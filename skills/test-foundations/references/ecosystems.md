# 생태계별 도구 표 — DETECT-then-MAP

> **로드 조건** — 진단 단계에서 스택을 탐지한 후 도구를 선택할 때, 또는 미지의
> 스택을 새 레포에 처음 배선할 때 연다. 이미 알고 있는 스택이면 SKILL.md 본문만으로 충분하다.

**핵심 원칙**: 도구 선택은 `verify.detect.sh` 데이터 테이블에 있고, slice 는
`measureCommand`/`filterCommand` 만 본다. **하드코딩 금지** — 탐지 후 매핑한다.
계약 상세 → [verify-contract.md](verify-contract.md).

---

## §1 JS/TS

| 계층 | 기본값 (2026) | override 트리거 |
|------|------------|----------------|
| **L0** | **Biome** (lint+format, Rust 기반 ~10–25× ESLint) + **tsc --noEmit** (Biome 는 타입 검사 불가) | ① 성숙한 코드베이스에 `eslint-plugin-*` 의존이 많음 → ESLint+Prettier+typescript-eslint 유지 ② React Native → ESLint 유지 (Vitest 무지원처럼 Biome 도 RN 에코가 성숙하지 않음) ③ 보안 플러그인(`eslint-plugin-security` 등) 필수 → ESLint |
| **L1** | **Vitest** (zero-config TS+ESM, Vite 모듈 그래프 affected watch, ~5.6× Jest) | React Native → **Jest** (Vitest 는 RN 환경 없음; 다른 이유로 Jest 교체 필요 없음) |
| **L2** | **Vitest** + **testcontainers** (JS npm) + **supertest** for HTTP | 모노레포에서 의존 경계가 없으면 supertest 만으로 충분 |
| **L3** | **Playwright** (auto-waiting locators, --shard, trace viewer; ~45% vs Cypress ~14%) | Cypress 기존 투자 유지비가 이전비보다 낮으면 유지 |
| **속도** | `tsc --incremental`, `vitest --changed` (모듈 그래프), Playwright `--shard/--workers`, Nx/Turborepo affected (모노레포), lefthook staged-file globs | — |

**[MUST]** Biome 를 채택할 때 tsc 를 제거하지 않는다 — Biome 는 타입을 모른다.
`"scripts": { "verify:l0": "biome check . && tsc --noEmit" }` 처럼 둘을 묶는다.

**[SHOULD]** Playwright 셀렉터 선택(`getByRole` > `data-testid` > XPath)은
이 파일의 소유가 아니다 →
[toss-frontend-fundamentals a11y-basics §테스트로 접근성 강제하기](../../toss-frontend-fundamentals/references/a11y-basics.md) 참조.

```ts
// L1 예 — Vitest, {scope} 토큰이 테스트 이름 안에 들어가야 한다
//   verify.sh --scope calcDiscount  →  vitest -t calcDiscount
test("calcDiscount.gold returns 0.2", () => {
  expect(calcDiscount("gold")).toBe(0.2);
});
```

---

## §2 Python

| 계층 | 기본값 (2026) | override 트리거 |
|------|------------|----------------|
| **L0** | **Ruff** (lint+format, Flake8+Black+isort+pyupgrade+bandit 대체, ~100×) + **mypy** 또는 **pyright** (타입 게이트, authoritative) | ① Ruff 0.15 formatter 가 Black 동작을 재현하므로 Black 제거 가능 ② **Astral ty** (10–100× 빠름, 2025-12 베타) → 빠른 피드백 용도로 opt-in; GA 전까지는 authoritative 게이트를 mypy/pyright 로 유지 (플러그인 시스템 없음, pyright edge case 미처리) |
| **L1** | **pytest** + **pytest-xdist** `-n auto` (병렬) | 단일 파일 스크립트 → pytest 만 (xdist 오버헤드 불필요) |
| **L2** | **testcontainers-python** (PyPI `testcontainers`) + `-m integration` 마커로 격리 | docker-compose 폴백 가능 (Testcontainers 바인딩 없는 이미지) |
| **L3** | **Playwright** (Python binding `playwright`) for web; **pytest + subprocess/httpx** for CLI/API | CLI/API 여정 → subprocess + assert 충분, Playwright 불필요 |
| **속도** | pytest-xdist `-n auto`, `-k` name filter, 마커로 계층 라우팅; seed per-worker (pytest-randomly + xdist 는 공유 seed 충돌 — per-worker seed 필수) | — |

**[MUST]** xdist + pytest-randomly 동시 사용 시 `--randomly-seed=$WORKER_ID` 처럼
워커별 seed 를 고정하지 않으면 순서 의존 flake 가 발생한다 (→ [flake.md §1](flake.md)).

**[SHOULD]** ty 를 authoritative 게이트에 올리지 않는다 — GA 전 릴리스는 mypy/pyright
대비 false-negative 가 존재한다. "빠른 편집 시 피드백" 용도로만 도입한다.

```python
# L2 예 — testcontainers-python, -m integration 마커
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="function")
def real_pg():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()

@pytest.mark.integration
def test_save_user.integration(real_pg):          # test NAME 에 토큰 포함
    ...                                           # verify.sh --scope save_user.integration
```

---

## §3 Go

| 계층 | 기본값 (2026) | override 트리거 |
|------|------------|----------------|
| **L0** | **gofmt** (또는 **gofumpt**, 더 엄격) + **go vet** + **golangci-lint** (병렬 aggregator; 2026 iterator/range-over-func linter 포함) | gofumpt 은 팀 합의 필요 — gofmt 호환 안 됨 |
| **L1** | **go test -race** `./...` (항상 `-race` — 동시성 버그의 핵심 품질 레버) + **testify** + **gotestsum** (읽기 좋은 출력, `--watch`, `--fail-fast`) | 테스트가 없는 라이브러리 패키지 → `go test ./...` 만 |
| **L2** | **testcontainers-go** + build tag `//go:build integration` → `go test -tags=integration ./...` | 태그 대신 `_integration_test.go` 파일명 관습도 가능 (팀 관습 우선) |
| **L3** | `os/exec` + built-in binary 로 CLI 하네스; `net/http` + `net/http/httptest` 로 API 여정; Playwright-go 는 웹 UI 가 있을 때 | 웹 UI 없는 CLI/API 가 대다수 — native 하네스로 충분 |
| **속도** | go test 는 패키지별 결과를 자동 캐시; `-run <NAME>` 이 `{scope}` 대상; `t.Parallel()` 로 패키지 내 병렬; 패키지 분리 자체가 병렬 실행 단위 | — |

**[MUST]** `-race` 를 생략하지 않는다. Go 의 데이터 레이스는 `-race` 없이 결정론적으로
재현되지 않는다 — 품질 축에서 가장 중요한 플래그다.

**[SHOULD]** `{scope}` 토큰은 Go 의 `-run` flag 에 정규식으로 전달된다.
테스트 함수 이름이 `TestUserService_Save` 이면 `--scope UserService_Save` 가 매칭된다.
슬래시·공백은 엔진 가드(`:611`)가 차단하므로 테스트 이름은 `[A-Za-z0-9_.-]` 안에 둔다.

```go
// L2 예 — testcontainers-go, build tag 격리
//go:build integration

package user_test

import (
    "testing"
    "github.com/testcontainers/testcontainers-go/modules/postgres"
)

func TestUserRepo_Save_integration(t *testing.T) {  // 토큰: UserRepo_Save_integration
    ctx := context.Background()
    pg, _ := postgres.Run(ctx, "postgres:16-alpine",
        testcontainers.WithWaitStrategy(wait.ForListeningPort("5432/tcp")))
    defer pg.Terminate(ctx)
    ...
}
```

---

## §4 Rust

| 계층 | 기본값 (2026) | override 트리거 |
|------|------------|----------------|
| **L0** | **cargo fmt** (`rustfmt`) + **cargo clippy -- -D warnings** (CI 에서 deny — warnings 를 errors 로) | `-D warnings` 가 너무 시끄러우면 `#[allow(...)]` 어노테이션으로 선별 억제; 전체 완화 금지 |
| **L1** | **cargo nextest run** (프로세스별 테스트 격리, all-cores, ~3× `cargo test`, 내장 retry/quarantine; drop-in); **cargo test --doc** 는 별도 유지 (nextest 는 doctest 미지원) | `cargo test` 로도 되지만 nextest 의 프로세스 격리가 공유 상태 flake 를 잡아줌 → 기본 선택 |
| **L2** | **testcontainers** crate (`testcontainers` on crates.io), feature/tag gated (`#[cfg(feature = "integration")]`) | docker-compose 폴백; `testcontainers` crate 활발히 유지됨 |
| **L3** | `tests/` 통합 테스트: **assert_cmd** / **escargot** for CLI binary; **reqwest** + spawned server for API | web UI 가 있으면 Playwright (.NET/Python/JS binding 중 하나 경유) |
| **속도** | **sccache** + incremental + dep 캐시 (CI); nextest `--partition` for sharding; nextest `-E 'test(/NAME/)'` filterset 이 `{scope}` 대상; **cargo-mutants** (nextest 기반) for mutation quality | — |

**[MUST]** nextest 파이프라인에 `cargo test --doc` 를 반드시 별도로 추가한다.
nextest 가 doctest 를 건너뛰는 것은 알려진 설계상 한계다.

**[SHOULD]** `{scope}` 토큰은 nextest 의 `-E 'test(/TOKEN/)'` filterset 에 들어간다.
토큰이 `/^[A-Za-z0-9_.-]+$/` 이므로 정규식 특수문자 이슈가 없다.

```rust
// L1 예 — nextest, {scope} 토큰이 테스트 이름 안에
//   verify.sh --scope calc_discount  →  nextest -E 'test(/calc_discount/)'
#[test]
fn calc_discount_gold_returns_point2() {    // 토큰: calc_discount
    assert_eq!(calc_discount(Tier::Gold), 0.2);
}
```

---

## §5 override 트리거 요약

| 도구 | 기본 (keep) | override (switch) |
|------|------------|------------------|
| **Biome** | 신규 순수 TS 프로젝트 | ESLint 플러그인 의존 多 · RN · 보안 플러그인 |
| **ty** (Astral) | 편집 시 빠른 피드백 opt-in | GA 전 authoritative 게이트 불가 |
| **Vitest** | 신규·Vite 기반 TS | RN → Jest |
| **nextest** | Rust (기본 선택) | doctest-only 레포 → `cargo test` 로 충분 |
| **Playwright** | 웹 UI 여정 | CLI/API only → native 하네스 |
| **testcontainers** | 바인딩 있는 스택 | 바인딩 없으면 docker-compose 폴백 |

**권위 vs 속도 이중 게이트 패턴** (Python/JS 모두 해당):

```
L0 fast feedback:  ruff check / biome check / ty check   (초 단위, 저장 시)
L0 authoritative:  mypy / pyright / tsc --noEmit          (CI 필수, 둘 다 통과해야)
```

빠른 도구를 CI authoritative 게이트로 올리지 않는 이유: false-negative 가 남아 있으면
authoritative 게이트가 무너진다. fast-feedback 과 authoritative 을 명시적으로 분리한다.

---

## §6 DETECT-then-MAP — 미지의 스택에 확장하기

**규칙**: 새 스택을 만나면 하드코딩하지 말고 같은 네 질문으로 매핑한다.
엔진은 `scripts/verify.sh` 한 계약만 보므로, 계약은 바뀌지 않는다.

### 네 질문 (모든 스택에 동일)

1. **이 스택의 관용 formatter + linter + type-checker 는?** (changed file 범위로 실행 가능한가?)
2. **이 스택의 빠른 unit runner 와 병렬 플래그는?** (`{scope}` 에 매핑되는 이름 filter 는?)
3. **Testcontainers 바인딩이 있는가?** (없으면 docker-compose 폴백; 둘 다 없으면 present:false)
4. **사용자 여정 하네스는?** (Playwright binding / native CLI+HTTP harness)

### 예시: .NET

| 계층 | 도구 |
|------|------|
| L0 | `dotnet format --verify-no-changes` + Roslyn analyzers (`dotnet build /warnaserror`) |
| L1 | xUnit + `dotnet test --parallel` (또는 NUnit/MSTest) |
| L2 | `Testcontainers.NET` (NuGet `Testcontainers.*`) + `IAsyncLifetime` |
| L3 | Playwright (.NET binding `Microsoft.Playwright`) |

`{scope}` → `dotnet test --filter "FullyQualifiedName~TOKEN"` 로 verbatim 포워드.

### 예시: JVM (Kotlin/Java)

| 계층 | 도구 |
|------|------|
| L0 | `spotless` (Gradle) + ktlint + detekt (Kotlin) / Checkstyle (Java) |
| L1 | JUnit5 + `--parallel` (Gradle `test { maxParallelForks = ... }`) |
| L2 | `testcontainers-java` + `@Testcontainers` + `@Container` |
| L3 | Playwright (Java binding) / RestAssured for API |

`{scope}` → Gradle: `./gradlew test --tests "*TOKEN*"` / Maven: `mvn -Dtest=TOKEN test`.

### 예시: Ruby

| 계층 | 도구 |
|------|------|
| L0 | RuboCop (`--format progress`) |
| L1 | RSpec (`--format progress`) / minitest |
| L2 | `testcontainers-ruby` gem + `described_class` fixture |
| L3 | Playwright (JS binding via node, or Capybara+Selenium) / HTTParty for API |

`{scope}` → RSpec: `rspec --example TOKEN` / minitest: `-n /TOKEN/`.

### 미지의 스택 배선 절차

```
1. 레포 자신의 build/test 명령을 먼저 확인한다
   (Makefile / justfile / mise.toml / README — 팀의 신뢰 명령이 우선)
2. manifest 탐지: *.csproj → .NET, pom.xml|build.gradle → JVM, Gemfile → Ruby, …
3. 네 질문으로 매핑 → verify.detect.sh 데이터 테이블에 4 행 추가
4. verify.sh 의 dispatch 함수에 4 분기 추가 (§ARCHITECTURE 참조)
5. scripts/verify.sh --help 로 탐지된 스택·매핑 확인
```

**미지의 스택이 탐지되었지만 테이블 행이 없으면**: 해당 계층은 `present:false` 로 보고
— 거짓 green 없음. diagnose 가 이를 "스택 미지원" purposeGap 으로 표시하고 proposals 에
매핑 추가를 제안한다.

---

## §7 {scope} 토큰 ↔ 네이티브 필터 대응표

엔진 가드(`recursive-slice.js:611`)는 `{scope}` 토큰을 항상
`/^[A-Za-z0-9_.-]+$/` 로 제한한다. 각 러너의 이름 필터 문법:

| 스택 | 러너 | {scope} 포워드 방식 |
|------|------|-------------------|
| JS/TS | Vitest | `vitest -t TOKEN` |
| JS/TS | Jest | `jest -t TOKEN` |
| Python | pytest | `pytest -k TOKEN` |
| Go | go test | `go test -run TOKEN ./...` |
| Rust | nextest | `cargo nextest run -E 'test(/TOKEN/)'` |
| .NET | dotnet test | `dotnet test --filter "FullyQualifiedName~TOKEN"` |
| JVM (Gradle) | JUnit5 | `./gradlew test --tests "*TOKEN*"` |
| Ruby | RSpec | `rspec --example TOKEN` |

**[MUST]** 스캐폴드는 executor 가 테스트 **NAME 안에** `{scope}` 토큰을 포함하도록
지시한다 (`recursive-slice.js:299`). 경로·파일명이 아니라 **이름**이다 — 엔진은
name-substring forward 만 가능하다.

**[MUST]** `--list-scopes` 출력은 `[A-Za-z0-9_.-]+` 형태의 bare 토큰이어야 한다.
슬래시·공백이 포함된 이름이 출력되면 엔진이 해당 토큰을 주입하지 못한다.

---

## 참조

- [verify-contract.md](verify-contract.md) — 엔트리 계약 전문 (flags / exit codes / NDJSON / detect 테이블 포맷)
- [layers.md](layers.md) — 계층 모델 (어느 계층에 무엇을 배치할지)
- [real-env.md](real-env.md) — Testcontainers 패턴, purposeGap 파생
- [speed.md](speed.md) — 속도 축 기법 (병렬, changed-only, 캐시)
- [toss-frontend-fundamentals a11y-basics](../../toss-frontend-fundamentals/references/a11y-basics.md) — Playwright 셀렉터 선택 (getByRole > data-testid)
