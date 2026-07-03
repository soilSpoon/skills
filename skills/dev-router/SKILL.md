---
name: dev-router
description: >-
  개발 작업 단일 진입점 — 작업 신호를 분류해 필요한 스킬 SKILL.md를 Read로 즉시 로드한다.
  UI/UX→ux-fundamentals, React/Next 구현→vercel-react-best-practices·composition-patterns·
  toss-frontend-fundamentals, 코드 품질→code-fundamentals, 문서→technical-writing, ship 전→
  commit-pr-checklist, 버그→issue-rootcause-workflow, 테스트→test-foundations, 런타임 설정
  깨짐→build-config-drift. 트리거: 개발, 구현, 리뷰, UI 개선, React, 커밋, 버그, 테스트.
  사용자가 스킬 이름을 몰라도 이 스킬만 호출하면 된다.
---

# Dev Router — 개발 시 스킬 자동 선택

**한 번 호출 → 라우팅 테이블 → 해당 스킬 Read → 그 지침으로 작업.**

서브스킬을 사용자에게 나열하지 않는다. 에이전트가 **반드시** 아래 워크플로를 따른다.

## 워크플로

### 1. 신호 수집

사용자 요청·열린 파일·diff 맥락에서 신호를 추출한다.

### 2. 라우트 (references/routing-table.md)

매칭된 **primary** 스킬을 모두 Read한다. **secondary**는 primary 본문이 "함께" 지시할 때만 Read.

### 3. 경로 해석 (references/resolve-paths.md)

Soilspoon marketplace · `npx skills add` · `~/.claude/skills` · 프로젝트 `.grok/skills` 순으로
SKILL.md를 찾는다. 없으면 `references/install-hints.md`의 설치 한 줄 후 재시도.

### 4. 실행

로드한 스킬 지침만 따른다. 라우터는 판정하지 않는다.

### 5. 복합 작업

여러 신호가 겹치면 **모든 해당 primary**를 Read한 뒤, 충돌 시 UX 판단은 ux-fundamentals,
구현 세부는 toss-FE/Vercel, 코드 4축은 code-fundamentals 우선.

## 비례

- 한 줄 typo → code-fundamentals만 또는 스킬 생략
- ship 직전 → commit-pr-checklist가 라우터를 다시 부를 수 있음 (중복 OK)

## Anti-patterns

- 스킬 이름만 안내하고 Read하지 않음
- 모든 스킬을 매번 전부 Read
- ux-fundamentals 범위를 dev-toolkit 여러 스킬로 쪼개 호출 (화면 UX는 ux-fundamentals 단일)