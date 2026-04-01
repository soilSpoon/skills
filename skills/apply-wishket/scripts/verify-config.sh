# verify-proposal.sh 설정 파일
# experience-pool.md와 동기화 필요

# 위시켓 포트폴리오 ID (파이프 구분)
PORTFOLIO_IDS='277406|287046|291990|291992|287048'

# 기술 디테일 금지어 — 내부 코드명/구현 상세가 지원서에 노출되면 안 됨
TECH_BANNED='PermissionGate|usePermission|SDK v5|hospital_id|RBAC|Chart\.js'

# 익명화 금지어 — 실제 회사/서비스명 노출 금지
ANON_BANNED='출근노트|에브리드론|GSS|슈퍼워크|gwnote|everydrone|포스코'

# 경험 코드 목록 (편중 검사용)
EXP_CODES_PATTERN='HR|SIM|MES|TOK|OSS|MENU'
