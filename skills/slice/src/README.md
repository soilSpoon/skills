# Engine source (TypeScript)

`recursive-slice.js` (the artifact the Workflow runtime executes) is BUILT — do not edit it
by hand. Source of truth:

| File | Holds |
|---|---|
| `main.ts` | the engine: phases, gates, repair loop, integrate, briefing |
| `types.ts` | domain data contracts (Baseline/Verdict/WorkNode/...) |
| `schemas.ts` | JSON-Schemas forced onto each role's output |
| `prompts.ts` | the role personas (mirrored by `agents/slice-*.md`) |
| `../tsup.config.ts` | bundle config + the runtime-required `export const meta` banner + the `return await __main()` footer |

Build: `../scripts/build-engine.sh` — tsc --strict gate → tsup bundle → node --check.

The ambient `declare` block in `main.ts` is the PORT: any host that injects those globals
(agent/parallel/phase/log/args/budget) runs the artifact unchanged.
