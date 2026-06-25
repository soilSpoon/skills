# PR 시각 증거 (before/after 스크린샷)

프론트·UI·타이포·레이아웃처럼 **화면이 바뀌는 PR**은 리뷰어가 diff만으로 판단하기 어렵다. ship
전 PR 본문에 before/after를 남긴다. 단, **이미지 호스팅 방식**을 틀리면 private 레포에서 엑스박스(404)가
난다.

## 언제 필수인가

다음 중 하나라도 해당하면 **before/after 스크린샷을 PR에 포함**한다:

- 폰트·색·간격·컴포넌트 스타일 변경
- 레이아웃·네비·대시보드·워크벤치 등 주요 화면 UX 변경
- 시각 회귀가 우려되는 리팩터 (동작은 같아도 *보이는* 결과가 다를 수 있음)

순수 로직·API·백엔드만 바뀌면 생략 (비례).

## 올바른 방법 — feature 브랜치에 커밋 + 상대 경로

**원칙:** 스크린샷은 **코드 PR과 같은 feature 브랜치**에 PNG로 커밋하고, PR 본문에는 **레포 루트
기준 상대 경로**만 쓴다. GitHub가 PR head 브랜치 기준으로 인증 프록시 렌더링한다.

```
.github/pr-assets/<slug>/
  before-landing.png
  after-landing.png
  before-dashboard.png
  after-dashboard.png
  ...
```

PR 본문 예시:

```markdown
## 스크린샷

### 랜딩 (`/ko`)

| Before | After |
|---|---|
| ![before landing](.github/pr-assets/pretendard-font/before-landing.png) | ![after landing](.github/pr-assets/pretendard-font/after-landing.png) |
```

### 캡처 절차 (everysim / worktree 예시)

1. **Before** — base 브랜치(또는 main) 앱을 한 포트에서 띄운 뒤 캡처
2. **After** — feature worktree를 다른 포트에서 띄운 뒤 같은 화면·뷰포트로 캡처
3. 파일명 규칙: `before-<화면>.png` / `after-<화면>.png` (kebab-case)
4. 최소 화면: 변경이 체감되는 **대표 2~3곳** (랜딩·대시보드·워크벤치 등)
5. **별도 커밋**으로 `.github/pr-assets/<slug>/`만 추가 (코드 커밋과 분리해도 됨)
6. `gh pr create` / `gh pr edit --body-file` 로 본문에 상대 경로 삽입

뷰포트·포트는 본문에 한 줄로만 적는다 (예: `1480×900`, before `:3030` / after `:3041`).

### 머지 후

- `.github/pr-assets/` 는 **히스토리용으로 남겨도** 되고, 팀 정책에 따라 머지 후 삭제 PR을 올려도 된다.
- **orphan 브랜치·release 태그는 머지 후 정리**한다 (아래 금지 항목).

## 금지 — PR 본문에 넣지 말 것

| 방식 | 왜 안 되나 |
|---|---|
| `https://raw.githubusercontent.com/...` | private 레포에서 인증 없이 404 → **엑스박스** |
| `gh-attach-assets` 등 **별도 orphan 브랜치 URL** | 레포 오염·UUID 경로·PR과 분리된 쓰레기 브랜치 |
| `releases/download/...` (prerelease 임시 태그) | private에서 `<img>` 렌더 실패 가능, 태그 관리 부담 |
| PR 본문에 base64 인라인 | 가독성·diff 노이즈 |

`?raw=1` blob URL, `github.com/.../raw/refs/heads/gh-attach-assets/...` 도 **본문 임베드용으로
쓰지 않는다.** 이미지가 안 보이면 상대 경로 + Files changed 링크로 충분하다.

## 대안 (상대 경로가 안 될 때만)

1. **Files changed** 탭에서 `.github/pr-assets/` PNG 직접 열람 (항상 동작)
2. GitHub 웹 UI에서 PR 코멘트에 **드래그앤드롭** 업로드 → `user-attachments` URL (수동, private OK)
3. 공개 레포만: release asset 또는 raw URL 검토

자동화가 필요하면 feature 브랜치 커밋 + 상대 경로를 **기본**으로 두고, `gh-attach` orphan 브랜치는
**쓰지 않는다**.

## 체크리스트

- [ ] before/after가 **같은 뷰포트·같은 화면·같은 상태**에서 찍혔는가
- [ ] PNG가 **feature 브랜치** `.github/pr-assets/<slug>/` 에 커밋됐는가
- [ ] PR 본문이 **상대 경로**만 쓰는가 (외부 raw URL 없음)
- [ ] orphan `gh-attach-assets` / 임시 release 태그를 만들지 않았는가