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

// src/schemas.ts
var BASELINE = { type: "object", required: ["invariants", "measureCommand"], properties: {
  summary: { type: "string" },
  invariants: { type: "array", items: { type: "string" } },
  // falsifiable things that must stay true
  measureCommand: { type: "string" },
  // exact green/red command
  filterCommand: { type: "string" },
  // I1: filtered-test TEMPLATE containing literal "{scope}" (e.g. "./scripts/test.sh --filter {scope}") — the engine substitutes a suite name and runs it verbatim as a deterministic per-leaf gate; empty if the runner cannot filter
  currentState: { type: "string" },
  // pass/fail counts as observed now
  projectCard: { type: "string" },
  // distilled STATIC repo conventions shared to all workers
  coldBuildCost: { type: "string", enum: ["cheap", "expensive"] },
  // would a FRESH worktree's first build be cheap (interpreted/no-build/shared-cache) or expensive (compiled lang, per-checkout dependency compile)?
  purposeCheck: { type: "string" },
  // ① how to verify the work ACTUALLY works for the user (PURPOSE) beyond unit tests — e.g. a live integration test / a human action
  inProcessVerifiable: { type: "boolean" },
  // ① can that purpose be verified deterministically in-process (pure logic / recorded-real bytes), or does it need a real env / human?
  worktreeSetupCommand: { type: "string" }
  // E: shell command run ONCE per parallel git-worktree immediately after creation (e.g. 'npm ci'); empty/absent = no setup needed
} };
var ASSESSMENT = { type: "object", required: ["difficulty", "action", "reason"], properties: {
  difficulty: { type: "string", enum: ["easy", "hard"] },
  size: { type: "string", enum: ["small", "big"] },
  action: { type: "string", enum: ["execute", "slice", "spike"] },
  reason: { type: "string" }
} };
var SLICES = { type: "object", required: ["slices"], properties: {
  slices: { type: "array", items: { type: "object", required: ["desc", "interface", "contract"], properties: {
    desc: { type: "string" },
    // one-line what
    interface: { type: "string" },
    // FIXED public surface — or "TBD/exploratory"
    contract: { type: "string" },
    // achieve + seam/files + invariant + how to verify ALONE
    independent: { type: "boolean" },
    // safe to build concurrently (no shared files)?
    dependsOn: { type: "array", items: { type: "integer" } },
    // indices of prerequisite slices
    kind: { type: "string", enum: ["tidy", "behavior"] },
    // ③ Tidy-First: 'tidy' = behavior-PRESERVING structural prep (verified by existing suite, no new tests); 'behavior' = the actual change
    atomic: { type: "boolean" },
    // ② true = a single directly-executable unit (skip the redundant re-assess); false = still decompose
    riskTier: { type: "string", enum: ["light", "standard", "heavy"] },
    // ② slicer's risk judgment → verification tier (used when atomic, so no re-assess needed)
    testScope: { type: "string" }
    // ④ the test suite/filter this slice's tests live under → leaf+verifier run FILTERED (not the full suite — the MEASURED #1 time cost)
  } } }
} };
var LEARNING = { type: "object", required: ["summary"], properties: {
  summary: { type: "string" }
} };
var RESULT = { type: "object", required: ["summary", "passed", "evidence"], properties: {
  summary: { type: "string" },
  passed: { type: "boolean" },
  // passed = DETERMINISTIC shell result (build+tests), the tier-0 gate
  evidence: { type: "string" },
  // what you ran and what you observed — the shell command + output tail that proves green/red
  filesChanged: { type: "array", items: { type: "string" } },
  refactor: { type: "string" },
  // structure hat: what was tidied after green, or why none needed
  funList: { type: "array", items: { type: "string" } },
  // tangents noticed, NOT chased (do not act on these — just list them)
  discovered: { type: "array", items: { type: "string" } },
  // NEW test-list scenarios found mid-work → fed back (Canon TDD)
  commits: { type: "array", items: { type: "string" } },
  // git mode: SHAs created (behavior commit, then refactor commit)
  interfaceConcern: { type: "string" },
  // if the FIXED interface seemed wrong — reported up, NOT changed
  purposeVerified: { type: "boolean" }
  // ① did this verify against REAL/recorded-real behavior (purpose), or only hand-fakes/mocks (prompt only)?
} };
var VERDICT = { type: "object", required: ["trustworthy", "reason"], properties: {
  trustworthy: { type: "boolean" },
  issues: { type: "array", items: { type: "string" } },
  reason: { type: "string" },
  purposeGap: { type: "string" },
  // ① real-user behavior the tests do NOT verify (e.g. only fakes used) — prompt satisfied ≠ purpose served
  prescription: { type: "string" },
  // I3: when untrustworthy and the fix is VISIBLE — the exact minimal fix (file:line + change); a precise prescription is what makes repair converge (proven live)
  followUps: { type: "array", items: { type: "string" } }
  // I4: concrete, independently-testable defects worth a follow-up leaf even when trustworthy=true (NOT style nits) — fed into the discovered batch
} };
var MISSING = { type: "object", required: ["missing"], properties: {
  missing: { type: "array", items: { type: "object", required: ["desc", "contract"], properties: {
    desc: { type: "string" },
    contract: { type: "string" }
  } } }
} };
var BRIEFING = { type: "object", required: ["briefing"], properties: {
  briefing: { type: "string" }
  // B: markdown owner's reading guide (comprehension-debt repayment aid)
} };

// src/prompts.ts
var R_BASELINE = 'You are the Baseliner (Beck: Baseline Measurement). Capture ground truth BEFORE any change. Read the repo AGENTS.md/CLAUDE.md for EXACT build/test commands; never guess. State falsifiable invariants this work must preserve (a FLOOR, not an exact match: adding new green tests is fine; an existing green test going red is a violation). Never fabricate a green result. (The engine captures the git SHA / clean-tree state deterministically itself — spend no effort on git state.) CARD: distill a `projectCard` of STATIC facts every worker needs so none re-reads AGENTS.md — exact build/test commands (record the FASTEST safe form: filter syntax + parallel flag like `swift test --parallel` if supported), test framework, conventions, hard constraints (pinned deps, secrets-never-logged, forbidden APIs). Select sources deterministically; skip generated/vendored/huge files. Tight but complete. FILTER: set `filterCommand` = the runner\'s filtered-test command as a TEMPLATE containing the literal token {scope} (e.g. "./scripts/test.sh --filter {scope}"); the engine substitutes a suite name and runs it VERBATIM as a deterministic per-leaf gate, so it must work from the repo root exactly as written. Empty ONLY if the runner truly cannot filter. BUILD COST: set `coldBuildCost` — would a FRESH checkout (a new git worktree, empty build dir) need an EXPENSIVE full dependency compile (a compiled language — Swift/Rust/C++/Go/etc. — whose deps recompile per checkout, with no shared/global cache a worktree reuses) → "expensive"; or is it CHEAP (interpreted / no build step / a shared cache a worktree reuses) → "cheap"? This gates whether parallel git-worktree builds are worthwhile or just thrash. PURPOSE (Beck — genies satisfy prompts, not purposes): set `purposeCheck` — beyond unit tests, how would one confirm this ACTUALLY works for the user? e.g. "run the env-gated live integration test", "a human marks a message unread in the app and confirms the server updated". Set `inProcessVerifiable` = can that be checked deterministically in-process (pure logic / recorded-REAL bytes) or does it need a real environment / human? WORKTREE SETUP: set `worktreeSetupCommand` = the shell command that must run ONCE in each parallel git-worktree right after it is created (e.g. "npm ci" to install deps into the fresh checkout). Leave empty or absent if no per-worktree setup is needed (interpreted language with no install step, or a shared-cache build dir that is already populated). This command runs verbatim in each worktree before any leaf work begins.';
var R_ASSESS = "You are the Assessor — the recursion termination condition. Bias HARD toward execute; over-decomposition is the dominant failure. Judge two orthogonal axes with file:line evidence: difficulty(easy=known/low-risk, hard=unknown/irreversible) × size(small=~one place, big=many places or many near-identical units). Table: easy+small→execute, hard+small→spike, *+big→slice. At/over the depth floor you MUST return execute. A confident wrong call is the costliest output.";
var R_SLICE = 'You are the Slicer (Beck: Slicing, Symmetry, Isolation). Cut into THIN, VERTICAL, independently-verifiable slices — NEVER by horizontal layer. The hard rule: if a slice cannot be verified ALONE it is wrong; restructure the seams until it can. Each slice carries a self-contained contract (achieve + exact files/seam + invariant + how to verify ALONE) AND is written knowing its siblings so they never overlap. Set `independent`=true ONLY if the slice shares NO files with any sibling AND has no `dependsOn` prerequisites (both conditions required: a dependent slice cannot build in isolation even if file-disjoint). Note: when this role is called as the PARTITION planner for a parallel build, the caller\'s prompt overrides the strict "NO files" rule — light additive overlap is allowed there (see that prompt). Big+easy→group near-identical units into 2-5 slices; hard→isolate the risky seam. Never emit one-liner slices, nor a single slice ~= the parent (no reduction). You ALSO own INTERFACE design — you see all siblings, the leaves do not. For each slice set a FIXED `interface` (signatures/types/error mode/access level), coherent and symmetric across siblings. Fix it ONLY when you can see it globally; if genuinely exploratory, set interface="TBD/exploratory". Implementation design stays with the leaf. TIDY-FIRST (Beck — "make the change easy, then make the easy change"): when a behavior change would touch a SCATTERED or awkward seam, FIRST emit a `kind:"tidy"` slice — a behavior-PRESERVING structural prep (rename/extract/generalize/move) that makes the later change easy — ordered BEFORE the behavior slice via `dependsOn`. A tidy slice adds NO new tests and changes NO observable behavior (verified solely by the EXISTING suite staying green). Mark the actual change `kind:"behavior"` (default). Do NOT bundle a mechanical rename with a new-behavior change — separate them so the behavior change stays small and reviewable. EFFICIENCY: for each slice set `atomic` (true = a single directly-executable unit needing NO further slicing) and `riskTier` (light=pure-function/test-only/low-risk, standard=normal, heavy=hard/irreversible/security-sensitive). These let the engine skip a redundant re-assessment of a slice you already sized + risk-judged. COHESION over verbosity: judge by how coherent the work IS, not how many steps the task TEXT lists — a single coherent feature described in many steps is still FEW slices. Do not let a verbose spec inflate the slice count. TEST SCOPE: for each slice set `testScope` — the test suite/class/file its tests will live under (something the project-card filter syntax can target) so the leaf and verifier run the FILTERED command, NEVER the full suite (the measured #1 time cost). If genuinely unknowable up front, leave it empty — the leaf derives it from the test it adds. WIRING (the #1 recurring cross-leaf defect: new API lands fully tested but NO production path reaches it): every slice that adds user-reachable capability MUST name, inside its contract, the EXISTING production call site / view / entry point the new code will be invoked from — "wire X into Y at file:line" — and its verify-ALONE step must include checking that call site actually invokes the new code. A slice whose contract cannot name where production calls it is either library-surface API (say so explicitly) or an unwired slice — restructure it.';
var R_EXEC = 'You are the Executor — where trust is deposited; your inner loop is Canon TDD, ONE test at a time. Follow the repo AGENTS.md / project card literally. The contract\'s `interface` is a FIXED boundary — design only the IMPLEMENTATION behind it. If the interface seems wrong, do NOT change it unilaterally — record `interfaceConcern`. Wear ONE HAT AT A TIME (Beck): (1) BEHAVIOR — call your shot, write the FAILING test FIRST, confirm red for that reason, then make it pass simply. (2) STRUCTURE — refactor is NOT optional: after green either refactor (separate, behavior-preserving) or put in `refactor` WHY none is needed. Never change behavior and structure in one step. If "tests only", do not modify production source dirs — Sources/, src/, lib/, whatever this repo uses (if you must, that is a finding). When sharing a file, ADD cases, never overwrite. New edge cases you notice → `discovered` (do NOT chase them). SEARCH BEFORE YOU WRITE: before implementing anything, grep the codebase for an existing implementation/helper — never assume not-implemented; duplicating an existing seam is a trust withdrawal. INSPECT WITH NATIVE TOOLS: use the Read/Grep/Glob tools, NOT shell cat/grep/sed/find/head — every shell inspect is a spawn+permission round-trip and is the measured #1 hidden time cost (it dwarfs test runs). Reserve Bash for builds/tests/git only. TESTS CARRY THEIR WHY: each new test states in a one-line comment the behavioral claim it pins (future agents and the owner will not have your context; a test whose reason is lost gets deleted or neutered later). `passed` MUST reflect a REAL deterministic run (the tier-0 gate): build + the relevant tests actually green — a false green, or one passing against a hardcoded/over-fit impl, is the worst trust withdrawal. SPEED: see LEAF TEST DISCIPLINE below. ONE-AT-A-TIME (Canon TDD): if this leaf CO-EVOLVES implementation with tests, proceed strictly one test at a time — write ONE failing test, make it pass, then the NEXT (if a pass changes your understanding, revise the remaining list); do NOT write all tests then run once. For test-only additions to ALREADY-STABLE code, batching is fine (the rework risk is ~0 when the impl is frozen). PURPOSE: set `purposeVerified` — did you verify against REAL or RECORDED-REAL behavior (the purpose), or only hand-written fakes/mocks (the prompt)? Prefer recorded-real bytes over hand-fakes — a fake passing proves the prompt, not the feature. `evidence`: the shell command you ran and the output tail that proves it — concrete, copy-pasteable. `funList`: tangents you noticed but did NOT chase — list them so the owner is aware; do NOT act on them here.';
var R_VERIFY = 'You are the Verifier / trust auditor. Try to DESTROY trust; assume wrong until proven. Default trustworthy=false. Re-run the relevant measurement YOURSELF (do not trust reported output). Hunt FALSE GREEN: (a) tests that pass WITHOUT exercising the target (vacuous/tautological — read them); (b) an impl hardcoded/over-fit to the test input; (c) anything outside scope silently changed; (d) a baseline invariant violated; (e) any claim you cannot independently confirm; (f) interface drift vs the fixed contract. A wrong confirmation is catastrophic — when uncertain, withhold. INSPECT WITH NATIVE TOOLS: read the diff/tests/seam with the Read/Grep/Glob tools, NOT shell cat/grep/sed — shell inspect is the measured #1 hidden cost (the verifier spends most of its budget RE-DISCOVERING what the executor already established; any ENGINE-DIFF/ENGINE-RAN block in this prompt is that material — use it instead of re-greping). Reserve Bash for re-running builds/tests/git. SPEED (see LEAF TEST DISCIPLINE — measured #1 time cost): reproduce ONLY the leaf\'s FILTERED tests + a full build, NEVER the whole suite (the integration net runs that once). EXCEPTION: if the prompt states a measurement was ALREADY run deterministically by the engine (ENGINE-RAN), JUDGE from that result — do not re-run it. REPAIR LEVERAGE: if untrustworthy and you can SEE the fix, put the exact minimal fix in `prescription` (file:line + what to change) — precise prescriptions are what make repair converge. Real but non-blocking defects (concrete + independently testable, NOT style nits) go in `followUps` — they spawn follow-up work even when you trust the leaf. PURPOSE: distinguish PROMPT-satisfaction (tests green, non-vacuous) from PURPOSE (the feature actually works for the user). If effectful behavior is exercised ONLY through fakes/mocks, set `purposeGap` naming the real-world behavior that remains UNVERIFIED and how to close it (live test / human action) — and NEVER report fake-green as "it works".';
var R_VERIFY_LIGHT = "You are the Verifier in LIGHT mode (low-risk leaf). No full re-run needed, but EARN trust from artifacts: read the actual diff/added tests and confirm they MEANINGFULLY exercise the claim (not vacuous), confirm scope (only intended files — check `git diff`), and confirm the executor reported a real green run. Default trustworthy=false; trust only what the artifacts show. The full suite at integration is the net behind you.";
var R_CRITIC = "You are the Completeness Critic (Beck: the test LIST is the step everyone skips). Given a task and a proposed list of slices/scenarios, find what is MISSING — boundary inputs, empty/null, error paths, the one edge case most likely to break trust that nobody listed. Return ONLY genuinely missing, independently-verifiable items with a contract each. Do NOT pad or restate existing items; if complete, return an empty array.";
var R_COORD = "You are the Coordinator — the ONLY agent with global context. A conflict has occurred merging one branch of a parallel build. Resolve the hunk by HONORING BOTH slices' stated intent — never silently discard a side's work; if genuinely irreconcilable, keep the lower-indexed slice and record the loss as an issue. Report the conflict resolved and any lost work in issues.";

// src/main.ts
async function __main() {
  let QUOTA_HALT = "";
  let NULL_STREAK = 0;
  let NULL_STREAK_CLASSES = /* @__PURE__ */ new Set();
  const callClass = (opts) => (opts && (opts.label || opts.phase) || "").replace(/[:·].*/u, "").trim() || "unknown";
  const quotaHalt = (why) => {
    QUOTA_HALT = why;
    log(`⛔ QUOTA HALT: ${why} — no further agents will be spawned; relaunch with resumeFromRunId after the cause clears (limit reset / model switch) — cached leaves replay free.`);
  };
  const bumpNullStreak = (opts) => {
    NULL_STREAK++;
    NULL_STREAK_CLASSES.add(callClass(opts));
    if (NULL_STREAK >= 3 && NULL_STREAK_CLASSES.size >= 2) quotaHalt(`${NULL_STREAK} consecutive agent failures (API/session quota suspected)`);
  };
  const agentSafe = async (prompt, opts) => {
    if (QUOTA_HALT) {
      log(`agent skipped (quota halt): ${opts && (opts.label || opts.phase) || ""}`);
      return null;
    }
    try {
      const r = await agent(prompt, opts);
      if (r === null) {
        bumpNullStreak(opts);
      } else {
        NULL_STREAK = 0;
        NULL_STREAK_CLASSES = /* @__PURE__ */ new Set();
      }
      return r;
    } catch (e) {
      const m = String(e && e.message || e);
      if (/budget|ceiling/i.test(m)) throw e;
      if (/session limit|rate.?limit|quota|too many requests|overloaded|credit/i.test(m)) {
        quotaHalt(m.slice(0, 120));
        return null;
      }
      if (/issue with the selected model|may not have access to it|selected model.*may not exist/i.test(m)) {
        quotaHalt(`model unavailable to subagents (verify/integrate/briefing inherit the session model): ${m.slice(0, 90)}`);
        return null;
      }
      log(`agent threw (treated as null): ${m.slice(0, 140)}`);
      bumpNullStreak(opts);
      return null;
    }
  };
  const A = typeof args === "string" ? JSON.parse(args) : args || {};
  if (!A.task) {
    log("FATAL: no task in args — refusing to run. (Resuming? Pass the ORIGINAL args alongside resumeFromRunId.)");
    return { error: "no task provided — pass args.task (a resume must pass the original args)" };
  }
  const TASK = A.task;
  const REPO = A.repo || ".";
  const FLOOR = A.maxDepth || 3;
  const PARALLEL = A.parallel === true;
  const FORCE_PARALLEL = A.forceParallel === true;
  const SHARED_SCRATCH = A.sharedScratch === true;
  const MAX_LEAVES = 24;
  const MAX_DISCOVERED = 8;
  const MAX_SPIKES = 1;
  const MAX_REPAIR = 1;
  const MAX_REPAIR_HARD = 3;
  const MAX_WORKERS = 4;
  const MAX_UNTRUSTED_STREAK = 3;
  const SH_UNAVAILABLE = { exitCode: -2, stdout: "\0SH_UNAVAILABLE" };
  const shUnavailable = (r) => r === SH_UNAVAILABLE || !!r && r.exitCode === -2 && String(r.stdout).startsWith("\0SH_UNAVAILABLE");
  const SH = { type: "object", required: ["exitCode"], properties: { stdout: { type: "string" }, exitCode: { type: "integer" } } };
  const sh = async (cmd, label) => {
    const r = await agentSafe(
      `Run EXACTLY this shell command verbatim, then report its stdout and exit code. Do NOT add to, modify, interpret, explain, or run anything besides this one command:

${cmd}`,
      { label: label || "sh", model: "haiku", schema: SH }
    );
    return r ?? SH_UNAVAILABLE;
  };
  const shForce = async (cmd, label) => {
    try {
      const r = await agent(
        `Run EXACTLY this shell command verbatim, then report its stdout and exit code. Do NOT add to, modify, interpret, explain, or run anything besides this one command:

${cmd}`,
        { label: label || "sh-force", model: "haiku", schema: SH }
      );
      return r ?? SH_UNAVAILABLE;
    } catch (e) {
      log(`shForce failed (${label || "sh-force"}): ${String(e && e.message || e).slice(0, 120)}`);
      return SH_UNAVAILABLE;
    }
  };
  phase("Baseline");
  log(`Task: ${TASK}${PARALLEL ? " [parallel mode]" : ""}`);
  const baseline = await agentSafe(
    `${R_BASELINE}

Repo: ${REPO}
Upcoming work: "${TASK}"
Establish the trust invariant BEFORE any change. Find the measurement command, run it once, and distill the project card.`,
    { phase: "Baseline", model: "sonnet", schema: BASELINE }
  );
  if (!baseline) {
    log("FATAL: baseline agent returned no result (API/rate-limit) — aborting before any change.");
    return { error: "baseline failed", task: TASK };
  }
  log(`Baseline: ${baseline.currentState} | measure: ${baseline.measureCommand}`);
  const CARD = baseline.projectCard ? `
Project card (authoritative repo conventions — use instead of re-reading AGENTS.md unless insufficient):
${baseline.projectCard}` : "";
  const PURPOSE = baseline.purposeCheck ? `
Purpose (does it ACTUALLY work for the user, not just the tests?): ${baseline.purposeCheck}${baseline.inProcessVerifiable === false ? " [NOT verifiable in-process — needs a real env / human; a purposeGap is expected]" : ""}` : "";
  const SKILL_PATHS = (Array.isArray(A.skills) ? A.skills : []).filter((s) => typeof s === "string" && !!s.trim()).slice(0, 8);
  const SKILLS_NOTE = SKILL_PATHS.length ? `
DOMAIN GUIDANCE (part of the contract): RELEVANCE GATE first — match each guide's domain (visible in its path/name) against YOUR contract's files and topic, and SKIP entirely (do not read even its index) any guide whose domain clearly does not apply to this leaf (e.g. a frontend guide on a backend-only leaf). For the guides that DO apply: Read them — house style / best-practice rules the owner expects. Follow their progressive disclosure: read the index/SKILL.md, then only the rule files relevant to YOUR change.
- ${SKILL_PATHS.join("\n- ")}
Executors apply them; verifiers treat clear violations as issues (a skipped non-matching guide is never a violation). On conflict, the repo's own established conventions win.` : "";
  const INV = `Baseline to preserve:
- ${baseline.invariants.join("\n- ")}
Measure: ${baseline.measureCommand}${CARD}${PURPOSE}${SKILLS_NOTE}`;
  const LEAF_TEST = (scope) => `
LEAF TEST DISCIPLINE (measured #1 time cost): at THIS leaf run ONLY the FILTERED tests — the bare full measure command (\`${baseline.measureCommand}\`) is FORBIDDEN here (it recompiles + runs the whole unrelated suite; it runs ONCE at integration as the net). ` + (scope ? `Test scope = \`${scope}\` — run the project-card filter form scoped to it, and NAME the test suite/class you add so this exact token matches it (the engine re-runs this filter as a deterministic gate; a name mismatch = zero tests matched = an untrusted leaf). ` : `Filter to the test suite/file you add or touch (project-card filter syntax). `) + `A full BUILD is fine; a full TEST run is not. STATIC CHECKS (lint/typecheck) follow the same rule: scope them to the files you changed when the toolchain supports it (e.g. lint only changed paths; rely on the typechecker's incremental cache) — a WHOLE-PROJECT lint/typecheck belongs to the integration net, not to every edit. Minimize re-runs: red once, green once, post-refactor once — do not re-run an unchanged check. Never poll or busy-wait on other processes (no pgrep/sleep loops — one such loop once wasted 5 minutes); run your command directly and let the build tool's own lock serialize.`;
  const headR = await sh(`git -C ${REPO} rev-parse HEAD 2>/dev/null || true`, "git-sha");
  if (shUnavailable(headR)) {
    log("FATAL: shell-proxy agent returned no result for git-sha capture — cannot determine git state; aborting.");
    return { error: "shell-proxy unavailable at git-sha decision point", task: TASK };
  }
  const headOut = headR.stdout || "";
  const BASE_SHA = (headOut.match(/[0-9a-f]{40}/i) || [""])[0];
  const GIT = !!BASE_SHA;
  const gitCleanR = GIT ? await sh(`git -C ${REPO} status --porcelain`, "git-clean") : null;
  if (gitCleanR && shUnavailable(gitCleanR)) {
    log("FATAL: shell-proxy agent returned no result for git-clean capture — cannot determine working tree state; aborting.");
    return { error: "shell-proxy unavailable at git-clean decision point", task: TASK };
  }
  const gitClean = GIT ? (gitCleanR.stdout || "").trim() === "" : false;
  const GIT_EXEC = GIT ? `
Git: after GREEN, commit the behavior step (\`git add -A && git commit -m "test: ..."\`); after any refactor, a SEPARATE commit (two hats). Commit ONLY in-scope files. Report SHAs in \`commits\`.` : "";
  const gitVerify = (repo, from) => GIT ? `
Git: inspect the exact change with \`git -C ${repo} diff ${from || BASE_SHA}..HEAD\` and \`git -C ${repo} status\` — confirm ONLY in-scope files changed within this range (it starts at this work's pre-state; precise drift detection).` : "";
  if (GIT) log(`git mode ON — baseline pinned at ${BASE_SHA.slice(0, 8)} (clean=${gitClean}) [deterministic capture]`);
  else log("git mode OFF (no .git) — sequential only, no per-leaf commits/reversibility/worktrees");
  if (GIT && gitClean === false) log(`⚠ DIRTY baseline tree — uncommitted edits will look like invariant violations (noisy false-negatives). Prefer a clean tree.`);
  let LOCKFILE = "";
  if (GIT) {
    let lockDirR = await sh(`git -C ${REPO} rev-parse --absolute-git-dir`, "lock-dir");
    if (shUnavailable(lockDirR)) {
      log("shell-proxy returned no result for lock-dir — retrying once …");
      lockDirR = await sh(`git -C ${REPO} rev-parse --absolute-git-dir`, "lock-dir-retry");
    }
    if (shUnavailable(lockDirR)) {
      log("FATAL: shell-proxy unavailable at lock-dir (both attempts) — cannot establish mutual exclusion; aborting.");
      return { error: "shell-proxy unavailable at lock-dir decision point", task: TASK };
    }
    const gd = (lockDirR.stdout || "").trim().split("\n").pop() || "";
    if (gd && gd.startsWith("/")) {
      LOCKFILE = `${gd}/rs-lock`;
      const lockCheckR = await sh(`cat ${LOCKFILE} 2>/dev/null || true`, "lock-check");
      if (shUnavailable(lockCheckR)) {
        log("FATAL: shell-proxy agent returned no result for lock-check — cannot verify mutual exclusion; aborting.");
        return { error: "shell-proxy unavailable at lock-check decision point", task: TASK };
      }
      const held = (lockCheckR.stdout || "").trim();
      if (held) {
        log(`FATAL: another recursive-slice run holds this working tree (lock: ${held}). If that run crashed/was killed, remove ${LOCKFILE} and relaunch.`);
        return { error: "working tree locked by another recursive-slice run", lock: held, lockFile: LOCKFILE, task: TASK };
      }
      const lockWriteR = await sh(`echo rs-${BASE_SHA.slice(0, 12)} > ${LOCKFILE}`, "lock-write");
      if (shUnavailable(lockWriteR)) {
        log("FATAL: shell-proxy unavailable at lock-write — lock file not written; cannot guarantee mutual exclusion; aborting.");
        return { error: "shell-proxy unavailable at lock-write decision point", task: TASK };
      }
    }
  }
  const verifyLeaf = async (lbl, node, res, tier, repo, leafStart, engineT0, buildNote) => {
    const leafTest = node.kind === "tidy" || tier === "light" || !!engineT0 ? "" : LEAF_TEST(node.testScope);
    const reported = JSON.stringify({
      summary: String(res.summary || "").slice(0, 400),
      passed: res.passed,
      evidence: String(res.evidence || "").slice(0, 500),
      filesChanged: res.filesChanged,
      commits: res.commits,
      refactor: res.refactor,
      interfaceConcern: res.interfaceConcern,
      discovered: res.discovered,
      purposeVerified: res.purposeVerified
    });
    const hats = GIT && res.commits && res.commits.length >= 2 ? `
TWO-HATS AUDIT: ${res.commits.length} commits — diff EACH separately (\`git -C ${repo} show <sha>\`); a structure/refactor commit must be strictly behavior-preserving (no test or behavior change smuggled in).` : "";
    const base = `${R_VERIFY}

Repo: ${repo}
Adversarially verify this finished leaf.
Task: ${node.task}
Reported: ${reported}
${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ""}${buildNote || ""}`;
    if (node.kind === "tidy") {
      return await agentSafe(
        `${base}
This is a TIDY-FIRST leaf: a behavior-PRESERVING structural change. Trust it ONLY if the existing suite is GREEN, NO test was added/changed/deleted, and the diff is a pure structural refactor with NO observable behavior change. Adding tests or changing behavior in a tidy leaf is a FINDING (untrusted).`,
        { phase: "Work", label: `verify:${lbl}·tidy`, model: "sonnet", schema: VERDICT }
      ) || { trustworthy: false, reason: "verification unavailable — untrusted" };
    }
    if (tier === "light") {
      return await agentSafe(
        `${R_VERIFY_LIGHT}

Repo: ${repo}
Low-risk leaf: ${node.task}
Reported: ${reported}
${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ""}${buildNote || ""}`,
        { phase: "Work", label: `verify:${lbl}·light`, model: "sonnet", schema: VERDICT }
      ) || { trustworthy: false, reason: "verification unavailable — untrusted" };
    }
    if (tier === "heavy") {
      const lenses = ["correctness & reproduce the green", "security: secrets/credentials NEVER logged or leaked", "interface & cross-module drift"];
      const votes = [];
      for (let li = 0; li < lenses.length; li++) {
        const L = lenses[li];
        const v = await agentSafe(
          `${base}
LENS: judge specifically through "${L}".`,
          { phase: "Work", label: `verify:${lbl}·${L.slice(0, 9)}`, ...li === 0 ? { model: "opus" } : {}, schema: VERDICT }
        );
        votes.push(v || { trustworthy: false, reason: `lens "${L}" verifier unavailable — counts as distrust` });
      }
      const distrust = votes.filter((v) => !v.trustworthy);
      return {
        trustworthy: distrust.length === 0,
        // UNANIMOUS across ALL 3 lenses (null counts against)
        reason: `heavy verify: ${votes.length} lenses, ${distrust.length} distrusted`,
        issues: votes.flatMap((v) => v.issues || []),
        purposeGap: votes.map((v) => v.purposeGap).filter(Boolean).join("; ") || void 0,
        // ① don't drop a hard-leaf purpose gap
        prescription: votes.map((v) => v.prescription).filter(Boolean).join(" | ") || void 0,
        // I3: lens prescriptions feed repair
        followUps: votes.flatMap((v) => v.followUps || [])
        // I4: lens follow-ups feed the batch
      };
    }
    return await agentSafe(base, { phase: "Work", label: `verify:${lbl}`, schema: VERDICT }) || { trustworthy: false, reason: "verification unavailable — untrusted" };
  };
  let t0redStreak = 0;
  const ABORTS = [];
  async function runWork(rootTask, repo, startDepth, gid, cleanOK, kind, buildNote) {
    buildNote = buildNote || "";
    const tag = gid != null ? `g${gid}:` : "";
    const stack = [{ task: rootTask, ctx: "", depth: startDepth, spikes: 0, kind: kind || "behavior" }];
    const done2 = [];
    const executedKeys = /* @__PURE__ */ new Set();
    let discovered = 0, untrustedStreak = 0;
    const keyOf = (s) => String(s).trim().slice(0, 120);
    while (stack.length && done2.length < MAX_LEAVES) {
      const node = stack.pop();
      const atFloor = node.depth >= FLOOR;
      let a = null, action;
      if (node.atomic) {
        action = "execute";
      } else {
        a = await agentSafe(
          `${R_ASSESS}

Repo: ${repo}
Task: ${node.task}
${node.ctx ? "Context: " + node.ctx + "\n" : ""}Depth ${node.depth}/${FLOOR}${atFloor ? " (AT FLOOR — you must return execute)" : ""}.
${INV}
Classify and emit the next action.`,
          { phase: "Work", label: `${tag}assess:d${node.depth}`, model: "sonnet", schema: ASSESSMENT }
        );
        if (!a) log(`${tag}assess failed [d${node.depth}] — defaulting to execute`);
        action = atFloor || !a ? "execute" : a.action;
        if (action === "spike" && node.spikes >= MAX_SPIKES) action = "execute";
      }
      if (action === "slice") {
        const sl = await agentSafe(
          `${R_SLICE}

Repo: ${repo}
Slice into thin, VERTICAL, independently-verifiable slices with a self-contained contract each. ${a && a.difficulty === "hard" ? "Isolate the risky seam first." : "Group near-identical units; 2-5 slices."}
Task: ${node.task}
${node.ctx}
${INV}`,
          { phase: "Work", label: `${tag}slice:d${node.depth}`, schema: SLICES }
        );
        let slices = sl && sl.slices || [];
        if (slices.length > 1) {
          const crit = await agentSafe(
            `${R_CRITIC}

Repo: ${repo}
Task: ${node.task}
Proposed list:
` + slices.map((s, j) => `${j + 1}. ${s.desc}`).join("\n") + `
${INV}`,
            // agentType:'Explore' — the completeness critic is READ-ONLY + additive-only (it gates
            // NO trust, only proposes missing scenarios, with inline input). The Explore recon agent
            // (reads excerpts, returns conclusions) fits exactly and is leaner than the default agent.
            // NOT for verifier/lens (they MUST keep Bash to re-run — Bash-less verify silently
            // defeats the fabricated-green catch, main.ts fabricated-green lesson) nor baseliner
            // (Explore skips CLAUDE.md, which the baseliner must read to build the project card).
            { phase: "Work", label: `${tag}critic:d${node.depth}`, agentType: "Explore", schema: MISSING }
          );
          if (crit && crit.missing && crit.missing.length) {
            slices = slices.concat(crit.missing.map((m) => ({ ...m, kind: "behavior" })));
            log(`${tag}completeness critic +${crit.missing.length} missing scenario(s)`);
          }
        }
        if (slices.length <= 1) {
          log(`${tag}non-reducing slice [d${node.depth}] → execute`);
          action = "execute";
        } else {
          log(`${tag}slice [d${node.depth}] → ${slices.length}`);
          for (let j = slices.length - 1; j >= 0; j--) {
            const iface = slices[j].interface;
            const ifaceCtx = iface && !/^TBD/i.test(iface.trim()) ? `
Interface (FIXED): ${iface}` : "";
            stack.push({ task: slices[j].desc, ctx: `Contract: ${slices[j].contract}${ifaceCtx}`, kind: slices[j].kind || node.kind || "behavior", atomic: slices[j].atomic, riskTier: slices[j].riskTier, testScope: slices[j].testScope, depth: node.depth + 1, spikes: 0 });
          }
          continue;
        }
      }
      if (action === "spike") {
        const learn = await agentSafe(
          `You are the Spiker (Beck: concrete hypotheses — make the uncertainty small, falsifiable, and cheap).
Repo: ${repo}
De-risk this hard-but-small task with the smallest experiment / minimal reproduction (remove extraneous detail; learn, don't build): ${node.task}
${node.ctx}`,
          { phase: "Work", label: `${tag}spike:d${node.depth}`, model: "sonnet", schema: LEARNING }
        );
        stack.push({ ...node, ctx: `${node.ctx}
LEARNED: ${learn ? learn.summary : "(spike produced no result)"}`, spikes: node.spikes + 1 });
        log(`${tag}spike [d${node.depth}]: ${node.task.slice(0, 50)}`);
        continue;
      }
      if (QUOTA_HALT || budget.total && budget.remaining() < 12e4) {
        log(`${tag}${QUOTA_HALT ? "quota halt" : "budget low"} — stopping after ${done2.length} leaves`);
        break;
      }
      const k = keyOf(node.task);
      if (executedKeys.has(k)) continue;
      executedKeys.add(k);
      const i = done2.length;
      const lbl = `${tag}${i}`;
      const tier = node.kind === "tidy" ? "standard" : node.atomic ? node.riskTier || "standard" : !a ? "standard" : a.difficulty === "easy" ? "light" : a.difficulty === "hard" ? "heavy" : "standard";
      const TIDY = node.kind === "tidy" ? "\nTIDY-FIRST leaf (Beck — make the change easy): a behavior-PRESERVING structural change ONLY (rename/extract/generalize/move). Do NOT add or change any test; do NOT change observable behavior — the EXISTING suite must stay green UNCHANGED. EXCEPTIONS for this tidy leaf: its proof IS the existing suite, so run the FULL existing suite once (this overrides the never-full-suite speed rule); and commit as ONE refactor commit (this replaces the two-hats behavior+refactor commit pair — a tidy leaf has no behavior step)." : "";
      const leafStart = GIT ? (((await sh(`git -C ${repo} rev-parse HEAD 2>/dev/null || true`, `head:${lbl}`)).stdout || "").match(/[0-9a-f]{40}/i) || [""])[0] : "";
      const restore = async () => {
        if (!GIT || !cleanOK || !leafStart) return false;
        const r = await sh(`git -C ${repo} reset --hard ${leafStart}`, `reset:${lbl}`);
        await sh(`git -C ${repo} clean -fdq -e .rs-wt -e .rs-scratch`, `clean:${lbl}`);
        return r.exitCode !== -2;
      };
      let res = null, verdict = null, attempt = 0, prevIssueCount = Infinity;
      while (true) {
        const repair = attempt === 0 ? "" : `
REPAIR ATTEMPT ${attempt}: a prior attempt was REJECTED by review for: ${JSON.stringify((verdict && verdict.issues && verdict.issues.length ? verdict.issues : [verdict && verdict.reason]).slice(0, 6).map((s) => String(s).slice(0, 300)))}. ` + (verdict && verdict.prescription ? `
REVIEWER'S PRESCRIBED FIX (apply exactly unless evidently wrong): ${String(verdict.prescription).slice(0, 1200)}
` : "") + (GIT && cleanOK && leafStart ? `FIRST undo your prior attempt with \`git -C ${repo} reset --hard ${leafStart}\` (sibling commits survive), then re-implement fresh; ` : "") + `then fix exactly those objections. In git mode add a fresh commit.`;
        res = await agentSafe(
          `${R_EXEC}

Repo: ${repo}
Do EXACTLY this one atomic task.
Task: ${node.task}
${node.ctx}
${INV}${node.kind === "tidy" ? "" : LEAF_TEST(node.testScope)}${GIT_EXEC}${TIDY}${buildNote}${repair}`,
          { phase: "Work", label: `exec:${lbl}${attempt ? ".r" + attempt : ""}`, model: "sonnet", schema: RESULT }
        );
        if (!res) break;
        if (!res.passed) {
          verdict = { trustworthy: false, reason: "tier-0 gate: deterministic build/tests RED" };
        } else {
          let engineT0 = "", t0red = null;
          const scopeSafe = node.testScope && /^[A-Za-z0-9_.-]+$/.test(String(node.testScope));
          const t0cmd = node.kind !== "tidy" && scopeSafe && baseline.filterCommand && baseline.filterCommand.includes("{scope}") ? baseline.filterCommand.replace("{scope}", String(node.testScope)) : "";
          if (t0cmd) {
            const t0 = await sh(`cd ${repo} && ${t0cmd}${SCRATCH && repo !== REPO ? ` --scratch-path ${SCRATCH}` : ""}`, `t0:${lbl}`);
            if (t0.exitCode !== 0) {
              t0red = { trustworthy: false, reason: `tier-0 (ENGINE-run filtered tests) RED: \`${t0cmd}\` exited ${t0.exitCode} though the executor reported green`, issues: [`deterministic filtered run failed (exit ${t0.exitCode}); output tail: ${String(t0.stdout || "").slice(-300)}`] };
              if (++t0redStreak >= 2) {
                baseline.filterCommand = "";
                log(`${tag}engine t0 disagreed with executor-green ${t0redStreak}× in a row — suspecting a broken filterCommand template; disabling the engine gate (LLM verify takes over)`);
              }
            } else {
              t0redStreak = 0;
              engineT0 = `
ENGINE-RAN: \`${t0cmd}\` exited 0. Output tail: ${String(t0.stdout || "").slice(-300)}
FIRST confirm from that output that at least one test ACTUALLY EXECUTED under scope \`${node.testScope}\` — zero tests matched = a FINDING (vacuous gate / scope-suite mismatch): distrust or re-run yourself. If tests did run, do NOT re-run them — audit the ARTIFACTS (diff scope, test meaningfulness, over-fit, interface drift).`;
            }
          }
          if (!t0red && node.kind === "tidy" && baseline.measureCommand) {
            const tidyFull = await sh(`cd ${repo} && ${baseline.measureCommand}`, `tidy-fullsuite:${lbl}`);
            if (tidyFull.exitCode !== 0) {
              t0red = { trustworthy: false, reason: `tidy-fullsuite (ENGINE-run full suite) RED: measureCommand exited ${tidyFull.exitCode} (behavior not preserved)`, issues: [`full suite failed for tidy leaf; output tail: ${String(tidyFull.stdout || "").slice(-300)}`] };
            } else {
              engineT0 = `
ENGINE-RAN: \`${baseline.measureCommand}\` (full suite — tidy behavior-preservation gate) exited 0. Output tail: ${String(tidyFull.stdout || "").slice(-300)}
Confirm from that output that the existing suite is actually green (zero tests run = vacuous). Do NOT re-run the suite yourself — judge the ARTIFACTS: diff scope, no test added/changed/deleted, pure structural refactor, no observable behavior change.`;
            }
          }
          verdict = t0red || await verifyLeaf(lbl, node, res, attempt === 0 ? tier : tier === "light" ? "standard" : tier, repo, leafStart, engineT0, buildNote);
        }
        if (verdict.trustworthy) break;
        const issueCount = (verdict.issues || []).length || 1;
        const converging = issueCount < prevIssueCount;
        if (attempt >= MAX_REPAIR && !(converging && attempt < MAX_REPAIR_HARD)) break;
        if (QUOTA_HALT || budget.total && budget.remaining() < 12e4) {
          log(`${tag}${QUOTA_HALT ? "quota halt" : "budget low"} — stopping repairs (leaf ${i} stays untrusted → reverted)`);
          break;
        }
        prevIssueCount = attempt === 0 && tier === "light" ? Infinity : issueCount;
        log(`${tag}leaf ${i} untrusted (tier=${res.passed ? tier : "tier0-red"}, ${issueCount} issue(s)${attempt > 0 && converging ? ", converging" : ""}) → self-repair ${attempt + 1}/${converging ? MAX_REPAIR_HARD : MAX_REPAIR}`);
        attempt++;
      }
      if (!res) {
        log(`${tag}leaf ${i} exec FAILED (no result) — restoring, continuing`);
        await restore();
        done2.push({ task: node.task, passed: false, summary: "executor returned no result (API/rate-limit)", verdict: { trustworthy: false, reason: "executor failed" } });
        if (++untrustedStreak >= MAX_UNTRUSTED_STREAK) {
          ABORTS.push(`${tag || "main:"} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`);
          log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure suspected). Integrate still runs.`);
          break;
        }
        continue;
      }
      done2.push({ task: node.task, ...res, verdict });
      log(`${tag}leaf ${i} ${res.passed ? "green" : "RED"} | tier=${tier}${attempt ? ` (repaired×${attempt})` : ""} | ${verdict.trustworthy ? "trusted" : "NOT trusted"}: ${node.task.slice(0, 36)}`);
      if (GIT && !verdict.trustworthy) {
        const restored = await restore();
        log(`${tag}leaf ${i} untrusted → ${restored ? `restored to ${leafStart.slice(0, 8)}` : !cleanOK ? "NOT auto-cleaned (dirty main baseline — left to protect your uncommitted work)" : !leafStart ? "NOT auto-cleaned (HEAD capture failed — left as-is, flagged for Integrate)" : "NOT auto-cleaned (restore skipped — quota halt or sh proxy unavailable)"}`);
      }
      untrustedStreak = verdict.trustworthy ? 0 : untrustedStreak + 1;
      if (untrustedStreak >= MAX_UNTRUSTED_STREAK) {
        ABORTS.push(`${tag || "main:"} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`);
        log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure: wrong decomposition / broken env / API trouble). Integrate still runs.`);
        break;
      }
      const feed = verdict.trustworthy ? [...res.discovered || [], ...verdict.followUps || []] : [];
      if (feed.length) {
        const fresh = feed.map(String).filter((d) => !executedKeys.has(keyOf(d))).slice(0, Math.max(0, MAX_DISCOVERED - discovered));
        if (fresh.length) {
          fresh.forEach((d) => executedKeys.add(keyOf(d)));
          discovered += fresh.length;
          const batchTask = `Address these ${fresh.length} discovered/review-flagged scenario(s) as ONE leaf (the implementation is stable, so batching tests is Canon-TDD-safe — write a meaningful test for each):
- ${fresh.join("\n- ")}
If ANY scenario actually needs an IMPLEMENTATION/behavior change (not just a test), do NOT force it — note it in \`discovered\` for a focused follow-up.`;
          stack.push({ task: batchTask, ctx: `Discovered while doing "${node.task.slice(0, 40)}".`, kind: "behavior", atomic: true, riskTier: "standard", testScope: node.testScope, depth: node.depth, spikes: 0 });
          log(`${tag}+${fresh.length} discovered → 1 batched follow-up leaf`);
        }
      }
    }
    if (done2.length >= MAX_LEAVES) log(`${tag}NOTE: hit MAX_LEAVES — work truncated`);
    return { done: done2 };
  }
  phase("Plan");
  let groups = null;
  const goParallel = PARALLEL && GIT && gitClean && (baseline.coldBuildCost !== "expensive" || FORCE_PARALLEL || SHARED_SCRATCH);
  if (PARALLEL && GIT && !goParallel)
    log(`parallel requested but skipped → SEQUENTIAL. Reason: ${!gitClean ? "main tree is DIRTY (merge would conflict with your work)" : "coldBuildCost=expensive (compile-bound: worktrees force cold builds → thrashing, slower than sequential-warm; sharedScratch:true to share one build dir, or forceParallel:true to brute-force)"}.`);
  const SCRATCH = goParallel && SHARED_SCRATCH ? `${REPO}/.rs-scratch` : "";
  const buildNoteFor = (repo) => SCRATCH && repo !== REPO ? `
SHARED BUILD DIRECTORY (mandatory): append \`--scratch-path ${SCRATCH}\` to EVERY build/test invocation (SwiftPM passes it through its wrappers; Cargo's equivalent is CARGO_TARGET_DIR; other builders have their own shared-build-dir mechanism — use this project's equivalent). The parallel worktrees share that ONE build dir so dependencies compile once; builds serialize on its lock (expected — do not work around it); NEVER delete it.` : "";
  if (goParallel) {
    const a0 = await agentSafe(
      `${R_ASSESS}

Repo: ${REPO}
Task: ${TASK}
Depth 0/${FLOOR}.
${INV}
Classify and emit the next action.`,
      { phase: "Plan", model: "sonnet", schema: ASSESSMENT }
    );
    if (a0 && a0.action === "slice") {
      const sl = await agentSafe(
        `${R_SLICE}

Repo: ${REPO}
This is the PARALLEL PARTITION — NOT fine slicing. Each group you emit becomes its OWN git worktree (its own branch off the baseline), so produce FEW, COARSE groups: ONE per LARGEST parallelizable unit. Aim for 2-4 groups; NEVER split one coherent feature — its fine-grained decomposition happens INSIDE the group later. ENGINEER independence rather than merely detecting it: put file-DISJOINT cores (new modules, separate subsystems, new files) into parallel groups, and EXTRACT the touches that would collide on shared files (wiring into common views/entry points, manifest edits) into a FINAL \`independent\`=false group that runs sequentially AFTER the parallel groups merge. Mark \`independent\`=true for disjoint groups AND for groups with only LIGHT, mergeable overlap (a few additive edits to a shared file) — the Coordinator role exists to merge branches and resolve exactly such conflicts honoring both sides; when you accept overlap, LIST the expected overlapping files in that group's contract so the coordinator anticipates them. Heavy same-file rework across groups is the only hard disqualifier.
Task: ${TASK}
${INV}`,
        { phase: "Plan", label: "partition:d0", schema: SLICES }
      );
      const all = sl && sl.slices || [];
      const indep = all.filter((s) => s.independent);
      if (indep.length >= 2) {
        groups = { indep, seq: all.filter((s) => !s.independent), all };
        log(`parallel plan: ${indep.length} independent group(s) + ${groups.seq.length} sequential`);
      } else log(`parallel requested but <2 independent top slices — falling back to sequential`);
    } else log(`parallel requested but root is not big enough to slice — falling back to sequential`);
  }
  phase("Work");
  let done = [];
  let merge = null;
  if (groups) {
    const N = groups.indep.length;
    const wtPaths = groups.indep.map((_, i) => `${REPO}/.rs-wt/g${i}`);
    const clearWorktrees = async (label, mergedOnly = false) => {
      for (let i = 0; i < N; i++) await sh(`git -C ${REPO} worktree remove --force ${wtPaths[i]} 2>/dev/null; true`, `${label}-rm:${i}`);
      await sh(`git -C ${REPO} worktree prune`, `${label}-prune`);
      if (mergedOnly) {
        const merged = await sh(`git -C ${REPO} branch --merged HEAD`, `${label}-merged-list`);
        const mergedNames = (merged.stdout || "").split("\n").map((l) => l.trim().replace(/^\*\s*/, ""));
        for (let i = 0; i < N; i++) {
          if (mergedNames.includes(`rs/g${i}`))
            await sh(`git -C ${REPO} branch -D rs/g${i} 2>/dev/null; true`, `${label}-br:${i}`);
        }
      } else {
        for (let i = 0; i < N; i++) await sh(`git -C ${REPO} branch -D rs/g${i} 2>/dev/null; true`, `${label}-br:${i}`);
      }
      await sh(`rm -rf ${REPO}/.rs-wt 2>/dev/null; true`, `${label}-rmdir`);
    };
    await clearWorktrees("wt-pre", true);
    const paths = {};
    for (let i = 0; i < N; i++) {
      const r = await sh(`git -C ${REPO} worktree add -b rs/g${i} ${wtPaths[i]} ${BASE_SHA}`, `wt-add:${i}`);
      if (r.exitCode === 0) {
        paths[i] = wtPaths[i];
        if (baseline.worktreeSetupCommand) {
          const setupR = await sh(`cd ${wtPaths[i]} && ${baseline.worktreeSetupCommand}`, `wt-setup:${i}`);
          if (setupR.exitCode !== 0) {
            log(`worktree g${i} setup command failed (exit ${setupR.exitCode}) — skipping group (no worktree/setup failed)`);
            delete paths[i];
          }
        }
      } else log(`worktree g${i} setup failed (exit ${r.exitCode})`);
    }
    const built = [];
    for (let b = 0; b < groups.indep.length; b += MAX_WORKERS) {
      const rs = await parallel(groups.indep.slice(b, b + MAX_WORKERS).map((s, j) => async () => {
        const idx = b + j;
        const repo = paths[idx];
        if (!repo) {
          log(`group g${idx} has no worktree — skipped`);
          return { done: [{ task: s.desc, passed: false, verdict: { trustworthy: false, reason: "no worktree" } }] };
        }
        return runWork(`${s.desc}
Contract: ${s.contract}
Interface: ${s.interface}`, repo, 1, idx, true, s.kind, buildNoteFor(repo));
      }));
      built.push(...rs);
    }
    built.forEach((r) => {
      if (r && r.done) done.push(...r.done);
    });
    phase("Coordinate");
    if (QUOTA_HALT) {
      log(`Coordinate skipped — quota halt active; worktrees preserved for resume (relaunch with resumeFromRunId after the limit resets)`);
    } else {
      let conflicts = 0;
      for (let i = 0; i < N; i++) {
        if (paths[i] == null) continue;
        const m = await sh(`git -C ${REPO} merge --no-ff --no-edit rs/g${i}`, `merge:${i}`);
        if (m.exitCode !== 0) {
          conflicts++;
          await agentSafe(
            `${R_COORD}

Repo: ${REPO}
The deterministic \`git -C ${REPO} merge --no-ff rs/g${i}\` FAILED (conflict). Resolve ONLY this branch's conflict (slice "${groups.indep[i].desc}"), honoring both sides' intent, complete the merge commit, then confirm the tree builds.
${INV}`,
            { phase: "Coordinate", label: `merge-conflict:${i}`, schema: VERDICT }
          );
        }
      }
      const mergeRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, "merge-fullsuite");
      merge = await agentSafe(
        `${R_VERIFY}

Repo: ${REPO}
${N} parallel branches were merged into the working branch (${conflicts} needed conflict resolution). The FULL measure command was JUST run DETERMINISTICALLY with exit=${mergeRun.exitCode} (${mergeRun.exitCode === 0 ? "GREEN" : "RED"}) — do NOT re-run it; JUDGE from that result whether every baseline invariant holds and NO slice's work was lost.
${INV}`,
        { phase: "Coordinate", label: "merge-verify", schema: VERDICT }
      );
      log(`coordinator: merged ${N} branches (${conflicts} conflicts) — ${merge && merge.trustworthy ? "OK" : "ISSUES"}`);
      await clearWorktrees("wt-post");
    }
    const all = groups.all, seq = groups.seq;
    const idxOf = (s) => all.indexOf(s), inSeq = new Set(seq.map(idxOf));
    const seqOrdered = [], placed = /* @__PURE__ */ new Set();
    let guard = seq.length + 2;
    while (seqOrdered.length < seq.length && guard-- > 0)
      for (const s of seq) {
        const ai = idxOf(s);
        if (placed.has(ai)) continue;
        if ((s.dependsOn || []).filter((d) => inSeq.has(d)).every((d) => placed.has(d))) {
          seqOrdered.push(s);
          placed.add(ai);
        }
      }
    for (const s of seq) if (!placed.has(idxOf(s))) seqOrdered.push(s);
    for (let s = 0; s < seqOrdered.length; s++) {
      const r = await runWork(`${seqOrdered[s].desc}
Contract: ${seqOrdered[s].contract}`, REPO, 1, "seq" + s, gitClean, seqOrdered[s].kind);
      if (r && r.done) done.push(...r.done);
    }
  } else {
    const r = await runWork(TASK, REPO, 0, void 0, gitClean);
    done = r.done;
  }
  phase("Integrate");
  let finalRun = { exitCode: -1, stdout: "" };
  let integration = null;
  if (QUOTA_HALT) {
    ABORTS.push(`quota-halt: ${QUOTA_HALT} — integrate/wiring/briefing skipped; relaunch with resumeFromRunId after the limit resets (cached leaves replay free)`);
    log("quota halt — skipping integrate/wiring/briefing (resume to run them)");
  } else try {
    finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, "integrate-fullsuite");
    if (finalRun.exitCode === 137) {
      log("integrate full suite timed out (exit 137) — one automatic retry (known flake class)");
      finalRun = await sh(`cd ${REPO} && ${baseline.measureCommand}`, "integrate-fullsuite-retry");
    }
    if (finalRun.exitCode !== 0) log(`⚠ FULL SUITE RED at integration (exit ${finalRun.exitCode}) — a leaf regression may have escaped its filter (④); the LLM integrator will attribute.`);
    integration = await agentSafe(
      `${R_VERIFY}

Repo: ${REPO}
All work is done. The FULL baseline measure command was JUST run DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? "GREEN" : "RED"}) — do NOT re-run the whole suite; JUDGE from that result whether every invariant still holds across the integrated whole${finalRun.exitCode === 0 ? "" : " (it is RED — identify which leaf/area most likely regressed)"}.
${INV}` + (GIT ? `
Also summarize the cumulative trust deposit (\`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`) and confirm no out-of-scope file changed since baseline.` : ""),
      { phase: "Integrate", schema: VERDICT }
    );
    if (!integration) {
      log("integration agent unavailable (API error) — one retry");
      integration = await agentSafe(
        `${R_VERIFY}

Repo: ${REPO}
All work is done. The FULL baseline measure command was JUST run DETERMINISTICALLY with exit=${finalRun.exitCode} (${finalRun.exitCode === 0 ? "GREEN" : "RED"}) — do NOT re-run the whole suite; JUDGE from that result whether every invariant still holds across the integrated whole.
${INV}`,
        { phase: "Integrate", label: "integration-retry", schema: VERDICT }
      );
    }
  } catch (e) {
    log(`integrate phase error (budget ceiling / API): ${e && e.message ? e.message : e} — returning partial results; the full-suite net DID NOT RUN.`);
  }
  const fullSuiteGreen = finalRun.exitCode === 0;
  const trusted = done.filter((d) => d.verdict && d.verdict.trustworthy);
  let wiringGaps = [];
  if (GIT && trusted.length && !QUOTA_HALT) {
    try {
      const newPub = await sh(
        `cd ${REPO} && git diff ${BASE_SHA}..HEAD -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null | grep -E '^\\+[^+].*\\b(public|open|export|pub)\\b.*\\b(func|fn|function|var|let|class|struct|enum|const)\\b' | sed -E 's/^\\+\\s*//' | head -40`,
        "wiring-scan"
      );
      const symbols = shUnavailable(newPub) ? "" : (newPub.stdout || "").trim();
      if (symbols) {
        const names = [...new Set((symbols.match(/(?:func|fn|function|var|let|class|struct|enum|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g) || []).map((m) => m.replace(/^.*\s/, "")))].slice(0, 20);
        let refCounts = "";
        if (names.length) {
          const counter = names.map((n) => `printf '%s %s\\n' "${n}" "$(grep -rw "${n}" . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null | grep -viE '(^|/)(tests?|spec)' | wc -l | tr -d ' ')"`).join("; ");
          refCounts = ((await sh(`cd ${REPO} && { ${counter}; }`, "wiring-count")).stdout || "").trim();
        }
        const w = await agentSafe(
          `You are the WIRING auditor. This run added the following NEW exported declarations to ${REPO} (extracted from \`git diff ${BASE_SHA.slice(0, 8)}..HEAD\`, test files excluded):
${symbols}

DETERMINISTIC reference counts (engine-run \`grep -rw\` over production paths; a count of 1-3 usually means declaration-only = UNWIRED candidate):
${refCounts || "(count step unavailable)"}

Judge from those counts — re-grep a symbol yourself ONLY when its count is ambiguous. Report as gaps ONLY symbols that (a) have ZERO production call sites AND (b) look like they were MEANT to be wired into an existing flow — i.e. the feature is unreachable by a user. EXCLUDE: protocol/interface requirements, overrides, library-surface API intended for external consumers, entry points referenced by config/manifest, helpers used by other NEW symbols that ARE wired. Each gap: "<symbol> (<file>): <why it looks unwired, one line>". Empty array if all wired.`,
          { phase: "Integrate", label: "wiring-audit", schema: { type: "object", required: ["gaps"], properties: { gaps: { type: "array", items: { type: "string" } } } } }
        );
        wiringGaps = w && w.gaps || [];
        if (wiringGaps.length) log(`⚠ wiring-audit: ${wiringGaps.length} new symbol(s) with NO production call site (built-tested-unwired class)`);
        else log("wiring-audit: all new exported symbols reachable from production code");
      }
    } catch (e) {
      log(`wiring-audit skipped: ${e && e.message ? e.message : e}`);
    }
  }
  const purposeGaps = [
    ...baseline.inProcessVerifiable === false && baseline.purposeCheck ? [`baseline: purpose needs out-of-process verification — ${baseline.purposeCheck}`] : [],
    ...done.map((d) => d.verdict && d.verdict.purposeGap).filter((g) => !!g),
    // the executor's own honest admission becomes a gap even if the verifier omitted one
    ...done.filter((d) => d.purposeVerified === false && !(d.verdict && d.verdict.purposeGap)).map((d) => `leaf verified only via fakes/mocks (purposeVerified=false): ${String(d.task).slice(0, 60)}`),
    ...integration && integration.purposeGap ? [integration.purposeGap] : []
  ];
  let briefing = null;
  if (trusted.length && !QUOTA_HALT) {
    const ledgerForBriefing = done.map((d, j) => ({
      i: j,
      task: String(d.task).slice(0, 140),
      trusted: !!(d.verdict && d.verdict.trustworthy),
      commits: d.commits || [],
      files: d.filesChanged || [],
      interfaceConcern: d.interfaceConcern || void 0,
      purposeGap: d.verdict && d.verdict.purposeGap || void 0,
      discovered: d.discovered && d.discovered.length ? d.discovered : void 0,
      funList: d.funList && d.funList.length ? d.funList : void 0,
      refactor: d.refactor ? String(d.refactor).slice(0, 200) : void 0
    }));
    try {
      briefing = await agentSafe(
        `You are the Comprehension Steward. A trust-first workflow just landed VERIFIED code the OWNER has not read — "comprehension debt": speed silently converts into a codebase the owner can no longer debug or steer. Turn this run's ledger into a GUIDED READ (~10-15 min) that repays that debt cheaply.
Repo: ${REPO}. Baseline ${BASE_SHA ? BASE_SHA.slice(0, 8) : "(no git)"} → HEAD.` + (GIT ? ` First run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` and \`git -C ${REPO} diff ${BASE_SHA}..HEAD --stat\`, then READ the key files yourself before writing.` : "") + `
Ledger (per leaf): ${JSON.stringify(ledgerForBriefing).slice(0, 6e3)}
Write \`briefing\` as markdown with EXACTLY these sections:
1. **Reading order** — files in dependency order (pure core first, shells last): per file what it does, which commit introduced it, why it matters.
2. **Decisions made for you** — interface/design choices made on the owner's behalf and WHY (include every interfaceConcern verbatim).
3. **Buried bodies** — quirks, known follow-ups, discovered-but-not-done items, funList tangents, anything that would surprise the owner in 3 months.
4. **Verify by hand** — the human-oracle items: every purposeGap, with the EXACT command/steps to close it (live test, app action).
Be concrete: real paths, commit SHAs, line pointers where it matters. Match the language the task was written in. No fluff — the test is: after this read, can the owner debug and steer this code?`,
        { phase: "Integrate", label: "owner-briefing", schema: BRIEFING }
      );
      if (!briefing) {
        log("owner-briefing agent unavailable (API error) — one retry");
        briefing = await agentSafe(
          `You are the Comprehension Steward. Turn this run's ledger into a GUIDED READ (~10-15 min) for the owner: reading order (files, commits, why), decisions made for them, buried bodies, and what to verify by hand. Repo: ${REPO}.` + (GIT ? ` Run \`git -C ${REPO} log --oneline ${BASE_SHA}..HEAD\` first.` : "") + `
Ledger: ${JSON.stringify(ledgerForBriefing).slice(0, 6e3)}
Match the language the task was written in. Be concrete.`,
          { phase: "Integrate", label: "owner-briefing-retry", schema: BRIEFING }
        );
      }
    } catch (e) {
      log(`owner-briefing skipped (budget/API): ${e && e.message ? e.message : e}`);
    }
  }
  if (LOCKFILE) {
    try {
      await shForce(`rm -f ${LOCKFILE}`, "lock-clear");
    } catch (e) {
      log(`lock-clear failed (budget ceiling?) — stale lock left at ${LOCKFILE}; remove it before the next run.`);
    }
  }
  if (ABORTS.length) log(`⚠ ${ABORTS.length} unit(s) halted by the untrusted-streak guard: ${ABORTS.join(" | ")}`);
  log(`Done: ${trusted.length}/${done.length} leaves trusted | merge ${merge ? merge.trustworthy ? "OK" : "ISSUES" : "n/a"} | full-suite ${finalRun.exitCode === -1 ? "NOT RUN" : fullSuiteGreen ? "GREEN" : "RED"} | integration ${integration && integration.trustworthy ? "OK" : integration ? "FAILED" : "UNKNOWN"}`);
  if (purposeGaps.length) log(`⚠ ${purposeGaps.length} PURPOSE GAP(S) — tests pass but real-user behavior is UNVERIFIED (see purposeGaps; close via live test / human).`);
  return {
    task: TASK,
    mode: groups ? "parallel" : "sequential",
    baseline,
    results: done,
    coordinator: merge,
    integration,
    fullSuiteGreen,
    integrationExit: finalRun.exitCode,
    trustedLeaves: trusted.length,
    totalLeaves: done.length,
    purposeGaps,
    wiringGaps,
    aborts: ABORTS,
    briefing: briefing && briefing.briefing || void 0
    // B: the owner's guided read — RELAY this, don't bury it
  };
}
return await __main()
