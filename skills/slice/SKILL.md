---
name: slice
description: Trust-first decomposition of development work — a ceremony ladder that routes each task to the cheapest path that still manufactures the trust it lacks. T0 deterministic (just run the check), T1 inline TDD (most work), T2-review (canned parallel lens review), T2-assemble (compose orchestration primitives per-task), T2-build (real-exec engine for genuinely multi-leaf builds). Use whenever a coding task is big, risky, multi-file, or vague enough that "just doing it" could silently break things, whenever the user asks to decompose work or wants TDD discipline enforced, and for parallel review/audit/verification lanes. Works on any language/stack. Not for a single-file fix already diagnosed to a line — do that directly. Args = the task description (optionally with a repo path).
---

# /slice — trust-first routing

Priority: **Trust Factory first**, TDD + Tidy First as its mechanisms. The test is never
"did I run the full ceremony?" but "did I manufacture the trust this change actually
lacked, and no more?" Trust you already hold is free — a clean compile, a green filtered
test, a diff you can read whole. Spend ceremony only on the deficit.

Three reflexes before routing: (1) *Scope* — the cheapest, highest-trust change is the one
you don't make: YAGNI, stdlib, one line before fifty. (2) *Deliberation* — never spend
longer deciding than doing; prose defending a simplification is complexity smuggled back in.
(3) *Verifier cost* — when the trust-manufacturing verifier is itself expensive (a minutes-long
native/WASM build, an e2e run), tier verifiers instead of verifying less: the cheapest verifier
that catches THIS change's error class runs in the inner loop; the expensive one runs only at
integration checkpoints. Make a slow verifier cheaper, never rarer — the floor (a trustworthy
signal per change) is non-negotiable; only which verifier produces it scales with its cost.

## The ladder — take the LOWEST rung that guarantees the floor

The floor at every rung: baseline invariants protected, changes reversible, evidence left
behind. Only ceremony above the floor scales with risk.

**T0 — deterministic.** A compiler / type-check / filtered test already proves it → run it.
No agent, no orchestration.

**T1 — inline.** One change you can read whole + a filtered test → do it yourself, in this
conversation: failing test → fix → filtered suite → one commit. Two hats (behavior, then
structure), one head. **Default for most work — most tasks exit here.** This includes
audit-prescribed fixes with known remedies: the audit was the verification; a lane adds
wall-clock, not trust.

**T2 — orchestrated.** Three shapes, three routes. Pick by what the task IS:

| task shape | route |
|---|---|
| review / audit / verify a change, PR, branch set, or claim | **`templates/review.js`** via the Workflow tool |
| investigation / design / any custom multi-agent shape | **compose it from `templates/primitives.md`** |
| genuinely multi-leaf BUILD (≥2 risky leaves, unknown interface, cross-cutting plumbing) | **real-exec engine: `adapters/claude-agent-sdk/` or `adapters/opencode/`** |

**In-harness launch is retired** — never run `recursive-slice.js` via the Workflow tool.
(The FILE stays: it is the tsup bundle of `src/*.ts` that both runtime adapters load and
execute in a real Node process — deleting it breaks T2-build.) Measured against the
in-harness path: exec-less sandboxes turn every git/test/build into a subagent round-trip
(74-minute runs), its ledger tripped safety classifiers, per-leaf commits sprawled into
unreadable PRs, and long runs blew the driving context. The routes above keep its
discipline without its packaging.

### T2-review — `templates/review.js`

```
Workflow({ scriptPath: '<skill-base-dir>/templates/review.js', args: {
  repo: '/abs/path',                 // required
  target: 'PR 123' | 'git diff main...HEAD' | 'focus hints',
  context: 'one paragraph every lane should know',
  lenses: [{ name, skillPath }...],  // optional — default: correctness + 4-axis + hygiene
  items: [{ name, note }...],        // optional — per-branch/PR mode, verdict ship|fix-first
}})
```

Read-only, no worktrees, no commits. Auto-select `lenses` yourself (never make the user
ask): resolve installed skill guides by domain — `code-fundamentals` for any substantial
code, `toss-frontend-fundamentals` + `vercel-*` (if installed) for React/Next.js,
`build-config-drift` for deps/config migrations, `issue-rootcause-workflow` for bug-hunt
lanes. A missing guide is silently dropped, never a blocker.

### T2-assemble — `templates/primitives.md`

The parts bin: scope-gate, lens-fanout, per-item-review, judge-panel, loop-until-dry,
sweep, adversarial-refute, deterministic-gate, model-tiering, worktree-fanout. Pick one
graph shape, wire one verifier behind it, set budget — a 10-line per-task script from
proven parts beats a generic engine, because you know the task's shape and the engine
doesn't.

### T2-build — real-exec runtime

For a decompose → TDD-leaves → verify → integrate build lane, use the runtime adapter
(`adapters/claude-agent-sdk/run.mjs`, or `adapters/opencode/` on an opencode host — each
README has the invocation). Build loops are shell-bound; they need real exec, not
subagent-relayed shells. Before launching: quote a rough ETA (~leaf count × per-leaf
build+test cost — an uncomfortable number means you mis-tiered; drop known-remedy leaves
to T1), and require a clean quiesced tree.

## Writing a T2 task spec — a lane spec, not a wish

Precise specs run trusted; vague specs produce verifier rejections and repair loops.
Include: **Evidence** (defect/feature anchored to `file:line` — diagnose BEFORE launching,
not inside the run) · **MUST PRESERVE** (untested behaviors the run may not regress) ·
**Purpose** (what the USER observes afterward) · **Wiring clause** for UI/feature lanes
(name the real production path — the #1 recurring defect class is built-tested-but-unwired)
· **Known flakes** by name · **DISCOVERY POLICY** (mandatory): by default instruct
"record discovered items to the repo's BACKLOG — do NOT execute them"; discover-as-you-go
otherwise chains follow-up leaves and silently multiplies wall-clock (measured live:
a 4-leaf ~50-min lane became 11 leaves / ~100+ min on 19 discovered items — every one
real debt, and still the wrong default, because delivery time is itself a reliability
axis). A lane that SHOULD sweep discoveries opts in explicitly WITH a leaf cap.

## The four invariants (every rung, every route)

1. **executor ≠ verifier** — who builds it never solely judges it.
2. **Shell truth before model judgment** — exit codes over opinions.
3. **One trusted leaf = one commit** on the work branch; squash to land when the sum
   would sprawl (an unreadable PR is a trust failure too). **A lane is one hat**: never mix
   a tidy/cleanup lane and a behavior lane into one landing — commit-level two-hats does
   not survive the squash, lane-level separation does.
4. **Full suite only at integrate** — leaves run filtered tests.

## Reporting back

Report a trust ledger, not a wall of text: the baseline protected, the decomposition,
per-leaf trusted/untrusted, the deterministic integrate verdict, and anything flagged —
untrusted leaves and wiring gaps FIRST. Include a **tiering verdict**: per leaf, would T1
have sufficed in hindsight? Routing has no prospective gate (task shape isn't a
deterministic input), so this retrospective line is what tunes the routing reflex over time. Relay any owner's briefing in full and persist it
to `docs/briefings/<date>-<lane>.md` in the target repo; append follow-ups to
`docs/BACKLOG.md` (the repo remembers; the conversation doesn't). After a UI lane, render
the real interface and read the pixels yourself before handover — a green ledger proves
tests pass, not that the user can see the feature (macOS: `scripts/capture-window.sh
<AppName> /tmp/verify.png` captures occluded windows without stealing focus).

## Notes

- The four roles are standalone subagents (`slice-baseliner`, `slice-slicer`,
  `slice-executor`, `slice-verifier`) — spawn any one directly for a lighter interactive
  pass. If they're missing from the agent registry and this skill has an `agents/` dir,
  copy those files to `~/.claude/agents/` once (say so).
- No Workflow tool in the harness → `references/portable-orchestration.md` drives the
  same algorithm with plain subagents. The four invariants survive any port.
- Repo not under git → note it and offer `git init`: small reversible commits are
  themselves a trust mechanism, and git unlocks worktree isolation.
