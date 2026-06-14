# The outer loop — an opt-in heartbeat that dispatches harnesses, with the human as exception-handler

`slice` is a **single-run harness**: you point it at one task, it decomposes → executes → verifies →
commits → integrates → briefs, and stops. It has no opinion about *what to work on next* — that
judgment is the human's, on purpose (see SKILL.md §2 "don't loop what doesn't need a loop").

The **outer loop** is the layer *above* a single slice run: the heartbeat that periodically
**discovers work** (from `docs/BACKLOG.md`), **classifies** each item by risk tier, and **dispatches**
the right tool — a one-line inline fix, a full slice run in a branch, or nothing — with **the human
firmly in the loop as the exception-handler** for every merge decision.

This layer is a SEPARATE, OPT-IN concern. **The engine stays untouched** — no `src/*.ts` or
`recursive-slice.js` change exists or is needed to support it. It is a thin driver that *calls* the
existing pieces; it never reaches inside them.

## The four SAFETY INVARIANTS (the baseline — see "the safety model" for the two RELAXED)

These are the outer-loop analogue of the engine's four trust invariants. They exist so that a
heartbeat — something that runs *repeatedly* and *unattended* — can never silently change `main` or
silently declare its own work "done". The `--execute` layer **relaxes exactly two** of these ([a] and
[b]) under tight, opt-in, human-present conditions — read the baseline here first, then **"The SAFETY
MODEL (stated explicitly)"** below for precisely what changes and every safeguard that keeps it safe.

- **[a] OPT-IN / explicit — the loop never runs on its own.** There is no daemon, no installed cron,
  no self-start. A human invokes `scripts/outer-loop.mjs` (or wires `/loop` / `/schedule` to it)
  deliberately, each time. The default invocation is a **dry run that dispatches nothing** — it only
  *prints a plan*. Autonomy is something the operator turns on, item by item, never the default.

- **[b] DISPATCH-ONLY — any slice run happens in a worktree/branch, NEVER auto-merged to `main`.**
  The loop's job is to *start* harnesses and *route* work, not to land it. A T2 dispatch (a real slice
  run) is created in an **isolated git worktree on its own branch** (exactly like this `ovh/phase5`
  worktree). The loop NEVER runs `git merge`, `git push`, or anything that touches the integration
  branch. Merging stays a separate, human-gated act. *(The `--execute` layer relaxes this to a
  **manual-gated** auto-merge — only via `gated-merge`, only with a present human + an opt-in flag +
  a human-authored spec + trust + a grader-OK; scheduled/synthesized never land. See "The SAFETY
  MODEL" below.)*

- **[c] SURFACE — the owner's briefing for every dispatched item is surfaced for human review before
  any merge.** Each slice run already ends by persisting an owner's briefing to `docs/briefings/`
  (engine ITEM 2) and follow-ups to `docs/BACKLOG.md`. The outer loop's contract is that this
  briefing is **presented to the human as the merge gate** — the human reads "what was decided, what's
  buried, what to verify by hand" and *then* decides to merge. No briefing read → no merge. The loop
  surfaces; it does not approve.

- **[d] maker ≠ checker — "is this backlog item done?" is graded by a SEPARATE small model, never the
  doer.** This is the engine's executor≠verifier invariant lifted to the loop's own stopping
  condition. The agent (or slice run) that *did* the work must never be the one that declares the
  backlog item satisfied — that is self-grading, the exact failure mode the whole system exists to
  prevent. A separate, small, cheap model reads the briefing + the item's acceptance text and returns a
  done / not-done verdict. The doer proposes; an independent grader disposes; the human ratifies.

## Composed from existing pieces — this layer adds almost no new surface

The outer loop is deliberately *thin*. It is not a new engine; it is a coordinator over parts that
already exist and already carry their own guarantees:

| Role | Existing piece | What it already gives us |
|---|---|---|
| **The harness** (does one unit of work, trustworthily) | `slice` (this skill) | All four trust invariants, per-leaf commits, owner's briefing. |
| **The heartbeat** (runs the driver on an interval / schedule) | the `/loop` + `/schedule` skills | Recurrence, self-pacing, cron — none of which we have to build. |
| **The memory** (survives the conversation) | the per-call JSONL run-trace, engine ITEM 7 (`docs/run-traces/<baseSha>.jsonl`) | A machine-readable record of every agent call + verdict from each run — what a later loop iteration *reads about itself*. |
| **The work source** (what to do next) | `docs/BACKLOG.md` | The human-curated queue; the engine already pushes follow-ups here at integrate. |

So the *new* surface this layer introduces is just: this document, and a small dry-run driver
(`scripts/outer-loop.mjs`). Everything load-bearing — trust, memory, recurrence, work discovery — is
borrowed from pieces that already shipped and already passed their own gates.

## The driver — `scripts/outer-loop.mjs`

A minimal, zero-dependency, Node-native driver with two faces (see "The `--execute` layer" below for
the second). The **planner** face (`--plan`, the historical default) is a pure **dry run**:

1. reads `docs/BACKLOG.md` and splits it into items (one per `- [ ]` / `- [x]` checklist line),
2. classifies each *open* item by a simple tier heuristic, and
3. **prints the dispatch plan** — per item: its tier, and for a T2 item the slice lane-spec it
   *would* use. It dispatches **nothing**: no slice run, no git, no network. The plan is for a human
   to read.

The **execute** face adds the deterministic git/fs subcommands (`worktree`, `gated-merge`, `ledger`)
that the harness orchestration calls between model turns — covered in full below.

The tiers:

- **T0 — trivial** (e.g. doc-only, rename, comment). The loop would note it; not worth a harness.
- **T1 — inline** — a *diagnosed*, single-line / known fix. The kind of thing SKILL.md says to "do
  directly", not slice. The loop would hand this to a single inline agent (not the recursive engine).
- **T2 — slice** — ≥2 risky leaves, an unknown decomposition, or a "migrate / refactor across …"
  shape. This is exactly what `slice` exists for, so the loop would dispatch a real slice run — **in a
  branch, never merged** (invariant [b]).

## The `--execute` layer — a HARNESS-ORCHESTRATED loop on DETERMINISTIC plumbing

`--execute` turns the plan into work. The key architectural fact: **a plain Node script cannot do
it.** Dispatching `slice` needs the Workflow runtime; grading needs a *model*. Neither lives in a
`.mjs`. So the layer is split in two:

- **the DETERMINISTIC PLUMBING** — `outer-loop.mjs`'s subcommands (`--plan`, `worktree`,
  `gated-merge`, `ledger`). Each is a small, boring, unit-tested git/fs step that **dispatches no
  model**. This is all the script does.
- **the MODEL ORCHESTRATION** — a Claude session (or a scheduled cloud-agent) that *reads the plan*,
  *calls `slice` via the Workflow tool*, *runs a separate-model grader*, and *calls the plumbing
  subcommands between those model turns*. This is the procedure below — run by the harness, **not** by
  the script. Running `outer-loop.mjs --execute` as a bare flag therefore **prints this procedure and
  refuses to auto-run** (it points back here); it never invokes slice or a model.

### The deterministic subcommands (what the orchestration calls)

| Subcommand | What it does (deterministically) | Touches `main`? |
|---|---|---|
| `--plan [backlog]` | classify the backlog, print the dispatch plan (the historical dry run) | no |
| `worktree <slug>` | `git worktree add <root>/.loop/<slug> -b loop/<slug> <main HEAD>`; print the path. Fails clearly if the branch/path exists (no clobber). | no |
| `gated-merge <branch>` | **THE SAFETY GATE** — the *only* command that can touch `main`. Triple-gated; see below. | **only on full pass** |
| `ledger <id> <status> [json]` | append one line to `docs/loop-status.jsonl`. **No clock** — any timestamp is a caller-supplied arg (`{"ts":…}`) or omitted, so the step is deterministic. | no |
| `ledger --done? <id>` | resume query — prints `DONE` iff the item's *most recent* status is terminal (`done`/`merged`), else `NOT-DONE`. | no |

### The orchestration PROCEDURE (the steps the harness runs)

1. **`--plan`** the backlog. Take the **T2** items (slice-shaped). Optionally bound the run with
   `--max N` (cap how many items) and **W** = max concurrent lanes.
2. For each T2 item, **up to W concurrent** (bounded-parallel dispatch), and up to `--max`:
   1. **resume check** — `ledger --done? <id>`; if `DONE`, **skip** (idempotent re-runs).
   2. **lane-spec** — if the backlog item is terse, *synthesize* a fuller lane-spec for slice. **MARK
      it synthesized** (e.g. `ledger … {"synthesizedSpec":true}`) — this flag is load-bearing: a
      synthesized spec can **never** auto-merge (safeguard below).
   3. **`worktree <slug>`** — isolate the lane on `loop/<slug>` off the current `main` HEAD.
   4. **dispatch slice** — the harness runs `slice` **via the Workflow tool**, on the lane-spec, **in
      that worktree**. Slice does its own decompose → TDD → adversarial verify → per-leaf commits →
      integrate → owner's briefing, *all on the branch*. (The script does not do this step.)
   5. **read the result** — `overallTrust`, `ownersHeadline`, `degradations`, and the owner's
      briefing slice persisted to `docs/briefings/`.
   6. **grade** — a **SEPARATE-MODEL grader** (maker ≠ checker) reads the briefing + the **ORIGINAL**
      backlog item text and judges one question: *does this resolve the original item's intent?* Its
      verdict is **advisory** — it gates auto-merge but never *forces* a merge.
   7. **land decision** — call `gated-merge loop/<slug>` **only if ALL** of:
      - this is a **manual** run (a human is present), **and**
      - `--auto-merge-trusted` was passed (opt-in), **and**
      - the lane-spec is **human-authored** (not synthesized), **and**
      - `overallTrust` is true (slice's own trust held), **and**
      - the grader said **OK**.
      Otherwise **leave the branch** for human review. `gated-merge` itself re-checks the hard
      invariants (clean main, not scheduled, gate green) and **aborts** on any doubt.
   8. **`ledger`** the outcome (`merged` / `branch-left` / `graded-no` / `slice-degraded` …, with the
      branch, trust, and grader verdict in the json).
3. **DIGEST** — surface a final digest (every lane: branch, trust, grader verdict, merged-or-left,
   and the briefing link) **for human review**. Unmerged lanes wait on a human reading the briefing.

### `gated-merge` — the triple gate (the one place that touches `main`)

`gated-merge <branch>` **defaults to ABORT** and leaves `main` byte-for-byte unchanged on any doubt.
It exits non-zero on every abort. In order:

- **[a] preconditions.** Refuse immediately if `OUTER_LOOP_SCHEDULED` is set (*scheduled runs are
  branch-only — never auto-merge to main*), or if HEAD is **not `main`**, or if the working tree is
  **dirty**, or if the branch does not exist. → main untouched.
- **[b] merge.** `git merge --no-ff --no-edit <branch>`. On **conflict** → `git merge --abort` →
  report *“conflict, left as branch”*. → main restored.
- **[c] re-gate.** After a *clean* merge, **re-run the integrate gate** (`sh scripts/build-engine.sh
  && node --test test/scenarios.test.mjs`) on the just-merged tree. If it goes **RED** → `git reset
  --hard HEAD@{1}` (undo the merge commit) → report *“post-merge red, reverted, left as branch”*. →
  main restored to the pre-merge tip.
- **[d] keep.** Only if the merge was clean **and** the re-gate is green → keep it → report
  *“merged <sha>”*.

> The gate is *serialized*: it runs on a single clean `main` checkout, one branch at a time. Lanes
> dispatch in parallel (autonomy of *trying*), but landing is one-at-a-time and re-gated (autonomy of
> *landing* is narrow and supervised).

## The SAFETY MODEL (stated explicitly)

The four original invariants ([a] opt-in, [b] dispatch-only/never-auto-merge, [c] surface, [d] maker
≠ checker) still hold — with **exactly two relaxed**, and only under tight, opt-in, human-present
conditions:

1. **[b] never-auto-merge → MANUAL-GATED auto-merge.** The loop *may* now merge to `main` — but only
   through `gated-merge`, and only when **manual + `--auto-merge-trusted` + human-authored spec +
   `overallTrust` + grader-OK** all hold. The default remains branch-only.
2. **[a] opt-in → opt-in *with a present human* for landing.** Trying (dispatch on a branch) is
   autonomous; **landing** additionally requires a human to be present (manual run). Scheduled runs
   never land.

Every safeguard that makes the relaxation safe:

- **triple gate** — `gated-merge`'s [a]/[b]/[c]/[d] above (precondition → no-ff merge → re-gate →
  keep), default-abort.
- **serialized landing** — merges happen one branch at a time on a single clean `main`.
- **re-gated post-merge** — the integrate gate (build + 41 scenarios) re-runs *after* the merge; red
  ⇒ auto-revert.
- **abort-on-red / abort-on-conflict** — either condition reverts `main` to its exact prior SHA and
  leaves the work as a branch.
- **scheduled-branch-only** — `OUTER_LOOP_SCHEDULED=1` makes `gated-merge` refuse outright; a
  scheduled agent can dispatch and brief but can **never** land.
- **synthesized-never-auto-merge** — a lane-spec the harness *synthesized* (because the item was
  terse) is marked `synthesized` and is **never** eligible for auto-merge; it always branches +
  waits for human review.
- **ledger-resume** — `docs/loop-status.jsonl` records every lane; `ledger --done?` lets a re-run
  (or a resumed scheduled run) **skip** already-landed items idempotently.
- **run-trace audit** — slice already writes a per-call JSONL run-trace (engine ITEM 7,
  `docs/run-traces/<baseSha>.jsonl`); the loop's ledger sits beside it, so every dispatch + verdict
  is auditable after the fact.
- **kill-switch** — there is no daemon; the human stops the harness session (or pauses the schedule)
  to halt the loop. `--execute` as a bare flag refuses to auto-run, so nothing starts itself.

**Principle:** *try-on-a-branch autonomy is fine; land-to-`main` autonomy requires human-authored
intent + a present human.* The loop may attempt freely in isolation; it may only **land** when a
human asked for landing (manual + `--auto-merge-trusted`), authored the intent (non-synthesized
spec), and an independent grader + slice's own trust both held — and even then the gate can still
abort and leave it as a branch.

## `/schedule` setup — a BRANCH-ONLY scheduled run

A scheduled cloud-agent (the `/schedule` skill) runs the **same orchestration**, but with
`OUTER_LOOP_SCHEDULED=1` exported, so step 2.7's `gated-merge` is **refused** — every lane stays a
branch and the agent surfaces a digest the human merges later. Concretely, the routine's prompt is:

```sh
# Scheduled OUTER LOOP — BRANCH-ONLY (never lands to main).
export OUTER_LOOP_SCHEDULED=1            # makes `gated-merge` refuse — the hard branch-only guard

# The agent then drives the orchestration procedure above:
#   node skills/slice/scripts/outer-loop.mjs --plan docs/BACKLOG.md      # classify
#   for each T2 item (bounded W, up to --max), skipping ledger --done? hits:
#     node skills/slice/scripts/outer-loop.mjs worktree <slug>           # isolate on loop/<slug>
#     <dispatch slice via the Workflow tool in that worktree>            # the model step
#     <separate-model grader judges resolves-original-intent?>           # the model step
#     node skills/slice/scripts/outer-loop.mjs gated-merge loop/<slug>   # REFUSED (scheduled) -> stays a branch
#     node skills/slice/scripts/outer-loop.mjs ledger <id> branch-left '{"branch":"loop/<slug>", ...}'
# Finally: surface a DIGEST of all branches + briefings for the human to review and merge later.
```

Even if every other condition were met, `gated-merge` aborts under `OUTER_LOOP_SCHEDULED` with
*“scheduled runs are branch-only”* and `main` is never touched. (This is a doc/snippet only — no cron
is installed here; wiring it into `/schedule` is a deliberate, separate, human act.)
