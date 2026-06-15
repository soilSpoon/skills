// No-LLM smoke for code-review-orchestrator.js — runs it exactly as the Workflow runtime does
// (strip `export const meta`, execute the rest as an AsyncFunction BODY with a top-level `return`),
// driving route→section→vote→synthesize with a SCRIPTED mock agent. Proves: (1) the script actually
// RUNS under the runtime convention (catches the `export default` no-op trap), (2) the deterministic
// proportional gate, (3) R1 (refute→demote/drop vs unavailable→keep+[unverified]), (4) R2 (deterministic
// synthesize + unresolved_disagreements, never auto-resolved). Run: node code-review-orchestrator.smoke.mjs
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
let code = readFileSync(join(here, "code-review-orchestrator.js"), "utf8")
// the runtime strips the meta banner and runs the rest as an AsyncFunction body (top-level `return` legal).
code = code.replace(/^export const meta = \{[\s\S]*?\n\}\n/m, "")
if (/^export /m.test(code)) { console.error("SMOKE FAILED: a stray top-level `export` survives — the AsyncFunction body would be a syntax error"); process.exit(1) }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let fn
try { fn = new AsyncFunction("agent", "parallel", "phase", "log", code) }
catch (e) { console.error("SMOKE FAILED: artifact does not parse as an AsyncFunction body:", e.message); process.exit(1) }
console.error("SMOKE OK: orchestrator parses + runs as a Workflow AsyncFunction body (export default trap avoided)")

const parallel = async (thunks) => Promise.all(thunks.map(t => t().catch(() => null)))
const phase = () => {}
// drive(mockAgent) → { result, labels } ; mockAgent(prompt, opts) is scripted per scenario.
async function drive(mockAgent) {
  const labels = []
  const agent = async (prompt, opts) => { labels.push((opts && opts.label) || ""); return mockAgent(prompt, opts) }
  const result = await fn(agent, parallel, phase, () => {})
  return { result, labels }
}
const finding = (sev, file, line, principle) => ({ severity: sev, file, line, principle, axis: "x", before: "b", after: "a", why: "w" })
let failed = 0
const ok = (cond, msg) => { if (cond) console.error("SMOKE OK:", msg); else { console.error("SMOKE FAILED:", msg); failed++ } }

// ── Scenario 1: SMALL diff → single Sonnet pass, NO VOTE ──────────────────────────────────────────
{
  const f1 = (p, o) => {
    if (o.label === "fetch-diff") return { stat: "1 file changed, 12 insertions(+), 2 deletions(-)", diff: "@@ a.ts @@\n+ const x = 86400", empty: false }
    if (o.label.startsWith("section")) return { findings: [finding("MUST", "a.ts", 5, "매직 넘버"), finding("SHOULD", "a.ts", 9, "과도한 DRY")] }
    return null
  }
  const { result, labels } = await drive(f1)
  ok(result.tier === "small", `small diff → tier=small (got ${result.tier})`)
  ok(!labels.some(l => l.startsWith("vote:")), "small diff runs NO vote (single-pass floor)")
  ok(result.findings.length === 2, `small diff ships its 2 findings (got ${result.findings.length})`)
}

// ── Scenario 2: LARGE stat but THIN candidate set (≤5) → short-circuit, NO VOTE ───────────────────
{
  const f2 = (p, o) => {
    if (o.label === "fetch-diff") return { stat: "8 files changed, 700 insertions(+), 50 deletions(-)", diff: "@@ many @@", empty: false }
    if (o.label === "section:L1") return { findings: [finding("MUST", "b.ts", 1, "숨은 부작용"), finding("SHOULD", "b.ts", 2, "이름 충돌")] }
    if (o.label === "section:L2") return { findings: [finding("SHOULD", "c.ts", 3, "drilling"), finding("NIT", "c.ts", 4, "응집도")] }
    return null
  }
  const { result, labels } = await drive(f2)
  ok(result.tier === "large", `large stat → tier=large (got ${result.tier})`)
  ok(!labels.some(l => l.startsWith("vote:")), "thin candidate set (≤5) short-circuits — NO vote fan-out even at large tier")
  ok(result.findings.length === 4, `thin set ships all 4 (got ${result.findings.length})`)
}

// ── Scenario 3: LARGE + >5 candidates → VOTE fires; exercise R1 (refute/unavailable) + R2 (conflicts) ──
{
  // 6 distinct findings (file encodes the desired VOTE behavior); the mock dispatches per file + lens index.
  const sec = [
    finding("MUST", "demote.ts", 1, "매직 넘버"),     // lens0 refutes → demote to SHOULD, ships
    finding("MUST", "drop.ts", 2, "추상화 수준 혼합"),  // lens0 refutes → drop (ship:false)
    finding("SHOULD", "unverified.ts", 3, "결합도"),   // lens1 UNAVAILABLE (null) → ships [unverified]
    finding("SHOULD", "confirm.ts", 4, "예측 가능성"), // all available, none refute → confirmed
    finding("MUST", "conflict.ts", 5, "과도한 DRY"),   // lens1 emits a tradeoff_decision (axis-conflict, no refute)
    finding("NIT", "confirm2.ts", 6, "가독성"),        // confirmed
  ]
  const f3 = (p, o) => {
    if (o.label === "fetch-diff") return { stat: "9 files changed, 900 insertions(+), 120 deletions(-)", diff: "@@ big @@", empty: false }
    if (o.label === "section:L1") return { findings: sec.slice(0, 3) }
    if (o.label === "section:L2") return { findings: sec.slice(3) }
    if (o.label.startsWith("vote:")) {
      const m = o.label.match(/^vote:(.+):(\d+)·(\d)$/)   // vote:<file>:<line>·<li>
      const [, file, , liS] = m; const li = Number(liS)
      if (file === "demote.ts") return li === 0 ? { refuted: true, reason: "style only", demotion: "to-SHOULD" } : { refuted: false }
      if (file === "drop.ts") return li === 0 ? { refuted: true, reason: "not a real issue", demotion: "drop" } : { refuted: false }
      if (file === "unverified.ts") return li === 1 ? null : { refuted: false }   // lens1 UNAVAILABLE
      if (file === "conflict.ts") return li === 1
        ? { refuted: false, tradeoff_decisions: [{ file, line: 5, side_a: "remove dup", side_b: "keep — legit reuse" }] }
        : { refuted: false }
      return { refuted: false }   // confirm.ts / confirm2.ts → all confirm
    }
    return null
  }
  const { result, labels } = await drive(f3)
  ok(result.tier === "large", `tier=large (got ${result.tier})`)
  ok(labels.some(l => l.startsWith("vote:")), "VOTE fires on >5 candidates at large tier")
  const byFile = Object.fromEntries(result.findings.map(f => [f.file, f]))
  // R1 — refute paths
  ok(!byFile["drop.ts"], "refuted+drop finding is DROPPED (not shipped)")
  ok(byFile["demote.ts"] && byFile["demote.ts"].severity === "SHOULD", "refuted+demote MUST→SHOULD, still ships")
  // R1 — unavailable ≠ refute: kept + flagged, never silently dropped
  ok(byFile["unverified.ts"] && /\[unverified\]/.test(byFile["unverified.ts"].principle), "unavailable-lens finding ships with [unverified] (kept, not dropped)")
  ok(byFile["confirm.ts"] && !/\[unverified\]/.test(byFile["confirm.ts"].principle), "all-available + no-refute → CONFIRMED (no [unverified] tag)")
  // R2 — axis-conflict surfaced, never resolved
  ok(result.unresolved_disagreements.length >= 1 && result.unresolved_disagreements[0].side_a, "axis-conflict surfaced in unresolved_disagreements (both sides, never auto-resolved)")
  // audit trail
  ok(result.vote_journal.some(j => j.status === "refuted") && result.vote_journal.some(j => j.status === "unverified"), "vote_journal records refuted + unverified (no silent change)")
  ok(result.metrics.dropped_count >= 1 && result.metrics.unverified_count >= 1 && result.metrics.refuted_count >= 2, `metrics tally the vote (dropped=${result.metrics.dropped_count} unverified=${result.metrics.unverified_count} refuted=${result.metrics.refuted_count})`)
}

if (failed) { console.error(`\n${failed} SMOKE ASSERTION(S) FAILED`); process.exit(1) }
console.error("\nALL ORCHESTRATOR SMOKES PASSED")
