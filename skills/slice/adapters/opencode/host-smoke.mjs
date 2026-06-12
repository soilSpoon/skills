// No-LLM smoke for the AsyncFunction PORT host: runs the artifact with NO task,
// expecting the engine's I7 guard to return {error} after ZERO agent() calls.
// Usage: node host-smoke.mjs [path-to-recursive-slice.js]
import { readFileSync } from "node:fs"
const path = process.argv[2] || `${process.env.HOME}/.claude/workflows/recursive-slice.js`
const code = readFileSync(path, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const makeRun = () => new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "workflow", "args", "budget", code)

// Assertion 1: I7 guard — no task → {error} with zero agent calls
let agentCalls = 0
const agent = async () => { agentCalls++; return null }
const logs = []
const result = await makeRun()(agent, t => Promise.all(t.map(f => f().catch(() => null))), null,
  t => logs.push(`== ${t}`), m => logs.push(m), null, {}, { total: null, spent: () => 0, remaining: () => Infinity })
console.log(JSON.stringify({ agentCalls, logs, result }))
if (agentCalls !== 0 || !result || !result.error) { console.error("SMOKE FAILED: I7 guard"); process.exit(1) }
console.error("SMOKE OK: I7 guard returned with zero agent calls")

// Assertion 2: parallel:true forwarded — engine logs "[parallel mode]" before baseline null-abort
// Pins: args.parallel reaches the engine's PARALLEL flag through the PORT args binding.
const logs2 = []
const result2 = await makeRun()(async () => null, t => Promise.all(t.map(f => f().catch(() => null))), null,
  t => logs2.push(`== ${t}`), m => logs2.push(m), null, { task: "smoke-test", parallel: true },
  { total: null, spent: () => 0, remaining: () => Infinity })
console.log(JSON.stringify({ logs2, result2 }))
if (!logs2.some(l => l.includes("[parallel mode]"))) { console.error("SMOKE FAILED: parallel:true not forwarded to engine"); process.exit(1) }
console.error("SMOKE OK: parallel:true reaches engine PARALLEL flag")
