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
   - `parallel: true` (opt-in) ONLY for a git repo + a task with ≥2 truly file-independent
     top-level groups + cheap cold builds. The engine auto-falls-back to sequential on
     compile-bound projects (Swift/Rust/C++) or a dirty main tree; `forceParallel: true` overrides.
   - `sharedScratch: true` lifts the compile-bound fallback PROPERLY: all worktrees share one
     build dir (`--scratch-path`), so dependencies compile once and builds serialize on its lock
     (measured on one compile-bound repo: 3×cold ≈ 9-15min → serialized-warm ≈ 1-2min). Use for
     compile-bound toolchains (SwiftPM/Cargo/CMake-style) whose builder supports a shared build dir.
   - Pass `repo` as an absolute path so the agents (whose cwd may differ) find it.

5. **Check the runway, then launch** via the Workflow tool, pointing at the bundled engine:
   `Workflow({ scriptPath: '<skill-base-dir>/recursive-slice.js', args: { task, repo, maxDepth, parallel } })`
   (or copy `recursive-slice.js` to `~/.claude/workflows/` once and use `{ name: 'recursive-slice' }`)
   It runs in the background; you'll be notified on completion. Tell the user they can watch
   live progress with `/workflows`. BEFORE launching, enforce the operational rules:
   - **ONE workflow at a time** (across ALL repos): concurrent workflows share one API quota —
     three at once starved every agent into harness stall-kills ("no progress 180s × 6").
     Check TaskList for a running workflow first; treat "its git deposits landed" as proof of
     NOTHING — a run can stall-retry for hours after its last commit. Queue, don't stack.
   - **Quiesced, clean tree**: nobody (human or other run) edits the target tree while a run is
     live. The engine refuses a tree another run holds (lock in the tree's gitdir, `rs-lock`);
     if a run crashed and left a stale lock, confirm no workflow task is alive, then remove it.
   - **Crash recovery**: the orchestrator dying loses NO work (per-leaf commits survive).
     `git stash` any unverified in-flight edits (never trust uncommitted debris), then relaunch
     with `Workflow({ scriptPath: <persisted script>, resumeFromRunId: <run id> })` — completed
     agents replay from the journal cache; only the stalled leaf re-runs live.
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

- The roles are also standalone subagents (`slice-baseliner`, `slice-assessor`, `slice-slicer`,
  `slice-executor`, `slice-verifier`) — you can spawn any one directly via the Agent tool for a
  lighter, interactive pass instead of the full workflow.
- If the target repo is not under git, note it: small reversible commits are themselves a trust
  mechanism, and git unlocks worktree isolation for parallel slices. Offer to `git init`.
