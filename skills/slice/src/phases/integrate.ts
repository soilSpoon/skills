// Phase: integrate + report — the deterministic full-suite net, the integration verdict, the trust-floor
// degradation audit, the wiring audit, the owner's briefing, and the final EngineResult assembly. Extracted
// from main.ts VERBATIM: integratePhase(d) takes the run's accumulated state + services as a typed deps arg
// (destructured), body unchanged. Called ONCE after the Work phase, so a plain function (not a factory).
import { BRIEFING, VERDICT } from '../schemas'
import { R_VERIFY } from '../prompts'
import { b64encode, engineRanBlock } from '../util'
import type { ShResult, Baseline, Verdict, LeafRecord, EngineResult, Briefing, Groups, GitCtx, Runtime } from '../types'
import type { Host } from '../host'

export type IntegrateDeps = {
  rt: Runtime
  host: Host
  git: GitCtx
  REPO: string
  INV: string
  TASK: string
  baseline: Baseline
  ABORTS: string[]
  done: LeafRecord[]
  merge: Verdict | null
  groups: Groups | null
}

export const integratePhase = async (d: IntegrateDeps): Promise<EngineResult> => {
const { rt, host, git, REPO, INV, TASK, baseline, ABORTS, done, merge, groups } = d
const { agent, phase, log } = rt
const { sh, shForce, shUnavailable, agentSafe, getQuotaHalt } = host
const { BASE_SHA, GIT, LOCKFILE } = git
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
if (getQuotaHalt()) {
  ABORTS.push(`quota-halt: ${getQuotaHalt()} — integrate/wiring/briefing skipped; relaunch with resumeFromRunId after the limit resets (cached leaves replay free)`)
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
  const integrationR = await agentSafe<Verdict>(
    `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
    `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
    `suite; JUDGE from that result whether every invariant still holds across the integrated whole` +
    `${finalRun.exitCode === 0 ? '' : ' (it is RED — identify which leaf/area most likely regressed)'}.\n${INV}` +
    (GIT ? `\nAlso summarize the cumulative trust deposit (\`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`) and confirm no out-of-scope file changed since baseline.` : ''),
    { phase: 'Integrate', schema: VERDICT })
  integration = integrationR.ok ? integrationR.value : null
  if (!integration) {
    log('integration agent unavailable (API error) — one retry')
    const integrationRetryR = await agentSafe<Verdict>(
      `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
      `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
      `suite; JUDGE from that result whether every invariant still holds across the integrated whole.\n${INV}`,
      { phase: 'Integrate', label: 'integration-retry', schema: VERDICT })
    integration = integrationRetryR.ok ? integrationRetryR.value : null
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
if (GIT && trusted.length && !getQuotaHalt()) {
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
      const wR = await agentSafe<{ gaps?: string[] }>(
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
      const w = wR.ok ? wR.value : null
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
if (trusted.length && !getQuotaHalt()) {
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
    const briefingR = await agentSafe<Briefing>(
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
      { phase: 'Integrate', label: 'owner-briefing', schema: BRIEFING })
    briefing = briefingR.ok ? briefingR.value : null
    if (!briefing) {
      log('owner-briefing agent unavailable (API error) — one retry')
      const briefingRetryR = await agentSafe<Briefing>(
        `You are the Comprehension Steward. Turn this run's ledger into a GUIDED READ (~10-15 min) for the ` +
        `owner: reading order (files, commits, why), decisions made for them, buried bodies, and what to ` +
        `verify by hand. Repo: ${REPO}.` + (GIT ? ` Run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` first.` : '') +
        `\nLedger: ${JSON.stringify(ledgerForBriefing).slice(0, 6000)}\nMatch the language the task was written in. Be concrete.`,
        { phase: 'Integrate', label: 'owner-briefing-retry', schema: BRIEFING })
      briefing = briefingRetryR.ok ? briefingRetryR.value : null
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
      const b64 = b64encode(String(briefing.briefing))
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
