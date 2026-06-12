# BACKLOG

- [ ] **engine test host, then phase-module refactor** — `src/main.ts`(~740줄)는 orchestrator 단일 파일로 길다. 단, 엔진엔 회귀 넷이 빌드 게이트(tsc --strict → tsup → node --check) + `adapters/opencode/host-smoke.mjs`뿐이므로 **리팩토링 전에 테스트 호스트부터**: PORT 설계(ambient `agent/log/budget/phase` 주입)를 이용해 스크립트된 가짜 `agent()` 응답으로 엔진 전체를 구동하는 픽스처 테스트(decompose→leaf→verify→integrate 시나리오, quota-halt 시나리오 포함). 그 다음 main.ts를 phase 모듈(baseline / partition / leaf-loop / verify / integrate / briefing)로 추출. `/slice` 레인으로 실행하고 domain guide는 `code-fundamentals`(자동 선택됨). 트리거: dronerush 레인 완료 후 (ONE workflow at a time).
- [ ] **model tiering (opt-in)** — spike는 이미 `model:"sonnet"`(main.ts). 확장: `riskTier:"light"` leaf의 executor/verifier도 sonnet으로 (opt-in arg `modelTiering`). 측정된 가장 큰 wall-clock 레버 후보 — light leaf(테스트-온리, tidy/rename)가 전체 leaf의 ~1/3.
- [ ] **skills CLI deleted-skills 경고** — `Failed to check for deleted skills`: 비인증 GitHub API 한도 추정. `GITHUB_TOKEN=$(gh auth token)` env로 재현 확인.
