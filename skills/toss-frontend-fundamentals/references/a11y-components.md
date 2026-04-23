# UI 컴포넌트별 접근성 패턴

각 컴포넌트는 **role · label · state** 삼요소 + 키보드 지원이 핵심. native HTML로 해결되는 건 native로, 안 될 때만 ARIA로.

## 목차

1. [Tab](#tab)
2. [Accordion](#accordion)
3. [Modal](#modal)
4. [Radio](#radio)
5. [Checkbox](#checkbox)
6. [Switch](#switch)

---

## Tab

**필수** — `role="tablist"` 컨테이너 / `role="tab"` 버튼 / `role="tabpanel"` 콘텐츠 / `aria-selected` / `aria-controls` / `aria-labelledby` / 비활성 패널엔 `hidden`

```tsx
<div role="tablist" aria-label="메뉴">
  <button role="tab" aria-selected={tab==="home"} id="tab-home" aria-controls="panel-home">홈</button>
  <button role="tab" aria-selected={tab==="liked"} id="tab-liked" aria-controls="panel-liked">관심</button>
</div>

<div role="tabpanel" id="panel-home" aria-labelledby="tab-home" hidden={tab!=="home"}>...</div>
<div role="tabpanel" id="panel-liked" aria-labelledby="tab-liked" hidden={tab!=="liked"}>...</div>
```

**키보드** — `ArrowLeft`/`ArrowRight`로 탭 이동, `Home`/`End`로 처음·끝 이동이 표준.

**함정**
- `aria-selected` 빠짐 → 선택 탭 구분 불가
- 비활성 `tabpanel` 에 `hidden` 안 붙임 → 스크린 리더가 전부 읽음
- 탭/패널 간 `aria-controls` ↔ `aria-labelledby` 링크 누락

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/tab.html

---

## Accordion

**필수** — 헤더 버튼에 `aria-expanded` + `aria-controls` / 패널에 `id` + `role="region"` + `aria-labelledby` / 닫힘 상태에서 `hidden`

```tsx
<button
  id="acc-btn-1"
  aria-expanded={isOpen}
  aria-controls="acc-panel-1"
  onClick={toggle}
>
  제목
</button>
<div
  id="acc-panel-1"
  role="region"
  aria-labelledby="acc-btn-1"
  hidden={!isOpen}
>
  내용
</div>
```

**가장 쉬운 길** — native `<details>/<summary>`:
```tsx
<details open={isOpen} onToggle={onToggle}>
  <summary>제목</summary>
  <p>내용</p>
</details>
```

**함정**
- `aria-expanded` 와 `hidden` 비동기 → 상태 잘못 읽힘
- 아이콘만 있는 헤더에 `aria-label` 없음
- 여러 버튼-패널을 독립 요소로 취급(관계 정보 없음)

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/accordion.html

---

## Modal

**필수** — `role="dialog"` + `aria-modal="true"` / `aria-labelledby` 또는 `aria-label` 로 제목 / 트리거 버튼에 `aria-haspopup="dialog"` / **포커스 관리** (열릴 때 모달 안으로, 닫힐 때 트리거로 복귀) / **ESC 지원** / 배경 `inert`

```tsx
const ref = useRef<HTMLDialogElement>(null);

return (
  <>
    <button aria-haspopup="dialog" onClick={() => ref.current?.showModal()}>
      열기
    </button>
    <dialog ref={ref} aria-labelledby="modal-title">
      <h3 id="modal-title">중요 안내</h3>
      <button onClick={() => ref.current?.close()}>확인</button>
    </dialog>
  </>
);
```

**가장 쉬운 길** — native `<dialog>` + `showModal()`. 포커스 트랩·ESC·배경 차단 모두 브라우저가 처리.

**함정**
- 포커스 관리 안 함 → 키보드 사용자가 모달 밖에서 작업
- ESC 미지원 → 키보드로 닫을 방법 없음
- 배경 `inert` 안 걸림 → 뒤 콘텐츠도 Tab으로 접근 가능
- `<div className="modal">` 커스텀 구현 시 위 전부를 직접 해야 함 — 실수 많음

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/modal.html

---

## Radio

**필수** — `<fieldset>` + `<legend>` 로 그룹화 / 모든 라디오의 `name` 동일 / `<label htmlFor>` 연결 / 커스텀이면 `role="radio"` + `aria-checked` + `tabIndex={0}` + `ArrowUp`/`ArrowDown` 키 처리

```tsx
<fieldset>
  <legend>국가 선택</legend>
  <label htmlFor="ko">대한민국</label>
  <input type="radio" id="ko" name="country" />

  <label htmlFor="au">호주</label>
  <input type="radio" id="au" name="country" />
</fieldset>
```

**함정**
- `fieldset`/`legend` 누락 → 스크린 리더가 "어떤 질문에 대한 선택인지" 모름
- `name` 서로 다름 → 브라우저 단일 선택 기능 깨짐 (여러 개 동시 선택됨)
- 커스텀 구현에 `Space`·방향키 핸들러 없음 → 키보드 사용 불가

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/radio.html

---

## Checkbox

**필수** — `<input type="checkbox">` + `<label>` / 그룹은 `<fieldset>`+`<legend>` / 커스텀이면 `role="checkbox"` + `aria-checked` + `tabIndex={0}` + `Space` 키 처리

```tsx
// Native
<fieldset>
  <legend>수신 동의</legend>
  <input type="checkbox" id="email" />
  <label htmlFor="email">이메일 수신</label>
</fieldset>

// Custom
<div
  role="checkbox"
  aria-checked={checked}
  tabIndex={0}
  onKeyDown={(e) => e.key === " " && setChecked(!checked)}
  onClick={() => setChecked(!checked)}
>
  ...
</div>
```

**함정**
- `<label>` 연결 누락 → 레이블 클릭해도 토글 안 되고 스크린 리더도 이름 못 읽음
- 그룹 `<fieldset>` 누락 → 집합적 의미 전달 실패
- 커스텀 구현에 `Space` 키 미처리

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/checkbox.html

---

## Switch

**필수** — `role="switch"` + `aria-checked` (체크박스가 아님 — "켜짐/꺼짐"을 표현) / `aria-label` 이나 인접 텍스트 / `tabIndex={0}` / `Space` 키 토글

```tsx
// 인접 텍스트가 있을 때
<label>
  <input type="checkbox" role="switch" checked={isOn} hidden />
  알림 설정
</label>

// 아이콘만일 때
<span role="switch" aria-checked={isOn} tabIndex={0} aria-label="다크 모드">
  <img src="/toggle.png" alt="" />
</span>
```

**함정**
- `role="switch"` 대신 `role="checkbox"` → "선택됨/선택 안 됨"으로 읽힘 (의도는 "켜짐/꺼짐")
- `aria-checked` 누락 → 상태 전달 불가
- 아이콘만 있는데 `aria-label` 없음

**원문** — https://frontend-fundamentals.com/a11y/ui-foundation/switch.html

---

## 위에 없는 컴포넌트는?

- **드롭다운 메뉴** → `role="menu"` + `role="menuitem"` + 방향키 이동 + `Escape` 닫기
- **툴팁** → `role="tooltip"` + 트리거에 `aria-describedby`
- **알림/토스트** → `role="status"` (`aria-live="polite"`) 또는 `role="alert"` (`aria-live="assertive"`)
- **드래그·정렬** → 키보드 대안(↑/↓로 순서 이동) 필수

기초 원리([a11y-basics.md](a11y-basics.md))의 **role·label·state** 를 조합해 설계. 헷갈리면 [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) 참고.
