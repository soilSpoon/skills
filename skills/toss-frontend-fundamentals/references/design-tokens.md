# Design Tokens & API Layering (토스 TDS 기반)

## 목차

1. 왜 이 파일이 존재하나
2. 4축 토큰 네이밍 (Target / Role / Variant / Level)
3. Single Source of Truth — 토큰은 codegen으로 분산시켜라
4. 인지 균일 색공간 (OKLCH) — 접근성 × 일관성
5. Flat API vs Compound API — 하이브리드 전략
6. 우회할 이유를 줄이는 설계 (메타 원칙)
7. 마이그레이션 전략 — 3단계

---

## 왜 이 파일이 존재하나

스킬 본문 §플랫폼 철학 #7 "**우회할 이유를 줄이는 설계**" 와 "매직 넘버" 가이드가 만나는 지점을 구체 레시피로 내린다. 출처는 토스 기술 블로그 [`rethinking-design-system`](https://toss.tech/article/rethinking-design-system) 과 [`tds-color-system-update`](https://toss.tech/article/tds-color-system-update).

---

## 1. 4축 토큰 네이밍 (Target / Role / Variant / Level)

### 원칙

**토큰 이름이 값을 드러내면 바꾸기 어렵다. 이름이 의미를 드러내면 바꾸기 쉽다.**

TDS v2 토큰은 전체 4-레벨 계층으로 관리되고, 아래 4축은 그 중 **Name 레벨**을 구성하는 의미 인코딩:

```
Category        → Color / Layout / Effect
  Style Element → Color / Sizing / Spacing / Blur
    Level       → Base (raw) / Semantic (의미) / Component (용도)
      Name      → Target · Role · Variant 조합 (아래 표)
```

Name을 구성하는 4축:

| 축 | 의미 | 예시 |
|---|---|---|
| **Target** | 색상이 적용되는 대상 | `fill`, `text`, `border` |
| **Role** | 의미론적/계층적 역할 | `brand`, `neutral`, `primary`, `accent`, `success`, `warning`, `danger` |
| **Variant** | 변형 스타일 | `weak`, `alt`, `strong` |
| **Level** | 추상화 단계 | `Base` (raw), `Semantic` (의미), `Component` (용도) |

### 전체 팔레트 관점 (부분 수정 안티패턴)

> "Blue 100만 고쳤더니 Red 100, Yellow 100, Green 100도 같이 봐야 하고, Blue 컬러 전체의 명도 진행도 다시 고려해야 했어요."

컬러 토큰은 **단일 값 수정이 불가능**하다. 한 번 건드리면 (1) 같은 단계(100)에 있는 다른 컬러의 명도, (2) 해당 컬러의 전체 명도 진행(100→500→900)을 모두 재검토해야 한다. 리뷰 시 "이 컬러 하나만 바꿔주세요" PR이 들어오면 **팔레트 일관성 영향 분석**을 요구.

### 안티패턴 → 개선

```diff
- color: #1B64DA;          // 매직 컬러
- color: var(--blue-500);  // Base 레벨만 — 브랜드 바뀌면 깨짐
+ color: var(--fill-brand);            // Semantic — 브랜드 변경 자동 반영
+ color: var(--button-fill-primary);   // Component — 용도 명확
```

### 검사 룰

- CSS/JS에 리터럴 색상·z-index·spacing이 직접 등장 → `[MUST]` 토큰화
- 토큰 이름에 숫자만 있음 (`blue-100`, `z-9999`, `space-4`) → `[SHOULD]` Base 레벨은 허용하되 Semantic/Component 레벨로 bumping 검토
- 라이트/다크 모드에서 다른 토큰 이름을 쓰면 → `[MUST]` 동일 토큰 이름 + 모드별 값 바인딩

### 원문 근거

> "토큰자체도 '사람과 기계가 모두 읽을 수 있는 구조'를 만들었던 것도 디자인 의사결정을 인코딩해 모두가 동일한 멘탈 모델을 가지기 위해서였어요."

---

## 2. Single Source of Truth — 토큰은 codegen으로 분산시켜라

### 원칙

**토큰은 한 곳에서 정의, 여러 플랫폼으로 자동 생성.** 웹/네이티브/서버/디자인 에디터가 각자 관리하면 반드시 어긋난다.

### 구현 힌트

- Style Dictionary + Token Studio (Figma 플러그인) + codegen
- Figma → GitHub PR 자동 생성 → 전처리된 토큰 → 플랫폼별 산출물(CSS·TS·iOS·Android·Server-Driven Format) 동시 빌드
- CI가 빌드 시점에 에러를 감지하고 디자이너가 직접 수정 → 리뷰

### 원문 근거

> "디자이너는 Token Studio라는 Figma 플러그인을 통해 GitHub에 커밋하고 PR을 생성하면, 전처리된 토큰과 각 플랫폼별 코드가 자동으로 생성됩니다. ... 빌드 시점에 에러를 감지하고 알려주기 때문에 디자이너가 직접 수정한 후 리뷰를 요청할 수 있습니다."

---

## 3. 인지 균일 색공간 (OKLCH) — 접근성 × 일관성

### 원칙

**같은 단계명(100/500)에 명도가 컬러별로 제각각이면 시각적 일관성이 깨지고 대비가 들쭉날쭉하다.** OKLCH 같은 인지 균일 색공간을 기준 명도로 사용하면 컬러별 대비가 통일된다.

### 한계

> "노란색에 OKLCH만 적용: '수치적으로 일정한 팔레트'만으로는 The Dark Yellow Problem 해결 못 함 → 시각보정 필요."

수치 일관성만으로 안 풀리는 컬러(특히 노랑·청록)는 **시각보정 단계**를 별도로 두라.

### 라이트 기준 작업 = 다크 깨짐 안티패턴

> "같은 색이 라이트모드에서는 1.06:1이고 다크모드에서는 1.36:1이어서, 다크모드에서만 너무 튀는 색이 되었어요."

디자이너가 **라이트 모드만 보고 작업하면 다크에서 대비가 어긋난다**. 토큰 정의 단계에서 **두 모드 동시 검증**이 필수. CI에 "동일 토큰의 라이트/다크 대비 비율 차이가 Δ 임계값 이내"를 검사하는 룰을 추가.

### a11y 교차 체크

- 대비 비율 기준 (`4.5:1` 본문 / `3:1` 대형 텍스트·UI) 은 **별개의 테스트**로 유지
- OKLCH 명도 통일 ≠ WCAG 대비 통과

---

## 4. Flat API vs Compound API — 하이브리드 전략

### 핵심 판단

| 상황 | 권장 API | 이유 |
|---|---|---|
| 사용 빈도 ↑ + 변형 여지 ↓ | **Flat** | 작성 간결, 학습 곡선 ↓ |
| 사용 빈도 ↓ + 변형 여지 ↑ | **Compound** | 확장성, 슬롯 기반 커스터마이징 |
| 둘 다 섞인 도메인 | **둘 다 동시 export** | 내부는 같은 primitive 재사용 |

### 경고 신호

- Flat 컴포넌트 prop이 15+ 개거나 boolean prop이 5+ 개 → **Compound로 분해**
- Card에 `title`만 설정하는데 `<Card><Card.Header><Card.Title>...` 강요 → **Flat 오버로드 추가**
- 팀이 컴포넌트를 fork·detach하고 있음 → **API 설계 실패의 증상**. 왜 우회하는지 먼저 조사

### 구현 패턴 (TDS 하이브리드)

```tsx
// Flat 진입점 — 단순 케이스
import { Card as FlatCard, Button, Badge } from "@tds/mobile/flat";
<FlatCard title="제목" description="설명" action={<Button>action</Button>} />

// Compound 진입점 — 변형 케이스
import { Card } from "@tds/mobile";
<Card>
  <Card.Header>
    <Card.Title>제목</Card.Title>
    <Card.Actions><Button>action</Button></Card.Actions>
  </Card.Header>
  <Card.Body>...</Card.Body>
</Card>
```

내부 primitive는 공유. "Flat API를 Compound로 미리 조립한 케이스"라고 생각하면 된다.

### 원문 근거

> "TDS는 '어떤 패턴이 옳은가'가 아니라, '언제 어떤 선택이 적절한가'에 집중했습니다. 단순하고 자주 쓰는 케이스는 Flat API, 복잡하고 변형이 잦은 케이스는 Compound API. ... 둘을 함께 제공하는 하이브리드 전략을 택했어요."

> "Flat API를 Compounds로 미리 조립한 케이스라고 생각하면 코드는 하나의 primitive로 관리될 수 있어요."

---

## 5. 우회할 이유를 줄이는 설계 (DS 적용)

이 메타 원칙의 정의·인용·리뷰 프로토콜은 [platform-philosophy.md §7](platform-philosophy.md)에 있다 (단일 출처). 디자인 시스템 문맥에서는 **detach·fork·custom 컴포넌트 양산**으로 나타난다.

해법은 위 §4의 **Flat/Compound 하이브리드** — Flat이 부족해서 fork, Compound가 무거워서 fork 하는 양 끝의 우회 동기를 동시에 흡수하는 API 레이어링이 그 실제 적용.

---

## 6. 마이그레이션 전략 — 3단계

기존 토큰 시스템에서 새 v2로 옮길 때:

1. **내부 프로세스 통합** — 토큰 소스, codegen 파이프라인 일원화
2. **서비스에 토큰 시스템 적용** — v1/v2 동시 호환 레이어 (`@tds/compat` 같은) + codemod CLI
3. **함께 컬러 버전 높이기** — 팀 단위로 이관, breaking change는 codemod가 처리

공개 API 변경엔 반드시:
- 마이그레이션 가이드
- codemod 스크립트 (`npx @tds/migrate v1-to-v2`)
- 릴리스 노트 항목

(스킬 본문 §플랫폼 철학 #6 "Breaking change는 codemod + 릴리스 노트 + 원라이너" 와 동일 원칙)

---

## 관련 리소스

- 원문: [rethinking-design-system](https://toss.tech/article/rethinking-design-system) · [tds-color-system-update](https://toss.tech/article/tds-color-system-update)
- 스킬 §플랫폼 철학 #2, #6, #7
- [recipes.md #14](recipes.md) 시맨틱 z-index 토큰
- [coupling.md #5](coupling.md) 어댑터 패턴
- [library-patterns.md](library-patterns.md) 라이브러리 저자 패턴
