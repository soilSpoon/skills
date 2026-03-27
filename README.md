# Skills

AI agent skills collection.

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

## Installation

```bash
# Install a specific skill
npx skills add soilSpoon/skills@tailor-resume
npx skills add soilSpoon/skills@fact-check
npx skills add soilSpoon/skills@human-like-browser
```

## License

MIT
