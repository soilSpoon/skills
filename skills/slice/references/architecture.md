# Architecture — the recursive-slice engine

How the [philosophy](philosophy.md) is realized as a runnable system on Claude Code Workflows.

## Central thesis

> Express the **recursion deterministically** (an explicit stack in plain JS), and use the
> model only for **judgment at each node** and **adversarial verification**.

Why an explicit JS stack rather than nested agents: Claude Code subagents (like goose
subagents — see [goose.md](goose.md)) **cannot spawn their own subagents**. Model-driven
recursion is also non-deterministic and impossible to budget — exactly where the "genie"
problem bites hardest. So recursion lives in the orchestrator's own loop; each `agent(prompt,
{schema})` call is a single node evaluation that returns validated JSON.

**Sharpened: anything *mechanically determinable* is done deterministically — not just control
flow.** Pure git/shell operations (capturing the baseline SHA, creating/removing worktrees,
merging branches, reverting an untrusted leaf) carry no judgment, so they are **JS-built command
strings** run by a thin `sh()` executor — the LLM is reduced to a `bash -c` proxy with zero
latitude (the sandbox has no real `exec()`; this is the closest approximation). The model is
reserved for what genuinely needs judgment: classify, slice, execute, verify, and *only a true
merge conflict*. And prefer primitives that **cannot fail**: an untrusted leaf is undone with a
conflict-free `git reset --hard <leafStart>`, never a batch `git revert` (which corrupts the tree
on interdependent commits — see [pitfalls-and-lessons.md](pitfalls-and-lessons.md) Lesson 7).

## The roles (each = one schema-forced agent)

| Role | Heuristic | In → Out |
|---|---|---|
| **Baseliner** | Baseline Measurement | repo → invariants + measure command + **gitSha** + **project card** |
| **Assessor** | (recursion termination) | task → `{difficulty, size, action, risk}` |
| **Slicer** | Slicing, Symmetry, Isolation | big/hard task → vertical slices + **fixed interface** + `independent`/`dependsOn` |
| **Completeness Critic** | the test list | slice list → missing edge-case scenarios |
| **Spiker** | Concrete hypotheses | hard-small task → minimal-repro learning |
| **Executor** | Canon TDD, two hats | one atomic task → diff + evidence + commits (in worktree/main) |
| **Verifier** | (trust gate) | a finished leaf → `{trustworthy, issues}` — reproduces evidence |
| **Coordinator** | (the only global-context agent) | parallel branches → merged main + conflict resolution |

Static repo knowledge (the **project card**) is shared to all roles (it's documentation, not
run-state, so it doesn't couple them). **Dynamic cross-node state stays only with the
Coordinator** — workers are context-isolated, which is what keeps them focused *and*
parallelizable.

## The phases

```
Baseline → Plan → Work → Coordinate → Integrate
```

- **Baseline** — pin the invariant the work must preserve: the measure command, falsifiable
  invariants (a *floor*: new green tests fine, an existing green going red is a violation),
  `gitSha` (content-addressed snapshot → drift detection), and the **project card**.
- **Plan** (parallel mode only) — classify the root; if it slices into ≥2 **independent**
  top-level slices, partition into parallel groups + a sequential (dependent) chain.
- **Work** — the recursive `runWork()` loop per unit (main checkout, or a group's worktree):
  classify → slice/spike/execute, **interleaved with discover-as-you-go feedback**.
- **Coordinate** (parallel mode only) — merge worktree branches into main, resolve conflicts,
  unconditionally clean up worktrees.
- **Integrate** — a **deterministic full-suite run via `sh()`** (the system-level net + a hard green/red
  gate that no soft LLM call can starve), then the LLM verifier judges invariants/purpose/drift *from that
  result* (no redundant re-run) + cumulative `git diff --stat`. Finally the **Owner's Briefing**: one agent
  turns the ledger into a guided read (reading order / decisions made for you / buried bodies / verify by
  hand) — comprehension debt is the one thing the loop can't repay, so the engine at least makes the
  repayment cheap. It rides in the payload as `briefing`.

## Key mechanisms

### 2-axis classification → action
Difficulty (easy/hard) × Size (small/big) are **orthogonal**. The Assessor emits an *action*,
biased hard toward `execute` (over-decomposition is the dominant failure):

| | easy | hard |
|---|---|---|
| **small** | `execute` | `spike` (de-risk → becomes easy-small) |
| **big** | `slice` (by volume) | `slice` (isolate the risky seam first) |

### Lazy decomposition + discovery feedback (Canon TDD faithful)
The decomposition is **not frozen** up front. An executed leaf may emit `discovered`
scenarios (edge cases the list missed) that are pushed back as new leaves — "add to the test
list as you discover." This makes the core loop inherently **sequential** within a unit.

### Risk-tiered verification (spend scrutiny where trust is fragile)
The Assessor's difficulty selects verification intensity:
- **light** (easy leaf) — audit the diff/tests, no full re-run (integration is the net).
- **standard** — one independent reproduction.
- **heavy** (hard leaf) — **3 perspective-diverse skeptics** (correctness / secrets-never-
  logged / interface drift), run *sequentially* (to avoid nested `parallel()`); **unanimous
  trust required**, and a null/unavailable lens counts as distrust. The correctness lens runs
  on a **different model** — homogeneous consensus re-confirms shared blind spots; cross-model
  diversity buys cheap independence exactly where trust is most fragile.

This applies the "spend the slowness budget where trust is fragile" principle to verification
itself.

### Leaf test discipline — filtered at the leaf, full suite is the net (④, measured)
A profile of a real run found the **Swift compile-and-test cycle was 68% of all shell time**, and **61% of
those runs were the *full* suite** — leaves needlessly recompiling+running the entire unrelated test set
when only their own slice's tests were relevant. The cure is deterministic + prompt-enforced: the Slicer
sets a `testScope` per slice; the engine threads it to the leaf and supplies a `LEAF_TEST` directive that
**forbids the bare full measure command at a leaf** (it runs only its *filtered* tests) and reserves the full
suite for Integrate. Tidy leaves are exempt (behavior-preservation needs a broad check). The leaf-level forbid
is prompt-strength (the Executor runs its own shell); what is *deterministic* is the scope threading + the
engine asking for the full command **only** at Integrate. Because per-leaf full runs are gone, the system-wide
regression gate now lives entirely at Integrate — so that gate was made a **deterministic `sh()` run** (above),
not a soft LLM call (an adversarial skeptic caught that a late budget cutoff could otherwise starve it). The
trade: a cross-suite regression is caught at Integrate, not at the offending leaf — later attribution, never a
false green (Integrate's full run is the net).

### Tier-0 deterministic gate (shell-truth before model-judgment)
Two layers. (a) The executor's `passed` must reflect a real run — but that is still an LLM
*claim* (one was once fabricated). So (b) the **engine itself re-runs the leaf's filtered
tests** via `sh()` using the Baseliner's `filterCommand` template (`... --filter {scope}`,
scope whitelisted against shell injection): engine-RED → the LLM verifier is skipped and the
leaf goes straight to repair with the real output. On exit-0 the verifier gets the OUTPUT
TAIL plus a duty: first confirm ≥1 test actually executed (exit 0 with a typo'd scope matches
ZERO tests — blind "engine-verified" would launder a vacuous green); only then audit
**artifacts** (vacuous tests, over-fit impl, scope drift, secret leaks) instead of re-running —
moving the reproduction cost from tokens to shell. Tidy leaves are exempt (their proof is the
full existing suite). Two self-defenses: 2 consecutive engine-RED-vs-executor-green
disagreements disable the gate (a broken template must not false-RED the whole run), and the
scope is whitelisted (`[A-Za-z0-9_.-]`, no `|` — it substitutes unquoted into a shell command).

### Self-repair (salvage, don't drop) — convergence-aware
An untrusted leaf is **re-executed against the verifier's specific objections** (not a blind
re-roll), plus the verifier's `prescription` (the exact fix, when visible — proven live to be
what lands a struggling leaf). Budget: `MAX_REPAIR` by default, extended to `MAX_REPAIR_HARD`
**only while the objection count strictly shrinks** round-over-round (a deterministic
convergence proxy — a real leaf landed on repair 3 as objections went 3→1, where a flat cap
would have reverted nine good commits; a diverging leaf still stops at the default). The repair first **resets the substrate** (git reset of
*only this leaf's* commits — never past them, so siblings survive) so it re-implements from
clean code + objections rather than compounding broken edits. Still untrusted after repair →
revert. (Hybrid of goose's reset-discipline and our keep-the-objections feedback.)

### Canon TDD in the leaf (the Executor's inner loop)
Call your shot → write the failing test first → make it pass → **two hats**: behavior commit,
then a *separate* refactor commit (non-optional). The fixed `interface` is a boundary — design
only the implementation; if the interface seems wrong, report `interfaceConcern`, don't change
it unilaterally.

### Inter-run mutual exclusion (per-tree lock)
Two engine runs mutating one working tree corrupt each other (one run's verifier reads the
other's edits as drift; restores clobber foreign leaves — observed live, Lesson 9). At baseline
the engine writes a deterministic lock (`rs-lock`) into the tree's REAL gitdir (resolved via
`git rev-parse --absolute-git-dir`, so each worktree carries its own lock): the same tree is
excluded, isolated worktrees may run concurrently. A held lock aborts the run before any change;
the lock is removed deterministically at the end. A crashed run leaves a stale lock — the front
door clears it only after confirming no run is alive. Note this guards the *tree*, not the API
quota: workflows also share one quota, so the front-door rule is **one workflow per working tree** (same tree excluded; isolated worktrees may run concurrently; quota burn is a separate concern managed by the owner).

### Git mode (reversibility + evidence as physics)
Auto-on when the repo is under git. Per-leaf **two-hats commits**, **SHA-pinned baseline**
(drift detection), untrusted leaves **reverted via `git reset --hard <leafStart>`** (conflict-free:
captures the leaf's pre-state SHA before work begins, so the hard reset erases exactly this leaf's
commits while preserving all sibling commits — replacing the old batch `git revert` which corrupted
trees on interdependent commits; see Lesson 7), and evidence = `git diff`. *Trust deposits survive an orchestrator crash because they're commits*
(proven — see [pitfalls-and-lessons.md](pitfalls-and-lessons.md)). The Baseliner now **must**
capture `gitSha` for a git repo (a silent omission once disabled git mode entirely).

### Parallel worktree groups + Coordinator (DEFAULT; `args.parallel: false` opts out)
Independent top-level slices build **concurrently, each in its own git worktree** (capped at
`MAX_WORKERS=4`, batched), within-group sequential with discovery feedback. The **Coordinator**
holds the only global context: a **deterministic per-branch `git merge --no-ff`** owns the merge,
and *only a true conflict* invokes the model (fixed-schema judgment); then a single re-verify.
Worktree setup/cleanup are **deterministic and unconditional** (JS-owned paths + commands via
`sh()`; cleanup runs regardless of merge outcome so nothing leaks). Dependent groups run on main
**after** the merge (so they see the integrated work), topologically ordered by `dependsOn`.

**The partition is COARSE, and gated on build cost.** Two hard lessons (observed live):
- *Coarse, not thin:* each group = one worktree = one **cold** dependency build, so the Plan
  partition emits the **fewest, largest** independent groups (one per feature/module); the
  fine-grained one-test-at-a-time decomposition happens *inside* each group (warm builds). Thin
  top-level splitting forced 5 cold builds where 2 sufficed. Fixing the *decomposition* is the
  cure — a worker cap is only a backstop.
- *Build-cost gate (deterministic):* the Baseliner reports `coldBuildCost`; for a **compile-bound**
  project (Swift/Rust/C++…) each worktree's cold build thrashes the machine and is *slower than
  sequential-warm*, so the engine **auto-falls-back to sequential** (override: `forceParallel`).
  The proper lift is `sharedScratch: true`: every worktree builds into ONE shared build dir — the
  toolchain's shared-build-dir mechanism (SwiftPM `--scratch-path`, Cargo `CARGO_TARGET_DIR`, …) — so
  dependency artifacts compile once and builds serialize on the build lock while model-work still
  overlaps. (Per-toolchain ceiling — e.g. SwiftPM: `--scratch-path` is the only shareable cache today;
  APFS-cloning `.build` fails (llbuild keys on absolute paths) and content-addressed caching is still
  experimental — other toolchains have their own limits.)
  Parallel-worktree's real win is **fast-build or I/O/network-bound** work — because a build tool
  serializes on its cache lock, you cannot have both warm *and* parallel builds. Parallel also
  requires a **clean main tree** (the branches merge into it).

### Interface-fixed contracts (SDD ⟂ TDD)
The Slicer designs interfaces with global sibling-view and pins them per slice; exploratory
APIs are marked `TBD` for a leaf to spike+propose. This is SDD doing interface design where
agents are weak at emergent design, and TDD doing implementation design where focused
iteration shines.

## Fault tolerance
Every `agent()` may return `null` (terminal API error / rate-limit). **All results are
null-guarded**: baseline-null aborts before any change; assess-null defaults to execute;
**verify-null = untrusted** (trust-correct); executor-null records a RED leaf and continues.
A single rate-limit can no longer crash the whole run (it once did — see lessons).

**Quota circuit breaker (`agentSafe`)**: a session/usage-limit error is not a one-off null —
left alone it kills every subsequent agent serially. The breaker trips on the FIRST
quota-shaped error string, OR on **3 consecutive nulls spanning ≥2 different call classes**
(the class-gate is essential: the 3-lens heavy-verify loop produces 3 same-class nulls by
design; only a cross-class streak signals session instability). Once tripped, `agentSafe`
no-ops for all remaining agents; the run ends resumable instead of burning retries until
the harness gives up.

## Anti-explosion backstops (deterministic, model-proof)
`FLOOR` (depth cap → forced execute), `MAX_LEAVES`, `MAX_DISCOVERED`, `MAX_SPIKES`,
convergence guard (a non-reducing slice → execute), budget gate, and `executedKeys` dedupe.
Plus **run-level no-progress detection**: leaf-level guards bound one leaf, but nothing used to
detect a run going *systemically* wrong — `MAX_UNTRUSTED_STREAK` (= 3) consecutive reverted leaves
(wrong decomposition / broken env / API trouble) now halts the unit and surfaces it in `aborts`
instead of grinding the budget into more reverts. Every cap **logs when hit** (no silent truncation).

## Validation status (honest)
- **Sequential path** — proven across multiple real MailKit runs (logging adoption + NIO test
  harness), incl. the verifier catching a fabricated evidence claim.
- **Risk-tiered verify / self-repair / tier-0 / project card / git mode** — implemented;
  sequential path solid.
- **Parallel + Coordinator** — implemented, **adversarially reviewed twice** (the 1st round
  caught a heavy-verify trust hole + worktree-leak + ordering bugs; the 2nd caught a *critical*
  batched-`git revert` tree-corruption bug — see Lesson 7 — now fixed with a conflict-free
  `reset --hard`), AND **live-validated end-to-end**: a 3-independent-module task on a cheap-build
  repo partitioned into 3 worktree groups, ran in parallel isolation (with within-group discovery
  feedback), deterministically merged all branches (182 tests green, "no slice's work lost"), and
  cleaned up every worktree. The build-cost gate correctly *withholds* this path from compile-bound
  projects (where it auto-falls-back to sequential).

## File map
- `recursive-slice.js` (skill base dir) — the engine (this document).
- `agents/slice-*.md` — standalone mirrors of the role personas (install to `~/.claude/agents/` to spawn them directly via the Agent tool).
- `SKILL.md` — `/slice` front door.
- `scripts/slice-watch.py` — live run viewer.
