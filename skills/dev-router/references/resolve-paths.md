# SKILL.md 경로 해석

논리 이름 `skill-name` → 파일 시스템 검색. **현재 하니스 우선** (`references/harnesses.md`).

## 공통 검색 순서

1. **이미 로드한 경로** — 라우터·부모 스킬이 Read에 성공한 디렉터리
2. **Soilspoon marketplace** (clone 되어 있을 때):  
   `~/.claude/plugins/marketplaces/soilspoon-skills/skills/<name>/SKILL.md`
3. **프로젝트 스킬** (git walk-up — OpenCode 규약과 동일):
   - `<repo>/.grok/skills/<name>/SKILL.md`
   - `<repo>/.claude/skills/<name>/SKILL.md`
   - `<repo>/.agents/skills/<name>/SKILL.md`
   - `<repo>/.factory/skills/<name>/SKILL.md` (Droid)
   - `<repo>/.opencode/skills/<name>/SKILL.md`
4. **글로벌 — 하니스별** (active harness 행, `harnesses.md`):
   - Grok: `~/.grok/skills/<name>/SKILL.md`
   - Droid: `~/.factory/skills/<name>/SKILL.md`
   - OpenCode: `~/.config/opencode/skills/<name>/SKILL.md`
   - Claude: `~/.claude/skills/<name>/SKILL.md`
   - Cursor: `~/.cursor/skills/<name>/SKILL.md`
   - Kimi / universal: `~/.agents/skills/<name>/SKILL.md`
5. **호환 폴백** (어느 하니스든):  
   `~/.claude/skills/<name>/SKILL.md` · `~/.agents/skills/<name>/SKILL.md`
6. **`npx skills` 설치 위치** — `npx skills list` 출력 경로

## Vercel 외부 스킬 (별칭 디렉터리)

| 논리 이름 | 추가 검색 경로 |
|-----------|----------------|
| vercel-react-best-practices | `.../react-best-practices/SKILL.md`, `.../vercel-react-best-practices/react-best-practices/SKILL.md` |
| vercel-composition-patterns | `.../composition-patterns/SKILL.md`, `.../vercel-composition-patterns/composition-patterns/SKILL.md` |

## 없을 때

`references/install-hints.md` → `scripts/ensure-skill.mjs` → 위 순서 **재검색**.

## 검증

Read 성공 시 frontmatter `name:`이 논리 이름과 일치하는지 확인 (Vercel은 폴더명이 다를 수 있음 — 본문 제목으로 교차 확인).