#!/bin/bash
# 지원서 구조 검사 스크립트
# Usage: bash verify-proposal.sh <proposal-file.md>
# 12항목 체크리스트를 자동 검증하고 PASS/FAIL을 출력한다.

FILE="$1"
if [ ! -f "$FILE" ]; then
  echo "Usage: bash verify-proposal.sh <proposal-file.md>"
  exit 1
fi

PASS=0
FAIL=0

check() {
  local name="$1" result="$2"
  if [ "$result" = "PASS" ]; then
    echo "  [PASS] $name"
    PASS=$((PASS+1))
  else
    echo "  [FAIL] $name — $3"
    FAIL=$((FAIL+1))
  fi
}

echo "=== 구조 검사: $(basename $FILE) ==="

# 본문 추출 (## 지원서 본문 ~ 다음 ---)
BODY=$(sed -n '/## 지원서 본문/,/^---$/p' "$FILE")

# 1. 프로젝트 핵심 파악 (본문 초반에 프로젝트 이해를 보여주는 내용)
COUNT=$(echo "$BODY" | head -20 | grep -c '.\{20,\}' 2>/dev/null)
[ "$COUNT" -ge 2 ] && check "프로젝트 분석" "PASS" || check "프로젝트 분석" "FAIL" "본문 초반 실질 내용 ${COUNT}줄"

# 2. 예상 이슈 2-3개
COUNT=$(echo "$BODY" | grep -c -i '이슈\|리스크\|문제' 2>/dev/null)
[ "$COUNT" -ge 2 ] && check "이슈 2-3개" "PASS" || check "이슈 2-3개" "FAIL" "${COUNT}개"

# 3. 경험 연결 (유사 경험/프로젝트 언급)
PATTERN_COUNT=$(echo "$BODY" | grep -c '경험\|프로젝트.*진행\|구축\|개발.*경험\|도입\|전환\|개선\|→' 2>/dev/null)
[ "$PATTERN_COUNT" -ge 2 ] && check "경험 연결" "PASS" || check "경험 연결" "FAIL" "${PATTERN_COUNT}개"

# 4. 단계별 프로세스
STAGE_COUNT=$(echo "$BODY" | grep -c '단계' 2>/dev/null)
[ "$STAGE_COUNT" -ge 2 ] && check "단계별 프로세스" "PASS" || check "단계별 프로세스" "FAIL" "${STAGE_COUNT}단계"

# 5. 830자 이상
CHARS=$(echo "$BODY" | wc -m | tr -d ' ')
[ "$CHARS" -ge 830 ] && check "830자 이상" "PASS" || check "830자 이상" "FAIL" "${CHARS}자"

# 6. 포트폴리오 2개+
PF_COUNT=$(grep -c '277406\|287046\|291990\|291992\|287048' "$FILE" 2>/dev/null)
[ "$PF_COUNT" -ge 2 ] && check "포트폴리오 2개+" "PASS" || check "포트폴리오 2개+" "FAIL" "${PF_COUNT}개"

# 7. 기술 디테일 금지어
TECH_VIOLATIONS=$(echo "$BODY" | grep -c -i 'PermissionGate\|usePermission\|SDK v5\|hospital_id\|RBAC\|Chart\.js' 2>/dev/null)
[ "$TECH_VIOLATIONS" -eq 0 ] && check "기술 금지어" "PASS" || check "기술 금지어" "FAIL" "${TECH_VIOLATIONS}건"

# 8. 미팅 논의 포함
MEETING=$(echo "$BODY" | grep -c '미팅 시 논의\|논의 희망' 2>/dev/null)
[ "$MEETING" -ge 1 ] && check "미팅 논의" "PASS" || check "미팅 논의" "FAIL"

# 9. 익명화 금지어
ANON_VIOLATIONS=$(echo "$BODY" | grep -c -i '출근노트\|에브리드론\|GSS\|슈퍼워크\|gwnote\|everydrone\|포스코' 2>/dev/null)
[ "$ANON_VIOLATIONS" -eq 0 ] && check "익명화" "PASS" || check "익명화" "FAIL" "${ANON_VIOLATIONS}건"

# 10. 범위형 기간 금지
RANGE=$(echo "$BODY" | grep -c '[0-9]~[0-9].*주\|[0-9]~[0-9].*일' 2>/dev/null)
[ "$RANGE" -eq 0 ] && check "확정형 기간" "PASS" || check "확정형 기간" "FAIL" "${RANGE}건"

# 11. 경험 소스 편중 (전체 파일에서)
EXP_CODES=$(grep '경험 [12]:' "$FILE" | grep -o 'HR\|SIM\|MES\|TOK\|OSS\|MENU' 2>/dev/null | sort | uniq -d)
[ -z "$EXP_CODES" ] && check "경험 편중 없음" "PASS" || check "경험 편중 없음" "FAIL" "중복: $EXP_CODES"

# 12. 금액 근거
DAILY=$(grep -c '만원/일\|만/일' "$FILE" 2>/dev/null)
[ "$DAILY" -ge 1 ] && check "금액 근거" "PASS" || check "금액 근거" "FAIL"

echo ""
echo "결과: ${PASS}/12 PASS, ${FAIL}/12 FAIL"
