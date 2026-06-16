# 상황별 작성 레시피 — 인덱스

"**작성 모드**"에서 자주 마주치는 상황을 **순서대로** 따라가는 체크리스트. 리뷰가 아니라 **처음부터 잘 쓰기** 위한 템플릿이다. 각 레시피는 4대 코드 품질 원칙 + 접근성을 **동시에** 고려한다.

> ⚠️ **로드 규율** — 레시피 20종은 관심사별 **3개 파일로 분리**돼 있다. 필요한 묶음만 로드하라(706L 통째 로드 금지). 아래 표에서 상황에 맞는 파일 하나만 연다.

| 파일 | 레시피 | 언제 |
|---|---|---|
| **[recipes-1-components.md](recipes-1-components.md)** | 1 Modal · 2 Toggle/Switch · 3 Form · 4 아이콘 버튼 · 5 서버 데이터 훅 · 6 props drilling · 7 복잡한 조건 분기 · 8 새 기능 디렉토리 | 컴포넌트·구조를 새로 만들 때 |
| **[recipes-2-data-forms.md](recipes-2-data-forms.md)** | 9 useEffect 최소화 · 10 React Query 키·옵션 · 11 Zod 폼 compose · 12 응답/폼/페이로드 3-type 어댑터 · 13 선언적 다이얼로그(overlay-kit) · 14 z-index 시맨틱 토큰 · 15 서버 enum 타이핑 | 데이터·폼·타입을 다룰 때 |
| **[recipes-3-advanced.md](recipes-3-advanced.md)** | 16 RSC data fetching colocation · 17 컴포넌트 API 확장(Fn+.with+.Consumer) · 18 ErrorBoundary/FallbackBoundary · 19 다단계 스키마 빌더 · 20 RSC + React Query hydration | RSC·라이브러리 저자·고급 패턴일 때 |

각 레시피는 원래 번호(`#N`)를 헤딩 앵커로 유지한다 — `recipes-2-data-forms.md #11` 처럼 직접 가리킬 수 있다.
