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
| `agents/slice-*.md` | the role agents (baseliner, slicer, executor, verifier) for standalone use — the slicer also owns the recursion-termination decision (ITEM 10: the former assessor is folded into it) |
| `skills/slice/SKILL.md` | the `/slice` front door |
| `scripts/slice-watch.py` | live terminal viewer of a run (decomposition tree + git trust deposits) |
| `scripts/gen-personas.mjs` | build-time persona generation: regenerates `agents/slice-*.md` from the `R_*` constants in `src/prompts.ts` (run by `build-engine.sh`, which asserts `git diff --quiet -- agents/` — drift is impossible, not merely caught) |
| `scripts/outer-loop.mjs` | the opt-in, dispatch-only, dry-run-by-default outer driver (reads `docs/BACKLOG.md`, classifies T0/T1/T2, would dispatch slice only for T2 in a branch; never auto-merges) — the loop altitude above a single run |
| `docs/recursive-slice/` | this knowledge base |

Run it: `/slice "<task>"`, or `Workflow({ scriptPath: '<skill-base-dir>/recursive-slice.js', args: { task, repo, maxDepth, parallel } })`.
Watch it: `/workflows`, or `watch -n3 'python3 scripts/slice-watch.py latest <repo>'`.

## The documents

1. **[philosophy.md](philosophy.md)** — why trust is the objective function. Kent Beck's
   *Trust Factory*, *Mastering Programming*, *Canon TDD*, *Design in TDD* — synthesized and
   read critically for the agent context (and the scope axis: minimalism as a trust claim).
2. **[architecture.md](architecture.md)** — the system: the deterministic-control +
   model-judgment thesis, the roles, the phases, and every mechanism (risk-tiered
   verification, self-repair, project card, git mode, parallel worktrees + coordinator).
3. **[pitfalls-and-lessons.md](pitfalls-and-lessons.md)** — the failure modes and their
   mitigations, plus the hard lessons from real runs (the crash, the verifier catching a
   fabrication, the silent git-off bug, the adversarial review finding a trust hole).
4. **[portable-orchestration.md](portable-orchestration.md)** — running the same algorithm by
   hand on a harness with no Workflow tool (opencode / Codex CLI / subagent-only): the four
   invariants that survive any port, and the accepted degradations.
5. **[portable-setup.md](portable-setup.md)** — setting up a NEW machine to run fast + reliably,
   by language/environment: the two costs (shell-as-agent tax + compiler time) and their fixes —
   host choice (native-exec adapters), the rig, and per-language build caching (Swift Xcode CAS
   ~4.3×, Rust/C++ sccache, JVM Gradle cache, …), plus the Max-plan auth/billing setup.
6. **[sources.md](sources.md)** — annotated bibliography: the Beck lineage + the contemporary
   agent-systems sources, each mapped to the engine.
6. **[outer-loop.md](outer-loop.md)** — the loop altitude above the single-run harness: the opt-in,
   dispatch-only, dry-run-by-default outer driver (`scripts/outer-loop.mjs`) that reads a backlog,
   risk-classifies (T0/T1/T2), and would dispatch slice only for T2 in a branch — the human stays
   the exception-handler; it never auto-merges.

## The one-sentence thesis

> The model (a "genie") is least trustworthy exactly when trust matters most — so put the
> *control flow* in deterministic code, the *judgment* in the model, and the *enforcement*
> (evidence, gates, verification) in mechanisms the model cannot talk its way past.
