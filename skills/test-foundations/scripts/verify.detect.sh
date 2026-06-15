#!/usr/bin/env bash
# verify.detect.sh — the per-stack tool/runner DATA table (DATA, not control flow).
#
# This file is SOURCED by verify.sh. It is pure data + tiny pure helpers:
#   - vd_detect_stacks      : echo the manifest-detected ecosystem ids (space-sep)
#   - vd_runner_for         : given (stack, layer) echo a "kind|tool|cmd-template" row
#   - vd_native_task        : given a layer, echo a native task (package.json/just/mise) if one exists
#
# THE EXTENSIBILITY CONTRACT (read this before adding a stack):
#   Adding an ecosystem = (1) one row in vd_detect_stacks' manifest map,
#                          (2) four rows in vd_runner_for (l0..l3),
#                          (3) nothing in verify.sh — the four layer dispatch
#                              functions in verify.sh are generic and call the
#                              table. The slice contract (verify.sh flags / exit
#                              codes / NDJSON) never changes.
#
# ROW FORMAT returned by vd_runner_for:  KIND|TOOL|MODE
#   KIND  = l0|l1|l2|l3 (echoed back for sanity)
#   TOOL  = human/JSON "tool" name, or "" when no tool is detected (=> present:false)
#   MODE  = an opaque token verify.sh's dispatcher switches on to build the real
#           argv. Keeping MODE a token (not a literal command) means quoting /
#           {scope} forwarding lives in ONE place (verify.sh), not smeared across
#           the table. Known modes:
#             js-biome js-eslint js-prettier js-tsc            (l0, JS/TS)
#             js-vitest js-node-test js-jest                   (l1, JS/TS)
#             js-testcontainers                                (l2, JS/TS)
#             js-playwright                                    (l3, JS/TS)
#             py-ruff py-mypy                                  (l0, Python)
#             py-pytest py-unittest                            (l1, Python)
#             py-testcontainers                                (l2, Python)
#             py-playwright                                    (l3, Python)
#             go-fmtvet go-test go-tc go-harness               (Go      — STUB)
#             rs-fmtclippy rs-nextest rs-tc rs-harness         (Rust    — STUB)
#             none                                             (no tool => present:false)
#
# DETECT-then-MAP: vd_runner_for picks the FIRST tool that is actually runnable
# in THIS environment (command -v / node-resolvable), so a repo that declares
# vitest but runs in an env without it degrades to node:test, and a repo with no
# L0 config degrades to MODE=none => present:false (a MEASURED FACT, never green).

# ---------------------------------------------------------------------------
# small pure helpers (no side effects, no exit)
# ---------------------------------------------------------------------------

# vd_has CMD : true if CMD is on PATH
vd_has() { command -v "$1" >/dev/null 2>&1; }

# vd_node_resolves PKG : true if `node -e "require.resolve(PKG)"` works from REPO_ROOT
vd_node_resolves() {
  ( cd "${REPO_ROOT:-.}" 2>/dev/null && node -e "require.resolve('$1')" >/dev/null 2>&1 )
}

# vd_node_bin PKG : echo a runnable command for a local node CLI if present, else ""
#   prefers node_modules/.bin, then a resolvable package, then npx --no-install.
vd_node_bin() {
  local pkg="$1"
  if [ -x "${REPO_ROOT:-.}/node_modules/.bin/$pkg" ]; then
    echo "${REPO_ROOT:-.}/node_modules/.bin/$pkg"; return 0
  fi
  return 1
}

# vd_py PKG : true if a python module is importable by the chosen interpreter
vd_py_has() {
  "${PYBIN:-python3}" -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('$1') else 1)" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# STACK DETECTION (manifest precedence; each stack maps independently)
# ---------------------------------------------------------------------------
vd_detect_stacks() {
  local root="${REPO_ROOT:-.}" out=""
  [ -f "$root/package.json" ]       && out="$out js"
  { [ -f "$root/pyproject.toml" ] || [ -f "$root/requirements.txt" ] || [ -f "$root/setup.py" ]; } && out="$out py"
  [ -f "$root/go.mod" ]             && out="$out go"
  [ -f "$root/Cargo.toml" ]         && out="$out rs"
  ls "$root"/*.csproj >/dev/null 2>&1 && out="$out dotnet"
  { [ -f "$root/pom.xml" ] || [ -f "$root/build.gradle" ] || [ -f "$root/build.gradle.kts" ]; } && out="$out jvm"
  [ -f "$root/Gemfile" ]            && out="$out ruby"
  echo "${out# }"
}

# ---------------------------------------------------------------------------
# NATIVE-RUNNER-FIRST: a layer may be served by a committed task the team trusts.
# vd_native_task LAYER : echo "RUNNER|TASK" if package.json script / just / mise
# defines a verify task for this layer, else "" . verify.sh DELEGATES to it.
# Convention names accepted (first hit wins):
#   package.json scripts:  verify:l0 / verify-l0 / lint (l0) etc.  -> npm run <name>
#   justfile recipes:      verify-l0 / verify:l0                   -> just <name>
#   mise tasks:            verify:l0                               -> mise run <name>
# ---------------------------------------------------------------------------
vd_native_task() {
  local layer="$1" root="${REPO_ROOT:-.}"
  # package.json scripts (JS/TS repos almost always have these)
  if [ -f "$root/package.json" ] && vd_has node; then
    local name
    name="$(node -e '
      const fs=require("fs");
      try{
        const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).scripts||{};
        const L=process.argv[2];
        const cands=[`verify:${L}`,`verify-${L}`];
        for(const c of cands){ if(p[c]){console.log(c);process.exit(0);} }
      }catch(e){}
    ' "$root/package.json" "$layer" 2>/dev/null)"
    if [ -n "$name" ]; then echo "npm|$name"; return 0; fi
  fi
  # justfile
  if { [ -f "$root/justfile" ] || [ -f "$root/Justfile" ]; } && vd_has just; then
    if just --list 2>/dev/null | grep -qE "(^| )verify-$layer( |$)"; then echo "just|verify-$layer"; return 0; fi
  fi
  # mise tasks
  if { [ -f "$root/mise.toml" ] || [ -f "$root/.mise.toml" ]; } && vd_has mise; then
    if mise tasks 2>/dev/null | grep -qE "(^| )verify:$layer( |$)"; then echo "mise|verify:$layer"; return 0; fi
  fi
  echo ""
}

# ---------------------------------------------------------------------------
# RUNNER TABLE: vd_runner_for STACK LAYER -> "KIND|TOOL|MODE"
# Each branch picks the best AVAILABLE tool, else MODE=none (=> present:false).
# ---------------------------------------------------------------------------
vd_runner_for() {
  local stack="$1" layer="$2" root="${REPO_ROOT:-.}"
  case "$stack" in
    # ===================== JS / TS (FULLY IMPLEMENTED) =====================
    js)
      case "$layer" in
        l0)
          # canonical formatter+linter+type-checker on changed files.
          if [ -f "$root/biome.json" ] || [ -f "$root/biome.jsonc" ]; then
            if vd_node_bin biome >/dev/null || vd_has biome; then echo "l0|biome|js-biome"; return 0; fi
          fi
          if [ -f "$root/.eslintrc" ] || [ -f "$root/.eslintrc.json" ] || [ -f "$root/.eslintrc.cjs" ] || [ -f "$root/eslint.config.js" ] || [ -f "$root/eslint.config.mjs" ]; then
            if vd_node_bin eslint >/dev/null || vd_has eslint; then echo "l0|eslint|js-eslint"; return 0; fi
          fi
          # tsc --noEmit is a real L0 type gate when a tsconfig exists.
          if [ -f "$root/tsconfig.json" ]; then
            if vd_node_bin tsc >/dev/null || vd_has tsc; then echo "l0|tsc|js-tsc"; return 0; fi
          fi
          # prettier-only formatting check as a last L0 resort.
          if [ -f "$root/.prettierrc" ] || [ -f "$root/.prettierrc.json" ] || [ -f "$root/prettier.config.js" ]; then
            if vd_node_bin prettier >/dev/null || vd_has prettier; then echo "l0|prettier|js-prettier"; return 0; fi
          fi
          # PORTABLE L0 FLOOR: when no formatter/linter/type-checker tool is
          # installed but a config FILE exists, validate config + source parse
          # via node (always available). A real structural-correctness floor
          # (catches broken JSON / unparseable JS) rather than a false green.
          if [ -f "$root/biome.json" ] || [ -f "$root/biome.jsonc" ] || [ -f "$root/tsconfig.json" ] \
             || [ -f "$root/.eslintrc.json" ] || [ -f "$root/.prettierrc" ] || [ -f "$root/.prettierrc.json" ]; then
            if vd_has node; then echo "l0|node-syntax|js-node-l0"; return 0; fi
          fi
          echo "l0||none"; return 0 ;;
        l1)
          # fast unit runner; prefer vitest, then jest, then node:test (built-in, always present).
          if [ -f "$root/vitest.config.ts" ] || [ -f "$root/vitest.config.js" ] || [ -f "$root/vitest.config.mts" ] || grep -q '"vitest"' "$root/package.json" 2>/dev/null; then
            if vd_node_bin vitest >/dev/null || vd_has vitest; then echo "l1|vitest|js-vitest"; return 0; fi
          fi
          if grep -q '"jest"' "$root/package.json" 2>/dev/null; then
            if vd_node_bin jest >/dev/null || vd_has jest; then echo "l1|jest|js-jest"; return 0; fi
          fi
          # node:test built-in — present whenever node is. The portable floor.
          if vd_has node && ls "$root"/{test,tests,src}/**/*.test.{js,mjs,ts} "$root"/*.test.{js,mjs} >/dev/null 2>&1 || vd_has node; then
            echo "l1|node:test|js-node-test"; return 0
          fi
          echo "l1||none"; return 0 ;;
        l2)
          # module seams against REAL deps (testcontainers). present:false unless wired.
          if grep -qiE 'testcontainers' "$root/package.json" 2>/dev/null; then
            echo "l2|testcontainers|js-testcontainers"; return 0
          fi
          echo "l2||none"; return 0 ;;
        l3)
          # user journeys (Playwright). present:false unless wired.
          if [ -f "$root/playwright.config.ts" ] || [ -f "$root/playwright.config.js" ]; then
            echo "l3|playwright|js-playwright"; return 0
          fi
          echo "l3||none"; return 0 ;;
      esac ;;

    # ===================== Python (FULLY IMPLEMENTED) =====================
    py)
      case "$layer" in
        l0)
          # ruff (lint+format) is the canonical L0; degrade to none if absent.
          if grep -q '\[tool.ruff\]' "$root/pyproject.toml" 2>/dev/null || [ -f "$root/ruff.toml" ] || [ -f "$root/.ruff.toml" ]; then
            if vd_has ruff || vd_py_has ruff; then echo "l0|ruff|py-ruff"; return 0; fi
          fi
          if grep -q '\[tool.mypy\]' "$root/pyproject.toml" 2>/dev/null || [ -f "$root/mypy.ini" ]; then
            if vd_has mypy || vd_py_has mypy; then echo "l0|mypy|py-mypy"; return 0; fi
          fi
          # PORTABLE L0 FLOOR: when ruff/mypy are not installed but a ruff config
          # (or any pyproject) exists, byte-compile all sources via the interpreter
          # (compileall) — a real syntax/structural floor, never a false green.
          if grep -q '\[tool.ruff\]' "$root/pyproject.toml" 2>/dev/null || [ -f "$root/ruff.toml" ] || [ -f "$root/pyproject.toml" ]; then
            if vd_has "${PYBIN:-python3}"; then echo "l0|py-compile|py-node-l0"; return 0; fi
          fi
          echo "l0||none"; return 0 ;;
        l1)
          # pytest preferred; degrade to stdlib unittest (always present).
          if grep -qE '\[tool.pytest|pytest' "$root/pyproject.toml" 2>/dev/null || vd_py_has pytest; then
            if vd_has pytest || vd_py_has pytest; then echo "l1|pytest|py-pytest"; return 0; fi
          fi
          # stdlib unittest — the portable Python floor.
          if vd_has "${PYBIN:-python3}"; then echo "l1|unittest|py-unittest"; return 0; fi
          echo "l1||none"; return 0 ;;
        l2)
          if grep -qiE 'testcontainers' "$root/pyproject.toml" "$root/requirements.txt" 2>/dev/null; then
            echo "l2|testcontainers|py-testcontainers"; return 0
          fi
          echo "l2||none"; return 0 ;;
        l3)
          if grep -qiE 'playwright' "$root/pyproject.toml" "$root/requirements.txt" 2>/dev/null; then
            echo "l3|playwright|py-playwright"; return 0
          fi
          echo "l3||none"; return 0 ;;
      esac ;;

    # ===================== Go (STUB: table rows + dispatch, present:false until wired) ====
    go)
      case "$layer" in
        l0) if vd_has gofmt && vd_has go; then echo "l0|go-vet|go-fmtvet"; return 0; fi; echo "l0||none"; return 0 ;;
        l1) if vd_has go; then echo "l1|go-test|go-test"; return 0; fi; echo "l1||none"; return 0 ;;
        l2) if [ -d "$root" ] && grep -rqs '//go:build integration' "$root" 2>/dev/null; then echo "l2|testcontainers-go|go-tc"; return 0; fi; echo "l2||none"; return 0 ;;
        l3) echo "l3||none"; return 0 ;;
      esac ;;

    # ===================== Rust (STUB) =====================
    rs)
      case "$layer" in
        l0) if vd_has cargo; then echo "l0|clippy|rs-fmtclippy"; return 0; fi; echo "l0||none"; return 0 ;;
        l1) if vd_has cargo; then if vd_has cargo-nextest; then echo "l1|nextest|rs-nextest"; return 0; fi; echo "l1|cargo-test|rs-nextest"; return 0; fi; echo "l1||none"; return 0 ;;
        l2) echo "l2||none"; return 0 ;;
        l3) echo "l3||none"; return 0 ;;
      esac ;;

    # ===================== .NET / JVM / Ruby (STUB rows — DETECT-then-MAP) =====================
    dotnet)
      case "$layer" in
        l0) if vd_has dotnet; then echo "l0|dotnet-format|dn-format"; return 0; fi; echo "l0||none"; return 0 ;;
        l1) if vd_has dotnet; then echo "l1|dotnet-test|dn-test"; return 0; fi; echo "l1||none"; return 0 ;;
        l2) echo "l2||none"; return 0 ;;
        l3) echo "l3||none"; return 0 ;;
      esac ;;
    jvm)
      case "$layer" in
        l0) echo "l0||none"; return 0 ;;
        l1) echo "l1||none"; return 0 ;;
        l2) echo "l2||none"; return 0 ;;
        l3) echo "l3||none"; return 0 ;;
      esac ;;
    ruby)
      case "$layer" in
        l0) if vd_has rubocop; then echo "l0|rubocop|rb-rubocop"; return 0; fi; echo "l0||none"; return 0 ;;
        l1) if vd_has rspec; then echo "l1|rspec|rb-rspec"; return 0; fi; echo "l1||none"; return 0 ;;
        l2) echo "l2||none"; return 0 ;;
        l3) echo "l3||none"; return 0 ;;
      esac ;;
  esac
  echo "${layer}||none"
}
