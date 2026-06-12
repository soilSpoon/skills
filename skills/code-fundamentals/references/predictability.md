# 예측 가능성 (Predictability)

"이름·시그니처만 보고 동작을 예측할 수 있어야 한다."

## 목차

1. [이름 겹치지 않게 관리 (http)](#1-이름-겹치지-않게-관리)
2. [같은 종류 함수는 반환 타입 통일 (use-user)](#2-같은-종류-함수-반환-타입-통일)
3. [숨은 로직 드러내기 (hidden-logic)](#3-숨은-로직-드러내기)
4. [Boolean state 네이밍](#4-boolean-state-네이밍)
5. [Controlled 컴포넌트 value/onChange](#5-controlled-컴포넌트-valueonchange)
6. [복수형 fetcher 네이밍 — 반환 타입 기반](#6-복수형-fetcher-네이밍)
7. [Named export 기본](#7-named-export-기본)
8. [Strict 동등 비교 — != null 사용 제한](#8-strict-동등-비교)
9. [선언적으로 쓰기 — 명령형 분기 최소화](#9-선언적으로-쓰기)
10. [Indexed Access Types — 타입 단일 원천](#10-indexed-access-types)
11. [서버 enum 타이핑 전략](#11-서버-enum-타이핑-전략)
12. [템플릿 리터럴 타입으로 문자열 결합 검증](#12-템플릿-리터럴-타입-문자열-결합-검증)
13. [플랫폼 표준 타입으로 승격](#13-플랫폼-표준-타입으로-승격)

---

## 1. 이름 겹치지 않게 관리

**원칙** — 라이브러리나 표준 API와 **이름이 겹치는** 커스텀 함수는 "같은 이름 = 같은 동작" 기대를 깨뜨려 예측 가능성을 떨어뜨린다. 동작이 다르면 이름도 달라야 한다.

**Before**
```typescript
import { http as httpLibrary } from "@some-library/http";
// 라이브러리 http와 이름이 같지만 인증까지 몰래 추가
export const http = {
  async get(url: string) {
    const token = await fetchToken();
    return httpLibrary.get(url, { headers: { Authorization: `Bearer ${token}` } });
  }
};
```

**After**
```typescript
export const httpService = {
  async getWithAuth(url: string) {
    const token = await fetchToken();
    return httpLibrary.get(url, { headers: { Authorization: `Bearer ${token}` } });
  }
};
```

**왜**
- `getWithAuth` 이름이 추가 동작(인증)을 명시
- 라이브러리의 `http`와 혼동되지 않음
- 호출부에서 "이건 인증이 붙는구나"를 바로 인지

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/http.html

---

## 2. 같은 종류 함수 반환 타입 통일

**원칙** — 같은 종류 훅(예: `useXxx` 서버 데이터 훅)이 **어떤 건 Query 객체**, **어떤 건 `.data`만** 반환하면 호출부에서 매번 타입을 확인해야 한다. 같은 종류면 반환 타입을 통일한다.

**Before**
```typescript
function useUser() {
  const query = useQuery(...);
  return query;            // Query 객체
}
function useServerTime() {
  const query = useQuery(...);
  return query.data;       // 데이터만
}
```

**After**
```typescript
function useUser() { return useQuery(...); }
function useServerTime() { return useQuery(...); } // 둘 다 Query 객체
```

**왜**
- 호출부가 `.data`, `.isLoading`, `.error`를 동일한 방식으로 다룰 수 있음
- 팀원이 새 훅을 볼 때 시그니처를 예측 가능
- Discriminated Union으로 성공/실패를 컴파일러 수준에서 보장 가능

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/use-user.html

---

## 3. 숨은 로직 드러내기

**원칙** — 함수 시그니처(이름·파라미터·반환타입)에 **드러나지 않는 부작용**(로깅, 분석 이벤트, 리다이렉트 등)은 호출자가 예측할 수 없다. 부작용은 호출부로 끌어올리거나 이름으로 드러낸다.

**Before**
```typescript
async function fetchBalance(): Promise<number> {
  const balance = await http.get<number>("...");
  logging.log("balance_fetched");   // 숨은 로깅
  return balance;
}
```

**After**
```typescript
async function fetchBalance(): Promise<number> {
  return await http.get<number>("...");
}

// 호출부에서 명시적으로
const balance = await fetchBalance();
logging.log("balance_fetched");
```

**왜**
- `fetchBalance` 시그니처만 봐서는 로깅을 알 수 없음(예측 불가)
- 로깅 서버가 다운되면 잔액 조회까지 영향 받는 불필요한 결합
- 로깅 필요 여부를 호출자가 결정 가능 (테스트·재사용성↑)

**응용** — 부작용이 본질적이라 분리할 수 없을 때는 이름을 `fetchBalanceAndLog` 처럼 **드러나게** 짓는다.

**원문** — https://frontend-fundamentals.com/code-quality/code/examples/hidden-logic.html

---

## 4. Boolean state 네이밍

**규칙** — Boolean 변수는 `is/has/can/should` + 명사. `useState` setter는 **변수명 그대로** 유지 (`setIsX`).

```tsx
// ✅
const [isLoading, setIsLoading] = useState(false);
const [hasError, setHasError] = useState(false);
const [canSubmit, setCanSubmit] = useState(true);

// ❌ setter만 줄이면 변수-세터 쌍이 깨짐
const [isLoading, setLoading] = useState(false);
```

**왜**
- 변수명·세터명이 짝을 이루면 grep·리팩터·자동완성 모두 안정
- Boolean 임을 이름이 알려주니 타입 추론 실수 감소 (`if (loading)` → 숫자일 가능성 0)

**참고** — 토론 #88

---

## 5. Controlled 컴포넌트 value/onChange

**규칙** — 제어 컴포넌트는 `value`/`onChange` 쌍을 **기본형**으로. 컴포넌트 이름이 이미 도메인을 표현하므로 prop에 prefix 중복 금지.

```tsx
// ✅ — TermsEditor 이름이 이미 도메인을 표현
type Props = {
  value: Term[];
  onChange?: (v: Term[]) => void;
};
function TermsEditor({ value, onChange }: Props) { ... }

// ❌ — 도메인 중복
type Props = { terms: Term[]; onTermsChange?: (t: Term[]) => void };
```

**왜**
- `value/onChange`는 React 생태 표준 — `<input>`, `<select>` 와 동일 규약
- 컴포넌트 재사용/조합 시 prop 이름으로 인한 혼란 제거
- 객체 설계에서도 `post.authorId` 대신 `post.author.id` 같은 계층 표현이 prefix 중복을 없앰

**Context API 주의** — 제어 상태를 Context로 숨기는 건 **props drilling 대체용**이지 기본값이 아니다. 외부 주입이 모호해져 테스트·재사용이 어려워진다.

**참고** — 토론 #177

---

## 6. 복수형 fetcher 네이밍

**규칙** — 배열 반환 함수 이름은 **반환 타입**에 맞춰 선택한다.

- `T[]` 순수 배열 반환 → **복수형** (`getGames(): Promise<Game[]>`)
- `{ data: T[]; pagination; ... }` 같은 래퍼 타입 → **`~List`** (`getGameList(): Promise<GameList>`)
- `findAll...` 은 ORM/백엔드 관용어 — 프론트엔드엔 잘 안 씀

```ts
const getGames = (): Promise<Game[]> => http.get('/games');

type GameList = { data: Game[]; pagination: Pagination };
const getGameList = (): Promise<GameList> => http.get('/games?paginated=true');
```

**왜** — 반환 타입과 이름을 짝지으면 호출부가 시그니처 안 봐도 반환 구조를 예측.

**참고** — 토론 #488

---

## 7. Named export 기본

**규칙** — 모듈 export는 **named**를 기본값으로. `default`는 프레임워크 규약(`page.tsx`, `layout.tsx`)이 강제할 때만.

```ts
// ✅
export function useBar() { return 'bar'; }
import { useBar } from './useBar';

// ❌ 특수한 이유 없이 default
export default function useBar() { return 'bar'; }
import useBar from './useBar';  // 호출부가 이름을 맘대로 바꿀 수 있음
```

**왜**
- 리네이밍·자동완성·grep 친화 (default import는 로컬 이름이 제각각)
- tree-shaking 안정
- 오타 발견 — named 는 import 시점에 바로 실패, default 는 null 넘어가 런타임 crash

**ESLint** — `import/no-default-export` (Next.js 특정 파일은 per-file override)

**참고** — 토론 #96

---

## 8. Strict 동등 비교

**규칙** — 기본은 `===`/`!==`. null/undefined 둘 다 체크하려면 `??`·`?.`·타입 가드 함수.

```ts
// ❌ 느슨 — 의도 모호
if (x != null) doSomething();

// ✅ 명시
if (x !== null && x !== undefined) doSomething();
// 또는 nullish 연산자
const name = user?.name ?? 'Anonymous';
// 또는 타입 가드
function isNotNullish<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}
```

**예외** — 팀 합의가 있고 ESLint로 `!= null` 만 허용하는 경우. 그 외엔 `@typescript-eslint/strict-boolean-expressions` 활성화.

**관련** — [discussions.md #5 불리언 암묵적 변환](discussions.md#5-불리언-암묵적-타입-변환) / 토론 #189

---

## 9. 선언적으로 쓰기

**규칙** — 명령형 분기·절차보다 **상태 → 선언적 렌더** 로. "무엇을 할지"(imperative)보다 "무엇인지"(declarative).

```tsx
// ❌ 명령형 분기 (DOM 조작)
button.addEventListener('click', () => box.classList.toggle('active'));

// ✅ 선언적 (상태 기반)
const [isActive, setIsActive] = useState(false);
<div className={isActive ? 'active' : 'inactive'} onClick={() => setIsActive(v => !v)} />
```

**원칙**
- 단일 진실 원천(single source of truth) 유지 — 한 상태를 여러 곳에서 수정하지 않기
- 조건을 외부에서 토글하는 대신 **상태 계산**으로 귀결
- 명령형이 필요한 자리(SDK 초기화, 외부 시스템 동기화)는 `useEffect` 또는 컴포넌트로 캡슐화 ([recipes.md #9](recipes.md#9-useeffect-최소화))

**참고** — 토론 #188

---

## 10. Indexed Access Types

**규칙** — 중첩 타입의 일부를 꺼낼 때 **별도 export 대신** Indexed Access Type 쓰기. 타입 단일 원천 유지.

```ts
// ❌ 매번 새 타입 이름 만들기
type Bookmark = { id: string; title: string };
type BookmarkResponseType = { bookmarks: Bookmark[]; total: number };

// ✅ 원천에서 파생
type BookmarkResponseType = { bookmarks: { id: string; title: string }[]; total: number };
type Bookmark = BookmarkResponseType['bookmarks'][number];

// API 타입 통합 인덱싱
type API = {
  getUser: { request: { id: string }; response: { name: string } };
};
type GetUserReq = API['getUser']['request'];
type GetUserRes = API['getUser']['response'];
```

**왜**
- 원천이 바뀌면 파생 타입 자동 갱신
- 타입 이름 난립(`GetUserRequest`, `GetUserRes`) 방지
- Mapped + Indexed Access 조합으로 discriminated union 추론 보강 가능

**참고** — 토론 #45

---

## 11. 서버 enum 타이핑 전략

**문제** — 서버가 돌려주는 `"active" | "paused"` 같은 카테고리가 동적으로 추가될 때 클라이언트가 깨짐.

**전략 (우선순위 순)**

1. **코드젠** — OpenAPI/Swagger/GraphQL 스키마 → 타입 자동 생성. 단일 진실 원천.
   ```bash
   openapi-typescript swagger.json -o types.gen.ts
   ```

2. **고정 유니온 + UNKNOWN 폴백** — 코드젠 불가 시
   ```ts
   type Status = 'active' | 'paused' | 'UNKNOWN';
   switch (status) {
     case 'active': ...
     case 'paused': ...
     default: /* UNKNOWN 포함, 서버 새 값도 무너지지 않음 */
   }
   ```

3. **Open Union** — literal 자동완성 + 확장 수용
   ```ts
   type Status = 'active' | 'paused' | (string & NonNullable<unknown>);
   ```

**안티패턴** — 그냥 `string`. 자동완성 없고 버그는 런타임에만.

**자세한 레시피** — [recipes.md #15 서버 enum 타이핑](recipes.md#15-서버-enum-타이핑-전략)

**참고** — 토론 #150

---

## 12. 템플릿 리터럴 타입 문자열 결합 검증

**규칙** — 함수가 **문자열을 조합해서 반환**하고 입력 조합이 유한하다면, 반환값을 **템플릿 리터럴 타입**으로 선언해 컴파일 타임에 결과를 고정한다.

**예: 조사 결합** (toss/es-hangul)
```ts
type JosaOption = '을/를' | '이/가' | '은/는';

// 반환 타입이 단순 string 이면 호출부가 구체 값을 모름
function josa<T extends string>(word: T, option: JosaOption): string;

// 템플릿 리터럴로 조합하면 반환값이 컴파일 타임에 결정
type ExtractJosaOption<T extends JosaOption> =
  T extends '을/를' ? '을' | '를' :
  T extends '이/가' ? '이' | '가' :
  T extends '은/는' ? '은' | '는' : never;

function josa<T extends string, U extends JosaOption>(
  word: T,
  option: U,
): `${T}${ExtractJosaOption<U>}`;

const result = josa('학교', '을/를');  // 타입: '학교을' | '학교를'
```

**적용 영역**
- 조사·영어 접미사(-s/-ing) 같은 언어적 결합
- URL 경로 생성 (`/users/${id}/posts` 식의 타입 보장)
- CSS class 조합 (`${Size}-${Variant}` → `sm-primary` | `lg-danger` ...)
- 이벤트 이름 (`on${Capitalize<T>}`)

**한계** — 유니온이 커질수록 **조합 폭발**. 입력이 4개 × 4개 × 4개면 64개 리터럴 타입이 생겨 IDE가 느려진다. 3단계 이상 조합되면 `string` 으로 퇴화 고려.

**참고** — toss/es-hangul `src/core/josa/josa.ts`

---

## 13. 플랫폼 표준 타입으로 승격

**규칙** — 커스텀 에러·상태 타입을 만들 때 **플랫폼 표준에 이미 같은 의미가 있으면** 표준을 상속하거나 그대로 쓴다. 사용자가 이미 아는 `instanceof` 관용구가 그대로 작동.

**예: AbortError → DOMException**
```ts
// ❌ 커스텀 Error — 사용자가 새 타입을 학습해야 함
export class AbortError extends Error {
  name = 'AbortError';
}

// ✅ DOMException 확장 — `AbortSignal.timeout()` 와 동일 타입
export class AbortError extends DOMException {
  constructor(message = 'The operation was aborted.') {
    super(message, 'AbortError');
  }
}

// 호출부: 플랫폼 표준 검사가 그대로 먹힘
try {
  await fetchWithAbort(signal);
} catch (err) {
  if (err instanceof DOMException && err.name === 'AbortError') {
    // 브라우저 signal.timeout() 과 동일하게 처리
  }
}
```

**왜**
- `instanceof Error`/`instanceof DOMException` 체크가 그대로 동작 → 사용자 코드 변경 최소
- 플랫폼 API(AbortSignal, AbortController) 와 자연스럽게 상호운용
- 새 학습 부담 제거 (MDN 문서가 그대로 적용됨)

**다른 예**
- 진행률 → `ProgressEvent` 계열 사용
- 입력 검증 실패 → `RangeError`/`TypeError` 사용 (커스텀 `ValidationError` 대신)
- 네트워크 실패 → `TypeError` ('Failed to fetch' 관용, fetch API 와 일관)

**주의** — 도메인 고유 의미가 있는 에러(비즈니스 규칙 위반, 권한 부족 등)는 커스텀이 맞다. **플랫폼에 같은 의미가 있을 때만** 승격.

**참고** — toss/es-toolkit PR #1660 (`AbortError`, `TimeoutError` → `DOMException` 확장)
