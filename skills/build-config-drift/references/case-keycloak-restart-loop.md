# Case Study — Compose 정의 변경 후 컨테이너 재생성 누락 (Keycloak 재시작 루프)

dronerush 모노레포 (`apps/everysim` + `libs/keycloak`) 에서 `npm run dev:local` 시 모든 페이지가 `/api/auth/error?error=Configuration` 으로 떨어지고, 추적해보니 Keycloak 컨테이너가 **재시작 루프**에 빠져 있었다. compose override 파일은 정상이었지만 컨테이너 env 가 옛 값 그대로였던 사례.

## 증상

```
[auth][error] TypeError: fetch failed
GET /api/auth/silent-sso-init?callbackUrl=%2Fen 307
GET /api/auth/error?error=Configuration 500
```

진입 자체가 막혀 그 뒤의 모듈 결손 등 다른 문제도 가려짐 (case-merge-import-drift.md 참조).

## DETECT: 진단 layer 식별

| Layer | 상태 | 단서 |
|---|---|---|
| Auth.js OIDC discovery | ❌ fetch 실패 | `AUTH_KEYCLOAK_ISSUER=http://localhost:9500/realms/everysim` |
| 9500 포트 LISTEN | ❌ 없음 | `ss -ltnp | grep 9500` 비어있음 |
| `keycloak` 컨테이너 | ❌ Restarting (1) | `docker ps -a` |
| Keycloak → MySQL 접속 | ❌ Connection refused | `docker logs keycloak` |
| `KC_DB_URL` 컨테이너 env | ❌ `jdbc:mysql://localhost:3306/...` | `docker inspect keycloak` |
| `MYSQL_HOST` 컨테이너 env | ❌ `localhost` | 같음 |
| compose override.yml | ✅ `MYSQL_HOST: mysql`, `KC_DB_URL: ...mysql:3306...` 명시 | `cat libs/keycloak/docker-compose.override.yml` |
| compose 라벨 (config_files) | ✅ override.yml 포함 | `docker inspect ... Labels` |

**모순**: compose 정의에는 `mysql:3306` 이 박혀있는데 컨테이너 env 는 `localhost:3306`. 라벨에는 override 가 적용된 걸로 표시됨. 이 모순이 root cause 의 단서 — *컨테이너가 옛 정의로 만들어진 후 재시작만 반복했고, docker restart 는 env 를 갱신하지 않는다*.

## SCOPE: 정적 layer (compose) vs 런타임 layer (container)

| Layer | 의미 | 변경 반영 시점 |
|---|---|---|
| `docker-compose.yml` + `override.yml` | 정적 정의 (텍스트) | 파일 저장 즉시 |
| 컨테이너의 `.Config.Env` | 런타임 상태 | 컨테이너 *생성* (create) 시점 |
| `docker restart <name>` | 프로세스 재시작 | env/network/volumes **갱신하지 않음** |
| `docker compose up -d --force-recreate` | 컨테이너 재생성 | 현재 compose 정의 적용 |

이 케이스의 부채: 자동복구 스크립트 `apps/everysim/scripts/ensure-keycloak.sh` 가 unhealthy 컨테이너에 대해 `docker restart` 만 호출 — compose 정의가 바뀌어도 영원히 옛 env 로 부팅 시도.

## AUDIT: 자동복구 스크립트의 회복 시나리오 누락

```bash
# (a) ensure-* / restart 스크립트가 docker restart 만 하는지 — env 갱신 안 됨
grep -rnE "docker (restart|start) " apps/*/scripts libs/*/scripts 2>/dev/null

# (b) compose 정의 vs 살아있는 컨테이너 env 비교
docker inspect <container> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep <SUSPICIOUS_VAR>
grep -E "<SUSPICIOUS_VAR>:" libs/*/docker-compose.yml libs/*/docker-compose.override.yml

# (c) 컨테이너 생성 시각 vs 관련 compose 파일 변경 시각
docker inspect <container> --format '{{.Created}}'
git log --oneline -- libs/<svc>/docker-compose.yml libs/<svc>/docker-compose.override.yml
```

(a) 의 결과가 *불건강 시 docker restart 호출* 패턴이면 stale-env 회복 누락 의심.
(b) 의 결과가 *compose 와 컨테이너 env 가 다름* 이면 컨테이너가 옛 정의로 만들어진 채 살아있다는 신호.
(c) 에서 컨테이너가 compose 변경 *이전*에 만들어진 게 보이면 인과 확정.

## 근본 원인

`docker ps` 는 RUNNING + RESTARTING 상태를 *둘 다* 노출한다. 자동복구 스크립트가 "running" 만 확인하고 health check 결과로 분기하면, **재시작 루프 컨테이너도 "running but not healthy" 분기**로 빠진다. 그 분기가 `docker restart` 라면 *영원히 같은 깨진 상태*가 반복된다.

```bash
# 변경 전 (문제 패턴)
if docker ps --filter name=^kc$ ...; then     # restart-loop 도 매치
  if [healthcheck pass]; then exit 0; fi
  docker restart kc                            # ← env 갱신 안 됨
fi

# 변경 후 (회복 보장 패턴)
if is_healthy; then exit 0; fi
docker compose up -d --force-recreate kc       # ← 현재 compose 정의로 재생성
```

원칙 매핑:
- 새 패턴 (이 케이스가 추가): **정적 정의 vs 런타임 상태의 동기화는 *재생성* 만이 보장한다.** 인프라 자동복구에서 `restart` 에 의존하면 compose drift 가 *영구 상태*가 된다.
- #1 (정적 layer ≠ 런타임 layer): compose 파일이 정적이고 컨테이너가 런타임이라는 점에서 같은 frame.
- #5 (Pending 메모 ≠ 검증): "재시작 시 자동복구된다" 는 메모만 있고 *어떤 회복 시나리오를 커버하는지* 명시 안 됨.

## SMOKE: 재발 방지

- **자동복구 스크립트는 `up -d --force-recreate` 로 통일**: healthy 면 조기 종료, 그 외 전부(미존재 / stopped / unhealthy / restart-loop) 동일 분기. compose 정의 변경이 다음 devcontainer 시작 시 자동 적용됨을 보장.
- **compose 파일 수정 PR 의 체크리스트**: 환경에 살아있는 컨테이너가 옛 정의로 만들어졌을 가능성을 명시. 단순 `docker restart` 가 아니라 `--force-recreate` 가 필요함을 PR 설명에 적기.
- **모순 신뢰**: compose 정의 ↔ 컨테이너 env 가 다른 신호가 보이면 *환경 문제* 로 치우지 말고 자동복구 스크립트의 회복 시나리오를 의심한다.

## 트리거 시그널

- `docker ps` 에 `Restarting (N)` 컨테이너가 보이고 `docker logs` 에 외부 의존성 (DB, 캐시, …) 접속 실패
- `docker inspect <c>` 의 env 가 `docker-compose.yml`/`override.yml` 의 값과 다름
- `docker inspect <c>` 의 `.Created` 시각이 *compose 파일 변경* commit 이전
- 자동복구 스크립트에 `docker restart` 가 들어있고 `--force-recreate` 는 없음
- "compose 파일은 고쳤는데 적용 안 됨", "어제까지 잘 됐는데 갑자기" — 컨테이너가 옛 정의로 살아있을 가능성

## 한 줄 정리

**compose 파일은 텍스트, 컨테이너는 상태.** `docker restart` 는 프로세스만 재시작하고 env/network/volumes 를 갱신하지 않는다. 자동복구 스크립트가 *재생성* 이 아니라 *재시작* 에 의존하면 compose drift 가 영구화된다. healthy 가 아니면 무조건 `up -d --force-recreate` 로 통일.
