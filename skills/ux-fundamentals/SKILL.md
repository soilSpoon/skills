---
name: ux-fundamentals
description: >-
  제품 UI UX의 단일 통합 스킬 — 구조·일관성·시선·행동 배치·피드백·점진 공개·선택/커밋·
  마이크로카피·접근성(UX 관점)을 한 워크플로로 진단·설계·리뷰·개선한다. 유사 화면 드리프트,
  위저드/폼/설정 흐름, CTA·상태·empty/loading, 이중 진입점, 내부용어 노출, i18n 톤.
  toss.tech 코퍼스+외부 UX 원칙 기반. 트리거: UX, UI 개선, 화면 일관성, 버튼 위치, 사용자
  흐름, 에러/빈상태/로딩, 마이크로카피, a11y. 비트리거: 순수 백엔드, 전체 IA/브랜드,
  코드 품질만(별도 코드 리뷰). 다른 UX 스킬을 부르지 말고 이 스킬 내부 reference로 처리.
---

# UX Fundamentals — 제품 UX 단일 관리 스킬

**좋은 인터페이스 = 비슷한 일은 비슷하게 느껴지고, 사용자가 다음에 무엇을 할지
구조·문구·피드백으로 함께 읽히는 것.**

이 스킬은 **제품 화면 UX 전반**을 한곳에서 다룬다. 구조·상호작용·문구·상태·접근성(UX
레벨)을 **형제 스킬에 위임하지 않는다** — 필요한 축은 `references/`에 모두 둔다.
구현 단계의 React 리팩터·코드 4축은 이 스킬 범위 밖(별도 코드 리뷰).

## 뿌리

**공급자/시스템 본위 → 사용자 본위.**

- 데이터 모델·내부 상태를 UI 구조 그대로 노출하지 않는다
- 화면마다 다른 배치·피드백·문구는 학습 비용이다
- 개별 판단을 **시스템 계약**(공용 surface·상태 어휘·CTA·카피 규칙)으로 승격한다

전형적 발화: **유사한 화면/단계 N개**가 갈라지면 사용자는 매번 UI를 다시 읽는다.

## 8축 (이 스킬이 관리하는 전부)

| 축 | 질문 | reference |
|---|---|---|
| **일관성** | 같은 결정이 같은 레이아웃·컨트롤·피드백·문구 패턴인가? | `consistency.md` |
| **시각 흐름** | 시선·읽기 순서·입력→결과 인과가 예측 가능한가? | `visual-flow.md` |
| **행동 배치** | 주 동작의 위치·크기·일관성 | `action-placement.md` |
| **피드백** | 상태가 무게에 맞는 채널·어휘로 오는가? | `feedback.md` |
| **점진 공개** | 노출·숨김·비활성·청크 | `disclosure.md` |
| **선택·커밋** | 컨트롤 형태 vs cardinality, configure/commit | `selection-and-commit.md` |
| **마이크로카피** | 라벨·CTA·에러·빈상태·i18n 톤 | `microcopy.md` |
| **접근성(UX)** | 이름·순서·비시각 상태 전달 | `accessibility-ux.md` |

축 충돌 → `conflict-resolutions.md`. 계약 패턴 → `surface-contract.md`.

## Scope floor

- **쓴다:** 화면/플로우 UX, 유사 surface 2개 이상, 또는 CTA·상태·문구·일관성 이슈
- **안 쓴다:** 한 줄 스타일, 순수 API 설계, 브랜드/IA 전면 재설계

## 워크플로

### 1. Surface inventory

같은 **mental model**을 공유하는 화면을 나열한다 (위저드 스텝, 설정 카드, 모달 단계,
리스트+편집 패널 등). 각각의 **commit 동작**과 **완료 조건**을 적는다.

### 2. Diagnose

`review-checklist.md` + 신호에 맞는 reference **1–2개만** 연다.

측정: 주 CTA Y·너비, disclosure, 피드백 채널, 이중 진입점, 위젯 vs cardinality,
문구·톤·용어, 텍스트 상태·aria.

### 3. Contract

- 가장 명확한 화면 하나를 **SSOT**로 채택 → 나머지에 복제 (새 레이아웃 발명 금지)
- **축 단위 순차** 변경 (위치 → 피드백 → disclosure → 카피 …)
- 공용 **surface contract** + 구현 시 단일 shell 컴포넌트

기본 권장 패턴: `surface-contract.md`의 **context → fields → sticky primary action**
(맥락·필드·하단 주 CTA). 제품마다 문구·필드만 바꾼다.

설계 단계 가설 비교만 `design-phase-experiments.md`. 프로덕션 variant 토글 금지.

### 4. Apply (구조 + 카피 + a11y 함께)

한 번의 개선안에 레이아웃·상태·문구·라벨을 **함께** 제시한다. 문구만 따로 빼지 않는다.

### 5. Verify

각 surface: `pending → commit → complete` (+ 실패). 스크린샷으로 CTA 정렬·문구·locale.

## 트리거 맵

| 신호 | reference |
|---|---|
| 비슷한 화면인데 레이아웃·버튼 위치 다름 | consistency, action-placement |
| 이중 CTA / 이중 진입점 | disclosure, conflict-resolutions |
| 토글에 무거운 작업 | selection-and-commit |
| 로딩·완료·에러가 화면마다 다름 | feedback, microcopy |
| 접힘 뒤에 핵심 액션 | disclosure |
| 입력→결과 연결 안 보임 | visual-flow |
| 내부 모델명·코드 식별자가 UI에 노출 | consistency, microcopy |
| 에러/빈상태 문구·i18n | microcopy |
| 스크린리더·순서·색만 상태 | accessibility-ux, feedback |
| 토스/UX 원칙·코퍼스 | essence-and-intent |

## Anti-patterns

- 한 화면만 고침
- surface마다 다른 토스트/모달/경고 체계
- CTA를 필드 사이에 인라인
- 색·애니만으로 상태
- 프로덕션 UX variant 토글
- 이 스킬 범위를 다른 스킬 호출로 대체

## References

| 파일 | 내용 |
|---|---|
| `essence-and-intent.md` | 연구 뿌리·코퍼스·갭 |
| `surface-contract.md` | 공용 surface 계약 |
| `review-checklist.md` | 드리프트 체크 |
| `design-phase-experiments.md` | 설계 단계 실험 |
| `examples/*.md` | 선택적 적용 예 (제품 무관) |

원칙 인덱스: `assets/principle-bank-index.json` (상세 추출은 레포별 보관 가능).