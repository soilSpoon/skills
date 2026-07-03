# 스킬 설치 소스 매핑

논리 이름 → `npx skills add` 소스. Vercel 외부 스킬은 별도 repo.

## Soilspoon (`soilSpoon/skills`)

| 논리 이름 | install 소스 |
|-----------|--------------|
| dev-router | `soilSpoon/skills@dev-router` |
| ux-fundamentals | `soilSpoon/skills@ux-fundamentals` |
| code-fundamentals | `soilSpoon/skills@code-fundamentals` |
| toss-frontend-fundamentals | `soilSpoon/skills@toss-frontend-fundamentals` |
| technical-writing | `soilSpoon/skills@technical-writing` |
| ux-writing | `soilSpoon/skills@ux-writing` |
| commit-pr-checklist | `soilSpoon/skills@commit-pr-checklist` |
| build-config-drift | `soilSpoon/skills@build-config-drift` |
| issue-rootcause-workflow | `soilSpoon/skills@issue-rootcause-workflow` |
| test-foundations | `soilSpoon/skills@test-foundations` |
| spec-first | `soilSpoon/skills@spec-first` |
| slice | `soilSpoon/skills@slice` |

## Vercel (`vercel-labs/agent-skills`)

| 논리 이름 | install 소스 | 설치 후 디렉터리 이름 |
|-----------|--------------|----------------------|
| vercel-react-best-practices | `vercel-labs/agent-skills@react-best-practices` | `react-best-practices` |
| vercel-composition-patterns | `vercel-labs/agent-skills@composition-patterns` | `composition-patterns` |

Read 시 `resolve-paths.md`의 Vercel 별칭 경로도 검색.

## Claude plugin 번들 (한 번에 여러 스킬)

| 번들 | 포함 스킬 |
|------|-----------|
| `dev-toolkit@soilspoon-skills` | code-fundamentals, toss-frontend-fundamentals, technical-writing, ux-writing, commit-pr-checklist, build-config-drift, issue-rootcause-workflow |
| `ux-fundamentals@soilspoon-skills` | ux-fundamentals |
| `dev-router@soilspoon-skills` | dev-router |
| `reliability-kit@soilspoon-skills` | test-foundations, spec-first |

Claude Code에서 처음 세팅:

```
/plugin marketplace add soilSpoon/skills
/plugin install dev-router@soilspoon-skills
/plugin install dev-toolkit@soilspoon-skills
/plugin install ux-fundamentals@soilspoon-skills
```

Vercel React 스킬은 marketplace 밖 — `npx skills add` 로 별도 설치.

## 라우트 번들 (`ensure-skill.mjs --route-bundle`)

| bundle | 스킬 목록 |
|--------|-----------|
| `react` | ux-fundamentals, vercel-react-best-practices, vercel-composition-patterns, toss-frontend-fundamentals |
| `ship` | commit-pr-checklist, code-fundamentals, technical-writing |
| `bug` | issue-rootcause-workflow, test-foundations |
| `ux` | ux-fundamentals |
| `minimal` | dev-router, ux-fundamentals, code-fundamentals |