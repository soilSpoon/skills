#!/bin/sh
# Build the engine artifact from TypeScript source (src/*.ts → recursive-slice.js).
#   1) tsc --strict   — the type gate (noEmit)
#   2) tsup (esbuild) — bundle the modules into ONE self-contained file,
#                       footer-inject the top-level `return await __main()`
#   3) node --check   — same parse gate the hand-written artifact passed
set -e
cd "$(dirname "$0")/.."

npx -y -p typescript tsc -p tsconfig.json

# Personas are a BUILD ARTIFACT, not a hand-mirror. agents/slice-<role>.md = pinned registration
# frontmatter + the R_* persona constant as the body — generated straight from src/prompts.ts (the
# single source of truth). This REPLACES the old 2-field grep drift-guard: a grep could only catch ONE
# class of drift (a dropped schema field reappearing); generation makes ALL drift impossible because the
# body IS the constant. Run AFTER tsc (so type errors fail first) and assert the regenerated tree is clean
# — i.e. the generator is idempotent AND the committed .md already match the constants. A dirty tree here
# means someone hand-edited an .md or changed a constant without committing the regenerated artifact.
node --experimental-strip-types scripts/gen-personas.mjs
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git diff --quiet -- agents/; then
    echo "FATAL: generated agents/*.md differ from the committed copy — gen-personas.mjs is not idempotent or the persona constants in src/prompts.ts changed without committing the regenerated .md. Run 'sh scripts/build-engine.sh' and commit the agents/ changes."
    git --no-pager diff --stat -- agents/
    exit 1
  fi
fi

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

# Reproducibility guard (Lesson 14: a drift that recurs despite being written down is a MISSING
# deterministic guard, not a memory problem). The committed recursive-slice.js MUST equal a fresh build
# of src/ — a direct edit to the ARTIFACT (not src/) passes the mtime freshness canary but is silently
# erased by this very rebuild (exactly how the sharedScratch auto-enable once shipped into the artifact
# only). Under RS_BUILD_VERIFY (CI / release) a mismatch is FATAL; otherwise a NOTE, since a normal dev
# build legitimately changes the artifact before you commit it.
if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  if ! git diff --quiet -- recursive-slice.js; then
    if [ -n "$RS_BUILD_VERIFY" ]; then
      echo "FATAL: recursive-slice.js is not reproducible from src/ — a hand-edited artifact, or a src/ change whose rebuild was never committed. Run 'sh scripts/build-engine.sh' and commit recursive-slice.js."
      git --no-pager diff --stat -- recursive-slice.js
      exit 1
    fi
    echo "NOTE: recursive-slice.js rebuilt and now differs from the committed copy — 'git add recursive-slice.js' and commit it (the published artifact must stay reproducible from src/; CI runs RS_BUILD_VERIFY=1 to enforce)."
  fi
fi

rm -rf build
echo "OK: recursive-slice.js rebuilt from src/"
