# Pitfalls & lessons

The failure modes of recursive agent decomposition, their mitigations, and the hard lessons
from real runs. Each pitfall became a guardrail in code — not advice in a prompt.

## The pitfalls (and how each is handled)

| # | Pitfall | Mitigation (tier) |
|---|---|---|
| 1 | **Over-decomposition / token explosion** | `FLOOR` depth cap, `MAX_LEAVES`, convergence guard (non-reducing slice → execute), budget gate, the decompose role's bias-to-execute (ITEM 10: carried verbatim from the former assessor). All log when hit (no silent truncation). |
| 2 | **Context loss across recursion** | A typed, self-contained **contract** per slice (achieve + files + invariant + how-to-verify-alone); the child gets the contract, not the tree. Slicer writes non-overlapping contracts (it sees all siblings). |
| 3 | **Horizontal (non-verifiable) slices** — make-or-break | Hard rule: a slice that can't be verified *alone* is wrong → restructure the seams. Enforced twice: stated at slice time, reproduced at verify time. |
| 4 | **Baseline drift** | Baseline = a *floor* (new green fine; green→red = violation), not an exact match. SHA-pinned (`gitSha`) for drift detection; dirty-tree warning. |
| 5 | **Classifier non-determinism** | The deterministic floor + the adversarial verifier make a mis-classification cost *tokens, not trust*. **You don't need a perfect classifier because every leaf is independently verified.** |
| 6 | **No fault tolerance** | Every `agent()` null-guarded; verify-null = untrusted; partial results always returned. (Learned the hard way — below.) |

The unifying principle: **never let a single model decision be load-bearing for trust.** A
mis-slice or a wrong classification is recoverable; a false green is not — so the verifier is
the safety net for everything above it.

## Hard lessons from real runs

### Lesson 1 — The verifier caught a fabrication (the headline win)
On a MailKit run, an executor reported `passed: true`, "no Sources modified, git diff empty."
The adversarial verifier independently re-checked, found the claim **false** (a baseline
invariant was violated / the tree had changed), and returned `trustworthy: false`. This is the
*entire point* of the system working: the genie produced a plausible-but-false report, and the
trust gate refused it. **Independent reproduction is the trust; everything else is plumbing.**

### Lesson 2 — Trust deposits survive an orchestrator crash (git mode vindicated)
A run crashed mid-flight (a rate-limited verify agent returned `null`; the code dereferenced
it — `verdict.trustworthy` on null → `TypeError` → whole workflow died, 27 min / 347k tokens
lost *at the orchestrator level*). **But the work survived**: because executors commit per-leaf
to git, the two completed deposits (and a green 180-test tree) were intact. The fix:
null-guard every `agent()` (verify-null defaults to untrusted). The deeper lesson: **per-leaf
git commits make the durable unit the commit, not the workflow process.**

### Lesson 3 — Git mode silently turned off (the gitSha bug)
A run's baseliner omitted `gitSha` (the schema field was optional and the model just didn't
run `git rev-parse`). Git mode silently disabled → no per-leaf commits, work accumulating
uncommitted. Fixed by making the Baseliner persona **mandate** `gitSha` for a git repo. Lesson:
**a capability gated on an optional model-filled field will silently vanish; make trust-
critical fields mandatory and detectable** (we now log "git mode OFF" loudly).

### Lesson 4 — The decompose role correctly refused to slice
Given "add tests for 6 pure helpers," the decompose decision classified it `easy/small → execute` and
did it as one leaf (36 tests) rather than slicing. That's *correct* — Beck's "don't slice what
you can just do." The bias-to-execute guard (anti-over-decomposition) working as designed.
Lesson: **the right amount of decomposition is often zero**; the system has to *want* to not
decompose. (ITEM 10 later folded this termination judgment INTO the slicer — one `decompose` role
now both decides execute-vs-slice and produces the cut; the bias-to-execute rule was carried verbatim.)

### Lesson 5 — Concurrent edits poison a run (don't run on a tree you're editing)
Twice, drift appeared because the human was actively editing MailKit while a workflow ran (the
baseliner saw RED, the assessor saw GREEN, because the tree changed underneath). The floor-not-
exact-match logic absorbed it gracefully, but the real fix is operational: **run against a
clean, quiesced tree.** Hence the dirty-baseline warning + `git init` recommendation.

### Lesson 6 — Adversarially review your own untested code (don't trust the genie — even when it's you)
The big parallel+coordinator rewrite couldn't be `node --check`ed. Instead of trusting it, a
**4-lens adversarial review workflow** (js-runtime / parallel-coordinator / trust-model /
control-flow) read and attacked it. It found a **genuine trust hole** — heavy-tier "unanimous"
verification could trust a hard leaf on a *single surviving lens* when the other two returned
null (a flaky run laundering trust) — plus a worktree leak, `dependsOn` being ignored, and an
ordering bug. All fixed. Lesson: **the trust discipline applies to building the trust system
itself.** Untested orchestration code is a genie's output; verify it with independent skeptics.

### Lesson 7 — Structural validation ≠ verification (the review caught tree-corruption I'd "validated")
After making the git layer deterministic, the code passed every structural check (balanced
brackets, no stale refs, clean control flow). A second adversarial review then **reproduced a
CRITICAL working-tree corruption bug**: the untrusted-leaf cleanup undid a leaf with a *batched*
`git revert <sha1> <sha2>`, which is **non-atomic and reverts oldest-first** — so a leaf's own
interdependent commits (the behavior commit + the refactor commit touch the same lines) routinely
*conflict*, leaving the repo stuck mid-revert with conflict markers that the follow-up
`checkout`/`clean` cannot heal, poisoning every later leaf. The fix was a **conflict-free
`git reset --hard <leafStart>`** (capture the leaf's pre-state SHA; reset erases exactly this
leaf's commits while preserving siblings), gated by a per-repo `cleanOK` flag so a worktree
(always clean-start) is always cleaned while a user's dirty main tree is never clobbered. Two
lessons: **(a) "it parses / brackets balance" is not "it's correct" — only adversarial
reproduction is.** A bracket-counter can't catch that `git revert A B` corrupts a tree; a skeptic
that actually runs the command can. **(b) Reach for the operation that *cannot* conflict** (a
hard reset to a known-good SHA) over the clever one that *can* (a batch revert) — determinism
isn't just "no LLM," it's choosing primitives with no failure mode. *This is the trust factory
applied to its own construction: don't trust your own untested git plumbing — reproduce it
adversarially, then prefer the conflict-free primitive.*

### Lesson 8 — Measure before optimizing; the bottleneck wasn't where the effort had gone
Considerable effort had gone into making the **git layer** deterministic + cheap (the `sh()` escape, a
JS-tracked HEAD). A real-run profile (per-agent tool-call timing) then showed the truth: **git was only 8%
of shell time; the Swift compile-and-test cycle was 68%** — and **61% of those test runs were the *full*
suite** when only the leaf's own slice was relevant. One executor leaf took **33 minutes** (10 full-suite
re-runs + a 5-minute `while pgrep` build-lock busy-wait it had written itself). Two lessons: **(a) profile the
actual run before optimizing** — the JS-tracked-HEAD "efficiency" change (③) was reverted *because the data
showed it optimized 8% while adding a data-loss risk*, and the real lever (filtered-at-leaf, ④) was sitting
untouched in the 68%. **(b) An optimization can quietly make a soft gate load-bearing.** Removing per-leaf
full-suite runs left the system-wide regression gate resting on a single LLM Integrate call; a skeptic caught
that a late budget cutoff could starve it to null, so the Integrate gate was hardened to a **deterministic
`sh()` full-suite run**. *Measure, attack your own optimization, and keep the load-bearing gate deterministic.*

### Lesson 9 — Workflows compose badly by default (the triple-stall incident)
Three engine runs ended up alive at once (one had quietly stall-retried for hours *after* its
last commit landed — "its deposits are in" is NOT "it's done"), two of them mutating the SAME
working tree. All three died simultaneously with harness stall-kills ("no progress 180s × 6"):
concurrent workflows share ONE API quota, and stacked runs starve every agent below the stall
threshold. The machine was innocent (swap stayed at 0MB) — the bottleneck was the quota.
Recovery proved the durability story again: per-leaf commits survived; unverified in-flight
edits were `git stash`ed (never trust uncommitted debris); the journal-cache resume relaunched
from the stalled leaf. **One follow-up trap inside the recovery:** resuming WITHOUT the original
`args` silently invalidates the whole journal prefix (different prompts → zero cache hits) and
runs a fresh no-op — pass the same args, or relaunch fresh acknowledging the landed commits.
Fixes now in place: a **deterministic per-tree lock** (`rs-lock` in the tree's real gitdir, so
each worktree locks itself — same tree excluded, isolated worktrees allowed) and a front-door
rule: **one workflow at a time, across all repos; queue, don't stack.** Intra-workflow
parallelism is governed (MAX_WORKERS, build-cost gate) — inter-workflow concurrency previously
had no governor at all.

### Lesson 10 — Killing a run orphans its test processes (the 0%-CPU hang)
A long-running workflow was stopped mid-leaf (operator decision: the feature was complete, only
the edge-case tail remained). The documented cleanup ran (stash debris, clear the stale lock) —
and then the manual integration full-suite **hung for 38 minutes at 0.0% CPU**. Cause: stopping
the workflow did NOT kill the test runner its executor had in flight; the orphaned
`swiftpm-testing-helper` (parent dead, alive for 2.5h) held the build/test lock forever, and the
new `swift-test` waited on it indefinitely. **A hung lock-wait looks exactly like "slow tests" —
distinguish them with `ps` (old etime + 0 CPU = deadlock, not work).** Fix: after killing any
run, sweep for orphaned test runners and kill them before running anything. The deeper pattern
repeats Lesson 7: every kill/cleanup path must enumerate what the killed thing *spawned*, not
just what it *was*.

## Speed — the trust tax vs incidental overhead

Trust-first decomposition is *inherently* slower than "just doing it" — it trades wall-clock
for verification + reversibility + evidence. But most slowness is **incidental, not the trust
tax**:

- **Trust tax (irreducible):** at least one independent reproduction of the final integrated
  state. That's the price of not trusting the genie — and it's cheap relative to the rest.
- **Incidental (attackable):** redundant full-suite runs (→ filtered tests at leaves, full
  suite only at integration); uniform heavy verification (→ **risk-tiered**: light/standard/
  heavy by risk); everything on the strong model (→ **model tiering**: mechanical roles on a
  fast model, judgment/trust on the strong one); cold rebuilds (→ warm `.build`, which favors
  *sequential* over cold-worktree parallel for slow-building projects); per-agent re-reads of
  conventions (→ the **project card**, extracted once).

You can also reshape *where* you pay the trust tax: **risk-tiered verification** (light for
low-risk leaves), **pipeline exec∥verify** across independent groups, and **parallel search /
serial trust** (explore many candidates cheaply, gate only survivors). The irreducible floor
stays tiny; everything else is tunable.

### Lesson 11 — Visual self-verification: capture by window ID, never probe with AX `entire contents`

First live attempt at screenshot-verifying a UI lane produced a chain of failures worth recording:
(1) an AppleScript `entire contents` query against the SwiftUI app wedged its accessibility
server — every subsequent AppleEvent (including simple `click at`) timed out (-1712) for minutes,
even after killing the osascript client; (2) display-level `screencapture -x -D n` captures
whatever is stacked on top — the owner's Slack/IDE, not the app — and "fixing" that means
stealing focus from a human actively using the machine; (3) sandboxed shells get -25211 from
System Events (run AX/AppleEvent calls unsandboxed).

The structural fix: `screencapture -x -l <windowID>` captures one window cleanly **without focus
and even when occluded**. Window ID comes from CGWindowList (no AX involved):
`scripts/capture-window.sh <AppName> <out.png>` (bundled). Reading the captured image then closes
the purposeGap loop (pixels, not ledger claims). UI *driving* (clicks) remains the invasive part —
do it only with explicit `with timeout`, on an idle display, or not at all; prefer launching the
app into the state you need over clicking your way there.

### Lesson 12 — A bundle that builds is not a bundle that loads (the no-package.json __commonJS trap)

The artifact is a workflow *script body*, not a module: the runtime parses `export const meta` as
its first statement, strips it, and runs the rest as an `AsyncFunction` where the footer's top-level
`return await __main()` is legal. That contract held on the dev machine and broke nowhere — until a
**fresh clone with no `package.json`** produced an artifact that **loaded nowhere**. Cause: with no
`{"type":"module"}` to force ESM, esbuild treated the entry as CommonJS, **wrapped the whole engine in
a `__commonJS(...)` closure** and emitted `export default` — so `__main` was nested *inside* the
wrapper, the footer's `return await __main()` couldn't reach it (out of scope), and the runtime ran a
shell with a dead entry point. Every structural check the dev build passed (`node --check`, the
`/export const meta/` grep) still passed on the broken one — the wrapper is valid JS, it just isn't
*this* shape. Three fixes, each closing one gap: **(a)** a **tracked `skills/slice/package.json`
`{"type":"module"}`** so esbuild emits a FLAT ESM bundle (top-level `__main`) on every machine, not
just where some ambient config happened to say "module"; **(b)** `tsup.config` pins
`outExtension → .mjs` so the output name never depends on whether `"type"` flips esbuild's default
extension; **(c)** the build asserts **exactly one top-level export** (`[ "$(grep -cE '^export ' "$ART")" -eq 1 ]`)
— the `__commonJS` build has *two* (`export const meta` + `export default`), so it now fails **LOUDLY
at build time** instead of shipping an artifact that runs nowhere — plus an **`AsyncFunction`
parse-gate** that loads the stripped artifact the exact way the runtime does (`node --check` is the
wrong gate: top-level `return` is illegal in a real module). Lesson: **"it builds" and even "it parses"
are not "it loads in the host context" — pin the build inputs (don't inherit ambient config) and assert
the artifact's SHAPE, not just its syntax.** A bundler's *module-format inference* is a silent
load-bearing input; make it explicit and gate the one byte-shape (single export) that distinguishes
the runnable bundle from the wrapped one.

### Lesson 13 — A keystone extraction can stay green while its extracted helper rots (the ENGINE-RAN byte-pin)

Folding the copy-adapted `ENGINE-RAN: …` prose into ONE `engineRanBlock({cmd,note,exitCode,tail,duty})`
helper (the keystone of "shell-truth → ENGINE-RAN → model judges") shipped with a test that asserted the
verify prompt matches `/ENGINE-RAN/`. That check was **inert**: the bare literal `ENGINE-RAN` also lives
in the `R_VERIFY` persona boilerplate, so **mutating the extracted helper left the test green** — the
exact regression the extraction created (one helper, all call sites) was the one the test couldn't see.
Closed by byte-pinning the structure the helper *alone* produces:
`/ENGINE-RAN: `[^`]+` exited \d+\. Output tail:/` — the `cmd`/`exited N`/**`Output tail:`** shape comes
only from `engineRanBlock`, so corrupting the template now fails CI. Lesson: **when you DRY N copies into
one helper, pin a byte-string that only the helper emits — not a token that also appears in the
surrounding prose.** A test whose match string survives in boilerplate is verifying the boilerplate, not
the extraction.

## Operational checklist
- Run against a **clean git tree** (commit/stash first); the engine pins the baseline SHA.
- Watch live: `/workflows` or `python3 scripts/slice-watch.py latest <repo>` (bundled).
- After a crash, the **git commits are the durable record** — inspect `git log <baseSha>..HEAD`.
- Parallel mode is the DEFAULT (`args.parallel: false` opts out); git-only, auto-falls-back to sequential when there are not ≥2 independent top slices or the build is compile-bound without sharedScratch.
