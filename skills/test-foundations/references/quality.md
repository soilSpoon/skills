# quality.md — 품질 축: 실제 exercise · 결정론 · 격리 · 실제 의존 · fail-loud

> **이 파일의 목적**: test-foundations의 **품질 축(quality axis)** 기법을 생태계 무관 공통어로 정리한다.
> `purposeGap` 필드의 의미와 검증자(verifier)의 fraud-role feed, 그리고 `fail-loud` 단언이
> code-fundamentals §진단 가능성을 테스트 설계로 이어받는 방식을 다룬다.
>
> 속도 축(speed axis)은 [speed.md](speed.md) | flake 제거는 [flake.md](flake.md) |
> L2/L3 실제 환경 세팅은 [real-env.md](real-env.md) | verify 엔트리 계약은 [verify-contract.md](verify-contract.md)

---

## §1 실제 exercise — vacuous green 을 구별하는 법

**원칙**: 테스트는 **변경된 동작을 관찰 가능하게 exercise** 해야 한다.
커버리지 숫자가 아니라 *무엇을 단언하느냐*가 품질이다.

### 세 가지 vacuous green 패턴

| 패턴 | 증상 | 고치는 방법 |
|---|---|---|
| **실행만 함** | `expect(fn()).not.toThrow()` — 반환값·부작용 단언 없음 | 관찰 가능한 출력·상태변화를 단언 |
| **stub 만 테스트** | 모든 의존이 mock, 실제 코드 경로 0% | L2 에서 실제 dep 사용 (→[real-env.md](real-env.md)) |
| **통과 전제 단언** | `expect(true).toBe(true)` 수준 — 어떤 변경도 빨개지지 않음 | invariant 를 명명하고 그 조건을 단언 |

**변경된 줄이 실제로 exercise 되는가?** — 가장 단순한 자가 점검.
변경 후 테스트를 *일부러 빨갛게 만들 수 있어야* 진짜 exercise 다.
mutation check 가 저렴하게 가능한 Rust 스택에서는 `cargo-mutants`(nextest 기반)로 자동 확인한다.

---

## §2 결정론 — 시간 · 난수 · 네트워크 고정

**원칙**: 같은 코드, 같은 입력 → **항상 같은 결과**.
비결정론은 품질 신뢰를 깎고 flake 의 주 원인이다.

### 2-1 시간 고정

| 생태계 | 권장 도구 | 주의 |
|---|---|---|
| JS/TS | `vi.useFakeTimers()` (Vitest) / `jest.useFakeTimers()` | `afterEach`에서 반드시 `vi.useRealTimers()` 복원 |
| Python | `freezegun` (`@freeze_time`) / `time-machine` | pytest-xdist 와 함께 쓸 때 seed 격리 확인 |
| Go | `injectable clock` 패턴 (`clock.Clock` 인터페이스 주입) | `time.Now()` 직접 호출 금지 — 인터페이스로 추상화 |
| Rust | 시스템 시간 의존 구조체에 `SystemTime` 주입 패턴 | cargo-mutants 사용 시 fake clock 과 조합 |

### 2-2 난수 고정

- **항상 seeded**. 테스트에 `Math.random()`, `random.random()`, `rand::random()` 직접 호출 금지.
- Python pytest-randomly + pytest-xdist 조합 주의: xdist 는 공유 seed 를 worker 별 분기 없이 쓰면
  worker 간 순서 비결정이 생긴다 → **worker 별 seed** (`PYTHONHASHSEED=$WORKER_ID`) 를 명시한다.

### 2-3 네트워크 금지 (L1 이하)

**[MUST]** L1 (유닛 테스트) 에서 live network 호출 금지.
인터셉터(nock, `httpretty`, `httpmock`, `mockito`) 또는 인터페이스 주입으로 차단한다.
L2 에서만 실제 의존을 맞이한다(→[real-env.md](real-env.md)).

```text
Before: L1 테스트가 실제 DB URL 에 연결 시도 → CI 환경 따라 pass/fail 변동
After:  L1 은 repository 인터페이스 mock, L2 에서 testcontainers Postgres 사용
왜:     L1 을 빠르고 결정론적으로 유지 + L2 에서 실제 의존 목적 달성
```

---

## §3 격리 / teardown — 테스트 간 상태 오염 방지

**원칙**: 각 테스트는 **선행 테스트 결과에 무관하게** 동일하게 동작해야 한다.
상태 공유는 flake 의 두 번째 주 원인이다(→[flake.md §1](flake.md)).

| 계층 | 격리 단위 | 도구/기법 |
|---|---|---|
| L1 | 테스트 함수 | 가변 전역 회피; `beforeEach`/`setup`/`Drop` 복원 |
| L1 Rust | **프로세스 격리** | `cargo nextest run` — 프로세스별 테스트, 공유 상태 불가 |
| L2 | 컨테이너 | Testcontainers: 테스트 실행마다 fresh 컨테이너 (→[real-env.md §1](real-env.md)) |
| L3 | 브라우저 컨텍스트 | Playwright `browser.newContext()` per-test; 쿠키·localStorage 자동 격리 |

**teardown 누락은 silent 오염** — 통과한 테스트가 뒤따르는 테스트를 오염시키고,
단독 실행 시엔 pass, 전체 실행 시엔 fail 하는 패턴(order-dependence)으로 나타난다.
→ flake 분류·수정은 [flake.md §3](flake.md) 참조.

---

## §4 실제 의존 > fake at L2 — purposeGap 이 측정하는 것

**원칙**: L2(기능/통합) 테스트는 **실제 의존**(Postgres, Redis, Kafka, HTTP 엔드포인트)을
맞닿아야 한다. Mock 만 사용한 L2 는 purpose-fidelity 가 없다 — 더 빠른 L1 이 할 일을
L2 에서 mock 으로 반복하는 것이다.

### purposeGap 필드

`scripts/verify.sh --json` 의 각 레이어 NDJSON 에는 `purposeGap` 필드가 있다:

```jsonc
// 실제 의존 O → purposeGap: null
{"layer":"l2","purposeGap":null,"...":"..."}

// mock 만 사용 → purposeGap: 서술 문자열 (diagnose 신호)
{"layer":"l2","purposeGap":"L2 mocks DB — no real dep","...":"..."}

// 계층 자체 부재 → purposeGap: 부재 이유 문자열
{"layer":"l2","purposeGap":"L2 absent — module seams unverified against real deps","...":"..."}
```

`purposeGapCount`(aggregate 라인)는 이 필드가 non-null 인 레이어 수이며,
diagnose 리포트의 **품질 축 부채 지표**로 쓰인다 (목표: 0).

### purposeGap 이 verifier fraud-role 에 공급되는 방식

slice 의 검증자(verifier)는 `purposeGap` 필드와 `inProcessVerifiable` 필드를
BASELINE 에서 읽어 fake-green 판별에 쓴다:

- Testcontainers 실제 컨테이너 확인 → `inProcessVerifiable: true` (recorded-real bytes 재현 가능)
- Live API 또는 사람 인증 필요 → `inProcessVerifiable: false`
- `purposeGap` non-null → 검증자가 해당 레이어를 **신뢰 불가** 신호로 플래그

이 흐름은 verify-contract.md §8 에 전체 BASELINE 파생 표로 정리되어 있다.

---

## §5 fail-loud 단언 — invariant 를 명명한다

**원칙 (code-fundamentals §진단 가능성 상속)**: 단언 메시지는 *무엇이 깨졌는지*가 아니라
**어떤 invariant 가 위반됐는지**를 명명해야 한다.

### Before / After

```python
# Before — 뭐가 왜 잘못됐는지 모름
assert result == 5

# After — invariant 를 명명
assert result == 5, (
    "invariant: selected_count == rendered_checkboxes; "
    f"expected 5 got {result}"
)
```

```typescript
// Before
expect(count).toBe(5)

// After
expect(count).toBe(5) // 메시지 추가:
// "invariant: selectedCount === renderedCheckboxes — expected 5, got ${count}"
```

**왜 나아지는가**:
- 빨개진 테스트가 *어떤 invariant 를 깨뜨렸는지* 즉시 드러난다 — 소스를 뒤질 필요 없음
- 회귀 테스트가 issue-rootcause 의 handoff 와 직접 연결된다 (→[recurrence.md §2](recurrence.md))
- 단언 메시지 = 테스트 외부 문서화 없이도 의도 전달

### 불가능한 상태를 표현 불가능하게 (fixture 설계)

```typescript
// Before: invalid 조합(선택=0, 표시=5)이 fixture 에 들어올 수 있음
function makeState(selected: number, rendered: number) { ... }

// After: invariant 위반 조합을 fixture 생성자에서 차단
function makeState(selected: number, rendered: number) {
  if (selected < 0 || selected > rendered) {
    throw new Error(
      `invariant violation: 0 <= selected <= rendered; got selected=${selected} rendered=${rendered}`
    )
  }
  ...
}
```

**[MUST]** 테스트 fixture 가 invalid 조합을 허용하면, 해당 테스트는 invariant 를
박제하지 못하고 단지 코드를 실행한 것에 불과하다.

---

## 요약 체크리스트

- `[MUST]` L1 에 live network 없음 — 인터셉터/인터페이스로 차단
- `[MUST]` fail-loud: 단언 메시지가 invariant 를 명명함 (`"invariant: X; expected N got M"`)
- `[MUST]` teardown 누락 없음 — 순서 의존 flake 의 주 원인
- `[MUST]` L2 에 실제 의존 사용 — mock-only L2 는 `purposeGap` non-null 부채로 기록
- `[SHOULD]` 시간·난수 고정 (freezegun / vi.useFakeTimers / injectable clock)
- `[SHOULD]` pytest-xdist 쓴다면 worker 별 seed 명시
- `[SHOULD]` 변경 후 일부러 테스트를 빨갛게 만들 수 있는지 확인 (mutation self-check)
- `[SHOULD]` Rust 스택 — cargo-mutants 로 mutation quality 확인

---

> **참조 연결**:
> flake 분류·수정 → [flake.md](flake.md) |
> Testcontainers 세팅 · purposeGap 설정 방법 → [real-env.md](real-env.md) |
> purposeGap NDJSON 구조·BASELINE 파생 → [verify-contract.md](verify-contract.md) |
> issue-rootcause invariant 를 회귀 테스트로 박제 → [recurrence.md](recurrence.md) |
> a11y 셀렉터·E2E 셀렉터 → [toss-frontend-fundamentals a11y-basics §테스트로 접근성 강제하기](../../toss-frontend-fundamentals/references/a11y-basics.md)
