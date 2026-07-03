# 행동 배치 (action-placement)

**질문:** 주 동작(Primary CTA)이 **어디에**, **얼마나 크게**, **일관되게** 있는가?

## 계약 (권장 기본값)

- **하단 full-width sticky** — 유사 설정 화면 전체에 동일 Y·동일 컴포넌트
- **필드와 시각 분리** — 구분선·primary 색·여백으로 "입력"과 "실행" 분리
- **전진=스캔 끝** — 다단계 흐름에서 commit CTA는 매 단계 같은 하단 앵커
- **터치·접근성** — 넉넉한 패딩·타깃 크기 (Fitts)

## 충돌

- 좌정렬 vs 우정렬 → **full-width로 해소**
- 필드 바로 아래 vs sticky → **sticky 우선** (필드 길 때도 버튼 시야 유지)

## Anti-pattern

- 화면마다 CTA가 카드 위/중간/아래로 분산
- 보조 버튼과 주 CTA가 같은 visual weight

## sources

- UX Collective "Where to put the primary button?"
- toss.tech/21021, /tds-component-making (시선·인지 비용)