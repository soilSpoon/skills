# /slice 엔진 강화 런 — 오너 가이드 리드 (8aa72d4 → a748020, 16 commits, +1400/-143)

이번 런의 주제 하나로 요약: **"sh() 프록시가 죽거나 쿼터가 터졌을 때 엔진이 거짓말하지 않게 만들기"** + 프롬프트/스키마 다이어트 + 병렬 worktree 실용화. 모든 검증은 in-process 픽스처 호스트(가짜 dispatcher) 기반 — 실세계 검증 항목은 4절에.

## 1. Reading order (~10-15분, 의존성 순)

1. **`/home/dh/work/skills/skills/slice/src/types.ts`** (2분) — 엔진의 타입 계약. `b592585`(C1-C4)가 한 번도 안 쓰이던 필드를 제거: `ExecResult.diff`, `Verdict.silentErrorRisk`, `Assessment.risk` 삭제, `Assessment.size` optional화. `21a62b8`(GROUP E)가 `Baseline.worktreeSetupCommand` 추가. 이 파일이 바뀌면 schemas.ts와 prompts.ts가 따라간다.
2. **`/home/dh/work/skills/skills/slice/src/schemas.ts`** (2분) — 위 타입의 JSON-Schema 거울. `BASELINE.required`에서 `summary` 빠짐, `worktreeSetupCommand` 추가. LLM 출력 강제 지점이므로 여기가 곧 role API다.
3. **`/home/dh/work/skills/skills/slice/src/prompts.ts`** (3분) — `9808cc4`(B2-B8) 프롬프트 다이어트가 핵심: **R_COORD가 "전체 머지+풀스위트+worktree 제거 오너"에서 "충돌 한 건 해결사"로 축소**(머지/풀스위트/정리는 엔진이 결정적으로 직접 수행), R_VERIFY의 dead FULL-run 분기 삭제, R_EXEC SPEED 중복 제거 + `evidence`/`funList` 요구 명시. `21a62b8`이 R_BASELINE에 WORKTREE SETUP 문단 추가.
4. **`/home/dh/work/skills/skills/slice/src/main.ts`** (핵심, 5-6분) — 읽을 지점:
   - **L44-72** (`961d43f`+`fa91b5c`, A6): `NULL_STREAK_CLASSES` — QUOTA_HALT는 이제 "연속 null ≥3 **그리고** 호출 class ≥2"일 때만. heavy 3-lens 루프(같은 class 3연속 null)는 halt 안 함. `callClass()`는 label/phase의 `:`/`·` 앞 prefix.
   - **L108-140** (`4302ccd` A1+A7, `8c23e1a` A2): `SH_UNAVAILABLE` 센티널(exitCode -2, 참조 동일성 비교)과 `shForce`(QUOTA_HALT를 우회하는 기계적 cleanup 전용 — lock-clear에만 사용).
   - **L193-268** (`4302ccd`+`a748020`): 5개 결정 지점의 fatal 가드 — git-sha, git-clean, lock-dir(1회 재시도 후 fatal), lock-check, lock-write. 각각 죽으면 false read(BASE_SHA='', gitClean=true, held='', 락 안 잡힘)로 이어지던 것을 abort로 교체.
   - **L427-436 + L535-539** (`8c23e1a` A3): `restore()`가 boolean 반환 — 쿼터 halt 중 sh가 no-op이면 거짓 "restored to" 로그를 안 찍는다.
   - **L484-498** (`adc0b09` B1): tidy leaf는 엔진이 `measureCommand`(풀스위트)를 sh로 직접 실행 → 결과를 ENGINE-RAN으로 verifier에 주입(재실행 금지). L276의 `leafTest` 조건도 light/engineT0면 LEAF_TEST 미주입.
   - **L641-676** (`30027a8` A5 + `21a62b8` E): `clearWorktrees(label, mergedOnly)` — wt-pre는 `--merged HEAD`인 브랜치만 `-D`(미머지 = 다른 런의 살아있는 작업). worktree add 직후 `worktreeSetupCommand` 1회 실행, 실패 시 `delete paths[i]`로 그룹 전체 스킵.
   - **L696-730** (`30027a8` A4): QUOTA_HALT면 Coordinate 전체 스킵 + worktree 보존(resume용). L807 briefing도 `!QUOTA_HALT` 게이트.
   - **L807-810** (`111c45b`): wiring-scan은 센티널이면 조용히 스킵(advisory라 fatal 아님).
5. **`/home/dh/work/skills/skills/slice/recursive-slice.js`** — 읽지 말 것(생성물). `scripts/build-engine.sh`(tsc --strict → tsup → node --check)가 src에서 빌드. **테스트는 src가 아니라 이 아티팩트를 실행한다.**
6. **`/home/dh/work/skills/skills/slice/test/host.mjs`** (1분) — AsyncFunction으로 아티팩트를 in-process 실행하는 픽스처 호스트. 엔진의 유일한 세계 접점이 agent() PORT라서 sh 죽음 경로도 실제 코드 경로다. `ARGS_PARALLEL` 추가됨.
7. **`/home/dh/work/skills/skills/slice/test/scenarios.test.mjs`** (2-3분, 훑기) — 5개 → **28개** 시나리오. 테스트 이름만 읽어도 이 런의 스펙 문서다 (L104, L125, L144, L176, L257: sh 죽음 fatal 5종 / L37, L299: 쿼터 / L406, L447, L803: A6 class-gate / L524-L770: B 시리즈 프롬프트 핀 / L830: C 스키마 / L911-L983: GROUP E).
8. **`/home/dh/work/skills/skills/slice/adapters/opencode/slice-engine.ts` + `host-smoke.mjs`** (`118a5ff`) — opencode tool이 `parallel/forceParallel/sharedScratch/skills`를 PORT args로 포워딩; smoke에 parallel 전달 assertion 추가.
9. **문서** (`1814c1b`): `references/architecture.md`(quota circuit breaker 절 신설, revert→reset --hard 서술 정정, "one workflow at a time"→"one workflow per working tree"), `references/portable-orchestration.md`(streak 2→3 정정), `docs/BACKLOG.md`(A6/tidy/worktreeSetup 완료 처리), `plugins/slice/.claude-plugin/plugin.json` **1.1.2→1.2.0**.

## 2. Decisions made for you

- **interfaceConcern (ledger 원문, leaf 1):** "None. PORT contract unchanged." — 이번 런 전체에서 엔진↔하니스 PORT(agent/log/phase/budget/args 시그니처)는 안 건드렸다.
- **센티널을 null/예외가 아닌 참조-동일 싱글턴으로** (`4302ccd`): `sh()` 반환 타입이 `ShResult` 그대로라 기존 호출부 전부 무수정 컴파일; 결정 지점에서만 `shUnavailable(r)` 검사. 대가는 3절의 참조-동일성 함정.
- **fatal vs graceful을 호출부마다 개별 판정**: 거짓 read가 트리를 망치는 곳(git-sha/git-clean/lock 3종)은 fatal, advisory(wiring-scan)는 스킵, cleanup(restore)은 boolean 보고. 일괄 정책 대신 지점별 위험 분석.
- **shForce를 sh()의 플래그가 아닌 별도 프리미티브로** (`8c23e1a`): ledger 원문 — "merging with sh() via a flag would obscure"; QUOTA_HALT 우회는 lock-clear 한 곳만 허용되는 좁은 예외라 호출부에서 눈에 띄어야 한다. reset/merge/checkout에 절대 사용 금지 주석 포함.
- **A6 class-gate 임계 = "null≥3 AND class≥2"** (`961d43f`): heavy 3-lens는 설계상 같은 class 3연속 null이 가능 — 단일 역할의 일시 장애와 세션 불안정을 구분. streak=3 핀은 `fe85b2e`.
- **A4: 쿼터 halt 시 worktree 보존** (`30027a8`): 이전엔 wt-post 정리가 resume에 필요한 브랜치를 지웠다. 이제 Coordinate 통째 스킵 — resume이 커밋된 leaf 상태에서 재개.
- **A5: wt-pre는 merged-only -D**: 미머지 rs/g* 브랜치 = 다른 런의 살아있는 작업으로 간주, 보존. wt-post는 무조건 삭제(방금 머지했으므로 자명히 merged).
- **B1: tidy 검증의 모순 해소**: R_VERIFY "절대 풀스위트 금지" vs tidy "풀스위트 필요" → 엔진이 결정적으로 1회 실행하고 verifier는 아티팩트만 심사(ENGINE-RAN). 검증자 신뢰 대신 exit code 신뢰.
- **C: SLICES interface가 자식 ctx에 실제로 주입** (`b592585`, main.ts L386-390): slicer가 설계한 FIXED interface가 이전엔 leaf에 안 전달됐다. `TBD`로 시작하면 미주입.
- **E: setup 실패 = 그룹 스킵(재시도 없음)**: 깨진 checkout에서 measure를 돌려 cold-thrash하는 것보다 `no worktree/setup failed`로 명시 실패가 낫다는 판단.

## 3. Buried bodies

- **`shUnavailable`은 참조 동일성** (main.ts L115): `structuredClone`/JSON 직렬화/캐싱이 끼어들면 감지가 조용히 죽는다. ledger가 shape-match 폴백(`exitCode===-2 && stdout.startsWith('\x00SH_UNAVAILABLE')`)을 follow-up으로 제안했지만 **미반영**.
- **`/quota/i` regex 함정**: agentSafe의 쿼터 패턴이 에러 메시지에 'quota'가 들어가기만 해도 QUOTA_HALT를 발동시킨다. 픽스처 작성 시 'fixture: transport error' 같은 문구를 써야 함 — 테스트 6/7이 우연히 통과했던 전례 있음.
- **lock-write: 핀했다가 뒤집음**: `111c45b`의 test 11은 fire-and-forget(현행) 동작을 핀했는데, `a748020`이 fatal로 바꾸면서 그 테스트를 갈아엎었다(현재 scenarios.test.mjs L257이 새 동작 핀). git blame에서 같은 테스트가 두 번 다른 주장을 한 이력.
- **shForce도 죽을 수 있다**: agent() 자체가 transport 레벨에서 죽으면 shForce도 SH_UNAVAILABLE → stale lock 잔존. catch는 로그만 찍는다. 수동 복구: `rm -f <repo>/.git/rs-lock`.
- **Coordinate halt 게이트는 재들여쓰기 없는 `} else {` 블록** (main.ts L705-730, `} // end QUOTA_HALT gate`): diff 최소화 선택이라 3개월 뒤 읽으면 들여쓰기가 거짓말처럼 보인다.
- **callClass는 label 문자열 파싱**: `reset:${lbl}`, `wt-setup:${i}` 같은 label의 `:` 앞부분이 곧 circuit-breaker의 class다. label 이름을 바꾸면 A6 의미가 조용히 바뀐다.
- **`node --test skills/slice/test/`(host.mjs L5의 문서화된 커맨드)는 Node v22.22.1에서 MODULE_NOT_FOUND로 실패** — `node --test skills/slice/test/scenarios.test.mjs`로 파일을 직접 지정해야 한다. 주석이 stale.
- **테스트는 아티팩트를 실행**: src/main.ts만 고치고 `scripts/build-engine.sh`를 안 돌리면 테스트가 옛 아티팩트에 대해 green이다. src↔artifact 동기화는 커밋 규율에만 의존.
- **A5의 부작용**: 진짜로 죽은 런이 남긴 *미머지* rs/g* 브랜치는 이제 wt-pre가 안 지운다 — 쌓이면 수동 `git branch -D` 필요.
- **lock-dir의 진화**: leaf 0에선 "gd=''로 graceful하니 가드 불필요"로 기록 → `a748020`에서 "LOCKFILE=''는 상호배제 자체의 소멸"로 재평가되어 retry-then-fatal로 격상. 같은 코드에 대한 판단이 런 내에서 뒤집힌 지점.
- **BACKLOG 잔여**: `leafConcurrency 2-3`(opt-in 동시 leaf)과 skills CLI deleted-skills 경고는 여전히 open.

## 4. Verify by hand (purposeGap 전수 — 픽스처가 못 닫는 것들)

전제: 모든 leaf의 공통 purposeGap = "검증이 전부 in-process 픽스처(가짜 dispatcher)였다". 결정적 넷부터:

1. **(지금, 1분) 결정적 회귀 넷 재확인**:
   `cd /home/dh/work/skills/skills/slice && ./scripts/build-engine.sh && node --test test/scenarios.test.mjs`
   → 기대: artifact 재빌드 성공 + **28 pass / 0 fail** (HEAD에서 28/28 green 확인함). adapter smoke: `node adapters/opencode/host-smoke.mjs ./recursive-slice.js` → "SMOKE OK" 2줄.
2. **(leaf 0+1 gap) 실제 haiku sh-proxy 죽음 → FATAL abort**: scratch repo에서 라이브 /slice 1회 실행, sh-proxy가 죽는 실패 런이 생기면 런 로그에서 `grep -n "FATAL: shell-proxy"` 확인 + 대상 repo에서 `git status --porcelain`이 깨끗한지(abort가 트리 변형 *전*인지) 확인. 인위 유발이 어려우므로 다음 자연 실패 시 관찰 항목으로.
3. **(leaf 2 gap) 실제 쿼터 halt 후 lock-clear**: 쿼터 한도 직전에 /slice 실행 → halt 후 `ls "$(git -C <repo> rev-parse --absolute-git-dir)/rs-lock"` → **파일이 없어야** 함(shForce가 진짜 rm을 실행했는지). 이어서 `resumeFromRunId`로 재실행이 lock에 안 막히는지. 남아 있으면 buried body의 "shForce도 죽는다" 케이스 — 수동 `rm -f` 후 메모.
4. **(leaf 1 gap) 라이브 leaf 게이트의 vacuous 여부**: 다음 라이브 /slice 런 로그에서 baseline의 `filterCommand` 값을 확인 — `--test-name-pattern <파일명>` 형태면 게이트가 vacuous(0 tests run). 엔진 측 치환은 픽스처로 핀됨(scenarios.test.mjs L200)이지만 **라이브 baseliner의 템플릿 산출**은 미검증.
5. **(GROUP E gap) 실제 node 모노레포 병렬 런**: `parallel: true`로 /slice 실행 → 로그에 worktree당 `wt-setup:N` 정확히 1회, leaf가 missing-deps RED 없이 시작하는지.
6. **(상호배제 실물 확인) 동일 트리 동시 2런**: 같은 working tree에서 /slice 둘 실행 → 두 번째가 "working tree locked by another recursive-slice run"으로 즉시 abort해야 함. 픽스처는 cat/echo를 가짜로만 봤다.