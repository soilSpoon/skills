# Case Study — branch-merge 후 stale import drift (occt-workbench / init-tour / sanitize-filename)

dronerush 모노레포 (`apps/everysim` Next.js 16 + Turbopack) 에서 keycloak 인증 깨짐을 고치고 처음으로 `/dashboard`·`/workbench` 라우트에 진입한 순간 표면화된 사례. **모듈 결손 세 종류**가 한 번에 드러났고, 공통 원인은 모두 *삭제·이동 PR 이전에 분기되어 있던 feature PR 이 옛 경로/이름을 그대로 머지*한 것.

## 증상

```
./apps/everysim/src/components/every-drone/dashboard/dashboard-shell.tsx:60:1
Module not found: Can't resolve '@/packages/occt-workbench/hooks/use-event-source-for-next'
Import map: aliased to relative './src/packages/occt-workbench/hooks/use-event-source-for-next' inside of [project]/apps/everysim
```

총 19개 파일에서 `@/packages/occt-workbench/...` (옛 디렉터리), `@/packages/ui/components/{avatar,sheet,...}` (옛 위치), `@/tour/init-tour` (dead module), `sanitize-filename` (npm 패키지 미등록) 가 한데 섞여 있었음.

## DETECT: layer 식별

| Layer | 결과 | 이유 |
|---|---|---|
| `tsc --noEmit` | ❓ (확인 안 됨) | tsconfig `paths` 가 `@/* → ./src/*` 로 alias 만 검증 — 실제 파일 존재는 IDE/CLI 가 *느슨하게* 통과 가능 |
| `eslint --max-warnings 0` | ✅ 통과 | `eslint-plugin-import/no-unresolved` 가 꺼져 있거나 resolver 설정 누락 |
| `vitest` | ✅ 통과 | 해당 라우트 컴포넌트가 unit test 로 import 되지 않음 |
| `next build` (prod, webpack) | ❓ (확인 안 됨) | 빌드는 모든 라우트 컴파일 — 실제론 깨졌을 것 |
| `next dev` (turbopack) | ❌ **라우트 진입 시점에만** | dev 는 lazy compile — 라우트가 navigate 되어야 컴파일 |

핵심: **dev 라우트 진입 = 발견 시점**. 통합 테스트가 라우트 응답 200 을 보지 않는 한 머지 후 처음 그 페이지를 띄우는 사람이 발견한다.

## SCOPE: 4종 결손의 공통 구조

| # | 결손 | 옛 경로 | 새 경로 | 삭제·이동 commit | 옛 경로를 다시 박은 commit |
|---|---|---|---|---|---|
| 1 | `occt-workbench` 디렉터리 | `@/packages/occt-workbench/{stores,hooks,components}/...` | `@/{stores,hooks}/...` 또는 `@/components/shared/job/...` | `59555d35f Delete legacy occt-workbench package` | unified-dashboard / fast-track 등 *분기 시점이 더 옛날인 PR* 들이 늦게 머지 |
| 2 | shadcn 컴포넌트 일부 | `@/packages/ui/components/{avatar,sheet,hover-card,scroll-area,separator,textarea,...}` | `@/components/ui/shadcn/{같은이름}` | (디렉터리 분리 리팩토링) | 같은 PR 들이 옛 위치 가정 |
| 3 | `init-tour` thin wrapper | `@/tour/init-tour` (`initTourSystem`) | (dead — `initTourEventBridge` 도 함께 청소됨) | `1580e9b23 chore: 의존성 청소 (-32K LOC)` | `808a2953c refactor: TourController v2 통합` 가 develop fix/onboarding-tour 의 옛 import 를 그대로 가져옴 |
| 4 | `sanitize-filename` npm dep | `import sanitize from 'sanitize-filename'` (`apps/everysim/src/lib/format.ts`) | 동일 — 단지 `package.json` 에 등록 안 됨 | `e3fbcdd14 feat: 워크벤치 v2 호스트 통합` | 같은 commit — 추가했지만 deps 등록 누락 |

원칙 매핑:
- #1 (정적 layer ≠ 런타임 layer): lint/test 다 통과, dev 라우트 진입에서 표면화
- #4 (Hoisting 환상): `sanitize-filename` 은 root `node_modules` 에도 없어서 hoisting 으로조차 가려지지 않음 — *그 이전* 단계의 누락
- 새 패턴 (이 케이스가 추가하는 것): **branch-merge import drift** — git 의 텍스트-merge 가 *symbol resolution* 을 검증하지 않는 사실이 잠재 부채로 작동

## AUDIT: 잠재 부채 스캔

```bash
# (a) 옛 디렉터리 stale 임포트 — 디렉터리 삭제 PR 이후 머지된 PR 의 잔재
DELETED_DIR='@/packages/occt-workbench'
grep -rnE "from '$DELETED_DIR" apps/everysim/src --include='*.ts' --include='*.tsx'

# (b) 옛 alias 위치 — 공통 alias 안의 *어떤 파일은 있고 어떤 파일은 없다* 케이스
for c in $(grep -rhoE "from '@/packages/ui/components/[^']+'" apps/everysim/src --include='*.ts' --include='*.tsx' | sed -E "s|.*components/([^']+)'|\1|" | sort -u); do
  test -e "apps/everysim/src/packages/ui/components/$c.tsx" || echo "STALE: $c"
done

# (c) dead import — symbol 정의가 어디에도 없음
grep -rn "initTourSystem" apps/everysim/src --include='*.ts' --include='*.tsx'
grep -rnE "(export (const|function) initTourSystem|export \{[^}]*initTourSystem)" apps/everysim/src

# (d) deps 등록 누락 — import 는 있는데 어떤 package.json 에도 없음
PKG=sanitize-filename
grep -rln "from '$PKG'" apps libs --include='*.ts' --include='*.tsx'
grep "\"$PKG\"" package.json apps/*/package.json libs/*/package.json
```

(d) 의 결과가 *grep 은 매치되는데 package.json 어디에도 없음* 이면 hoisting 환상을 *지나서* deps 자체 누락. `npm install <pkg> -w <workspace>` 로 사용처 워크스페이스에 직접 등록.

## CONSUMER-GREP: stale 임포트의 *진짜 사용처* 매핑

stale 경로를 새 경로로 교체하기 전, 같은 symbol 을 다른 파일들이 *이미* 어떤 경로로 import 하는지 확인 → 그 경로가 canonical:

```bash
# 같은 store/hook 을 다른 파일들은 어떻게 import 하는가
grep -rnE "from '@/.*dialog-store'" apps/everysim/src --include='*.ts' --include='*.tsx'
# new-project-button.tsx → @/stores/dialog-store        ← canonical
# dashboard-shell.tsx    → @/packages/occt-workbench/...  ← stale (소수)
```

같은 코드의 두 import 경로가 공존하면 *다수가 쓰는 쪽이 canonical*. 일치 캠페인.

## 일괄 교체 (string-literal sed)

매핑이 모두 1:1 string substitution 이라 충돌 위험 없음:

```bash
mapfile -t FILES < <(grep -rlE "@/packages/(occt-workbench|ui/components/(alert-dialog|avatar|hover-card|...))" apps/everysim/src --include='*.ts' --include='*.tsx' | sort -u)
sed -i \
  -e 's|@/packages/occt-workbench/components/job/|@/components/shared/job/|g' \
  -e 's|@/packages/occt-workbench/hooks/|@/hooks/|g' \
  -e 's|@/packages/occt-workbench/stores/|@/stores/|g' \
  -e 's|@/packages/ui/components/avatar|@/components/ui/shadcn/avatar|g' \
  ... \
  "${FILES[@]}"
```

## SMOKE: 재발 방지

- **CI 또는 lint 단계에서 잡히게**: `eslint-plugin-import/no-unresolved` + `eslint-import-resolver-typescript` 활성화. tsconfig `paths` 와 실제 파일 매칭을 lint 가 검증하면 위 4종 모두 *머지 전*에 잡힌다.
- **dev-smoke**: `next build` 또는 최소한 `next dev` + 주요 라우트 (`/`, `/dashboard`, `/workbench/[id]`) curl 200 확인. lazy-compile 의 발견 지연을 *머지 시점*으로 당김.
- **머지 시점 점검 룰**: 디렉터리 삭제·이동 PR 후 *분기가 더 오래된* PR 을 머지할 때, 머지 결과물에 옛 경로 잔재가 있는지 grep — 텍스트 충돌이 없어도 symbol resolution 충돌이 있을 수 있다.

## 트리거 시그널

- 기능을 처음 페이지에 들어가 본 순간 `Module not found: Can't resolve '@/...'` 한꺼번에 다수 발생
- 같은 symbol 을 *어떤 파일은 새 경로*, *다른 파일은 옛 경로* 로 import 하고 있음
- `git log` 에 "Delete legacy ...", "정리 -XK LOC", "v2 통합" 같은 정리·통합 commit + 그 이후 *분기 시점이 더 오래된* feature PR 머지
- `package.json` 에 등록 안 됐는데 `node_modules` 에도 없는 import — hoisting 환상의 *전 단계* (deps 등록 누락) 의심
- dev runtime 만 깨지고 build/lint 통과 — Next.js Turbopack 처럼 lazy-compile 환경의 라우트 진입 발견 지연

## 한 줄 정리

**git 의 텍스트 merge 는 symbol resolution 을 검증하지 않는다.** 디렉터리 삭제·이동 PR 과 분기 시점이 다른 feature PR 이 늦게 머지되면, lint/test 가 *우연히* 통과해도 dev 라우트 진입 순간 다수의 결손이 한꺼번에 표면화된다. `import/no-unresolved` 가 lint 단에서 못 잡으면 머지 시점 점검 룰 + dev-smoke 로 당겨야 한다.
