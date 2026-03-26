# Skills

AI agent skills for resume tailoring and job application automation.

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

## Installation

```bash
npx skills add soilSpoon/skills@tailor-resume
```

## License

MIT
