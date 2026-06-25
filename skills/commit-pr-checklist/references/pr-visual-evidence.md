# PR 시각 증거 (before/after 스크린샷)

프론트·UI·타이포·레이아웃처럼 **화면이 바뀌는 PR**은 리뷰어가 diff만으로 판단하기 어렵다. ship
전 증거를 남긴다. **private org 레포**에서는 URL 종류에 따라 PR 본문 인라인이 되거나 엑스박스가
난다.

## 언제 필수인가

다음 중 하나라도 해당하면 before/after를 남긴다:

- 폰트·색·간격·컴포넌트 스타일 변경
- 레이아웃·네비·대시보드·워크벤치 등 주요 화면 UX 변경
- 시각 회귀가 우려되는 리팩터

순수 로직·API·백엔드만 바뀌면 생략 (비례).

## 표준 워크플로 (private 레포)

### 1) PNG는 **레포 밖** 로컬 경로에만 둔다

**절대 레포 안에 만들거나 커밋하지 않는다.** `.github/pr-assets/` 같은 경로는
**생성 금지** — 과거에 레포가 오염된 전례가 있다.

표준 출력 경로 (worktree 루트 기준):

```
out/pr-screenshots/<slug>/
  before-landing.png
  after-landing.png
  before-dashboard.png
  after-dashboard.png
  ...
```

- `out/` 은 빌드·검증 산출물 디렉터리 — **git 추적 대상 아님**
- 파일명: `before-<화면>.png` / `after-<화면>.png` (kebab-case)
- 대표 화면 2~3곳, 동일 뷰포트·동일 상태
- before = base/main 앱 한 포트, after = worktree/feature 앱 다른 포트

`preship-scan.sh` 가 staged에 `.github/pr-assets/` 또는 `out/` 이 있으면 **경고**한다.
스크린샷 PNG가 staged면 ship 전에 unstage 한다.

### 2) PR 본문 — **`gh-image` 인라인 임베드** (기본)

private 레포 PR 설명에서 인라인 미리보기가 필요하면 **[`gh-image`](https://github.com/drogers0/gh-image)**
로 `user-attachments` URL을 얻는다. 웹 드래그앤드롭과 동일한 URL이며, 로그인한 org 멤버에게
본문에 바로 렌더된다.

**사전 조건 (한 번만 — 이후 headless)**

```bash
gh extension install drogers0/gh-image

# 호스트 Mac 터미널 (Docker 밖 — Chrome에 github.com 로그인)
gh image extract-token > ~/.config/gh/image-session && chmod 600 ~/.config/gh/image-session

# 이후 Docker/headless
gh image check-token
```

**before/after 일괄 업로드 + PR 본문 반영**

```bash
bash scripts/pr-inline-images.sh \
  --repo everysim-dev/dronerush \
  --pr <N> \
  --assets out/pr-screenshots/<slug> \
  --body-file /tmp/pr-body.md \
  --apply
```

`--body-file`에 `<!-- PR_INLINE_SCREENSHOTS -->` 플레이스홀더를 넣으면 해당 구간을
업로드된 인라인 테이블로 치환한다.

### 3) 폴백 — blob 링크 테이블 (세션 없을 때)

`gh-image` 인증이 불가하면 PR 본문에 화면명·포트·검증 절차만 텍스트로 남기고, 세션 확보
후 `gh-image`로 갱신한다. **레포 blob URL로 스크린샷을 링크하지 않는다** (private에서
인라인·img 모두 불안정).

## 금지

| 하지 말 것 | 이유 |
|---|---|
| `.github/pr-assets/` 디렉터리 생성·커밋 | 레포 오염, 머지 후 제거 비용 |
| `out/` · 스크린샷 PNG staged | 산출물은 PR diff에 넣지 않음 |
| `raw.githubusercontent.com` / 상대 경로 `![...]()` | private → 엑스박스 |
| `gh-attach-assets` orphan 브랜치 / release asset URL | 레포 오염 + img 404 |
| PAT만으로 업로드 | 422 — `user_session` 필요 |

## 체크리스트

- [ ] 스크린샷이 `out/pr-screenshots/<slug>/` 에만 있는가 (레포 안 경로 없음)
- [ ] staged에 PNG·`.github/pr-assets/`·`out/` 이 없는가
- [ ] PR 본문이 **`gh-image` `user-attachments` 인라인**인가
- [ ] `gh image check-token` 통과했는가