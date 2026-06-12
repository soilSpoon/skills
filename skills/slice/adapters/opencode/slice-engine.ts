// opencode adapter for the recursive-slice engine — first-class execution outside Claude Code.
//
// The engine artifact (recursive-slice.js) talks ONLY to the PORT globals declared in
// src/main.ts (agent/parallel/phase/log/args/budget). This tool hosts that PORT on opencode:
//   agent()   → a fresh non-interactive `opencode run` subprocess (bills the user's own
//               opencode provider/plan — NOT claude -p API credits)
//   schema    → "respond ONLY with JSON matching <schema>" + parse + one retry
//   the body  → executed via AsyncFunction, whose function-body context makes the artifact's
//               top-level `return await __main()` legal — same trick the Workflow runtime uses
//
// Install: copy this file to ~/.config/opencode/tools/slice-engine.ts (global) or
// <project>/.opencode/tools/ (per-project). The tool name is the filename.
// Engine path resolution: $SLICE_ENGINE_PATH > ~/.claude/workflows/ > the installed skill dir.
//
// Known v1 degradations (documented, not silent): per-call model overrides (sonnet/opus
// lenses) fall back to the session's default model; no resume journal (per-leaf commits
// remain the durable record); budget is unlimited (watch your provider quota).
import { tool } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "node:fs"
import { execFile } from "node:child_process"

const HOME = process.env.HOME || "~"
const CANDIDATES = [
  process.env.SLICE_ENGINE_PATH || "",
  `${HOME}/.claude/workflows/recursive-slice.js`,
  `${HOME}/.claude/skills/slice/recursive-slice.js`,
  `${HOME}/.config/opencode/skills/slice/recursive-slice.js`,
].filter(Boolean)

export default tool({
  description:
    "Run the recursive-slice trust-first decomposition engine (the /slice skill's Workflow engine) " +
    "on a task+repo: baseline → vertical slices → Canon-TDD leaves → adversarial verification → " +
    "per-leaf git commits → deterministic integrate + owner's briefing. Long-running; returns the " +
    "trust ledger JSON. Use for big/risky multi-leaf coding tasks, not single diagnosed fixes.",
  args: {
    task: tool.schema.string().describe("the lane spec (precise: evidence file:line, MUST PRESERVE, purpose, wiring clause)"),
    repo: tool.schema.string().describe("absolute path to the target repo"),
    maxDepth: tool.schema.number().optional().describe("recursion cap (default 3; 2 for contained tasks)"),
    enginePath: tool.schema.string().optional().describe("override path to the recursive-slice.js artifact"),
  },
  async execute(a: { task: string; repo: string; maxDepth?: number; enginePath?: string }) {
    const enginePath = [a.enginePath || "", ...CANDIDATES].filter(Boolean).find(p => existsSync(p))
    if (!enginePath) return JSON.stringify({ error: "recursive-slice.js artifact not found", searched: CANDIDATES })
    // strip the runtime's `export const meta = {...}` header (first bare closing brace ends it)
    const code = readFileSync(enginePath, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")

    const logs: string[] = []
    const log = (m: string) => { logs.push(String(m)) }
    const phase = (t: string) => { logs.push(`══ ${t} ══`) }

    const ocRun = (prompt: string) => new Promise<string>((resolve, reject) => {
      execFile(process.env.OPENCODE_BIN || "opencode", ["run", prompt],
        { cwd: a.repo, maxBuffer: 32e6, timeout: 30 * 60_000 },
        (err, stdout) => (stdout ? resolve(String(stdout)) : err ? reject(err) : resolve("")))
    })
    const agent = async (prompt: string, opts?: { schema?: object; label?: string }) => {
      const p = opts?.schema
        ? `${prompt}\n\nRespond with ONLY a single JSON object matching this JSON-Schema — no prose, no code fences:\n${JSON.stringify(opts.schema)}`
        : prompt
      for (let attempt = 0; attempt < 2; attempt++) {           // one retry on parse/process failure
        try {
          const out = await ocRun(p)
          if (!opts?.schema) return out.trim()
          const m = out.match(/\{[\s\S]*\}/)
          if (m) return JSON.parse(m[0])
        } catch { /* retry once, then null — the engine treats null as distrust */ }
      }
      return null
    }
    const parallel = (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map(t => t().catch(() => null)))
    const budget = { total: null as number | null, spent: () => 0, remaining: () => Infinity }

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...v: unknown[]) => Promise<unknown>
    const run = new AsyncFunction("agent", "parallel", "pipeline", "phase", "log", "workflow", "args", "budget", code)
    const result = await run(agent, parallel, null, phase, log, null,
      { task: a.task, repo: a.repo, maxDepth: a.maxDepth }, budget)
    return JSON.stringify({ engine: enginePath, logs, result }, null, 2)
  },
})
