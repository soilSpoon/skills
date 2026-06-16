// NOTE: the runtime-required `export const meta = {...}` literal lives in tsup.config.ts
// (banner) — a bundler would relocate an in-module export away from the top of the file.

import { BASELINE, DECOMPOSE, SLICES, LEARNING, RESULT, VERDICT, MISSING, BRIEFING } from './schemas'
import { R_BASELINE, R_SLICE, R_EXEC, R_VERIFY, R_VERIFY_LIGHT, R_CRITIC, R_COORD } from './prompts'
import type { EngineArgs, Baseline, Decompose, SliceSpec, ExecResult, Verdict, ShResult, WorkNode, LeafRecord, Groups, EngineResult, RiskTier, SliceKind, Briefing, GateLevel, TraceRecord } from './types'
import { b64encode, circuitBreaker, engineRanBlock } from './util'
import { makeVerifyLeaf } from './phases/verify'
import { makeRunWork } from './phases/leaf-loop'
import { makeHost } from './host'
import { makeWorkflowRuntime } from './runtime'
import { makeLeafTest } from './leaf-prompt'
import { integratePhase } from './phases/integrate'
// ARCHITECTURE (full: references/architecture.md · ENFORCED: test/unit/architecture.test.mjs) — the engine
// src is a strict layered DAG, imports flowing DOWN: L0 pure leaves (types/util/prompts/schemas/leaf-prompt)
// → L1 host (I/O) → L2 phases/* (verify·leaf-loop·integrate, each a cohesive logic unit reached only by
// main's dep-wiring) → L3 main (this orchestrator spine, imported by nothing). "Module or inline?" is the
// fitness test's call, not a judgment: a cohesive unit + clean deps interface that lifts out byte-for-byte → module.
async function __main(): Promise<EngineResult> {
// Runtime-throw containment: agent() can THROW rather than return null (observed live:
// "subagent completed without calling StructuredOutput" killed a 50-agent, 5-hour run that
// the null path would have survived — the engine already treats null as distrust/retry at
// every call site). Convert throws to null; budget/ceiling throws stay fatal — they mean
// STOP, and the Integrate try/catch owns that cleanup path.
// circuitBreaker (the ONE breaker abstraction) → src/util.ts. Instantiated three ways below: quota =
// circuitBreaker(3, 2) at SESSION scope, untrusted = circuitBreaker(MAX_UNTRUSTED_STREAK) at UNIT scope,
// t0red = circuitBreaker(2) at RUN scope. Behavior-preserving: thresholds/scopes/ACTIONS/resumability UNCHANGED.
// Quota circuit breaker: a session/usage-limit death is NOT a one-off null — left alone it
// kills every subsequent agent serially (observed live: 12 consecutive corpses after one
// "You've hit your session limit"). First quota-shaped error (or 3 consecutive nulls of any
// cause) flips QUOTA_HALT; from then on agentSafe no-ops, loops stop cleanly, and the run
// ends resumable instead of burning attempts until the harness gives up.
// The injected platform Runtime (Claude Code Workflow adapter). makeHost builds the engine's I/O services
// over it; each phase receives `rt` too. The opencode adapter supplies its own Runtime — same engine core.
const rt = makeWorkflowRuntime()
const { agent, parallel, phase, log, args } = rt   // the platform primitives main itself calls
const host = makeHost(rt)   // cohesive host-services bundle — passed WHOLE to phases (one param); destructured here for main's own use
const { agentSafe, sh, shForce, shBatch, shUnavailable, SH_UNAVAILABLE, MARKER, getQuotaHalt } = host
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
// depth-0 over-tier gate sentinel (mirrors the QUOTA_HALT flag): `stop` reason string ('' = not tripped),
// `slices` = breadth that tripped it (machine-readable ETA). An OBJECT (not two `let`s) so the extracted
// runWork (src/phases/leaf-loop.ts) mutates it by-reference; consumed at the top-level call site so the
// lock-safe teardown still runs.
const overTier = { stop: '', slices: 0 }
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
// the run's tuning limits, bundled (introduce-parameter-object) — threaded as one `cfg` into the leaf loop
const cfg = { FLOOR, MAX_LEAVES, MAX_DISCOVERED, MAX_SPIKES, MAX_REPAIR, MAX_REPAIR_HARD, MAX_UNTRUSTED_STREAK, CONFIRM_TIER }


// =============================================================================
phase('Baseline')
log(`Task: ${TASK}${PARALLEL ? ' [parallel mode]' : ''}`)
const baseline: Baseline | null = await agentSafe(
  `${R_BASELINE}\n\nRepo: ${REPO}\nUpcoming work: "${TASK}"\nEstablish the trust invariant BEFORE any change. ` +
  `Find the measurement command, run it once, and distill the project card.`,
  { phase: 'Baseline', model: 'sonnet', schema: BASELINE })
if (!baseline) { log('FATAL: baseline agent returned no result (API/rate-limit) — aborting before any change.'); return { error: 'baseline failed', task: TASK } }
log(`Baseline: ${baseline.currentState} | measure: ${baseline.measureCommand}`)
// RIG CROSS-CHECK (non-halting, additive — surfaces a baseliner inconsistency between its rigPresent verdict
// and the measureCommand it authored). rigPresent:false + a REAL measureCommand ⇒ likely UNDER-judgment (a
// false halt the human can override); rigPresent:true + a TRIVIAL measureCommand ('true'/''/'echo'/'exit 0')
// ⇒ likely a vacuous floor (per-leaf gates degrade to llm-only, the integrate net cannot go red — false-green
// risk). A WARN only: it NEVER halts (the gate below owns halting) — the engine just makes the mismatch LOUD.
const rigMeasure = String(baseline.measureCommand || '').trim()
const rigTrivial = rigMeasure === '' || /^(true|:|echo|exit\s+0)\b/.test(rigMeasure)
if (baseline.rigPresent === false && !rigTrivial) log(`⚠ rig cross-check: rigPresent:false but measureCommand looks real (\`${rigMeasure}\`) — possible baseliner under-judgment. If the rig is real, fix the baseliner or re-run with confirmNoRig:true.`)
if (baseline.rigPresent === true && rigTrivial) log(`⚠ rig cross-check: rigPresent:true but measureCommand is trivial (\`${rigMeasure || '(empty)'}\`) — possible vacuous floor (false-green risk): per-leaf gates degrade to llm-only and the integrate net cannot go red.`)
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
const LEAF_TEST = makeLeafTest(baseline.measureCommand)   // dynamic per-leaf prompt fragment → src/leaf-prompt.ts

// ITEM 8 (KEYSTONE): the engine's deepest idea — run a deterministic shell command, then a model JUDGES from
// that FIXED result (never re-runs) — was hand-reimplemented at the two leaf gates (filtered tier-0 + tidy
// full-suite). This is the ONE canonical "shell-truth → ENGINE-RAN → model judges" string builder for those
// sites: it states the command, its exit, and an output tail, then hands the verifier its `duty` (confirm a
// real test ran / judge the artifacts) — explicitly WITHOUT re-running. The control flow that decides WHEN each
// gate runs and how RED is handled legitimately differs per site and stays inline; only this shared STRING is
// extracted here. (The merge/integrate nets use a different surface form — `exit=N (GREEN/RED)` mid-prose, no
// ENGINE-RAN prefix / no tail — so they are NOT folded in: that would change the byte-text the verifier sees.)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━ GIT + LOCK BOOTSTRAP ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Establishes BASE_SHA / GIT / gitVerify / GIT_EXEC / trace + acquires the inter-run lock. INTENTIONALLY
// INLINE (FATAL early-returns + the atomic-lock spec lives on this code — Lesson 9; see architecture.md).
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
const trace = async (rec: TraceRecord): Promise<void> => {
  try {
    // Stamp the baseline SHA on every line; drop undefined fields so the JSONL stays compact + only
    // carries facts the engine actually knows at this call site (leafIndex/gateLevel/trustworthy/etc.).
    const line: Record<string, unknown> = { baseSha: BASE_SHA || null }
    for (const [k, v] of Object.entries(rec)) if (v !== undefined) line[k] = v
    const json = JSON.stringify(line)
    const b64 = b64encode(json + '\n')
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
// the git/repo context, bundled — all members final by here (BASE_SHA, GIT_EXEC, gitVerify, LOCKFILE all set above)
const git = { BASE_SHA, GIT, GIT_EXEC, LOCKFILE, gitVerify }   // GIT-mode state only; REPO threaded separately (git-independent)
const verifyLeaf = makeVerifyLeaf({ rt, host, git, LEAF_TEST, INV, ENGINE_DIFF_CAP })

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
// The leaf loop (src/phases/leaf-loop.ts) — wired here, AFTER SCRATCH is known, with all its shared services.
const runWork = makeRunWork({ rt, host, cfg, git, REPO, SCRATCH, trace, verifyLeaf, t0redBreaker, LEAF_TEST, INV, ABORTS, RE_ZERO_TESTS, overTier, baseline: baseline! })
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
  if (getQuotaHalt()) {
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
if (overTier.stop) {
  log(`over-tier stop — skipping integrate/wiring/briefing (nothing was executed)`)
  if (LOCKFILE) { try { await shForce(`rm -f ${LOCKFILE}`, 'lock-clear') } catch (e) { log(`lock-clear failed — stale lock at ${LOCKFILE}; remove before next run.`) } }
  return { error: `over-tiered: ${overTier.stop} — do it inline (T1) or re-run with confirmTier:true`, task: TASK, baseline, overTierStop: true, slices: overTier.slices }
}

// =============================================================================
return await integratePhase({ rt, host, git, REPO, INV, TASK, baseline: baseline!, ABORTS, done, merge, groups })

}
