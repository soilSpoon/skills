// NOTE: the runtime-required `export const meta = {...}` literal lives in tsup.config.ts
// (banner) — a bundler would relocate an in-module export away from the top of the file.

import { BASELINE, DECOMPOSE, SLICES, LEARNING, RESULT, VERDICT, MISSING, BRIEFING } from './schemas'
import { R_BASELINE, R_SLICE, R_EXEC, R_VERIFY, R_VERIFY_LIGHT, R_CRITIC, R_COORD } from './prompts'
import type { EngineArgs, Baseline, Decompose, SliceSpec, ExecResult, Verdict, ShResult, WorkNode, LeafRecord, Groups, EngineResult, RiskTier, SliceKind, Briefing, GateLevel } from './types'

// ===== Workflow runtime ambient contract (the PORT) ==========================
// Any host that injects these globals can run the emitted engine unchanged:
// Claude Code's Workflow tool provides them natively; other harnesses can adapt
// by implementing this exact surface (see references/portable-orchestration.md).
// All declarations below are erased at build time.
type ModelTier = 'sonnet' | 'opus' | 'haiku' | 'fable'
interface AgentOpts {
  label?: string
  phase?: string
  schema?: Record<string, unknown>
  model?: ModelTier
  isolation?: 'worktree'
  agentType?: string
}
declare function agent(prompt: string, opts?: AgentOpts): Promise<any>
declare function parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>
declare function phase(title: string): void
declare function log(message: string): void
declare const args: unknown
declare const budget: { total: number | null; spent(): number; remaining(): number }
// ITEM 2: the host runs the emitted engine as a Node AsyncFunction body, so Node's `Buffer` global is
// always present — declared here (erased at build time, like the rest of the PORT) ONLY to base64-encode
// the owner-briefing text injection-safely before it is handed to the deterministic `sh` write proxy.
declare const Buffer: { from(s: string, enc: string): { toString(enc: string): string } }

async function __main(): Promise<EngineResult> {
// Runtime-throw containment: agent() can THROW rather than return null (observed live:
// "subagent completed without calling StructuredOutput" killed a 50-agent, 5-hour run that
// the null path would have survived — the engine already treats null as distrust/retry at
// every call site). Convert throws to null; budget/ceiling throws stay fatal — they mean
// STOP, and the Integrate try/catch owns that cleanup path.
// ITEM 11a: ONE circuit-breaker abstraction, instantiated three ways (this engine had three ad-hoc
// counter+constant+comment clusters that are the SAME breaker at different (class, scope)). A breaker
// counts a consecutive failure streak and, optionally, the DISTINCT call-classes seen during it; it
// trips when streak ≥ `threshold` AND the distinct-class count ≥ `classThreshold` (default 0 = no
// class gate — `record()` is called with no class and the gate is vacuously true). The three guards
// below parameterize it: quota = circuitBreaker(3, 2) at SESSION scope (≥2 distinct classes is part of
// its trip rule), untrusted = circuitBreaker(MAX_UNTRUSTED_STREAK) at UNIT scope, t0red =
// circuitBreaker(2) at RUN scope. Behavior-preserving: thresholds, scopes, halt/disable ACTIONS, and
// resumability are UNCHANGED — only the three counters are replaced by named parameterizations.
//   • `.record(klass?)` bumps the streak (and adds the class when given), returns the new streak;
//   • `.streak` exposes the live count (some ACTION log lines embed it verbatim);
//   • `.tripped()` is the trip predicate (threshold + class gate); `.reset()` clears streak+classes.
const circuitBreaker = (threshold: number, classThreshold = 0) => {
  let streak = 0
  const classes = new Set<string>()
  return {
    record(klass?: string) { streak++; if (klass !== undefined) classes.add(klass); return streak },
    get streak() { return streak },
    tripped() { return streak >= threshold && classes.size >= classThreshold },
    reset() { streak = 0; classes.clear() },
  }
}
// Quota circuit breaker: a session/usage-limit death is NOT a one-off null — left alone it
// kills every subsequent agent serially (observed live: 12 consecutive corpses after one
// "You've hit your session limit"). First quota-shaped error (or 3 consecutive nulls of any
// cause) flips QUOTA_HALT; from then on agentSafe no-ops, loops stop cleanly, and the run
// ends resumable instead of burning attempts until the harness gives up.
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
// ---- args: { task, repo, maxDepth?, parallel? } -----------------------------
const A = ((typeof args === 'string') ? JSON.parse(args) : (args || {})) as EngineArgs   // tolerate stringified args
// I7: refuse to run without a task — a resume that forgot the original args once ran a full
// no-op pipeline (baseline + leaf + integrate, ~168k tokens) doing literally nothing.
if (!A.task) {
  log('FATAL: no task in args — refusing to run. (Resuming? Pass the ORIGINAL args alongside resumeFromRunId.)')
  return { error: 'no task provided — pass args.task (a resume must pass the original args)' }
}
const TASK = A.task
const REPO = A.repo || '.'
const FLOOR = A.maxDepth || 3            // recursion depth cap (anti-explosion)
const PARALLEL = A.parallel !== false    // DEFAULT ON: parallelize independent top-level slices (git worktrees).
                                         // Explicit `parallel:false` opts out. The decision is cheap to default because the
                                         // downstream guards (GIT + clean tree + cheap builds + ≥2 INDEPENDENT groups) auto-
                                         // fall-back to sequential whenever parallel is unsafe or unbeneficial — so default-on
                                         // means "parallelize where it actually helps," never "force worktrees blindly."
const FORCE_PARALLEL = A.forceParallel === true   // override the compile-bound auto-fallback to sequential
const CONFIRM_TIER = A.confirmTier === true        // opt-in: override the depth-0 over-tier stop (compile-bound + small breadth + all-light)
const CONFIRM_NO_RIG = A.confirmNoRig === true     // opt-in: override the post-baseline testing-readiness gate (baseliner judged no runnable test rig → empty trust floor)
const SHARED_SCRATCH = A.sharedScratch === true   // compile-bound parallel WITHOUT per-worktree cold builds: all
                                                  // worktrees share ONE build dir (--scratch-path) so dependency
                                                  // artifacts compile once; builds serialize on its lock (measured:
                                                  // 3×cold ≈ 9-15min vs serialized-warm ≈ 1-2min). Opt-in: assumes a
                                                  // SwiftPM-style builder whose test wrapper passes flags through.
const MAX_LEAVES = 24                    // hard backstop on total executed work units (per work-unit/group)
let OVER_TIER_STOP = ''                 // depth-0 over-tier gate sentinel (mirrors the QUOTA_HALT string flag): reason string, '' = not tripped; set in runWork, consumed at the top-level call site so the lock-safe teardown still runs
let OVER_TIER_SLICES = 0                // breadth that tripped the over-tier stop (machine-readable ETA in the EngineResult)
const MAX_DISCOVERED = 8                 // backstop on Canon-TDD discover-as-you-go feedback growth
const MAX_SPIKES = 1                     // per-node spike cap (work must bottom out)
const MAX_REPAIR = 1                     // default self-repair budget before reverting an untrusted leaf
const MAX_REPAIR_HARD = 3                // I2: convergence-extended ceiling — extra repairs allowed ONLY while the
                                         // objection count strictly shrinks (a leaf once landed on repair 3 as
                                         // objections went 3→1; divergence still stops at the default)
const MAX_WORKERS = 4                    // concurrent worktree groups (goose review: 4 = sweet spot before rate-limit/contention)
const MAX_UNTRUSTED_STREAK = 3           // A: run-level no-progress detection — N consecutive untrusted leaves means
                                         // the APPROACH is failing (bad decomposition / broken env / API trouble);
                                         // halt the unit instead of grinding the budget into more reverts
const ENGINE_DIFF_CAP = 6000             // ITEM 9: max chars of leaf diff injected as ENGINE-DIFF into a verify
                                         // prompt; above this, point the verifier back at git (gitVerify) rather
                                         // than flood the prompt with a giant diff it would not read anyway

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

// =============================================================================
phase('Baseline')
log(`Task: ${TASK}${PARALLEL ? ' [parallel mode]' : ''}`)
const baseline: Baseline | null = await agentSafe(
  `${R_BASELINE}\n\nRepo: ${REPO}\nUpcoming work: "${TASK}"\nEstablish the trust invariant BEFORE any change. ` +
  `Find the measurement command, run it once, and distill the project card.`,
  { phase: 'Baseline', model: 'sonnet', schema: BASELINE })
if (!baseline) { log('FATAL: baseline agent returned no result (API/rate-limit) — aborting before any change.'); return { error: 'baseline failed', task: TASK } }
log(`Baseline: ${baseline.currentState} | measure: ${baseline.measureCommand}`)
// TESTING-READINESS GATE — enforce the Baseliner's rigPresent verdict. The trust floor ("an existing green test
// going red is a violation") is meaningful ONLY if a real runnable rig exists; rigPresent===false means
// measureCommand is vacuous, every per-leaf filtered gate degrades to gate=llm-only, and the integrate net runs a
// command that cannot go red — so "still works" would be an EMPTY-floor false green. Halt BEFORE any work. The lock
// is NOT yet held here (LOCKFILE assigned ~428, written ~452-454, prologue starts ~318) → no shForce cleanup,
// unlike the over-tier gate (1097) and final teardown (1281). undefined NEVER trips (older/resumed baselines); only
// an explicit false does. confirmNoRig:true collapses the guard so the owner can proceed onto the empty floor.
if (baseline.rigPresent === false && !CONFIRM_NO_RIG) {
  log(`TESTING-READINESS STOP: baseliner judged NO runnable test rig (no scripts/verify.sh, no test files, no test command). The trust floor would be empty — 'still works' would be unverifiable. Scaffold a rig (test-foundations: add scripts/verify.sh or a real test command), then re-run. To proceed anyway, re-run with confirmNoRig:true. (No lock taken; nothing changed.)`)
  return { error: `no runnable test rig — baseliner reported rigPresent:false; add a test rig (test-foundations: scripts/verify.sh or a real test command) or re-run with confirmNoRig:true`, task: TASK, baseline, noRigStop: true }
}
const CARD = baseline.projectCard
  ? `\nProject card (authoritative repo conventions — use instead of re-reading AGENTS.md unless insufficient):\n${baseline.projectCard}`
  : ''
// ① Purpose context — threaded everywhere (via INV) so leaves/verifiers know how the work is REALLY
// verified for the user, and flag the gap when only fakes are reachable.
const PURPOSE = baseline.purposeCheck
  ? `\nPurpose (does it ACTUALLY work for the user, not just the tests?): ${baseline.purposeCheck}${baseline.inProcessVerifiable === false ? ' [NOT verifiable in-process — needs a real env / human; a purposeGap is expected]' : ''}`
  : ''
// Domain-guidance skills (args.skills): paths to SKILL.md-style guide files (framework
// best-practices, house style). Threaded into EVERY role prompt via INV so executors apply
// them and verifiers enforce them. Selecting WHICH guides fit the task is the front door's
// judgment — the engine just delivers paths (agents Read them on demand; content never
// inflates the prompt). Capped to keep leaf context lean.
const SKILL_PATHS = (Array.isArray(A.skills) ? A.skills : []).filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, 8)
const SKILLS_NOTE = SKILL_PATHS.length
  ? `\nDOMAIN GUIDANCE (part of the contract): RELEVANCE GATE first — match each guide's domain ` +
    `(visible in its path/name) against YOUR contract's files and topic, and SKIP entirely (do not ` +
    `read even its index) any guide whose domain clearly does not apply to this leaf (e.g. a frontend ` +
    `guide on a backend-only leaf). For the guides that DO apply: Read them — house style / ` +
    `best-practice rules the owner expects. Follow their progressive disclosure: read the index/SKILL.md, ` +
    `then only the rule files relevant to YOUR change.\n- ${SKILL_PATHS.join('\n- ')}\n` +
    `Executors apply them; verifiers treat clear violations as issues (a skipped non-matching guide is ` +
    `never a violation). On conflict, the repo's own established conventions win.`
  : ''
const INV = `Baseline to preserve:\n- ${baseline.invariants.join('\n- ')}\nMeasure: ${baseline.measureCommand}${CARD}${PURPOSE}${SKILLS_NOTE}`

// ④ Leaf test discipline (MEASURED on a real run: re-running the FULL suite at every leaf — recompiling +
// running all unrelated tests — was 68% of shell time and 61% of test runs). The engine DETERMINISTICALLY
// decides where the full command is allowed: FORBIDDEN at a leaf, run ONCE at integration (the net). A leaf
// runs only its FILTERED tests, and is given the scope so it never falls back to the concrete full command.
const LEAF_TEST = (scope?: string) =>
  `\nLEAF TEST DISCIPLINE (measured #1 time cost): at THIS leaf run ONLY the FILTERED tests — the bare full ` +
  `measure command (\`${baseline.measureCommand}\`) is FORBIDDEN here (it recompiles + runs the whole unrelated ` +
  `suite; it runs ONCE at integration as the net). ` +
  (scope ? `Test scope = \`${scope}\` — run the project-card filter form scoped to it, and NAME the test you add so this EXACT token matches the runner's filter. Know your runner: many match a FUNCTION/TEST-NAME substring (Swift Testing \`--filter\`, pytest \`-k\`) — for those put \`${scope}\` IN the @Test/test-function name, NOT a suite path; suite-path runners match the suite/class name. (The engine re-runs this filter as the deterministic gate; a name mismatch = zero tests matched, which now degrades THIS leaf to LLM-verify — a FINDING, not a false RED.) `
         : `Filter to the test you add or touch — match the runner's filter syntax (function-name substring for Swift Testing/pytest; suite path otherwise). `) +
  `A full BUILD is fine; a full TEST run is not. STATIC CHECKS (lint/typecheck) follow the same rule: scope them to ` +
  `the files you changed when the toolchain supports it (e.g. lint only changed paths; rely on the typechecker's ` +
  `incremental cache) — a WHOLE-PROJECT lint/typecheck belongs to the integration net, not to every edit. ` +
  `Minimize re-runs: red once, green once, post-refactor once — do not re-run an unchanged check. ` +
  `Never poll or busy-wait on other processes (no pgrep/sleep loops — one such loop once wasted 5 minutes); run your command directly and let the build tool's own lock serialize.`

// ITEM 8 (KEYSTONE): the engine's deepest idea — run a deterministic shell command, then a model JUDGES from
// that FIXED result (never re-runs) — was hand-reimplemented at the two leaf gates (filtered tier-0 + tidy
// full-suite). This is the ONE canonical "shell-truth → ENGINE-RAN → model judges" string builder for those
// sites: it states the command, its exit, and an output tail, then hands the verifier its `duty` (confirm a
// real test ran / judge the artifacts) — explicitly WITHOUT re-running. The control flow that decides WHEN each
// gate runs and how RED is handled legitimately differs per site and stays inline; only this shared STRING is
// extracted here. (The merge/integrate nets use a different surface form — `exit=N (GREEN/RED)` mid-prose, no
// ENGINE-RAN prefix / no tail — so they are NOT folded in: that would change the byte-text the verifier sees.)
const engineRanBlock = ({ cmd, note, exitCode, tail, duty }: { cmd: string; note?: string; exitCode: number; tail: string; duty: string }): string =>
  `\nENGINE-RAN: \`${cmd}\`${note ? ' ' + note : ''} exited ${exitCode}. Output tail: ${tail}\n${duty}`

// Deterministic gitSha — do NOT rely on the LLM baseliner to remember it (it once silently
// didn't, disabling git mode). A fixed `git rev-parse HEAD`, run verbatim, owns this.
//
// ITEM 6 (LATENCY): the prologue was 5 SERIAL sh() spawns (git-sha, git-clean, lock-dir, lock-check,
// lock-write) BEFORE the first leaf. They are all deterministic JS-computed git, and lock-check→write
// is a sequential dependency — perfect for ONE batched sh() round-trip. Commands stay verbatim; each
// emits an EXIT MARKER so per-command outcome detection is byte-for-byte unchanged (parsed below).
// BONUS: batching lock-dir+check+write into one script TIGHTENS atomicity — there is no JS round-trip
// gap between reading the lock and writing it, so two concurrent runs can no longer interleave there.
//
// A1/A7: if the shell proxy is dead, shUnavailable(prologue.raw) is true; treat that as FATAL — not as
// "no git" (which would silently downgrade to sequential-no-revert mode, hiding the outage). A dead
// proxy kills the WHOLE batch, so this ONE check covers every decision point the batch carries.
// Lock-dir retry: a single transport hiccup on the batch retries ONCE before aborting (same guarantee
// the per-call lock-dir retry gave — proceeding lock-less after 'git mode ON' stays strictly forbidden).
//
// BASE_SHA is captured FROM the batch (git-sha marker), but the lock content embeds that sha — so the
// prologue is TWO batches: batch-1 = git-sha + git-clean + lock-dir + lock-check (all reads, no
// mutation), then JS decides held/abort using the lock-check marker, then batch-2 = the single
// conditional lock-write whose content carries the real BASE_SHA from batch-1. The check-then-write
// stays atomic at the decision (lock-write re-tests `! -s` inside the same shell so a racing run that
// grabbed the lock between the two batches still loses the write), and the 'lock held → abort' path
// fires in JS from the lock-check marker exactly as the old per-call lock-check did. 5 spawns → 2.
//
// --- Batch 1: git-sha + git-clean + lock-dir + lock-check (all reads, no mutation) ---
const probe =
  `git -C ${REPO} rev-parse HEAD 2>/dev/null; printf '<<RS:git-sha:%s>>\\n' "$?"; ` +
  `git -C ${REPO} status --porcelain 2>/dev/null; printf '<<RS:git-clean:%s>>\\n' "$?"; ` +
  `GD="$(git -C ${REPO} rev-parse --absolute-git-dir 2>/dev/null)"; ec=$?; printf '%s\\n' "$GD"; printf '<<RS:lock-dir:%s>>\\n' "$ec"; ` +
  `if [ -n "$GD" ]; then cat "$GD/rs-lock" 2>/dev/null; printf '<<RS:lock-check:%s>>\\n' "$?"; fi`
let prologue = await shBatch(probe, 'prologue')
if (shUnavailable(prologue.raw)) {
  // Lock-dir retry parity: one transport hiccup retries the whole read-batch ONCE before aborting.
  log('shell-proxy returned no result for prologue (git-sha/clean/lock) — retrying once …')
  prologue = await shBatch(probe, 'prologue-retry')
}
if (shUnavailable(prologue.raw)) {
  log('FATAL: shell-proxy agent returned no result for prologue (git-sha/git-clean/lock) — cannot determine git state; aborting.')
  return { error: 'shell-proxy unavailable at prologue decision point', task: TASK }
}
const shaSeg = prologue.get('git-sha')
const cleanSeg = prologue.get('git-clean')
// A1/A7: a missing git-sha marker means the batch ran but the marker protocol broke — treat as fatal
// rather than reading an absent marker as "no git" (a silent git-mode-OFF downgrade).
if (!shaSeg) {
  log('FATAL: prologue batch produced no git-sha marker — cannot determine git state; aborting.')
  return { error: 'shell-proxy unavailable at git-sha decision point', task: TASK }
}
const headOut = shaSeg.out
const BASE_SHA = (headOut.match(/[0-9a-f]{40}/i) || [''])[0]
const GIT = !!BASE_SHA
// A1/A7: a shell-proxy death at git-clean must not be silently read as "clean tree" (empty output = clean).
// In the batch this is covered by the whole-batch shUnavailable guard above; but if GIT is on we also
// require the git-clean marker to be present (its absence = broken protocol = fatal, not silent-clean).
if (GIT && !cleanSeg) {
  log('FATAL: prologue batch produced no git-clean marker — cannot determine working tree state; aborting.')
  return { error: 'shell-proxy unavailable at git-clean decision point', task: TASK }
}
const gitClean = GIT ? (cleanSeg!.out.trim() === '') : false
const GIT_EXEC = GIT
  ? `\nGit: after GREEN, commit the behavior step (\`git add -A && git commit -m "test: ..."\`); after any ` +
    `refactor, a SEPARATE commit (two hats). Commit ONLY in-scope files. Report SHAs in \`commits\`.`
  : ''
// Leaf verifiers diff from the LEAF's pre-state (not the run baseline): diffing BASE_SHA..HEAD at a
// later leaf includes every SIBLING's committed work and reads as out-of-scope drift (observed live —
// an integrator flagged exactly this confusion). Integration still uses BASE_SHA for the whole deposit.
const gitVerify = (repo: string, from?: string) => GIT
  ? `\nGit: inspect the exact change with \`git -C ${repo} diff ${from || BASE_SHA}..HEAD\` and \`git -C ${repo} status\` — ` +
    `confirm ONLY in-scope files changed within this range (it starts at this work's pre-state; precise drift detection).`
  : ''
if (GIT) log(`git mode ON — baseline pinned at ${BASE_SHA.slice(0, 8)} (clean=${gitClean}) [deterministic capture]`)
else log('git mode OFF (no .git) — sequential only, no per-leaf commits/reversibility/worktrees')
if (GIT && gitClean === false) log(`⚠ DIRTY baseline tree — uncommitted edits will look like invariant violations (noisy false-negatives). Prefer a clean tree.`)

// ITEM 7 (observability/memory — PURE OBSERVATION, zero invariant risk): the engine's biggest historical
// win (Lesson 8's filtered-at-leaf cost/verdict profile) needed a HUMAN reading logs the engine never
// emitted. trace() makes the engine auto-emit its own cost/verdict profile: ONE JSONL line per agent()
// call (and per deterministic gate, when known) appended to docs/run-traces/<baseSha>.jsonl. This file is
// machine-readable (JSONL) and survives the conversation, unlocking the OUTER self-improvement loop (a
// later run / a tool can read the profile the engine produced about itself). It is a PASSIVE observer:
//   • it gates NO trust and touches NONE of the four invariants — it only records what already happened;
//   • the append goes through the same deterministic `sh` write proxy as ITEM 2's briefing-persist, and is
//     INJECTION-SAFE the same way: the JSON line (which can embed arbitrary role/label/model text) is
//     base64-encoded in JS — the [A-Za-z0-9+/=] alphabet is shell-safe — and decoded by `base64 -d`, so no
//     LLM/agent text ever reaches the shell command verbatim (the keep-text-out-of-shell discipline);
//   • <baseSha>: the run has no clock in its context, so the file is named from the pinned baseline SHA
//     (deterministic + stable across a run), falling back to a fixed name when git is off;
//   • the whole thing is wrapped in its OWN try/catch that NEVER aborts the run — a failed append (dead
//     proxy, full disk, sh error) must not cost a green run a single trusted leaf. Best-effort, fire-and-
//     forget: trace() is awaited only so the test can observe the sh call, never to gate any decision.
const TRACE_FILE = `${REPO}/docs/run-traces/${BASE_SHA ? BASE_SHA.slice(0, 12) : 'no-git'}.jsonl`
type TraceRecord = {
  phase: string
  role?: string
  model?: string
  leafIndex?: number
  gateLevel?: GateLevel
  trustworthy?: boolean
  repairAttempt?: number
}
const trace = async (rec: TraceRecord): Promise<void> => {
  try {
    // Stamp the baseline SHA on every line; drop undefined fields so the JSONL stays compact + only
    // carries facts the engine actually knows at this call site (leafIndex/gateLevel/trustworthy/etc.).
    const line: Record<string, unknown> = { baseSha: BASE_SHA || null }
    for (const [k, v] of Object.entries(rec)) if (v !== undefined) line[k] = v
    const json = JSON.stringify(line)
    const b64 = Buffer.from(json + '\n', 'utf8').toString('base64')
    // mkdir -p the dir, then base64-decode the line and `>>` APPEND it (one line per call). The b64
    // alphabet is shell-safe, so the arbitrary role/label/model text never reaches the shell verbatim.
    await sh(`mkdir -p ${REPO}/docs/run-traces && printf %s '${b64}' | base64 -d >> ${TRACE_FILE}`, 'trace-append')
  } catch (e) { log(`trace append skipped (${e && (e as Error).message ? (e as Error).message : e}) — observability only, run unaffected`) }
}

// Inter-run mutual exclusion (Lesson 9): two engine runs mutating the SAME working tree corrupt each
// other (one run's verifier sees the other's edits as drift; restores clobber foreign leaves). A
// deterministic lock in the tree's REAL gitdir (resolved via --absolute-git-dir, so each worktree has
// its OWN lock — isolated worktrees may run concurrently, the same tree may not). Content is just the
// base SHA (no task text — keep user text out of shell commands). A crashed run leaves a stale lock:
// the front door clears it after confirming no run is alive. Cleared deterministically at the end.
let LOCKFILE = ''
if (GIT) {
  // lock-dir + lock-check were captured in batch-1 (the prologue) — no extra round-trip. A1 (4th
  // point): a dead proxy already aborted via the whole-batch shUnavailable guard above (with the
  // ONE retry), so reaching here means the batch ran; we now read its lock-dir / lock-check markers.
  // A missing lock-dir marker (protocol broke while GIT is on) is fatal — proceeding lock-less after
  // 'git mode ON' is strictly forbidden, and an absent marker must NOT silently set LOCKFILE=''.
  const lockDirSeg = prologue.get('lock-dir')
  if (!lockDirSeg) {
    log('FATAL: prologue batch produced no lock-dir marker — cannot establish mutual exclusion; aborting.')
    return { error: 'shell-proxy unavailable at lock-dir decision point', task: TASK }
  }
  const gd = lockDirSeg.out.trim().split('\n').pop() || ''
  if (gd && gd.startsWith('/')) {
    LOCKFILE = `${gd}/rs-lock`
    // A1/A7: the lock-check marker MUST be present — its absence (gitdir resolved but no lock-check
    // segment) means the batch's lock read was lost; that must NOT read as "held=''" (no lock held),
    // which would let a second concurrent engine clobber the working tree. Treat as fatal.
    const lockCheckSeg = prologue.get('lock-check')
    if (!lockCheckSeg) {
      log('FATAL: prologue batch produced no lock-check marker — cannot verify mutual exclusion; aborting.')
      return { error: 'shell-proxy unavailable at lock-check decision point', task: TASK }
    }
    const held = lockCheckSeg.out.trim()
    if (held) {
      log(`FATAL: another recursive-slice run holds this working tree (lock: ${held}). If that run crashed/was killed, remove ${LOCKFILE} and relaunch.`)
      return { error: 'working tree locked by another recursive-slice run', lock: held, lockFile: LOCKFILE, task: TASK }
    }
    // --- Batch 2: the single conditional lock-write (carries the real BASE_SHA from batch-1) ---
    // A1 (same class as lock-check): if sh proxy dies writing the lock, the engine would proceed
    // believing it holds the lock when it does not — a second concurrent run could clobber the
    // working tree. Treat as fatal. The `[ ! -s ]` re-test inside the same shell keeps check-then-write
    // atomic at the write itself: a run that grabbed the lock between batch-1 and batch-2 makes the
    // file non-empty, so this write is skipped and lock-write reports skipped — JS then aborts.
    // The write marker uses a NON-numeric `race` sentinel for the else branch so it is distinguishable
    // from a real exit code (a numeric marker = the write ran; `race` = the file became non-empty between
    // the two batches). We detect `race` from the raw output (it deliberately does NOT parse as a marker
    // code, so get('lock-write') returns null for it), and `wrote` (any numeric marker) means it ran.
    const writeBatch = await shBatch(
      `if [ ! -s "${LOCKFILE}" ]; then echo rs-${BASE_SHA.slice(0, 12)} > "${LOCKFILE}"; printf '<<RS:lock-write:%s>>\\n' "$?"; else printf '<<RS-RACE:lock-write>>\\n'; fi`,
      'lock-write')
    if (shUnavailable(writeBatch.raw)) {
      log('FATAL: shell-proxy unavailable at lock-write — lock file not written; cannot guarantee mutual exclusion; aborting.')
      return { error: 'shell-proxy unavailable at lock-write decision point', task: TASK }
    }
    // A racing run grabbed the lock between batch-1 and batch-2 (file became non-empty → the `else`
    // branch emitted the RACE sentinel): abort rather than clobber a concurrent run's lock.
    if (/<<RS-RACE:lock-write>>/.test(writeBatch.raw.stdout || '')) {
      log(`FATAL: another recursive-slice run grabbed this working tree between lock-check and lock-write. Remove ${LOCKFILE} if that run is dead, then relaunch.`)
      return { error: 'working tree locked by a concurrent recursive-slice run (lock-write race)', lockFile: LOCKFILE, task: TASK }
    }
    const writeSeg = writeBatch.get('lock-write')
    // Missing marker AND no race sentinel = batch ran but protocol broke → cannot confirm the lock was
    // written → fatal (never proceed believing the lock is held when we cannot prove it).
    if (!writeSeg) {
      log('FATAL: lock-write batch produced no lock-write marker — lock not confirmed; aborting.')
      return { error: 'shell-proxy unavailable at lock-write decision point', task: TASK }
    }
    if (writeSeg.code !== 0) {
      log(`FATAL: lock-write failed (exit ${writeSeg.code}) — lock file not written; cannot guarantee mutual exclusion; aborting.`)
      return { error: 'shell-proxy unavailable at lock-write decision point', task: TASK }
    }
  }
}

// ---- Risk-tiered verification: spend scrutiny where trust is fragile.
//   light (easy)    → audit diff/tests, no full re-run (integration is the net)
//   standard        → one independent reproduction
//   heavy (hard)    → 3 perspective-diverse skeptics (PARALLEL — runtime queues concurrent calls safely); UNANIMOUS trust required
const verifyLeaf = async (lbl: string, node: WorkNode, res: ExecResult, tier: RiskTier | undefined, repo: string, leafStart: string, engineT0: string, buildNote: string): Promise<Verdict> => {
  // ④ tidy: engine already ran the full suite (ENGINE-RAN); light: diff-audit path — no filter-run;
  // engineT0 non-empty: engine already ran filtered gate — injecting LEAF_TEST is contradictory noise.
  const leafTest = (node.kind === 'tidy' || tier === 'light' || !!engineT0) ? '' : LEAF_TEST(node.testScope)
  // F5: the executor's own ADMISSIONS (discovered/refactor/interfaceConcern) are the verifier's best leads —
  // never truncate those away; clip only the prose. The real diff is read via git, not from `res.diff`.
  const reported = JSON.stringify({
    summary: String(res.summary || '').slice(0, 400), passed: res.passed,
    evidence: String(res.evidence || '').slice(0, 500),
    filesChanged: res.filesChanged, commits: res.commits, refactor: res.refactor,
    interfaceConcern: res.interfaceConcern, discovered: res.discovered, purposeVerified: res.purposeVerified,
  })
  // F6: a "refactor" commit once smuggled in a behavior change — with 2+ commits, audit each hat separately.
  const hats = GIT && res.commits && res.commits.length >= 2
    ? `\nTWO-HATS AUDIT: ${res.commits.length} commits — diff EACH separately (\`git -C ${repo} show <sha>\`); a structure/refactor commit must be strictly behavior-preserving (no test or behavior change smuggled in).`
    : ''
  // ITEM 9: R_VERIFY promises "any ENGINE-DIFF/ENGINE-RAN block in this prompt is that material — use it
  // instead of re-greping", but the engine only ever emitted ENGINE-RAN — so the verifier re-greped the
  // leaf's diff via git (its #1 measured hidden cost). Run that scoped diff ONCE deterministically here and
  // hand it over. This is engine SHELL-TRUTH (a fixed `git diff` over the leaf range, test files excluded the
  // way the wiring-audit does), NOT a sibling model's claim — so executor!=verifier still holds: the verifier
  // KEEPS its full duty and ability to re-run / widen the range (gitVerify already tells it how). Skip for
  // tidy leaves: their behavior-preservation gate has its own flow and a diff fetch only complicates it.
  // Capped at ENGINE_DIFF_CAP chars — above the cap, point the verifier back at git rather than flood the prompt.
  let engineDiff = ''
  if (GIT && leafStart && node.kind !== 'tidy') {
    const d = await sh(
      `git -C ${repo} diff ${leafStart}..HEAD -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null || true`,
      `verify-diff:${lbl}`)
    if (!shUnavailable(d)) {
      const body = String(d.stdout || '')
      engineDiff = body.length > ENGINE_DIFF_CAP
        ? `\nENGINE-DIFF: (diff too large — inspect via git yourself)`
        : `\nENGINE-DIFF: ${body}`
    }
  }
  const base = `${R_VERIFY}\n\nRepo: ${repo}\nAdversarially verify this finished leaf.\nTask: ${node.task}\n` +
    `Reported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineDiff}${engineT0 || ''}${buildNote || ''}`
  if (node.kind === 'tidy') {   // ③ a tidy leaf must be BEHAVIOR-PRESERVING — verify THAT, not new-feature trust
    return (await agentSafe(
      `${base}\nThis is a TIDY-FIRST leaf: a behavior-PRESERVING structural change. Trust it ONLY if the existing ` +
      `suite is GREEN, NO test was added/changed/deleted, and the diff is a pure structural refactor with NO ` +
      `observable behavior change. Adding tests or changing behavior in a tidy leaf is a FINDING (untrusted).`,
      { phase: 'Work', label: `verify:${lbl}·tidy`, model: 'sonnet', schema: VERDICT }))
      || { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'light') {
    return (await agentSafe(
      `${R_VERIFY_LIGHT}\n\nRepo: ${repo}\nLow-risk leaf: ${node.task}\nReported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ''}${buildNote || ''}`,
      { phase: 'Work', label: `verify:${lbl}·light`, model: 'sonnet', schema: VERDICT }))
      || { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'heavy') {
    const lenses = ['correctness & reproduce the green', 'security: secrets/credentials NEVER logged or leaked', 'interface & cross-module drift']
    // C: the correctness lens (index 0) runs on a DIFFERENT model — homogeneous consensus re-confirms
    // shared blind spots rather than producing independent evidence; cross-model diversity is cheap
    // independence, spent only where trust is most fragile (heavy leaves).
    // Run all 3 lenses in parallel: the Workflow runtime queues concurrent calls against its concurrency
    // cap, so nesting parallel() is safe — ~3× faster heavy-leaf verification vs. sequential.
    const rawVotes = await parallel(lenses.map((L, li) => async () => {
      const v: Verdict | null = await agentSafe(`${base}\nLENS: judge specifically through "${L}".`,
        { phase: 'Work', label: `verify:${lbl}·${L.slice(0, 9)}`, ...(li === 0 ? { model: 'opus' } : {}), schema: VERDICT })
      return v || { trustworthy: false, reason: `lens "${L}" verifier unavailable — counts as distrust` }
    }))                                                          // null lens = distrust: a flaky run can't launder a hard leaf
    // parallel() returns T|null per thunk (catches thunk throws); a null slot also counts as distrust.
    const votes: Verdict[] = rawVotes.map((v, li) => v ?? { trustworthy: false, reason: `lens "${lenses[li]}" verifier unavailable — counts as distrust` })
    const distrust = votes.filter(v => !v.trustworthy)
    return {
      trustworthy: distrust.length === 0,                       // UNANIMOUS across ALL 3 lenses (null counts against)
      reason: `heavy verify: ${votes.length} lenses, ${distrust.length} distrusted`,
      issues: votes.flatMap(v => v.issues || []),
      purposeGap: votes.map(v => v.purposeGap).filter(Boolean).join('; ') || undefined,   // ① don't drop a hard-leaf purpose gap
      prescription: votes.map(v => v.prescription).filter(Boolean).join(' | ') || undefined,   // I3: lens prescriptions feed repair
      followUps: votes.flatMap(v => v.followUps || []),                                        // I4: lens follow-ups feed the batch
    }
  }
  return (await agentSafe(base, { phase: 'Work', label: `verify:${lbl}`, schema: VERDICT }))
    || { trustworthy: false, reason: 'verification unavailable — untrusted' }
}

// ---- runWork: the recursive decomposition+execution loop for ONE work unit, in ONE repo
// (the main checkout, or a group's worktree). Sequential + Canon-TDD discover-as-you-go.
// Returns { done } — the list of leaf results. No integration here (that's the caller's job).
// ITEM 11a: RUN-scope breaker — consecutive engine-RED-vs-executor-green disagreements (run-global, like
// the template it disables). Trips at 2 (no class gate). I1 fallback: a broken filterCommand template
// false-REDs every leaf run-wide; after 2 in a row, distrust the TEMPLATE (kill it), not the leaves.
const t0redBreaker = circuitBreaker(2)
// ① A filtered t0 run that exits NON-ZERO because the filter matched ZERO tests (a scope/name mismatch —
// Swift Testing exits 1 with "matched zero tests" / "Test run with 0 tests" / "No matching test cases")
// is NOT a real failure and NOT a broken template — it is a per-leaf scope mismatch. Telling it apart from
// a real red (tests ran AND failed) stops ONE mismatched scope from tripping t0redBreaker and disabling
// deterministic gating run-wide (observed live on MailKit: 13 leaves silently llm-only). Regex verified
// against the actual `./scripts/test.sh --filter <none>` output; broadened for other runners.
const RE_ZERO_TESTS = /matched zero tests|no matching test cases|test run with 0 tests|\b(executed|ran|found|matched|collected)\s+0\s+(tests?|items?)\b|\bno tests? (were\s+)?(found|ran|run|matched|to run|collected|executed)\b|\b0 tests? (passed|ran|found|matched|executed)\b/i
const ABORTS: string[] = []     // A: units halted by the untrusted-streak guard (surfaced in the final payload)
async function runWork(rootTask: string, repo: string, startDepth: number, gid?: number | string, cleanOK?: boolean, kind?: SliceKind, buildNote?: string): Promise<{ done: LeafRecord[] }> {
  buildNote = buildNote || ''
  const tag = gid != null ? `g${gid}:` : ''
  const stack: WorkNode[] = [{ task: rootTask, ctx: '', depth: startDepth, spikes: 0, kind: kind || 'behavior' }]
  const done: LeafRecord[] = []
  const executedKeys = new Set<string>()
  let discovered = 0
  // ITEM 11a: UNIT-scope breaker (fresh per runWork invocation) — N consecutive untrusted leaves means
  // the APPROACH is failing; halt this unit instead of grinding the budget into more reverts. No class gate.
  const untrustedBreaker = circuitBreaker(MAX_UNTRUSTED_STREAK)
  const keyOf = (s: unknown) => String(s).trim().slice(0, 120)

  while (stack.length && done.length < MAX_LEAVES) {
    const node = stack.pop()!   // loop condition guarantees a non-empty stack
    const atFloor = node.depth >= FLOOR
    // ITEM 10: ONE 'decompose' decision per node, returned by ONE agent (the merged Slicer/assess role).
    // ② An atomic slice was already sized + risk-judged when it was emitted — it is a LEAF; the engine
    //   bottoms out on it directly with NO decompose call. ① For a non-atomic node, ONE R_SLICE+DECOMPOSE
    //   call returns BOTH the action (execute|slice|spike — bias HARD to execute) AND, when action:'slice',
    //   the cut itself (slices[]) — the assessment and the cut are one judgment, no longer two round-trips.
    //   The depth-floor forced-execute and the spike-cap stay deterministic JS guards around this call.
    let d: Decompose | null = null, action: Decompose['action']
    if (node.atomic) {
      action = 'execute'
    } else {
      d = (await agentSafe(
        `${R_SLICE}\n\nRepo: ${repo}\nDecide this node's next action (bias HARD toward execute), then act.\n` +
        `Task: ${node.task}\n${node.ctx ? 'Context: ' + node.ctx + '\n' : ''}` +
        `Depth ${node.depth}/${FLOOR}${atFloor ? ' (AT FLOOR — you must return execute)' : ''}.\n${INV}\n` +
        `If action:'execute' set this leaf's riskTier. If action:'slice' emit thin, VERTICAL, ` +
        `independently-verifiable slices with a self-contained contract each (group near-identical units; ` +
        `2-5 slices; isolate any risky seam first).`,
        { phase: 'Work', label: `${tag}decompose:d${node.depth}`, model: 'sonnet', schema: DECOMPOSE })) as Decompose | null
      if (!d) log(`${tag}decompose failed [d${node.depth}] — defaulting to execute`)
      action = (atFloor || !d) ? 'execute' : d.action
      if (action === 'spike' && node.spikes >= MAX_SPIKES) action = 'execute'
    }

    if (action === 'slice') {
      // The merged decompose call ALREADY returned the cut (d.slices) in the SAME round-trip — no
      // separate slicer call. (A null/empty slices array with action:'slice' falls through to the
      // non-reducing→execute guard below, exactly as the old separate-slicer empty result did.)
      let slices: SliceSpec[] = (d && d.slices) || []
      // B2: the completeness critic's marginal value is highest at SHALLOW depth (top-level scenario gaps);
      // re-running it at EVERY deep recursion level multiplies leaves for little extra trust (excess ceremony —
      // proportional-ceremony). Bound to depth ≤ 1 (root + first level); deeper plan-gaps are still caught by
      // per-leaf discovery (the executor's `discovered` scenarios), so this trims runtime, not the trust floor.
      if (slices.length > 1 && node.depth <= 1) {
        const crit: { missing?: Array<{ desc: string; contract: string }> } | null = await agentSafe(
          `${R_CRITIC}\n\nRepo: ${repo}\nTask: ${node.task}\nProposed list:\n` +
          slices.map((s, j) => `${j + 1}. ${s.desc}`).join('\n') + `\n${INV}`,
          // agentType:'Explore' — the completeness critic is READ-ONLY + additive-only (it gates
          // NO trust, only proposes missing scenarios, with inline input). The Explore recon agent
          // (reads excerpts, returns conclusions) fits exactly and is leaner than the default agent.
          // NOT for verifier/lens (they MUST keep Bash to re-run — Bash-less verify silently
          // defeats the fabricated-green catch, main.ts fabricated-green lesson) nor baseliner
          // (Explore skips CLAUDE.md, which the baseliner must read to build the project card).
          { phase: 'Work', label: `${tag}critic:d${node.depth}`, agentType: 'Explore', schema: MISSING })
        if (crit && crit.missing && crit.missing.length) {
          slices = slices.concat(crit.missing.map(m => ({ ...m, kind: 'behavior' })))   // critic items are always behavior scenarios
          log(`${tag}completeness critic +${crit.missing.length} missing scenario(s)`)
        }
      }
      if (slices.length <= 1) {
        log(`${tag}non-reducing slice [d${node.depth}] → execute`)
        action = 'execute'
      } else {
        log(`${tag}slice [d${node.depth}] → ${slices.length}`)
        if (node.depth === 0) {
          // ③ PREDICTABILITY backstop (deterministic — the Lesson-14 guard for the prompt-strength
          // "quote an ETA before launch" rule). Surface run MAGNITUDE from the root breadth + coldBuildCost
          // so "long" is never a surprise, and so an over-tiered low-risk task is caught at launch. The
          // completeness critic + per-leaf discovery EXPAND this floor, so the real run is larger.
          const compileBound = baseline!.coldBuildCost === 'expensive'
          log(`${tag}⟂ SCALE: ${slices.length} top-level slice(s) (a FLOOR — the completeness critic + per-leaf discovery expand it)${compileBound ? '; compile-bound → each leaf is a full build cycle, wall-clock ∝ leaf count' : ''}. If you diagnosed this task low-risk/file:line, that is the over-tier signal — prefer inline T1, not a multi-leaf engine run.`)
          // OVER-TIER GATE (deterministic, HARD-to-trip): a compile-bound repo with a small breadth where EVERY
          // slice was explicitly judged light is inline-T1 work — stop before any leaf runs unless the caller
          // confirmed. STRICT .every(=== 'light'): a single non-light slice OR any completeness-critic addition
          // (riskTier undefined) flips this false → the engine runs, so trust is preserved exactly where fragile.
          if (compileBound && slices.length <= 3 && slices.every(s => s.riskTier === 'light') && !CONFIRM_TIER) {
            OVER_TIER_STOP = `compile-bound repo, ${slices.length} low-risk slice(s) — inline T1 work`; OVER_TIER_SLICES = slices.length
            log(`${tag}⟂ OVER-TIER STOP: this looks like inline-T1 work (compile-bound + ${slices.length} all-light slice(s)). Doing it inline is faster. To force the engine anyway, re-run with confirmTier:true. (No leaves ran; nothing changed.)`)
            return { done: [] }
          }
        }
        for (let j = slices.length - 1; j >= 0; j--) {
          const iface = slices[j].interface
          const ifaceCtx = (iface && !/^TBD/i.test(iface.trim())) ? `\nInterface (FIXED): ${iface}` : ''
          stack.push({ task: slices[j].desc, ctx: `Contract: ${slices[j].contract}${ifaceCtx}`, kind: slices[j].kind || node.kind || 'behavior', atomic: slices[j].atomic, riskTier: slices[j].riskTier, testScope: slices[j].testScope, seamPointers: slices[j].seamPointers, depth: node.depth + 1, spikes: 0 })
        }
        continue
      }
    }

    if (action === 'spike') {
      const learn: { summary: string } | null = await agentSafe(
        `You are the Spiker (Beck: concrete hypotheses — make the uncertainty small, falsifiable, and cheap).\n` +
        `Repo: ${repo}\nDe-risk this hard-but-small task with the smallest experiment / minimal ` +
        `reproduction (remove extraneous detail; learn, don't build): ${node.task}\n${node.ctx}`,
        { phase: 'Work', label: `${tag}spike:d${node.depth}`, model: 'sonnet', schema: LEARNING })
      stack.push({ ...node, ctx: `${node.ctx}\nLEARNED: ${learn ? learn.summary : '(spike produced no result)'}`, spikes: node.spikes + 1 })
      log(`${tag}spike [d${node.depth}]: ${node.task.slice(0, 50)}`)
      continue
    }

    // ---- execute leaf: Canon TDD + tier-0 gate + risk-tiered verify + self-repair ----
    // Reserve enough for ONE more leaf + the integrate net: a leaf (exec+verify) measured ~60-100k tokens,
    // and once spent() hits the hard ceiling agent() THROWS mid-leaf (losing `done` + leaking the lock).
    if (QUOTA_HALT || (budget.total && budget.remaining() < 120_000)) { log(`${tag}${QUOTA_HALT ? 'quota halt' : 'budget low'} — stopping after ${done.length} leaves`); break }
    const k = keyOf(node.task)
    if (executedKeys.has(k)) continue
    executedKeys.add(k)
    const i = done.length
    const lbl = `${tag}${i}`
    // ITEM 10: the leaf's verification tier. tidy → standard; an atomic slice carries its own riskTier;
    // a non-atomic node executed directly takes the riskTier the merged decompose decision set on the
    // execute branch (the former assessor's difficulty→tier mapping is now the role's explicit riskTier).
    const tier = node.kind === 'tidy' ? 'standard' : (node.atomic ? (node.riskTier || 'standard') : ((d && d.riskTier) || 'standard'))
    // ③ Tidy-First: a tidy leaf is a behavior-PRESERVING prep — verified by the existing suite, not by new tests.
    const TIDY = node.kind === 'tidy' ? '\nTIDY-FIRST leaf (Beck — make the change easy): a behavior-PRESERVING structural change ONLY (rename/extract/generalize/move). Do NOT add or change any test; do NOT change observable behavior — the EXISTING suite must stay green UNCHANGED. EXCEPTIONS for this tidy leaf: its proof IS the existing suite, so run the FULL existing suite once (this overrides the never-full-suite speed rule); and commit as ONE refactor commit (this replaces the two-hats behavior+refactor commit pair — a tidy leaf has no behavior step).' : ''

    // Capture this leaf's pre-state for a CONFLICT-FREE deterministic restore. `git reset --hard
    // <leafStart>` erases exactly this leaf's commits + edits while preserving sibling commits —
    // replacing the non-atomic, oldest-first `git revert` that corrupted the tree on interdependent
    // (behavior+refactor) commits. `restore()` only acts when SAFE: in a worktree (always clean-start)
    // or a clean main tree (cleanOK); on a DIRTY main tree it is a no-op so a user's work is never clobbered.
    // Deterministic pre-leaf HEAD for the conflict-free restore anchor. (A JS-tracked HEAD was reverted:
    // advancing it from the LLM-reported res.commits risked drift → reset --hard could destroy a trusted
    // sibling's commits, and a SAFE advance needs a real rev-parse anyway, so it saved nothing. — review)
    const leafStart = GIT ? (((await sh(`git -C ${repo} rev-parse HEAD 2>/dev/null || true`, `head:${lbl}`)).stdout || '').match(/[0-9a-f]{40}/i) || [''])[0] : ''
    // A3: restore() returns true only when it actually ran the revert (GIT+cleanOK+leafStart all
    // set AND sh calls were dispatched). During QUOTA_HALT the inner sh() calls no-op, so we check
    // the exitCode of the first sh to decide: QUOTA_HALT makes sh return SH_UNAVAILABLE (-2) which
    // means the restore was a no-op — callers must not log 'restored to' in that case.
    // ITEM 6 (LATENCY): the per-leaf restore was 2 SERIAL sh() spawns (reset --hard, then clean -fdq)
    // for every untrusted leaf. They are sequential-deterministic git on the same tree — BATCHED into
    // ONE sh() round-trip. Each sub-command keeps its EXIT MARKER so a reset/clean failure is still
    // detected per-command (the reset marker drives the return value verbatim). A dead proxy / quota
    // halt makes the WHOLE batch return SH_UNAVAILABLE → no reset marker → returns false (the old
    // `r.exitCode !== -2` no-op semantics, byte-equivalent: restore did not run).
    const restore = async (): Promise<boolean> => {
      if (!GIT || !cleanOK || !leafStart) return false
      const b = await shBatch(
        `git -C ${repo} reset --hard ${leafStart}; printf '<<RS:reset:%s>>\\n' "$?"; ` +
        `git -C ${repo} clean -fdq -e .rs-wt -e .rs-scratch; printf '<<RS:clean:%s>>\\n' "$?"`,   // drop untracked files the leaf created (never the shared build dir)
        `reset:${lbl}`)
      // reset marker present ⇔ the reset sub-command actually ran (proxy alive, not a quota no-op).
      // Absent (SH_UNAVAILABLE / protocol break) = no-op → false, exactly as `r.exitCode !== -2` did.
      return b.get('reset') !== null
    }

    let res: ExecResult | null = null, verdict: Verdict | null = null, attempt = 0, prevIssueCount = Infinity
    // ITEM 1: which deterministic trust-floor gate actually ran THIS leaf. Default 'llm-only' (no
    // deterministic gate); the gate block below upgrades it to 'deterministic-filtered' or 'full-suite'
    // when the engine actually ran shell-truth. A leaf that stays 'llm-only' is a LOUD, auditable
    // trust-floor downgrade (the Lesson-3 class) — logged + recorded + collected run-wide.
    let gateLevel: GateLevel = 'llm-only'
    while (true) {
      const repair = attempt === 0 ? '' :
        `\nREPAIR ATTEMPT ${attempt}: a prior attempt was REJECTED by review for: ` +
        `${JSON.stringify((verdict && verdict.issues && verdict.issues.length ? verdict.issues : [verdict && verdict.reason]).slice(0, 6).map(s => String(s).slice(0, 300)))}. ` +
        (verdict && verdict.prescription ? `\nREVIEWER'S PRESCRIBED FIX (apply exactly unless evidently wrong): ${String(verdict.prescription).slice(0, 1200)}\n` : '') +
        (GIT && cleanOK && leafStart ? `FIRST undo your prior attempt with \`git -C ${repo} reset --hard ${leafStart}\` (sibling commits survive), then re-implement fresh; ` : '') +
        `then fix exactly those objections. In git mode add a fresh commit.`
      const seamCtx = (node.seamPointers && node.seamPointers.length)
        ? `\nSeam Pointers (already resolved by the Slicer — confirm each via Read BEFORE using; lines may be stale):\n${node.seamPointers.map((p) => `  - ${p.file}${p.line != null ? `:${p.line}` : ''}${p.symbol ? ` (${p.symbol})` : ''}${p.currentText ? ` — "${p.currentText}"` : ''}`).join('\n')}`
        : ''
      res = await agentSafe(
        `${R_EXEC}\n\nRepo: ${repo}\nDo EXACTLY this one atomic task.\nTask: ${node.task}\n${node.ctx}${seamCtx}\n${INV}${node.kind === 'tidy' ? '' : LEAF_TEST(node.testScope)}${GIT_EXEC}${TIDY}${buildNote}${repair}`,
        { phase: 'Work', label: `exec:${lbl}${attempt ? '.r' + attempt : ''}`, model: 'sonnet', schema: RESULT })
      if (!res) break
      // ITEM 7: trace the executor call (cost dimension — model:sonnet, which repair attempt). Distinct
      // from the leaf-verify line below: this records the EXECUTOR was spawned (executor!=verifier — the
      // two roles are even two trace lines), so the profile shows exec cost separately from verdict. Placed
      // AFTER the `!res` break so a DEAD executor doesn't fire a (successful) trace sh — that would reset the
      // agentSafe quotaBreaker and mask a real session-instability halt (observed: A6 mixed-class streak).
      await trace({ phase: 'Work', role: `exec:${lbl}`, model: 'sonnet', leafIndex: i, repairAttempt: attempt })
      // tier-0 deterministic gate: a RED leaf never reaches the LLM verifier (wasted budget + noise).
      if (!res.passed) { verdict = { trustworthy: false, reason: 'tier-0 gate: deterministic build/tests RED' } }
      else {
        // I1: ENGINE-owned tier-0 — re-run the leaf's FILTERED tests via sh() (shell truth, not the
        // executor's claim: a green was once fabricated and only an LLM verifier caught it). Needs a
        // machine-usable template + an injection-safe scope; tidy leaves exempt (their proof is the
        // full existing suite). On engine-RED the LLM verifier is skipped entirely (budget + noise).
        let engineT0 = '', t0red: Verdict | null = null
        // No '|' in the whitelist: the scope is substituted UNQUOTED, so '|' would become a shell pipe
        // (exit 127 → false RED). One suite per slice; multi-suite scopes just skip the engine gate.
        const scopeSafe = node.testScope && /^[A-Za-z0-9_.-]+$/.test(String(node.testScope))
        const t0cmd = (node.kind !== 'tidy' && scopeSafe && baseline!.filterCommand && baseline!.filterCommand.includes('{scope}'))
          ? baseline!.filterCommand!.replace('{scope}', String(node.testScope)) : ''
        // ITEM 1: a NON-tidy leaf with NO runnable filtered gate (missing/disabled filterCommand, or an
        // unsafe/multi-suite scope) silently fell through to the LLM verifier ALONE — a silent trust-floor
        // downgrade with no record (the Lesson-3 class). Make it LOUD: name the leaf and the reason. (A tidy
        // leaf is excluded here — its deterministic gate is the full-suite run below, not a filtered t0.)
        if (!t0cmd && node.kind !== 'tidy') {
          log(`${tag}⚠ WARN: leaf ${i} (${node.task.slice(0, 36)}) gate=llm-only (no filterCommand/scope) — trust rests on the LLM verifier + the integrate net`)
        }
        if (t0cmd) {
          // In shared-scratch parallel mode the engine's own filtered run must hit the shared build dir
          // too (assumes the filter template passes appended flags through — documented opt-in).
          const t0 = await sh(`cd ${repo} && ${t0cmd}${(SCRATCH && repo !== REPO) ? ` --scratch-path ${SCRATCH}` : ''}`, `t0:${lbl}`)
          if (t0.exitCode !== 0) {
            const t0tail = String(t0.stdout || '')
            if (RE_ZERO_TESTS.test(t0tail)) {
              // ① ZERO tests matched (scope/name mismatch, NOT a failure, NOT a broken template). Do NOT
              // t0red and do NOT trip the breaker — else one mismatched scope kills gating run-wide. This
              // leaf stays gate=llm-only (default); hand the verifier the finding to confirm independently.
              log(`${tag}⚠ leaf ${i} t0 filter matched ZERO tests (scope='${node.testScope}' ≠ any test name) → gate=llm-only for THIS leaf only (scope mismatch, breaker untouched)`)
              engineT0 = engineRanBlock({
                cmd: t0cmd, note: '(filter matched ZERO tests — scope/name MISMATCH, NOT a pass)',
                exitCode: t0.exitCode, tail: t0tail.slice(-300),
                duty: `The engine's filtered gate matched ZERO tests under scope \`${node.testScope}\` — the executor's testScope does not match any test it added (a FINDING; common with Swift Testing function-name filters). Do NOT treat this as green: independently confirm the leaf's tests exist and pass, or distrust.` })
            } else {
              t0red = { trustworthy: false, reason: `tier-0 (ENGINE-run filtered tests) RED: \`${t0cmd}\` exited ${t0.exitCode} though the executor reported green`, issues: [`deterministic filtered run failed (exit ${t0.exitCode}); output tail: ${t0tail.slice(-300)}`] }
              // A BROKEN template (env/wrapper/filter-syntax) false-REDs every leaf run-wide. After 2
              // consecutive engine-RED-vs-executor-green disagreements, distrust the TEMPLATE, not the
              // leaves — kill it and fall back to LLM verification (the pre-gate path).
              if ((t0redBreaker.record(), t0redBreaker.tripped())) { baseline!.filterCommand = ''; log(`${tag}engine t0 disagreed with executor-green ${t0redBreaker.streak}× in a row — suspecting a broken filterCommand template; disabling the engine gate (LLM verify takes over)`) }
            }
          } else {
            t0redBreaker.reset()
            gateLevel = 'deterministic-filtered'   // ITEM 1: the engine ran the filtered tier-0 (green) — full trust floor held
            // Exit 0 is NOT proof tests ran: a typo'd scope can match ZERO tests and still exit 0 —
            // blind "ENGINE-VERIFIED" would LAUNDER a vacuous green while muzzling the verifier. Hand
            // the verifier the output and the zero-tests duty instead of an assertion.
            engineT0 = engineRanBlock({
              cmd: t0cmd, exitCode: 0, tail: String(t0.stdout || '').slice(-300),
              duty: `FIRST confirm from that output that at least one test ACTUALLY EXECUTED under scope \`${node.testScope}\` — ` +
                `zero tests matched = a FINDING (vacuous gate / scope-suite mismatch): distrust or re-run yourself. ` +
                `If tests did run, do NOT re-run them — audit the ARTIFACTS (diff scope, test meaningfulness, over-fit, interface drift).` })
          }
        }
        // B1: tidy leaf behavior-preservation gate — engine runs the FULL measure command deterministically
        // (not the executor's claim: a tidy "existing suite is GREEN" was once a self-report with no proof).
        // Passing ENGINE-RAN into verifyLeaf lets the verifier judge the artifact instead of re-running the
        // suite itself (resolving the R_VERIFY "NEVER the whole suite" vs tidy "run the full suite" contradiction).
        if (!t0red && node.kind === 'tidy' && baseline!.measureCommand) {
          const tidyFull = await sh(`cd ${repo} && ${baseline!.measureCommand}`, `tidy-fullsuite:${lbl}`)
          if (tidyFull.exitCode !== 0) {
            t0red = { trustworthy: false, reason: `tidy-fullsuite (ENGINE-run full suite) RED: measureCommand exited ${tidyFull.exitCode} (behavior not preserved)`, issues: [`full suite failed for tidy leaf; output tail: ${String(tidyFull.stdout || '').slice(-300)}`] }
          } else {
            gateLevel = 'full-suite'   // ITEM 1: tidy leaf — engine ran the FULL measure command (its deterministic proof)
            engineT0 = engineRanBlock({
              cmd: baseline!.measureCommand!, note: '(full suite — tidy behavior-preservation gate)',
              exitCode: 0, tail: String(tidyFull.stdout || '').slice(-300),
              duty: `Confirm from that output that the existing suite is actually green (zero tests run = vacuous). ` +
                `Do NOT re-run the suite yourself — judge the ARTIFACTS: diff scope, no test added/changed/deleted, pure structural refactor, no observable behavior change.` })
          }
        }
        // A repaired leaf is verified at the SAME tier or stricter — never looser (a leaf that failed the
        // heavy gate must not pass on a single standard reproduction after repair).
        verdict = t0red || await verifyLeaf(lbl, node, res, attempt === 0 ? tier : (tier === 'light' ? 'standard' : tier), repo, leafStart, engineT0, buildNote)
      }
      if (verdict.trustworthy) break
      // I2: convergence-aware repair — extend past MAX_REPAIR up to MAX_REPAIR_HARD ONLY while the
      // objection count STRICTLY shrinks round-over-round (deterministic convergence proxy; a diverging
      // leaf that grows new objections each round still stops at the default budget).
      const issueCount = (verdict.issues || []).length || 1
      const converging = issueCount < prevIssueCount
      if (attempt >= MAX_REPAIR && !(converging && attempt < MAX_REPAIR_HARD)) break
      if (QUOTA_HALT || (budget.total && budget.remaining() < 120_000)) { log(`${tag}${QUOTA_HALT ? 'quota halt' : 'budget low'} — stopping repairs (leaf ${i} stays untrusted → reverted)`); break }
      // Cross-tier fairness: a LIGHT attempt-0 verdict (cursory, few issues) vs a STANDARD repair
      // re-verify (thorough, more issues) reads as divergence even when the leaf improved — don't
      // let the thoroughness jump eat the convergence extension; compare from the escalated tier on.
      prevIssueCount = (attempt === 0 && tier === 'light') ? Infinity : issueCount
      log(`${tag}leaf ${i} untrusted (tier=${res.passed ? tier : 'tier0-red'}, ${issueCount} issue(s)${attempt > 0 && converging ? ', converging' : ''}) → self-repair ${attempt + 1}/${converging ? MAX_REPAIR_HARD : MAX_REPAIR}`)
      attempt++
    }
    if (!res) {
      log(`${tag}leaf ${i} exec FAILED (no result) — restoring, continuing`)
      await restore()   // undo anything the dead executor left
      done.push({ task: node.task, passed: false, summary: 'executor returned no result (API/rate-limit)', verdict: { trustworthy: false, reason: 'executor failed' } })
      if ((untrustedBreaker.record(), untrustedBreaker.tripped())) {
        ABORTS.push(`${tag || 'main:'} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`)
        log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure suspected). Integrate still runs.`)
        break
      }
      continue
    }
    done.push({ task: node.task, ...res, verdict, gateLevel })   // ITEM 1: record which deterministic gate actually ran (auditable trust floor)
    log(`${tag}leaf ${i} ${res.passed ? 'green' : 'RED'} | tier=${tier}${attempt ? ` (repaired×${attempt})` : ''} | gate=${gateLevel} | ${verdict!.trustworthy ? 'trusted' : 'NOT trusted'}: ${node.task.slice(0, 36)}`)
    // ITEM 7: emit the leaf's cost/verdict profile line — the single richest trace record (carries the
    // leafIndex, the deterministic gateLevel from ITEM 1, the final trust verdict, and how many repairs it
    // took). This is exactly the per-leaf profile Lesson 8 needed a human to reconstruct from logs.
    await trace({ phase: 'Work', role: `leaf-verify:${lbl}`, model: 'verify', leafIndex: i, gateLevel, trustworthy: verdict!.trustworthy, repairAttempt: attempt })

    // An untrusted leaf (incl. a RED/tier-0 leaf with only uncommitted edits) must leave NOTHING behind.
    if (GIT && !verdict!.trustworthy) {
      // A3: only log 'restored to' when restore() ACTUALLY ran the revert (exitCode !== -2).
      // During QUOTA_HALT the inner sh() calls no-op (SH_UNAVAILABLE), so restored=false here —
      // avoid the false 'restored to' log that would mislead the user into thinking state was reset.
      const restored = await restore()
      log(`${tag}leaf ${i} untrusted → ${restored ? `restored to ${leafStart.slice(0, 8)}` : (!cleanOK ? 'NOT auto-cleaned (dirty main baseline — left to protect your uncommitted work)' : !leafStart ? 'NOT auto-cleaned (HEAD capture failed — left as-is, flagged for Integrate)' : 'NOT auto-cleaned (restore skipped — quota halt or sh proxy unavailable)')}`)
    }

    // A: run-level no-progress detection — leaf-level guards (convergence, repair caps) bound ONE leaf,
    // but nothing detected a run going systemically wrong; N consecutive reverted leaves = stop and
    // surface ("the approach is failing"), don't grind the remaining budget into more reverts.
    if (verdict!.trustworthy) untrustedBreaker.reset(); else untrustedBreaker.record()
    if (untrustedBreaker.tripped()) {
      ABORTS.push(`${tag || 'main:'} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`)
      log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure: wrong decomposition / broken env / API trouble). Integrate still runs.`)
      break
    }

    // ① + I4: batch the executor's discovered scenarios AND the verifier's concrete followUps (trusted
    //    leaves only — an untrusted leaf's findings describe reverted code) into ONE follow-up leaf
    //    (one build/verify) instead of N. Edge-case TESTS for now-stable code → batching is Canon-TDD-
    //    safe; if one needs a behavior change, the executor flags it back via `discovered` (bounded).
    // Trusted leaves only — an UNTRUSTED leaf was reverted, so both its discovered items and its
    // verifier followUps describe code that no longer exists.
    const feed = verdict!.trustworthy ? [...(res.discovered || []), ...(verdict!.followUps || [])] : []
    if (feed.length) {
      const fresh = feed.map(String).filter(d => !executedKeys.has(keyOf(d))).slice(0, Math.max(0, MAX_DISCOVERED - discovered))
      if (fresh.length) {
        fresh.forEach(d => executedKeys.add(keyOf(d)))   // mark so the same scenario can't re-spawn
        discovered += fresh.length
        const batchTask = `Address these ${fresh.length} discovered/review-flagged scenario(s) as ONE leaf (the ` +
          `implementation is stable, so batching tests is Canon-TDD-safe — write a meaningful test for each):\n- ${fresh.join('\n- ')}\n` +
          `If ANY scenario actually needs an IMPLEMENTATION/behavior change (not just a test), do NOT force it — note it in \`discovered\` for a focused follow-up.`
        // Batch leaf INHERITS the parent's testScope: scenarios discovered while working a scope
        // almost always live in/near that suite, and inheritance arms the engine t0 gate for the
        // batch (previously batch leaves carried no scope → the deterministic gate never fired).
        stack.push({ task: batchTask, ctx: `Discovered while doing "${node.task.slice(0, 40)}".`, kind: 'behavior', atomic: true, riskTier: 'standard', testScope: node.testScope, depth: node.depth, spikes: 0 })
        log(`${tag}+${fresh.length} discovered → 1 batched follow-up leaf`)
      }
    }
  }
  if (done.length >= MAX_LEAVES) log(`${tag}NOTE: hit MAX_LEAVES — work truncated`)
  return { done }
}

// =============================================================================
phase('Plan')
// Parallel mode needs git (worktrees) + a root that splits into ≥2 INDEPENDENT slices, AND cheap
// builds: on a compile-bound project each worktree is a COLD dependency build that thrashes and is
// slower than sequential-warm. The fallback is a DETERMINISTIC gate on a baseliner-reported fact.
let groups: Groups | null = null
// Parallel also needs a CLEAN main tree — the worktree branches merge into it, and a dirty main makes
// `git merge` abort / risks clobbering the user's uncommitted work.
// Compile-bound repos (coldBuildCost=expensive, per the Baseliner): AUTO-enable the shared build dir so a
// forgotten `sharedScratch` no longer silently demotes parallel → sequential (the recurring drift logged
// in proportional-ceremony memory). Explicit `sharedScratch:false` still wins; the <2-independent-groups
// guard below still demotes to sequential when slices share files, so no merge hazard is ever forced.
const autoSharedScratch = baseline.coldBuildCost === 'expensive' && A.sharedScratch !== false
const useSharedScratch = SHARED_SCRATCH || autoSharedScratch
if (autoSharedScratch && !SHARED_SCRATCH)
  log(`compile-bound (coldBuildCost=expensive) → sharedScratch auto-ENABLED (deterministic; pass sharedScratch:false to opt out).`)
const goParallel = PARALLEL && GIT && gitClean && (baseline.coldBuildCost !== 'expensive' || FORCE_PARALLEL || useSharedScratch)
if (PARALLEL && GIT && !goParallel)
  log(`parallel requested but skipped → SEQUENTIAL. Reason: ${!gitClean ? 'main tree is DIRTY (merge would conflict with your work)' : 'sharedScratch:false explicitly set on a compile-bound repo (worktrees would force per-checkout cold builds → thrashing, slower than sequential-warm; drop sharedScratch:false to use the auto shared build dir, or forceParallel:true to brute-force)'}.`)
// Shared scratch dir for parallel groups on a compile-bound repo. Lives in the MAIN repo (worktree
// leaf-cleans run inside their own worktree and cannot touch it; main-repo cleans exclude it).
const SCRATCH = (goParallel && useSharedScratch) ? `${REPO}/.rs-scratch` : ''
const buildNoteFor = (repo: string) => (SCRATCH && repo !== REPO)
  ? `\nSHARED BUILD DIRECTORY (mandatory): append \`--scratch-path ${SCRATCH}\` to EVERY build/test invocation ` +
    `(SwiftPM passes it through its wrappers; Cargo's equivalent is CARGO_TARGET_DIR; other builders have their ` +
    `own shared-build-dir mechanism — use this project's equivalent). The parallel worktrees share that ONE build dir so ` +
    `dependencies compile once; builds serialize on its lock (expected — do not work around it); NEVER delete it.`
  : ''
if (goParallel) {
  // ITEM 10: the merged decompose role gates the partition — does the ROOT split (action:'slice') or is
  // it a single executable unit (no parallel benefit)? This is the same execute|slice|spike judgment the
  // former Plan-phase assessor made; the dedicated COARSE-partition cut below keeps its own R_SLICE call
  // (it is a different cut from fine slicing — few coarse groups, light-overlap independence engineering).
  const a0: Decompose | null = await agentSafe(
    `${R_SLICE}\n\nRepo: ${REPO}\nDecide ONLY this root's next action: is it one executable unit (action:'execute') ` +
    `or does it split into multiple parallelizable units (action:'slice')? Do NOT emit slices here — the coarse ` +
    `partition is requested separately next.\nTask: ${TASK}\nDepth 0/${FLOOR}.\n${INV}`,
    { phase: 'Plan', model: 'sonnet', schema: DECOMPOSE })
  if (a0 && a0.action === 'slice') {
    const sl: { slices?: SliceSpec[] } | null = await agentSafe(
      `${R_SLICE}\n\nRepo: ${REPO}\nThis is the PARALLEL PARTITION — NOT fine slicing. Each group you emit becomes ` +
      `its OWN git worktree (its own branch off the baseline), so produce FEW, COARSE groups: ONE per LARGEST ` +
      `parallelizable unit. Aim for 2-4 groups; NEVER split one coherent feature — its fine-grained decomposition ` +
      `happens INSIDE the group later. ENGINEER independence rather than merely detecting it: put file-DISJOINT ` +
      `cores (new modules, separate subsystems, new files) into parallel groups, and EXTRACT the touches that would ` +
      `collide on shared files (wiring into common views/entry points, manifest edits) into a FINAL ` +
      `\`independent\`=false group that runs sequentially AFTER the parallel groups merge. Mark \`independent\`=true ` +
      `for disjoint groups AND for groups with only LIGHT, mergeable overlap (a few additive edits to a shared ` +
      `file) — the Coordinator role exists to merge branches and resolve exactly such conflicts honoring both ` +
      `sides; when you accept overlap, LIST the expected overlapping files in that group's contract so the ` +
      `coordinator anticipates them. Heavy same-file rework across groups is the only hard disqualifier.\nTask: ${TASK}\n${INV}`,
      { phase: 'Plan', label: 'partition:d0', schema: SLICES })
    const all = (sl && sl.slices) || []
    const indep = all.filter(s => s.independent)
    if (indep.length >= 2) {
      groups = { indep, seq: all.filter(s => !s.independent), all }
      log(`parallel plan: ${indep.length} independent group(s) + ${groups.seq.length} sequential`)
    } else log(`parallel requested but <2 independent top slices — falling back to sequential`)
  } else log(`parallel requested but root is not big enough to slice — falling back to sequential`)
}

// =============================================================================
phase('Work')
let done: LeafRecord[] = []
let merge: Verdict | null = null
if (groups) {
  // 1) One git worktree+branch per independent group, off the pinned baseline.
  //    DETERMINISTIC: paths + commands are computed in JS; sh() runs them verbatim (no LLM latitude).
  const N = groups.indep.length
  const wtPaths = groups.indep.map((_, i) => `${REPO}/.rs-wt/g${i}`)
  // Two-PHASE cleanup so `branch -D` is never blocked by a still-registered worktree (the cause of
  // a leaked rs/g* branch + empty .rs-wt/ seen in testing): remove ALL worktrees, prune the
  // registry, THEN delete the branches, THEN drop the now-empty .rs-wt/ parent. Leave nothing behind.
  // A5: mergedOnly=true (wt-pre): only delete branches that are already merged — a branch that is NOT
  // merged is live work from another run or a resume-in-progress; blindly -D-ing it destroys that work.
  // wt-post never needs this guard (the branches were JUST merged by this run; --merged HEAD is trivially true).
  const clearWorktrees = async (label: string, mergedOnly = false) => {
    for (let i = 0; i < N; i++) await sh(`git -C ${REPO} worktree remove --force ${wtPaths[i]} 2>/dev/null; true`, `${label}-rm:${i}`)
    await sh(`git -C ${REPO} worktree prune`, `${label}-prune`)
    if (mergedOnly) {
      // A5: query merged branches once, then -D only the subset that are already merged into HEAD.
      const merged = await sh(`git -C ${REPO} branch --merged HEAD`, `${label}-merged-list`)
      const mergedNames = (merged.stdout || '').split('\n').map(l => l.trim().replace(/^\*\s*/, ''))
      for (let i = 0; i < N; i++) {
        if (mergedNames.includes(`rs/g${i}`))
          await sh(`git -C ${REPO} branch -D rs/g${i} 2>/dev/null; true`, `${label}-br:${i}`)
      }
    } else {
      for (let i = 0; i < N; i++) await sh(`git -C ${REPO} branch -D rs/g${i} 2>/dev/null; true`, `${label}-br:${i}`)
    }
    await sh(`rm -rf ${REPO}/.rs-wt 2>/dev/null; true`, `${label}-rmdir`)
  }
  await clearWorktrees('wt-pre', true)   // clear any stale worktrees/branches left by a previous run (merged-only -D)
  const paths: Record<number, string> = {}
  for (let i = 0; i < N; i++) {
    const r = await sh(`git -C ${REPO} worktree add -b rs/g${i} ${wtPaths[i]} ${BASE_SHA}`, `wt-add:${i}`)
    if (r.exitCode === 0) {
      paths[i] = wtPaths[i]
      // E: run worktreeSetupCommand exactly once in each fresh worktree (e.g. 'npm ci') so leaves
      // start with deps installed and never fail with a fake RED due to a missing-deps error.
      // E-error: if setup fails (exitCode !== 0), unregister the worktree path so the group
      // falls into the !repo branch (→ trustworthy:false/'no worktree/setup failed') instead of
      // silently running measure in a broken checkout and cold-thrashing (the very mode this
      // feature was designed to prevent).
      if (baseline.worktreeSetupCommand) {
        const setupR = await sh(`cd ${wtPaths[i]} && ${baseline.worktreeSetupCommand}`, `wt-setup:${i}`)
        if (setupR.exitCode !== 0) {
          log(`worktree g${i} setup command failed (exit ${setupR.exitCode}) — skipping group (no worktree/setup failed)`)
          delete paths[i]
        }
      }
    } else log(`worktree g${i} setup failed (exit ${r.exitCode})`)
  }

  // 2) Build independent groups in PARALLEL, capped at MAX_WORKERS (batched). Within a group: sequential + feedback.
  const built: Array<{ done: LeafRecord[] } | null> = []
  for (let b = 0; b < groups.indep.length; b += MAX_WORKERS) {
    const rs = await parallel(groups.indep.slice(b, b + MAX_WORKERS).map((s, j) => async () => {
      const idx = b + j
      const repo = paths[idx]
      if (!repo) { log(`group g${idx} has no worktree — skipped`); return { done: [{ task: s.desc, passed: false, verdict: { trustworthy: false, reason: 'no worktree' } }] } }
      return runWork(`${s.desc}\nContract: ${s.contract}\nInterface: ${s.interface}`, repo, 1, idx, true, s.kind, buildNoteFor(repo))   // worktree = always clean-start; thread group kind + shared-scratch note
    }))
    built.push(...rs)
  }
  built.forEach(r => { if (r && r.done) done.push(...r.done) })

  // 3) Coordinate: DETERMINISTIC merge attempt per branch (code owns the merge); the LLM
  //    coordinator is invoked ONLY to resolve a real conflict. Then a single re-verify, then
  //    unconditional DETERMINISTIC cleanup.
  phase('Coordinate')
  // A4: Coordinate halt gate — if quota was exhausted during the parallel Work phase, skip all
  // merge sh calls and branch cleanup entirely (worktrees are PRESERVED so a resume can replay
  // from the committed leaf states without losing any work). Without this gate, the prior code
  // called sh(merge) + sh(merge-fullsuite) after quota death — both no-opped via agentSafe but
  // the merge verdict would be null/ISSUES and the wt-post clearWorktrees would delete the
  // worktree branches that a resume needs, causing the next run's wt-pre branch -D to abort on
  // non-existent refs and the merge step to re-do all the parallel work from scratch.
  if (QUOTA_HALT) {
    log(`Coordinate skipped — quota halt active; worktrees preserved for resume (relaunch with resumeFromRunId after the limit resets)`)
  } else {
  let conflicts = 0
  for (let i = 0; i < N; i++) {
    if (paths[i] == null) continue                              // group never built — nothing to merge
    const m = await sh(`git -C ${REPO} merge --no-ff --no-edit rs/g${i}`, `merge:${i}`)
    if (m.exitCode !== 0) {                                     // conflict/error → LLM judgment for THIS branch only
      conflicts++
      await agentSafe(
        `${R_COORD}\n\nRepo: ${REPO}\nThe deterministic \`git -C ${REPO} merge --no-ff rs/g${i}\` FAILED (conflict). ` +
        `Resolve ONLY this branch's conflict (slice "${groups.indep[i].desc}"), honoring both sides' intent, complete ` +
        `the merge commit, then confirm the tree builds.\n${INV}`,
        { phase: 'Coordinate', label: `merge-conflict:${i}`, schema: VERDICT })
    }
  }
  // Deterministic merge net (mirrors the Integrate gate): the engine runs the full measure command
  // via sh() — shell truth — and the LLM JUDGES from that result instead of re-running it.
  const mergeRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'merge-fullsuite')
  merge = (await agentSafe(
    `${R_VERIFY}\n\nRepo: ${REPO}\n${N} parallel branches were merged into the working branch (${conflicts} needed ` +
    `conflict resolution). The FULL measure command was JUST run DETERMINISTICALLY with exit=${mergeRun.exitCode} ` +
    `(${mergeRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run it; JUDGE from that result whether every baseline ` +
    `invariant holds and NO slice's work was lost.\n${INV}`,
    { phase: 'Coordinate', label: 'merge-verify', schema: VERDICT })) as Verdict | null
  log(`coordinator: merged ${N} branches (${conflicts} conflicts) — ${merge && merge.trustworthy ? 'OK' : 'ISSUES'}`)
  await clearWorktrees('wt-post')   // unconditional two-phase cleanup — no leaked worktrees/branches/.rs-wt
  } // end QUOTA_HALT gate

  // 4) Dependent groups run on main AFTER the merge (so they see integrated independent work),
  //    ordered by dependsOn (prerequisites first; cycle/odd-dep → emission order).
  const all = groups.all, seq = groups.seq
  const idxOf = (s: SliceSpec) => all.indexOf(s), inSeq = new Set<number>(seq.map(idxOf))
  const seqOrdered: SliceSpec[] = [], placed = new Set<number>()
  let guard = seq.length + 2
  while (seqOrdered.length < seq.length && guard-- > 0)
    for (const s of seq) {
      const ai = idxOf(s); if (placed.has(ai)) continue
      if ((s.dependsOn || []).filter(d => inSeq.has(d)).every(d => placed.has(d))) { seqOrdered.push(s); placed.add(ai) }
    }
  for (const s of seq) if (!placed.has(idxOf(s))) seqOrdered.push(s)
  for (let s = 0; s < seqOrdered.length; s++) {
    const r = await runWork(`${seqOrdered[s].desc}\nContract: ${seqOrdered[s].contract}`, REPO, 1, 'seq' + s, gitClean, seqOrdered[s].kind)
    if (r && r.done) done.push(...r.done)
  }
} else {
  const r = await runWork(TASK, REPO, 0, undefined, gitClean)
  done = r.done
}
if (OVER_TIER_STOP) {
  log(`over-tier stop — skipping integrate/wiring/briefing (nothing was executed)`)
  if (LOCKFILE) { try { await shForce(`rm -f ${LOCKFILE}`, 'lock-clear') } catch (e) { log(`lock-clear failed — stale lock at ${LOCKFILE}; remove before next run.`) } }
  return { error: `over-tiered: ${OVER_TIER_STOP} — do it inline (T1) or re-run with confirmTier:true`, task: TASK, baseline, overTierStop: true, slices: OVER_TIER_SLICES }
}

// =============================================================================
phase('Integrate')
// DETERMINISTIC system-level net (④): per-leaf full-suite runs were removed, so the whole-system regression
// gate must NOT rest on a single soft LLM call (a late budget cutoff could starve it to null, leaving committed
// leaves over which no full suite ever ran). Run the FULL measure command ONCE here via sh() — a hard shell-truth
// green/red over the integrated tree (the tier-0 pattern at system scale) — then the LLM integrator JUDGES from
// that result with NO redundant full re-run (this also removes the integrator's own full-suite run). The Work
// loop's <40k budget break reserves room so this cheap sonnet run is not starved.
// try/catch: if the budget ceiling is hit here, agent() THROWS — without the catch that would lose the
// final payload (all `done` results) AND leak the repo lock. exitCode -1 = the net never ran (distinct from RED).
let finalRun: ShResult = { exitCode: -1, stdout: '' }
let integration: Verdict | null = null
if (QUOTA_HALT) {
  ABORTS.push(`quota-halt: ${QUOTA_HALT} — integrate/wiring/briefing skipped; relaunch with resumeFromRunId after the limit resets (cached leaves replay free)`)
  log('quota halt — skipping integrate/wiring/briefing (resume to run them)')
} else try {
  finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'integrate-fullsuite')
  if (finalRun.exitCode === 137) {
    // Known fragile-suite timeout class (watchdog kill): one DETERMINISTIC retry — this used to be
    // per-task prompt boilerplate ("retry once before judging"); the engine owns it now.
    log('integrate full suite timed out (exit 137) — one automatic retry (known flake class)')
    finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'integrate-fullsuite-retry')
  }
  if (finalRun.exitCode !== 0) log(`⚠ FULL SUITE RED at integration (exit ${finalRun.exitCode}) — a leaf regression may have escaped its filter (④); the LLM integrator will attribute.`)
  integration = (await agentSafe(
    `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
    `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
    `suite; JUDGE from that result whether every invariant still holds across the integrated whole` +
    `${finalRun.exitCode === 0 ? '' : ' (it is RED — identify which leaf/area most likely regressed)'}.\n${INV}` +
    (GIT ? `\nAlso summarize the cumulative trust deposit (\`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`) and confirm no out-of-scope file changed since baseline.` : ''),
    { phase: 'Integrate', schema: VERDICT })) as Verdict | null
  if (!integration) {
    log('integration agent unavailable (API error) — one retry')
    integration = (await agentSafe(
      `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
      `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
      `suite; JUDGE from that result whether every invariant still holds across the integrated whole.\n${INV}`,
      { phase: 'Integrate', label: 'integration-retry', schema: VERDICT })) as Verdict | null
  }
} catch (e) {
  log(`integrate phase error (budget ceiling / API): ${e && e.message ? e.message : e} — returning partial results; the full-suite net DID NOT RUN.`)
}
const fullSuiteGreen = finalRun.exitCode === 0

const trusted = done.filter(d => d.verdict && d.verdict.trustworthy)

// ITEM 1: run-level audit of the silent tier-0 downgrade. A TRUSTED leaf that ran gate='llm-only'
// (no deterministic filtered/full-suite gate could run) shipped on the LLM verifier + integrate net
// alone — the trust floor was lowered for it. Surface every such leaf LOUDLY in the payload (the
// Lesson-3 class the engine claims to have killed) so it is never invisible again.
const degradations = trusted
  .filter(d => d.gateLevel === 'llm-only')
  .map(d => `gate=llm-only (no deterministic gate ran): ${String(d.task).slice(0, 80)}`)
if (degradations.length) log(`⚠ ${degradations.length} TRUST-FLOOR DEGRADATION(S): leaf(s) trusted on the LLM verifier ALONE (no deterministic tier-0 gate) — see degradations.`)

// W: "built-tested-unwired" audit — the dominant cross-leaf defect class observed live (4 recurrences:
// new API lands fully leaf-tested but NO production path calls it; per-leaf verification structurally
// cannot see this). Deterministic extraction (diff → new exported symbols) + one agent judging call
// sites. ADVISORY: surfaces in the payload/log, never gates the run.
let wiringGaps: string[] = []
if (GIT && trusted.length && !QUOTA_HALT) {
  try {
    const newPub = await sh(
      `cd ${REPO} && git diff ${BASE_SHA}..HEAD -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null | ` +
      `grep -E '^\\+[^+].*\\b(public|open|export|pub)\\b.*\\b(func|fn|function|var|let|class|struct|enum|const)\\b' | ` +
      `sed -E 's/^\\+\\s*//' | head -40`, 'wiring-scan')
    // A1/A7: if the sh proxy is dead, newPub is SH_UNAVAILABLE (sentinel object); its stdout
    // '\x00SH_UNAVAILABLE' is truthy, which would fire the wiring-auditor with garbage input.
    // Guard first so proxy death keeps the old skip behavior (advisory only — never gate the run).
    const symbols = shUnavailable(newPub) ? '' : (newPub.stdout || '').trim()
    if (symbols) {
      // Deterministic reference COUNTS (engine-owned, ONE sh call): the judge should weigh
      // evidence, not gather it. Symbol names come from the declaration lines via a strict
      // identifier regex (injection-safe by construction); grep -rw counts every mention
      // outside test paths — a count ≈ the declaration's own lines marks the unwired
      // candidate. The LLM now judges only the EXCEPTIONS instead of doing its own greps.
      const names = [...new Set((symbols.match(/(?:func|fn|function|var|let|class|struct|enum|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g) || [])
        .map(m => m.replace(/^.*\s/, '')))].slice(0, 20)
      let refCounts = ''
      if (names.length) {
        const counter = names.map(n =>
          `printf '%s %s\\n' "${n}" "$(grep -rw "${n}" . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null | grep -viE '(^|/)(tests?|spec)' | wc -l | tr -d ' ')"`).join('; ')
        refCounts = ((await sh(`cd ${REPO} && { ${counter}; }`, 'wiring-count')).stdout || '').trim()
      }
      const w: { gaps?: string[] } | null = await agentSafe(
        `You are the WIRING auditor. This run added the following NEW exported declarations to ${REPO} ` +
        `(extracted from \`git diff ${BASE_SHA.slice(0, 8)}..HEAD\`, test files excluded):\n${symbols}\n\n` +
        `DETERMINISTIC reference counts (engine-run \`grep -rw\` over production paths; a count of 1-3 ` +
        `usually means declaration-only = UNWIRED candidate):\n${refCounts || '(count step unavailable)'}\n\n` +
        `Judge from those counts — re-grep a symbol yourself ONLY when its count is ambiguous. ` +
        `Report as gaps ONLY symbols that (a) have ZERO production call sites AND (b) look like they were ` +
        `MEANT to be wired into an existing flow — i.e. the feature is unreachable by a user. ` +
        `EXCLUDE: protocol/interface requirements, overrides, library-surface API intended for external ` +
        `consumers, entry points referenced by config/manifest, helpers used by other NEW symbols that ARE wired. ` +
        `Each gap: "<symbol> (<file>): <why it looks unwired, one line>". Empty array if all wired.`,
        { phase: 'Integrate', label: 'wiring-audit', schema: { type: 'object', required: ['gaps'], properties: { gaps: { type: 'array', items: { type: 'string' } } } } })
      wiringGaps = (w && w.gaps) || []
      if (wiringGaps.length) log(`⚠ wiring-audit: ${wiringGaps.length} new symbol(s) with NO production call site (built-tested-unwired class)`)
      else log('wiring-audit: all new exported symbols reachable from production code')
    }
  } catch (e) { log(`wiring-audit skipped: ${e && e.message ? e.message : e}`) }
}
// ① Surface PURPOSE gaps prominently — tests green (prompt) ≠ feature verified for the user (purpose).
const purposeGaps = [
  ...((baseline.inProcessVerifiable === false && baseline.purposeCheck) ? [`baseline: purpose needs out-of-process verification — ${baseline.purposeCheck}`] : []),
  ...done.map(d => d.verdict && d.verdict.purposeGap).filter((g): g is string => !!g),
  // the executor's own honest admission becomes a gap even if the verifier omitted one
  ...done.filter(d => d.purposeVerified === false && !(d.verdict && d.verdict.purposeGap)).map(d => `leaf verified only via fakes/mocks (purposeVerified=false): ${String(d.task).slice(0, 60)}`),
  ...((integration && integration.purposeGap) ? [integration.purposeGap] : []),
]
// B: Owner's Briefing — comprehension debt is the one thing the loop cannot repay (the owner must READ
// what landed, or they own a codebase they can't debug or steer). The ledger already holds the raw
// material (decisions, concerns, gaps, tangents); one agent turns it into a cheap GUIDED read instead
// of an unaided archaeology dig. Failure here never blocks the run (try/catch, payload survives).
let briefing: Briefing | null = null
// A4: explicit QUOTA_HALT gate — even if trusted.length > 0 (e.g. some leaves trusted before the
// halt fired), skip the briefing agent entirely; the halt log already carries the resume instruction
// and spawning another agent would re-trip the same quota immediately.
if (trusted.length && !QUOTA_HALT) {
  const ledgerForBriefing = done.map((d, j) => ({
    i: j, task: String(d.task).slice(0, 140), trusted: !!(d.verdict && d.verdict.trustworthy),
    commits: d.commits || [], files: d.filesChanged || [],
    interfaceConcern: d.interfaceConcern || undefined,
    purposeGap: (d.verdict && d.verdict.purposeGap) || undefined,
    discovered: d.discovered && d.discovered.length ? d.discovered : undefined,
    funList: d.funList && d.funList.length ? d.funList : undefined,
    refactor: d.refactor ? String(d.refactor).slice(0, 200) : undefined,
  }))
  try {
    briefing = (await agentSafe(
      `You are the Comprehension Steward. A trust-first workflow just landed VERIFIED code the OWNER has not ` +
      `read — "comprehension debt": speed silently converts into a codebase the owner can no longer debug or ` +
      `steer. Turn this run's ledger into a GUIDED READ (~10-15 min) that repays that debt cheaply.\n` +
      `Repo: ${REPO}. Baseline ${BASE_SHA ? BASE_SHA.slice(0, 8) : '(no git)'} → HEAD.` +
      (GIT ? ` First run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` and \`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`, then READ the key files yourself before writing.` : '') +
      `\nLedger (per leaf): ${JSON.stringify(ledgerForBriefing).slice(0, 6000)}\n` +
      `Write \`briefing\` as markdown with EXACTLY these sections:\n` +
      `1. **Reading order** — files in dependency order (pure core first, shells last): per file what it does, which commit introduced it, why it matters.\n` +
      `2. **Decisions made for you** — interface/design choices made on the owner's behalf and WHY (include every interfaceConcern verbatim).\n` +
      `3. **Buried bodies** — quirks, known follow-ups, discovered-but-not-done items, funList tangents, anything that would surprise the owner in 3 months.\n` +
      `4. **Verify by hand** — the human-oracle items: every purposeGap, with the EXACT command/steps to close it (live test, app action).\n` +
      `Be concrete: real paths, commit SHAs, line pointers where it matters. Match the language the task was written in. No fluff — the test is: after this read, can the owner debug and steer this code?`,
      { phase: 'Integrate', label: 'owner-briefing', schema: BRIEFING })) as Briefing | null
    if (!briefing) {
      log('owner-briefing agent unavailable (API error) — one retry')
      briefing = (await agentSafe(
        `You are the Comprehension Steward. Turn this run's ledger into a GUIDED READ (~10-15 min) for the ` +
        `owner: reading order (files, commits, why), decisions made for them, buried bodies, and what to ` +
        `verify by hand. Repo: ${REPO}.` + (GIT ? ` Run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` first.` : '') +
        `\nLedger: ${JSON.stringify(ledgerForBriefing).slice(0, 6000)}\nMatch the language the task was written in. Be concrete.`,
        { phase: 'Integrate', label: 'owner-briefing-retry', schema: BRIEFING })) as Briefing | null
    }
  } catch (e) { log(`owner-briefing skipped (budget/API): ${e && e.message ? e.message : e}`) }
  // ITEM 2: best-effort DETERMINISTIC persist of the briefing text to docs/briefings/<ts>.md. The
  // briefing was previously RELAYED only through the agent (the `briefing` payload field) — a relay the
  // owner can miss; a file on disk survives the conversation. The write is purely additive (it gates NO
  // trust) and is wrapped in its OWN try/catch that NEVER aborts the run — a failed persist must not cost
  // a green run its trusted leaves. <ts>: the run has no clock-timestamp in its context, so use a STABLE
  // name derived from the pinned baseline SHA (deterministic + collision-resistant across runs), falling
  // back to a fixed name when git is off. INJECTION-SAFE: the briefing markdown (arbitrary LLM text) is
  // base64-encoded in JS — the [A-Za-z0-9+/=] alphabet is shell-safe — and decoded by `base64 -d`, so no
  // user/agent text ever reaches the shell command verbatim (the keep-text-out-of-shell discipline).
  if (briefing && briefing.briefing) {
    try {
      const ts = BASE_SHA ? BASE_SHA.slice(0, 12) : 'briefing'
      const dir = `${REPO}/docs/briefings`
      const file = `${dir}/${ts}.md`
      const b64 = Buffer.from(String(briefing.briefing), 'utf8').toString('base64')
      const w = await sh(`mkdir -p ${dir} && printf %s '${b64}' | base64 -d > ${file}`, 'briefing-persist')
      if (!shUnavailable(w) && w.exitCode === 0) log(`owner briefing persisted → ${file}`)
      else log(`owner briefing persist skipped (write unavailable/failed; the briefing is still in the payload)`)
    } catch (e) { log(`owner briefing persist skipped (${e && e.message ? e.message : e}); briefing is still relayed in the payload`) }
  }
}

// A2: shForce so lock-clear runs even after QUOTA_HALT — without this, a quota death leaves a
// stale lock that blocks the user's guided resume (self-defeating: the engine announces "relaunch
// with resumeFromRunId" but the next run immediately hits "working tree locked by another run").
if (LOCKFILE) { try { await shForce(`rm -f ${LOCKFILE}`, 'lock-clear') } catch (e) { log(`lock-clear failed (budget ceiling?) — stale lock left at ${LOCKFILE}; remove it before the next run.`) } }
if (ABORTS.length) log(`⚠ ${ABORTS.length} unit(s) halted by the untrusted-streak guard: ${ABORTS.join(' | ')}`)
log(`Done: ${trusted.length}/${done.length} leaves trusted | merge ${merge ? (merge.trustworthy ? 'OK' : 'ISSUES') : 'n/a'} | full-suite ${finalRun.exitCode === -1 ? 'NOT RUN' : (fullSuiteGreen ? 'GREEN' : 'RED')} | integration ${integration && integration.trustworthy ? 'OK' : (integration ? 'FAILED' : 'UNKNOWN')}`)
if (purposeGaps.length) log(`⚠ ${purposeGaps.length} PURPOSE GAP(S) — tests pass but real-user behavior is UNVERIFIED (see purposeGaps; close via live test / human).`)

// ITEM 2: ONE overall trust verdict + an owner's headline. The payload already exposes every signal
// SEPARATELY (results/coordinator/integration/fullSuiteGreen/degradations…) but NO single rollup — so a
// CATASTROPHIC run (RED suite, distrusted integration, reverted leaves) could still LOOK perfect to a
// glancing reader who only checks `briefing` or `trustedLeaves`. overallTrust is the AND of every trust
// dimension; it is purely ADDITIVE (a rollup over existing booleans — it can only ever go FALSE on a
// dimension that already failed, so it can NEVER manufacture a false green that the individual signals
// did not already carry). Dimensions, in headline-priority order (first failing one names the verdict):
const allLeavesTrusted = trusted.length === done.length          // every EXECUTED leaf is trusted
const mergeOk = !merge || merge.trustworthy                       // no parallel merge, OR the merge is trustworthy
const integrationOk = !!(integration && integration.trustworthy) // the integrate verifier trusts the whole
const noDegradations = !degradations || degradations.length === 0 // Item 1's trust-floor downgrades are empty
const overallTrust = allLeavesTrusted && mergeOk && fullSuiteGreen && integrationOk && noDegradations
// ownersHeadline: one human line. When green, the full reassuring summary; when not, NAME the first
// failing dimension (so the owner sees WHAT broke, not just that something did) in the same priority order
// the verdict is computed in.
const headlineCounts = `${trusted.length}/${done.length} leaves trusted · full-suite ${finalRun.exitCode === -1 ? 'NOT RUN' : (fullSuiteGreen ? 'GREEN' : 'RED')} · integration ${integrationOk ? 'OK' : (integration ? 'DISTRUSTED' : 'UNKNOWN')} · ${(degradations || []).length} degradation${(degradations || []).length === 1 ? '' : 's'}${merge ? ` · merge ${mergeOk ? 'OK' : 'ISSUES'}` : ''}`
const firstFailure =
  !allLeavesTrusted ? `${done.length - trusted.length} of ${done.length} leaves NOT trusted`
  : !mergeOk        ? 'parallel merge NOT trustworthy'
  : !fullSuiteGreen ? (finalRun.exitCode === -1 ? 'integrate full-suite DID NOT RUN' : `integrate full-suite RED (exit ${finalRun.exitCode})`)
  : !integrationOk  ? (integration ? 'integration verdict DISTRUSTED' : 'integration verdict UNKNOWN (never ran)')
  : !noDegradations ? `${degradations!.length} trust-floor degradation(s)`
  : ''
const ownersHeadline = overallTrust
  ? `TRUSTED — ${headlineCounts}`
  : `NOT TRUSTED — first failing: ${firstFailure} · ${headlineCounts}`
log(`Overall verdict: ${ownersHeadline}`)

return {
  task: TASK, mode: groups ? 'parallel' : 'sequential', baseline,
  results: done, coordinator: merge, integration,
  fullSuiteGreen, integrationExit: finalRun.exitCode,
  trustedLeaves: trusted.length, totalLeaves: done.length,
  purposeGaps, wiringGaps, aborts: ABORTS, degradations,
  overallTrust, ownersHeadline,   // ITEM 2: the single rollup verdict + the one human line (additive; never a false green)
  briefing: (briefing && briefing.briefing) || undefined,   // B: the owner's guided read — RELAY this, don't bury it
}

}
