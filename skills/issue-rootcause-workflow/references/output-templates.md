# Output Templates

조사 결과를 4섹션으로 정리한 뒤 사용처에 따라 템플릿 변환.

```
**Invariant** — 무엇이 참이어야 했는가
**Violation** — 어디서 어떻게 깨졌는가
**Choice**    — workaround | root fix | both 중 무엇을 적용했고 왜
**Evidence**  — A/B 결과 표, 도달 검증 명령, 모순 해소 과정
```

## 목차

1. PR 코멘트 (검증 결과 보고)
2. ADR (Architecture Decision Record)
3. 인시던트 포스트모템
4. 코드 주석 (workaround 명시)

---

## 1. PR 코멘트 (검증 결과 보고)

```markdown
Confirmed — <PR_NUMBER> [fixes / does not fix] <issue>.

**Test setup**
- Environment: <toolchain version, base commit>
- Two builds, identical except the patch:
  - unfixed: <base>, vanilla
  - fixed: <base> + this PR cherry-picked
- Only <single variable> swapped between the two
- Workload: <real workload + flags>
- Verified hypothesis arrival: <command + output snippet>

**Result**

|                          | unfixed | fixed |
|--------------------------|---------|-------|
| <metric 1>               | <X>     | <Y>   |
| <metric 2>               | <X>     | <Y>   |

Same root cause as <issue> on every failure. With the patch, all <N> sites <pass>.

**Failing sites** (collected with full enumeration):
- <list>

(<note about discrepancy with original report, if any>)
```

LLVM PR #194184 코멘트가 이 형식 — [case-llvm-vtk.md](case-llvm-vtk.md) §2 T10 참조.

핵심:
- "한 변수만 swap" 명시 (#3)
- "도달 검증 명령" 인용 (#4)
- 표로 양쪽 결과 (#3)
- 원래 보고와 불일치 있으면 *원인까지* 적기 (이번 사례의 "three → 11"처럼)

---

## 2. ADR (Architecture Decision Record) — workaround vs root fix 선택

```markdown
# ADR: <decision>

**Date**: YYYY-MM-DD
**Status**: accepted | proposed | superseded by <link>

## Context

**Invariant** — <which invariant of which structure/contract was violated>

**Violation** — <where, how, since when>

## Decision

**Choice** — workaround | root fix | both

**Why** — <reasoning. 시간 압박? 외부 코드? 같은 패턴이 1차 vs N차?>

## Consequences

- <if workaround> follow-up issue: <link>. invariant를 회복할 시점·조건.
- <if root fix> 영향 범위: <list>. 회귀 가능성: <risk + mitigation>.

## Evidence

- A/B 결과 표
- 도달 검증 명령 + 출력 스니펫
```

핵심:
- **Decision** 칸에서 workaround인지 root fix인지 *명시적으로* 선택 (#2)
- 이유에는 "왜 다른 쪽을 안 골랐는가"도 포함

---

## 3. 인시던트 포스트모템

```markdown
# Postmortem: <incident>

## TL;DR
한 줄 — invariant + violation + 영향 범위.

## Timeline (시간순)
- T+0 — 첫 alert
- T+x — <action>
- ...

## Invariant
무엇이 참이어야 했는가.

## What broke the invariant
1차 원인 + (있으면) 2차/3차 원인 (인접 invariant 연쇄).

## Detection
어떻게 발견됐나. 모니터가 잡았나, 사용자 리포트인가.

## Resolution
- 즉각 조치 (workaround) — 명시
- 후속 조치 (root fix) — 시점, 책임자

## What we'd do differently
- 도달 검증을 <어디서> 자동화했어야 했다 (#4)
- 두 path 대조를 <어떤 마이그레이션>에 적용했어야 했다 (#6)
- 모순 신호를 <어디서> 더 빨리 잡을 수 있었다 (#5)

## Action items
- [ ] root fix PR (시점)
- [ ] regression test — invariant 명문 형식으로 (예: `assert(stack.size() == try_table_count)`)
- [ ] 모니터링 — invariant violation을 미리 잡는 metric
```

핵심:
- **Invariant** 섹션을 *별도로* 두기 (#1)
- "What we'd do differently"에 6원칙 키워드 매핑 (#4·#5·#6) — 다음 인시던트에 직접 도움됨
- regression test는 "버그 케이스 재현" 보다 "invariant 명문화"로 작성

---

## 4. 코드 주석 (workaround 명시)

```typescript
// WORKAROUND: <invariant 위반 한 줄>
// Root cause: <원인 요약 + reduced repro/issue link>
// Root fix: <어디서/어떻게>. follow-up: <issue link>
if (!stack.empty()) stack.pop();
```

핵심:
- `WORKAROUND:` 키워드는 grep 가능한 sentinel — 정기적으로 `git grep WORKAROUND` 해서 백로그 정리
- `Root cause`와 `Root fix`를 *둘 다* 적기 — 다음 인계자가 root fix 방향으로 직진할 수 있게
- 이 주석이 없으면 다음 사람이 워크어라운드 위에 워크어라운드를 또 쌓는다 (이번 LLVM 사례에서 사용자가 PR 본문에 "likely a workaround" 명시한 게 같은 효과)
