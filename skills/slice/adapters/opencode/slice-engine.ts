// opencode adapter for the recursive-slice engine — first-class execution outside Claude Code.
//
// The engine artifact (recursive-slice.js) talks ONLY to the PORT globals declared in
// src/main.ts (agent/parallel/phase/log/args/budget). This tool hosts that PORT on opencode:
//   agent()   → a non-interactive `opencode run` subprocess (bills the user's own opencode
//               provider — e.g. with oh-my-openagent that's OpenRouter credits, NOT a
//               Claude subscription; pick your lane agents/models accordingly)
//   schema    → "respond ONLY with JSON matching <schema>" + parse + one retry
//   the body  → executed via AsyncFunction, whose function-body context makes the artifact's
//               top-level `return await __main()` legal — same trick the Workflow runtime uses
//
// ROLE ROUTING — the engine annotates every call (the sh() proxy prompt, opts.model tier);
// the adapter maps those lanes onto opencode agents/models from config:
//   shell  — the deterministic sh() proxy (verbatim bash + exit code; cheapest obedient agent)
//   light  — engine `model:'sonnet'` calls (assessor, executor, light verifier, baseliner)
//   heavy  — engine `model:'opus'` calls (the cross-model heavy verification lens)
//   main   — everything else (slicer, standard verifier, integrator, briefing)
// With oh-my-openagent installed the recommended mapping is
//   { shell: "sisyphus-junior", light: "sisyphus-junior", heavy: "momus", main: "" }
// — momus (criticism, GPT-5.5 xhigh) as the heavy lens preserves the engine's cross-model
// diversity goal; "" means the session's default agent.
//
// FIRST RUN — if no config exists the tool does NOT guess silently: it returns a
// `needsSetup` payload (with a recommended mapping and how it was derived) and instructs the
// calling agent to ASK THE USER, then call again with `writeConfig`.
//
// Config (closest wins): <repo>/.opencode/slice-engine.json → ~/.config/opencode/slice-engine.json
//   { "agents": { "shell": "", "light": "", "heavy": "", "main": "" },
//     "models": { "shell": "", "light": "", "heavy": "", "main": "" } }   // optional --model per lane
//
// Install: copy this file to ~/.config/opencode/tools/ (global) or <project>/.opencode/tools/.
// Verify install without spending tokens: node host-smoke.mjs
//
// Known v1 degradations (documented, not silent): no resume journal (per-leaf commits remain
// the durable record); budget is unlimited (watch your provider quota); each agent call is a
// fresh subprocess session (no cross-call cache).
import { tool } from "@opencode-ai/plugin"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { execFile } from "node:child_process"

const HOME = process.env.HOME || "~"
const GLOBAL_CONFIG = `${HOME}/.config/opencode/slice-engine.json`
const OMO_MARKER = `${HOME}/.config/opencode/oh-my-openagent.jsonc`
const ENGINE_CANDIDATES = [
  process.env.SLICE_ENGINE_PATH || "",
  `${HOME}/.claude/workflows/recursive-slice.js`,
  `${HOME}/.claude/skills/slice/recursive-slice.js`,
  `${HOME}/.config/opencode/skills/slice/recursive-slice.js`,
].filter(Boolean)

type Lane = "shell" | "light" | "heavy" | "main"
interface LaneMap { shell?: string; light?: string; heavy?: string; main?: string }
interface Config { agents?: LaneMap; models?: LaneMap }

const readConfig = (repo: string): Config | null => {
  for (const p of [`${repo}/.opencode/slice-engine.json`, GLOBAL_CONFIG]) {
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")) } catch { /* fall through */ } }
  }
  return null
}

const laneOf = (prompt: string, model?: string): Lane =>
  prompt.startsWith("Run EXACTLY this shell command") ? "shell"
  : model === "opus" ? "heavy"
  : model === "sonnet" ? "light"
  : "main"

export default tool({
  description:
    "Run the recursive-slice trust-first decomposition engine (the /slice skill's Workflow engine) " +
    "on a task+repo: baseline → vertical slices → Canon-TDD leaves → adversarial verification → " +
    "per-leaf git commits → deterministic integrate + owner's briefing. Long-running; returns the " +
    "trust ledger JSON. Use for big/risky multi-leaf coding tasks, not single diagnosed fixes. " +
    "On first use it may return needsSetup — then ask the user how to map engine lanes to " +
    "agents/models and call again with writeConfig.",
  args: {
    task: tool.schema.string().describe("the lane spec (precise: evidence file:line, MUST PRESERVE, purpose, wiring clause)"),
    repo: tool.schema.string().describe("absolute path to the target repo"),
    maxDepth: tool.schema.number().optional().describe("recursion cap (default 3; 2 for contained tasks)"),
    enginePath: tool.schema.string().optional().describe("override path to the recursive-slice.js artifact"),
    writeConfig: tool.schema.string().optional().describe(
      'setup: JSON {"agents":{shell,light,heavy,main},"models":{...}} — written to the global config, then the run proceeds'),
  },
  async execute(a: { task: string; repo: string; maxDepth?: number; enginePath?: string; writeConfig?: string }) {
    if (a.writeConfig) {
      const cfg = JSON.parse(a.writeConfig)
      mkdirSync(`${HOME}/.config/opencode`, { recursive: true })
      writeFileSync(GLOBAL_CONFIG, JSON.stringify({ agents: cfg.agents || {}, models: cfg.models || {} }, null, 2))
    }
    let config = readConfig(a.repo)
    if (!config) {
      const omo = existsSync(OMO_MARKER)
      return JSON.stringify({
        needsSetup: true,
        question: "First use: how should the engine's lanes map to your opencode agents/models? " +
          "ASK THE USER (do not decide silently), then call this tool again with writeConfig.",
        lanes: {
          shell: "deterministic bash proxy — cheapest obedient agent",
          light: "assess/execute/light-verify — a capable mid-tier implementer",
          heavy: "the adversarial heavy lens — strongest critic, ideally a DIFFERENT model family",
          main: "slicer/integrator/briefing — your default orchestrator ('' = session default)",
        },
        recommended: omo
          ? { agents: { shell: "sisyphus-junior", light: "sisyphus-junior", heavy: "momus", main: "" } }
          : { agents: { shell: "", light: "", heavy: "", main: "" } },
        recommendedBecause: omo
          ? "oh-my-openagent detected: sisyphus-junior (sonnet) fits obedient shell/implement lanes; momus (criticism, GPT-5.5 xhigh) fits the heavy lens AND preserves the engine's cross-model-diversity goal; '' keeps Sisyphus for global-context work."
          : "no oh-my-openagent detected: '' everywhere uses your session default; set models per lane instead if you prefer.",
        billingNote: "each engine call is an `opencode run` on YOUR provider (OpenRouter/API credits if so configured) — a full lane can be hundreds of calls; route shell/light lanes to cheap models.",
      }, null, 2)
    }

    const enginePath = [a.enginePath || "", ...ENGINE_CANDIDATES].filter(Boolean).find(p => existsSync(p))
    if (!enginePath) return JSON.stringify({ error: "recursive-slice.js artifact not found", searched: ENGINE_CANDIDATES })
    const code = readFileSync(enginePath, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")

    const logs: string[] = []
    const log = (m: string) => { logs.push(String(m)) }
    const phase = (t: string) => { logs.push(`══ ${t} ══`) }

    const ocRun = (prompt: string, lane: Lane) => new Promise<string>((resolve, reject) => {
      const agentName = config!.agents?.[lane] || ""
      const model = config!.models?.[lane] || ""
      const argv = ["run",
        ...(agentName ? ["--agent", agentName] : []),
        ...(model ? ["--model", model] : []),
        prompt]
      execFile(process.env.OPENCODE_BIN || "opencode", argv,
        { cwd: a.repo, maxBuffer: 32e6, timeout: 30 * 60_000 },
        (err, stdout) => (stdout ? resolve(String(stdout)) : err ? reject(err) : resolve("")))
    })
    const agent = async (prompt: string, opts?: { schema?: object; label?: string; model?: string }) => {
      const lane = laneOf(prompt, opts?.model)
      const p = opts?.schema
        ? `${prompt}\n\nRespond with ONLY a single JSON object matching this JSON-Schema — no prose, no code fences:\n${JSON.stringify(opts.schema)}`
        : prompt
      for (let attempt = 0; attempt < 2; attempt++) {           // one retry on parse/process failure
        try {
          const out = await ocRun(p, lane)
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
    return JSON.stringify({ engine: enginePath, lanes: config.agents || {}, logs, result }, null, 2)
  },
})
