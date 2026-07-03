# 일관성 (consistency)

**질문:** 같은 종류의 결정·상태·행동이 화면 간에 **같은 레이아웃·컨트롤·피드백**으로 구현됐는가?

## 핵심 원칙

1. **SSOT 복제** — 가장 명확한 화면 하나를 표준으로 채택, 나머지는 거기에 맞춘다. 화면마다 새 레이아웃 발명 금지.
2. **축 단위 순차 적용** — 위치 → 피드백 → disclosure 순으로 PR 분리. 한 커밋에 모든 축을 섞지 않는다.
3. **역할=형태** — 생성 vs 확정 vs 삭제는 다른 시각·강도. 같은 성격은 같은 형태.
4. **표준 요소** — button, form+submit, 동일 collapsible, aria-current 등 익숙한 동작 보장.
5. **시스템 계약** — 개별 판단을 공용 Surface shell + 상태 토큰으로 승격.

## 진단 신호

- "어디 갔지?" — CTA·헤딩·아이콘이 **유사 surface**마다 다른 위치
- 한 화면에서 익힌 패턴이 다음 화면에서 안 통함
- 같은 "완료"인데 토스트/색/조용함이 제각각

## sources

- toss.tech/45391 (실험·축 단위), /27426 (Effective Component), /rethinking-design-system
- NN/g Toggle Guidelines — Implement Consistently