#!/usr/bin/env bash
# preship-scan.sh — 커밋·PR 직전 기계적 스캔 (SKILL.md G1·G2·G4·G5 보조).
# best-effort 휴리스틱이다. clean 리포트는 ship 보증이 아니다 — 게이트의 판단을 대체하지 않는다.
# 섹션마다 무엇을 봤는지 정직히 라벨한다. read-only(변경하지 않음).
#   사용: bash scripts/preship-scan.sh [--base REF]
#     --base REF  비교 기준(기본: staged = index vs HEAD). PR 스코프를 보려면 origin/main 등.
# secret 스캔은 키워드=값 + 알려진 토큰 모양만 잡는다 — 단일따옴표 키·접두 없는 토큰은
# 구조적으로 놓친다(아래 SECRET 섹션 라벨 참조). diff를 직접 읽는 G1을 대체하지 않는다.
set -euo pipefail

BASE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --base) [ $# -ge 2 ] || { echo "--base 에 REF 인자가 필요하다" >&2; exit 2; }
            BASE="$2"; shift 2 ;;
    --base=*) BASE="${1#*=}"; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git repo — preship-scan needs git." >&2; exit 2
fi

# BASE를 단일 안전 ref 토큰으로 제한 → 아래 unquoted 사용이 word-split/glob에 안전.
if [ -n "$BASE" ]; then
  case "$BASE" in
    *[!A-Za-z0-9._/-]*) echo "--base REF 형식이 이상하다(공백/특수문자): $BASE" >&2; exit 2 ;;
  esac
  DIFF_ARGS="$BASE"; SCOPE_LABEL="$BASE..worktree"
else
  DIFF_ARGS="--cached"; SCOPE_LABEL="staged (index vs HEAD)"
fi
diff_added() { git diff $DIFF_ARGS -U0 -- "$@" 2>/dev/null | grep -E '^\+' | grep -vE '^\+\+\+'; }
section() { printf '\n=== %s ===\n' "$1"; }

section "BRANCH"
BR="$(git branch --show-current 2>/dev/null || true)"
[ -n "$BR" ] || BR="(detached/unborn)"
echo "current: $BR"
case "$BR" in main|master) echo "  ⚠ 기본 브랜치다 — 커밋 전 브랜치를 먼저 판다." ;; esac
echo "scope: $SCOPE_LABEL"

section "WHAT'S INCLUDED (G2)"
echo "-- staged 파일 --"
git diff --cached --name-status 2>/dev/null | sed 's/^/  /' || true
UNSTAGED="$(git diff --name-only 2>/dev/null || true)"
[ -n "$UNSTAGED" ] && { echo "-- unstaged(미포함) --"; printf '%s\n' "$UNSTAGED" | sed 's/^/  /'; }
UNTRACKED="$(git ls-files --others --exclude-standard 2>/dev/null || true)"
[ -n "$UNTRACKED" ] && { echo "-- untracked(추적 안 됨) --"; printf '%s\n' "$UNTRACKED" | sed 's/^/  /'; }

section "TEST / COMMENT 신호 (G3·G4 진입 환기, 정보용)"
STAGED_FILES="$(git diff --cached --name-only 2>/dev/null || true)"
TESTN=$(printf '%s\n' "$STAGED_FILES" | grep -icE '(\.|_|/)(test|spec)s?[._/]|__tests__|\.(test|spec)\.' || true)
echo "  staged 테스트 파일: ${TESTN} (코드만 staged이고 0이면 G4 — 유닛·피처 테스트 확인)"
CMTN=$(diff_added . | grep -cE '^\+[[:space:]]*(//|#|\*|/\*)' || true)
echo "  추가된 주석 라인: ${CMTN} (많으면 G3 — 최소화 + 기존 밀도/스타일 대조)"

section "STRAY / ARTIFACT 후보"
ART='(^|/)(dist|build|out|coverage|node_modules)/|\.(zip|tar|tgz|log|map|min\.js)$|(^|/)\.(env|DS_Store)|\.(pyc|class|o)$'
{ printf '%s\n' "$STAGED_FILES"; printf '%s\n' "$UNTRACKED"; } | grep -E "$ART" | sed 's/^/  ⚠ /' \
  || echo "  (의심 패턴 없음 — 그래도 untracked 목록은 눈으로 확인)"
printf '%s\n' "$STAGED_FILES" | while IFS= read -r f; do
  [ -f "$f" ] || continue
  sz=$(wc -c <"$f" 2>/dev/null | tr -d ' ' || echo 0)
  [ "${sz:-0}" -gt 524288 ] && printf '  ⚠ large: %s (%s bytes)\n' "$f" "$sz"
done || true

section "SECRET 패턴 (추가된 줄, 키워드=값 + 토큰 모양만)"
SEC='(AKIA[0-9A-Z]{16}|-----BEGIN[A-Z ]*PRIVATE KEY-----|xox[baprs]-[0-9A-Za-z-]{8,}|sk_live_[0-9A-Za-z]{16,}|gh[posru]_[0-9A-Za-z]{20,}|ssh-rsa AAAA|[Bb]earer [A-Za-z0-9._-]{20,}|(api[_-]?key|secret|passwd|password|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)["[:space:]]*[:=])'
if diff_added . | grep -inE "$SEC" | head -40 | sed 's/^/  ⚠ /'; then :; else
  echo "  (매치 없음 — 단일따옴표 키·접두 없는 토큰·인라인 URL 자격증명은 구조적으로 놓침. 눈으로도 확인)"; fi

section "DEBUG 잔여 (추가된 줄, best-effort)"
DBG='(console\.(log|debug)|debugger;|System\.out\.print|binding\.pry|byebug|dbg!|fmt\.Print|^[+].*\b(TODO|FIXME|XXX)\b|^[+][[:space:]]*//.*[A-Za-z].*;[[:space:]]*$)'
if diff_added . | grep -inE "$DBG" | head -40 | sed 's/^/  ⚠ /'; then :; else echo "  (매치 없음)"; fi

section "DURABILITY — 휘발성 표현 (추가된 줄, G6)"
VOL='(현재는|지금은|최근에|오늘 기준|어제|Phase [0-9]|[0-9]차 시도|임시(로)?|wf_[0-9a-f]{6,}|as of (today|now))'
if diff_added . | grep -inE "$VOL" | head -30 | sed 's/^/  ⚠ /'; then :; else
  echo "  (매치 없음 — 코드/주석/메시지 모두 무시간인지 눈으로)"; fi

section "메시지 관례 (G5 — 도출용 샘플)"
echo "-- 최근 커밋 subject --"
git log --format='  %s' -15 2>/dev/null || echo "  (히스토리 없음)"
if command -v gh >/dev/null 2>&1; then
  echo "-- 최근 머지된 PR 제목 --"
  gh pr list --state merged --limit 10 --json title --jq '.[].title' 2>/dev/null | sed 's/^/  /' \
    || echo "  (gh: PR 조회 실패 — 인증/원격 확인)"
fi
for t in .github/PULL_REQUEST_TEMPLATE .github/pull_request_template .github/PULL_REQUEST_TEMPLATE.md .github/pull_request_template.md; do
  [ -e "$t" ] && echo "PR 템플릿 있음: $t"
done

printf '\n--- best-effort 스캔 끝. 매치 0이 보증은 아니다 — diff를 직접 읽어라(G1). ---\n'
