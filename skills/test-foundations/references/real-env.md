# real-env — L2/L3 실제 의존성·실제 환경 검증

"mock 이 통과했어도 실제 DB 를 친 적이 없다면, 그 green 은 거짓이다."

## 목차

1. [Testcontainers — 스택별 패턴](#1-testcontainers--스택별-패턴)
2. [purpose vs prompt — 거짓 green 방지](#2-purpose-vs-prompt--거짓-green-방지)
3. [inProcessVerifiable / purposeCheck — baseliner 결합점](#3-inprocessverifiable--purposecheck--baseliner-결합점)
4. [E2E: 프레임워크·타이밍·CI (셀렉터는 defer)](#4-e2e-프레임워크타이밍ci)
5. [CLI/API 여정 하네스 (웹 UI 없는 경우)](#5-cliapi-여정-하네스)

---

## 1. Testcontainers — 스택별 패턴

**원칙** — L2(기능/통합) 계층은 실제 의존성을 컨테이너로 격리 실행한다. 한 테스트 실행당 신선한 컨테이너 하나, 종료 시 자동 teardown.

| 스택 | 바인딩 | 비고 |
|---|---|---|
| JS/TS | `testcontainers` (npm) | Vitest + Node ≥18 |
| Python | `testcontainers` (PyPI) | pytest fixture 에 wrapping |
| Go | `testcontainers-go` + build tag `//go:build integration` | `go test -tags=integration` 로 격리 |
| Rust | `testcontainers` crate, feature/tag gated | nextest 와 함께 동작 |
| .NET | `Testcontainers.NET` NuGet | xUnit `IAsyncLifetime` |
| JVM | `testcontainers-java` / `testcontainers-kotlin` | JUnit5 `@Testcontainers` |
| Ruby | `testcontainers-ruby` gem | RSpec before/after |

10+ 언어 바인딩이 있어 "Testcontainers 바인딩이 없는 스택"은 드물다. 없으면 `docker-compose up -d` + `docker-compose down` 래퍼로 대체한다(기능 동일, teardown 보장 필수).

**Before** — mock DB 로만 테스트
```python
# L2 인데 실제 Postgres 를 전혀 안 침
def test_save_user(mock_db):
    mock_db.insert.return_value = {"id": 1}
    result = save_user(mock_db, {"name": "Alice"})
    assert result["id"] == 1
```

**After** — Testcontainers 로 실제 Postgres 기동
```python
import pytest
from testcontainers.postgres import PostgresContainer

@pytest.fixture(scope="function")
def real_db():
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg.get_connection_url()

def test_save_user(real_db):
    # 실제 Postgres 에 insert/select, 마이그레이션까지 검증
    conn = connect(real_db)
    result = save_user(conn, {"name": "Alice"})
    assert result["id"] is not None
    assert fetch_user(conn, result["id"])["name"] == "Alice"
```

**왜**
- 실제 트랜잭션·제약조건·마이그레이션 버그를 L2 에서 잡는다.
- mock 이 현실과 어긋나는 순간("mock drift")을 원천 차단한다.
- 컨테이너 격리로 테스트 간 상태 오염 없음.

**주의**
- [MUST] L2 가 컨테이너 없이 mock 만 쓴다면 → `purposeGap: "L2 mocks DB — no real dep"` 으로 보고 (거짓 green 이 아닌 측정된 부채).
- [SHOULD] 컨테이너 spin-up 시간이 L1 을 침범하지 않도록 빌드 태그·marker 로 계층 격리.
- [NIT] `scope="session"` 픽스처로 재사용하면 속도 개선되나, teardown 에서 DB 상태 초기화 필수.

---

## 2. purpose vs prompt — 거짓 green 방지

**원칙** — "테스트가 green 이다"와 "테스트가 목적(purpose)을 검증했다"는 다르다. mock 만 통과한 green = **거짓 green (anti-genie)**.

**두 질문으로 판별**

1. 이 테스트가 green 일 때, 실제 의존성(DB·HTTP·큐)을 실제로 쳤는가?
2. 관측 가능한 외부 상태(DB row, HTTP 응답, 큐 메시지)가 assertion 에 들어있는가?

두 질문 모두 "아니오" → purposeGap 존재.

**anti-genie 패턴 카탈로그**

| 패턴 | 문제 | 해결 |
|---|---|---|
| mock 만 쓰는 L2 | 실제 의존성 미행사 | Testcontainers 또는 docker-compose |
| assertion 없는 smoke | 통과 자체가 목적 | 관측 가능한 상태 단언 추가 |
| stub 이 always-true 반환 | 로직 검증 불가 | recorded-real 응답으로 교체 |
| `.not.toThrow()` 만 | 동작 확인 없음 | 결과 값·상태 명시적 단언 |

**purposeGap 문자열 결정 규칙** (verify.sh 가 --json 에 emit)

```
L2 present=true 이면:
  실제 dep 사용 → purposeGap: null   (신뢰 가능)
  mock 만 사용   → purposeGap: "L2 mocks DB — no real dep"

L2 present=false 이면:
  purposeGap: "L2 absent — module seams unverified against real deps"

L3 present=false 이면:
  purposeGap: "no user journey wired — E2E deferred by scope-floor (not a gap if no journey)"
```

**왜**
- purposeGapCount = 0 이 4축 budget 목표 중 하나 (§5.1-line-99).
- purposeGap 이 null 이어야 slice 바탕선의 `purposeCheck` 가 clean 으로 표시된다.
- "green 이 많다" vs "purpose 가 검증됐다"를 분리해야 리그가 실제 신뢰 지표가 된다.

---

## 3. inProcessVerifiable / purposeCheck — baseliner 결합점

**원칙** — slice 바탕선(BASELINE)은 리그의 검증 방식을 두 필드로 읽는다. `--json` 출력의 purposeGap 에서 자동 파생.

| 시나리오 | inProcessVerifiable | purposeCheck |
|---|---|---|
| L2: Testcontainers 실제 Postgres | `true` | `"real Postgres via testcontainers ✓"` |
| L2: HTTP stub 으로 recorded-real 응답 재생 | `true` | `"recorded-real bytes ✓"` |
| L3: Playwright + 로컬 스택 전체 기동 | `true` | `"local full-stack ✓"` |
| L3: 실제 외부 API 필요 (결제, SMS) | `false` | `"live external API — human-in-loop"` |
| L2: mock 만 사용 | `false` | `"purposeGap: mocks only"` |

**baseliner 파생 규칙**

```
scripts/verify.sh --json 결과에서:
  perLayer[l2].purposeGap == null  → inProcessVerifiable = true
  perLayer[l2].purposeGap != null  → inProcessVerifiable = false
  perLayer[l3].purposeGap == null  → E2E in-process 가능
  perLayer[l3].purposeGap != null  → 외부 의존성 필요, CI 에서만
```

**주의**
- [MUST] baseliner 가 `inProcessVerifiable=false` 를 읽으면 해당 계층은 worktree 에서 자동 실행 불가 → CI-only 로 라우팅.
- [SHOULD] `purposeCheck` 문자열은 "어떤 실제 dep 을 어떻게 쳤는가"를 명시 (단순 "pass" 금지).

---

## 4. E2E: 프레임워크·타이밍·CI

**이 파일이 소유**: E2E 프레임워크 선택, 타이밍/대기 전략, CI 훅, 샤딩/병렬화, 여정 조직.

**이 파일이 defer**: 셀렉터 전략(getByRole > data-testid > XPath), a11y 검증 방식, React 런타임 패턴 → [toss-frontend-fundamentals a11y-basics §테스트로 접근성 강제하기](../../toss-frontend-fundamentals/references/a11y-basics.md).

### 프레임워크 기본값

| 스택 | 기본 | override 조건 |
|---|---|---|
| 웹 (모든 언어) | Playwright | Cypress 가 이미 mature 하게 운용 중이면 유지 |
| 모바일 웹 | Playwright (모바일 viewport) | 네이티브 앱이면 Detox/XCTest |
| 스크린리더 | Playwright + axe-core | — |

**Playwright 선택 근거**: 자동 대기 로케이터(flake 원천 감소), trace viewer, --shard 기본 지원, 무료 병렬화.

### 타이밍/대기 전략

**원칙** — `waitForTimeout(ms)` 는 [MUST] 금지. 상태 전이를 기다리는 올바른 형식:

```typescript
// ❌ 고정 sleep — 느리고 flaky
await page.waitForTimeout(2000);

// ✅ 조건 대기 — Playwright 자동 재시도
await expect(page.getByRole('status')).toHaveText('저장됨');
await page.getByRole('button', { name: '제출' }).click();
await expect(page.getByRole('alert')).toBeVisible();
```

자동-waiting 로케이터가 없는 곳(WebSocket, 폴링): `waitForResponse` / `waitForFunction` 사용, timeout 은 명시적으로.

### CI 라우팅

```
L3 E2E 는 PR/CI 에서만 실행 (--layer l3 또는 full suite).
로컬 pre-commit 에서는 실행하지 않는다.
--changed 플래그: e2e/ 또는 journey-bearing path 변경 시만 L3 포함.
```

### 샤딩/병렬화

```bash
# Playwright 샤딩 (CI 매트릭스)
npx playwright test --shard=1/4
npx playwright test --shard=2/4
# ...

# nextest 파티셔닝 (Rust)
cargo nextest run --partition count:1/4
```

**주의**
- [MUST] E2E 는 journey-gated. 사용자 여정이 없는 PR(내부 유틸 수정 등)에는 L3 를 강제하지 않는다.
- [SHOULD] E2E fixture/seed 는 idempotent 하게 — 동일 입력 → 동일 결과, 병렬 샤드 간 충돌 없음.
- [NIT] Playwright trace 는 CI 실패 시 artifact 로 업로드 — `.zip` 로컬 열기로 재현 가능.

---

## 5. CLI/API 여정 하네스

**원칙** — 웹 UI 없는 프로덕트(CLI 도구, HTTP API, gRPC 서비스)의 L3 여정은 Playwright 대신 언어 기본 harness 로 구성한다.

### 패턴 표

| 스택 | 컴파일 기동 | HTTP 어설션 | 비고 |
|---|---|---|---|
| Go | `os/exec` + `net/http/httptest` | `net/http` + `io.ReadAll` | 서버를 goroutine 으로 기동 |
| Rust | `assert_cmd` crate / `escargot` | `reqwest` (tokio::test) | `assert_cmd::Command::cargo_bin` |
| Python | `subprocess` + `httpx` | `httpx.Client` | `pytest` fixture 로 서버 생명주기 |
| JS/TS | `execa` + `supertest` | `supertest(app)` | express/fastify 인스턴스 직접 |

**Go 예시 — HTTP API 여정**
```go
//go:build e2e

func TestPaymentJourney(t *testing.T) {
    srv := startTestServer(t) // httptest.NewServer
    c := &http.Client{}

    // 1. 장바구니 생성
    cart := mustPost(c, srv.URL+"/carts", `{"userId":"u1"}`)
    // 2. 상품 추가
    mustPost(c, srv.URL+"/carts/"+cart.ID+"/items", `{"sku":"A","qty":2}`)
    // 3. 결제
    receipt := mustPost(c, srv.URL+"/orders", `{"cartId":"`+cart.ID+`"}`)
    require.Equal(t, "PAID", receipt.Status)
    require.NotEmpty(t, receipt.OrderID)
}
```

**Rust 예시 — CLI 여정**
```rust
#[test]
fn test_export_journey() {
    let assert = Command::cargo_bin("myapp")
        .unwrap()
        .args(["export", "--format", "json", "--output", "/tmp/out.json"])
        .assert();
    assert.success();
    let out = std::fs::read_to_string("/tmp/out.json").unwrap();
    let v: serde_json::Value = serde_json::from_str(&out).unwrap();
    assert_eq!(v["status"], "ok");
}
```

**왜**
- 브라우저 없이 실제 바이너리/서버를 기동해 purpose-fidelity 보장.
- Playwright 오버헤드(Chromium 번들) 없이 빠른 E2E.
- CI 에서 Docker 없이 돌릴 수 있어 infra 단순.

**주의**
- [MUST] 서버 기동 후 ready-check 필수 (포트 listen 확인 후 요청) — `waitForPort` 유틸 또는 재시도 루프.
- [SHOULD] 여정 테스트는 단계별로 주석("1. 장바구니 생성", "2. 결제") — 실패 시 어느 단계인지 즉시 식별.
- [NIT] 각 여정 테스트는 독립 서버 인스턴스 또는 DB teardown 으로 격리.

---

## 로드 규율

이 파일은 다음 상황에서만 연다:
- L2 테스트가 mock 만 쓰는 것으로 의심될 때
- purposeGap / inProcessVerifiable 필드를 채워야 할 때
- E2E 프레임워크·타이밍·샤딩 설정이 필요할 때
- 웹 UI 없는 E2E harness 패턴이 필요할 때

셀렉터·a11y 질문이면 [toss-frontend-fundamentals a11y-basics](../../toss-frontend-fundamentals/references/a11y-basics.md) 를 열고 이 파일은 닫는다.
