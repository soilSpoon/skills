# Skill Hygiene

Rules of thumb that keep this repo's skills lean as they grow. Derived from Anthropic's
skill-creator guidance and the structure of the best skills in the wild (e.g.
vercel-labs/agent-skills).

## Budgets (progressive disclosure)

| Layer | Budget | Why |
|---|---|---|
| `description` (frontmatter) | ~100 words | Always in context for every session — the triggering surface. Include WHEN to use (and when not), not just what. |
| `SKILL.md` body | < 500 lines hard, ~150 ideal | Loaded whole on every trigger. It should be a dispatcher: workflow + pointers, not an encyclopedia. |
| `references/` / `rules/` | unlimited | Loaded only when the agent needs that specific depth. Files > 300 lines get a table of contents. |
| `scripts/` | unlimited | Executed, not loaded — deterministic repeated work belongs here, not in prose. |
| `assets/` | unlimited | Templates/data used in output. |

## Structure pattern

The shape that scales (one rule, one file):

```
skill-name/
├── SKILL.md          # index: what, when, workflow, pointers to rules
├── rules/            # one concern per small file — agents read only what's relevant
├── references/       # deep docs, case studies
└── scripts/          # bundled executables
```

A 350-line SKILL.md that enumerates every rule inline costs every invocation the full read;
the same content as an index + 20 rule files costs each invocation only the 2-3 rules it needs.

## Red flags

- SKILL.md growing past ~200 lines by accretion of examples → move examples to `references/`.
- Content anchored to one project (file paths, app names, incident specifics) → generalize the
  rule, keep the project story in `references/` as a case study.
- `.zip` archives or build artifacts committed next to their source directories → delete; the
  directory is the distributable.
- Two skills sharing large duplicated guidance → extract a shared reference, or merge.
- A skill whose description doesn't say when NOT to trigger it → near-miss invocations waste
  whole turns; add the negative trigger.

## Periodic check

Quarterly (or when the repo "feels heavy"): `du -sk skills/*` + `wc -l skills/*/SKILL.md`,
compare against budgets, and split/trim the outliers. Treat hygiene as a small recurring cost
that prevents a large one-time rewrite.
