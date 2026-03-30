---
name: tailor-resume
description: Tailor resume and career description for a specific job posting. Analyze requirements, research the company, filter relevant experience from master.yaml, generate a variant, build PDFs, and evaluate via groupby. Triggers on job URL + resume request ("이 공고에 맞게 이력서 만들어줘", "tailor my resume for this job", "이 포지션에 지원하려는데").
---

# Tailor Resume

Create a job-specific resume + career description variant from `cv/master.yaml`.

## Workflow

### 1. Read Guidelines

Read `<skill-dir>/references/resume-guidelines.md` before starting. It contains mandatory content, design, and structure rules.

### 2. Research Company + Job Posting

**Job posting**: Fetch URL → extract required/preferred skills, responsibilities, team context, seniority signals.

**Company deep research** (go beyond the posting):
- Search "{company} 기술 블로그", "{company} 개발 문화" → engineering values, tech stack, migration plans
- Check official careers/culture page → 인재상, core values
- Search "{company} 면접 합격 후기" → interview process, evaluation criteria
- Identify recent tech initiatives → what problems they're solving now

Use findings to frame summary, highlights, and experience prioritization.

### 3. Match and Prioritize

Read `cv/master.yaml`. For each job requirement, identify relevant projects, bullets, details, and skills. Create a relevance ranking — include only what makes the strongest case for THIS role.

### 4. Generate Variant

Create `cv/variants/{company-slug}.yaml`:

```yaml
variant: {company-slug}
title: '이력서 ({company})'
career_title: 경력기술서
subtitle: '{position} 지원용'
theme: default
modes: [resume, career]

summary_text: |
  공고+회사 리서치에 맞춘 맞춤 summary (명사형 어미)

highlight_bullets_text:
  - 공고 핵심 요구에 맞는 불릿 (임팩트 수치만, 활동 카운트 금지)

sections:
  - type: experience
    filter: [all]
  - type: projects
    include: [slug1, slug2, slug3]  # slug 기반 선택 (권장)
    filter: [general, all]           # include 없을 때 fallback
    max: 3                           # resume에만 적용, career는 무시
  - type: oss
    filter: [general, all]           # filter 필수 — 없으면 raw markdown 노출
```

**Key rules:**
- `include`: slug 기반 프로젝트 선택. 표시 순서는 master.yaml 시간순 유지.
- `max`: resume 모드에서만 적용. career 모드는 모든 매칭 프로젝트 포함.
- `summary_text` / `highlight_bullets_text`: variant에 인라인. master.yaml 수정 불필요.
- oss 섹션에 filter 필수 — 없으면 `general_md` 태그 항목의 `**bold**`가 raw 노출.

### 5. Verify Layout

Playwright로 PDF 생성 (dev server localhost:5173 필요):
- Resume: `resume-{slug}` → A4, printBackground: true → 1페이지 필수
- Career: `career-{slug}` → A4, printBackground: false → 빈 여백 최소화
- 스크린샷으로 시각 확인: 텍스트 깨짐, bold 렌더링, 페이지 분리 점검

### 6. Evaluate with Groupby

```bash
npx zx <skill-dir>/scripts/groupby-api.mjs both cv/output/combined.pdf "{posting-url}"
```

Modes: `improve` (팩폭), `job-match` (합격률), `both`. 90+ 점수 목표.

### 7. Iterate

Groupby 피드백 기반으로 variant 조정 → 재빌드 → 재평가.

## Content Rules (Quick Reference)

Full rules in `<skill-dir>/references/resume-guidelines.md`. Key points:

- **서사 구조**: 비효율 상황 → 개선 → 효율 증진
- **제목**: 역량 영역이 제목. 작업 나열 금지.
- **Bold**: 개선 사항에서 제거. 적용 결과에서만 성과/수치를 Bold.
- **활동 카운트 금지**: PR 개수, 포크 수 무의미. 왜 했고 뭘 개선했고 어떤 효과인지.
- **어미**: 명사형 통일 ("~제거", "~구축"). 동사형/혼재 금지.
- **master.yaml 수정 금지**: variant가 커스텀 수단. 경험/스킬 날조 금지.

## References

| File | When to read |
|------|-------------|
| `references/resume-guidelines.md` | variant 생성 전 필수 |
| `references/resume-restructure-analysis.md` | master.yaml 구조 이해 필요 시 |
| `benchmark/README.md` | 합격 프로필 패턴 참고 시 |
| `benchmark/reference-A.md` | DevOps 경력기술서 구조 참고 시 |
| `benchmark/groupby-profiles/` | 개별 합격 프로필 상세 확인 시 |
