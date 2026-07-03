# 하니스 감지 · 스킬 루트

dev-router는 **어느 코딩 에이전트에서든** 동일한 `SKILL.md`를 찾고, 없으면 설치한다.
하니스별 API(Workflow, Task, skill tool)는 다르지만 **파일 경로 규약**은 공통이다.

## 감지 순서

환경 변수 → 프로젝트 마커 → 사용자 홈 마커. **첫 매칭**이 active harness.

| harness | env / 마커 | `npx skills -a` | 글로벌 스킬 루트 | 프로젝트 스킬 루트 |
|---------|------------|---------------|------------------|-------------------|
| **claude-code** | `CLAUDE_CODE=1`, `~/.claude/` | `claude-code` | `~/.claude/skills/<name>/SKILL.md` | `<repo>/.claude/skills/<name>/SKILL.md` |
| **grok** | `GROK_*`, `~/.grok/`, `<repo>/.grok/` | *(미지원)* | `~/.grok/skills/<name>/SKILL.md` | `<repo>/.grok/skills/<name>/SKILL.md` |
| **droid** | `DROID_*`, `~/.factory/` | `droid` | `~/.factory/skills/<name>/SKILL.md` | `<repo>/.factory/skills/<name>/SKILL.md` |
| **opencode** | `OPENCODE_*`, `~/.config/opencode/` | `opencode` | `~/.config/opencode/skills/<name>/SKILL.md` | `<repo>/.opencode/skills/<name>/SKILL.md` |
| **kimi** | `KIMI_*`, Kimi CLI | `kimi-code-cli` | `~/.agents/skills/<name>/SKILL.md` | `<repo>/.agents/skills/<name>/SKILL.md` |
| **cursor** | Cursor IDE | `cursor` | `~/.cursor/skills/<name>/SKILL.md` | `<repo>/.agents/skills/<name>/SKILL.md` |
| **codex** | Codex CLI | `codex` | `~/.codex/skills/<name>/SKILL.md` | `<repo>/.agents/skills/<name>/SKILL.md` |
| **universal** | 위에 해당 없음 | `universal` | `~/.agents/skills/<name>/SKILL.md` | `<repo>/.agents/skills/<name>/SKILL.md` |

### 공통 호환 경로 (대부분 하니스가 함께 탐색)

- `~/.agents/skills/<name>/SKILL.md` · `<repo>/.agents/skills/<name>/SKILL.md`
- `~/.claude/skills/<name>/SKILL.md` · `<repo>/.claude/skills/<name>/SKILL.md` (OpenCode 등)

### Claude marketplace (플러그인 번들)

Claude Code 전용 — 스킬 원본이 marketplace에 clone되어 있을 수 있음:

`~/.claude/plugins/marketplaces/soilspoon-skills/skills/<name>/SKILL.md`

## 하니스별 설치 메커니즘

| harness | 1순위 | 2순위 |
|---------|-------|-------|
| claude-code | `/plugin install <bundle>@soilspoon-skills` (번들) | `npx skills add … -a claude-code -g -y` |
| grok | `node <dev-router>/scripts/ensure-skill.mjs <name>` (copy) | 수동: marketplace → `~/.grok/skills/` |
| droid · opencode · kimi · cursor · codex | `npx skills add … -a <agent> -g -y` | 프로젝트 스코프 `-p` (팀 공유 시) |
| universal / 불명 | `npx skills add … -a universal -g -y` | `.agents/skills/` 에 설치됨 |

Grok은 [vercel-labs/skills](https://github.com/vercel-labs/skills) 에 아직 에이전트 항목이 없다.
`ensure-skill.mjs`가 Soilspoon 원본을 **복사**한다.

## 프로젝트 vs 글로벌

- **글로벌 (`-g`)**: 개인 머신 전체 — 일상 dev-router 기본.
- **프로젝트 (기본)**: `<repo>/.agents/skills/` 등 — 팀이 lockfile으로 고정할 때.

한 레포에서만 쓰는 스킬은 프로젝트 스코프. dev-router가 라우팅하는 **공통 dev 스킬**은 글로벌 권장.

## 스크립트로 일괄 확인

```bash
node <dev-router-skill-dir>/scripts/ensure-skill.mjs --detect
node <dev-router-skill-dir>/scripts/ensure-skill.mjs ux-fundamentals code-fundamentals
node <dev-router-skill-dir>/scripts/ensure-skill.mjs --route-bundle react
```

`<dev-router-skill-dir>` = 이 SKILL.md가 있는 디렉터리 (Read로 확보한 경로).