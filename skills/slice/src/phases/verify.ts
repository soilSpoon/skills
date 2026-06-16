// Phase: adversarial leaf verification (the trust gate). Extracted from main.ts verbatim via a
// deps-factory (makeVerifyLeaf) so the orchestrator wires its shared services in once; the body is
// UNCHANGED — only the closed-over deps are now destructured from `d`. The tsup bundle re-inlines this.
import { VERDICT } from '../schemas'
import { R_VERIFY, R_VERIFY_LIGHT } from '../prompts'
import type { WorkNode, ExecResult, Verdict, RiskTier, ShResult, GitCtx, Runtime } from '../types'
import type { Host } from '../host'

export type VerifyDeps = {
  rt: Runtime
  host: Host
  git: GitCtx
  LEAF_TEST: (scope?: string) => string
  INV: string
  ENGINE_DIFF_CAP: number
}

export const makeVerifyLeaf = (d: VerifyDeps) => {
  const { rt, host, git, LEAF_TEST, INV, ENGINE_DIFF_CAP } = d
  const { parallel } = rt
  const { sh, agentSafe, shUnavailable } = host
  const { gitVerify, GIT } = git
  return async (lbl: string, node: WorkNode, res: ExecResult, tier: RiskTier | undefined, repo: string, leafStart: string, engineT0: string, buildNote: string, diffRange?: string): Promise<Verdict> => {
  // ④ tidy: engine already ran the full suite (ENGINE-RAN); light: diff-audit path — no filter-run;
  // engineT0 non-empty: engine already ran filtered gate — injecting LEAF_TEST is contradictory noise.
  const leafTest = (node.kind === 'tidy' || tier === 'light' || !!engineT0) ? '' : LEAF_TEST(node.testScope)
  // F5: the executor's own ADMISSIONS (discovered/refactor/interfaceConcern) are the verifier's best leads —
  // never truncate those away; clip only the prose. The real diff is read via git, not from `res.diff`.
  const reported = JSON.stringify({
    summary: String(res.summary || '').slice(0, 400), passed: res.passed,
    evidence: String(res.evidence || '').slice(0, 500),
    filesChanged: res.filesChanged, commits: res.commits, refactor: res.refactor,
    interfaceConcern: res.interfaceConcern, discovered: res.discovered, purposeVerified: res.purposeVerified,
  })
  // F6: a "refactor" commit once smuggled in a behavior change — with 2+ commits, audit each hat separately.
  const hats = GIT && res.commits && res.commits.length >= 2
    ? `\nTWO-HATS AUDIT: ${res.commits.length} commits — diff EACH separately (\`git -C ${repo} show <sha>\`); a structure/refactor commit must be strictly behavior-preserving (no test or behavior change smuggled in).`
    : ''
  // ITEM 9: R_VERIFY promises "any ENGINE-DIFF/ENGINE-RAN block in this prompt is that material — use it
  // instead of re-greping", but the engine only ever emitted ENGINE-RAN — so the verifier re-greped the
  // leaf's diff via git (its #1 measured hidden cost). Run that scoped diff ONCE deterministically here and
  // hand it over. This is engine SHELL-TRUTH (a fixed `git diff` over the leaf range, test files excluded the
  // way the wiring-audit does), NOT a sibling model's claim — so executor!=verifier still holds: the verifier
  // KEEPS its full duty and ability to re-run / widen the range (gitVerify already tells it how). Skip for
  // tidy leaves: their behavior-preservation gate has its own flow and a diff fetch only complicates it.
  // Capped at ENGINE_DIFF_CAP chars — above the cap, send the `git diff --stat` footprint (not the full
  // diff) so the change's file-level shape stays visible without flooding the prompt.
  let engineDiff = ''
  if (GIT && leafStart && node.kind !== 'tidy') {
    const d = await sh(
      `git -C ${repo} diff ${diffRange || (leafStart + '..HEAD')} -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null || true`,
      `verify-diff:${lbl}`)
    if (!shUnavailable(d)) {
      const body = String(d.stdout || '')
      if (body.length > ENGINE_DIFF_CAP) {
        // Over cap: don't flood the prompt with the full diff — but don't go OPAQUE either. The file
        // footprint (`git diff --stat`) is tiny and keeps "which files, how much" visible, so a large
        // change can't hide past the cap (a verifier handed zero signal can't scope-check). Full hunks
        // stay one `git diff` away (gitVerify already told it how). --stat unavailable → prior message.
        const s = await sh(
          `git -C ${repo} diff --stat ${leafStart}..HEAD -- . ':(exclude)*Tests*' ':(exclude)*test*' 2>/dev/null || true`,
          `verify-diffstat:${lbl}`)
        const stat = shUnavailable(s) ? '' : String(s.stdout || '').trim()
        engineDiff = stat
          ? `\nENGINE-DIFF: (full diff > ${ENGINE_DIFF_CAP} chars — file footprint below; inspect hunks via \`git -C ${repo} diff ${leafStart}..HEAD\`):\n${stat}`
          : `\nENGINE-DIFF: (diff too large — inspect via git yourself)`
      } else {
        engineDiff = `\nENGINE-DIFF: ${body}`
      }
    }
  }
  const base = `${R_VERIFY}\n\nRepo: ${repo}\nAdversarially verify this finished leaf.\nTask: ${node.task}\n` +
    `Reported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineDiff}${engineT0 || ''}${buildNote || ''}`
  if (node.kind === 'tidy') {   // ③ a tidy leaf must be BEHAVIOR-PRESERVING — verify THAT, not new-feature trust
    const r = await agentSafe<Verdict>(
      `${base}\nThis is a TIDY-FIRST leaf: a behavior-PRESERVING structural change. Trust it ONLY if the existing ` +
      `suite is GREEN, NO test was added/changed/deleted, and the diff is a pure structural refactor with NO ` +
      `observable behavior change. Adding tests or changing behavior in a tidy leaf is a FINDING (untrusted).`,
      { phase: 'Work', label: `verify:${lbl}·tidy`, model: 'sonnet', schema: VERDICT })
    return r.ok ? r.value : { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'light') {
    const r = await agentSafe<Verdict>(
      `${R_VERIFY_LIGHT}\n\nRepo: ${repo}\nLow-risk leaf: ${node.task}\nReported: ${reported}\n${INV}${gitVerify(repo, leafStart)}${leafTest}${hats}${engineT0 || ''}${buildNote || ''}`,
      { phase: 'Work', label: `verify:${lbl}·light`, model: 'sonnet', schema: VERDICT })
    return r.ok ? r.value : { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
  if (tier === 'heavy') {
    const lenses = ['correctness & reproduce the green', 'security: secrets/credentials NEVER logged or leaked', 'interface & cross-module drift']
    // C: the correctness lens (index 0) runs on a DIFFERENT model — homogeneous consensus re-confirms
    // shared blind spots rather than producing independent evidence; cross-model diversity is cheap
    // independence, spent only where trust is most fragile (heavy leaves).
    // Run all 3 lenses in parallel: the Workflow runtime queues concurrent calls against its concurrency
    // cap, so nesting parallel() is safe — ~3× faster heavy-leaf verification vs. sequential.
    const rawVotes = await parallel(lenses.map((L, li) => async () => {
      const r = await agentSafe<Verdict>(`${base}\nLENS: judge specifically through "${L}".`,
        { phase: 'Work', label: `verify:${lbl}·${L.slice(0, 9)}`, ...(li === 0 ? { model: 'opus' } : {}), schema: VERDICT })
      return r.ok ? r.value : { trustworthy: false, reason: `lens "${L}" verifier unavailable — counts as distrust` }
    }))                                                          // outcome.ok:false = distrust: a flaky run can't launder a hard leaf
    // parallel() returns T|null per thunk (catches thunk throws); a null slot also counts as distrust.
    const votes: Verdict[] = rawVotes.map((v, li) => v ?? { trustworthy: false, reason: `lens "${lenses[li]}" verifier unavailable — counts as distrust` })
    const distrust = votes.filter(v => !v.trustworthy)
    return {
      trustworthy: distrust.length === 0,                       // UNANIMOUS across ALL 3 lenses (null counts against)
      reason: `heavy verify: ${votes.length} lenses, ${distrust.length} distrusted`,
      issues: votes.flatMap(v => v.issues || []),
      purposeGap: votes.map(v => v.purposeGap).filter(Boolean).join('; ') || undefined,   // ① don't drop a hard-leaf purpose gap
      prescription: votes.map(v => v.prescription).filter(Boolean).join(' | ') || undefined,   // I3: lens prescriptions feed repair
      followUps: votes.flatMap(v => v.followUps || []),                                        // I4: lens follow-ups feed the batch
    }
  }
  const r = await agentSafe<Verdict>(base, { phase: 'Work', label: `verify:${lbl}`, schema: VERDICT })
  return r.ok ? r.value : { trustworthy: false, reason: 'verification unavailable — untrusted' }
  }
}
