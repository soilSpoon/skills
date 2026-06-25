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

### 1) PNG는 feature 브랜치에 커밋 (증거 보관)

코드 PR과 **같은 feature 브랜치**에 스크린샷만 모은 별도 커밋을 권장한다.

```
.github/pr-assets/<slug>/
  before-landing.png
  after-landing.png
  before-dashboard.png
  after-dashboard.png
  ...
```

- 파일명: `before-<화면>.png` / `after-<화면>.png` (kebab-case)
- 대표 화면 2~3곳 (랜딩·대시보드·워크벤치 등), 동일 뷰포트·동일 상태
- before = base/main 앱 한 포트, after = worktree/feature 앱 다른 포트

브랜치 커밋은 **리뷰·감사용 아카이브**다. PR 본문 `![...]()` 인라인 URL로는 쓰지 않는다.

### 2) PR 본문 — **`gh-image` 인라인 임베드** (기본)

private 레포 PR 설명에서 인라인 미리보기가 필요하면 **[`gh-image`](https://github.com/drogers0/gh-image)**
로 `user-attachments` URL을 얻는다. 웹 드래그앤드롭과 동일한 URL이며, 로그인한 org 멤버에게
본문에 바로 렌더된다.

**사전 조건**

```bash
gh extension install drogers0/gh-image
export GH_SESSION_TOKEN="$(gh image extract-token)"   # 로컬: github.com 브라우저 로그인
gh image check-token                                  # username 확인
```

headless/CI에서는 `GH_SESSION_TOKEN`을 환경 시크릿으로 주입한다(전용 bot 계정 권장).

**단일 이미지**

```bash
gh image screenshot.png --repo everysim-dev/dronerush
# => ![screenshot.png](https://github.com/user-attachments/assets/<uuid>)
```

**before/after 일괄 업로드 + PR 본문 반영**

```bash
bash scripts/pr-inline-images.sh \
  --repo everysim-dev/dronerush \
  --pr 2319 \
  --assets .github/pr-assets/pretendard-font \
  --body-file .github/pr-body.md \
  --apply
```

`--body-file`에 `<!-- PR_INLINE_SCREENSHOTS -->` 플레이스홀더를 넣으면 해당 구간을
업로드된 인라인 테이블로 치환한다. `--apply` 없으면 stdout에만 출력한다.

**PR 본문 예시 (인라인)**

```markdown
## 스크린샷 (Before: `:3030` / After: `:3040`)

### landing

| Before | After |
|---|---|
| ![before-landing](https://github.com/user-attachments/assets/…) | ![after-landing](https://github.com/user-attachments/assets/…) |
```

### 3) 폴백 — blob 링크 테이블 (세션 없을 때)

`gh-image` 인증이 불가한 환경(브라우저 미로그인·세션 만료)에서는 **blob 링크 테이블**로
남긴다. 클릭하면 GitHub에서 이미지가 열린다 (엑스박스 없음, 인라인은 아님).

```markdown
| 화면 | Before | After |
|------|--------|-------|
| 랜딩 | [before-landing.png](https://github.com/ORG/REPO/blob/BRANCH/.github/pr-assets/SLUG/before-landing.png) | [after-landing.png](...) |
```

세션을 확보한 뒤 `gh-image`로 다시 올려 인라인으로 갱신하는 것을 권장한다.

## 금지 — PR 본문 `![...]()` 에 넣지 말 것

| 방식 | 결과 |
|---|---|
| `https://raw.githubusercontent.com/...` | private → 404 엑스박스 |
| `![...](.github/pr-assets/...)` 상대 경로 | PR 설명에서 렌더 실패 (엑스박스) |
| `gh-attach-assets/<uuid>/...` orphan 브랜치 | 레포 오염 + 임베드 불안정 |
| org private release / `gh-attach release-asset` | `<img>` 404 |
| `gh auth token` / PAT만으로 업로드 시도 | 422 — `user_session` 필요 |

`gh-attach login`은 PAT만 저장하고 브라우저 쿠키는 없어 `browser-session`이 422로 실패할 수
있다. 인라인 업로드는 **`gh-image`** 를 쓴다.

## 체크리스트

- [ ] before/after가 같은 뷰포트·화면·상태에서 찍혔는가
- [ ] PNG가 **feature 브랜치** `.github/pr-assets/<slug>/` 에 커밋됐는가
- [ ] PR 본문이 **`gh-image` `user-attachments` 인라인**인가 (기본)
- [ ] `gh image check-token` 이 통과했는가
- [ ] 세션 없을 때만 blob 링크 테이블 폴백을 썼는가