---
load-on-demand: true
purpose: 비자명(non-obvious) 분해를 보정할 때만 연다 — 4개 end-to-end 워크드 예시. 각 예시는 fuzzy 요청 → 5-step de-risk 트랜스크립트 → now/punt/later 버킷 리스트 → 정확한 slice task-string 핸드오프로 구성된다. Ex1 순수 로직 피처(discount: L1+L2+L3 토큰 패밀리, promo-stacking PUNT). Ex2 실제 의존성 통합(webhook-ingest: L2 real-dep, 멱등성+에러 변종). Ex3 여정 피처(onboarding: L3 journey-gated, L1 검증 NOW). Ex4 CLI/백엔드 라이브러리 피처(config-merge CLI: web UI 없음 — L1 순수 병합 로직, L2 real-file/env, L3 = subprocess CLI 여정[브라우저 아님]).
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

## Ex4 — CLI / 백엔드 라이브러리 피처 (web UI 없음): "설정 파일 병합 명령 만들어줘"

> **왜 이 예시인가** — Ex1-3 은 모두 web checkout/UI 맥락을 함의했다. 많은 작업은 **브라우저가 없다** — CLI 명령·백엔드 라이브러리 함수. 이 예시는 L3 가 *브라우저 여정이 아니라* subprocess/API 여정(`config-tool merge ...` 를 실제로 실행해 exit code·stdout·결과 파일을 관찰)임을 보여준다. journey-gated 규율은 동일하되, "여정"의 정의가 CLI invocation 이다.

### 요청 (fuzzy)

> "여러 환경 설정 파일을 하나로 합치는 CLI 가 필요해요. base 랑 override 를 합쳐주는 `config-tool merge` 같은 거요. 뚝딱 만들어주세요."

### 5-step de-risk 트랜스크립트

**Step 1 — 진짜 문제 (해법 아닌 문제)**
: 제안된 해법은 "merge 명령 제작". 진짜 문제는 → *팀이 환경별 설정을 손으로 합치다 키를 빠뜨리거나 잘못된 우선순위로 덮어써 배포가 조용히 깨진다(config-drift on hand-merge)*. "merge CLI"는 해법이지 문제가 아니다.

**Step 2 — 사용자·고통 구체화**
: 사용자 = base + 환경 override 를 배포 전에 합치는 릴리스 엔지니어 / CI 파이프라인. 고통 = 합치는 우선순위·깊은 키가 불명확해 잘못 합쳐진 설정이 프로덕션에 도달 → 침묵 장애. "done" = `config-tool merge base.yaml prod.yaml` 가 결정론적으로 합쳐진 설정을 stdout 으로 내고, 충돌·누락 키에 대해 명시적으로 동작할 때.

**Step 3 — 숨은 가정 표면화**
: (a) override 가 base 를 이긴다(우선순위 방향이 고정돼야 함 — 반대면 무의미). (b) 중첩(nested) 키는 깊은 병합(deep-merge)이지 top-level 덮어쓰기가 아니다(가정 불일치 시 하위 키 전멸). (c) 입력 파일이 없거나 깨진 YAML 이면 silent 빈 출력이 아니라 non-zero exit + stderr 진단이어야 한다(신뢰 경계 입력 검증 — scope-floor). (d) 키 충돌 시 타입이 다르면(scalar vs map) 무엇이 이기나(미결 정책).

**Step 4 — Downside if wrong**
: (b) deep-merge 가 아니면 → 중첩 설정 블록 전체가 override 의 부분 키로 교체돼 누락 → 프로덕션 설정 손실(심각). (c) 깨진 입력에 빈 출력 → 빈 설정이 배포돼 전 서비스 장애 → **데이터/구성 손실 scope-floor, CANNOT be silently punted**. (a) 우선순위 역전 → 환경 설정이 base 에 먹힘(심각). (d) 타입 충돌 정책 → 드물고 정책 미결 → PUNT with reason.

**Step 5 — Now / punt 컷**
: NOW: 깊은 병합 우선순위 순수 로직(L1) + base-키 보존 회귀 가드(L1) + 실제 파일/env 로딩 통합(L2 real-file) + 깨진 입력 → non-zero exit 진단(L2, scope-floor) + CLI 호출 여정(L3, `merge` subprocess 실행→exit 0→stdout 합쳐진 설정). PUNT: scalar-vs-map 타입 충돌 정책(미결).

### 출력 블록

```
SHARPENED TASK: 팀이 환경별 설정을 손으로 합치다 키 누락·우선순위 오류로 배포가 조용히
  깨지는 config-drift 문제. 사용자 = base+override 를 배포 전 합치는 릴리스 엔지니어/CI;
  고통 = 잘못 합쳐진 설정이 프로덕션 도달 → 침묵 장애.
  done = `config-tool merge base prod` 가 결정론적 병합 결과를 stdout 으로, 충돌/누락에 명시 동작.
  확인된 가정: override 가 base 를 이긴다(우선순위 고정) + 중첩 키는 deep-merge.
  DOWNSIDE-IF-WRONG: 깨진 입력에 빈 출력 → 빈 설정 배포 → 전 서비스 장애
    (구성 손실 scope-floor, CANNOT punt); deep-merge 아니면 중첩 블록 손실(심각).

MUST PRESERVE: base 에만 있는 키는 override 후에도 보존(override 가 명시하지 않은 키 불변).

ACCEPTANCE TEST-LIST

NOW
- id: merge_override_wins_scalar      layer:l1  falsifiable:✓  deterministic:✓
    given base{a:1} + override{a:2} / when merged / then result{a:2}
    criterion: merge({a:1},{a:2}) == {a:2}

- id: merge_preserves_base_only_keys  layer:l1  falsifiable:✓  deterministic:✓
    (MUST-PRESERVE 회귀 가드 — override 미명시 키 불변)
    criterion: merge({a:1,b:9},{a:2}) == {a:2,b:9}

- id: merge_deep_nested_maps          layer:l1  falsifiable:✓  deterministic:✓
    given nested maps in both / when merged / then nested keys deep-merged not replaced
    criterion: merge({db:{host:h,port:1}},{db:{port:2}}) == {db:{host:h,port:2}}

- id: merge_reads_real_files_and_env  layer:l2  falsifiable:✓  deterministic:✓
    given two on-disk YAML files (fresh tmpdir) + one env override /
    when merged / then output reflects file+env precedence
    criterion: merge of real base.yaml + prod.yaml (tmp) → stdout YAML with override precedence

- id: merge_broken_input_nonzero_exit layer:l2  falsifiable:✓  deterministic:✓
    (구성-손실 scope-floor — 절대 punt 불가)
    given a malformed / missing input file /
    when command runs / then non-zero exit AND diagnostic on stderr AND empty stdout
    criterion: malformed input → exit != 0 AND stderr non-empty AND stdout empty

- id: merge_cli_journey_exit_and_stdout  layer:l3  falsifiable:✓  deterministic:✓
    dependsOn: [merge_reads_real_files_and_env]
    criterion: `config-tool merge base.yaml prod.yaml` (subprocess) → exit 0 AND
      stdout parses to the merged config with prod precedence
    (L3 — CLI 여정 존재: invoke→exit code→stdout 관찰, 브라우저 아님; journey-gated 충족)

PUNT
- id: merge_type_conflict_policy      cut:punt
    cutReason: scalar-vs-map 타입 충돌 시 승자 정책 미결(제품/팀 결정) — 드문 케이스,
      결정 전 테스트 가능 기준 없음; downside: 잘못 정하면 설정 의미 왜곡. NAMED not dropped.

CUT RATIONALE: "두 작은 프로젝트 — (1) 순수 병합 우선순위·deep-merge·base-키 보존(L1),
  (2) real-file/env 로딩 + 깨진 입력 진단(L2) + CLI subprocess 여정(L3) — 그리고 자른 것 하나:
  타입 충돌 정책(엔지니어링이 아니라 팀 결정)."
```

### slice 핸드오프 문자열

```
팀이 환경별 설정을 손으로 합치다 키 누락·우선순위 오류로 배포가 조용히 깨지는 config-drift.
사용자 = base+override 를 배포 전 합치는 릴리스 엔지니어/CI.

MUST PRESERVE: base 에만 있는 키는 override 후에도 보존(override 미명시 키 불변).

ACCEPTANCE VARIANTS (behavioral, WHAT-not-HOW — Canon TDD 힌트):
  [now] merge_override_wins_scalar     (L1) merge({a:1},{a:2}) == {a:2}
  [now] merge_preserves_base_only_keys (L1) override 미명시 키 불변
  [now] merge_deep_nested_maps         (L1) 중첩 맵 deep-merge (replace 아님)
  [now] merge_reads_real_files_and_env (L2, real-file) 실제 YAML+env 우선순위
  [now] merge_broken_input_nonzero_exit (L2, scope-floor) 깨진 입력 → exit!=0 + stderr
  [now] merge_cli_journey_exit_and_stdout (L3, CLI subprocess) merge 실행 → exit0 + 합쳐진 stdout

PUNT (이번 스코프 아님): merge_type_conflict_policy — 타입 충돌 정책 결정 대기.
```

**왜 L3 가 브라우저가 아닌가**: 이 피처엔 web UI 가 없다 — "여정"은 *CLI invocation* 이다. L3 item 은 실제 바이너리를 subprocess 로 실행(`config-tool merge ...`)해 **exit code + stdout** 을 관찰한다(httpx/subprocess 류, browser-driver 아님). API 라이브러리였다면 동일 L3 가 `httpx` 로 엔드포인트를 치는 형태가 된다. journey-gated 규율은 그대로: CLI/API 여정이 *실제로 존재할 때만* L3 를 NOW 에 둔다.

**왜 L1 이 무게중심인가**: 병합 우선순위·deep-merge·키 보존은 순수 입력→출력 invariant 다 — 파일·env 없이 L1 에서 가장 싸게 잡는다(pyramid economics). 실제 파일/env 로딩과 깨진-입력 진단만 real-dep 가 필요해 L2. CLI 호출 여정 하나가 L3.

**토큰 패밀리**: `merge_` 접두사. L1 토큰 3개(`merge_override_wins_scalar`, `merge_preserves_base_only_keys`, `merge_deep_nested_maps`) + L2 토큰 2개(`merge_reads_real_files_and_env`, `merge_broken_input_nonzero_exit`) + L3 토큰 1개(`merge_cli_journey_exit_and_stdout`) — 하나의 invariant(결정론적 안전 병합)이 web UI 없이 6개 item 으로 펼쳐짐. 각 토큰 → `scripts/verify.sh --scope merge_override_wins_scalar` 등으로 per-leaf T0 게이트.

---

## 패턴 요약 — 네 예시에서 반복되는 구조

| | Ex1 discount (순수 로직) | Ex2 webhook (real-dep 통합) | Ex3 onboarding (여정) | Ex4 config-merge (CLI/라이브러리, web 없음) |
|---|---|---|---|---|
| **L1 NOW** | 할인 계산 순수 fn | — | 입력 검증 순수 로직 | 병합 우선순위·deep-merge·키 보존 |
| **L2 NOW** | real DB 통합 | 서명·멱등·DB-fault (핵심 계층) | 완료 상태 저장·차단 | real-file/env 로딩·깨진 입력 진단 |
| **L3 NOW** | checkout journey (존재 확인) | — (여정 없음, journey-gated 제외) | 신규 가입 전체 여정 | CLI subprocess 여정 (브라우저 아님) |
| **PUNT** | 프로모 중첩(제품 미결정) | 미지 이벤트 타입(카탈로그 미결) | resume 로직(지표 미확인) | 타입 충돌 정책(팀 결정) |
| **MUST PRESERVE** | 비-gold 총액 불변 | 기존 상태 전환 API | 기존 로그인 라우팅 | base-only 키 불변 |

**공통 규칙**:
- PUNT 는 항상 이름 + 이유를 남긴다 — 조용히 삭제 금지.
- 보안·데이터 손실·입력 검증은 scope-floor → CANNOT be silently punted (Ex4 의 깨진-입력 진단도 구성-손실 scope-floor).
- L3 는 journey-gated: 사용자 여정이 *실제로 존재할 때만* NOW. Ex2 처럼 여정 없으면 제외. **여정 ≠ 브라우저** — Ex4 처럼 web UI 없으면 L3 는 CLI/API invocation(subprocess/httpx)으로 관찰한다.
- criterion 은 메커니즘이 아닌 관찰 가능한 결과: `sendgrid.send() 호출` ✗ → `이메일 수신` ✓; Ex4 `exit != 0 AND stderr non-empty` 는 관찰 가능한 결과지 구현 단계가 아니다.
- slice 핸드오프는 NOW 토큰만 포함(PUNT/LATER 는 BACKLOG 행).
