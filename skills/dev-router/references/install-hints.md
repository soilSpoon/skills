# 설치 · 구성 (SKILL.md 없을 때)

**원칙**: 사용자에게 설치법만 알려주지 말고, Shell로 먼저 실행한다.

## 0. 자동 (모든 하니스 — 권장)

```bash
node <dev-router-dir>/scripts/ensure-skill.mjs --detect
node <dev-router-dir>/scripts/ensure-skill.mjs ux-fundamentals code-fundamentals
node <dev-router-dir>/scripts/ensure-skill.mjs --route-bundle react
```

`<dev-router-dir>` = dev-router `SKILL.md`가 있는 폴더.

## 1. npx skills (Droid · OpenCode · Kimi · Cursor · Codex · Claude …)

소스 매핑: `references/skill-sources.md`

```bash
# 단일 스킬 — 에이전트 지정 + 글로벌 + 비대화형
npx skills add soilSpoon/skills@ux-fundamentals -g -y -a opencode --copy
npx skills add soilSpoon/skills@code-fundamentals -g -y -a droid --copy
npx skills add soilSpoon/skills@dev-router -g -y -a kimi-code-cli --copy
npx skills add soilSpoon/skills@dev-router -g -y -a claude-code --copy

# Vercel React
npx skills add vercel-labs/agent-skills@react-best-practices -g -y -a claude-code --copy
npx skills add vercel-labs/agent-skills@composition-patterns -g -y -a claude-code --copy

# 팀 공유 — 프로젝트 스코프 (repo 루트에서)
npx skills add soilSpoon/skills@ux-fundamentals -y -a universal --copy
```

`-a` 값: `references/harnesses.md` 표의 `npx skills -a` 열.

## 2. Grok (npx 미지원)

```bash
node <dev-router-dir>/scripts/ensure-skill.mjs ux-fundamentals
# 또는 수동 복사
cp -r ~/.claude/plugins/marketplaces/soilspoon-skills/skills/ux-fundamentals ~/.grok/skills/
cp -r ~/.claude/plugins/marketplaces/soilspoon-skills/skills/ux-fundamentals /path/to/repo/.grok/skills/
```

## 3. Claude Code — plugin 번들 (한 번에)

```
/plugin marketplace add soilSpoon/skills
/plugin install dev-router@soilspoon-skills
/plugin install dev-toolkit@soilspoon-skills
/plugin install ux-fundamentals@soilspoon-skills
```

Vercel React 스킬은 marketplace 밖 — 섹션 1의 `npx skills add` 필요.

## 4. 설치 후

`resolve-paths.md` 순서로 Read 재시도. 실패 시 `npx skills list`로 실제 경로 확인.

## 5. 최초 Soilspoon clone (marketplace·Grok copy 둘 다 필요할 때)

```bash
mkdir -p ~/.claude/plugins/marketplaces
git clone https://github.com/soilSpoon/skills.git ~/.claude/plugins/marketplaces/soilspoon-skills
```

이후 `ensure-skill.mjs`가 Grok copy 폴백에 이 경로를 쓴다.