#!/usr/bin/env bash
# pr-inline-images.sh — gh-image로 private PR 본문 인라인 스크린샷 업로드
#
# user-attachments URL을 얻어 PR 본문에 ![...]() 로 붙일 때 쓴다.
# PAT/gh auth token 만으로는 업로드가 안 되므로 브라우저 세션이 필요하다.
#
# 사용:
#   export GH_SESSION_TOKEN="$(gh image extract-token)"   # 로컬(브라우저 로그인)
#   bash scripts/pr-inline-images.sh \
#     --repo everysim-dev/dronerush \
#     --pr 2319 \
#     --assets .github/pr-assets/pretendard-font \
#     --body-file .github/pr-body.md \
#     --apply
#
# --apply 없으면 업로드 + 치환된 본문을 stdout에만 출력한다.
set -euo pipefail

REPO=""
PR=""
ASSETS=""
BODY_FILE=""
APPLY=false
PLACEHOLDER="<!-- PR_INLINE_SCREENSHOTS -->"

usage() {
  sed -n '2,16p' "$0"
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) [ $# -ge 2 ] || usage 2; REPO="$2"; shift 2 ;;
    --repo=*) REPO="${1#*=}"; shift ;;
    --pr) [ $# -ge 2 ] || usage 2; PR="$2"; shift 2 ;;
    --pr=*) PR="${1#*=}"; shift ;;
    --assets) [ $# -ge 2 ] || usage 2; ASSETS="$2"; shift 2 ;;
    --assets=*) ASSETS="${1#*=}"; shift ;;
    --body-file) [ $# -ge 2 ] || usage 2; BODY_FILE="$2"; shift 2 ;;
    --body-file=*) BODY_FILE="${1#*=}"; shift ;;
    --apply) APPLY=true; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown arg: $1" >&2; usage 2 ;;
  esac
done

[ -n "$REPO" ] || { echo "--repo owner/repo 가 필요하다" >&2; exit 2; }
[ -n "$PR" ] || { echo "--pr N 이 필요하다" >&2; exit 2; }
[ -n "$ASSETS" ] || { echo "--assets DIR 이 필요하다" >&2; exit 2; }
[ -d "$ASSETS" ] || { echo "assets dir 없음: $ASSETS" >&2; exit 2; }

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI 가 필요하다" >&2
  exit 2
fi

if ! gh image --version >/dev/null 2>&1; then
  echo "gh-image 확장 설치 중..." >&2
  gh extension install drogers0/gh-image
fi

if [ -z "${GH_SESSION_TOKEN:-}" ] && [ -f "$HOME/.config/gh/image-session" ]; then
  GH_SESSION_TOKEN=$(tr -d '[:space:]' <"$HOME/.config/gh/image-session")
  export GH_SESSION_TOKEN
fi

if ! gh image check-token >/dev/null 2>&1; then
  echo "gh-image 인증 실패 — user_session 토큰이 필요하다 (PAT/gh auth token 과 다름)" >&2
  echo "  한 번만 설정 (호스트 Mac 터미널 — Docker 밖, github.com 로그인된 Chrome):" >&2
  echo "    gh image extract-token > ~/.config/gh/image-session && chmod 600 ~/.config/gh/image-session" >&2
  echo "  또는 DevTools → Cookies → user_session 값을 같은 파일에 저장" >&2
  echo "  이후 Docker/headless: gh image check-token" >&2
  exit 1
fi

declare -A URLS=()
shopt -s nullglob
pngs=("$ASSETS"/*.png)
shopt -u nullglob

if [ ${#pngs[@]} -eq 0 ]; then
  echo "PNG 없음: $ASSETS/*.png" >&2
  exit 2
fi

echo "업로드 중 (${#pngs[@]} files) → $REPO ..." >&2
for f in "${pngs[@]}"; do
  base=$(basename "$f")
  md=$(gh image --repo "$REPO" "$f")
  url=$(printf '%s\n' "$md" | sed -n 's/^!\[[^]]*\](\(.*\))$/\1/p')
  if [ -z "$url" ]; then
    echo "업로드 실패(마크다운 파싱): $base" >&2
    exit 1
  fi
  URLS["$base"]="$url"
  echo "  ✓ $base" >&2
done

build_screenshots_md() {
  local screens=()
  for f in "${pngs[@]}"; do
    local b=$(basename "$f")
    case "$b" in
      before-*.png) screens+=("${b#before-}") ;;
    esac
  done

  if [ ${#screens[@]} -eq 0 ]; then
    for f in "${pngs[@]}"; do
      local b=$(basename "$f")
      printf '### %s\n\n![%s](%s)\n\n' "${b%.png}" "$b" "${URLS[$b]}"
    done
    return
  fi

  echo "## 스크린샷"
  echo
  for screen in "${screens[@]}"; do
    local label="${screen%.png}"
    local before="before-$screen"
    local after="after-$screen"
    echo "### $label"
    echo
    echo "| Before | After |"
    echo "|---|---|"
    printf '| ![%s](%s) | ![%s](%s) |\n' \
      "$before" "${URLS[$before]:-}" \
      "$after" "${URLS[$after]:-}"
    echo
  done
}

SCREENSHOTS_MD=$(build_screenshots_md)

if [ -n "$BODY_FILE" ]; then
  [ -f "$BODY_FILE" ] || { echo "body file 없음: $BODY_FILE" >&2; exit 2; }
  if grep -qF "$PLACEHOLDER" "$BODY_FILE"; then
    BODY=$(python3 - "$BODY_FILE" "$PLACEHOLDER" "$SCREENSHOTS_MD" <<'PY'
import sys
path, marker, block = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path, encoding="utf-8").read()
if marker not in text:
    sys.exit(1)
print(text.replace(marker, block, 1), end="")
PY
)
  else
    BODY=$(cat "$BODY_FILE")
    BODY="$BODY

$SCREENSHOTS_MD"
  fi
else
  BODY="$SCREENSHOTS_MD"
fi

if $APPLY; then
  tmp=$(mktemp)
  printf '%s' "$BODY" >"$tmp"
  gh pr edit "$PR" --repo "$REPO" --body-file "$tmp"
  rm -f "$tmp"
  echo "PR #$PR 본문 업데이트 완료" >&2
else
  printf '%s\n' "$BODY"
fi