// Phase: the recursive decomposition+execution loop for ONE work unit (the leaf loop), the engine's core.
// Extracted from main.ts VERBATIM via a deps-factory (makeRunWork): the body is byte-for-byte unchanged
// except (1) wrapped in the factory, (2) its closed-over services destructured from `d`, (3) the over-tier
// write goes through the `overTier` ref object (was a module-level let). Recursion works because the inner
// `function runWork` self-references within the factory scope. The tsup bundle re-inlines this module.
import { DECOMPOSE, SLICES, LEARNING, RESULT, MISSING } from '../schemas'
import { R_SLICE, R_EXEC, R_CRITIC } from '../prompts'
import { circuitBreaker, engineRanBlock } from '../util'
import type { Breaker } from '../util'
import type { Host } from '../host'
import type { ShResult, TraceRecord, AgentOpts, WorkNode, ExecResult, Verdict, RiskTier, SliceKind, LeafRecord, Decompose, SliceSpec, Baseline, GateLevel, Limits, GitCtx } from '../types'

declare function agent(prompt: string, opts?: AgentOpts): Promise<any>
declare function parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>
declare function phase(title: string): void
declare function log(message: string): void
declare const budget: { total: number | null; spent(): number; remaining(): number }

export type RunWorkDeps = {
  host: Host
  cfg: Limits
  git: GitCtx
  SCRATCH: string
  trace: (rec: TraceRecord) => Promise<void>
  verifyLeaf: (lbl: string, node: WorkNode, res: ExecResult, tier: RiskTier | undefined, repo: string, leafStart: string, engineT0: string, buildNote: string) => Promise<Verdict>
  t0redBreaker: Breaker
  LEAF_TEST: (scope?: string) => string
  INV: string
  ABORTS: string[]
  RE_ZERO_TESTS: RegExp
  overTier: { stop: string; slices: number }
  baseline: Baseline
}

export const makeRunWork = (d: RunWorkDeps) => {
const { host, cfg, git, SCRATCH, trace, verifyLeaf, t0redBreaker, LEAF_TEST, INV, ABORTS, RE_ZERO_TESTS, overTier, baseline } = d
const { sh, shBatch, agentSafe, getQuotaHalt, MARKER } = host
const { FLOOR, MAX_LEAVES, MAX_DISCOVERED, MAX_SPIKES, MAX_REPAIR, MAX_REPAIR_HARD, MAX_UNTRUSTED_STREAK, CONFIRM_TIER } = cfg
const { REPO, GIT, GIT_EXEC } = git
async function runWork(rootTask: string, repo: string, startDepth: number, gid?: number | string, cleanOK?: boolean, kind?: SliceKind, buildNote?: string): Promise<{ done: LeafRecord[] }> {
  buildNote = buildNote || ''
  const tag = gid != null ? `g${gid}:` : ''
  const stack: WorkNode[] = [{ task: rootTask, ctx: '', depth: startDepth, spikes: 0, kind: kind || 'behavior' }]
  const done: LeafRecord[] = []
  const executedKeys = new Set<string>()
  let discovered = 0
  // ITEM 11a: UNIT-scope breaker (fresh per runWork invocation) — N consecutive untrusted leaves means
  // the APPROACH is failing; halt this unit instead of grinding the budget into more reverts. No class gate.
  const untrustedBreaker = circuitBreaker(MAX_UNTRUSTED_STREAK)
  const keyOf = (s: unknown) => String(s).trim().slice(0, 120)

  while (stack.length && done.length < MAX_LEAVES) {
    const node = stack.pop()!   // loop condition guarantees a non-empty stack
    const atFloor = node.depth >= FLOOR
    // ITEM 10: ONE 'decompose' decision per node, returned by ONE agent (the merged Slicer/assess role).
    // ② An atomic slice was already sized + risk-judged when it was emitted — it is a LEAF; the engine
    //   bottoms out on it directly with NO decompose call. ① For a non-atomic node, ONE R_SLICE+DECOMPOSE
    //   call returns BOTH the action (execute|slice|spike — bias HARD to execute) AND, when action:'slice',
    //   the cut itself (slices[]) — the assessment and the cut are one judgment, no longer two round-trips.
    //   The depth-floor forced-execute and the spike-cap stay deterministic JS guards around this call.
    let d: Decompose | null = null, action: Decompose['action']
    if (node.atomic) {
      action = 'execute'
    } else {
      d = (await agentSafe(
        `${R_SLICE}\n\nRepo: ${repo}\nDecide this node's next action (bias HARD toward execute), then act.\n` +
        `Task: ${node.task}\n${node.ctx ? 'Context: ' + node.ctx + '\n' : ''}` +
        `Depth ${node.depth}/${FLOOR}${atFloor ? ' (AT FLOOR — you must return execute)' : ''}.\n${INV}\n` +
        `If action:'execute' set this leaf's riskTier. If action:'slice' emit thin, VERTICAL, ` +
        `independently-verifiable slices with a self-contained contract each (group near-identical units; ` +
        `2-5 slices; isolate any risky seam first).`,
        { phase: 'Work', label: `${tag}decompose:d${node.depth}`, model: 'sonnet', schema: DECOMPOSE })) as Decompose | null
      if (!d) log(`${tag}decompose failed [d${node.depth}] — defaulting to execute`)
      action = (atFloor || !d) ? 'execute' : d.action
      if (action === 'spike' && node.spikes >= MAX_SPIKES) action = 'execute'
    }

    if (action === 'slice') {
      // The merged decompose call ALREADY returned the cut (d.slices) in the SAME round-trip — no
      // separate slicer call. (A null/empty slices array with action:'slice' falls through to the
      // non-reducing→execute guard below, exactly as the old separate-slicer empty result did.)
      let slices: SliceSpec[] = (d && d.slices) || []
      // B2: the completeness critic's marginal value is highest at SHALLOW depth (top-level scenario gaps);
      // re-running it at EVERY deep recursion level multiplies leaves for little extra trust (excess ceremony —
      // proportional-ceremony). Bound to depth ≤ 1 (root + first level); deeper plan-gaps are still caught by
      // per-leaf discovery (the executor's `discovered` scenarios), so this trims runtime, not the trust floor.
      if (slices.length > 1 && node.depth <= 1) {
        const crit: { missing?: Array<{ desc: string; contract: string }> } | null = await agentSafe(
          `${R_CRITIC}\n\nRepo: ${repo}\nTask: ${node.task}\nProposed list:\n` +
          slices.map((s, j) => `${j + 1}. ${s.desc}`).join('\n') + `\n${INV}`,
          // agentType:'Explore' — the completeness critic is READ-ONLY + additive-only (it gates
          // NO trust, only proposes missing scenarios, with inline input). The Explore recon agent
          // (reads excerpts, returns conclusions) fits exactly and is leaner than the default agent.
          // NOT for verifier/lens (they MUST keep Bash to re-run — Bash-less verify silently
          // defeats the fabricated-green catch, main.ts fabricated-green lesson) nor baseliner
          // (Explore skips CLAUDE.md, which the baseliner must read to build the project card).
          { phase: 'Work', label: `${tag}critic:d${node.depth}`, agentType: 'Explore', schema: MISSING })
        if (crit && crit.missing && crit.missing.length) {
          slices = slices.concat(crit.missing.map(m => ({ ...m, kind: 'behavior' })))   // critic items are always behavior scenarios
          log(`${tag}completeness critic +${crit.missing.length} missing scenario(s)`)
        }
      }
      if (slices.length <= 1) {
        log(`${tag}non-reducing slice [d${node.depth}] → execute`)
        action = 'execute'
      } else {
        log(`${tag}slice [d${node.depth}] → ${slices.length}`)
        if (node.depth === 0) {
          // ③ PREDICTABILITY backstop (deterministic — the Lesson-14 guard for the prompt-strength
          // "quote an ETA before launch" rule). Surface run MAGNITUDE from the root breadth + coldBuildCost
          // so "long" is never a surprise, and so an over-tiered low-risk task is caught at launch. The
          // completeness critic + per-leaf discovery EXPAND this floor, so the real run is larger.
          const compileBound = baseline!.coldBuildCost === 'expensive'
          log(`${tag}⟂ SCALE: ${slices.length} top-level slice(s) (a FLOOR — the completeness critic + per-leaf discovery expand it)${compileBound ? '; compile-bound → each leaf is a full build cycle, wall-clock ∝ leaf count' : ''}. If you diagnosed this task low-risk/file:line, that is the over-tier signal — prefer inline T1, not a multi-leaf engine run.`)
          // OVER-TIER GATE (deterministic, HARD-to-trip): a compile-bound repo with a small breadth where EVERY
          // slice was explicitly judged light is inline-T1 work — stop before any leaf runs unless the caller
          // confirmed. STRICT .every(=== 'light'): a single non-light slice OR any completeness-critic addition
          // (riskTier undefined) flips this false → the engine runs, so trust is preserved exactly where fragile.
          if (compileBound && slices.length <= 3 && slices.every(s => s.riskTier === 'light') && !CONFIRM_TIER) {
            overTier.stop = `compile-bound repo, ${slices.length} low-risk slice(s) — inline T1 work`; overTier.slices = slices.length
            log(`${tag}⟂ OVER-TIER STOP: this looks like inline-T1 work (compile-bound + ${slices.length} all-light slice(s)). Doing it inline is faster. To force the engine anyway, re-run with confirmTier:true. (No leaves ran; nothing changed.)`)
            return { done: [] }
          }
        }
        for (let j = slices.length - 1; j >= 0; j--) {
          const iface = slices[j].interface
          const ifaceCtx = (iface && !/^TBD/i.test(iface.trim())) ? `\nInterface (FIXED): ${iface}` : ''
          stack.push({ task: slices[j].desc, ctx: `Contract: ${slices[j].contract}${ifaceCtx}`, kind: slices[j].kind || node.kind || 'behavior', atomic: slices[j].atomic, riskTier: slices[j].riskTier, testScope: slices[j].testScope, seamPointers: slices[j].seamPointers, depth: node.depth + 1, spikes: 0 })
        }
        continue
      }
    }

    if (action === 'spike') {
      const learn: { summary: string } | null = await agentSafe(
        `You are the Spiker (Beck: concrete hypotheses — make the uncertainty small, falsifiable, and cheap).\n` +
        `Repo: ${repo}\nDe-risk this hard-but-small task with the smallest experiment / minimal ` +
        `reproduction (remove extraneous detail; learn, don't build): ${node.task}\n${node.ctx}`,
        { phase: 'Work', label: `${tag}spike:d${node.depth}`, model: 'sonnet', schema: LEARNING })
      stack.push({ ...node, ctx: `${node.ctx}\nLEARNED: ${learn ? learn.summary : '(spike produced no result)'}`, spikes: node.spikes + 1 })
      log(`${tag}spike [d${node.depth}]: ${node.task.slice(0, 50)}`)
      continue
    }

    // ---- execute leaf: Canon TDD + tier-0 gate + risk-tiered verify + self-repair ----
    // Reserve enough for ONE more leaf + the integrate net: a leaf (exec+verify) measured ~60-100k tokens,
    // and once spent() hits the hard ceiling agent() THROWS mid-leaf (losing `done` + leaking the lock).
    if (getQuotaHalt() || (budget.total && budget.remaining() < 120_000)) { log(`${tag}${getQuotaHalt() ? 'quota halt' : 'budget low'} — stopping after ${done.length} leaves`); break }
    const k = keyOf(node.task)
    if (executedKeys.has(k)) continue
    executedKeys.add(k)
    const i = done.length
    const lbl = `${tag}${i}`
    // ITEM 10: the leaf's verification tier. tidy → standard; an atomic slice carries its own riskTier;
    // a non-atomic node executed directly takes the riskTier the merged decompose decision set on the
    // execute branch (the former assessor's difficulty→tier mapping is now the role's explicit riskTier).
    const tier = node.kind === 'tidy' ? 'standard' : (node.atomic ? (node.riskTier || 'standard') : ((d && d.riskTier) || 'standard'))
    // ③ Tidy-First: a tidy leaf is a behavior-PRESERVING prep — verified by the existing suite, not by new tests.
    const TIDY = node.kind === 'tidy' ? '\nTIDY-FIRST leaf (Beck — make the change easy): a behavior-PRESERVING structural change ONLY (rename/extract/generalize/move). Do NOT add or change any test; do NOT change observable behavior — the EXISTING suite must stay green UNCHANGED. EXCEPTIONS for this tidy leaf: its proof IS the existing suite, so run the FULL existing suite once (this overrides the never-full-suite speed rule); and commit as ONE refactor commit (this replaces the two-hats behavior+refactor commit pair — a tidy leaf has no behavior step).' : ''

    // Capture this leaf's pre-state for a CONFLICT-FREE deterministic restore. `git reset --hard
    // <leafStart>` erases exactly this leaf's commits + edits while preserving sibling commits —
    // replacing the non-atomic, oldest-first `git revert` that corrupted the tree on interdependent
    // (behavior+refactor) commits. `restore()` only acts when SAFE: in a worktree (always clean-start)
    // or a clean main tree (cleanOK); on a DIRTY main tree it is a no-op so a user's work is never clobbered.
    // Deterministic pre-leaf HEAD for the conflict-free restore anchor. (A JS-tracked HEAD was reverted:
    // advancing it from the LLM-reported res.commits risked drift → reset --hard could destroy a trusted
    // sibling's commits, and a SAFE advance needs a real rev-parse anyway, so it saved nothing. — review)
    const leafStart = GIT ? (((await sh(`git -C ${repo} rev-parse HEAD 2>/dev/null || true`, `head:${lbl}`)).stdout || '').match(/[0-9a-f]{40}/i) || [''])[0] : ''
    // A3: restore() returns true only when it actually ran the revert (GIT+cleanOK+leafStart all
    // set AND sh calls were dispatched). During QUOTA_HALT the inner sh() calls no-op, so we check
    // the exitCode of the first sh to decide: QUOTA_HALT makes sh return SH_UNAVAILABLE (-2) which
    // means the restore was a no-op — callers must not log 'restored to' in that case.
    // ITEM 6 (LATENCY): the per-leaf restore was 2 SERIAL sh() spawns (reset --hard, then clean -fdq)
    // for every untrusted leaf. They are sequential-deterministic git on the same tree — BATCHED into
    // ONE sh() round-trip. Each sub-command keeps its EXIT MARKER so a reset/clean failure is still
    // detected per-command (the reset marker drives the return value verbatim). A dead proxy / quota
    // halt makes the WHOLE batch return SH_UNAVAILABLE → no reset marker → returns false (the old
    // `r.exitCode !== -2` no-op semantics, byte-equivalent: restore did not run).
    const restore = async (): Promise<boolean> => {
      if (!GIT || !cleanOK || !leafStart) return false
      const b = await shBatch(
        `git -C ${repo} reset --hard ${leafStart}; printf '<<RS:reset:%s>>\\n' "$?"; ` +
        `git -C ${repo} clean -fdq -e .rs-wt -e .rs-scratch; printf '<<RS:clean:%s>>\\n' "$?"`,   // drop untracked files the leaf created (never the shared build dir)
        `reset:${lbl}`)
      // reset marker present ⇔ the reset sub-command actually ran (proxy alive, not a quota no-op).
      // Absent (SH_UNAVAILABLE / protocol break) = no-op → false, exactly as `r.exitCode !== -2` did.
      return b.get('reset') !== null
    }

    let res: ExecResult | null = null, verdict: Verdict | null = null, attempt = 0, prevIssueCount = Infinity
    // ITEM 1: which deterministic trust-floor gate actually ran THIS leaf. Default 'llm-only' (no
    // deterministic gate); the gate block below upgrades it to 'deterministic-filtered' or 'full-suite'
    // when the engine actually ran shell-truth. A leaf that stays 'llm-only' is a LOUD, auditable
    // trust-floor downgrade (the Lesson-3 class) — logged + recorded + collected run-wide.
    let gateLevel: GateLevel = 'llm-only'
    while (true) {
      const repair = attempt === 0 ? '' :
        `\nREPAIR ATTEMPT ${attempt}: a prior attempt was REJECTED by review for: ` +
        `${JSON.stringify((verdict && verdict.issues && verdict.issues.length ? verdict.issues : [verdict && verdict.reason]).slice(0, 6).map(s => String(s).slice(0, 300)))}. ` +
        (verdict && verdict.prescription ? `\nREVIEWER'S PRESCRIBED FIX (apply exactly unless evidently wrong): ${String(verdict.prescription).slice(0, 1200)}\n` : '') +
        (GIT && cleanOK && leafStart ? `FIRST undo your prior attempt with \`git -C ${repo} reset --hard ${leafStart}\` (sibling commits survive), then re-implement fresh; ` : '') +
        `then fix exactly those objections. In git mode add a fresh commit.`
      const seamCtx = (node.seamPointers && node.seamPointers.length)
        ? `\nSeam Pointers (already resolved by the Slicer — confirm each via Read BEFORE using; lines may be stale):\n${node.seamPointers.map((p) => `  - ${p.file}${p.line != null ? `:${p.line}` : ''}${p.symbol ? ` (${p.symbol})` : ''}${p.currentText ? ` — "${p.currentText}"` : ''}`).join('\n')}`
        : ''
      res = await agentSafe(
        `${R_EXEC}\n\nRepo: ${repo}\nDo EXACTLY this one atomic task.\nTask: ${node.task}\n${node.ctx}${seamCtx}\n${INV}${node.kind === 'tidy' ? '' : LEAF_TEST(node.testScope)}${GIT_EXEC}${TIDY}${buildNote}${repair}`,
        { phase: 'Work', label: `exec:${lbl}${attempt ? '.r' + attempt : ''}`, model: 'sonnet', schema: RESULT })
      if (!res) break
      // ITEM 7: trace the executor call (cost dimension — model:sonnet, which repair attempt). Distinct
      // from the leaf-verify line below: this records the EXECUTOR was spawned (executor!=verifier — the
      // two roles are even two trace lines), so the profile shows exec cost separately from verdict. Placed
      // AFTER the `!res` break so a DEAD executor doesn't fire a (successful) trace sh — that would reset the
      // agentSafe quotaBreaker and mask a real session-instability halt (observed: A6 mixed-class streak).
      await trace({ phase: 'Work', role: `exec:${lbl}`, model: 'sonnet', leafIndex: i, repairAttempt: attempt })
      // tier-0 deterministic gate: a RED leaf never reaches the LLM verifier (wasted budget + noise).
      if (!res.passed) { verdict = { trustworthy: false, reason: 'tier-0 gate: deterministic build/tests RED' } }
      else {
        // I1: ENGINE-owned tier-0 — re-run the leaf's FILTERED tests via sh() (shell truth, not the
        // executor's claim: a green was once fabricated and only an LLM verifier caught it). Needs a
        // machine-usable template + an injection-safe scope; tidy leaves exempt (their proof is the
        // full existing suite). On engine-RED the LLM verifier is skipped entirely (budget + noise).
        let engineT0 = '', t0red: Verdict | null = null
        // No '|' in the whitelist: the scope is substituted UNQUOTED, so '|' would become a shell pipe
        // (exit 127 → false RED). One suite per slice; multi-suite scopes just skip the engine gate.
        // Gate scope: the slicer-assigned node.testScope is authoritative; if absent/unsafe (a root executed
        // directly as ONE cohesive leaf has none — the 2026-06-16 MailKit dogfood gap, where 3/3 leaves
        // silently went llm-only), fall back to the bare-token scope the EXECUTOR reports its tests run under
        // (res.testScope) so the spec-first→slice→gate token thread still binds a deterministic filtered gate.
        // Failure mode is the status quo: a wrong res.testScope zero-matches → the existing finding path (below)
        // degrades THIS leaf to llm-only — never a false RED.
        const okScope = (s: unknown): s is string => !!s && /^[A-Za-z0-9_.-]+$/.test(String(s))
        const gateScope = okScope(node.testScope) ? node.testScope : (okScope(res.testScope) ? res.testScope : '')
        const t0cmd = (node.kind !== 'tidy' && gateScope && baseline!.filterCommand && baseline!.filterCommand.includes('{scope}'))
          ? baseline!.filterCommand!.replace('{scope}', gateScope) : ''
        // ITEM 1: a NON-tidy leaf with NO runnable filtered gate (missing/disabled filterCommand, or an
        // unsafe/multi-suite scope) silently fell through to the LLM verifier ALONE — a silent trust-floor
        // downgrade with no record (the Lesson-3 class). Make it LOUD: name the leaf and the reason. (A tidy
        // leaf is excluded here — its deterministic gate is the full-suite run below, not a filtered t0.)
        if (!t0cmd && node.kind !== 'tidy') {
          log(`${tag}⚠ WARN: leaf ${i} (${node.task.slice(0, 36)}) gate=llm-only (no filterCommand/scope) — trust rests on the LLM verifier + the integrate net`)
        }
        if (t0cmd) {
          // In shared-scratch parallel mode the engine's own filtered run must hit the shared build dir
          // too (assumes the filter template passes appended flags through — documented opt-in).
          const t0 = await sh(`cd ${repo} && ${t0cmd}${(SCRATCH && repo !== REPO) ? ` --scratch-path ${SCRATCH}` : ''}`, `t0:${lbl}`)
          if (t0.exitCode !== 0) {
            const t0tail = String(t0.stdout || '')
            if (RE_ZERO_TESTS.test(t0tail)) {
              // ① ZERO tests matched (scope/name mismatch, NOT a failure, NOT a broken template). Do NOT
              // t0red and do NOT trip the breaker — else one mismatched scope kills gating run-wide. This
              // leaf stays gate=llm-only (default); hand the verifier the finding to confirm independently.
              log(`${tag}⚠ leaf ${i} t0 filter matched ZERO tests (scope='${gateScope}' ≠ any test name) → gate=llm-only for THIS leaf only (scope mismatch, breaker untouched)`)
              engineT0 = engineRanBlock({
                cmd: t0cmd, note: '(filter matched ZERO tests — scope/name MISMATCH, NOT a pass)',
                exitCode: t0.exitCode, tail: t0tail.slice(-300),
                duty: `The engine's filtered gate matched ZERO tests under scope \`${gateScope}\` — the executor's testScope does not match any test it added (a FINDING; common with Swift Testing function-name filters). Do NOT treat this as green: independently confirm the leaf's tests exist and pass, or distrust.` })
            } else {
              t0red = { trustworthy: false, reason: `tier-0 (ENGINE-run filtered tests) RED: \`${t0cmd}\` exited ${t0.exitCode} though the executor reported green`, issues: [`deterministic filtered run failed (exit ${t0.exitCode}); output tail: ${t0tail.slice(-300)}`] }
              // A BROKEN template (env/wrapper/filter-syntax) false-REDs every leaf run-wide. After 2
              // consecutive engine-RED-vs-executor-green disagreements, distrust the TEMPLATE, not the
              // leaves — kill it and fall back to LLM verification (the pre-gate path).
              if ((t0redBreaker.record(), t0redBreaker.tripped())) { baseline!.filterCommand = ''; log(`${tag}engine t0 disagreed with executor-green ${t0redBreaker.streak}× in a row — suspecting a broken filterCommand template; disabling the engine gate (LLM verify takes over)`) }
            }
          } else {
            t0redBreaker.reset()
            gateLevel = 'deterministic-filtered'   // ITEM 1: the engine ran the filtered tier-0 (green) — full trust floor held
            // Exit 0 is NOT proof tests ran: a typo'd scope can match ZERO tests and still exit 0 —
            // blind "ENGINE-VERIFIED" would LAUNDER a vacuous green while muzzling the verifier. Hand
            // the verifier the output and the zero-tests duty instead of an assertion.
            engineT0 = engineRanBlock({
              cmd: t0cmd, exitCode: 0, tail: String(t0.stdout || '').slice(-300),
              duty: `FIRST confirm from that output that at least one test ACTUALLY EXECUTED under scope \`${gateScope}\` — ` +
                `zero tests matched = a FINDING (vacuous gate / scope-suite mismatch): distrust or re-run yourself. ` +
                `If tests did run, do NOT re-run them — audit the ARTIFACTS (diff scope, test meaningfulness, over-fit, interface drift).` })
          }
        }
        // B1: tidy leaf behavior-preservation gate — engine runs the FULL measure command deterministically
        // (not the executor's claim: a tidy "existing suite is GREEN" was once a self-report with no proof).
        // Passing ENGINE-RAN into verifyLeaf lets the verifier judge the artifact instead of re-running the
        // suite itself (resolving the R_VERIFY "NEVER the whole suite" vs tidy "run the full suite" contradiction).
        if (!t0red && node.kind === 'tidy' && baseline!.measureCommand) {
          const tidyFull = await sh(`cd ${repo} && ${baseline!.measureCommand}`, `tidy-fullsuite:${lbl}`)
          if (tidyFull.exitCode !== 0) {
            t0red = { trustworthy: false, reason: `tidy-fullsuite (ENGINE-run full suite) RED: measureCommand exited ${tidyFull.exitCode} (behavior not preserved)`, issues: [`full suite failed for tidy leaf; output tail: ${String(tidyFull.stdout || '').slice(-300)}`] }
          } else {
            gateLevel = 'full-suite'   // ITEM 1: tidy leaf — engine ran the FULL measure command (its deterministic proof)
            engineT0 = engineRanBlock({
              cmd: baseline!.measureCommand!, note: '(full suite — tidy behavior-preservation gate)',
              exitCode: 0, tail: String(tidyFull.stdout || '').slice(-300),
              duty: `Confirm from that output that the existing suite is actually green (zero tests run = vacuous). ` +
                `Do NOT re-run the suite yourself — judge the ARTIFACTS: diff scope, no test added/changed/deleted, pure structural refactor, no observable behavior change.` })
          }
        }
        // A repaired leaf is verified at the SAME tier or stricter — never looser (a leaf that failed the
        // heavy gate must not pass on a single standard reproduction after repair).
        verdict = t0red || await verifyLeaf(lbl, node, res, attempt === 0 ? tier : (tier === 'light' ? 'standard' : tier), repo, leafStart, engineT0, buildNote)
      }
      if (verdict.trustworthy) break
      // I2: convergence-aware repair — extend past MAX_REPAIR up to MAX_REPAIR_HARD ONLY while the
      // objection count STRICTLY shrinks round-over-round (deterministic convergence proxy; a diverging
      // leaf that grows new objections each round still stops at the default budget).
      const issueCount = (verdict.issues || []).length || 1
      const converging = issueCount < prevIssueCount
      if (attempt >= MAX_REPAIR && !(converging && attempt < MAX_REPAIR_HARD)) break
      if (getQuotaHalt() || (budget.total && budget.remaining() < 120_000)) { log(`${tag}${getQuotaHalt() ? 'quota halt' : 'budget low'} — stopping repairs (leaf ${i} stays untrusted → reverted)`); break }
      // Cross-tier fairness: a LIGHT attempt-0 verdict (cursory, few issues) vs a STANDARD repair
      // re-verify (thorough, more issues) reads as divergence even when the leaf improved — don't
      // let the thoroughness jump eat the convergence extension; compare from the escalated tier on.
      prevIssueCount = (attempt === 0 && tier === 'light') ? Infinity : issueCount
      log(`${tag}leaf ${i} untrusted (tier=${res.passed ? tier : 'tier0-red'}, ${issueCount} issue(s)${attempt > 0 && converging ? ', converging' : ''}) → self-repair ${attempt + 1}/${converging ? MAX_REPAIR_HARD : MAX_REPAIR}`)
      attempt++
    }
    if (!res) {
      log(`${tag}leaf ${i} exec FAILED (no result) — restoring, continuing`)
      await restore()   // undo anything the dead executor left
      done.push({ task: node.task, passed: false, summary: 'executor returned no result (API/rate-limit)', verdict: { trustworthy: false, reason: 'executor failed' } })
      if ((untrustedBreaker.record(), untrustedBreaker.tripped())) {
        ABORTS.push(`${tag || 'main:'} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`)
        log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure suspected). Integrate still runs.`)
        break
      }
      continue
    }
    done.push({ task: node.task, ...res, verdict, gateLevel })   // ITEM 1: record which deterministic gate actually ran (auditable trust floor)
    log(`${tag}leaf ${i} ${res.passed ? 'green' : 'RED'} | tier=${tier}${attempt ? ` (repaired×${attempt})` : ''} | gate=${gateLevel} | ${verdict!.trustworthy ? 'trusted' : 'NOT trusted'}: ${node.task.slice(0, 36)}`)
    // ITEM 7: emit the leaf's cost/verdict profile line — the single richest trace record (carries the
    // leafIndex, the deterministic gateLevel from ITEM 1, the final trust verdict, and how many repairs it
    // took). This is exactly the per-leaf profile Lesson 8 needed a human to reconstruct from logs.
    await trace({ phase: 'Work', role: `leaf-verify:${lbl}`, model: 'verify', leafIndex: i, gateLevel, trustworthy: verdict!.trustworthy, repairAttempt: attempt })

    // An untrusted leaf (incl. a RED/tier-0 leaf with only uncommitted edits) must leave NOTHING behind.
    if (GIT && !verdict!.trustworthy) {
      // A3: only log 'restored to' when restore() ACTUALLY ran the revert (exitCode !== -2).
      // During QUOTA_HALT the inner sh() calls no-op (SH_UNAVAILABLE), so restored=false here —
      // avoid the false 'restored to' log that would mislead the user into thinking state was reset.
      const restored = await restore()
      log(`${tag}leaf ${i} untrusted → ${restored ? `restored to ${leafStart.slice(0, 8)}` : (!cleanOK ? 'NOT auto-cleaned (dirty main baseline — left to protect your uncommitted work)' : !leafStart ? 'NOT auto-cleaned (HEAD capture failed — left as-is, flagged for Integrate)' : 'NOT auto-cleaned (restore skipped — quota halt or sh proxy unavailable)')}`)
    }

    // A: run-level no-progress detection — leaf-level guards (convergence, repair caps) bound ONE leaf,
    // but nothing detected a run going systemically wrong; N consecutive reverted leaves = stop and
    // surface ("the approach is failing"), don't grind the remaining budget into more reverts.
    if (verdict!.trustworthy) untrustedBreaker.reset(); else untrustedBreaker.record()
    if (untrustedBreaker.tripped()) {
      ABORTS.push(`${tag || 'main:'} ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — unit halted`)
      log(`${tag}⚠ ${MAX_UNTRUSTED_STREAK} consecutive untrusted leaves — halting this unit (systemic failure: wrong decomposition / broken env / API trouble). Integrate still runs.`)
      break
    }

    // ① + I4: batch the executor's discovered scenarios AND the verifier's concrete followUps (trusted
    //    leaves only — an untrusted leaf's findings describe reverted code) into ONE follow-up leaf
    //    (one build/verify) instead of N. Edge-case TESTS for now-stable code → batching is Canon-TDD-
    //    safe; if one needs a behavior change, the executor flags it back via `discovered` (bounded).
    // Trusted leaves only — an UNTRUSTED leaf was reverted, so both its discovered items and its
    // verifier followUps describe code that no longer exists.
    const feed = verdict!.trustworthy ? [...(res.discovered || []), ...(verdict!.followUps || [])] : []
    if (feed.length) {
      const fresh = feed.map(String).filter(d => !executedKeys.has(keyOf(d))).slice(0, Math.max(0, MAX_DISCOVERED - discovered))
      if (fresh.length) {
        fresh.forEach(d => executedKeys.add(keyOf(d)))   // mark so the same scenario can't re-spawn
        discovered += fresh.length
        const batchTask = `Address these ${fresh.length} discovered/review-flagged scenario(s) as ONE leaf (the ` +
          `implementation is stable, so batching tests is Canon-TDD-safe — write a meaningful test for each):\n- ${fresh.join('\n- ')}\n` +
          `If ANY scenario actually needs an IMPLEMENTATION/behavior change (not just a test), do NOT force it — note it in \`discovered\` for a focused follow-up.`
        // Batch leaf INHERITS the parent's testScope: scenarios discovered while working a scope
        // almost always live in/near that suite, and inheritance arms the engine t0 gate for the
        // batch (previously batch leaves carried no scope → the deterministic gate never fired).
        stack.push({ task: batchTask, ctx: `Discovered while doing "${node.task.slice(0, 40)}".`, kind: 'behavior', atomic: true, riskTier: 'standard', testScope: node.testScope, depth: node.depth, spikes: 0 })
        log(`${tag}+${fresh.length} discovered → 1 batched follow-up leaf`)
      }
    }
  }
  if (done.length >= MAX_LEAVES) log(`${tag}NOTE: hit MAX_LEAVES — work truncated`)
  return { done }
}
  return runWork
}
