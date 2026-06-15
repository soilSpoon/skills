---
load-on-demand: true
purpose: 비자명(non-obvious) 분해를 보정할 때만 연다 — 3개 end-to-end 워크드 예시. 각 예시는 fuzzy 요청 → 5-step de-risk 트랜스크립트 → now/punt/later 버킷 리스트 → 정확한 slice task-string 핸드오프로 구성된다. Ex1 순수 로직 피처(discount: L1+L2+L3 토큰 패밀리, promo-stacking PUNT). Ex2 실제 의존성 통합(webhook-ingest: L2 real-dep, 멱등성+에러 변종). Ex3 여정 피처(onboarding: L3 journey-gated, L1 검증 NOW).
---

# Worked Examples — fuzzy 요청 → acceptance test-list → slice 핸드오프

> **로드 규율**: 비자명 분해를 조율할 때만 연다. 이미 명확한 요청에는 SKILL.md 체크리스트로 충분하다.

---

## Ex1 — 순수 로직 피처: "gold 등급 할인을 checkout 에 추가해줘"

### 요청 (fuzzy)

> "gold 멤버한테 할인을 줘야 할 것 같아요. checkout 에 추가해주세요."

### 5-step de-risk 트랜스크립트

**Step 1 — 진짜 문제 (해법 아닌 문제)**
: 제안된 해법은 "할인 필드 추가". 진짜 문제는 → *gold 등급 고객이 결제 시 정가를 내는 바람에 로열티 리텐션이 새고 있다(revenue-leakage on loyalty)*. "할인 필드"는 해법이지 문제가 아니다.

**Step 2 — 사용자·고통 구체화**
: 사용자 = 결제 단계의 gold 등급 복귀 구매자. 고통 = 기대 혜택 없이 정가 결제 → 이탈. "언제 done이냐" = 결제 화면에서 할인 금액이 명시되고 실제 총액이 줄어들 때.

**Step 3 — 숨은 가정 표면화**
: (a) checkout 시점에 tier 정보가 이미 알려져 있다(세션·DB row 확인 필요). (b) 할인이 프로모 코드와 중첩 가능하다(→ 이중 할인 → 마진 손실 위험). (c) 비-gold 사용자의 기존 총액은 변하지 않아야 한다.

**Step 4 — Downside if wrong**
: (b) 가 틀리면(중첩 정책 미결정 채로 출시) → 이중 할인으로 마진 손실. 고도 위험 → PUNT with reason. (a) 가 틀리면 → checkout 에서 tier 조회 실패 → 500. (c) 가 틀리면 → 기존 사용자 가격 변동 → 심각한 신뢰 손상 → MUST PRESERVE 항목으로 박제.

**Step 5 — Now / punt 컷**
: NOW: 할인 계산 순수 로직(L1) + 기존 총액 회귀 가드(L1) + real-DB 통합(L2) + 구매 여정(L3, checkout journey 이미 존재). PUNT: 프로모 중첩 규칙(제품 결정 미완).

### 출력 블록

```
SHARPENED TASK: gold 등급 고객이 결제 시 정가를 내는 loyalty revenue-leakage 문제.
  사용자 = 결제 단계 gold 복귀 구매자; 고통 = 혜택 없는 정가 결제 → 이탈.
  확인된 가정: tier 는 checkout 시점에 세션에 존재(가정 (a) — 스프린트 내 검증 필요).
  DOWNSIDE-IF-WRONG: 프로모 중첩은 제품 미결정(이중 할인 → 마진 손실) → 명시적 PUNT.

MUST PRESERVE: 비-gold 사용자 기존 checkout 총액 불변.

ACCEPTANCE TEST-LIST

NOW
- id: discount_gold_tier          layer:l1  falsifiable:✓  deterministic:✓
    given gold tier / when calc_discount runs / then == 0.20
    criterion: calc_discount('gold') == 0.20

- id: discount_non_gold_zero      layer:l1  falsifiable:✓  deterministic:✓
    (MUST-PRESERVE 회귀 가드)
    criterion: calc_discount('silver') == 0.0  AND  calc_discount(None) == 0.0

- id: checkout_applies_gold_discount   layer:l2  falsifiable:✓  deterministic:✓
    given a persisted gold user (real DB) / when checkout total computed /
    then total == subtotal * 0.80
    criterion: checkout_total(real_db_user='gold') == subtotal * 0.80

- id: buy_as_gold_member_receipt  layer:l3  falsifiable:✓  deterministic:✓
    dependsOn: [checkout_applies_gold_discount]
    criterion: login→cart→pay 후 영수증에 "Gold -20%" 줄이 표시됨
    (checkout journey 존재 확인 — journey-gated scope-floor 충족)

PUNT
- id: discount_promo_stacking_rule   cut:punt
    cutReason: 중첩 정책은 제품 미결정(downside: 이중 할인 → 마진 손실) —
      제품 결정 전 테스트 가능 기준 없음; NAMED not dropped.

CUT RATIONALE: "두 작은 프로젝트 — (1) 순수 할인 계산 + 비-gold 회귀 가드,
  (2) real-DB 통합 + 기존 checkout journey E2E — 그리고 자른 것 하나:
  프로모 중첩(제품 결정이 먼저)."
```

### slice 핸드오프 문자열

```
gold 등급 고객이 결제 시 정가를 내는 loyalty revenue-leakage 문제.
사용자 = 결제 단계 gold 복귀 구매자.

MUST PRESERVE: 비-gold 사용자 기존 checkout 총액 불변.

ACCEPTANCE VARIANTS (behavioral, WHAT-not-HOW — Canon TDD 힌트):
  [now] discount_gold_tier          (L1) calc_discount('gold') == 0.20
  [now] discount_non_gold_zero      (L1) non-gold 총액 불변
  [now] checkout_applies_gold_discount (L2, real DB) total == subtotal*0.80
  [now] buy_as_gold_member_receipt  (L3, journey exists) 영수증 "Gold -20%"

PUNT (이번 스코프 아님): discount_promo_stacking_rule — 제품 결정 대기.
```

**토큰 연속성**: `discount_gold_tier` → `scripts/verify.sh --scope discount_gold_tier` (filterCommand), 스캐폴드는 이 토큰을 테스트 *이름 안에* 삽입하도록 executor에게 지시.

---

## Ex2 — 실제 의존성 통합: "webhook 이벤트 수신 엔드포인트 만들어줘"

### 요청 (fuzzy)

> "결제 provider에서 webhook 날아오면 우리 DB에 상태 업데이트해야 해요. 엔드포인트 만들어주세요."

### 5-step de-risk 트랜스크립트

**Step 1 — 진짜 문제 (해법 아닌 문제)**
: 제안된 해법은 "엔드포인트 생성". 진짜 문제는 → *결제 provider 가 보내는 비동기 이벤트가 우리 DB 상태에 반영되지 않아 주문 상태가 불일치한다(payment-state-drift)*. "엔드포인트"는 해법이지 문제가 아니다.

**Step 2 — 사용자·고통 구체화**
: 사용자 = 결제 완료 후 주문 상태를 확인하는 구매자 + 주문 처리 팀. 고통 = provider 는 결제 완료로 봤는데 우리 DB 는 `pending` → 배송 지연·고객 문의 폭증. "done" = webhook 수신 후 DB row 가 provider 의 상태와 일치.

**Step 3 — 숨은 가정 표면화**
: (a) provider 가 같은 이벤트를 중복 전송할 수 있다(재시도 정책). (b) payload 에 서명 검증이 있다(없으면 스푸핑 가능). (c) DB write 실패 시 재처리가 가능해야 한다(at-least-once vs exactly-once). (d) 알 수 없는 event_type 은 조용히 200 으로 무시해야 한다(향후 provider 이벤트 확장 대비).

**Step 4 — Downside if wrong**
: (a) 멱등성 없으면 → 중복 이벤트 → 주문 상태 덮어쓰기·이중 배송 → 심각. (b) 서명 없으면 → 스푸핑으로 임의 주문 상태 조작 → 보안 scope-floor → CANNOT be silently punted. (c) DB 실패 시 재처리 없으면 → 이벤트 유실 → 영구 state-drift. (d) 미지 이벤트 200 무시 → 낮은 위험, 구현 간소화.

**Step 5 — Now / punt 컷**
: NOW: 서명 검증(보안, scope-floor), 멱등 처리(중복 방지), 정상 상태 업데이트(L2 real DB), DB 실패 시 5xx 반환(재처리 시그널). PUNT: 알 수 없는 이벤트 타입 처리(별도 이벤트 카탈로그 결정 후).

### 출력 블록

```
SHARPENED TASK: 결제 provider 비동기 이벤트가 DB 에 반영되지 않아 주문 상태가 불일치
  (payment-state-drift). 사용자 = 결제 후 상태 확인 구매자 + 주문팀; 고통 = provider
  완료인데 DB는 pending → 배송 지연.
  확인된 가정: provider 중복 전송(at-least-once) — 멱등성 REQUIRED.
  DOWNSIDE-IF-WRONG: 서명 없음 → 스푸핑 → 임의 주문 상태 조작(보안 scope-floor,
    CANNOT punt); 멱등성 없음 → 이중 배송(심각).

MUST PRESERVE: 기존 주문 상태 전환 API 불변.

ACCEPTANCE TEST-LIST

NOW
- id: webhook_signature_valid      layer:l2  falsifiable:✓  deterministic:✓
    (보안 scope-floor — 절대 punt 불가)
    given valid provider signature / when endpoint receives payload /
    then status 200 AND DB updated
    criterion: POST /webhook (valid-sig, real DB) → 200 AND order.status updated

- id: webhook_signature_invalid    layer:l2  falsifiable:✓  deterministic:✓
    given tampered/missing signature / when endpoint receives payload /
    then status 401 AND DB unchanged
    criterion: POST /webhook (bad-sig, real DB) → 401 AND order.status unchanged

- id: webhook_idempotent_duplicate layer:l2  falsifiable:✓  deterministic:✓
    given same event_id delivered twice / when endpoint processes both /
    then DB state after second == state after first (no double-apply)
    criterion: two identical POSTs → second returns 200 AND order.status == first result

- id: webhook_db_failure_5xx       layer:l2  falsifiable:✓  deterministic:✓
    given valid payload + DB write error (injected) /
    when endpoint processes / then status 5xx (재처리 시그널)
    criterion: POST /webhook (valid, DB-fault injected) → 5xx

PUNT
- id: webhook_unknown_event_type   cut:punt
    cutReason: 미지 이벤트 타입 처리는 provider 이벤트 카탈로그 결정 대기 — 현재
      payload 구조 미확정; NAMED not dropped.

CUT RATIONALE: "두 작은 프로젝트 — (1) 보안(서명 검증 valid/invalid),
  (2) 신뢰성(멱등+DB-실패 5xx) — 그리고 자른 것 하나: 미지 이벤트 타입
  (카탈로그 결정 먼저)."
```

### slice 핸드오프 문자열

```
결제 provider 비동기 이벤트가 DB 에 반영되지 않아 주문 상태 불일치(payment-state-drift).
사용자 = 결제 후 상태 확인 구매자 + 주문팀.

MUST PRESERVE: 기존 주문 상태 전환 API 불변.

ACCEPTANCE VARIANTS (behavioral, WHAT-not-HOW — Canon TDD 힌트):
  [now] webhook_signature_valid     (L2, real DB) valid sig → 200 + DB updated
  [now] webhook_signature_invalid   (L2, real DB) bad sig → 401 + DB unchanged
  [now] webhook_idempotent_duplicate (L2, real DB) 중복 이벤트 → no double-apply
  [now] webhook_db_failure_5xx      (L2, DB-fault injected) → 5xx

PUNT: webhook_unknown_event_type — provider 이벤트 카탈로그 결정 대기.
```

**왜 L2가 주인가**: webhook 은 DB row 상태 전환이 핵심이므로 real DB 없이는 purpose-fidelity 결손(mock DB 로 멱등성 테스트는 anti-genie). L3 는 이 기능에 별도 사용자 여정이 없으므로 journey-gated로 제외(scope-floor 준수).

**토큰 패밀리**: `webhook_` 접두사로 가족을 구성. 각 토큰 → `scripts/verify.sh --scope webhook_signature_valid` 등으로 흘러 per-leaf T0 게이트 담당.

---

## Ex3 — 여정 피처: "신규 사용자 온보딩 플로우 만들어줘"

### 요청 (fuzzy)

> "신규 가입자가 처음 들어왔을 때 설정 완료까지 안내하는 온보딩이 필요해요. 뚝딱 만들어주세요."

### 5-step de-risk 트랜스크립트

**Step 1 — 진짜 문제 (해법 아닌 문제)**
: 제안된 해법은 "온보딩 플로우 제작". 진짜 문제는 → *신규 가입 후 핵심 설정을 완료하지 않아 첫 사용 실패율이 높다(activation-gap)*. 온보딩 UI 는 해법 중 하나이지 문제가 아니다.

**Step 2 — 사용자·고통 구체화**
: 사용자 = 가입 후 처음 로그인한 신규 사용자. 고통 = 빈 화면만 보이고 다음 행동 불명확 → 이탈. "done" = 신규 사용자가 온보딩 3단계(프로필 입력→연동→알림 설정)를 완료하면 대시보드로 이동.

**Step 3 — 숨은 가정 표면화**
: (a) "온보딩 완료" 여부를 DB 에 저장해야 한다(새로 로그인해도 재진입 안 함). (b) 입력 검증 실패 시(필수 필드 비어있음) 다음 단계로 넘어가면 안 된다. (c) 온보딩 중 이탈 후 재접속 시 중단 지점부터 재개해야 한다(resume). (d) 이미 온보딩 완료한 기존 사용자는 온보딩 플로우로 진입하면 안 된다.

**Step 4 — Downside if wrong**
: (b) 검증 없으면 → 빈 프로필로 완료 처리 → 데이터 품질 손상(scope-floor — CANNOT punt). (a) 완료 상태 미저장 → 매 로그인마다 온보딩 재진입 → UX 파괴. (c) resume 없으면 → 중단 후 처음부터 반복 → 이탈 증가(NOW 이지만 복잡도 높음). (d) 기존 사용자 재진입 → 낮은 위험, 리다이렉트로 해결.

**Step 5 — Now / punt 컷**
: NOW: 입력 검증(scope-floor L1), 완료 상태 저장+재진입 차단(L2 real DB), 신규 사용자 전체 여정(L3). PUNT: 중단-재개(resume) 로직(복잡도 높음, 첫 출시 가설 검증 후 결정).

### 출력 블록

```
SHARPENED TASK: 신규 가입자가 핵심 설정 미완료로 첫 사용에서 이탈하는 activation-gap.
  사용자 = 가입 후 최초 로그인 신규 사용자; 고통 = 빈 화면 → 다음 행동 불명 → 이탈.
  done = 온보딩 3단계(프로필→연동→알림) 완료 → 대시보드 이동.
  확인된 가정: 완료 상태 DB 저장 필수(미저장 → 매 로그인 재진입).
  DOWNSIDE-IF-WRONG: 입력 검증 없음 → 빈 프로필 완료(데이터 scope-floor, CANNOT punt).

MUST PRESERVE: 기존 로그인 플로우 및 인증된 사용자 라우팅 불변.

ACCEPTANCE TEST-LIST

NOW
- id: onboarding_profile_required_fields   layer:l1  falsifiable:✓  deterministic:✓
    (scope-floor 입력 검증 — 절대 punt 불가)
    given empty required field (display_name) /
    when step-1 submit attempted / then error shown AND step not advanced
    criterion: submit(profile={display_name:''}) → error present AND step == 1

- id: onboarding_profile_valid_advances    layer:l1  falsifiable:✓  deterministic:✓
    given all required fields filled /
    when step-1 submit / then advances to step-2
    criterion: submit(profile={display_name:'Alice'}) → step == 2

- id: onboarding_completion_persisted      layer:l2  falsifiable:✓  deterministic:✓
    given new user completes all 3 steps (real DB) /
    when completion confirmed / then DB records onboarding_completed = true
    criterion: complete_onboarding(real_db_user=new) → user.onboarding_completed == true

- id: onboarding_completed_user_skips     layer:l2  falsifiable:✓  deterministic:✓
    given already-completed user (real DB) /
    when onboarding route accessed / then redirected away (not shown onboarding)
    criterion: GET /onboarding (real_db_user=completed) → redirect to dashboard, not 200 onboarding

- id: new_user_completes_onboarding_journey  layer:l3  falsifiable:✓  deterministic:✓
    dependsOn: [onboarding_completion_persisted]
    criterion: 신규 가입 → 로그인 → 온보딩 3단계 완료 → 대시보드 도달
    (L3 — 사용자 여정 존재: login→onboarding→dashboard, journey-gated 충족)

PUNT
- id: onboarding_resume_from_step         cut:punt
    cutReason: 중단-재개 로직은 복잡도 높음 + 첫 출시에서 이탈-후-재개 빈도 가설 미검증 —
      첫 릴리즈 지표 확인 후 결정; NAMED not dropped.

CUT RATIONALE: "두 작은 프로젝트 — (1) 입력 검증(필수 필드 오류/정상 진행, L1 순수 로직),
  (2) 상태 지속성(완료 저장 + 기존 사용자 차단, L2) + 전체 여정(L3) — 그리고 자른 것 하나:
  resume 로직(첫 출시 가설 검증 후)."
```

### slice 핸드오프 문자열

```
신규 가입자가 핵심 설정 미완료로 첫 사용에서 이탈하는 activation-gap.
사용자 = 가입 후 최초 로그인 신규 사용자.

MUST PRESERVE: 기존 로그인 플로우 및 인증된 사용자 라우팅 불변.

ACCEPTANCE VARIANTS (behavioral, WHAT-not-HOW — Canon TDD 힌트):
  [now] onboarding_profile_required_fields (L1) 빈 필수 필드 → 에러, 단계 미진행
  [now] onboarding_profile_valid_advances  (L1) 정상 입력 → 다음 단계 진행
  [now] onboarding_completion_persisted    (L2, real DB) 완료 → DB onboarding_completed=true
  [now] onboarding_completed_user_skips    (L2, real DB) 완료 사용자 → 온보딩 재진입 차단
  [now] new_user_completes_onboarding_journey (L3, journey) 가입→온보딩→대시보드

PUNT: onboarding_resume_from_step — 첫 출시 이탈 지표 확인 후 결정.
```

**왜 L1 이 먼저인가**: 입력 검증은 순수 로직 invariant 다 — DB 없이 L1 에서 가장 싸게 잡는다(pyramid economics). 완료 상태는 DB 상태기계이므로 L2. 전체 여정(가입→온보딩→대시보드) 은 사용자 여정이 존재하므로 L3 정당(journey-gated).

**토큰 패밀리**: `onboarding_` 접두사. L1 토큰 2개(`onboarding_profile_*`) + L2 토큰 2개(`onboarding_completion_*`, `onboarding_completed_*`) + L3 토큰 1개(`new_user_completes_onboarding_journey`) — 하나의 invariant(온보딩 신뢰성)이 계층을 넘어 5개 item 으로 펼쳐짐.

---

## 패턴 요약 — 세 예시에서 반복되는 구조

| | Ex1 discount (순수 로직) | Ex2 webhook (real-dep 통합) | Ex3 onboarding (여정) |
|---|---|---|---|
| **L1 NOW** | 할인 계산 순수 fn | — | 입력 검증 순수 로직 |
| **L2 NOW** | real DB 통합 | 서명·멱등·DB-fault (핵심 계층) | 완료 상태 저장·차단 |
| **L3 NOW** | checkout journey (존재 확인) | — (여정 없음, journey-gated 제외) | 신규 가입 전체 여정 |
| **PUNT** | 프로모 중첩(제품 미결정) | 미지 이벤트 타입(카탈로그 미결) | resume 로직(지표 미확인) |
| **MUST PRESERVE** | 비-gold 총액 불변 | 기존 상태 전환 API | 기존 로그인 라우팅 |

**공통 규칙**:
- PUNT 는 항상 이름 + 이유를 남긴다 — 조용히 삭제 금지.
- 보안·데이터 손실·입력 검증은 scope-floor → CANNOT be silently punted.
- L3 는 journey-gated: 사용자 여정이 *실제로 존재할 때만* NOW. Ex2 처럼 여정 없으면 제외.
- criterion 은 메커니즘이 아닌 관찰 가능한 결과: `sendgrid.send() 호출` ✗ → `이메일 수신` ✓.
- slice 핸드오프는 NOW 토큰만 포함(PUNT/LATER 는 BACKLOG 행).
