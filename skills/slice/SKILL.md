---
name: slice
description: Trust-first recursive decomposition of a development task — baseline → vertical slices → Canon-TDD execution → adversarial verification → per-leaf commits → deterministic integration + owner's briefing. Use whenever a coding task is big, risky, multi-file, or vague enough that "just doing it" could silently break things — "implement X across the app", "refactor this subsystem", "migrate Y", "fix this and also clean up around it" — and whenever the user asks to decompose work, wants TDD discipline enforced, or wants changes they can verify and trust rather than take on faith. Works on any language/stack (the baseline step learns the repo's own build/test physics). Not for a single-file fix already diagnosed to a line — do that directly. Args = the task description (optionally with a repo path).
---

# /slice — recursive, trust-first decomposition

You are the front door to the `recursive-slice` workflow engine
(bundled as `recursive-slice.js` in this skill's base directory). It encodes Kent Beck's *Mastering Programming*
heuristics (Slicing, One-thing-at-a-time, Baseline Measurement, Concrete hypotheses) in
service of the *Trust Factory* objective: every step leaves verifiable evidence and avoids
silent surprise.

## Trust Factory sets the ceremony — read first

Priority: **Trust Factory first**, then **TDD + Tidy First** as its mechanisms — never the
reverse. The test is never "did I run the full ceremony?" but "did I manufacture the trust this
change actually lacked, and no more?" Trust you already hold is free — a clean compile, a green
filtered test, a diff you can read whole and revert in one commit. Spend the costly ceremony
(executor≠verifier, adversarial verify, baseline/slice/integrate rounds, parallel worktrees) only
on the trust **deficit**. Uniform max-ceremony lowers trust-per-hour; a 10-minute change that
takes an hour is a tier error, not rigor.

**Two reflexes before the tiers (reflexes, not research projects):** (1) *Scope* — the cheapest,
highest-trust change is the one you don't make: does it need to exist (YAGNI)? stdlib / native /
one line before fifty? (the scope floor — details in `code-fundamentals`). (2) *Deliberation* —
don't spend longer deciding what *not* to build than building it would take; if your explanation
is longer than the change, cut the explanation (prose defending a simplification is complexity
smuggled back in). A care-process that ruminates is slower for zero trust gain.

**Ceremony ladder — pick the LOWEST tier that still guarantees the baseline floor:**
- **T0 deterministic** — a compiler / type-check / filtered test already proves it → just run it. No agent, no engine.
- **T1 legible** — one change you can read whole + a filtered test → do it inline yourself: failing test → fix → filtered suite → one commit. Two hats (behavior, then structure), one head. **Default for simple work — most tasks exit here, no engine.**
- **T2 manufactured** — ≥2 independent risky leaves, an unknown interface/API, cross-cutting plumbing, a security gate, or an irreversible seam → the engine earns its 100k–700k tokens: executor≠verifier, adversarial verify, and independent leaves run in **parallel** (worktree groups + coordinator) by default — serial buys no extra trust, only wall-clock.

> This T0/T1/T2 ladder is the **front-door routing** decision (do nothing / inline yourself /
> launch the engine). It is ORTHOGONAL to the engine's internal `riskTier: light/standard/heavy`,
> which — once you are inside a T2 run — sets how hard each *leaf* is verified. Don't conflate
> them: a T2 lane still has light, standard, and heavy leaves within it.

The floor (baseline invariants, per-leaf reversibility, evidence) is non-negotiable at *every*
tier; only the ceremony *above* it scales with risk. Step 2 below is the per-group mechanics.

## What to do

1. **Resolve the task and repo.**
   - The task = the user's `$ARGUMENTS` (or, if empty, the work currently under discussion).
   - The repo = the relevant project root. If ambiguous, infer from the conversation/cwd; ask
     only if you genuinely cannot tell.

2. **Don't loop what doesn't need a loop** (judgment stays with you, not the engine). A
   diagnosed, single-file, single-leaf fix (you already have file:line + the failing behavior)
   is cheaper and safer done DIRECTLY in-conversation with the same discipline inline: failing
   test first → fix → filtered suite → full gate → one commit. Reserve the engine for work
   with ≥2 genuinely separate leaves, an unknown decomposition, or a risky seam needing
   adversarial verification. A full lane spends 100k-700k tokens on ceremony that a 10-line
   wiring fix does not need.
   **This rule applies PER GROUP, not per task.** When the spec already carries the
   decomposition with file:line evidence and KNOWN remedies (typical after an audit), do those
   groups YOURSELF inline — same discipline, no agent ceremony: failing test → known fix →
   filtered suite → one commit per fix — and lane ONLY the genuinely risky seams (unknown
   APIs, cross-cutting plumbing, security gates). Measured on a live remediation lane: a
   known-fix leaf costs ~5 agents (~25min) through the engine vs ~10min inline; running
   audit-prescribed groups through the full engine roughly DOUBLED the lane's wall-clock for
   no trust gain (the audit was the verification). Mixed task → split it: inline the known,
   lane the risky.

3. **Write the task as a LANE SPEC, not a wish.** Runs given precise specs went 11/11–12/12
   trusted; vague specs produced verifier rejections and repair loops. Include, in the task string:
   - **Evidence**: the defect/feature anchored to `file:line` + the observed symptom (paste the
     line of code if you've already diagnosed it). Diagnose BEFORE launching, not inside the run.
   - **MUST PRESERVE**: behaviors the run may not regress (the baseline protects tests; this
     protects un-tested behaviors you know matter).
   - **Purpose**: what the USER should observe afterward — this feeds the purposeGap check.
   - **Wiring clause** (UI/feature lanes): name the REAL production path the change must be
     reachable from ("wire into the screen/endpoint the app actually serves, not a legacy variant") —
     the #1 recurring defect class is built-tested-but-unwired.
   - **Known flakes**: name them (e.g. "exit 137 = watchdog timeout, not a failure"). The engine
     already auto-retries the integrate gate once on exit 137.

4. **Right-size the call.** Tune the workflow args before launching:
   - `maxDepth`: 2 for a contained task, 3–4 for a genuinely large one. Keep it small — the
     floor is the anti-explosion guard.
   - `parallel` — **ON by default** (the engine's native disposition: parallelize the independent).
     You rarely pass it; pass `parallel: false` only to FORCE sequential. The partition ENGINEERS
     independence (file-disjoint cores in parallel; shared-file wiring as a final sequential
     group), and light overlap is fine — the Coordinator merges branches and resolves conflicts
     honoring both sides, with the deterministic full-suite net behind it. The default is cheap
     because the engine **auto-falls back to sequential** whenever parallel can't help — no git,
     dirty main tree, compile-bound builds (unless `sharedScratch`/`forceParallel` lifts it), or
     <2 independent groups. So single-seam work runs sequentially on its own; you don't opt out.
   - `sharedScratch` — **now AUTO-ON for compile-bound repos** (the engine enables it whenever the
     Baseliner reports `coldBuildCost: "expensive"`; you no longer pass it). It lifts the compile-bound
     fallback PROPERLY: all worktrees share one build dir (`--scratch-path`), deps compile once, builds
     serialize on its lock (measured: 3×cold ≈ 9-15min → serialized-warm ≈ 1-2min). This kills the
     recurring drift of forgetting it on Swift/Rust/CMake lanes and silently crawling. Pass
     `sharedScratch: false` ONLY to force the old per-worktree-cold behavior (rarely what you want).
   - `confirmTier` — the engine **stops before any leaf runs** when it detects an over-tier launch:
     a compile-bound repo whose plan is ≤3 slices ALL judged low-risk (`light`) — i.e. inline-T1-shaped
     work the engine would only make slower (the 5.8h-run lesson). The stop is a clean half-nothing
     (zero leaves, commits, worktrees; lock released) and names the escape. Pass `confirmTier: true` to
     override and force the engine anyway. A single non-light slice OR any completeness-critic expansion
     bypasses the gate — so it fires only on the narrowest, explicitly-lowest-risk run, and trust stays
     exactly where it is fragile. (Verifier speed: on compile-bound repos the verifier no longer adds a
     redundant full build when the engine already ran a deterministic build+filtered-test gate.)
   - `skills: [paths]` — domain-guidance guide files threaded into every executor/verifier
     (executors apply them, verifiers enforce them; repo conventions win on conflict).
     **AUTO-SELECT these yourself** — selection is part of right-sizing the call, never
     something the user must ask for. Resolve each name to its SKILL.md absolute path,
     checking in order: project `.agents/skills/<name>/`, user `~/.agents/skills/<name>/`,
     plugin cache `~/.claude/plugins/cache/*/*/<sha>/skills/<name>/` (latest sha), then any
     local skill-library index. Selection table (COMPOSE matching rows; cap ~4 entries):

     | lane touches | add |
     |---|---|
     | any substantial code (default) | `code-fundamentals` |
     | React/Next.js UI (.tsx/.jsx, components/hooks/routes) | `toss-frontend-fundamentals` + `vercel-react-best-practices` + `vercel-composition-patterns` |
     | build config / deps / workspace / codemod migration | `build-config-drift` |
     | bug-hunt / regression / rootcause lane | `issue-rootcause-workflow` |

     A lane in a domain with no matching guide gets none. Every entry taxes every leaf's
     attention, but the engine's per-leaf RELEVANCE GATE (leaves skip guides whose domain
     doesn't match their contract) bounds the cost for mixed lanes — so a full-stack lane may
     safely carry both backend and frontend guides.
   - Pass `repo` as an absolute path so the agents (whose cwd may differ) find it.

5. **Check the runway, then launch** via the Workflow tool, pointing at the bundled engine:
   `Workflow({ scriptPath: '<skill-base-dir>/recursive-slice.js', args: { task, repo, maxDepth, parallel } })`
   (or copy `recursive-slice.js` to `~/.claude/workflows/` once and use `{ name: 'recursive-slice' }`)
   It runs in the background; you'll be notified on completion. Tell the user they can watch
   live progress with `/workflows`.
   - **QUOTE AN ETA BEFORE YOU LAUNCH (delivery-predictability is a reliability axis).** A correct
     result that lands at an unpredictable hour erodes trust as much as a wrong one — "a slow tool
     trains its owner to distrust it" applies to납기 too. Before launching, state a rough wall-clock
     estimate to the user, derived from the shape: ~(leaf count) × (per-leaf build+test cost), with
     compile-bound repos dominated by serial rebuilds. If that number is uncomfortable for a task you
     diagnosed to `file:line`, that is the signal you mis-tiered — drop the low-risk leaves to inline
     T1 (step 2) and reserve the engine for the genuinely risky seams. Never let "long" be a surprise.
   BEFORE launching, enforce the operational rules:
   - **ONE workflow per WORKING TREE, always** (rs-lock enforces it — two runs mutating one
     tree corrupt each other; correctness, not cost). ACROSS repos, concurrent workflows are
     fine when the owner accepts the burn rate — they share one API quota, and three at once
     once starved every agent into stall-kills, so check what else is consuming quota before
     stacking. Treat "its git deposits landed" as proof of NOTHING — a run can stall-retry for
     hours after its last commit.
   - **Quiesced, clean tree**: nobody (human or other run) edits the target tree while a run is
     live. The engine refuses a tree another run holds (lock in the tree's gitdir, `rs-lock`);
     if a run crashed and left a stale lock, confirm no workflow task is alive, then remove it.
   - **Crash recovery**: the orchestrator dying loses NO work (per-leaf commits survive).
     `git stash` any unverified in-flight edits (never trust uncommitted debris), then relaunch
     with `Workflow({ scriptPath: <persisted script>, resumeFromRunId: <run id> })` — completed
     agents replay from the journal cache; only the stalled leaf re-runs live.
   - **Quota-halt auto-resume**: if the run returns with an `aborts` entry starting `quota-halt:`
     (the engine's circuit breaker tripped on a session/usage limit), do NOT hand it back to the
     owner to babysit: parse the reset time from the quoted error when present (e.g. "resets
     12:20am"), `ScheduleWakeup` for a few minutes past it (fallback ~60min if unknown), and on
     wake relaunch with the SAME args + `resumeFromRunId` — cached leaves replay free. The
     quiesce rules still apply first: stash crash debris, remove a stale `rs-lock`.
   - **After killing a run, also kill its ORPHANED test processes**: stopping a workflow does
     NOT kill the test runner its executor had in flight (whatever the stack spawns:
     `swift-test`/`swiftpm-testing-helper`, jest/vitest workers, `cargo test` runners…). The orphan keeps the build/test lock forever (its parent is dead), and the NEXT test
     run hangs at 0% CPU waiting on it — looks like "tests are slow", is actually a deadlock.
     Check `ps` for stale runners (old etime, 0 CPU) and kill them before re-running anything.
   - **Hang triage in one line**: `ps -o pcpu,etime` — old etime + ~0% CPU = deadlock, not work
     (a working test/build burns CPU). Don't wait on a 0%-CPU runner; capture the last-started
     test (serial/PTY run if output is block-buffered), `sample` the host process, then kill.
   - **Background Bash tasks OUTLIVE the tool timeout** (observed: a 8-min-timeout suite ran 38
     minutes). For anything that can hang, build the wall-clock watchdog INTO the command
     (e.g. `( sleep N && kill … ) &`) — never rely on the harness timeout in background mode.

6. **On completion, report the trust ledger** — not a wall of text:
   - the baseline that was protected,
   - how the task was sliced (the decomposition tree),
   - per-leaf: passed + whether the verifier trusted it,
   - the final integration verdict (deterministic full-suite green/red),
   - anything the agents flagged (funList tangents, untrusted leaves, MAX_LEAVES truncation,
     `aborts` — a unit halted by the untrusted-streak guard means the APPROACH failed, lead with it).
   Surface untrusted leaves and false-green risks prominently — that is the whole point.
   Then **relay the `briefing` field (the Owner's Briefing) in full** — it is the owner's guided
   read for repaying comprehension debt (reading order, decisions made for them, buried bodies,
   what to verify by hand). Never summarize it away; the owner reading code is the loop's one
   unautomatable obligation.
   **Persist the briefing durably**: append it to `docs/briefings/<date>-<lane>.md` in the target
   repo (create the dir if missing) and commit it with the lane. /tmp copies die with the machine;
   the briefing IS the comprehension-debt ledger and must live with the code it explains.
   Also report `wiringGaps` (the engine's built-tested-unwired audit) right after untrusted leaves —
   a gap there means a feature landed unreachable; queue the wiring fix before anything else.

7. **Visually verify UI lanes before handover.** A green ledger proves tests pass, not that the
   user can SEE the feature — after a lane that changes UI, render the real interface and read
   the pixels yourself (the purposeGap check, done by you, not the owner). If the screenshot
   contradicts the green ledger, that's a wiring gap: report it as a failure, not a success.
   Per platform:
   - **Web**: headless-browser screenshot (playwright/puppeteer) of the changed route/state.
   - **macOS app** (needs Screen Recording permission): capture the app's window WITHOUT
     stealing focus via `<skill-base-dir>/scripts/capture-window.sh <AppName> /tmp/verify.png` —
     window-ID capture works on occluded windows; never fight the owner for displays/focus.
     Driving the UI (clicks) needs an idle display and explicit `with timeout`; never run an
     `entire contents` AX query against an app — it wedges the app's accessibility server for
     minutes and every subsequent AppleEvent times out (-1712).
   - **CLI/TUI**: capture real terminal output (PTY run if output is block-buffered).

8. **Compound the lane before closing it** (each unit of work must make the next one easier —
   not just ship). After relaying the briefing, spend one explicit pass on three questions:
   - **Repo convention?** If the lane established a pattern (e.g. "thread data explicitly into
     views, never via store selection state"), add ONE line to the target repo's CLAUDE.md
     conventions — that's how the next lane's agents inherit it without re-deriving it.
   - **Caught next time?** For every defect class the lane fixed, name the regression canary
     that now catches it (a test, a compile-gated parameter, a t0 gate). If none exists, that's
     unfinished work — queue it, don't close.
   - **Feel regression checklist**: every owner complaint about look/feel (a janky scroll, a
     wrong icon, a missing header) becomes a permanent entry in the repo's
     `docs/polish-checklist.md`; after any UI lane, walk that checklist yourself with the
     platform's capture method (step 7) before handover. Owner taste, once stated, is system
     property — never make them say it twice.

9. **Keep the loop's memory in the repo, not the conversation** (the agent forgets, the repo
   doesn't). The durable queue lives in `docs/BACKLOG.md` of the target repo: every briefing's
   "buried bodies"/follow-ups, deferred funList items, and known-gap canaries get appended there
   (with file:line evidence) when you relay the briefing; completed items get checked off at the
   next lane's start. Point the next lane's spec at the relevant BACKLOG entries instead of
   re-deriving them from chat history — conversation summaries are lossy; BACKLOG.md is not.

## Notes

- The roles are also standalone subagents (`slice-baseliner`, `slice-slicer`,
  `slice-executor`, `slice-verifier`) — you can spawn any one directly via the Agent tool for a
  lighter, interactive pass instead of the full workflow. (`slice-slicer` also owns the
  recursion-termination decision — the former `slice-assessor` is folded into it.)
  **One-time setup (npx-installed copies)**: plugin installs register these automatically; a
  plain skill install does not. If `slice-*` agents are missing from the agent registry and this
  skill's base directory has an `agents/` folder, copy those files to `~/.claude/agents/` (tell
  the user you did) — idempotent, skip if already present.
- **No Workflow tool in this harness?**
  - **opencode**: first-class adapter available — copy `adapters/opencode/slice-engine.ts` to
    `~/.config/opencode/tools/` and the `slice-engine` tool runs the SAME engine artifact
    (AsyncFunction-hosted PORT; `agent()` = `opencode run` subprocess on the user's own plan).
    First use returns a `needsSetup` question — lane→agent/model mapping, with oh-my-openagent
    auto-detection (recommended: sisyphus-junior for shell/light, momus for the heavy lens —
    cross-model criticism preserved). Verify install free with `node adapters/opencode/host-smoke.mjs`. v1 degradations are documented
    in the adapter header (no per-call model overrides, no resume journal, unlimited budget).
  - **Anything else** (Codex CLI, subagent-only setups): don't give up the discipline — read
    `references/portable-orchestration.md` and drive the same algorithm yourself with subagents.
    The four invariants survive any port: executor ≠ verifier, shell truth before model
    judgment, one commit per trusted leaf, full suite only at integrate.
- If the target repo is not under git, note it: small reversible commits are themselves a trust
  mechanism, and git unlocks worktree isolation for parallel slices. Offer to `git init`.
