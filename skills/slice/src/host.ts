// Host I/O layer: the agent+quota wrapper (agentSafe) and the deterministic shell proxies (sh/shForce/
// shBatch). Extracted from main.ts VERBATIM into a zero-dependency factory makeHost() — the whole layer
// closes over only ambient globals (agent/log) + its OWN quota state (QUOTA_HALT), nothing from config or
// git, so it lifts out cleanly. main.ts calls makeHost() once and threads these services into every phase.
import { circuitBreaker } from './util'
import type { ShResult, AgentOpts } from './types'

declare function agent(prompt: string, opts?: AgentOpts): Promise<any>
declare function log(message: string): void

export const makeHost = () => {
let QUOTA_HALT = ''
// SESSION-scope breaker: 3 consecutive null/failed agent results spanning ≥2 distinct call-classes.
// A6: same-class-only streaks arise by design (heavy 3-lens loop), so ≥2 distinct classes are
// required before treating the streak as a session-instability signal (not one role's transient flake).
const quotaBreaker = circuitBreaker(3, 2)
// A6: extract the call class from opts — the prefix before ':' or '·'.
const callClass = (opts?: AgentOpts) => ((opts && (opts.label || opts.phase)) || '').replace(/[:·].*/u, '').trim() || 'unknown'
const quotaHalt = (why: string) => {
  QUOTA_HALT = why
  log(`⛔ QUOTA HALT: ${why} — no further agents will be spawned; relaunch with resumeFromRunId after the cause clears (limit reset / model switch) — cached leaves replay free.`)
}
// A6: shared bump used in both null-return and catch paths — keeps the class-gate condition DRY.
const bumpNullStreak = (opts?: AgentOpts) => {
  quotaBreaker.record(callClass(opts))
  if (quotaBreaker.tripped()) quotaHalt(`${quotaBreaker.streak} consecutive agent failures (API/session quota suspected)`)
}
const agentSafe: typeof agent = async (prompt, opts) => {
  if (QUOTA_HALT) { log(`agent skipped (quota halt): ${(opts && (opts.label || opts.phase)) || ''}`); return null }
  try {
    const r = await agent(prompt, opts)
    if (r === null) { bumpNullStreak(opts) }
    else { quotaBreaker.reset() }
    return r
  }
  catch (e: any) {
    const m = String((e && e.message) || e)
    if (/budget|ceiling/i.test(m)) throw e
    if (/session limit|rate.?limit|quota|too many requests|overloaded|credit/i.test(m)) { quotaHalt(m.slice(0, 120)); return null }
    // Model-access failure = INFRA, not a work verdict. Observed live: the session model
    // (claude-fable-5) was not subagent-spawnable; the VERIFY/INTEGRATE/BRIEFING roles INHERIT
    // the session model, so they died with "issue with the selected model … may not have access".
    // Without this branch the null fell through to distrust → 3 untrusted verify-class leaves →
    // untrusted-streak HALT, misreading an infra outage as "the approach failed" (and losing the
    // briefing). Treat it like quota: an immediate resumable pause, not a grind. Resume after the
    // transient clears OR after switching the session model to a subagent-spawnable one.
    if (/issue with the selected model|may not have access to it|selected model.*may not exist/i.test(m)) {
      quotaHalt(`model unavailable to subagents (verify/integrate/briefing inherit the session model): ${m.slice(0, 90)}`)
      return null
    }
    log(`agent threw (treated as null): ${m.slice(0, 140)}`)
    bumpNullStreak(opts)
    return null
  }
}
// ---- sh(): deterministic shell escape. The COMMAND is computed in JS (deterministic); the
// agent is reduced to a verbatim `bash -c` proxy with zero latitude. Used for all purely-
// MECHANICAL git (no judgment) so it is not left to a non-deterministic LLM. The sandbox has
// no real exec(); this is the closest approximation — deterministic command, LLM as transport.
//
// A1/A7: When agentSafe returns null (sh proxy died — non-quota), we MUST NOT silently return
// { stdout:'', exitCode:1 } — that disguises the outage as "command ran but failed", which at
// decision points (git-sha / git-clean / lock-check) produces false reads (BASE_SHA='',
// gitClean=true, held=''). Instead we return SH_UNAVAILABLE so callers can detect the outage.
const SH_UNAVAILABLE: ShResult = { exitCode: -2, stdout: '\x00SH_UNAVAILABLE' }
// Shape-match fallback: reference equality breaks silently if a future refactor clones/serializes
// results between sh() and a decision site. exitCode -2 is unreachable from a real shell (0-255)
// and the \x00 prefix is unprintable — only the sentinel (or a lying proxy, fail-safe) matches.
const shUnavailable = (r: ShResult) =>
  r === SH_UNAVAILABLE || (!!r && r.exitCode === -2 && String(r.stdout).startsWith('\x00SH_UNAVAILABLE'))
const SH = { type: 'object', required: ['exitCode'], properties: { stdout: { type: 'string' }, exitCode: { type: 'integer' } } }
const sh = async (cmd: string, label?: string): Promise<ShResult> => {
  const r = (await agentSafe(
    `Run EXACTLY this shell command verbatim, then report its stdout and exit code. Do NOT add to, ` +
    `modify, interpret, explain, or run anything besides this one command:\n\n${cmd}`,
    { label: label || 'sh', model: 'haiku', schema: SH })) as ShResult | null
  return r ?? SH_UNAVAILABLE
}
// A2: shForce — mechanical cleanup path that bypasses QUOTA_HALT. Use ONLY for lock-clear (rm -f
// <lockfile>) — a purely deterministic, file-system-only operation that touches no user work and
// must run even after quota death so the stale lock doesn't block the user's guided resume. NEVER
// use for reset/merge/checkout or any command that could mutate user work: agentSafe is the gate
// for those so QUOTA_HALT correctly prevents runaway mutations; shForce is the narrow exception
// where NOT running would leave the repo in a permanently broken state (stale lock).
const shForce = async (cmd: string, label?: string): Promise<ShResult> => {
  try {
    const r = (await agent(
      `Run EXACTLY this shell command verbatim, then report its stdout and exit code. Do NOT add to, ` +
      `modify, interpret, explain, or run anything besides this one command:\n\n${cmd}`,
      { label: label || 'sh-force', model: 'haiku', schema: SH })) as ShResult | null
    return r ?? SH_UNAVAILABLE
  } catch (e: any) {
    log(`shForce failed (${label || 'sh-force'}): ${String((e && e.message) || e).slice(0, 120)}`)
    return SH_UNAVAILABLE
  }
}

// ITEM 6 (LATENCY): each sh() is a full agent round-trip. Independent / sequential-deterministic git
// is BATCHED into ONE sh() script per logical phase to pay one spawn instead of N serial spawns. The
// NON-NEGOTIABLE invariant: per-command outcome detection survives byte-for-byte. Every sub-command is
// followed by an EXIT MARKER `<<RS:name:$?>>` on its own line; its stdout precedes the marker. shBatch()
// parses those markers so a RED/failure in ANY sub-command is detected EXACTLY as before. The whole
// batch still goes through sh(), so a dead shell proxy returns SH_UNAVAILABLE for the WHOLE batch — and
// shUnavailable(raw) on the raw result stays FATAL (a dead proxy never silently reads as "no git").
//
// Authoring contract for the script passed to shBatch:
//   <command> ; printf '<<RS:NAME:%s>>\n' "$?"      ← stdout of <command>, then the marker line
// NAME must be a stable [A-Za-z0-9_-] token. parseBatch returns, per NAME: { code, out } where `out`
// is the captured stdout that PRECEDED that marker (between the previous marker and this one), trimmed
// of the trailing newline only — so `git status --porcelain` empties and SHAs are read verbatim.
const MARKER = /<<RS:([A-Za-z0-9_-]+):(-?\d+)>>/
// shBatch: run a marker-delimited multi-command script in ONE sh() round-trip; parse per-command
// {code,out}. Returns { raw, get(name) }. raw is the underlying ShResult so callers keep the
// shUnavailable() FATAL check verbatim (a dead proxy → raw is the sentinel → get() returns null for
// every name → callers detect the outage exactly as a single-command sh() death would surface it).
const shBatch = async (script: string, label?: string): Promise<{ raw: ShResult; get: (name: string) => { code: number; out: string } | null }> => {
  const raw = await sh(script, label)
  const dead = shUnavailable(raw)
  const stdout = raw.stdout || ''
  // Split on marker lines; segment i's stdout is everything before marker i since the previous marker.
  const map = new Map<string, { code: number; out: string }>()
  if (!dead) {
    let rest = stdout
    let m: RegExpMatchArray | null
    // Walk markers left-to-right; the text before each marker is that command's stdout.
    while ((m = rest.match(new RegExp(MARKER.source)))) {
      const idx = m.index || 0
      const before = rest.slice(0, idx)
      // Strip exactly one trailing newline that the `printf` line introduces; keep inner content verbatim.
      const out = before.replace(/\n$/, '')
      map.set(m[1], { code: parseInt(m[2], 10), out })
      rest = rest.slice(idx + m[0].length).replace(/^\n/, '')
    }
  }
  return { raw, get: (name: string) => map.get(name) || null }
}
  return { agentSafe, sh, shForce, shBatch, shUnavailable, SH_UNAVAILABLE, MARKER, getQuotaHalt: () => QUOTA_HALT }
}
