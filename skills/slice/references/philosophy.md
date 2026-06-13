# Philosophy — trust as the objective function

Source: Kent Beck's *tidyfirst* essays — **Trust Factory**, **Mastering Programming**,
**Canon TDD**, **Design in TDD** — synthesized, then read critically for the *agent* context.
(Full annotated bibliography — every Beck essay plus the contemporary agent-systems sources,
each mapped to the engine — in [sources.md](sources.md).)

## 1. Trust is the goal; TDD/SDD are mechanisms

The starting intuition: spec-driven and test-driven development are not ends in themselves —
they exist to produce **trust**. Beck's *Trust Factory* makes trust the explicit output:
XP's practices, principles, and values are a deliberate machine for *generating
trustworthiness*.

The load-bearing insight is an **asymmetry**:

> "Trust accumulates slowly & evaporates in an instant."

Code is repairable in proportion to the time spent creating it; trust is not. A single bad
incident (data loss, a confident-but-wrong answer, a silent corruption) destroys more trust
than dozens of features build. **This asymmetry dictates strategy: optimize against
catastrophic trust loss, not for marginal speed.**

### Distinguish reliability from trust
- **Reliability** is a property of the system ("is this code correct?").
- **Trust** is a relationship ("can I rely on this code/team/person over time?").

Beck means the latter. This is why trust is the concept *above* TDD: reliability is only one
input to trust. You can have 100% coverage and still lose trust — by hiding a failure, being
unresponsive, or *surprising* someone.

### Trust decomposed (where it actually dies)
```
Trust  ← the objective
 ├─ Intent alignment   "what we built matches what we agreed"   → SDD / spec
 ├─ Internal correctness "I can change it and prove nothing broke" → TDD / types / tests
 ├─ Non-surprise        "no unexpected failures"                  → CI/CD, observability, small reversible steps
 └─ Relational honesty  "failures are surfaced, not hidden"       → transparent reporting, owning failures
```
TDD/SDD cover the top two lines. **Trust usually dies on the bottom two** — which is why a
trust-first system must bake in non-surprise (loud, contained failures) and honest reporting,
not just verification.

### The complement: ceremony scales with the trust *deficit*

The asymmetry says never trade the floor away for speed. It does **not** say maximize ceremony.
Trust you already hold is *free*: a clean compile, a green filtered test, a diff small enough to
read whole and revert in one commit manufacture trust **deterministically**, at zero agent cost.
Spend the expensive trust-manufacturing — separate executor≠verifier, adversarial verification,
parallel-worktree lanes — only on the **deficit**: the seams where you cannot yet *see* it is
right. Beck says this three ways: *Scope Management 101* ("excessive quality for your purpose is
waste"), *First Principles First* ("the simplest tool that reveals the flaw"), *The Documentation
Tradeoff* ("justify every document"). Uniform max-ceremony is not rigor — it lowers **trust per
hour**, and a tool that turns a ten-minute change into an hour teaches its owner to distrust it,
which is itself a trust loss. **Guarantee the floor at every tier; let the ceremony above the
floor scale with the deficit.** The operational ladder (T0 deterministic / T1 legible-inline /
T2 manufactured-parallel) lives in [SKILL.md](../SKILL.md).

### The same principle, the scope axis

Ceremony is one axis; **scope** is the other. Absent code is the highest-trust code — nothing to
surprise the owner, nothing to verify, nothing to rot. So *before* "how much ceremony does this
code need?" comes "**how little code?**": does it need to exist (YAGNI), does stdlib / a native
feature / an installed dep already do it, can it be one line — stop at the first rung that holds,
as a reflex, not a research project (deliberating about what *not* to build is itself a cost that
buys no trust — a minimalism process that ruminates can run slower than no process at all). Both
axes serve trust-per-effort and both keep the same floor: validation at trust boundaries, error
handling that prevents data loss, security, and accessibility are never simplified away.
(Generalized from the "lazy senior dev" ladder — anchored on trust, not laziness; minimalism here
is a *trust* claim, not a style. The scope floor's operational home is `code-fundamentals` §0.)

## 2. Mastering Programming — the decomposition discipline

Beck's master-vs-journeyman heuristics are all about **"scaling your brain" by solving fewer
problems at once**. They map directly onto agent design (an isolated sub-agent context *is*
"one thing at a time"):

- **Slicing** — break a project into thin slices, rearrange for your context.
- **One thing at a time** / **make it run → make it right → make it fast**.
- **Easy changes** — when a change is hard, first restructure so it becomes easy ("make the
  change easy, then make the easy change").
- **Concentration / Isolation** — gather the change into one place / extract the part that
  must change.
- **Baseline Measurement** — measure before you fix, so improvement is provable.
- **Call your shot / Concrete hypotheses** — predict behavior *before* running. (The single
  most important discipline for agents — the antidote to confident-but-wrong.)
- **Symmetry / Aesthetics / Rhythm / Tradeoffs** — taste as a guide.
- **Fun list / 80-15-5 / Feed ideas** — portfolio/risk management.

**These are the *mechanism*; Trust Factory is the *objective function*.** An agent system
that embodies both = agents that decompose work (master heuristics) in service of accumulating
trust (trust factory), each step leaving visible evidence and avoiding surprise.

## 3. Canon TDD — the leaf loop

Beck's canonical five steps:
1. Write a **test list** (scenarios/edge cases) — behavioral analysis *up front*.
2. Turn **exactly one** item into a concrete, runnable test.
3. Change code to make it + all previous tests pass (adding to the list as you discover).
4. **Optionally** refactor.
5. Repeat until the list is empty.

Corrections Beck stresses: the **test list is the step everyone skips**; **one test at a
time** (speculative tests cause rework); **refactor after green, not during** ("don't wear two
hats"); interface design happens when writing the test, implementation design when refactoring.

The skill of turning a behavior *into* that test list — decomposing a large behavior into pieces
whose **combination** validates the whole, discovered piecemeal rather than known up front — is
what Beck calls **behavioral composition** (*TDD's Missing Skill*). It is the same move as slicing
a leaf, one altitude down: the Slicer composes behavior across leaves; Canon TDD composes it
*within* a leaf.

## 4. Design in TDD — where design lives

Design happens in **two** places in the loop: **writing the test** (interface/API design) and
**refactoring** (implementation/structure design). Red/green are *behavior*; write-test and
refactor are *structure*. The refactor question: *"what design, if I'd had it, would have made
this implementation easy?"* Beck defends emergent, incremental design — "design like a tree
designs, growing like a tree grows" — over up-front perfection, while admitting real risks:
local maxima, feature pressure, complexity blindness.

## 5. Critical reading — what changes for AGENTS

Beck writes for skilled humans. For LLM agents, several things invert (these drove the system
design):

1. **"One test at a time" fights parallelism — resolve by altitude.** Canon TDD is inherently
   sequential ("discover as you go"). Our recursion/slicing is the *test list* (behavioral
   analysis); Canon TDD is what runs *inside each leaf*. They compose at different altitudes.
   But: pre-freezing the whole decomposition then executing violates Beck's "don't turn all
   list items into tests at once" — so the engine **interleaves** decompose↔execute and feeds
   discovered scenarios back (lazy decomposition).

2. **Emergent design is *more* dangerous for agents → lean toward up-front interface design.**
   Beck's "tree grows" assumes human taste that notices the local maximum. Agents have weaker
   architectural taste *and can't see sibling slices*. So we move **interface design up to the
   Slicer** (which sees all siblings) as a *fixed contract*; the leaf designs only the
   implementation. This sides with Ousterhout more than Beck — *because of who holds the pen.*
   SDD (interface, top) complements TDD (implementation, leaf).

3. **"Fake it" + an incomplete test list = a false green.** Faking-to-pass relies on a
   *sufficient* list to force generalization. Agents routinely miss the killer edge case, so
   the verifier must specifically hunt hardcoded/over-fit implementations and vacuous tests.

4. **"Optional" refactor = "never" for agents.** Under any pressure an agent reads "optional"
   as "skip." So refactor is made *non-optional*: refactor, or state why none is needed.

5. **Test-list completeness is unbounded by the loop.** The loop only passes what's *in* the
   list; trust dies on the edge case nobody listed. Hence a **completeness critic** pass after
   slicing.

## 6. The genie principle (the architectural core)

Trust Factory's sharpest line for AI work:

> "Genies 'care' about satisfying prompts, not purposes."

The model is **least trustworthy exactly when trust matters most**. Therefore:

> **Control flow → deterministic code. Judgment → the model. Enforcement → mechanisms the
> model cannot talk its way past.**

Three tiers of defense, each catching the layer above:
| Tier | Means | Nature |
|---|---|---|
| Deterministic guards | JS (depth floor, caps, convergence guard, budget, tier-0 shell gate) | model can't override |
| Model judgment | schema'd agent calls (classify, slice, execute) | wobbles, but bounded |
| Adversarial verification | skeptical verifier reproducing evidence | safety net for the two above |

No single model decision is load-bearing for trust. That is the trust factory applied to the
orchestrator itself. See [architecture.md](architecture.md) for how this is realized.
