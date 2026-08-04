# Orchestration primitives — the parts bin

Paste-ready blocks for hand-authoring a per-task Workflow script. Each block is a
pattern proven across ~150 real hand-written workflows; the failure modes listed are
ones actually observed in session logs, not hypotheticals.

Composition rule: pick ONE graph shape, wire ONE verifier behind it, set budget, done.
A 10-line script from these parts beats a generic engine — the engine cannot know your
task's shape; you do. For the canned review shape, use `review.js` instead of assembling.

Conventions used by every block: `agent()` returns null on failure → always
`.filter(Boolean)`; every fan-out carries a `schema` (unstructured returns rot into
prose); `Date.now()`/`Math.random()` are unavailable in Workflow scripts.

---

## Graph shapes — how units connect

### scope-gate (run FIRST, before any fan-out)

Pin what is being worked on with one agent; abort early when empty. Fanning out
before scoping wastes the whole fleet on a wrong or empty target.

```js
const scope = await agent(
  `Pin the exact diff command for <target> in <repo>, run it (must be non-empty), ` +
  `list changed files, summarize in one paragraph, note conventions from applicable CLAUDE.md/AGENTS.md. ` +
  `Structured output only.`,
  { label: 'scope', schema: { type: 'object', required: ['diffCommand', 'files', 'summary'],
    properties: { diffCommand: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
                  summary: { type: 'string' }, conventions: { type: 'string' } } } })
if (!scope || !scope.files?.length) return { summary: 'nothing to do' }
const SCOPE_BLOCK = `Diff: ${scope.diffCommand}\nFiles: ${scope.files.join(', ')}\n${scope.summary}`
// → inline SCOPE_BLOCK into every downstream prompt: fetch once, share everywhere.
```

Failure mode: each lane re-deriving the diff itself — N× the cost and lanes silently
reviewing different diffs.

### lens-fanout (parallel perspectives over ONE target)

One agent per perspective, shared scope block, shared schema. Diversity of lens beats
redundancy of identical reviewers.

```js
const LANES = [
  { name: 'correctness', prompt: '...axis text...' },
  { name: 'fundamentals', skillPath: '~/.claude/skills/code-fundamentals/SKILL.md' }, // lens = a skill guide
]
const out = (await parallel(LANES.map(l => () =>
  agent(`${SCOPE_BLOCK}\nLens: ${l.skillPath ? `Read ${l.skillPath} first, apply its principles` : l.prompt}\n` +
        `Do NOT pad — zero findings is a valid answer. file:line per finding.`,
    { label: `lane:${l.name}`, schema: FINDINGS })))).filter(Boolean).flat()
```

Failure mode: lanes without "do not pad" produce filler findings that swamp the
verify pass.

### per-item-review (parallel verdicts over MANY targets)

One reviewer per item (branch / PR / module / bug claim), each returning a
gate verdict. Use when the list is the task.

```js
const ITEMS = [{ name: 'fix/p0-correctness', note: 'billing logic — review strictly' }, /* … */]
const results = await parallel(ITEMS.map(x => () =>
  agent(`Final-gate review of ${x.name} — ${x.note}. Read the FULL diff; blockers = ` +
        `"will actually break if merged" only, improvements go to nits.`,
    { label: `review:${x.name}`, schema: { type: 'object', required: ['verdict', 'blockers', 'nits'],
      properties: { verdict: { enum: ['ship', 'fix-first'] },
                    blockers: { type: 'array', items: { type: 'object' } },
                    nits: { type: 'array', items: { type: 'string' } } } } })))
```

### judge-panel (N independent attempts → cross-judge → synthesize)

For design questions with a wide solution space. Generate attempts from DIFFERENT
angles (not N copies of the same prompt), judge, then synthesize from the winner
grafting runners-up ideas.

```js
const ANGLES = ['minimal-change-first', 'invariant-first', 'user-observable-first']
const designs = (await parallel(ANGLES.map(a => () =>
  agent(`Design a solution for <problem>, optimizing ${a}. Constraints: ...`,
    { label: `design:${a}`, schema: DESIGN })))).filter(Boolean)
const scores = (await parallel(designs.map((d, i) => () =>
  agent(`Score this design 1-10 per criterion (correctness/simplicity/blast-radius), justify: ${JSON.stringify(d)}`,
    { label: `judge:${i}`, schema: SCORE })))).filter(Boolean)
// pick winner in plain code, then one synthesize agent.
```

### loop-until-dry (unknown-size discovery)

Keep spawning finders until K consecutive rounds surface nothing new. A fixed
`while count < N` misses the tail; a single pass misses everything past its cap.

```js
const seen = new Set(); const found = []; let dry = 0
while (dry < 2) {
  const round = (await parallel(FINDERS.map(f => () =>
    agent(f.prompt, { schema: BUGS })))).filter(Boolean).flatMap(r => r.bugs)
  const fresh = round.filter(b => !seen.has(key(b)))       // dedup vs SEEN, not vs confirmed —
  if (!fresh.length) { dry++; continue }                    // else judge-rejected items reappear forever
  dry = 0; fresh.forEach(b => seen.add(key(b)))
  found.push(...fresh)
}
```

### sweep (second pass hunting only gaps)

After the main pass, one fresh agent told what is ALREADY found, hunting only for
what the first pass tends to miss. Cheap recall insurance.

```js
const sweep = await agent(
  `${SCOPE_BLOCK}\nAlready found (do NOT re-derive):\n${kept.map(f => `- ${f.file_line} ${f.problem}`).join('\n')}\n` +
  `Re-read the diff looking ONLY for defects not listed: moved code that dropped a guard, ` +
  `setup/teardown asymmetry, config defaults flipped. Empty list if nothing new — do not pad.`,
  { label: 'sweep', schema: FINDINGS })
```

---

## Verifiers — closing the loop honestly

### adversarial-refute (the core trust gate)

Never let a finder's claim reach the report unverified. Verifiers are prompted to
DESTROY the claim, with a recall guard so realistic-state bugs survive.

```js
const VERDICT_LADDER =
  `- CONFIRMED — name the inputs/state that trigger it and the wrong output. Quote the line.\n` +
  `- PLAUSIBLE — mechanism real, trigger uncertain. State what would confirm it.\n` +
  `- REFUTED — factually wrong or guarded elsewhere. Quote the line that proves it.\n` +
  `PLAUSIBLE by default: races, rare-but-reachable paths, falsy-zero, unexcluded boundaries are NOT "speculative". ` +
  `REFUTED only when constructible from the code.`
// One verifier per FILE (group near-miss line numbers together), verdict per candidate by [i] index:
const verdicts = await parallel(groups.map(g => () =>
  agent(`ADVERSARIAL verifier — refute, don't re-confirm. Re-read the ACTUAL file yourself; never trust the excerpt.\n` +
        `${SCOPE_BLOCK}\nCandidates:\n${g.map((f, i) => `[${i}] ${f.file_line} — ${f.problem}`).join('\n')}\n${VERDICT_LADDER}`,
    { label: `verify:${g[0].file_line}`, schema: GROUP_VERDICTS })))
// verifier returned null → DROP that group. Unverified must never be reported as verified.
```

Failure modes observed: (a) verifier prompts without the recall guard refute every
timing bug as "speculative"; (b) reporting a candidate whose verifier died — the
false-green the whole pass exists to prevent.

### deterministic-gate (shell truth before model judgment)

Where a compiler/test/linter can answer, run IT — an agent's opinion adds nothing.
Model verdicts are for what the shell cannot decide.

```js
const gate = await agent(
  `Run: <build + filtered test command>. Report exit code and the failing test names verbatim. ` +
  `Do NOT interpret or fix anything.`, { label: 'gate', schema: GATE })
if (!gate || gate.exitCode !== 0) return { verdict: 'red', gate }
```

Failure mode: "tests pass" claimed from reading the code. Require the exit code.

---

## Budget — bounding the loop

### model-tiering

Match lane cost to lane difficulty at write time: mechanical scans on `haiku`,
standard lanes inherit the session model (omit `model`), the one genuinely hard
lens on the top tier. Observed: hygiene lanes on haiku are ~free; promoting them
buys nothing.

```js
{ name: 'hygiene', model: 'haiku' }      // mechanical scan
{ name: 'correctness' }                  // inherit — the default; omit model unless sure
{ name: 'threading', model: 'opus', effort: 'high' }  // the one hard lens
```

### size-tier gate

Scale ceremony to diff size in plain code — a 3-line diff does not need 5 lanes.

```js
const lines = /* parse from scope */ 0
const TIER = lines < 40 ? 'small' : lines < 400 ? 'std' : 'large'
const LANES = TIER === 'small' ? CORE_LANES.slice(0, 2) : TIER === 'std' ? CORE_LANES : ALL_LANES
```

### budget-loop

For open-ended work under a token target, guard on `budget.total` — with no target,
`remaining()` is Infinity and the loop runs to the agent cap.

```js
while (budget.total && budget.remaining() > 50_000) { /* one more round */ }
```

### caps + honest truncation

Every report has a cap; every cap logs what it dropped. Silent truncation reads as
"covered everything" when it didn't.

```js
const report = kept.slice(0, MAX)
if (kept.length > MAX) log(`${kept.length - MAX} findings dropped by cap`)
```

---

## Isolation — blast radius when a unit misbehaves

### read-only-review

Review/investigate lanes state it in the prompt and get no write path:
`(read-only — do not modify anything)`. A reviewer that "helpfully" fixes what it
reads corrupts the tree mid-scan for every sibling lane.

### worktree-fanout (build lanes only)

Parallel agents that MUTATE files need disjoint trees; reviewers do not.

```js
// inside the Workflow tool: per-agent worktree isolation
agent(prompt, { isolation: 'worktree' })
```

Rules that survived contact: file-disjoint cores in parallel, shared-file wiring as
a final sequential step; one workflow per working tree, always; after killing a run,
also kill its orphaned test runners (`ps` for old-etime ~0%-CPU processes) — the
orphan holds the build lock and the next run "hangs" at 0% CPU.

For a full build lane (decompose → TDD leaves → integrate), do not assemble it from
these blocks — use the real-exec runtime (`runtime/`), which exists precisely because
build loops are shell-bound.

---

## Output discipline — what every block above assumes

- **Schema per fan-out.** `{ schema }` on every `agent()` in a `parallel()`. Free-text
  returns cannot be deduped, ranked, or gated.
- **`.filter(Boolean)` after every `parallel()`.** A dead agent is null, not an error.
- **Dedup in plain code, not with an agent.** Same file:line from two lanes = one
  finding, keep the highest severity, union the lens names. Sorting, ranking, capping,
  grouping: all plain JS. Agents are for judgment, code is for bookkeeping.
- **"Do not pad — zero findings is a valid answer"** in every finder/reviewer prompt.
- **Severity ladder** in every review prompt: `[MUST]` clear defect / `[SHOULD]`
  recommended / `[NIT]` taste — and MUST outranks everything when a cap forces a cut.
