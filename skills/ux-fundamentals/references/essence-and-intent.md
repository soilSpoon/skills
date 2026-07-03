# 연구 뿌리·코퍼스

toss.tech UX 글 수집 + 다축 원칙 추출 + 외부 보강(NN/g, IxDF, Material)에서 온 **범용** SSOT.
제품·화면 이름은 `examples/`에만 둔다.

## 전형적 문제 (일반화)

**유사한 commit surface**가 여러 개일 때 독립 성장하면 갈라진다:

1. 주 행동 위치·형태
2. 입력→결과 인과 표현
3. 피드백 채널·강도
4. 시선·읽기 순서
5. disclosure·이중 진입점·configure/commit 혼선
6. 문구·용어·톤 (surface마다 다른 경고·CTA 패턴)
7. 비시각 상태 전달 부재

## 본질적 접근

1. 개별 최적화 → **시스템 계약** (컴포넌트·토큰·카피·상태 어휘)
2. 드리프트 **측정** 후 수정
3. SSOT surface 복제
4. 축 단위 순차 변경
5. configure / commit 분리
6. 단일 primary 진입점
7. 텍스트 상태 + 시각 보조
8. **이 스킬 하나**로 구조·카피·a11y(UX) 동시 적용

## Top corpus {#top-corpus}

| 글 | 전이 |
|---|---|
| [가이드라인을 시스템으로](https://toss.tech/article/introducing-toss-error-message-system) | 판단 → 시스템 |
| [Effective Component](https://toss.tech/article/27426) | 공용 컴포넌트로 드리프트 봉인 |
| [화려한 UI가 정보전달 방해](https://toss.tech/article/34897) | 위계·인지 부하 |
| [읽는 순서](https://toss.tech/article/voiceover_usability) | 시선·포커스 순서 |
| [Easy to answer](https://toss.tech/article/insurance-claim-process) | 순차·청크·점진 공개 |
| [인터랙션 꼭 넣어야?](https://toss.tech/article/interaction) | 피드백·모션 절제 |
| [안 좋은 경험 만들기](https://toss.tech/article/42221) | 불일치 역설계 |
| [디자인 시스템 다시 생각](https://toss.tech/article/rethinking-design-system) | 다 surface 일관성 |

추가: /21021, /A11y_Fundamentals, /mysterydesignclub1, /27752, /45391, /interaction_simplicity

## 외부로 메운 갭

| 갭 | 보강 |
|---|---|
| Primary CTA 배치 | UX Collective, NN/g |
| loading / empty / success | Material, Webeyez |
| multi-step 일관성 | IxDF, UXPin |
| 입력→결과 방향 단서 | Gestalt, NN/g |
| 고밀도 설정 UI | 청크·단일 흐름·일관 contract |

## 추출 데이터 품질

대량 자동 추출 시 **동일 recommendation 반복** 가능. 에이전트는 `references/*.md` +
`conflict-resolutions.md`를 SSOT로 쓰고, raw bank는 감사·확장용.