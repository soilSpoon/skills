# 설치 힌트 (SKILL.md 없을 때)

```bash
# Soilspoon (marketplace)
/plugin marketplace add soilSpoon/skills
/plugin install dev-router@soilspoon-skills
/plugin install ux-fundamentals@soilspoon-skills
/plugin install dev-toolkit@soilspoon-skills

# 단일 스킬
npx skills add soilSpoon/skills@ux-fundamentals
npx skills add soilSpoon/skills@dev-router

# Vercel (React)
npx skills add vercel-labs/agent-skills@react-best-practices
npx skills add vercel-labs/agent-skills@composition-patterns
```

설치 후 `resolve-paths.md` 순서로 다시 Read.