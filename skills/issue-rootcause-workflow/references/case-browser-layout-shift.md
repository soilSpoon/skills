# Case Study — 우측 도크 열 때 좌측 패널이 가로로 밀림 (원칙 #9 의 기원)

## TL;DR

워크벤치에서 우측 도크(AI 어시스턴트)를 열면 좌측 속성 패널과 캔버스가 잠깐 왼쪽으로 밀렸다 돌아왔다. 처음엔 `requestAnimationFrame` 으로 패널 *폭*만 재서 "360px 고정 → 도크와 결합 없음"이라 **오판(false negative)**. 사용자가 "스크린샷은 동작 끝난 뒤라 그렇다"고 push → confound 밖 도구(CDP 스크린캐스트)로 재측정 + *옳은 관측값*(left 좌표·부모 scrollLeft) 으로 보니 실제로 슬라이드했다. `scrollIntoView` 를 패치해 호출자를 특정: 채팅 자동스크롤이 화면 밖(`translate-x-full`) 도크를 보이려고 `overflow-hidden` 콘텐츠 영역을 *가로로* 스크롤했다. fix: 그 영역을 `overflow-clip`(스크롤 컨테이너 아님)으로 변경.

## Setup

- 증상: 우측 도크 토글로 열 때 좌측 패널 + 캔버스가 가로로 출렁임.
- 1차 가설: 두 패널이 어떤 상태로 결합돼 있다.
- 1차 측정: Playwright + `requestAnimationFrame` 루프로 좌측 패널 `getBoundingClientRect().width` 를 샘플.
- 1차 결론(틀림): 폭이 내내 360px → "안 움직인다 → 결합 없음".

## false negative 의 두 출처 (원칙 #9)

### A. 측정 도구가 굶었다 (instrument as confound)

`requestAnimationFrame`·`setInterval`·`page.evaluate` 폴링은 전부 **페이지 메인스레드**에서 돈다. 그런데 관측하려는 순간(도크 열 때의 무거운 리렌더, WASM 부팅)이 바로 메인스레드를 막는 구간이다 → 도구가 굶어 *중간 프레임을 통째로 잃는다*. 샘플 분포가 그 증거였다: 무거운 구간에 샘플 1개(`[{t:278}]`), 1.7초 갭에 0개.

> 도구가 피측정 시스템과 같은 자원(메인스레드)을 공유하면, *관측하려는 바로 그 바쁜 순간*에 눈을 감는다.

### B. 엉뚱한 관측값을 봤다 (wrong observable)

"애니메이션 = 폭 변화"라고 *가정*하고 width 만 쟀다. 실제 움직임은 **위치**였다 — 패널 폭은 360px 고정인 채 `left` 좌표가 −100→64 로 슬라이드. 폭만 보면 영원히 "변화 없음".

> "width 고정"은 "안 움직임"이 아니다. 위치·부모 스크롤·transform 으로 얼마든지 움직인다.

## 측정 다시 — confound 밖 도구 + 옳은 관측값

1. **CDP `Page.startScreencast`** — 프레임을 브라우저/compositor 프로세스가 생성하므로 페이지 메인스레드 starvation 과 무관. 저장한 프레임에서 좌측 콘텐츠가 화면 밖으로 잘려 슬라이드하는 게 *눈으로* 보였다.
2. **옳은 관측값** — 폭이 아니라 `left` 좌표와 *부모 컨테이너의 `scrollLeft`* 를 측정:
   - 좌측 패널 `left`: −100 → 64
   - 메인 `left`: 260 → 424
   - 콘텐츠 영역 `scrollLeft`: **384 → 0** ← 진짜 신호
   - 도크 `left`/`transform`: 변화 없음 (도크가 미는 게 아니다)
3. 큐잉되는 `focusin` 이벤트는 0건 → focus 기반 스크롤은 아님.

## 진짜 mechanism — 의심 API 패치 + stack trace

`focusin` 이 없는데 `scrollLeft` 이 튀었다 → `scrollIntoView`/`scrollTo` 의심(이들은 focus 이벤트를 안 낸다). recompile 못 하는 런타임이므로 #7 의 `errs()`+rebuild 대신 *프로토타입 패치 + 스택*:

```js
const orig = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function (...a) {
  window.__calls.push(new Error().stack);
  return orig.apply(this, a);
};
```

스택이 호출자를 결정적으로 가리켰다: **채팅의 `ConversationContent` useEffect** 가 `scrollIntoView({ block: 'end' })`(최신 메시지로 자동스크롤)를 호출.

인과 사슬:
1. 도크는 접힌 동안 `translate-x-full` 로 화면 *밖*(오른쪽)에 있다.
2. 도크를 열면(또는 닫힌 채 마운트 시) 채팅이 자기 바닥을 `scrollIntoView`.
3. 그 대상이 가로로 화면 밖이라, 브라우저가 보이게 하려고 *가장 가까운 스크롤 가능 조상*을 가로로 스크롤한다.
4. 그 조상이 워크벤치 콘텐츠 영역(`overflow-hidden`)이었다. `overflow:hidden` 은 **여전히 스크롤 컨테이너** — `scrollLeft` 을 가질 수 있다.
5. → 영역 전체(좌측 패널 + 캔버스)가 가로로 밀렸다가 settle.

## Fix

콘텐츠 영역을 `overflow-hidden` → `overflow-clip` 으로. `clip` 은 클리핑은 동일하되 *스크롤 컨테이너가 아니라서* 어떤 하위 `scrollIntoView` 도 이 영역을 스크롤할 수 없다.

```diff
- <div className="relative flex min-w-0 flex-1 overflow-hidden">
+ <div className="relative flex min-w-0 flex-1 overflow-clip">
```

검증(수정 후): 도크는 정상 슬라이드(`left 1480→1080`), 좌측 패널은 `left=64` 고정, 영역 `scrollLeft` 0 유지. `scrollIntoView` 는 여전히 호출되지만(7→10회) 영역이 스크롤 불가라 무해. 회귀 가드 테스트로 영역이 `overflow-clip` 인지 박제.

## 일반화

1. **도구가 confound 인가** — 측정 채널이 피측정 시스템과 독립인지 먼저 묻는다. 같은 스레드/루프/클럭 공유 = 바쁜 순간에 굶음. 브라우저(메인스레드 폴러)뿐 아니라 네트워크(앱 이벤트루프 위 계측 vs tcpdump), 프로파일러(샘플 주기 aliasing), 로깅(버퍼링 유실), 분산 추적(클럭 skew)도 같은 함정.
2. **관측값을 가정하지 말 것** — 변할 수 있는 값을 enumerate(위치/스크롤/transform/opacity/size). 가정한 한 속성만 보면 false negative.
3. **정적 스냅샷으로 과정 판정 금지** — 동작 *끝난 뒤* 스크린샷은 과정을 못 본다. 과정을 캡처(스크린캐스트·비디오·큐잉 이벤트).
4. **호출자 미상이면 API 패치 + stack** — recompile 불가 런타임의 mechanism trace(#7). `scrollIntoView`/`scrollTo`/`focus`/`addEventListener` monkeypatch.
5. **CSS 함정** — `overflow:hidden` 은 스크롤 컨테이너다. "절대 안 스크롤하게" 하려면 `overflow:clip`. 화면 밖 자식(`translate-x-full` 등)을 두는 영역에서 특히 중요.

## 자매 case study

- [case-occt-wasm-ld.md](case-occt-wasm-ld.md) — recompile *가능*한 OSS toolchain 에서의 mechanism trace(원칙 #7). 이 케이스는 그 정신을 recompile *불가*한 런타임(브라우저)에 적용한 것 — 패치 대상이 소스가 아니라 프로토타입 메서드.
- 원칙 연결: #9 는 #5(모순 신뢰)의 false-negative 특수형. 결과(=측정)를 받아들이기 전에 *측정 자체*를 의심한다.
