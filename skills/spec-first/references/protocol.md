---
load-on-demand: true
---

# De-risk Protocol — 5단계 심층 가이드

> 이 파일은 SKILL.md의 "5단계 de-risk" 섹션의 깊이 레퍼런스다.
> 각 단계마다: **정확한 질문 · 구체적 행동 · 근거 출처 · fuzzy→sharpened 전사**.

---

## §1 진짜 문제, 해법이 아닌 문제

**원칙**: 요청자가 건넨 *해법 프레이밍*을 그대로 받지 않는다. 시니어 엔지니어의 첫 번째 움직임은 "무엇을 만들까"가 아니라 "**우리가 실제로 해결하려는 문제가 무엇인가?**"다.

**정확한 질문**: "이 요청이 해결하려는 *문제*는 무엇인가? 제안된 메커니즘(솔루션)을 일단 내려놓고."

**구체적 행동**:
1. 요청에서 제안된 메커니즘("X 기능 추가", "Y 리팩터링", "Z API 연동")을 밑줄 긋고 *옆에 놓는다*.
2. 그 메커니즘 없이 문제를 한 문장으로 재서술한다. 서술에 메커니즘 단어가 들어가면 다시 쓴다.
3. "이 문제를 해결하지 않으면 무슨 일이 일어나는가?"를 물어 문제의 *중력*을 확인한다.

**시니어 근거 (terriblesoftware — "What Actually Makes You Senior")**:
> "The defining senior capability is *reducing ambiguity* — turning vague problems into actionable plans. The invisible upfront work that de-risks projects."

해법을 먼저 받는 것은 그 보이지 않는 일을 건너뛰는 것이다. 문제를 잘못 정의한 채로 완벽하게 구현하는 것이 가장 비싼 실패다.

**Before / After**

| Before (fuzzy) | After (sharpened) |
|---|---|
| "골드 등급 할인 기능을 checkout 에 추가해줘" | "골드 등급 고객이 지금 full-price를 내고 있어 로열티 리텐션이 새고 있다 — 체크아웃 시 적용되어야 할 할인이 누락된 것이 문제" |
| "알림 서비스를 리팩터링해줘" | "알림 전송 실패가 조용히 무시되어 사용자가 중요한 이벤트를 놓치고 있다" |

**주의**: 문제 재서술이 너무 추상적("UX 개선")이거나 너무 구체적("sendgrid.send()가 retry를 안 함")이면 아직 덜 된 것이다. 관찰 가능한 *증상*과 *영향받는 사용자*가 보여야 한다.

---

## §2 사용자와 고통 — 구체성 필수

**원칙**: "사용자"라는 단어는 답이 아니다. *누가, 언제, 무엇이 고통스러운지*가 없으면 인수 기준을 쓸 수 없고, 완료 여부를 판단할 수도 없다.

**정확한 질문**: "누가 사용자인가? 그들이 *언제*, *무엇* 때문에 고통받는가? — 'users' 수준의 답은 인정하지 않는다."

**구체적 행동**:
1. 역할(role), 시나리오(when), 고통(what pain)을 채운다: `[역할]이 [시나리오]에서 [고통]을 겪는다`.
2. "이 고통이 해결됐다는 것을 *관찰 가능하게* 어떻게 아는가?"를 물어 인수 기준의 씨앗을 얻는다.
3. 사용자가 둘 이상일 경우(구매자 vs 판매자 vs 관리자), *각각* 분리한다 — 합쳐 놓으면 인수 기준이 모호해진다.

**시니어 근거**: 구체적인 고통이 없으면 우선순위를 매길 수 없고, "done"을 선언할 수 없다. 추상적 사용자 정의는 체크리스트를 만들게 하지 않고 해석을 만들게 한다. 해석은 나중에 비용이 된다.

**Before / After**

| Before (fuzzy) | After (sharpened) |
|---|---|
| "사용자들이 불편해하는 할인 문제" | "반복 구매 골드 등급 고객이 결제 단계에서 할인이 적용되지 않아 full-price를 내고 이탈한다. 완료 신호: 골드 고객의 결제 완료 화면에 '골드 -20%' 라인이 보인다" |
| "알림이 잘 안 된다고 해서요" | "이벤트 참여자가 시작 10분 전 알림을 받지 못해 이벤트를 놓친다. 완료 신호: 예약된 알림이 실제 수신 확인 가능(DB 상태 = delivered)된다" |

**주의**: 고통을 팀 내부 불편("코드가 복잡해서")으로 정의하는 경우가 많다. 그것이 진짜 사용자 고통인지, 아니면 기술 부채인지를 구분한다. 기술 부채는 §3의 가정 항목이 되거나, 별도의 now/punt 결정이 필요하다.

---

## §3 숨은 가정 표면화

**원칙**: 모든 계획은 말하지 않은 가정 위에 서 있다. 그 가정이 틀렸을 때 조용히 실패하지 않으려면, *먼저 가정을 이름 붙여야* 한다.

**정확한 질문**: "이 계획이 당연하게 받아들이는 것들이 뭔가? 그것들이 틀렸다면?"

**구체적 행동**:
1. 각 계획 요소에 대해 "이것이 사실임을 우리는 어떻게 아는가?"를 묻는다.
2. 가정 목록을 세 종류로 분류한다:
   - **검증됨**: 데이터나 코드로 확인 가능한 것.
   - **검증 필요**: 아직 확인 안 된 것 — 스파이크나 NOW 인수 항목이 된다.
   - **미결 상품 결정**: 팀/제품 차원에서 먼저 결정해야 하는 것 — PUNT 후보.
3. "검증 필요" 가정 중 고위험 항목은 Step 4에서 downside를 평가한다.

**시니어 근거 (terriblesoftware)**:
> "Every plan carries hidden assumptions that silently derail execution. Enumerate them explicitly."

숨은 가정이 가장 자주 현실화되는 곳: 런타임에 이미 알고 있다고 가정한 상태(tier known at checkout?), 신뢰할 수 있다고 가정한 입력(input trusted?), 이미 존재한다고 가정한 의존성(dependency available?).

**Before / After**

| Before (fuzzy) | After (sharpened) |
|---|---|
| "체크아웃에 골드 할인 적용" | 가정 표면화: ① 체크아웃 시점에 tier 정보가 *런타임에 조회 가능*한가(검증 필요) ② 할인이 프로모 코드와 중첩 적용되는가(미결 상품 결정) ③ 기존 비골드 고객 total은 변경 없는가(검증됨 — 회귀 가드 필요) |
| "알림 retry 추가" | 가정 표면화: ① 현재 실패율 측정값이 있는가(검증 필요) ② retry 횟수 정책이 정해져 있는가(미결 상품 결정) ③ 중복 전송 방지 로직이 있는가(검증 필요 — idempotency) |

**주의**: 가정을 "리스크"라고 부르고 목록을 만든 뒤 무시하는 패턴이 흔하다. 이 단계의 목적은 가정을 *인수 항목이나 PUNT로 변환*하는 것이지, 목록 생성 자체가 목적이 아니다. 변환되지 않은 가정은 Step 4 이후에도 숨은 채로 남는다.

---

## §4 틀렸을 때의 결과 — blast-radius + signal/noise

**원칙**: 가정이 틀렸을 때의 *비용*이 결정을 구분한다. 고비용 가정은 NOW 항목이 되고, 저비용 가정은 PUNT 후보가 된다. 이것이 signal/noise 분리다 — 표면적 긴급함에 속지 않고 실제 영향을 본다.

**정확한 질문**: "이 가정이 틀린 채로 이것을 출시하면 어떤 일이 일어나는가? 누가, 얼마나 많이 영향받는가?"

**구체적 행동**:
1. §3의 각 "검증 필요" 가정마다 downside를 한 줄로 쓴다: `[가정]이 틀리면 → [결과]`.
2. 결과를 severity로 분류한다:
   - **데이터 손실 / 보안 / 신뢰 경계 위반**: scope-floor — 조용히 punt 불가. NOW이거나 explicit PUNT+이유가 필요하다.
   - **매출/마진 손실**: 고위험 — NOW 인수 항목이 되거나 product 결정 후 PUNT.
   - **UX 불편**: 중간 — 규모와 빈도에 따라 NOW/PUNT 결정.
   - **기술 부채 누적**: 저위험 — LATER 후보.
3. **signal/noise 분리**: "긴급해 보이는" 항목과 "실제로 중요한" 항목을 분리한다. 긴급함은 noise일 수 있다 — blast-radius가 작으면 나중에 처리해도 된다.

**시니어 근거 (terriblesoftware)**:
> "Assess the consequence/blast-radius of shipping on an incorrect assumption. High-downside items MUST become NOW acceptance items or explicit PUNTs with a reason — never silent."

**Before / After**

| 가정 | Downside if wrong | 분류 | 결과 |
|---|---|---|---|
| "체크아웃 시점에 tier 런타임 조회 가능" | 골드 고객이 전원 full-price를 냄 — 매출 누수 지속 + 로열티 훼손 | 고위험 | NOW: 런타임 tier 조회 검증 인수 항목 |
| "프로모+골드 할인 중첩 정책" | double-discount → 마진 손실 | 미결 상품 결정 | PUNT: 제품 결정 전 testable 하지 않음 (NAMED) |
| "기존 비골드 total 불변" | regression — 비골드 고객 total이 변경됨 | 데이터 정확성 | NOW: 회귀 가드 인수 항목 |

**주의**: severity 분류는 *엔지니어링 판단*이지 checklist 기계적 적용이 아니다. 같은 "데이터 손실"이라도 규모와 복구 가능성이 다르다. 분류 근거를 SHARPENED TASK 블록에 *보이게* 남긴다 — "팀이 같은 이유로 같은 결정을 재현할 수 있어야 한다"가 기준이다.

---

## §5 Now / Punt 컷 + 출력 게이트

**원칙**: "무엇을 이번에 하고, 무엇을 명시적으로 안 하는가"를 *결론으로만* 말하면 안 된다. 각 항목마다 명시적이고 소통된 결정이어야 한다. "cut"은 "삭제"가 아니라 "이름 붙인 범위 밖"이다.

**정확한 질문**: "이번 라운드에 *반드시* 있어야 하는 것은 무엇인가? 그리고 우리가 *명시적으로 안 하는* 것은 무엇이며, 왜인가?"

**구체적 행동**:
1. §4 결과를 세 버킷으로 분류한다:
   - **NOW**: 이번 라운드 핵심 가정 검증 + scope-floor 항목.
   - **PUNT**: 명명 + 이유 필수. "지금 결정할 수 없는 제품 결정", "전제 조건 미충족", "blast-radius 작아 이후 처리 가능".
   - **LATER**: 미래 결정에 의존하거나 현재 전략과 맞지 않는 것.
2. 출력 블록을 구성한다 (형식은 고정):
   ```
   SHARPENED TASK: <한 단락 — 진짜 문제, 구체적 사용자+고통, 표면화된 가정, downside-if-wrong>
   MUST PRESERVE: [ ... ]

   ACCEPTANCE TEST-LIST
     NOW   (→ slice root scope tokens)
     PUNT  (named + reason → BACKLOG)
     LATER (maybe / future decision → BACKLOG)

   CUT RATIONALE: "<두-프로젝트-+-컷 프레이밍>"
   ```

**출력 게이트 — "두 프로젝트 + 컷 하나" 테스트**:

출력이 **작은 프로젝트 2개 + 명시적 컷 1개** 모양으로 분해되지 않으면 모호함을 충분히 줄이지 못한 것이다 — §1로 돌아간다.

> *"'I don't even know what this is'를 'two small projects and one thing we should cut'으로 바꾸는 것."* — terriblesoftware

**왜 이 프레이밍인가**: "두 프로젝트"는 팀이 *동시에 이해할 수 있는* 크기다. "컷 하나"는 명시적으로 이름 붙인 범위 밖이 있음을 보여주는 신뢰 신호다. 둘 다 없으면 "이번에 뭐 합니까?"라는 질문이 반복된다.

**Before / After**

| Before (fuzzy) | After (sharpened) |
|---|---|
| "골드 할인 다 만들어줘" | CUT RATIONALE: "두 작은 프로젝트 — (1) 순수 할인 계산 로직 + 비골드 회귀 가드, (2) 실제 DB 고객 레코드로 체크아웃 total 통합 + 기존 E2E 여정 — 그리고 지금 자르는 것 하나: 프로모 중첩 정책 (제품 결정 전 testable 하지 않음)" |

**주의**: PUNT와 LATER는 *이름과 이유*를 반드시 남긴다. "나중에"는 범위 밖이 아니다. scope-floor 항목(신뢰 경계 입력 검증, 데이터 손실, 보안)은 조용히 PUNT 불가 — 이유가 없으면 NOW다.

---

## §6 비례 원칙 — 언제 spec-first를 건너뛰는가

**원칙**: spec-first는 *fuzzy 진입용*이지 모든 요청에 붙는 세금이 아니다. 이미 구체적인 요청, 1줄로 진단된 수정은 1-item list로 끝내거나 직접 실행한다(T0/T1).

**건너뛰는 조건** (하나라도 해당되면 spec-first 없이 진행):

| 조건 | 대신 하는 것 |
|---|---|
| 이미 1줄로 진단된 버그 수정 | 직접 수정 (T0/T1) |
| 명확한 인수 기준이 이미 존재함 | 바로 test-list 작성 |
| 탐색적 스파이크 (발견이 목적) | 스파이크 후 spec-first |
| 단일 invariant, 단일 사용자, 단일 계층 | 1-item list로 단축 |

**왜**: 의식(ceremony)은 신뢰 결손에 비례한다. 신뢰 결손이 없는 곳에 의식을 강제하면 그 자체가 비용이 된다. "이 스킬을 적용해야 하는가?"가 첫 번째 질문이어야 한다.

**Before / After**

| Before (과도한 spec-first) | After (비례적) |
|---|---|
| "status 200이 되어야 하는데 404가 남" → 5단계 전체 실행 | 직접 진단 → 1-item: `api_health_returns_200` criterion: `GET /health == 200` |
| "이 함수의 return type 명시해줘" → 사용자+고통 분석 | 직접 수정 — invariant 명확, 단일 파일, spec 불필요 |

**주의**: "이미 구체적"인지 판단하는 것 자체가 약한 형태의 모호함 제거다. 판단이 10초 안에 안 되면, 이미 fuzzy한 것 — spec-first를 적용한다.

---

## §7 Pre-hoc vs issue-rootcause Post-hoc 거울

**원칙**: spec-first와 issue-rootcause는 *같은 근육(invariant articulation)*을 *반대 방향*으로 쓴다. 혼용하면 둘 다 얕아진다 — 선명하게 구분한다.

**대칭 구조**:

| | spec-first (이 스킬) | issue-rootcause |
|---|---|---|
| **시점** | PRE-HOC — 아직 짓지 않은 일 | POST-HOC — 이미 발생한 버그 |
| **방향** | "이 변경이 *만족해야 할* invariant는 무엇인가?" | "이 버그가 *위반한* invariant는 무엇인가?" |
| **입력** | fuzzy 요청 → 가정 표면화 → downside | 버그 증상 → 근본 원인 → 재현 |
| **출력** | falsifiable acceptance test-list + now/punt 컷 | invariant 명문화 + 회귀 테스트 박제 handoff |
| **핸드오프 핸들** | `proposedTestName` (bare token, `/^[A-Za-z0-9_.-]+$/`) | `proposedTestName` (동일 형식) |
| **다음 단계** | → slice (구현) + test-foundations (rig) | → test-foundations (회귀 박제) |

**공유 핸들이 의미하는 것**: 두 스킬이 같은 bare-token 형식의 `proposedTestName`을 emit하므로, test-foundations의 recurrence seam은 두 경로를 구분 없이 소비할 수 있다. *같은 이름이 같은 scope token이 된다* — 연속성 보장.

**혼용을 막는 리트머스**:
- "버그가 *이미 발생했나*?" → issue-rootcause.
- "아직 짓지 않은 기능의 *인수 조건을 정의*하려 하나?" → spec-first.
- "기존 기능에 invariant를 *소급 추가*하려 하나?" → issue-rootcause (사후 박제).
- "기존 기능을 *변경하는데 regression 가드*가 필요하나?" → spec-first의 MUST PRESERVE 항목 → NOW acceptance item.

**왜 구분이 중요한가**: issue-rootcause는 *발생한 사실*에서 invariant를 역추출하는 데 최적화되어 있다(증상→근본원인→재현 경로). spec-first는 *발생 전 가정*을 표면화하는 데 최적화되어 있다(fuzzy→가정→downside→컷). 한 도구로 두 방향을 커버하려 하면 두 방향 모두 얕아진다.

**Before / After**

| 상황 | 잘못된 라우팅 | 올바른 라우팅 |
|---|---|---|
| 프로덕션에서 골드 할인 누락 버그 발생 | spec-first로 acceptance list 재작성 | issue-rootcause → 어긴 invariant 명문화 → L1 회귀 테스트 박제 |
| 새 기능: 골드 할인 추가 (아직 없음) | issue-rootcause로 "버그" 탐색 | spec-first → 5단계 → NOW list → slice |
| 기존 기능 변경 중 regression 방지 | issue-rootcause (버그 아님) | spec-first MUST PRESERVE → NOW 회귀 가드 acceptance item |
