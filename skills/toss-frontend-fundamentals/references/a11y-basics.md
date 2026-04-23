# 접근성 기초 (A11y Basics)

"접근성은 모든 사용자가 더 쉽고 편리하게 웹을 사용하도록 돕는 기본 원칙이다." 스크린 리더·키보드 사용자뿐 아니라 일반 사용자의 편의성과 코드 테스트 가능성까지 개선한다.

## 목차

1. [왜 접근성인가](#왜-접근성인가)
2. [4대 원칙](#4대-원칙)
3. [핵심 3요소: Role · Label · State](#핵심-3요소)
4. [ESLint 자동화 (jsx-a11y)](#eslint-자동화)

---

## 왜 접근성인가

- **보조기기 사용자 지원** — 스크린 리더가 role·label·상태를 읽어줘야 사용 가능
- **키보드 사용자 지원** — Tab / Shift+Tab / Enter / Space / 방향키로 모든 상호작용 가능해야 함
- **일반 사용자 편의** — 링크 우클릭 메뉴, Enter 폼 제출, 모달 ESC 닫기 같은 "익숙한 동작"이 자연스럽게 작동
- **테스트 품질** — Testing Library의 `getByRole`, `getByLabelText`가 더 견고해짐. 마크업 구조 변경에 강건한 테스트
- **유지보수성** — semantic HTML이 DOM 구조 변경에 더 강하다

## 4대 원칙

### 1. 올바른 구조 만들기

HTML을 의미에 맞게 중첩·배치한다.

- ❌ 버튼 안에 버튼 (`<button><button>...</button></button>`) — 스크린 리더 혼란, 클릭 이벤트 충돌
- ❌ 테이블 행 전체가 클릭 영역인데 `<div>` 로 래핑 — semantic 손실
- ✅ 클릭 가능한 요소는 `<button>`·`<a>`·`<label>` 같은 native element로 시작

### 2. 의미를 정확하게 전달하기

사용자가 요소의 정체·기능을 명확히 인지할 수 있어야 한다.

- ❌ `<button><Icon/></button>` — 스크린 리더가 "button"만 읽음
- ✅ `<button aria-label="검색"><Icon/></button>` — "검색 버튼"으로 읽힘
- ✅ 카드 번호 입력 4개라면 각각 "첫번째 4자리", "두번째 4자리" 로 **고유 레이블**

### 3. 예측 가능한 인터랙션 만들기

**보이는 것 = 실제 동작**.

- ❌ 링크처럼 생겼는데 클릭해도 이동 안 함 / 버튼처럼 생겼는데 form submit
- ✅ `<input>` 은 `<form>` 으로 감싸서 Enter 키 제출 보장
- ✅ 버튼은 `<button>`, 이동은 `<a href>`, 토글은 `role="switch"` — 의도와 element 일치

### 4. 시각 정보에만 의존하지 않기

색·아이콘·이미지는 대체 수단으로 보완.

- ❌ "빨간색 = 오류" 만으로 표시 — 색각 이상 사용자 인지 불가
- ✅ 색 + 아이콘 + 텍스트 (`❌ 비밀번호 8자 이상이어야 합니다`)
- ✅ 의미 있는 이미지는 `alt="설명"`, 장식용은 `alt=""`
- ✅ 아이콘 버튼은 `aria-label` 필수

---

## 핵심 3요소

스크린 리더는 UI 요소를 **role · label · state** 세 가지로 해석한다. 커스텀 컴포넌트를 만들 때 이 셋을 모두 챙겨야 한다.

### Role (역할)

"이게 뭔지" 알려준다. **native HTML 우선**, `<div>`/`<span>` 커스텀일 때만 `role=` 명시.

```tsx
// ✅ native element — role 불필요
<button>제출</button>
<input type="checkbox" />

// ✅ 커스텀 요소 — role 명시
<div role="checkbox" aria-checked={checked} tabIndex={0}>...</div>
<div role="dialog" aria-modal="true" aria-labelledby="title">...</div>
```

**자주 쓰는 role** — `button`, `checkbox`, `radio`, `switch`, `tab`, `tablist`, `tabpanel`, `dialog`, `alert`, `status`, `region`, `navigation`, `menu`, `menuitem`

**원칙** — "native가 있으면 native". `<button>` 대신 `<div role="button">` 쓰지 말 것. 키보드·포커스·Enter/Space 처리까지 직접 구현해야 함.

### Label (이름)

"뭘 하는지" 알려준다.

- **폼 input** → `<label htmlFor>` 로 연결
- **아이콘 버튼** → `aria-label="검색"`
- **같은 역할 반복** (카드번호 4분할 등) → 각자 다른 레이블
- **다른 요소가 제목 역할** → `aria-labelledby="heading-id"`

```tsx
// ❌
<input type="text" />
<button><SearchIcon/></button>

// ✅
<label htmlFor="addr">주소</label>
<input id="addr" type="text" />
<button aria-label="검색"><SearchIcon/></button>
```

### State (상태)

"지금 어떤지" 알려준다. native element는 자동, 커스텀은 ARIA로.

| 속성 | 용도 |
|---|---|
| `aria-checked` | 체크박스·스위치·라디오 |
| `aria-selected` | 탭·리스트 선택 |
| `aria-expanded` | 아코디언·드롭다운 |
| `aria-disabled` | 비활성 (단, `disabled` 속성이 먼저) |
| `aria-current` | 현재 위치 (네비 링크, 오늘 날짜) |
| `aria-live` | 동적 업데이트 (`polite` / `assertive`) |
| `aria-invalid` | 입력 검증 실패 |

```tsx
// ❌ 상태가 시각으로만 표현
<span className={isOn ? "on" : "off"}>
  <img src={isOn ? "on.png" : "off.png"} />
</span>

// ✅ 스크린 리더도 상태 인지
<span
  role="switch"
  aria-checked={isOn}
  tabIndex={0}
  aria-label="알림 설정"
>
  <img src={isOn ? "on.png" : "off.png"} alt="" />
</span>
```

**중요** — `aria-expanded` 와 `hidden` 처럼 **시각 상태와 ARIA 상태를 항상 동기화**. 한쪽만 바뀌면 스크린 리더가 잘못된 정보 제공.

---

## ESLint 자동화

**`eslint-plugin-jsx-a11y`** 로 대부분의 기본 위반을 컴파일 타임에 잡는다.

```bash
yarn add -D eslint-plugin-jsx-a11y
# eslint.config.js 또는 .eslintrc 에 extends: ['plugin:jsx-a11y/recommended']
```

**주요 규칙**

| 규칙 | 잡는 것 |
|---|---|
| `alt-text` | `<img>` 에 `alt` 없음 — 장식용은 `alt=""` |
| `control-has-associated-label` | 폼 컨트롤에 label 없음 (**기본 off — 직접 on 권장**) |
| `no-noninteractive-element-interactions` | `<div onClick>` 같은 비상호작용 요소에 이벤트 |
| `no-noninteractive-element-to-interactive-role` | `<h1 role="button">` 같이 semantic 뒤집기 |
| `no-noninteractive-tabindex` | 비상호작용 요소에 `tabIndex` |
| `tabindex-no-positive` | `tabIndex={3}` 같은 양수 값 (예측 불가 포커스 순서) |

**권장 최소 설정**
```json
{
  "extends": ["plugin:jsx-a11y/recommended"],
  "rules": {
    "jsx-a11y/control-has-associated-label": "error"
  }
}
```

**한계** — jsx-a11y는 정적 분석. `aria-expanded` 동기화나 `focus trap` 같은 런타임 동작은 못 잡는다. 이런 건 E2E + Testing Library `getByRole` 로 보완.

### 디자인 시스템 컴포넌트에 적용

jsx-a11y는 표준 HTML (`<button>`, `<img>` 등) 만 인식한다. 조직 디자인 시스템의 `<MyButton>`, `<MyImage>` 같은 커스텀 컴포넌트는 **매핑**을 명시해야 규칙이 작동한다.

```json
// .eslintrc 또는 eslint.config.js
{
  "settings": {
    "jsx-a11y": {
      "components": {
        "MyButton": "button",
        "MyImage": "img",
        "MyInput": "input",
        "MyAnchor": "a"
      },
      "polymorphicPropName": "as"
    }
  }
}
```

**옵션 요약**
- `components` — 커스텀 컴포넌트 → 기본 HTML 매핑 (alt-text, control-has-associated-label 등 규칙이 이 매핑을 보고 작동)
- `polymorphicPropName` — `<MyButton as="a" href="...">` 패턴을 쓴다면 명시. 기본은 `as`
- `labelAttributes` — children 대신 `contents`, `text` 같은 prop으로 텍스트를 받는 디자인 시스템은 이 옵션에 prop 이름 추가

**왜 중요** — 디자인 시스템을 쓰는 순간, 매핑 설정 없이는 `eslint-plugin-jsx-a11y` 가 사실상 **끄진 상태**가 된다. 팀에서 커스텀 컴포넌트를 도입하는 첫날 이 설정을 함께 넣어야 한다.

**원문** — https://frontend-fundamentals.com/a11y/eslint/design-system.html

---

## 테스트로 접근성 강제하기

**핵심 원칙** — Testing Library의 쿼리 우선순위는 "**사용자가 요소를 찾는 방식**"을 따른다. `getByRole` 이나 `getByLabelText` 로 테스트를 쓰면, 테스트가 통과한다는 건 스크린 리더 사용자도 그 요소에 접근할 수 있다는 증거가 된다.

### 권장 쿼리 순서 (Testing Library 공식)

1. **`getByRole`** — 가장 먼저. role + name 조합은 스크린 리더가 보는 방식
2. **`getByLabelText`** — 폼 input 에 최적
3. **`getByPlaceholderText`** — label 이 없을 때만 (보통 label 쓰는 게 맞음)
4. **`getByText`** — 상호작용이 아닌 순수 텍스트
5. **`getByDisplayValue`** — 현재 값 기반
6. **`getByAltText`** — 이미지
7. **`getByTitle`** — `title` 속성 기반
8. **`getByTestId`** — **최후의 수단**. 위 모두가 안 될 때만

### Before / After

```tsx
// ❌ data-testid 로 찾음 — 마크업 세부 구현에 의존
render(<SubmitButton />);
fireEvent.click(screen.getByTestId("submit-btn"));

// ✅ role + name 으로 찾음 — 접근성 통과 = 테스트 통과
render(<SubmitButton />);
fireEvent.click(screen.getByRole("button", { name: "제출" }));
```

```tsx
// ❌ 아이콘 버튼의 aria-label 이 깨져도 테스트는 통과
const btn = screen.getByTestId("search-btn");

// ✅ aria-label 빠지면 테스트 실패 — 자연스레 a11y 강제
const btn = screen.getByRole("button", { name: "검색" });
```

### 자주 쓰는 패턴

**폼 input**
```tsx
// 레이블로 찾기 — <label htmlFor> 연결이 깨지면 실패
const input = screen.getByLabelText("이메일");
fireEvent.change(input, { target: { value: "a@b.com" } });
```

**토글 상태 검증**
```tsx
const toggle = screen.getByRole("switch", { name: "다크 모드" });
expect(toggle).toHaveAttribute("aria-checked", "false");

fireEvent.click(toggle);
expect(toggle).toHaveAttribute("aria-checked", "true");
```

**모달 열림**
```tsx
fireEvent.click(screen.getByRole("button", { name: "열기" }));
// 모달이 role=dialog + aria-labelledby 제대로 세팅되어야 통과
const modal = await screen.findByRole("dialog", { name: "중요 안내" });
expect(modal).toBeInTheDocument();
```

**탭 전환**
```tsx
const homeTab = screen.getByRole("tab", { name: "홈" });
expect(homeTab).toHaveAttribute("aria-selected", "true");
```

### 테스트가 실패했는데 접근성 문제라면

Testing Library 에러 메시지는 **accessibility tree** 를 덤프한다. `getByRole("button", { name: "..." })` 가 실패하면 화면에 실제로 렌더된 role/name 목록을 함께 보여준다 — 이게 **스크린 리더가 보는 것과 같다**. 디버깅과 a11y 개선이 동시에 된다.

### 자동화 도구 조합

| 도구 | 잡는 것 |
|---|---|
| `eslint-plugin-jsx-a11y` | 정적 위반(누락된 alt, aria-*) |
| Testing Library (`getByRole`) | role/label이 실제로 연결되는지 |
| `@axe-core/react` | 런타임 WCAG 위반 (색 대비, landmark 등) |
| Storybook `a11y` addon | 컴포넌트 단위 반자동 audit |
| Playwright / Cypress + axe | E2E a11y 검증 |

**추천 조합** — 최소 `jsx-a11y` + `getByRole` 중심 테스트. 중형 이상이면 `@axe-core/react` 추가.

### 타입 테스트와 런타임 테스트 공존

공개 API 가 복잡한 타입을 갖는다면 **런타임 테스트만으로는 회귀를 잡지 못한다**. 예를 들어 `getByRole("button", { name: "X" })` 는 실행은 하지만 이 API 의 타입이 바뀌어 `name` 이 사라져도 런타임 테스트는 통과한다.

**해법** — 런타임 테스트 옆에 `*.test-d.tsx` 를 두고 `vitest --typecheck` 로 **한 파이프라인에서 실행**.

```ts
// MyComponent.test-d.tsx
import { expectTypeOf } from 'vitest';
import { MyComponent, type MyProps } from './MyComponent';

expectTypeOf<MyProps>().toHaveProperty('onSubmit');
expectTypeOf<MyProps['onSubmit']>().parameters.toEqualTypeOf<[FormData]>();

// discriminated union 검증
type Variant = MyProps['variant'];
expectTypeOf<Variant>().toEqualTypeOf<'primary' | 'secondary'>();
```

`vitest.config.ts`:
```ts
export default defineConfig({
  test: {
    typecheck: { enabled: true, include: ['**/*.test-d.{ts,tsx}'] },
  },
});
```

**활용 예**
- 훅 반환 타입이 인자에 따라 narrowing 되는가 (`useFunnel.history.push(next)` 의 required 필드)
- discriminated union 이 실제로 좁혀지는가 (`shouldCatch` → `error` 자동 추론)
- 제네릭 기본값이 퇴화해도 호출부 타입이 유지되는가

**주의** — 타입 테스트는 **공개 API 의 핵심 계약**만 검증. 내부 헬퍼의 타입까지 테스트하면 리팩터 비용만 늘어난다.

**참고** — toss/suspensive `packages/react/src/*.test-d.tsx`, toss/use-funnel `packages/core/test/typeUtil.test-d.tsx`

---

**원문**
- 주요 원칙: https://frontend-fundamentals.com/a11y/principles.html
- Role: https://frontend-fundamentals.com/a11y/basic-guide/role.html
- Label: https://frontend-fundamentals.com/a11y/basic-guide/label.html
- State: https://frontend-fundamentals.com/a11y/basic-guide/state.html
- ESLint: https://frontend-fundamentals.com/a11y/eslint/rules.html
- ESLint x 디자인 시스템: https://frontend-fundamentals.com/a11y/eslint/design-system.html
- 왜 접근성인가: https://frontend-fundamentals.com/a11y/why.html
- 인터랙티브 체험 playground: https://frontend-fundamentals.com/a11y/playground.html
