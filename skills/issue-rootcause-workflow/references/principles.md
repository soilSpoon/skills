# 6 Principles for Root-Cause Investigation

## 목차

1. Invariant 명문화
2. Workaround vs Root fix 의식
3. A/B with smallest reliable repro
4. 가설이 도달했는지 검증
5. 모순 신뢰 — 실험 먼저 의심
6. 최근 변경 + 두 path 대조
7. 통합 체크리스트
8. 메타: 메인테이너 한 줄 질문

각 원칙은 [SKILL.md](../SKILL.md)의 §워크플로 5단계 중 어느 단계에서 발동하는지 표시.

---

## 1. Invariant 명문화 (단계 1)

### 정의

**증상을 보기 전에, 자료구조·계약·상태가 무엇이 참이어야 하는지를 1문장으로 명문화한다.**

invariant: 어떤 시점에 항상 참이어야 하는 명제. 함수 진입/이탈, 자료구조 push/pop, 트랜잭션 commit/rollback 등 *경계*에서 가장 유용.

### 발동 신호

- crash · assertion failure
- 자료구조가 "비어있는데 비어있지 않아야 했다" / "차있는데 비어있어야 했다"
- 마이그레이션 후 데이터 카운트가 안 맞음
- "왜 이렇게 동작하지?" — 명문화된 기대치 없이 받아들이는 순간

### 적용 방법

- [ ] 망가진 자료구조/상태/계약을 1줄로 적기
- [ ] 정상 입력에서 그것이 어떻게 보존되는지 적기 (push N번 → pop N번 같은 균형)
- [ ] 문제 입력에서 그 보존이 어디서 깨지는지 짚기
- [ ] 깨진 이유를 다음 4차원 중 어느 것인지 분류:
  - **Ordering** — 호출 순서, dispatch 순서
  - **Counting** — push/pop 균형, ref count, transaction depth
  - **Ownership** — 누가 만들고 누가 지우나, lifecycle
  - **Visibility** — 어느 thread/context에서 보이나, memory model

### 안티패턴 → 개선

```diff
- // 그냥 죽지 않게 하자
- if (!stack.empty()) stack.pop();
+ // invariant: push N(catch) ↔ pop N(call_unwind) 균형
+ // 위반 원인: shared cleanup pad에서 try_table N개 → catch 1개로 push 부족
+ // root fix: catch 대신 END_TRY_TABLE에서 push해서 N:N 회복
```

### 트레이드오프

- invariant 명문화에 시간이 든다 (5–30분). 사소한 버그면 과잉.
- 가장 큰 효과는 *문서화된 invariant가 다음 회귀를 막는다*는 것. 코드 주석·테스트 케이스 이름·타입 시스템·schema에 invariant를 박아두면 시스템이 다음번에 자동으로 잡는다.

---

## 2. Workaround vs Root fix 의식 (단계 2)

### 정의

**둘 다 합법적 선택이지만 어느 걸 고르고 있는지 명시하고, 그 이유를 남긴다.**

| | Workaround | Root fix |
|---|---|---|
| 효과 | 증상 차단 | invariant 회복 |
| 위험 | 다른 자리에서 재발 가능 | 영향 범위 큼, 시간 듦 |
| 적절한 때 | 핫픽스, 외부 코드, 권한 없음, 마감 임박 | 자기 코드, 시간 있음, 같은 패턴 반복 |
| 수명 | 짧음 (다음 인접 변경에 깨질 수 있음) | 김 (invariant가 회복되어 신규 입력도 자동 처리) |

### 발동 신호

- "일단 막아놓자"는 충동
- 외부 라이브러리·OS·드라이버 버그 (자기 코드 아님)
- 마감이 임박
- 같은 패턴 버그가 N차로 등장 (이때 룰 변경: *이번엔 root fix 차례*)

### 적용 방법

- [ ] 코드 주석에 `WORKAROUND: <invariant 위반 한 줄> — root fix는 <위치/방법>` 적기
- [ ] 후속 이슈 만들고 주석에 링크
- [ ] PR description에도 "이 PR은 workaround입니다" 명시
- [ ] 같은 버그를 두 번째 만나면 룰을 바꿔서: *이번엔 root fix 차례*. workaround로 계속 덮으면 invariant가 영구적으로 휘어진다.

### 예시 (이번 LLVM 사례)

- 사용자 PR #192968 = `if (!empty())` 가드 추가 = workaround. PR 본문에 *"likely a workaround rather than a root fix"* 라고 본인이 명시 — **이게 바로 명시 패턴.**
- 메인테이너 PR #194184 = push 위치 이동 = root fix. invariant 회복.
- 둘 다 빌드 통과시키지만 root fix만이 다음 동일 패턴 버그를 막는다.

### 트레이드오프

- 모든 워크어라운드를 거부하면 deploy 못 한다. *명시된* 워크어라운드는 합법.
- 명시 없이 머지된 워크어라운드는 다음 인계자가 root fix인 줄 알고 위에 또 워크어라운드 쌓는다. 그래서 *주석 + 후속 이슈*가 핵심.

---

## 3. A/B with smallest reliable repro (단계 3)

### 정의

**가설을 증명하려면 한 변수만 다른 두 환경에서 결과를 비교한다. 작고 결정적인 repro(micro)와 현실적인 repro(macro) 둘 다.**

### 발동 신호

- "이 패치가 진짜 고치는지 검증해줘"
- "특정 환경에서만 발생"
- 회귀 의심
- "프로덕션 데이터로만 재현됨"

### 적용 방법

| 종류 | 목적 | 예시 |
|---|---|---|
| Micro | 결정성 — 1초 내, 결과 명확 | 단위 테스트, 리듀스드 .ll, curl 한 줄, 작은 fixture |
| Macro | 현실성 — 운영과 비슷한 환경 | 풀빌드, e2e 시나리오, 운영 traffic replay |

- [ ] Micro: 1초 내 끝나고 결과 명확
- [ ] Macro: 한 변수만 다름 (binary swap, env var toggle, feature flag)
- [ ] 첫 실패에서 멈추지 말고 전수 수집:
  - `ninja -k 0` (모든 실패 사이트까지 진행)
  - `pytest --maxfail=0` 또는 기본 (--maxfail 없으면 전수)
  - `cargo test --no-fail-fast`
  - `go test -failfast=false`

### 안티패턴 → 개선

```diff
- # 풀빌드만 돌려보고 "통과하니까 fix됨"
- ./build-everything.sh && echo "fixed!"

+ # micro 결정성 + macro 전수
+ # 1) reduced repro로 unfixed=crash, fixed=pass 결정성 확인
+ # 2) 풀빌드로 모든 사이트가 영향받는지 전수 (ninja -k 0)
+ # 3) 두 binary md5 차이로 실제 다른 buildl인지 확인
```

### 트레이드오프

- micro만 하면 "lab에선 되는데 prod에서 안 됨"
- macro만 하면 "통과한 것 같은데 사실은 그 path를 안 탐" (#4 도달 검증 안 한 경우, 이번 사례에서 발생)
- 둘 다 해야 진짜 증명이다.

---

## 4. 가설이 도달했는지 검증 (단계 4)

### 정의

**"옵션을 추가했다" ≠ "옵션이 관련 단계에 적용됐다". 가설이 시스템 안쪽으로 진짜 도달했는지 한 단계 더 trace한다.**

### 발동 신호

- "테스트는 도는데 실제로 안 고쳐짐"
- 환경변수 추가했는데 효과 없음
- feature flag 켰는데 동작 동일
- patch 적용했다 했는데 코드 path가 안 바뀜
- migration 적용했는데 row count 그대로

### 적용 방법

가설 → 도달 검증 매핑:

| 가설 | 도달 검증 방법 |
|---|---|
| compile flag 추가 | `gcc -###` / `clang -v` / `emcc -v` 로 cc1·런타임 명령 보기 |
| env var | 프로세스 안에서 echo, startup log, `/proc/<pid>/environ` |
| feature flag | 응답 헤더, profiler tag, debug log signature |
| patch 적용 | binary md5/sha 차이, `git diff HEAD~1`, symbol dump (`nm`, `objdump`) |
| 데이터 마이그레이션 | row count, sample row 비교, schema 메타데이터 |
| config reload | hot-reload 시그널 후 `/admin/config` 또는 endpoint diff |
| dependency 변경 | `npm ls`, `go mod why`, `cargo tree`, lockfile diff |

### 이번 사례 — 결정적 fail의 출처

- compile flag에 `-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0` 넣었다고 *생각*함
- 실제로는 `LINK_FLAGS`에만 넣어 cc1엔 default `-wasm-use-legacy-eh=true` 전달됨
- 결과: standardized EH 경로를 *한 번도 안 탐* → unfixed인데 통과 (false negative)
- 검증 명령: `emcc -v -c test.c 2>&1 | grep wasm-use-legacy` → `-mllvm -wasm-use-legacy-eh=0` 실제 도착했는지 출력에서 확인

이게 바로 "가설이 도달했는지" 한 단계 더 들어가지 않으면 false positive·false negative가 양쪽으로 발생하는 패턴.

### 트레이드오프

- 매번 도달 검증 하려면 시간이 든다. 빠른 iteration 때는 1차만 하고 결과가 *예상과 어긋날 때* 풀로 한다 (이때 #5와 결합).

---

## 5. 모순 신뢰 — 실험 먼저 의심 (단계 5)

### 정의

**결과가 사전지식과 충돌하면, 사전지식을 의심하기 전에 실험 셋업을 먼저 의심한다.**

### 발동 신호

- "이거 fail해야 하는데 pass했다"
- "이거 그렇게 동작할 리 없는데"
- "운영에선 안 되는데 staging에선 됨" (혹은 그 반대)
- "어제 같은 명령 했을 땐 다른 결과 나왔는데"
- "내 컴퓨터에선 됨"

### 적용 방법

- [ ] 결과를 *수용*하기 전에 **"내가 이걸 진짜 테스트한 게 맞나?"** 라고 적어본다
- [ ] 도달 검증 (#4)으로 실험이 의도된 path를 탔는지 확인
- [ ] 환경 차이 점검: 캐시, 빌드 산출물, 환경변수, 데이터 fixture, 시계, locale
- [ ] 그래도 모순이 남으면 *그때* 사전지식이 틀렸을 가능성 검토 (보통은 사전지식이 부정확했음)

### 이번 사례 — 모순 발견 직전·직후

- 첫 매크로 빌드: "unfixed 4618/4618 통과" — 사전지식("unfixed면 crash")과 모순
- 사용자 한 마디: *"지금 제대로 해본 거 맞아? `-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0`이면 문제 발생했었는데"*
- 이 한 줄이 false positive를 캐치해서 시간 수 시간을 절약. 모순을 *바로 신뢰한* 사용자가 한 일.

### 안티패턴 → 개선

```diff
- # "어, baseline이 통과하네. 그럼 fix가 옳다는 뜻이군."
+ # "baseline이 통과해서는 안 된다. 셋업이 잘못됐을 확률이 99%.
+ #  결과를 받아들이기 전에 도달 검증부터."
```

### 트레이드오프

- 모든 결과를 의심하면 progress 없음. 균형: *사전지식과 어긋날 때만* 즉시 셋업 의심.
- 사전지식이 없을 때 (낯선 코드베이스) 는 모순 신호가 약하다 — 이때 #6의 path 대조가 사전지식을 빠르게 만들어준다.

---

## 6. 최근 변경 + 두 path 대조 (단계 5의 cross-check)

### 정의

**ordering·dispatch 버그는 거의 항상 최근 commit이 trigger다. 그리고 같은 함수가 두 path를 처리할 때 한쪽만 깨졌다면 두 path의 차이가 곧 답이다.**

### 발동 신호

- "어제까지 됐는데 오늘부터 안 됨"
- 마이그레이션 중인 코드 (legacy vs new, v1 vs v2, sync vs async, 모드 A vs B)
- 같은 함수가 분기로 두 모드를 처리 (production vs dev, A/B test variant, region별)

### 적용 방법

**최근 변경**:
```bash
git log -p --since="6 months ago" path/to/suspect.cpp
git blame path/to/suspect.cpp | grep <fn-name>
git log --all --source -- path/to/suspect.cpp
git log -S '<changed signature or symbol>' --since='6 months ago'
```

관심: 함수 호출 *순서* 바꾼 commit, transform pass 추가, dispatch table 변경, ordering 키워드 (`reorder`, `move`, `swap`, `before`, `after`)

**두 path 대조**:
- 어떤 함수가 두 모드를 모두 처리하는데 한쪽만 깨짐 → 두 모드의 차이가 직접적 단서
- diff 두 분기를 시각적으로 그려보기 (트리, 박스, 화살표 — 종이 5분)

### 이번 사례

- aheejin은 자기가 만든 commit #187484가 `fixCallUnwindMismatches`를 `fixCatchUnwindMismatches` *뒤로* 옮긴 사실을 알고 있었음
- ordering 변경 → trampoline BB는 fixCatch가 만들고 fixCall이 처리해야 하는데 처리 안 함 → standardized EH에서만 터짐
- 외부 컨트리뷰터가 같은 단서에 도달하려면 `git log -p --since`로 이 commit을 봤어야 함

**두 path**: legacy EH (catch가 try 직후) vs standardized (catch는 trampoline BB로 분리). aheejin이 fix 본문에 *이 차이*를 명시 — "legacy는 X, standardized는 Y". 그래서 fix는 standardized path에서만 push 위치를 옮김.

### 트레이드오프

- 매 버그마다 6개월치 log 훑으면 비용 큼. *ordering·dispatch·transform pass* 같은 키워드가 의심될 때만.
- 두 path 대조는 마이그레이션 중인 코드에서 가장 강력. 단일 path만 있는 코드엔 #1·#4가 더 효율적.

---

## 7. 통합 체크리스트

조사를 끝맺기 전에 점검. 라벨은 최소 엄격도. (SKILL.md 본문과 동일.)

**Invariant (#1)**
- `[MUST]` 망가진 자료구조/계약/상태가 무엇인지 1문장으로 적었는가
- `[SHOULD]` 정상 입력에서 그게 어떻게 보존되는지 적었는가
- `[SHOULD]` 깨진 이유를 ordering / counting / ownership / visibility 중 어느 차원인지 분류했는가

**선택의 의식 (#2)**
- `[MUST]` 지금 fix가 "원인 제거"인지 "증상 차단"인지 PR/주석에 명시했는가
- `[MUST]` workaround면 "왜 root fix를 안 골랐는가" 사유 + 후속 이슈 링크가 있는가

**A/B 실험 (#3)**
- `[MUST]` 결정적인 minimal repro
- `[SHOULD]` 현실적인 macro repro
- `[MUST]` 한 번에 한 변수만 변경
- `[SHOULD]` 첫 실패에서 멈추지 말고 전수 수집

**도달 검증 (#4)**
- `[MUST]` 추가한 flag/config/patch가 실제로 적용된 단계에서 확인됐는가

**모순 처리 (#5)**
- `[MUST]` 결과가 사전지식과 다르면 결과를 수용하기 전에 실험 셋업을 먼저 의심했는가

**Cross-check (#6)**
- `[SHOULD]` 같은 함수/모듈의 다른 path는 통과하나? 차이는 무엇인가
- `[SHOULD]` 최근 6개월 git log에서 의심 영역 변경 commit을 봤는가
- `[NIT]` 모르겠으면 메인테이너에게 reduced repro와 함께 한 줄 질문

---

## 8. 메타: 메인테이너 한 줄 질문

PR 만들기 전 — 

> "X 자료구조가 Y 시점에 invariant Z를 깨는데, 의도한 동작인가요? reduced repro: <link>"

이 한 줄로 root fix 방향이 잡히는 경우가 많다. 시간을 *측정*하면 reduced repro 만드는 비용 < PR 만들고 거절당하고 다시 만드는 비용.

**채널 우선순위**:
1. 프로젝트 Discourse / Discord / Slack `#dev`
2. GitHub *issue* (PR이 아닌 issue로 시작)
3. 메인테이너 멘션 (마지막 수단 — 본인 시간을 강요)

**좋은 질문의 형태**:
- invariant를 명시 (`X.empty()`가 함수 끝에서 항상 true여야 한다고 이해했는데...)
- 깨지는 입력의 reduced repro (이상적으로는 1파일)
- 본인 가설 1줄 (틀렸어도 OK — 메인테이너가 정정해줌)
