# SKILL.md 경로 해석

논리 이름 `skill-name` → 파일 시스템 검색 순서:

1. **Soilspoon marketplace** (Claude Code):  
   `~/.claude/plugins/marketplaces/soilspoon-skills/skills/<name>/SKILL.md`
2. **npx skills add** 캐시 (도구별; 없으면 3으로)
3. **User skills**: `~/.claude/skills/<name>/SKILL.md`  
   또는 Vercel 번들: `~/.claude/skills/vercel-react-best-practices/react-best-practices/SKILL.md`
4. **Grok user**: `~/.grok/skills/<name>/SKILL.md`
5. **Project**: `<repo>/.grok/skills/<name>/SKILL.md`

## Vercel 외부 스킬 (별도 repo)

| 논리 이름 | 일반 경로 |
|-----------|-----------|
| vercel-react-best-practices | `.../vercel-react-best-practices/react-best-practices/SKILL.md` |
| vercel-composition-patterns | `.../vercel-composition-patterns/composition-patterns/SKILL.md` 또는 `.../composition-patterns/SKILL.md` |

없으면 `install-hints.md` 후 재검색.

## 검증

Read 성공 시 frontmatter `name:`이 논리 이름과 일치하는지 확인.