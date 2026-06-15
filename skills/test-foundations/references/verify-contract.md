---
load-on-demand: true
purpose: scripts/verify.sh + verify.detect.sh 의 전체 계약 스펙 — 플래그·종료 코드·NDJSON 형식·--changed 2단계 맵·{scope} 엔진 제약·detect.sh 데이터 테이블 형식·native-runner-first·baseliner 필드 도출. 스캐폴드 단계와 slice baseliner 가 읽는 단일 진실 원천.
---

# verify 엔트리 계약

**원칙:** `scripts/verify.sh` 는 레포마다 byte-identical 한 단일 계약이다. 도구 선택 전체가 `scripts/verify.detect.sh` 데이터 테이블에 산다 — slice 는 *한 계약*만 본다.

```
measureCommand  = "scripts/verify.sh"
filterCommand   = "scripts/verify.sh --scope {scope}"
```

엔진은 `replace('{scope}', token)` 후 `cd ${repo} && scripts/verify.sh --scope <token>` 을 그대로 실행한다 (recursive-slice.js:612). 생태계가 바뀌어도 이 두 줄은 변하지 않는다.

---

## §1 CLI — 플래그 의미표

```
scripts/verify.sh [--layer l0|l1|l2|l3|all]
                  [--changed] [--base REF]
                  [--scope NAME] [--filter NAME]
                  [--json]
                  [--list-scopes] [--print-setup]
                  [-h|--help]
```

파일: `scripts/verify.sh` (`#!/usr/bin/env bash`, `set -euo pipefail`, `chmod +x`). 형제 파일 `scripts/verify.detect.sh` 를 source 해 데이터 테이블을 읽는다. 알 수 없는 플래그 → exit 2.

| 플래그 | 기본값 | 의미 |
|---|---|---|
| `--layer l0\|l1\|l2\|l3\|all` | `all` | 정확히 한 계층 실행. `all` 은 L0→L1→L2→L3 오름순으로 실행하며 **첫 RED 에서 단락**(short-circuit). `--json` 은 단락을 비활성화해 모든 계층을 측정한다. |
| `--changed` | off | git-only 변경 파일 제한. 이식 가능(Nx/Turbo 의존 없음). base 해결: `merge-base origin/HEAD HEAD` → `origin/main` → `HEAD~1` → 워킹 트리 폴백. |
| `--base REF` | – | `--changed` 의 base ref 를 REF 로 덮어씀. |
| `--scope NAME` | – | NAME 을 러너의 name/substring 필터로 VERBATIM 전달. `--filter NAME` 은 exact alias. [§5 엔진 제약](#5-scope-bare-token-엔진-제약) 참조. |
| `--json` | off | stdout 에 NDJSON 만 출력(human 출력 억제). 도구 출력 → `.verify/logs/<layer>.log`. |
| `--list-scopes` | – | 법적 `{scope}` 토큰을 한 줄씩 출력(L1 러너 dry-list). baseliner 가 채택 전 검증에 쓴다. |
| `--print-setup` | – | 스택별 worktree setup 명령(npm ci / pnpm install --frozen-lockfile / uv sync / go mod download / cargo fetch) 출력. |
| `-h\|--help` | – | usage + 탐지된 스택 + 계층별 tool/mode 매핑 + coldBuildCost + setup 명령. exit 0. |

`--layer` 와 `--scope` 는 합성 가능: `scripts/verify.sh --scope myFunc --layer l1` 은 L1 에서만 `myFunc` 과 일치하는 테스트를 실행한다.

---

## §2 종료 코드 계약

엔진은 0-vs-nonzero 로 분기한다. 세부 코드는 diagnose 와 사람을 위한 것이다.

| 코드 | 의미 | 엔진 반응 |
|---|---|---|
| **0** | 요청된 모든 계층 GREEN. absent 계층(present:false)은 RED 가 아님. | 게이트 통과 |
| **1** | ≥1 요청 계층 RED. | 게이트 실패 → 리프 차단 |
| **2** | usage 에러 **또는** `--scope` 가 테스트 0건 매치 (contract gap — 진짜 RED 아님). | llm-only 로 graceful degrade (recursive-slice.js:621); t0redBreaker 가 반복 불일치 후 게이트 비활성화(:632) |
| **3** | 인프라/전제조건 실패 (L2/L3 Docker 다운, runner 바이너리 없음). CI 가 코드가 아닌 인프라를 재시도. | 인프라 실패 신호 |

**우선순위:** infra(3) > red(1) > zero-match(2). 진짜 RED 와 zero-match 가 공존하면 RED(1) 가 이긴다.

**[MUST]** 러너가 "수집된 테스트 없음"에 exit 0 을 내는 경우(pytest exit 5 = exit 2 변환, vitest/jest "no tests found" 패턴 매칭), verify.sh 가 exit 2 로 변환한다. exit 0 으로 통과시키는 것은 false green — 계약 위반.

**[MUST]** Docker 다운 = L2/L3 green skip 이 아닌 exit 3. infra 부재를 "측정된 사실 absent" 로 처리하면 안 된다.

---

## §3 NDJSON 형식 — 2축 요약 (품질 × 속도)

`--json` 시 stdout 에는 NDJSON 만 나온다. 계층이 완료될 때마다 스트리밍(40분짜리 L3 가 L0/L1 결과를 지연시키지 않음).

### 계층당 줄 (l0..l3 각 1줄)

```json
{
  "layer":      "l1",
  "tool":       "vitest",
  "present":    true,
  "passed":     true,
  "durationMs": 254,
  "flake":      false,
  "flakeRuns":  1,
  "tests":      {"run": 2},
  "scope":      null,
  "changed":    false,
  "affected":   false,
  "purposeGap": null,
  "zeroMatch":  0,
  "exit":       0,
  "log":        ".verify/logs/l1.log"
}
```

**속도 축:** `durationMs` (계층별 wall-clock), `changed` / `affected` (변경 영향 범위).

**품질 축:** `passed` + `exit`; `flake` (재실행에서 뒤집혔으면 true) + `flakeRuns`; `purposeGap` (string|null).

**absent 계층 (present:false):**

```json
{"layer":"l2","tool":"","present":false,"passed":null,"durationMs":null, ... ,
 "purposeGap":"L2 absent — module seams unverified against real deps"}
{"layer":"l3","tool":"","present":false,"passed":null,"durationMs":null, ... ,
 "purposeGap":"no user journey wired — E2E deferred by scope-floor (not a gap if no journey)"}
```

Docker 다운 L2/L3:

```json
{"present":true,"passed":false,"exit":3,
 "purposeGap":"L2 real-dep configured but Docker down — could not verify real dependency"}
```

### 최종 집계 줄 (summary:true)

```json
{
  "summary":          true,
  "passed":           true,
  "layers":           ["l0","l1","l2","l3"],
  "changedFeedbackMs": 147,
  "fullSuiteMs":       147,
  "flakeRatePct":      0.0,
  "purposeGapCount":   2,
  "redLayers":         [],
  "zeroMatch":         0,
  "infra":             0,
  "base":              null,
  "baseFallback":      false,
  "exit":              0
}
```

**§5.1 의무 예산 수치 4개:**

| 필드 | 의미 |
|---|---|
| `changedFeedbackMs` | L0+L1 누적 ms (fast-door 비용) |
| `fullSuiteMs` | 모든 present 계층 ms 합계 |
| `flakeRatePct` | flaky 계층 수 / present 계층 수 × 100 |
| `purposeGapCount` | null 아닌 purposeGap 필드 수 (absent L2/L3 각 1씩) |

이 4개가 slice integration 카드 + diagnose 리포트가 소비하는 예산 신호다.

**flake 측정 (정직, retry-hide 금지):** `--json` 하에서 RED L0/L1 계층은 격리 재실행을 1회 한다. 뒤집히면 `flake:true / flakeRuns:2` 이고 **exit 는 1 로 유지** — flake 를 backlog 신호로 노출하지 pass 로 숨기지 않는다. retry = "시간+품질 이중 비용"이며 치료가 아니다.

---

## §4 --changed 2단계 이식 가능 맵

**Stage 1 — 변경 파일 집합 (git-only, 이식 가능):**

```bash
BASE=$(git merge-base origin/HEAD HEAD \
    || git rev-parse origin/main \
    || git rev-parse HEAD~1)
# union of:
git diff --name-only "$BASE"...HEAD
git diff --name-only HEAD
git status --porcelain | cut -c4-
# deduped
```

`--base REF` 가 있으면 BASE 를 덮어씀. base 불능(shallow/detached) → 워킹 트리 폴백 + `baseFallback:true`.

**Stage 2 — 계층 라우팅 (0.1.0 의 실제 동작):**

`--changed`(기본 `--layer all`)는 **fast door = L0+L1** 만 돈다 — 빠른 피드백용. `changedFeedbackMs`
는 그 L0+L1 누적 시간이다. **L2/L3 는** full `verify.sh`(`--changed` 없이) 또는 명시적 `--layer l2`/
`l3` 로 돈다 (§5.1 'L3 는 PR/CI 에서만' 라우팅의 보수적·정직한 형태). 명시적 `--layer` 는 항상 우선.

`affected` 필드는 현재 **항상 `false`** 다 — 정직하게: `--changed` 는 *계층 단위*로 라우팅(fast door)
할 뿐, 도는 계층 *안에서* 테스트를 좁히지(per-test impact-selection) 않는다. 가짜 `true` 를 내지 않는다.

**계획된 followUp (0.1.0 미구현, BACKLOG):** 아래가 들어오면 `affected:true` 가 의미를 갖는다 —
1. **(a) 네이티브 affected** — vitest `--changed $BASE`, go per-package 캐시, jest `--onlyChanged`.
2. **(b) 경로 관례 맵** — `src/foo/bar` → scope 필터 `foo/bar`; 변경 파일 유형 → 포함 계층(config→L0,
   integration 경로→L2, `e2e/`/journey 경로→L3).
3. **(c) 폴백** — 전체 affected 계층 (조용히 건너뛰는 것보다 정확함 우선).
   그때 선택 전략이 `affected:true/false` 로 보고되어 diagnose 가 진짜 영향 선택 vs 계층 폴백을 판별한다.

---

## §5 {scope} bare-token 엔진 제약

**[MUST]** 엔진이 `{scope}` 에 주입하는 토큰은 항상 `/^[A-Za-z0-9_.-]+$/` 를 만족한다 (recursive-slice.js:611 의 `scopeSafe` 가드).

슬래시·공백·경로는 절대 들어오지 않는다. verify.sh 는 토큰을 NAME/substring 필터로 VERBATIM 전달하기만 하면 된다.

**러너별 필터 문법:**

| 러너 | 필터 플래그 | 예시 |
|---|---|---|
| pytest | `-k NAME` | `pytest -k myFunc` |
| vitest | `-t NAME` | `vitest run -t myFunc` |
| Jest | `-t NAME` | `jest -t myFunc` |
| node:test | `--test-name-pattern=NAME` | `node --test --test-name-pattern=myFunc` |
| go test | `-run NAME` | `go test -run myFunc ./...` |
| cargo nextest | `-E 'test(/NAME/)'` | `nextest run -E 'test(/myFunc/)'` |

**왜:** 엔진은 `filterCommand.replace('{scope}', testScope)` (line 612) 후 `cd ${repo} && <cmd>` 를 verbatim 실행한다. 슬래시/경로 방언은 엔진 레벨에서 도달 불가능한 형태다.

**스캐폴드 지시 [MUST]:** 스캐폴드는 executor 가 테스트 **이름(NAME) 안에** `{scope}` 토큰이 들어가도록 작성하게 해야 한다 (recursive-slice.js:299). 경로 기반 실행이 아니라 이름 매치가 되어야 한다.

**--list-scopes 출력 보장:** `--list-scopes` 가 출력하는 토큰은 모두 `/^[A-Za-z0-9_.-]+$/` 를 만족해야 한다. baseliner 가 scope 를 채택하기 전 `--list-scopes` 로 검증해 silent zero-match (recursive-slice.js:621) 를 방지한다.

---

## §6 verify.detect.sh 데이터 테이블 형식

`verify.detect.sh` 는 pure data + 작은 pure helper 로만 구성된다. **control flow 가 없다.** verify.sh 가 source 해서 읽는다.

**주요 함수 3개:**

| 함수 | 역할 |
|---|---|
| `vd_detect_stacks` | 매니페스트 탐지로 space-separated 스택 id 출력 (`js py go rs dotnet jvm ruby`) |
| `vd_runner_for STACK LAYER` | `KIND\|TOOL\|MODE` 행 반환. MODE=none 이면 present:false. |
| `vd_native_task LAYER` | `RUNNER\|TASK` 반환(없으면 빈 문자열). package.json script / just / mise 를 탐지. |

**vd_runner_for 행 형식:**

```
KIND|TOOL|MODE
l1  |vitest|js-vitest
```

- `KIND`: l0~l3 (확인용으로 에코)
- `TOOL`: human/JSON 용 tool 이름 (NDJSON `tool` 필드)
- `MODE`: verify.sh dispatcher 가 switch-on 하는 불투명 토큰. quoting / `{scope}` 전달이 **한 곳(verify.sh)** 에만 존재.

**생태계 추가 = 3곳만 수정:**

1. `vd_detect_stacks` 에 매니페스트 행 1개
2. `vd_runner_for` 에 l0..l3 행 4개
3. verify.sh 의 `dispatch_mode` 에 4개 분기

→ slice 계약(measureCommand/filterCommand/플래그/종료 코드/NDJSON)은 변하지 않는다.

**[MUST]** MODE 가 없는(none) 계층은 `present:false` 로 보고된다 — 측정된 사실이지 false green 이 아니다.

---

## §7 native-runner-first

verify.sh 의 각 계층 함수는 먼저 `vd_native_task LAYER` 를 호출한다. 커밋된 태스크가 있으면 그쪽으로 **위임**하고, 없으면 인라인 네이티브 도구를 직접 호출한다.

**위임 계층 (첫 hit 가 이김):**

```
package.json scripts:  verify:l0 / verify-l0   → npm run <name>
justfile recipes:      verify-l0 / verify:l0   → just <name>
mise tasks:            verify:l0               → mise run <name>
```

**왜:** 팀이 이미 커밋한 관용적 태스크가 있으면, verify.sh 가 직접 도구를 재구현하는 것보다 그쪽에 위임하는 게 팀 관용을 존중하는 것이다. verify.sh 의 인라인 구현은 커밋된 태스크가 없을 때의 폴백이다.

**[SHOULD]** 스캐폴드는 `mise.toml` / `justfile` verify 태스크를 먼저 작성하고, verify.sh 가 shell-in 하게 한다. 기존 justfile/mise.toml 이 있으면 덮어쓰지 않고 태스크만 추가한다.

**Before (기존 repo — mise 태스크 없음):**
```bash
# verify.sh 가 vitest 를 직접 호출
vitest run
```

**After (스캐폴드 후 — mise 태스크 존재):**
```toml
# mise.toml
[tasks."verify:l1"]
run = "vitest run"
```
```bash
# verify.sh 가 위임
mise run verify:l1
```

---

## §8 baseliner 필드 도출

baseliner 는 `scripts/verify.sh --help` 를 읽어 BASELINE 필드를 직접 채운다.

| BASELINE 필드 | 도출 방법 |
|---|---|
| `measureCommand` | `"scripts/verify.sh"` 고정 (또는 `--json` 을 붙여 예산 캡처) |
| `filterCommand` | `"scripts/verify.sh --scope {scope}"` 고정 |
| `coldBuildCost` | `--help` 가 출력하는 추론값: Go/Rust/.NET/JVM → expensive; JS/Py → cheap |
| `worktreeSetupCommand` | `--print-setup` 출력 verbatim |
| `purposeCheck` | `--json` 의 L2/L3 `purposeGap` 필드: `null` (real dep ✓) 이면 in-process-verifiable, 문자열이면 gap |
| `inProcessVerifiable` | Testcontainers ✓ 이면 true; live API / human 필요이면 false |
| `invariants` | `"every layer green under measureCommand stays green"` (floor 표현) |

**계층 좁힘 leaf 게이트:** `"scripts/verify.sh --scope {scope} --layer l1"` — 동일한 엔트리에 `--layer` 를 붙여 쓸 뿐이다.

**[MUST]** baseliner 는 `--list-scopes` 로 토큰이 법적임을 검증한 후 filterCommand 에 채택한다. 검증 없이 채택하면 silent zero-match (exit 2, engine degrades to llm-only) 가 될 수 있다.

---

**참고:** 생태계별 도구 선택(L0~L3 기본값·override 트리거·미지 스택 추가) → [`ecosystems.md`](ecosystems.md). L2/L3 real-dep purposeGap 해석 + Testcontainers 패턴 → [`real-env.md`](real-env.md). 계층 분포·scope-floor 결정 트리 → [`layers.md`](layers.md).
