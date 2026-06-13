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
# The artifact is a workflow SCRIPT, not a module: `export const meta` (the runtime parses it as the first
# statement) is the ONLY top-level export, the rest is the engine, and `return await __main()` is the entry.
# tsup.config pins the output name; skills/slice/package.json pins "type":"module" so esbuild emits a FLAT
# bundle (top-level __main) on every machine. ONE assertion proves the whole contract: exactly the meta
# banner + the entry footer + NO other export — a CommonJS-context build wraps in __commonJS and adds
# `export default` (2 exports), so it fails here LOUDLY instead of shipping an artifact that runs nowhere.
ART=build/recursive-slice.mjs
[ -f "$ART" ]                                || { echo "FATAL: tsup produced no $ART"; exit 1; }
grep -q "export const meta" "$ART"           || { echo "FATAL: meta banner missing"; exit 1; }
grep -q "return await __main()" "$ART"       || { echo "FATAL: entry footer missing"; exit 1; }
[ "$(grep -cE '^export ' "$ART")" -eq 1 ]    || { echo "FATAL: stray top-level export(s) — expected ONLY 'export const meta'. A __commonJS-wrapped (CommonJS-context) build trips this; ensure skills/slice/package.json has '\"type\": \"module\"'."; exit 1; }
mv "$ART" recursive-slice.js
# Parse gate: the artifact is NOT a standalone module — the runtime strips the `export const meta`
# banner and runs the rest as an AsyncFunction body (where top-level `return await __main()` is legal,
# but illegal in a real module — so `node --check` is the wrong gate). Validate it the way it is loaded.
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
const AF = Object.getPrototypeOf(async function () {}).constructor
let s = await readFile('recursive-slice.js', 'utf8')
s = s.replace(/^export const meta/m, 'const meta').replace(/^export default [^\n]*$/m, '').replace(/^export \{[^}]*\};?$/m, '')
new AF('agent', 'log', 'phase', 'budget', 'args', 'pipeline', 'parallel', 'workflow', s)  // throws on parse error
NODE
rm -rf build
echo "OK: recursive-slice.js rebuilt from src/"
