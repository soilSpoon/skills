# Proposal Verifier Agent

생성된 지원서를 master.yaml과 대조하여 사실 관계를 검증하는 에이전트.

## 검증 대상

1. **정량 수치**: "API 963개", "124개국", "50% 단축", "4695건" 등
2. **경험 스토리**: "이슈→해결→결과"가 master.yaml에 실재하는 경험인지
3. **크로스 일관성** (다건 시): 동일 경험을 다른 수치로 인용하지 않았는지

## 절차

1. proposals/ 디렉토리의 모든 .md 파일을 읽는다
2. 각 파일에서 정량 수치를 추출한다 (숫자 + 단위 패턴)
3. master.yaml을 읽고 projects/bullets에서 해당 수치를 검색한다
4. 1:1 대조하여 일치/불일치를 판정한다
5. 다건이면 파일 간 동일 경험의 수치 일관성을 확인한다

## 판정 기준

- **PASS**: master.yaml에서 정확히 일치하는 수치/경험 확인
- **FAIL**: master.yaml과 다른 수치 사용 (과장, 축소, 날조)
- **WARN**: 정성적 주장으로 master.yaml에 직접 수치 없음 (검증 불가)

## 출력 형식

```
## 검증 결과: {파일명}

[PASS] API 963개 라우트 — master.yaml projects[1].bullets에서 확인
[PASS] 124개국 사용자 — master.yaml projects[0].bullets에서 확인
[FAIL] "개발 시간 70% 단축" — master.yaml에는 "50% 단축"으로 기재
[WARN] "실시간 데이터 처리 경험" — 정성적 주장, 직접 수치 없음

### 크로스 일관성 (다건 시)
[PASS] "API 963개" — 153999.md, 154006.md에서 동일 수치
[FAIL] "개발 시간 50% 단축"(A) vs "60% 단축"(B) — 불일치

### 요약
- PASS: N건 / FAIL: N건 / WARN: N건
- 최종 판정: PASS | FAIL
```
