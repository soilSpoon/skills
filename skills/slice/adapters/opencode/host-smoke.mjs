// No-LLM smoke for the AsyncFunction PORT host: runs the artifact with NO task,
// expecting the engine's I7 guard to return {error} after ZERO agent() calls.
// Usage: node host-smoke.mjs [path-to-recursive-slice.js]
import { readFileSync } from "node:fs"
const path = process.argv[2] || `${process.env.HOME}/.claude/workflows/recursive-slice.js`
const code = readFileSync(path, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")
let agentCalls = 0
const agent = async () => { agentCalls++; return null }
const logs = []
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "workflow", "args", "budget", code)
const result = await run(agent, t => Promise.all(t.map(f => f().catch(() => null))), null,
  t => logs.push(`== ${t}`), m => logs.push(m), null, {}, { total: null, spent: () => 0, remaining: () => Infinity })
console.log(JSON.stringify({ agentCalls, logs, result }))
if (agentCalls !== 0 || !result || !result.error) { console.error("SMOKE FAILED"); process.exit(1) }
console.error("SMOKE OK: I7 guard returned with zero agent calls")
