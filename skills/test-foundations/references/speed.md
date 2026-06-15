# Speed — 속도 축 기법 (변경분 피드백 × 전체 스위트 시간)

> **목적**: 테스트가 느리면 아무도 안 돌린다 — 40분 스위트는 품질 신뢰성 0과 같다.
> 속도 축 목표는 두 숫자를 동시에 관리하는 것이다:
> `changedFeedbackMs` (변경분 빠른 문, ≤ 10 s 목표) ×
> `fullSuiteMs` (전체 스위트, 소·중형 레포 ≤ 5 분 목표).
> 이 두 숫자는 `scripts/verify.sh --json` NDJSON aggregate 줄에 있다.

**[MUST]** 이 페이지는 속도 기법만 다룬다. 품질 축(real-exercise·결정론·목적 충실도)은
[quality.md](quality.md), flake 문제는 [flake.md](flake.md),
L2/L3 real-dep 타이밍은 [real-env.md](real-env.md) 참조.

---

## 목차

1. [변경분만 / affected (portable floor)](#1-변경분만--affected-portable-floor)
2. [병렬 / 샤딩](#2-병렬--샤딩)
3. [계층 라우팅 — 언제 어느 계층을 돌리나](#3-계층-라우팅--언제-어느-계층을-돌리나)
4. [캐시 (빌드·dep·테스트 결과)](#4-캐시-빌드dep테스트-결과)
5. [재시도는 시간+품질 이중 비용](#5-재시도는-시간품질-이중-비용)

---

## 1. 변경분만 / affected (portable floor)

**원칙** — 빠른 문의 핵심은 전체가 아니라 *변경에 영향받는 것만* 돌리는 것이다.
실행 전략을 신뢰도 순으로 선택한다.

| 우선순위 | 전략 | 조건 |
|---|---|---|
| 1 | native-affected (도구 자체 모듈 그래프) | 도구가 무료로 제공할 때 |
| 2 | `--changed` 경로 관례 맵 (src/foo/bar → name filter foo/bar) | 경로 관례가 명확할 때 |
| 3 | 영향받은 계층 전체 fallback | 관례 불분명 — 정확성 우선, 속도 차선 |

**`scripts/verify.sh --changed`의 동작 (portable git-only, no Nx/Turbo 의존)**

```
STAGE 1  파일 집합
  BASE=$(git merge-base origin/HEAD HEAD  ||
         git rev-parse origin/main        ||
         git rev-parse HEAD~1)
  파일 = git diff --name-only "$BASE"...HEAD
        + git diff --name-only HEAD
        + git status --porcelain | cut -c4-
  (dedup, --base REF로 override 가능; base 불가 = working-tree fallback + baseFallback:true)

STAGE 2  파일 → 계층 + 테스트 매핑
  • config/lock 변경 → L0만 (affected files)
  • source/test 변경 → L0 + L1 항상 (cheap)
  • integration-bearing 경로(DB/HTTP 레이어) → L2 포함
  • e2e/ 또는 journey-bearing 경로 → L3 포함 (그 외 L3 skip)
```

**JSON에서 구분**

```json
{"layer":"l1","affected":false,"scope":null,"changed":true,...}
// 0.1.0: --changed 는 fast door(l0+l1)만 돈다 → changedFeedbackMs = 그 두 계층의 실제 시간.
// affected 는 아직 항상 false (도는 계층 안에서 per-test 로 좁히지 않는다).
// followUp 후: affected:true = 진짜 per-test impact-selection;
//             affected:false(whole-layer fallback) = 경로 관례 불일치 → 그땐 속도 수치를 그대로 믿지 말 것.
```

**왜** — `affected:false` + 느린 `changedFeedbackMs` 조합이 보이면 경로 관례를 정비하거나
scope-floor를 재검토한다. 수치를 잘못 읽어 "빠르다"고 착각하는 것이 더 위험하다.

---

## 2. 병렬 / 샤딩

**원칙** — 코어를 놀리지 마라. 대부분의 CI 환경은 유휴 코어가 있다.

### JS/TS — Vitest

```bash
# 기본: Vitest는 worker threads로 자동 병렬
vitest run --reporter=verbose

# PR 슬로우 스위트 → shard (GitHub Actions matrix 예)
vitest run --shard=1/4   # runner 1
vitest run --shard=2/4   # runner 2 ...

# 모듈 그래프 affected watch (로컬 fast-door)
vitest --changed          # Vite 모듈 그래프 사용 — native-affected
```

### Python — pytest-xdist

```bash
pytest -n auto            # 코어 수 자동
# 주의: pytest-randomly와 xdist 공유 seed 충돌 → worker당 seed 고정
pytest -n auto -p pytest-randomly --randomly-seed=1234
```

**[SHOULD]** `pytest-xdist -n auto`는 process 격리가 아닌 forking — L1 이하에서만.
실제 DB 연결(L2)에서는 worker당 DB schema 또는 Testcontainers per-worker 필요.

### Go

```bash
# go test -race는 이미 package-level 병렬 (GOMAXPROCS)
go test -race -count=1 ./...

# 테스트 내 병렬 명시
func TestFoo(t *testing.T) {
    t.Parallel()
    ...
}
```

Go는 패키지 캐시를 자동 활용해 변경 없는 패키지를 재실행하지 않는다.

### Rust — cargo nextest

```bash
# nextest는 기본으로 모든 코어 사용 (cargo test 대비 ~3x)
cargo nextest run

# CI shard
cargo nextest run --partition count:1/4
cargo nextest run --partition count:2/4 ...
```

### Playwright (L3)

```bash
# 로컬: workers 자동
npx playwright test

# CI shard (4개 runner)
npx playwright test --shard=1/4
```

---

## 3. 계층 라우팅 — 언제 어느 계층을 돌리나

**원칙** — 빠르고 결정론적인 계층을 앞에 두고, 비싼 계층은 가능한 뒤로 미룬다.
`verify.sh --layer all`은 첫 RED에서 short-circuit하므로 L0 lint fail이 L3 E2E 비용을 내지 않는다.

| 이벤트 | --layer | 비고 |
|---|---|---|
| 파일 저장 / pre-commit | `l0` (staged 파일만) | lefthook/husky staged-file glob |
| 저장 + 빠른 유닛 확인 | `l0 l1` | IDE watch mode |
| push | `all --changed` | L3는 e2e/ 변경 시에만 |
| PR / CI | `all` | 전체, short-circuit 해제(`--json`) |
| 병합 후 / nightly | `all` | full suite time 측정 |

**[MUST]** `scripts/verify.sh --json`에서 각 계층 `durationMs`를 확인해 느린 계층을 파악한다.
40분짜리 L3가 모든 save 이벤트에 달려 있다면 계층 라우팅이 깨진 것이다.

**pre-commit hook 예 (lefthook)**

```yaml
# lefthook.yml
pre-commit:
  commands:
    verify-l0:
      run: scripts/verify.sh --layer l0 --changed
      stage_fixed: false
```

**[NIT]** `--layer l0 --changed`는 staged 파일만 L0 도구에 전달한다.
전체 프로젝트 lint를 pre-commit에 거는 것은 slow-door — `changedFeedbackMs` 목표를 즉시 초과한다.

---

## 4. 캐시 (빌드·dep·테스트 결과)

**원칙** — 캐시는 항상 정확성 도구가 먼저다 (올바른 캐시 키 없으면 오히려 위험).

### 빌드 캐시

| 스택 | 도구 | 캐시 키 |
|---|---|---|
| JS/TS | tsc `--incremental` | `tsconfig.tsbuildinfo` |
| Rust | `sccache` | target/ + Cargo.lock hash |
| Go | go build cache | `$GOCACHE` (자동) |
| monorepo | Nx/Turborepo/moon | task graph + input hash |

### dep 캐시 (CI)

```yaml
# GitHub Actions — pnpm 예
- uses: actions/cache@v4
  with:
    path: ~/.pnpm-store
    key: pnpm-${{ hashFiles('pnpm-lock.yaml') }}
```

### 테스트 결과 캐시

- **Go**: package-level 캐시 자동 (`go test` 재실행 시 `[cached]`)
- **Nx/Turborepo**: `nx affected --target=test` — 입력 hash 동일 = 캐시 히트
- **Rust nextest**: nextest archive + CI artifact 재사용 (pre-built binary)

**[SHOULD]** 모노레포 규모에서 Nx/Turborepo affected는 강력하지만 verify.sh의
`--changed` portable floor와 독립적이다 — 최적화이지 의존이 아님.
빌드 도구가 없는 레포에서도 git-diff floor가 동작해야 한다.

---

## 5. 재시도는 시간+품질 이중 비용

**원칙** — 재시도는 flake를 *숨기는* 기법이다. 시간 비용(재실행)과 품질 비용(진짜 실패 은폐)을 동시에 지불하며, 두 축을 모두 훼손한다.

**Before (재시도 기본값)**
```yaml
# .github/workflows/ci.yml
- run: pytest
  continue-on-error: true   # ← flake를 통과시킴
```

```bash
# playwright.config.ts
retries: 3,  # ← 결정론적 실패를 3번 재실행
```

**After (정직한 surfacing)**
```bash
# verify.sh 내 동작 (--json 모드)
# RED L0/L1 → 한 번 isolated 재실행
# 뒤집히면: flake:true, flakeRuns:2, exit 여전히 1
# 뒤집히지 않으면: flake:false, flakeRuns:2, exit 1 (진짜 RED)
```

**왜** — `flakeRatePct` 목표는 ≤ 1 %. 재시도로 통과시키면 이 수치가 0으로 보이지만
실제 flake 부채는 쌓인다. `verify.sh --json` aggregate에서 `flake:true` 줄이 보이면
즉시 백로그 항목으로 등록한다 — [flake.md](flake.md) 참조.

**[MUST]** Playwright `retries` 기본값을 CI에 설정하지 않는다.
auto-waiting locator를 먼저 고쳐라 — 그게 없으면 retry가 의미없다.

---

## 속도 축 체크리스트

| 항목 | 태그 |
|---|---|
| `changedFeedbackMs` ≤ 10 s (fast door) | [MUST] |
| `fullSuiteMs` ≤ 5 min (소·중형 레포) | [SHOULD] |
| pre-commit은 `--layer l0 --changed`만 | [MUST] |
| L3는 PR/CI에만; 로컬 저장 이벤트 금지 | [MUST] |
| `affected:false` 줄 → 경로 관례 정비 신호 | [SHOULD] |
| 재시도 기본값 비활성화 / flake backlog 등록 | [MUST] |
| 병렬 플래그 확인 (`-n auto` / `t.Parallel()` / nextest) | [SHOULD] |
| 모노레포 → Nx/Turborepo affected (optimize, not depend) | [NIT] |

---

> **속도 수치 출처**: `scripts/verify.sh --json` 의 aggregate 줄
> (`changedFeedbackMs`, `fullSuiteMs`, `flakeRatePct`, `purposeGapCount`).
> 이 네 숫자가 slice 프로젝트 카드의 신뢰도 예산이다 ([verify-contract.md](verify-contract.md) §3).
