---
name: commit-pr-checklist
description: 커밋·푸시·PR 직전 "ship 가능한가"를 묻는 게이트 오케스트레이터 — *무엇이 들어가나*(필요한 변경만·깨끗한 diff)와 *어떻게 설명하나*(레포 관례 + 독자 본위)를 순서대로 보고, 판정은 형제 스킬에 위임한다. 커밋·PR은 영구 기록이라 작업 *과정*(페이즈·단계·시도·run ID·"오늘 기준")이 아니라 *결과와 정당성*만 남긴다. 트리거 - (1) "이거 커밋/푸시/머지해도 돼?"·"올리기 전/머지 전 점검"·"PR·커밋 메시지 써줘", (2) git commit·gh pr create 직전 staged diff 셀프리뷰·불필요한 파일·시크릿·디버그·무관한 churn 점검, (3) 커밋/PR 형식을 기존 커밋·PR에서 도출해 맞추기, (4) "필요한 것만 커밋"·"atomic commit"·"커밋 쪼개줘"·"작업 흔적(임시·페이즈) 빼기", (5) 유닛·피처 테스트가 스펙-중심으로 붙었는지 확인. 판정은 형제 담당 — 코드는 code-fundamentals(프론트면 + toss-frontend-fundamentals + Vercel react-best-practices·composition-patterns 함께), 테스트는 test-foundations, 스펙 변종은 spec-first, 문장은 technical-writing. 이 게이트는 *언제·순서대로* 부른다. ship 맥락 없는 순수 코드리뷰/글다듬기는 그 단독 스킬이고, 1줄 수정엔 안 쓴다(proportional).
---

# Commit/PR Checklist — "ship 가능한가"를 묻는 게이트 (오케스트레이터)

**커밋·PR은 코드가 아니라 *기록*이다.** 미래의 독자 — 리뷰어, `git blame` 하는 사람,
6개월 뒤의 나 — 가 이 기록을 읽고 비용을 치른다. 그래서 ship 전에 두 가지만 묻는다:
**① 무엇이 들어가는가**(필요한 변경만, 깨끗한 diff) · **② 어떻게 설명되는가**(레포의
관례를 따른, 독자 본위의 메시지). 작업의 *과정*은 기록이 아니다.

이 스킬은 **게이트를 *소유*하고 판정을 *위임*한다.** 코드가 좋은지·테스트가 옳은지·문장이
매끄러운지는 형제 스킬이 답한다. 이 스킬은 그것들을 *언제·어떤 순서로* 부를지, 그리고
diff 위생·메시지 도출·기록 내구성처럼 *아무도 소유하지 않는 ship 직전 관심사*를 책임진다.

## 왜 — 게이트의 단 하나의 뿌리

> 거의 모든 나쁜 커밋·PR은 한 증상이다 — **작업한 사람 본위로 남겼다.** 내가 거친
> 순서대로(페이즈 1, 2차 시도…), 내 작업 흔적을 담아서, 지금 내 머릿속 상태("현재는…")로.

기록은 *과정*이 아니라 *결과와 그 정당성*이어야 한다. 어떻게 도달했는지(막다른 길, 단계,
임시 스캐폴드)는 미래 독자에게 잡음이다. 무엇이 바뀌었고 왜 그게 옳은지만 남긴다 — 이게
durability filter(G6)의 뿌리이자, 메시지를 레포 관례로 맞추는(G5) 이유다.

## 0. 비례 (scope floor) — 게이트보다 먼저

**교리가 아니라 비례한다.** typo·주석 한 줄·import 정리는 전체 의식이 필요 없다 — diff를
한 번 읽고(G1) 메시지만 맞추면(G5) 끝. 게이트의 무게는 변경의 크기·위험에 비례한다.
보안·데이터 손실·시크릿 노출만은 작은 변경에서도 *항상* 본다(G2 — scope floor의 바닥은
협상 대상이 아니다, code-fundamentals 상속).

## 워크플로 — 6 게이트 (순서대로)

기계적 스캔(G1·G2 대부분)은 번들 [scripts/preship-scan.sh](scripts/preship-scan.sh)가
한 번에 리포트한다 — branch·staged/untracked·시크릿/디버그 패턴·최근 커밋&PR 관례. 스크립트
없는 환경이면 아래를 손으로 한다. 스크립트는 *best-effort*이고, clean 리포트가 ship 보증은
아니다 — 게이트의 판단을 대체하지 않는다.

- **G1 · SELF-REVIEW** — `git diff --staged`를 *리뷰어처럼* 한 hunk씩 읽는다. 의도와
  무관한 줄이 보이면 거기서 멈춘다. ship 전 가장 큰 레버 하나다("look at the target").
- **G2 · 무엇이 들어가나** — staged 집합이 *필요한 변경만*인가:
  - **stray/artifact** — 빌드 산출물·`dist/`·`.zip`·로그·`.DS_Store`·스냅샷·대용량 바이너리,
    실수로 든 임시 파일이 없는가. `.gitignore`를 존중하되, 생성물은 커밋하지 않는다.
  - **secret** — 키·토큰·`.env`·비밀번호·`BEGIN ... PRIVATE KEY`가 diff에 새지 않는가.
  - **debug 잔여** — `console.log`/`print`/`debugger`/주석 처리된 코드/죽은 코드/맥락
    없는 `TODO`.
  - **무관한 churn** — 포매터 잡음·import 재정렬·공백만 바뀐 줄로 diff가 부풀지 않는가
    (리뷰 비용↑). 의도한 변경만 남긴다.
  - **atomic** — 한 커밋 = 한 논리적 변경. feature+refactor+fix가 한 덩어리면 쪼갠다.
- **G3 · 코드 품질** → **defer**. *항상* [code-fundamentals](../code-fundamentals/SKILL.md)로
  4축(가독성·예측가능성·응집도·결합도) 점검. **프론트엔드면 네 렌즈를 함께** 켠다 —
  code-fundamentals(언어 불문 4축) + [toss-frontend-fundamentals](../toss-frontend-fundamentals/SKILL.md)
  (a11y·React 런타임·디자인 토큰) + `vercel-react-best-practices`(React/Next *성능*: 워터폴·번들·
  RSC·리렌더) + `vercel-composition-patterns`(*합성 API*: compound·render props·context·React 19).
  뒤 둘은 외부 스킬([vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills)) —
  설치돼 있으면 함께 트리거, 없으면 설치 후. **주석**은 최소로 — 달아야 한다면 *왜*를 담고
  (무엇은 코드가 말한다), 밀도·스타일은 *그 파일의 기존 주석*에 맞춘다. 주석이 제값을
  하는지의 판정은 code-fundamentals.
- **G4 · 테스트** → **defer**. 변경 코드에 테스트가 붙고 *green*인가. 기능과 1:1로 찍어내지
  말고 **행동 변종**을 덮는다: 유닛(L1)은 순수 로직을 정직하게(억지 green·vacuous·over-fit
  금지), 피처(L2, *사용자 여정이 있으면* L3)는 *관찰 가능한 결과 = 스펙/의도*를 단언(구현·
  메커니즘 단언 금지). 계층 최종 배치는 [test-foundations](../test-foundations/SKILL.md)에
  defer하고(리그·`verify` 엔트리도), E2E는 *여정이 있을 때만*이지 전-변경 강제가 아니다
  (scope-floor). 스펙-중심 변종 도출은 [spec-first](../spec-first/SKILL.md). 변경 scope부터
  돌린다(`verify --changed`).
- **G5 · 메시지 · PR** — 아래 "메시지는 레포에서 배운다" 참조.
- **G6 · durability filter** — 아래 "기록에서 과정을 벗긴다" 참조.

## 메시지는 레포에서 배운다 (G5)

**형식을 발명하지 말고 *도출*한다.** ship 직전 레포가 이미 쓰는 관례를 읽어 맞춘다 — 이게
가장 적은 마찰로 리뷰어를 돕는다.

1. **관례 추출** — `git log --format='%s' -30`(최근 subject) + `gh pr list --state merged`로
   본다: Conventional Commits인가(`feat(scope):`)? 제목 길이·대소문자·언어(한/영)? 본문에
   이슈 링크·"왜" 단락·테스트 노트가 있나? PR 템플릿이 있나(`.github/PULL_REQUEST_TEMPLATE`)?
2. **문장 다듬기** → **defer**. [technical-writing](../technical-writing/SKILL.md): 가치를
   기능보다 먼저, 독자 본위, *왜*를 남긴다(메타담화·번역체·수동태 교정). 커밋·PR은 짧은 글
   — technical-writing 본문 + 트리거 맵으로 충분하다(references 깊게 안 연다).
3. **무엇을 담나** — 제목은 *무엇이 바뀌었나*를 한 줄로(레포 형식대로). 본문은 **왜**(이
   변경이 푸는 문제) > **무엇**(diff가 이미 말함) > 리스크·breaking change·리뷰어가 검증하는
   법. 공개 API breaking이면 마이그레이션 노트(프론트면 codemod까지 — toss-frontend 담당).
4. **프론트·UI 시각 증거** — 폰트·레이아웃·스타일 등 *화면이 바뀌는* PR이면 before/after
   스크린샷을 남긴다. PNG는 **feature 브랜치** `.github/pr-assets/<slug>/` 에 커밋(코드와
   분리 커밋 권장). **private 레포 PR 본문**에는 `![...]()` 인라인이 아니라 **blob 링크
   테이블**로 첨부한다(클릭 시 GitHub에서 이미지 열림 — 엑스박스 없음). 인라인 미리보기가
   꼭 필요하면 GitHub 웹에서 드래그앤드롭(`user-attachments`)만 쓴다. `raw.githubusercontent.com`·
   상대 경로 임베드·orphan 브랜치 URL은 금지. [pr-visual-evidence.md](references/pr-visual-evidence.md).

> 1줄 감각: `Phase 2 임시로 우회, 현재는 잘 됨` → `fix(auth): 토큰 만료 시 재시도 — 상류
> race 회피`(과정·시간어를 벗고, 무엇 + 왜만).

좋은/나쁜 예시와 learn-from-repo 워크드 예시는 [references/messages.md](references/messages.md).

## 기록에서 과정을 벗긴다 (G6 · durability filter)

커밋·PR·코드·주석에서 **시간이 지나면 거짓이 되거나, 미래 독자에게 잡음인** 것을 걷어낸다.
영구 기록에 휘발성 정보를 박으면 다음 사람이 그 거짓을 디버깅한다.

- **시간 상대어** — "현재는"·"지금"·"최근"·"오늘 기준"·곧 바뀔 버전·날짜. → 절대·무시간으로.
- **작업 과정 흔적** — "Phase 1"·"1단계"·"2차 시도"·"임시"·"우선"·스캐폴드 메모·막다른 길의
  잔재. 기록은 결과지 일지가 아니다.
- **휘발성 식별자** — run/agent/job ID(`wf_…`), 임시 브랜치명, "어제 논의한 대로"·"슬랙에서
  말한"처럼 곧 닿을 수 없어지는 참조.
- 남길 가치가 있는 *왜*는 무시간 명제로 다시 쓴다("X 때문에 Y로 우회" — 과정이 아니라 이유).

> 문장-수준 메타담화 교정은 technical-writing과 겹친다 — 그쪽은 *읽기 쉬움*, 여긴 *기록의
> 내구성*. 코드 곁 산문엔 둘을 함께 쓴다. 메시지에 적용한 before/after 카탈로그는
> [references/messages.md §4](references/messages.md).

## 분담 (seams) — 무엇이 *아닌가*

이 스킬이 **소유** = 게이트 시퀀스 + diff 위생(G1·G2) + 메시지 learn-from-repo(G5) +
durability filter(G6). 판정은 전부 defer한다.

| 스킬 | 이 게이트가 거기에 **defer**하는 것 |
|---|---|
| **code-fundamentals** | 코드 품질 판정(가독성·예측가능성·응집도·결합도), 주석이 제값 하는지, scope-floor *판정 기준*. 이 스킬은 *무엇이 staged됐나*를 보지 코드를 리뷰하지 않는다(단 secret·데이터 손실 바닥은 기준만 상속하고 스캔·실행은 G2가 한다) |
| **toss-frontend-fundamentals** | 프론트엔드 고유 판정(a11y·React 런타임·디자인 토큰), 공개 API breaking의 codemod·마이그레이션 가이드 |
| **vercel-react-best-practices** *(외부)* | 프론트엔드 *성능* 판정 — 데이터 워터폴 제거·번들 크기·서버(RSC) 성능·리렌더 최적화. [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) |
| **vercel-composition-patterns** *(외부)* | React *합성 API 설계* — compound components·render props·context·boolean prop 증식·React 19 API. [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/main/skills/composition-patterns) |
| **test-foundations** | 테스트 *리그*(계층·구조·`verify` 엔트리·2축 신뢰성), 유닛 vs 피처 계층 배치, 정직한 green(vacuous·flake 차단) |
| **spec-first** | 피처 테스트의 *스펙-중심* 변종(관찰 가능한 결과 = WHAT, 구현·메커니즘 금지) — "구현 중심 아닌 스펙 중심"의 정본 |
| **technical-writing** | 메시지·PR 본문의 문장 다듬기(가치>기능·독자 본위·번역체/수동태 교정·문서 유형) |

판정이 아니라 *순서와 게이트*가 이 스킬의 일이다 — 위 스킬들을 ship 직전 한 번에 엮는다.

## 체크리스트 (최소 스캔)

- `[MUST]` staged diff를 hunk 단위로 읽었다(G1) · 시크릿/키/`.env` 비노출 · 빌드 산출물·임시
  파일 비포함 · 메시지·코드·주석에 휘발성 정보(시간어·페이즈·run ID) 없음
- `[MUST]` 변경 코드에 테스트가 있고 로컬 green(없으면 *이유 명시*) · 피처 테스트는 구현이
  아니라 스펙/의도를 단언
- `[SHOULD]` 디버그 잔여(`console.log`/`debugger`/주석코드) 제거 · 한 커밋 = 한 논리 변경
  (되돌릴 수 있는 단위) · 무관한 churn(포맷·재정렬) 비포함
- `[SHOULD]` 메시지 형식·트레일러(`Co-authored-by`/sign-off)가 레포 관례와 일치(`git log`/
  `gh pr list`에서 도출) · 본문이 *왜* > 무엇 · breaking change·리스크·검증법 명시 · CI green 예상
- `[SHOULD]` UI·타이포·레이아웃 변경 PR — before/after PNG를 feature 브랜치 `.github/pr-assets/`에
  커밋하고 본문은 **blob 링크 테이블** (`![...]()` 인라인·raw URL 금지 — [pr-visual-evidence](references/pr-visual-evidence.md))
- `[SHOULD]` 기본 브랜치에 직접 커밋 안 함(브랜치 먼저) · 주석은 최소 + 기존 밀도/스타일에 맞춤

## 주의 / 비목표

- **교리가 아니다 — proportional.** 1줄 수정에 6게이트를 매기지 마라. 게이트는 변경에 비례.
- **브랜치 먼저, 커밋은 요청 시.** 기본 브랜치면 먼저 브랜치를 판다. 사용자가 명시적으로
  요청할 때만 커밋·푸시한다(외부로 나가는 작업).
- **자동화가 1차 방어선.** 린터·포매터·타입·시크릿 스캐너·CI가 먼저 잡는다 — 이 게이트는
  그 위의 사람-층(리뷰어 본위·관례·내구성)이다. `preship-scan.sh`도 자동화의 보조이지 판정이
  아니다.
- **판정을 재구현하지 마라.** 코드·테스트·문장 규칙은 형제 스킬에 산다 — 여기 복제하면 두
  곳이 어긋난다. 이 스킬은 *언제 부르나*만 안다.
