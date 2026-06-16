// adapter.test.mjs — Node --test suite for the opencode adapter.
// Groups: A=type-check, B=sh()-path, C=role-routing, D=AgentOutcome-mapping,
//         E=budget-accumulation, F=I7-guard-smoke
// Invariant: no imports from skills/slice/src/ — adapter is standalone.
// OPENCODE_LIVE gate: live round-trips only when OPENCODE_LIVE=1 is set.
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

// Import exported helpers from the adapter (strip-types handles .ts)
import {
  roleOf,
  shNative,
  agentCall,
  makeBudgetAccumulator,
  SH_PREFIX,
} from "../slice-engine.ts"

// ── A: type-check ─────────────────────────────────────────────────────────────
// Behavioral claim: tsc --noEmit exits 0 — the adapter has no type errors.
describe("adapter type-check", () => {
  it("tsc --noEmit exits 0 — no type errors in the adapter", () => {
    const r = spawnSync(
      process.execPath,
      ["node_modules/.bin/tsc", "--noEmit"],
      { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" },
    )
    assert.strictEqual(r.status, 0, `tsc failed:\n${r.stdout}\n${r.stderr}`)
  })
})

// ── B: sh() path ──────────────────────────────────────────────────────────────
// Behavioral claim: shNative() runs /bin/sh directly; `echo hello` returns stdout "hello" and exitCode 0.
describe("adapter sh-path", () => {
  it("shNative executes `echo hello` natively — stdout contains hello and exitCode is 0", async () => {
    const prompt = `${SH_PREFIX}\n\necho hello`
    const result = await shNative(prompt)
    assert.strictEqual(result.exitCode, 0)
    assert.ok(result.stdout.includes("hello"), `expected stdout to include "hello", got: ${result.stdout}`)
  })

  it("shNative returns exitCode 1 for a failing command", async () => {
    const prompt = `${SH_PREFIX}\n\nexit 1`
    const result = await shNative(prompt)
    assert.strictEqual(result.exitCode, 1)
  })
})

// ── C: role-routing ───────────────────────────────────────────────────────────
// Behavioral claim: roleOf() maps every engine label/phase combination to the expected Role string.
// All 11 roles are covered.
describe("adapter role-routing", () => {
  it("phase=Baseline → baseliner (phase wins over label)", () => {
    assert.strictEqual(roleOf("anything", "Baseline"), "baseliner")
  })
  it("label=assess* → assessor", () => {
    assert.strictEqual(roleOf("assess-complexity"), "assessor")
  })
  it("label=slice* → slicer", () => {
    assert.strictEqual(roleOf("slice-work"), "slicer")
  })
  it("label=partition* → slicer (alias)", () => {
    assert.strictEqual(roleOf("partition-lanes"), "slicer")
  })
  it("label=exec* → executor", () => {
    assert.strictEqual(roleOf("exec-leaf"), "executor")
  })
  it("label=spike* → spiker", () => {
    assert.strictEqual(roleOf("spike-approach"), "spiker")
  })
  it("label=critic* → critic", () => {
    assert.strictEqual(roleOf("critic-review"), "critic")
  })
  it("label=owner-briefing* → briefing", () => {
    assert.strictEqual(roleOf("owner-briefing-final"), "briefing")
  })
  it("label=wiring-audit* → wiringAudit", () => {
    assert.strictEqual(roleOf("wiring-audit-callsites"), "wiringAudit")
  })
  it("label=merge-conflict* → coordinator", () => {
    assert.strictEqual(roleOf("merge-conflict-resolve"), "coordinator")
  })
  it("model=opus → heavyLens (cross-model diversity)", () => {
    assert.strictEqual(roleOf("any-label", undefined, "opus"), "heavyLens")
  })
  it("label=verify* → verifier", () => {
    assert.strictEqual(roleOf("verify-leaf"), "verifier")
  })
  it("label=merge-verify* → verifier", () => {
    assert.strictEqual(roleOf("merge-verify"), "verifier")
  })
  it("label=integration* → verifier", () => {
    assert.strictEqual(roleOf("integration-net"), "verifier")
  })
  it("phase=Integrate → verifier (phase wins)", () => {
    assert.strictEqual(roleOf("anything", "Integrate"), "verifier")
  })
  it("phase=Coordinate → verifier", () => {
    assert.strictEqual(roleOf("anything", "Coordinate"), "verifier")
  })
  it("parallel-group prefix g1: stripped before matching", () => {
    assert.strictEqual(roleOf("g1:exec-leaf"), "executor")
  })
  it("parallel-group prefix seq2: stripped before matching", () => {
    assert.strictEqual(roleOf("seq2:slice-work"), "slicer")
  })
  it("unmapped label → default", () => {
    assert.strictEqual(roleOf("unknown-label"), "default")
  })
})

// ── D: AgentOutcome mapping ───────────────────────────────────────────────────
// Behavioral claim: agentCall() maps each AssistantMessage.error variant to null (distrust signal).
// A mock OpencodeClient is used; OPENCODE_LIVE=1 is set/unset around each call.
describe("adapter AgentOutcome-mapping", () => {
  // Helper: build mock client that returns a specific error name from session.prompt
  const makeMockClient = (errorName) => ({
    session: {
      create: async () => ({ data: { id: "s1" } }),
      prompt: async () => ({
        data: {
          info: {
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            error: { name: errorName, data: {} },
          },
          parts: [],
        },
      }),
    },
  })

  // Helper: agentCall with OPENCODE_LIVE=1 temporarily set and a mock client
  const callWithMock = async (errorName) => {
    const prev = process.env.OPENCODE_LIVE
    process.env.OPENCODE_LIVE = "1"
    try {
      return await agentCall("test prompt", "executor", {
        repo: "/tmp",
        client: makeMockClient(errorName),
      })
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_LIVE
      else process.env.OPENCODE_LIVE = prev
    }
  }

  it("StructuredOutputError → null (schema distrust)", async () => {
    assert.strictEqual(await callWithMock("StructuredOutputError"), null)
  })
  it("MessageAbortedError → null (timeout)", async () => {
    assert.strictEqual(await callWithMock("MessageAbortedError"), null)
  })
  it("ProviderAuthError → null (model_unavailable)", async () => {
    assert.strictEqual(await callWithMock("ProviderAuthError"), null)
  })
  it("APIError → null (quota/other)", async () => {
    assert.strictEqual(await callWithMock("APIError"), null)
  })
  it("UnknownError → null (catch-all)", async () => {
    assert.strictEqual(await callWithMock("UnknownError"), null)
  })
  it("any other error name → null (default branch)", async () => {
    assert.strictEqual(await callWithMock("SomeNewErrorType"), null)
  })
  it("without OPENCODE_LIVE set, agentCall returns null immediately (no client call)", async () => {
    const prev = process.env.OPENCODE_LIVE
    delete process.env.OPENCODE_LIVE
    try {
      let clientCalled = false
      const client = {
        session: {
          create: async () => { clientCalled = true; return { data: { id: "x" } } },
          prompt: async () => { clientCalled = true; return { data: { info: { tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [] } } },
        },
      }
      const result = await agentCall("test", "executor", { repo: "/tmp", client })
      assert.strictEqual(result, null)
      assert.strictEqual(clientCalled, false, "client should not be called when OPENCODE_LIVE is unset")
    } finally {
      if (prev !== undefined) process.env.OPENCODE_LIVE = prev
    }
  })
})

// ── E: budget accumulation ────────────────────────────────────────────────────
// Behavioral claim: budget.spent() sums input+output+reasoning+cache.read+cache.write across calls.
describe("adapter budget-accumulation", () => {
  it("makeBudgetAccumulator().spent() === 38 after one add({input:10,output:20,reasoning:5,cache:{read:2,write:1}})", () => {
    const budget = makeBudgetAccumulator()
    budget.add({ input: 10, output: 20, reasoning: 5, cache: { read: 2, write: 1 } })
    assert.strictEqual(budget.spent(), 38)
  })

  it("budget accumulates across multiple agentCall()-style adds", () => {
    const budget = makeBudgetAccumulator()
    budget.add({ input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } })
    budget.add({ input: 3, output: 4, reasoning: 0, cache: { read: 0, write: 0 } })
    assert.strictEqual(budget.spent(), 10)
  })

  it("agentCall() accumulates tokens in budget when OPENCODE_LIVE=1 and no error", async () => {
    // Mock client returns a successful AssistantMessage with token counts
    const budget = makeBudgetAccumulator()
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 2, write: 1 } },
            },
            parts: [{ type: "text", text: "ok" }],
          },
        }),
      },
    }
    const prev = process.env.OPENCODE_LIVE
    process.env.OPENCODE_LIVE = "1"
    try {
      await agentCall("test prompt", "executor", { repo: "/tmp", client, budget })
      assert.strictEqual(budget.spent(), 38)
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_LIVE
      else process.env.OPENCODE_LIVE = prev
    }
  })
})

// ── F: I7 guard smoke ─────────────────────────────────────────────────────────
// Behavioral claim: the artifact's I7 guard returns {error} with zero agent calls when no task is given.
// Re-pins the host-smoke.mjs assertions under the Node test runner.
describe("adapter I7-guard-smoke", () => {
  const ARTIFACT = new URL("../../../recursive-slice.js", import.meta.url).pathname
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const smokeBudget = { total: null, spent: () => 0, remaining: () => Infinity }

  let code
  before(() => {
    code = readFileSync(ARTIFACT, "utf8").replace(/^export const meta = \{[\s\S]*?\n\}\n/, "")
  })

  const makeRun = () => new AsyncFunction(
    "agent", "parallel", "pipeline", "phase", "log", "workflow", "args", "budget", code,
  )

  it("I7 guard: no task in args → result.error truthy and zero agent calls made", async () => {
    // Behavioral claim: engine refuses to run without args.task; I7 guard fires immediately.
    let agentCalls = 0
    const agent = async () => { agentCalls++; return null }
    const result = await makeRun()(
      agent,
      (ts) => Promise.all(ts.map((f) => f().catch(() => null))),
      null,
      (t) => void t,
      (m) => void m,
      null,
      {},
      smokeBudget,
    )
    assert.strictEqual(agentCalls, 0, "I7 guard should fire before any agent calls")
    assert.ok(result && result.error, `expected result.error to be truthy, got: ${JSON.stringify(result)}`)
  })

  it("parallel:true forwarded — engine logs [parallel mode] before baseline null-abort", async () => {
    // Behavioral claim: args.parallel reaches the PARALLEL flag through the PORT args binding.
    const logs = []
    const agent = async () => null
    await makeRun()(
      agent,
      (ts) => Promise.all(ts.map((f) => f().catch(() => null))),
      null,
      (t) => logs.push(`== ${t}`),
      (m) => logs.push(m),
      null,
      { task: "adapter-I7-guard-smoke", parallel: true },
      smokeBudget,
    )
    assert.ok(
      logs.some((l) => l.includes("[parallel mode]")),
      `expected log containing "[parallel mode]", got: ${JSON.stringify(logs)}`,
    )
  })

  it("noRigStop gate fires when rigPresent:false and no confirmNoRig", async () => {
    // Behavioral claim: testing-readiness gate emits {noRigStop:true, error} before any work is done.
    const baseliner = async (_p, opts) => {
      if (opts && opts.phase === "Baseline")
        return { summary: "smoke", invariants: [], measureCommand: "true", currentState: "green", rigPresent: false }
      return null
    }
    const result = await makeRun()(
      baseliner,
      (ts) => Promise.all(ts.map((f) => f().catch(() => null))),
      null,
      () => {},
      () => {},
      null,
      { task: "adapter-I7-guard-smoke" },
      smokeBudget,
    )
    assert.ok(result && result.noRigStop === true, `expected noRigStop:true, got: ${JSON.stringify(result)}`)
    assert.ok(result.error, "expected result.error to be truthy alongside noRigStop")
  })

  it("confirmNoRig:true overrides noRigStop gate — engine continues past the gate", async () => {
    // Behavioral claim: the confirmNoRig flag suppresses the testing-readiness stop.
    const baseliner = async (_p, opts) => {
      if (opts && opts.phase === "Baseline")
        return { summary: "smoke", invariants: [], measureCommand: "true", currentState: "green", rigPresent: false }
      return null
    }
    const result = await makeRun()(
      baseliner,
      (ts) => Promise.all(ts.map((f) => f().catch(() => null))),
      null,
      () => {},
      () => {},
      null,
      { task: "adapter-I7-guard-smoke", confirmNoRig: true },
      smokeBudget,
    )
    assert.ok(!result || result.noRigStop !== true, `noRigStop gate should be suppressed, got: ${JSON.stringify(result)}`)
  })

  it("noRigStop gate stays quiet when rigPresent:true", async () => {
    // Behavioral claim: gate is keyed on rigPresent === false; present rig → no noRigStop.
    const baseliner = async (_p, opts) => {
      if (opts && opts.phase === "Baseline")
        return { summary: "smoke", invariants: [], measureCommand: "true", currentState: "green", rigPresent: true }
      return null
    }
    const result = await makeRun()(
      baseliner,
      (ts) => Promise.all(ts.map((f) => f().catch(() => null))),
      null,
      () => {},
      () => {},
      null,
      { task: "adapter-I7-guard-smoke" },
      smokeBudget,
    )
    assert.ok(!result || result.noRigStop !== true, `noRigStop gate should not fire when rigPresent:true, got: ${JSON.stringify(result)}`)
  })
})

// ── LIVE round-trip gate (opt-in: OPENCODE_LIVE=1) ───────────────────────────
// Behavioral claim: a real opencode session returns a non-null string for a trivial prompt.
if (process.env.OPENCODE_LIVE) {
  describe("adapter live-round-trip OPENCODE_LIVE", () => {
    it("live agentCall returns non-null for a simple text prompt", async () => {
      // This test spends provider tokens — only runs when OPENCODE_LIVE=1 is set.
      const { createOpencodeClient } = await import("@opencode-ai/sdk/v2/client")
      const client = createOpencodeClient()
      const result = await agentCall("Say ONLY the word: hello", "default", {
        repo: process.cwd(),
        client,
      })
      assert.ok(result !== null, "live call should return a non-null result")
    })
  })
}
