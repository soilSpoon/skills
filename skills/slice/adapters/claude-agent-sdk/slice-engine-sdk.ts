// Claude Agent SDK host for the recursive-slice engine — the THIRD Runtime adapter (after the
// Claude Code Workflow runtime and the opencode adapter). It runs the engine artifact in a real
// Node process, so the engine's deterministic shell proxy `sh()` executes via NATIVE execFile —
// NO shell-as-agent tax (the Workflow sandbox's structural cost: every git/test/build is a full
// haiku subagent round-trip). Model calls go through the Agent SDK `query()` with native structured
// output. On Max plans this draws on the same Claude subscription as interactive Claude Code (the
// announced 2026-06-15 "Agent SDK → credit pool" change was PAUSED — verify in Settings>Usage).
//
// Composes PR1 (the engine depends on an injected Runtime) + PR2 (AgentOutcome). Isolated package:
// zero deps leak into the core (own package.json/tsconfig/node_modules).
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import type { query as SdkQuery } from "@anthropic-ai/claude-agent-sdk"
import { trackProcessGroup, trackQuery } from "./lifecycle.mjs"

// ── Native shell — the whole point: sh() runs DIRECTLY, no model, no agent spawn ────────────────
// The engine's sh() builds a prompt: "Run EXACTLY this shell command…\n\n<cmd>". We split off the
// command and run it via /bin/sh, returning the {stdout, exitCode} shape the engine's SH schema expects.
export const SH_PREFIX = "Run EXACTLY this shell command"
export const isShPrompt = (prompt: string) => prompt.startsWith(SH_PREFIX)
export const shNative = (prompt: string, cwd: string): Promise<{ stdout: string; exitCode: number }> =>
  new Promise((resolve) => {
    const cmd = prompt.split("\n\n").slice(1).join("\n\n")
    // detached:true → child is its OWN process-group leader (pgid===pid); lets us reap the whole
    // xcodebuild→XCBBuildService→swift-frontend subtree via process.kill(-pid) on cleanup. NOT unref'd:
    // we track and reap it, never let it outlive us.
    const child = spawn("/bin/sh", ["-c", cmd], { cwd, detached: true })
    const untrack = trackProcessGroup(child.pid as number)

    let out = ""
    let truncated = false
    const MAX = 32e6
    const push = (b: Buffer) => {
      if (truncated) return
      out += b.toString()
      if (out.length > MAX) { out = out.slice(0, MAX); truncated = true; try { process.kill(-(child.pid as number), "SIGTERM") } catch {} }
    }
    child.stdout?.on("data", push)
    child.stderr?.on("data", push)

    // 30-min timeout → group-kill (matches execFile's old timeout semantics, but reaps the TREE).
    const timer = setTimeout(() => { try { process.kill(-(child.pid as number), "SIGTERM") } catch {} }, 30 * 60_000)

    const finish = (code: number) => { clearTimeout(timer); untrack(); resolve({ stdout: out, exitCode: code }) }
    child.on("close", (code, signal) => finish(typeof code === "number" ? code : signal ? 1 : 0))
    child.on("error", () => finish(1))   // spawn failure → exitCode 1, mirrors old err→1 mapping
  })

// ── AgentOutcome — same discriminated union as PR2 (src/types.ts), reused at the adapter boundary ─
export type Outcome =
  | { ok: true; value: unknown }
  | { ok: false; kind: "schema" | "quota" | "model_unavailable" | "timeout" | "refusal" | "null"; detail: string }

// classifyAgentSdkResult — maps an Agent SDK `type:'result'` message to an Outcome.
//   subtype 'success' + stop_reason 'refusal' → refusal
//   subtype 'success'                          → ok (structured_output, else the text result)
//   error_max_structured_output_retries        → schema
//   error_max_budget_usd                       → quota
//   error_max_turns                            → timeout
//   error_during_execution                     → quota (429/402) / model_unavailable (5xx or default)
export type SdkResult = {
  subtype: string
  stop_reason?: string | null
  structured_output?: unknown
  result?: string
  api_error_status?: number | null
}
export function classifyAgentSdkResult(m: SdkResult): Outcome {
  if (m.subtype === "success") {
    if (m.stop_reason === "refusal") return { ok: false, kind: "refusal", detail: "stop_reason=refusal" }
    return { ok: true, value: m.structured_output !== undefined ? m.structured_output : m.result }
  }
  switch (m.subtype) {
    case "error_max_structured_output_retries": return { ok: false, kind: "schema", detail: m.subtype }
    case "error_max_budget_usd": return { ok: false, kind: "quota", detail: m.subtype }
    case "error_max_turns": return { ok: false, kind: "timeout", detail: m.subtype }
    default: {
      const s = m.api_error_status ?? undefined
      if (s === 429 || s === 402) return { ok: false, kind: "quota", detail: `${m.subtype} ${s}` }
      if (s != null && s >= 500) return { ok: false, kind: "model_unavailable", detail: `${m.subtype} ${s}` }
      return { ok: false, kind: "model_unavailable", detail: `${m.subtype}${s != null ? ` ${s}` : ""}` }
    }
  }
}

// ── Role routing (which persona + tools a call needs) — mirrors the opencode adapter ────────────
export type Role =
  | "baseliner" | "slicer" | "executor" | "verifier" | "heavyLens"
  | "critic" | "spiker" | "coordinator" | "briefing" | "wiringAudit" | "default"
export const roleOf = (label: string, phase?: string, model?: string): Role => {
  const l = label.replace(/^(g\d+|seq\d+):/, "")
  if (phase === "Baseline") return "baseliner"
  if (/^(slice|partition|decompose)/.test(l)) return "slicer"
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
// Editing roles get write+bash; read-only judges get read+bash (the engine's deterministic sh() is
// separate — it never reaches the model — so even read-only roles only need Bash for their own probes).
const EDIT_ROLES = new Set<Role>(["executor", "spiker", "coordinator"])
export const toolsFor = (role: Role): string[] =>
  EDIT_ROLES.has(role) ? ["Read", "Edit", "Write", "Bash", "Grep", "Glob"] : ["Read", "Grep", "Glob", "Bash"]

// Engine model tier (opts.model) → Claude model id. Unknown tiers fall through to the SDK default.
const MODEL_ID: Record<string, string> = {
  opus: "claude-opus-4-8", sonnet: "claude-sonnet-4-6", haiku: "claude-haiku-4-5",
}
export const modelFor = (tier?: string): string | undefined => (tier ? MODEL_ID[tier] : undefined)

export type AgentOpts = { schema?: object; model?: string; label?: string; phase?: string; agentType?: string }
export type Budget = { add(usd: number): void; spent(): number }

// agentCall — ONE engine node evaluation via the Agent SDK. `runQuery` is injected (the real SDK
// `query` in production; a mock in tests) so the whole mapping is unit-testable with zero tokens.
export async function agentCall(
  prompt: string,
  opts: AgentOpts,
  deps: { runQuery: typeof SdkQuery; cwd: string; persona: (role: Role) => string | undefined; budget?: Budget },
): Promise<Outcome> {
  const role = roleOf(opts.label || "", opts.phase, opts.model)
  const model = modelFor(opts.model)
  const systemPrompt = deps.persona(role)
  const abort = new AbortController()
  const options: Record<string, unknown> = {
    allowedTools: toolsFor(role),
    cwd: deps.cwd,
    permissionMode: "bypassPermissions",
    abortController: abort,
    ...(model ? { model } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(opts.schema ? { outputFormat: { type: "json_schema", schema: opts.schema } } : {}),
  }
  const q = deps.runQuery({ prompt, options } as Parameters<typeof SdkQuery>[0])
  // Register this in-flight query so a SIGTERM/SIGINT mid-run aborts the turn AND hard-closes the
  // 'claude' CLI subprocess (q.close()). close is optional-chained: mocks in tests have no .close.
  const untrack = trackQuery(abort, () => { try { (q as { close?: () => void }).close?.() } catch {} })
  try {
    for await (const m of q as AsyncIterable<{ type: string } & SdkResult & { total_cost_usd?: number }>) {
      if (m.type !== "result") continue
      if (deps.budget && typeof m.total_cost_usd === "number") deps.budget.add(m.total_cost_usd)
      return classifyAgentSdkResult(m)
    }
    return { ok: false, kind: "null", detail: "no result message" }
  } finally {
    untrack()   // natural completion (or throw) deregisters; cleanup never targets a done query.
  }
}

// ── Host the engine artifact (the AsyncFunction trick, faithful to test/host.mjs + the runtime) ──
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...a: string[]) => (...a: unknown[]) => Promise<unknown>
const isShOpts = (o: { schema?: { required?: unknown } } | undefined) =>
  !!(o && o.schema && Array.isArray(o.schema.required) && o.schema.required.length === 1 && o.schema.required[0] === "exitCode")

export async function runEngine(opts: {
  artifactPath: string
  args: { task?: string; repo?: string; [k: string]: unknown }
  runQuery: typeof SdkQuery
  persona?: (role: Role) => string | undefined
  log?: (m: string) => void
}): Promise<unknown> {
  let src = await readFile(opts.artifactPath, "utf8")
  src = src.replace(/^export const meta/m, "const meta") // neutralize the one export, exactly as the runtime does
  const repo = (opts.args.repo as string) || process.cwd()
  const persona = opts.persona ?? (() => undefined)
  const log = opts.log ?? ((m: string) => process.stderr.write(String(m) + "\n"))
  let spentUsd = 0
  const budget = { total: null as number | null, spent: () => spentUsd, remaining: () => Infinity, add: (usd: number) => { spentUsd += usd } }

  const agent = async (prompt: string, o: AgentOpts = {}) => {
    if (isShOpts(o)) return shNative(prompt, repo) // NATIVE shell — the tax-free path
    const out = await agentCall(prompt, o, { runQuery: opts.runQuery, cwd: repo, persona, budget })
    // Runtime.agent contract is value|null (host.ts agentSafe re-classifies); a typed-quota throw is a
    // follow-up so QUOTA_HALT fires on kind:'quota' rather than the generic null-streak. v1: value|null.
    return out.ok ? out.value : null
  }
  const parallel = async <T,>(thunks: Array<() => Promise<T>>) => Promise.all(thunks.map((t) => t().catch(() => null)))
  const fn = new AsyncFunction("agent", "log", "phase", "budget", "args", "pipeline", "parallel", "workflow", src)
  return fn(
    agent, log, (_t: string) => {}, budget, opts.args,
    async () => { throw new Error("pipeline unused by engine") },
    parallel,
    async () => { throw new Error("nested workflow unused by engine") },
  )
}
