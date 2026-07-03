# 선택·커밋 (selection · configure→commit)

**질문:** 컨트롤 **형태**가 선택 구조와 맞고, 가벼운 설정과 무거운 적용이 **분리**됐는가?

## 컨트롤 ↔ cardinality

| 구조 | 위젯 |
|------|------|
| 상호배타 1-of-N | radio / single-select group |
| 독립 다중 | checkbox / 개별 필드 |
| 즉시 반영 이진 | toggle (폼 submit 필요 없는 것만) |

습관이 아니라 **논리 구조**로 위젯 선택.

## configure vs commit

- **Configure** — 되돌릴 수 있는 입력·선택. Back/Cancel로 폐기.
- **Commit** — 비용 큰 생성·적용·제출 = **명시 버튼**, 유사 surface 간 **동일 위치**
- toggle/on-change에 무거운 부작용 금지
- 즉시 on-change는 **저비용 reversible** (미리보기 토글 등)만

## 기본값

- 좋은 기본값으로 열기 → 사용자 과제는 "확인/조정" not "처음부터 조립"

## sources

- NN/g Toggle-Switch Guidelines
- toss.tech/mysterydesignclub1, /A11y_Fundamentals