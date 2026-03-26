---
name: tailor-resume
description: Tailor resume and career description for a specific job posting. Use when the user provides a job posting URL and wants their resume customized for that position — analyzing requirements, filtering relevant experience/skills/projects from master.yaml, generating a variant, building PDFs, and evaluating via groupby. Triggers on "이 공고에 맞게 이력서 만들어줘", "tailor my resume for this job", "이 포지션에 지원하려는데", or any request combining a job URL with resume preparation.
---

# Tailor Resume

Customize resume + career description for a specific job posting by filtering the master data and generating an optimized variant.

## Overview

The user maintains a single `cv/master.yaml` containing ALL experience, projects, skills, and details. Different job applications use different **variants** (`cv/variants/*.yaml`) that filter this master data by tags. This skill creates a new variant tailored to a specific job posting.

## Workflow

### Step 1: Read Guidelines

Before starting, read these files in the project root:
- **`docs/resume-guidelines.md`** — 통합 가이드라인 (필수 준수)
- **`docs/resume-restructure-analysis.md`** — master.yaml 이슈별 재구성 분석
- **`cv/benchmark/README.md`** — 벤치마크 패턴 요약

These contain mandatory rules for content, design, and structure. Every variant must follow them.

### Step 2: Analyze the Job Posting

Fetch the job posting URL using WebFetch and extract:
- **Required skills** (languages, frameworks, tools)
- **Preferred/bonus skills**
- **Key responsibilities** (what the role does day-to-day)
- **Team/domain context** (e.g., fintech, e-commerce, infra)
- **Seniority signals** (leadership, mentoring, architecture)

Summarize these as a structured list before proceeding.

### Step 3: Read Master Data

Read `cv/master.yaml` in the project root (`/Users/dh/dev/portfolio/cv/master.yaml`). Understand:
- All projects and their `tags` (general, toss, instructor, freelancer, etc.)
- All bullets and details within each project
- Skills categories
- Open source contributions

### Step 4: Match and Prioritize

For each job requirement, identify which master.yaml items are relevant:
- Which projects demonstrate the required skills?
- Which bullets/details show the most relevant experience?
- Which skills categories should be included?

Create a relevance ranking. Not everything needs to be included — focus on what makes the strongest case for THIS specific role.

### Step 5: Generate Variant

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

## Content Quality Rules

These rules come from expert review and are **mandatory**. See `docs/resume-guidelines.md` for full details.

### Narrative Structure

Every career description item must follow: **비효율 상황 → 불편함 인식 → 개선 → 효율 증진**

Three strengths to consistently highlight:
1. **비효율 해결사** — 비효율을 보면 해결 방법을 찾는 사람. 오픈소스 기여도 이 맥락.
2. **빠른 기술 적응력** — 새로운 툴을 워크플로우에 가장 먼저 도입.
3. **AI 시대 적합 인재** — 새 기술을 먼저 써보고 효율화에 연결하는 사람.

### Title Framing

Titles must show **역량 영역**, not task lists.
- Bad: "C++ CAD 엔진의 Emscripten WASM 컴파일 및 Next.js SSR 브라우저 이식"
- Good: "React, TypeScript, Next.js 기반 프로덕트 아키텍처 설계 — jQuery 레거시 전환부터 Chakra UI 53개 공통 컴포넌트 체계까지"

### Bold Rules

- **개선 사항**: Bold 전부 제거
- **적용 결과**: 여기서만 성과/수치를 Bold
- 동사("구현하여", "도입하고")에 Bold 금지

### Writing Style

- 어미 통일: "~했다/~하다" 체 (혼재 금지)
- 상황 설명 NO — 내가 한 것 어필 중심
- 중요한 것을 문두에 배치

### Summary (확정)

Default summary text:
> 사용자 업무 프로세스를 이해하고 비효율을 구조적으로 제거하는 데 집중합니다. 새로운 기술을 프로덕트에 가장 먼저 도입하되, 표면 적용에 그치지 않고 소스 레벨까지 파고들어 근본을 개선합니다.

## Benchmark Patterns (합격 프로필에서 추출)

Groupby 합격 프로필 13개에서 추출한 공통 패턴:

| 패턴 | 설명 |
|------|------|
| 수치 기반 성과 | "검색 응답 800ms→150ms (81%↑)", "배포 시간 95%↓" |
| 문제→해결→성과 서사 | 단순 나열 아닌 스토리텔링 |
| 기술 선택 이유 | "왜 이 기술을 선택했는지"가 드러남 |
| 짧은 자기소개 | 핵심 강점 1-2줄 압축 |
| 강점 초반 명시 | "대규모 트래픽 처리와 비즈니스 로직 구현에 강점" |
| 개발 철학 제시 | "변경에 쉽게 대응할 수 있는 구조를 고민" |
| 폭넓은 역할 | "ML에 국한되지 않고 필요한 역할을 폭넓게 수행" |

## Reference Documents

Before generating a variant, read the files in these directories for quality standards, structural patterns, and benchmark examples:

- **`docs/resume-guidelines.md`** — 통합 가이드라인 (피드백 + 규칙 + 디자인)
- **`docs/resume-restructure-analysis.md`** — master.yaml 이슈별 재구성 계획 + gh 검증 데이터
- **`cv/benchmark/`** — 익명화된 벤치마크 PDF + 패턴 요약
- **`cv/self-intro-draft.md`** — 승인된 자기소개 초안

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
├── benchmark/
│   ├── README.md            # Benchmark index + 합격 패턴 요약
│   ├── reference-A/         # DevOps 경력기술서 (이슈→문제→의사결정→개선→결과 구조)
│   └── reference-B/         # 비개발 CV (레이아웃 참고)
└── output/                  # Generated PDFs and results
docs/
├── resume-guidelines.md     # 통합 가이드라인 (필수)
└── resume-restructure-analysis.md
<skill-dir>/scripts/
└── groupby-api.mjs           # Groupby API (브라우저 불필요, curl 기반)
```

## Example

User: "https://toss.im/career/job-detail?job_id=123 이 공고에 맞게 이력서 만들어줘"

1. Read `docs/resume-guidelines.md` → understand quality rules
2. Fetch the posting → "Frontend Developer, React/TypeScript, design system experience preferred"
3. Read master.yaml → gwnote project has Chakra UI design system, React Query/Jotai/Zustand
4. Create `cv/variants/toss.yaml` with toss-tagged items prioritized
5. Add custom summary emphasizing design system + performance optimization
6. Apply content rules: Bold only in results, "~했다" style, narrative structure
7. Build PDF → verify 1 page
8. Run `groupby-api.mjs both ... --job-url=...` → 100점
9. Done!
