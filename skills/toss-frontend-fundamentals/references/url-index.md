# 원문 URL 인덱스

## ⚠️ 로딩 규율 (선제 fetch 금지)

**이 인덱스는 참조용 북마크이다.**

- 스킬 활성화 시점 또는 리뷰 시작 시점에 여기 URL들을 **선제적으로 WebFetch 하지 않는다.**
- 리뷰·작성 중 **특정 원칙의 원문 근거**가 필요해진 순간에만, **해당 항목 1개**를 fetch.
- 각 항목의 `[축]` 태그와 "언제 열어볼까"는 fetch 동기를 명시하기 위한 것이지 "항상 읽으라"는 뜻이 아니다.
- 대부분의 리뷰는 SKILL.md 본문 + 이미 있는 `references/*.md` 만으로 충분하다.

## 목차

1. 토스 채용·팀 (career)
2. 토스 기술 블로그 (toss.tech) — 프론트엔드 핵심
3. 모닥불 (Fireside Chat) FE 시리즈
4. 컨퍼런스 세션 (TMC 25 / SLASH)
5. 오픈소스 (토스 공개 라이브러리)
6. Frontend Fundamentals 공식 사이트 — 코드 품질
7. Frontend Fundamentals 공식 사이트 — 접근성
8. 주요 커뮤니티 토론 (frontend-fundamentals GitHub Discussions)

각 항목 포맷: `- [축/주제] 제목 — 언제 열어볼까: URL`

---

## 1. 토스 채용·팀 (career)

- [평가기준] 합류 5가지 이유 — 채용 평가축(완성·확장·라이브러리·실용) 원문 인용 필요 시: https://toss.im/career/article/26291
- [플랫폼철학] Frontend Platform 이야기 — SSR/CI·RN/Toolbox 조직 맥락, platform-philosophy.md 근거: https://toss.im/career/article/Frontend
- [플랫폼철학] Web Framework 팀 도전기 — "문제 근원·시스템이 실수 방지" 직접 인용 시: https://toss.im/career/article/web_framework_2511
- [채용프로세스] 합류 여정 — 사전과제·라이브코딩 맥락 확인 시: https://toss.im/career/joining-guide
- [문화] 팀 문화 8원칙 — DRI·Radical Transparency 등 문화 축 근거: https://toss.im/career/culture
- [채용프로세스] FAQ — 인터뷰 포맷·사전과제 관련 질문 확인 시: https://toss.im/career/faq?category=0
- [사례] 토스뱅크 FE DX 개선 — DX 개선 서사 예시 필요 시: https://toss.im/career/article/tossbank-developer-experience
- [문화] FE 챕터 리드 인터뷰 — 리드 역할·성장 사례 필요 시: https://toss.im/career/article/toss-frontend-leadership-and-growth
- [사례] 토스증권 PC Design Platform — DS 플랫폼 구축기 필요 시: https://toss.im/career/article/secu_pc_design_platform
- [사례] FE UX Engineer 인터뷰 — UX 엔지니어 직무 구분 필요 시: https://toss.im/career/article/ux-engineer-interview
- [사례] Frontend UX Engineer (2026.01) — 최신 UX 엔지니어 서술: https://toss.im/career/article/44425
- [채용] NEXT Frontend 직무 — NEXT 프로그램 안내: https://toss.im/career/article/next-developer-2023-frontend
- [문화] NEXT 개발 문화 — 팀 문화 보강 자료: https://toss.im/career/article/next-developer-2023-culture
- [평가기준] NEXT 2022 코딩테스트 기출/풀이 — 코테 유형·모범 풀이 확인 시: https://toss.im/career/article/next-developer-2023-sample-questions
- [평가기준] NEXT 합격 수기 (결과보다 왜) — 지원자 관점 합격 인사이트: https://toss.im/career/article/next-25-frontend

---

## 2. 토스 기술 블로그 (toss.tech) — 프론트엔드 핵심

- [채용/평가] 리포지토리 기반 지원 — 평가 기준 공식 공개: https://toss.tech/article/frontend-apply-without-resume
- [가독성] 선언적인 코드 작성하기 — 선언형 코드 원칙 근거: https://toss.tech/article/frontend-declarative-code
- [가독성/결합도] 자료구조로 복잡한 FE 컴포넌트 — 트리 기반 분해: https://toss.tech/article/frontend-tree-structure
- [예측가능성] ts-pattern은 더 멋진 if문이 아니다 — discriminated union 다룰 때: https://toss.tech/article/ts-pattern-usage
- [예측가능성] Template Literal Types — 문자열 조합 타입 안전성: https://toss.tech/article/template-literal-types
- [예측가능성] TS 타입 호환성 (구조적 서브타이핑) — 고급 타입 호환 이해: https://toss.tech/article/typescript-type-compatibility
- [확장성/테스트] 100년 가는 FE 코드, SDK — 장수 SDK 설계: https://toss.tech/article/42223
- [테스트] 가치있는 테스트 전략 — 테스트 투자 판단: https://toss.tech/article/test-strategy-server
- [결합도/확장성] React Native 2024 — MFE·결정적 빌드 판단 시: https://toss.tech/article/react-native-2024
- [인프라] RN 도입, CocoaPods 없이 — RN 설치 인프라: https://toss.tech/article/react-native-without-cocoapods
- [디자인토큰] 디자인 시스템 다시 생각하기 (Flat/Compound) — API 레이어링, design-tokens.md 직접 근거: https://toss.tech/article/rethinking-design-system
- [디자인토큰] TDS 컬러 시스템 업데이트 — Target/Role/Variant/Level 4축 토큰: https://toss.tech/article/tds-color-system-update
- [응집도] 이런 것도 컴포넌트로? — DS 컴포넌트화 결정 기준: https://toss.tech/article/tds-component-making
- [디자인시스템] DS 가이드 스케일업 — 제품 성장에 따른 DS 가이드: https://toss.tech/article/toss-design-system-guide
- [인프라] 200+ 서비스 모노레포 CI — 모노레포 파이프라인 최적화: https://toss.tech/article/monorepo-pipeline
- [성능] SSR 서버 최적화 — SSR 비용 절감 사례: https://toss.tech/article/ssr-server
- [인프라] 유연한 배포 Pipeline (SLASH 23 DevOps) — 배포 파이프라인 설계: https://toss.tech/article/slash23-devops
- [도구] 패키지 매니저의 과거·미래 — Yarn Berry·pnpm 선택 배경: https://toss.tech/article/lightning-talks-package-manager
- [접근성] A11y Fundamentals — 토스 공식 접근성 문서: https://toss.tech/article/A11y_Fundamentals
- [접근성] 접근성 업무일지 #3 (챗봇 흐름) — 스크린리더 흐름 설계 사례: https://toss.tech/article/38743
- [UX] 인터랙션, 꼭 넣어야 해요? — 마이크로 인터랙션 필요성 판단: https://toss.tech/article/interaction

---

## 3. 모닥불 (Fireside Chat) FE 시리즈

- [가독성] EP.1 가독성 좋은 코드란? — 가독성 기준 심화: https://toss.tech/article/28334
- [예측가능성] EP.2 함수형 프로그래밍 FE — 함수형·객체지향 선택: https://toss.tech/article/firesidechat_frontend_2
- [테스트] EP.3 FE 테스트 자동화 — 테스트 자동화 가치 토론: https://toss.tech/article/firesidechat_frontend_3
- [평가기준] EP.4 OSS 기여와 토스 합격 — OSS 경험이 채용에서 갖는 의미: https://toss.tech/article/firesidechat_frontend_4
- [문화] EP.5 개발만 잘해도 될까 — 커뮤니케이션·DX 감각 평가: https://toss.tech/article/firesidechat_frontend_5
- [평가기준] EP.8 면접관이 진짜 원하는 것 — FE 면접 평가 포인트: https://toss.tech/article/firesidechat_frontend_8
- [성능] EP.9 서비스 최적화 노하우 — 초기 로딩·런타임·체감 응답성: https://toss.tech/article/firesidechat_frontend_9
- [응집도] EP.10 FE 코드/디렉토리 관리 — 도메인 폴더링·응집도: https://toss.tech/article/firesidechat_frontend_10
- [사례] EP.11 디자인 편집기 데우스 — 복잡한 에디터 FE 구현기: https://toss.tech/article/firesidechat_frontend_11
- [리뷰문화] EP.12 코드 리뷰 컬쳐 — 고맥락자 리뷰·코드스멜 WG·리뷰 배틀: https://toss.tech/article/firesidechat_frontend_12

---

## 4. 컨퍼런스 세션 (TMC 25 / SLASH)

- [결합도/운영] TMC 25 장애 대응 자동화 — 알림→대응 자동화·책임 주체 분리: https://toss.im/tmc-25/sessions/engineering/frontend-32
- [사례] SLASH 24 오프라인 결제 혁신 — 배포 속도 vs 안정성 양립: https://toss.im/slash-24/sessions/4
- [도구] SLASH 24 RN 디버깅 — 자체 RN 디버깅 도구: https://toss.im/slash-24/sessions/7
- [도구] SLASH 24 Yarn Plugin 자동 로깅 — Yarn 플러그인 DX 개선: https://toss.im/slash-24/sessions/10
- [결합도] SLASH 24 SharedWorker 멀티탭 WS — 브라우저 자원 공유 패턴: https://toss.im/slash-24/sessions/13

---

## 5. 오픈소스 (토스 공개 라이브러리)

- es-toolkit: https://es-toolkit.dev
- es-hangul: https://es-hangul.slash.page
- suspensive: https://suspensive.org
- @toss/use-funnel: https://use-funnel.slash.page
- granite (RN Framework): https://www.granite.run
- 전체 리포지토리: https://github.com/toss

---

## 6. Frontend Fundamentals 공식 사이트 — 코드 품질

- 개요: https://frontend-fundamentals.com/code-quality/code/
- 좋은 토론: https://frontend-fundamentals.com/code-quality/code/community/good-discussions.html
- 인기 토론 전체: https://github.com/toss/frontend-fundamentals/discussions?discussions_q=is:open+sort:top

**가독성 예제** — [submit-button](https://frontend-fundamentals.com/code-quality/code/examples/submit-button.html) · [login-start-page](https://frontend-fundamentals.com/code-quality/code/examples/login-start-page.html) · [condition-name](https://frontend-fundamentals.com/code-quality/code/examples/condition-name.html) · [magic-number-readability](https://frontend-fundamentals.com/code-quality/code/examples/magic-number-readability.html) · [ternary-operator](https://frontend-fundamentals.com/code-quality/code/examples/ternary-operator.html) · [use-page-state-readability](https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-readability.html) · [user-policy](https://frontend-fundamentals.com/code-quality/code/examples/user-policy.html) · [comparison-order](https://frontend-fundamentals.com/code-quality/code/examples/comparison-order.html)

**예측 가능성 예제** — [http](https://frontend-fundamentals.com/code-quality/code/examples/http.html) · [use-user](https://frontend-fundamentals.com/code-quality/code/examples/use-user.html) · [hidden-logic](https://frontend-fundamentals.com/code-quality/code/examples/hidden-logic.html)

**응집도 예제** — [code-directory](https://frontend-fundamentals.com/code-quality/code/examples/code-directory.html) · [magic-number-cohesion](https://frontend-fundamentals.com/code-quality/code/examples/magic-number-cohesion.html) · [form-fields](https://frontend-fundamentals.com/code-quality/code/examples/form-fields.html)

**결합도 예제** — [use-page-state-coupling](https://frontend-fundamentals.com/code-quality/code/examples/use-page-state-coupling.html) · [use-bottom-sheet](https://frontend-fundamentals.com/code-quality/code/examples/use-bottom-sheet.html) · [item-edit-modal](https://frontend-fundamentals.com/code-quality/code/examples/item-edit-modal.html)

---

## 7. Frontend Fundamentals 공식 사이트 — 접근성

- 개요: https://frontend-fundamentals.com/a11y/overview.html
- 왜: https://frontend-fundamentals.com/a11y/why.html
- 원칙: https://frontend-fundamentals.com/a11y/principles.html
- 기초(Role/Label/State): https://frontend-fundamentals.com/a11y/basic-guide/overview.html
- UI 컴포넌트: [tab](https://frontend-fundamentals.com/a11y/ui-foundation/tab.html) · [accordion](https://frontend-fundamentals.com/a11y/ui-foundation/accordion.html) · [modal](https://frontend-fundamentals.com/a11y/ui-foundation/modal.html) · [radio](https://frontend-fundamentals.com/a11y/ui-foundation/radio.html) · [checkbox](https://frontend-fundamentals.com/a11y/ui-foundation/checkbox.html) · [switch](https://frontend-fundamentals.com/a11y/ui-foundation/switch.html)
- 실전 가이드:
  - 구조: [button-inside-button](https://frontend-fundamentals.com/a11y/structure/button-inside-button.html) · [table-row-link](https://frontend-fundamentals.com/a11y/structure/table-row-link.html)
  - 의미: [required-label](https://frontend-fundamentals.com/a11y/semantic/required-label.html) · [duplicate-interactive-element](https://frontend-fundamentals.com/a11y/semantic/duplicate-interactive-element.html)
  - 동작: [fake-button](https://frontend-fundamentals.com/a11y/predictability/fake-button.html) · [form](https://frontend-fundamentals.com/a11y/predictability/form.html)
  - 시각 보완: [image-alt](https://frontend-fundamentals.com/a11y/alt-text/image-alt.html)
- ESLint: [rules](https://frontend-fundamentals.com/a11y/eslint/rules.html) · [design-system](https://frontend-fundamentals.com/a11y/eslint/design-system.html)
- 체험 playground: https://frontend-fundamentals.com/a11y/playground.html

---

## 8. 주요 커뮤니티 토론 (frontend-fundamentals GitHub Discussions)

전체 정리: [discussions.md](discussions.md) 참조

- [#4 조건부 렌더링](https://github.com/toss/frontend-fundamentals/discussions/4)
- [#5 전역 상태 기준](https://github.com/toss/frontend-fundamentals/discussions/5)
- [#6 enum vs as const](https://github.com/toss/frontend-fundamentals/discussions/6)
- [#7 queryKey 관리](https://github.com/toss/frontend-fundamentals/discussions/7)
- [#21 불리언 암묵 변환](https://github.com/toss/frontend-fundamentals/discussions/21)
- [#35 Hook vs Component](https://github.com/toss/frontend-fundamentals/discussions/35)
- [#41 if return 포맷](https://github.com/toss/frontend-fundamentals/discussions/41)
- [#42 다이얼로그 관리](https://github.com/toss/frontend-fundamentals/discussions/42)
- [#45 Indexed Access](https://github.com/toss/frontend-fundamentals/discussions/45)
- [#66 RSC data fetching](https://github.com/toss/frontend-fundamentals/discussions/66)
- [#67 Form 3-type](https://github.com/toss/frontend-fundamentals/discussions/67)
- [#85 Zod 스키마 compose](https://github.com/toss/frontend-fundamentals/discussions/85)
- [#88 Boolean 네이밍](https://github.com/toss/frontend-fundamentals/discussions/88)
- [#96 export 스타일](https://github.com/toss/frontend-fundamentals/discussions/96)
- [#114 배열 타입](https://github.com/toss/frontend-fundamentals/discussions/114)
- [#128 인라인 함수](https://github.com/toss/frontend-fundamentals/discussions/128)
- [#150 서버 enum](https://github.com/toss/frontend-fundamentals/discussions/150)
- [#162 z-index](https://github.com/toss/frontend-fundamentals/discussions/162)
- [#175 데이터 주입](https://github.com/toss/frontend-fundamentals/discussions/175)
- [#177 value/onChange](https://github.com/toss/frontend-fundamentals/discussions/177)
- [#189 != null](https://github.com/toss/frontend-fundamentals/discussions/189)
- [#196 도메인 디렉토리](https://github.com/toss/frontend-fundamentals/discussions/196)
- [#199 discriminatedUnion](https://github.com/toss/frontend-fundamentals/discussions/199)
- [#202 queryOptions](https://github.com/toss/frontend-fundamentals/discussions/202)
- [#221 상수 위치](https://github.com/toss/frontend-fundamentals/discussions/221)
- [#488 fetcher 네이밍](https://github.com/toss/frontend-fundamentals/discussions/488)
- [#689 useEffect 최소화](https://github.com/toss/frontend-fundamentals/discussions/689)
- [#755 MV-VI](https://github.com/toss/frontend-fundamentals/discussions/755)
- [#832 function vs arrow](https://github.com/toss/frontend-fundamentals/discussions/832)

---

## 제거된 항목 (참고)

다음 항목들은 **본문 미검증** 또는 **스킬 목적(코드 리뷰·작성)에서 거리가 멀다**는 이유로 인덱스에서 제외:

- ~~쓰기 쉬운 Toss Front SDK~~ (`toss-front-sdk`) — 제목만 있고 본문 검증 안 됨. 토스 FE팀이 만든 SDK 홍보성 글로 추정되나 "코드 품질 4축"에 어떻게 적용되는지 명시된 바 없음.
- ~~하마터면 못생겨질 뻔 (토스 프론트 2 제작기)~~ (`toss_front`) — 제품 제작기, 일반 리뷰에 쓸 원칙 없음.
- ~~es-toolkit 10M 다운로드~~ — OSS 섹션에 이미 있음. 기술 블로그 엔트리는 다운로드 수 마케팅 서사라 리뷰 근거로 약함.
- ~~Software 3.0 시대~~ (`software-3-0-era`) — AI 시대 개발 전망, 4축 리뷰와 직접 연결 약함.
- ~~Harness로 조직 생산성 저점 올리기~~ (`harness-for-team-productivity`) — 조직 생산성 도구 소개, FE 리뷰 원칙으로 사용하기 어려움.
- ~~토스뱅크 FE 일주일~~, ~~토스인슈어런스 FE 하루~~ — 일상 르포, 리뷰에 쓸 원칙 없음.
- ~~토스증권 FE 챕터를 엿보다~~ (`secu_frontend-chapter`) — 챕터 소개, `toss-frontend-chapter`와 중복성.

**복구가 필요한 경우**: 본문을 열어 "어느 축에 어느 원칙으로 매핑되는지"를 확인한 뒤 섹션 2에 `[축] 제목 — 언제 열어볼까` 포맷으로 추가.
