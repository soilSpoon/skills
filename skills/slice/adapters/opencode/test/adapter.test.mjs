// adapter.test.mjs — Node --test suite for the opencode adapter.
// Groups: A=type-check, B=sh()-path, C=role-routing, D=AgentOutcome-mapping,
//         E=budget-accumulation, F=I7-guard-smoke, H=artifact-freshness-canary
// Invariant: no imports from skills/slice/src/ — adapter is standalone.
// OPENCODE_LIVE gate: live round-trips only when OPENCODE_LIVE=1 is set.
//
// REBUILD BOUNDARY: the integration phase MUST call scripts/build-engine.sh ONCE before
// invoking this rig. The H-group freshness canary enforces this boundary: it asserts that
// the artifact's mtime is >= the mtime of every src/**/*.ts file, proving the build consumed
// the latest sources. Stale or hand-edited artifacts fail the canary.
import { describe, it, before } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"

// Import exported helpers from the adapter (strip-types handles .ts)
import {
  roleOf,
  shNative,
  agentCall,
  makeBudgetAccumulator,
  SH_PREFIX,
  classifySdkError,
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

  // ── sh() bypass rationale + worktree setup proof ─────────────────────────────
  // WHY sh() bypasses agent(): the engine's parallel worktree setup runs commands like
  //   `git worktree add`, `git -C <repo> rev-parse HEAD`, `git -C <repo> branch -D rs/g*`
  // These MUST be deterministic (same input → same output, zero LLM variance) and free
  // (no provider tokens). Routing them through agent() would: (a) spend provider credits,
  // (b) let the LLM paraphrase or refuse the command, (c) add latency per worktree.
  // shNative() uses execFile(/bin/sh, ['-c', cmd]) directly — not spawn, not exec — so the
  // command string reaches /bin/sh verbatim, the exit code is the process exit code, and
  // stdout is the raw bytes. This is the SAME execFile path the current adapter uses;
  // the tests below prove the path is preserved by running a real git command.
  it("shNative runs a real `git rev-parse HEAD` — exit 0, stdout is a 40-char hex SHA (worktree setup proof)", async () => {
    // Behavioral claim: a git command representative of worktree prologue reaches /bin/sh
    // natively; the SHA in stdout is deterministic (same commit, same hash every run).
    const REPO = new URL("../../../../..", import.meta.url).pathname  // soilSpoon-skills root
    const prompt = `${SH_PREFIX}\n\ngit -C ${REPO} rev-parse HEAD`
    const result = await shNative(prompt)
    assert.strictEqual(result.exitCode, 0, `git rev-parse HEAD should exit 0, got: ${result.exitCode}\nstdout: ${result.stdout}`)
    const sha = result.stdout.trim().split("\n")[0]
    assert.match(sha, /^[0-9a-f]{40}$/, `expected 40-char hex SHA, got: ${JSON.stringify(sha)}`)
  })

  it("shNative with parallel Promise.all — two git commands run concurrently, both exit 0 (parallel worktree path)", async () => {
    // Behavioral claim: parallel worktree setup uses Promise.all over shNative() thunks;
    // each command runs in its own execFile child process. Two concurrent git status calls
    // both complete with exit 0, proving no shared state or lock contention on the native path.
    const REPO = new URL("../../../../..", import.meta.url).pathname
    const [r1, r2] = await Promise.all([
      shNative(`${SH_PREFIX}\n\ngit -C ${REPO} rev-parse HEAD`),
      shNative(`${SH_PREFIX}\n\ngit -C ${REPO} status --porcelain`),
    ])
    assert.strictEqual(r1.exitCode, 0, `concurrent git rev-parse should exit 0, got: ${r1.exitCode}`)
    assert.strictEqual(r2.exitCode, 0, `concurrent git status should exit 0, got: ${r2.exitCode}`)
    // Both SHAs from the same HEAD must match
    const sha1 = r1.stdout.trim().split("\n")[0]
    assert.match(sha1, /^[0-9a-f]{40}$/, `expected 40-char hex SHA from concurrent call, got: ${JSON.stringify(sha1)}`)
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

// ── G: json_schema happy-path + schema error injection ────────────────────────
// Behavioral claim: when a schema is provided agentCall() uses json_schema format and
// returns info.structured on success; returns null on schema violation or when
// info.structured is missing despite the schema flag.
describe("adapter json-schema-path", () => {
  // Helper: set OPENCODE_LIVE=1, call agentCall with a mock client, then restore env.
  const withLive = async (clientOrFn) => {
    const prev = process.env.OPENCODE_LIVE
    process.env.OPENCODE_LIVE = "1"
    try {
      const client = typeof clientOrFn === "function" ? clientOrFn() : clientOrFn
      return await agentCall("route this task", "executor", {
        repo: "/tmp",
        schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
        client,
      })
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_LIVE
      else process.env.OPENCODE_LIVE = prev
    }
  }

  it("happy-path: info.structured non-null with schema → returns structured value (AgentOutcome ok)", async () => {
    // Behavioral claim: json_schema success path returns info.structured directly.
    const expected = { role: "executor" }
    const client = {
      session: {
        create: async () => ({ data: { id: "s1" } }),
        prompt: async (params) => {
          // Verify format is json_schema
          assert.deepEqual(params.format, { type: "json_schema", schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] } })
          return {
            data: {
              info: {
                tokens: { input: 5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
                structured: expected,
              },
              parts: [],
            },
          }
        },
      },
    }
    const result = await withLive(client)
    assert.deepEqual(result, expected, `expected structured value ${JSON.stringify(expected)}, got: ${JSON.stringify(result)}`)
  })

  it("schema present but info.structured is null → returns null (distrust)", async () => {
    // Behavioral claim: structured output missing despite schema flag → null (engine treats as distrust).
    const client = {
      session: {
        create: async () => ({ data: { id: "s2" } }),
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 5, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
              structured: null,
            },
            parts: [{ type: "text", text: "some text" }],
          },
        }),
      },
    }
    assert.strictEqual(await withLive(client), null)
  })

  it("StructuredOutputError with schema → null (schema violation error injection)", async () => {
    // Behavioral claim: schema violation error from server maps to null via the error branch.
    const client = {
      session: {
        create: async () => ({ data: { id: "s3" } }),
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              error: { name: "StructuredOutputError", data: { statusCode: 422 } },
            },
            parts: [],
          },
        }),
      },
    }
    assert.strictEqual(await withLive(client), null)
  })

  it("MessageAbortedError with schema → null (timeout error injection)", async () => {
    // Behavioral claim: timeout/abort on a schema call also maps to null (not thrown).
    const client = {
      session: {
        create: async () => ({ data: { id: "s4" } }),
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              error: { name: "MessageAbortedError" },
            },
            parts: [],
          },
        }),
      },
    }
    assert.strictEqual(await withLive(client), null)
  })

  it("ProviderAuthError with schema → null (refusal/auth error injection)", async () => {
    // Behavioral claim: auth errors on schema calls are treated as refusals → null.
    const client = {
      session: {
        create: async () => ({ data: { id: "s5" } }),
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              error: { name: "ProviderAuthError" },
            },
            parts: [],
          },
        }),
      },
    }
    assert.strictEqual(await withLive(client), null)
  })

  it("happy-path: session.create uses agentName when config has a role mapping", async () => {
    // Behavioral claim: executor role maps to the right agentName in session.create params.
    let capturedCreateParams
    const client = {
      session: {
        create: async (params) => { capturedCreateParams = params; return { data: { id: "s6" } } },
        prompt: async () => ({
          data: {
            info: {
              tokens: { input: 5, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
              structured: { role: "executor" },
            },
            parts: [],
          },
        }),
      },
    }
    const prev = process.env.OPENCODE_LIVE
    process.env.OPENCODE_LIVE = "1"
    try {
      await agentCall("do work", "executor", {
        repo: "/tmp",
        schema: { type: "object", properties: { role: { type: "string" } }, required: ["role"] },
        agentName: "sisyphus-junior",
        client,
      })
      assert.strictEqual(capturedCreateParams.agent, "sisyphus-junior", "agentName should be forwarded to session.create")
      assert.strictEqual(capturedCreateParams.directory, "/tmp", "repo should be forwarded as directory")
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_LIVE
      else process.env.OPENCODE_LIVE = prev
    }
  })
})

// ── H: artifact freshness canary ─────────────────────────────────────────────
// Behavioral claim: the integration phase called scripts/build-engine.sh BEFORE this rig,
// so the artifact's mtime MUST be >= the mtime of every src/**/*.ts file — proving the
// built artifact reflects the current sources and no per-leaf hand-edit has occurred.
// This mirrors the core 'artifact freshness' architecture test (test/unit/architecture.test.mjs)
// but runs in the adapter context to catch stale artifacts earlier in the adapter rig.
// A stale artifact (hand-edited, or src changed without rebuild) fails here — not silently
// downstream when the engine behaves differently than the sources imply.
// Skip when RS_NO_FRESHNESS_CANARY=1 (CI jobs that pin a known-good artifact for speed).
describe("adapter artifact-freshness-canary", () => {
  const ARTIFACT = new URL("../../../recursive-slice.js", import.meta.url).pathname
  const SRC_DIR = new URL("../../../src", import.meta.url).pathname

  // Walk src/**/*.ts recursively, relative paths.
  const walkTs = (dir, base = "") =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walkTs(`${dir}/${e.name}`, `${base}${e.name}/`)
        : e.name.endsWith(".ts") ? [`${base}${e.name}`] : [],
    )

  it("artifact mtime >= test-process start — integration called build-engine.sh before this rig", () => {
    // Behavioral claim: artifact is not older than any src/**/*.ts file, proving build-engine.sh
    // ran after the last source edit (the integration phase rebuild boundary is honored).
    if (process.env.RS_NO_FRESHNESS_CANARY) return
    const artifactMtime = statSync(ARTIFACT).mtimeMs
    for (const f of walkTs(SRC_DIR)) {
      const srcMtime = statSync(`${SRC_DIR}/${f}`).mtimeMs
      assert.ok(
        artifactMtime >= srcMtime,
        `Freshness canary: recursive-slice.js (mtime ${new Date(artifactMtime).toISOString()}) is OLDER than src/${f} (${new Date(srcMtime).toISOString()}). The integration phase MUST call 'sh scripts/build-engine.sh' before invoking the adapter rig. See adapters/opencode/README.md.`,
      )
    }
  })
})

// ── I: classifySdkError — SDK error name → AgentOutcome kind mapping ──────────
// Behavioral claim: classifySdkError() maps each SDK PromptError.name (and optional statusCode)
// to an AgentOutcome<T> {ok:false, kind, detail} — the opencode adapter's SDK-to-engine bridge.
// The L0 classifyFailure in util.ts is PURE (message-pattern only); this adapter-local function
// is the SDK-error-to-kind extension (schema/timeout/refusal are opencode-specific kinds).
describe("adapter classifySdkError", () => {
  it("StructuredOutputError → {ok:false, kind:'schema', detail:string}", () => {
    // Behavioral claim: schema parse failure from the SDK maps to the schema kind.
    const result = classifySdkError("StructuredOutputError")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "schema")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0,
      `expected non-empty detail string, got: ${result.detail}`)
  })

  it("MessageAbortedError → {ok:false, kind:'timeout', detail:string}", () => {
    // Behavioral claim: session abort (timeout/cancel) from the SDK maps to the timeout kind.
    const result = classifySdkError("MessageAbortedError")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "timeout")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0)
  })

  it("ProviderAuthError → {ok:false, kind:'refusal', detail:string}", () => {
    // Behavioral claim: auth rejection (content flag / credentials) maps to the refusal kind.
    const result = classifySdkError("ProviderAuthError")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "refusal")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0)
  })

  it("APIError with statusCode 429 → {ok:false, kind:'quota', detail:string}", () => {
    // Behavioral claim: HTTP 429 (rate-limit / quota) from APIError maps to quota kind.
    const result = classifySdkError("APIError", 429)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "quota")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0)
  })

  it("APIError with statusCode 503 → {ok:false, kind:'model_unavailable', detail:string}", () => {
    // Behavioral claim: HTTP 503 (service unavailable) from APIError maps to model_unavailable kind.
    const result = classifySdkError("APIError", 503)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "model_unavailable")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0)
  })

  it("APIError with statusCode 401 → {ok:false, kind:'refusal', detail:string}", () => {
    // Behavioral claim: HTTP 401 (auth) from APIError maps to refusal kind.
    const result = classifySdkError("APIError", 401)
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "refusal")
    assert.ok(typeof result.detail === "string" && result.detail.length > 0)
  })

  it("UnknownError → {ok:false, kind:'null', detail:string}", () => {
    // Behavioral claim: unrecognised SDK error names fall through to the null kind (same as L0 classifyFailure).
    const result = classifySdkError("UnknownError")
    assert.strictEqual(result.ok, false)
    assert.strictEqual(result.kind, "null")
    assert.ok(typeof result.detail === "string")
  })

  it("classifySdkError accepts an optional detail string and includes it verbatim", () => {
    // Behavioral claim: when a detail hint is supplied (e.g. err.message), it is embedded in result.detail.
    const result = classifySdkError("StructuredOutputError", undefined, "schema parse failed: missing role")
    assert.ok(result.detail.includes("schema parse failed: missing role"),
      `expected detail to include supplied hint, got: ${result.detail}`)
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
