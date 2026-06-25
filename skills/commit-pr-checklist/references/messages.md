# 커밋·PR 메시지 — 레포에서 배워서 쓴다

SKILL.md G5의 깊은 참조. 메시지는 *짧은 기술 글*이라 문장 원칙은
[technical-writing](../../technical-writing/SKILL.md)이 정본이고, 여기선 **무엇을 담고 무엇을
버리나**(레포 관례 도출 + 내구성)만 다룬다.

## 1. 관례를 도출하는 법 (형식을 발명하지 않는다)

ship 직전 레포가 *이미* 쓰는 관례를 읽는다. 발명한 형식은 리뷰어에게 낯선 비용이다.

```sh
git log --format='%s' -30                 # 제목 관례: 형식·scope·길이·언어
git log --format='%s%n%n%b' -8            # 본문 관례: 왜 단락·이슈 링크·테스트 노트
gh pr list --state merged --limit 15 --json title,body   # PR 제목·본문 패턴
ls .github/PULL_REQUEST_TEMPLATE* .github/pull_request_template* 2>/dev/null  # 템플릿
```

도출할 것: **형식**(Conventional Commits `feat(scope):` / gitmoji / 평문?), **제목**(길이·
대소문자·마침표·명령형 vs 과거형·한/영), **본문**(왜 단락이 있나·이슈를 `Closes #123`로 거나·
breaking change 표기·테스트 노트·Co-authored-by 트레일러), **PR**(템플릿 섹션·리뷰어 체크리스트).
관례가 갈리면 *최근·머지된* 것에 가중치를 둔다.

> **도출이 항상 우선** — 아래는 도출이 *찾아낼 결과의 예시*일 뿐 규범이 아니다. 예: 어떤
> 레포는 Conventional Commits + 슬래시 scope(`type(scope): 명령형 제목`)를, 다른 레포는
> 평문 제목 + 본문 이슈 링크를 쓴다. 레포가 쓰는 쪽을 따른다.

## 2. 제목 — 무엇이 바뀌었나, 한 줄로

레포 형식대로. 가치/효과를 동사로, 메커니즘이 아니라 변화를.

**Example 1**
- 작업 내용: JWT 토큰으로 사용자 인증 추가
- 나쁨: `update auth code` · `여러 파일 수정` · `WIP` · `2차 시도 반영`
- 좋음: `feat(auth): JWT 기반 인증 추가` (레포가 Conventional Commits일 때)

**Example 2**
- 작업 내용: 큰 목록에서 매 렌더 재정렬하던 것을 메모이즈
- 나쁨: `성능 개선` (무엇을?) · `fixed the slow thing from yesterday` (휘발성 참조)
- 좋음: `perf(list): 정렬 결과 메모이즈로 재렌더 시 재정렬 제거`

## 3. 본문 — 왜 > 무엇

diff는 *무엇*을 이미 보여준다. 본문은 **왜**를 — 이 변경이 푸는 문제, 택한 트레이드오프,
리뷰어가 알아야 할 리스크·검증법. 가치를 기능보다 먼저(technical-writing 상속).

```
<제목 — 레포 형식대로>

<왜: 이 변경이 푸는 문제. 요청된 해법이 아니라 진짜 문제부터.>
<무엇/어떻게: diff로 안 보이는 비자명한 선택만. 자명한 건 생략.>

- 리스크 / breaking change: <있으면. 공개 API면 마이그레이션 노트>
- 검증: <리뷰어가 직접 확인하는 법 — 명령·화면·재현 절차>
Closes #<이슈>   ← 레포가 이슈를 거는 관례면
```

PR도 같은 골격 + 레포 템플릿 섹션을 채운다. 버그 fix엔 회귀 테스트, 성능 PR엔 before/after
수치를 (프론트 규범은 toss-frontend 담당) — 없으면 *없는 이유*를 적는다.

**프론트·UI 시각 변경** — before/after 스크린샷을 PR 본문에 넣는다. PNG는 feature 브랜치
`.github/pr-assets/<slug>/`에 커밋하고, 본문에는 **상대 경로**만 쓴다. `raw.githubusercontent.com`·
`gh-attach-assets` orphan URL은 private 레포에서 깨지므로 쓰지 않는다. 절차는
[pr-visual-evidence.md](pr-visual-evidence.md).

## 4. durability filter를 메시지에 (G6)

영구 기록에 휘발성 정보를 박지 않는다. 시간이 지나면 거짓이 되거나 잡음인 것을 뺀다.

| 빼는 것 | 나쁨 → 좋음 |
|---|---|
| 시간 상대어 | `현재 버전에선 안 됨` → `v2.3 이하에서 실패` 또는 조건 자체로 |
| 작업 과정 | `Phase 2: 리팩토링 / 3차 시도 끝에 해결` → 결과만: `렌더 경로를 …로 단순화` |
| 휘발성 식별자 | `wf_abc 참고, 어제 슬랙 논의대로` → 이유를 무시간 명제로: `N+1 쿼리라 …` |
| 일지 서술 | `처음엔 A를 시도했다가 B로 바꿈` → 채택안과 *왜*만: `B를 택함 — A는 …이라` |

> 막다른 길·대안 비교가 *결정의 근거*로 가치 있으면 무시간으로 한 줄 남긴다("A 대신 B —
> A는 X 제약" ). 가치 없는 *과정 서술*은 버린다. 기준: 6개월 뒤 독자에게 도움이 되는가.
