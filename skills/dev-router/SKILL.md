---
name: dev-router
description: >-
  개발 작업 단일 진입점 — 작업 신호를 분류해 필요한 스킬 SKILL.md를 Read로 즉시 로드한다.
  없으면 하니스에 맞게 자동 설치·구성(npx skills / Grok copy / Claude plugin).
  UI/UX→ux-fundamentals, React/Next→vercel-react-best-practices·composition-patterns·
  toss-frontend-fundamentals, 코드 품질→code-fundamentals, 문서→technical-writing, ship→
  commit-pr-checklist, 버그→issue-rootcause-workflow, 테스트→test-foundations, 런타임 설정
  깨짐→build-config-drift. Claude Code·Grok·Droid·OpenCode·Kimi·Cursor 등 크로스 툴.
  트리거: 개발, 구현, 리뷰, UI 개선, React, 커밋, 버그, 테스트. 스킬 이름 몰라도 이것만 호출.
---

# Dev Router — 개발 시 스킬 자동 선택

**한 번 호출 → 라우팅 → (없으면 설치) → Read → 그 지침으로 작업.**

서브스킬을 사용자에게 나열하지 않는다. 에이전트가 **반드시** 아래 워크플로를 따른다.

## Harness notes (포팅)

이 스킬은 **harness-중립**이다. Read·Shell·파일 복사로 동작하며 Claude 전용 API에 의존하지 않는다.

- **스킬 로드**: 모든 하니스 = `Read`로 `SKILL.md` 전문 로드 (OpenCode `skill` tool이 있어도 라우터는 Read 우선).
- **자동 설치**: `scripts/ensure-skill.mjs` 또는 `npx skills add` (하니스별 `-a` — `references/harnesses.md`).
- **Grok**: `npx skills` 미지원 → 스크립트가 Soilspoon 원본을 `~/.grok/skills/` 또는 `<repo>/.grok/skills/`에 복사.

## 워크플로

### 1. 신호 수집

사용자 요청·열린 파일·diff 맥락에서 신호를 추출한다.

### 2. 라우트 (references/routing-table.md)

매칭된 **primary** 스킬을 모두 Read한다. **secondary**는 primary 본문이 "함께" 지시할 때만 Read.

### 3. 경로 해석 (references/resolve-paths.md)

`references/harnesses.md` 순서로 현재 하니스·프로젝트·글로벌 경로를 탐색한다.

### 3½. 없으면 설치 (references/install-hints.md)

Read 실패 시 **사용자에게 묻지 말고** 설치를 시도한다 (네트워크·쓰기 권한 필요).

1. **일괄** (라우트된 스킬 여러 개):  
   `node <dev-router-dir>/scripts/ensure-skill.mjs <skill-a> <skill-b> …`
2. **번들** (React 작업 등):  
   `node <dev-router-dir>/scripts/ensure-skill.mjs --route-bundle react`
3. **Claude Code 첫 세팅** (marketplace 없을 때만):  
   `/plugin marketplace add soilSpoon/skills` → `dev-toolkit` · `ux-fundamentals` 설치 (`references/skill-sources.md`)
4. 설치 후 **3단계 경로 탐색을 반복**해 Read.

`<dev-router-dir>` = 이 파일이 있는 디렉터리 (이 스킬을 Read한 경로).

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
- 없다고 멈추고 사용자에게 설치법만 알려줌 (먼저 ensure 시도)
- 모든 스킬을 매번 전부 Read
- ux-fundamentals 범위를 dev-toolkit 여러 스킬로 쪼개 호출 (화면 UX는 ux-fundamentals 단일)

## References

| 파일 | 용도 |
|------|------|
| `references/routing-table.md` | 신호 → 스킬 |
| `references/resolve-paths.md` | SKILL.md 검색 순서 |
| `references/harnesses.md` | 하니스 감지 · 에이전트별 루트 |
| `references/skill-sources.md` | 논리 이름 → install 소스 · 번들 |
| `references/install-hints.md` | 하니스별 설치 명령 |
| `scripts/ensure-skill.mjs` | 자동 probe + install |