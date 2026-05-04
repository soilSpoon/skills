# Case Study — Tailwind v3→v4 마이그레이션 잔재 + monorepo shadcn deps 재배치

dronerush 모노레포 (`apps/everysim` Next.js 16 + Turbopack + Tailwind v4) 에서 머지 commit 직후 `next dev` 가 처음 띄울 때 발견한 사례. 두 잠재 부채가 동시에 표면화되어 단일 증상 (`Can't resolve 'shadcn/tailwind.css'`) 으로 위장한 케이스.

## 증상

- `npm run lint` 통과 (eslint, tsconfig paths OK)
- `npm test` 통과 (vitest 379/379)
- `next build` 통과 (webpack 기반 production)
- **`next dev`** (turbopack) 만 실패:
  ```
  CssSyntaxError: tailwindcss: globals.css:1:1:
    Can't resolve 'shadcn/tailwind.css' in '.../apps/everysim/src/app'
  ```

## DETECT: layer 식별

| Layer | 결과 | 이유 |
|---|---|---|
| `tsc` (lint) | ✅ | CSS import 안 봄 |
| `vitest` (test) | ✅ | PostCSS pipeline 안 돔 |
| `next build` (prod=webpack) | ✅ (의심됨) | webpack 의 css resolver 는 다를 수 있음 |
| `next dev` (turbopack) | ❌ | turbopack 의 CSS resolver 가 패키지 `exports.style` condition 을 honor 안 함 |

→ 같은 코드인데 dev 만 깨지는 layer 차이.

## AUDIT: 두 잠재 부채

### Drift 1 — Tailwind v3→v4 자동 마이그레이션 잔재

```
apps/everysim/postcss.config.cjs  (v3 style: tailwindcss + autoprefixer, 가리키는 tailwind.config.ts 는 사라짐)
apps/everysim/postcss.config.mjs  (v4 style: @tailwindcss/postcss)
```

`a65832255 feat: Tailwind CSS v3.4 → v4.2 업그레이드` commit 메시지:
> `@tailwindcss/upgrade` 자동 마이그레이션 / tailwind.config.ts 삭제 → CSS @theme 블록으로 전환 / postcss.config.mjs 신규

자동 도구는 `.mjs` 만 *추가* 하고 기존 `.cjs` 는 손대지 않음. postcss-load-config 가 `.cjs` 우선 → v3 plugin 모드로 진입 시도 → `tailwind.config.ts` 사라진 상태라 `@tailwindcss/postcss` 가 활성화 *안 됨* → Tailwind v4 의 자체 cssResolver (`enhanced-resolve` + `conditionNames: ['style']`) 가 동작 안 함.

### Drift 2 — monorepo deps 위치 부정합 + workspace hoisting 환상

`bb4f96efa fix: add shadcn/tailwind.css import` 의 변경:
- `libs/workbench/package.json` 에 `"shadcn": "^4.2.0"` devDep 등록
- `apps/everysim/src/app/globals.css` 에 `@import 'shadcn/tailwind.css';`
- `libs/workbench/src/styles/workbench-tokens.css` 에도 같은 import

→ shadcn 의 진짜 *primary* 사용처는 `apps/everysim/globals.css` 인데 deps 는 `libs/workbench` 에만 등록. npm workspace hoisting 이 root `node_modules/shadcn` 에 올려서 turbopack 이 *우연히* 풀어줌.

이후 `c41df4e76 refactor(workbench): TS SDK v2 — public API 재정립 + UI/도메인 자산 외부화` 가 `libs/workbench` styles 디렉토리를 정리하면서 `libs/workbench/package.json` 에서 shadcn devDep 도 제거. `apps/everysim/globals.css` 의 import 는 그대로. → 이 시점부터 root `node_modules/shadcn` 도 사라져 dev 가 *진짜로* 깨졌지만 lint/test/build 가 다 통과해서 표면화 안 됨.

## CONSUMER-GREP

```bash
$ grep -rn "shadcn/tailwind" apps libs --include='*.css'
apps/everysim/src/app/globals.css:2:@import 'shadcn/tailwind.css';

$ grep -l '"shadcn"' apps/*/package.json libs/*/package.json package.json
(none — 어느 워크스페이스에도 등록 안 됨)

$ ls node_modules/shadcn 2>&1
ls: cannot access 'node_modules/shadcn': No such file or directory
```

→ 사용처 `apps/everysim` ≠ (없어진) 등록 위치 `libs/workbench`. 두 부채가 합쳐져 침묵 속에 누적.

## 표면화 트리거

`upstream/develop` 머지 commit 직후 사용자가 처음 `npm run dev:local` 시도. 메모리 노트 (`project_workbench_v2_status.md`) 에는 "Manual browser smoke test on the release/v1.0 branch is **pending the user**" — *기록* 만 있고 *수행* 은 없는 상태로 흘러옴.

## SMOKE / 복구

두 부채를 *분리해서* 두 commit 으로 정리:

1. **`42c804b71 fix(everysim): shadcn devDep 누락 복구`**
   ```bash
   npm install --save-dev shadcn@^4.2.0 -w apps/everysim
   ```
   - shadcn 의 *진짜 사용처* (`apps/everysim`) 에 직접 등록.
   - `libs/workbench` 가 더 이상 host 가 아니므로 거기에는 안 등록.

2. **`ccebec87a fix(everysim): legacy postcss.config.cjs 제거`**
   ```bash
   rm apps/everysim/postcss.config.cjs
   ```
   - v3 잔재 제거. `.mjs` 가 단독으로 활성화되어 `@tailwindcss/postcss` 가 살아남.
   - 이걸로 Tailwind v4 의 자체 cssResolver 가 `@import 'shadcn/tailwind.css'` 를 가로채 `exports.style` condition 으로 정상 해소.

검증:
```bash
$ npm run dev:local
✓ Ready in 278ms
○ Compiling /[locale] ...
GET /en 200 in 10.5s
```

## 4섹션 출력

```
Drift     — (1) Tailwind v3 잔재 postcss.config.cjs 가 v4 .mjs 보다 우선이라 PostCSS 가 v3 모드로 진입 시도. (2) shadcn devDep 의 등록 위치(libs/workbench) 와 사용 위치(apps/everysim) 불일치, npm workspace hoisting 으로 우연히 풀리던 상태.
Trigger   — c41df4e76 (workbench v2 SDK 재구성) 이 libs/workbench 에서 shadcn 을 떼어내면서 root node_modules 에서 사라짐. 하지만 lint/test/build 모두 통과해 표면화 안 됨. 사용자가 머지 후 처음 next dev 띄우다 발견.
Consumer  — `grep -r '@import' apps libs --include='*.css'` → apps/everysim/src/app/globals.css 단 한 곳. 사용처와 등록 위치가 다른 워크스페이스.
Smoke     — apps/everysim 에 shadcn 직접 등록 + postcss.config.cjs 제거. 두 변경을 별도 commit (42c804b71, ccebec87a) 으로 분리. dev 첫 페이지 200 확인. 후속 — CI 에 next dev + curl 한번 추가 검토.
```

## 회고 — 왜 이 부채가 누적됐나

- **자동 마이그레이션 직후 수동 정리 누락** (#2). `@tailwindcss/upgrade` 가 add 만 한다는 사실을 의식하지 못함.
- **monorepo deps 정리 PR 에서 consumer-grep 누락** (#3·#4). `c41df4e76` 가 `libs/workbench` 측만 보고 떼어냄.
- **정적 검증 = 통과 라는 안일함** (#1). lint/test/build 가 다 초록색이라 검증된 줄 알았지만 dev runtime 은 안 봄.
- **"smoke pending" 메모를 검증 대신 사용** (#5). 메모로 기록은 했지만 그 사이 부채가 누적된 채 흘러감.
