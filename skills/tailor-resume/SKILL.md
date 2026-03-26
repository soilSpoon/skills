---
name: tailor-resume
description: Tailor resume and career description for a specific job posting. Use when the user provides a job posting URL and wants their resume customized for that position — analyzing requirements, filtering relevant experience/skills/projects from master.yaml, generating a variant, building PDFs, and evaluating via groupby. Triggers on "이 공고에 맞게 이력서 만들어줘", "tailor my resume for this job", "이 포지션에 지원하려는데", or any request combining a job URL with resume preparation.
---

# Tailor Resume

Customize resume + career description for a specific job posting by filtering the master data and generating an optimized variant.

## Overview

The user maintains a single `cv/master.yaml` containing ALL experience, projects, skills, and details. Different job applications use different **variants** (`cv/variants/*.yaml`) that filter this master data by tags. This skill creates a new variant tailored to a specific job posting.

## Workflow

### Step 1: Analyze the Job Posting

Fetch the job posting URL using WebFetch and extract:
- **Required skills** (languages, frameworks, tools)
- **Preferred/bonus skills**
- **Key responsibilities** (what the role does day-to-day)
- **Team/domain context** (e.g., fintech, e-commerce, infra)
- **Seniority signals** (leadership, mentoring, architecture)

Summarize these as a structured list before proceeding.

### Step 2: Read Master Data

Read `cv/master.yaml` in the project root (`/Users/dh/dev/portfolio/cv/master.yaml`). Understand:
- All projects and their `tags` (general, toss, instructor, freelancer, etc.)
- All bullets and details within each project
- Skills categories
- Open source contributions

### Step 3: Match and Prioritize

For each job requirement, identify which master.yaml items are relevant:
- Which projects demonstrate the required skills?
- Which bullets/details show the most relevant experience?
- Which skills categories should be included?

Create a relevance ranking. Not everything needs to be included — focus on what makes the strongest case for THIS specific role.

### Step 4: Generate Variant

Create a new variant yaml at `cv/variants/{company-slug}.yaml`. Use `summary_text` and `highlight_bullets_text` to write inline content directly in the variant — this keeps master.yaml untouched.

```yaml
variant: {company-slug}
title: '이력서 ({company})'
career_title: 경력기술서
subtitle: '{position title} 지원용'
theme: default
modes:
  - resume
  - career

# Inline summary — no need to add keys to master.yaml
summary_text: |
  공고에 맞춘 맞춤 summary 텍스트...

# Inline highlight bullets
highlight_bullets_text:
  - 공고 요구사항에 맞는 핵심 불릿 1
  - 공고 요구사항에 맞는 핵심 불릿 2
  - 공고 요구사항에 맞는 핵심 불릿 3
  - 공고 요구사항에 맞는 핵심 불릿 4

sections:
  - type: experience
    filter: [all]
  - type: projects
    filter: [{company-slug}, general, all]  # tag-based filtering
    max: 4                                   # limit to most relevant
  - type: oss
  - type: sideProjects
    filter: [{company-slug}, general, all]
```

If existing tags (general, toss) already cover what's needed, reuse them. Only add new tags to master.yaml bullets if absolutely necessary for filtering.

Alternatively, if the default summary/highlights are already well-aligned with the posting, reference them by key:
```yaml
summary: default
highlight_bullets: default
```

### Step 6: Verify Layout

Build the PDF to check page layout:
```bash
npx zx <skill-dir>/scripts/groupby-api.mjs --slug=resume-{company-slug} --career-slug=career-{company-slug} --no-career
```

Or to include career description:
```bash
npx zx <skill-dir>/scripts/groupby-api.mjs --slug=resume-{company-slug} --career-slug=career-{company-slug}
```

Check that:
- Resume fits on 1 page (A4) without excessive whitespace
- Career description sections break at logical points
- No orphaned headers at page bottoms

### Step 7: Evaluate with Groupby

Run both evaluations (팩폭 + 합격률 예측) in one command:
```bash
npx zx <skill-dir>/scripts/groupby-api.mjs --mode=both --job-url="{posting-url}" --slug=resume-{company-slug} --career-slug=career-{company-slug}
```

Review the results:
- **합격률 예측**: Aim for 90+ score, check which requirements are "충족" vs "부족"
- **팩폭**: Check for structural/content weaknesses the score doesn't capture

### Step 8: Iterate

Based on groupby feedback:
- If a requirement shows as "부족", check if master.yaml has relevant experience that wasn't included
- Adjust the variant's project selection (max count, tag filters)
- If summary doesn't address key requirements, write a custom one
- Re-run evaluation until satisfied

## Important Rules

- **Never invent experience or skills.** Only use what exists in master.yaml.
- **Don't modify master.yaml** for a specific application. Variants are the customization mechanism.
- **Use `summary_text` / `highlight_bullets_text`** in variant yaml for inline content — no master.yaml keys needed.
- **You CAN add new tags** to existing bullets in master.yaml only if existing tags can't provide the right filtering.
- **Keep resume to 1 page.** Use `max` in sections and selective filtering to control length.
- **Career description can be multi-page** but should only include relevant details.

## Reference Documents

Before generating a variant, read the files in these directories for quality standards, structural patterns, and benchmark examples:

- **`docs/`** — Design feedback, restructuring analysis, architecture specs
- **`cv/benchmark/`** — Reference resumes/career descriptions from other people
- **`cv/self-intro-draft.md`** — Approved self-introduction drafts

## File Locations

```
cv/
├── master.yaml              # All data (DO NOT modify content for specific applications)
├── variants/
│   ├── general.yaml         # Default variant
│   ├── toss.yaml            # Toss-specific variant (example)
│   └── {company-slug}.yaml  # Generated by this skill
├── themes/
│   ├── default.yaml
│   └── toss.yaml
└── output/                  # Generated PDFs and results
<skill-dir>/scripts/
└── groupby-api.mjs           # Groupby API (브라우저 불필요, curl 기반)
```

## Example

User: "https://toss.im/career/job-detail?job_id=123 이 공고에 맞게 이력서 만들어줘"

1. Fetch the posting → "Frontend Developer, React/TypeScript, design system experience preferred"
2. Read master.yaml → gwnote project has Chakra UI design system, React Query/Jotai/Zustand
3. Create `cv/variants/toss.yaml` with toss-tagged items prioritized
4. Add custom summary emphasizing design system + performance optimization
5. Build PDF → verify 1 page
6. Run `groupby-api.mjs both ... --job-url=...` → 100점
7. Done!
