# Skills

AI agent skills collection — a Claude Code plugin marketplace.

## Install

```
/plugin marketplace add soilSpoon/skills
/plugin install slice@soilspoon-skills           # trust-first engineering workflow (+5 role agents)
/plugin install dev-toolkit@soilspoon-skills      # frontend fundamentals, build-config drift, root-cause workflow
/plugin install job-hunt@soilspoon-skills         # resume tailoring, Wishket applications
/plugin install research-tools@soilspoon-skills   # fact-checking, browser automation
```

Individual skills also install standalone (any SKILL.md-compatible tool — Claude Code, opencode, …):

```
npx skills add soilSpoon/skills@<skill-name>
```

Contributing or growing a skill? See [docs/skill-hygiene.md](docs/skill-hygiene.md) for size budgets and structure rules that keep this repo lean.

## Available Skills

### tailor-resume

Tailor resume and career description for a specific job posting.

```bash
npx skills add soilSpoon/skills@tailor-resume
```

**What it does:**
- Analyzes job posting requirements
- Filters relevant experience/skills from master resume data
- Generates a tailored variant
- Evaluates via Groupby API (서류 합격률 예측 + 이력서 강화 팩폭)

**Bundled scripts:**
- `scripts/groupby-api.mjs` — Groupby resume analysis API client (no browser needed)

### slice

Trust-first recursive decomposition of a development task — Kent Beck's *Mastering Programming* heuristics (Slicing, Baseline Measurement, One-thing-at-a-time) as an executable workflow.

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
- `agents/slice-*.md` — the 5 roles (baseliner/assessor/slicer/executor/verifier) as standalone subagents
- `references/` — architecture, philosophy, and 11 battle-tested lessons (deadlocks, orphaned test runners, false greens)
- `scripts/` — live run viewer, no-focus window capture for visual UI verification (macOS)

### fact-check

Fact-check articles, newsletters, and written content by dispatching 6 parallel verification agents.

```bash
npx skills add soilSpoon/skills@fact-check
```

**What it does:**
- Accepts text, file path, or URL as input
- Extracts claims and classifies risk (high/medium/low)
- Dispatches 6 parallel agents: source verify, number check, freshness check, context check, link check, assumption check
- Cross-references results with Tier 1-4 source credibility system
- Auto-searches for higher-tier sources when only Tier 3-4 found
- Outputs structured report with verdicts, conflicts, and diff-style fix suggestions

### human-like-browser

Human-like browser automation that bypasses bot detection systems.

```bash
npx skills add soilSpoon/skills@human-like-browser
```

**What it does:**
- Bezier-curve mouse movements with micro-tremor and Fitts's Law timing
- Log-normal typing delays with digraph timing and typo simulation (~600 chars/min)
- Smooth inertia scrolling with trackpad/mousewheel mix
- FCaptcha keystroke biometrics bypass (autocorrelation, dwell variance, log-normal fit)
- Comprehensive anti-fingerprinting stealth (navigator.webdriver, hardware, WebGL, CDP artifacts)
- Auto-stealth on navigation, idle fidget, element-scoped scrolling

**Bundled scripts:**
- `scripts/human-behavior.js` — Initialization block reference (paste into Playwright `browser_run_code`)

### apply-wishket

Generate tailored proposals for Wishket freelance projects.

```bash
npx skills add soilSpoon/skills@apply-wishket
```

**What it does:**
- Analyzes project requirements from Wishket URL or project ID
- Matches relevant experience from master.yaml
- Estimates cost and timeline with multi-step validation
- Generates proposal with issue→solution pattern and staged process
- Fact-checks output via parallel verification agents
- Supports single or batch (parallel) project processing

**Bundled scripts:**
- `scripts/verify-proposal.sh` — 12-point structural validation for generated proposals

### toss-frontend-fundamentals

Toss의 [Frontend Fundamentals](https://frontend-fundamentals.com) 코드 품질 4대 기준(가독성/예측가능성/응집도/결합도) + 접근성(A11y)을 반영하는 프론트엔드 코드 리뷰 & 작성 가이드.

```bash
npx skills add soilSpoon/skills@toss-frontend-fundamentals
```

**What it does:**
- React/TypeScript 코드 리뷰·작성 시 원칙 citation + before/after refactoring + 체크리스트 제공
- 트리거 맵 38+ rows — 안티패턴 감지 후 해당 reference 파일만 progressive-load
- Toss OSS 레포(es-toolkit, es-hangul, suspensive, use-funnel) PR 분석 기반 아키텍처 패턴 포함
- GitHub discussions 주요 스레드(boolean 네이밍, if-return, 배열 타입, MV-VI 등) 반영
- 라이브러리 저자용 패턴(subpath exports, attw/publint/sherif, Changesets, OIDC provenance)은 opt-in

**References (progressive disclosure):**
- `references/readability.md` — 맥락 축소, 이름으로 추상화, 조건 단순화
- `references/predictability.md` — 이름 겹침, 숨은 로직, 템플릿 리터럴 타입
- `references/cohesion.md` — 디렉토리, 폼, RSC colocation, 환경 분기 중앙화
- `references/coupling.md` — 책임 분리, 어댑터 패턴, `/compat` 마이그레이션
- `references/a11y-basics.md`, `a11y-components.md`, `a11y-practical.md` — WAI-ARIA, Tab/Modal/Radio, 안티패턴
- `references/recipes.md` — Modal, Form, Query Key Factory, overlay-kit 등 20 recipes
- `references/discussions.md` — 커뮤니티 토론 8건 요약
- `references/library-patterns.md` — 라이브러리 저자 전용(opt-in)

## Installation

```bash
# Install a specific skill
npx skills add soilSpoon/skills@tailor-resume
npx skills add soilSpoon/skills@fact-check
npx skills add soilSpoon/skills@human-like-browser
npx skills add soilSpoon/skills@apply-wishket
npx skills add soilSpoon/skills@toss-frontend-fundamentals
```

## License

MIT
