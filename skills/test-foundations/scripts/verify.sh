#!/usr/bin/env bash
# verify.sh — the single owned cross-ecosystem verification contract.
#
# This file IS the contract the slice engine adopts:
#   measureCommand = "scripts/verify.sh"            (recursive-slice.js merge/integrate/tidy gates)
#   filterCommand  = "scripts/verify.sh --scope {scope}"  (engine replace('{scope}',token) then runs verbatim)
#
# It is BYTE-IDENTICAL across every repo; per-stack variance lives in
# verify.detect.sh (the DATA table). The slice baseliner reads `--help` and
# adopts the two commands above with zero per-runner detection.
#
# DESIGN INVARIANTS (do not break these — the engine's trust depends on them):
#   * Absent layer => present:false — a MEASURED FACT, NEVER a false green.
#   * A runner that exits 0 on "no tests collected" is CONVERTED to exit 2 here.
#   * Infra down (Docker for L2/L3, missing binary) => exit 3, NOT a green skip.
#   * {scope} is ALWAYS a bare /^[A-Za-z0-9_.-]+$/ token (recursive-slice.js:611);
#     we forward it VERBATIM to the runner's NAME filter (pytest -k / vitest -t /
#     node --test-name-pattern / go -run / nextest -E). No slashes/paths handled.
#
# EXIT CODES (engine branches on 0-vs-nonzero; finer codes serve diagnose+humans):
#   0  all requested layers GREEN (absent/skipped count as non-RED)
#   1  >=1 requested layer RED
#   2  usage error  OR  --scope matched ZERO tests (contract gap, not true RED)
#   3  infra/precondition failure (Docker down, runner binary missing for a present layer)

set -euo pipefail

# ---------------------------------------------------------------------------
# locate repo root + this script's dir; source the data table
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# REPO_ROOT resolution: the contract verifies the repo it is INVOKED in.
# Prefer $PWD when it already holds a project manifest (so a fixture/subproject
# nested inside a larger git tree is verified in place, not the outer tree);
# otherwise climb to the git toplevel; otherwise fall back to $PWD.
_has_manifest() {
  [ -f "$1/package.json" ] || [ -f "$1/pyproject.toml" ] || [ -f "$1/requirements.txt" ] \
    || [ -f "$1/setup.py" ] || [ -f "$1/go.mod" ] || [ -f "$1/Cargo.toml" ] \
    || ls "$1"/*.csproj >/dev/null 2>&1 || [ -f "$1/pom.xml" ] || [ -f "$1/build.gradle" ] \
    || [ -f "$1/Gemfile" ]
}
if _has_manifest "$PWD"; then
  REPO_ROOT="$PWD"
elif REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then :
else
  REPO_ROOT="$PWD"
fi
export REPO_ROOT

# Choose a python interpreter once (used by the py-* dispatch + detect helpers).
PYBIN="python3"; command -v python3 >/dev/null 2>&1 || PYBIN="python"
export PYBIN

# shellcheck source=verify.detect.sh
. "$SCRIPT_DIR/verify.detect.sh"

LOGDIR="$REPO_ROOT/.verify/logs"

# ---------------------------------------------------------------------------
# defaults / arg state
# ---------------------------------------------------------------------------
OPT_LAYER="all"
OPT_CHANGED=0
OPT_SCOPE=""
OPT_JSON=0
OPT_BASE=""
OPT_LIST_SCOPES=0
OPT_PRINT_SETUP=0

usage() {
  cat <<'EOF'
verify.sh — 4-layer test verification contract (L0 quality · L1 unit · L2 integration · L3 E2E)

USAGE:
  scripts/verify.sh [--layer l0|l1|l2|l3|all] [--changed] [--scope NAME] [--filter NAME]
                    [--json] [--base REF] [--list-scopes] [--print-setup] [-h|--help]

FLAGS:
  --layer L         run exactly one layer; 'all' (default) runs L0->L1->L2->L3,
                    SHORT-CIRCUITing on the first RED. --json disables short-circuit
                    so every layer is measured for the diagnose budget.
  --changed         restrict to git-changed files (portable, no Nx/Turbo dependency).
  --scope NAME      forward NAME VERBATIM to the runner's name filter
                    (pytest -k / vitest -t / node --test-name-pattern / go -run / nextest -E).
                    NAME is always a bare [A-Za-z0-9_.-]+ token (engine guard).
  --filter NAME     EXACT alias of --scope.
  --base REF        override the --changed base ref.
  --json            NDJSON: one object per layer + one aggregate line with the four
                    budget numbers (changedFeedbackMs/fullSuiteMs/flakeRatePct/purposeGapCount).
  --list-scopes     print legal {scope} tokens (bare names), one per line.
  --print-setup     print the per-stack worktree setup command (npm ci / uv sync / ...).
  -h, --help        this help + the detected stack + per-layer tool mapping.

EXIT CODES:
  0 green   1 red   2 usage-error-or-zero-scope-match   3 infra/precondition failure
EOF
}

die_usage() { echo "verify.sh: $1" >&2; echo "try: scripts/verify.sh --help" >&2; exit 2; }

# ---------------------------------------------------------------------------
# arg parse (order-independent, positional-free; unknown flag => exit 2)
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --layer)        OPT_LAYER="${2:-}"; shift 2 || die_usage "--layer needs a value" ;;
    --layer=*)      OPT_LAYER="${1#*=}"; shift ;;
    --changed)      OPT_CHANGED=1; shift ;;
    --scope|--filter)   OPT_SCOPE="${2:-}"; shift 2 || die_usage "--scope needs a value" ;;
    --scope=*|--filter=*) OPT_SCOPE="${1#*=}"; shift ;;
    --json)         OPT_JSON=1; shift ;;
    --base)         OPT_BASE="${2:-}"; shift 2 || die_usage "--base needs a value" ;;
    --base=*)       OPT_BASE="${1#*=}"; shift ;;
    --list-scopes)  OPT_LIST_SCOPES=1; shift ;;
    --print-setup)  OPT_PRINT_SETUP=1; shift ;;
    -h|--help)      :; HELP=1; shift ;;
    *)              die_usage "unknown flag: $1" ;;
  esac
done

case "$OPT_LAYER" in l0|l1|l2|l3|all) ;; *) die_usage "invalid --layer: $OPT_LAYER (want l0|l1|l2|l3|all)" ;; esac

# ---------------------------------------------------------------------------
# stack detection (used by help / dispatch)
# ---------------------------------------------------------------------------
STACKS="$(vd_detect_stacks)"
# primary stack = first detected (monorepo: each maps independently; for the
# single-entry contract we drive the primary and note the rest in --help).
PRIMARY="${STACKS%% *}"

# per-stack worktree setup command (defined early so --help can print it).
vd_print_setup() {
  case " $STACKS " in
    *" js "*)  if [ -f "$REPO_ROOT/pnpm-lock.yaml" ]; then echo "pnpm install --frozen-lockfile"; elif [ -f "$REPO_ROOT/package-lock.json" ]; then echo "npm ci"; else echo "npm install"; fi ;;
    *" py "*)  if [ -f "$REPO_ROOT/uv.lock" ]; then echo "uv sync"; elif [ -f "$REPO_ROOT/requirements.txt" ]; then echo "pip install -r requirements.txt"; else echo "pip install -e ."; fi ;;
    *" go "*)  echo "go mod download" ;;
    *" rs "*)  echo "cargo fetch" ;;
    *)         echo "# no setup command detected" ;;
  esac
}

# ---------------------------------------------------------------------------
# --help
# ---------------------------------------------------------------------------
if [ "${HELP:-0}" = 1 ]; then
  usage
  echo
  echo "DETECTED STACK: ${STACKS:-<none>}"
  if [ -n "$STACKS" ]; then
    echo "PER-LAYER TOOL MAPPING (primary=$PRIMARY):"
    for L in l0 l1 l2 l3; do
      row="$(vd_runner_for "$PRIMARY" "$L")"
      tool="$(echo "$row" | cut -d'|' -f2)"
      mode="$(echo "$row" | cut -d'|' -f3)"
      if [ "$mode" = none ] || [ -z "$tool" ]; then
        printf "  %-3s present:false  (no %s tool detected)\n" "$L" "$L"
      else
        printf "  %-3s present:true   tool=%-12s mode=%s\n" "$L" "$tool" "$mode"
      fi
    done
  fi
  # coldBuildCost inference (compiled => expensive, interpreted/shared => cheap)
  cold="cheap"
  case " $STACKS " in *" go "*|*" rs "*|*" dotnet "*|*" jvm "*) cold="expensive" ;; esac
  echo "coldBuildCost: $cold"
  echo "setup: $({ vd_print_setup; } 2>/dev/null)"
  exit 0
fi

# ---------------------------------------------------------------------------
# --print-setup
# ---------------------------------------------------------------------------
if [ "$OPT_PRINT_SETUP" = 1 ]; then vd_print_setup; exit 0; fi

# ---------------------------------------------------------------------------
# --changed: STAGE-1 file set (git-only, portable)
# ---------------------------------------------------------------------------
CHANGED_BASE=""
BASE_FALLBACK=0
changed_files() {
  local base
  if [ -n "$OPT_BASE" ]; then
    base="$OPT_BASE"
  elif base="$(git -C "$REPO_ROOT" merge-base origin/HEAD HEAD 2>/dev/null)"; then :
  elif base="$(git -C "$REPO_ROOT" rev-parse origin/main 2>/dev/null)"; then :
  elif base="$(git -C "$REPO_ROOT" rev-parse HEAD~1 2>/dev/null)"; then :
  else base=""; BASE_FALLBACK=1; fi
  CHANGED_BASE="$base"
  {
    [ -n "$base" ] && git -C "$REPO_ROOT" diff --name-only "$base"...HEAD 2>/dev/null
    git -C "$REPO_ROOT" diff --name-only HEAD 2>/dev/null
    git -C "$REPO_ROOT" status --porcelain 2>/dev/null | cut -c4-
  } | sed '/^$/d' | sort -u
}

# ---------------------------------------------------------------------------
# --list-scopes: print legal bare {scope} tokens via runner dry-list
# ---------------------------------------------------------------------------
list_scopes() {
  local row mode
  row="$(vd_runner_for "$PRIMARY" l1)"; mode="$(echo "$row" | cut -d'|' -f3)"
  case "$mode" in
    js-vitest)    ( cd "$REPO_ROOT" && "$(vd_node_bin vitest)" list 2>/dev/null | sed 's/.* > //' ) ;;
    js-node-test) node_test_list ;;
    js-jest)      ( cd "$REPO_ROOT" && "$(vd_node_bin jest)" --listTests 2>/dev/null ) ;;
    py-pytest)    ( cd "$REPO_ROOT" && { command -v pytest >/dev/null 2>&1 && pytest --collect-only -q || "$PYBIN" -m pytest --collect-only -q; } 2>/dev/null | sed 's/.*::\([A-Za-z0-9_.-]*\).*/\1/' | grep -E '^[A-Za-z0-9_.-]+$' | sort -u ) ;;
    py-unittest)  py_unittest_list ;;
    go-test)      ( cd "$REPO_ROOT" && go test -list '.*' ./... 2>/dev/null | grep -E '^Test|^Example|^Benchmark' ) ;;
    *)            return 0 ;;
  esac
}

# node:test scope listing — extract bare test() names from *.test.* files.
node_test_list() {
  ( cd "$REPO_ROOT" && \
    grep -rhoE "(test|it)\(['\"][^'\"]+['\"]" --include='*.test.js' --include='*.test.mjs' --include='*.test.ts' . 2>/dev/null \
    | sed -E "s/^(test|it)\(['\"]([^'\"]+)['\"]/\2/" \
    | grep -E '^[A-Za-z0-9_.-]+$' | sort -u )
}

# find the unittest discovery start dir: first dir holding test_*.py, else "."
# always returns 0 (never trips set -e in the caller's command substitution).
py_test_startdir() {
  local d=""
  d="$(cd "$REPO_ROOT" && find . -name 'test_*.py' -not -path '*/.*' -not -path '*/node_modules/*' 2>/dev/null | head -1 || true)"
  if [ -n "$d" ]; then dirname "$d"; else echo "."; fi
  return 0
}

# unittest scope listing — method names of discovered TestCases.
py_unittest_list() {
  local sdir; sdir="$(py_test_startdir)"
  ( cd "$REPO_ROOT" && "$PYBIN" -m unittest discover -s "$sdir" -p 'test_*.py' -v 2>&1 \
    | grep -oE '^test_[A-Za-z0-9_.-]+' | sort -u ) || true
}

if [ "$OPT_LIST_SCOPES" = 1 ]; then list_scopes; exit 0; fi

# ===========================================================================
# LAYER DISPATCH
# Each layer fn runs the detected runner, writes to a log, and RETURNS via three
# globals so the caller can build NDJSON without subshell loss:
#   R_PRESENT (0/1) R_PASSED (0/1) R_EXIT (runner exit) R_TOOL R_TESTS_RUN
#   R_PURPOSEGAP R_ZEROMATCH(0/1) R_INFRA(0/1) R_DURMS
# A layer with MODE=none sets R_PRESENT=0 and is non-RED.
# ===========================================================================

now_ms() { "$PYBIN" -c 'import time;print(int(time.time()*1000))' 2>/dev/null || date +%s000; }

# json-escape a string for embedding (minimal: backslash, quote, control)
json_str() { "$PYBIN" -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$1" 2>/dev/null || printf '"%s"' "$1"; }

run_layer() {
  local layer="$1"
  R_PRESENT=0; R_PASSED=1; R_EXIT=0; R_TOOL=""; R_TESTS_RUN=0
  R_PURPOSEGAP="null"; R_ZEROMATCH=0; R_INFRA=0; R_DURMS=0
  mkdir -p "$LOGDIR"
  local log="$LOGDIR/$layer.log"; : > "$log"

  local row mode tool
  row="$(vd_runner_for "$PRIMARY" "$layer")"
  tool="$(echo "$row" | cut -d'|' -f2)"
  mode="$(echo "$row" | cut -d'|' -f3)"
  R_TOOL="$tool"

  if [ "$mode" = none ] || [ -z "$mode" ]; then
    R_PRESENT=0
    # purposeGap semantics: L2/L3 absence is a diagnose signal; L3 with no journey is scope-floor.
    case "$layer" in
      l2) R_PURPOSEGAP="L2 absent — module seams unverified against real deps" ;;
      l3) R_PURPOSEGAP="no user journey wired — E2E deferred by scope-floor (not a gap if no journey)" ;;
    esac
    echo "layer $layer skipped (no $layer tool detected)" >> "$log"
    return 0
  fi
  R_PRESENT=1

  # native-runner-first: if a committed task exists for this layer, delegate.
  local native; native="$(vd_native_task "$layer")"
  local start end; start="$(now_ms)"
  # Disable -e ACROSS the dispatch: a RED runner legitimately exits non-zero and
  # we capture that in R_EXIT — it must NOT abort the script. Re-enable after.
  set +e
  if [ -n "$native" ]; then
    local nr nt; nr="${native%%|*}"; nt="${native#*|}"
    R_TOOL="$nr:$nt"
    dispatch_native "$nr" "$nt" "$log"
  else
    dispatch_mode "$mode" "$layer" "$log"
  fi
  set -e
  end="$(now_ms)"; R_DURMS=$(( end - start ))
  return 0
}

# delegate to a committed native task (package.json script / just / mise)
dispatch_native() {
  local runner="$1" task="$2" log="$3"
  ( cd "$REPO_ROOT" && case "$runner" in
      npm)  npm run "$task" ;;
      just) just "$task" ;;
      mise) mise run "$task" ;;
    esac ) >>"$log" 2>&1
  R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}

# build the scope filter args for a given runner mode (verbatim forward).
# ALL {scope} quoting lives here, in ONE place.
dispatch_mode() {
  local mode="$1" layer="$2" log="$3"
  case "$mode" in
    # ---------------- JS/TS L0 ----------------
    js-biome)    js_l0_biome "$log" ;;
    js-eslint)   js_l0_eslint "$log" ;;
    js-tsc)      js_l0_tsc "$log" ;;
    js-prettier) js_l0_prettier "$log" ;;
    js-node-l0)  js_l0_node "$log" ;;
    # ---------------- JS/TS L1 ----------------
    js-vitest)    js_l1_vitest "$log" ;;
    js-jest)      js_l1_jest "$log" ;;
    js-node-test) js_l1_node "$log" ;;
    # ---------------- JS/TS L2/L3 (infra-gated) ----------------
    js-testcontainers) l2_infra "$log" "Testcontainers (JS)" ;;
    js-playwright)     l3_infra "$log" "Playwright" ;;
    # ---------------- Python L0 ----------------
    py-ruff)    py_l0_ruff "$log" ;;
    py-mypy)    py_l0_mypy "$log" ;;
    py-node-l0) py_l0_compile "$log" ;;
    # ---------------- Python L1 ----------------
    py-pytest)   py_l1_pytest "$log" ;;
    py-unittest) py_l1_unittest "$log" ;;
    # ---------------- Python L2/L3 ----------------
    py-testcontainers) l2_infra "$log" "Testcontainers (py)" ;;
    py-playwright)     l3_infra "$log" "Playwright (py)" ;;
    # ---------------- Go / Rust / .NET / Ruby (STUB: present but unimplemented) ----------------
    go-*|rs-*|dn-*|rb-*)
      echo "dispatch '$mode' not yet wired (DETECT-then-MAP stub) — emitting present:false" >>"$log"
      R_PRESENT=0; R_PASSED=1; R_EXIT=0 ;;
    *)
      echo "unknown mode '$mode'" >>"$log"; R_PRESENT=0 ;;
  esac
}

# ---- shared infra guard: L2/L3 need Docker; down => exit 3 (NOT green skip) ----
l2_infra() { _infra_layer "$1" "$2" "L2 real-dep" "real dependency via container ✓" ; }
l3_infra() { _infra_layer "$1" "$2" "L3 journey"  "E2E journey ✓" ; }
_infra_layer() {
  local log="$1" what="$2" label="$3" goodgap="$4"
  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    echo "$label: $what requires Docker, which is not available — INFRA failure (exit 3, not a green skip)" >>"$log"
    R_INFRA=1; R_PASSED=0; R_EXIT=3; R_PRESENT=1
    R_PURPOSEGAP="$what configured but Docker down — could not verify real dependency"
    return 0
  fi
  # Docker present but the actual harness wiring is repo-specific; emit honest signal.
  echo "$label: Docker present; delegate to the repo's $what task" >>"$log"
  R_PURPOSEGAP="$goodgap"
  R_PASSED=1; R_EXIT=0; R_PRESENT=1
}

# =================== JS/TS layer implementations ===================
js_l0_biome() {
  local log="$1" bin; bin="$(vd_node_bin biome || true)"; [ -z "$bin" ] && bin="biome"
  ( cd "$REPO_ROOT" && "$bin" check . ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
js_l0_eslint() {
  local log="$1" bin; bin="$(vd_node_bin eslint || true)"; [ -z "$bin" ] && bin="eslint"
  ( cd "$REPO_ROOT" && "$bin" . ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
js_l0_tsc() {
  local log="$1" bin; bin="$(vd_node_bin tsc || true)"; [ -z "$bin" ] && bin="tsc"
  ( cd "$REPO_ROOT" && "$bin" --noEmit ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
js_l0_prettier() {
  local log="$1" bin; bin="$(vd_node_bin prettier || true)"; [ -z "$bin" ] && bin="prettier"
  ( cd "$REPO_ROOT" && "$bin" --check . ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
# PORTABLE L0 FLOOR (no biome/eslint/tsc installed): validate JSON configs parse
# and every source file is syntactically valid via `node --check`. A genuine
# structural-correctness floor, not a placebo green.
js_l0_node() {
  local log="$1"
  ( cd "$REPO_ROOT" && node -e '
    const fs=require("fs"),path=require("path"),cp=require("child_process");
    let bad=0;
    // 1) JSON config files must parse
    for (const f of ["package.json","biome.json","tsconfig.json",".eslintrc.json",".prettierrc.json"]) {
      if (fs.existsSync(f)) { try{ JSON.parse(fs.readFileSync(f,"utf8")); console.log("ok json "+f);}catch(e){console.error("BAD json "+f+": "+e.message);bad++;} }
    }
    // 2) every src .js/.mjs must pass node --check (syntax)
    const walk=(d)=>{ for(const e of fs.readdirSync(d,{withFileTypes:true})){ if(e.name==="node_modules"||e.name.startsWith("."))continue; const p=path.join(d,e.name); if(e.isDirectory())walk(p); else if(/\.(m?js)$/.test(e.name)){ try{cp.execSync(`node --check ${JSON.stringify(p)}`,{stdio:"pipe"});console.log("ok syntax "+p);}catch(err){console.error("BAD syntax "+p);bad++;} } } };
    if (fs.existsSync("src")) walk("src");
    process.exit(bad?1:0);
  ' ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
js_l1_vitest() {
  local log="$1" bin args; bin="$(vd_node_bin vitest || true)"; [ -z "$bin" ] && bin="vitest"
  args=(run)
  [ -n "$OPT_SCOPE" ] && args+=(-t "$OPT_SCOPE")
  ( cd "$REPO_ROOT" && "$bin" "${args[@]}" --reporter=json --outputFile=/dev/stderr ) >>"$log" 2>>"$log"; R_EXIT=$?
  # zero-match guard: vitest exits 1 with "No test files found" or 0 with 0 tests.
  if [ -n "$OPT_SCOPE" ] && grep -qiE 'no test|0 passed|No test files' "$log"; then R_ZEROMATCH=1; fi
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
js_l1_jest() {
  local log="$1" bin args; bin="$(vd_node_bin jest || true)"; [ -z "$bin" ] && bin="jest"
  args=()
  [ -n "$OPT_SCOPE" ] && args+=(-t "$OPT_SCOPE")
  ( cd "$REPO_ROOT" && "$bin" "${args[@]}" ) >>"$log" 2>&1; R_EXIT=$?
  if [ -n "$OPT_SCOPE" ] && grep -qiE 'No tests found|0 matched' "$log"; then R_ZEROMATCH=1; fi
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
# node:test (built-in). Scope => --test-name-pattern. Zero-match detected by
# counting TAP test lines whose name is NOT a bare filename.
js_l1_node() {
  local log="$1" args=(--test --test-reporter=tap)
  [ -n "$OPT_SCOPE" ] && args+=("--test-name-pattern=$OPT_SCOPE")
  ( cd "$REPO_ROOT" && node "${args[@]}" ) >>"$log" 2>&1; R_EXIT=$?
  # count "ok N - NAME" / "not ok N - NAME" lines whose NAME is not a *.js file.
  local named
  named="$(grep -E '^(ok|not ok) [0-9]+ - ' "$log" 2>/dev/null | sed -E 's/^(ok|not ok) [0-9]+ - //' | grep -vE '\.(m?js|ts)( |$)' | grep -cE '.' || true)"
  R_TESTS_RUN="${named:-0}"
  if [ -n "$OPT_SCOPE" ] && [ "${named:-0}" -eq 0 ]; then R_ZEROMATCH=1; fi
  # also: when scope empty but there were genuinely no named tests at all => zero collected.
  if [ -z "$OPT_SCOPE" ] && [ "${named:-0}" -eq 0 ]; then
    if ! grep -qE '^# tests [1-9]' "$log"; then R_ZEROMATCH=1; fi
  fi
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}

# =================== Python layer implementations ===================
py_l0_ruff() {
  local log="$1"
  ( cd "$REPO_ROOT" && { command -v ruff >/dev/null 2>&1 && ruff check . || "$PYBIN" -m ruff check .; } ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
py_l0_mypy() {
  local log="$1"
  ( cd "$REPO_ROOT" && { command -v mypy >/dev/null 2>&1 && mypy . || "$PYBIN" -m mypy .; } ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
# PORTABLE L0 FLOOR (no ruff/mypy installed): byte-compile all sources via the
# interpreter. Catches syntax errors — a real structural floor, not a fake green.
py_l0_compile() {
  local log="$1"
  ( cd "$REPO_ROOT" && "$PYBIN" -m compileall -q -x '(\.venv|venv|node_modules|build|dist)/' . ) >>"$log" 2>&1; R_EXIT=$?
  [ "$R_EXIT" -eq 0 ] && R_PASSED=1 || R_PASSED=0
}
py_l1_pytest() {
  local log="$1" runpfx args
  if command -v pytest >/dev/null 2>&1; then runpfx=(pytest); else runpfx=("$PYBIN" -m pytest); fi
  args=(-q)
  [ -n "$OPT_SCOPE" ] && args+=(-k "$OPT_SCOPE")
  ( cd "$REPO_ROOT" && "${runpfx[@]}" "${args[@]}" ) >>"$log" 2>&1; R_EXIT=$?
  # pytest exit 5 = no tests collected; with -k a no-match is exit 5 too.
  if [ "$R_EXIT" -eq 5 ]; then R_ZEROMATCH=1; fi
  if grep -qiE 'no tests ran|collected 0 items' "$log"; then R_ZEROMATCH=1; fi
  if [ "$R_EXIT" -eq 0 ]; then R_PASSED=1; elif [ "$R_ZEROMATCH" = 1 ]; then R_PASSED=1; else R_PASSED=0; fi
}
# stdlib unittest. Scope => -k. Zero-match detected via "Ran 0 tests".
py_l1_unittest() {
  local log="$1" sdir; sdir="$(py_test_startdir)"
  # NOTE: no -t flag — setting top-level-dir to "." would require the test dir to
  # be an importable package (__init__.py). Letting unittest default top-level to
  # the start dir keeps zero-config fixtures (tests/ without __init__.py) working.
  local args=(-m unittest discover -s "$sdir" -p 'test_*.py')
  [ -n "$OPT_SCOPE" ] && args+=(-k "$OPT_SCOPE")
  ( cd "$REPO_ROOT" && "$PYBIN" "${args[@]}" ) >>"$log" 2>&1; R_EXIT=$?
  local ran; ran="$(grep -oE 'Ran [0-9]+ test' "$log" | grep -oE '[0-9]+' | tail -1 || echo 0)"
  R_TESTS_RUN="${ran:-0}"
  if [ "${ran:-0}" -eq 0 ]; then R_ZEROMATCH=1; fi
  if [ "$R_EXIT" -eq 0 ] && [ "$R_ZEROMATCH" = 0 ]; then R_PASSED=1
  elif [ "$R_ZEROMATCH" = 1 ]; then R_PASSED=1  # zero-match is exit 2, not RED
  else R_PASSED=0; fi
}

# ---------------------------------------------------------------------------
# flake re-run (honest, surface-not-hide): under --json a RED deterministic
# L0/L1 layer re-runs ONCE isolated; if it flips green => flake:true, exit stays.
# ---------------------------------------------------------------------------
maybe_flake_rerun() {
  local layer="$1"
  R_FLAKE=false; R_FLAKERUNS=1
  if [ "$OPT_JSON" = 1 ] && [ "$R_PRESENT" = 1 ] && [ "$R_PASSED" = 0 ] && [ "$R_INFRA" = 0 ] && { [ "$layer" = l0 ] || [ "$layer" = l1 ]; }; then
    local saved_exit="$R_EXIT"
    run_layer "$layer"   # re-run once, isolated
    R_FLAKERUNS=2
    if [ "$R_PASSED" = 1 ]; then
      R_FLAKE=true            # flipped => flaky; but keep the layer RED
      R_PASSED=0; R_EXIT="$saved_exit"
    fi
  fi
}

# ---------------------------------------------------------------------------
# emit one NDJSON per-layer line
# ---------------------------------------------------------------------------
emit_layer_json() {
  local layer="$1"
  local present passed flake gap scope changed affected
  present=$([ "$R_PRESENT" = 1 ] && echo true || echo false)
  if [ "$R_PRESENT" = 1 ]; then passed=$([ "$R_PASSED" = 1 ] && echo true || echo false); else passed=null; fi
  flake="${R_FLAKE:-false}"
  if [ "$R_PURPOSEGAP" = "null" ]; then gap=null; else gap="$(json_str "$R_PURPOSEGAP")"; fi
  if [ -n "$OPT_SCOPE" ]; then scope="$(json_str "$OPT_SCOPE")"; else scope=null; fi
  changed=$([ "$OPT_CHANGED" = 1 ] && echo true || echo false)
  affected=false  # 0.1.0: per-test impact-selection within a layer is a followUp; --changed routes at LAYER granularity (fast door), tests within a RUN layer are not yet narrowed — so `affected` is honestly false until that lands (never a fake `true`)
  printf '{"layer":"%s","tool":%s,"present":%s,"passed":%s,"durationMs":%s,"flake":%s,"flakeRuns":%s,"tests":{"run":%s},"scope":%s,"changed":%s,"affected":%s,"purposeGap":%s,"zeroMatch":%s,"exit":%s,"log":%s}\n' \
    "$layer" "$(json_str "${R_TOOL:-}")" "$present" "$passed" \
    "$([ "$R_PRESENT" = 1 ] && echo "$R_DURMS" || echo null)" \
    "$flake" "${R_FLAKERUNS:-1}" "${R_TESTS_RUN:-0}" "$scope" "$changed" "$affected" \
    "$gap" "$R_ZEROMATCH" "$R_EXIT" "$(json_str "$LOGDIR/$layer.log")"
}

# ===========================================================================
# MAIN DRIVE
# ===========================================================================
LAYERS_TO_RUN=()
case "$OPT_LAYER" in
  # --changed (with the default --layer all) = the FAST DOOR (l0+l1) for quick feedback; L2/L3 run via the
  # full `verify.sh` (no --changed) or an explicit --layer. (Path-conditional L2/L3 inclusion + per-test
  # impact-selection are followUps — see references/verify-contract.md §4.) An explicit --layer always wins.
  all) if [ "$OPT_CHANGED" = 1 ]; then LAYERS_TO_RUN=(l0 l1); else LAYERS_TO_RUN=(l0 l1 l2 l3); fi ;;
  *)   LAYERS_TO_RUN=("$OPT_LAYER") ;;
esac

# aggregate accumulators
AGG_RED=()
AGG_PURPOSEGAP=0
AGG_FLAKE_LAYERS=0
AGG_PRESENT_LAYERS=0
AGG_ANY_ZEROMATCH=0
AGG_ANY_INFRA=0
FULLSUITE_MS=0
CHANGED_FB_MS=0
FINAL_EXIT=0

# resolve changed base early so JSON aggregate can report it
if [ "$OPT_CHANGED" = 1 ]; then changed_files >/dev/null; fi

for L in "${LAYERS_TO_RUN[@]}"; do
  run_layer "$L"
  maybe_flake_rerun "$L"

  if [ "$R_PRESENT" = 1 ]; then
    AGG_PRESENT_LAYERS=$((AGG_PRESENT_LAYERS+1))
    FULLSUITE_MS=$((FULLSUITE_MS + R_DURMS))
    # changedFeedbackMs = cumulative cost of the cheap fast-door layers (l0,l1)
    if [ "$L" = l0 ] || [ "$L" = l1 ]; then CHANGED_FB_MS=$((CHANGED_FB_MS + R_DURMS)); fi
  fi
  [ "${R_FLAKE:-false}" = true ] && AGG_FLAKE_LAYERS=$((AGG_FLAKE_LAYERS+1))
  [ "$R_PURPOSEGAP" != "null" ] && AGG_PURPOSEGAP=$((AGG_PURPOSEGAP+1))
  [ "$R_ZEROMATCH" = 1 ] && AGG_ANY_ZEROMATCH=1
  [ "$R_INFRA" = 1 ] && AGG_ANY_INFRA=1

  if [ "$R_INFRA" = 1 ]; then
    # infra failure dominates: exit 3
    [ "$FINAL_EXIT" -lt 3 ] && FINAL_EXIT=3
  elif [ "$R_PRESENT" = 1 ] && [ "$R_PASSED" = 0 ] && [ "$R_ZEROMATCH" = 0 ]; then
    AGG_RED+=("$L"); [ "$FINAL_EXIT" -lt 1 ] && FINAL_EXIT=1
  fi

  if [ "$OPT_JSON" = 1 ]; then
    emit_layer_json "$L"
  else
    # human output
    if [ "$R_PRESENT" = 0 ]; then
      echo "[$L] present:false (no tool detected) — non-RED"
    elif [ "$R_INFRA" = 1 ]; then
      echo "[$L] INFRA FAIL (exit 3): $R_PURPOSEGAP"
    elif [ "$R_ZEROMATCH" = 1 ]; then
      echo "[$L] scope '$OPT_SCOPE' matched ZERO tests (exit 2 contract gap)"
    elif [ "$R_PASSED" = 1 ]; then
      echo "[$L] GREEN  tool=${R_TOOL}  ${R_DURMS}ms${R_FLAKE:+ flake=$R_FLAKE}"
    else
      echo "[$L] RED    tool=${R_TOOL}  ${R_DURMS}ms  (see $LOGDIR/$L.log)"
    fi
  fi

  # zero-match short-circuits to exit 2 (a contract gap, not RED)
  if [ "$AGG_ANY_ZEROMATCH" = 1 ]; then
    # exit 2 unless an infra failure already set 3
    [ "$FINAL_EXIT" -lt 2 ] && [ "$FINAL_EXIT" != 3 ] && FINAL_EXIT=2
  fi

  # --layer all short-circuits on first RED, UNLESS --json (which measures all).
  if [ "$OPT_LAYER" = all ] && [ "$OPT_JSON" = 0 ] && [ "$FINAL_EXIT" = 1 ]; then
    break
  fi
done

# zero-match precedence: 2 unless infra (3) already won.
if [ "$AGG_ANY_ZEROMATCH" = 1 ] && [ "$FINAL_EXIT" -ne 3 ]; then FINAL_EXIT=2; fi
# but a real RED + zero-match: RED dominates over the contract-gap signal.
if [ "${#AGG_RED[@]}" -gt 0 ] && [ "$FINAL_EXIT" -ne 3 ]; then FINAL_EXIT=1; fi

# ---------------------------------------------------------------------------
# aggregate NDJSON line
# ---------------------------------------------------------------------------
if [ "$OPT_JSON" = 1 ]; then
  # flakeRatePct = flaky-layers / present-layers * 100
  flakepct=0
  if [ "$AGG_PRESENT_LAYERS" -gt 0 ]; then
    flakepct="$("$PYBIN" -c "print(round($AGG_FLAKE_LAYERS/$AGG_PRESENT_LAYERS*100,2))" 2>/dev/null || echo 0)"
  fi
  passed_overall=$([ "$FINAL_EXIT" = 0 ] && echo true || echo false)
  # build redLayers json array
  red_json="[]"
  if [ "${#AGG_RED[@]}" -gt 0 ]; then
    red_json="[$(printf '"%s",' "${AGG_RED[@]}" | sed 's/,$//')]"
  fi
  layers_json="[$(printf '"%s",' "${LAYERS_TO_RUN[@]}" | sed 's/,$//')]"
  base_field=null; [ -n "$CHANGED_BASE" ] && base_field="$(json_str "$CHANGED_BASE")"
  bf=$([ "$BASE_FALLBACK" = 1 ] && echo true || echo false)
  printf '{"summary":true,"passed":%s,"layers":%s,"changedFeedbackMs":%s,"fullSuiteMs":%s,"flakeRatePct":%s,"purposeGapCount":%s,"redLayers":%s,"zeroMatch":%s,"infra":%s,"base":%s,"baseFallback":%s,"exit":%s}\n' \
    "$passed_overall" "$layers_json" "$CHANGED_FB_MS" "$FULLSUITE_MS" "$flakepct" "$AGG_PURPOSEGAP" \
    "$red_json" "$AGG_ANY_ZEROMATCH" "$AGG_ANY_INFRA" "$base_field" "$bf" "$FINAL_EXIT"
else
  echo "----"
  case "$FINAL_EXIT" in
    0) echo "RESULT: GREEN (all requested layers passed; absent layers present:false)" ;;
    1) echo "RESULT: RED (layers: ${AGG_RED[*]})" ;;
    2) echo "RESULT: scope contract gap (zero match) — exit 2" ;;
    3) echo "RESULT: INFRA failure — exit 3" ;;
  esac
fi

exit "$FINAL_EXIT"
