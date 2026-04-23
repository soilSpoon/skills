# 상황별 작성 레시피

"**작성 모드**"에서 자주 마주치는 상황을 **순서대로** 따라가는 체크리스트. 리뷰가 아니라 **처음부터 잘 쓰기** 위한 템플릿이다. 각 레시피는 4대 코드 품질 원칙 + 접근성을 **동시에** 고려한다.

## 목차

1. [Modal 만들 때](#1-modal-만들-때)
2. [커스텀 Toggle/Switch 만들 때](#2-커스텀-toggleswitch-만들-때)
3. [Form 만들 때](#3-form-만들-때)
4. [아이콘 버튼 만들 때](#4-아이콘-버튼-만들-때)
5. [서버 데이터 훅 만들 때](#5-서버-데이터-훅-만들-때)
6. [props drilling을 발견했을 때](#6-props-drilling을-발견했을-때)
7. [복잡한 조건 분기를 발견했을 때](#7-복잡한-조건-분기를-발견했을-때)
8. [새 기능의 디렉토리를 만들 때](#8-새-기능의-디렉토리를-만들-때)
9. [useEffect가 눈에 띄게 많아질 때](#9-useeffect-최소화)
10. [React Query 키·옵션 관리](#10-react-query-키-옵션-관리)
11. [Zod 폼 스키마를 여러 usecase에 쓸 때](#11-zod-폼-스키마-compose)
12. [응답/폼/페이로드 타입이 달라질 때](#12-응답폼페이로드-3-type-어댑터)
13. [다이얼로그 여러 개 관리](#13-선언적-다이얼로그-overlay-kit)
14. [z-index가 여기저기 박혀 있을 때](#14-z-index-시맨틱-토큰)
15. [서버가 돌려주는 문자열 enum 타이핑](#15-서버-enum-타이핑-전략)
16. [RSC에서 데이터 패칭 위치](#16-rsc-data-fetching-colocation)
17. [컴포넌트 API 확장: Fn + `.with` + `.Consumer`](#17-컴포넌트-api-확장-패턴)
18. [ErrorBoundary — fallback 내부 예외 상위 위임](#18-errorboundary-fallbackboundary)
19. [다단계 스키마 — 빌더 패턴 + 단계별 가드 누적](#19-다단계-스키마-빌더-패턴)
20. [RSC + React Query — hydration timeout + 실패 폴백](#20-rsc--react-query-hydration-timeout)

---

## 1. Modal 만들 때

**먼저 자문** — 정말 모달이어야 하는가? 페이지 전환·인라인 폼이 더 나은 경우 많다.

**체크리스트**
1. **native `<dialog>` 부터 고려** — `showModal()` 이 포커스 트랩·ESC·배경 차단을 무료로 제공 ([a11y-components.md #modal](a11y-components.md#modal))
2. native 불가 시:
   - `role="dialog"` + `aria-modal="true"`
   - `aria-labelledby="<제목 id>"` 또는 `aria-label`
   - 트리거 버튼에 `aria-haspopup="dialog"`
   - 열릴 때 모달 내부 첫 focusable로 포커스 이동, 닫힐 때 트리거로 복귀
   - `Escape` 키 핸들러로 닫기
   - 배경에 `inert` 속성 (또는 focus trap 라이브러리)
3. **상태 관리는 한 곳** — 열림/닫힘을 parent에서. 내부에선 `onClose` props로 위임. props drilling이 심하면 Context 고려 ([coupling.md #3](coupling.md#3-props-drilling-제거))
4. **렌더 조건** — `isOpen && <Modal/>` 로 DOM에 없을 때는 완전히 unmount. transition은 라이브러리(Framer Motion, react-aria)에 맡기기

## 2. 커스텀 Toggle/Switch 만들 때

**먼저 자문** — `<input type="checkbox">` 로 해결 안 되는가? 대부분 해결된다.

**체크리스트**
1. `role="switch"` (**checkbox 아님** — "켜짐/꺼짐" vs "선택됨/선택 안 됨")
2. `aria-checked={isOn}` — 상태 동기화 필수
3. `tabIndex={0}` — 포커스 가능
4. 아이콘만이면 `aria-label="다크 모드"` 같은 명시적 레이블
5. 인접 텍스트 있으면 `<label>` 로 감싸기
6. **키보드** — `Space` / `Enter` 키로 토글 처리
7. `focus-visible` 스타일 확실히 (접근성 + 디자인)

**타입 제약 팁** — `on: boolean` 하나만 받는 단일 책임 props. `variant`, `size`, `loading` 을 한꺼번에 때려넣으면 [예측 가능성 떨어짐](predictability.md).

## 3. Form 만들 때

**체크리스트**
1. **응집도 전략 결정** — 필드 독립적 → react-hook-form `register`, 필드 간 의존 → Zod 스키마 ([cohesion.md #3](cohesion.md#3-폼의-응집도-전략))
2. **모든 `<input>` 에 `<label htmlFor>`** — 예외 없음. 시각적 레이블이 없으면 `aria-label`
3. **그룹 입력(체크박스 다중, 라디오)** → `<fieldset>` + `<legend>`
4. **`<form>` 태그로 감싸기** — Enter 키 제출 보장
5. **에러 메시지 연결** — `aria-invalid={hasError}` + `aria-describedby="<error-id>"`
6. **검증 타이밍** — 입력 중 vs submit 시. 보통 submit 시 전체 검증 + 필드 이탈(blur) 시 해당 필드만
7. **제출 버튼** — `type="submit"` 명시, 로딩 중 `disabled` + `aria-busy`

## 4. 아이콘 버튼 만들 때

**체크리스트**
1. `<button>` 태그 사용 (`<div>` 아님 — 키보드·폼 제출 무료)
2. `aria-label="검색"` — 아이콘만이면 필수
3. 아이콘 자체는 `<svg aria-hidden="true">` 또는 `alt=""` (중복 announcement 방지)
4. 툴팁이 있다면 `aria-describedby` 로 연결 (label과 중복 X)
5. 클릭 영역 최소 **44x44 CSS 픽셀** (WCAG AAA 권장)

```tsx
<button aria-label="검색" onClick={onSearch}>
  <SearchIcon aria-hidden="true" />
</button>
```

## 5. 서버 데이터 훅 만들 때

**체크리스트**
1. **이름** — 다른 유사 훅과 반환 타입이 같은가? (`useUser`, `useServerTime` 모두 Query 객체 반환 같은 통일) ([predictability.md #2](predictability.md#2-같은-종류-함수-반환-타입-통일))
2. **라이브러리와 이름 겹침 확인** — `http`, `fetch`, `request` 같이 흔한 이름은 피하고 도메인 명사 붙이기 ([predictability.md #1](predictability.md#1-이름-겹치지-않게-관리))
3. **부작용 없음** — 내부에서 몰래 로깅·리다이렉트·분석 이벤트 발행 금지. 필요하면 훅 이름에 명시 (`useUserAndTrack`) ([predictability.md #3](predictability.md#3-숨은-로직-드러내기))
4. **책임 쪼개기** — 한 훅이 쿼리 파라미터 + 상태 + 서버 데이터를 모두 다루면 나누기 ([readability.md #6](readability.md#6-로직-종류별-함수-분리))
5. **에러·로딩 상태** — 반환 타입에 `isLoading`, `error` 또는 discriminated union 일관되게

## 6. props drilling을 발견했을 때

**판단 순서**
1. **몇 단 깊은가?**
   - 1~2단 → 그대로 둘 것 (오버엔지니어링 방지)
   - 3단 이상 → 리팩토링 고려
2. **어떻게 끊을까?**
   - (a) **조합 패턴(composition)** — `<Parent>{child content as children}</Parent>` 로 중간 계층이 모르게 하기 ([coupling.md #3](coupling.md#3-props-drilling-제거))
   - (b) **Context API** — 같은 값을 여러 자식이 쓰고, 업데이트 빈도가 낮을 때
   - (c) **전역 상태** — 다른 라우트와도 공유할 때만. 대부분 React Query로 서버 상태 해결 가능 ([discussions.md #2](discussions.md#2-전역-상태-도입-기준))

**안티패턴 주의** — props 이름만 `...rest` 로 넘기는 건 drilling 은폐. 타입 안전성까지 잃는다.

## 7. 복잡한 조건 분기를 발견했을 때

**패턴 매칭**
- 중첩 삼항 → `if` + early return 또는 IIFE ([readability.md #5](readability.md#5-삼항-단순화))
- `.some/.every` 중첩 → 중간 변수명 붙이기 ([readability.md #3](readability.md#3-복잡한-조건에-이름-붙이기))
- 같은 컴포넌트 안 viewer/admin 분기 → 컴포넌트 분리 ([readability.md #1](readability.md#1-배타적-분기-컴포넌트-분리))
- 여러 상태 조합 (3+ 개) → `ts-pattern` 같은 pattern matching 라이브러리
- `if (!value)` 같은 암묵적 boolean → 명시적 비교로 ([discussions.md #5](discussions.md#5-불리언-암묵적-타입-변환))

**범위 비교** — `a <= x && x <= b` 형식 유지 ([readability.md #8](readability.md#8-부등호-순서))

## 8. 새 기능의 디렉토리를 만들 때

**도메인 폴더링 기본형**
```
src/
├─ domains/
│  └─ <기능이름>/
│     ├─ components/
│     ├─ hooks/
│     ├─ api/         (또는 queries/)
│     ├─ types.ts
│     ├─ constants.ts
│     └─ index.ts    (공개 API만 re-export)
└─ shared/           (정말 여러 도메인이 쓰는 것만)
```

**체크리스트**
1. 기능명은 **도메인 언어** — "Invoice", "Statement" 같은 사용자·제품 용어. "Utils", "Common" 금지
2. 외부에서 참조하는 건 `index.ts` 에서만 export — 내부 구조 변경이 영향 안 주도록
3. 다른 도메인의 internal import 금지 (ESLint `import/no-internal-modules`)
4. `shared/` 에 올리기 전에 **3곳 이상에서 진짜 쓰는가** 확인 ([coupling.md #2](coupling.md#2-중복-허용하기))
5. 기능이 커지면 `<기능이름>/subfeatures/` 처럼 내부 재귀 구조 허용

**참고** — [cohesion.md #1](cohesion.md#1-함께-수정되는-파일-같은-디렉토리)

---

## 9. useEffect 최소화

**규칙** — `useEffect` 는 **외부 시스템과의 동기화**에만 쓴다. 파생값·이벤트 처리·변환은 Effect가 아니다. React 공식 가이드 "You Might Not Need an Effect".

**체크리스트 (Effect 쓰기 전에 자문)**
- [ ] 파생값인가? → `useMemo` 또는 **렌더 중 그냥 계산** (예: `const fullName = `${first} ${last}`` )
- [ ] 사용자 이벤트 결과인가? → 이벤트 핸들러에서 처리 (`onClick` 안에서 setState + 로깅)
- [ ] 부모 값이 바뀌면 리셋? → **`key` prop** 으로 컴포넌트 리마운트
- [ ] DOM 이벤트 부착? → **Callback Ref** (`<div ref={node => node?.addEventListener(...)} />`)
- [ ] 정말 외부 동기화 (웹소켓, 구독, 서드파티 SDK, localStorage 쓰기)? → 이때만 `useEffect`

**Before / After**
```tsx
// ❌ 파생값을 Effect로
const [fullName, setFullName] = useState("");
useEffect(() => { setFullName(`${first} ${last}`); }, [first, last]);

// ✅ 렌더 중 계산
const fullName = `${first} ${last}`;
```

```tsx
// ❌ Effect 에서 이벤트 부착
useEffect(() => { ref.current?.addEventListener("click", onClick); }, []);

// ✅ Callback Ref
<div ref={(node) => node?.addEventListener("click", onClick)} />
```

**참고** — React 공식: https://react.dev/learn/you-might-not-need-an-effect / 토론 #689

---

## 10. React Query 키·옵션 관리

**문제** — `useQuery({ queryKey: ['todos', sort], queryFn: () => fetchTodos(sort) })` 를 여러 곳에 복붙 → 캐시 키 불일치, 공통 옵션 누락, invalidation 어려움.

**해법 1: Query Key Factory** (key 체계화)

```ts
export const todoQueries = {
  all: () => ['todos'] as const,
  lists: () => [...todoQueries.all(), 'list'] as const,
  list: (sort: Sort) => [...todoQueries.lists(), sort] as const,
  details: () => [...todoQueries.all(), 'detail'] as const,
  detail: (id: string) => [...todoQueries.details(), id] as const,
};

useQuery({ queryKey: todoQueries.list('recent'), queryFn: () => fetchTodos('recent') });

// invalidate 상위에서 하위 전부
queryClient.invalidateQueries({ queryKey: todoQueries.lists() });
```

**해법 2: `queryOptions` 팩토리** (key + fn + 옵션을 한 객체로)

```ts
import { queryOptions } from '@tanstack/react-query';

export const todoDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ['todos', id],
    queryFn: () => fetchTodoDetail(id),
    enabled: Boolean(id),
  });

// 호출부는 어떤 hook 이든 재사용
const { data } = useQuery(todoDetailQuery(id));
const { data } = useSuspenseQuery(todoDetailQuery(id));
queryClient.prefetchQuery(todoDetailQuery(id));
```

**왜 훅 래퍼보다 낫나**
- `useXxx` 훅은 options 커스터마이즈(`staleTime`·`enabled`)를 위해 인자가 폭발
- `queryOptions` 객체는 호출부에서 spread로 오버라이드 가능 (`{ ...todoDetailQuery(id), staleTime: 5000 }`)
- `prefetchQuery` / `useSuspenseQuery` / 서버 컴포넌트 (RSC) 에서 재사용

**인증/에러 공통 처리** — **훅에 섞지 말 것**. axios interceptor·fetch 미들웨어·ErrorBoundary 로 위임.

**참고** — tkdodo "The Query Options API", `@lukemorales/query-key-factory` / 토론 #7, #202

---

## 11. Zod 폼 스키마 compose

**문제** — 같은 도메인 객체를 조회/생성/수정 usecase마다 `optional` 분포가 달라짐 → 거대 스키마 + 중복.

**해법** — `baseSchema` + `.pick`/`.omit`/`.partial`/`.required`/`.merge` 조합.

```ts
const userBase = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
});

// 생성: id 없음, phone optional
export const createUserSchema = userBase.omit({ id: true });

// 수정: 모두 있어야 함
export const updateUserSchema = userBase.required();

// 조회 파라미터: 일부만
export const userFilterSchema = userBase.pick({ name: true, email: true }).partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

**훅 단위로 스키마·타입·default 묶기**
```ts
export function useCreateUserForm() {
  return useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', phone: '' },
  });
}
```

**복잡한 분기 스키마 — Discriminated Union**

타입별 필드가 갈라지면 optional 범벅 대신:
```ts
const creativeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('video'), src: z.string(), duration: z.number() }),
  z.object({ type: z.literal('image'), src: z.string(), alt: z.string() }),
]);

// 타입 가드
const isVideo = (c: Creative): c is Extract<Creative, { type: 'video' }> => c.type === 'video';

// 렌더는 type 기반 switch
function CreativeForm({ creative }: { creative: Creative }) {
  switch (creative.type) {
    case 'video': return <VideoForm creative={creative} />;
    case 'image': return <ImageForm creative={creative} />;
  }
}
```

**트리거 신호** — 새 팀원이 "이 필드 언제 nullable이에요?" 묻는 순간 = optional이 암묵 지식화되어 있음.

**참고** — 토론 #85, #199

---

## 12. 응답/폼/페이로드 3-type 어댑터

**규칙** — 서버 Response, 화면 Form, 요청 Payload 는 **서로 다른 타입**이다. 억지로 하나로 맞추려다 optional 범벅이 되느니 **어댑터(mapper)** 를 두고 3개를 분리한다.

```ts
// 서버 타입
type UserResponse = { id: string; full_name: string; email: string };
// 폼 타입 (UI 요구사항)
type UserForm = { firstName: string; lastName: string; email: string };
// 요청 타입
type UserUpdatePayload = { id: string; full_name: string; email: string };

// 어댑터 레이어 (순수 함수)
export const responseToForm = (r: UserResponse): UserForm => {
  const [firstName, ...rest] = r.full_name.split(' ');
  return { firstName, lastName: rest.join(' '), email: r.email };
};

export const formToPayload = (id: string, f: UserForm): UserUpdatePayload => ({
  id,
  full_name: `${f.firstName} ${f.lastName}`.trim(),
  email: f.email,
});

// 컴포넌트
function EditUserPage({ user }: { user: UserResponse }) {
  const form = useForm<UserForm>({ defaultValues: responseToForm(user) });
  const onSubmit = (values: UserForm) => mutate(formToPayload(user.id, values));
}
```

**왜**
- 서버·UI 중 한쪽이 바뀌어도 어댑터만 수정
- zod `.transform` 에 무거운 로직을 두면 스키마가 지저분해짐 → 순수 함수로 분리
- 테스트 용이(어댑터는 입력·출력만 검증)

**참고** — 토론 #67

---

## 13. 선언적 다이얼로그 (overlay-kit)

**문제** — `isOpen` 상태를 10개+ 관리 → `useState` 폭발, props 전달 난잡, Promise 기반 confirm 패턴 구현 복잡.

**해법** — 토스 [`overlay-kit`](https://overlay-kit.slash.page) 또는 유사 라이브러리. **명령형 `open` + 선언적 렌더**.

```ts
import { overlay } from 'overlay-kit';

async function onDelete() {
  const confirmed = await overlay.openAsync<boolean>(({ isOpen, close }) => (
    <ConfirmDialog
      open={isOpen}
      title="정말 삭제할까요?"
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ));
  if (confirmed) deleteItem();
}
```

**왜 전역 상태보다 나은가**
- 호출부가 **Promise 를 await** 할 수 있어 흐름 제어가 선형
- 다이얼로그 트리거가 **로컬 함수**에 캡슐화 → 페이지 전역 리렌더 없음
- 컴포넌트 트리에 `isOpen` state prop 들을 안 뿌려도 됨

**React 19+ 대안** — `useActionState` + Form 액션 + `<dialog>` 의 `showModal()`.

**참고** — 토론 #42

---

## 14. z-index 시맨틱 토큰

**문제** — `z-index: 9999`, `z-index: 100`, `z-index: 1000` 이 산발적으로 박힘 → 어느 게 위인지 모름, 새 레이어 추가 시 값 경합.

**해법** — **레이어별 시맨틱 상수 파일**을 단일 출처로.

```ts
// src/styles/z-index.ts
export const Z = {
  base: 0,
  dropdown: 1000,
  sticky: 1100,
  overlay: 1200,
  modal: 1300,
  popover: 1400,
  tooltip: 1500,
  toast: 1600,
} as const;
```

```tsx
<div style={{ zIndex: Z.modal }}>...</div>
```

**규칙**
1. 숫자 직접 기입 금지 — ESLint `no-magic-numbers` 또는 `declaration-property-value-allowed-list`
2. 새 레이어는 기존 상수 사이로 끼워 넣기 (1300 → 1350 같은 틈 확보)
3. Portal 라이브러리(Radix/Headless UI)의 layer 값을 여기로 통합
4. **스태킹 컨텍스트 먼저 이해** — `position`+`z-index`, `transform`, `isolation: isolate` 가 새 스태킹 컨텍스트를 만든다. 이를 이용해 경합 자체를 줄이는 게 최선.

**참고** — [readability.md #4 매직 넘버](readability.md#4-매직-넘버-명명) 의 CSS 변형 / 토론 #162

---

## 15. 서버 enum 타이핑 전략

**문제** — 서버가 `"A" | "B" | "C"` 같은 카테고리를 돌려주는데 동적으로 추가될 수 있음. 클라이언트에서 좁히느냐 느슨히 두느냐.

**전략 (우선순위)**

**1. 코드젠 (최선)** — OpenAPI / Swagger / GraphQL codegen 파이프라인으로 서버가 단일 진실원.
```bash
openapi-typescript swagger.json -o types.gen.ts
```

**2. 고정 유니온 + UNKNOWN 폴백** (코드젠 불가 시)
```ts
type Status = 'active' | 'paused' | 'archived' | 'UNKNOWN';

function render(s: Status) {
  switch (s) {
    case 'active': return <Active />;
    case 'paused': return <Paused />;
    case 'archived': return <Archived />;
    default: return <Unknown />; // 서버에 새 값 추가되어도 깨지지 않음
  }
}
```

**3. Open Union 트릭** (literal 자동완성 + 확장 수용)
```ts
type Status = 'active' | 'paused' | (string & NonNullable<unknown>);
// 자동완성은 'active'/'paused' 뜨고, 다른 문자열도 허용
```

**안티패턴** — 그냥 `string` 으로 두기. literal 자동완성 없음 + 버그 잡힐 곳이 런타임.

**참고** — 토론 #150

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
