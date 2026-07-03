# 라우팅 테이블

`skill` = Read할 SKILL.md 논리 이름. 경로는 `resolve-paths.md`.

## Primary routes

| 신호 | skill | 비고 |
|------|-------|------|
| 화면 UX·패널 일관성·CTA·피드백·empty/loading·마이크로카피·i18n 톤(구조 포함) | **ux-fundamentals** | 제품 UI는 이것만. ux-writing 단독 호출 금지 |
| React·Next 컴포넌트·페이지·훅 작성/리팩터 | **vercel-react-best-practices** | 성능·데이터·번들 |
| 컴포넌트 API·compound·props 폭발·context | **vercel-composition-patterns** | 합성 패턴 |
| a11y·디자인 토큰·React 구조(채용축) | **toss-frontend-fundamentals** | UX 구조 판단은 ux-fundamentals |
| 코드 리뷰·리팩터·4축·안티패턴 | **code-fundamentals** | |
| README·PR·설계문서·커밋 메시지(산문) | **technical-writing** | UI 문구는 ux-fundamentals |
| 커밋/푸시/PR 직전·ship | **commit-pr-checklist** | 내부에서 다시 라우팅 |
| 버그·회귀·근본 원인 | **issue-rootcause-workflow** | |
| 테스트 리그·verify·flaky | **test-foundations** | |
| lint/test 통과인데 런타임만 깨짐 | **build-config-drift** | |
| 큰/위험한 기능 분해·slice | **slice** | |

## React 프론트 기본 번들

`.tsx` / `.jsx` / `components/` 변경이 **주 작업**이면 primary를 **함께** Read:

1. vercel-react-best-practices
2. vercel-composition-patterns (UI 구조 변경 시)
3. toss-frontend-fundamentals

**화면 UX 변경**이면 위 3개 **전에** ux-fundamentals를 먼저 Read.

## Secondary (명시적 트리거 시만)

| 신호 | skill |
|------|-------|
| 마케팅 카피·푸시만 | ux-writing |
| 스펙·인수 조건 목록 | spec-first |
| 이력서·위시켓 | tailor-resume / apply-wishket |