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

## Engine gates — testing-readiness and over-tier (halt-and-surface)

Two deterministic STOP gates fire BEFORE any leaf runs and BEFORE the lock is taken, so a tripped
gate leaves nothing executed, nothing committed, no lock to clean up — re-entry is free.

- **Testing-readiness gate** (post-baseline). The baseliner sets `rigPresent` — its explicit
  judgment of whether a real RUNNABLE test rig exists (a real test command, OR `scripts/verify.sh`).
  When `baseline.rigPresent === false` the engine HALTS: the trust floor would be empty, so "still
  works" is unverifiable. It returns `{ error, noRigStop: true }` before taking the lock. **Fix the
  cause, not the symptom:** scaffold a rig (test-foundations adds `scripts/verify.sh` per the verify
  contract below). **Override:** re-run with `confirmNoRig: true` to proceed onto the empty floor.
- **Over-tier gate** (depth-0 / root decomposition). Fires when ALL three hold: compile-bound repo
  (`coldBuildCost === 'expensive'`), breadth `slices.length <= 3`, and every slice is
  `riskTier: 'light'`. The engine HALTS with `{ error, overTierStop: true, slices: <count> }` and
  the message "this looks like inline-T1 work" — running a multi-leaf engine over a small all-light
  task on an expensive build is over-engine-ing. **Override:** re-run with `confirmTier: true`.

**The two override args:** `confirmTier` and `confirmNoRig` are `EngineArgs` booleans (default off).
They are opt-in ACKS from a human, never auto-set by the harness. In pure hand-driven mode there is
no args object — the gate SEMANTICS survive (you still must not start engine-grade ceremony on an
all-light task, and you still must not certify "works" with no rig), but the machine-checkable
override discipline does not; you carry that judgment yourself.

**Verify contract (the rig the testing-readiness gate depends on).** A scaffolded rig must honor
`test-foundations/references/verify-contract.md`: `measureCommand = 'scripts/verify.sh'` and
`filterCommand = 'scripts/verify.sh --scope {scope}'` (§1, fixed strings). The `{scope}` token is a
bare token `[A-Za-z0-9_.-]+` — no slashes/paths/spaces (§5). Exit codes: 0=green, 1=red, 2=zero-match
graceful-degrade, 3=infra. The baseliner derives `measureCommand`/`filterCommand`/`coldBuildCost`/
`worktreeSetupCommand`/`rigPresent` by reading `--help`/`--list-scopes` (§8); `filterCommand` is
mutable at runtime — a template that repeatedly false-REDs is disabled by the engine's circuit
breaker and the leaf downgrades to llm-only.

**Gate discipline for non-interactive hosts (opencode, Codex CLI).** A non-interactive harness MUST
halt-and-surface — it does NOT auto-scaffold (scaffolding needs consent) and does NOT auto-confirm:
1. Log the gate reason.
2. Return the `EngineResult` unchanged, with `overTierStop` or `noRigStop` true.
3. Surface to the human (no silent fallback). For testing-readiness offer "run test-foundations to
   add a rig" OR "re-run with confirmNoRig:true"; for over-tier offer "do it inline (T1)" OR "re-run
   with confirmTier:true".
4. The human then scaffolds / re-runs with the override flag.
The opencode adapter (`adapters/opencode/slice-engine.ts`) does exactly this: it forwards
`confirmTier`/`confirmNoRig` through to the engine args (it does not consume or auto-set them), its
native `sh()` makes the tier-0 truth deterministic with no LLM, and on first use it returns
`needsSetup` rather than guessing a role→agent mapping — the same halt-and-ask posture the gates use.

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
| Gate overrides (`confirmTier`/`confirmNoRig`) | Requestable via args on an AsyncFunction host (opencode adapter forwards them); in pure manual mode the gate SEMANTICS survive but the override flags do not — apply the judgment yourself |

## Porting the role personas

The five `agents/slice-*.md` files are plain markdown personas — register them wherever the
harness keeps subagents (opencode: `.opencode/agent/`; Claude Code: `~/.claude/agents/`), or
inline their text into your spawn prompts if the harness has no agent registry.
