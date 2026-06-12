# 결합도 (Coupling)

"한 곳 수정했을 때 영향 범위가 좁고 예측 가능해야 한다."

## 목차

1. [책임을 하나씩 관리 (use-page-state-coupling)](#1-책임을-하나씩-관리)
2. [중복 코드 허용하기 (use-bottom-sheet)](#2-중복-허용하기)
3. [Props Drilling 제거 (item-edit-modal)](#3-props-drilling-제거)
4. [데이터 주입 위치 — id vs 데이터](#4-데이터-주입-위치)
5. [어댑터 패턴 — 얇은 인터페이스 + DI 팩토리](#5-어댑터-패턴)
6. [점진 마이그레이션 — `/compat` 어댑터](#6-점진-마이그레이션-compat-어댑터)

---

## 1. 책임을 하나씩 관리

**원칙** — 광범위한 책임을 가진 **단일 훅**(예: 페이지의 모든 쿼리파라미터를 한 훅에서)은 수정할 때마다 **영향 범위가 페이지 전체**다. 책임을 쪼갠다.

**Before**
```typescript
// 페이지 전체 상태를 한 훅에
function usePageState() {
  // cardId, statementId, dateFrom, dateTo, statusList 전부
}
// 사용처 모두가 이 훅 하나에 결합
```

**After**
```typescript
function useCardIdQueryParam() { ... }
function useStatementIdQueryParam() { ... }
function useDateRangeQueryParam() { ... }
// 사용처는 필요한 훅만 의존
```

**왜**
- 수정의 영향이 해당 훅 사용처로 제한됨
- 다른 페이지로 재사용하기 쉬움(필요한 것만 가져감)
- 예상치 못한 부수 효과(리렌더, 초기화) 차단

**참고** — [readability.md: 로직 종류별 함수 분리](readability.md#6-로직-종류별-함수-분리)와 같은 리팩토링을 **결합도 관점**에서 본 것.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-coupling.html

---

## 2. 중복 허용하기

**원칙** — 공통화는 결합도를 올린다. 여러 페이지에서 **미래에 달라질 수 있는** 로직을 성급히 묶으면, 달라지는 부분을 처리하느라 인자·플래그가 계속 추가되고 결국 모든 사용처가 이 공통 모듈에 얽힌다. **중복을 허용**하는 편이 나을 때가 있다.

**Before** — 여러 페이지의 점검 바텀시트 로직을 `useMaintenanceBottomSheet()` 하나로 공통화 → 페이지마다 다른 로깅·동작을 지원하려 인자가 계속 늘어남.

**After** — 각 페이지가 독립적으로 바텀시트 로직 구현. 중복이 있어도 각자 자유롭게 바뀔 수 있음.

**공통화할지 판단 기준**
- 지금 동작이 정말 같은가? (우연히 같아 보이는 것과 구분)
- 앞으로도 같이 바뀔 것이 확실한가?
- 달라지는 시점이 왔을 때 공통 모듈에서 분리하기 쉬운가?

**왜 중복을 허용하면 좋아지는가**
- 각 사용처가 독립적으로 변경 가능 → 다른 페이지 테스트 불필요
- "공통 모듈이 자꾸 복잡해짐" 루프 회피
- 진짜 공통된 것이 드러날 때까지 기다릴 수 있음

**주의** — 의미론적으로 **진짜 한 개념**인 것은 공통화한다. `formatCurrency`, 정규식 상수, 도메인 엔티티 타입 등.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/use-bottom-sheet.html

---

## 3. Props Drilling 제거

**원칙** — 부모→자식→손자로 props가 그냥 **전달만 되는** 구조(props drilling)는 중간 컴포넌트를 props에 결합시킨다. prop 이름이 바뀌면 중간 단계 모두 수정해야 한다. **조합 패턴**(composition)으로 끊는다.

**Before**
```tsx
<ItemEditModal>
  <ItemEditBody
    items={items}
    recommendedItems={recommendedItems}
    onConfirm={onConfirm}
  />
</ItemEditModal>
// ItemEditBody 내부에서 ItemEditList로 또 전달
```

**After**
```tsx
<ItemEditModal>
  <ItemEditBody keyword={keyword} onClose={onClose}>
    <ItemEditList items={items} onConfirm={onConfirm} />
  </ItemEditBody>
</ItemEditModal>
```

**왜**
- 중간 컴포넌트가 자기가 쓰지 않는 props를 알 필요 없음
- props 변경이 관련 컴포넌트로만 제한됨
- 각 컴포넌트의 책임이 이름으로 드러남

**추가 도구**
- 컴포넌트 트리가 **매우 깊고** 여러 곳이 같은 값을 필요로 하면 → Context API
- 전역 상태가 꼭 필요한지는 [discussions.md: 전역 상태 도입 기준](discussions.md)을 참고

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/item-edit-modal.html

---

## 4. 데이터 주입 위치

**규칙** — 서버 데이터가 필요한 컴포넌트는 **상황에 따라 다르게** 결합도를 풀어야 한다. "컴포넌트 재사용성"을 기준으로 삼지 말고 **데이터 응집도**로 판단.

| 상황 | 권장 | 이유 |
|---|---|---|
| **단일 아이템 상세** (Post 하나) | **id만 받아 컴포넌트 내부에서 fetch** | 부모와 결합↓, custom hook이 Container 역할 |
| **리스트 렌더** (PostList) | **부모가 한 번에 fetch → props로 전달** | N+1 방지, 일괄 로딩·에러 처리 용이 |

```tsx
// ✅ 단일 상세 — 내부 패칭
function Post({ postId }: { postId: string }) {
  const { username, comment } = usePost(postId);
  return <div>{username}: {comment}</div>;
}

// ✅ 리스트 — 부모 패칭 + props
function PostList() {
  const posts = usePosts();
  return (
    <>
      {posts.map((p) => (
        <Post key={p.id} username={p.username} comment={p.comment} />
      ))}
    </>
  );
}
// 주의: 같은 Post 컴포넌트를 두 상황에서 공유하려 하면 시그니처가 꼬인다 —
// 리스트용 <PostRow /> 와 상세용 <PostDetail /> 로 분리하는 편이 낫다.
```

**왜 "재사용성"이 기준이 아닌가** — 재사용을 핑계로 prop API를 두 상황에 맞추면 optional 폭발 + 내부 분기가 늘어난다. 보통은 **두 컴포넌트로 분리**가 정답.

**참고** — 토론 #175

---

## 5. 어댑터 패턴

**목적** — 핵심 로직과 외부 시스템(라우터·스토리지·네트워크·SDK)을 **얇은 인터페이스**로 분리해, 외부가 교체돼도 core를 건드리지 않게 한다.

**공식** (toss/use-funnel 실제 사례)
1. **인터페이스 정의** — 계약이 크면 결합도가 안 떨어진다. 필드 수를 최소화.
   ```ts
   // FunnelRouter 전체 계약이 7개 필드
   interface FunnelRouter<TState> {
     history: TState[];
     currentIndex: number;
     push(step: string, context: unknown): void;
     replace(step: string, context: unknown): void;
     go(delta: number): void;
     cleanup(): void;
     transitionOption?: unknown;  // 어댑터별 확장
   }
   ```
2. **DI 팩토리** — core 는 라우터를 직접 생성/호출하지 않고, **팩토리를 통해 주입**.
   ```ts
   export const createUseFunnel = <R, F>(
     getRouter: (opts: FunnelOptions) => FunnelRouter<R>,
   ) => {
     return function useFunnel(initial: F) {
       const router = getRouter(/* ... */);
       // core 로직은 router 만 사용
     };
   };
   ```
3. **어댑터 구현** — 각 환경별로 팩토리 소비.
   ```ts
   // @use-funnel/browser
   export const useFunnel = createUseFunnel(() => browserHistoryRouter(...));
   // @use-funnel/next
   export const useFunnel = createUseFunnel(() => nextQueryRouter(...));
   ```
4. **Memory Mock** — 테스트용 in-memory 어댑터로 core 를 **라우터 없이 단독 검증**.
   ```ts
   export const memoryRouter = <T>(): FunnelRouter<T> => {
     let history: T[] = [];
     let index = 0;
     return { /* 필드 7개 구현 */ };
   };
   ```

**왜**
- 외부 라이브러리 메이저 업(react-navigation 6→7) 시 **어댑터만 수정**, core 무변경
- 새 환경 지원이 상수 시간 비용 (예: 새 라우터 어댑터 추가)
- 테스트가 실제 라우터에 종속되지 않음 → 빠르고 결정론적

**적용 영역** — 라우터·스토리지(localStorage/IndexedDB/SecureStorage)·HTTP 클라이언트·SDK 바인딩·분석 이벤트 전송 등 "환경에 따라 달라지지만 core 로직은 같은" 곳.

**주의** — 어댑터가 core 로 **새는 타입**(`any` 캐스트, 어댑터별 옵션을 core 에 흘림)이 생기면 결합도가 다시 올라감. core 는 어댑터 디테일을 **제네릭 파라미터** 로만 받기.

**참고** — toss/use-funnel `packages/core/src/router.ts`, `useFunnel.tsx` / `packages/{browser,next,react-router}/src/`

---

## 6. 점진 마이그레이션 — `/compat` 어댑터

**문제** — 공개 API 를 깔끔히 바꾸고 싶은데 **기존 사용처가 수백 곳**. 한 번에 바꾸면 위험.

**패턴** — 구 API 를 **어댑터로 감싸 새 구현 위에 올림**. 두 API 가 한 패키지에서 공존하다가 점진 이전.

**사례 1: 서브패스 분리 (라이브러리 전체)**
```ts
// es-toolkit — 엄격한 신규 API
import { chunk } from 'es-toolkit';

// es-toolkit/compat — lodash 호환 시그니처 (인자 순서, falsy 처리 등)
import { chunk } from 'es-toolkit/compat';
```
- `/compat` 는 **새 기능 추가 금지**, **lodash 일치 버그만 수정** (es-toolkit CLAUDE.md 방침)
- 마이그레이션 완료 후 `/compat` 제거 or 해당 사용처만 유지

**사례 2: 인접 파일 재래핑 (애플리케이션 모듈)**
```ts
// 새 API
export function useItemForm(id: string) { /* ... */ }

// compat.ts — 구 튜플 API 를 새 API 위에 래핑
export function useItemState(id: string): [Item, (next: Item) => void] {
  const form = useItemForm(id);
  return [form.value, form.setValue];
}

// 각 호출부를 파일 단위로 전환. 전환 완료되면 compat.ts 삭제.
```

**사례 3: `.withState` 같은 레거시 헬퍼 보존** (toss/use-funnel `@use-funnel/next/compat`)
```ts
// 레거시 API: [Funnel, setStep] = useFunnel(...)
// 새 API: { Render, history } = useFunnel(...)
export function createFunnel(steps: string[]) {
  // 레거시 API 시그니처를 새 훅 위에 어댑터로 구현
  return withStateAdapter(steps);
}
```

**원칙**
- compat 는 **동결** — 버그 수정만, 새 기능 금지
- **Deprecation 경고** 를 dev 모드에서만 노출 (프로덕션 로그 오염 방지)
- 마이그레이션 완료 기한을 명시해 무한 지속 방지

**참고** — toss/es-toolkit `src/compat/`, toss/use-funnel `packages/next/src/compat.tsx`
