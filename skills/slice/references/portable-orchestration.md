# Portable orchestration — running slice WITHOUT the Workflow tool

**opencode users: skip manual mode** — `adapters/opencode/slice-engine.ts` hosts the engine's
PORT as a custom tool, running the same artifact with full automation (verified live). Manual
mode below is for harnesses with no adapter yet.

The bundled engine (`recursive-slice.js`) needs Claude Code's Workflow runtime (a sandboxed JS
interpreter providing `agent()`/`parallel()`/`phase()` plus journaling and resume). On harnesses
without it — opencode, Codex CLI, plain subagent-only setups — the front-door agent executes the
SAME algorithm itself. You lose the journal (resume), enforced schemas, and parallel worktrees;
you keep everything that makes the system trustworthy, because those are disciplines, not APIs:

> **The four invariants that must survive any port:** executor ≠ verifier · shell truth before
> model judgment · one git commit per trusted leaf · the full suite runs ONCE, at integrate.

## The algorithm, hand-driven

**0. Externalize state.** You have no journal — keep a `WORK.md` scratch file (or equivalent)
with the work stack, per-leaf status, and the ledger. Per-leaf commits remain the durable record;
losing your context must never lose work.

**1. Baseline (once).** Spawn a baseliner subagent (or do it inline): pin the git SHA, list the
invariants that must stay true, record the repo's test physics — the FULL measure command, the
FILTERED per-scope command, cold-build cost — and a compact project card (conventions, test
framework, layout). Run the measure command via shell yourself and record the exact green state.

**2. Work loop.** Pop one item off the stack:
- **Assess** (inline or subagent): easy/hard × small/big → `execute` | `slice` | `spike`.
- **Slice** (subagent): thin VERTICAL slices, each with a self-contained contract (achieve +
  files/seam + invariant + how to verify ALONE) and a FIXED interface; push onto the stack in
  dependency order. Slices adding user-reachable capability must name the production call site
  they wire into.
- **Execute** (subagent): give it ONLY the leaf contract + interface + invariants — never the
  whole tree (small context is both economy and discipline). Canon TDD, one test at a time;
  filtered tests only; one commit on green.
- **Tier-0 gate — run it YOURSELF**: build + the leaf's filtered tests via shell, and confirm at
  least one test actually executed (a 0-test green is laundering). Only then spawn the verifier.
- **Verify** (a DIFFERENT subagent, refute-mode): hunt vacuous tests, over-fit implementations,
  silent behavior changes, interface drift, purpose gaps. Ask for structured JSON and validate it
  yourself — schema discipline by convention when the harness can't force it.
- **Repair**: one attempt; continue (max 3) only while the issue count strictly shrinks.
  3 consecutive untrusted leaves → ABORT the unit and surface it: the approach failed,
  not the leaf (`MAX_UNTRUSTED_STREAK = 3` in the engine; aligns with the repair-loop budget).

**3. Integrate.** Run the FULL measure command yourself — the verdict comes from its exit code,
not from a model's impression. Then the wiring audit: diff the run for new exported symbols and
grep production code for call sites; new API with zero production callers is the
built-tested-unwired defect class — report it.

**4. Brief.** Spawn a briefing subagent over the ledger: reading order, decisions made for the
owner, buried bodies, what to verify by hand. Persist to `docs/briefings/`, push follow-ups to
`docs/BACKLOG.md`.

## Accepted degradations

| Lost | Mitigation |
|---|---|
| Resume journal | `WORK.md` + per-leaf commits; re-entry = read both, continue the stack |
| Schema forcing | "Answer ONLY with this JSON" + front-door validation/retry |
| Parallel worktrees | Sequential only (usually fine — compile-bound repos serialize anyway) |
| Budget/quota plumbing | Watch your own context; prefer more, smaller leaves |

## Porting the role personas

The five `agents/slice-*.md` files are plain markdown personas — register them wherever the
harness keeps subagents (opencode: `.opencode/agent/`; Claude Code: `~/.claude/agents/`), or
inline their text into your spawn prompts if the harness has no agent registry.
