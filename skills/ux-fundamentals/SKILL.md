---
name: ux-fundamentals
description: >-
  제품 UI UX의 단일 통합 스킬 — 구조·일관성·시선·행동 배치·피드백·점진 공개·선택/커밋·
  마이크로카피·접근성(UX 관점)에 **측정 가능한 시각 표면**(강조·채도·밀도·여백 척도·
  고정 크롬 비율)을 더해 한 워크플로로 진단·설계·리뷰·개선한다. 유사 화면 드리프트,
  위저드/폼/설정 흐름, CTA·상태·empty/loading, 이중 진입점, 내부용어 노출, i18n 톤.
  toss.tech 코퍼스+외부 UX 원칙 기반. 트리거: UX, UI 개선, 화면 일관성, 버튼 위치, 사용자
  흐름, 에러/빈상태/로딩, 마이크로카피, a11y — 그리고 "디자인이 별로다/답답하다/정신없다/
  촌스럽다", 여백·간격이 제각각, 스타일 정리, 디자인 시스템·디자인 토큰 도입, 스타일을
  건드리는 diff 리뷰, 다른 앱·레퍼런스의 패턴을 가져오려 할 때. 사용자가 '감사'나 'audit'을
  말하지 않아도 쓴다. 비트리거: 순수 백엔드, 전체 IA/브랜드, 코드 품질만(별도 코드 리뷰).
  다른 UX 스킬을 부르지 말고 이 스킬 내부 reference로 처리.
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

## 9축 (이 스킬이 관리하는 전부)

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
| **시각 표면** | 강조·채도·밀도·척도가 **수로** 임계 안에 있는가? | `visual-audit.md` |

축 충돌 → `conflict-resolutions.md`. 계약 패턴 → `surface-contract.md`.

앞 8축은 **정성 진단**이고, 9축만 **정량**이다. 시각 표면은 눈으로 안 보인다 —
같은 화면을 수십 번 봐도 "굵기 700이 52회, 400이 1회"는 안 보인다. 그래서 이 축만
탐침이 따로 있다(`counting-probes.md`).

## Scope floor

- **쓴다:** 화면/플로우 UX, 유사 surface 2개 이상, 또는 CTA·상태·문구·일관성 이슈,
  또는 **단일 화면의 시각 표면**(밀도·강조·여백·색 일관성)이 문제로 지목된 경우
- **안 쓴다:** 한 줄 스타일, 순수 API 설계, 브랜드/IA 전면 재설계

## 워크플로

### 1. Surface inventory

같은 **mental model**을 공유하는 화면을 나열한다 (위저드 스텝, 설정 카드, 모달 단계,
리스트+편집 패널 등). 각각의 **commit 동작**과 **완료 조건**을 적는다.

### 2. Diagnose

`review-checklist.md` + 신호에 맞는 reference **1–2개만** 연다.

측정: 주 CTA Y·너비, disclosure, 피드백 채널, 이중 진입점, 위젯 vs cardinality,
문구·톤·용어, 텍스트 상태·aria.

**시각 표면이 불만이면 세는 게 먼저다.** 소스가 있으면 `counting-probes.md`의 탐침을
돌리고 `visual-audit.md`의 임계와 대조한다. **임계를 넘은 것만** 결함으로 올린다 —
임계 없는 지적은 취향이고, 취향은 이 스킬의 산출물이 아니다.

세기 전에 **불만을 한 문장으로 고정한다.** "목록이 안 보인다"와 "색이 촌스럽다"는
다른 감사다. 범위를 안 정하면 화면 전체를 다시 그리게 된다.

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
| 디자인이 별로다·답답하다·정신없다 | visual-audit, counting-probes |
| 여백·글자 크기·모서리가 제각각 | visual-audit (C10·C11) |
| 목록이 몇 줄 안 보인다 / 화면이 헤더로 꽉 참 | visual-audit (C3·C4) |
| 디자인 토큰·디자인 시스템 도입 | visual-audit (C11), counting-probes |
| 스타일 diff 리뷰 | counting-probes |

## 레퍼런스를 베끼기 전에

좋은 화면에서 온 좋은 패턴도 **전제와 함께** 온다. 베끼기 전에 전제를 한 문장으로 적는다.
못 적으면 아직 그 패턴을 이해한 게 아니다.

> "하단 고정 액션 바가 세로를 회수한다" → **전제: 그 바가 콘텐츠를 덮는 오버레이일 때.**
> 레이아웃이 flex column이면 아래로 옮겨도 총 예산은 그대로다.

> "화면 제목은 22~28px" → **전제: 스크롤하면 접히는 large title일 때.**
> 안 접히는 헤더면 17px nav 바가 맞다.

전제가 우리 조건에서 거짓이면 **거절하고 근거를 남긴다.** 안 남기면 다음 사람이 같은
레퍼런스를 보고 같은 제안을 다시 한다.

## Anti-patterns

- 한 화면만 고침
- surface마다 다른 토스트/모달/경고 체계
- CTA를 필드 사이에 인라인
- 색·애니만으로 상태
- 프로덕션 UX variant 토글
- 이 스킬 범위를 다른 스킬 호출로 대체
- 세지 않고 단정 ("여백이 부족해 보인다"는 감사 결과가 아니다)
- 임계 없는 지적 — 임계가 표준(WCAG)인지 휴리스틱인지 밝히지 않음
- 밀도를 올리면서 표적을 축소 (여백과 히트 영역은 별개 예산)
- 레퍼런스를 전제 검사 없이 채택
- 한 번 세고 가드레일 없이 종료

## References

| 파일 | 내용 |
|---|---|
| `essence-and-intent.md` | 연구 뿌리·코퍼스·갭 |
| `surface-contract.md` | 공용 surface 계약 |
| `review-checklist.md` | 드리프트 체크 |
| `design-phase-experiments.md` | 설계 단계 실험 |
| `visual-audit.md` | 시각 표면 계수 13종·임계·정렬·보고 형식 |
| `counting-probes.md` | 스택별 탐침 명령·스크린샷 폴백·가드레일로 굳히기 |
| `examples/*.md` | 선택적 적용 예 (제품 무관) |

원칙 인덱스: `assets/principle-bank-index.json` (상세 추출은 레포별 보관 가능).