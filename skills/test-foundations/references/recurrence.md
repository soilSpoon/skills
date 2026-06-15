# Recurrence — 탈출한 버그를 영구 회귀 테스트로 박제하기

**이 파일의 역할**: issue-rootcause-workflow가 발견한 invariant를 테스트 리그에 박아 넣는 handoff 계약을 정의한다 (reliability-system §6.4 recurrence seam).

---

## §1 Seam — 역할 분담

| | issue-rootcause-workflow | test-foundations (이 파일) |
|---|---|---|
| **소유** | invariant 발견·명문화, workaround vs root-fix, A/B repro | 발견된 invariant를 *회귀 테스트*로 박제, 가장 저렴한 계층 선택 |
| **입력** | 버그 증상·스택트레이스·최근 변경 | invariant 문자열 + 발동 조건 |
| **출력** | "invariant: X; 발동 조건: Y" 핸드오프 | 실패 → 녹색 전환 회귀 테스트 + 계층 판단 + (2회차) guardrail |

[issue-rootcause의 원칙 목록](../../issue-rootcause-workflow/references/principles.md)을 직접 가져오지 않는다 — 링크만, 발췌 금지.

**왜 분담하는가**: issue-rootcause는 *무엇이 깨졌는가*를 해석하는 언어를 소유한다. test-foundations는 *그 해석을 코드로 고착시키는* 언어를 소유한다. 두 역할을 한 컨텍스트에 섞으면 각각이 얕아진다.

---

## §2 핸드오프 템플릿

issue-rootcause가 단계 1(invariant 명문화)을 마치면 아래 템플릿을 채워 건넨다. test-foundations는 이 템플릿을 입력으로 받아 회귀 테스트를 작성한다.

```
Invariant from rootcause: <invariant 원문, 한 문장>
Trigger condition:        <재현에 필요한 최소 선행 조건>
Observed violation:       <실제로 어긴 값·상태>
Cheapest catching layer:  <L1 | L2 | L3 — 이유 한 줄>
Proposed test name:       <bare 토큰, /^[A-Za-z0-9_.-]+$/ — {scope} 주입 대상>
```

**예시**

```
Invariant from rootcause: 선택된 항목 수 == 렌더된 체크박스 수
Trigger condition:        items 배열이 비동기로 업데이트된 직후 count UI 를 읽을 때
Observed violation:       expected 5 got 3 (비동기 flush 전에 count 를 읽음)
Cheapest catching layer:  L1 (순수 로직 — flush 타이밍을 fakeClock 으로 고정 가능)
Proposed test name:       selectedCount.matchesRenderedCheckboxes
```

> [MUST] test name은 bare 토큰(영숫자·점·하이픈·언더스코어만)으로 확정한다.  
> recursive-slice.js:611의 엔진 가드(`/^[A-Za-z0-9_.-]+$/`)가 슬래시·공백이 있는 토큰을 차단한다 — 테스트 함수명 안에 이 토큰이 들어가야 `--scope <token>`이 실제로 매칭된다.

---

## §3 계층 선택 — 가장 저렴한 계층이 정답

**원칙**: 탈출한 버그를 잡는 계층이 여럿이면 *가장 아래* 계층에서 박제한다. 상위 계층은 느리고, 느린 테스트는 아무도 안 돌려 신뢰성이 증발한다.

| 버그 유형 | 권장 계층 | 이유 |
|---|---|---|
| 순수 로직 오류 (계산·상태 전이) | **L1** | mock 없이 함수 단위로 재현 가능 |
| 모듈 경계 오류 (DB 반환값 변환, HTTP 파싱) | **L2** | real dep 필요, L1에선 목이 현상 은폐 |
| 사용자 여정 조합에서만 재현 | **L3** | 계층을 낮출 수 없을 때만 |
| 타입·null 안전성 위반 | **L0** (type-check) | 컴파일 타임에서 막히면 테스트 불필요 |

**Before** (흔한 실수): 버그가 E2E에서 발견됐다고 L3 회귀 테스트를 작성한다.  
**After**: invariant를 분리해 L1/L2에서 재현 가능한지 먼저 확인한다. 가능하면 그 계층에 쓴다.

**왜**: L3 회귀 테스트는 ~수 분 → 누적되면 아무도 안 돌리는 스위트가 된다. L1에서 200ms면 항상 돌린다. 같은 invariant를 더 싼 계층에서 잡는 것이 신뢰성을 높인다.

---

## §4 escalation — 같은 버그 클래스가 두 번 탈출하면 guardrail로

**1회 탈출**: L1/L2 회귀 테스트 추가.  
**2회 탈출 (같은 클래스)**: 테스트를 넘어 *구조적 guardrail*로 에스컬레이션한다.

| 버그 클래스 | guardrail 형태 |
|---|---|
| null 역참조 | 타입에서 nullable 제거, strict null checks 강화 |
| 암묵적 타입 강제 | linter rule (L0) — CI에서 `--deny warnings` |
| 공유 상태 오염 | Testcontainers fresh-container-per-run 강제 (L2 설정) |
| 미검증 입력 경계 | 스키마 파서(zod/pydantic/serde) 신뢰 경계에 고정 |
| 특정 API misuse 패턴 | codemod (jscodeshift/libcst) 또는 custom lint rule |

> [SHOULD] guardrail은 테스트가 아니라 *패턴 자체를 표현 불가능하게* 만드는 장치다.  
> code-fundamentals §진단 가능성의 "불가능한 상태를 표현 불가능하게" 원칙을 테스트 설계에 적용한 것.

---

## §5 per-leaf commit + BACKLOG 기록

회귀 테스트를 추가한 뒤:

1. **failing commit** — 테스트만 추가, 아직 RED인 상태로 커밋 (`fix(test): add regression for <token>`).
2. **fix commit** — 실제 코드 수정, GREEN 전환. 별도 커밋으로 분리.
3. **BACKLOG 항목** — 에스컬레이션 대상이면 `BACKLOG: guardrail for <버그 클래스>` 카드를 만든다. 2회차가 아니라도 "guardrail이 있었다면 이 버그를 막았을까?"를 항상 묻는다.

slice 엔진이 per-leaf commit을 소비하는 방식: filterCommand `scripts/verify.sh --scope <token>`이 해당 회귀 테스트만 실행하고 exit 0을 돌려줄 때 그 leaf가 green으로 닫힌다.

---

## §6 flake로 탈출한 버그의 recurrence

flake가 prod까지 탈출했다면 그것도 하나의 escape다. 이 경우:

- issue-rootcause에 invariant를 등록한다 (버그가 숨어있던 flake 클래스 + 발동 조건).
- `flake.md §5` 링크를 참고해 fix-at-source를 선행한다.
- fix 이후 회귀 테스트가 deterministic한지 확인한다 — flaky 회귀 테스트는 아무 보장도 안 한다.

---

> **로드 규율**: 이 파일은 (a) issue-rootcause handoff 직후 또는 (b) 동일 버그 2회 탈출 감지 시만 연다.  
> 평상시 스캐폴드·진단 흐름에서는 불필요하다.
