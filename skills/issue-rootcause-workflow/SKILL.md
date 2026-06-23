---
name: issue-rootcause-workflow
description: 이슈·버그·회귀를 만났을 때 증상이 아닌 근본 원인까지 도달하기 위한 6원칙 워크플로 — invariant 명문화, workaround vs root fix 의식, A/B 검증(가설 도달 검증 포함), 모순 신뢰, 최근 변경 + 두 path 대조. 트리거 - (1) "이거 왜 안 되지", "버그 추적", "회귀 분석", "근본 원인 찾기", "rootcause", (2) "이 fix 검증해줘", "이 패치가 진짜 고치는지", "A/B 테스트", (3) compiler/runtime/lib/infra 패치 PR 리뷰, (4) "테스트는 통과하는데 실제론 안 됨" 같은 false positive 의심, (5) "옵션 추가했는데 효과 없음" 같은 가설-도달 의심, (6) workaround만 쌓이고 같은 버그가 반복되는 상황, (7) 인시던트 포스트모템·ADR 작성, (8) "측정했는데 변화 없음/repro 안 됨" 같은 false negative 의심 — 측정 도구가 굶었거나(메인스레드 폴러) 엉뚱한 관측값을 봤을 때, 정적 스냅샷으로 과정을 판정할 때. 컴파일러/런타임/인프라 한정이 아니라 자료구조 invariant·외부 시스템 호출·다단 toolchain·이중 경로 마이그레이션·UI 레이아웃·측정 신뢰성 어디든 적용.
---

# Issue Rootcause Workflow

## 핵심 철학

**증상을 막지 말고 invariant를 회복해라.** 같은 버그가 두 번째 돌아왔다면 첫 번째 fix가 root cause가 아니었다는 뜻이다. workaround와 root fix는 둘 다 합법적 선택이지만 *어느 쪽을 골랐는지 의식*하고 *그 이유를 남겨야* 다음 사람이 다시 root fix 차례를 가져갈 수 있다.

| # | 원칙 | 한 줄 |
|---|---|---|
| 1 | Invariant 명문화 | 무엇이 참이어야 하는가 → 왜 안 참인가 |
| 2 | Workaround vs Root fix | 둘 다 valid, 어느 걸 고르고 있는지 명시 |
| 3 | A/B with smallest reliable repro | micro(결정적) + macro(현실적), 한 변수만 swap |
| 4 | 가설이 도달했는지 검증 | "옵션 추가" ≠ "옵션이 관련 단계에 적용됨" |
| 5 | 모순을 신뢰 | 결과가 사전지식과 충돌 → 실험을 먼저 의심 |
| 6 | 최근 변경 + 두 path 대조 | git log + working/broken, before/after |
| 7 | Mechanism trace > blind variation | 표면 변형 5+ round 0 결과 → source patch + dump 로 전환. "X-specific"/"한계" 결론은 게으른 답. |
| 8 | Variable enumeration & causal mapping | 분석 시작 전 *어떤 변수* 가 시스템에 영향 주는지 8 카테고리 (Surface/Composition/Order/Boundary/Format/Timing/Linkage/Environment) 훑기. 각 변수에 causal chain 가설. **모든 원칙의 prerequisite** — list 가 부족하면 #1–#7 모두 헛돈다. |
| 9 | 측정 도구·관측 대상 의심 | "변화 없음/repro 안 됨"(false negative)은 *도구가 굶었거나*(메인스레드 폴러로 메인스레드 막힘 측정) *엉뚱한 관측값*(width 만 보고 위치 변화 놓침)이 원인. confound 밖 도구(CDP 스크린캐스트 등)로 재측정 + 관측값 enumerate + 의심 API 패치+stack. #5 의 false-negative 특수형. |

자세한 정의·발동 신호·체크리스트·트레이드오프는 [principles.md](references/principles.md).

## 워크플로 (6단계 + self-check)

```
0. VARIABLE-MAP    어떤 변수가 시스템에 영향 주는가?              → 원칙 #8
                   8 카테고리 훑기 + 각 변수에 causal chain 가설.
                   모든 다음 단계의 prerequisite.
1. INVARIANT       무엇이 참이어야 하는가? 어디서 깨졌는가?      → 원칙 #1
2. CHOICE          workaround vs root fix, 어느 걸 고르는가? 왜? → 원칙 #2
3. EXPERIMENT      smallest reliable repro 만들고 한 변수만 swap → 원칙 #3
4. VERIFY-ARRIVAL  가설(flag·config·patch)이 진짜 적용됐는지     → 원칙 #4
5. CROSS-CHECK     모순 있나? 최근 변경? 두 path 차이?           → 원칙 #5·#6
                   ↑ 모순 발견 시 0단계로 (변수 list 의심)
   AXIS-CHECK      변형 5+ round 0 trigger?                      → 원칙 #7·#8
                   → variable list 재검토 (#8 self-doubt protocol)
                   → source 가능하면 mechanism trace (#7)
                   ↑ "한계"/"X-specific" 결론 직전 강제 발동
```

각 단계에서 빠지지 않도록 체크리스트는 [principles.md](references/principles.md) 끝에 통합.

## 트리거 맵

리뷰·디버깅 중 아래 신호가 보이면 해당 원칙으로 들어간다.

| 신호 | 원칙 | 파일 |
|---|---|---|
| `if (!x.empty())` 가드, `try/catch` 무시, 매직 retry — "왜 그런 상태가 되는가"는 안 묻는 fix | #1·#2 | [principles.md #1·#2](references/principles.md) |
| 같은 버그가 다른 자리에서 재발 (fix 두 번째 본 패턴) | #1 (invariant 미회복) | [principles.md #1](references/principles.md) |
| "테스트는 도는데 실제로는 안 고쳐짐" / 운영에선 효과 없음 | #4 (도달 검증 누락) | [principles.md #4](references/principles.md) |
| "이거 fail해야 하는데 pass했다" / 결과가 사전지식과 충돌 | #5 (모순 → 실험 의심) | [principles.md #5](references/principles.md) |
| "어제까지 됐는데 오늘부터 안 됨" | #6 (최근 변경) | [principles.md #6](references/principles.md) |
| legacy/v1 vs new/v2 마이그레이션 중 한쪽만 깨짐 | #6 (path 대조) | [principles.md #6](references/principles.md) |
| PR 리뷰에서 "이 fix가 진짜 고치는지 검증해줘" 요청 | #3 (A/B) | [principles.md #3](references/principles.md) |
| 첫 실패에서 멈춰서 부분만 봄 | #3 (전수조사 — `ninja -k 0`, `pytest --maxfail=0`) | [principles.md #3](references/principles.md) |
| compiler/toolchain 패치 검증 (LLVM/V8/CPython 등 ABI 민감) | #3·#4 | [case-llvm-vtk.md](references/case-llvm-vtk.md) |
| **변형 5+ round 모두 0 결과** / "다 시도해봤는데 trigger 안 됨" | #7 (mechanism trace 로 전환) + #8 (변수 list 자체 의심) | [principles.md #7](references/principles.md), [#8](references/principles.md), [case-occt-wasm-ld.md](references/case-occt-wasm-ld.md) |
| **"X-specific 이라 generic 합성 불가능"** 결론 직전 | #7 (표준 패턴이면 흉내 가능 — 게으른 답 의심) | [principles.md #7](references/principles.md) |
| **"한계 도달" / "여기까지" / "더 시도할 게 없음"** 결론 직전 | #7 (다음 단일 결정적 step 자기점검) + #8 (self-doubt protocol 5문항) | [principles.md #7](references/principles.md), [#8](references/principles.md) |
| OSS toolchain (LLVM/lld/V8/CPython 등) 디버깅 — source 접근 가능 | #7 (variation 보다 errs() 패치 + rebuild 가 빠른 길) | [principles.md #7](references/principles.md) |
| **새 시스템/도메인 분석 시작** — 변수 list 처음 만드는 단계 | #8 (taxonomy 8 카테고리 훑기 + causal chain 가설) | [principles.md #8](references/principles.md) |
| **N round 변형 시도 후 "이 변수만 다르고 결과 같다"** 결론 | #8 (변수와 값 혼동 안티패턴 B — axis 다양성 vs 값 다양성) | [principles.md #8](references/principles.md) |
| 변형 시도가 *causal chain 가설 없이* 진행 — "vtable size 늘려보자" 같은 blind | #8 (변수 → mechanism → 결과 가설 강제) | [principles.md #8](references/principles.md) |
| **"측정했는데 안 변함 / 애니메이션 없음 / repro 안 됨"** 결론 직전 | #9 (도구가 굶었나 + 옳은 관측값인가 — false negative 의심) | [principles.md #9](references/principles.md), [case-browser-layout-shift.md](references/case-browser-layout-shift.md) |
| 측정 도구가 피측정 시스템과 *같은 자원* 공유 (rAF/메인스레드 폴러로 무거운 구간 측정, 앱 위 계측, 프로파일러 aliasing) | #9 (confound 밖 도구로 재측정 — CDP 스크린캐스트·tcpdump·외부 샘플러) | [principles.md #9](references/principles.md) |
| 동작 *끝난 뒤* 정적 스냅샷(스크린샷·로그 한 장)으로 *과정*을 판정 | #9 (과정 캡처 — 스크린캐스트·비디오·큐잉 이벤트) | [principles.md #9](references/principles.md) |
| 브라우저 런타임에서 "누가 이 API 를 호출하나" (recompile 불가) | #9·#7 (프로토타입 메서드 patch + stack trace = 런타임 mechanism trace) | [principles.md #9](references/principles.md), [case-browser-layout-shift.md](references/case-browser-layout-shift.md) |
| 인시던트 포스트모템 / ADR 작성 | (출력 형식) | [output-templates.md](references/output-templates.md) |

## 출력 형식 (조사 결과 보고)

조사 끝에는 항상 4섹션으로 정리:

```
**Invariant** — 무엇이 참이어야 했는가 (1줄)
**Violation** — 어디서 어떻게 깨졌는가 (file:line, 또는 단계명)
**Choice**    — workaround | root fix | both 중 무엇을 적용했고 왜
**Evidence**  — A/B 결과 표, 도달 검증 명령, 모순 해소 과정
```

이 4섹션을 PR 코멘트·ADR·인시던트 포스트모템·코드 주석 형식으로 변환하는 템플릿: [output-templates.md](references/output-templates.md).

## 통합 체크리스트

조사를 끝맺기 전에 점검. 라벨은 최소 엄격도.

**Invariant (#1)**
- `[MUST]` 망가진 자료구조/계약/상태가 무엇인지 1문장으로 적었는가
- `[SHOULD]` 정상 입력에서 그게 어떻게 보존되는지 적었는가 (push N → pop N 같은 균형)
- `[SHOULD]` 문제 입력에서 어디서 깨지는지 짚었는가 (ordering / counting / ownership / visibility)

**선택의 의식 (#2)**
- `[MUST]` 지금 fix가 "원인 제거"인지 "증상 차단"인지 PR/주석에 명시했는가
- `[MUST]` workaround면 "왜 root fix를 안 골랐는가" 사유 + 후속 이슈 링크가 있는가

**A/B 실험 (#3)**
- `[MUST]` 결정적인 minimal repro (.ll, 단위 테스트, 작은 스크립트)
- `[SHOULD]` 현실적인 macro repro (real workload)
- `[MUST]` 한 번에 한 변수만 변경 (binary swap, flag toggle)
- `[SHOULD]` 첫 실패에서 멈추지 말고 전수 수집 (`ninja -k 0`, `pytest --maxfail=0`)

**도달 검증 (#4)**
- `[MUST]` 추가한 flag/config/patch가 *실제로 적용된 단계*에서 확인됐는가 (`emcc -v`, `--print-config`, profiler tag, log signature, binary md5 차이)

**모순 처리 (#5)**
- `[MUST]` 결과가 사전지식과 다르면 결과를 수용하기 전에 실험 셋업을 먼저 의심했는가

**Cross-check (#6)**
- `[SHOULD]` 같은 함수/모듈의 다른 path는 통과하나? 차이는 무엇인가
- `[SHOULD]` 최근 6개월 git log에서 의심 영역 변경 commit을 봤는가 (`git log -p --since`)
- `[NIT]` 모르겠으면 메인테이너에게 reduced repro와 함께 한 줄 질문

**Mechanism trace 우선순위 (#7)**
- `[MUST]` variation 5+ round 모두 0 trigger 면 *변형 axis list* 적고 *안 건드린 axis* enumerate (표면 변수 외 암묵 변수: link order, file/TU boundary, format combo, 시점, scope)
- `[MUST]` source 가 알려진 OSS 시스템에서 5+ round 0 이면 *direct mechanism trace 로 전환* (`errs()` 패치 + rebuild + dump). variation 추가 round 비용 vs trace 비용 비교
- `[MUST]` "X-specific 이라 generic 합성 불가능" / "한계 도달" 결론 직전 *다음 단일 결정적 step* 이 보이는지 1분 self-check. 보이면 한계 아니고 회피
- `[MUST]` "사용자 push 없이도 받아들였을 결론인가" self-check — push 가 필요한 결론은 진짜 결론 아님
- `[SHOULD]` N round 의 *axis 분포* 점검 — 같은 axis N 점이면 다른 axis 로 이동

**Variable enumeration & causal mapping (#8) — 모든 원칙의 prerequisite**
- `[MUST]` 분석 시작 시 *variable taxonomy* 8 카테고리 (Surface / Composition / Order / Boundary / Format / Timing / Linkage / Environment) 훑기 — 모르면 "?" 라도 적기
- `[MUST]` 각 변수에 *causal chain 가설* (변수 → mechanism → 결과) 1줄 — 가설 없는 변형 = blind
- `[MUST]` N round 0 결과 시 *self-doubt protocol 5문항* 적어서 답 (속으로만 ❌)
  1. 내가 변형한 axis 들 (카테고리별)?
  2. 안 건드린 카테고리?
  3. 변수로 인식 안 한 것?
  4. 다른 system 의 비슷한 case 에서 결정적이었던 변수?
  5. 외부 push 없이도 "list 완전" 결론지을 자신?
- `[SHOULD]` 변형 부피 = *axis 다양성* 인지 *값 다양성* 인지 점검 (anti-pattern B: 변수와 값 혼동 — vtable size 4/30/31 = 1 axis 의 3 값)
- `[SHOULD]` 5 round 마다 변수 list 재검토 + brainstorm

**측정 도구·관측 대상 (#9) — false negative 결론 직전**
- `[MUST]` "변화 없음 / repro 안 됨" 결론 전에 *측정 도구가 피측정 시스템과 자원을 공유해 굶지 않았는지* 의심했는가 (rAF/메인스레드 폴러로 메인스레드 막힘 구간 측정 등)
- `[MUST]` confound *밖*의 도구로 1회 재측정했는가 (CDP 스크린캐스트·비디오·큐잉 이벤트·외부 샘플러)
- `[MUST]` 가정한 속성 하나가 아니라 *변할 수 있는 관측값*을 enumerate 했는가 (위치/스크롤/transform/opacity/size — "width 고정 ≠ 안 움직임")
- `[SHOULD]` 동작 *끝난 뒤* 정적 스냅샷이 아니라 *과정*을 캡처했는가
- `[SHOULD]` 호출자 미상이면 의심 API 를 패치 + stack trace 로 특정했는가 (recompile 불가 런타임의 mechanism trace)

## 케이스 스터디 — 이번 워크플로의 기원

LLVM PR #194184 검증 (VTK 9.6.1 standardized-EH crash). 6원칙 각각이 어느 turning point에서 발동했는지 시간순 매핑 + 두 PR 비교(workaround vs root fix) + 외부 컨트리뷰터가 root cause에 도달하기 위한 가이드: [case-llvm-vtk.md](references/case-llvm-vtk.md).

특히 **#5 (모순 신뢰)** 가 결정적이었던 사례 — "baseline이 통과해야 할 때 통과하지 않았는데, 그걸 그대로 받아들이지 않고 *실험 먼저 의심*한 사용자의 한 줄 질문이 false positive 검증을 캐치"한 부분 참조.

**#9 (측정 도구·관측 대상 의심)** 의 기원 — 우측 도크 열 때 좌측 패널이 가로로 밀리는 버그를, 처음엔 rAF 로 *폭만* 재서 "변화 없음"으로 오판했다가, confound 밖 도구(CDP 스크린캐스트)와 옳은 관측값(left 좌표·부모 scrollLeft) + `scrollIntoView` 패치로 root cause 에 도달한 사례: [case-browser-layout-shift.md](references/case-browser-layout-shift.md).

## 주의 사항

- **워크플로는 교리가 아니다.** 단순 typo 같은 trivial bug에 5단계를 강요하면 과잉. **5분 이상** 걸리거나 **같은 버그가 두 번째** 보일 때부터 적용한다.
- **"바빠서 root fix 못 함"은 합법.** 단, workaround라는 사실을 *코드 주석 + 후속 이슈*로 남겨야 다음 사람이 invariant를 회복할 수 있다 (#2의 핵심).
- **도달 검증 없는 A/B는 false positive 공장.** 실험 셋업이 가설을 진짜로 테스트하고 있는지가 결과보다 먼저다 (#4·#5).
- **변형 부피로 노력 합리화하지 말 것.** *N round 시도*가 *충분* 의 증거 아님. 같은 axis 의 N 점이면 다른 axis 로 이동하거나 mechanism trace 로 전환 (#7). 부피 ≠ 다양성 (#8 anti-pattern B).
- **"X-specific 이라 generic 합성 불가능" 은 거의 항상 게으른 답.** 표준 패턴(vtable, ABI, linking, format spec)이면 정의상 흉내 가능. 못 흉내냈다 = 변수를 못 짚었다 (#7·#8).
- **변수 list 가 모든 분석의 prerequisite.** invariant 도, A/B 도, mechanism trace 도 *어떤 변수* 위에서 작동. list 가 부족하면 다음 단계 헛돈다 (#8).
- **변수 self-doubt 항상.** "내가 본 변수가 진짜 다인가" 자기점검을 *적어서* 한다. 속으로만 하면 회피하기 쉽다 (#8 self-doubt protocol).
- **"메인테이너 한 줄 질문"이 PR 한 개를 절약한다.** invariant를 짚어 reduced repro와 함께 물으면 root cause 방향을 받을 수 있다. 시간을 *측정*하면 reduced repro 만드는 비용 < PR 만들고 거절당하고 다시 만드는 비용.
- **자동화가 가능한 건 자동화.** invariant 위반 검사는 assertion·schema·type·test로, 도달 검증은 dry-run·log signature·smoke test로. 사람 눈은 시스템이 못 잡는 *판단*에 쓴다.
- **외부 push 없이 한계 결론 받아들이지 말 것.** 사용자/maintainer가 push 한 후에야 다음 시도가 작동한다면 그 워크플로는 실패. mechanism trace 가 *default move* 가 되어야 한다 (#7).

## 관련 스킬

- 토스 프론트엔드 fundamentals — 4축 코드 품질 + 접근성 (이 스킬과 도메인 다름; 합쳐 쓰면 프런트엔드 회귀 분석에 효과적)
- test-foundations — invariant 발견 후 *회귀 박제* 핸드오프 (recurrence seam, reliability-system §6.4). 1단계(invariant 명문화)를 마치면 [test-foundations/references/recurrence.md](../test-foundations/references/recurrence.md) §2 핸드오프 템플릿(Invariant / Trigger condition / Observed violation / Cheapest catching layer / Proposed test name)을 채워 건넨다 — test-foundations가 그 invariant를 가장 싼 계층(보통 L1/L2)의 failing→green 회귀 테스트로 고착시키고, 2차 발생 시 guardrail로 escalate 한다. 분담: 이 스킬이 *무엇이 깨졌는가*를 소유, test-foundations가 *그 해석을 코드로 고착시키는* 언어를 소유. (Proposed test name 은 `/^[A-Za-z0-9_.-]+$/` 라 slice 엔진의 `{scope}` 토큰으로 바로 쓰인다.)
- skill-creator — 이 스킬도 그 가이드로 만들어짐 (progressive disclosure, references one-level deep)
