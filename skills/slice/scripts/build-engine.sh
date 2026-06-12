#!/bin/sh
# Build the engine artifact from TypeScript source (src/*.ts → recursive-slice.js).
#   1) tsc --strict   — the type gate (noEmit)
#   2) tsup (esbuild) — bundle the modules into ONE self-contained file,
#                       footer-inject the top-level `return await __main()`
#   3) node --check   — same parse gate the hand-written artifact passed
set -e
cd "$(dirname "$0")/.."
npx -y -p typescript tsc -p tsconfig.json
npx -y -p tsup -p typescript tsup
grep -q "export const meta" build/recursive-slice.mjs || { echo "FATAL: meta export missing"; exit 1; }
grep -q "return await __main()" build/recursive-slice.mjs || { echo "FATAL: footer missing"; exit 1; }
mv build/recursive-slice.mjs recursive-slice.js
node --check recursive-slice.js
rm -rf build
echo "OK: recursive-slice.js rebuilt from src/"
