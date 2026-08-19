# 계수 탐침 — 스타일을 데이터로 읽는다

소스가 있으면 **추측하지 않는다.** 스크린샷 판독은 소스가 없을 때의 폴백이다.
계수 정의는 `visual-audit.md`.

## 스택별 선언 형태

| 스택 | 그림자 | 여백 | 굵기 |
|---|---|---|---|
| CSS/SCSS | `box-shadow:` | `padding:` | `font-weight:` |
| CSS-in-JS(객체) | `boxShadow:` | `padding:` | `fontWeight:` |
| Tailwind | `shadow-*` | `p-* px-* py-*` | `font-bold` `font-semibold` |
| SwiftUI | `.shadow(` | `.padding(` | `.fontWeight(` |
| Flutter | `BoxShadow(` | `EdgeInsets` | `FontWeight.` |

아래는 CSS-in-JS 기준. 다른 스택은 위 표로 패턴만 바꾼다.

## 탐침

```bash
DIR=src/ui   # 감사 범위. 화면 하나면 그 디렉터리로 좁힌다

# C7 강조 예산 — 값별 등장 횟수 (700이 52, 400이 1이면 위계가 없다)
grep -ro "fontWeight: '[0-9]*'" $DIR | sort | uniq -c | sort -rn

# C6 그림자 : 실제 층 — 두 수가 다르면 그 차이가 거짓말이다
grep -rc  "boxShadow" $DIR
grep -rcE "position: '(fixed|absolute)'" $DIR

# C10 값 종류 수 — 36종이면 매번 눈대중한 것이다
grep -ro "padding: '[^']*'" $DIR | sed "s/.*: //" | sort -u | wc -l
grep -ro "borderRadius: '[^']*'" $DIR | sort | uniq -c | sort -rn

# C10 오프그리드 — 4px 배수 밖 여백
grep -roE "(padding|gap|margin)[A-Za-z]*: '[^']*'" $DIR |
  grep -oE "[0-9]+px" | sort | uniq -c |
  awk '{n=$2+0; printf "%s%s\n", $0, (n%4 ? "   <- off-grid" : "")}'

# C11 토큰 채택률 — 팔레트 밖으로 새는 색 (팔레트를 고쳐도 안 따라온다)
# &#10003; 같은 HTML 엔티티가 #10003 으로 잡히므로 앞의 & 를 제외한다
grep -rnoE "(^|[^&[:alnum:]])#[0-9a-fA-F]{3,8}\b|rgba?\(" $DIR

# C1 색 단독 — 종류·상태를 색으로만 나르는 맵
grep -rn "KIND_COLORS\|STATUS_COLORS\|typeColor" $DIR
```

## 스크린샷만 있을 때

1. **왜 열었나** → 그 답이 *아닌* 영역을 칠한다. 30% 초과면 C3
2. **실눈으로 본다** → 색 덩어리가 2개 이상이면 C8
3. **흑백 변환** → 사라지는 구분이 있으면 C1
4. **한 행의 테두리를 센다** → C5
5. **"이 색이 없는 시간이 있나"** → C9

## 굳히기 — 감사를 테스트로

**한 번 세고 끝내면 원위치한다.** 센 것들은 누가 게을러서가 아니라 바쁠 때 하나씩
더해진 결과라, 조건이 같으면 같은 속도로 다시 쌓인다.

- 계수를 **소스 정적 검사**로 옮긴다 — 전용 도구 불필요. 파일 읽고 정규식 + 개수 단언
- 임계를 상한으로 단언한다: `expect(shadows).toBeLessThanOrEqual(1)`
- **삭제한 토큰의 좀비 참조**도 막는다 — 빌드 시스템은 무효 토큰을 조용히 버려서
  화면에서만 티가 난다
- 각 규칙마다 **일부러 위반을 주입해 실제로 잡히는지 확인한다.** 안 하면 통과하는
  테스트가 사실 아무것도 안 보고 있을 수 있다
- 주석·문자열 안의 예시가 오탐을 만든다 — 검사 전에 주석을 제거한다
- **탐침도 오탐을 낸다.** HTML 엔티티(`&#10003;`)가 색으로, 들여쓰기가 다른 같은 줄이
  중복으로 잡힌다. 처음 돌릴 때 결과를 눈으로 한 번 훑고 정규식을 좁힌다 —
  세는 게 목적이지 숫자를 크게 만드는 게 목적이 아니다
- 스타일이 **css() 밖(생 style 문자열·헬퍼 반환값)** 으로 새는지도 본다. 빌드 도구의
  토큰 참조는 대개 거기서 컴파일되지 않고 **조용히 버려진다** — 화면에서만 티가 난다
- 같은 지적을 두 번 하게 되면 그건 사람 문제가 아니라 **자동화의 부재**다
