# recursive-slice — trust-first recursive decomposition

A knowledge base for the **trust-first recursive decomposition** agent system built on
Claude Code Workflows, and the research behind it. Captured 2026-06-09.

## What this is

A generic engine that takes any software task and **recursively decomposes it into thin,
independently-verifiable slices**, executes each leaf with Canon-TDD discipline, and
**adversarially verifies every result** against a pinned baseline — committing per-leaf to
git so trust deposits survive even an orchestrator crash. The control flow is deterministic
(plain JS); the model is used only for *judgment* at each node and for *adversarial
verification*. Trust — not code — is the optimization target.

## The artifacts (bundle layout)

| Path | What |
|---|---|
| `workflows/recursive-slice.js` | the engine (deterministic orchestrator + schema'd agent nodes) |
| `agents/slice-*.md` | the role agents (baseliner, assessor, slicer, executor, verifier) for standalone use |
| `skills/slice/SKILL.md` | the `/slice` front door |
| `scripts/slice-watch.py` | live terminal viewer of a run (decomposition tree + git trust deposits) |
| `docs/recursive-slice/` | this knowledge base |

Run it: `/slice "<task>"`, or `Workflow({ scriptPath: '<skill-base-dir>/recursive-slice.js', args: { task, repo, maxDepth, parallel } })`.
Watch it: `/workflows`, or `watch -n3 'python3 scripts/slice-watch.py latest <repo>'`.

## The documents

1. **[philosophy.md](philosophy.md)** — why trust is the objective function. Kent Beck's
   *Trust Factory*, *Mastering Programming*, *Canon TDD*, *Design in TDD* — synthesized and
   read critically for the agent context.
2. **[architecture.md](architecture.md)** — the system: the deterministic-control +
   model-judgment thesis, the roles, the phases, and every mechanism (risk-tiered
   verification, self-repair, project card, git mode, parallel worktrees + coordinator).
3. **[pitfalls-and-lessons.md](pitfalls-and-lessons.md)** — the failure modes and their
   mitigations, plus the hard lessons from real runs (the crash, the verifier catching a
   fabrication, the silent git-off bug, the adversarial review finding a trust hole).
4. **[goose.md](goose.md)** — deep analysis of `aaif-goose/goose`: what it validates about
   our design, what to borrow (with source citations), and the "goose-as-leaf-executor"
   reframe and when it's worth adopting.

## The one-sentence thesis

> The model (a "genie") is least trustworthy exactly when trust matters most — so put the
> *control flow* in deterministic code, the *judgment* in the model, and the *enforcement*
> (evidence, gates, verification) in mechanisms the model cannot talk its way past.
