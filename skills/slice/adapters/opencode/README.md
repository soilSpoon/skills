# opencode adapter

Adapter that wires the recursive-slice engine (`recursive-slice.js`) to opencode's
AsyncFunction host API. The engine is a standalone artifact; this adapter is the only
file that imports `@opencode-ai/sdk` or any opencode-specific dep.

## Files

| File | Role |
|---|---|
| `slice-engine.ts` | Adapter implementation — `roleOf`, `shNative`, `agentCall`, `makeBudgetAccumulator` |
| `host-smoke.mjs` | No-LLM smoke test for the AsyncFunction PORT host (I7 guard + gate smokes) |
| `test/adapter.test.mjs` | Node `--test` suite (groups A–H) |

## Rebuild boundary

**The integration phase MUST call `sh scripts/build-engine.sh` ONCE before running the
adapter rig.** This is the rebuild boundary contract:

```sh
# Integration phase (run from skills/slice/):
sh scripts/build-engine.sh          # rebuilds recursive-slice.js from src/
cd adapters/opencode && npm test     # adapter rig — uses the freshly-built artifact
```

The artifact (`recursive-slice.js`) is the bundle output of `src/*.ts` via tsup. It must
never be rebuilt per-leaf or hand-edited. The H-group freshness canary in
`test/adapter.test.mjs` enforces this boundary at test time: it asserts that
`recursive-slice.js` mtime >= the mtime of every `src/**/*.ts` file. If the canary fails,
run `sh scripts/build-engine.sh` and commit the rebuilt artifact.

The core architecture test (`test/unit/architecture.test.mjs` — `'artifact freshness'`)
pins the same invariant for the committed state.

## Skipping the freshness canary

Set `RS_NO_FRESHNESS_CANARY=1` to skip the H-group canary (e.g., CI jobs that pin a
known-good artifact for speed). The core architecture test still runs unconditionally.

## Deps isolation

This adapter's deps (`@opencode-ai/sdk`, `@opencode-ai/plugin`, `typescript`) live in
`adapters/opencode/package.json` — they MUST NOT appear in `skills/slice/package.json`.
The engine core has zero opencode/SDK deps.
