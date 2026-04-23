---
name: toss-frontend-fundamentals
description: Toss Frontend Fundamentals의 4대 코드 품질 기준(가독성·예측 가능성·응집도·결합도)과 접근성(A11y) 원칙으로 React·TypeScript·프론트엔드 코드를 작성·리뷰·리팩토링한다. 사용 시점 - (1) "리뷰해줘", "개선해줘", "PR 봐줘", "code review" 같은 프론트엔드 리뷰 요청, (2) React 컴포넌트·훅·프론트엔드 유틸을 새로 쓰거나 리팩토링할 때, (3) "토스 코딩 컨벤션", "frontend-fundamentals", "변경하기 쉬운 코드", "가독성/예측가능성/응집도/결합도" 관련 질문, (4) props drilling, 매직 넘버, 중첩 삼항, 복잡한 조건문, 커스텀 훅 분리/통합, 전역 상태 도입, 폼 설계, 조건부 렌더링, 디렉토리 구조 같은 패턴을 검토할 때, (5) "접근성", "a11y", "aria", "스크린 리더", "키보드 네비게이션", "semantic HTML", 모달·탭·아코디언·라디오·체크박스·스위치 같은 UI 컴포넌트의 a11y 점검 요청. Use when reviewing or writing React/TypeScript frontend code that should follow Toss coding principles for maintainability and accessibility.
---

# Toss Frontend Fundamentals

## 핵심 철학

**좋은 프론트엔드 코드 = 변경하기 쉽고 + 모두가 쓸 수 있는 코드.**

- **변경하기 쉬움** → 4대 코드 품질 기준 (가독성 · 예측 가능성 · 응집도 · 결합도)
- **모두가 쓸 수 있음** → 접근성 (A11y)

| 축 | 질문 |
|---|---|
| **가독성** | 한 번에 고려해야 할 맥락이 적은가? |
| **예측 가능성** | 이름·시그니처만으로 동작을 예측할 수 있는가? |
| **응집도** | 같이 수정될 코드가 같이 묶여 있는가? |
| **결합도** | 한 곳 수정 시 영향 범위가 좁고 예측 가능한가? |
| **접근성** | 스크린 리더·키보드·색각 이상 사용자도 쓸 수 있는가? |

원칙들은 때로 **충돌**한다(예: 중복 제거 vs 결합도 낮추기). 스킬은 답을 강제하지 않고 트레이드오프를 드러내며, 맥락에 따라 선택을 돕는다.

## 빠른 트리거 맵 (코드 → 원칙 → 파일)

리뷰 중 아래 패턴이 보이면 해당 reference를 로드한다.

| 코드에 나타난 것 | 가능한 원칙 | 파일 |
|---|---|---|
| 중첩 삼항 `? :`, 4+ 줄 조건문 | 복잡한 조건/삼항 | [readability.md #3, #5](references/readability.md) |
| 의미 없는 숫자·문자열 상수 | 매직 넘버 | [readability.md #4](references/readability.md) / [cohesion.md #2](references/cohesion.md) |
| `score >= 80 && score <= 100` | 부등호 순서 | [readability.md #8](references/readability.md) |
| 한 컴포넌트에 viewer/admin 분기 혼합 | 배타 분기 분리 | [readability.md #1](references/readability.md) |
| 한 훅이 5개+ 상태 관리 | 로직 종류별 분리 | [readability.md #6](references/readability.md) / [coupling.md #1](references/coupling.md) |
| 라이브러리와 이름 겹치는 래퍼 | 이름 충돌 | [predictability.md #1](references/predictability.md) |
| 훅마다 반환 타입 제각각 | 반환 타입 통일 | [predictability.md #2](references/predictability.md) |
| 함수 내부에서 로깅·리다이렉트 같은 숨은 부작용 | 숨은 로직 | [predictability.md #3](references/predictability.md) |
| `components/`·`hooks/`·`utils/` 로만 분리 | 디렉토리 응집도 | [cohesion.md #1](references/cohesion.md) |
| 폼 전체 vs 필드 단위 혼재 | 폼 응집도 | [cohesion.md #3](references/cohesion.md) |
| 3+ 단 props 전달 | props drilling | [coupling.md #3](references/coupling.md) |
| 페이지마다 달라지는 로직을 억지로 공통화 | 과도한 DRY | [coupling.md #2](references/coupling.md) |
| `{cond && <X/>}`, `<If/>`, 전역 상태, enum vs as const, `if (!val)` 등 논쟁점 | 커뮤니티 합의 | [discussions.md](references/discussions.md) |
| `<div onClick>`, 아이콘만 있는 버튼, `role=`/`aria-*` 없음 | 접근성 기초 | [a11y-basics.md](references/a11y-basics.md) |
| 커스텀 Modal/Tab/Accordion/Radio/Checkbox/Switch | UI 접근성 패턴 | [a11y-components.md](references/a11y-components.md) |
| `<a>` 안의 `<button>`, `<tr onClick>`, `<div onClick>`, placeholder만 있는 input, `<form>` 밖 input, 중복 버튼 이름, img `alt` 누락 | a11y 실전 안티패턴 | [a11y-practical.md](references/a11y-practical.md) |
| **작성 중**: "Modal/Form/Toggle 만들 건데 뭘 챙겨야 하지?" | 상황별 레시피 | [recipes.md](references/recipes.md) |
| 테스트 작성 중: `getByRole`/`getByLabelText` 활용 | 테스트로 a11y 강제 | [a11y-basics.md #테스트](references/a11y-basics.md) |
| 디자인 시스템(`<MyButton>` 등) eslint-plugin-jsx-a11y 적용 | 커스텀 컴포넌트 a11y 매핑 | [a11y-basics.md #디자인-시스템](references/a11y-basics.md) |
| `useEffect` 여러 개 + 파생값/이벤트 뒤섞임 | useEffect 최소화 체크리스트 | [recipes.md #9](references/recipes.md) |
| useQuery 키/옵션 복붙 | Query Key Factory + queryOptions | [recipes.md #10](references/recipes.md) |
| Zod 스키마 optional 범벅 / 생성/수정 usecase마다 스키마 복제 | `.pick/.omit/.partial` compose | [recipes.md #11](references/recipes.md) |
| Response/Form/Payload 타입이 서로 다름 | 어댑터 레이어 | [recipes.md #12](references/recipes.md) / [cohesion.md #7](references/cohesion.md) |
| 다이얼로그 10개+ `useState` 폭발 | overlay-kit 선언적 패턴 | [recipes.md #13](references/recipes.md) |
| `z-index: 9999` 등 매직넘버 산재 | 시맨틱 z-index 토큰 | [recipes.md #14](references/recipes.md) |
| 서버 enum (`"A"|"B"...`) 타이핑 고민 | 코드젠/UNKNOWN/open-union 3전략 | [recipes.md #15](references/recipes.md) / [predictability.md #11](references/predictability.md) |
| Next.js App Router/RSC 데이터 패칭 위치 | 컴포넌트 곁 fetch + `cache()` | [recipes.md #16](references/recipes.md) / [cohesion.md #8](references/cohesion.md) |
| `setLoading` / `isLoading` Boolean 네이밍 | Boolean state 네이밍 | [predictability.md #4](references/predictability.md) |
| prop 이름 `terms` vs `value` | controlled `value/onChange` | [predictability.md #5](references/predictability.md) |
| `default export` 쓸지 `named` 쓸지 | Named export 기본 | [predictability.md #7](references/predictability.md) |
| `x != null`, `if (!value)` 느슨한 비교 | Strict 동등 비교 | [predictability.md #8](references/predictability.md) |
| `onClick={() => ...}` 인라인이 "비효율"? | 인라인 핸들러 통념 교정 | [readability.md #9](references/readability.md) |
| 단일 상세 vs 리스트에서 데이터 주입 | id vs 데이터 props | [coupling.md #4](references/coupling.md) |
| `function` vs `() =>` React 컴포넌트 선언 | function 권장 | [discussions.md #6](references/discussions.md) |
| `useInitializeX` 훅 vs `<XInitializer/>` 컴포넌트 | Hook vs Component 결정 규칙 | [cohesion.md #6](references/cohesion.md) |
| 상수 위치 — 함수 안 vs 밖 | 범용성×도메인 지엽성 | [cohesion.md #4](references/cohesion.md) |
| `components/`/`hooks/`/`utils/` 만으로 분할 | 도메인 중심 디렉토리 | [cohesion.md #5](references/cohesion.md) |
| `Object.assign(Fn, {with, Consumer})` / HOC+Consumer 공존 컴포넌트 | 컴포넌트 API 확장 패턴 | [recipes.md #17](references/recipes.md) |
| ErrorBoundary — fallback 에서 또 에러나면? | FallbackBoundary 위임 | [recipes.md #18](references/recipes.md) |
| Router / Storage / SDK 등 core 와 외부 환경 분리 | 어댑터 패턴 (얇은 인터페이스 + DI) | [coupling.md #5](references/coupling.md) |
| 기존 API 유지하면서 새 API로 이전 | `/compat` 어댑터 | [coupling.md #6](references/coupling.md) |
| `typeof window` / `typeof Buffer` 체크 산재 | 환경 분기 중앙화 | [cohesion.md #9](references/cohesion.md) |
| 타입 시그니처가 복잡한 공개 API 회귀 방지 | 타입 테스트 공존 (`*.test-d.tsx`) | [a11y-basics.md #테스트](references/a11y-basics.md) |
| **npm 라이브러리 빌드/publish/CI 세팅** | 라이브러리 저자 패턴 | [library-patterns.md](references/library-patterns.md) |
| 조사·URL 경로·CSS class 같은 **문자열 조합**을 타입으로 보장 | 템플릿 리터럴 타입 | [predictability.md #12](references/predictability.md) |
| 커스텀 `AbortError`/`TimeoutError`/`ValidationError` 만들 때 | 플랫폼 표준으로 승격 (DOMException/RangeError 등) | [predictability.md #13](references/predictability.md) |
| 다단계 폼·위저드 — 단계마다 required 필드가 다름 | 빌더 패턴 + 단계별 가드 누적 | [recipes.md #19](references/recipes.md) |
| RSC prefetch 쿼리가 오래 걸려 페이지 전체 지연 | hydration timeout + CSR 폴백 | [recipes.md #20](references/recipes.md) |

## 워크플로

### A. 코드 리뷰 모드 (사용자가 "리뷰해줘", PR 코멘트, "개선점" 요청)

1. **트리거 맵으로 스캔** — 위 표를 대조해 의심 지점 열거.
2. **해당 reference 로드** — 필요한 파일만. 전부 한꺼번에 읽지 않는다.
3. **지적 포맷** — 아래 출력 형식으로 정리.
4. **심각도 라벨** — `[MUST]` 명백한 버그·안티패턴 / `[SHOULD]` 권장 / `[NIT]` 취향·미세. 우선순위 전달.
5. **트레이드오프** — 원칙이 충돌하거나 맥락에 따라 달라지는 건 명시.

### B. 작성 모드 (새 컴포넌트·훅 작성, 리팩토링)

1. **5가지 질문** — 가독성/예측/응집도/결합도/접근성 각각 점검.
2. **관련 reference 참조** — 패턴이 애매하면 해당 파일 로드.
3. **판단 근거 메모** — 트레이드오프가 있는 선택(중복 허용, 공통화 회피 등)은 리뷰 시 설명 가능하도록.

## 통합 체크리스트

리뷰 시 최소 이 항목을 스캔한다. `✗` 가 나오면 해당 reference로 들어간다. 라벨은 최소 엄격도.

**가독성**
- `[MUST]` 매직 넘버/문자열이 상수화되어 있는가
- `[MUST]` 삼항 연산자가 2중 이상 중첩되지 않았는가
- `[SHOULD]` 범위 비교 부등호가 `min <= x && x <= max` 순서인가
- `[SHOULD]` 복잡한 filter/조건 표현에 중간 변수명이 붙어 있는가
- `[SHOULD]` 한 함수·컴포넌트가 배타적 분기(viewer/admin 등)를 혼합하지 않는가

**예측 가능성**
- `[MUST]` 외부 라이브러리와 이름이 겹치는 커스텀 함수가 없는가
- `[SHOULD]` 같은 종류의 훅이 일관된 반환 타입을 갖는가
- `[MUST]` 함수 시그니처에 드러나지 않는 부작용이 없는가

**응집도**
- `[SHOULD]` 같이 수정되는 파일들이 같은 디렉토리에 있는가
- `[SHOULD]` 같은 의미의 상수가 여러 곳에 복제되어 있지 않은가
- `[NIT]` 폼 검증이 "필드 단위 vs 폼 전체"의 변경 단위와 맞는가

**결합도**
- `[SHOULD]` 단일 훅/컴포넌트가 너무 많은 쿼리파라미터·상태를 한꺼번에 다루지 않는가
- `[SHOULD]` props drilling이 3단계 이상 깊게 이어지지 않는가
- `[SHOULD]` 공통화된 훅이 "페이지마다 달라지는 동작"을 인자로 받고 있지 않은가

**접근성**
- `[MUST]` 모든 `<img>` 에 `alt` 속성 (장식용은 `alt=""`)
- `[MUST]` 아이콘만 있는 버튼에 `aria-label`
- `[MUST]` 폼 `<input>` 마다 연결된 `<label>`
- `[MUST]` `<div onClick>` 같은 비상호작용 요소에 핸들러 없음 (또는 `role` + `tabIndex` + 키보드 처리)
- `[MUST]` Modal에 포커스 관리 + ESC 지원
- `[SHOULD]` 커스텀 컴포넌트는 `role` + `aria-checked/selected/expanded` + 키보드 이벤트
- `[SHOULD]` `aria-expanded` 같은 상태와 시각 상태(`hidden`)가 동기화
- `[SHOULD]` 색만으로 의미 전달하지 않음 (색 + 아이콘 + 텍스트)

## 출력 형식 (리뷰 지적 1건 당)

```
### [MUST|SHOULD|NIT] [축] 원칙 이름

**문제** — 어디가 원칙에 어긋나는지 (코드 스니펫 or 파일:라인)

**원칙 인용** — 토스 가이드의 한 줄 문장

**Before**
```tsx
// 현재 코드
```

**After**
```tsx
// 제안 코드
```

**왜 나아지는가** — 2~3 bullet

**참고** — https://frontend-fundamentals.com/... (원문)

**트레이드오프** (해당 시) — 이 변경이 놓칠 수 있는 것
```

## 주의 사항

- **토스 가이드는 교리가 아니다.** 커뮤니티 토론([discussions.md](references/discussions.md))에서 이미 논쟁된 항목이 많다. "토스가 그렇게 해서" 대신 "이 코드베이스에 왜 더 맞는가"로 설득한다.
- **컨텍스트를 우선한다.** 작은 스크립트에 도메인 폴더링, 2명이 쓰는 파일에 중복 허용을 밀어붙이면 과잉 적용이다.
- **접근성은 타협 대상이 아니다.** `[MUST]` 항목은 "시간 없어서 나중에" 가 아닌 **기본값**. semantic HTML·`aria-label`·키보드 지원은 기능 구현과 동시에 한다.
- **자동화가 가능한 건 자동화.** `eslint-plugin-jsx-a11y`, Testing Library `getByRole`, Prettier + ESLint 룰로 사람 리뷰 시간 절약.

## 원문 URL 인덱스

**코드 품질**
- 개요: https://frontend-fundamentals.com/code-quality/code/
- 좋은 토론: https://frontend-fundamentals.com/code-quality/code/community/good-discussions.html
- 인기 토론 전체: https://github.com/toss/frontend-fundamentals/discussions?discussions_q=is:open+sort:top

**가독성 예제** — [submit-button](https://frontend-fundamentals.com/code-quality/code/examples/submit-button.html) · [login-start-page](https://frontend-fundamentals.com/code-quality/code/examples/login-start-page.html) · [condition-name](https://frontend-fundamentals.com/code-quality/code/examples/condition-name.html) · [magic-number-readability](https://frontend-fundamentals.com/code-quality/code/examples/magic-number-readability.html) · [ternary-operator](https://frontend-fundamentals.com/code-quality/code/examples/ternary-operator.html) · [use-page-state-readability](https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-readability.html) · [user-policy](https://frontend-fundamentals.com/code-quality/code/examples/user-policy.html) · [comparison-order](https://frontend-fundamentals.com/code-quality/code/examples/comparison-order.html)

**예측 가능성 예제** — [http](https://frontend-fundamentals.com/code-quality/code/examples/http.html) · [use-user](https://frontend-fundamentals.com/code-quality/code/examples/use-user.html) · [hidden-logic](https://frontend-fundamentals.com/code-quality/code/examples/hidden-logic.html)

**응집도 예제** — [code-directory](https://frontend-fundamentals.com/code-quality/code/examples/code-directory.html) · [magic-number-cohesion](https://frontend-fundamentals.com/code-quality/code/examples/magic-number-cohesion.html) · [form-fields](https://frontend-fundamentals.com/code-quality/code/examples/form-fields.html)

**결합도 예제** — [use-page-state-coupling](https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-coupling.html) · [use-bottom-sheet](https://frontend-fundamentals.com/code-quality/code/examples/use-bottom-sheet.html) · [item-edit-modal](https://frontend-fundamentals.com/code-quality/code/examples/item-edit-modal.html)

**접근성**
- 개요: https://frontend-fundamentals.com/a11y/overview.html
- 왜: https://frontend-fundamentals.com/a11y/why.html
- 원칙: https://frontend-fundamentals.com/a11y/principles.html
- 기초(Role/Label/State): https://frontend-fundamentals.com/a11y/basic-guide/overview.html
- UI 컴포넌트: [tab](https://frontend-fundamentals.com/a11y/ui-foundation/tab.html) · [accordion](https://frontend-fundamentals.com/a11y/ui-foundation/accordion.html) · [modal](https://frontend-fundamentals.com/a11y/ui-foundation/modal.html) · [radio](https://frontend-fundamentals.com/a11y/ui-foundation/radio.html) · [checkbox](https://frontend-fundamentals.com/a11y/ui-foundation/checkbox.html) · [switch](https://frontend-fundamentals.com/a11y/ui-foundation/switch.html)
- 실전 가이드:
  - 구조: [button-inside-button](https://frontend-fundamentals.com/a11y/structure/button-inside-button.html) · [table-row-link](https://frontend-fundamentals.com/a11y/structure/table-row-link.html)
  - 의미: [required-label](https://frontend-fundamentals.com/a11y/semantic/required-label.html) · [duplicate-interactive-element](https://frontend-fundamentals.com/a11y/semantic/duplicate-interactive-element.html)
  - 동작: [fake-button](https://frontend-fundamentals.com/a11y/predictability/fake-button.html) · [form](https://frontend-fundamentals.com/a11y/predictability/form.html)
  - 시각 보완: [image-alt](https://frontend-fundamentals.com/a11y/alt-text/image-alt.html)
- ESLint: [rules](https://frontend-fundamentals.com/a11y/eslint/rules.html) · [design-system](https://frontend-fundamentals.com/a11y/eslint/design-system.html)
- 체험 playground: https://frontend-fundamentals.com/a11y/playground.html

**주요 커뮤니티 토론 (원문)** — 전체 [discussions.md](references/discussions.md) 참조
- [#4 조건부 렌더링](https://github.com/toss/frontend-fundamentals/discussions/4) · [#5 전역 상태 기준](https://github.com/toss/frontend-fundamentals/discussions/5) · [#6 enum vs as const](https://github.com/toss/frontend-fundamentals/discussions/6) · [#7 queryKey 관리](https://github.com/toss/frontend-fundamentals/discussions/7) · [#21 불리언 암묵 변환](https://github.com/toss/frontend-fundamentals/discussions/21) · [#35 Hook vs Component](https://github.com/toss/frontend-fundamentals/discussions/35) · [#41 if return 포맷](https://github.com/toss/frontend-fundamentals/discussions/41) · [#42 다이얼로그 관리](https://github.com/toss/frontend-fundamentals/discussions/42) · [#45 Indexed Access](https://github.com/toss/frontend-fundamentals/discussions/45) · [#66 RSC data fetching](https://github.com/toss/frontend-fundamentals/discussions/66) · [#67 Form 3-type](https://github.com/toss/frontend-fundamentals/discussions/67) · [#85 Zod 스키마 compose](https://github.com/toss/frontend-fundamentals/discussions/85) · [#88 Boolean 네이밍](https://github.com/toss/frontend-fundamentals/discussions/88) · [#96 export 스타일](https://github.com/toss/frontend-fundamentals/discussions/96) · [#114 배열 타입](https://github.com/toss/frontend-fundamentals/discussions/114) · [#128 인라인 함수](https://github.com/toss/frontend-fundamentals/discussions/128) · [#150 서버 enum](https://github.com/toss/frontend-fundamentals/discussions/150) · [#162 z-index](https://github.com/toss/frontend-fundamentals/discussions/162) · [#175 데이터 주입](https://github.com/toss/frontend-fundamentals/discussions/175) · [#177 value/onChange](https://github.com/toss/frontend-fundamentals/discussions/177) · [#189 != null](https://github.com/toss/frontend-fundamentals/discussions/189) · [#196 도메인 디렉토리](https://github.com/toss/frontend-fundamentals/discussions/196) · [#199 discriminatedUnion](https://github.com/toss/frontend-fundamentals/discussions/199) · [#202 queryOptions](https://github.com/toss/frontend-fundamentals/discussions/202) · [#221 상수 위치](https://github.com/toss/frontend-fundamentals/discussions/221) · [#488 fetcher 네이밍](https://github.com/toss/frontend-fundamentals/discussions/488) · [#689 useEffect 최소화](https://github.com/toss/frontend-fundamentals/discussions/689) · [#755 MV-VI](https://github.com/toss/frontend-fundamentals/discussions/755) · [#832 function vs arrow](https://github.com/toss/frontend-fundamentals/discussions/832)
