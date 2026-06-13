# Sources & further reading

The intellectual lineage behind the **slice / recursive-slice** engine, plus the
contemporary agent-systems writing that independently validates and extends it.
The *deep synthesis* of the core Beck essays lives in [philosophy.md](philosophy.md);
this file is the **catalog** — each entry is a faithful one-line thesis plus how it
maps to the engine.

> Theses are point-in-time summaries (fetched 2026-06-13) — read the originals for nuance.

---

## I. Kent Beck — the engine's foundations
*tidyfirst newsletter, https://newsletter.kentbeck.com*

### Core loop & decomposition
- **[Mastering Programming](https://newsletter.kentbeck.com/p/mastering-programming)** —
  master programmers scale by solving *fewer* things at once. Heuristics: Slicing, One Thing
  at a Time, Baseline Measurement, Concrete Hypotheses, Isolation, Symmetry, Call Your Shot,
  Make It Run/Right/Fast. → the decomposition discipline driving `slice-slicer` / `slice-assessor` / `slice-baseliner`.
- **[Canon TDD](https://newsletter.kentbeck.com/p/canon-tdd)** — the exact 5-step loop: list
  scenarios → turn *one* into a concrete test → make it (and all prior) pass → optionally
  refactor → repeat. Names the anti-patterns (deleting assertions, pasting computed values,
  abstracting too soon). → the leaf loop `slice-executor` runs, one test at a time.
- **[Design in TDD](https://newsletter.kentbeck.com/p/design-in-tdd)** — design *is* in TDD:
  two hats — behavior (red/green) vs structure (refactor); ask "what structure would have made
  this easier?" after green. → the executor's non-optional two-hat refactor.
- **[TDD's Missing Skill: Behavioral Composition](https://newsletter.kentbeck.com/p/tdds-missing-skill-behavioral-composition)** —
  break a big behavior into testable pieces whose *combination* validates the whole; the list
  is discovered piecemeal, not known upfront. → precisely what slicing a leaf into tests is.

### Trust, scope, quality
- **[Trust Factory](https://newsletter.kentbeck.com/p/trust-factory)** — code accumulates faster
  than trust; XP deliberately *manufactures* trust as its output ("slow down to go fast"). → the
  engine's **objective function**: every step leaves verifiable evidence and avoids silent surprise.
- **[Scope Management 101](https://newsletter.kentbeck.com/p/scope-management-101)** — scope is
  *discoverable*, not fixed; hold quality, make scope the variable, plan weekly. → vertical slices
  with per-leaf scope; "the list grows as you discover."
- **[Bugs Optional](https://newsletter.kentbeck.com/p/bugs-optional)** — Forest vs Desert: a bug
  should be a rare "anti-holiday" that triggers a systemic fix, not daily noise. → adversarial
  verification + regression-lock + per-leaf revert keep the baseline a floor.
- **[First Principles First](https://newsletter.kentbeck.com/p/first-principles-first)** — the
  value chain Effort→Output→Outcome→Impact; use the *simplest* tool that reveals the flaw;
  earlier-in-chain metrics are easy but gameable. → deterministic shell gates before model
  inference; `purposeCheck` measures impact, not activity.
- **[Measuring Developer Productivity](https://newsletter.kentbeck.com/p/measuring-developer-productivity)** —
  measure outcome/impact, not effort/output (which incentivizes gaming). → `purposeGap` over
  green-test theater; "please the customer once per week," not lines of code.
- **[Party of One for Code Review](https://newsletter.kentbeck.com/p/party-of-one-for-code-review)** —
  AI generates faster than any human can review; review's job shifts to **sanity-check intent**
  + **structural-drift detection**. → the refute-mode `slice-verifier` + the integrate wiring audit.
- **[The Documentation Tradeoff](https://newsletter.kentbeck.com/p/the-documentation-tradeoff)** —
  justify every doc (large audience × stable × low opp-cost); prefer simplify / socialize / test /
  code as communication. → the owner's briefing is *justified* comprehension-debt repayment; tests
  are guaranteed-current communication.

## II. Kent Beck — AI / augmented-coding economics
*Why an engine like this exists at all.*

- **[Augmented Coding: Beyond the Vibes](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes)** —
  unlike vibe coding, you *care* about the code, complexity, tests, coverage; constrain the agent
  with a `plan.md` (one test at a time); watch for three tells — unexpected loops, unrequested
  functionality, test-cheating. → the engine **is** this discipline, automated and adversarially gated.
- **[90% of My Skills Are Now Worth $0](https://newsletter.kentbeck.com/p/90-of-my-skills-are-now-worth-0)** —
  execution (completion, bug-fixing, wordsmithing) depreciates; *judgment* about when/how to deploy
  AI, and discerning good output from bad, appreciates. → the human stays the verifier/decider.
- **[Programming Deflation](https://newsletter.kentbeck.com/p/programming-deflation)** — productivity
  gains create a deflationary pull ("wait, it'll be cheaper tomorrow"); don't predict — build taste,
  integration, judgment that thrive either way.
- **[Slow Deployment Causes Meetings](https://newsletter.kentbeck.com/p/slow-deployment-causes-meetings)** —
  reverses the arrow: low deployment capacity *causes* overhead (meetings/reviews/handoffs) as a
  pressure valve. → per-leaf commits + integrate-once expand the far end of the hose; ceremony is a symptom, so the engine right-sizes it (inline known fixes, lane only risky seams).
- **[Sales Happen When Buyers Fear Missing Out](https://newsletter.kentbeck.com/p/sales-happen-when-buyers-fear-missing)** —
  FOMO drives purchasing more than rational ROI. *(business/persuasion; tangential to the engine —
  included for completeness of the referenced set.)*

## III. Contemporary agent systems
*This session's sources — the modern practice the engine already embodies. Detailed mapping in the
2026-06-13 conversation; see also [[recursive-slice-engine]] memory.*

- **Lee Robinson (Cursor) — "Building recursive agent systems"** (X long-form, quoted by
  [@lucas_flatwhite](https://x.com/lucas_flatwhite/status/2065755881321738621)) — Cursor runs
  *thousands* of agents to train Composer; they DM on Slack / page when stuck. → human as
  **exception-handler**, not in-loop executor; the engine's quota-halt → escalate-don't-grind.
- **[Lee Robinson — Coding Agents & Complexity Budgets](https://leerob.com/agents)** — agents flip
  the cost of abstraction ($260 / one weekend migration; subagent parallelization; `@browser`
  visual-validation loop). → inline-vs-lane right-sizing; "abstraction is expensive with AI."
- **[Avi Chawla / Akshay Pachaar — Your Agent Harness Should Repair Itself](https://blog.dailydoseofds.com/p/your-agent-harness-should-repair)** —
  closed-loop self-repair: bad trace → diagnose → diff → approve → rerun → regression-lock; Karpathy:
  "remove yourself as the bottleneck … put in very few tokens, a huge amount happens on your behalf."
  → the verifier's `prescription` + regression-as-test; "loop engineering."
- **[Martin Fowler — Harness Engineering](https://martinfowler.com/articles/harness-engineering.html)** —
  harness = everything but the model; dual loop: **feedforward (Guides)** before generation +
  **feedback (Sensors)** after; controls are computational (fast/deterministic) vs inferential. →
  relevance-gated domain guides + deterministic tier-0 gates.
- **[Self-Harness: Harnesses That Improve Themselves (arXiv 2606.09498)](https://arxiv.org/abs/2606.09498)** —
  agents mine their own failures and propose bounded harness edits, accepting only those that don't
  degrade a held-out split. → the discipline that makes self-modification safe (vs the 33.7%/11.8%
  fix-vs-regression-precision caveat Avi cites).
- **[Loop Engineering (Cobus Greyling)](https://cobusgreyling.substack.com/p/loop-engineering)** —
  builder time shifts from prompt-wrangling to *designing the self-repair loop itself*.
- **[Addy Osmani — Loop Engineering](https://addyosmani.com/blog/loop-engineering/)** — distinguishes
  *harness* engineering (one agent's environment — what slice IS) from *loop* engineering (a scheduled
  system that DISCOVERS work and dispatches harnesses); five pieces (automations, worktrees, skills, MCP
  connectors, sub-agent verifiers) + on-disk state + a separate small model for the stop condition. →
  slice is the harness; the outer scheduled loop is a layer we have the pieces for but haven't assembled.

## IV. Patterns adopted (scope axis)

- **[Ponytail — the "lazy senior dev" plugin](https://github.com/DietrichGebert/ponytail)** — a scope-
  minimalism ruleset (does it need to exist → stdlib → native → installed dep → one line → minimum),
  output-capped, deliberate simplifications marked with their ceiling + upgrade path; honest self-critical
  benchmarks (its own v1 was *slower* — it deliberated about what not to build). → the **scope axis** of
  our proportional-trust principle: `code-fundamentals` §0 (the scope floor) and slice SKILL.md's two
  reflexes derive from it, re-anchored on **trust** (absent code = nothing to surprise/verify/rot), not laziness.

---

*Provenance: §I–II added 2026-06-13 from the user-supplied Beck reading list; §III from the
two X posts ([@lucas_flatwhite](https://x.com/lucas_flatwhite/status/2065755881321738621),
[@_avichawla](https://x.com/_avichawla/status/2065727218991735000)) traced recursively to their
primary sources.*
