# PR 시각 증거 (before/after 스크린샷)

프론트·UI·타이포·레이아웃처럼 **화면이 바뀌는 PR**은 리뷰어가 diff만으로 판단하기 어렵다. ship
전 증거를 남긴다. **private 레포**에서는 *어디에* 두고 *어떻게* 링크하느냐가 잘못되면 PR 본문에
엑스박스(404)만 보인다.

## 언제 필수인가

다음 중 하나라도 해당하면 before/after를 남긴다:

- 폰트·색·간격·컴포넌트 스타일 변경
- 레이아웃·네비·대시보드·워크벤치 등 주요 화면 UX 변경
- 시각 회귀가 우려되는 리팩터

순수 로직·API·백엔드만 바뀌면 생략 (비례).

## 표준 워크플로 (private 레포 기준)

### 1) PNG는 feature 브랜치에 커밋

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

### 2) PR 본문 — **링크 테이블** (기본, 엑스박스 없음)

private 레포 PR 설명에서 `![alt](url)` **인라인 임베드는 깨지는 경우가 많다**
(relative path, `raw.githubusercontent.com`, orphan 브랜치 URL, release URL 모두 시도해도 404).

**기본 형식:** blob 링크 테이블. 클릭하면 GitHub에서 이미지가 열린다 (로그인한 팀원).

```markdown
## 스크린샷

| 화면 | Before | After |
|------|--------|-------|
| 랜딩 | [before-landing.png](https://github.com/ORG/REPO/blob/BRANCH/.github/pr-assets/SLUG/before-landing.png) | [after-landing.png](...) |

일괄: [`.github/pr-assets/SLUG/`](https://github.com/ORG/REPO/tree/BRANCH/.github/pr-assets/SLUG)
```

`BRANCH` = PR head 브랜치명. **코드와 같은 브랜치**에 PNG가 있어야 한다.

### 3) 인라인 미리보기가 꼭 필요할 때만 — GitHub 웹 드래그앤드롭

PR 편집 UI에 PNG를 **드래그앤드롭**하면 `user-attachments` URL이 생성되고, private에서도
본문에 인라인으로 보인다. 이 경로는 **브라우저 세션(쿠키)** 이 필요해 CLI 자동화가 불안정할
수 있다 (`gh-attach browser-session`은 PAT만으로는 422가 날 수 있음).

자동화보다 **수동 드래그앤드롭**을 인라인용으로 쓰고, 그 외에는 1)·2)를 기본으로 한다.

## 금지 — PR 본문 `![...]()` 에 넣지 말 것

| 방식 | 결과 |
|---|---|
| `https://raw.githubusercontent.com/...` | private → 404 엑스박스 |
| `![...](.github/pr-assets/...)` 상대 경로 | PR 설명에서 렌더 실패 (엑스박스) 사례 다수 |
| `gh-attach-assets/<uuid>/...` orphan 브랜치 | 레포 오염 + 임베드도 불안정 |
| 임시 release / `?raw=1` blob 임베드 | private에서 `<img>` 실패 가능 |

orphan `gh-attach-assets` 브랜치·임시 release 태그는 만들지 않는다.

## 체크리스트

- [ ] before/after가 같은 뷰포트·화면·상태에서 찍혔는가
- [ ] PNG가 **feature 브랜치** `.github/pr-assets/<slug>/` 에 커밋됐는가
- [ ] PR 본문이 **blob 링크 테이블**인가 (`![...]()` 인라인 아님)
- [ ] 인라인 미리보기는 웹 드래그앤드롭으로만 추가했는가 (선택)