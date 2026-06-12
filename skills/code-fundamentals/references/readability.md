# 가독성 (Readability)

"한 번에 고려해야 할 맥락이 적고, 위에서 아래로 자연스레 이어져야 한다."

## 목차

1. [배타적 분기 컴포넌트 분리 (submit-button)](#1-배타적-분기-컴포넌트-분리)
2. [구현 세부 추상화 (login-start-page)](#2-구현-세부-추상화)
3. [복잡한 조건에 이름 붙이기 (condition-name)](#3-복잡한-조건에-이름-붙이기)
4. [매직 넘버 명명 (magic-number-readability)](#4-매직-넘버-명명)
5. [삼항 단순화 (ternary-operator)](#5-삼항-단순화)
6. [로직 종류별 함수 분리 (use-page-state-readability)](#6-로직-종류별-함수-분리)
7. [시점 이동 줄이기 (user-policy)](#7-시점-이동-줄이기)
8. [왼쪽→오른쪽 부등호 순서 (comparison-order)](#8-부등호-순서)
9. [인라인 핸들러 — 성능 통념 vs 시점 이동](#9-인라인-핸들러-시점-이동-트레이드오프)
10. [삼항 연산자 — 긍정 술어 + fallback 후치](#10-삼항-연산자-fallback-위치)

---

## 1. 배타적 분기 컴포넌트 분리

**원칙** — 동시에 실행되지 않는 코드를 한 컴포넌트에 섞지 말고 배타적 분기를 별도 컴포넌트로 쪼개 맥락을 줄인다.

**Before**
```tsx
function SubmitButton() {
  const isViewer = useRole() === "viewer";
  useEffect(() => {
    if (isViewer) return;
    showButtonAnimation();
  }, [isViewer]);
  return isViewer
    ? <TextButton disabled>Submit</TextButton>
    : <Button type="submit">Submit</Button>;
}
```

**After**
```tsx
function SubmitButton() {
  const isViewer = useRole() === "viewer";
  return isViewer ? <ViewerSubmitButton /> : <AdminSubmitButton />;
}
function ViewerSubmitButton() { return <TextButton disabled>Submit</TextButton>; }
function AdminSubmitButton() {
  useEffect(() => { showButtonAnimation(); }, []);
  return <Button type="submit">Submit</Button>;
}
```

**왜**
- 각 컴포넌트가 단일 상태만 다루어 의도가 명확
- `useEffect`의 조건 분기가 사라져 훅 내부가 단순
- 리뷰·수정 시 viewer/admin 한쪽 파일만 보면 됨

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/submit-button.html

---

## 2. 구현 세부 추상화

**원칙** — UI 컴포넌트 안에서 로그인 체크·리다이렉트·권한 확인 같은 "세부 구현"을 직접 처리하면 맥락이 섞인다. 상위 래퍼(`AuthGuard`)로 빼 각 층이 **하나의 관심사**만 갖게 한다.

**Before**
```tsx
function LoginStartPage() {
  useCheckLogin({
    onChecked: (s) => { if (s === "LOGGED_IN") location.href = "/home"; }
  });
  return <>/* login UI */</>;
}
```

**After**
```tsx
<AuthGuard>
  <LoginStartPage />
</AuthGuard>

function AuthGuard({ children }) {
  const status = useCheckLoginStatus();
  useEffect(() => {
    if (status === "LOGGED_IN") location.href = "/home";
  }, [status]);
  return status !== "LOGGED_IN" ? children : null;
}
```

**왜**
- UI와 인증 로직이 분리되어 컴포넌트가 "자기 일"만 함
- `AuthGuard`는 다른 페이지에도 재사용 가능
- 테스트 시 UI/로직 각각 독립 검증

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/login-start-page.html

---

## 3. 복잡한 조건에 이름 붙이기

**원칙** — 중첩된 조건식은 중간 변수로 이름을 붙여 의도를 드러낸다.

**Before**
```typescript
const result = products.filter((product) =>
  product.categories.some((category) =>
    category.id === targetCategory.id &&
    product.prices.some((price) => price >= minPrice && price <= maxPrice)
  )
);
```

**After**
```typescript
const matchedProducts = products.filter((product) => {
  return product.categories.some((category) => {
    const isSameCategory = category.id === targetCategory.id;
    const isPriceInRange = product.prices.some(
      (price) => price >= minPrice && price <= maxPrice
    );
    return isSameCategory && isPriceInRange;
  });
});
```

**왜**
- 조건별 의미가 변수명으로 즉시 드러남
- 각 조건을 따로 테스트·추출 가능
- 중첩 람다의 인지 부담 감소

**주의** — 단순한 조건(`user.age >= 18`)까지 이름 붙이면 오히려 산만하다. 2개 이상이 AND/OR로 엮이거나 `.some/.every`가 중첩될 때 적용.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/condition-name.html

---

## 4. 매직 넘버 명명

**원칙** — 소스 코드에 박힌 숫자는 의도가 드러나지 않는다. 이름을 붙여 상수화한다.

**Before**
```typescript
async function onLikeClick() {
  await postLike(url);
  await delay(300);
  await refetchPostLike();
}
```

**After**
```typescript
const ANIMATION_DELAY_MS = 300;

async function onLikeClick() {
  await postLike(url);
  await delay(ANIMATION_DELAY_MS);
  await refetchPostLike();
}
```

**왜**
- `300`이 애니메이션 대기인지 서버 반영 대기인지 이름으로 구분
- 다른 개발자가 실수로 줄이거나 늘리는 일 방지
- 동일 상수 공유 시 한 곳만 수정 (→ 응집도에도 기여)

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/magic-number-readability.html

---

## 5. 삼항 단순화

**원칙** — 2중 이상 중첩된 삼항 연산자는 조건 구조가 흐려진다. 명시적 `if` 분기로 푼다.

**Before**
```typescript
const status =
  A && B ? "BOTH" : A || B ? (A ? "A" : "B") : "NONE";
```

**After**
```typescript
const status = (() => {
  if (A && B) return "BOTH";
  if (A) return "A";
  if (B) return "B";
  return "NONE";
})();
```

**왜**
- 각 조건-반환의 대응이 한눈에 보임
- 조건 추가/수정이 국소적
- 평가 순서가 선형적으로 드러남

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/ternary-operator.html

---

## 6. 로직 종류별 함수 분리

**원칙** — 하나의 훅이 여러 종류 로직(쿼리 파라미터 + 상태 + 날짜 기본값 등)을 한꺼번에 다루면 이해도 수정도 어렵다. **종류별로 훅을 쪼갠다**.

**Before**
```typescript
// 페이지 전체 상태를 한 훅에
function usePageState() {
  // cardId, statementId, dateFrom, dateTo, statusList 모두 관리
  return { values, controls };
}
```

**After**
```typescript
function useCardIdQueryParam() {
  const [cardId, setCardId] = useQueryParam("cardId", NumberParam);
  return [cardId ?? undefined, setCardId] as const;
}
// useStatementIdQueryParam, useDateRangeQueryParam 등으로 분리
```

**왜**
- 새 파라미터 추가 시 기존 훅에 영향 없음
- 파라미터별 변경 시 해당 컴포넌트만 리렌더 (성능 이점)
- 훅 이름만으로 책임이 명확

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-readability.html

---

## 7. 시점 이동 줄이기

**원칙** — 단순 로직을 **여러 파일·함수로 흩어놓으면** 읽는 사람이 시점을 옮겨다녀야 한다. 추상화가 가치를 더하지 않는 단순 로직은 **직접 드러내기**가 낫다.

**Before**
```tsx
// 어딘가에 있는 헬퍼
function getPolicyByRole(role) { return POLICY_SET[role]; }
const POLICY_SET = { admin: {...}, viewer: {...} };

const policy = getPolicyByRole(user.role);
<Button disabled={!policy.canInvite}>Invite</Button>
```

**After**
```tsx
const policy = {
  admin:  { canInvite: true,  canView: true },
  viewer: { canInvite: false, canView: true },
}[user.role];
<Button disabled={!policy.canInvite}>Invite</Button>
```

**왜**
- 값의 정의와 사용처가 같은 곳에 있음
- `getPolicyByRole`·`POLICY_SET` 파일을 오갈 필요 없음
- 정책이 복잡해지면 그때 분리해도 늦지 않음

**주의** — 권한 체계가 여러 곳에서 쓰이거나 규칙이 복잡하면 오히려 분리가 맞다. "현재 이 파일 안에서만 쓰이고 단순한가"를 기준으로 판단.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/user-policy.html

---

## 8. 부등호 순서

**원칙** — 범위 비교는 수학 부등식처럼 **작은 값 → 대상 → 큰 값** 순서로 쓴다.

**Before**
```typescript
if (score >= 80 && score <= 100) { ... }
```

**After**
```typescript
if (80 <= score && score <= 100) { ... }
```

**왜**
- `80 ≤ score ≤ 100`과 동일한 시각 구조
- 중간값(`score`)을 반복 확인할 필요 없음
- 범위의 시작점→끝점이 선형으로 읽힘

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/comparison-order.html

---

## 9. 인라인 핸들러 시점 이동 트레이드오프

**통념 교정** — "`onClick={() => ...}` 같은 인라인 화살표 함수는 매 렌더마다 새 함수를 만들어 비효율"이라는 말은 **틀린 지적**이다. 컴포넌트 함수 본문이 어차피 통째로 재실행되므로 인라인이든 변수로 뽑든 함수 선언 횟수는 **동일**.

**판단 기준은 성능이 아니라 가독성(시점 이동)**
- 짧은 일회성 → **인라인 유지** (근처에서 읽힘, 시점 이동 0)
- 길거나 여러 곳에서 쓰거나 재사용 → **분리**
- 자식에 props로 전달되고 memo/re-render에 민감 → **`useCallback`** (참조 안정성)
- 폼 필드 여러 개 → `name` 속성 + 통합 `handleChange`로 묶기

**Before / After**
```tsx
// ✅ 짧은 일회성 — 인라인 OK
<button onClick={() => setCount(c => c + 1)}>+</button>

// ✅ 자식에 props로 넘기면 useCallback
const onSelect = useCallback((id: string) => setSel(id), []);
<Child onSelect={onSelect} />

// ✅ Form 필드 여러 개 — 통합 핸들러
const handleChange = (e) =>
  setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
<input name="email" onChange={handleChange} />
<input name="name" onChange={handleChange} />
```

**리뷰 시 주의** — "인라인 함수 빼세요" 지적은 **참조 안정성이 필요한 자식에 props로 내릴 때**만 유효. 같은 컴포넌트 내부에서 쓰는 짧은 핸들러에는 과잉 최적화다.

**참고** — 토론 #128

---

## 10. 삼항 연산자 fallback 위치

**규칙** — **긍정 술어를 조건으로 쓰고 원하는 값을 먼저, fallback을 뒤로**. 부정의 부정(`!isUndefined`) 은 피한다.

```ts
// ❌ 부정 술어 + 값 뒤
isUndefined(date) ? '미지정' : format(date)

// ❌ 부정의 부정
!isUndefined(date) ? format(date) : '미지정'

// ✅ 긍정 술어 + 원하는 값 먼저
isDefined(date) ? format(date) : '미지정'
```

**일반 룰** — `condition ? valueIfTrue : valueIfFalse` 흐름이 자연스럽게 읽히려면:
1. **긍정형 술어** 사용 (`isEmpty` 대신 `hasItems`, `!visible` 대신 `isHidden`)
2. 조건 = "정상/기대 상태"
3. falsy 분기 = fallback/기본값

**참고** — 토론 #98 / [readability #3 복잡한 조건](#3-복잡한-조건에-이름-붙이기) 확장
