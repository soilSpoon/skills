# Example: multi-step setup surfaces (optional)

**패턴:** configure → commit. **맥락:** 순차 설정이 있는 제품 (온보딩·빌더·관리 콘솔 등).

## 증상 → 축 (일반)

| 증상 | 축 |
|------|-----|
| 스텝마다 CTA Y 다름 | action-placement, consistency |
| 프롬프트 카드 + 접힌 섹션 이중 | disclosure, visual-flow |
| 데이터 1건인데 list/delete UI | consistency (cardinality ≠ UI) |
| 폼 + 미리보기 플로팅 CTA | disclosure, action-placement |
| layout variant 많은데 체감 차이 작음 | design-phase-experiments |

## 적용

- `surface-contract` 고정 · 단일 shell · 단일 진입점
- cardinality에 맞는 UI
- 설계 variant 제거

본문 스킬에 하드코딩하지 않는 **검증 사례**일 뿐이다.