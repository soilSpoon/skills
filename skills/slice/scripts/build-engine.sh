#!/bin/sh
# Build the engine artifact from TypeScript source (src/*.ts → recursive-slice.js).
#   1) tsc --strict   — the type gate (noEmit)
#   2) tsup (esbuild) — bundle the modules into ONE self-contained file,
#                       footer-inject the top-level `return await __main()`
#   3) node --check   — same parse gate the hand-written artifact passed
set -e
cd "$(dirname "$0")/.."

# Drift guard: the standalone agents/*.md personas are a hand-maintained mirror of the R_*
# constants in src/prompts.ts. They silently drifted once (telling spawned subagents to emit
# fields the engine schema had dropped — gitSha/silentErrorRisk). Fail the build if a dropped
# schema field reappears in a mirror, so the single source of truth (schemas.ts) is enforced
# structurally instead of by memory. When you intentionally remove a schema field, add it here.
for dropped in gitSha silentErrorRisk; do
  if grep -lw "$dropped" agents/*.md >/dev/null 2>&1; then
    echo "FATAL: agents/*.md still reference the dropped schema field '$dropped' — sync the mirror with src/schemas.ts/prompts.ts"; exit 1
  fi
done

npx -y -p typescript tsc -p tsconfig.json
npx -y -p tsup -p typescript tsup
grep -q "export const meta" build/recursive-slice.mjs || { echo "FATAL: meta export missing"; exit 1; }
grep -q "return await __main()" build/recursive-slice.mjs || { echo "FATAL: footer missing"; exit 1; }
mv build/recursive-slice.mjs recursive-slice.js
node --check recursive-slice.js
rm -rf build
echo "OK: recursive-slice.js rebuilt from src/"
