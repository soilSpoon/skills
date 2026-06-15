# Flake — 품질×속도 두 축을 동시에 갉아먹는 문제

**flaky test는 품질 문제이면서 동시에 속도 문제다.**  
실패했다가 재시도 하면 성공하는 테스트는 *품질 신뢰성*을 0으로 만들고(RED=진짜 버그인지 모름),  
재시도 비용은 *속도 신뢰성*을 갉아먹는다(재시도 = '시간+품질 이중 비용').  
retry는 치료가 아니라 부채의 은폐다 — flake는 **측정하고, 드러내고, 근원에서 제거**한다.

---

## §1 Flake 분류 (원인부터 알아야 고친다)

아래 다섯 클래스가 실전 flake의 거의 전부를 덮는다.

| 클래스 | 증상 | 대표 예 |
|---|---|---|
| **순서 의존** | 특정 테스트 실행 순서에서만 실패 | 글로벌 변수·싱글턴이 이전 테스트에 오염됨 |
| **공유 상태** | 병렬 실행 시만 실패, 단독 실행은 통과 | DB/캐시/파일/큐의 공유 레코드 충돌 |
| **타이밍/클럭** | CI에서만 실패, 로컬은 통과 | `new Date()` / `time.Now()` / `setTimeout` 비결정론 |
| **네트워크** | 외부 API 응답 지연·실패로 간헐 실패 | L1에서 live HTTP 호출, DNS 타임아웃 |
| **리소스 풀 포화** | 부하가 높은 CI에서만 실패 | 스레드 풀·커넥션 풀·컨테이너 포트 고갈 |

> **왜 분류가 먼저인가** — 증상("CI에서 가끔 빨개")만 보면 retry 설정을 건드리게 된다.  
> 원인 클래스를 식별하면 retry 없이 근원에서 차단하는 경로가 보인다.

---

## §2 정직한 측정 — flake를 숨기지 않는다

**원칙: `verify.sh --json` 은 flake를 절대 retry로 은폐하지 않는다.**

`verify.sh`가 `--json` 모드에서 L0·L1이 RED일 때 취하는 행동:

1. 레이어를 한 번 **격리 재실행**한다 (동일 환경, 동일 플래그).
2. 재실행에서 GREEN으로 뒤집히면 → `flake:true`, `flakeRuns:2`, **exit는 1 그대로** 유지.
3. 두 번 모두 RED → `flake:false`, `flakeRuns:2`, exit 1.
4. 재실행은 **L0/L1에만**, L2/L3는 인프라 비용이 크고 pool-saturation flake는 격리 재실행으로 판별이 안 됨.

```jsonc
// --json 출력 예시: flake가 감지된 L1
{"layer":"l1","tool":"vitest","present":true,"passed":false,
 "durationMs":510,"flake":true,"flakeRuns":2,
 "tests":{"run":214},"purposeGap":null,"exit":1,...}

// aggregate: flakeRatePct = flaky layers / present layers * 100
{"summary":true,"passed":false,"flakeRatePct":50.0,"redLayers":["l1"],...}
```

**[MUST]** `flake:true`여도 gate는 RED다. "재실행에서 통과했으니 OK" 처리 금지.  
**[MUST]** `flakeRatePct > 1.0`은 즉각 backlog 등록 신호 — 임계 목표는 **≤ 1%**.

**왜 exit를 1 그대로 두는가** — 슬라이스 엔진은 exitCode 0/non-zero로 게이트를 분기한다.  
flake를 통과시키면 엔진이 "green이니 다음 단계로" 진행해버린다.  
flake는 신뢰성 채무(backlog)로 보고되어야 하지 '이번엔 괜찮음'으로 사라지면 안 된다.

---

## §3 근원 제거 — 클래스별 처방

### 3-1 순서 의존 flake

**Before:** 테스트 A가 글로벌 레지스트리를 오염시키고, 테스트 B가 그 상태를 의존한다.  
**After:** 각 테스트가 레지스트리를 `beforeEach`/`setup`·`defer`로 초기화·정리한다.

처방:
- 난수 시드 기반으로 **실행 순서를 섞어** 순서 의존을 표면화: `pytest-randomly`, `vitest --sequence.shuffle`.
- `cargo nextest`는 프로세스-퍼-테스트 격리라 기본적으로 글로벌 상태 누수가 차단됨.
- 테스트가 "단독으론 통과, 전체 스위트엔 실패"할 때 → `pytest --lf`·`vitest --reporter=verbose`로 오염원 테스트를 역추적.

**[MUST]** `--shuffle`/`--randomly`는 CI 기본 플래그로 추가한다. 로컬에선 결정론, CI에선 섞기가 아니라 **둘 다 섞는다**.

### 3-2 공유 상태 flake

**Before:** 병렬 워커 8개가 같은 DB 테이블 행을 동시에 insert → unique constraint 충돌.  
**After:** 각 테스트가 격리된 DB (Testcontainers fresh container, 또는 트랜잭션 롤백).

처방:
- L2: **Testcontainers per-run fresh container** — 같은 테스트가 자체 DB를 가짐, 공유 상태 원천 차단.
- `pytest-xdist`의 `--dist=worksteal` + per-worker 임시 DB 네임스페이스: `db_name = f"testdb_{worker_id}"`.
- `pytest-randomly` + `xdist`를 함께 쓸 때: **xdist는 per-worker 시드 설정**이 필요 (`pytest-randomly`의 global seed는 worker 간 공유 충돌). `RANDOMLY_SEED=<fixed>` 또는 per-worker 픽스처에서 `random.seed(worker_index)`.
- Go: `testcontainers-go` + `t.Parallel()` 조합, 각 parallel test가 own container.

**[SHOULD]** 파일 시스템 공유도 확인 — `/tmp/fixture.json`처럼 하드코딩된 경로는 병렬에서 충돌.  
`os.MkdirTemp`·`t.TempDir()`·`tmp_path` (pytest) 로 **테스트별 임시 디렉토리**를 쓴다.

### 3-3 타이밍/클럭 flake

**Before:** `setTimeout(fn, 100)` + `await sleep(150)` — CI 부하에 따라 간헐 실패.  
**After:** 가짜 클럭으로 시간을 주입·제어.

처방:

| 스택 | 처방 |
|---|---|
| JS/TS | `vi.useFakeTimers()` (Vitest) / `jest.useFakeTimers()` |
| Python | `freezegun.freeze_time` / `time-machine` |
| Go | 인터페이스 `Clock` 주입, 테스트에서 `fakeclock.NewFakeClock(fixed)` |
| Rust | `tokio::time::pause()` + `tokio::time::advance()` / 인터페이스 주입 |

**[MUST]** L1에서 `time.Sleep`·`asyncio.sleep`·`time.sleep`의 **실제 대기는 금지** — 항상 가짜 클럭이나 `clock.Advance`.  
**[MUST]** `Date.now()` / `datetime.now()` 직접 호출은 L1에서 테스트 불가 — 주입 가능한 시계로 래핑.

### 3-4 네트워크 flake

**원칙: L1 아래에 live network는 없다.**

처방:
- JS/TS: `vi.mock`·`msw` (Mock Service Worker) — 네트워크 레이어를 인터셉트.
- Python: `responses`·`httpretty`·`pytest-httpserver` — `requests`·`httpx` 모킹.
- Go: `net/http/httptest.NewServer` — in-process HTTP 서버.
- Rust: `wiremock` crate — `MockServer::start()` per-test.

live network가 반드시 필요한 검증은 **L2**로 격상 — L2는 Docker/real-dep의 영역이다.

**[MUST]** L1 테스트에서 DNS 조회·TCP 연결이 일어나면 그 테스트는 계층 분류가 잘못된 것.

### 3-5 리소스 풀 포화 flake

이 클래스는 격리 재실행으로 잘 드러나지 않는다 — CI 병렬도가 낮을 때 로컬에서 재현이 안 된다.  
MailKit의 pool-saturation 사례: 전체 `.xctest` 스위트를 `swiftpm-testing-helper`로 루프 돌렸을 때만 표면화됨.

처방:
- **풀 크기를 명시적으로 제한**: DB 커넥션 풀 `max=N`을 테스트 환경에서 1-2로 줄여 포화를 로컬 재현.
- **포트 충돌**: `net.Listen(":0")`(Go) / `server.bind(("", 0))`(Python) — OS가 빈 포트 할당.
- **컨테이너 수 제한**: `testcontainers` 병렬 실행 시 `Ryuk` reaper에 max-alive 설정.
- `nextest --test-threads N` 으로 병렬도를 낮춰 포화 여부 확인.

**[SHOULD]** CI 환경의 CPU/메모리 제약을 파악하고, 병렬 워커 수를 `--jobs`·`-n auto`가 아닌 **명시적 상한**으로 캡핑한다.

---

## §4 격리(Quarantine) 정책

flake를 **즉각 수정**하기 어려울 때 gate를 막지 않도록 격리하되,  
격리는 **임시 조치**다 — 영구 은폐가 되는 순간 flake는 죽은 코드와 같다.

**[MUST] 격리 규칙:**
1. 격리 시 반드시 **소유자 + 기한**을 달아라: `@flaky owner=@alice due=2026-07-01 reason="pool-saturation under investigation"`.
2. 격리된 테스트는 `--json` aggregate의 `purposeGapCount`에 포함시키거나 별도 카운터로 추적 — **보이지 않게 만들지 않는다**.
3. 기한 초과 시 격리 태그가 아닌 **삭제 또는 수정** — 기한 없는 격리 태그는 허용하지 않는다.
4. `flakeRatePct > 1%`는 팀 백로그 최상위 항목으로 에스컬레이션한다.

**Before:** `@Ignore` / `xit` / `#[ignore]` 를 달고 잊음 → 테스트가 영구 비활성화.  
**After:** `@flaky(owner="alice", due="2026-07-01")` + backlog 카드 + 2주 안에 근원 제거.

**왜 기한을 강제하는가** — 격리된 테스트는 'false floor': 커버리지는 있어 보이지만 실제론 검증하지 않는다. 기한이 없으면 팀은 거짓 안도감을 가지고 리그를 방치한다.

---

## §5 탈출한 flake = 재발 seam

flake가 격리·수정되지 않고 프로덕션까지 탈출했다면,  
그건 단순 flake가 아니라 **invariant 누락**이다 — issue-rootcause 핸드오프로 처리한다.

핸드오프 흐름:
1. issue-rootcause가 invariant를 발굴한다 ("입력이 경계값일 때 race condition 발생").
2. **test-foundations recurrence seam**: 그 invariant를 가장 저렴하게 잡는 계층(보통 L1/L2)에 failing-then-green 회귀 테스트로 박제한다.
3. 같은 버그 클래스가 **두 번** 탈출하면 개별 테스트가 아닌 **guardrail**(린트 규칙·타입 제약·코드모드)로 에스컬레이션한다.

→ 재발 seam의 전체 프로토콜: [`recurrence.md`](recurrence.md) 참조.  
→ invariant 발굴 원칙: issue-rootcause-workflow의 `principles.md` 참조 (link-only, 여기서 발췌 안 함).
