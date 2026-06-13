---
name: toss-frontend-fundamentals
description: 토스 Frontend Fundamentals 4대 축(가독성·예측 가능성·응집도·결합도) + 접근성 + 채용 평가축(완성도·확장성·라이브러리 동작 이해·실용성) + 토스 문화 8원칙·플랫폼 엔지니어링 철학으로 React·TypeScript 프론트엔드 코드를 작성·리뷰·리팩토링한다. 트리거 - (1) "리뷰해줘"·"개선해줘"·"PR 봐줘"·"code review", (2) React 컴포넌트·훅·유틸 작성·리팩토링, (3) "토스 코딩 컨벤션"·"frontend-fundamentals"·"변경하기 쉬운 코드"·4대 축 명칭, (4) props drilling, 매직 넘버, 중첩 삼항, 커스텀 훅 분리/통합, 전역 상태, 폼 설계, 조건부 렌더링, 디렉토리 구조, (5) "접근성"·"a11y"·"aria"·"스크린 리더"·"semantic HTML", 모달·탭·아코디언·라디오·체크박스·스위치 a11y 점검, (6) "토스 사전과제"·"기술과제"·"라이브 코딩"·"토스 평가"·"토스 지원"·"코드 리뷰 하는 듯한 경험", (7) 디자인 토큰·Flat/Compound API·React Native MFE·codemod·breaking change. 4대 축 코어(언어 불문)는 code-fundamentals 스킬이 담당하며 이 스킬은 프론트엔드 고유 관점을 얹는다 — 둘을 함께 설치/활성화. Use when reviewing/writing React/TypeScript frontend code that should follow Toss coding principles or Toss-style hiring evaluation.
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

> 🧩 **분담** — 4대 축의 본체(원칙 references + 언어 불문 리뷰)는
> [code-fundamentals](../code-fundamentals/SKILL.md) 스킬이 담당한다(함께 설치 권장 —
> dev-toolkit 플러그인은 둘을 같이 설치한다). 이 스킬은 그 위에 **프론트엔드 고유
> 관점**(접근성·React 런타임·디자인 토큰·라이브러리 저자 패턴·토스 평가/문화/플랫폼
> 철학)을 얹는다. L1/L2 lane의 references는 code-fundamentals 쪽 파일을 가리킨다.

> ⚠️ **로드 규율** — `references/*.md`와 외부 URL은 **필요할 때만** 1-2개씩 연다 (클라이언트가 references를 어떻게 로드하든 무방 — 한꺼번에 다 끌어오려 하지 말라는 의미). 트리거 맵에서 해당 패턴이 매칭됐을 때, 또는 리뷰·작성 중 특정 축의 근거가 필요해진 순간에 연다. SKILL.md 본문 + 트리거 맵으로 충분한 리뷰가 대부분이다.

## Harness notes (포팅)

이 스킬은 harness-중립으로 쓰였다. 아래 능력은 클라이언트별 메커니즘으로 구현한다:

- **lane 병렬 dispatch (워크플로 C)**: Claude Code = `Task`(sub-agent) 도구로 각 lane을 동시에 띄움; opencode·Codex CLI·SDK = 각자의 병렬 sub-agent/태스크 호출, 미가용 시 직렬 다회 호출로 폴백.
- **사용자 커스텀 규칙 위치 / 다른 모델로 rescue (워크플로 C-5)**: Claude Code = config는 `~/.claude/review-extensions/`, rescue는 `codex:rescue`; opencode·Codex CLI·SDK = 클라이언트별 config 디렉터리와 별도 모델 호출 메커니즘으로 동일하게 구현.

## 토스가 실제로 평가하는 것 (채용 기술과제·라이브 코딩)

토스 프론트엔드 채용 페이지(toss.im/career/article/26291) 공식 설명:

> "토스는 **주어진 시간 안에 제품을 완성할 수 있는지**, 작성된 **코드가 확장 가능한지**, **React와 같은 라이브러리 동작을 이해하고 있는지**를 위주로 살펴보아요. 이론적인 지식보다는 **실용적인 개발 역량**이 중요하다고 생각하기 때문이에요. 그래서 JavaScript의 Hoisting/Closure와 같은 지식적인 질문들보다는, 매일매일 프론트엔드 개발에서 나오는 실용적인 내용들을 주제로 **코드 리뷰를 하는 듯한 경험**을 하시게 될 거예요."

이 문구를 코드 판단 기준으로 번역하면 다음 4축이 4대 코드 품질 기준과 **함께** 평가된다.

| 평가축 | 질문 | 안티패턴 (감점) |
|---|---|---|
| **완성도** | 주어진 시간 내 기능이 전부 돌아가는가? | 핵심 기능 누락, TODO/주석 버그, 스스로 fix 코멘트가 PR에 누적 |
| **확장성** | 요구가 살짝 바뀌어도 안전하게 수정할 수 있는가? | 페이지에 원자/상태/라우팅/API가 전부 직접 박힘, 훅이 추상화 이름만 있고 결합은 그대로 |
| **라이브러리 동작 이해** | React·상태 라이브러리·라우터가 실제로 어떻게 도는지 알고 쓰는가? | useEffect로 라우팅 guard + 상태 초기화 경쟁, dep 누락, Strict Mode 이중 실행 취약, cleanup 안 함, `setState` 후 같은 턴에 값 읽음 |
| **실용성** | 과제 범위 안에서 가치 있는 선택을 했는가? | **자가 도입 복잡성** — 요청 없는 View Transitions/애니메이션/커스텀 상태 라이브러리 도입 뒤 버그 발생, 그걸 또 커스텀 Promise 계약으로 땜질 |

**핵심 해석 — "코드 리뷰를 하는 듯한 경험"**: 평가자는 *"이 코드가 내가 매일 리뷰한다면 어떤 코멘트를 달까?"* 로 본다. 따라서 스킬의 리뷰 출력은 **실제 리뷰 코멘트 톤**이어야 하고, 코드 작성 시에도 **"이 줄에 리뷰 코멘트가 달릴 것 같은가?"** 를 셀프체크한다.

### 작성 모드 Red Flag — 과제·라이브코딩 중 스스로에게 질문

- **"이 기능, 과제에서 요구했나?"** — No면 추가 복잡성이 갚아야 할 가치를 증명하라. View Transitions 같은 self-driven 기능은 버그 없이 완벽하지 않으면 **오히려 감점**.
- **"useEffect 안에서 navigate/setState를 한다면, 전환·언마운트 중 다시 트리거되지 않나?"** — React 동작 이해 평가 포인트.
- **"시그니처만 보고 동기/비동기·순서 의존성이 보이는가?"** — 안 보이면 이름 바꾸거나 옵션으로 드러낸다 (`afterTransition`, `onSettled` 같은 명시적 콜백).
- **"남은 시간으로 고치기 vs 일단 제출 vs 기능 축소 중 뭐가 가장 완성도 있는가?"** — 완성 > 자가 복잡성.

## 토스 문화 8원칙을 리뷰로 번역

토스 팀 문화 공식 페이지(toss.im/career/culture)의 8원칙은 채용 평가 기준이자 **코드 리뷰 가이드라인**이다. 각 원칙을 코드/PR 관점으로 번역.

| 원칙 | 원문 핵심 | 코드 리뷰 번역 |
|---|---|---|
| **DRI** (Direct Responsible Individual) | "맡은 일에 대한 최종의사결정권을 바탕으로 모든 것을 스스로 결정하고 주도적으로 진행하며, 결과에 대한 책임을 집니다" | 이 변경의 **DRI가 코드/PR에서 1명으로 식별**되는가. 여러 모듈에 걸친 변경은 DRI 명시 필수. |
| **Freedom & Responsibility** | "팀원을 믿지 못해 만든 규칙과 프로세스를 최소화" | "금지" 규칙보다 **"우회할 이유를 줄이는 설계"**로 (ESLint disable을 막기보다, ESLint를 따르고 싶게 만들기). |
| **Radical Transparency** | "의사결정에 필요한 최대한의 정보를 팀 전체에 공개" | **"왜 이 추상화/결합인가"를 PR 본문·주요 커밋 메시지·코드 주석에 드러내라.** 트레이드오프를 숨기지 않는다. |
| **Courage to Fail Fast** | "더 빨리 실패를 선언하고 … 용기 있게 나아가는 것에 언제나 박수" | **거대 PR 금지, 작게 빠르게 머지**. 실패는 롤백·포스트모템으로 학습. 실험적 구조는 feature flag 뒤에. |
| **Mission over Individual** | "팀의 목표에 가장 큰 영향을 줄 수 있는 일이 최우선 순위" | "내가 더 깔끔하게 짜고 싶은" 스타일 리팩토링보다 **사용자/임팩트가 큰 변경**을 먼저. |
| **Radical Candor** | "동료가 성장하길 바라는 마음을 바탕으로 개선점을 솔직하게" | 리뷰 톤: **솔직 + 대안 제시 + 이유**. "이렇게 하면 안 됨" 만 적지 말고, "왜 / 대신 이렇게" 를 붙인다. |
| **Question Every Assumption** | "'당연한 것'은 없습니다 … 가정을 바꾸면 어떨지 생각" | 관용적 패턴(매직 넘버, 기본 prop, 관용 hook 분리)에도 **"정말 이게 최선인가?"** 재질문. |
| **Move with Urgency / Focus on Impact / Extra-mile** | "과감히 생략 … 신속한 속도로 시도", "적당한 수준에서 마무리 짓지 않습니다" | 리뷰 우선순위는 **가독성·예측가능성·접근성 결함 먼저**, 양념 개선은 뒤. "대충 돌아가는" 상태로 PR 보내지 않는다. |

## 프론트엔드 플랫폼 엔지니어링 철학 (요약)

[Frontend Platform 이야기](https://toss.im/career/article/Frontend), [Web Framework 팀 도전기](https://toss.im/career/article/web_framework_2511), [rethinking-design-system](https://toss.tech/article/rethinking-design-system) 원문에서 추출한 7개 원칙. 상세 인용·리뷰 프로토콜은 [platform-philosophy.md](references/platform-philosophy.md).

| # | 원칙 | 리뷰 번역 (한 줄) |
|---|---|---|
| 1 | 문제의 근원 vs 표면 덮기 | 같은 버그 2회차면 개별 fix 대신 **가드레일** |
| 2 | 시스템이 실수 방지 > 개인이 실수 안 하길 바람 | 같은 지적 두 번 하면 **자동화 실패**. 1차 방어선은 ESLint·TS·jsx-a11y |
| 3 | 문제 정의·발견 역량 > 기술 스택 | 과제에서 "안 시킨 문제 발견 + 해결안 제안"이 가점 |
| 4 | 테스트·모니터링 없으면 회귀는 반드시 | 버그 fix PR에 **회귀 테스트 없으면 `[MUST]` 차단**, 성능 PR엔 수치 필수 |
| 5 | E2E 셀렉터는 a11y 친화적 | `getByRole`/`getByLabelText` 우선, `data-testid`·XPath는 최후 |
| 6 | Breaking change 세트 | 마이그레이션 가이드 + codemod + 릴리스 노트 동시 제공 |
| 7 | **우회할 이유를 줄이는 설계** (메타) | `@ts-ignore`·`as any`·fork는 **API 설계 실패의 증상** |

## Lane 분할 (관점 1개당 컨텍스트 1개)

한 컨텍스트가 4대 축 + 접근성 + 시스템 + 레시피를 *전부* 평가하면 관점 오염이 생긴다. 가독성 보러 들어왔다가 a11y 코드 보고 거기로 휩쓸리고, recipes 20종에 묻혀 결합도 시그널을 놓치는 식. 이 스킬은 리뷰를 5개 **lane**으로 나누고, 각 lane은 자기 관점의 references만 보고 자기 안티패턴만 본다.

작은 diff(<50줄)·단일 함수 리뷰는 단일 패스(워크플로 A)로 충분하다. **PR·큰 diff·채용 과제 전체 리뷰**에선 lane들을 **병렬로** 디스패치한다(워크플로 C).

### 5 lane 정의

| Lane | 관점 | 활성화 | 매핑 references |
|---|---|---|---|
| **L1 readability+predictability** | 인지 부하·이름·시그니처·스코프 가시성 | 항상 | [readability.md](../code-fundamentals/references/readability.md), [predictability.md](../code-fundamentals/references/predictability.md) |
| **L2 cohesion+coupling** | 모듈 경계·중복 vs 추상·디렉토리·결합 | 항상 | [cohesion.md](../code-fundamentals/references/cohesion.md), [coupling.md](../code-fundamentals/references/coupling.md) |
| **L3 a11y** | WCAG·ARIA·키보드·semantic HTML | UI/JSX 코드 감지 시 | [a11y-basics.md](references/a11y-basics.md), [a11y-components.md](references/a11y-components.md), [a11y-practical.md](references/a11y-practical.md) |
| **L4 react-runtime+systems** | hook 동작·렌더링·라이브러리 저자 패턴·디자인 토큰 | React/라이브러리/디자인 시스템 코드 감지 시 | [library-patterns.md](references/library-patterns.md), [design-tokens.md](references/design-tokens.md) |
| **L5 recipes** | 즉시 적용 가능한 코드 변환 패턴 | 작성 모드 또는 리뷰 중 fix 제안 시 | [recipes.md](references/recipes.md) |

### Cross-cutting (META) — 모든 lane이 필요 시 인용

- [discussions.md](references/discussions.md) — 트레이드오프 토론·대안 설계
- [platform-philosophy.md](references/platform-philosophy.md) — 플랫폼 7원칙 상세
- [url-index.md](references/url-index.md) — 원문 URL 인덱스
- 본 SKILL.md의 §토스 평가 / §문화 8원칙 / §플랫폼 7원칙 요약 표

### Lane 간 통신 금지

각 lane은 **같은 diff/코드를 받되, 자기 관점만** 답변한다. L1이 L4 결과를 보면 안 되고, L3이 L2에 의존하면 안 된다. 관점 독립성이 깨지면 fan-out의 의미가 사라진다 — "병렬 N 에이전트" 패턴의 본질은 **각 에이전트가 다른 에이전트 출력을 모르고** 자기 축만 본다는 것.

### 안티패턴 → lane 빠른 매핑

아래 "빠른 트리거 맵"은 lane-aware로 읽는다. 한 트리거가 여러 references를 호출하면 그 트리거는 cross-cutting — **가장 무거운 lane에 1차 보고**하고 나머지는 dedup 단계에서 머지.

| 안티패턴 군 | 1차 lane |
|---|---|
| 매직 넘버, 부등호, 중첩 삼항, 인라인 핸들러, 이름 충돌, Boolean 네이밍, 숨은 부작용 | L1 |
| props drilling, useEffect 다중, 디렉토리 분류, 환경 분기 산재, 과도한 DRY, 어댑터 누락 | L2 |
| `<div onClick>`, 아이콘 버튼 무라벨, alt 누락, 커스텀 Modal/Tab/Switch, label 미연결 | L3 |
| `useEffect` race, navigate inside effect, library 빌드/CI, 디자인 토큰 산재, Flat→Compound | L4 |
| Form/Modal/Toggle "어떻게 만들지?", overlay-kit, query key factory, RSC hydration | L5 |

## 빠른 트리거 맵 (코드 → 원칙 → 파일)

리뷰 중 아래 패턴이 보이면 해당 reference를 로드한다.

| 코드에 나타난 것 | 가능한 원칙 | 파일 |
|---|---|---|
| 중첩 삼항 `? :`, 4+ 줄 조건문 | 복잡한 조건/삼항 | [readability.md #3, #5](../code-fundamentals/references/readability.md) |
| 의미 없는 숫자·문자열 상수 | 매직 넘버 | [readability.md #4](../code-fundamentals/references/readability.md) / [cohesion.md #2](../code-fundamentals/references/cohesion.md) |
| `score >= 80 && score <= 100` | 부등호 순서 | [readability.md #8](../code-fundamentals/references/readability.md) |
| 한 컴포넌트에 viewer/admin 분기 혼합 | 배타 분기 분리 | [readability.md #1](../code-fundamentals/references/readability.md) |
| 한 훅이 5개+ 상태 관리 | 로직 종류별 분리 | [readability.md #6](../code-fundamentals/references/readability.md) / [coupling.md #1](../code-fundamentals/references/coupling.md) |
| 라이브러리와 이름 겹치는 래퍼 | 이름 충돌 | [predictability.md #1](../code-fundamentals/references/predictability.md) |
| 훅마다 반환 타입 제각각 | 반환 타입 통일 | [predictability.md #2](../code-fundamentals/references/predictability.md) |
| 함수 내부에서 로깅·리다이렉트 같은 숨은 부작용 | 숨은 로직 | [predictability.md #3](../code-fundamentals/references/predictability.md) |
| `components/`·`hooks/`·`utils/` 로만 분리 | 디렉토리 응집도 | [cohesion.md #1](../code-fundamentals/references/cohesion.md) |
| 폼 전체 vs 필드 단위 혼재 | 폼 응집도 | [cohesion.md #3](../code-fundamentals/references/cohesion.md) |
| 3+ 단 props 전달 | props drilling | [coupling.md #3](../code-fundamentals/references/coupling.md) |
| 페이지마다 달라지는 로직을 억지로 공통화 | 과도한 DRY | [coupling.md #2](../code-fundamentals/references/coupling.md) |
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
| Response/Form/Payload 타입이 서로 다름 | 어댑터 레이어 | [recipes.md #12](references/recipes.md) / [cohesion.md #7](../code-fundamentals/references/cohesion.md) |
| 다이얼로그 10개+ `useState` 폭발 | overlay-kit 선언적 패턴 | [recipes.md #13](references/recipes.md) |
| `z-index: 9999` 등 매직넘버 산재 | 시맨틱 z-index 토큰 | [recipes.md #14](references/recipes.md) |
| 서버 enum (`"A"|"B"...`) 타이핑 고민 | 코드젠/UNKNOWN/open-union 3전략 | [recipes.md #15](references/recipes.md) / [predictability.md #11](../code-fundamentals/references/predictability.md) |
| Next.js App Router/RSC 데이터 패칭 위치 | 컴포넌트 곁 fetch + `cache()` | [recipes.md #16](references/recipes.md) / [cohesion.md #8](../code-fundamentals/references/cohesion.md) |
| `setLoading` / `isLoading` Boolean 네이밍 | Boolean state 네이밍 | [predictability.md #4](../code-fundamentals/references/predictability.md) |
| prop 이름 `terms` vs `value` | controlled `value/onChange` | [predictability.md #5](../code-fundamentals/references/predictability.md) |
| `default export` 쓸지 `named` 쓸지 | Named export 기본 | [predictability.md #7](../code-fundamentals/references/predictability.md) |
| `x != null`, `if (!value)` 느슨한 비교 | Strict 동등 비교 | [predictability.md #8](../code-fundamentals/references/predictability.md) |
| `onClick={() => ...}` 인라인이 "비효율"? | 인라인 핸들러 통념 교정 | [readability.md #9](../code-fundamentals/references/readability.md) |
| 단일 상세 vs 리스트에서 데이터 주입 | id vs 데이터 props | [coupling.md #4](../code-fundamentals/references/coupling.md) |
| `function` vs `() =>` React 컴포넌트 선언 | function 권장 | [discussions.md #6](references/discussions.md) |
| `useInitializeX` 훅 vs `<XInitializer/>` 컴포넌트 | Hook vs Component 결정 규칙 | [cohesion.md #6](../code-fundamentals/references/cohesion.md) |
| 상수 위치 — 함수 안 vs 밖 | 범용성×도메인 지엽성 | [cohesion.md #4](../code-fundamentals/references/cohesion.md) |
| `components/`/`hooks/`/`utils/` 만으로 분할 | 도메인 중심 디렉토리 | [cohesion.md #5](../code-fundamentals/references/cohesion.md) |
| `Object.assign(Fn, {with, Consumer})` / HOC+Consumer 공존 컴포넌트 | 컴포넌트 API 확장 패턴 | [recipes.md #17](references/recipes.md) |
| ErrorBoundary — fallback 에서 또 에러나면? | FallbackBoundary 위임 | [recipes.md #18](references/recipes.md) |
| Router / Storage / SDK 등 core 와 외부 환경 분리 | 어댑터 패턴 (얇은 인터페이스 + DI) | [coupling.md #5](../code-fundamentals/references/coupling.md) |
| 기존 API 유지하면서 새 API로 이전 | `/compat` 어댑터 | [coupling.md #6](../code-fundamentals/references/coupling.md) |
| `typeof window` / `typeof Buffer` 체크 산재 | 환경 분기 중앙화 | [cohesion.md #9](../code-fundamentals/references/cohesion.md) |
| 타입 시그니처가 복잡한 공개 API 회귀 방지 | 타입 테스트 공존 (`*.test-d.tsx`) | [a11y-basics.md #테스트](references/a11y-basics.md) |
| **npm 라이브러리 빌드/publish/CI 세팅** | 라이브러리 저자 패턴 | [library-patterns.md](references/library-patterns.md) |
| 조사·URL 경로·CSS class 같은 **문자열 조합**을 타입으로 보장 | 템플릿 리터럴 타입 | [predictability.md #12](../code-fundamentals/references/predictability.md) |
| 커스텀 `AbortError`/`TimeoutError`/`ValidationError` 만들 때 | 플랫폼 표준으로 승격 (DOMException/RangeError 등) | [predictability.md #13](../code-fundamentals/references/predictability.md) |
| 다단계 폼·위저드 — 단계마다 required 필드가 다름 | 빌더 패턴 + 단계별 가드 누적 | [recipes.md #19](references/recipes.md) |
| RSC prefetch 쿼리가 오래 걸려 페이지 전체 지연 | hydration timeout + CSR 폴백 | [recipes.md #20](references/recipes.md) |
| **과제에서 요청하지 않은** 애니메이션/View Transitions/커스텀 라우팅 계층 도입 | 자가 도입 복잡성 (완성도·실용성 감점) | §토스 평가 — 위 섹션 |
| `useEffect`가 `navigate` + 상태 초기화 + race 방지 flag까지 다 포함 | React 동작 이해 — effect는 **동기화**용, 명령형 로직은 이벤트 핸들러/콜백으로 | §토스 평가 — React 동작 이해 |
| 함수가 조용히 `Promise`를 반환하는데 호출부 절반은 `await`, 절반은 버림 | 시그니처로 비동기 드러내기 (`afterTransition` 콜백 / 이름에 `Async`) | [predictability.md #3](../code-fundamentals/references/predictability.md) + §토스 평가 |
| 컴포넌트 prop이 15개+ / boolean prop 폭증 | Flat → Compound 분해 (props가 끝없이 늘어나면 위험 신호) | [design-tokens.md #flat-vs-compound](references/design-tokens.md) + §플랫폼 철학 #7 |
| 색상·z-index·spacing이 숫자 이름(`blue-100`, `z-9999`) | Target/Role/Variant/Level 의미 기반 토큰 | [design-tokens.md #4축-네이밍](references/design-tokens.md) |
| E2E/컴포넌트 테스트 셀렉터가 `data-testid` · XPath 투성이 | `getByRole`/`getByLabelText` 우선 — 테스트와 a11y 동시 강화 | §플랫폼 철학 #5 |
| 버그 fix PR에 회귀 테스트 없음 / 성능 PR에 측정 수치 없음 | `[MUST]` 차단 (버그·성능은 반드시 돌아온다) | §플랫폼 철학 #4 |
| 같은 버그 유형이 2회 이상 보고됨 | 개별 패치 대신 **가드레일**(타입·Lint 룰·codemod·테스트) | §플랫폼 철학 #1,#2 |
| `// @ts-ignore` / `/* eslint-disable */` / `as any` / 디자인 시스템 fork | "우회할 이유를 줄이는 설계" — API 실패의 증상으로 취급 | §플랫폼 철학 #7 |
| `typeof window` / Universal·Isomorphic 분기가 여러 곳 산재 | 실행 환경을 좁혀 응집도 회복 (toss.tech RN 2024) | [cohesion.md #9](../code-fundamentals/references/cohesion.md) + §플랫폼 철학 |
| 공개 API breaking change PR에 마이그레이션 가이드/codemod 없음 | 릴리스 노트 + codemod + 업그레이드 원라이너 세트 | [library-patterns.md](references/library-patterns.md) + §플랫폼 철학 #6 |
| 모바일/RN 앱 번들이 모놀리식 (서비스 A 변경이 B에 영향) | Shared 번들 + Service 번들 분리, 결정적 빌드 도구 선택 | §플랫폼 철학 (toss.tech RN 2024) |

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

### C. 병렬 리뷰 모드 (PR · 큰 diff · 채용 과제 전체)

**활성화 트리거** — PR 리뷰 / `git diff` 50줄+ / "전반적으로 봐줘" / 채용 과제 제출 직전 셀프 리뷰. 단일 함수·50줄 미만 리뷰는 워크플로 A가 더 효율적이다.

**1. 활성 lane 결정**

변경 파일을 스캔해 lane을 켠다.

| 감지 | 켜는 lane |
|---|---|
| 항상 | L1, L2, L5 |
| `*.tsx`/`*.jsx` 또는 JSX 마크업 | + L3 |
| React hook (`use*`) · `package.json` publish 설정 · 디자인 토큰 정의 | + L4 |

**2. lane 병렬 dispatch (가용 시 권장; Harness notes 참조)**

각 활성 lane을 별도 sub-agent/태스크로 동시에 띄운다.

```
각 lane sub-agent/task =
  system: "당신은 toss-FF의 {lane} 관점만 본다. 다른 관점은 무시한다."
  context: §Lane 분할의 매핑표가 정해준 references/*.md 만
  input: 동일 diff 또는 변경 파일 전체
  output (JSON): {
    findings: [{ file, line, severity:"MUST|SHOULD|NIT",
                 lane, principle, before, after, citation_url? }]
  }
```

**3. Aggregator (코디네이터 직렬 수행)**

- 같은 `file:line`의 findings dedup — 가장 강한 severity + 가장 짧은 citation 1개만 남긴다
- severity → file → line 순 정렬
- 본문은 §출력 형식의 단일 finding 포맷으로 통일
- lane 간 disagreement(같은 코드를 두 lane이 정반대로 평가)는 별도 섹션으로 표기 — 자동 머지하지 않는다

**4. 병렬 dispatch 미가용 환경 fallback**

직렬 다회 호출. 1회당 references는 1 lane만 컨텍스트에 두고 같은 diff에 대해 N번 묻는다. 토큰은 N배지만 관점 오염은 막힌다. diff가 작으면 워크플로 A로 떨어뜨리는 게 합리적.

**5. 확장 lane (선택, 항상 활성화 X)**

- 클라이언트 config 위치 (Claude Code: `~/.claude/review-extensions/`)에 사용자 커스텀 규칙이 있으면 추가 lane으로 자동 등록
- 다른 모델로 rescue (가용 시; Claude Code에서는 `codex:rescue`) — 동일 diff를 같은 schema로 요청해 모델 간 disagree 항목만 별도 표시

## 통합 체크리스트

리뷰 시 최소 이 항목을 스캔한다. `✗` 가 나오면 해당 reference로 들어간다. 라벨은 최소 엄격도.

> 일부 항목은 여러 블록에 cross-cutting (예: `useEffect` 동작 이해는 "예측 가능성"·"채용"·"플랫폼" 모두에 해당). 한 번 위반이면 어느 블록에서든 같은 결정 — **중복 지적은 피하고 가장 무거운 라벨로 한 번만**.

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

**채용 과제·라이브코딩 관점** (토스 공식 기준)
- `[MUST]` 과제 요구사항의 모든 기능이 실제로 돌아간다 (완성도)
- `[MUST]` 과제에서 요청하지 않은 복잡성(커스텀 애니메이션/라우팅 래퍼/자체 상태 라이브러리)을 **스스로** 도입한 뒤 버그가 남아 있지 않다
- `[MUST]` `useEffect`가 "렌더 후 동기화"가 아닌 "이벤트 핸들러"로 쓰이지 않는다 (navigate/setState 내부 호출 + 경쟁 상태 없음)
- `[MUST]` 커스텀 훅이 **자기 책임의 원자는 자기가 set** 한다 — 페이지가 훅 사용 후 `useSetAtom`을 또 꺼내 쓰면 추상화 실패
- `[SHOULD]` 함수 시그니처가 동기/비동기·실행 순서·부작용을 드러낸다 (숨은 `Promise`, 숨은 DOM 조작 금지)
- `[SHOULD]` 도메인 중심 디렉토리로 **"같이 변하는 파일이 같이 묶여" 있다** — `components/`·`hooks/`·`utils/` 만의 분류는 감점
- `[SHOULD]` PR·커밋이 "스스로 만든 버그를 스스로 고치는" 루프로 보이지 않는다 (자가 도입 복잡성의 신호)

**플랫폼 엔지니어링 관점** (토스 Web Framework·Frontend Platform 팀 기준)
- `[MUST]` 같은 버그 유형이 2회 이상이면 **개별 패치 대신 가드레일**(타입·Lint·codemod·테스트)로 승격
- `[MUST]` 버그 fix PR에 **회귀 테스트**가 있거나, 없는 이유가 명시됨 ("버그는 반드시 돌아온다")
- `[MUST]` 성능 개선 PR에 **before/after 측정 수치**가 있거나, 없는 이유가 명시됨 ("모니터링 없으면 속도는 반드시 느려진다")
- `[SHOULD]` "왜 이 추상화/결합인가"가 **PR 본문·주요 커밋·코드 주석에 드러남** (Radical Transparency)
- `[SHOULD]` **"왜 우회하나"** 질문: `// @ts-ignore`·`/* eslint-disable */`·`as any`·private API 우회는 **API 설계 실패의 증상**으로 조사
- `[SHOULD]` 공개 API breaking change는 **마이그레이션 가이드 + codemod + 업그레이드 원라이너**
- `[SHOULD]` E2E·컴포넌트 테스트 셀렉터가 `getByRole`/`getByLabelText` 우선 (접근성 + 테스트 동시 강화)
- `[NIT]` "내가 더 깔끔하게 짜고 싶은" 스타일 리팩토링보다 **임팩트 큰 변경이 먼저** (Mission over Individual)

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
- **채용 과제에서는 "완성도 > 자가 복잡성"**. 토스는 공식적으로 "주어진 시간 안에 완성, 코드 확장성, 라이브러리 동작 이해, 실용성"을 평가한다고 밝힘(toss.im/career/article/26291). 요청하지 않은 멋있는 기능(View Transitions, 복잡한 전환 애니메이션, 자체 네비게이션 훅 등)을 도입하려면 **버그 없이 끝낼 시간이 남았을 때만** 한다.
- **"코드 리뷰를 하는 듯한 경험"이 평가 방식**이라는 점을 작성 단계에서 내재화한다. 한 줄 한 줄 "여기 리뷰 코멘트가 달릴 것 같은가?"로 셀프체크.

## 원문 URL 인덱스

전체 목록은 [references/url-index.md](references/url-index.md). 카테고리별 2-3개만 자주 쓰는 북마크로 남긴다.

> ⚠️ **선제 fetch 금지** — 이 링크들은 참조용이다. 스킬 활성화 시점에 **선제적으로 WebFetch 하지 않는다.** 리뷰·작성 중 특정 원칙의 원문 근거가 **필요해진 순간에만** 해당 항목 1개를 fetch. 대부분의 리뷰는 SKILL.md 본문 + `references/*.md` 만으로 충분하다.

**토스 평가 기준 · 팀** — [26291 합류 5가지 이유](https://toss.im/career/article/26291) · [Frontend Platform 이야기](https://toss.im/career/article/Frontend) · [Web Framework 팀 도전기](https://toss.im/career/article/web_framework_2511) · [팀 문화 8원칙](https://toss.im/career/culture)

**토스 기술 블로그 핵심** — [리포지토리 기반 지원 평가 기준](https://toss.tech/article/frontend-apply-without-resume) · [rethinking-design-system (Flat/Compound)](https://toss.tech/article/rethinking-design-system) · [TDS 컬러 시스템 (4축 토큰)](https://toss.tech/article/tds-color-system-update) · [React Native 2024 (MFE·결정적 빌드)](https://toss.tech/article/react-native-2024) · [100년 가는 SDK](https://toss.tech/article/42223) · [A11y Fundamentals](https://toss.tech/article/A11y_Fundamentals)

**Fireside Chat** — [EP.1 가독성](https://toss.tech/article/28334) · [EP.8 면접관이 진짜 원하는 것](https://toss.tech/article/firesidechat_frontend_8) · [EP.12 리뷰 컬쳐](https://toss.tech/article/firesidechat_frontend_12)

**Frontend Fundamentals 공식** — [코드 품질 개요](https://frontend-fundamentals.com/code-quality/code/) · [접근성 개요](https://frontend-fundamentals.com/a11y/overview.html) · [playground](https://frontend-fundamentals.com/a11y/playground.html)

**오픈소스** — [es-toolkit](https://es-toolkit.dev) · [suspensive](https://suspensive.org) · [@toss/use-funnel](https://use-funnel.slash.page) · [granite](https://www.granite.run) · [전체 리포지토리](https://github.com/toss)

## 애셋

- [`assets/pr-template.md`](assets/pr-template.md) — 채용 과제·라이브코딩 제출 시 PR/README 템플릿 (TL;DR · 요구사항 체크 · 설계 결정 Why · 의도한 단순화 · 확장 지점 · 러닝 포인트 · a11y 자가점검). "코드 리뷰 하는 듯한 경험" 평가에 맞춰 **자기 변론서** 역할.
