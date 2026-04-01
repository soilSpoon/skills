---
name: apply-wishket
description: 위시켓(Wishket) 프로젝트에 맞춤형 지원서를 생성한다. 프로젝트 URL/ID를 분석하고, master.yaml 경험과 매칭하여, 금액/기간을 산정하고, 지원서를 작성한 뒤, fact-check까지 수행. 단건 또는 다건 병렬 처리. 트리거: "위시켓 지원", "이 프로젝트 지원해줘", "wishket apply", "외주 프로젝트 지원서 써줘", 위시켓 프로젝트 URL(wishket.com/project/) 입력, "153999 지원", 또는 위시켓 프로젝트 ID와 함께 지원서/제안서 작성 요청.
---

# Apply Wishket

위시켓 프로젝트에 맞춤형 지원서를 생성한다.

지원서의 목표는 기술력 과시가 아니다. 클라이언트가 "이 사람은 우리 프로젝트의 어려운 점을 이미 겪어봤고, 체계적으로 진행할 수 있겠다"라고 느끼게 하는 것이다. 위시켓 상위 파트너(5.0 평점) 분석에서 반복 확인된 성공 패턴: 적극성, 사전 준비성, 능동적 제안, 빠른 문제해결.

## Input

사용자가 다음 중 하나를 제공한다:

1. **프로젝트 URL**: `https://www.wishket.com/project/153999/`
2. **프로젝트 ID**: `153999`
3. **ID 목록**: `153999, 154006, 153297` 또는 파일 경로
4. **"전체"**: 프로젝트 목록 파일에서 미지원 건 전체

URL에서 ID 추출: `/project/(\d+)/` 패턴 매칭.

**Example:**
```
Input:  "위시켓 153999 지원서 써줘"
Output: benchmark/wishket/proposals/153999.md (지원서 + 작성 근거)
```

```
Input:  "154006, 153636 두 개 동시에 지원서 만들어줘"
Output: proposals/154006.md + proposals/153636.md (경험 다양화 + 크로스 검증)
```

## Bundled Resources

`<skill-dir>/` = 이 SKILL.md가 있는 디렉토리.

| 파일 | 용도 | 읽는 시점 |
|------|------|----------|
| `references/experience-pool.md` | 경험 코드 테이블, 매칭 규칙, 익명화 규칙, 포트폴리오 매핑 | Phase 2 |
| `references/proposal-rules.md` | 지원서 템플릿, DO/DON'T, 금액 산정 7단계 | Phase 3~4 |
| `references/estimation-guide.md` | 공수 추정: 기능 분해 → 복잡도 → 생산성 계수 → 상식 체크 | Phase 3 |
| `agents/proposal-writer.md` | 생성 에이전트 프롬프트 | 다건 Wave 1 |
| `agents/verifier.md` | 수치/경험 fact-check 에이전트 | Wave 2 |
| `agents/estimator.md` | 공수 독립 검증 에이전트 | Wave 2 |
| `scripts/verify-proposal.sh` | 구조 검사 12항목 자동화 스크립트 | Phase 6 |
| `scripts/wishket.mjs` | HTTP-first Wishket CLI — list/detail/boost/evaluation/analyze/submit | Phase 1, 8 |

프로젝트 루트: `cv/master.yaml` (경험 원천 데이터)

---

## Workflow

### Phase 1: 프로젝트 분석 + 시장 조사

프로젝트를 이해해야 맞춤 지원서를 쓸 수 있다. 기술 스택만 보지 말고, 클라이언트가 이 프로젝트로 풀려는 비즈니스 문제가 무엇인지 파악하라.

**1-1.** 프로젝트 페이지에서 추출할 정보:
- 프로젝트 상세 설명 전문
- 요구 기술 스택, 업무 범위 (개발/디자인/기획)
- 클라이언트 질문 (있으면)
- 예산, 기간, 모집 마감일, 지원자 수
- **클라이언트 우선순위**: [1순위] 산출물 완성도 / 일정 준수 / 금액 등

**파싱 도구: `scripts/wishket.mjs`** (Playwright 없는 HTTP-first CLI):
```bash
node <skill-dir>/scripts/wishket.mjs list --sort closing    # 마감 임박 순 목록
node <skill-dir>/scripts/wishket.mjs analyze 154095         # detail+boost+evaluation 종합 분석
node <skill-dir>/scripts/wishket.mjs list                   # 모집 중 프로젝트 목록
node <skill-dir>/scripts/wishket.mjs detail 154095 154137   # 프로젝트 상세
node <skill-dir>/scripts/wishket.mjs boost 154095           # 로그인 apply 페이지 힌트 / data-bot
node <skill-dir>/scripts/wishket.mjs evaluation 154095      # 클라이언트 평가 요약 / 리뷰 카드
```
`boost`는 브라우저 프로필을 열지 않는다. `WISHKET_COOKIE_HEADER` 또는 `~/.wishket-cookie-header`에서 쿠키 헤더를 읽어 로그인 apply 페이지를 가져오고, 지원 힌트(data-bot)를 파싱한다.

기본 우선순위는 `list --sort closing`이다. 마감 임박 순으로 보고, **명백히 못하는 일만 제외한 뒤** `analyze`로 내려가라.

**1-2. 클라이언트 과거 채택 패턴 분석** — `node <skill-dir>/scripts/wishket.mjs analyze {ID}`를 기본으로 사용한다. 필요 시 `evaluation` 단독으로 확인:
- 이 클라이언트가 과거에 채택한 파트너들의 **레벨** (시니어/미드/주니어)
- **계약 금액과 기간** (일당 환산)
- **프로젝트 유형** (프론트엔드/백엔드/풀스택)
- **평가 키워드** (클라이언트가 중시하는 가치)

`analyze` 결과의 `analyze`와 `evaluation.summary`를 바로 의사결정에 사용한다:
- `avgDayRate`, `medianDayRate`, `minDayRate`, `maxDayRate`: 과거 계약 일당 범위
- `topKeywords`: 반복 평가 키워드
- `toneHints`: 지원서에 반영할 톤 제안

이 데이터로 지원서 톤과 금액을 보정한다:
- `medianDayRate`가 낮으면 → 공격적인 고단가 제안 피하기
- `topKeywords`에 "적극성", "소통", "사전 준비"가 반복되면 → 해당 계획을 본문에 명시
- `toneHints`는 지원서 본문 마지막 2~3문단의 어조를 고르는 기본 가이드로 사용

**1-3.** Feasibility 스코어링 — 모든 프로젝트에 지원하면 안 된다. 이 점수로 지원 여부와 금액 전략을 결정한다:

| 기준 | 가중치 | 1점 | 3점 | 5점 |
|------|--------|-----|-----|-----|
| 기술 매칭도 | 30% | 경험 없음 | 유사 기술 | 동일 스택 실무 |
| 도메인 유사성 | 25% | 새 도메인 | 유사 패턴 | 동일 도메인 |
| 규모 대비 기간 | 20% | 불가 | 타이트 | 충분 |
| 경쟁 수준 | 15% | 50명+ | 20~50명 | 20명 미만 |
| 클라이언트 신뢰도 | 10% | 첫 프로젝트 | 1~2건 | 다수+높은 평가 |

비공개 지원자 수는 3점. 종합 2.0 미만이면 사용자에게 스킵을 권하라.

### Phase 2: 경험 매칭

`references/experience-pool.md`를 읽어 경험 코드 테이블과 익명화 규칙을 로드하라. `cv/master.yaml`에서 실제 수치와 스토리를 확인하라.

경험 선택의 핵심: 기술 키워드 일치가 아니라, **프로젝트의 예상 이슈와 직접 연결되는 "이슈→해결" 스토리**를 고르는 것이다. 클라이언트는 "이 문제를 겪어봤고 해결했구나"에 반응한다.

**프로젝트 업무 유형과 경험의 관련성 필수** — 경험이 프로젝트의 실제 작업과 직결되어야 한다:
- 퍼블리싱 프로젝트 → 컴포넌트 설계, 디자인 토큰, Figma→코드 경험 (O) / MES 실시간 데이터 처리 (X)
- SaaS 백엔드 → API 설계, 권한 체계, DB 설계 경험 (O) / 프론트엔드 애니메이션 (X)
- 관련 없는 경험은 아무리 인상적이어도 클라이언트에게 "이 사람은 우리 일을 이해 못 한다"는 인상을 줌

**Example:**
```
프로젝트: AI 채팅 플랫폼 고도화 (코드 인수인계 + 안정화)
→ 경험 1: SIM — AI 챗봇 구축 경험 (직접 매칭)
→ 경험 2: HR — jQuery 레거시 인수받아 React 전환 (코드 인수인계 매칭)
(SIM+SIM이 아니라 SIM+HR로 다른 측면을 커버)

프로젝트: B2B SaaS 어드민 퍼블리싱
→ 경험 1: HR — 53개 공통 컴포넌트 디자인 시스템 (어드민 UI 직결)
→ 경험 2: HR — Figma→코드 변환 워크플로우 (퍼블리싱 직결)
→ (X) MES 실시간 데이터 처리 — 퍼블리싱과 무관
```

### Phase 3: 공수 추정 + 금액/기간 산정

이 단계가 지원서의 설득력을 좌우한다. "예산 동일"로 끝내면 아마추어고, 스코프를 분석하고 근거를 남기면 전문가다.

**3-1. 공수 추정** — `references/estimation-guide.md`를 읽고 5단계 수행:
1. 기능 분해 (명시적 + 암묵적 — 클라이언트가 안 썼지만 필요한 기능도)
2. 기능별 복잡도 (S/M/L/XL + 체크리스트)
3. 생산성 계수 (기술 매칭도 ×1.0~2.0)
4. 총 공수 (합계 + QA 20%)
5. 상식 체크

반드시 **기능별 테이블**로 근거를 남겨라. "대략 50인일"은 안 된다.

**3-2. 금액/기간** — `references/proposal-rules.md`의 7단계:
스코프 → 공수 → 강도(빡빡한 정도) → 예산 현실성 → 제안 → 이탈도 → 벤치마크

빡빡한 일정이면 일당이 올라가야 한다 — 하루에 더 많은 시간을 쓰기 때문이다. 강도 1.0+는 야근/주말이므로 프리미엄을 부과하라.

### Phase 4: 지원서 작성

`references/proposal-rules.md`의 4단 템플릿과 DO/DON'T를 따르라.

위시켓 상위 파트너 평가에서 반복되는 키워드를 지원서에 구조적으로 반영하라:
- "적극성" → 진행 프로세스에 "주 N회 공유" 명시
- "사전 준비성" → 프로젝트 분석에 이슈를 미리 정리
- "능동적 제안" → 미팅 논의에 클라이언트가 놓칠 수 있는 포인트 1개
- "수정 끝까지" → QA/수정 단계 포함

### Phase 5: 포트폴리오 선택

`references/experience-pool.md`의 매핑 테이블에서 2-3개를 선택하라. 1개만 첨부하면 매칭률 60% 하락한다.

### Phase 6: 검증 (5단계)

`references/verification-guide.md`를 읽고 5단계 전체를 수행하라. 검증을 건너뛰면 수치 오류, 경험 편중, 어색한 문장이 그대로 제출된다.

### Phase 7: 사용자 리뷰

검증 통과한 지원서를 요약 테이블로 보여줘라:

```
| # | 프로젝트 | 금액 | 기간 | 일당 | 강도 | 포트폴리오 | 구조 | Fact | 공수 | 배분 | 품질 |
|---|---------|------|------|------|------|-----------|------|------|------|------|------|
| 1 | Next.js 어드민 | 500만 | 13일 | 38.5만 | 1.3 | 2개 | 12/12 | PASS | OK | OK | GO |
```

FIX/REWRITE 판정된 건은 수정 사항을 구체적으로 제시.

### Phase 8: 웹 폼 제출

`scripts/wishket.mjs submit`은 Playwright 없이 **직접 HTTP POST** 로 제출 payload를 만든다. 기본은 preview 모드이고, `--confirm`이 있을 때만 실제 전송한다:

```bash
node <skill-dir>/scripts/wishket.mjs submit proposals.json
node <skill-dir>/scripts/wishket.mjs submit proposals.json --confirm
node <skill-dir>/scripts/wishket.mjs submit benchmark/wishket/proposals/154095.md
node <skill-dir>/scripts/wishket.mjs submit benchmark/wishket/proposals/153634.md benchmark/wishket/proposals/154048.md
```

`proposals.json` 형식: `[{ "id": "154095", "amount": "5000000", "term": "30", "body": "...", "portfolios": ["제목1", "제목2"], "desc": "포트폴리오 설명" }]`

단건은 proposal markdown도 직접 입력할 수 있다. 이 경우 스크립트가 다음 메타데이터를 읽는다:
- `**프로젝트 ID:**`
- `**지원 금액:**`
- `**지원 기간:**`
- `**첨부 포트폴리오:**`
- `## 지원서 본문`
- 선택: `## 관련 포트폴리오 설명`

쿠키 공급:
- `WISHKET_COOKIE_HEADER="csrftoken=...; wsessionid=..."`
- 또는 `~/.wishket-cookie-header`

동작 방식:
- apply 페이지를 먼저 fetch
- CSRF 토큰과 포트폴리오 목록을 HTML에서 파싱
- 제목 또는 포트폴리오 ID 기준으로 포트폴리오를 최대 3개까지 매칭
- preview 모드에서 실제 전송 전 payload를 JSON으로 출력
- preview에 `minimums`, `checks`, `warnings`를 포함하여 본문 길이/포트폴리오 수/관련 설명 길이 경고를 표시
- `--confirm` 모드에서 같은 apply URL로 POST

주의:
- 기본값은 **전송하지 않는 preview**
- 실제 submit 성공 케이스가 있으므로 현재 경로를 기본 제출 경로로 사용해도 된다. 다만 실수 방지를 위해 **항상 단건 preview → 확인 후 `--confirm`** 순서를 유지하라.

---

## 에이전트 아키텍처

2건 이상이면 `references/multi-proposal-arch.md`를 읽고 Wave 0-3 파이프라인을 수행하라. 단건은 Phase 1~7을 메인 세션에서 직접 수행.


Wave 0~1을 건너뛰고 메인 세션에서 Phase 1~7을 직접 수행. Phase 6도 5단계 모두 수행 (에이전트 대신 직접).

---

## 출력

결과 파일: `benchmark/wishket/proposals/{ID}.md` (경로는 사용자 지정 가능)

파일 구조는 `agents/proposal-writer.md`의 출력 형식 참조.

---

## 운영 주의사항

- **쿠키 만료**: `WISHKET_COOKIE_HEADER`는 주기적으로 만료된다. boost/evaluation 호출이 `NOT_LOGGED_IN`을 반환하면 쿠키를 갱신하라. detail은 로그인 없이도 동작한다.
- **배치 rate-limit**: 10건 이상 동시 처리 시 wishket.mjs 호출 간 1초 간격을 두라. 동일 IP에서 빠른 연속 요청은 차단될 수 있다.

## File Structure

```
apply-wishket/
├── SKILL.md                        # 워크플로우 + 에이전트 아키텍처
├── references/
│   ├── experience-pool.md          # 경험 코드, 매칭 규칙, 익명화, 포트폴리오
│   ├── proposal-rules.md           # 템플릿, DO/DON'T, 금액 7단계, 성공 패턴
│   ├── estimation-guide.md         # 공수: 기능 분해 → 복잡도 → 생산성 → 상식 체크
│   ├── verification-guide.md       # Phase 6 검증 5단계 상세
│   └── multi-proposal-arch.md      # Wave 0-3 다건 병렬 처리 아키텍처
├── agents/
│   ├── proposal-writer.md          # 생성 에이전트 (Phase 1~5)
│   ├── verifier.md                 # 수치/경험 fact-check
│   └── estimator.md                # 공수 독립 검증
└── scripts/
    ├── verify-proposal.sh          # 구조 검사 12항목 자동화
    └── wishket.mjs                 # HTTP-first CLI (list/detail/boost/evaluation/analyze/submit)
```
