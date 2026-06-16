# 작성 레시피 ③  고급·RSC 패턴 (16–20: RSC fetching·컴포넌트 API 확장·ErrorBoundary·다단계 스키마·RSC+RQ hydration)

"**작성 모드**"에서 자주 마주치는 상황을 **순서대로** 따라가는 체크리스트. 리뷰가 아니라 **처음부터 잘 쓰기** 위한 템플릿이다. 각 레시피는 4대 코드 품질 원칙 + 접근성을 **동시에** 고려한다.

> 이 파일은 `recipes.md`(작성 레시피 인덱스)에서 분리된 조각이다 — 필요한 묶음만 로드한다.

---

## 16. RSC data fetching colocation

**원칙** — Next.js App Router / RSC 환경에서는 **데이터를 쓰는 컴포넌트 곁에서 직접 fetch**. Page에서 한꺼번에 긁어 props로 내리지 않는다.

```tsx
// ❌ Page가 모든 자식 데이터를 알아야 함
export default async function Page({ params }) {
  const user = await getUser(params.id);
  const posts = await getPosts(params.id);
  return <Profile user={user} posts={posts} />;
}

// ✅ 각 컴포넌트가 자기 데이터를 책임
export default async function Page({ params }) {
  return (
    <>
      <UserHeader id={params.id} />
      <PostList userId={params.id} />
    </>
  );
}

async function UserHeader({ id }: { id: string }) {
  const user = await getUser(id);
  return <h1>{user.name}</h1>;
}
```

**중복 fetch 걱정 해소 — `React.cache()`**
```ts
import { cache } from 'react';
export const getUser = cache((id: string) => prisma.users.findUnique({ where: { id } }));
// 같은 렌더 안에서 동일 id로 여러 번 호출해도 한 번만 실행
```

**병렬화**
```tsx
async function Page({ id }: { id: string }) {
  const [user, posts] = await Promise.all([getUser(id), getPosts(id)]);
  return <>...</>;
}
```

**Suspense 경계** — `cookies()`/`headers()` 쓰는 컴포넌트를 `<Suspense>` 로 감싸 상위는 static, 하위만 dynamic.

**참고** — [cohesion.md #1 함께 수정되는 파일](cohesion.md#1-함께-수정되는-파일-같은-디렉토리) / 토론 #66

---

## 17. 컴포넌트 API 확장 패턴

**패턴** — `Object.assign(Fn, { displayName, with, Consumer })` — 한 심볼에 **선언형 컴포넌트 + HOC + Context Consumer** 를 모두 붙여 소비 스타일에 자유도를 준다. toss/suspensive 의 `ErrorBoundary`, `Suspense`, `Delay` 모두 이 패턴.

```tsx
function _Delay({ ms = 0, children, fallback }: DelayProps) {
  const [done, setDone] = useState(ms === 0);
  useEffect(() => {
    if (ms === 0) return;
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return <>{done ? children : fallback}</>;
}

// HOC — 기존 컴포넌트를 래핑
_Delay.with = function withDelay<P extends object>(
  props: Omit<DelayProps, 'children'>,
  Target: React.ComponentType<P>,
) {
  return (p: P) => (
    <_Delay {...props}>
      <Target {...p} />
    </_Delay>
  );
};

// Consumer — context 값을 render-prop 으로 노출
_Delay.Consumer = DelayContext.Consumer;

_Delay.displayName = 'Delay';

export const Delay = _Delay;
```

**왜**
- **HOC가 필요한 자리**(라우트 레벨 래핑, 고차 구성) 와 **JSX로 직접 쓰는 자리** 가 한 컴포넌트로 커버 → 호출부가 취향 선택
- `displayName` 명시로 React DevTools 추적성
- Consumer 동시 제공으로 context 소비가 hooks 규칙에 막힐 때 render-prop으로 우회 가능

**주의** — `Object.assign` 은 타입이 무너지기 쉬움. TypeScript 에서는 `const Foo = Object.assign(_Foo, { with, Consumer })` 로 조합 타입을 유지.

**참고** — toss/suspensive `ErrorBoundary.tsx`, `Suspense.tsx`, `Delay.tsx`

---

## 18. ErrorBoundary — FallbackBoundary 패턴

**문제** — `react-error-boundary` 같은 표준 구현은 **fallback 자체에서 에러가 던져지면 무한 루프**에 빠진다 (상위 경계가 잡지 못함).

**해법** — fallback 을 **자체 내부 ErrorBoundary**(`FallbackBoundary`) 로 감싸 에러를 상위 경계로 위임.

```tsx
class BaseErrorBoundary extends Component<Props, State> {
  // ... 일반 ErrorBoundary 구현
  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      return (
        <FallbackBoundary
          onError={(err) => {
            // fallback 내부 에러를 상위로 재던짐
            throw err;
          }}
        >
          {typeof fallback === 'function' ? fallback({ error, reset }) : fallback}
        </FallbackBoundary>
      );
    }
    return children;
  }
}
```

**추가 안전장치** (toss/suspensive)
- `shouldCatch: ErrorMatcher | ErrorMatcher[]` — 특정 에러 타입만 잡고 나머지는 상위로
- `InferError<TShouldCatch>` 조건부 타입으로 fallback 의 `error` 자동 narrowing
- `useErrorBoundary` 는 컨텍스트 바깥 호출 시 **사용처 위치를 알려주는 구체 에러 메시지** 던짐

**Transpiled Error 대응** — SWC/Babel 로 다운타겟된 `class MyError extends Error` 는 `prototype instanceof Error` 가 깨짐. `shouldCatch` 매칭을 3단 시도:
```ts
function matchError(err: unknown, matcher: ErrorMatcher): boolean {
  try { if (err instanceof matcher) return true; } catch {}    // 네이티브
  try { if (matcher instanceof Function && err instanceof matcher) return true; } catch {}
  if (typeof matcher === 'function') return (matcher as TypeGuard)(err);  // type guard
  return false;
}
```

**참고** — toss/suspensive `packages/react/src/ErrorBoundary.tsx`, PR #1919

---

## 19. 다단계 스키마 빌더 패턴

**문제** — 회원가입·주문 같은 다단계 플로우에서 "A 단계를 거치면 `email` 확정, B 단계를 거치면 `password` 확정" 같은 **단계별 요구 필드**를 타입 + 런타임에서 동시에 표현해야 한다. 한 번에 전체 스키마를 정의하면 optional 범벅이 되고 discriminatedUnion 도 단계 순서를 표현 못 한다.

**해법** — **빌더 패턴**으로 `.extends()` 체이닝. 각 단계가 **requiredKeys 를 누적**, 타입과 런타임 가드가 함께 생성.

```ts
type SignupForm = {
  email: string;
  password: string;
  passwordConfirm: string;
  nickname: string;
};

const steps = createFunnelSteps<SignupForm>()
  .extends('email')  // 단계: email 단계 진입 시 특별한 조건 없음
  .extends('password', {
    requiredKeys: 'email',  // 이 단계 오려면 email 필수
  })
  .extends('confirm', {
    requiredKeys: ['email', 'password', 'passwordConfirm'],
  })
  .extends('nickname', {
    requiredKeys: ['email', 'password', 'passwordConfirm'],
  })
  .build();

// 타입 자동 생성
// 각 step 의 context 타입이 "지금까지 누적된 required 필드만 있음"으로 정확히 좁혀짐
```

**왜**
- "email 단계에서 password 가 context 에 있을 리 없다" 가 타입으로 보장
- `.extends()` 호출마다 `requiredKeys` 가 누적 — 이전 단계 가드가 자동 반영
- 런타임 가드 함수도 자동 생성 — context 가 오염돼 들어오면 initial 로 fallback

**타입 설계의 핵심**
```ts
// 재귀 제네릭으로 단계별 타입을 누적
type CreateFunnelStepType<
  TSteps,
  TAccumulated = never,
> = TSteps extends [infer Head, ...infer Rest]
  ? // Head.requiredKeys 를 TAccumulated 에 합쳐서 다음 재귀로
    ...
  : TAccumulated;
```

**적용 영역**
- 회원가입·KYC·주문·보험 설계 등 단계 진행형 폼
- 멀티스텝 설정 위저드
- wizard 패턴이지만 타입 안전성이 중요한 경우

**관련 레시피** — [#11 Zod 스키마 compose](#11-zod-폼-스키마-compose) 와 조합: 각 step 별 zod 스키마를 `.extends()` 옵션에 `parse` 로 전달

**참고** — toss/use-funnel `packages/core/src/stepBuilder.ts`, `typeUtil.ts`

---

## 20. RSC + React Query hydration timeout

**문제** — Next.js App Router 에서 `<QueriesHydration>` 으로 서버 prefetch 하다 쿼리가 **오래 걸리면 전체 스트림이 멈춤**. 최악의 경우 TTFB 가 무한 지연.

**해법** — timeout 프롭 + 실패 시 CSR 폴백.

```tsx
// app/dashboard/page.tsx
import { QueriesHydration } from '@suspensive/react-query';

export default async function Page() {
  return (
    <QueriesHydration
      queries={[todosQuery(), userQuery()]}
      timeout={3000}  // 3초 내 응답 안 오면 포기
      skipSsrOnError={{ fallback: <Skeleton /> }}  // 타임아웃·실패 시 클라이언트에서 렌더
    >
      <Dashboard />
    </QueriesHydration>
  );
}
```

**내부 동작 (구현 골조)**
```ts
async function prefetchWithTimeout(queries, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    await Promise.race([
      Promise.all(queries.map((q) =>
        queryClient.fetchQuery({ ...q, signal: controller.signal })
      )),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new DOMException('Hydration timeout', 'TimeoutError'))
        )
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
```

**세 가지 `skipSsrOnError` 모드**
- `true` — 타임아웃·실패 시 아무것도 SSR 안 하고 클라이언트에서 모두 렌더
- `{ fallback: JSX }` — 서버는 fallback JSX 렌더, 클라이언트에서 실제 쿼리 재시도
- `false` — 실패하면 에러를 ErrorBoundary 로 던짐 (기본값)

**왜**
- "긴 쿼리 하나가 전체 페이지 SSR 을 막는" 장애 차단
- 네트워크 느릴 때 **CSR 로 우아한 저하** — 사용자는 Skeleton 보다가 데이터 받음
- 서버 리소스 회수(`AbortController.abort()`) — 프록시/DB 연결 해방

**주의**
- `timeout` 을 짧게 잡으면 SSR 이득이 줄어든다 — 3~5초가 현실적
- 취소 가능한 fetch 가 전제 — `queryFn` 이 `signal` 을 받아 전달해야 함
- React Suspense 경계와 함께 써야 클라이언트 재시도가 자연스러움

**참고** — toss/suspensive PR #1927, `packages/react-query-5/src/QueriesHydration.tsx` / [recipes #16 RSC colocation](#16-rsc-data-fetching-colocation) 와 조합

---

## 원칙 재확인

레시피는 **시작점**이지 교리가 아니다. 토스 가이드의 [주의 사항](../SKILL.md#주의-사항) 참조: "컨텍스트를 우선한다." 2명이 쓰는 스크립트에 도메인 폴더링, 프로토타입에 포커스 트랩을 강제하는 건 과잉이다.
