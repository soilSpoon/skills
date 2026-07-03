# Surface contract (범용)

**Surface** = 사용자가 한 덩어리의 설정·확정을 하는 UI 단위 (카드, 스텝, 패널, 모달 페이지).

## 불변 (유사 surface 간 동일)

| 항목 | 규칙 |
|------|------|
| 수직 순서 | 제목·맥락 → 입력 → (미리보기) → 주 CTA |
| 주 CTA | 미완료 시만 · full-width · 하단 sticky · 동일 컴포넌트 |
| 상태 어휘 | pending / in-progress / complete / failed (텍스트+live) |
| configure / commit | 입력은 가역 · 비용 큰 확정은 명시 버튼 1회 |
| 진입점 | 동일 행동에 **한** primary 진입점 |
| 카피 슬롯 | 제목 · 맥락 1줄 · CTA 라벨 · 상태 라벨 (microcopy 패턴 통일) |

## 권장 레이아웃: context → fields → action

```
┌─ Surface ─────────────────┐
│ 제목                       │
│ 맥락 1줄 (선택)            │
│ ┌ 필드 영역 ─────────────┐ │
│ │ 미완료: 펼침·기본값 확인 │ │
│ │ 완료: 편집만            │ │
│ └────────────────────────┘ │
│ ─── 구분 ───               │
│ [████ 주 CTA sticky ████]  │  ← 미완료만
└────────────────────────────┘
```

완료 후: CTA 제거, 필드만.

## 구현 메모 (제품 코드)

- 레이아웃 분기는 **단일 shell** 안에만
- surface별로 title · fields · onCommit · labels 만 주입
- 미리보기 영역(캔버스·맵·프리뷰)은 **결과 피드백** — 행동 진입점 아님

## when to vary

- **역할**이 다르면 형태 다름 OK: 생성(primary) vs 확정(apply) vs 삭제(destructive)
- **cardinality**가 다르면 컨트롤 다름 OK — 레이아웃·CTA 위치는 동일 유지