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
// ROLE ROUTING — the engine annotates every call (label + phase + model tier); the adapter
// resolves each to an engine ROLE and routes it to a configured opencode agent. With
// oh-my-openagent installed, the recommendation maps roles to OMO's specialist pantheon:
//   slicer → prometheus (planner)     verifier/heavyLens/critic → momus (criticism)
//   spiker → oracle (debug/arch)      briefing → librarian (docs)
//   wiringAudit → explore (fast grep) baseliner/assessor/executor → sisyphus-junior
//   coordinator/default → "" (the session's main agent, e.g. Sisyphus)
// momus on the heavy lens preserves the engine's cross-model-diversity goal (GPT vs Claude).
//
// NATIVE sh() — the engine's deterministic shell proxy ("Run EXACTLY this shell command…")
// is executed DIRECTLY via /bin/sh, no LLM at all: free, instant, and MORE deterministic
// than any agent transport. (On opencode the tier-0 gates are therefore truly deterministic.)
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

type Role = "baseliner" | "assessor" | "slicer" | "executor" | "verifier" | "heavyLens"
  | "critic" | "spiker" | "coordinator" | "briefing" | "wiringAudit" | "default"
type RoleMap = Partial<Record<Role, string>>
interface Config { roles?: RoleMap; models?: RoleMap }

const readConfig = (repo: string): Config | null => {
  for (const p of [`${repo}/.opencode/slice-engine.json`, GLOBAL_CONFIG]) {
    if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf8")) } catch { /* fall through */ } }
  }
  return null
}

const SH_PREFIX = "Run EXACTLY this shell command"
const roleOf = (label: string, phase?: string, model?: string): Role => {
  const l = label.replace(/^(g\d+|seq\d+):/, "")           // strip parallel-group tags
  if (phase === "Baseline") return "baseliner"
  if (/^assess/.test(l)) return "assessor"
  if (/^(slice|partition)/.test(l)) return "slicer"
  if (/^exec/.test(l)) return "executor"
  if (/^spike/.test(l)) return "spiker"
  if (/^critic/.test(l)) return "critic"
  if (/^owner-briefing/.test(l)) return "briefing"
  if (/^wiring-audit/.test(l)) return "wiringAudit"
  if (/^merge-conflict/.test(l)) return "coordinator"
  if (model === "opus") return "heavyLens"
  if (/^(verify|merge-verify|integration)/.test(l) || phase === "Integrate" || phase === "Coordinate") return "verifier"
  return "default"
}

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
      'setup: JSON {"roles":{baseliner,assessor,slicer,executor,verifier,heavyLens,critic,spiker,coordinator,briefing,wiringAudit,default},"models":{...}} — written to the global config, then the run proceeds'),
  },
  async execute(a: { task: string; repo: string; maxDepth?: number; enginePath?: string; writeConfig?: string }) {
    if (a.writeConfig) {
      const cfg = JSON.parse(a.writeConfig)
      mkdirSync(`${HOME}/.config/opencode`, { recursive: true })
      writeFileSync(GLOBAL_CONFIG, JSON.stringify({ roles: cfg.roles || cfg.agents || {}, models: cfg.models || {} }, null, 2))
    }
    let config = readConfig(a.repo)
    if (!config) {
      const omo = existsSync(OMO_MARKER)
      return JSON.stringify({
        needsSetup: true,
        question: "First use: how should the engine's lanes map to your opencode agents/models? " +
          "ASK THE USER (do not decide silently), then call this tool again with writeConfig.",
        roles: {
          baseliner: "repo physics capture (runs the suite once)",
          assessor: "easy/hard × small/big classification",
          slicer: "vertical decomposition + interface design (global view)",
          executor: "Canon-TDD leaf implementation",
          verifier: "adversarial trust audit (standard tier + integrate/merge judgment)",
          heavyLens: "the cross-model heavy lens — strongest critic, DIFFERENT model family",
          critic: "completeness critic (missing scenarios)",
          spiker: "de-risking experiments",
          coordinator: "parallel-branch merge conflicts (global context)",
          briefing: "the owner's guided read",
          wiringAudit: "new-symbol production-callsite grep",
          default: "anything unmapped ('' = session default agent)",
        },
        note: "the engine's sh() shell proxy is executed NATIVELY (no LLM, no config needed).",
        recommended: omo
          ? { roles: { baseliner: "sisyphus-junior", assessor: "sisyphus-junior", slicer: "prometheus",
                       executor: "sisyphus-junior", verifier: "momus", heavyLens: "momus", critic: "momus",
                       spiker: "oracle", coordinator: "", briefing: "librarian", wiringAudit: "explore", default: "" } }
          : { roles: { default: "" } },
        recommendedBecause: omo
          ? "oh-my-openagent detected — role→specialist mapping: prometheus(planner)→slicer, momus(criticism, GPT-5.5)→verifier/heavyLens/critic (cross-model diversity preserved), oracle(debug)→spiker, librarian(docs)→briefing, explore(fast grep)→wiringAudit, sisyphus-junior(sonnet)→mechanical roles, ''(Sisyphus)→global-context work."
          : "no oh-my-openagent detected: '' everywhere uses your session default; map models per role instead if you prefer.",
        billingNote: "each engine call is an `opencode run` on YOUR provider (OpenRouter/API credits if so configured) — a full lane can be hundreds of calls; route shell/light lanes to cheap models.",
      }, null, 2)
    }

    const enginePath = [a.enginePath || "", ...ENGINE_CANDIDATES].filter(Boolean).find(p => existsSync(p))
    if (!enginePath) return JSON.stringify({ error: "recursive-slice.js artifact not found", searched: ENGINE_CANDIDATES })
    const code = readFileSync(enginePath, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")

    const logs: string[] = []
    const log = (m: string) => { logs.push(String(m)) }
    const phase = (t: string) => { logs.push(`══ ${t} ══`) }

    const shNative = (prompt: string) => new Promise<{ stdout: string; exitCode: number }>(resolve => {
      // engine sh() format: "...this one command:\n\n<cmd>" — extract and exec verbatim
      const cmd = prompt.split("\n\n").slice(1).join("\n\n")
      execFile("/bin/sh", ["-c", cmd], { cwd: a.repo, maxBuffer: 32e6, timeout: 30 * 60_000 },
        (err: (Error & { code?: number }) | null, stdout: string, stderr: string) =>
          resolve({ stdout: String(stdout) + String(stderr || ""), exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0 }))
    })
    const ocRun = (prompt: string, role: Role) => new Promise<string>((resolve, reject) => {
      const agentName = config!.roles?.[role] || ""
      const model = config!.models?.[role] || ""
      const argv = ["run",
        ...(agentName ? ["--agent", agentName] : []),
        ...(model ? ["--model", model] : []),
        prompt]
      execFile(process.env.OPENCODE_BIN || "opencode", argv,
        { cwd: a.repo, maxBuffer: 32e6, timeout: 30 * 60_000 },
        (err, stdout) => (stdout ? resolve(String(stdout)) : err ? reject(err) : resolve("")))
    })
    const agent = async (prompt: string, opts?: { schema?: object; label?: string; phase?: string; model?: string }) => {
      if (prompt.startsWith(SH_PREFIX)) return shNative(prompt)   // tier-0 truth without an LLM
      const role = roleOf(opts?.label || "", opts?.phase, opts?.model)
      const p = opts?.schema
        ? `${prompt}\n\nRespond with ONLY a single JSON object matching this JSON-Schema — no prose, no code fences:\n${JSON.stringify(opts.schema)}`
        : prompt
      for (let attempt = 0; attempt < 2; attempt++) {           // one retry on parse/process failure
        try {
          const out = await ocRun(p, role)
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
    return JSON.stringify({ engine: enginePath, roles: config.roles || {}, logs, result }, null, 2)
  },
})
