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
| `docs/experience-pool.md` | 경험 코드 테이블, 매칭 규칙, 익명화 규칙, 포트폴리오 매핑 | Phase 2 |
| `docs/proposal-rules.md` | 지원서 템플릿, DO/DON'T, 금액 산정 7단계 | Phase 3~4 |
| `docs/estimation-guide.md` | 공수 추정: 기능 분해 → 복잡도 → 생산성 계수 → 상식 체크 | Phase 3 |
| `agents/proposal-writer.md` | 생성 에이전트 프롬프트 | 다건 Wave 1 |
| `agents/verifier.md` | 수치/경험 fact-check 에이전트 | Wave 2 |
| `agents/estimator.md` | 공수 독립 검증 에이전트 | Wave 2 |
| `scripts/verify-proposal.sh` | 구조 검사 12항목 자동화 스크립트 | Phase 6 |

프로젝트 루트: `cv/master.yaml` (경험 원천 데이터)

---

## Workflow

### Phase 1: 프로젝트 분석

프로젝트를 이해해야 맞춤 지원서를 쓸 수 있다. 기술 스택만 보지 말고, 클라이언트가 이 프로젝트로 풀려는 비즈니스 문제가 무엇인지 파악하라.

**1-1.** WebFetch로 `https://www.wishket.com/project/{ID}/`를 가져와 추출:
- 프로젝트 상세 설명 전문
- 요구 기술 스택, 업무 범위 (개발/디자인/기획)
- 클라이언트 질문 (있으면)
- 예산, 기간, 모집 마감일, 지원자 수

**1-2.** Feasibility 스코어링 — 모든 프로젝트에 지원하면 안 된다. 이 점수로 지원 여부와 금액 전략을 결정한다:

| 기준 | 가중치 | 1점 | 3점 | 5점 |
|------|--------|-----|-----|-----|
| 기술 매칭도 | 30% | 경험 없음 | 유사 기술 | 동일 스택 실무 |
| 도메인 유사성 | 25% | 새 도메인 | 유사 패턴 | 동일 도메인 |
| 규모 대비 기간 | 20% | 불가 | 타이트 | 충분 |
| 경쟁 수준 | 15% | 50명+ | 20~50명 | 20명 미만 |
| 클라이언트 신뢰도 | 10% | 첫 프로젝트 | 1~2건 | 다수+높은 평가 |

비공개 지원자 수는 3점. 종합 2.0 미만이면 사용자에게 스킵을 권하라.

### Phase 2: 경험 매칭

`docs/experience-pool.md`를 읽어 경험 코드 테이블과 익명화 규칙을 로드하라. `cv/master.yaml`에서 실제 수치와 스토리를 확인하라.

경험 선택의 핵심: 기술 키워드 일치가 아니라, **프로젝트의 예상 이슈와 직접 연결되는 "이슈→해결" 스토리**를 고르는 것이다. 클라이언트는 "이 문제를 겪어봤고 해결했구나"에 반응한다.

**Example:**
```
프로젝트: AI 채팅 플랫폼 고도화 (코드 인수인계 + 안정화)
→ 경험 1: SIM — AI 챗봇 구축 경험 (직접 매칭)
→ 경험 2: HR — jQuery 레거시 인수받아 React 전환 (코드 인수인계 매칭)
(SIM+SIM이 아니라 SIM+HR로 다른 측면을 커버)
```

### Phase 3: 공수 추정 + 금액/기간 산정

이 단계가 지원서의 설득력을 좌우한다. "예산 동일"로 끝내면 아마추어고, 스코프를 분석하고 근거를 남기면 전문가다.

**3-1. 공수 추정** — `docs/estimation-guide.md`를 읽고 5단계 수행:
1. 기능 분해 (명시적 + 암묵적 — 클라이언트가 안 썼지만 필요한 기능도)
2. 기능별 복잡도 (S/M/L/XL + 체크리스트)
3. 생산성 계수 (기술 매칭도 ×1.0~2.0)
4. 총 공수 (합계 + QA 20%)
5. 상식 체크

반드시 **기능별 테이블**로 근거를 남겨라. "대략 50인일"은 안 된다.

**3-2. 금액/기간** — `docs/proposal-rules.md`의 7단계:
스코프 → 공수 → 강도(빡빡한 정도) → 예산 현실성 → 제안 → 이탈도 → 벤치마크

빡빡한 일정이면 일당이 올라가야 한다 — 하루에 더 많은 시간을 쓰기 때문이다. 강도 1.0+는 야근/주말이므로 프리미엄을 부과하라.

### Phase 4: 지원서 작성

`docs/proposal-rules.md`의 4단 템플릿과 DO/DON'T를 따르라.

위시켓 상위 파트너 평가에서 반복되는 키워드를 지원서에 구조적으로 반영하라:
- "적극성" → 진행 프로세스에 "주 N회 공유" 명시
- "사전 준비성" → 프로젝트 분석에 이슈를 미리 정리
- "능동적 제안" → 미팅 논의에 클라이언트가 놓칠 수 있는 포인트 1개
- "수정 끝까지" → QA/수정 단계 포함

### Phase 5: 포트폴리오 선택

`docs/experience-pool.md`의 매핑 테이블에서 2-3개를 선택하라. 1개만 첨부하면 매칭률 60% 하락한다.

### Phase 6: 검증 (5단계)

검증을 건너뛰면 수치가 틀리거나, 경험 배분이 무시되거나, 어색한 문장이 그대로 제출된다. 5단계 모두 수행하라.

**6-1. 구조 검사** — 번들된 스크립트로 12항목 자동 검사:
```bash
for f in proposals/*.md; do
  bash <skill-dir>/scripts/verify-proposal.sh "$f"
done
```
FAIL 항목이 있으면 해당 파일을 수정하고 재실행.

**6-2. Fact-Check** — `agents/verifier.md`를 읽고 검증 에이전트를 실행하라.
수치/경험이 master.yaml과 일치하는지 대조. 에이전트 실패 시(토큰 만료 등) **메인 세션에서 직접 수행**:
```bash
# master.yaml의 핵심 수치를 grep으로 확인
grep -o '963개\|124개국\|50% 단축\|53개 공통\|6개 모듈\|5단계' cv/master.yaml
# 각 지원서 본문에서 수치 추출하여 대조
for f in proposals/*.md; do
  sed -n '/## 지원서 본문/,/^---$/p' "$f" | grep -o '[0-9]*[개건명%]'
done
```

**6-3. 공수 독립 검증** — `agents/estimator.md`를 읽고 에이전트 실행. 에이전트 실패 시 메인 세션에서 직접:
- 각 지원서의 "공수 추정" 테이블을 읽고
- 기능 수 × 복잡도가 상식적인지 확인 (소규모 10~25인일, 중규모 25~60, 대규모 60~120)
- 강도 계산이 맞는지 (공수 ÷ 가용일)
- 강도 대비 금액 전략이 일관적인지

**6-4. 경험 배분 검증** (다건 시) — Wave 0에서 배정한 경험 코드를 에이전트가 실제로 따랐는지 확인:
```bash
# 각 지원서에서 실제 사용된 경험 코드 추출
for f in proposals/*.md; do
  echo "$(basename $f):"
  grep '경험 [12]:' "$f" | head -2
done
```
Wave 0 배분표와 대조. 불일치 시 해당 지원서의 경험 섹션을 수정.

**6-5. 본문 품질 리뷰** — 각 지원서 본문을 **직접 읽고** 아래 관점에서 확인. 자동화할 수 없는 부분이므로 반드시 사람의 눈(또는 메인 세션)이 확인해야 한다:

| 관점 | 확인 사항 |
|------|----------|
| 클라이언트 관점 | 이 지원서를 읽고 미팅을 잡고 싶은가? |
| 프로젝트 이해도 | 분석이 프로젝트 설명을 복붙한 수준인가, 실제 이슈를 파악했는가? |
| 경험 연결 | "이슈→해결" 스토리가 이 프로젝트의 이슈와 자연스럽게 연결되는가? |
| 톤 | 기술 용어 과잉이 아닌가? 비즈니스 문제 중심인가? |
| 금액 설득력 | 금액/기간 제안에 근거가 지원서 내에서 느껴지는가? |
| 어색한 문장 | 반복 표현, 부자연스러운 문장, 맞춤법 오류 |
| 차별화 | 다른 지원자와 뭐가 다른지 느껴지는가? |

각 지원서에 대해 한 줄 판정:
- **GO**: 바로 제출 가능
- **FIX**: 특정 부분 수정 후 제출 (수정 사항 명시)
- **REWRITE**: 재작성 필요 (사유 명시)

### Phase 7: 사용자 리뷰

검증 통과한 지원서를 요약 테이블로 보여줘라:

```
| # | 프로젝트 | 금액 | 기간 | 일당 | 강도 | 포트폴리오 | 구조 | Fact | 공수 | 배분 | 품질 |
|---|---------|------|------|------|------|-----------|------|------|------|------|------|
| 1 | Next.js 어드민 | 500만 | 13일 | 38.5만 | 1.3 | 2개 | 12/12 | PASS | OK | OK | GO |
```

FIX/REWRITE 판정된 건은 수정 사항을 구체적으로 제시.

### Phase 8: 웹 폼 입력 (선택)

사용자가 웹에서 직접 제출을 요청하면 Playwright로 위시켓 지원 폼에 입력한다. 제출 버튼은 사용자가 확인 후 직접 클릭한다.

**브라우저는 입력 후 닫지 않는다** — 사용자가 확인할 수 있도록 열어둔다. `await new Promise(r => setTimeout(r, 86400000))` 등으로 충분한 시간 대기.

**폼 입력 절차:**

```javascript
// 1. 지원 페이지로 이동
await page.goto('https://www.wishket.com/project/{ID}/proposal/apply/');

// 2. 금액 입력 — 쉼표 없이 숫자만, 입력 후 Tab으로 focus out
await page.fill('input[name="budget"]', '5000000');  // 쉼표 금지!
await page.press('input[name="budget"]', 'Tab');      // focus out → 예상 수령 금액 계산

// 3. 기간 입력 — 마찬가지로 focus out
await page.fill('input[name="term"]', '15');
await page.press('input[name="term"]', 'Tab');

// 4. 지원 내용 입력
await page.fill('textarea[name="body"]', proposalBody);

// 5. 스크롤 + 포트폴리오 라디오 (hidden input → label 클릭)
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.evaluate(() => document.querySelector('label[for="has_related_portfolio"]')?.click());

// 6. 포트폴리오 선택 모달 열기 (JS 클릭)
await page.evaluate(() => document.querySelector('.btn-select-related-portfolio')?.click());

// 7. 포트폴리오 위치 확인 후 클릭 — 반드시 title로 매칭
const boxes = await page.evaluate(() => {
  return [...document.querySelectorAll('.portfolio-box')].map(box => ({
    title: box.querySelector('.portfolio-title-box')?.innerText,
    x: Math.round(box.getBoundingClientRect().x + box.getBoundingClientRect().width/2),
    y: Math.round(box.getBoundingClientRect().y + box.getBoundingClientRect().height/2)
  }));
});
// title로 찾아서 클릭 (좌표 추측 금지)

// 8. 선택 확인 스크린샷 → "선택 완료" 클릭

// 9. 포트폴리오 설명 입력
await page.fill('textarea[name="related_description"]', portfolioDesc);

// 10. 최종 스크린샷으로 전체 확인 — 제출 버튼 클릭 안 함
```

**핵심 규칙:**
- 금액에 쉼표(,) 넣지 않는다
- 금액/기간 입력 후 반드시 Tab 또는 클릭으로 focus out (예상 수령 금액 계산 트리거)
- 포트폴리오 설명(related_description) 반드시 입력
- 매 단계 스크린샷 찍고 확인 — 추측하지 말고 눈으로 확인
- 포트폴리오 선택은 title로 매칭 후 좌표 클릭 (index 추측 금지)
- **브라우저를 닫지 않는다** — 사용자가 확인 후 직접 제출

---

## 에이전트 아키텍처 (다건 처리)

2건 이상이면 병렬 에이전트를 활용한다.

### Wave 0: 경험 배분 계획 (메인 세션)

N개 에이전트가 독립 실행하면 범용성 높은 경험(HR, SIM)만 반복 선택된다. 테스트에서 확인: 3회 iteration 모두 배치 2건이 HR+SIM 동일 조합이었다. 이를 방지하기 위해 메인 세션이 사전에 경험을 배분한다.

1. N개 프로젝트를 병렬 WebFetch로 요구사항 파악
2. `docs/experience-pool.md`의 6개 경험 코드 로드
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

공유 파일(master.yaml, docs/*.md)은 읽기 전용이므로 동시 접근 안전.

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

Wave 0~1을 건너뛰고 메인 세션에서 Phase 1~7을 직접 수행. Phase 6도 5단계 모두 수행 (에이전트 대신 직접).

---

## 출력

결과 파일: `benchmark/wishket/proposals/{ID}.md` (경로는 사용자 지정 가능)

파일 구조는 `agents/proposal-writer.md`의 출력 형식 참조.

---

## File Structure

```
apply-wishket/
├── SKILL.md                # 워크플로우 + 에이전트 아키텍처
├── docs/
│   ├── experience-pool.md  # 경험 코드, 매칭 규칙, 익명화, 포트폴리오
│   ├── proposal-rules.md   # 템플릿, DO/DON'T, 금액 7단계, 성공 패턴
│   └── estimation-guide.md # 공수: 기능 분해 → 복잡도 → 생산성 → 상식 체크
├── agents/
│   ├── proposal-writer.md  # 생성 에이전트 (Phase 1~5)
│   ├── verifier.md         # 수치/경험 fact-check
│   └── estimator.md        # 공수 독립 검증
└── scripts/
    └── verify-proposal.sh  # 구조 검사 12항목 자동화
```
