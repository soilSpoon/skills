# 접근성 — UX 관점 (이 스킬 내장)

구현 레시피(React prop)가 아니라 **사용자가 인지·조작하는 방식** 기준.

## 원칙

1. **이름** — 모든 인터랙티브 요소에 사용자 언어 이름 (아이콘만 버튼 금지)
2. **읽기 순서** — 시각 흐름 = 포커스/스크린리더 순서 (visual-flow와 동일 계약)
3. **상태는 텍스트** — 색·아이콘만으로 pending/complete/failed 전달 금지; aria-live·aria-busy
4. **표준 요소** — button, label, fieldset, radio group — 커스텀 div 클릭 영역 최소화
5. **반복 라벨** — 같은 CTA 문구가 여러 surface에 있으면 제목·aria-labelledby로 구분
6. **motion** — prefers-reduced-motion 존중; 방향성 있는 절제된 전이

## UX 리뷰 체크

- [ ] 주 CTA에 접근 가능한 name
- [ ] 상태 변경이 announce 되는가
- [ ] 버튼 안 버튼, 행 전체 onClick 없는가

## sources

- toss.tech/A11y_Fundamentals, /voiceover_usability, /38743