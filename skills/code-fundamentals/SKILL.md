---
name: code-fundamentals
description: 변경하기 쉬운 코드의 4대 축(가독성·예측 가능성·응집도·결합도)으로 코드를 작성·리뷰·리팩토링한다 — 언어 불문(예시는 TS/React지만 원칙은 Swift·Kotlin·Python·Go 어디든 적용). 트리거 - (1) "리뷰해줘"·"개선점"·"리팩토링"·"code review" 등 코드 품질 요청, (2) 매직 넘버, 중첩 삼항/조건, 이름 충돌, 숨은 부작용, 거대 함수/훅, 추상화 수준(레벨) 혼합, 단일 책임(SRP)·이름과 내용 불일치, 삼킨 에러/진단 가능성, 디렉토리 구조, 과도한 DRY, 깊은 파라미터 전달(drilling), 전역 상태 결합 등 안티패턴 언급, (3) "가독성"·"응집도"·"결합도"·"예측 가능성"·"변경하기 쉬운 코드" 명칭, (4) 다른 워크플로(slice 등)의 도메인 가이드로 주입될 때. 프론트엔드 고유 관점(a11y·디자인 토큰·React 런타임·라이브러리 저자 패턴·토스 채용축)은 toss-frontend-fundamentals가 담당 — UI 코드 리뷰엔 둘을 함께 쓴다.
---

# Code Fundamentals — 변경하기 쉬운 코드의 4대 축

**좋은 코드 = 변경하기 쉬운 코드.** 토스 Frontend Fundamentals의 코드 품질 코어를
언어 불문 원칙으로 분리한 스킬이다. 예시 코드는 TS/React지만, 축 자체는 어떤
언어·계층(백엔드·CLI·앱)에도 그대로 적용된다.

| 축 | 질문 |
|---|---|
| **가독성** | 한 번에 고려해야 할 맥락이 적은가? |
| **예측 가능성** | 이름·시그니처만으로 동작을 예측할 수 있는가? |
| **응집도** | 같이 수정될 코드가 같이 묶여 있는가? |
| **결합도** | 한 곳 수정 시 영향 범위가 좁고 예측 가능한가? |

원칙들은 때로 **충돌**한다(예: 중복 제거 vs 결합도 낮추기). 이 스킬은 답을 강제하지
않고 트레이드오프를 드러내며, 맥락에 따라 선택을 돕는다.

## 0. 범위 바닥 (the scope floor) — 4축보다 먼저

가장 변경하기 쉬운 코드는 **없는 코드**다 — 검증할 것도, 유지할 것도, 깨질 것도 없다.
4축이 *존재하는* 코드를 다루기 전에, 먼저 *존재 여부*를 묻는다. 첫 번째로 통과하는
계단에서 멈춘다 — research가 아니라 **reflex**로:

1. **이게 존재할 필요가 있나?** 추측성 필요 = 만들지 말고 한 줄로 그렇게 말한다 (YAGNI).
2. **표준 라이브러리가 하나?** 쓴다.
3. **네이티브 플랫폼 기능이 덮나?** 쓴다 (`<input type="date">` > 피커 lib, CSS > JS, DB 제약 > 앱 코드).
4. **이미 설치된 dep이 푸나?** 쓴다. 몇 줄이면 될 걸 새 dep로 늘리지 않는다.
5. **한 줄로 되나?** 한 줄.
6. **그제서야:** 동작하는 최소 코드.

1번(존재 여부)은 *설계·요청 시점* 질문이다 — 이미 배정된 작업이면 조용히 빼지 말고 *제기*해
확인받는다(실행자는 받은 일을 한다). 2–6번(더 적게 쓰기)은 무엇을 만들든 항상 적용된다.

이건 결합도·응집도의 *상류*다: 안 쓴 코드는 결합도 0, 변경 surface 0. **단, 바닥은 절대
생략 금지** — 신뢰 경계의 입력 검증, 데이터 손실을 막는 에러 처리, 보안, a11y, 명시적으로
요청된 것. 의도적 단순화는 **천장과 업그레이드 경로를 코드 곁 주석으로** 남긴다
(`// 단순화: 전역 락; 처리량 문제되면 계정별 락`) — 단순함이 무지가 아닌 의도로 읽히게(non-surprise).
단순화를 *변호하는* 산문이 코드보다 길면, 그 산문이 곧 복잡도다.

> ⚠️ **로드 규율** — `references/*.md`는 **필요할 때만** 연다. 트리거 맵에서
> 패턴이 매칭됐을 때 1-2개씩만 열면 충분하다 (클라이언트가 references를 어떻게
> 로드하든 무방). 본문 + 트리거 맵으로 충분한 리뷰가 대부분이다.

## 진단 가능성 (operability) — 축에 인접한 관점

4축은 **소스를 읽는** 비용을 줄인다. 그러나 같은 사람이 나중에 그 코드를 **런타임에서** 다시 읽는다 — 실패·로그·도구를 통해. *읽기 쉬움은 그 표면까지 이어진다.* 작성·리뷰 시 다음 **설계 속성**을 함께 본다 (별도 도구를 "지어내라"가 아니라, **이미 짜는 코드를 진단 가능한 쪽으로** 기울이라는 것):

- **크게 실패한다(fail-loud)** — 에러를 삼키지 말고 **맥락과 함께** 던진다. `catch {}` 침묵·무근거 기본값 폴백이 버그를 더 깊은 곳으로 밀어넣지 않게.
- **불가능한 상태를 표현 불가능하게** — 잘못된 조합이 타입·생성자 경계에서 막히면, 버그가 런타임 깊숙이가 아니라 **경계에서** 드러난다.
- **추적에서 식별 가능하게** — 로그·devtools·trace에 뜨는 이름(명명 함수·trace id 등)을 남겨 "이게 뭐였지"를 없앤다.
- **머리에 안 들어오는 흐름은 들여다보이게** — 상태기계·다단 분기가 사람 단기기억을 넘으면 그 복잡도 자체가 신호다. 먼저 **단순화**하고, 본질적으로 복잡하면 상태를 **노출·관찰 가능**하게 만든다.

핵심은 "디버거를 만들라"가 아니라 **변경 비용에 진단 비용을 더해** 설계를 고르라는 것. 진단 불가능한 코드는 다음 사람이 읽는 데 가장 비싼 코드다. (이건 4축과 *별개 차원*이라 별도 reference를 두지 않고 이 한 절로 충분 — 범위 바닥 원칙.)

## Lane 분할 (관점 1개당 컨텍스트 1개)

큰 diff 리뷰에서 한 컨텍스트가 모든 축을 평가하면 관점 오염이 생긴다. 두 lane으로
나누고, 각 lane은 자기 references만 본다 (병렬 디스패치 가능 환경에선 동시에).

| Lane | 관점 | references |
|---|---|---|
| **L1 readability+predictability** | 인지 부하·이름·시그니처·스코프 가시성 | [readability.md](references/readability.md), [predictability.md](references/predictability.md) |
| **L2 cohesion+coupling** | 모듈 경계·중복 vs 추상·디렉토리·결합 | [cohesion.md](references/cohesion.md), [coupling.md](references/coupling.md) |

Lane 간 통신 금지 — 각 lane은 같은 diff를 받되 자기 관점만 답한다.

## 빠른 트리거 맵 (코드 → 원칙 → 파일)

| 코드에 나타난 것 | 원칙 | 파일 |
|---|---|---|
| 중첩 삼항/조건, 4+ 줄 조건문 | 복잡한 조건 분해 | [readability.md #3, #5](references/readability.md) |
| 의미 없는 숫자·문자열 상수 | 매직 넘버 | [readability.md #4](references/readability.md) / [cohesion.md #2](references/cohesion.md) |
| `score >= 80 && score <= 100` | 부등호 순서 (`min <= x && x <= max`) | [readability.md #8](references/readability.md) |
| 한 단위에 배타적 역할(viewer/admin) 분기 혼합 | 배타 분기 분리 | [readability.md #1](references/readability.md) |
| 한 함수/훅이 5개+ 상태·책임 관리 | 로직 종류별 분리 | [readability.md #6](references/readability.md) / [coupling.md #1](references/coupling.md) |
| 표준 라이브러리와 이름 겹치는 래퍼 | 이름 충돌 | [predictability.md #1](references/predictability.md) |
| 같은 종류 함수의 반환 타입 제각각 | 반환 타입 통일 | [predictability.md #2](references/predictability.md) |
| 시그니처에 없는 로깅·리다이렉트·IO | 숨은 부작용 | [predictability.md #3](references/predictability.md) |
| Boolean 이름이 상태인지 동작인지 모호 | Boolean 네이밍 | [predictability.md #4](references/predictability.md) |
| 느슨한 비교(`!= null`, falsy 체크) | 엄격 동등 비교 | [predictability.md #8](references/predictability.md) |
| 종류별 폴더(`utils/`·`helpers/`)로만 분리 | 도메인 중심 디렉토리 | [cohesion.md #1, #5](references/cohesion.md) |
| 같은 의미 상수가 여러 곳 복제 | 상수 위치 = 범용성×지엽성 | [cohesion.md #4](references/cohesion.md) |
| 환경 분기(`typeof window` 류) 산재 | 환경 분기 중앙화 | [cohesion.md #9](references/cohesion.md) |
| 3+ 단 파라미터/props 전달 | drilling | [coupling.md #3](references/coupling.md) |
| 곳마다 달라지는 로직을 억지 공통화 | 과도한 DRY | [coupling.md #2](references/coupling.md) |
| core와 외부 환경(Router/Storage/SDK) 직결 | 어댑터 패턴 (얇은 인터페이스 + DI) | [coupling.md #5](references/coupling.md) |
| 기존 API 유지하며 새 API 이전 | `/compat` 어댑터 | [coupling.md #6](references/coupling.md) |
| 한 함수에 고수준 의도 + 저수준 메커니즘 혼재 | 추상화 수준 일관성 | [readability.md #11](references/readability.md) |
| 이름에 `and`/그리고, 이름이 본문을 다 못 덮음, 비대 함수 | 이름=정직한 계약·단일 책임 | [predictability.md #14](references/predictability.md) |
| 삼킨 에러(`catch {}`)·무근거 폴백, 표현 가능한 불가능 상태 | 진단 가능성 | [본문 §진단 가능성](#진단-가능성-operability--축에-인접한-관점) |

## 워크플로

**A. 리뷰 모드** — ① 트리거 맵 스캔 ② 매칭된 reference만 로드 ③ 심각도
라벨(`[MUST]` 명백한 결함 / `[SHOULD]` 권장 / `[NIT]` 취향) ④ 원칙 충돌 시
트레이드오프 명시.

**B. 작성 모드** — 4축 질문으로 자가 점검; 트레이드오프 있는 선택(중복 허용,
공통화 회피)은 근거를 코드 곁에 남긴다.

**C. 병렬 리뷰** (50줄+ diff) — L1·L2를 병렬 디스패치, 코디네이터가 같은
`file:line` dedup(강한 severity 우선) 후 severity→file→line 정렬.

## 체크리스트 (최소 스캔)

- `[MUST]` 매직 넘버/문자열 상수화 · 삼항 2중 중첩 금지 · 시그니처에 없는 부작용 금지 · 표준 라이브러리와 이름 충돌 금지
- `[SHOULD]` 범위 비교 부등호 순서 · 복잡식에 중간 변수명 · 배타 분기 비혼합 · 같은-수정-단위 파일 동거 · 상수 비복제 · drilling 3단 미만 · "곳마다 다른" 동작의 공통 훅 인자화 금지 · 한 단위 내 추상화 수준 일관 · 이름이 본문 전체를 정직하게 덮음(`and` 금지) · 에러는 맥락과 함께 크게 실패(삼킴 금지)

## 출력 형식 (지적 1건 당)

```
### [MUST|SHOULD|NIT] [축] 원칙 이름
**문제** — 파일:라인 + 무엇이 어긋나는지
**Before / After** — 코드
**왜 나아지는가** — 2~3 bullet
**트레이드오프** (해당 시)
```

## 주의

- **교리가 아니다** — "가이드가 그렇게 해서"가 아니라 "이 코드베이스에 왜 더 맞는가"로 설득한다.
- **컨텍스트 우선** — 작은 스크립트에 도메인 폴더링을 밀어붙이면 과잉 적용이다.
- **자동화 가능한 건 자동화** — 린터/포매터/타입이 1차 방어선; 사람 리뷰는 그 위에.
- **프론트엔드 코드라면** [toss-frontend-fundamentals](../toss-frontend-fundamentals/SKILL.md)를
  함께 활성화한다 (a11y·React 런타임·디자인 토큰·플랫폼 철학은 그쪽 담당).
