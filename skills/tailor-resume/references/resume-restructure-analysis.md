# 경력기술서 재구성 분석

**일자**: 2026-03-25
**근거**: 피드백 PDF + 석건 경력기술서 참고 + GitHub 기여 데이터 검증

---

## 구조: 회사 단위 → 이슈/스킬 단위

석건 패턴을 채택하되, 회사 정보를 메타로 남김.
각 이슈 제목이 **"무엇을 해서 어떤 결과"** 형태가 되도록.

---

## 이슈 목록 (gh 검증 완료)

### 1. webpack 내부 수정으로 React Fast Refresh 구현

**소속**: 오픈소스 (laravel-mix) · 2020–2021
**동기**: 출근노트 프로젝트에서 코드 변경마다 전체 페이지가 새로고침 → 폼 상태 초기화로 개발 생산성 저하

**한 것 (gh 검증):**
- `laravel-mix/laravel-mix`에 **12개 PR merged** (5.2k stars)
  - [#2661](https://github.com/laravel-mix/laravel-mix/pull/2661) React Fast Refresh 기능 추가 (+48/-3) — `react-refresh-webpack-plugin`을 webpack 설정에 직접 통합
  - [#2660](https://github.com/laravel-mix/laravel-mix/pull/2660) webpack-dev-server 4.0 마이그레이션 (+7/-7)
  - [#2783](https://github.com/laravel-mix/laravel-mix/pull/2783) HMR HTTPS 옵션 복구 (+10/-4) — `--https` 옵션이 사라진 버그 수정
  - [#2797](https://github.com/laravel-mix/laravel-mix/pull/2797) BabelConfig 최상위 레벨 최적화 (+305/-121, 12파일) — 사용자가 babel config를 직접 지정할 수 있도록 옵션 추가 + merge 순서 수정
  - [#2809](https://github.com/laravel-mix/laravel-mix/pull/2809) React Fast Refresh overlay 버그 수정 (+25/-15)
- `react-refresh-webpack-plugin`에 **3개 PR merged** (3.2k stars)
  - type-fest 호환성, wds 버전 업데이트

**결과**: 코드 변경 시 폼 상태가 유지된 채 컴포넌트만 교체. laravel-mix 전체 사용자에게 React Fast Refresh 제공.

**어필 포인트**: 단순 "사용"이 아니라 webpack 내부 설정을 직접 분석하고 수정한 것. BabelConfig PR은 12파일 305줄 추가로 아키텍처 수준 변경.

---

### 2. React 디자인 시스템 구축 — 53개 공통 컴포넌트

**소속**: 씨엠유니버스 · 출근노트 · 2020–2025

**의사 결정**:
- 초기 jQuery 기반 → React 도입 직접 건의
- 상태관리 3계층 선택:
  - React Query (서버 상태) vs SWR → React Query 선택 (mutation + cache invalidation 우위)
  - 전역 상태: Redux vs Zustand → Zustand 선택 (보일러플레이트 최소)
  - 로컬 상태: useState vs Jotai → Jotai 선택 (atom 기반 세밀한 리렌더링 제어)
- Chakra UI 선택 이유: WAI-ARIA 접근성 내장, 커스텀 토큰 시스템

**한 것**: 865 커밋, 526+ PRs. Chakra UI 기반 53개 공통 컴포넌트 추출·표준화. 346개 파일에서 재사용.

**결과**: 신규 페이지 개발 시간 50% 단축. 이 아키텍처 위에 노무법인 시스템 6개 모듈 신규 개발.

---

### 3. 대량 데이터 렌더링 최적화 — UI 프리징 완전 해소

**소속**: 씨엠유니버스 · 출근노트 · 2020–2025

**한 것**:
- react-window 가상화 → 화면에 보이는 행만 렌더링
- React.memo + useMemo → 행 단위 메모이제이션
- React Query staleTime/cacheTime 조정 → 중복 API 호출 제거

**결과**: 수천 명 급여 정산 화면에서 UI 프리징 완전 해소. 관련 CS 문의 해소.

---

### 4. B2B2C 5단계 권한 체계 설계

**소속**: 씨엠유니버스 · 출근노트 · 2020–2025

**한 것**: PermissionGate 컴포넌트 + usePermission 훅 → 선언적 권한 기반 렌더링. 라우트 레벨 권한 가드 미들웨어.

**결과**: 권한 로직 중앙 집중화. 노무법인 6개 모듈을 기존 프로젝트에 안정적 추가.

---

### 5. OpenCASCADE WASM 브라우저 이식 — 설치 과정 제거

**소속**: 에브리심 · 에브리드론 · 2025–2026

**의사 결정**:
- Emscripten 3→4→5 단계적 업그레이드 (한번에 올리면 깨지는 부분 많아 점진적 접근)
- SSR 호환: dynamic import + Suspense (Next.js hydration 경고 제거)

**한 것**:
- C++ 3D CAD 엔진을 WASM 컴파일 → 브라우저 실행
- 64비트 메모리 지원 활성화
- d.ts 자동 생성 파이프라인 → 프론트엔드-WASM 간 타입 안전 인터페이스

**결과**: 데스크탑 설치 없이 브라우저에서 3D CAD 모델링 가능. 사용자 진입 장벽 완전 제거.

---

### 6. AI 챗봇으로 시뮬레이션 워크플로우 단순화

**소속**: 에브리심 · 에브리드론 · 2025–2026

**한 것**:
- AI SDK v5 기반 챗봇 프론트엔드 — 스트리밍 응답, 도구 실행 상태, 대화 히스토리
- 클라이언트 사이드 도구 실행 구조 — 챗봇에서 메시 실행·시뮬레이션 직접 제어
- YAML 기반 프롬프트 관리 + 의도 분류 UI

**결과**: 비전문가도 자연어로 5단계 시뮬레이션 파이프라인 조작. 진입 장벽 대폭 감소.

---

### 7. 실시간 WebSocket 대량 데이터 처리 — 포스코 MES

**소속**: 씨엠유니버스 · GSS · 2019–2023

**한 것**:
- 전처리 필터링 + 메모이제이션 + 배치 렌더링
- 메모리 파이프라인 전환 (디스크 누적 문제 해결)
- 코일 등급 판정 규칙 엔진 (설정 파일 기반, 코드 수정 없이 대응)

**결과**: 데이터 유입 속도에 밀리지 않는 실시간 처리. 설정 파일만으로 신규 공정 대응.

---

### 8. AI/LLM 도구 생태계 기여 — CLIProxyAPI 메인테이너

**소속**: 오픈소스 · 2024–현재
**프로젝트**: [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (18.8k stars) — Gemini↔Claude API 호환 프록시

**한 것 (gh 검증):**
- **5개 PR merged**, 30+ 포크 파생
- [#611](https://github.com/router-for-me/CLIProxyAPI/pull/611) Claude 모델 호환성 대폭 개선 (+2,162/-80) — thinking 모델 시그니처 캐싱(멀티턴 대화 지원), 도구 호출 처리 안정화
- [#575](https://github.com/router-for-me/CLIProxyAPI/pull/575) Gemini↔Claude JSON 스키마 호환성 (+927/-24) — Gemini API가 거부하는 x-* 확장 필드를 자동 정리하는 유틸리티 함수 구현
- [#1311](https://github.com/router-for-me/CLIProxyAPI/pull/1311) 비호환 확장 필드 제거 (+172/-0)
- [#605](https://github.com/router-for-me/CLIProxyAPI/pull/605) Amp 클라이언트 호환성 (+25/-0) — thinking+tool_use 동시 렌더링 이슈 해결
- [#1522](https://github.com/router-for-me/CLIProxyAPI/pull/1522) 프록시 에러 핸들링 개선 (+30/-0) — 폴링 중 클라이언트 취소 시 불필요한 에러 로그 제거

**결과**: Claude/Gemini/Codex 간 프록시 안정성 확보. 30+ 포크가 파생될 정도로 생태계 기여.

---

### 9. Goose AI 에이전트 — 로컬 추론 의존성 분리

**소속**: 오픈소스 · 2026
**프로젝트**: [block/goose](https://github.com/block/goose) (33.5k stars) — Block(Square) 사의 AI 코딩 에이전트

**한 것 (gh 검증):**
- [#7976](https://github.com/block/goose/pull/7976) merged (+372/-100) — `local-inference` Cargo feature flag 도입
  - candle, llama-cpp-2, symphonia, rubato, tokenizers 등 로컬 추론 의존성을 선택적으로 제외 가능하게 변경
  - 클라우드 프로바이더만 필요한 다운스트림에서 ~200MB+ 컴파일 비용 절감
- [#8080](https://github.com/block/goose/pull/8080) open (+32/-11) — AWS 프로바이더도 동일 패턴으로 feature-gate

**결과**: goose를 라이브러리로 사용하는 프로젝트에서 불필요한 200MB+ 빌드 시간/용량 절감.

---

### 10. 프론트엔드 핵심 인프라 기여 (기타)

**Astro** (57.7k stars):
- [#7729](https://github.com/withastro/astro/pull/7729) Vercel 어댑터에 정적 에셋 캐시 헤더 추가 (+144/-3) — Vercel의 기본 캐시 설정을 따르도록 route config에 Cache-Control 헤더 추가. CDN 캐싱 성능 개선.

**Tremor** (16.5k stars):
- [#410](https://github.com/tremorlabs/tremor-npm/pull/410) 차트에 null 값 구간 연결 옵션 추가 (+88/-3) — AreaChart, LineChart에 `connectNulls` prop 추가. 중간 데이터가 없을 때 그래프가 끊기지 않고 자연스럽게 연결.

**QuickRecorder** (8.1k stars):
- [#102](https://github.com/lihaoyun6/QuickRecorder/pull/102) 윈도우 조회 로직을 ScreenCaptureKit API로 리팩토링 (+3/-13) — deprecated CGWindow API를 최신 macOS ScreenCaptureKit으로 전환.

**vite-plugin-checker** (1.2k stars):
- [#188](https://github.com/fi3ework/vite-plugin-checker/pull/188) 소켓 URL 해석 로직 수정 (+23/-23) — Laravel Vite 플러그인 환경에서 WebSocket URL이 잘못 파싱되는 버그 수정.

**twin.macro** (8.0k stars):
- [#200](https://github.com/ben-rogerson/twin.macro/pull/200) transform-gpu, transform-none 유틸리티 추가 (+41/-7) — Tailwind의 하드웨어 가속 transform 기능을 twin.macro에서도 사용 가능하게.

**laravel/framework** (34.6k stars):
- [#35480](https://github.com/laravel/framework/pull/35480) PHPUnit 9 deprecated API 리팩토링 (+2/-2)
- [#35474](https://github.com/laravel/framework/pull/35474) deprecated `at()` 호출 제거 (+6/-7)

**Zed Editor** (진행 중, 미포함):
- 2개 open PR: git panel 디렉토리 컨텍스트 메뉴 (+987/-13), commit message 모델 picker (+365/-31)

---

## 적용 계획

### master.yaml 변경
1. 기존 details를 이슈 단위로 재구성 (회사별 묶음 해제)
2. 각 이슈에 "의사 결정 사항" 추가 (해당되는 경우)
3. Bold 제거 (개선 사항) / Bold 추가 (적용 결과 성과만)
4. 문체 "~함/~됨" 통일
5. 오픈소스 섹션: PR별 구체적 내용·동기·결과 서술

### CareerLayout.svelte 변경
1. 제목 위계 강화
2. 간격/행간 축소
3. 본문 색상 검은색 통일
4. 구분선 진하게
