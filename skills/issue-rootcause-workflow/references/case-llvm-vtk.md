# Case Study: LLVM PR #194184 검증 (VTK 9.6.1 standardized-EH crash)

> **자매 case**: [case-occt-wasm-ld.md](case-occt-wasm-ld.md). 두 케이스 모두 *외부 push 없이 받아들였을 결론* 이라는 공통 anti-pattern; LLVM/VTK 는 #5 (모순 신뢰) 강조, OCCT 는 #7/#8 (mechanism trace, variable enumeration) 강조.

이 케이스는 [SKILL.md](../SKILL.md)의 워크플로가 어떤 실제 흐름에서 도출됐는지를 보여준다. 각 원칙이 어느 turning point에서 발동했는지 시간순으로 매핑.

## 목차

1. 배경
2. 시간순 흐름 + 6원칙 매핑
3. 두 PR의 fix 비교 — workaround vs root fix
4. 회고: 외부 컨트리뷰터가 root cause에 도달하려면

---

## 1. 배경

- **사용자**: LLVM PR #192968 (WebAssembly EH backend의 `EHPadStack` underflow 가드 — workaround) 작성자
- **메인테이너**: aheejin (Heejin Ahn, WebAssembly EH 메인테이너) — 같은 버그의 근본 수정 PR #194184 따로 올림
- **요청**: aheejin이 사용자에게 *"PR #194184가 당신의 VTK 9.6.1 풀빌드를 통과시키는지 테스트해달라"*
- **목표**: A/B 검증 후 결과 코멘트

## 2. 시간순 흐름 + 6원칙 매핑

| 시점 | 행동 | 발동 원칙 | 코멘트 |
|---|---|---|---|
| T0 | 환경 셋업 (LLVM clone, emsdk, VTK) | — | 사전 작업 |
| T1 | emsdk가 쓰는 정확한 LLVM commit (`bbeae693`)에 PR fix만 cherry-pick | **#3** (한 변수만 swap) | main HEAD가 아닌 이유: ABI 호환 — 기존 libc/libcxx와 어긋나면 검증 자체가 무의미 |
| T2 | emsdk `upstream/bin/clang-23` 을 patched binary로 symlink, 원본은 `.orig`로 백업 | **#3** | "한 변수만 swap"의 구체 구현 |
| T3 | fixed 매크로 풀빌드 → 4618/4618 통과 | — | OK 신호 |
| T4 | unfixed 매크로 풀빌드 (baseline) → **4618/4618 통과** ⚠️ | **#5 모순** | sanity 깨짐: unfixed면 crash가 나야 했음 |
| T5 | 사용자 한 줄 질문: *"지금 제대로 해본 거 맞아? `-fwasm-exceptions -sWASM_LEGACY_EXCEPTIONS=0`이면 문제 발생했었는데"* | **#5 (실험 먼저 의심)** | 이 한 줄이 시간 수 시간을 절약. *모순을 즉시 신뢰* |
| T6 | `emcc -v`로 cc1 인자 추적 → cc1엔 default `-wasm-use-legacy-eh=true` 전달 | **#4 (도달 검증)** | `-sWASM_LEGACY_EXCEPTIONS=0`을 link flag에만 넣어서 컴파일 단계엔 도달 X |
| T7 | flag를 compile + link 양쪽에 넣고 재실행. cc1에 `-wasm-use-legacy-eh=0` 도착 확인 | **#4** | 가설이 도달했는지 *binary 명령에서 확인* |
| T8 | 마이크로 (.ll reduced repro) — unfixed → SIGSEGV at WebAssembly CFG Stackify, fixed → 통과 | **#3 (micro)** | 결정성 확보 |
| T9 | 매크로 (VTK 풀빌드, `ninja -k 0`로 끝까지 진행) — unfixed → 11 TU crash, fixed → 0 crash | **#3 (macro + 전수)** | `-k 0` 덕에 *모든 실패 사이트*를 수집 (PR 본문 "three"보다 많은 11개) |
| T10 | 결과를 표 형식으로 PR #194184 + #192968에 게시 | (#5 결과 포맷) | 영문 코멘트, [output-templates.md](output-templates.md) §1 참조 |
| T11 | 사용자 질문: "두 fix의 차이는?" | **#1·#2 (사후)** | 표면 비교 |
| T12 | `EHPadStack`의 invariant 짚기: "push N(try_table) ↔ pop N(call_unwind)" — shared cleanup pad에서 N:1 (try_table N, catch 1)로 깨짐 | **#1** | invariant 명문화는 fix 직후가 아니라 *비교 후 회고*에 들어옴 — 이 순서가 일반적 |
| T13 | aheejin의 fix는 push 위치를 catch → END_TRY_TABLE 로 옮겨 N:N 회복 | **#1·#2** | invariant 회복 = root fix |
| T14 | aheejin이 사용한 단서: 자기 commit #187484가 `fixCallUnwindMismatches` 호출 순서를 바꾼 사실 | **#6 (최근 변경)** | 메인테이너는 자기 변경이라 자연히 알았음. 외부 컨트리뷰터는 `git log -p`로만 도달 가능 |
| T15 | 사용자 질문: *"어떡하면 저런 걸 파악할 수 있을까?"* | (회고) | → 6원칙으로 정리됨 → 이 스킬의 출처 |

## 3. 두 PR의 fix 비교

|  | #192968 (사용자) | #194184 (aheejin) |
|---|---|---|
| 접근 | 증상 차단 (defensive guard) | 원인 제거 (push 위치 변경) |
| 변경 위치 | `fixCallUnwindMismatches` 4곳 `if (!empty())` + assert 제거 | `fixCallUnwindMismatches` push 로직 + `addNestedTryTable` `registerTryScope` 인자 |
| 줄 수 | +23 / -9 | +51 / -3 |
| 부수 효과 | 없음 | 불필요한 try_table 제거, codegen 약간 개선 |
| 본인 평가 | *"likely a workaround rather than a root fix"* (PR 본문) | "Closes #192968" |

**핵심**: 사용자는 invariant 위반을 *허용하는* 쪽 (workaround), aheejin은 invariant를 *보존하는* 쪽 (root fix). 같은 invariant 분석에서 두 결정 모두 가능하지만 *수명*이 다르다 — 사용자 fix는 다른 trampoline 패턴이 추가되면 또 underflow 날 수 있고, aheejin fix는 invariant 자체가 회복돼서 그런 신규 패턴도 자동으로 처리.

**중요한 예시**: 사용자가 PR 본문에 "likely a workaround"라고 *직접 명시*한 것이 [principles.md #2](principles.md#2-workaround-vs-root-fix-의식-단계-2) 의 핵심 패턴 — 워크어라운드라는 사실을 PR description·코드 주석에 남기면 다음 인계자가 root fix 방향을 안다.

## 4. 회고: 외부 컨트리뷰터가 root cause에 도달하려면

### 사전 도구

- `llc -debug-only=wasm-cfg-stackify -print-after-all` — 매 instruction마다 EHPadStack 상태 trace. underflow 직전에 *어느 push가 빠졌는가*가 보인다.
- MIR을 종이에 그리기 — try_table 박스 / trampoline BB 동그라미 / reverse walk 화살표. 5분이면 push/pop 카운트 불일치가 시각화됨.
- 두 path 대조 — legacy(catch가 try 직후) vs standardized(catch는 trampoline BB로 분리). aheejin이 fix 본문에 *이 차이*를 명시.

### 메인테이너 한 줄 질문

LLVM Discourse [WebAssembly] 또는 LLVM Discord `#wasm`에서:

> "shared cleanup pad에 try_table N개가 동일 pad를 가리키는데 catch는 trampoline BB에 1개뿐입니다. fixCallUnwindMismatches reverse walk에서 push 횟수 < pop 횟수가 되는데, 이게 의도한 invariant인가요? reduced repro: <link>"

이 한 줄이면 aheejin이 30분 안에 root fix 방향(push를 END_TRY_TABLE로 옮김)을 답해줬을 가능성이 큼. 사용자 PR 만들고 거절당하고 다시 만드는 시간보다 짧다.

### 6원칙으로 다시 보면

| 원칙 | 외부 컨트리뷰터의 액션 |
|---|---|
| **#1 Invariant** | "EHPadStack은 무엇을 추적하는 stack인가? push/pop 짝은? 함수 끝 상태는?"을 적기 |
| **#2 Choice** | invariant 위반을 허용할지 회복할지 *의식적으로* 선택. workaround면 "왜 root fix를 안 골랐는가" 사유 명시 |
| **#3 A/B** | reduced .ll로 결정성 + macro로 현실성. 한 binary만 swap |
| **#4 도달 검증** | flag·patch가 진짜 적용된 단계에서 확인 (`emcc -v`로 cc1 인자 보기) |
| **#5 모순 신뢰** | "unfixed인데 통과" 같은 사전지식 충돌 시 즉시 셋업부터 의심 |
| **#6 최근 변경 + path** | `git log -p --since`로 ordering 바꾼 commit 찾고, legacy vs standardized 코드 path 대조 |

이 케이스는 6원칙 모두가 한 흐름에서 발동한 드문 사례라 reference로 보존한다.

## 5. 다른 도메인으로의 일반화

| 이 사례의 요소 | 일반화 |
|---|---|
| LLVM `EHPadStack` underflow | 자료구조 invariant 위반 (parser stack, reducer queue, GC mark stack, transaction depth) |
| emsdk binary swap-in | A/B 환경에서 한 변수만 변경 (binary, image tag, env var, feature flag) |
| `-sWASM_LEGACY_EXCEPTIONS=0` 도달 안 함 | feature flag 켰는데 effect 없음 / config reload 안 됨 / migration 적용 안 됨 |
| ninja `-k 0` 전수조사 | `pytest --maxfail=0`, `cargo test --no-fail-fast`, traffic replay로 모든 실패 케이스 수집 |
| legacy vs standardized EH | v1 vs v2 API, sync vs async path, region별 dispatch, feature flag variant |
| commit #187484 ordering 변경 | 최근 호출 순서 변경, dispatch table 수정, middleware 순서 변경 |
| aheejin Discord 한 줄 질문 | 도메인 owner 메인테이너에게 reduced repro와 함께 invariant 짚기 |

원칙은 도메인 독립이고 적용 도구만 바뀐다.
