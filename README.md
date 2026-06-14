# Skills

soilSpoon's agent skills — a Claude Code plugin marketplace pairing a trust-first
engineering workflow with day-to-day dev, job-hunt, and research skills.

## Install

```
/plugin marketplace add soilSpoon/skills
/plugin install slice@soilspoon-skills            # trust-first decomposition workflow (+4 role agents)
/plugin install dev-toolkit@soilspoon-skills      # code & frontend fundamentals, build-config drift, root-cause workflow
/plugin install job-hunt@soilspoon-skills         # resume tailoring, Wishket applications
/plugin install research-tools@soilspoon-skills   # fact-checking, human-like browser automation
```

Every skill also installs standalone in any `SKILL.md`-compatible tool (Claude Code, opencode, …):

```
npx skills add soilSpoon/skills@<skill-name>
```

Contributing or growing a skill? See [docs/skill-hygiene.md](docs/skill-hygiene.md) for the
size budgets and structure rules that keep this repo lean.

## Plugins & Skills

Four plugins bundle nine skills. Pick a plugin for the whole set, or install any skill on its own.

| Plugin | Skills | For |
|---|---|---|
| [`slice`](#slice) | `slice` (+5 agents) | Decomposing big/risky/vague coding tasks into verifiable slices |
| [`dev-toolkit`](#dev-toolkit) | `code-fundamentals`, `toss-frontend-fundamentals`, `build-config-drift`, `issue-rootcause-workflow` | Code-quality review, frontend fundamentals, build/runtime diagnostics |
| [`job-hunt`](#job-hunt) | `tailor-resume`, `apply-wishket` | Resume tailoring and freelance-project applications |
| [`research-tools`](#research-tools) | `fact-check`, `human-like-browser` | Verifying content and driving the browser undetected |

---

## slice

Trust-first recursive decomposition of a development task — Kent Beck's *Mastering Programming*
heuristics (Slicing, Baseline Measurement, One-thing-at-a-time) as an executable workflow.

```bash
npx skills add soilSpoon/skills@slice
```

**What it does:**
- Pins a deterministic baseline (tests + invariants at a git SHA) before any work begins
- Recursively classifies the task (easy/hard × small/big) into thin vertical slices
- Executes each atomic leaf with Canon TDD (call-your-shot, one test at a time, two hats)
- Adversarially verifies every leaf (executor ≠ verifier, deterministic gates before model judgment, risk-tiered lenses)
- Self-repairs while issues strictly converge; halts the approach on an untrusted streak
- Lands one git commit per trusted leaf; deterministic full-suite gate at integrate
- Ends with an Owner's Briefing — a guided read to repay comprehension debt
- Optional parallel mode: isolated git worktrees per independent slice group (+ shared build scratch for compile-bound repos)

**Bundled:**
- `recursive-slice.js` — the workflow engine (run via the Workflow tool's `scriptPath`)
- `agents/slice-*.md` — the 4 roles (baseliner/slicer/executor/verifier) as standalone subagents — the slicer also owns the recursion-termination decision (the former assessor is folded into it)
- `references/` — architecture, philosophy, and battle-tested lessons (deadlocks, orphaned test runners, false greens)
- `scripts/` — live run viewer, no-focus window capture for visual UI verification (macOS)

---

## dev-toolkit

Engineering fundamentals and diagnostics. Four skills that review code quality, enforce frontend
fundamentals, and trace why something is broken at runtime even when static checks pass.

### code-fundamentals

The four axes of change-friendly code — readability, predictability, cohesion, coupling —
applied language-agnostically (examples are TS/React, but the axes hold for Swift, Kotlin, Python, Go…).

```bash
npx skills add soilSpoon/skills@code-fundamentals
```

**What it does:**
- Reviews/writes/refactors against the four axes, surfacing trade-offs rather than forcing one answer
- Starts at the "scope floor" — the most change-friendly code is no code (YAGNI, stdlib, native platform, existing deps)
- Splits large diffs into lanes (L1 readability+predictability, L2 cohesion+coupling) for uncontaminated review
- Progressive-loads only the relevant `references/` (readability, predictability, cohesion, coupling)
- Pairs with `toss-frontend-fundamentals` for UI code — this is the language-neutral core

### toss-frontend-fundamentals

Toss's [Frontend Fundamentals](https://frontend-fundamentals.com) — the four code-quality axes
plus accessibility (A11y) — as a frontend review & authoring guide.

```bash
npx skills add soilSpoon/skills@toss-frontend-fundamentals
```

**What it does:**
- React/TypeScript review/authoring with principle citation + before/after refactor + checklists
- 38+ row trigger map — detects an antipattern, then progressive-loads only that reference file
- Architecture patterns from Toss OSS PRs (es-toolkit, es-hangul, suspensive, use-funnel)
- Reflects key GitHub discussion threads (boolean naming, if-return, array types, MV-VI, …)
- Library-author patterns (subpath exports, attw/publint/sherif, Changesets, OIDC provenance) are opt-in

**References (progressive disclosure):**
- `references/readability.md`, `predictability.md`, `cohesion.md`, `coupling.md` — the four axes
- `references/a11y-basics.md`, `a11y-components.md`, `a11y-practical.md` — WAI-ARIA, Tab/Modal/Radio, antipatterns
- `references/recipes.md` — Modal, Form, Query Key Factory, overlay-kit, … (20 recipes)
- `references/discussions.md` — community thread summaries
- `references/library-patterns.md` — library-author only (opt-in)

### build-config-drift

Find, audit, and recover "build-config drift" debt — where lint/test/tsc/build all pass (or the
container is "up") but the runtime is silently broken.

```bash
npx skills add soilSpoon/skills@build-config-drift
```

**What it does:**
- Catches the debt at PR-review time instead of when someone finally boots `dev` weeks later
- Knows the failure modes: codemods that *add* but never *remove*, monorepo dep moves, hoisting illusions, merge ≠ resolution, compose-definition ≠ container-instance drift
- Runs a 5-step workflow: DETECT → SCOPE → AUDIT → CONSUMER-GREP → SMOKE
- Trigger map keys off real signals (`Can't resolve 'X'`, dual `eslint.config.js`+`.eslintrc`, `Restarting (N)` containers, …)
- Complements `issue-rootcause-workflow`: this is *discovery/audit* of static-change debt; that is debugging an observed runtime bug

**References:** case studies — tailwind/shadcn/postcss migration residue, merge import drift, Keycloak restart loop.

### issue-rootcause-workflow

A principle-driven workflow for reaching the root cause of a bug/regression instead of patching
the symptom.

```bash
npx skills add soilSpoon/skills@issue-rootcause-workflow
```

**What it does:**
- Restore the invariant, don't suppress the symptom — a recurring bug means the first fix wasn't the root
- Makes the workaround-vs-root-fix choice explicit and records why
- A/B with the smallest reliable repro, swapping one variable; verifies the hypothesis actually *arrived*
- Trusts contradictions (suspect the experiment first), checks recent changes + two code paths
- Variable enumeration & causal mapping (8 categories) as the prerequisite to every other principle
- Mechanism trace over blind variation — "X-specific" / "it's a limitation" is the lazy answer

**References:** principles + checklists, output templates, and case studies (LLVM/VTK, OCCT-WASM linker).

---

## job-hunt

### tailor-resume

Tailor a resume and career description to a specific job posting.

```bash
npx skills add soilSpoon/skills@tailor-resume
```

**What it does:**
- Analyzes job posting requirements and researches the company
- Filters the most relevant experience/skills from a master resume
- Generates a tailored variant and builds the PDF
- Scores it via the Groupby evaluator (서류 합격률 예측 + 이력서 강화 팩폭)

**Precondition:** needs a structured master resume (a `cv/master.yaml`-style source). Without one this
is generic resume writing, not this skill.

**Bundled scripts:**
- `scripts/groupby-api.mjs` — Groupby resume analysis API client (no browser needed)

### apply-wishket

Generate tailored proposals for [Wishket](https://wishket.com) freelance projects.

```bash
npx skills add soilSpoon/skills@apply-wishket
```

**What it does:**
- Analyzes project requirements from a Wishket URL or project ID
- Matches relevant experience from `master.yaml`
- Estimates cost and timeline with multi-step validation
- Generates a proposal with an issue→solution pattern and staged process
- Fact-checks output via parallel verification agents
- Supports single or batch (parallel sub-agent) processing

**Bundled scripts:**
- `scripts/verify-proposal.sh` — 12-point structural validation for generated proposals

---

## research-tools

### fact-check

Fact-check articles, newsletters, and written content by dispatching 6 parallel verification agents.

```bash
npx skills add soilSpoon/skills@fact-check
```

**What it does:**
- Accepts text, file path, or URL as input
- Extracts claims and classifies risk (high/medium/low)
- Dispatches 6 parallel agents: source verify, number check, freshness check, context check, link check, assumption check
- Cross-references results with a Tier 1–4 source-credibility system
- Auto-searches for higher-tier sources when only Tier 3–4 are found
- Outputs a structured report with verdicts, conflicts, and diff-style fix suggestions

### human-like-browser

Human-like browser automation that bypasses bot-detection systems.

```bash
npx skills add soilSpoon/skills@human-like-browser
```

**What it does:**
- Bezier-curve mouse movements with micro-tremor and Fitts's Law timing
- Log-normal typing delays with digraph timing and typo simulation (~600 chars/min)
- Smooth inertia scrolling with trackpad/mousewheel mix
- FCaptcha keystroke-biometrics bypass (autocorrelation, dwell variance, log-normal fit)
- Comprehensive anti-fingerprinting stealth (navigator.webdriver, hardware, WebGL, CDP artifacts)
- Auto-stealth on navigation, idle fidget, element-scoped scrolling; Korean QWERTY supported

**Bundled scripts:**
- `scripts/human-behavior.js` — initialization block reference (paste into Playwright `browser_run_code`)

## License

MIT
