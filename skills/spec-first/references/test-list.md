# Acceptance test-list — load-bearing 산출물 심화

> **로드 조건** — ITEM 필드 스키마·falsifiability/determinism 게이트·scopeSafe 토큰 도출 알고리즘·계층 힌트·원자성·NOW/PUNT/LATER 블록 형식 중 하나라도 확인이 필요할 때 연다. SKILL.md 본문으로 충분한 경우에는 열지 않는다.

---

## §1 ITEM 필드표 — `id == proposedTestName == {scope}` 토큰

각 item 은 **단일 FALSIFIABLE + DETERMINISTIC 행동 주장**이다. 정확히 아래 필드를 갖는다.

| 필드 | 타입 | 제약 / 출처 |
|---|---|---|
| `id` | string slug, `/^[A-Za-z0-9_.-]+$/` | 리스트 내 유일; **proposedTestName 과 동일** — 별도 필드 없음(`id == proposedTestName`). |
| `given` / `when` / `then` | 문자열 3개 | 낙오 불가능한 주장을 given-when-then 으로 표현; `then` 이 깨질 수 있는 단언. 순수 로직 item 은 단일 `assertion` 문자열로 대체 가능. |
| `criterion` | string | 실행 가능한 불변식 주장, 예: `calc_discount('gold') == 0.2`, `response.status == 201 within 200ms`. **관찰 가능한 결과** 이지 구현 단계가 아니다(`sendgrid.send()` 호출 ✗ → `email delivered` ✓). |
| `layer` | enum `l0\|l1\|l2\|l3` | test-foundations [layers.md §3](../../test-foundations/references/layers.md) 결정 트리 기반 힌트. 최종 배치는 test-foundations 가 결정(re-layer 가능) — *힌트이지 바인딩이 아니다*. |
| `falsifiable` | bool | **MUST `true`**: §2 falsifiability 게이트 통과를 선언. |
| `deterministic` | bool | **MUST `true`**: §3 determinism 게이트 통과를 선언. |
| `proposedTestName` | string, `/^[A-Za-z0-9_.-]+$/` | `id` 와 동일. slice `{scope}` 토큰이 되고 recurrence-seam "Proposed test name" 핸들이 된다. §4 도출 알고리즘으로 결정론적으로 파생. |
| `cut` | enum `now\|punt\|later` | CUT 버킷. |
| `cutReason` | string, **`cut != now` 이면 필수** | 왜 미뤘는가 — punt/later item 은 이름과 이유를 남긴다. 신뢰 경계 입력 검증·데이터 손실·보안 item 은 조용한 punt 불가(scope-floor). |
| `dependsOn` | `string[]` of ids (선택) | slicer 를 위한 순서 힌트. |

**로드-베어링 제약 — 이 필드표가 작동하는 이유:**

- **1 item = 1 행동 주장 = 1 `{scope}` 토큰 = 1 slice leaf** (원자성; "5개 행동 1개 테스트"는 금지 — code-fundamentals §operability 의 trace-identifiability 를 상속).
- **단일 불변식 → 복수 item across layers** 가능(§6). 계층별로 각각 독립 행이고, 토큰은 같은 family.
- **어떤 필드도 함수/파일/라이브러리/자료구조를 명명하지 않는다** (Canon TDD — §2 자기감사).
- `proposedTestName` 은 rig 가 존재하면 **`scripts/verify.sh --list-scopes` 로 사전 검증** 필수(§4).

---

## §2 falsifiability 게이트

**원칙: criterion 을 소리 내 읽어서 두 질문을 통과해야 한다.**

**질문 A — "이 기준이 실패할 수 있는가?"**

실패할 수 없는 주장은 vacuous(공허)하다 — 리스트에서 제거하거나 구체화한다.

**Before** (vacuous):
```
criterion: "email 이 전송된다"
```
언제, 누구에게, 무슨 주소로? 조건 없이 항상 통과할 수 있다.

**After** (falsifiable):
```
criterion: "가입 확인 이메일이 verified 주소로 60초 이내 도달한다"
```
수신 타임아웃·수신 주소·이메일 종류가 명시돼 깨질 수 있는 주장이 됐다.

**왜** — vacuous criterion 은 코드가 아무것도 안 해도 통과한다. "test 가 Green" 이지만 실제로는 아무것도 검증하지 않는 fake-green — 가장 비싼 거짓 신뢰.

**질문 B — "코드가 이 기준을 우연히 통과할 수 있는가? (vacuous green)"**

우연 통과 경로가 있으면 criterion 을 더 엄격하게 하거나, given 에 setup guardrail 을 추가한다.

**Before** (vacuous green 위험):
```
given: 어떤 사용자 / criterion: checkout_total < original_price
```
original_price 를 고정하지 않으면 아무 가격이나 넣어도 통과할 수 있다.

**After**:
```
given: price=100.00 인 상품, gold-tier 사용자
criterion: checkout_total == 80.00
```

> **주의** — falsifiability 는 최종적으로 모델 판단에 의존한다. `falsifiable:true` 는 "이 item 이 게이트를 통과한다고 저자가 선언"하는 것이지 기계가 보증하는 것이 아니다. 자기감사(§ Canon TDD 관련)로 이중 점검한다.

---

## §3 determinism 게이트

**원칙: 비결정론의 출처를 명명하고, 해당 layer 에서 고정됨을 선언해야 한다.**

비결정론의 주요 출처 세 가지와 layer 별 처리:

| 출처 | L1 처리 | L2 처리 | L3 처리 |
|---|---|---|---|
| **시간** | 고정 타임스탬프 / mock clock | fresh container per run | pinned 환경 / 절대값 대신 상대 범위 |
| **랜덤** | seed 고정 | seed 고정 | seed 고정 또는 범위 단언 |
| **네트워크** | **live network 금지** (L1 에서 제일 중요) | fresh isolated container (Testcontainers) | pinned live 서비스 또는 `inProcessVerifiable:false` + manual signoff |

**Before** (비결정론 방치):
```
layer: l1
criterion: "외부 환율 API 응답이 0보다 크다"
```
live network 를 치는 L1 — 네트워크 없으면 항상 실패, 있어도 응답이 달라진다.

**After**:
```
layer: l2
criterion: "환율 서비스가 stubbed HTTP 200 응답(rate=1.3)을 받았을 때 환산 결과 == 130.00"
```
또는 L1 으로 두려면:
```
layer: l1
criterion: "convert(rate=1.3, amount=100) == 130.00"  # 순수 함수, 외부 호출 없음
```

**어떤 layer 에도 결정론이 불가능하면** — 그 item 은 research spike 이지 acceptance item 이 아니다. `cut:punt`, `cutReason: "결정론 불가 — 스파이크 필요"` 로 명시한다.

---

## §4 scopeSafe 토큰 도출 알고리즘

`proposedTestName` (= `id`) 은 **결정론적으로** 파생한다. 아래 절차를 순서대로 적용한다.

**1단계 — 불변식 명사구 추출**

행동의 핵심 명사구를 영어 또는 snake_case 로 적는다. 관사·전치사·접속사·filler 는 제거한다.

```
"gold tier 고객에게 20% 할인이 적용된다" → gold_tier_discount
"결제 총액이 할인 후 80.00 이 된다 (L2 real DB)" → checkout_discount_applied
"gold 회원으로 구매 시 영수증에 '-20%' 줄이 보인다 (L3)" → buy_as_gold_member_receipt
```

**2단계 — 정규식 필터 통과 검증**

```
/^[A-Za-z0-9_.-]+$/
```

- 허용: 영문자·숫자·`_`·`.`·`-`
- 금지: 슬래시·공백·경로 구분자·한글·특수문자
- 엔진 가드 `recursive-slice.js:611` 이 이 정규식으로 검증하므로 사전 정렬 필수.

**3단계 — 충돌 해소 (같은 family, 다른 layer)**

동일 불변식의 다층 토큰은 layer 접두사 또는 접미사로 구분한다:

```
discount_gold_tier          ← L1 순수 함수
checkout_discount_applied   ← L2 real DB 통합
buy_as_gold_member_receipt  ← L3 여정
```

같은 이름이 두 개면 한쪽에 `_l2`, `_l3` 접미사를 붙인다. family 이름은 공유한다(§6 참조).

**4단계 — `--list-scopes` 검증 (rig 존재 시 필수)**

```bash
scripts/verify.sh --list-scopes
```

이미 rig 가 있는 레포에서 토큰을 채택하기 전에 위 명령으로 기존 합법 토큰 목록을 확인한다. 매칭 없으면 exit 2 — 이 경우 토큰이 새로운지(OK) 충돌인지(rename 필요) 판단한다. silent zero-match(`recursive-slice.js:621`) 함정을 막는다.

> **주의** — 토큰은 슬래시·공백·경로를 포함할 수 없다. `src/discount` ✗, `discount_gold_tier` ✓. 한 토큰이 동시에 (a) 사람이 읽기 좋고, (b) 정규식을 만족하고, (c) 리스트 내 유일하고, (d) `--list-scopes` 에서 충돌 없어야 한다. 긴 행동 설명은 핵심 동사·명사만 남겨 짧게 한다.

---

## §5 layer 힌트 — 계층 결정 트리

layer 필드는 **힌트**다. 최종 배치는 test-foundations 가 결정한다.

결정 트리는 **[test-foundations/references/layers.md §3](../../test-foundations/references/layers.md)** 에 있다 — 여기서 발췌하지 않는다. 필요할 때 그쪽을 열어라.

요점만:

- 순수 로직(입력→출력, 외부 상태 없음) → `l1` 힌트
- 모듈 경계가 실제 의존성(DB·HTTP·큐)에 닿음 → `l2` 힌트
- 사용자 여정이 실재함(login→checkout→receipt 같은 흐름) → `l3` 힌트
- 구조적 정합성(타입·형식·린트) → `l0` 힌트

test-foundations 가 re-layer 할 수 있다 — 예: spec-first 가 `l1` 힌트를 줬는데 실 DB 호출이 발견되면 `l2` 로 격상. `{scope}` 토큰 family 이름은 변경되지 않고, token 에 layer 접미사를 붙여 구분한다(§4 3단계).

---

## §6 1 invariant → N items across layers (토큰 family)

**원칙: 하나의 불변식은 여러 계층에서 각각 독립 item 으로 표현될 수 있다.**

같은 비즈니스 불변식("gold 고객은 20% 할인을 받는다")이 세 계층에서 다른 각도로 검증된다:

```
NOW
- id: discount_gold_tier            layer:l1  cut:now
    criterion: calc_discount('gold') == 0.20
    (순수 함수 — 가장 싸고 빠른 검증)

- id: checkout_discount_applied     layer:l2  cut:now  dependsOn:[discount_gold_tier]
    criterion: checkout_total(real_db_user='gold') == subtotal * 0.8
    (실제 DB 사용자 레코드 + 결제 파이프라인)

- id: buy_as_gold_member_receipt    layer:l3  cut:now  dependsOn:[checkout_discount_applied]
    criterion: login→cart→pay 영수증에 "Gold -20%" 줄이 보임
    (사용자 여정이 실제로 존재할 때만)
```

이 세 item 이 `discount` 토큰 family 다.

**왜** — L1 만 있으면 순수 함수가 맞아도 실제 DB 경로에서 할인이 적용 안 될 수 있다. L2 가 그 gap 을 막는다. L3 는 사용자가 실제로 보는 UI 경로를 닫는다. 각 계층은 서로가 잡지 못하는 것을 잡는다.

**주의** — L3 item 은 **사용자 여정이 존재할 때만** NOW 에 넣는다. 여정 없는 레포에서 phantom L3 item 을 만들면 scope-floor 위반이다. 여정이 불명확하면 PUNT + cutReason 으로 명시한다.

**1 invariant → 1 item (단층)도 정상이다** — 순수 함수만 존재하면 L1 item 하나로 끝낸다. family 를 억지로 만들지 않는다.

---

## §7 원자성 — 1 item = 1 행동 = 1 토큰 (operability 상속)

**원칙: 한 item 은 단 하나의 행동 주장만 담는다.**

**Before** (원자성 위반 — 3개 행동이 1 item 에):
```
id: discount_all_tiers
criterion: gold==0.20 AND silver==0.10 AND None==0.0
```

**After** (원자성 준수 — 3개 item):
```
- id: discount_gold_tier    criterion: calc_discount('gold') == 0.20
- id: discount_silver_tier  criterion: calc_discount('silver') == 0.10
- id: discount_no_tier      criterion: calc_discount(None) == 0.0
```

**왜** — 한 item 에 여러 행동이 묶이면:
- 실패 시 *어떤 행동이* 깨졌는지 알 수 없다 (trace-identifiability 상실).
- `{scope}` 토큰 하나로 여러 leaf 가 커버돼 slice 경계가 모호해진다.
- code-fundamentals §operability 의 "테스트당 한 변수" 원칙을 위반한다.

**operability 상속** — 테스트 이름(`proposedTestName`) 이 CI 실패 로그에 그대로 찍힌다. `discount_all_tiers failed` 보다 `discount_silver_tier failed` 가 즉시 원인을 가리킨다.

---

## §8 NOW / PUNT / LATER 블록 + cutReason 필수

**원칙: 모든 item 은 명시적으로 버킷에 배치되고, 미루는 item 은 반드시 이유를 남긴다.**

### 전체 리스트 구조

```
SHARPENED TASK: <한 문단 — 진짜 문제(제안 해법 아님), 구체적 사용자 + 고통,
  표면화한 가정, 틀렸을 때의 downside>
KEY CONSTRAINTS (MUST PRESERVE): [ ... ]

ACCEPTANCE TEST-LIST
  NOW    (이번 라운드 deliver → slice 루트 scope 토큰이 됨)
  PUNT   (미뤄짐, 이름 + 이유 명시 → BACKLOG, slice 입력 아님)
  LATER  (미래 결정에 달림 → BACKLOG)

CUT RATIONALE: "<두-프로젝트-+-컷 프레이밍>"
```

### NOW

slice 로 흘러가는 item 들. 각 id 가 `scripts/verify.sh --scope {scope}` 의 bare 토큰이 된다.

```
NOW
- id: discount_gold_tier        layer:l1  falsifiable:✓ deterministic:✓
    given gold tier / when calc_discount runs / then == 0.20
    criterion: calc_discount('gold') == 0.20

- id: discount_non_gold_zero    layer:l1  falsifiable:✓ deterministic:✓
    criterion: calc_discount('silver') == 0.0 and calc_discount(None) == 0.0
    (MUST PRESERVE 불변식을 위한 회귀 방어 item)
```

### PUNT

결정 부재·범위 초과·스파이크 필요 등으로 이번에 다루지 않는 item. **이름과 이유를 남긴다** — 조용히 삭제하지 않는다.

```
PUNT
- id: discount_promo_stacking_rule  cut:punt
    cutReason: "스택 정책이 미결 product 결정 — 결정 전 불변식 쓸 수 없음;
      downside: 잘못 적용 시 이중 할인 → 마진 손실. BACKLOG 로 이동."
```

**scope-floor 예외 — 조용한 punt 절대 금지:**

아래 종류의 item 은 cutReason 없이 PUNT/LATER 불가. cutReason 이 있더라도 HIGH-DOWNSIDE 로 표시하고 팀과 명시 합의 필요:

- 신뢰 경계 입력 검증 (악성 입력 차단)
- 데이터 손실 방지 단언
- 보안 속성 (인증·권한·암호화)
- 명시적으로 요청된 item

### LATER

미래 기술 또는 제품 방향 결정에 따라 달라지는 item.

```
LATER
- id: discount_international_tax    cut:later
    cutReason: "국제 세금 정책 미확정 — 글로벌 확장 결정 후 의미 있음."
```

### CUT RATIONALE

리스트 맨 끝, 한 줄 또는 두 줄로:

```
CUT RATIONALE: "두 작은 프로젝트 — (1) 순수 할인 계산 + 비-gold 회귀 방어(L1),
  (2) real-DB 통합 + 기존 E2E 여정 연결(L2+L3) — 그리고 자른 것 하나:
  프로모 스태킹, 이건 engineering 이 아니라 product 결정이다."
```

CUT RATIONALE 이 "두-프로젝트-+-컷" 모양을 만들지 못하면 모호함 제거가 충분하지 않은 것 — de-risk 프로토콜 Step 1 로 회귀한다(protocol.md §5 output gate).
