# 작성 레시피 ①  컴포넌트·구조 기본 (1–8: Modal·Toggle·Form·아이콘버튼·서버데이터훅·props drilling·조건분기·디렉토리)

"**작성 모드**"에서 자주 마주치는 상황을 **순서대로** 따라가는 체크리스트. 리뷰가 아니라 **처음부터 잘 쓰기** 위한 템플릿이다. 각 레시피는 4대 코드 품질 원칙 + 접근성을 **동시에** 고려한다.

> 이 파일은 `recipes.md`(작성 레시피 인덱스)에서 분리된 조각이다 — 필요한 묶음만 로드한다.

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

