---
name: test-foundations
description: 신뢰할 만한 4계층 테스트 리그(L0 품질·L1 유닛·L2 기능/통합·L3 E2E)를 진단→스캐폴드→가이드한다 — 신뢰성 = 품질 × 속도 두 축을 동시에. 언어·라이브러리 적응(JS/TS·Python·Go·Rust + 탐지로 확장), 단일 `verify` 엔트리가 도구 선택을 추상화해 slice baseliner의 measureCommand/filterCommand로 채택된다. 트리거 - (1) 새 레포/기능에 테스트 리그 부재, "테스트 어떻게 깔지"·"테스트 세팅"·"E2E/유닛/lint/CI 세팅", (2) "이거 어떻게 검증하지"·"verify 엔트리"·"테스트 스캐폴드", (3) slice baseline의 testing-readiness 게이트(리그 없으면 작업 전 강제), (4) 느리거나 flaky 한 리그 진단·계층 분포(pyramid) 재조정·변경분 피드백 가속, (5) issue-rootcause 가 찾은 invariant 를 회귀 테스트로 박제(recurrence seam). E2E 1급 — 단, scope-floor: *관련 계층만* 항상, E2E 는 *사용자 여정이 있을 때만*(전부-항상 아님). 코드 품질 *판단*은 code-fundamentals, FE a11y 셀렉터·E2E 셀렉터는 toss-frontend-fundamentals, 근본원인 추적은 issue-rootcause 몫 — 여긴 *리그와 그 신뢰성*만.
---

# Test Foundations — 신뢰할 만한 4계층 테스트 리그 (품질 × 속도)

모든 변경에 **신뢰할 만한 4계층 테스트 리그를 항상 갖춘다** — 단, '항상'은
*전부-everything*이 아니라 *관련 계층 always*다 (scope-floor). 목적함수는 하나다:

> **신뢰성 = 품질 × 속도. 두 축을 *동시에*.**

품질만 높고 느리면 아무도 안 돌려서 시간 신뢰성이 0이 되고(40분 스위트 = 사실상 없는 스위트),
빨라도 fake-green이면 품질 신뢰성이 0이다(통과하는데 아무것도 검증 안 함). 어느 한 축이
0이면 곱은 0 — 둘 중 하나만 챙긴 리그는 신뢰할 수 없다.

이 스킬은 **리그와 그 신뢰성**만 소유한다. 코드 품질 *판단*(code-fundamentals), 근본원인
*추적*(issue-rootcause), FE 셀렉터·a11y *선택*(toss-frontend)과는 겹치지 않는다 — `## 분담`
참조. 비협상 게이트: slice baseline이 리그 부재를 감지하면 작업 *전에* 이 스킬을 강제 호출한다.

> ⚠️ **로드 규율** — `references/*.md`는 **필요할 때만** 연다. 트리거 맵에서 패턴이 매칭됐을
> 때 1-2개씩만. 본문 + 트리거 맵으로 충분한 경우가 대부분이다. 권위는 항상 blueprint —
> 이 SKILL.md는 그 압축이고, 깊이는 references가 진다.

## 2축 모델 — 품질 × 속도 (계층 분포가 주 레버)

4계층 × 2축. 각 계층은 하나의 **(품질, 속도) 트레이드 지점**이다. 두 축을 동시에 움직이는
주 레버는 **같은 동작을 *어느 계층*에서 검증하느냐**다 — pyramid economics.

| 계층 | Purpose | 품질 축 역할 | 속도 축 역할 | 언제 도나 |
|---|---|---|---|---|
| **L0 품질**<br/>lint·format·type | 테스트 한 판 돌리기 전에 결함 차단 (formatter+linter+type-checker) | 구조적 정합성 바닥 — 타입이 불가능한 상태를 표현 불가능하게(operability 상속); 가장 싼 fraud 저항 | 가장 싼 계층 — **변경 파일만** 스코프(sub-second '빠른 문'); 전체 lint는 통합 그물 몫 | 매 저장 / pre-commit, staged/changed 파일만 |
| **L1 유닛**<br/>pure logic | 순수 로직·invariant 를 격리 검증 | 변경된 줄을 *실제로* exercise(vacuous green 금지); 결정론(시간·랜덤·네트워크 고정); 단언이 invariant 를 명명 | fast + parallel(`-n auto`/`--partition`); native-affected(vitest `--changed`, go cache)가 공짜면 사용 | 매 저장 / pre-commit, affected 테스트만 |
| **L2 기능/통합**<br/>module seams | 모듈 경계를 **실제 의존성**에 검증(Testcontainers Postgres/Redis/Kafka, supertest/httpx) | purpose-fidelity — 실제 dep이 mock이 숨기는 걸 잡는다; **purposeGap이 가장 load-bearing**(real dep ✓ vs mock); 매 실행 fresh isolated 컨테이너 | 느림(컨테이너 spin-up) — push에서 돌고 build-tag/marker로 게이트해 빠른 문에 세금 안 매김; `--changed`는 통합-bearing 경로 변경일 때만 L2 포함 | push 시 (그리고 통합 경로 변경일 때만 `--changed`에 포함) |
| **L3 E2E**<br/>user journeys | end-to-end 사용자 여정 검증(Playwright 기본 / 비웹은 native CLI+HTTP harness) | 최고 purpose-fidelity(진짜 사용자 경로가 도나); purposeGap이 live-API ✓ vs local-stub 구분; `inProcessVerifiable=false` | 가장 느림 — 그 '40분 스위트 아무도 안 돌림' 리스크; shard/parallel; **PR/CI에서만**; `--changed`에서 e2e/ 또는 여정 경로 안 건드리면 SKIP | PR / CI 에서만. **scope-floor 게이트**: 사용자 여정이 *실제로 존재할 때만* — 전 변경에 자동 강제 아님 |

**주 레버 = 계층 분포(pyramid economics).** 같은 동작을 *어느 계층*에서 검증하느냐가 두 축을
동시에 가른다:

- 전부 E2E → 품질은 OK지만 시간 최악(느리고 flaky).
- 전부 무거운 mock 유닛 → 빠르지만 purpose 결손(anti-genie — prompt는 통과, purpose는 미검증).

**원칙**: 빠르고 결정론적인 건 *아래로*, 본질적으로 통합/여정인 것만 *위로*. 깊이는
[layers.md](references/layers.md). 속도 기법(변경분만·병렬/샤딩·계층 라우팅·캐시·test-impact·flake
제거)은 [speed.md](references/speed.md), 품질 기법(실제 exercise·결정론·real dep at L2·격리/teardown)은
[quality.md](references/quality.md)에서 교차 생태계로.

## 0. 범위 바닥 (scope floor) — 계층 선택보다 먼저

code-fundamentals의 §범위 바닥을 *상속*한다 — 문서화가 아니라 **reflex**. 계층 결정은 항상
'이 테스트가 *필요한가*?'로 시작한다. 가장 신뢰하기 쉬운 테스트는 **없어도 되는 테스트가
아니라, 꼭 있어야 할 자리에 있는 테스트**다.

**계층 결정 트리** (첫 번째로 통과하는 데서 멈춤):

- **Q1. 순수 로직 + invariant 가 있나?** → L1 유닛. (단, trivial map/filter처럼 stdlib가 이미
  보장하는 건 skip — test-speculation은 speculation-turned-code와 같은 낭비다.)
- **Q2. 상태기계/상호작용 전이인가?** → L2 / component.
- **Q3. 사용자 여정이 존재하나?**(login→profile→payment) → L3 E2E. (내부 레이아웃 변경·
  라이브러리 표면 API는 여정이 아니므로 E2E 불필요.)

각 계층 **pre-flight 3단**(code-fundamentals §범위 바닥 상속):

1. **stdlib 단언으로 되나?** → 새 인프라 안 만든다.
2. **기존 테스트 인프라가 푸나?** → 그걸 쓴다(러너·fixture 중복 생성 금지).
3. **새 테스트라면 — invariant 를 박제하나, 코드만 덮나?** → invariant 를 명명하는 단언을 쓴다.

**E2E 1급의 진짜 의미** ([layers.md §4](references/layers.md)): '어떤 개발이든 결국 E2E가
필요'는 *사용자 여정이 생기면* 필요하다는 뜻이지, *모든 PR에 강제*가 아니다. 10줄 변경에 E2E를
강제하지 않는다(`## 주의 / 비목표`). 게이트는 신뢰 결손에 비례(T0/T1/T2)하지 교리가 아니다.

> **구체 예 (오독 방지)** — E2E는 `login → settings → save` 처럼 **여러 화면을 가로지르는
> 사용자 여정이 실제로 존재할 때만** 만든다. 반대로 **E2E를 만들지 *않는* 경우**: 버튼 색·여백
> 같은 *레이아웃 변경*, *10줄짜리 로직 수정*, 외부에 노출되는 *라이브러리 surface API*(여정이 아니라
> 함수 계약 — L1/L2로 충분), 내부 리팩터링. 즉 "E2E 1급"은 *여정이 있으면 1급으로 다룬다*는 뜻이지
> *모든 변경에 E2E를 얹는다*는 뜻이 절대 아니다 — over-testing(전부 E2E)도, under-testing(여정인데
> E2E 생략)도 둘 다 신뢰성을 깎는다.

## 흐름: 진단 → 스캐폴드 → 가이드 (사용자 결정 = 전부 함)

세 단계를 모두 수행한다(full).

**① 진단 (diagnose) — 자동·읽기 전용.** 스택 탐지(언어·프레임워크·패키지매니저·모노레포·기존
러너) + 어느 계층이 비었나 + **두 축을 수치로**. `verify.sh --json`이 계층별 NDJSON 한 줄씩 +
4개 budget 수치(`changedFeedbackMs`·`fullSuiteMs`·`flakeRatePct`·`purposeGapCount`)를 담은
aggregate 한 줄을 낸다(스크립트가 emit하는 것은 *딱 이것* — 별도 preamble은 없다). Claude가 이
리포트를 스택 탐지 결과와 합쳐 slice 프로젝트 카드 해석을 *구성*한다(stack/proposals 해석은 Claude의
종합이지 스크립트 출력이 아니다). 계층별 wall-clock(속도) · flake율 · purpose-fidelity(품질)를
측정하고, **빠진 계층은 `present:false`로 보고**(false green 금지). 적합 도구는 스택에 맞춰
*제안*하되 **설치 전 동의**를 받는다.

> **주의** — 빈 계층은 *측정된 사실*이지 통과가 아니다. 느리거나 flaky한 리그를 '있으니 OK'로
> 통과시키지 않는다 — 부채를 수치로 보고한다(rig 위양성 금지, `## 주의 / 비목표`).

**② 스캐폴드 (scaffold) — Claude 주도(별도 스크립트 아님).** 빠진 계층의 러너·설정·CI·샘플
E2E(스모크 1개)를 *Claude가 이 스킬에 따라* 실제 설치하고(`scaffold.sh` 같은 자동 스크립트는 없다 —
`scripts/verify.sh`/`verify.detect.sh`가 산출물이자 템플릿), 단일 `scripts/verify.sh` 엔트리를 노출한다. **native-runner-first**: 레포에 `mise`/`just`/`make`/
package.json scripts가 있으면 verify 태스크를 *그쪽*에 쓰고 verify.sh가 거기로 shell-in한다(팀이
이미 신뢰하는 idiom 존중); 없으면 verify.sh가 네이티브 도구를 직접 호출한다. 기존 설정은
*덮어쓰지 않는다* — 있으면 surface하고 멈춘다.

**③ 가이드 (guide).** references를 *필요할 때만* 로드해 계층별 품질·속도 기법을 안내한다.

깊이: 스캐폴드 산출물과 진단 스키마는 [verify-contract.md](references/verify-contract.md),
생태계별 도구 선택은 [ecosystems.md](references/ecosystems.md).

## verify 엔트리 계약 (slice 와의 결합점)

리그 전체를 단일 owned 계약 뒤에 추상화한다. **도구 선택은 `verify.detect.sh` 데이터 테이블에
산다 — slice는 *한 계약*만 본다.** 아래는 AS-BUILT `scripts/verify.sh` 그대로다.

```
scripts/verify.sh [--layer l0|l1|l2|l3|all] [--changed] [--scope NAME] [--filter NAME] \
                  [--json] [--base REF] [--list-scopes] [--print-setup] [-h|--help]
```

`set -euo pipefail`, `chmod +x`, 형제 `scripts/verify.detect.sh`(데이터 테이블)를 source한다.
플래그는 **순서 무관·positional-free**이고 `--flag VALUE` / `--flag=VALUE` 둘 다 받는다.

**플래그 의미**

- `--layer l0|l1|l2|l3|all` (기본 `all`). `all`은 L0→L1→L2→L3 오름차순으로 돌고, **human
  모드에선 첫 RED에서 SHORT-CIRCUIT**(lint 실패가 E2E 값을 치르지 않게). `--json`은
  short-circuit을 **끈다**(diagnose budget을 위해 4계층 전부 측정).
- `--scope NAME` (= `--filter NAME`, **EXACT alias**). NAME을 러너 name 필터로 **verbatim
  포워드**(pytest `-k` / vitest `-t` / go `-run` / nextest `-E 'test(/NAME/)'`). **{scope}는 항상
  bare 토큰** — 엔진 가드 `recursive-slice.js:611`의 `/^[A-Za-z0-9_.-]+$/`가 슬래시/공백/경로를
  애초에 막으므로, 스크립트는 path 처리를 *하지 않는다*. **스캐폴드는 executor가 테스트 *NAME
  안에* {scope}를 넣게 지시**(`recursive-slice.js:299`)해야 name 매치가 진짜가 된다.
  `--scope ∩ --changed` 합성 가능.
- `--changed` — git-only/portable(Nx/Turbo 의존 없음). base = `merge-base origin/HEAD HEAD` ||
  `origin/main` || `HEAD~1` || working-tree fallback. `--base REF`로 override. base 해소 불가 시
  working-tree fallback + JSON `"baseFallback":true`.
- `--list-scopes` — 합법 bare {scope} 토큰을 한 줄에 하나씩(L1 러너 dry-list). baseliner가 scope를
  *채택 전 검증*해 silent zero-match 함정(`recursive-slice.js:621`)을 피한다.
- `--print-setup` — per-stack worktree setup 커맨드 출력(npm install / pnpm install
  --frozen-lockfile / npm ci / pip install -e . / uv sync / go mod download / cargo fetch).
- `--json` — stdout으로 NDJSON(human 출력 억제; 도구 출력 → `.verify/logs/<layer>.log`).
- `-h|--help` — usage + DETECTED STACK + per-layer tool/mode 매핑 + coldBuildCost + setup 커맨드,
  exit 0.

**exit 코드** (엔진은 0 vs non-zero만 보지만, finer 코드는 DIAGNOSE·사람 몫):

| 코드 | 의미 |
|---|---|
| **0 GREEN** | 요청 계층 모두 통과 (absent 계층 `present:false`는 non-RED로 카운트 — 부재는 false green 아님) |
| **1 RED** | present 계층 ≥1 실패 (엔진 per-leaf 게이트가 분기하는 신호) |
| **2** | usage error **또는** `--scope`가 ZERO 테스트 매치 (contract gap, true RED 아님 — 엔진은 `recursive-slice.js:621`에서 그 leaf를 llm-only로 graceful degrade) |
| **3** | infra/precondition 실패 (present L2/L3의 Docker down) — CI가 코드 아닌 인프라를 재시도하게 |

**Precedence**: `infra(3) > red(1) > zero-match(2)`. 실제 RED는 동시 발생한 zero-match를
누른다.

> **주의** — pytest/vitest/go가 'no tests collected'에 기본 exit 0을 내면, verify.sh가 *직접*
> exit 2로 변환한다(per-runner author-time 가드). Docker down은 L2를 green skip 시키지 않고 exit
> 3이다 — fail-loud-on-infra.

**NDJSON shape** (downstream 저자가 파싱할 정확한 모양):

per-layer (l0..l3, 각 끝날 때마다 streamed):

```json
{"layer":"l1","tool":"node:test","present":true,"passed":true,"durationMs":254,"flake":false,"flakeRuns":1,"tests":{"run":2},"scope":null,"changed":false,"affected":false,"purposeGap":null,"zeroMatch":0,"exit":0,"log":".../.verify/logs/l1.log"}
```

- absent 계층은 `present:false`(passed:null, durationMs:null, tool:"").
- **L2 absent** → `purposeGap:"L2 absent — module seams unverified against real deps"`.
- **L3 absent** → `purposeGap:"no user journey wired — E2E deferred by scope-floor (not a gap if no journey)"`.
- Docker-down L2/L3 → `present:true, passed:false, exit:3`, purposeGap이 인프라 gap 기술.

aggregate (마지막 줄, **mandated 4개 budget 숫자**):

```json
{"summary":true,"passed":true,"layers":["l0","l1","l2","l3"],"changedFeedbackMs":147,"fullSuiteMs":147,"flakeRatePct":0.0,"purposeGapCount":2,"redLayers":[],"zeroMatch":0,"infra":0,"base":null,"baseFallback":false,"exit":0}
```

- `changedFeedbackMs` = L0+L1 누적 ms(빠른 문). `fullSuiteMs` = 모든 present 계층 ms 합.
- `flakeRatePct` = flakyLayers/presentLayers × 100. `purposeGapCount` = non-null purposeGap 개수
  (absent L2/L3 각 1 기여).

**slice 결합** — 엔진은 `filterCommand.replace('{scope}', token)` 후 `cd ${repo} &&
scripts/verify.sh --scope <token>`를 verbatim 실행한다:

- `measureCommand = "scripts/verify.sh"` — merge/integrate full-suite, tidy 게이트.
- `filterCommand = "scripts/verify.sh --scope {scope}"` — 결정론적 per-leaf T0 게이트.
- 계층-narrowed leaf 게이트 = `"scripts/verify.sh --scope {scope} --layer l1"`.

**아키텍처** — per-stack 도구 선택은 *전부* `verify.detect.sh`에 산다(manifest map +
`STACK LAYER → "KIND|TOOL|MODE"` 테이블 + native-runner-first delegation). verify.sh의 4개 계층
함수는 generic하고 MODE로 switch한다. **생태계 추가 = manifest 1행 + 테이블 4행 + dispatch 4
브랜치** — 슬라이스 계약(flags/exit/NDJSON)은 절대 안 바뀐다. 전체 계약과 baseliner 필드 도출은
[verify-contract.md](references/verify-contract.md).

## 생태계별 도구 표 (탐지→매핑, 하드코딩 금지)

각 표: L0(formatter+linter+type-checker) / L1(fast unit + parallel flag) / L2(testcontainers
binding) / L3(Playwright or native harness) / 속도 기법. **2026 기본값과 *override 트리거*를 함께**
— diagnose는 *제안*하지 *강제*하지 않는다. 깊이는 [ecosystems.md](references/ecosystems.md).

- **JS/TS** — L0: Biome(신규 기본, lint+format) **+ tsc --noEmit**(Biome은 type-check 안 함);
  *override*: MATURE/React-Native/보안 플러그인 多 → ESLint+Prettier+typescript-eslint 유지.
  L1: Vitest(Jest는 RN 한정). L2: Vitest + testcontainers / supertest. L3: Playwright(셀렉터는
  toss-frontend로 defer).
- **Python** — L0: Ruff(lint AND format) **+ mypy/pyright** authoritative; *override*: Astral
  `ty`는 GA 전까지 opt-in/fast-feedback만. L1: pytest(+xdist `-n auto`). L2: testcontainers-python,
  `-m integration` marker 뒤. L3: Playwright(Python) / httpx·subprocess.
- **Go** — L0: gofmt(또는 gofumpt) + go vet + golangci-lint. L1: `go test -race ./...`(동시성엔
  **항상 -race**) + testify, gotestsum wrap. L2: testcontainers-go, `//go:build integration` tag.
  L3: 컴파일된 바이너리 구동(os/exec) + httptest.
- **Rust** — L0: cargo fmt + `cargo clippy -- -D warnings`. L1: `cargo nextest run`(process-per-test
  isolation) — **단, nextest는 doctest 안 돌림, `cargo test --doc` 유지**. L2: testcontainers-rs,
  feature/tag-gated. L3: assert_cmd / reqwest + spawned server.

**미지의 스택은 DETECT-then-MAP** — 같은 4 질문으로 매핑한다: 관용 formatter+linter+type-checker /
fast unit runner+parallel / Testcontainers 바인딩(10+ 언어) 또는 docker-compose / Playwright(멀티
바인딩)+native CLI/API harness. manifest/lockfile로 탐지(*.csproj/.NET, pom.xml|build.gradle/JVM,
Gemfile/Ruby), **레포 *자체* build/test 명령을 먼저 학습**한 뒤 `scripts/verify.sh` 뒤에 wire한다 —
슬라이스 계약은 변하지 않는다.

## 분담 (seams) — 무엇이 *아닌가*

각 lane은 자기 references만 보고, 교차는 dedup만 한다. **권위는 blueprint** — 아래 표는 그 압축이다.

| 스킬 | test-foundations가 **소유** | 그쪽에 **defer** |
|---|---|---|
| **code-fundamentals** | 테스트 *리그*(어느 계층·구조·언제·verify 엔트리·2축 신뢰성); scope-floor reflex + operability를 *테스트 설계에* 적용(단언이 invariant 명명) | 코드 품질 *판단*(가독성·예측가능성·응집도·결합도)과 scope-floor 자체. 프로덕션 코드 리뷰는 안 한다 — 리그를 짓고 채점한다 |
| **toss-frontend-fundamentals** | E2E *프레임워크 + 타이밍 + CI hooks + 샤딩 + 여정 구성 + 언제-E2E-도나* | FE 테스트 *내용*: a11y 셀렉터 선택(getByRole > getByLabelText > data-testid > XPath), a11y 검증 방법, React-runtime 패턴. [real-env.md](references/real-env.md)는 a11y-basics §테스트로 접근성 강제하기로 **link만, excerpt 금지** |
| **issue-rootcause-workflow** | 발견된 invariant를 *가장 싸게 잡는 계층(보통 L1/L2)의* failing-then-green 회귀 테스트로 박제하고, 2차 발생 시 guardrail로 escalate (recurrence seam) | 근본원인 *발견*: invariant 명문화, workaround-vs-root-fix, A/B 도달 검증, 'find the essence'. 버그를 진단하지 않는다 — handoff 템플릿으로 invariant를 *받아* 박제한다 |
| **spec-first** | acceptance test-list가 *도는* 4계층 리그, 각 acceptance item을 계층에 매핑 | ambiguity 제거 + falsifiable acceptance test-list 생성(WHAT-to-test). 여긴 HOW/WHERE-it-runs |
| **slice (엔진)** | measureCommand + filterCommand의 *실재 구현*인 verify 엔트리, coldBuildCost/purposeCheck/inProcessVerifiable/worktreeSetupCommand를 채우는 diagnose 리포트 | orchestration(baseline→slice→TDD→verify→commit→integrate)과 testing-readiness *게이트*. 엔진이 {scope}를 substitute해 verbatim 실행하므로 `/^[A-Za-z0-9_.-]+$/` bare-token 제약과 exitCode 0-vs-nonzero 게이트를 honor해야 한다 |

recurrence seam 깊이는 [recurrence.md](references/recurrence.md).

## operability 를 테스트 설계에 (code-fundamentals §진단 가능성 상속)

테스트도 나중에 *런타임에서* 다시 읽힌다 — 빨간 줄·CI 로그를 통해. 진단 가능성은 테스트에도
적용된다.

- **원칙: fail-loud 단언은 invariant 를 명명한다.**

  ```
  # Before  — 무엇이 깨졌는지 미스터리
  assert len(selected) == len(rendered)

  # After   — invariant 가 메시지에 박혀 있음
  assert len(selected) == len(rendered), \
      f"invariant: selected count == rendered checkboxes; expected {len(rendered)} got {len(selected)}"
  ```

  **왜** — 실패 한 줄로 *어떤 계약*이 깨졌는지 즉시 보인다. `expected 5 got 3`만 있으면 다음
  사람이 코드를 역추적해야 한다(가장 비싼 읽기).

- **원칙: 테스트당 한 변수(binary swap).** 한 테스트가 5개를 동시에 흔들면 빨개져도 *무엇이*
  원인인지 모른다. 격리는 trace-식별 가능성의 전제다.
- **원칙: trace-식별 가능한 실패.** *어느 사용자 여정*이 *왜* 깨졌나가 보이게 — `test #234
  failed` 미스터리 금지.
- **원칙: 불가능한 테스트 상태를 표현 불가능하게.** fixture가 invalid 조합을 *애초에* 못
  만들게 막으면 버그가 경계에서 드러난다.
- **원칙: 결정론 바닥.** 시간·랜덤·네트워크 고정. **L1에 live network 금지**(L2에서만). 깊이는
  [quality.md §2](references/quality.md), flake 처리는 [flake.md](references/flake.md).

## 빠른 트리거 맵 + 워크플로 + 체크리스트

**트리거 맵 (증상 → references):**

| 증상 | 가는 곳 |
|---|---|
| 느린 스위트(40분, 아무도 안 돌림) | [speed.md](references/speed.md) |
| flaky(빨개졌다 초록됐다) | [flake.md](references/flake.md) |
| mock-만-유닛(real DB 안 침) | [real-env.md](references/real-env.md) |
| E2E 셀렉터(getByRole vs data-testid) | toss-frontend로 **defer** |
| 회귀(같은 버그 재발) | issue-rootcause + [recurrence.md](references/recurrence.md) → L1/L2 회귀 테스트 |
| 어느 계층에 둘지 모름 | [layers.md](references/layers.md) (결정 트리) |

**워크플로** — A. 진단 모드(스택 탐지 + 2축 수치 리포트, 제안만) / B. 스캐폴드 모드(동의 후
설치, native-runner-first) / C. 가이드 모드(references on demand).

**체크리스트:**

- `[MUST]` 모든 present 계층이 `verify.sh`로 green · purposeGap 측정(fake-green 아님) · flake
  숨김 금지(retry로 가리지 않음) · zero-match = contract gap(exit 2, RED 아님) · absent 계층
  `present:false`(false green 금지) · 스캐폴드는 propose-then-confirm
- `[SHOULD]` 변경분 라우팅(`--changed`) · 결정론 고정(시간·랜덤·네트워크) · L2에 real dep ·
  단언이 invariant 명명 · a11y 셀렉터는 toss-frontend로 defer
- `[NIT]` 계층 분포가 pyramid에 가까운가(전부-E2E/전부-mock 회피)

로드 규율: references는 필요할 때만 1-2개.

## 주의 / 비목표

- **교리가 아니다** — 신뢰 결손에 비례(T0/T1/T2). "가이드가 그렇게 해서"가 아니라 "이 변경에 왜
  이 계층이 필요한가"로 설득한다.
- **scope-floor: '항상'은 '관련 계층 always'지 '전부-항상'이 아니다.** L0은 사실상 항상 관련(거의
  공짜); L1은 순수 로직+invariant가 있을 때; L2는 모듈 seam이 *실제 dep*을 만날 때만; **L3 E2E는
  *사용자 여정이 있을 때만* — journey-gated, PR-gated 아님.** 10줄 변경·내부 레이아웃·라이브러리
  표면 API에 E2E를 강제하지 *않는다*. 여정이 없는 레포의 L3 부재는 `purposeFidelity:journey-gated`
  로 보고(debt 아님); 반면 real DB를 mock으로 치는 레포의 L2 부재는 quality gap으로 보고한다. 이게
  '여정 존재' 테스트를 유일한 게이트로 만드는 이유다 — '항상 E2E 추가'(over-testing)도, 'E2E
  optional'(under-testing)도 아니다.
- **바닥은 절대 생략 금지** — 신뢰 경계 입력 검증, 데이터 손실 방지 단언, 보안, a11y, *명시적으로
  요청된* 테스트는 안 뺀다. 동시에, vacuous한 계층을 *지어내지도* 않는다 — 느리고 flaky한
  over-built 리그는 그 자체가 신뢰성을 깎는 위양성이다.
- **스캐폴드 = outward 행위** — 항상 진단·제안을 *먼저 보여주고* 동의 후 설치. 기존 설정(justfile,
  mise.toml, .eslintrc 등)을 덮어쓰지 않는다 — 있으면 surface. native-runner-first 선호가 기존
  러너를 clobber하지 않게 한다.
- **리그 위양성 금지** — 느린/flaky를 '있으니 OK'로 통과시키지 않는다. 부채를 수치로 보고한다.
- **purposeGap은 휴리스틱이지 증명이 아니다** — 'Testcontainers 있음 vs mock 있음'은 보지만, L3가
  live API를 쳤는지 그럴듯한 stub를 쳤는지는 증명 못 한다. verifier에게 *먹이는 신호*로 프레임하지
  보증으로 over-claim하지 않는다.
- **자율 task-picking 금지.** 받은 일을 한다 — 빠진 게 보여도 *제기*해 확인받지 조용히 추가하지
  않는다.
- **포터빌리티** — SKILL.md + references + bash/git 스크립트만. Claude-only API 없음 — verify
  엔트리는 opencode에서도 동일하게 동작한다.
- **스크립트 위생 (CI)** — `shellcheck -S error scripts/verify.sh scripts/verify.detect.sh` 를 CI에
  건다(작성 환경에 shellcheck 부재 시 최소 `bash -n` 으로 파싱 검증). 이 두 스크립트가 byte-identical
  계약이므로 lint 회귀가 모든 레포로 전파되는 걸 막는다.
- **Windows** — `verify.sh`/`verify.detect.sh` 는 bash 스크립트다. Windows-only 레포는 **Git Bash
  (또는 WSL)** 에서 실행해야 한다(`git` 설치에 동봉되는 MINGW bash 로 충분). PowerShell-only 환경엔
  `.ps1` twin 을 두지 않고 git-bash 의존을 명시하는 쪽을 기본으로 한다 — 계약을 한 벌만 유지해
  byte-identical 불변식을 지키기 위함. CI 의 Windows job 도 `bash scripts/verify.sh` 로 호출한다.
