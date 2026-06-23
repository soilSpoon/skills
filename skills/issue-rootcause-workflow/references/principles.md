# 6 Principles for Root-Cause Investigation

## 목차

1. Invariant 명문화
2. Workaround vs Root fix 의식
3. A/B with smallest reliable repro
4. 가설이 도달했는지 검증
5. 모순 신뢰 — 실험 먼저 의심
6. 최근 변경 + 두 path 대조
7. Mechanism trace > blind variation
8. Variable enumeration & causal mapping (모든 원칙의 prerequisite)
9. 측정 도구·관측 대상 의심 — false negative 의 출처
10. 통합 체크리스트
11. 메타: 메인테이너 한 줄 질문

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

### 함정: 변형 공간이 좁으면 N round 가 모두 같은 답을 반복

A/B 가 효력을 발휘하려면 *변형 공간이 충분히 넓어야* 한다. 흔한 실패: 표면적 변수 (구조 크기, 메서드 개수, 옵션 flag) 만 enumerate 하고 *암묵적 변수* (호출/링크 순서, file/TU 분리 boundary, lazy vs eager, format combo, 시점 결정) 는 무시. 같은 axis 에서 N 점 swap 해도 답은 그 axis 가 결정 변수일 때만 나온다.

- [ ] 변형 공간 정의 시: **표면 변수 + 암묵 변수** 둘 다 list. 암묵 변수 후보:
  - 빌드/링크 순서 (eager vs lazy, archive 분리)
  - file/TU boundary (분리 단위가 결정에 영향)
  - format combo (LTO bitcode vs native object 같은 cross-format)
  - lifecycle/시점 (init 시점, lazy-resolve, JIT vs AOT)
  - scope (whole-program vs per-TU)
- [ ] 5+ round 변형이 모두 0 결과면 *변형 axis 자체* 를 의심 — 다른 axis 로 옮기거나 #7 mechanism trace 로 전환

이번 OCCT/wasm-ld 사례: 21+ round 동안 vtable size, RTTI, multi-level inheritance, 30 forward types 등 *표면 변수* 만 변형. 결정적 변수는 *암묵* 했던 link order (eager driver TU + lazy base archive). axis 자체를 못 짚어서 부피로 회피.

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

### "한계 도달" 결론도 모순 신호

자기가 *"한계에 부딪쳤다"* 고 결론짓는 순간이 가장 중요한 모순 신호다. 표준 패턴 (C++ vtable, ABI, archive linking, file format protocol 등) 으로 작동하는 시스템에서 *generic 합성이 불가능하다* 는 결론은 거의 항상 잘못이다. 표준 패턴이면 정의상 흉내 가능 — 못 흉내냈다는 건 *내가 결정 변수를 못 짚은 것*.

- [ ] "X-specific 이라 generic 으로 안 됨" 결론 직전 — *내가 시도한 변형 공간 list* 을 적고, *내가 안 건드린 axis* 가 무엇인지 1분 self-check
- [ ] "시간 한도라 한계" — 진짜 한계인지, 다음 *결정적 단일 step* 이 보이는지 self-check. 결정적 단일 step 이 보이면 그건 한계 아니고 회피.

이번 OCCT/wasm-ld 사례: "21+ round 모두 0 → OCCT-specific 결정" 결론 직전. 사용자가 "표준 C++ 인데 흉내 가능해야" 한 줄이 모순 신호 catch → mechanism trace 로 전환 → 1.5h 안에 답.

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

## 7. Mechanism trace > blind variation (단계 3·4 의 우선순위 결정)

### 정의

**source 가 알려져 있으면 표면 변형 N번 시도하기 전에 직접 mechanism trace 가 빠르다.** OSS toolchain (LLVM, V8, CPython, lld, glibc 등) 처럼 source 접근 가능한 시스템에서, *어느 단계에서 분기되는지* `errs() << ` 한 줄 patch + rebuild + dump 면 결정적 답. blind 변형은 답을 향한 우회로 — variation space 가 정확히 정의됐을 때만 효율적.

### 발동 신호

- A/B 변형 5+ round 모두 0 결과 — 변형 공간이 좁거나 axis 가 잘못
- "X-specific 이라 generic 으로 안 됨" 결론 직전
- "한계" / "여기까지" / "더 이상 시도할 게 없음" 결론 직전
- *source 가 알려진* 시스템인데 변형 시도만 반복
- "21 round 시도했으니 충분" — 부피로 노력 합리화

### 4 anti-pattern (variation 차원의 회피 패턴 — 변수 차원의 enumeration 패턴은 #8 참조)

#### A. Mechanism trace 미루기

source 알면서 *간접 변형* 만 시도. trace 가 결정적인 경우에도 reproducer 만 굴림.

```diff
- # 21 round 동안 Handle template, vtable size, multi-driver 변형
- # 모두 0 결과 → "한계" 결론
+ # 1 round: lld/wasm/SymbolTable.cpp 의 handleSymbolVariants 에 errs() 패치 + rebuild
+ # workbench dump → "sig=()->void in bitcode side, sig=(i64,i64)->void in native side"
+ # mechanism 식별 → minimal 합성 (1.5h 안)
```

#### B. "X-specific" 결론 빠르게

표준 패턴 (vtable, ABI, linking, format spec) 이면 정의상 흉내 가능. *흉내 못 했다 = 내가 결정 변수를 못 짚었다* 가 default. "이 시스템 specific 해서" 라는 결론은 게으른 답.

```diff
- # 21 round 모두 0 → OCCT 가 unique 한 무엇이 있다고 결론
+ # 21 round 모두 0 → 내가 본 변형 axis 가 잘못. 표준 패턴이면 흉내 가능해야 함.
+ # → mechanism trace 로 결정 변수 식별
```

> 변형 axis 자체가 좁았던 *진단* 은 #8 anti-pattern A (변수로 인식 안 함) — variable enumeration 차원에서 다룸. #7 의 #B 는 *결론 받아들이기 전 self-check* 에 초점.

#### C. 외부 push 없이 멈춤 (구 D)

"한계 도달" 결론은 *진짜 한계인지 게으름인지* self-check. 다음 *단일 결정적 step* 이 보이면 한계 아니고 회피. 사용자/외부 push 없이도 그 step 에 진입할 수 있어야 함.

```diff
- # "21 round 모두 0. 시간 한도. 한계." → 사용자에게 보고
- # 사용자: "OCCT-free 여야 돼"
- # → 다시 시도
- # 사용자가 push 한 만큼만 진전, push 안 했으면 그만뒀을 것
+ # "21 round 모두 0" 시점에 self-check:
+ # - source 접근 가능한가? → mechanism trace
+ # - "X-specific" 결론은 합리적인가? → 표준 패턴이면 의심
+ # - 다음 단일 결정적 step 이 보이는가? → 보이면 그게 한계 아님
+ # 위 self-check 후에도 step 안 보이면 *그때* 진짜 한계
```

#### D. 부피로 노력 합리화

"21 round 시도" 같은 부피로 *충분히 했다* 결론. 그러나 *같은 변형 공간 내 N 점* 은 회피의 다른 형태. *N 다른 axis* 가 아니다.

```diff
- # "Handle template 6 변형 + vtable size 5 변형 + multi-driver 4 변형 = 15 round"
- # → 부피 충분, 한계 결론
+ # 15 round 의 axis 분석:
+ # - 모두 'derived TU 의 surface composition' axis
+ # - 안 건드린 axis: link order, archive composition, format combo
+ # → 다른 axis 로 1 round 시도
```

> 변수와 값 혼동 (vtable size 4/30/31 = 1 axis 의 3 값) 의 detail 은 #8 anti-pattern B 참조. #7 의 #D 는 *부피로 self-justify* 하는 행동에 초점.

### 적용 방법

- [ ] **5+ round 0 trigger** — variation 5+ round 모두 0 이면 *axis 자체* 의심. 다음 round 전 *변형 axis list* 적고 *안 건드린 axis* enumerate
- [ ] **Mechanism trace 임계** — source 가 알려졌고 5+ variation round 0 이면 *direct trace 로 전환*. trace 비용 (clone + build + patch + rebuild) 보다 *N 추가 round* 가 비싼지 비교
- [ ] **"X-specific" 결론 self-check** — 그 결론 적기 전에 *표준 패턴 list* 와 비교. 표준 패턴이면 흉내 가능 → 내가 못 짚은 변수 의심
- [ ] **"한계" 결론 self-check** — *다음 단일 결정적 step* 이 보이면 한계 아님. 안 보이면 한계
- [ ] **부피 vs 다양성** — N round 의 axis 분포. 같은 axis 면 다른 axis 로 이동

### Mechanism trace 의 전형적 비용 vs 가치

| 시스템 | clone | build | dump patch | total |
|---|---|---|---|---|
| LLVM/lld (sparse checkout) | 5분 | 30분 | 1줄 errs() | ~45분 |
| V8 | 30분 | 1시간 | DEBUG flag | ~1.5시간 |
| CPython | 5분 | 3분 | printf | ~10분 |
| Linux kernel module | 5분 | 30분 | printk | ~45분 |

비교: 1 variation round = 5–30분 (build + run + analyze). **5+ round 가 0 trigger 면 mechanism trace 가 항상 더 빠름**.

### 트레이드오프

- Mechanism trace 가 항상 가능하지 않음. proprietary system, source unavailable, build infrastructure 없을 때 fallback to variation
- 그러나 *대부분 의 OSS 환경* 에서는 trace 가능. clone + build 가 *생각보다* 빠름 (LLVM lld만은 1시간 안에 가능)
- "변형 더 시도" vs "trace 시도" 결정 시 *비용 비교* 명시화 — 막연히 "변형이 더 쉬워 보이는데" 가 아니라 시간 추정

### 외부 push 없이도 진행할 의지

이 워크플로 자체가 anti-pattern 인 것 — *내가 한계 결론* → *사용자가 push* → *다시 시도* → *답 발견*. 사용자 push 가 매번 필요하면 워크플로 실패. 진짜 mechanism trace 가 *내 default move* 가 되어야 한다. self-check 항목:
- "이 결론 (한계/X-specific) 을 사용자가 push 안 했으면 받아들였을 텐가?"
- "내가 *지금* 식별 가능한 다음 결정적 step 이 있는가?"
- 답 yes 면 그 step 진행. 답 no 면 진짜 한계.

---

## 8. Variable enumeration & causal mapping (단계 0 — 모든 원칙의 prerequisite)

### 정의

**분석 시작 전에 *시스템 동작에 영향 주는 변수* 를 명시적으로 enumerate 하고, 각 변수가 *어떤 mechanism 으로 trigger 에 영향 주는지* causal chain 가설을 1줄 적는다.** 매 round 마다 list 가 *완전한지* 의심한다.

이 원칙은 #1–#7 모두의 prerequisite. invariant 도 *어떤 변수에 대한* invariant 인지, A/B 도 *어떤 변수* swap 인지, mechanism trace 도 *어느 변수가 결정적인지* 가설 위에 작동. variable list 자체가 부족하면 모든 다음 원칙이 헛돈다.

### 발동 신호

- 분석 시작 시점 — *항상* 1단계여야
- variation 5+ round 0 결과 — list 자체 부족 의심 신호
- "이 변수만 다르고 결과 같다" 결론 직전 — 못 본 변수 가능성
- 새 system 분석 — 익숙하지 않을수록 list 빠뜨릴 위험

### Variable taxonomy (8 카테고리)

분석 시작 시 매 카테고리 훑어서 *변할 수 있는 것* 적기. 모르겠으면 "?" 로 적어둠 (그것도 진전).

| 카테고리 | 예시 |
|---|---|
| **Surface** | 옵션 flag, 파라미터 값, 데이터 크기, 카운트 (vtable slot 수, method count) |
| **Composition** | 클래스 계층, vtable layout, RTTI macro, type 구성 |
| **Order** | call/dispatch 순서, init 순서, **link 순서**, build 순서, evaluation 순서 |
| **Boundary** | file/TU 경계, 모듈 경계, **archive 경계**, namespace, scope 경계 |
| **Format/medium** | **LTO bitcode vs native**, text vs binary, sync vs async, JSON vs binary protocol |
| **Lifetime/timing** | **lazy vs eager**, JIT vs AOT, init 시점, scope (per-TU vs whole-program) |
| **Linkage/visibility** | static vs dynamic, hidden vs default, weak vs strong, external vs internal |
| **Environment** | OS, locale, time zone, hardware, env var, config |

이번 OCCT case 에서 *13 round 모두 Surface + Composition* 만 변형. **Order (link 순서) + Boundary (archive 분리) + Format (LTO bitcode ↔ native) + Timing (lazy vs eager)** 가 결정적이었지만 변수 list 에 *없었다*.

### Causal chain 가설 (변수 → mechanism → 결과)

각 변수마다 *이 변수가 어떤 mechanism 으로 어떤 결과* 인지 1줄 가설. 가설 없이 변형하면 결과 0 일 때 *왜 0 인지* 추론 불가.

**예 (OCCT case 의 정답 변수)**:
- 변수: `link order` (eager driver TU + lazy base archive)
- Mechanism: SymbolTable 가 placeholder undefined sig 를 *first non-null sig* (eager native wasm) 로 attach → 후에 다른 sig (lazy archive) add 시 mismatch → variant
- 결과: variant 30개 → handleSymbolVariants → 30 mismatch warnings

이런 mapping 이 있으면 변형 결과 해석 가능. 없으면 *값만 던지고 받기*.

### 5 anti-pattern (이번 OCCT case 에서 직접 발현)

#### A. 변수로 인식 안 함 (Unrecognized variable)

13 round 동안 link order, archive composition 자체가 *변수 list 에 없었다*. enumerate 못 한 변수는 시도 못 함.

```diff
- # 변수 list: vtable size, RTTI, inheritance level, forward type, driver count
- # → Surface + Composition 만 enumerate
+ # 변수 list 확장:
+ # - Surface: vtable size, RTTI, ...
+ # - Order: link order, init order
+ # - Boundary: archive composition, file/TU split
+ # - Format: LTO bitcode ↔ native cross-format
+ # - Timing: lazy vs eager linking
+ # → Order axis 에서 trigger 발견
```

#### B. 변수와 값 혼동

"vtable size 4/30/31 변형" 은 *변수 1개의 N 값*. 별개 변수가 N 개가 아님. 부피 N 으로 보이지만 실제로는 axis 1.

```diff
- # 13 variations = "13 variables" 로 자기 합리화
+ # 13 variations = "1 axis 의 13 점" — diversity 없음
+ # axis 다양성 = 카테고리 다양성, 값 다양성 아님
```

#### C. Causal mapping 부재

"vtable size 늘리면 trigger 될지도" — 가설 없는 시도. 늘려서 0 결과 시 *왜 0 인지* 추론 못 함.

```diff
- # "vtable size 30 으로 늘려보자" → 0 → "더 늘려보자"
+ # 가설: vtable size 가 trigger 라면 mechanism 은 ?
+ # → 못 적으면 그 변형 무의미. mechanism 가설 없는 variation = blind.
```

#### D. 변수 list 갱신 안 함

5 round 0 결과 = list 부족 의심 신호. 그런데 같은 list 로 6, 7, 8 round. 새 결과를 *list 의 정합성 evidence* 로 쓰지 않고 *값 fail evidence* 로만.

```diff
- # Round 5 0 → "vtable size 더 늘려보자" (같은 list)
- # Round 10 0 → "RTTI 추가" (같은 list)
+ # Round 5 0 → variable list 자체 의심
+ # → taxonomy 8 카테고리 재훑기 → 빠뜨린 카테고리 발견
```

#### E. Self-doubt 부재

"내가 본 변수가 진짜 다인가?" 자기점검 없음. 사용자/외부 push 가 self-doubt 강제 → "이 결론 push 없이도 받아들였을지?" 항상 self-check.

### Self-doubt protocol

N round 0 결과 시점에 다음을 *적어서* 자기점검 (속으로만 하면 회피 쉬움):

1. **내가 변형한 axis 들** (카테고리별): ___
2. **taxonomy 8 카테고리 중 안 건드린 것**: ___
3. **시스템에 본질적으로 영향 주는데 변수로 인식 안 한 것**: ___ (예: 이번 OCCT 의 link order)
4. **다른 system 의 비슷한 bug case 에서 결정적이었던 변수**: ___ (검색/회상)
5. **외부 push 없이도 "내 변수 list 가 완전" 이라고 결론지을 자신** 있나: y/n

### 적용 방법

- [ ] 분석 시작 시 *variable taxonomy* 8 카테고리 훑기 (10분)
- [ ] 각 카테고리에서 *변할 수 있는 것* 적기 (모르면 "?")
- [ ] 각 변수에 *causal chain 가설* 1줄 (변수 → mechanism → 결과)
- [ ] 매 5 round 마다 list 재검토 — 새 변수 후보 brainstorm
- [ ] N round 0 결과 시 self-doubt protocol 5문항 *적어서* 답하기

### 트레이드오프

- variable enumeration 10–30분. trivial bug 에 과잉.
- 그러나 *5+ round 0 trigger* 시점에서 enumeration 비용 < N 추가 round. 거의 모든 serious bug 에 worth.
- taxonomy 8 카테고리가 *모든* domain 에 정확히 맞지는 않음. 익숙하지 않은 domain 이면 *해당 domain 의 taxonomy* 학습 우선 (예: networking bug → protocol/timing/topology, ML bug → data/model/optimizer/hyperparameter).

### 이번 OCCT 사례 — 변수 list 누락 분석

| Round | 변형 변수 | Category | 결과 |
|---|---|---|---|
| 1–6 | Handle template 모양 (trivial vs non-trivial) | Surface/Composition | 0 |
| 7–8 | vtable size (4, 30, 31) | Surface | 0 |
| 9 | RTTI macro 유무 | Composition | 0 |
| 10 | multi-level inheritance | Composition | 0 |
| 11 | 30 different forward types | Composition | 0 |
| 12 | 17 driver classes | Composition | 0 |
| 13 | Forward declared T + dtor anchor | Composition | 0 |

13 round 의 axis 분포: *Surface 2, Composition 11*. **Order, Boundary, Format, Timing, Linkage = 0**.

자가 점검을 round 5 시점에 했다면:
- "내가 본 5 변수 다 surface/composition. order/boundary/format/timing 카테고리 0 — 누락"
- → round 6 부터 *order axis* (link sequence) 시도
- → 1 round 에 답

실제로는 13 round 후 사용자 push (외부 self-doubt 강제) → trace 후 발견. **anti-pattern E (self-doubt 부재)** 가 가장 비용 컸다.

---

## 9. 측정 도구·관측 대상 의심 — false negative 의 출처 (단계 3·4 의 전제)

### 정의

**"변화 없음 / repro 안 됨" 결론은 거의 항상 *측정 도구가 굶었거나* *엉뚱한 관측값을 봤기* 때문이다. 결과를 받아들이기 전에 측정 자체를 의심한다.**

#5(모순 신뢰)의 특수형이자 강화형이다. #5는 "결과가 사전지식과 충돌하면 실험 셋업을 먼저 의심"이라 했다 — 그 *실험 셋업에는 측정 도구와 관측값 선택이 포함*된다. false **positive**(없는 효과를 봄)는 #4(도달 검증)가 잡고, false **negative**(있는 효과를 못 봄)는 이 원칙이 잡는다. A/B(#3) 결과를 믿으려면 그 측정이 유효해야 한다.

### 발동 신호

- "측정해보니 안 변하더라 / 애니메이션 없더라 / 차이 없더라" → 결론 직전
- 정적 스냅샷(동작 *끝난 뒤* 스크린샷·로그 한 장)으로 *과정*을 판정하는 중
- 측정 도구가 피측정 시스템과 *같은 자원*을 공유 (메인스레드 폴러로 메인스레드 막힘 구간 측정, 앱 이벤트루프 위의 계측, 샘플링 주기에 aliasing 되는 프로파일러)
- 샘플 분포가 듬성·불균등 (무거운 구간에 샘플 0개 = 도구가 굶은 증거)
- "이 속성은 안 변한다"로 끝냈는데 *그 속성을 변하리라 가정*했을 뿐

### 적용 방법 (false negative 결론 직전)

- [ ] **도구가 confound 인가** — 내 측정 채널이 피측정 시스템과 독립인가? 같은 스레드/루프/클럭을 공유하면, *관측하려는 바로 그 바쁜 순간*에 도구가 굶어 표본을 잃는다
- [ ] **confound 밖 도구로 1회 재측정** — 피측정 시스템 *바깥*에서 캡처. 브라우저면 CDP 스크린캐스트(compositor/브라우저 프로세스)·비디오 녹화·큐잉되는 DOM 이벤트(`transition*`/`animation*` 는 메인스레드가 풀릴 때 순서대로 배달). 일반화: tcpdump(앱 밖), 외부 샘플러, 하드웨어 트레이스
- [ ] **관측값 enumerate** — 가정한 속성 하나만 보지 말 것. 위치/스크롤/transform/opacity/size/visibility 중 *실제로* 무엇이 변하는지 나열해 측정. "width 고정"이 "안 움직임"은 아니다 (위치·ancestor scroll 로 움직일 수 있다)
- [ ] **의심 API 를 패치해 호출자 특정** — recompile 못 하는 런타임에선 #7 의 `errs()`+rebuild 대신 *프로토타입 메서드 monkeypatch + stack trace*. `scrollIntoView`/`scrollTo`/`focus`/`addEventListener` 등을 감싸 호출 시점·인자·스택을 덤프하면 "누가 이걸 호출했나"가 결정적으로 잡힌다

### 안티패턴 → 개선

```diff
- // rAF 로 패널 폭을 샘플 → 360px 고정 → "애니메이션 없음"
- const loop = () => { samples.push(el.getBoundingClientRect().width); requestAnimationFrame(loop); };
+ // rAF 는 메인스레드 — WASM 부팅·무거운 리렌더 중 굶어 중간 프레임 누락(false negative).
+ // 1) confound 밖 캡처: CDP Page.startScreencast (브라우저 프로세스가 프레임 생성)
+ // 2) 옳은 관측값: width 아니라 left 좌표 + 부모 scrollLeft 를 본다
+ //    → 폭은 고정인데 left 가 -100→64 로 슬라이드, region.scrollLeft 384→0 으로 확인
```

```diff
- // "스크롤이 어디서 일어나지?" → 코드 grep 으로 추정
+ // 의심 API 를 패치 + stack trace 로 *실제* 호출자 특정 (recompile 불가 런타임의 mechanism trace)
+ const orig = Element.prototype.scrollIntoView;
+ Element.prototype.scrollIntoView = function (...a) {
+   console.log(new Error().stack); return orig.apply(this, a);
+ }; // → 호출자 = 채팅 자동스크롤 useEffect 라고 결정적으로 드러남
```

### 트레이드오프

- confound-free 측정이 더 비싸다 (CDP 세팅, 프레임 저장, 패치 주입). 그러나 *false negative 1회의 잘못된 결론* (→ 잘못된 fix·"버그 없음" 종결) 이 훨씬 비싸다.
- 브라우저는 한 도메인일 뿐 — 일반 원리는 **"측정 채널이 피측정 시스템과 독립인가"**. 네트워크(앱 이벤트루프 위 계측 vs tcpdump), 프로파일러(샘플 주기 aliasing), 로깅(버퍼링돼 crash 시 유실), 분산 추적(클럭 skew) 모두 같은 함정.
- 사용자/리뷰어가 "그건 동작 끝난 뒤 측정 아니냐"고 push 하면 — 그 push 없이도 측정 유효성을 의심했어야 한다 (#7 의 self-check 와 동일 정신).

### 이번 사례 — 워크벤치 레이아웃 가로 밀림

처음엔 rAF 로 *폭만* 재고 "좌측 패널 360px 고정 → 우측 도크와 결합 없음"이라 오판. 사용자가 "스크린샷은 동작 끝난 뒤라 그렇다"고 push → confound 밖 도구(CDP 스크린캐스트)로 재측정하니 좌측 콘텐츠가 잘려 슬라이드. *옳은 관측값*(left 좌표·부모 scrollLeft)을 보니 left −100→64, region scrollLeft 384→0. `scrollIntoView` 패치+stack 으로 호출자가 채팅 자동스크롤(`ConversationContent` useEffect)임을 특정. 워크드 케이스: [case-browser-layout-shift.md](case-browser-layout-shift.md).

---

## 10. 통합 체크리스트

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

**Mechanism trace 우선순위 (#7)**
- `[MUST]` 5+ variation round 가 0 trigger 면 변형 axis list 적고 안 건드린 axis enumerate
- `[MUST]` source 접근 가능한 시스템에서 5+ round 0 이면 *direct mechanism trace 시작* (errs() 패치 + rebuild + dump)
- `[MUST]` "X-specific" 또는 "한계" 결론 직전 *다음 단일 결정적 step* 이 있는지 self-check
- `[SHOULD]` 변형 axis 가 표면 변수 (size, count) 만이 아니라 암묵 변수 (link order, file boundary, format combo, 시점) 도 포함하는가
- `[SHOULD]` "사용자 push 없이도 받아들였을 결론인가" self-check

**Variable enumeration & causal mapping (#8)**
- `[MUST]` 분석 시작 시 *variable taxonomy* 8 카테고리 (Surface / Composition / Order / Boundary / Format / Timing / Linkage / Environment) 훑었는가
- `[MUST]` 각 변수에 *causal chain 가설* (변수 → mechanism → 결과) 1줄 적었는가
- `[MUST]` N round 0 결과 시 *self-doubt protocol 5문항* 적어서 답했는가 (속으로만 ❌)
- `[SHOULD]` 변형 부피가 *axis 다양성* 인지 *값 다양성* 인지 점검 (anti-pattern B: 변수와 값 혼동)
- `[SHOULD]` 5 round 마다 변수 list 재검토하고 새 후보 brainstorm 했는가

**측정 도구·관측 대상 (#9) — false negative 결론 직전**
- `[MUST]` "변화 없음 / repro 안 됨" 결론 전에 *측정 도구가 피측정 시스템과 자원을 공유해 굶지 않았는지* 의심했는가 (메인스레드 폴러로 메인스레드 막힘 구간 측정 등)
- `[MUST]` confound *밖*의 도구로 1회 재측정했는가 (CDP 스크린캐스트·비디오·큐잉 이벤트·외부 샘플러)
- `[MUST]` 가정한 속성 하나가 아니라 *변할 수 있는 관측값*을 enumerate 했는가 (위치/스크롤/transform/opacity/size — "width 고정 ≠ 안 움직임")
- `[SHOULD]` 동작 *끝난 뒤* 정적 스냅샷이 아니라 *과정*을 캡처했는가
- `[SHOULD]` 호출자 미상이면 의심 API 를 패치 + stack trace 로 특정했는가 (recompile 불가 런타임의 mechanism trace)

---

## 11. 메타: 메인테이너 한 줄 질문

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
