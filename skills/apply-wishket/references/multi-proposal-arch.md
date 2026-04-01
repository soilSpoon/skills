# 에이전트 아키텍처 (다건 처리)

## 에이전트 아키텍처 (다건 처리)

2건 이상이면 병렬 에이전트를 활용한다.

### Wave 0: 경험 배분 계획 (메인 세션)

N개 에이전트가 독립 실행하면 범용성 높은 경험(HR, SIM)만 반복 선택된다. 테스트에서 확인: 3회 iteration 모두 배치 2건이 HR+SIM 동일 조합이었다. 이를 방지하기 위해 메인 세션이 사전에 경험을 배분한다.

1. N개 프로젝트를 `node <skill-dir>/scripts/wishket.mjs analyze ...`로 병렬 파싱하여 요구사항 파악
2. `references/experience-pool.md`의 6개 경험 코드 로드
3. 프로젝트별 경험 2-3개를 배정:
   - 1순위: 가장 직접적 매칭 (겹쳐도 OK)
   - 2순위: N건 전체에서 다양하게 분산 (동일 조합 3건+ 반복 금지)

**Example (10건 배분):**
```
| 프로젝트 | 경험 1 | 경험 2 |
|---------|--------|--------|
| SaaS 어드민 | HR | MES |
| AI 채팅 고도화 | SIM | MENU |
| 문제은행 | HR | TOK |
| CPQ 견적 | MES | HR |
| 교육 중개 | SIM | OSS |
| ... |
```

### Wave 1: 생성 — N개 병렬

단일 메시지에 N개 Agent 호출, `run_in_background: true`.

각 에이전트에 전달:
- 프로젝트 ID
- **사전 배정된 경험 코드** (Wave 0 결과)
- skill-dir 경로, master.yaml 경로, 출력 경로
- `agents/proposal-writer.md` 읽고 절차 수행

공유 파일(master.yaml, references/*.md)은 읽기 전용이므로 동시 접근 안전.

### Wave 2: 검증 — Phase 6 전체 수행

Wave 1 완료 후 Phase 6의 5단계를 모두 수행한다.

**2-a. 에이전트 검증 시도** (병렬):
- Verifier (`agents/verifier.md`): 수치 fact-check + 크로스 일관성
- Estimator (`agents/estimator.md`): 공수 독립 검증

각 에이전트에 **파일 목록을 명시적으로 전달**:
```
생성된 파일: ["proposals/153999.md", "proposals/154006.md", ...]
Master YAML: /path/to/master.yaml
```

**2-b. 에이전트 실패 시 fallback** — 토큰 만료, 타임아웃 등으로 에이전트가 실패하면 메인 세션에서 직접 수행. "에이전트가 실패했으니 건너뛴다"는 안 된다. Phase 6-2, 6-3의 fallback 절차를 따르라.

**2-c. 메인 세션 직접 검증** (에이전트 성공 여부와 무관하게 반드시):
1. 구조 검사 스크립트 실행 (6-1)
2. 경험 배분 검증 (6-4) — Wave 0 배분표와 실제 사용 경험 대조
3. 본문 품질 리뷰 (6-5) — 10건 본문을 직접 읽고 GO/FIX/REWRITE 판정

### Wave 3: 수정 (FAIL/FIX 건만)

FAIL/FIX 사유를 구체적으로 명시하여 수정:
- 구조 FAIL: "153807.md: RBAC → 역할별 접근 권한으로 교체"
- Fact FAIL: "153999.md: '70% 단축' → master.yaml에는 '50% 단축'"
- 품질 FIX: "153636.md: 2번째 경험이 프로젝트와 연결이 약함, 코드 인수인계 관점으로 재작성"

수정 후 해당 항목만 재검증.

### 단건 처리
