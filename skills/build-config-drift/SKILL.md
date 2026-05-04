---
name: build-config-drift
description: 자동 마이그레이션·codemod·monorepo deps 재배치·workspace 변경·branch 머지·compose 파일 변경 후 정적 검증(lint/test/tsc/build)은 통과하거나 인프라 컨테이너는 살아있는데 런타임만 침묵 속에 깨지는 잠재 부채를 추적·감사·복구하는 워크플로. 트리거 — (1) "Can't resolve X" 같은 빌드 도구 resolve 에러, "next dev 안 됨", "lint/test 다 통과하는데 화면이 흰색", "build 는 되는데 dev 가", (2) `@tailwindcss/upgrade`·jscodeshift·codemod·`eslint --fix` 대량 적용·`next codemod` 같은 자동 마이그레이션 PR 직후, (3) `postcss.config.{cjs,mjs}`·`babel.config.{js,cjs}`·`eslint.config.{js,mjs}` + `.eslintrc*`·`tsconfig*.json` 같은 두 개의 빌드 도구 config 가 공존 의심, (4) monorepo workspace 의 패키지 외부화·deps 정리 PR (`-30K LOC chore` 류), 패키지 deps 떼어냈는데 *진짜 사용처는 다른 워크스페이스* 케이스, (5) "이 dep 누가 써?", "왜 root `node_modules` 에 있지", workspace hoisting 으로 우연히 풀리던 import 의심, (6) "수동 스모크 테스트 펜딩" 같은 미검증 메모만 남기고 흘러간 PR 검증, (7) 같은 dep/config 가 머지·머지 후에야 표면화된 dev 깨짐 사례, (8) 디렉터리 삭제·이동·심볼 rename PR 후 *분기 시점이 더 옛날인 feature PR* 이 늦게 머지되어 stale import (`Module not found: Can't resolve '@/...'`) 가 라우트 진입 시점에 한꺼번에 표면화 — git 텍스트 머지가 symbol resolution 을 검증하지 않는 부채, (9) `import` 가 있는데 `package.json` 어디에도 없는 npm 패키지 (hoisting 환상의 *전 단계* — deps 등록 누락), (10) `docker ps` 에 `Restarting (N)` 컨테이너 + `compose` 정의 ↔ 컨테이너 `.Config.Env` 불일치, 자동복구 스크립트가 `docker restart` 만 하고 `--force-recreate` 가 없는 경우 (compose drift 가 영구 상태). issue-rootcause-workflow 와 다른 점 — 그건 *런타임 버그를 만난 후* 의 디버깅 워크플로고, 이건 *정적 변경이 런타임을 침묵시킨* 잠재 부채의 *발견·감사* 워크플로다.
---

# Build Config Drift

## 핵심 철학

**정적 검증 통과 ≠ 런타임 통과.** 자동 마이그레이션은 새 형식을 *add* 하지만 옛 형식을 *remove* 하지 않는다. monorepo 의 deps 재배치는 host 측의 진짜 사용처를 보지 않은 채 "여기서 안 써" 로 떼어낸다. workspace hoisting 은 우연히 풀리던 import 를 silent 하게 만든다. 이 셋이 합쳐져 *lint/test/tsc/build 는 통과하는데 dev runtime 만 침묵 속에 깨진* 채 PR 이 흘러가고, 한참 후 누군가 dev 를 띄우려는 순간에야 표면화된다.

이 스킬은 그 부채를 *발견* 하고 *감사* 하고 *복구* 한다. 이미 깨진 런타임을 보고 *역추적* 하는 방향이 아니라, **PR 검증 단계에서 잠재 부채를 미리 잡는** 방향으로 작동한다.

| # | 원칙 | 한 줄 |
|---|---|---|
| 1 | 정적 layer ≠ 런타임 layer | lint/test/tsc 가 통과해도 dev/build resolver 는 다른 코드 경로다 |
| 2 | 자동 도구는 add 만 한다 | codemod·upgrade tool 직후엔 옛 형식 파일·옛 deps 가 잔재로 남는다 |
| 3 | Consumer 우선 grep | dep 정리 전 *진짜 사용처* 를 import 경로로 검증한다 |
| 4 | Hoisting 환상 | workspace root `node_modules` 에 우연히 hoist 된 dep 는 등록 위치와 사용 위치 불일치를 가린다 |
| 5 | "Pending" 메모 ≠ 검증 | "smoke test pending" 같은 기록은 *수행* 이 아니다 |
| 6 | Merge ≠ Resolution | git 의 텍스트 머지는 symbol/path resolution 을 검증하지 않는다 — 디렉터리·심볼 삭제 PR 후 분기가 옛 PR 을 머지하면 stale import 가 통과 |
| 7 | 정의 변경 ≠ 인스턴스 갱신 | compose/manifest 같은 정적 정의는 *재생성* 으로만 컨테이너/리소스에 반영된다. `restart` 는 env/network/volumes 를 갱신하지 않는다 |

자세한 정의·발동 신호·체크리스트는 [principles.md](references/principles.md) (필요해지면 이 파일을 분리). 케이스 스터디 — [case-tailwind-shadcn-postcss.md](references/case-tailwind-shadcn-postcss.md) (자동 마이그레이션 잔재 + monorepo deps 재배치), [case-merge-import-drift.md](references/case-merge-import-drift.md) (디렉터리 삭제·이동 PR 후 분기 PR 의 stale import + npm dep 등록 누락), [case-keycloak-restart-loop.md](references/case-keycloak-restart-loop.md) (compose 정의 ↔ 컨테이너 env drift, `docker restart` 자동복구의 함정).

## 워크플로 (5단계)

```
1. DETECT          의심 신호 인지: "Can't resolve X" / dev 만 깨짐 / dual config / "smoke pending"
2. SCOPE           정적/런타임 layer 어디서 실패하는가? lint·test·tsc 는 어떻게 통과했나?
3. AUDIT           dual config 스캔 + deps 이동 이력 추적 (git log -p package.json)
4. CONSUMER-GREP   해당 import/symbol 의 *진짜 사용처* grep — 어느 워크스페이스가 쓰는가
5. SMOKE           dev runtime 띄워 첫 페이지 200 확인. CI 에 dev-smoke 추가 가치 검토
                   ↑ 이 단계가 빠지면 같은 부채가 반복된다
```

각 단계의 진입 신호와 도구는 아래 트리거 맵.

## 트리거 맵

PR 리뷰·환경 진단·머지 직후 아래 신호가 보이면 해당 단계로 들어간다.

| 신호 | 단계 | 원칙 |
|---|---|---|
| `Can't resolve 'X'` (turbopack/webpack/postcss) — root `node_modules` 에는 X 가 있는데 못 찾음 | DETECT → AUDIT | #1·#4 |
| `npm run build` 통과 / `next dev` 깨짐 (또는 그 반대) | DETECT → SCOPE | #1 |
| `@tailwindcss/upgrade`·`next codemod`·`eslint --fix` 대량 적용 후 PR | DETECT → AUDIT | #2 |
| `postcss.config.cjs` 와 `postcss.config.mjs` 가 동시 존재 | AUDIT | #2 |
| `babel.config.{js,cjs,json}` 과 `.babelrc*` 동시 존재 | AUDIT | #2 |
| `eslint.config.{js,mjs}` 와 `.eslintrc*` 동시 존재 | AUDIT | #2 |
| 자동 마이그레이션 후 사라진 파일 (`tailwind.config.ts`, `babel.config.js`) 을 가리키는 *옛* config 가 살아있음 | AUDIT | #2 |
| monorepo 의 패키지 정리 PR (`-XX K LOC chore`, "외부화", "정리") | CONSUMER-GREP | #3·#4 |
| `package.json` 어디에도 등록 안 된 dep 인데 `node_modules` 에 들어와 있음 | AUDIT → CONSUMER-GREP | #4 |
| 한 워크스페이스에서 떨어진 dep 의 사용처가 *다른* 워크스페이스 | CONSUMER-GREP | #3·#4 |
| "수동 스모크 테스트는 사용자 펜딩" 같은 메모만 있고 검증 안 된 PR | SMOKE | #5 |
| 머지 commit 후 처음 dev 띄우다 발견 — 머지 자체는 죄가 없을 수 있음 | DETECT → SCOPE → AUDIT | #1·#2·#3·#4·#5 |
| 라우트 진입 시 `Module not found: Can't resolve '@/...'` 다수가 한꺼번에 — 디렉터리 삭제·이동 PR 이후 머지된 옛 분기 PR 의 잔재 | DETECT → AUDIT → CONSUMER-GREP | #1·#6 |
| 같은 symbol 을 *어떤 파일은 새 경로*, *다른 파일은 옛 경로* 로 import | CONSUMER-GREP | #6 (canonical 은 다수가 쓰는 쪽) |
| `import` 는 있는데 `package.json` *어디에도* 없는 npm 패키지 — root `node_modules` 에도 없음 | AUDIT → CONSUMER-GREP | #4 (hoisting *전 단계* — deps 등록 누락) |
| `docker ps` 에 `Restarting (N)` + 외부 의존성 접속 실패 로그 | DETECT → AUDIT | #7 |
| `docker inspect <c>` env 가 `compose`/`override.yml` 의 값과 다름; `.Created` 시각이 compose 변경 commit 이전 | AUDIT | #7 (옛 정의로 만들어진 컨테이너가 살아있음) |
| 자동복구 스크립트(`ensure-*.sh` 류) 가 `docker restart` 만 하고 `--force-recreate` 가 없음 | AUDIT → SMOKE | #7 (compose drift 영구화) |

## 출력 형식

조사 끝에는 항상 4섹션으로 정리. PR 코멘트·인시던트 메모·commit 본문 그대로 사용 가능한 형식:

```
**Drift**    — 어떤 잠재 부채가 누적됐나 (config 중복 / dep 위치 불일치 / hoisting 의존)
**Trigger**  — 무엇이 그걸 표면화시켰나 (어떤 PR·머지·환경 변경)
**Consumer** — 진짜 사용처가 어디였나 (grep 결과)
**Smoke**    — runtime 한번 더 검증한 결과 + 같은 부채 재발 방지책
```

## 단계별 도구

### DETECT

빌드/런타임의 어느 layer 에서 실패하는가 식별한다. 같은 코드를 검증하는 도구가 여러 개 있고 *각각 다른 resolver/parser/transform pipeline 을 쓴다*.

| Layer | 도구 | resolver | 잡는 것 |
|---|---|---|---|
| TS 타입 | `tsc --noEmit` | tsconfig paths | 타입·import 존재 |
| Lint | `eslint` | eslint resolver | 코드 패턴 |
| Test | `vitest`/`jest` | 자체 resolver (보통 lenient) | 단위 동작 |
| Build (prod) | `webpack`/`next build` | webpack resolve.conditionNames | 프로덕션 번들 |
| Dev runtime | `turbopack`/`vite`/`next dev` | 자체 resolver (조건 다를 수 있음) | 실제 실행 |

여기서 핵심: **"lint/test/build 통과 ≠ dev 통과"** 가 자주 발생하는 위치는 두 군데 — (a) build 와 dev 가 다른 번들러 (예: Next.js prod=webpack, dev=turbopack), (b) PostCSS 같은 sub-pipeline 이 일부 layer 에서만 활성화.

### SCOPE

DETECT 결과로 어느 layer 가 실패하는지 좁힌다. 그 다음 그 layer 의 resolver 가 *어떤 input 을 받는지* 추적한다 (config 파일, env, conditionNames 등).

### AUDIT

```bash
# 1. dual config 스캔 — 같은 도구의 여러 형식이 공존하는지
find . -maxdepth 4 \
  \( -name "postcss.config.*" -o -name "babel.config.*" -o -name ".babelrc*" \
     -o -name "eslint.config.*" -o -name ".eslintrc*" -o -name "tsconfig*.json" \
     -o -name "vite.config.*" -o -name "rollup.config.*" \) \
  -not -path "*/node_modules/*" -not -path "*/.next/*" \
  | sort

# 2. 옛 config 가 사라진 파일을 가리키는지
grep -l "tailwind.config" $(find . -name "postcss.config.*" -not -path "*/node_modules/*")

# 3. deps 이동 이력
git log --oneline -p -- package.json apps/*/package.json libs/*/package.json | grep -B2 -A1 '"<dep-name>"'

# 4. 자동 마이그레이션 commit 식별
git log --grep="upgrade\|codemod\|migrate" --oneline -20
```

dual config 가 발견되면 보통 *오래된 형식이 우선* 이라 새 형식 plugin 이 *침묵 속에 비활성화* 된다 — postcss-load-config·cosmiconfig 류는 보통 `.cjs`/`.js` 를 `.mjs` 보다 먼저 본다.

```bash
# 5. stale import 스캔 — 디렉터리 삭제·이동 PR 후 머지된 옛 분기의 잔재 (#6)
DELETED='@/packages/occt-workbench'   # 예: 삭제된 옛 alias prefix
grep -rnE "from '$DELETED" apps libs --include='*.ts' --include='*.tsx'

# alias 안에서 *어떤 파일은 있고 어떤 파일은 없는* 케이스
for c in $(grep -rhoE "from '@/<old-alias>/[^']+'" apps/X/src --include='*.tsx' | sed -E "s|.*/([^/']+)'|\1|" | sort -u); do
  test -e "apps/X/src/<old-alias-path>/$c.tsx" || echo "STALE: $c"
done

# 6. dead import — symbol 정의가 코드베이스 어디에도 없음 (#6)
SYM=initTourSystem
grep -rn "$SYM" apps libs --include='*.ts' --include='*.tsx'
grep -rnE "(export (const|function) $SYM|export \{[^}]*$SYM)" apps libs

# 7. deps 등록 누락 — import 는 있는데 어떤 package.json 에도 없음 (#4의 *전 단계*)
PKG=sanitize-filename
grep -rln "from '$PKG'" apps libs --include='*.ts' --include='*.tsx'
grep "\"$PKG\"" package.json apps/*/package.json libs/*/package.json

# 8. compose 정의 ↔ 살아있는 컨테이너 env drift (#7)
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '<VAR>'
grep -E '<VAR>:' libs/<svc>/docker-compose.yml libs/<svc>/docker-compose.override.yml
docker inspect <container> --format '{{.Created}}'
git log --oneline -- libs/<svc>/docker-compose.yml libs/<svc>/docker-compose.override.yml

# 9. 자동복구 스크립트가 docker restart 만 하는지 (#7)
grep -rnE 'docker (restart|start) ' apps/*/scripts libs/*/scripts 2>/dev/null
```

### CONSUMER-GREP

```bash
# import 경로로 진짜 사용처 추적
grep -rn "from ['\"]<package>" apps libs --include='*.{ts,tsx,js,jsx,css,scss}'
grep -rn "@import ['\"]<package>" apps libs --include='*.css'
grep -rn "require\(['\"]<package>" apps libs --include='*.{ts,tsx,js,jsx,cjs}'

# 실제 등록된 워크스페이스 확인
for f in package.json apps/*/package.json libs/*/package.json; do
  has=$(grep -c "\"<package>\"" "$f" 2>/dev/null)
  echo "$f $has"
done
```

사용처와 등록 위치가 *다른 워크스페이스* 면 hoisting 환상에 의존하는 상태. host 측 (사용처) 워크스페이스에 dep 를 직접 등록한다.

### SMOKE

```bash
# dev runtime 한번 띄우고 첫 페이지 200 확인
npm run dev:local & sleep 8
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/
kill %1
```

CI 에 추가하려면 `next dev` 띄우고 `curl` 한번 하는 가벼운 step 으로 충분하다. 화면 렌더 검증까지 가려면 Playwright 한 페이지.

## 통합 체크리스트

조사·정리를 끝맺기 전 점검. 라벨은 최소 엄격도.

**Detect (#1)**
- `[MUST]` 어느 layer (lint·test·tsc·build·dev) 에서 실패하는지 한 줄로 정리했는가
- `[MUST]` 통과한 layer 와 실패한 layer 가 *다른 resolver/pipeline* 을 쓰는 이유를 짚었는가

**Audit (#2)**
- `[MUST]` `find` 로 dual config 스캔 결과를 PR 코멘트/노트에 첨부했는가
- `[SHOULD]` 자동 마이그레이션 commit (codemod·upgrade) 이 *어떤 파일을 추가했고 어떤 옛 파일을 안 지웠는지* 명시했는가
- `[SHOULD]` 옛 config 가 사라진 파일 (예: `tailwind.config.ts`) 을 가리키는지 확인했는가

**Consumer-grep (#3)**
- `[MUST]` `import`·`@import`·`require` grep 결과로 진짜 사용처를 찾았는가
- `[MUST]` 사용처와 등록 위치 (`package.json`) 가 *같은 워크스페이스* 인지 확인했는가
- `[SHOULD]` workspace root `node_modules` hoisting 에 의존하는 import 가 있는지 짚었는가 (#4)

**Smoke (#5)**
- `[MUST]` dev runtime 한번 띄우고 첫 페이지 응답 200 확인했는가
- `[SHOULD]` 같은 부채 재발 방지책을 commit 본문 또는 follow-up issue 에 남겼는가
- `[NICE]` CI 에 dev-smoke step 추가 검토했는가 (`next dev` + `curl /` + kill)
- `[SHOULD]` 라우트 진입까지 가는 smoke 인지 확인했는가 — 인증 게이트로 막혀있으면 dashboard/workbench 같은 *내부 라우트*의 결손이 가려진다 (#6)

**Merge resolution (#6)**
- `[MUST]` 디렉터리 삭제·이동·심볼 rename PR 이 main 에 들어간 후, 분기가 *그보다 옛날인* 머지 대상 PR 들의 stale import 를 grep 했는가
- `[MUST]` 같은 symbol 을 *다수가 쓰는 canonical 경로* 와 *소수가 쓰는 옛 경로* 가 공존하는지 확인했는가 — 일치 캠페인 대상
- `[SHOULD]` lint 단의 `import/no-unresolved` (+ `eslint-import-resolver-typescript`) 가 켜져 있는지 점검했는가 — 안 켜져 있으면 dev 라우트 진입 전엔 안 잡힘

**정의 ↔ 인스턴스 동기화 (#7)**
- `[MUST]` 자동복구 스크립트가 unhealthy/restart-loop 케이스에 `docker restart` 가 아닌 `up -d --force-recreate` 를 쓰는지 확인했는가
- `[MUST]` `docker ps` 의 RUNNING + RESTARTING 가 같이 노출되는 점을 의식하고, 상태 판정을 *health check 결과* 로 했는가 (string match 가 아니라)
- `[SHOULD]` compose 파일 수정 PR 에 "기존 컨테이너 force-recreate 필요" 메모를 남겼는가

## 안티패턴

조사·정리 중 빠지기 쉬운 패턴:

- **"이 dep 우리 패키지 안에서 안 쓰니 지운다"** — 같은 워크스페이스 안만 grep 하고 *다른 워크스페이스*·*CSS 의 `@import`*·*config 안의 string 참조* 를 놓침. → CONSUMER-GREP 의 모든 검색 패턴 적용.
- **"새 config 추가했으니 옛 config 는 자동으로 무시될 거다"** — 자동 마이그레이션 도구가 가정하는 동작이지만 postcss-load-config 같은 라이브러리는 *발견된 첫 config* 를 우선시한다. → AUDIT 의 dual-config 스캔.
- **"smoke test pending 으로 메모만 남기고 머지"** — 메모는 *기록* 일 뿐. 다음 사람·다음 환경·다음 머지가 trigger 가 되어 잠재 부채를 표면화시킨다. → SMOKE 단계 강제.
- **"dev 가 깨진 건 환경 문제일 거야 (다른 사람은 잘 도는데)"** — workspace hoisting·환경별 캐시·node_modules 상태에 따라 *우연히* 풀리던 게 누군가에겐 안 풀린다. 우연을 부채로 인정. → CONSUMER-GREP 으로 등록 위치를 명시화.
- **"머지 충돌 없으면 머지 안전"** — git 의 텍스트 머지는 *symbol resolution* 을 검증하지 않는다. 디렉터리 삭제·이동·rename PR 이 main 에 들어간 후 *분기 시점이 더 옛날인 PR* 이 늦게 머지되면, 텍스트 충돌 없이도 stale import 가 통과한다. → 디렉터리 삭제·심볼 rename PR 이후 머지하는 PR 마다 stale-import grep 룰.
- **"compose 파일은 고쳤으니 다음 dev 에서 적용될 것"** — `docker restart` 는 env/network/volumes 를 갱신하지 않는다. 자동복구 스크립트가 *재시작* 에 의존하면 옛 정의로 만들어진 컨테이너가 *영구히* 그 상태로 남는다. → healthy 분기 외 모두 `up -d --force-recreate` 로 통일.
- **"`docker ps` 에 보이니 running 이다"** — `docker ps` 는 RUNNING + RESTARTING 모두 노출. 재시작 루프 컨테이너가 "running" 으로 분류되어 health 분기까지 도달하지 못함. → 상태 판정은 health check 결과만 신뢰.

## 예시 적용

- [case-tailwind-shadcn-postcss.md](references/case-tailwind-shadcn-postcss.md) — Tailwind v3→v4 자동 마이그레이션 잔재 (`postcss.config.cjs`) + monorepo deps 재배치 (`shadcn` 이 `libs/workbench` 에서 떨어졌는데 사용처는 `apps/everysim`) 가 머지 한 번에 동시에 표면화된 사례. 5단계 워크플로 적용 결과와 두 commit (`42c804b71`, `ccebec87a`) 의 분리 이유를 정리.
- [case-merge-import-drift.md](references/case-merge-import-drift.md) — `Delete legacy occt-workbench` PR 이후 분기가 옛날인 unified-dashboard·v2 통합 PR 들이 늦게 머지되면서 stale `@/packages/occt-workbench/...` import + dead `@/tour/init-tour` + `package.json` 미등록 `sanitize-filename` 가 라우트 진입 시점에 한꺼번에 표면화된 케이스. 19개 파일 일괄 string-literal sed 교체와 lint 단 `import/no-unresolved` 활성화 권장.
- [case-keycloak-restart-loop.md](references/case-keycloak-restart-loop.md) — `libs/keycloak/docker-compose.override.yml` 가 DinD 환경 보정 (`MYSQL_HOST: mysql`) 을 추가했는데, 이전에 만들어진 컨테이너가 `docker restart` 자동복구 루프 안에 갇혀 옛 env (`localhost:3306`) 로 영원히 부팅 시도한 케이스. `ensure-keycloak.sh` 의 healthy-or-recreate 단순화 패치.
