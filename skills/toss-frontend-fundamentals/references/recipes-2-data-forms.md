# 작성 레시피 ②  데이터·폼·타입 (9–15: useEffect·React Query·Zod·3-type 어댑터·다이얼로그·z-index·enum)

"**작성 모드**"에서 자주 마주치는 상황을 **순서대로** 따라가는 체크리스트. 리뷰가 아니라 **처음부터 잘 쓰기** 위한 템플릿이다. 각 레시피는 4대 코드 품질 원칙 + 접근성을 **동시에** 고려한다.

> 이 파일은 `recipes.md`(작성 레시피 인덱스)에서 분리된 조각이다 — 필요한 묶음만 로드한다.

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

