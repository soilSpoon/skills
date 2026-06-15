# Reliability System — 청사진 (Blueprint)

> 상태: **승인됨 · 실행 중** — Phase 1(`reliability-kit`/`test-foundations` 0.1.0)·Phase 3(slice 1.11.0 testing-readiness 게이트) **ship 완료**; Phase 2(`spec-first`)·4(opencode 휴대) 대기. §10 로드맵 순서로 구현 중.
> 목적함수: **신뢰(trust)는 코드도 속도도 아닌, 제조되는 것** (Kent Beck, *Trust Factory*). 이 시스템은 그 제조 기계를 레포에 설치하고, 에이전트가 그 기계를 돌리게 한다.

---

## 1. 한 문장

> 모든 변경에 대해 **(a) 모호함을 먼저 줄이고 → (b) 신뢰할 만한 4계층 테스트 리그를 항상 갖추고 → (c) Canon-TDD로 한 스텝씩 만들고 → (d) 적대적으로 검증하고 → (e) 사고가 나면 그 본질을 테스트로 박제해 재발을 막는다** — 이것을 Claude Code·opencode 양쪽에서 도는 역할-분담 스킬 시스템으로 구현한다.

이건 새 철학이 아니라 **이미 `slice` 엔진이 구현한 Trust Factory의 빠진 앞단·게이트를 채우는 일**이다.

## 2. 근거 (읽은 자료 → 설계 결정)

| 자료 | 본질 | 이 시스템에서 |
|---|---|---|
| Beck, *Trust Factory* | XP 관행(테스트·CI·리팩토링·관찰가능성·작은 스텝)은 신뢰를 만들고 *동시에* 신뢰할 만하게 만든다. single-player AI는 신뢰 침식(지니는 prompt 만족 ≠ purpose 만족) | 목적함수. `purpose vs prompt` 검증(이미 slice에 있음)을 시스템 전역 불변식으로 |
| Beck, *Canon TDD* | test list → 한 테스트 → green → (옵션)refactor → 반복. 관심사 분리 | `spec-first`가 test list를 만들고, `slice-executor`가 한 스텝씩 소비 |
| Beck, *Design in TDD* | 설계는 refactor 스텝 + 새 테스트의 API 결정에 산다. "나무처럼 자란다" | executor의 structure hat. 선설계 금지, 점진 성장 |
| terriblesoftware, *what makes you senior* | 시니어 = **모호함 줄이기/de-risk**: fuzzy→concrete, 안 묻는 질문, now vs punt | `spec-first` 스킬의 핵심 (현재 시스템의 빠진 앞단) |
| luminousmen, *senior lessons* | 단순함 최우선, 문서화, **TDD 도그마 경계**, 규칙보다 판단 | scope floor + T0/T1/T2 ceremony 사다리 (이미 있음). 게이트는 도그마가 아니라 **신뢰 결손에 비례** |
| Ponytail | laziness 계층(= scope floor), 멀티 하네스 portable | 이미 일치. 휴대성 모델의 증거 |

핵심 해석: 사용자의 "**항상 신뢰성·품질 높은 E2E·품질·기능·유닛 테스트 도구를 세팅**하고, **사고의 본질을 테스트로 막는다**"는 곧 *Trust Factory의 기계를 레포에 설치하고 게이트로 강제*하는 것.

## 3. 상속하는 설계 원칙 (slice에서)

새 스킬은 아래를 **그대로 따른다** — 새 패러다임을 만들지 않는다.

1. **결정론적 제어 + 모델 판단** — 기계적으로 정할 수 있는 건 JS/shell(스캐폴드·verify·git), 판단만 모델.
2. **executor ≠ verifier** — 만든 주체가 "됐다"고 선언하지 못한다. anti-genie의 구조적 구현.
3. **per-leaf commit / 가역성** — 모든 신뢰 단위는 되돌릴 수 있는 한 커밋.
4. **Ceremony 사다리 (T0/T1/T2)** — 신뢰 결손에 비례한 *최소* 의식. 10줄 변경에 100k 토큰 엔진은 tier 오류.
5. **scope floor (= ponytail laziness)** — 가장 신뢰하기 쉬운 코드/테스트/도구는 *없는 것*. 단, 신뢰 경계 검증·데이터 손실·보안·a11y·**명시적으로 요청된 테스트**는 절대 생략 금지.
6. **휴대성** — SKILL.md + node/shell만. Claude-전용 API 금지. (slice가 opencode 어댑터로 이미 증명)
7. **판단은 사람에게** — 자율적 "무엇을 할지" 결정 AI 금지 (Trust Factory의 anti-genie). 라우팅은 *얇게*, 사람이 분기.
8. **신뢰성 = 품질 × 속도 (두 축 동시)** — 테스트의 신뢰성은 한 축이 아니다. **품질 신뢰성**(주장하는 걸 실제로 잡나) 과 **시간 신뢰성**(피드백이 쓸 수 있을 만큼 빨리 오나 = 납기·dev 속도). 둘은 상충하며 *둘 다 성립*해야 한다. 품질만 높고 느리면 아무도 안 돌려 시간 신뢰성이 0, 빨라도 fake-green이면 품질 신뢰성이 0. test-foundations(§5.1)의 1급 목적함수.

## 4. 역할 지도 (현재 + 신규, 경계 명시)

### 척추 (유지)
- **`slice`** — 신뢰 제조 엔진(baseline→slice→Canon TDD→verify→commit→integrate→briefing). 모든 변경의 오케스트레이터.

### 도메인 가이드 (유지, slice가 주입)
- **`code-fundamentals`** — 언어 불문 4축 + scope floor + operability.
- **`toss-frontend-fundamentals`** — FE 변경용이 + a11y + 토스 문화/평가.
- **`build-config-drift`** — 정적 통과 ↔ 런타임 침묵 깨짐 감사.
- **`issue-rootcause-workflow`** — 근본 원인(증상 아님) + **회귀 테스트로 재발 방지** (← recurrence의 본거지).

### 신규: `reliability-kit` 플러그인
| 스킬 | 역할 | 경계 (무엇이 *아닌가*) |
|---|---|---|
| **`test-foundations`** ⭐ | 신뢰할 만한 **4계층 테스트 리그**의 진단→스캐폴드→가이드. 단일 `verify` 엔트리. E2E 1급. | 코드 품질 *판단*은 code-fundamentals 몫. 근본원인 추적은 issue-rootcause 몫. 여긴 *리그와 그 신뢰성*만. |
| **`spec-first`** | fuzzy 요청 → 진짜 문제 + **낙오 불가능한 acceptance test-list** + now/punt 컷. | 구현·슬라이싱은 slice 몫. 여긴 *모호함 제거와 test list 생성*까지. |

### 프론트엔드 합성 (외부 참조)
- **`vercel-composition-patterns`** (컴포넌트 API 설계 / boolean prop 증식 방지 / compound·context) — **외부 설치**.
- **`vercel-react-best-practices`** (성능 70규칙: waterfall·bundle·server·rerender…) — **외부 설치**.
- 역할 분담: `toss-frontend`=변경용이+a11y+문화 · `vercel-composition`=API 설계 · `vercel-react-best`=성능. **겹치지 않음**. (설치 안내 §7)

> recurrence는 새 스킬을 만들지 않는다. **issue-rootcause(추적·본질) + test-foundations(회귀 테스트 작성 기계)**의 합으로 구현 — §6.4의 cross-plugin seam.

## 5. `reliability-kit` 스펙

### 5.1 `test-foundations` (비협상 게이트)

**트리거** — 새 레포/기능에 테스트 리그 부재, "테스트 어떻게 깔지", E2E/유닛/lint/CI 세팅, slice baseline 게이트, "이거 어떻게 검증하지".

**4계층 (모두 1급)**
| 계층 | 무엇 | 대표 도구(탐지·제안) |
|---|---|---|
| **L0 품질** | lint · format · type-check (변경 파일 우선) | eslint/biome · prettier/biome · tsc |
| **L1 유닛** | 순수 로직, 빠르고 결정론적 | vitest/jest/pytest/go test |
| **L2 기능/통합** | 모듈 경계·실제 의존(DB/HTTP) — fake 최소 | vitest+testcontainers · supertest |
| **L3 E2E** | 사용자 여정. *어떤 개발이든 결국 필요* | Playwright(기본) · Cypress |

#### 신뢰성 = 품질 × 속도 (두 축 모두 성립)
test-foundations는 한 축이 아니라 **두 축을 동시에** 최적화한다.
- **품질 신뢰성** — 테스트가 주장하는 걸 실제로 잡나: vacuous green·flake 없음, 타깃을 실제 exercise, purpose 검증(fake-green 아님).
- **시간 신뢰성** — 피드백이 *쓸 수 있을 만큼 빨리* 오나: 납기·dev 속도. 40분 스위트는 아무도 안 돌려 신뢰성이 증발한다.

**주 레버 = 계층 분포 (pyramid economics)** — 같은 동작을 *어느 계층*에서 검증하느냐가 두 축을 동시에 가른다. 전부 E2E = 품질 OK·시간 최악. 전부 무거운 mock 유닛 = 빠름·purpose 결손(anti-genie). 빠르고 결정론적인 건 아래로, 본질적으로 통합/여정인 것만 위로.

**언어·라이브러리 적응 (situational, 하드코딩 금지)** — "항상 Playwright+Vitest" 식 고정 금지. 진단이 스택·기존 컨벤션(레포 컨벤션 우선)·제약을 보고 *적합한 도구와 속도 기법*을 고른다. **`verify` 엔트리가 그 선택을 추상화** → 도구가 레포마다 달라도 slice/baseliner는 *한 계약*만 본다.

| 생태계 | 빠른 L0/L1 | L2/L3 | 시간 기법 |
|---|---|---|---|
| JS/TS | biome·vitest(esbuild) | testcontainers · Playwright | `tsc --incremental`, `vitest --changed`, PW 샤딩/워커 |
| Python | ruff·pytest | pytest+testcontainers · Playwright | pytest-xdist, `-k` 필터, markers |
| Go | `go vet`·`go test`(병렬 기본) | testcontainers-go · chromedp | `-run` 필터, `t.Parallel` |
| Rust | clippy·nextest | nextest+containers · … | cargo nextest, 모듈 필터 |
| 기타 | 진단이 관용 도구 탐지 | … | 생태계 관용 병렬·필터·캐시 |

**시간 신뢰성 기법 (1급)** — 변경분만(`verify --changed`) · 병렬/샤딩 · 계층 라우팅(L0/L1 저장 시, L2 push 시, L3 PR/CI) · 캐시(build·deps·test result) · test-impact 선택 · **flake 제거**(재시도는 시간+품질 이중 비용).

**품질 신뢰성 기법 (1급)** — 타깃 실제 exercise(vacuous 금지) · 결정론(시간/랜덤/네트워크 고정) · L2는 fake보다 real dep(purpose-fidelity) · 격리/teardown · a11y 셀렉터.

**신뢰성 목표(budget) — 측정 가능하게** — 진단이 두 축을 *수치로* 보고하고 목표 대비 평가: 변경분 피드백 시간 · 전체 스위트 시간 · flake율 · vacuous/purpose-gap 수. 목표값은 레포 규모·팀이 정하되 기본 제안 제공. (slice의 `coldBuildCost`·ETA·`purposeGap` 개념과 직결)

**흐름: 진단 → 스캐폴드 → 가이드** (사용자 결정 = 전부 함)
1. **진단** — 스택 탐지(언어·프레임워크·패키지 매니저·모노레포), 기존 리그/CI 유무, 어느 계층이 비었나. **두 축을 수치로 보고**: 계층별 wall-clock·flake율(시간 축) + purpose-fidelity·vacuous/커버리지 신호(품질 축). 적합 도구를 스택에 맞춰 *제안*.
2. **스캐폴드** — 빠진 계층의 러너·설정·CI 워크플로·**샘플 E2E**(스모크 1개)를 실제로 설치/작성. 단일 진입점 노출:
   - `verify` 엔트리 (예: `scripts/verify.sh [--filter <scope>] [--layer l0|l1|l2|l3]`) — slice baseliner의 `measureCommand`/`filterCommand`의 **실재 구현**.
   - `verify --changed` = 변경 파일만(속도). `verify` = 전체(integration 게이트).
3. **가이드** — 신뢰성 원칙(references): flake 제거, 결정론(시간·랜덤·네트워크 고정), 격리/teardown, **a11y 친화 셀렉터**(`getByRole`>`data-testid`>XPath), real-env purpose 검증, "테스트가 타깃을 실제로 exercise하나"(vacuous green 금지).

**slice와의 결합** — baseline phase의 **testing-readiness 게이트**: 리그가 없으면 작업 전에 `test-foundations` 스캐폴드를 강제. 이로써 "항상 테스트 세팅"이 *옵션이 아니라 구조*가 된다.

### 5.2 `spec-first` (모호함 → test list)

**트리거** — fuzzy/큰/애매한 요청, "이거 만들어줘"인데 스펙 불명, 인수 조건 필요, slice 진입 직전.

**프로토콜 (senior = de-risk)**
1. **진짜 문제 정의** — 원하는 *해법*이 아니라 *문제*. "안 묻는 질문"을 묻는다.
2. **사용자·고통 구체화** — 일반 "유저"가 아니라 누가/언제/무엇이 아픈가.
3. **숨은 가정 표면화 + downside risk 평가.**
4. **acceptance test-list** — 동작 변종을 *낙오 불가능한*(falsifiable)·결정론적 테스트 목록으로. (Canon TDD의 test list = 행동 분석, 구현 설계 섞지 않음)
5. **now vs punt 컷** — "이건 지금 / 이건 잘라낸다 / 이건 나중." fuzzy를 "작은 프로젝트 2개 + 잘라낼 것 1개"로.

**출력** — slice의 root 작업으로 넘기는 test-list + 컷. spec-first → slice → executor가 한 스텝씩 소비.

## 6. 오케스트레이션 (얇게, 사람이 분기)

### 6.1 front-door 라우팅 (판단은 사람)
작업 모양 → 진입점. 자율 AI 라우터 아님 — 사람이 고르되 표가 돕는다.

| 작업 모양 | 진입점 |
|---|---|
| fuzzy/큰/스펙 불명 | **`spec-first`** → slice |
| 진단된 1파일 수정 (T1) | 인라인 직접 |
| 코드 리뷰/개선 | `code-fundamentals` (+FE면 toss/vercel) |
| 버그/회귀 | `issue-rootcause` → (root fix면) slice |
| ≥2 risky/교차 변경 (T2) | **`slice`** |
| 테스트 리그 부재 | **`test-foundations`** (또는 slice 게이트가 자동 호출) |

### 6.2 slice baseline의 testing-readiness 게이트 (신규)
baseliner가 리그 부재를 감지하면 → `test-foundations` 스캐폴드를 작업 전에 실행 → `verify` 엔트리를 `measureCommand`/`filterCommand`로 채택. **소프트 모델 호출이 게이트를 굶길 수 없다**(결정론).

### 6.3 selection 테이블 확장 (slice SKILL §4)
| lane이 닿으면 | 추가 |
|---|---|
| 모든 출하 코드 (기본) | `code-fundamentals` **+ `test-foundations`** |
| fuzzy 진입 | `spec-first` (front) |
| React/Next UI | `toss-frontend-fundamentals` **+ (설치 시) `vercel-composition-patterns`·`vercel-react-best-practices`** |
| build/deps/workspace | `build-config-drift` |
| 버그/회귀 | `issue-rootcause-workflow` |

### 6.4 recurrence 루프 (cross-plugin seam)
탈출한 버그 발생 → `issue-rootcause`(본질·invariant) → **본질을 재현하는 회귀 테스트**를 `test-foundations`의 적합 계층(보통 L1/L2)에 추가 → guardrail(타입/lint/CI)로 승격 → per-leaf commit. "버그는 반드시 돌아온다"(Beck)에 대한 구조적 답.

## 7. 프론트엔드 합성 (외부 설치 참조)
Vercel 스킬은 **벤더링하지 않는다**. 설치 안내 + 역할 분담만 문서화하고, slice 선택표는 "설치돼 있으면" 전제로 부른다.

- 출처: `vercel-labs/agent-skills` (`skills/composition-patterns`, `skills/react-best-practices`).
- 설치(예): 해당 SKILL.md를 `~/.claude/skills/`에 두거나 plugin marketplace로 추가. (정확한 설치 절차는 Phase 3에서 README에 명문화)
- 미설치 시 graceful degrade: slice는 toss-frontend만으로 진행, 선택표가 조용히 건너뜀.

## 8. 휴대성 (Claude Code / opencode)
- 신규 스킬 = 평범한 SKILL.md + references + node/shell 스캐폴드. Claude-전용 API 없음.
- `verify` 엔트리는 셸 스크립트 → 어느 하네스에서도 동일.
- slice는 이미 `adapters/opencode/` + `portable-orchestration.md` 보유 → 게이트/선택표 확장은 양쪽에 그대로 반영.

## 9. 끝에서 끝까지 루프

```
① spec-first      fuzzy → 문제정의 + acceptance test-list + now/punt        (senior + Canon list)
② baseline+GATE   invariant 고정. 리그 없으면 → test-foundations 스캐폴드(4계층)  ← 비협상 게이트
③ slice + TDD     leaf마다 실패테스트 먼저→green→refactor, per-leaf commit, 가이드 주입
④ verify          executor≠verifier, purpose vs prompt, filtered(verify --changed)+full(verify) 게이트
⑤ integrate+brief 전체 verify + Owner's Briefing + follow-ups→BACKLOG
⑥ incident→test   탈출 버그 → issue-rootcause(본질) → test-foundations 회귀테스트 + guardrail (재발 불가)
```

## 10. 로드맵 (비협상 항목 먼저)

| Phase | 산출물 | 버전 | 게이트(완료 정의) |
|---|---|---|---|
| **0** | 이 청사진 승인 | — | 사용자 OK |
| **1** ✅ | `reliability-kit` 플러그인 + `test-foundations` (진단·스캐폴드·가이드·`verify` 엔트리, 4계층, E2E 1급, **2축 신뢰성 + 언어 적응**). 자체 evals/fixtures. | **reliability-kit 0.1.0 ship** | ✅ node·python fixture에서 verify green + 2축 리포트 (적대적 검증, 2 blocking 수정 후) |
| **2** | `spec-first` 스킬 (모호함 제거 프로토콜 + acceptance test-list 출력) | 0.2.0 | fuzzy 요청 1건 → test-list+컷 산출 데모 |
| **3** ✅ | slice 통합: baseline **testing-readiness 게이트**(rigPresent fail-closed) + selection 테이블 확장 + recurrence seam + Vercel 외부설치 README | **slice 1.11.0 ship** | ✅ rigPresent:false 시 작업 전 halt(no leaf/lock), confirmNoRig 탈출 (테스트 60/60, 적대적 검증 SAFE) |
| **4** | 휴대성: opencode 어댑터에 게이트/`verify` 반영 + portable-orchestration 갱신 | patch | opencode 경로에서 동일 동작 확인 |

각 Phase는 **독립적으로 출하 가능**(slice의 vertical slice 원칙). Phase 1이 사용자의 "꼭 해줘야 하는" 비협상 항목이라 최우선.

## 11. 비목표 (Non-goals) / 리스크
- **자율 task-picking AI 금지** — 무엇을 할지는 사람이 분기(Trust Factory anti-genie). 라우팅은 얇은 표.
- **TDD 도그마 금지** — 게이트는 신뢰 결손에 비례(T0/T1/T2). 10줄 변경에 E2E 강제 안 함. (luminousmen)
- **Vercel 벤더링 안 함** — 외부 설치 참조(결정). 라이선스/업스트림 표류 회피.
- **스캐폴드 위험** — 사용자 레포에 파일/의존성 설치 = outward 행위. 항상 진단·제안을 *먼저 보여주고* 동의 후 설치. 기존 설정 덮어쓰기 금지(있으면 surface).
- **리그 위양성** — 느린/flaky 리그를 "있으니 OK"로 통과시키지 않기. 진단이 속도·flake 부채를 보고.

---

### 부록: 신규 레포 구조 (Phase 1~2 후 예상)
```
plugins/reliability-kit/.claude-plugin/plugin.json        # 0.1.0 → 0.2.0
plugins/reliability-kit/skills/{test-foundations,spec-first} → ../../skills/...
skills/test-foundations/{SKILL.md, references/{e2e,unit,quality,flake,real-env}.md, scripts/{detect,scaffold,verify}.*, evals/}
skills/spec-first/{SKILL.md, references/{protocol,test-list,examples}.md}
docs/reliability-system.md                                 # 이 문서
.claude-plugin/marketplace.json                            # reliability-kit 등록 추가
```
