// NOTE: the runtime-required `export const meta = {...}` literal lives in tsup.config.ts
// (banner) — a bundler would relocate an in-module export away from the top of the file.

import { BASELINE, ASSESSMENT, SLICES, LEARNING, RESULT, VERDICT, MISSING, BRIEFING } from './schemas'
import { R_BASELINE, R_ASSESS, R_SLICE, R_EXEC, R_VERIFY, R_VERIFY_LIGHT, R_CRITIC, R_COORD } from './prompts'
import type { EngineArgs, Baseline, Assessment, SliceSpec, ExecResult, Verdict, ShResult, WorkNode, LeafRecord, Groups, EngineResult, RiskTier, SliceKind, Briefing } from './types'

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
declare function pipeline(items: unknown[], ...stages: Array<(prev: any, item: any, index: number) => unknown>): Promise<unknown[]>
declare function phase(title: string): void
declare function log(message: string): void
declare function workflow(nameOrRef: string | { scriptPath: string }, args?: unknown): Promise<unknown>
declare const args: unknown
declare const budget: { total: number | null; spent(): number; remaining(): number }

async function __main(): Promise<EngineResult> {
// Runtime-throw containment: agent() can THROW rather than return null (observed live:
// "subagent completed without calling StructuredOutput" killed a 50-agent, 5-hour run that
// the null path would have survived — the engine already treats null as distrust/retry at
// every call site). Convert throws to null; budget/ceiling throws stay fatal — they mean
// STOP, and the Integrate try/catch owns that cleanup path.
// Quota circuit breaker: a session/usage-limit death is NOT a one-off null — left alone it
// kills every subsequent agent serially (observed live: 12 consecutive corpses after one
// "You've hit your session limit"). First quota-shaped error (or 3 consecutive nulls of any
// cause) flips QUOTA_HALT; from then on agentSafe no-ops, loops stop cleanly, and the run
// ends resumable instead of burning attempts until the harness gives up.
let QUOTA_HALT = ''
let NULL_STREAK = 0
let NULL_STREAK_CLASSES = new Set<string>()  // A6: track call classes in streak; same-class-only loop (e.g. heavy lenses) must not halt
// A6: extract the call class from opts — the prefix before ':' or '·'. Same-class streaks arise
// by design (heavy 3-lens loop), so ≥2 different classes are required before treating the
// streak as a session-instability signal (not just a single role's transient failures).
const callClass = (opts?: AgentOpts) => ((opts && (opts.label || opts.phase)) || '').replace(/[:·].*/u, '').trim() || 'unknown'
const quotaHalt = (why: string) => {
  QUOTA_HALT = why
  log(`⛔ QUOTA HALT: ${why} — no further agents will be spawned; relaunch with resumeFromRunId after the limit resets (cached leaves replay free).`)
}
const agentSafe: typeof agent = async (prompt, opts) => {
  if (QUOTA_HALT) { log(`agent skipped (quota halt): ${(opts && (opts.label || opts.phase)) || ''}`); return null }
  try {
    const r = await agent(prompt, opts)
    if (r === null) {
      NULL_STREAK++; NULL_STREAK_CLASSES.add(callClass(opts))
      if (NULL_STREAK >= 3 && NULL_STREAK_CLASSES.size >= 2) quotaHalt(`${NULL_STREAK} consecutive agent failures (API/session quota suspected)`)
    } else { NULL_STREAK = 0; NULL_STREAK_CLASSES = new Set() }
    return r
  }
  catch (e: any) {
    const m = String((e && e.message) || e)
    if (/budget|ceiling/i.test(m)) throw e
    if (/session limit|rate.?limit|quota|too many requests|overloaded|credit/i.test(m)) { quotaHalt(m.slice(0, 120)); return null }
    log(`agent threw (treated as null): ${m.slice(0, 140)}`)
    NULL_STREAK++; NULL_STREAK_CLASSES.add(callClass(opts))
    if (NULL_STREAK >= 3 && NULL_STREAK_CLASSES.size >= 2) quotaHalt(`${NULL_STREAK} consecutive agent failures (API/session quota suspected)`)
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
const PARALLEL = A.parallel === true     // opt-in: run independent top-level slices in parallel git worktrees
const FORCE_PARALLEL = A.forceParallel === true   // override the compile-bound auto-fallback to sequential
const SHARED_SCRATCH = A.sharedScratch === true   // compile-bound parallel WITHOUT per-worktree cold builds: all
                                                  // worktrees share ONE build dir (--scratch-path) so dependency
                                                  // artifacts compile once; builds serialize on its lock (measured:
                                                  // 3×cold ≈ 9-15min vs serialized-warm ≈ 1-2min). Opt-in: assumes a
                                                  // SwiftPM-style builder whose test wrapper passes flags through.
const MAX_LEAVES = 24                    // hard backstop on total executed work units (per work-unit/group)
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
const shUnavailable = (r: ShResult) => r === SH_UNAVAILABLE
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

// =============================================================================
phase('Baseline')
log(`Task: ${TASK}${PARALLEL ? ' [parallel mode]' : ''}`)
const baseline: Baseline | null = await agentSafe(
  `${R_BASELINE}\n\nRepo: ${REPO}\nUpcoming work: "${TASK}"\nEstablish the trust invariant BEFORE any change. ` +
  `Find the measurement command, run it once, and distill the project card.`,
  { phase: 'Baseline', model: 'sonnet', schema: BASELINE })
if (!baseline) { log('FATAL: baseline agent returned no result (API/rate-limit) — aborting before any change.'); return { error: 'baseline failed', task: TASK } }
log(`Baseline: ${baseline.currentState} | measure: ${baseline.measureCommand}`)
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
  (scope ? `Test scope = \`${scope}\` — run the project-card filter form scoped to it, and NAME the test suite/class you add so this exact token matches it (the engine re-runs this filter as a deterministic gate; a name mismatch = zero tests matched = an untrusted leaf). `
         : `Filter to the test suite/file you add or touch (project-card filter syntax). `) +
  `A full BUILD is fine; a full TEST run is not. Minimize re-runs: red once, green once, post-refactor once — do not re-run unchanged. ` +
  `Never poll or busy-wait on other processes (no pgrep/sleep loops — one such loop once wasted 5 minutes); run your command directly and let the build tool's own lock serialize.`

// Deterministic gitSha — do NOT rely on the LLM baseliner to remember it (it once silently
// didn't, disabling git mode). A fixed `git rev-parse HEAD`, run verbatim, owns this.
// A1/A7: if the shell proxy is dead, shUnavailable(r) is true; treat that as FATAL — not as
// "no git" (which would silently downgrade to sequential-no-revert mode, hiding the outage).
const headR = await sh(`git -C ${REPO} rev-parse HEAD 2>/dev/null || true`, 'git-sha')
if (shUnavailable(headR)) {
  log('FATAL: shell-proxy agent returned no result for git-sha capture — cannot determine git state; aborting.')
  return { error: 'shell-proxy unavailable at git-sha decision point', task: TASK }
}
const headOut = headR.stdout || ''
const BASE_SHA = (headOut.match(/[0-9a-f]{40}/i) || [''])[0]
const GIT = !!BASE_SHA
// A1/A7: a shell-proxy death at git-clean must not be silently read as "clean tree" (empty output = clean).
const gitCleanR = GIT ? await sh(`git -C ${REPO} status --porcelain`, 'git-clean') : null
if (gitCleanR && shUnavailable(gitCleanR)) {
  log('FATAL: shell-proxy agent returned no result for git-clean capture — cannot determine working tree state; aborting.')
  return { error: 'shell-proxy unavailable at git-clean decision point', task: TASK }
}
const gitClean = GIT ? ((gitCleanR!.stdout || '').trim() === '') : false
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

// Inter-run mutual exclusion (Lesson 9): two engine runs mutating the SAME working tree corrupt each
// other (one run's verifier sees the other's edits as drift; restores clobber foreign leaves). A
// deterministic lock in the tree's REAL gitdir (resolved via --absolute-git-dir, so each worktree has
// its OWN lock — isolated worktrees may run concurrently, the same tree may not). Content is just the
// base SHA (no task text — keep user text out of shell commands). A crashed run leaves a stale lock:
// the front door clears it after confirming no run is alive. Cleared deterministically at the end.
let LOCKFILE = ''
if (GIT) {
  const lockDirR = await sh(`git -C ${REPO} rev-parse --absolute-git-dir`, 'lock-dir')
  const gd = shUnavailable(lockDirR) ? '' : ((lockDirR.stdout || '').trim().split('\n').pop() || '')
  if (gd && gd.startsWith('/')) {
    LOCKFILE = `${gd}/rs-lock`
    // A1/A7: if sh proxy is dead here, treat as fatal — a null result would read as "held=''"
    // (no lock held) and allow a second concurrent engine to clobber the working tree.
    const lockCheckR = await sh(`cat ${LOCKFILE} 2>/dev/null || true`, 'lock-check')
    if (shUnavailable(lockCheckR)) {
      log('FATAL: shell-proxy agent returned no result for lock-check — cannot verify mutual exclusion; aborting.')
      return { error: 'shell-proxy unavailable at lock-check decision point', task: TASK }
    }
    const held = (lockCheckR.stdout || '').trim()
    if (held) {
      log(`FATAL: another recursive-slice run holds this working tree (lock: ${held}). If that run crashed/was killed, remove ${LOCKFILE} and relaunch.`)
      return { error: 'working tree locked by another recursive-slice run', lock: held, lockFile: LOCKFILE, task: TASK }
    }
    await sh(`echo rs-${BASE_SHA.slice(0, 12)} > ${LOCKFILE}`, 'lock-write')
  }
}

// ---- Risk-tiered verification: spend scrutiny where trust is fragile.
//   light (easy)    → audit diff/tests, no full re-run (integration is the net)
//   standard        → one independent reproduction
//   heavy (hard)    → 3 perspective-diverse skeptics (SEQUENTIAL — avoids nested parallel()); UNANIMOUS trust required
const verifyLeaf = async (lbl: string, node: WorkNode, res: ExecResult, tier: RiskTier | undefined, repo: string, leafStart: string, engineT0: string, buildNote: string): Promise<Verdict> => {
  const leafTest = node.kind === 'tidy' ? '' : LEAF_TEST(node.testScope)   // ④ tidy needs broad behavior-preservation, not a filter
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
  const base = `${R_VERIFY}\n\nRepo: ${repo}\nAdversarially verify this finished leaf.\nTask: ${node.task}\n` +
    `Reported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ''}${buildNote || ''}`
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
    const votes: Verdict[] = []
    for (let li = 0; li < lenses.length; li++) {                // sequential: safe to nest under parallel groups
      const L = lenses[li]
      // C: the correctness lens runs on a DIFFERENT model — homogeneous consensus re-confirms shared
      // blind spots rather than producing independent evidence; cross-model diversity is cheap
      // independence, spent only where trust is most fragile (heavy leaves).
      const v: Verdict | null = await agentSafe(`${base}\nLENS: judge specifically through "${L}".`,
        { phase: 'Work', label: `verify:${lbl}·${L.slice(0, 9)}`, ...(li === 0 ? { model: 'opus' } : {}), schema: VERDICT })
      votes.push(v || { trustworthy: false, reason: `lens "${L}" verifier unavailable — counts as distrust` })
    }                                                            // null lens = distrust: a flaky run can't launder a hard leaf
    const distrust = votes.filter(v => !v.trustworthy)
    return {
      trustworthy: distrust.length === 0,                       // UNANIMOUS across ALL 3 lenses (null counts against)
      reason: `heavy verify: ${votes.length} lenses, ${distrust.length} distrusted`,
      issues: votes.flatMap(v => v.issues || []),
      silentErrorRisk: (distrust[0] || {}).silentErrorRisk,
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
let t0redStreak = 0   // I1 fallback: consecutive engine-RED-vs-executor-green disagreements (run-global, like the template)
const ABORTS: string[] = []     // A: units halted by the untrusted-streak guard (surfaced in the final payload)
async function runWork(rootTask: string, repo: string, startDepth: number, gid?: number | string, cleanOK?: boolean, kind?: SliceKind, buildNote?: string): Promise<{ done: LeafRecord[] }> {
  buildNote = buildNote || ''
  const tag = gid != null ? `g${gid}:` : ''
  const stack: WorkNode[] = [{ task: rootTask, ctx: '', depth: startDepth, spikes: 0, kind: kind || 'behavior' }]
  const done: LeafRecord[] = []
  const executedKeys = new Set<string>()
  let discovered = 0, untrustedStreak = 0
  const keyOf = (s: unknown) => String(s).trim().slice(0, 120)

  while (stack.length && done.length < MAX_LEAVES) {
    const node = stack.pop()!   // loop condition guarantees a non-empty stack
    const atFloor = node.depth >= FLOOR
    // ② An atomic slice was already sized + risk-judged by the slicer — skip the redundant re-assess.
    let a: Assessment | null = null, action: Assessment['action']
    if (node.atomic) {
      action = 'execute'
    } else {
      a = (await agentSafe(
        `${R_ASSESS}\n\nRepo: ${repo}\nTask: ${node.task}\n${node.ctx ? 'Context: ' + node.ctx + '\n' : ''}` +
        `Depth ${node.depth}/${FLOOR}${atFloor ? ' (AT FLOOR — you must return execute)' : ''}.\n${INV}\nClassify and emit the next action.`,
        { phase: 'Work', label: `${tag}assess:d${node.depth}`, model: 'sonnet', schema: ASSESSMENT })) as Assessment | null
      if (!a) log(`${tag}assess failed [d${node.depth}] — defaulting to execute`)
      action = (atFloor || !a) ? 'execute' : a.action
      if (action === 'spike' && node.spikes >= MAX_SPIKES) action = 'execute'
    }

    if (action === 'slice') {
      const sl: { slices?: SliceSpec[] } | null = await agentSafe(
        `${R_SLICE}\n\nRepo: ${repo}\nSlice into thin, VERTICAL, independently-verifiable slices with a ` +
        `self-contained contract each. ${a && a.difficulty === 'hard' ? 'Isolate the risky seam first.' : 'Group near-identical units; 2-5 slices.'}` +
        `\nTask: ${node.task}\n${node.ctx}\n${INV}`,
        { phase: 'Work', label: `${tag}slice:d${node.depth}`, schema: SLICES })
      let slices: SliceSpec[] = (sl && sl.slices) || []
      if (slices.length > 1) {
        const crit: { missing?: Array<{ desc: string; contract: string }> } | null = await agentSafe(
          `${R_CRITIC}\n\nRepo: ${repo}\nTask: ${node.task}\nProposed list:\n` +
          slices.map((s, j) => `${j + 1}. ${s.desc}`).join('\n') + `\n${INV}`,
          { phase: 'Work', label: `${tag}critic:d${node.depth}`, schema: MISSING })
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
        for (let j = slices.length - 1; j >= 0; j--)
          stack.push({ task: slices[j].desc, ctx: `Contract: ${slices[j].contract}`, kind: slices[j].kind || node.kind || 'behavior', atomic: slices[j].atomic, riskTier: slices[j].riskTier, testScope: slices[j].testScope, depth: node.depth + 1, spikes: 0 })
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
    const tier = node.kind === 'tidy' ? 'standard' : (node.atomic ? (node.riskTier || 'standard') : (!a ? 'standard' : a.difficulty === 'easy' ? 'light' : a.difficulty === 'hard' ? 'heavy' : 'standard'))
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
    const restore = async (): Promise<boolean> => {
      if (!GIT || !cleanOK || !leafStart) return false
      const r = await sh(`git -C ${repo} reset --hard ${leafStart}`, `reset:${lbl}`)
      await sh(`git -C ${repo} clean -fdq -e .rs-wt -e .rs-scratch`, `clean:${lbl}`)   // drop untracked files the leaf created (never the shared build dir)
      return r.exitCode !== -2   // -2 = SH_UNAVAILABLE = sh no-op'd (quota halt or proxy dead)
    }

    let res: ExecResult | null = null, verdict: Verdict | null = null, attempt = 0, prevIssueCount = Infinity
    while (true) {
      const repair = attempt === 0 ? '' :
        `\nREPAIR ATTEMPT ${attempt}: a prior attempt was REJECTED by review for: ` +
        `${JSON.stringify((verdict && verdict.issues && verdict.issues.length ? verdict.issues : [verdict && verdict.reason]).slice(0, 6).map(s => String(s).slice(0, 300)))}. ` +
        (verdict && verdict.prescription ? `\nREVIEWER'S PRESCRIBED FIX (apply exactly unless evidently wrong): ${String(verdict.prescription).slice(0, 1200)}\n` : '') +
        (GIT && cleanOK && leafStart ? `FIRST undo your prior attempt with \`git -C ${repo} reset --hard ${leafStart}\` (sibling commits survive), then re-implement fresh; ` : '') +
        `then fix exactly those objections. In git mode add a fresh commit.`
      res = await agentSafe(
        `${R_EXEC}\n\nRepo: ${repo}\nDo EXACTLY this one atomic task.\nTask: ${node.task}\n${node.ctx}\n${INV}${node.kind === 'tidy' ? '' : LEAF_TEST(node.testScope)}${GIT_EXEC}${TIDY}${buildNote}${repair}`,
        { phase: 'Work', label: `exec:${lbl}${attempt ? '.r' + attempt : ''}`, model: 'sonnet', schema: RESULT })
      if (!res) break
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
        if (t0cmd) {
          // In shared-scratch parallel mode the engine's own filtered run must hit the shared build dir
          // too (assumes the filter template passes appended flags through — documented opt-in).
          const t0 = await sh(`cd ${repo} && ${t0cmd}${(SCRATCH && repo !== REPO) ? ` --scratch-path ${SCRATCH}` : ''}`, `t0:${lbl}`)
          if (t0.exitCode !== 0) {
            t0red = { trustworthy: false, reason: `tier-0 (ENGINE-run filtered tests) RED: \`${t0cmd}\` exited ${t0.exitCode} though the executor reported green`, issues: [`deterministic filtered run failed (exit ${t0.exitCode}); output tail: ${String(t0.stdout || '').slice(-300)}`] }
            // A BROKEN template (env/wrapper/filter-syntax) false-REDs every leaf run-wide. After 2
            // consecutive engine-RED-vs-executor-green disagreements, distrust the TEMPLATE, not the
            // leaves — kill it and fall back to LLM verification (the pre-gate path).
            if (++t0redStreak >= 2) { baseline!.filterCommand = ''; log(`${tag}engine t0 disagreed with executor-green ${t0redStreak}× in a row — suspecting a broken filterCommand template; disabling the engine gate (LLM verify takes over)`) }
          } else {
            t0redStreak = 0
            // Exit 0 is NOT proof tests ran: a typo'd scope can match ZERO tests and still exit 0 —
            // blind "ENGINE-VERIFIED" would LAUNDER a vacuous green while muzzling the verifier. Hand
            // the verifier the output and the zero-tests duty instead of an assertion.
            engineT0 = `\nENGINE-RAN: \`${t0cmd}\` exited 0. Output tail: ${String(t0.stdout || '').slice(-300)}\n` +
              `FIRST confirm from that output that at least one test ACTUALLY EXECUTED under scope \`${node.testScope}\` — ` +
              `zero tests matched = a FINDING (vacuous gate / scope-suite mismatch): distrust or re-run yourself. ` +
              `If tests did run, do NOT re-run them — audit the ARTIFACTS (diff scope, test meaningfulness, over-fit, interface drift).`
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
      if (++untrustedStreak >= MAX_UNTRUSTED_STREAK) {
        ABORTS.push(`${tag || 'main:'} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`)
        log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure suspected). Integrate still runs.`)
        break
      }
      continue
    }
    done.push({ task: node.task, ...res, verdict })
    log(`${tag}leaf ${i} ${res.passed ? 'green' : 'RED'} | tier=${tier}${attempt ? ` (repaired×${attempt})` : ''} | ${verdict!.trustworthy ? 'trusted' : 'NOT trusted'}: ${node.task.slice(0, 36)}`)

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
    untrustedStreak = verdict!.trustworthy ? 0 : untrustedStreak + 1
    if (untrustedStreak >= MAX_UNTRUSTED_STREAK) {
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
        stack.push({ task: batchTask, ctx: `Discovered while doing "${node.task.slice(0, 40)}". ${INV}`, kind: 'behavior', atomic: true, riskTier: 'standard', testScope: node.testScope, depth: node.depth, spikes: 0 })
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
const goParallel = PARALLEL && GIT && gitClean && (baseline.coldBuildCost !== 'expensive' || FORCE_PARALLEL || SHARED_SCRATCH)
if (PARALLEL && GIT && !goParallel)
  log(`parallel requested but skipped → SEQUENTIAL. Reason: ${!gitClean ? 'main tree is DIRTY (merge would conflict with your work)' : 'coldBuildCost=expensive (compile-bound: worktrees force cold builds → thrashing, slower than sequential-warm; sharedScratch:true to share one build dir, or forceParallel:true to brute-force)'}.`)
// Shared scratch dir for parallel groups on a compile-bound repo. Lives in the MAIN repo (worktree
// leaf-cleans run inside their own worktree and cannot touch it; main-repo cleans exclude it).
const SCRATCH = (goParallel && SHARED_SCRATCH) ? `${REPO}/.rs-scratch` : ''
const buildNoteFor = (repo: string) => (SCRATCH && repo !== REPO)
  ? `\nSHARED BUILD DIRECTORY (mandatory): append \`--scratch-path ${SCRATCH}\` to EVERY build/test invocation ` +
    `(SwiftPM passes it through its wrappers; Cargo's equivalent is CARGO_TARGET_DIR; other builders have their ` +
    `own shared-build-dir mechanism — use this project's equivalent). The parallel worktrees share that ONE build dir so ` +
    `dependencies compile once; builds serialize on its lock (expected — do not work around it); NEVER delete it.`
  : ''
if (goParallel) {
  const a0: Assessment | null = await agentSafe(
    `${R_ASSESS}\n\nRepo: ${REPO}\nTask: ${TASK}\nDepth 0/${FLOOR}.\n${INV}\nClassify and emit the next action.`,
    { phase: 'Plan', model: 'sonnet', schema: ASSESSMENT })
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
    if (r.exitCode === 0) paths[i] = wtPaths[i]
    else log(`worktree g${i} setup failed (exit ${r.exitCode})`)
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
    (GIT ? `\nAlso summarize the cumulative trust deposit (\`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`) and confirm no out-of-scope file changed since baseline.` : '') +
    `\nPURPOSE (①, Beck): the tests are green (the PROMPT) — but does the work actually WORK for the user (the ` +
    `PURPOSE)? If effectful behavior was exercised only via fakes/mocks, set \`purposeGap\` naming exactly what ` +
    `real-world behavior remains UNVERIFIED and how to close it (live test / human action). Never present fake-green as "it works".`,
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
}

// A2: shForce so lock-clear runs even after QUOTA_HALT — without this, a quota death leaves a
// stale lock that blocks the user's guided resume (self-defeating: the engine announces "relaunch
// with resumeFromRunId" but the next run immediately hits "working tree locked by another run").
if (LOCKFILE) { try { await shForce(`rm -f ${LOCKFILE}`, 'lock-clear') } catch (e) { log(`lock-clear failed (budget ceiling?) — stale lock left at ${LOCKFILE}; remove it before the next run.`) } }
if (ABORTS.length) log(`⚠ ${ABORTS.length} unit(s) halted by the untrusted-streak guard: ${ABORTS.join(' | ')}`)
log(`Done: ${trusted.length}/${done.length} leaves trusted | merge ${merge ? (merge.trustworthy ? 'OK' : 'ISSUES') : 'n/a'} | full-suite ${finalRun.exitCode === -1 ? 'NOT RUN' : (fullSuiteGreen ? 'GREEN' : 'RED')} | integration ${integration && integration.trustworthy ? 'OK' : (integration ? 'FAILED' : 'UNKNOWN')}`)
if (purposeGaps.length) log(`⚠ ${purposeGaps.length} PURPOSE GAP(S) — tests pass but real-user behavior is UNVERIFIED (see purposeGaps; close via live test / human).`)
return {
  task: TASK, mode: groups ? 'parallel' : 'sequential', baseline,
  results: done, coordinator: merge, integration,
  fullSuiteGreen, integrationExit: finalRun.exitCode,
  trustedLeaves: trusted.length, totalLeaves: done.length,
  purposeGaps, wiringGaps, aborts: ABORTS,
  briefing: (briefing && briefing.briefing) || undefined,   // B: the owner's guided read — RELAY this, don't bury it
}

}
