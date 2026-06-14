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

## The four SAFETY INVARIANTS (these must NEVER break)

These are the outer-loop analogue of the engine's four trust invariants. They exist so that a
heartbeat — something that runs *repeatedly* and *unattended* — can never silently change `main` or
silently declare its own work "done".

- **[a] OPT-IN / explicit — the loop never runs on its own.** There is no daemon, no installed cron,
  no self-start. A human invokes `scripts/outer-loop.mjs` (or wires `/loop` / `/schedule` to it)
  deliberately, each time. The default invocation is a **dry run that dispatches nothing** — it only
  *prints a plan*. Autonomy is something the operator turns on, item by item, never the default.

- **[b] DISPATCH-ONLY — any slice run happens in a worktree/branch, NEVER auto-merged to `main`.**
  The loop's job is to *start* harnesses and *route* work, not to land it. A T2 dispatch (a real slice
  run) is created in an **isolated git worktree on its own branch** (exactly like this `ovh/phase5`
  worktree). The loop NEVER runs `git merge`, `git push`, or anything that touches the integration
  branch. Merging stays a separate, human-gated act.

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

A minimal, zero-dependency, Node-native driver. **Dry-run by default.** It:

1. reads `docs/BACKLOG.md` and splits it into items (one per `- [ ]` / `- [x]` checklist line),
2. classifies each *open* item by a simple tier heuristic, and
3. **prints the dispatch plan** — per item: its tier, and for a T2 item the slice lane-spec it
   *would* use. It dispatches **nothing**: no slice run, no git, no network. The plan is for a human
   to read.

The tiers:

- **T0 — trivial** (e.g. doc-only, rename, comment). The loop would note it; not worth a harness.
- **T1 — inline** — a *diagnosed*, single-line / known fix. The kind of thing SKILL.md says to "do
  directly", not slice. The loop would hand this to a single inline agent (not the recursive engine).
- **T2 — slice** — ≥2 risky leaves, an unknown decomposition, or a "migrate / refactor across …"
  shape. This is exactly what `slice` exists for, so the loop would dispatch a real slice run — **in a
  branch, never merged** (invariant [b]).

### A future `--execute` mode (documented, NOT implemented now)

A later, opt-in `--execute` mode *would* actually dispatch for T2 items — and only ever:

- create a **fresh worktree on a new branch** for the item,
- run `slice` there with the printed lane-spec,
- let the run produce its commits + owner's briefing **in that branch**, and
- **stop** — surfacing the briefing for human review (invariant [c]) and **never merging**
  (invariant [b]). The done/not-done call is made by a **separate small grader** (invariant [d]),
  whose verdict is *advisory to the human*, not an auto-merge trigger.

**This is explicitly out of scope right now.** The current deliverable is dispatch-only and
prints-only: no autonomous running, no self-improvement, no merge. The point of shipping the dry-run
driver first is to make the *plan* reviewable and the *pattern* documented, while autonomy stays a
deliberate, later, human-thrown switch. The default will always be dry-run; `--execute` will always
be the thing a human asks for, one run at a time.
