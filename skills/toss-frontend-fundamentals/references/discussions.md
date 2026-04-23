# 커뮤니티 토론 (논쟁이 있는 주제)

토스 가이드 위 원칙들 외에도, 커뮤니티에서 **정답이 갈리는 주제**들이 있다. 이 파일은 해당 토론의 결론과 실무 가이드를 정리한다. "무조건 이렇게" 보다는 **맥락별 트레이드오프**로 제시한다.

## 목차

1. [조건부 렌더링: && vs 삼항 vs `<If/>` 컴포넌트](#1-조건부-렌더링)
2. [전역 상태 도입 기준](#2-전역-상태-도입-기준)
3. [enum vs as const](#3-enum-vs-as-const)
4. [간단한 if문의 return 포맷](#4-간단한-if문-return-포맷)
5. [불리언 암묵적 타입 변환](#5-불리언-암묵적-타입-변환)
6. [컴포넌트 선언: function vs arrow](#6-컴포넌트-선언-function-vs-arrow)
7. [배열 타입 표기: `T[]` vs `Array<T>`](#7-배열-타입-표기)
8. [도메인 중심 대안 설계: MV-VI 패턴](#8-mv-vi-패턴-대안-설계)

---

## 1. 조건부 렌더링

**질문** — React에서 `{isA && <A />}`, `{cond ? <A /> : <B />}`, `<If when={cond}><A /></If>` 중 무엇이 가독성·유지보수에 유리한가?

**결론**
- **단순 조건은 연산자**(`&&`, `?:`)가 명확. TypeScript 타입 narrowing을 보존한다.
- **컴포넌트 래퍼**(`<If/>`)는 children을 항상 평가하므로 타입 narrowing 이점이 사라지고, 성능·재렌더 이점도 없다.
- **복잡한 분기**는 래퍼 대신 **early return + 컴포넌트 추출** 또는 `ts-pattern` 같은 패턴 매칭 라이브러리가 낫다.

**실무 가이드**
- `cond && <X/>` → `cond`가 `0`·`""`이 될 수 있는 타입이면 함정(`0`이 렌더됨). 꼭 `Boolean(cond) && <X/>` 또는 `cond != null && <X/>` 쓰기.
- 상호배타 2분기 → 삼항이 자연스러움.
- 3분기 이상 → [readability.md: 배타적 분기 컴포넌트 분리](readability.md#1-배타적-분기-컴포넌트-분리) 적용.

**원문** — https://github.com/toss/frontend-fundamentals/discussions/4

---

## 2. 전역 상태 도입 기준

**질문** — props drilling이 3~4단 깊이가 되면 Redux/Zustand 같은 전역 상태를 도입해야 하나?

**결론**
- **깊이로 판단하지 말 것.** 전역 상태 도입 여부는 **상태의 성격**으로 결정한다.
  - 서버 데이터 → React Query / SWR
  - URL/라우팅 상태 → 라우터
  - 브라우저 스토리지 연동 → 전용 훅
  - 여러 트리에서 진짜 공유되는 도메인 상태 → 전역 상태
- **Context API는 DI 도구이지 상태 관리자가 아니다.** 잦은 업데이트가 있는 상태를 Context에 넣으면 리렌더 지옥.
- 대부분의 앱은 **Context + useReducer + React Query** 조합이면 충분. Redux/Zustand는 진짜 필요할 때만.

**실무 가이드**
- props drilling 2단 이하 → 그냥 둬도 됨
- props drilling 3단 이상이지만 상태가 **한 서브트리**에만 필요 → Context (그 서브트리에 Provider)
- 여러 라우트/페이지에서 공유 → 해당 상태의 성격에 맞는 도구 (대부분 서버 상태라 React Query로 해결)

**참고** — [coupling.md: Props Drilling 제거](coupling.md#3-props-drilling-제거)에서는 조합 패턴으로 풀기. Context·전역 상태는 그 다음 선택지.

**원문** — https://github.com/toss/frontend-fundamentals/discussions/5

---

## 3. enum vs as const

**질문** — TypeScript 상수 정의에 `enum`을 쓸까, `as const` + 타입 추출을 쓸까?

**결론 (토스 커뮤니티 투표: as const 69% vs enum 30%)**
- **`as const` 선호**
  - 트리 셰이킹 가능(`enum`은 IIFE로 컴파일되어 셰이킹 안 됨)
  - JavaScript 표준 지향(TC39·Node.js 네이티브 TS 실행에 유리)
  - 런타임 객체가 필요 없으면 더 가볍다
- **`enum`은 언제?**
  - 숫자 기반 플래그가 필요하거나 reverse mapping 쓸 때
  - 기존 코드베이스가 이미 `enum` 일색이면 일관성 유지

**실무 가이드**
```typescript
// 권장
export const Status = {
  Idle: "idle",
  Loading: "loading",
  Done: "done",
} as const;
export type Status = typeof Status[keyof typeof Status];
```

**원문** — https://github.com/toss/frontend-fundamentals/discussions/6

---

## 4. 간단한 if문 return 포맷

**질문** — `if (cond) return null;` 한 줄 vs `if (cond) { return null; }` 중괄호 중 어느 쪽?

**결론**
- **중괄호 포함이 근소하게 우세.** 나중에 로직이 추가될 때 **diff 노이즈가 적다**(한 줄 추가 vs 중괄호 + 들여쓰기 재구성).
- 하지만 **일관성이 선택보다 중요하다.** ESLint/Biome로 팀 전체 룰을 고정할 것.
- 검증 가드(early return)는 **단순한 한 줄**이 적합, 본문 로직은 중괄호 블록이 적합 같은 맥락 분기도 허용됨.

**실무 가이드** — 개인 취향 논쟁에 시간 쓰지 말고 린터로 강제.

**원문** — https://github.com/toss/frontend-fundamentals/discussions/41

---

## 5. 불리언 암묵적 타입 변환

**질문** — `if (!value)`, `if (value)` 같은 암묵적 불리언 변환은 안전한가? 구체적 예: 선택 문자열 파라미터가 undefined인지 확인할 때 `if (!value)` 와 `if (value === undefined)` 중 어느 쪽?

**쟁점**
- 암묵적은 짧고 익숙하지만 **의도 모호** — undefined를 체크하려는 건지, 빈 문자열까지 포함하려는 건지 코드만 봐서는 알기 어려움.
- JavaScript falsy 값 ( `0`, `""`, `null`, `undefined`, `NaN`, `false` ) 이 전부 통과해서 버그 온상. `0`, `""` 이 유효한 값일 때 특히 위험.
- `NaN === NaN`, `'0' == 0` 같은 JS 기묘함도 숨겨진 버그 요인.

**결론 (토론 합의)**
- **예측 가능성 우선** — boolean-only 조건식이 인지 부담을 줄이고 의도 전달이 명확. 특히 `count`, `name`, `array.length` 같이 0/빈값이 의미 있는 경우.
- **맥락 의존** — "모든 falsy 값을 거부하고 싶다"가 진짜 의도라면 암묵적 변환이 맞음. 예: `if (!user) redirect()` 에서 null/undefined 모두 로그인 필요로 취급.
- **일관성** — 한 코드베이스 안에서 섞어 쓰지 말 것. 유틸 함수(`isNil`, `isString`, `isEmpty`)가 자연어처럼 읽혀 가독성↑.
- **ESLint 자동화** — `@typescript-eslint/strict-boolean-expressions` 로 의도치 않은 변환을 빌드 타임에 차단 가능.

**실무 가이드**
```typescript
// ❌ 위험 — count가 0일 때도 "empty"로 처리됨
if (!count) showEmpty();

// ❌ 모호 — undefined만 체크하는 건지 falsy 전체인지
if (!value) handleMissing();

// ✅ 의도 명확
if (count === 0) showZero();
if (count == null) showMissing();     // null || undefined
if (value === undefined) handleMissing();

// ✅ 유틸로 자연어화
if (isNil(value)) handleMissing();
if (isEmpty(list)) showEmpty();
```

**예외적으로 암묵적이 나은 경우**
```typescript
// 모든 falsy를 거부하는 게 의도라면 OK
if (!user) return <Login />;

// 선택적 값 체크 — null/undefined 모두 스킵
const name = user?.name;
if (name) greet(name);
```

**원문** — https://github.com/toss/frontend-fundamentals/discussions/21

---

## 6. 컴포넌트 선언 function vs arrow

**질문** — React/Next 컴포넌트를 `function` 선언문과 arrow function(`const X = () => ...`) 중 무엇으로 쓸까?

**결론 (2025+ 기준 무게추 이동)**
- **컴포넌트 = `function` 권장**. 내부 핸들러·콜백 = arrow.
- `function` 이점:
  - **Hoisting** — 메인 컴포넌트를 파일 상단에 배치해 Top-down 가독성
  - **제네릭 문법이 깔끔** — `function List<T>(...)` (arrow는 `<T,>` 꼼수 필요)
  - 스택트레이스에서 이름 명확
  - Next.js App Router `export default async function Page()` 표준과 일관
- React 17 이전에 arrow가 주류였던 이유(`React.FC` children 자동, `forwardRef` HOC 간결)는 React 18+에서 대부분 소멸

**실무 가이드**
```tsx
// 권장 (React 18+)
export default function SelectBox<T>({ options, value, onChange }: Props<T>) {
  const handleClick = (v: T) => onChange(v); // 내부 핸들러는 arrow
  return <select>...</select>;
}
```

**원문** — https://github.com/toss/frontend-fundamentals/discussions/832

---

## 7. 배열 타입 표기

**질문** — `string[]` vs `Array<string>`, 뭐가 낫나?

**토스 공식 입장** (`@raon0211`)
- **단순 타입** → `T[]` 권장 (`string[]`, `number[]`, `User[]`)
- **복잡한 유니온** → `Array<T>` 권장 (`Array<string | number>`)
  - `(string | number)[]` 는 괄호가 가독성 떨어뜨림
- 팀 일관성이 더 중요. `typescript-eslint/array-type` 로 자동 강제.

```ts
const ids: string[] = [];
const items: Array<string | number> = [];
```

**원문** — https://github.com/toss/frontend-fundamentals/discussions/114

---

## 8. MV-VI 패턴 (대안 설계)

**제안** (커뮤니티 저자 제안, 토스 공식 아님) — `useCart` 같은 훅이 도메인 로직 + 구현(React Query, Suspense)을 섞는 문제를 3계층으로 분리:

- **M (Model)** — React 무관 순수 타입/비즈니스 인터페이스
- **VI (View Implementation)** — 런타임(React Query 등) 복잡성 흡수, 모델 인터페이스 구현
- **V (View)** — Model 인터페이스만 의존하는 선언적 컴포넌트

**장점** — 라이브러리 교체·테스트·UI/도메인 분리에 유리.

**단점** — 러닝 커브 있고 중소 프로젝트엔 오버 엔지니어링.

**스킬 관점** — 주 원칙으로 격상하지 말고, **대형 복잡 프로젝트의 선택지**로 인지만.

**원문** — https://github.com/toss/frontend-fundamentals/discussions/755

---

## 더 많은 토론

- 전체 인기 토론: https://github.com/toss/frontend-fundamentals/discussions?discussions_q=is:open+sort:top
- 좋은 토론 모음(큐레이션): https://frontend-fundamentals.com/code-quality/code/community/good-discussions.html
