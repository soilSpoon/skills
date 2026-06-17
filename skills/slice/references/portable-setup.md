# Portable setup — running the slice engine FAST + reliably on any machine / language

How to set up a new computer so a slice-engine run is fast and trustworthy, organised by the two costs
that actually dominate wall-clock and the per-language knobs that cut them. (Speed is a trust axis — a
correct-but-hour-long tool is not a trusted tool.)

## The mental model: two costs, two independent fixes

An engine run's wall-clock ≈ **Σ(model round-trips)** + **Σ(build/test time)**. These are SEPARATE costs
with SEPARATE fixes — diagnose which one dominates before optimising:

1. **Shell-as-agent tax (the HOST cost).** The Claude Code *Workflow* runtime is a sandbox with no
   `exec()` (probe-confirmed: `require`/`process`/`import()` all blocked). So every `git`/build/test the
   engine runs goes out as a full *subagent* round-trip (~30–60 s each of spawn + queue + throttle). On a
   compile-bound repo, **~75 % of all agent spawns** are these shell proxies. → **Fix: a native-exec host.**
2. **Compiler time (the BUILD cost).** On compile-bound languages (Swift/Rust/C++/JVM) the per-leaf build
   dominates. The engine can cut *redundant* builds (fewer leaves, build-once-at-integration) but cannot
   make the compiler faster. → **Fix: a per-language compile cache, shared across worktrees.**

A fast-build repo (TS/Python/Go) is bottlenecked by #1; a compile-bound repo by both. Fix the dominant one first.

---

## Step 1 — auth / billing (Claude Max plans)

- **`unset ANTHROPIC_API_KEY`.** Claude Code uses it *over* your subscription if it is set anywhere in the
  environment, silently billing pay-as-you-go API instead of your plan. `env | grep ANTHROPIC` and clear it.
- Authenticate with the subscription (`claude` login, or `claude setup-token` for a long-lived token).
- *(As of 2026-06 the announced "Agent SDK → separate credit pool" change is PAUSED — Agent-SDK usage
  currently draws on the Max subscription. Re-check Settings › Usage; this can change.)*
- Model tiering protects quota: **Opus** only for hard judgment (baseliner, heavy verify); **Sonnet/Haiku**
  for executors, filters, and the shell proxy. A run that is 80 % Sonnet is ~2–3× faster than 80 % Opus
  *and* spares the weekly Opus cap.

## Step 2 — pick the HOST (fixes the shell-as-agent tax)

| Host | shell | models | billing | use it when |
|---|---|---|---|---|
| **Claude Code Workflow** (default) | agent-proxy (taxed) | Claude | Max subscription | FAST-build repos (TS/Py/Go) — the tax is small when each build is ~1 s |
| **Claude Agent SDK adapter** (`adapters/claude-agent-sdk`) | **native `execFile`** | Claude | Max subscription* | COMPILE-bound repos — kills the per-build round-trip while staying on Claude/the subscription |
| **opencode adapter** (`adapters/opencode`) | **native `execFile`** | any provider ($) | your own API keys | non-Claude models / OpenRouter / off-subscription |

Run the engine on the SDK adapter (a real Node process, so `sh()` = native exec):
```sh
node adapters/claude-agent-sdk/run.mjs --repo <path> --task "…" [--parallel] [--max-depth N]
```
Both native-exec adapters keep the engine's whole discipline (the deterministic `sh()` is *more*
deterministic run natively — it never touches a model). See [portable-orchestration.md](portable-orchestration.md)
for the four orchestration invariants any host must uphold.

## Step 3 — the RIG (the trust floor — language-agnostic)

The engine adopts ONE verify entry as its gate:
- **measureCommand** — the full build + test (the ship gate, run once at integration).
- **filterCommand** — `<entry> --filter <scope>` (the fast per-leaf loop).

Scaffold it with the `test-foundations` skill (it produces `scripts/verify.sh` with both axes). Keep the
filtered loop genuinely fast and reserve the full suite for the integration gate (filter-test the loop /
full-suite the ship-gate). If the baseliner reports no runnable rig, the engine *halts before any work* —
that gate is pointing you here.

## Step 4 — per-language BUILD-SPEED setup (fixes compiler time)

> Pattern: **compile-bound → set up a SHARED compile cache and point every worktree at it; fast-build →
> skip caching and rely on the native-exec host (Step 2).** Cross-worktree parallel *cold* builds are a
> near-mirage (one build already saturates the cores) — the win is shared-cache *hits*, not parallelism.

| Language | compile-bound | cache mechanism | shared dir (cross-worktree) |
|---|---|---|---|
| **Swift** | YES (heavy) | **Xcode CAS** via `xcodebuild` (see worked example) | `COMPILATION_CACHE_CAS_PATH=~/.cache/<proj>-cas` |
| **Rust** | YES | **sccache** (`export RUSTC_WRAPPER=sccache`) | `SCCACHE_DIR=~/.cache/sccache` |
| **C / C++** | YES | **ccache** or **sccache** (compiler wrapper) | `CCACHE_DIR` / `SCCACHE_DIR` |
| **Kotlin / JVM** | YES | **Gradle build cache** (`org.gradle.caching=true`) + the Gradle daemon | `~/.gradle/caches` |
| **Go** | mild | built-in build cache (already shared per-user) | `GOCACHE` (default) |
| **TypeScript / JS** | NO (esbuild/swc/tsup ≈ ms) | — none needed — | — |
| **Python** | NO (no compile) | — none needed — | — |

The shared dir is the leverage: a content-addressed cache means worktree B's clean build *hits* worktree
A's compile. Keep each worktree's build/scratch dir **per-checkout** (do not share it — SwiftPM/Cargo take
an exclusive lock on it and would serialise) and share only the *cache*.

### Swift — the worked example (proven here: ~4.3×)

`swift build`/`swift test` do **not** engage compilation caching (they warn "cannot be used without
explicit module build" → 0 cache hits — verified). CAS needs `xcodebuild` + a full Xcode.

1. Install **full Xcode** (≥ 26 for compilation caching); `sudo xcode-select -s /Applications/Xcode.app`.
2. Build + test via:
   ```sh
   xcodebuild test -scheme <Package> -derivedDataPath .build/xcode-dd -destination 'platform=macOS' \
     COMPILATION_CACHE_ENABLE_CACHING=YES COMPILATION_CACHE_CAS_PATH="$HOME/.cache/<proj>-cas"
   ```
   The **derivedData** is per-checkout (`.build/...`); the **CAS** is shared (`~/.cache/...`). The default
   CAS lives *inside* derivedData — wiped on a clean build (0 hits); an external `COMPILATION_CACHE_CAS_PATH`
   is what makes clean/cross-worktree builds hit (100 %).
3. **Test-target module hygiene (one-time).** xcodebuild's explicit-module resolution is *stricter* than
   `swift test`: a test that imports a module **outside its target's dependency graph** fails with
   `unable to resolve module dependency`. `swift test` tolerates it (it builds every module into one
   space); xcodebuild — the CAS prerequisite — does not. **Move such tests to the target whose graph
   covers their imports** (a test belongs with its subject anyway), or declare the missing dependency.
4. Measured: one target 284 → 67 s; full package 128 → 30 s (99 % cache hits). Residual = linking the
   static archive (CAS does not cache the link) + dependency resolution.
5. Wire it into the rig so the engine inherits it: make `scripts/test.sh` (or `verify.sh`) take the
   `xcodebuild + CAS` path when a full Xcode is selected and fall back to `swift test` on CLT-only machines.

### Fast-build languages (TS / JS / Python / Go)

Compile caching buys little — builds are already ~ms–1 s. Here the *only* meaningful lever is the
**native-exec host** (Step 2): on the Workflow runtime even a 1 s `npm test` costs a full ~40 s agent
round-trip, so a repo with 50 such calls pays ~30 min in pure transport. The SDK/opencode adapter removes it.

## Step 5 — proportional ceremony (don't over-pay)

- Don't run the full engine on a change you already fully understand — that is over-ceremony; a clear
  single edit is faster done directly with the engine's *discipline* (red-first, verify) than its machinery.
- Don't mandate per-leaf artifact rebuilds; rebuild once at integration.
- Keep leaf count down — over-decomposition multiplies every per-leaf cost (build + executor + verifier).

## One-screen checklist for a new machine

```
[ ] unset ANTHROPIC_API_KEY ; claude login (subscription)
[ ] host: compile-bound repo? → use adapters/claude-agent-sdk (native exec). fast-build? → Workflow is fine.
[ ] rig: scripts/verify.sh exists (test-foundations) with a fast --filter path + a full-suite gate
[ ] build cache (if compile-bound): set the language's shared cache dir; wire it into the rig
        Swift→Xcode CAS · Rust/C++→sccache/ccache · JVM→Gradle cache · Go→GOCACHE · TS/Py→none
[ ] models: Opus = judgment only; Sonnet/Haiku = executors/shell ; concurrency ~10–15
```
