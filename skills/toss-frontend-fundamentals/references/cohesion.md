# 응집도 (Cohesion)

"같이 수정되는 코드가 같이 묶여 있어야 한다."

## 목차

1. [함께 수정되는 파일은 같은 디렉토리 (code-directory)](#1-함께-수정되는-파일-같은-디렉토리)
2. [매직 넘버 제거 - 응집도 관점 (magic-number-cohesion)](#2-매직-넘버-제거-응집도-관점)
3. [폼의 응집도 전략 (form-fields)](#3-폼의-응집도-전략)
4. [상수·헬퍼 선언 위치](#4-상수헬퍼-선언-위치)
5. [도메인 중심 디렉토리 구조](#5-도메인-중심-디렉토리)
6. [Hook vs Component 결정 규칙](#6-hook-vs-component-결정-규칙)
7. [폼 레이어 — Response / Form / Payload 어댑터](#7-폼-레이어-3-type-어댑터)
8. [RSC 데이터 패칭 colocation](#8-rsc-데이터-패칭-colocation)
9. [환경 분기 중앙화 — `_internal/globalThis.ts`](#9-환경-분기-중앙화)

---

## 1. 함께 수정되는 파일 같은 디렉토리

**원칙** — 파일 종류(`components/`, `hooks/`, `utils/`)로만 나누면 "기능 하나"를 수정하려 여러 폴더를 뒤져야 한다. **같이 수정되는 파일을 한 폴더로 모은다**(도메인 폴더링).

**Before**
```
src/
├─ components/
├─ hooks/
├─ utils/
└─ constants/
```

**After**
```
src/
├─ domains/
│  ├─ Invoice/
│  │  ├─ components/
│  │  ├─ hooks/
│  │  └─ utils/
│  └─ Statement/
│     ├─ components/
│     ├─ hooks/
│     └─ utils/
└─ shared/
```

**왜**
- 기능 수정 시 한 폴더만 본다
- 기능 삭제 시 폴더 째 지우면 끝 (잔재 코드 방지)
- 잘못된 cross-import(Invoice 훅이 Statement 컴포넌트 참조 등)가 눈에 띔

**주의** — 진짜 공유되는 것만 `shared/`에. 성급히 공유 폴더에 넣으면 결합도가 올라간다(see [coupling.md: 중복 허용하기](coupling.md#2-중복-허용하기)).

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/code-directory.html

---

## 2. 매직 넘버 제거 (응집도 관점)

**원칙** — [readability 4번](readability.md#4-매직-넘버-명명)과 같은 코드지만 관점이 다르다. 응집도 관점에서는 **같은 숫자가 여러 곳에 복제**되어 있을 때 문제다. 한 상수로 묶어 한 번에 수정되도록 한다.

**Before** — `300`이 4~5곳에 박혀 있음

**After**
```typescript
const ANIMATION_DELAY_MS = 300;
// 모든 사용처에서 이 상수 참조
```

**왜**
- 애니메이션 시간 변경 시 한 곳만 고침
- "이 300은 저 300과 같은 의미인가?" 고민 제거
- 상수 파일이 "시스템 타이밍의 단일 출처"가 됨

**주의** — 서로 **우연히 같은 숫자**지만 의미가 다른 경우(예: 재시도 횟수 3회 vs 페이지 크기 3)는 억지로 합치지 말 것. 오히려 결합도가 올라간다.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/magic-number-cohesion.html

---

## 3. 폼의 응집도 전략

**원칙** — 폼은 "필드 단위 응집도"와 "폼 전체 응집도" 중 **변경의 단위**에 맞게 선택한다. 잘못된 단위를 고르면 필드 하나 수정에 폼 전체가 흔들리거나, 반대로 분산된 검증이 서로 어긋난다.

**필드 단위 응집도** (react-hook-form `register` 스타일)
- 각 필드의 검증·에러가 **독립적**
- 재사용 가능한 필드 컴포넌트 만들기 쉬움
- 필드 간 의존성 없는 단순 폼에 적합

**폼 전체 응집도** (Zod 스키마 기반 등)
- 검증을 **한 곳(스키마)** 에서 관리
- 필드 간 의존(비밀번호 확인 = 비밀번호) 처리 용이
- 복잡한 다단 폼·크로스필드 검증에 적합

**선택 기준**
- 필드가 폼을 넘어 재사용됨 → 필드 단위
- 필드 간 상호 의존 있음 → 폼 전체
- 단일 기능(회원가입 등)이고 필드 수 적음 → 폼 전체가 보통 더 깔끔

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/form-fields.html

---

## 4. 상수·헬퍼 선언 위치

**원칙** — 상수·헬퍼를 **함수 안/밖** 중 어디 둘지는 두 축으로 판단: **범용성** × **도메인 지엽성**.

| 대상 | 권장 위치 | 이유 |
|---|---|---|
| 범용 상수 (`PI`, 시간 오프셋) | **컴포넌트·함수 밖** (또는 별도 파일) | 재사용, 재선언 방지 |
| 도메인 특화 매직 넘버 (함수 내부에서만 의미) | **함수 안** | 응집도 ≥ 약간의 시점 이동, 읽는 순서 유지 |
| `useReducer` 의 `initialState`·`reducer` | **컴포넌트 밖** | 렌더마다 재선언 회피 + 뷰 로직 집중 |
| 큰 `ACTION_TYPE` enum 또는 state 계산 유틸 | **별도 파일**로 분리 | 뷰 집중도, 테스트 가능 |

**예시**
```ts
// ✅ 함수 안 — 이 함수에서만 쓰이는 짧은 매직 넘버
function getNextMonth(year: number, m: OneBasedMonth) {
  const DECEMBER = 12, JANUARY = 1;
  const nextMonth = m + 1;
  return nextMonth > DECEMBER ? [year + 1, JANUARY] : [year, nextMonth];
}

// ✅ 컴포넌트 밖 — 렌더마다 재선언 필요 없음
const initialState = { input: '', select: '' };
function reducer(state, action) { /* ... */ }

export function Example() {
  const [state, dispatch] = useReducer(reducer, initialState);
  return <>...</>;
}
```

**핵심** — 시점 이동 비용은 **네이밍 명확성**으로 상쇄. `DECEMBER`, `ACTION_TYPE.CLEAR` 같은 이름은 정의 찾아갈 필요 없음.

**참고** — 토론 #221 / [readability #4 매직 넘버](readability.md#4-매직-넘버-명명)

---

## 5. 도메인 중심 디렉토리

**문제** — `components/`·`hooks/`·`utils/` 로만 나눈 파일 트리는 기능 추적이 어렵고, `pages/PageA`/`pages/PageB` 공통 로직을 `commons/`에 올리면 다른 도메인 페이지도 접근해 경계 붕괴.

**해법** — **도메인 폴더**가 훅·컴포넌트·유틸·타입을 함께 품는 구조 (FSD/Feature-Sliced 유사).

```
src/
├─ domains/
│  ├─ Invoice/
│  │  ├─ components/
│  │  ├─ hooks/
│  │  ├─ utils/
│  │  ├─ types.ts
│  │  └─ index.ts    (공개 API만 re-export)
│  └─ Statement/
│     └─ ...
├─ pages/            (도메인을 조립만)
│  ├─ InvoicePage.tsx
│  └─ StatementPage.tsx
└─ shared/           (정말 여러 도메인이 쓰는 것만)
```

**단계적 공용화**
- 2도메인 이상이 진짜 같은 로직? → `shared/` 로 승격
- 아직 애매? → 도메인 안에 둔 채 복제 허용 ([coupling #2 중복 허용](coupling.md#2-중복-허용하기))
- 중간 계층 → `features/` 또는 `lib/<domain>/` 같은 이름

**원칙** — `commons`, `utils`, `helpers` 같은 **의미 없는 버킷** 지양. 진짜 shared가 뭔지 경계를 강제.

**참고** — 토론 #196 / [cohesion #1 함께 수정되는 파일](#1-함께-수정되는-파일-같은-디렉토리)

---

## 6. Hook vs Component 결정 규칙

**규칙** — 반환값이 **UI** 또는 **DOM 사이드이펙트**면 **컴포넌트**, 반환값이 **값/상태/함수**면 **훅**.

```tsx
// ❌ 채널톡 부트스트랩을 훅으로 — JSX 트리에 의도가 안 드러남
export function useInitializeChannelTalk() {
  useEffect(() => {
    ChannelService.loadScript();
    ChannelService.boot({ pluginKey });
  }, []);
}

// ✅ 컴포넌트로 — 배치·조건부 렌더가 자연스러움
export function ChannelTalkButton() {
  useEffect(() => {
    ChannelService.loadScript();
    ChannelService.boot({ pluginKey });
  }, []);
  return null; // 또는 <></>
}

// App.tsx
<ChannelTalkButton />
```

**왜 컴포넌트가 나은가 (이 경우)**
1. JSX 트리에 "이 페이지에 채널톡이 있다"가 드러남 → **예측 가능성**
2. 조건부 렌더·`<Suspense>`·`<ErrorBoundary>` 로 감싸기 쉬움
3. 훅은 "값 반환/로직 재사용"의 원래 의미 유지 (응집도)

**적용 영역**
- 토스트·포털·포커스 트랩·SDK 부트스트랩 (`<Toast/>`, `<Portal/>`, `<ChatWidget/>`)
- 접근성 위젯 — [a11y-components.md](a11y-components.md) 와 동일 원칙

**참고** — 토론 #35

---

## 7. 폼 레이어 3-type 어댑터

**규칙** — 서버 **Response**, 화면 **Form**, 요청 **Payload** 는 서로 다른 타입. 하나로 합치려다 optional 범벅이 되지 말고 **어댑터(mapper)** 를 둔다.

```ts
type UserResponse = { id: string; full_name: string; email: string };
type UserForm = { firstName: string; lastName: string; email: string };
type UserUpdatePayload = { id: string; full_name: string; email: string };

// adapter layer — 순수 함수
export const responseToForm = (r: UserResponse): UserForm => {
  const [firstName, ...rest] = r.full_name.split(' ');
  return { firstName, lastName: rest.join(' '), email: r.email };
};

export const formToPayload = (id: string, f: UserForm): UserUpdatePayload => ({
  id,
  full_name: `${f.firstName} ${f.lastName}`.trim(),
  email: f.email,
});
```

**왜**
- Form은 UI 편의를 따라 쪼개지고, 서버 타입은 외부 변화에 휘둘림 → **어댑터가 충격 흡수**
- zod `.transform` 에 무거운 변환을 넣으면 스키마가 오염됨 → 순수 함수로 분리
- 어댑터는 입력·출력만 검증하면 되므로 테스트 단순

**전체 레시피** — [recipes.md #12](recipes.md#12-응답폼페이로드-3-type-어댑터)

**참고** — 토론 #67

---

## 8. RSC 데이터 패칭 colocation

**원칙** — Next.js App Router / RSC 환경에서는 **데이터를 쓰는 컴포넌트 곁에서 직접 fetch**. Page에서 한꺼번에 긁어 props로 내리지 않는다.

```tsx
// ❌ Page가 모든 자식 데이터 책임
export default async function Page({ params }) {
  const user = await getUser(params.id);
  const posts = await getPosts(params.id);
  return <Profile user={user} posts={posts} />;
}

// ✅ 각 컴포넌트가 자기 데이터 책임
export default async function Page({ params }) {
  return (
    <>
      <UserHeader id={params.id} />
      <PostList userId={params.id} />
    </>
  );
}
```

**중복 걱정은 `React.cache()` 로 해결**
```ts
import { cache } from 'react';
export const getUser = cache((id: string) => prisma.users.findUnique({ where: { id } }));
```

**전체 레시피** — [recipes.md #16](recipes.md#16-rsc-data-fetching-colocation)

**참고** — 토론 #66

---

## 9. 환경 분기 중앙화

**문제** — `typeof window === 'undefined'`, `typeof Buffer !== 'undefined'`, `navigator.userAgent.includes('...')` 같은 **환경 분기가 여러 파일에 흩어지면** 번들 사이드 이펙트(toss/es-toolkit #1671 의 Buffer 44KB 폴리필), 테스트 어려움, 플랫폼별 동작 차이를 추적하기 어려워진다.

**해법** — 환경 관련 체크를 `_internal/environment.ts` 같은 **단일 파일로 집약**.

```ts
// src/_internal/environment.ts
export const isBrowser = typeof window !== 'undefined';
export const isNode = typeof process !== 'undefined' && process.versions?.node != null;
export const isBuffer = (value: unknown): value is Buffer =>
  typeof Buffer !== 'undefined' && Buffer.isBuffer(value);
export const getGlobalThis = () => {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof window !== 'undefined') return window;
  if (typeof global !== 'undefined') return global;
  throw new Error('Unable to locate global object');
};
```

**왜**
- **번들러가 한 모듈만 swap** 하면 Browser/Node 환경 분리 가능 (Rollup alias, Webpack resolve.alias)
- 테스트에서 환경 mock 이 쉬움 (`vi.mock('@/_internal/environment', ...)`)
- 새 환경(Deno/Bun/Edge) 지원이 **한 파일 수정**으로 끝남
- 같이 쓰이는 환경 체크끼리 가까이 있어 누락 발견 용이

**적용 시 주의** — 앱 레벨에서는 `isBrowser` 같은 체크가 거의 없어도 돼야 한다 (서버 전용 / 클라이언트 전용 컴포넌트로 경계가 이미 나뉨). 라이브러리·유틸 계층에서 주로 필요한 패턴.

**참고** — toss/es-toolkit `src/_internal/globalThis.ts`, `src/predicate/isBuffer.ts`, PR #1671 (Buffer polyfill 44KB 제거)
