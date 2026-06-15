// code-review-orchestrator — the Claude Code Workflow impl of code-fundamentals 워크플로 D.
//
// route → section → vote → synthesize, for a git diff. This is NOT a new engine: it is the
// PROVEN slice heavy-verify glue (slice/src/main.ts:547-570 — lens array, parallel(), li===0?opus,
// ?? = unavailable, distrust filter, flatMap merge) RE-POINTED from leaves to FINDINGS.
//
// Two owner resolutions that CORRECT the naive slice-copy for the REVIEW domain:
//
//   (R1) REFUTE vs UNAVAILABLE are DIFFERENT. slice treats null=distrust because a false-GREEN is
//        catastrophic. REVIEW's failure mode is the OPPOSITE — a MISSED bug (false NEGATIVE). So:
//          • a lens that READ the diff and actively REFUTES → demote or drop the finding.
//          • a lens that is UNAVAILABLE (null / errored / could not run) → KEEP the finding, but
//            FLAG it `[unverified]` — NEVER silently drop it (a dropped real bug is the worst case).
//        A finding ships CONFIRMED only if ALL lenses were available AND zero refuted; any
//        unavailable lens → it ships `[unverified]`. (Do NOT write `survived = distrust.length===0`
//        collapsing null into distrust — we distinguish refuted (active) from unavailable (null).)
//
//   (R2) SYNTHESIZE is DETERMINISTIC plain JS (dedup/sort/merge), NOT a model arbiter. Axis-conflicts
//        (DRY vs coupling — two lanes disagree) are SURFACED in `unresolved_disagreements` with BOTH
//        sides cited, NEVER auto-resolved. No Opus arbiter picks a winner (that contradicts "surface
//        both sides, the human decides"). dedup must NOT collapse opposite-verdict pairs — that pair
//        IS the conflict signal.
//
// Workflow-tool API (NOT slice's internal host — no agentSafe/$/circuitBreaker):
//   agent(prompt, {label,phase,schema,model}) → the schema object, or null on failure
//   parallel(thunks)  → array (barrier); a thrown thunk yields null in its slot — filter it
//   phase(title) / log(msg)
// No top-level shell: the FIRST agent runs `git diff` via its Bash tool and returns it.
// No Date.now()/Math.random()/new Date() (they throw here). Plain JS only.

export const meta = {
  name: 'code-review-orchestrator',
  description: 'Multi-agent code review (워크플로 D): route → section → vote → synthesize over a git diff. Deterministic proportional gate sizes the run; large/multi-aspect diffs get a 3-lens adversarial VOTE (lens[0]=Opus cross-model) that refutes findings before they ship; refuted findings are demoted/dropped, unavailable-lens findings ship [unverified] (never silently dropped); synthesize is deterministic and surfaces axis-conflicts unresolved for the human.',
  phases: [
    { title: 'Route', detail: 'fetch the diff (git diff + --stat via Bash); deterministic proportional gate → small | medium | large' },
    { title: 'Section', detail: 'parallel perspective-isolated lanes propose candidate findings (no cross-lane comms)' },
    { title: 'Vote', detail: 'per finding, 3 independent refute-mode lenses; refuted→demote/drop, unavailable→keep+[unverified]' },
    { title: 'Synthesize', detail: 'deterministic dedup/sort/merge + vote_journal + unresolved_disagreements (axis-conflicts never auto-resolved)' },
  ],
}

// ── schemas (JSON-schema literals, slice style) ──────────────────────────────────────────────────
// A candidate finding proposed by a SECTION lane.
const FINDING = { type: 'object', required: ['severity', 'file', 'principle'], properties: {
  severity: { type: 'string', enum: ['MUST', 'SHOULD', 'NIT'] }, // [MUST] defect / [SHOULD] recommended / [NIT] taste
  axis: { type: 'string' },        // 가독성 | 예측가능성 | 응집도 | 결합도 | a11y | correctness | ...
  principle: { type: 'string' },   // the named rule (e.g. "매직 넘버", "과도한 DRY")
  file: { type: 'string' },
  line: { type: 'integer' },
  before: { type: 'string' },      // the offending hunk (proposer cites the actual diff, not prose)
  after: { type: 'string' },       // the prescription
  why: { type: 'string' },         // 2-3 bullets
  tradeoff: { type: 'string' },    // when the principle conflicts with another axis
} }
// The diff envelope returned by the fetch agent (it ran `git diff` itself via Bash).
const DIFF = { type: 'object', required: ['stat', 'diff'], properties: {
  diff: { type: 'string' },        // full `git diff` body
  stat: { type: 'string' },        // `git diff --stat` (last line carries "N files changed, ... M insertions(+)")
  empty: { type: 'boolean' },      // true if there is nothing staged/unstaged to review
} }
// One lens's adversarial verdict on ONE finding. `refuted` is the ACTIVE judgment (lens read the diff
// and disagrees); an UNAVAILABLE lens never produces this object — it surfaces as a null slot (R1).
const VERDICT = { type: 'object', required: ['refuted'], properties: {
  refuted: { type: 'boolean' },              // true = this lens read the diff and DISAGREES with the finding
  reason: { type: 'string' },                // why (cites the diff hunk it read — shell truth before verdict)
  demotion: { type: 'string', enum: ['none', 'to-SHOULD', 'to-NIT', 'drop'] }, // if refuted, the weaker verdict that survives (or drop)
  tradeoff_decisions: { type: 'array', items: { type: 'object', properties: {  // R2: axis-conflict, BOTH sides — never resolved
    file: { type: 'string' }, line: { type: 'integer' },
    side_a: { type: 'string' }, side_b: { type: 'string' }, // the two contradicting positions, each cited
  } } },
} }

// ── deterministic helpers (plain JS — NO model, NO Date/Math.random) ──────────────────────────────

// Parse `git diff --stat`'s summary line in PLAIN JS. Shapes like:
//   "3 files changed, 120 insertions(+), 14 deletions(-)"
// Robust to missing insertions/deletions. Returns {files, lines} (lines = insertions+deletions touched).
function parseStat(stat) {
  const text = String(stat || '')
  const last = text.trim().split('\n').filter(Boolean).pop() || ''
  const files = (last.match(/(\d+)\s+files?\s+changed/) || [])[1]
  const ins = (last.match(/(\d+)\s+insertions?\(\+\)/) || [])[1]
  const del = (last.match(/(\d+)\s+deletions?\(-\)/) || [])[1]
  return { files: Number(files || 0), lines: Number(ins || 0) + Number(del || 0) }
}

// Proportional gate (R/Lesson-8: keep the load-bearing gate DETERMINISTIC; thresholds are the levers).
// small  = trust-floor: one competent Sonnet pass, no fan-out earns its cost on a tiny diff.
// medium = full 3-lens rigor (1 Opus + 2 Sonnet ≈ 2-3 Sonnet-equiv).
// large  = full VOTE on every contested finding (false-positive risk high; owner's wasted time is dear).
function gateTier({ files, lines }) {
  if (lines < 100 && files <= 1) return 'small'
  if (lines <= 500 && files <= 5) return 'medium'
  return 'large'
}

const SEV_RANK = { MUST: 0, SHOULD: 1, NIT: 2 }
const fkey = f => `${f.file || ''}:${f.line == null ? '' : f.line}` // file:line grouping key

// dedup that PRESERVES disagreement (R2). Group by file:line; within a group, collapse only findings
// that AGREE (same principle/severity → keep the strongest severity). Findings at the same site that
// DISAGREE (different principle, e.g. "remove dup" vs "keep — legit reuse") are NOT collapsed: that
// opposite-verdict pair IS the axis-conflict signal that feeds unresolved_disagreements.
function dedupKeepDisagreements(findings) {
  const byKey = new Map()
  for (const f of findings) {
    const k = fkey(f)
    if (!byKey.has(k)) byKey.set(k, [])
    const bucket = byKey.get(k)
    // an AGREEING duplicate already at this site: same principle → keep the stronger severity, drop the copy
    const twin = bucket.find(g => (g.principle || '') === (f.principle || ''))
    if (twin) { if (SEV_RANK[f.severity] < SEV_RANK[twin.severity]) twin.severity = f.severity; continue }
    bucket.push(f) // distinct principle at the same site → KEEP both (may be the conflict pair)
  }
  return [...byKey.values()].flat()
}

// Deterministic final ordering: severity → file → line. Stable, no model judgment.
function sortFindings(findings) {
  return findings.slice().sort((a, b) =>
    (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
    String(a.file).localeCompare(String(b.file)) ||
    ((a.line || 0) - (b.line || 0)))
}

// R1: fold one finding's lens slots into a ship-decision. `slots` is the raw parallel() array:
// a VERDICT object = lens ran; null = lens UNAVAILABLE. refuted (active) ≠ unavailable (null).
function decide(finding, slots) {
  const available = slots.filter(v => v && typeof v.refuted === 'boolean')
  const unavailable = slots.length - available.length          // null/errored lenses
  const refuters = available.filter(v => v.refuted === true)   // ACTIVE disagreement (read the diff, says no)
  const tradeoffs = available.flatMap(v => v.tradeoff_decisions || []) // R2: surfaced, never resolved here
  if (refuters.length > 0) {
    // A lens actively refuted. Demote to the weakest surviving verdict, or drop.
    const demotions = refuters.map(v => v.demotion).filter(d => d && d !== 'none')
    const drop = demotions.includes('drop')
    let severity = finding.severity
    if (demotions.includes('to-NIT')) severity = 'NIT'
    else if (demotions.includes('to-SHOULD') && severity === 'MUST') severity = 'SHOULD'
    return { ship: !drop, status: 'refuted', finding: { ...finding, severity }, refuters, unavailable, tradeoffs }
  }
  // Zero refutations. CONFIRMED only if ALL lenses were available; any unavailable → [unverified] (R1 — keep, flag).
  const status = unavailable === 0 ? 'confirmed' : 'unverified'
  const tag = status === 'unverified' ? `[unverified] ${finding.principle || ''}`.trim() : finding.principle
  return { ship: true, status, finding: { ...finding, principle: tag }, refuters, unavailable, tradeoffs }
}

// ── prompts ──────────────────────────────────────────────────────────────────────────────────────

// The fetch agent runs git itself (no top-level shell in a Workflow script).
const FETCH = `You are the diff-fetch step of a code review. Using your Bash tool, run exactly:\n` +
  `  git diff --stat\n  git diff\n` +
  `If both are empty, also try \`git diff --cached --stat\` and \`git diff --cached\` (staged). ` +
  `Return the FULL \`git diff\` body as "diff" and the \`--stat\` output as "stat" (its last line carries ` +
  `"N files changed, M insertions(+), K deletions(-)"). Set "empty" true ONLY if there is nothing to review. ` +
  `Do NOT review, summarize, or edit — return the raw diff verbatim.`

// SECTION lane prompts. code-fundamentals ships 2 lanes; toss-frontend overrides ROUTE with its own
// lane→reference map (so this list is the config input, not a hardcoded fork).
const LANES = [
  { id: 'L1', focus: '가독성 + 예측 가능성 — 인지 부하·이름·시그니처·스코프 가시성·숨은 부작용·매직 넘버·중첩 조건·추상화 수준 혼합' },
  { id: 'L2', focus: '응집도 + 결합도 — 모듈 경계·중복 vs 추상·디렉토리·drilling·과도한 DRY·어댑터 누락·전역 상태 결합' },
]
function sectionPrompt(lane, diff) {
  return `You are a code-review lane. Review ONLY through your perspective; do NOT comment on other axes ` +
    `(another lane covers them). Perspective: ${lane.focus}.\n\nThis is code-fundamentals — judge "변경하기 쉬운 코드" ` +
    `(readability/predictability/cohesion/coupling). For EACH issue emit a finding: severity [MUST] defect / ` +
    `[SHOULD] recommended / [NIT] taste, the named principle, file:line, the offending hunk (before) + ` +
    `prescription (after), 2-3 reasons, and a tradeoff note when the principle conflicts with another axis. ` +
    `Cite the ACTUAL diff hunk, not prose. The scope-floor applies: the easiest code to change is no code.\n\n` +
    `DIFF:\n${diff}`
}

// VOTE lens prompts — REFUTE-MODE (destroy trust, do not re-confirm). REVIEWER ≠ PROPOSER:
// the lens must independently READ the diff hunk before any verdict (shell truth before model judgment).
const LENSES = [
  'correctness & true binding — is this REALLY a [MUST]? Read the actual diff hunk: does removing/ignoring it ' +
    'cause a correctness/safety/a11y defect (not merely style)? If only style, it is NOT a [MUST] — demote it.',
  'reuse / coupling vs DRY — is the flagged duplication actually ACCEPTABLE reuse? Forcing곳마다-다른 logic into ' +
    'one abstraction is worse than duplication. If the dedup would raise coupling, REFUTE and emit a tradeoff_decision.',
  'context / altitude — does the tradeoff FLIP the severity? A 200-line script vs an app; a throwaway vs a library. ' +
    'If the finding over-applies an app-grade rule to small/throwaway code, refute or demote and say why.',
]
function refutePrompt(finding, lens, diff) {
  return `You are an ADVERSARIAL reviewer. Default this finding UNTRUSTED. Your job is to REFUTE it — try to ` +
    `DESTROY trust in it, not re-confirm it. First independently READ the relevant hunk in the diff below ` +
    `(shell truth before verdict); only then judge.\n\nLENS: ${lens}\n\n` +
    `FINDING under review:\n${JSON.stringify(finding, null, 2)}\n\n` +
    `Set refuted=true ONLY if, having read the hunk, you genuinely disagree (wrong, overstated severity, or legit ` +
    `as-is). If refuted, set demotion = the weakest verdict that still survives ('to-SHOULD' | 'to-NIT' | 'drop'). ` +
    `If this finding contradicts a legitimate opposite position (e.g. DRY vs coupling), DO NOT pick a winner — emit ` +
    `a tradeoff_decision citing BOTH sides; the human decides. If the finding holds, refuted=false.\n\nDIFF:\n${diff}`
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────────
export default async function () {
  // ROUTE — fetch the diff (the agent runs git via Bash; no top-level shell here) + the deterministic gate.
  phase('Route')
  const fetched = await agent(FETCH, { label: 'fetch-diff', phase: 'Route', model: 'sonnet', schema: DIFF })
  if (!fetched || fetched.empty || !String(fetched.diff || '').trim()) {
    log('No diff to review.')
    return { tier: 'none', findings: [], unresolved_disagreements: [], vote_journal: [], metrics: { findings_proposed: 0, findings_shipped: 0 } }
  }
  const diff = String(fetched.diff)
  const size = parseStat(fetched.stat)         // PLAIN JS parse of the --stat line (lines + files counts)
  const tier = gateTier(size)                  // small | medium | large — deterministic, NOT LLM-decided
  log(`diff: ${size.files} file(s), ~${size.lines} changed lines → tier=${tier}`)

  // SMALL — trust floor: one competent Sonnet pass, no VOTE (a tiny diff can't earn the 3-lens fan-out).
  if (tier === 'small') {
    phase('Section')
    const lane = LANES[0] // single combined pass for a 1-file diff
    const out = await agent(
      sectionPrompt({ id: 'all', focus: '가독성·예측 가능성·응집도·결합도 전부' }, diff),
      { label: 'section:small', phase: 'Section', model: 'sonnet', schema: { type: 'object', properties: { findings: { type: 'array', items: FINDING } } } })
    void lane
    const findings = sortFindings(dedupKeepDisagreements((out && out.findings) || []))
    return finalize(findings.map(f => ({ ship: true, status: 'single-pass', finding: f, refuters: [], unavailable: 0, tradeoffs: [] })), findings.length, tier)
  }

  // SECTION — parallel, perspective-isolated lanes (no cross-lane comms). parallel() returns null on throw.
  phase('Section')
  const sectioned = await parallel(LANES.map(lane => () =>
    agent(sectionPrompt(lane, diff),
      { label: `section:${lane.id}`, phase: 'Section', model: 'sonnet',
        schema: { type: 'object', properties: { findings: { type: 'array', items: FINDING } } } })))
  // merge lanes; dedup but PRESERVE disagreement pairs (R2 — they feed unresolved_disagreements).
  const candidates = dedupKeepDisagreements(sectioned.flatMap(s => (s && s.findings) || []))
  log(`section: ${candidates.length} candidate finding(s) across ${LANES.length} lane(s)`)

  // Two-key short-circuit: even at medium/large, a thin candidate set (≤5) doesn't earn the fan-out.
  if (candidates.length <= 5) {
    log('thin candidate set (≤5) — trusting section output without VOTE fan-out')
    const findings = sortFindings(candidates)
    return finalize(findings.map(f => ({ ship: true, status: 'single-pass', finding: f, refuters: [], unavailable: 0, tradeoffs: [] })), candidates.length, tier)
  }

  // VOTE — per finding, 3 independent refute-mode lenses in parallel. lens[0] runs on a DIFFERENT model
  // (Opus): cross-model diversity is cheap independence spent only on the fragile [MUST]/correctness call;
  // homogeneous Sonnet consensus re-confirms shared blind spots. Nested parallel() is safe under the cap.
  phase('Vote')
  const voted = await parallel(candidates.map(f => async () => {
    const slots = await parallel(LENSES.map((lens, li) => () =>
      agent(refutePrompt(f, lens, diff),
        { label: `vote:${fkey(f)}·${li}`, phase: 'Vote',
          ...(li === 0 ? { model: 'opus' } : { model: 'sonnet' }), schema: VERDICT })))
    // R1: a null slot is UNAVAILABLE (lens couldn't run) — NOT a refutation. decide() keeps the finding
    // and flags it [unverified] rather than dropping it (a dropped real bug is the worst outcome).
    return decide(f, slots)
  }))
  // a thrown VOTE thunk → null slot in `voted`; that finding lost ALL its lenses → unverified, keep it.
  const decided = voted.map((d, i) => d || { ship: true, status: 'unverified', finding: { ...candidates[i], principle: `[unverified] ${candidates[i].principle || ''}`.trim() }, refuters: [], unavailable: LENSES.length, tradeoffs: [] })

  return finalize(decided, candidates.length, tier)
}

// SYNTHESIZE — DETERMINISTIC (R2): dedup/sort/merge in plain JS, emit vote_journal (audit of demotions)
// and unresolved_disagreements (axis-conflicts surfaced with BOTH sides, NEVER auto-resolved). No model
// arbiter picks a winner. `decided` = decide()-shaped records; `proposed` = pre-vote candidate count.
function finalize(decided, proposed, tier) {
  phase('Synthesize')
  const shipped = decided.filter(d => d.ship)
  const findings = sortFindings(dedupKeepDisagreements(shipped.map(d => d.finding)))

  // vote_journal: every demotion/drop/unverified is auditable — never a silent change.
  const vote_journal = decided
    .filter(d => d.status === 'refuted' || d.status === 'unverified')
    .map(d => ({
      finding: fkey(d.finding),
      principle: d.finding.principle,
      severity: d.finding.severity,
      status: d.status,                                  // 'refuted' (demoted/dropped) | 'unverified' (lens missing)
      shipped: d.ship,
      refuted_by: (d.refuters || []).map(v => v.reason).filter(Boolean),
      lenses_unavailable: d.unavailable || 0,
    }))

  // unresolved_disagreements: axis-conflicts, BOTH sides cited, surfaced for the human (R2 — never resolved).
  const unresolved_disagreements = decided.flatMap(d => d.tradeoffs || [])

  const shippedFindings = findings.length
  return {
    tier,
    findings,                       // CONFIRMED + [unverified] (flagged), severity→file→line sorted
    unresolved_disagreements,       // axis-conflicts — the owner decides, we never pick a winner
    vote_journal,                   // demotion/drop/unverified audit trail
    metrics: {
      findings_proposed: proposed,
      findings_shipped: shippedFindings,
      refuted_count: decided.filter(d => d.status === 'refuted').length,
      dropped_count: decided.filter(d => d.status === 'refuted' && !d.ship).length,
      unverified_count: decided.filter(d => d.status === 'unverified').length,
      lenses_unavailable: decided.reduce((n, d) => n + (d.unavailable || 0), 0),
    },
  }
}
