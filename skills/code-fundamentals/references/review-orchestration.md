# 리뷰 오케스트레이션 — Workflow 없는 하니스용 손-구동 가이드

**opencode / Codex CLI / 서브에이전트 전용 환경 대상.**
Claude Code Workflow 런타임(agentSafe·parallel·phase·저널링)이 없어도 동일한
*규율*로 route→section→vote→synthesize를 수행한다. 잃는 것은 자동화 편의(병렬
동시 실행·강제 스키마·이력 재개)이고, 신뢰를 만드는 것들—REVIEWER≠PROPOSER,
diff 직접 읽기, 만장일치, 출력 게이트—은 API가 아니라 규율이므로 그대로 남는다.

> 이 문서는 `slice/references/portable-orchestration.md`를 거울로 삼아
> REVIEW 도메인에 맞게 적용한 버전이다. 구조가 동일하고 내용의 편차는 명시된다.

---

## 규율은 포팅된다, Workflow 런타임은 선택이다

Workflow 런타임이 제공하는 것:

- `parallel()` — 렌즈를 진짜 동시에 실행
- 강제 JSON 스키마 — 서브에이전트 출력을 파싱 전에 검증
- 저널 + 재개 — 맥락 손실 시 찾아오기
- concurrency cap — 동시 호출 수 자동 제한

이 중 어느 것도 VOTE의 신뢰를 만들지 않는다. 신뢰를 만드는 것:

| 불변식 | 슬라이스 대응 |
|---|---|
| **REVIEWER≠PROPOSER** | executor≠verifier |
| **diff 직접 읽기 후 판단** (산문 주장 전 git hunk) | shell truth before model judgment |
| **finding마다 독립 근거** | per-leaf attestation |
| **전체 코드베이스 체크는 출력 게이트에서 1회** | full suite ONCE at integrate |

이 4개는 손-구동에서도 그대로 강제할 수 있다.

---

## 손-구동 4단계

### 0. 상태 외부화

저널이 없으므로 `REVIEW.md` 스크래치 파일을 만든다.
finding 스택, 각 finding의 렌즈 판결, 강등 이력을 기록한다.
맥락이 끊겨도 `REVIEW.md`를 읽으면 재개할 수 있다.

### 1단계 — ROUTE

`git diff --stat | tail -1`로 줄 수·파일 수를 측정(결정론, LLM이 정하지 않음).

**비례 게이트:**

| 규모 | 조건 | 실행 |
|---|---|---|
| **Small** | <100줄, ≤5 findings 예상, 1파일 | VOTE 없이 Sonnet 단일 패스 |
| **Medium** | 100–500줄, 6–15 findings, 2–5파일 | Opus 1 + Sonnet 2 |
| **Large** | >500줄, 16+ findings, 5+파일 또는 3+ 모듈 | 풀 3-렌즈 VOTE |

Small diff에 3-렌즈 팬아웃을 강제하지 않는다 — 바닥(1패스)이 곧 신뢰 바닥이다.

후보 findings를 세 렌즈 파일에 라우팅한다:

- `[MUST]` → **렌즈 ①** correctness / binding 판단
- `[SHOULD]` → **렌즈 ②** reuse/coupling vs DRY
- `[NIT]` → **렌즈 ③** context/altitude / severity 역전

`code-fundamentals` 트리거 맵(SKILL.md §빠른 트리거 맵)으로 증상→원칙→파일을 분류한다.
toss-frontend 리뷰라면 그쪽 5-lane 맵으로 ROUTE를 오버라이드한다(SECTION/VOTE/SYNTHESIZE는 동일).

### 2단계 — SECTION

각 lane(`L1`=가독성+예측 가능성, `L2`=응집도+결합도)을 **별도 서브에이전트**(또는 신선 맥락)로 구동한다.

지시문:
```
너는 [L1|L2] lane 리뷰어다. 아래 diff만 보고 자기 관점(L1: 가독성·예측 가능성 /
L2: 응집도·결합도)의 findings만 출력한다. 다른 lane 결과는 보지 않는다.
출력: ONLY JSON
{ "findings": [{ "file": "...", "line": 0, "severity": "MUST|SHOULD|NIT",
  "axis": "readability|predictability|cohesion|coupling",
  "principle": "...", "citation": "코드 인용(1-2줄)", "before": "...", "after": "..." }] }
```

`Answer ONLY with this JSON` + 전달받은 JSON을 직접 파싱해 스키마 검증한다(서버 강제 불가 → 앞-문 검증으로 대체).

### 3단계 — VOTE

> **이 단계가 핵심이다 — slice heavy-verify의 리뷰판.**

#### R1 — REFUTE vs UNAVAILABLE 구분 (slice와 반대 failure mode)

slice는 false-green이 치명적 → `null=distrust`(억제).
REVIEW의 실패 모드는 **놓친 버그(false negative)** — 실제 버그가 조용히 누락되는 것.

| 렌즈 결과 | 처리 |
|---|---|
| 렌즈가 diff hunk를 읽고 **적극적으로 반박** | finding 강등 또는 제거 |
| 렌즈가 **unavailable** (null / 오류 / 실행 불가) | finding을 **버리지 않고** `[unverified]`로 플래그해 출력 |
| 모든 렌즈 available + 반박 0 | **CONFIRMED** 출력 |

`survived = distrust.length === 0`을 쓰되, null을 distrust로 취급하지 않는다.
null은 `[unverified]` 표시지 drop이 아니다. **조용한 drop = 진짜 버그 누락.**

#### 3-렌즈 서브에이전트 (순차, 하니스에 병렬 없을 때)

각 finding마다(또는 `[MUST]`/contested finding 우선으로) 3개 서브에이전트를 순차 실행한다.

**렌즈 ① correctness — `[MUST]` 판단** (가능하면 Opus; 불가하면 신선 맥락 서브에이전트)

```
너는 회의론자다. 이 finding은 기본적으로 UNTRUSTED다.
git diff에서 해당 hunk를 직접 읽고(아래 첨부), 네가 직접 원칙 위반을 확인할 때만 신뢰한다.
질문: 이 finding을 제거하면 정확성 / 안전 / a11y가 실제로 손상되는가?
'코드 스타일이 나빠진다'는 이유로 [MUST]로 남길 수 없다.
출력: ONLY JSON
{ "trustworthy": true|false, "reason": "...",
  "refuted": ["반박 근거 1줄"], "demotion": null|"SHOULD"|"NIT" }
```

**렌즈 ② reuse/coupling vs DRY** (Sonnet)

```
너는 회의론자다. 이 finding은 기본적으로 UNTRUSTED다.
git diff에서 해당 hunk를 직접 읽어라.
질문: 지적된 중복이 정당한 재사용인가?
두 코드가 같은 이유로 같이 바뀌는가(응집도) 아니면 우연히 닮았는가?
과도한 DRY가 오히려 결합도를 높이지는 않는가?
출력: ONLY JSON
{ "trustworthy": true|false, "reason": "...",
  "refuted": ["반박 근거"], "demotion": null|"SHOULD"|"NIT",
  "tradeoff_decision": null|{ "side_a": "...", "side_b": "..." } }
```

**렌즈 ③ context/altitude** (Sonnet)

```
너는 회의론자다. 이 finding은 기본적으로 UNTRUSTED다.
git diff에서 해당 hunk를 직접 읽어라.
질문: 이게 200줄 스크립트인가 프로덕션 앱인가?
문맥(규모·팀·수명)을 고려하면 severity가 뒤집히는가?
과잉 적용(작은 스크립트에 도메인 폴더링 강제 등)인가?
출력: ONLY JSON
{ "trustworthy": true|false, "reason": "...",
  "refuted": ["반박 근거"], "demotion": null|"SHOULD"|"NIT",
  "tradeoff_decision": null|{ "side_a": "...", "side_b": "..." } }
```

#### 판결 집계 — R1 적용

각 finding에 대해 3개 판결을 받은 뒤:

1. 렌즈가 **반박(refuted)** → `refuted[]` 배열에 추가 (active distrust)
2. 렌즈가 **unavailable** → finding을 `[unverified]` 플래그로 보존 (NOT drop)
3. `refuted.length === 0 && all_available` → **CONFIRMED**
4. `refuted.length > 0` → 강등 후보(`demotion` 값) 또는 탈락
5. 강등은 `vote_journal`에 기록 — 조용한 강등 금지

**severity 재투표 규칙:**

- `[MUST]` 생존 조건: 렌즈가 "제거 시 정확성/안전/a11y 손상" 확인 (스타일만으론 불가)
- `[SHOULD]` 생존 조건: lane 합의 + 강한 반론 없음
- `[NIT]` 생존 조건: 명시적 트레이드오프 인용

#### 표준 refute-mode 반박 패턴 목록

skeptic 역할이 운영자마다 달라지지 않도록:

| 패턴 | 적용 렌즈 |
|---|---|
| "이 `[MUST]`가 정확성/안전/a11y에 실제 손상을 주는가, 아니면 스타일인가?" | 렌즈 ① |
| "두 코드가 우연히 닮은 건가, 아니면 같은 이유로 같이 바뀌는가?" | 렌즈 ② |
| "이 중복 제거가 결합도를 높이지는 않는가?" | 렌즈 ② |
| "200줄 스크립트에 도메인 폴더링을 강제하는 건 과잉 적용이 아닌가?" | 렌즈 ③ |
| "채용 과제 맥락에서 이 severity가 프로덕션 기준 그대로 적용되는가?" | 렌즈 ③ |
| "트레이드오프가 코드 곁에 주석으로 남겨져 있어 의도적 단순화가 명확한가?" | 렌즈 ③ |
| "표준 라이브러리 / 이미 설치된 dep이 이 코드를 대체할 수 있는가?" | 렌즈 ① or ③ |
| "이 패턴이 하위 스택에선 안티패턴이지만 이 스택/계층에선 관용적인가?" | 렌즈 ③ |

### 4단계 — SYNTHESIZE (결정론, 모델 판단 없음)

#### R2 — SYNTHESIZE는 결정론적이다

SYNTHESIZE는 모델이 아니라 **직접 손으로** 수행한다.
Opus arbiter가 winner를 고르지 않는다 — 그것은 "양측 표면화·사람 결정" 규칙과 모순된다.

1. **dedup**: 같은 `file:line`에 여러 finding → 강한 severity 우선, citation은 짧은 쪽
2. **dedup은 반대-verdict 쌍을 붕괴하지 않는다** — 두 lane이 반대 verdict를 낸 쌍이 곧 AXIS-CONFLICT 신호
3. **정렬**: severity(`MUST`→`SHOULD`→`NIT`) → file → line
4. **prescription 머지**: 여러 lens가 동일 finding에 다른 fix를 제안 → 양쪽 병기
5. **`vote_journal`** 추가: 강등된 finding, 강등 이유, 원래 severity
6. **`unresolved_disagreements`** 섹션 추가: AXIS-CONFLICT 쌍을 `{ side_a, side_b }` 형태로 노출, 사람이 결정

AXIS-CONFLICT 예시(DRY vs 결합도):
```
unresolved_disagreements:
  - axis_a: "L1: 동일 변환 로직 3곳 복제 → 공통 util로 추출 [SHOULD]"
    axis_b: "L2: 세 컴포넌트가 각기 다른 맥락에서 우연히 닮은 것 — 추출하면 결합도 상승 [NIT]"
    decision: 사람이 결정
```

두 lane의 반대 판단을 자동으로 합쳐 한쪽으로 결론 내리지 않는다.

---

## 수락된 저하 (accepted degradations)

| 잃는 것 | 완화 방법 |
|---|---|
| 저널(재개) | `REVIEW.md` 스크래치 + finding별 판결 기록; 재개 = 파일 읽고 스택 계속 |
| 스키마 강제 | `"Answer ONLY with this JSON"` + 앞-문 파싱·재시도 |
| 병렬 렌즈 실행 | 순차 실행 (리뷰는 컴파일-바운드가 아님; 보통 괜찮음) |
| 교차 모델 렌즈 | 렌즈 ①에 모델 전환 불가 → 신선 맥락 서브에이전트로 독립성 대체 |
| 비례 게이트 자동화 | `git diff --stat` 결과를 직접 읽어 tier 판단 (결정론 유지) |

---

## 4개 신뢰 불변식 — 포트 후에도 생존

1. **REVIEWER≠PROPOSER** — SECTION 서브에이전트가 finding을 제안하면 VOTE 서브에이전트는 별도 맥락이다. 같은 서브에이전트가 찾고 검증하지 않는다.
2. **diff 직접 읽기 후 판단** — 각 렌즈 skeptic은 반드시 git diff hunk를 직접 읽는다. 제안자의 산문만 보고 판결을 내리지 않는다.
3. **finding마다 독립 근거** — 각 finding은 3개 렌즈로 개별 검증된다. 배치로 묶어 한번에 "다 맞다"고 승인하지 않는다.
4. **전체 코드베이스 체크는 출력 게이트에서 1회** — 최종 출력 전, `grep`/`find`로 새로 노출된 API에 production caller가 있는지 확인한다(built-tested-unwired 결함 클래스). 이 체크는 SECTION이 아니라 SYNTHESIZE 후 게이트에서 한 번만 한다.
