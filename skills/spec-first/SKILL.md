---
name: spec-first
description: fuzzy/큰/애매한 요청을 → 진짜 문제 + 낙오 불가능한(falsifiable) acceptance test-list + now/punt 컷으로 바꾼다 — 시니어의 핵심 능력 = 모호함 줄이기(de-risk). 신뢰 루프의 *앞단*. 트리거 - (1) fuzzy/큰/스펙 불명 요청, "이거 만들어줘"인데 인수 조건 불명, "진짜 문제가 뭔지"·"숨은 가정"·"뭘 지금 하고 뭘 자를지(now/punt)" 정리 요청, (2) slice 진입 직전 acceptance 변종 추출, "falsifiable test-list 로 쪼개줘"·"동작 변종 목록 + 컷", (3) vague PRD → 동작 분석. 각 item = FALSIFIABLE + DETERMINISTIC 단일 행동 주장, test-foundations 4계층(L0-L3)에 매핑, /^[A-Za-z0-9_.-]+$/ 만족하는 proposedTestName 산출(= slice {scope} 토큰 + recurrence 핸들). Canon TDD 규율 — 변종만 적고 *구현 설계는 섞지 않는다*. **WHAT-to-test 만 소유** — HOW/WHERE-it-runs(계층·도구·rig)는 test-foundations, 슬라이싱·실행은 slice, 근본원인 추적(post-hoc)은 issue-rootcause 몫. 이미 1줄로 진단된 수정엔 안 쓴다(proportional — 직접 해라).
---

# Spec-First — fuzzy 요청을 낙오 불가능한 acceptance test-list 로 (신뢰 루프의 앞단)

한 문장: **시니어 = 모호함 줄이기(de-risk)** — fuzzy→concrete, 아무도 안 묻는 질문을 묻고,
*now vs punt* 를 명시한다(terriblesoftware "What Actually Makes You Senior"). 이 보이지 않는
앞단 작업이 프로젝트를 de-risk 한다.

이 스킬은 신뢰 제조 루프(reliability-system §9)의 **앞단만** 소유한다: ambiguity 제거 +
falsifiable acceptance test-list 생성 — 즉 **WHAT-to-test**. 구현·슬라이싱은 slice, 계층 실재·
도구·verify rig 는 test-foundations 몫이다(`## 분담`). 산출물은 test 코드가 아니라 *동작 주장의
목록*이다.

> ⚠️ **로드 규율** — `references/*.md`는 **필요할 때만** 1개씩 연다. 본문 + 트리거 맵으로
> 충분한 경우가 대부분이다. 권위는 항상 blueprint(reliability-system §5.2) — 이 SKILL.md는 그
> 압축이고, 깊이는 references 가 진다.

## 왜 앞단인가 — 신뢰는 모호함 제거에서 시작

Beck *Canon TDD* 의 test list = **STEP 1 행동 분석** — "새 동작의 모든 변종을 나열한다"(basic
case + timeout + missing key + error paths). 모두가 이 단계를 건너뛴다(everyone skips it). 그
list 를 *제대로* 만드는 게 이 스킬이다.

fuzzy 한 요청을 **'작은 프로젝트 2개 + 잘라낼 것 1개'** 모양으로 만들지 못하면 아직 모호함을
덜 줄인 것이다 — ①로 돌아가라(출력 게이트).

> **주의 (proportional)** — 이미 concrete 한 요청(1줄로 진단된 수정)은 1-item list 로 끝이다.
> spec-first 는 *fuzzy 진입용*이지 모든 작업에 매기는 세금이 아니다. concrete 한 건 T0/T1 로
> 직접 해라.

## 프로토콜 — 5단계 de-risk (senior 진단 시퀀스)

issue-rootcause 의 POST-HOC #1(invariant 명문화)의 **PRE-HOC 거울**이다. 각 단계의 *진단
질문* 을 sharpened-task 블록에 **보이게** 남겨라(reasoning 노출 — 팀이 de-risk 작업을 보게).

| 단계 | 묻는 질문 | 구체적 move | 답하는 것 | 출력 |
|---|---|---|---|---|
| **① 진짜 문제** | "우리가 *실제로* 푸는 문제가 뭐지?" | 요청자가 건넨 *해법*을 떼고, 제안된 메커니즘을 명명하지 *않는* 문제 문장으로 재진술 | 우리가 옳은 걸 푸는가? | 진짜 문제 한 문장 |
| **② 사용자·고통** | "누가 사용자고 뭐가 아픈가?" | 구체성 **필수** — 일반적 "users" 금지, named 누가/언제/무엇 | 누구를 위해, 완료를 어떻게 아나? | 인수조건이 *관찰가능하게* 덜어줄 user + pain |
| **③ 숨은 가정** | "틀릴 수도 있는 가정이 뭐지?" | 명시적 열거(tier 가 런타임에 알려지나? 입력 신뢰? dep 가용?) | 무엇이 계획을 무효화하나? | 가정 목록 — risky 한 건 regression-guard item 또는 spike 로 |
| **④ downside if wrong** | "틀린 채 ship 하면 무슨 일?" | blast-radius 평가(데이터 손실? 마진 손실? 보안 구멍?) — signal/noise 분리 | 틀리면 얼마나 비싼가? | 가정별 downside — high-downside 는 NOW item 또는 *명시 PUNT* |
| **⑤ now/punt 컷** | "이건 지금 / 이건 자른다 / 이건 나중" | item 별 EXPLICIT, communicated 한 콜 | 핵심 가정을 검증하는 최소 버전 + 명시적으로 *안* 하는 것 | 버킷된 test-list + 한 줄 cut rationale |

**출력 게이트(시니어의 시험):** *두-프로젝트-+-컷* 모양이 안 나오면 모호함을 덜 줄인 것 —
①로 회귀. 깊이는 [protocol.md](references/protocol.md).

## acceptance test-list ITEM — load-bearing 산출물

각 item = 단일 **FALSIFIABLE + DETERMINISTIC** 행동 주장, WHAT-not-HOW(Canon TDD), 정확히 이
필드를 진다:

| field | type | constraint / source |
|---|---|---|
| `id` | string slug, regex `/^[A-Za-z0-9_.-]+$/` | unique; IS the scopeSafe token (no separate field — id == proposedTestName) |
| `given` / `when` / `then` | 3 strings | the falsifiable claim in given-when-then; `then` is the assertion that can break. (For pure-logic items a single `assertion` string substitutes for when/then.) |
| `criterion` | string | the EXACT invariant restated as a runnable claim, e.g. `calc_discount('gold') == 0.2`, `response.status == 201 within 200ms`. NOT an implementation step (`call sendgrid.send()` ✗ → `email delivered` ✓). |
| `layer` | enum `l0\|l1\|l2\|l3` | from test-foundations layers.md §3 decision tree (HINT, not binding — test-foundations may re-layer). |
| `falsifiable` | bool | MUST be true; the spec-first falsifiability audit gate (read criterion aloud: can it fail? can code pass it vacuously?). |
| `deterministic` | bool | MUST be true; time/random/network fixed at the named layer (L1 no live net, L2 fresh container). |
| `proposedTestName` | string, regex `/^[A-Za-z0-9_.-]+$/` | == `id`; becomes the slice `{scope}` token AND the recurrence-seam "Proposed test name". Derived deterministically: strip articles/filler → join with `_`/`.`/`-` → assert regex. |
| `cut` | enum `now\|punt\|later` | the CUT bucket. |
| `cutReason` | string, REQUIRED iff cut≠now | why deferred — punt/later items are NAMED, never silently dropped (scope-floor items like input-validation/data-loss/security CANNOT be silently punted). |
| `dependsOn` | string[] of ids (optional) | ordering hint for the slicer. |

**두 게이트 (규율을 mechanical 하게):**

- **falsifiability** — `criterion` 을 소리내 읽어라. (a) *실패 가능한가?*(불가능하면 vacuous —
  reject). (b) 코드가 *우연히* 통과(vacuous green)할 수 있나? 그러면 criterion 을 조이거나 setup
  guardrail 추가. "email sent" ✗(언제? 누구에게?) → "verified address 로 60s 내 signup-confirmation
  email 수신" ✓.
- **determinism** — nondeterminism 출처(시간·랜덤·네트워크)를 명명하고 chosen `layer` 에서
  고정됨을 단언하라. L1 은 live network 금지, L2 는 fresh-per-run real dep. 어느 계층에서도
  결정론화 불가능한 item 은 acceptance 가 아니라 *research spike* — 이유 달아 punt 한다.

**atomic:** 1 item = 1 행동 주장 = 1 `{scope}` 토큰 = 1 slice leaf(절대 "5 behaviors in 1
test" 금지 — operability/trace-식별 가능성 상속). 한 business invariant 는 계층을 가로질러 **N
items** 를 낳을 수 있다(L1 pure-fn + L2 real-dep + L3 journey), 각자 같은 family 의 토큰
(`discount_gold` / `checkout_discount_applied` / `buy_as_gold_member`) — 계층당 1:1 item↔test.
깊이는 [test-list.md](references/test-list.md).

## Canon TDD 규율 — 구현 설계를 섞지 않는다

Beck 의 named anti-pattern: *"Mixing in implementation design decisions. Chill. There will be
plenty of time for that later."*

- **OWNS** — 행동 *변종* 열거(the WHAT): happy path, boundary, empty/null, error/timeout, 각
  MUST-PRESERVE invariant 의 regression-guard.
- **FORBIDS** in any field — 함수명, 파일 경로, class/module 선택, 자료구조 픽, "call X / use
  library Y", control-flow. criterion 은 *관찰 가능한 결과*(`email delivered`)지 *메커니즘*
  (`sendgrid.send() called`)이 아니다.

**self-audit (handoff 전):** 모든 item 을 스캔 — 어떤 필드든 함수/파일/라이브러리/자료구조를
명명하면 → 그 item 은 구현 설계를 *밀반입*한 것 → 결과 주장으로 재작성하거나 reject. 이게
slicer(WHERE/HOW 설계를 OWN)가 pre-baked design 을 절대 받지 않게 하는 구조적 보증이다 —
slicer 는 오직 *행동 주장*만 받는다.

> **왜** — executor 는 여전히 slice 안에서 Canon TDD 를 **ONE TEST AT A TIME** 으로 구현한다.
> spec-first 는 *list 를 completion audit* 로 제공할 뿐(모든 변종을 떠올렸나?), pre-written test
> 코드나 upfront 설계가 아니다. 구현은 slice 의 refactor + new-test 단계에서 tree-like 하게
> 자란다.

## now/punt/later 컷 + 출력 블록

list 는 세 버킷으로 묶여 한 블록으로 방출된다:

```
SHARPENED TASK: <한 문단 — 진짜 문제(요청된 해법 아님), 구체적 user + pain, 표면화된 가정, downside-if-wrong>
KEY CONSTRAINTS (MUST PRESERVE): [ ... ]

ACCEPTANCE TEST-LIST
  NOW   (이번 라운드 배달 → slice 루트 scope 토큰이 됨)
  PUNT  (deferred, NAMED + reason → BACKLOG, slice 입력 아님)
  LATER (maybe / 미래 결정에 의존 → BACKLOG)

CUT RATIONALE: "<'작은 프로젝트 2개 + 잘라낼 것 1개' framing>"
```

> **주의 (scope-floor)** — **PUNT/LATER 은 이름과 이유를 남긴다.** 신뢰 경계 입력 검증·데이터
> 손실 방지·보안 item 은 *조용히 punt 금지* — 이건 code-fundamentals 의 scope-floor 를 list 에
> 적용한 것이다. ④ downside 가 high 인데 PUNT 되면 cutReason 이 *진짜 product 결정*(promo-stacking
> 처럼)인지 scope-floor 위반인지 자문하라.

워크드 예시(discount L1+L2+L3 토큰 family + promo-stacking PUNT)는 [examples.md](references/examples.md).

## 분담 (seams) — 무엇이 *아닌가*

| 스킬 | spec-first가 **소유** | 그쪽에 **defer** |
|---|---|---|
| **test-foundations** | ambiguity 제거 + falsifiable acceptance test-list(WHAT-to-test): 각 criterion 명료성·falsifiability·now/punt 컷·proposedTestName/{scope} 토큰. item 별 **layer 힌트** 방출 | HOW/WHERE-it-runs: L0-L3 *실제* 배치, 스택별 도구, verify.sh 엔트리, L2 real-dep fidelity, 결정론 강제, flake 제거. layer 는 *힌트*고 최종 배치는 test-foundations(layers.md §3, **link only**) — 이 seam 은 test-foundations SKILL.md line 222 에 이미 선언, verbatim 미러 |
| **slice (엔진)** | sharpened task 문자열 + 버킷된 변종 목록. spec-first 는 루프의 *앞*(§9 ①)이자 fuzzy 진입의 front-door 라우트(§6.1) | 분해(R_SLICE)·완전성 감사(R_CRITIC)·Canon-TDD 실행·adversarial verify·per-leaf commit·integrate. spec-first 는 NOW item 을 root scope 토큰 + 변종을 *힌트지 제약 아님*으로 넘긴다(slicer 가 WHERE/HOW 설계, critic 이 힌트 커버리지 감사). spec-first 는 test 코드·설계를 보지도 쓰지도 않는다 |
| **issue-rootcause** | PRE-HOC ambiguity 감소: 짓기 *전*에 변경이 MUST 만족할 invariant 명문화(가정 표면화 + downside). recurrence seam 이 소비하는 같은 산출물 모양(named invariant + bare-token proposedTestName) 생산 | POST-HOC 짝: 버그가 *사후에* 어긴 invariant 명문화(#1) 후 recurrence.md 로 test-foundations 에 핸드오프. spec-first 는 버그를 진단하지 않는다 — 안 지은 일을 de-risk. 같은 근육(invariant 명문화), 반대 시간 방향 — 섞지 마라 |
| **code-fundamentals** | scope-floor reflex 를 *list 에* 적용: 각 item 은 invariant 를 단언해야 하고 단순 커버리지가 아니다(coverage-only item drop). 1 item = 1 행동(operability/trace-식별 가능성 상속) | scope-floor 자체와 코드 품질 판단. spec-first 는 3-part pre-flight(stdlib 가 푸나? 기존 테스트가 덮나? invariant vs 커버리지?)를 상속하지만 프로덕션 코드를 리뷰하지 않는다 |

## slice 핸드오프 — 토큰 연속성

**slice 진입 계약(검증됨):** `recursive-slice.js`/`main.ts:111`이 `args.task` 를 STRING 으로
읽는다. `EngineArgs`(types.ts)는 `task?`·`repo?`·`skills?` 만 있고 `testList`/`acceptanceVariants`
필드는 **없다**. 따라서 핸드오프는 새 엔진 인터페이스가 아니라 — 구조화된 TASK 문자열 + 문서화된
convention 이다(GROUND Rec 1/3: 변종은 힌트, 구현 설계와 분리 보관; slicer 는 acceptance test
코드를 절대 보지 않고 *행동 주장*만 본다).

**핸드오프 문자열** spec-first 가 조립해 `args.task` 로 넘긴다:

```
<SHARPENED TASK paragraph>

MUST PRESERVE: <key constraints>

ACCEPTANCE VARIANTS (behavioral, WHAT-not-HOW — Canon TDD list, hints for the slicer/critic):
  [now] discount_gold_tier        (L1) calc_discount('gold') == 0.20
  [now] discount_non_gold_zero    (L1) non-gold totals unchanged
  [now] checkout_applies_gold_discount (L2, real DB) total == subtotal*0.8
  [now] buy_as_gold_member_receipt (L3, journey exists)
PUNT (not in scope this round): discount_promo_stacking_rule — product decision pending.
```

PUNT/LATER item 은 엔진 입력에서 **제외**된다(BACKLOG 로) — NOW 만 나타나 slicer 의 breadth 가
실제 scope 를 반영하게.

**slice 가 소비하는 두 단계(GROUND Rec 2):**
1. **R_SLICE(Slicer, main.ts:615)** 가 sharpened task 를 vertical slice 로 분해 — NOW acceptance
   토큰이 자연스러운 slice 경계(1 atomic item ≈ 1 leaf). slicer 가 WHERE/HOW 설계, spec-first 는
   WHAT 만 공급.
2. **R_CRITIC(Completeness Critic, main.ts:637, depth≤1)** 가 MISSING 변종을 감사하고 — 각 힌트된
   acceptance 변종이 어느 slice 에 덮였나도 감사 가능("어느 slice 가 discount_non_gold_zero 를
   다뤘나?"). Additive-only(Rec 5): 빠진 slice 를 *추가*하지 재설계 안 함. 힌트를 넘는 critic 추가는
   로그됨(Rec 6: "critic found N gaps beyond Y acceptance variants").

**토큰 연속성(load-bearing thread):** 각 NOW `proposedTestName` 은 이미 `/^[A-Za-z0-9_.-]+$/`
(recursive-slice.js:611 scopeSafe 가드)에 맞는 bare 토큰 → `filterCommand = "scripts/verify.sh
--scope {scope}"`(verify-contract.md §8)로 그대로 흘러 deterministic per-leaf T0 게이트가 되고,
스캐폴드가 executor 에게 그 토큰을 테스트 *이름 안에* 넣게 지시(verify-contract.md §5,
recursive-slice.js:299)해 name-match 가 진짜가 된다. 같은 토큰이 recurrence-seam 의 "Proposed test
name" 핸들(recurrence.md §2) — spec-first(pre-hoc)와 issue-rootcause(post-hoc)는 교환 가능한
핸드오프 핸들을 방출한다.

**3계층 변종 발견(GROUND Rec 4):** Layer 1 = spec-first acceptance 변종(NEW, optional, 이 스킬).
Layer 2 = critic top-level 갭 감사 + Layer 1 커버리지 감사(기존). Layer 3 = executor per-leaf
Canon TDD 발견(기존). spec-first 는 Layer 1 을 추가하고 2+3 을 **먹인다** — 대체하지 않는다.

## 체크리스트 + 트리거 맵

**체크리스트:**

- `[MUST]` 각 item `falsifiable:true && deterministic:true` · `proposedTestName =~
  /^[A-Za-z0-9_.-]+$/` · `cut≠now ⇒ cutReason` 존재 · 어떤 필드도 함수/파일/라이브러리/자료구조
  비명명(Canon TDD self-audit) · list 가 *두-프로젝트-+-컷* 모양
- `[SHOULD]` layer 힌트 = layers.md 결정트리 따름 · 1 invariant → N layer items(토큰 family) ·
  `--list-scopes` 로 토큰 사전검증(rig 존재 시 silent zero-match exit 2 회피)
- `[NIT]` SHARPENED TASK 블록이 진단 질문(reasoning)을 노출하나

**트리거 맵 (증상 → references):**

| 증상 | 가는 곳 |
|---|---|
| 모호함 5단계 de-risk 심화 | [protocol.md](references/protocol.md) |
| item 필드/falsifiability·determinism 게이트/토큰 도출 | [test-list.md](references/test-list.md) |
| 비자명한 분해 calibration | [examples.md](references/examples.md) |
| layer 최종 배치(L0-L3 결정트리) | test-foundations [layers.md](../test-foundations/references/layers.md) 로 **defer** |

로드 규율: references 는 필요할 때만 1개씩.

## 주의 / 비목표

- **교리가 아니다 — proportional.** 이미 concrete 면 1-item list, 그냥 직접 해라(T0/T1). 1줄로
  진단된 수정에 spec-first 를 매기지 않는다 — fuzzy 진입용이지 세금이 아니다.
- **자율 task-picking 금지.** 빠진 게 보여도 *제기*해 확인받지(slice·사람이 분기) 조용히 추가하지
  않는다.
- **test 코드·구현 설계 안 쓴다** — WHAT 만. 변종을 적되 함수/파일/라이브러리를 명명하지 않는다.
- **layer 는 힌트지 최종 배치 아니다** — test-foundations 가 re-layer 가능(L1 이라 했는데 real dep
  발견 → L2). 분쟁 시 HOW/WHERE 는 test-foundations 가 이긴다; 토큰 family 명명은 유지.
- **scope-floor 는 PUNT 보다 강하다** — ④ downside 에서 high-downside item 을 그럴듯한 cutReason 으로
  PUNT 로 합리화하지 마라. 보안·데이터 손실·입력 검증은 named PUNT 도 신중히.
- **휴대성** — SKILL.md + references 만, Claude-only API 없음 — siblings 처럼 opencode 포터블.
  bare-token 제약은 엔진 가드(recursive-slice.js:611)와 정렬 — 슬래시/공백/경로 금지.
