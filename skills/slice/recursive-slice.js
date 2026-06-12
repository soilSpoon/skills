export const meta = {
  name: 'recursive-slice',
  description: 'Trust-first recursive decomposition: baseline → plan → recursive slice/execute with Canon-TDD discipline, risk-tiered adversarial verification, self-repair, per-leaf git commits → (opt-in) parallel worktree groups + coordinator merge → integrate. Generic over any repo+task via args.',
  phases: [
    { title: 'Baseline', detail: 'capture the invariant + project card to preserve' },
    { title: 'Plan', detail: 'classify root; (parallel mode) slice into independent groups' },
    { title: 'Work', detail: 'recursive slice/execute with discover-as-you-go (Canon TDD); parallel worktrees if independent' },
    { title: 'Coordinate', detail: 'merge parallel worktree branches, resolve conflicts (parallel mode only)' },
    { title: 'Integrate', detail: 'final adversarial check of the whole vs baseline' },
  ],
}

// ---- args: { task, repo, maxDepth?, parallel? } -----------------------------
const A = (typeof args === 'string') ? JSON.parse(args) : (args || {})   // tolerate stringified args
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

// ---- schemas: force machine-usable decisions out of each role ---------------
const BASELINE = { type: 'object', required: ['summary', 'invariants', 'measureCommand'], properties: {
  summary: { type: 'string' },
  invariants: { type: 'array', items: { type: 'string' } },   // falsifiable things that must stay true
  measureCommand: { type: 'string' },                          // exact green/red command
  filterCommand: { type: 'string' },                           // I1: filtered-test TEMPLATE containing literal "{scope}" (e.g. "./scripts/test.sh --filter {scope}") — the engine substitutes a suite name and runs it verbatim as a deterministic per-leaf gate; empty if the runner cannot filter
  currentState: { type: 'string' },                            // pass/fail counts as observed now
  projectCard: { type: 'string' },                             // distilled STATIC repo conventions shared to all workers
  coldBuildCost: { type: 'string', enum: ['cheap', 'expensive'] }, // would a FRESH worktree's first build be cheap (interpreted/no-build/shared-cache) or expensive (compiled lang, per-checkout dependency compile)?
  purposeCheck: { type: 'string' },                            // ① how to verify the work ACTUALLY works for the user (PURPOSE) beyond unit tests — e.g. a live integration test / a human action
  inProcessVerifiable: { type: 'boolean' },                    // ① can that purpose be verified deterministically in-process (pure logic / recorded-real bytes), or does it need a real env / human?
} }
const ASSESSMENT = { type: 'object', required: ['difficulty', 'size', 'action', 'reason'], properties: {
  difficulty: { type: 'string', enum: ['easy', 'hard'] },
  size: { type: 'string', enum: ['small', 'big'] },
  action: { type: 'string', enum: ['execute', 'slice', 'spike'] },
  risk: { type: 'string' }, reason: { type: 'string' },
} }
const SLICES = { type: 'object', required: ['slices'], properties: {
  slices: { type: 'array', items: { type: 'object', required: ['desc', 'interface', 'contract'], properties: {
    desc: { type: 'string' },                                  // one-line what
    interface: { type: 'string' },                             // FIXED public surface — or "TBD/exploratory"
    contract: { type: 'string' },                              // achieve + seam/files + invariant + how to verify ALONE
    independent: { type: 'boolean' },                          // safe to build concurrently (no shared files)?
    dependsOn: { type: 'array', items: { type: 'integer' } },  // indices of prerequisite slices
    kind: { type: 'string', enum: ['tidy', 'behavior'] },      // ③ Tidy-First: 'tidy' = behavior-PRESERVING structural prep (verified by existing suite, no new tests); 'behavior' = the actual change
    atomic: { type: 'boolean' },                               // ② true = a single directly-executable unit (skip the redundant re-assess); false = still decompose
    riskTier: { type: 'string', enum: ['light', 'standard', 'heavy'] }, // ② slicer's risk judgment → verification tier (used when atomic, so no re-assess needed)
    testScope: { type: 'string' },                             // ④ the test suite/filter this slice's tests live under → leaf+verifier run FILTERED (not the full suite — the MEASURED #1 time cost)
  } } },
} }
const LEARNING = { type: 'object', required: ['summary'], properties: {
  summary: { type: 'string' },
} }
const RESULT = { type: 'object', required: ['summary', 'passed', 'evidence'], properties: {
  summary: { type: 'string' }, passed: { type: 'boolean' },   // passed = DETERMINISTIC shell result (build+tests), the tier-0 gate
  evidence: { type: 'string' }, diff: { type: 'string' },
  filesChanged: { type: 'array', items: { type: 'string' } },
  refactor: { type: 'string' },                                // structure hat: what was tidied after green, or why none needed
  funList: { type: 'array', items: { type: 'string' } },       // tangents noticed, NOT chased
  discovered: { type: 'array', items: { type: 'string' } },    // NEW test-list scenarios found mid-work → fed back (Canon TDD)
  commits: { type: 'array', items: { type: 'string' } },       // git mode: SHAs created (behavior commit, then refactor commit)
  interfaceConcern: { type: 'string' },                        // if the FIXED interface seemed wrong — reported up, NOT changed
  purposeVerified: { type: 'boolean' },                        // ① did this verify against REAL/recorded-real behavior (purpose), or only hand-fakes/mocks (prompt only)?
} }
const VERDICT = { type: 'object', required: ['trustworthy', 'reason'], properties: {
  trustworthy: { type: 'boolean' },
  issues: { type: 'array', items: { type: 'string' } },
  silentErrorRisk: { type: 'string' }, reason: { type: 'string' },
  purposeGap: { type: 'string' },                              // ① real-user behavior the tests do NOT verify (e.g. only fakes used) — prompt satisfied ≠ purpose served
  prescription: { type: 'string' },                            // I3: when untrustworthy and the fix is VISIBLE — the exact minimal fix (file:line + change); a precise prescription is what makes repair converge (proven live)
  followUps: { type: 'array', items: { type: 'string' } },     // I4: concrete, independently-testable defects worth a follow-up leaf even when trustworthy=true (NOT style nits) — fed into the discovered batch
} }
const MISSING = { type: 'object', required: ['missing'], properties: {
  missing: { type: 'array', items: { type: 'object', required: ['desc', 'contract'], properties: {
    desc: { type: 'string' }, contract: { type: 'string' },
  } } },
} }
const BRIEFING = { type: 'object', required: ['briefing'], properties: {
  briefing: { type: 'string' },                                // B: markdown owner's reading guide (comprehension-debt repayment aid)
} }
// ---- role personas inlined (self-contained; .claude/agents/*.md mirror these) ----
const R_BASELINE =
  'You are the Baseliner (Beck: Baseline Measurement). Capture ground truth BEFORE any change. ' +
  'Read the repo AGENTS.md/CLAUDE.md for EXACT build/test commands; never guess. State falsifiable ' +
  'invariants this work must preserve (a FLOOR, not an exact match: adding new green tests is fine; an ' +
  'existing green test going red is a violation). Never fabricate a green result. ' +
  '(The engine captures the git SHA / clean-tree state deterministically itself — spend no effort on git state.) ' +
  'CARD: distill a `projectCard` of STATIC facts every worker needs so none re-reads AGENTS.md — exact ' +
  'build/test commands (record the FASTEST safe form: filter syntax + parallel flag like `swift test ' +
  '--parallel` if supported), test framework, conventions, hard constraints (pinned deps, secrets-never-' +
  'logged, forbidden APIs). Select sources deterministically; skip generated/vendored/huge files. Tight but complete. ' +
  'FILTER: set `filterCommand` = the runner\'s filtered-test command as a TEMPLATE containing the literal token ' +
  '{scope} (e.g. "./scripts/test.sh --filter {scope}"); the engine substitutes a suite name and runs it VERBATIM ' +
  'as a deterministic per-leaf gate, so it must work from the repo root exactly as written. Empty ONLY if the runner truly cannot filter. ' +
  'BUILD COST: set `coldBuildCost` — would a FRESH checkout (a new git worktree, empty build dir) need an EXPENSIVE ' +
  'full dependency compile (a compiled language — Swift/Rust/C++/Go/etc. — whose deps recompile per checkout, with no ' +
  'shared/global cache a worktree reuses) → "expensive"; or is it CHEAP (interpreted / no build step / a shared cache ' +
  'a worktree reuses) → "cheap"? This gates whether parallel git-worktree builds are worthwhile or just thrash. ' +
  'PURPOSE (Beck — genies satisfy prompts, not purposes): set `purposeCheck` — beyond unit tests, how would one ' +
  'confirm this ACTUALLY works for the user? e.g. "run the env-gated live integration test", "a human marks a ' +
  'message unread in the app and confirms the server updated". Set `inProcessVerifiable` = can that be checked ' +
  'deterministically in-process (pure logic / recorded-REAL bytes) or does it need a real environment / human?'
const R_ASSESS =
  'You are the Assessor — the recursion termination condition. Bias HARD toward execute; over-decomposition ' +
  'is the dominant failure. Judge two orthogonal axes with file:line evidence: difficulty(easy=known/low-risk, ' +
  'hard=unknown/irreversible) × size(small=~one place, big=many places or many near-identical units). Table: ' +
  'easy+small→execute, hard+small→spike, *+big→slice. At/over the depth floor you MUST return execute. A ' +
  'confident wrong call is the costliest output.'
const R_SLICE =
  'You are the Slicer (Beck: Slicing, Symmetry, Isolation). Cut into THIN, VERTICAL, independently-verifiable ' +
  'slices — NEVER by horizontal layer. The hard rule: if a slice cannot be verified ALONE it is wrong; ' +
  'restructure the seams until it can. Each slice carries a self-contained contract (achieve + exact files/seam ' +
  '+ invariant + how to verify ALONE) AND is written knowing its siblings so they never overlap. Set ' +
  '`independent`=true ONLY if the slice shares NO files with any sibling (so it could build in a separate ' +
  'worktree); set `dependsOn` for prerequisites. Big+easy→group near-identical units into 2-5 slices; ' +
  'hard→isolate the risky seam. Never emit one-liner slices, nor a single slice ~= the parent (no reduction). ' +
  'You ALSO own INTERFACE design — you see all siblings, the leaves do not. For each slice set a FIXED ' +
  '`interface` (signatures/types/error mode/access level), coherent and symmetric across siblings. Fix it ONLY ' +
  'when you can see it globally; if genuinely exploratory, set interface="TBD/exploratory". Implementation design stays with the leaf. ' +
  'TIDY-FIRST (Beck — "make the change easy, then make the easy change"): when a behavior change would touch a ' +
  'SCATTERED or awkward seam, FIRST emit a `kind:"tidy"` slice — a behavior-PRESERVING structural prep ' +
  '(rename/extract/generalize/move) that makes the later change easy — ordered BEFORE the behavior slice via ' +
  '`dependsOn`. A tidy slice adds NO new tests and changes NO observable behavior (verified solely by the EXISTING ' +
  'suite staying green). Mark the actual change `kind:"behavior"` (default). Do NOT bundle a mechanical rename ' +
  'with a new-behavior change — separate them so the behavior change stays small and reviewable. ' +
  'EFFICIENCY: for each slice set `atomic` (true = a single directly-executable unit needing NO further slicing) ' +
  'and `riskTier` (light=pure-function/test-only/low-risk, standard=normal, heavy=hard/irreversible/security-sensitive). ' +
  'These let the engine skip a redundant re-assessment of a slice you already sized + risk-judged. ' +
  'COHESION over verbosity: judge by how coherent the work IS, not how many steps the task TEXT lists — a single ' +
  'coherent feature described in many steps is still FEW slices. Do not let a verbose spec inflate the slice count. ' +
  'TEST SCOPE: for each slice set `testScope` — the test suite/class/file its tests will live under (something the ' +
  "project-card filter syntax can target) so the leaf and verifier run the FILTERED command, NEVER the full suite " +
  '(the measured #1 time cost). If genuinely unknowable up front, leave it empty — the leaf derives it from the test it adds. ' +
  'WIRING (the #1 recurring cross-leaf defect: new API lands fully tested but NO production path reaches it): every ' +
  'slice that adds user-reachable capability MUST name, inside its contract, the EXISTING production call site / view / ' +
  'entry point the new code will be invoked from — "wire X into Y at file:line" — and its verify-ALONE step must include ' +
  'checking that call site actually invokes the new code. A slice whose contract cannot name where production calls it ' +
  'is either library-surface API (say so explicitly) or an unwired slice — restructure it.'
const R_EXEC =
  'You are the Executor — where trust is deposited; your inner loop is Canon TDD, ONE test at a time. Follow ' +
  'the repo AGENTS.md / project card literally. The contract\'s `interface` is a FIXED boundary — design only ' +
  'the IMPLEMENTATION behind it. If the interface seems wrong, do NOT change it unilaterally — record ' +
  '`interfaceConcern`. Wear ONE HAT AT A TIME (Beck): (1) BEHAVIOR — call your shot, write the FAILING test ' +
  'FIRST, confirm red for that reason, then make it pass simply. (2) STRUCTURE — refactor is NOT optional: ' +
  'after green either refactor (separate, behavior-preserving) or put in `refactor` WHY none is needed. Never ' +
  'change behavior and structure in one step. If "tests only", do not modify production source dirs — Sources/, ' +
  'src/, lib/, whatever this repo uses (if you must, that is a finding). When sharing a file, ADD cases, never overwrite. New edge cases you notice → `discovered` (do NOT ' +
  'chase them). SEARCH BEFORE YOU WRITE: before implementing anything, grep the codebase for an existing ' +
  'implementation/helper — never assume not-implemented; duplicating an existing seam is a trust withdrawal. ' +
  'TESTS CARRY THEIR WHY: each new test states in a one-line comment the behavioral claim it pins (future ' +
  'agents and the owner will not have your context; a test whose reason is lost gets deleted or neutered later). ' +
  '`passed` MUST reflect a REAL deterministic run (the tier-0 gate): build + the relevant tests ' +
  'actually green — a false green, or one passing against a hardcoded/over-fit impl, is the worst trust ' +
  'withdrawal. SPEED (see LEAF TEST DISCIPLINE below — measured #1 time cost): run ONLY this leaf\'s FILTERED tests + a full BUILD; ' +
  'NEVER the whole test suite — that recompiles+runs all unrelated tests and is reserved for the integration net. ' +
  'ONE-AT-A-TIME (Canon TDD): if this leaf CO-EVOLVES implementation with tests, proceed strictly one test at a ' +
  'time — write ONE failing test, make it pass, then the NEXT (if a pass changes your understanding, revise the ' +
  'remaining list); do NOT write all tests then run once. For test-only additions to ALREADY-STABLE code, ' +
  'batching is fine (the rework risk is ~0 when the impl is frozen). ' +
  'PURPOSE: set `purposeVerified` — did you verify against REAL or RECORDED-REAL behavior (the purpose), or only ' +
  'hand-written fakes/mocks (the prompt)? Prefer recorded-real bytes over hand-fakes — a fake passing proves the prompt, not the feature.'
const R_VERIFY =
  'You are the Verifier / trust auditor. Try to DESTROY trust; assume wrong until proven. Default ' +
  'trustworthy=false. Re-run the relevant measurement YOURSELF (do not trust reported output). Hunt FALSE ' +
  'GREEN: (a) tests that pass WITHOUT exercising the target (vacuous/tautological — read them); (b) an impl ' +
  'hardcoded/over-fit to the test input; (c) anything outside scope silently changed; (d) a baseline invariant ' +
  'violated; (e) any claim you cannot independently confirm; (f) interface drift vs the fixed contract. A wrong ' +
  'confirmation is catastrophic — when uncertain, withhold. SPEED (see LEAF TEST DISCIPLINE — measured #1 time cost): ' +
  'reproduce ONLY the leaf\'s FILTERED tests + a full build, NEVER the whole suite (the integration net runs that once). ' +
  'EXCEPTION: if the prompt states a measurement was ALREADY run deterministically by the engine, JUDGE from that ' +
  'result — do not re-run it; if the prompt explicitly orders a FULL run (integration/merge), run the full suite. ' +
  'The prompt\'s stated measurement scope overrides this default. ' +
  'REPAIR LEVERAGE: if untrustworthy and you can SEE the fix, put the exact minimal fix in `prescription` ' +
  '(file:line + what to change) — precise prescriptions are what make repair converge. Real but non-blocking ' +
  'defects (concrete + independently testable, NOT style nits) go in `followUps` — they spawn follow-up work ' +
  'even when you trust the leaf. ' +
  'PURPOSE: distinguish PROMPT-satisfaction (tests green, non-vacuous) from PURPOSE (the feature actually works ' +
  'for the user). If effectful behavior is exercised ONLY through fakes/mocks, set `purposeGap` naming the ' +
  'real-world behavior that remains UNVERIFIED — and NEVER report fake-green as "it works".'
const R_VERIFY_LIGHT =
  'You are the Verifier in LIGHT mode (low-risk leaf). No full re-run needed, but EARN trust from artifacts: ' +
  'read the actual diff/added tests and confirm they MEANINGFULLY exercise the claim (not vacuous), confirm ' +
  'scope (only intended files — check `git diff`), and confirm the executor reported a real green run. Default ' +
  'trustworthy=false; trust only what the artifacts show. The full suite at integration is the net behind you.'
const R_CRITIC =
  'You are the Completeness Critic (Beck: the test LIST is the step everyone skips). Given a task and a proposed ' +
  'list of slices/scenarios, find what is MISSING — boundary inputs, empty/null, error paths, the one edge case ' +
  'most likely to break trust that nobody listed. Return ONLY genuinely missing, independently-verifiable items ' +
  'with a contract each. Do NOT pad or restate existing items; if complete, return an empty array.'
const R_COORD =
  'You are the Coordinator — the ONLY agent with global context. Independent slices were built in parallel git ' +
  'worktrees (separate branches off the pinned baseline). Merge each branch into the main working branch IN THE ' +
  'GIVEN ORDER with `git merge --no-ff`. Most merges should be clean (slices were partitioned to be ' +
  'independent). For a TRUE conflict, resolve the hunk by HONORING BOTH slices\' stated intent — never silently ' +
  'discard a side\'s work; if genuinely irreconcilable, keep the lower-indexed slice and record the loss as an ' +
  'issue. After ALL merges, run the FULL measure command on the integrated tree; set trustworthy=true ONLY if ' +
  'the whole suite is green AND no slice\'s work was lost. Finally remove the worktrees (`git worktree remove ' +
  '--force <path>`). Report merged branches, conflicts resolved, and any lost work in issues.'

// ---- sh(): deterministic shell escape. The COMMAND is computed in JS (deterministic); the
// agent is reduced to a verbatim `bash -c` proxy with zero latitude. Used for all purely-
// MECHANICAL git (no judgment) so it is not left to a non-deterministic LLM. The sandbox has
// no real exec(); this is the closest approximation — deterministic command, LLM as transport.
const SH = { type: 'object', required: ['exitCode'], properties: { stdout: { type: 'string' }, exitCode: { type: 'integer' } } }
const sh = async (cmd, label) => (await agent(
  `Run EXACTLY this shell command verbatim, then report its stdout and exit code. Do NOT add to, ` +
  `modify, interpret, explain, or run anything besides this one command:\n\n${cmd}`,
  { label: label || 'sh', model: 'sonnet', schema: SH })) || { stdout: '', exitCode: 1 }

// =============================================================================
phase('Baseline')
log(`Task: ${TASK}${PARALLEL ? ' [parallel mode]' : ''}`)
const baseline = await agent(
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
const INV = `Baseline to preserve:\n- ${baseline.invariants.join('\n- ')}\nMeasure: ${baseline.measureCommand}${CARD}${PURPOSE}`

// ④ Leaf test discipline (MEASURED on a real run: re-running the FULL suite at every leaf — recompiling +
// running all unrelated tests — was 68% of shell time and 61% of test runs). The engine DETERMINISTICALLY
// decides where the full command is allowed: FORBIDDEN at a leaf, run ONCE at integration (the net). A leaf
// runs only its FILTERED tests, and is given the scope so it never falls back to the concrete full command.
const LEAF_TEST = scope =>
  `\nLEAF TEST DISCIPLINE (measured #1 time cost): at THIS leaf run ONLY the FILTERED tests — the bare full ` +
  `measure command (\`${baseline.measureCommand}\`) is FORBIDDEN here (it recompiles + runs the whole unrelated ` +
  `suite; it runs ONCE at integration as the net). ` +
  (scope ? `Test scope = \`${scope}\` — run the project-card filter form scoped to it, and NAME the test suite/class you add so this exact token matches it (the engine re-runs this filter as a deterministic gate; a name mismatch = zero tests matched = an untrusted leaf). `
         : `Filter to the test suite/file you add or touch (project-card filter syntax). `) +
  `A full BUILD is fine; a full TEST run is not. Minimize re-runs: red once, green once, post-refactor once — do not re-run unchanged. ` +
  `Never poll or busy-wait on other processes (no pgrep/sleep loops — one such loop once wasted 5 minutes); run your command directly and let the build tool's own lock serialize.`

// Deterministic gitSha — do NOT rely on the LLM baseliner to remember it (it once silently
// didn't, disabling git mode). A fixed `git rev-parse HEAD`, run verbatim, owns this.
const headOut = (await sh(`git -C ${REPO} rev-parse HEAD 2>/dev/null || true`, 'git-sha')).stdout || ''
const BASE_SHA = (headOut.match(/[0-9a-f]{40}/i) || [''])[0]
const GIT = !!BASE_SHA
const gitClean = GIT ? ((await sh(`git -C ${REPO} status --porcelain`, 'git-clean')).stdout || '').trim() === '' : false
const GIT_EXEC = GIT
  ? `\nGit: after GREEN, commit the behavior step (\`git add -A && git commit -m "test: ..."\`); after any ` +
    `refactor, a SEPARATE commit (two hats). Commit ONLY in-scope files. Report SHAs in \`commits\`.`
  : ''
// Leaf verifiers diff from the LEAF's pre-state (not the run baseline): diffing BASE_SHA..HEAD at a
// later leaf includes every SIBLING's committed work and reads as out-of-scope drift (observed live —
// an integrator flagged exactly this confusion). Integration still uses BASE_SHA for the whole deposit.
const gitVerify = (repo, from) => GIT
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
  const gd = ((await sh(`git -C ${REPO} rev-parse --absolute-git-dir`, 'lock-dir')).stdout || '').trim().split('\n').pop()
  if (gd && gd.startsWith('/')) {
    LOCKFILE = `${gd}/rs-lock`
    const held = ((await sh(`cat ${LOCKFILE} 2>/dev/null || true`, 'lock-check')).stdout || '').trim()
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
const verifyLeaf = async (lbl, node, res, tier, repo, leafStart, engineT0, buildNote) => {
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
    return (await agent(
      `${base}\nThis is a TIDY-FIRST leaf: a behavior-PRESERVING structural change. Trust it ONLY if the existing ` +
      `suite is GREEN, NO test was added/changed/deleted, and the diff is a pure structural refactor with NO ` +
      `observable behavior change. Adding tests or changing behavior in a tidy leaf is a FINDING (untrusted).`,
      { phase: 'Work', label: `verify:${lbl}·tidy`, schema: VERDICT }))
      || { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'light') {
    return (await agent(
      `${R_VERIFY_LIGHT}\n\nRepo: ${repo}\nLow-risk leaf: ${node.task}\nReported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ''}${buildNote || ''}`,
      { phase: 'Work', label: `verify:${lbl}·light`, model: 'sonnet', schema: VERDICT }))
      || { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'heavy') {
    const lenses = ['correctness & reproduce the green', 'security: secrets/credentials NEVER logged or leaked', 'interface & cross-module drift']
    const votes = []
    for (let li = 0; li < lenses.length; li++) {                // sequential: safe to nest under parallel groups
      const L = lenses[li]
      // C: the correctness lens runs on a DIFFERENT model — homogeneous consensus re-confirms shared
      // blind spots rather than producing independent evidence; cross-model diversity is cheap
      // independence, spent only where trust is most fragile (heavy leaves).
      const v = await agent(`${base}\nLENS: judge specifically through "${L}".`,
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
  return (await agent(base, { phase: 'Work', label: `verify:${lbl}`, schema: VERDICT }))
    || { trustworthy: false, reason: 'verification unavailable — untrusted' }
}

// ---- runWork: the recursive decomposition+execution loop for ONE work unit, in ONE repo
// (the main checkout, or a group's worktree). Sequential + Canon-TDD discover-as-you-go.
// Returns { done } — the list of leaf results. No integration here (that's the caller's job).
let t0redStreak = 0   // I1 fallback: consecutive engine-RED-vs-executor-green disagreements (run-global, like the template)
const ABORTS = []     // A: units halted by the untrusted-streak guard (surfaced in the final payload)
async function runWork(rootTask, repo, startDepth, gid, cleanOK, kind, buildNote) {
  buildNote = buildNote || ''
  const tag = gid != null ? `g${gid}:` : ''
  const stack = [{ task: rootTask, ctx: '', depth: startDepth, spikes: 0, kind: kind || 'behavior' }]
  const done = []
  const executedKeys = new Set()
  let discovered = 0, untrustedStreak = 0
  const keyOf = s => String(s).trim().slice(0, 120)

  while (stack.length && done.length < MAX_LEAVES) {
    const node = stack.pop()
    const atFloor = node.depth >= FLOOR
    // ② An atomic slice was already sized + risk-judged by the slicer — skip the redundant re-assess.
    let a = null, action
    if (node.atomic) {
      action = 'execute'
    } else {
      a = await agent(
        `${R_ASSESS}\n\nRepo: ${repo}\nTask: ${node.task}\n${node.ctx ? 'Context: ' + node.ctx + '\n' : ''}` +
        `Depth ${node.depth}/${FLOOR}${atFloor ? ' (AT FLOOR — you must return execute)' : ''}.\n${INV}\nClassify and emit the next action.`,
        { phase: 'Work', label: `${tag}assess:d${node.depth}`, model: 'sonnet', schema: ASSESSMENT })
      if (!a) log(`${tag}assess failed [d${node.depth}] — defaulting to execute`)
      action = (atFloor || !a) ? 'execute' : a.action
      if (action === 'spike' && node.spikes >= MAX_SPIKES) action = 'execute'
    }

    if (action === 'slice') {
      const sl = await agent(
        `${R_SLICE}\n\nRepo: ${repo}\nSlice into thin, VERTICAL, independently-verifiable slices with a ` +
        `self-contained contract each. ${a && a.difficulty === 'hard' ? 'Isolate the risky seam first.' : 'Group near-identical units; 2-5 slices.'}` +
        `\nTask: ${node.task}\n${node.ctx}\n${INV}`,
        { phase: 'Work', label: `${tag}slice:d${node.depth}`, schema: SLICES })
      let slices = (sl && sl.slices) || []
      if (slices.length > 1) {
        const crit = await agent(
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
      const learn = await agent(
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
    if (budget.total && budget.remaining() < 120_000) { log(`${tag}budget low — stopping after ${done.length} leaves`); break }
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
    const restore = async () => {
      if (!GIT || !cleanOK || !leafStart) return
      await sh(`git -C ${repo} reset --hard ${leafStart}`, `reset:${lbl}`)
      await sh(`git -C ${repo} clean -fdq -e .rs-wt -e .rs-scratch`, `clean:${lbl}`)   // drop untracked files the leaf created (never the shared build dir)
    }

    let res = null, verdict = null, attempt = 0, prevIssueCount = Infinity
    while (true) {
      const repair = attempt === 0 ? '' :
        `\nREPAIR ATTEMPT ${attempt}: a prior attempt was REJECTED by review for: ` +
        `${JSON.stringify((verdict && verdict.issues && verdict.issues.length ? verdict.issues : [verdict && verdict.reason]).slice(0, 6).map(s => String(s).slice(0, 300)))}. ` +
        (verdict && verdict.prescription ? `\nREVIEWER'S PRESCRIBED FIX (apply exactly unless evidently wrong): ${String(verdict.prescription).slice(0, 1200)}\n` : '') +
        (GIT && cleanOK && leafStart ? `FIRST undo your prior attempt with \`git -C ${repo} reset --hard ${leafStart}\` (sibling commits survive), then re-implement fresh; ` : '') +
        `then fix exactly those objections. In git mode add a fresh commit.`
      res = await agent(
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
        let engineT0 = '', t0red = null
        // No '|' in the whitelist: the scope is substituted UNQUOTED, so '|' would become a shell pipe
        // (exit 127 → false RED). One suite per slice; multi-suite scopes just skip the engine gate.
        const scopeSafe = node.testScope && /^[A-Za-z0-9_.-]+$/.test(String(node.testScope))
        const t0cmd = (node.kind !== 'tidy' && scopeSafe && baseline.filterCommand && baseline.filterCommand.includes('{scope}'))
          ? baseline.filterCommand.replace('{scope}', String(node.testScope)) : ''
        if (t0cmd) {
          // In shared-scratch parallel mode the engine's own filtered run must hit the shared build dir
          // too (assumes the filter template passes appended flags through — documented opt-in).
          const t0 = await sh(`cd ${repo} && ${t0cmd}${(SCRATCH && repo !== REPO) ? ` --scratch-path ${SCRATCH}` : ''}`, `t0:${lbl}`)
          if (t0.exitCode !== 0) {
            t0red = { trustworthy: false, reason: `tier-0 (ENGINE-run filtered tests) RED: \`${t0cmd}\` exited ${t0.exitCode} though the executor reported green`, issues: [`deterministic filtered run failed (exit ${t0.exitCode}); output tail: ${String(t0.stdout || '').slice(-300)}`] }
            // A BROKEN template (env/wrapper/filter-syntax) false-REDs every leaf run-wide. After 2
            // consecutive engine-RED-vs-executor-green disagreements, distrust the TEMPLATE, not the
            // leaves — kill it and fall back to LLM verification (the pre-gate path).
            if (++t0redStreak >= 2) { baseline.filterCommand = ''; log(`${tag}engine t0 disagreed with executor-green ${t0redStreak}× in a row — suspecting a broken filterCommand template; disabling the engine gate (LLM verify takes over)`) }
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
      if (budget.total && budget.remaining() < 120_000) { log(`${tag}budget low — stopping repairs (leaf ${i} stays untrusted → reverted)`); break }
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
    log(`${tag}leaf ${i} ${res.passed ? 'green' : 'RED'} | tier=${tier}${attempt ? ` (repaired×${attempt})` : ''} | ${verdict.trustworthy ? 'trusted' : 'NOT trusted'}: ${node.task.slice(0, 36)}`)

    // An untrusted leaf (incl. a RED/tier-0 leaf with only uncommitted edits) must leave NOTHING behind.
    if (GIT && !verdict.trustworthy) {
      await restore()
      log(`${tag}leaf ${i} untrusted → ${(cleanOK && leafStart) ? `restored to ${leafStart.slice(0, 8)}` : (!leafStart ? 'NOT auto-cleaned (HEAD capture failed — left as-is, flagged for Integrate)' : 'NOT auto-cleaned (dirty main baseline — left to protect your uncommitted work)')}`)
    }

    // A: run-level no-progress detection — leaf-level guards (convergence, repair caps) bound ONE leaf,
    // but nothing detected a run going systemically wrong; N consecutive reverted leaves = stop and
    // surface ("the approach is failing"), don't grind the remaining budget into more reverts.
    untrustedStreak = verdict.trustworthy ? 0 : untrustedStreak + 1
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
    const feed = verdict.trustworthy ? [...(res.discovered || []), ...(verdict.followUps || [])] : []
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
let groups = null
// Parallel also needs a CLEAN main tree — the worktree branches merge into it, and a dirty main makes
// `git merge` abort / risks clobbering the user's uncommitted work.
const goParallel = PARALLEL && GIT && gitClean && (baseline.coldBuildCost !== 'expensive' || FORCE_PARALLEL || SHARED_SCRATCH)
if (PARALLEL && GIT && !goParallel)
  log(`parallel requested but skipped → SEQUENTIAL. Reason: ${!gitClean ? 'main tree is DIRTY (merge would conflict with your work)' : 'coldBuildCost=expensive (compile-bound: worktrees force cold builds → thrashing, slower than sequential-warm; sharedScratch:true to share one build dir, or forceParallel:true to brute-force)'}.`)
// Shared scratch dir for parallel groups on a compile-bound repo. Lives in the MAIN repo (worktree
// leaf-cleans run inside their own worktree and cannot touch it; main-repo cleans exclude it).
const SCRATCH = (goParallel && SHARED_SCRATCH) ? `${REPO}/.rs-scratch` : ''
const buildNoteFor = repo => (SCRATCH && repo !== REPO)
  ? `\nSHARED BUILD DIRECTORY (mandatory): append \`--scratch-path ${SCRATCH}\` to EVERY build/test invocation ` +
    `(SwiftPM passes it through its wrappers; Cargo's equivalent is CARGO_TARGET_DIR; other builders have their ` +
    `own shared-build-dir mechanism — use this project's equivalent). The parallel worktrees share that ONE build dir so ` +
    `dependencies compile once; builds serialize on its lock (expected — do not work around it); NEVER delete it.`
  : ''
if (goParallel) {
  const a0 = await agent(
    `${R_ASSESS}\n\nRepo: ${REPO}\nTask: ${TASK}\nDepth 0/${FLOOR}.\n${INV}\nClassify and emit the next action.`,
    { phase: 'Plan', model: 'sonnet', schema: ASSESSMENT })
  if (a0 && a0.action === 'slice') {
    const sl = await agent(
      `${R_SLICE}\n\nRepo: ${REPO}\nThis is the PARALLEL PARTITION — NOT fine slicing. Each group you emit becomes ` +
      `its OWN git worktree with its OWN full (cold) build, so every extra group costs a whole build. Therefore ` +
      `produce the FEWEST, COARSEST groups: ONE per LARGEST independent unit (a whole feature/module/file-set that ` +
      `shares NO files — including manifests (Package.swift / Cargo.toml / package.json / pom.xml) — with any sibling). Aim for 2-3 groups; NEVER split ` +
      `one coherent feature into multiple groups — its fine-grained, one-test-at-a-time decomposition happens INSIDE ` +
      `the group later (cheap, warm builds). Over-splitting here forces redundant cold builds and is the dominant ` +
      `cost. Mark \`independent\`=true only for a group that truly shares no files with any sibling.\nTask: ${TASK}\n${INV}`,
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
let done = []
let merge = null
if (groups) {
  // 1) One git worktree+branch per independent group, off the pinned baseline.
  //    DETERMINISTIC: paths + commands are computed in JS; sh() runs them verbatim (no LLM latitude).
  const N = groups.indep.length
  const wtPaths = groups.indep.map((_, i) => `${REPO}/.rs-wt/g${i}`)
  // Two-PHASE cleanup so `branch -D` is never blocked by a still-registered worktree (the cause of
  // a leaked rs/g* branch + empty .rs-wt/ seen in testing): remove ALL worktrees, prune the
  // registry, THEN delete the branches, THEN drop the now-empty .rs-wt/ parent. Leave nothing behind.
  const clearWorktrees = async (label) => {
    for (let i = 0; i < N; i++) await sh(`git -C ${REPO} worktree remove --force ${wtPaths[i]} 2>/dev/null; true`, `${label}-rm:${i}`)
    await sh(`git -C ${REPO} worktree prune`, `${label}-prune`)
    for (let i = 0; i < N; i++) await sh(`git -C ${REPO} branch -D rs/g${i} 2>/dev/null; true`, `${label}-br:${i}`)
    await sh(`rm -rf ${REPO}/.rs-wt 2>/dev/null; true`, `${label}-rmdir`)
  }
  await clearWorktrees('wt-pre')   // clear any stale worktrees/branches left by a previous run
  const paths = {}
  for (let i = 0; i < N; i++) {
    const r = await sh(`git -C ${REPO} worktree add -b rs/g${i} ${wtPaths[i]} ${BASE_SHA}`, `wt-add:${i}`)
    if (r.exitCode === 0) paths[i] = wtPaths[i]
    else log(`worktree g${i} setup failed (exit ${r.exitCode})`)
  }

  // 2) Build independent groups in PARALLEL, capped at MAX_WORKERS (batched). Within a group: sequential + feedback.
  const built = []
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
  let conflicts = 0
  for (let i = 0; i < N; i++) {
    if (paths[i] == null) continue                              // group never built — nothing to merge
    const m = await sh(`git -C ${REPO} merge --no-ff --no-edit rs/g${i}`, `merge:${i}`)
    if (m.exitCode !== 0) {                                     // conflict/error → LLM judgment for THIS branch only
      conflicts++
      await agent(
        `${R_COORD}\n\nRepo: ${REPO}\nThe deterministic \`git -C ${REPO} merge --no-ff rs/g${i}\` FAILED (conflict). ` +
        `Resolve ONLY this branch's conflict (slice "${groups.indep[i].desc}"), honoring both sides' intent, complete ` +
        `the merge commit, then confirm the tree builds.\n${INV}`,
        { phase: 'Coordinate', label: `merge-conflict:${i}`, schema: VERDICT })
    }
  }
  // Deterministic merge net (mirrors the Integrate gate): the engine runs the full measure command
  // via sh() — shell truth — and the LLM JUDGES from that result instead of re-running it.
  const mergeRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'merge-fullsuite')
  merge = await agent(
    `${R_VERIFY}\n\nRepo: ${REPO}\n${N} parallel branches were merged into the working branch (${conflicts} needed ` +
    `conflict resolution). The FULL measure command was JUST run DETERMINISTICALLY with exit=${mergeRun.exitCode} ` +
    `(${mergeRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run it; JUDGE from that result whether every baseline ` +
    `invariant holds and NO slice's work was lost.\n${INV}`,
    { phase: 'Coordinate', label: 'merge-verify', schema: VERDICT })
  log(`coordinator: merged ${N} branches (${conflicts} conflicts) — ${merge && merge.trustworthy ? 'OK' : 'ISSUES'}`)
  await clearWorktrees('wt-post')   // unconditional two-phase cleanup — no leaked worktrees/branches/.rs-wt

  // 4) Dependent groups run on main AFTER the merge (so they see integrated independent work),
  //    ordered by dependsOn (prerequisites first; cycle/odd-dep → emission order).
  const all = groups.all, seq = groups.seq
  const idxOf = s => all.indexOf(s), inSeq = new Set(seq.map(idxOf))
  const seqOrdered = [], placed = new Set()
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
let finalRun = { exitCode: -1, stdout: '' }
let integration = null
try {
  finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'integrate-fullsuite')
  if (finalRun.exitCode === 137) {
    // Known fragile-suite timeout class (watchdog kill): one DETERMINISTIC retry — this used to be
    // per-task prompt boilerplate ("retry once before judging"); the engine owns it now.
    log('integrate full suite timed out (exit 137) — one automatic retry (known flake class)')
    finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, 'integrate-fullsuite-retry')
  }
  if (finalRun.exitCode !== 0) log(`⚠ FULL SUITE RED at integration (exit ${finalRun.exitCode}) — a leaf regression may have escaped its filter (④); the LLM integrator will attribute.`)
  integration = await agent(
    `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
    `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
    `suite; JUDGE from that result whether every invariant still holds across the integrated whole` +
    `${finalRun.exitCode === 0 ? '' : ' (it is RED — identify which leaf/area most likely regressed)'}.\n${INV}` +
    (GIT ? `\nAlso summarize the cumulative trust deposit (\`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`) and confirm no out-of-scope file changed since baseline.` : '') +
    `\nPURPOSE (①, Beck): the tests are green (the PROMPT) — but does the work actually WORK for the user (the ` +
    `PURPOSE)? If effectful behavior was exercised only via fakes/mocks, set \`purposeGap\` naming exactly what ` +
    `real-world behavior remains UNVERIFIED and how to close it (live test / human action). Never present fake-green as "it works".`,
    { phase: 'Integrate', schema: VERDICT })
  if (!integration) {
    log('integration agent unavailable (API error) — one retry')
    integration = await agent(
      `${R_VERIFY}\n\nRepo: ${REPO}\nAll work is done. The FULL baseline measure command was JUST run ` +
      `DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? 'GREEN' : 'RED'}) — do NOT re-run the whole ` +
      `suite; JUDGE from that result whether every invariant still holds across the integrated whole.\n${INV}`,
      { phase: 'Integrate', label: 'integration-retry', schema: VERDICT })
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
let wiringGaps = []
if (GIT && trusted.length) {
  try {
    const newPub = await sh(
      `cd ${REPO} && git diff ${BASE_SHA}..HEAD -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null | ` +
      `grep -E '^\\+[^+].*\\b(public|open|export|pub)\\b.*\\b(func|fn|function|var|let|class|struct|enum|const)\\b' | ` +
      `sed -E 's/^\\+\\s*//' | head -40`, 'wiring-scan')
    const symbols = (newPub.stdout || '').trim()
    if (symbols) {
      const w = await agent(
        `You are the WIRING auditor. This run added the following NEW exported declarations to ${REPO} ` +
        `(extracted from \`git diff ${BASE_SHA.slice(0, 8)}..HEAD\`, test files excluded):\n${symbols}\n\n` +
        `For each, grep the PRODUCTION code (exclude test directories) for actual call/use sites. ` +
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
  ...done.map(d => d.verdict && d.verdict.purposeGap).filter(Boolean),
  // the executor's own honest admission becomes a gap even if the verifier omitted one
  ...done.filter(d => d.purposeVerified === false && !(d.verdict && d.verdict.purposeGap)).map(d => `leaf verified only via fakes/mocks (purposeVerified=false): ${String(d.task).slice(0, 60)}`),
  ...((integration && integration.purposeGap) ? [integration.purposeGap] : []),
]
// B: Owner's Briefing — comprehension debt is the one thing the loop cannot repay (the owner must READ
// what landed, or they own a codebase they can't debug or steer). The ledger already holds the raw
// material (decisions, concerns, gaps, tangents); one agent turns it into a cheap GUIDED read instead
// of an unaided archaeology dig. Failure here never blocks the run (try/catch, payload survives).
let briefing = null
if (trusted.length) {
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
    briefing = await agent(
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
    if (!briefing) {
      log('owner-briefing agent unavailable (API error) — one retry')
      briefing = await agent(
        `You are the Comprehension Steward. Turn this run's ledger into a GUIDED READ (~10-15 min) for the ` +
        `owner: reading order (files, commits, why), decisions made for them, buried bodies, and what to ` +
        `verify by hand. Repo: ${REPO}.` + (GIT ? ` Run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` first.` : '') +
        `\nLedger: ${JSON.stringify(ledgerForBriefing).slice(0, 6000)}\nMatch the language the task was written in. Be concrete.`,
        { phase: 'Integrate', label: 'owner-briefing-retry', schema: BRIEFING })
    }
  } catch (e) { log(`owner-briefing skipped (budget/API): ${e && e.message ? e.message : e}`) }
}

if (LOCKFILE) { try { await sh(`rm -f ${LOCKFILE}`, 'lock-clear') } catch (e) { log(`lock-clear failed (budget ceiling?) — stale lock left at ${LOCKFILE}; remove it before the next run.`) } }
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
