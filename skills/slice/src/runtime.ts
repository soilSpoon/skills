// L1 — the Claude Code WorkflowRuntime ADAPTER: the SINGLE place that touches the Workflow runtime's
// ambient globals (agent/parallel/phase/log/budget/args, injected into the AsyncFunction body the tsup
// bundle becomes). The engine core (main/phases/host) depends only on the Runtime TYPE (types.ts, L0) —
// never on these globals. A second adapter (opencode, over @opencode-ai/sdk) satisfies the same Runtime
// without touching this file. The architecture fitness test asserts NO other src file declares these
// globals, so the ambient PORT cannot silently regrow across the codebase. All declares erase at build.
//
// Billing note (Claude Max, from 2026-06-15): running via THIS Workflow path = interactive Claude Code =
// the Max subscription pool. The Agent SDK path bills a separate monthly credit pool instead — so for a
// Max-plan user this WorkflowRuntime stays the primary Claude adapter; an Agent-SDK Runtime is opt-in.
import type { Runtime, AgentOpts } from './types'

declare function agent(prompt: string, opts?: AgentOpts): Promise<any>
declare function parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>
declare function phase(title: string): void
declare function log(message: string): void
declare const budget: { total: number | null; spent(): number; remaining(): number }
declare const args: unknown

export const makeWorkflowRuntime = (): Runtime => ({ agent, parallel, phase, log, budget, args })
