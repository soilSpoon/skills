# 4계층 모델 — 각 계층이 소유하는 것, 피라미드 경제, 계층 결정 트리

> **로드 조건** — 어느 계층에 어떤 변경을 배치할지 판단이 필요할 때, 또는 새 레포에
> 리그를 처음 구성할 때 연다. 배치가 자명하면 SKILL.md 본문만으로 충분하다.

---

## §1 네 개의 계층 = 네 개의 질문

각 계층은 "이 소프트웨어의 어떤 속성을 확인하는가?"라는 질문에 하나씩 대응한다.
**신뢰 = 품질 × 속도** — 두 축 모두 계층마다 다른 지점에 위치한다.

| 계층 | 한 문장 목적 | 품질 축 역할 | 속도 축 역할 | 언제 실행 |
|------|------------|------------|------------|---------|
| **L0** 품질 게이트 | 구조적 정확성 바닥 — 형식·린트·타입 | 잘못된 상태를 타입·구문 경계에서 막음 (가장 싼 사기 방지) | 변경 파일만 검사, sub-second; 전체-프로젝트 린트는 통합 넷에 둠 | 저장 / pre-commit, staged 파일 범위 |
| **L1** 유닛 | 순수 로직과 invariant 검증 | 변경 라인 실재 exercise; 결정론; 단언이 invariant 를 명명 | 빠름 + 병렬(-n auto / --partition / 패키지별 캐시) | 저장 / pre-commit, affected 범위 |
| **L2** 기능/통합 | 모듈 경계가 실제 의존성에서 성립함 | 실제 dep (Testcontainers DB/Redis/Kafka); mock 이 숨기는 것을 잡음; purposeGap 의 핵심 | 느림 (컨테이너 기동); push 시 실행; --changed 는 통합 경로 변경 시만 포함 | push, 통합 경로 변경 시 |
| **L3** E2E | 사용자 여정 end-to-end | 최고 purpose-fidelity; 실 API 경로 검증; purposeGap 이 live vs stub 을 구분 | 가장 느림 (Playwright / CLI 하네스); shard; PR/CI 전용; 여정 경로 변경이 아니면 --changed 에서 제외 | PR / CI, 여정 존재 시에만 |

**verify.sh 가 이 열여섯 칸을 한 계약 뒤에 숨긴다.** 도구 선택은
`verify.detect.sh` 데이터 테이블에 있고, slice 는 `measureCommand`/`filterCommand` 만
본다 (계약 상세 → [verify-contract.md](verify-contract.md)).

---

## §2 피라미드 경제 — 주 레버는 계층 배치

**같은 동작을 어느 계층에서 검증하느냐**가 두 축을 동시에 결정한다.
이것이 "계층 분포"가 가장 강력한 레버인 이유다.

```
실패 모드 A — 전부 E2E
  품질 OK, 시간 최악 → 40분 스위트 → 아무도 안 돌림 → 시간 신뢰성 0

실패 모드 B — 전부 heavy mock 유닛
  빠름 OK, purpose 결손 → mock 이 통과시키는 버그가 L2/L3 에서야 드러남 → 품질 신뢰성 0

올바른 분포
  L0  변경 파일 lint/type     : 항상, sub-second
  L1  빠르고 결정론적 로직     : 항상, affected, 병렬
  L2  본질적으로 통합인 것만   : push 시, 실 dep
  L3  사용자 여정이 있을 때만  : PR/CI 시, journey-gated
```

**Before (전부 통합 테스트로 덮음)**
```
tests/
  integration/  # 70개 테스트, 컨테이너 기동 포함
    unit_like_tests.py   # 순수 로직인데 여기 있음
    db_tests.py
```
- `git push` 마다 5분 대기 → 빠른 피드백 불가

**After (계층 분리)**
```
tests/
  unit/         # L1: 빠른 것들, 순수 로직
  integration/  # L2: 실 DB 필요한 것만
```
- 저장 시 L0+L1 → 10초, push 시 L2 → 2분

**왜 나아지는가**
- 같은 신뢰 수준을 훨씬 싼 비용으로 달성한다.
- 느린 계층은 "언제 돌릴지"가 명확해진다 — 레이어 라우팅 (→ [speed.md §3](speed.md)).
- purposeGap 이 계층별로 측정된다: 빠른 계층이 녹색이어도 L2 absent 는 debt 로 표시됨.

---

## §3 계층 결정 트리

**Q1 선점 질문** — 이 테스트가 필요한가?
scope-floor reflex 를 먼저 통과한다 (code-fundamentals §범위 바닥 상속):

1. stdlib 단언으로 되나? → 별도 테스트 불필요
2. 기존 테스트 인프라가 이미 다루나? → 새 테스트 불필요
3. invariant 가 있나, 아니면 코드만 덮나? → 코드 덮기 전용 테스트는 추가하지 않는다

**Q2 로직이 순수한가? (입력 → 출력, 외부 상태 없음)**
→ **L1 유닛** (vitest / pytest / go test / nextest)

예: 할인 계산, 날짜 포매팅, 파싱, 검증 함수

```python
# Before — L2 통합 테스트에 묻혀 있음 (너무 비쌈)
def test_discount_in_integration():
    db = get_real_db()
    user = db.get_user(1)
    assert calc_discount(user.tier) == 0.2

# After — L1 유닛으로 분리 (순수 함수이므로)
def test_discount_gold():
    assert calc_discount("gold") == 0.2
```

**Q3 모듈 경계가 실제 의존성(DB, HTTP, 큐)에 닿는가?**
→ **L2 기능/통합** (Testcontainers)

예: ORM 쿼리, HTTP 클라이언트 응답 파싱, 이벤트 발행

mock 만 있는 L2 는 purpose-fidelity 결손 → purposeGap:
`"L2 mocks DB — no real dep"` 으로 기록됨.

**Q4 사용자 여정이 존재하는가?**
`로그인 → 프로필 → 결제 → 영수증` 같은 흐름이 실제로 있을 때.
→ **L3 E2E** (Playwright / CLI harness)

내부 레이아웃 변경, 리팩토링, 라이브러리 표면 API 변경 = L3 불필요.

> **[MUST]** 위 결정 트리의 출력이 "L3" 이 아닐 때 E2E 를 강제하지 않는다.
> 여정 존재가 유일한 gate 다.

---

## §4 "E2E 1급 / 결국 필요"의 진짜 의미

블루프린트(scopeFloorStance)는 이렇게 구분한다:

> E2E 는 **여정-gated** 이지 **PR-gated** 가 아니다.

- "결국 필요" = 제품이 사용자 여정을 갖게 되면 필요하다는 것. *언젠가는* 맞다.
- "모든 PR 에 E2E 강제" = 10줄 변경에 E2E 추가는 [§11 비목표] 위반.
- diagnose 는 여정 없는 L3 absent 를 `purposeFidelity:"journey-gated"` 로 기록한다
  — debt 가 아니라 올바른 scope-floor 적용.

**journey-gated vs 실제 gap 의 구분 (diagnose 에서)**

| 상황 | purposeGap 값 | debt 인가? |
|------|--------------|----------|
| L2 없음, 코드가 DB 를 실제로 침 | `"L2 absent — module seams unverified against real deps"` | YES |
| L3 없음, 사용자 여정 없는 라이브러리 | `"no user journey wired — E2E deferred by scope-floor (not a gap if no journey)"` | NO |
| L3 없음, login→checkout 여정 존재 | `"no user journey wired — E2E deferred by scope-floor (not a gap if no journey)"` + proposals 에 L3 추가 제안 | YES (proposals 로) |

---

## §5 계층 간 pre-flight 체크리스트

새 테스트를 추가하기 전 세 가지:

```
(a) stdlib 단언이나 기존 helper 로 되나?    → 된다면 그걸로 끝낸다
(b) 기존 테스트 파일이 이미 이 케이스를 다루나? → 중복 추가 금지
(c) 이 테스트가 invariant 를 박제하나,
    아니면 구현 세부를 코드만 덮나?          → 코드 덮기만이면 추가하지 않는다
```

---

## 참조

- [verify-contract.md](verify-contract.md) — verify.sh 엔트리 계약 전문 (flags / exit codes / NDJSON)
- [quality.md](quality.md) — 품질 축 기법 (real exercise, determinism, isolation)
- [speed.md](speed.md) — 속도 축 기법 (changed-only, 병렬, 계층 라우팅)
- [real-env.md](real-env.md) — L2/L3 실 의존성, Testcontainers, purposeGap 파생
- [recurrence.md](recurrence.md) — issue-rootcause 에서 invariant 넘겨받아 L1/L2 회귀 테스트로 박제
