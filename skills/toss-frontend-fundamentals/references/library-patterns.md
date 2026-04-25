# 라이브러리 저자 패턴

애플리케이션이 아닌 **npm 라이브러리/유틸 패키지**를 만들 때의 패턴. 토스의 오픈소스 레포(es-toolkit, es-hangul, suspensive, use-funnel)에서 공통적으로 확인된 운영 기준.

이 파일은 **라이브러리 개발 상황**에서만 로드한다 (앱 개발 리뷰에는 불필요).

## 목차

1. [패키지 기본 — subpath exports + `sideEffects:false` + `browser` condition](#1-패키징-기본-3종)
2. [환경 분기 중앙화 — core 로직과 분리](#2-환경-분기-중앙화)
3. [타입 테스트 공존 — `*.test-d.ts`](#3-타입-테스트-공존)
4. [공급망 보안 — OIDC provenance + Action SHA pinning](#4-공급망-보안)
5. [CI 품질 게이트 — attw · publint · sherif · knip · compressed-size](#5-ci-품질-게이트)
6. [릴리스 — Changesets](#6-릴리스--changesets)
7. [점진 마이그레이션 — `/compat` 서브패스](#7-점진-마이그레이션-compat)
8. [SDK 특수성 — 호출 환경 통제 불가 전제](#8-sdk-특수성)

---

## 1. 패키징 기본 3종

### (a) subpath exports

카테고리별로 엔트리를 나눠 **사용자가 필요한 부분만 import** 하게.

```jsonc
// package.json
{
  "name": "es-toolkit",
  "exports": {
    ".": { "import": "./dist/index.mjs", "require": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./array": { "import": "./dist/array.mjs", "require": "./dist/array.js", "types": "./dist/array.d.ts" },
    "./string": { "import": "./dist/string.mjs", "require": "./dist/string.js", "types": "./dist/string.d.ts" }
  }
}
```

**효과**
- `import { chunk } from 'es-toolkit/array'` — 필요한 카테고리만 로드
- 타입과 런타임 모듈이 dual 제공되어 CJS/ESM 모두 정확
- 구 번들러 호환을 위해 `array.js`, `array.d.ts` 같은 **루트 shortcut 파일**을 `files` 에 포함

### (b) `sideEffects: false`

```jsonc
{ "sideEffects": false }
```

번들러에게 "이 패키지의 사용되지 않는 import 는 안전하게 제거 가능" 을 선언. 트리셰이킹의 전제 조건.

**주의** — CSS import 같은 실제 side effect 가 있으면 `sideEffects: ["*.css"]` 로 화이트리스트.

### (c) `browser` export condition

Node-only 코드(`typeof Buffer !== 'undefined'`)가 번들러에게 **Buffer 전체 폴리필을 끌어들이는 문제** 회피.

```jsonc
{
  "exports": {
    ".": {
      "browser": "./dist/browser/index.mjs",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    }
  }
}
```

Rollup `alias` 플러그인으로 브라우저 빌드 시 Node 체크를 `() => false` 스텁으로 교체:
```ts
// rollup.config.mjs (browser build)
alias({ entries: [{ find: './isBuffer', replacement: './isBuffer.browser' }] });
```

**실적** — toss/es-toolkit #1671 — Next.js 앱 gzip 기준 -6.5KB (4.5% 감소).

---

## 2. 환경 분기 중앙화

`typeof window`, `typeof Buffer` 같은 환경 체크를 **단일 파일로 집약**. 상세는 [cohesion.md #9](cohesion.md#9-환경-분기-중앙화).

```
src/_internal/environment.ts  ← 단일 출처
src/_internal/globalThis.ts    ← getGlobalThis()
```

**이점**
- 번들러 alias 한 지점에서 Browser/Node 분리
- 새 플랫폼(Deno/Bun/Edge) 지원이 한 파일 수정

---

## 3. 타입 테스트 공존

런타임 API 는 바뀌지 않았어도 **타입 시그니처 회귀**가 사용자 코드를 깨뜨릴 수 있다. 상세는 [a11y-basics.md #테스트](a11y-basics.md#테스트로-접근성-강제하기) 의 "타입 테스트와 런타임 테스트 공존" 섹션.

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    typecheck: { enabled: true, include: ['**/*.test-d.{ts,tsx}'] },
  },
});
```

**검증 대상 (라이브러리 관점)**
- 제네릭 추론 (`function map<T, U>(arr: T[], fn: (x: T) => U): U[]`)
- 조건부/재귀 타입 (`CompareMergeContext`, `InferError`)
- 템플릿 리터럴 타입 (`josa('X', '을/를')` 반환)
- discriminated union narrowing

---

## 4. 공급망 보안

### OIDC provenance

```yaml
# .github/workflows/release.yml
permissions:
  id-token: write
  contents: write

jobs:
  release:
    steps:
      - run: pnpm publish -r
        env:
          NPM_CONFIG_PROVENANCE: 'true'
```

**효과** — npm 패키지가 **GitHub Actions 실행에 서명**됨. 사용자가 `npm show <pkg> --json` 으로 출처 검증 가능. 토큰 탈취로 가짜 버전 발행을 어렵게 만든다.

### GitHub Action SHA pinning

```yaml
# ❌ 태그는 변조 가능
- uses: actions/checkout@v4

# ✅ commit SHA 핀
- uses: actions/checkout@f43a0e5ff2bd294095638e18286ca9a3d1956744  # v4.1.1
```

**근거** — 타사 액션이 악성 커밋을 tag 에 재배치하면 전파됨. SHA 는 불변.

### Fork PR 실행 방지

```yaml
jobs:
  release:
    if: github.repository == 'toss/es-hangul'  # fork 에선 안 돌게
```

릴리스 워크플로가 fork PR 에서 실행되어 시크릿이 노출되는 사고 방지 (toss/es-hangul #370).

---

## 5. CI 품질 게이트

라이브러리 릴리스 직전 **6-7개 게이트**가 병렬로 돈다. 실패하면 PR merge 불가.

| 게이트 | 도구 | 역할 |
|---|---|---|
| Lint | `eslint --cache` | 변경 파일만 (속도) |
| Typecheck | `tsc --noEmit` | 전체 |
| Test | `vitest --coverage` | 런타임 + 타입 |
| **`attw`** | `@arethetypeswrong/cli --pack` | CJS/ESM 타입 export 정확성 (subpath 포함) |
| **`publint`** | `publint --strict` | `package.json` exports 필드 유효성, `files` 누락 |
| **`check-peer`** | 스크립트 | peer dependency 범위와 실제 호환성 |
| **`sherif`** | 모노레포 의존성 일관성 | 같은 라이브러리가 패키지별 버전 다른지 |
| **`knip`** | 데드코드 검사 | 사용 안 되는 export, 파일 |
| **compressed-size** | `preactjs/compressed-size-action` | PR 마다 `dist/*` gzip 사이즈 diff 코멘트 |

**설치 예 (`package.json`)**
```jsonc
{
  "scripts": {
    "ci:attw": "attw --pack",
    "ci:publint": "publint --strict",
    "ci:sherif": "sherif",
    "ci:knip": "knip"
  },
  "devDependencies": {
    "@arethetypeswrong/cli": "^0.17.0",
    "publint": "^0.3.0",
    "sherif": "^1.0.0",
    "knip": "^5.0.0"
  }
}
```

---

## 6. 릴리스 — Changesets

**워크플로**
1. PR 에 `.changeset/<hash>.md` 생성 (수동 또는 `pnpm changeset`)
   ```md
   ---
   "es-toolkit": minor
   ---
   feat: add isEmptyObject predicate
   ```
2. main merge 시 GitHub Action 이 **"Version packages" PR** 을 자동 생성 (버전 bump + CHANGELOG 갱신)
3. 해당 PR merge → `pnpm publish -r` 자동 실행

**고급 설정** (`.changeset/config.json`)
```json
{
  "changelog": "@changesets/changelog-github",
  "fixed": [["@suspensive/react", "@suspensive/react-query-5"]],
  "linked": [],
  "access": "public"
}
```
- `fixed` — 패키지 버전을 **강제로 같이** 올림 (toss/suspensive 가 6개 패키지에 적용)
- `linked` — 같이 올리되 개별 semver 허용

**장점**
- 릴리스 노트가 PR 단위로 누적 → 의미 있는 CHANGELOG
- "언제 어떤 버전을 언제 낼지" 가 명시적 — 자동 publish 의 투명성

---

## 7. 점진 마이그레이션 `/compat`

신규 라이브러리가 기존 경쟁 라이브러리(lodash, 구 API) 를 대체할 때 **드롭인 치환 레이어**를 제공해 이주 비용을 낮춘다. 상세 패턴은 [coupling.md #6](coupling.md#6-점진-마이그레이션-compat-어댑터).

**예** — `es-toolkit`
- `es-toolkit` — 엄격한 신규 API (`chunk(arr, size)`, size < 1 시 throw)
- `es-toolkit/compat` — lodash 호환 시그니처 (size < 1 시 `[]` 반환)

**원칙**
- `/compat` 는 **새 기능 추가 금지**, lodash 와 다른 동작만 패치
- 기여 가이드에 "새 유틸리티는 `/compat` 대신 메인에" 명시
- 마이그레이션 완료 후 major 버전에서 `/compat` 제거 검토

**사용자 시각**
```ts
// 초기 — 드롭인 치환
import { chunk } from 'es-toolkit/compat';  // lodash 호환

// 점진 전환
import { chunk } from 'es-toolkit';  // 엄격, 엣지 케이스 throw
```

---

## 8. SDK 특수성

일반 라이브러리(es-toolkit, suspensive)와 **SDK(payments-legacy-3 출처)** 는 다음에서 갈라진다 — SDK 작업 시 추가로 챙겨라.

### 전제 — 호출 환경을 통제할 수 없다

> "SDK 개발은 일반 프론트엔드 개발과 많이 달랐습니다. 가맹점 코드 속에 깊숙이 박혀, 가맹점 코드와 동일한 수명을 가졌고."

- **로그 한 줄 추가가 장애가 될 수 있다.** 가맹점이 짧은 간격에 같은 메서드를 여러 번 호출하면 새로 추가한 네트워크 의존성이 페이지를 다운시킨다 → "사이드 이펙트 없는 추가" 가정 금지.
- **타입 검증을 런타임에 한다.** 사용자가 `customerKey`에 number 를 넣어도 `startsWith` 가 터지지 않게 — TS interface → Zod schema 자동 변환으로 경계에서 validate.
- **로그·메서드 추가는 PR 단위로 영향 분석.** 같은 메서드의 호출 패턴(빈도/병렬성) 을 모르면 일단 보류.

### 추적 가능성 — Global Trace ID

평범한 로깅으로는 "결제 요청은 했는데 성공 못 함" 같은 케이스를 추출 못 한다.

- **단일 Trace ID로 시스템 입구-출구 매핑** — 첫 요청 로그와 마지막 결제완료 로그를 ID 로 join.
- 모니터링 CLI 가 "성공 카운트 41 → 0" 같은 신호를 배포 직후 즉시 노출.
- 일반 라이브러리에서도 디버깅 사이클 짧게 만들고 싶으면 동일 패턴 적용 가능 (단, SDK 는 거의 필수).

### "계약" 으로서의 인터페이스

- TypeScript interface + JSDoc 을 **단일 진실의 출처**로 두고:
  - 컴파일러로 MDX 문서 자동 생성 (CI 에서 갱신)
  - 동일 interface 를 Zod schema 로 변환해 런타임 validate
- "계약 변경 = 문서·검증 동시 변경" 보장.

### 3계층 + 의존성 역전

> "변경의 원인이 되는 곳을 따라서 경계를 그어라."

- **Public Interface Layer** — 가맹점과의 약속 (검증 + 도메인 변환)
- **Domain Layer** — 비즈니스 로직 (외부 의존성은 인터페이스로만 요청)
- **External Service Layer** — 서버/Web API

경계마다 인터페이스 기반 DI. 가맹점 특수 케이스는 도메인 블록만 교체 (`StandardWidgetRequestPaymentUsecase` → `JinyoungMallWidgetRequestPaymentUsecase`) 로 흡수.

### 출처

[toss.tech/article/payments-legacy-3](https://toss.tech/article/payments-legacy-3) — 토스페이먼츠 V2 SDK 설계.

---

## 언제 이 파일을 로드하나

- "내 프론트엔드 앱 만들고 있어" → **로드 불요**
- "npm 에 publish 할 라이브러리 세팅 중" → 로드
- "모노레포 CI 에 attw/publint/sherif 넣고 싶다" → 로드
- "트리셰이킹 되는 유틸 패키지 만들고 싶다" → 로드
- "라이브러리 설계 시 core/adapter 분리" → [coupling.md #5](coupling.md#5-어댑터-패턴) 만으로 충분
