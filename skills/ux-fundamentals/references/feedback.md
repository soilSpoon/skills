# 피드백 (feedback · states)

**질문:** 상태 변화가 **내용 무게에 맞는 채널**로, **같은 종류는 같은 방식**으로 오는가?

## 상태 어휘 (통일)

`pending` · `in-progress` · `complete` · `failed` — 텍스트 라벨 + aria-live (+ aria-busy).
색·캔버스만으로 전달 금지.

## 무게–그릇 매칭

| 무게 | 채널 |
|------|------|
| 가벼운 완료 (되돌릴 수 있음) | 인라인 라벨 + 약한 미리보기 강조. 토스트/모달 X |
| 설명 필요한 실패·차단 | 다이얼로그 — 상황·이유·다음 행동 |
| 진행 중 | 인라인 + indeterminate; 모션은 절제·reduced-motion |

**일관성 vs 무게:** 상태 **클래스** 내부는 동일 처리; 무게는 클래스 **분류**에만 사용.

## 두 단계 피드백 (권장)

1. **버튼 근처** — lightweight status (proximity)
2. **미리보기/결과 영역** — authoritative 결과 (directional, transient)

## sources

- toss.tech/21021, /introducing-toss-error-message-system, /interaction
- Material multi-step form; A11y Fundamentals