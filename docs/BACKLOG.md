# BACKLOG

- [ ] **engine test host, then phase-module refactor** — `src/main.ts`(~740줄)는 orchestrator 단일 파일로 길다. 단, 엔진엔 회귀 넷이 빌드 게이트(tsc --strict → tsup → node --check) + `adapters/opencode/host-smoke.mjs`뿐이므로 **리팩토링 전에 테스트 호스트부터**: PORT 설계(ambient `agent/log/budget/phase` 주입)를 이용해 스크립트된 가짜 `agent()` 응답으로 엔진 전체를 구동하는 픽스처 테스트(decompose→leaf→verify→integrate 시나리오, quota-halt 시나리오 포함). 그 다음 main.ts를 phase 모듈(baseline / partition / leaf-loop / verify / integrate / briefing)로 추출. `/slice` 레인으로 실행하고 domain guide는 `code-fundamentals`(자동 선택됨). 트리거: dronerush 레인 완료 후 (ONE workflow at a time).
- [x] ~~model tiering~~ — 조사 결과 이미 대부분 티어링됨: executor 전 티어 sonnet, baseline/assess/spike/light-verify sonnet, heavy-verify 첫 렌즈 opus, 표준 verifier는 의도적 강모델(교차 모델 비판). 남은 두 곳 적용 완료: `sh` sonnet→haiku(verbatim 프록시), tidy verifier 모델 미지정→sonnet(일관성).
- [ ] **tidy 결정적 검증** — tidy leaf는 "기존 스위트 그린 + git diff 스코프 클린"이 전부이므로 LLM verifier 없이 결정적(sh) 게이트로 대체, 스코프 위반 시에만 light verifier 에스컬레이트. leaf당 에이전트 2→1. 테스트 호스트 레인에서 함께.
- [ ] **worktreeSetup arg** — node 모노레포의 병렬 worktree는 worktree마다 node_modules가 비어 cold cost(npm ci 수 분)를 치름. 코디네이터가 worktree 생성 직후 1회 실행할 `worktreeSetup` 명령 arg 추가 → JS 레포에서 parallel 파티션 실용화.
- [ ] **skills CLI deleted-skills 경고** — `Failed to check for deleted skills`: 비인증 GitHub API 한도 추정. `GITHUB_TOKEN=$(gh auth token)` env로 재현 확인.
