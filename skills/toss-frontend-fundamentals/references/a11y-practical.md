# 접근성 실전 가이드

4대 원칙([a11y-basics.md](a11y-basics.md#4대-원칙))에 대응하는 **구체적 코드 패턴** 7가지. 각각 흔한 실수·이상적 형태·이유를 담는다.

## 목차

1. [구조 명확화](#1-구조-명확화)
   - 버튼 안에 버튼 넣지 않기
   - 테이블 행에 직접 onClick 붙이지 않기
2. [의미 정확 전달](#2-의미-정확-전달)
   - 인터랙티브 요소에 이름 붙이기
   - 같은 이름의 요소에 설명 추가하기
3. [예상 가능한 동작](#3-예상-가능한-동작)
   - 버튼 역할과 동작 일치시키기
   - 입력 요소는 `<form>` 으로 감싸기
4. [시각 정보 보완](#4-시각-정보-보완)
   - 이미지·아이콘 대체 텍스트

---

## 1. 구조 명확화

### 버튼 안에 버튼 넣지 않기

**규칙** — 상호작용 요소(`<a>`, `<button>`, `<input>`) 안에 또 다른 상호작용 요소를 중첩하지 않는다. HTML 표준 위반 + 키보드/스크린 리더 혼란.

**❌**
```jsx
<a href="/go-to">
  <Button>확인했어요.</Button>
</a>
```

**✅**
```jsx
<Button as="a" href="/go-to">
  확인했어요.
</Button>
```

**왜**
- HTML 스펙 위반 — 어느 상호작용이 실제로 발동될지 예측 불가
- 포커스 순서 꼬여 Tab 동작 이상
- 스크린 리더가 중첩 버튼을 잘못 읽음

**원문** — https://frontend-fundamentals.com/a11y/structure/button-inside-button.html

---

### 테이블 행에 직접 onClick 붙이지 않기

**규칙** — `<tr onClick>` 로 행 전체를 클릭 가능하게 만들지 말 것. 내부에 `<a>` 링크를 두고 CSS로 클릭 영역을 행 전체로 확장한다.

**❌**
```jsx
<tr onClick={() => navigate('/detail/김토스')}>
  <td>김토스</td>
  <td>22</td>
</tr>
```

**✅**
```jsx
<tr style={{ position: 'relative' }}>
  <td>
    김토스
    <IconLink
      label="자세히 보기"
      href="/detail/김토스"
      className="link"
    />
  </td>
  <td>22</td>
</tr>
```
```css
.link::after {
  position: absolute;
  inset: 0;
  content: '';
  display: block;
}
```

**왜**
- `<tr>` 은 기본 포커스 불가 → 키보드 사용자 접근 불가
- `<a>` 는 새 창 열기·주소 복사 같은 브라우저 기능 무료
- 스크린 리더가 링크로 인식

**원문** — https://frontend-fundamentals.com/a11y/structure/table-row-link.html

---

## 2. 의미 정확 전달

### 인터랙티브 요소에 이름 붙이기

**규칙** — `<input>`, `<button>`, `<select>` 등 모든 상호작용 요소는 **접근 가능한 이름(accessible name)** 을 가져야 한다. placeholder는 이름이 **아니다**.

**❌**
```html
<input type="text" />
<input type="text" placeholder="이름을 입력하세요" />  <!-- placeholder만 있음 -->
```

**✅**
```html
<!-- 방법 1: label + htmlFor -->
<label htmlFor="user-name">이름</label>
<input id="user-name" type="text" />

<!-- 방법 2: aria-label -->
<input type="text" aria-label="이름" placeholder="이름을 입력하세요" />

<!-- 방법 3: aria-labelledby -->
<h2 id="addr-h">배송 주소</h2>
<input type="text" aria-labelledby="addr-h" />
```

**왜**
- placeholder는 입력 시 사라짐 → 사용자가 목적 잊음
- 스크린 리더가 필드 정체 파악 불가
- `<label>` 은 **클릭 영역도 확대** (터치에 유리)

**원문** — https://frontend-fundamentals.com/a11y/semantic/required-label.html

---

### 같은 이름의 요소에 설명 추가하기

**규칙** — 같은 텍스트의 버튼이 여러 개 있는 경우(예: 상품 목록의 "선택" 버튼들) 각각이 어떤 항목과 연결되는지 이름으로 구분해야 한다.

**❌** (리스트에 "선택" 버튼 N개)
```html
<li>
  <h3>종이</h3>
  <button>선택</button>   <!-- "선택, 버튼" 으로만 읽힘 -->
</li>
<li>
  <h3>플라스틱</h3>
  <button>선택</button>
</li>
```

**✅**
```html
<li>
  <h3 id="paper-title">종이</h3>
  <button aria-labelledby="paper-title paper-btn" id="paper-btn">선택</button>
  <!-- "종이 선택" 으로 읽힘 -->
</li>
```

또는 개별 `aria-label`:
```html
<button aria-label="종이 선택">선택</button>
```

**왜**
- 스크린 리더 사용자는 모든 버튼이 동일하게 들림 → 어느 항목인지 모름
- `aria-labelledby` 로 **여러 id 조합** 가능 → 기존 제목 재사용

**원문** — https://frontend-fundamentals.com/a11y/semantic/duplicate-interactive-element.html

---

## 3. 예상 가능한 동작

### 버튼 역할과 동작 일치시키기

**규칙** — 버튼처럼 생긴 요소는 **정말 `<button>`** 이어야 한다. `<div>` + `onClick` + CSS 는 키보드·스크린 리더에 전혀 보이지 않음.

**❌**
```jsx
<div className="button-style" onClick={handleClick} style={{cursor: 'pointer'}}>
  문의하기
</div>
```

**✅** (3가지 방법, 선호 순서)

1. **`<button>` 사용** — 가장 쉽고 안전
```jsx
<button onClick={handleClick}>문의하기</button>
```

2. **접근성 속성 명시** — 스타일 이슈로 `<div>` 써야 할 때만
```jsx
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') handleClick();
  }}
>
  문의하기
</div>
```

3. **react-aria `useButton`** — 복잡한 커스텀 버튼
```jsx
const { buttonProps } = useButton({ onPress: handleClick }, ref);
return <div ref={ref} {...buttonProps}>문의하기</div>;
```

**왜**
- `<div>` 는 키보드 포커스 불가, Enter/Space 미지원, 스크린 리더가 "버튼"이라 읽지 않음
- `<button>` 은 이 모든 걸 **무료로** 제공

**원문** — https://frontend-fundamentals.com/a11y/predictability/fake-button.html

---

### 입력 요소는 `<form>` 으로 감싸기

**규칙** — `<input>`, `<textarea>` 등 폼 필드는 반드시 `<form>` 안에. 단순 `<div>` 래핑은 Enter 제출·자동완성·스크린 리더 폼 탐색을 모두 깬다.

**❌**
```html
<div>
  <input type="text" name="username" />
  <input type="password" name="password" />
  <button>로그인</button>
</div>
```

**✅**
```html
<form onSubmit={(e) => { e.preventDefault(); login(); }}>
  <label htmlFor="login-id">아이디</label>
  <input id="login-id" name="id" type="text" />
  <label htmlFor="login-pw">비밀번호</label>
  <input id="login-pw" name="pw" type="password" />
  <button type="submit">로그인</button>
</form>
```

**왜**
- Enter 키 자동 제출 — 사용자의 **기본 기대**
- 브라우저 자동완성 / 비밀번호 저장 / 모바일 키보드 "이동→완료" 버튼
- 스크린 리더가 "폼 시작/끝" 안내 + 단축키로 폼 간 이동

**원문** — https://frontend-fundamentals.com/a11y/predictability/form.html

---

## 4. 시각 정보 보완

### 이미지·아이콘 대체 텍스트

**규칙** — 이미지·아이콘이 **정보를 전달**하면 의미 있는 `alt`, **장식**이거나 **옆에 텍스트가 있으면** `alt=""` (스크린 리더가 중복 읽지 않도록).

**❌**
```html
<!-- 의미 있는 아이콘에 alt 비움 → 스크린 리더가 "버튼"만 읽음 -->
<button>
  <img src="search.svg" alt="" />
</button>

<!-- 텍스트 옆 아이콘에 중복 alt -->
<button>
  <img src="trash.svg" alt="삭제 아이콘" />
  삭제
</button>
<!-- 스크린 리더: "삭제 아이콘 삭제" (중복) -->
```

**✅**
```html
<!-- 아이콘만 — 의미 전달해야 함 -->
<button>
  <img src="search.svg" alt="검색" />
</button>

<!-- 텍스트와 함께 — 아이콘은 장식 -->
<button>
  <img src="trash.svg" alt="" />
  삭제
</button>
```

**왜**
- `alt=""` ≠ 속성 없음. 없으면 스크린 리더가 **파일명**을 읽음 (최악)
- 장식용에 `alt=""` 를 **명시** — "나는 의미가 없다"를 선언
- `<svg>` 로 인라인 쓰면 `aria-hidden="true"` 가 같은 역할

**추가 팁**
- 복잡한 인포그래픽 → `alt` + `<figcaption>` 또는 `aria-describedby` 로 상세 설명 연결
- 반복되는 장식 (예: 리스트 불릿) → CSS `background-image` 로 아예 DOM 에서 제거

**원문** — https://frontend-fundamentals.com/a11y/alt-text/image-alt.html

---

## 체크리스트 (실전 가이드 통합)

리뷰 시 빠르게 훑기:

- [ ] `<a>`·`<button>` 안에 또 다른 `<a>`/`<button>` 없음
- [ ] `<tr onClick>` 없음. 링크는 `<a>` + CSS 클릭 영역 확장
- [ ] 모든 input 에 `<label htmlFor>` 또는 `aria-label` (placeholder만 금지)
- [ ] 같은 텍스트 버튼이 여러 개라면 각각 고유 이름
- [ ] `<div onClick>` / `<span onClick>` 대신 `<button>` 사용
- [ ] 입력 필드는 `<form>` 안에
- [ ] `<img>` 는 의미 있으면 `alt="설명"`, 장식/중복이면 `alt=""`
