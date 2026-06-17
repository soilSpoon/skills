// Deterministic smoke test for the Claude Agent SDK adapter — NO real SDK calls, NO tokens.
// `agentCall` takes an injected runQuery, so the whole mapping is testable with a mock generator.
// Run: node --experimental-strip-types --test test/adapter.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  shNative, isShPrompt, classifyAgentSdkResult, roleOf, toolsFor, modelFor, agentCall,
} from '../slice-engine-sdk.ts'
import {
  trackProcessGroup, trackQuery, cleanup, sweepPidfile, configurePidfile, __resetForTests,
} from '../lifecycle.mjs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

// ── the native-shell path (the whole point: sh() runs WITHOUT a model) ──────────────────────────
test('shNative runs a shell-runner prompt natively, captures stdout + exit 0', async () => {
  const r = await shNative('Run EXACTLY this shell command…\n\necho hello-native', '/tmp')
  assert.match(r.stdout, /hello-native/)
  assert.equal(r.exitCode, 0)
})
test('shNative surfaces a non-zero exit code', async () => {
  const r = await shNative('Run EXACTLY…\n\nexit 3', '/tmp')
  assert.equal(r.exitCode, 3)
})
test('isShPrompt distinguishes shell-runner prompts from model prompts', () => {
  assert.ok(isShPrompt('Run EXACTLY this shell command verbatim…\n\ngit status'))
  assert.ok(!isShPrompt('You are the Slicer / decompose decision…'))
})

// ── AgentOutcome mapping ────────────────────────────────────────────────────────────────────────
test('classify: success → ok with structured_output', () => {
  assert.deepEqual(classifyAgentSdkResult({ subtype: 'success', structured_output: { a: 1 } }), { ok: true, value: { a: 1 } })
})
test('classify: success WITHOUT structured_output falls back to the text result', () => {
  assert.deepEqual(classifyAgentSdkResult({ subtype: 'success', result: 'hi' }), { ok: true, value: 'hi' })
})
test('classify: success + stop_reason refusal → refusal (refusal hides under success)', () => {
  const o = classifyAgentSdkResult({ subtype: 'success', stop_reason: 'refusal' })
  assert.equal(o.ok, false)
  assert.equal(o.kind, 'refusal')
})
test('classify: error subtypes → the right kind', () => {
  assert.equal(classifyAgentSdkResult({ subtype: 'error_max_structured_output_retries' }).kind, 'schema')
  assert.equal(classifyAgentSdkResult({ subtype: 'error_max_budget_usd' }).kind, 'quota')
  assert.equal(classifyAgentSdkResult({ subtype: 'error_max_turns' }).kind, 'timeout')
  assert.equal(classifyAgentSdkResult({ subtype: 'error_during_execution', api_error_status: 503 }).kind, 'model_unavailable')
  assert.equal(classifyAgentSdkResult({ subtype: 'error_during_execution', api_error_status: 429 }).kind, 'quota')
  assert.equal(classifyAgentSdkResult({ subtype: 'error_during_execution' }).kind, 'model_unavailable')
})

// ── role routing / tools / model tiers ──────────────────────────────────────────────────────────
test('roleOf routes labels + phase + model to engine roles', () => {
  assert.equal(roleOf('exec:3'), 'executor')
  assert.equal(roleOf('verify:1'), 'verifier')
  assert.equal(roleOf('', 'Baseline'), 'baseliner')
  assert.equal(roleOf('decompose:d0'), 'slicer')
  assert.equal(roleOf('g1:exec:2'), 'executor', 'parallel-group tag stripped')
  assert.equal(roleOf('anything', undefined, 'opus'), 'heavyLens')
})
test('toolsFor: editing roles get Edit/Write, read-only judges do not', () => {
  assert.ok(toolsFor('executor').includes('Edit'))
  assert.ok(toolsFor('executor').includes('Bash'))
  assert.ok(!toolsFor('verifier').includes('Edit'))
  assert.ok(toolsFor('verifier').includes('Read'))
})
test('modelFor maps engine tiers to Claude model ids', () => {
  assert.equal(modelFor('opus'), 'claude-opus-4-8')
  assert.equal(modelFor('sonnet'), 'claude-sonnet-4-6')
  assert.equal(modelFor('haiku'), 'claude-haiku-4-5')
  assert.equal(modelFor(undefined), undefined)
  assert.equal(modelFor('fable'), undefined, 'unknown tier → SDK default')
})

// ── agentCall wires query() correctly + accrues budget (mocked query, no tokens) ────────────────
const mockQuery = (resultMsg, capture) => (params) => {
  if (capture) capture(params)
  return (async function* () { yield { type: 'assistant' }; yield { type: 'result', ...resultMsg } })()
}
test('agentCall: success → ok value; passes model+systemPrompt+outputFormat; accrues cost', async () => {
  let captured
  const runQuery = mockQuery({ subtype: 'success', structured_output: { ok: 1 }, total_cost_usd: 0.5 }, (p) => { captured = p })
  let usd = 0
  const out = await agentCall('do it', { label: 'exec:1', model: 'sonnet', schema: { type: 'object' } },
    { runQuery, cwd: '/repo', persona: (r) => `persona:${r}`, budget: { add: (u) => { usd += u }, spent: () => usd } })
  assert.deepEqual(out, { ok: true, value: { ok: 1 } })
  assert.equal(usd, 0.5, 'budget accrued from total_cost_usd')
  assert.equal(captured.options.model, 'claude-sonnet-4-6')
  assert.equal(captured.options.systemPrompt, 'persona:executor')
  assert.deepEqual(captured.options.outputFormat, { type: 'json_schema', schema: { type: 'object' } })
  assert.ok(captured.options.allowedTools.includes('Edit'), 'executor gets edit tools')
})
test('agentCall: a quota error result → kind quota', async () => {
  const out = await agentCall('x', { label: 'verify:1' },
    { runQuery: mockQuery({ subtype: 'error_max_budget_usd' }), cwd: '/r', persona: () => undefined })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'quota')
})
test('agentCall: a generator with no result message → kind null', async () => {
  const runQuery = () => (async function* () { yield { type: 'assistant' } })()
  const out = await agentCall('x', { label: 'exec:1' }, { runQuery, cwd: '/r', persona: () => undefined })
  assert.equal(out.ok, false)
  assert.equal(out.kind, 'null')
})

// ── orphan-leak elimination: lifecycle reaping (token-free, SDK-free) ────────────────────────────
// (mockQuery is already defined above for the agentCall tests.)
// Each reaping test resets the module-level registry + one-shot cleaning guard so they're independent.
test('cleanup() group-kills a tracked detached build tree (real sleep, no tokens)', async (t) => {
  t.after(() => __resetForTests())
  __resetForTests()
  // spawn through the SAME tracked-detached path shNative uses
  const child = spawn('/bin/sh', ['-c', 'sleep 300'], { detached: true })
  const untrack = trackProcessGroup(child.pid)
  await delay(100)
  // process is alive: signal 0 throws ESRCH if dead, returns if alive
  assert.doesNotThrow(() => process.kill(child.pid, 0), 'sleep child should be alive before cleanup')

  cleanup()                       // the production teardown path
  await new Promise((r) => child.on('exit', r))   // wait for the kill to land

  assert.throws(() => process.kill(child.pid, 0), (e) => e.code === 'ESRCH', 'sleep pid must be dead after cleanup')
  untrack()
})

test('cleanup() aborts an in-flight query AND calls Query.close() (mocked, no tokens)', async (t) => {
  t.after(() => __resetForTests())
  __resetForTests()
  let aborted = false
  let closed = false
  const abort = { abort: () => { aborted = true } }
  const close = () => { closed = true }
  const untrack = trackQuery(abort, close)

  cleanup()

  assert.ok(aborted, 'AbortController.abort() called on cleanup')
  assert.ok(closed, 'Query.close() called on cleanup (kills the claude CLI subprocess)')
  untrack()
})

test('agentCall threads an AbortController into query() options', async () => {
  let captured
  const runQuery = mockQuery({ subtype: 'success', result: 'ok' }, (p) => { captured = p })
  await agentCall('x', { label: 'exec:1' }, { runQuery, cwd: '/r', persona: () => undefined })
  assert.ok(captured.options.abortController instanceof AbortController, 'abortController passed to SDK')
})

test('sweepPidfile() reaps a group recorded by a prior run (real sleep, no tokens)', async (t) => {
  t.after(() => __resetForTests())
  __resetForTests()
  const repo = '/tmp/slice-sweep-test'
  configurePidfile(repo)                         // writes <repo>/.slice/children.pids
  const child = spawn('/bin/sh', ['-c', 'sleep 300'], { detached: true })
  trackProcessGroup(child.pid)                   // appends pid to the pidfile
  await delay(100)
  assert.doesNotThrow(() => process.kill(child.pid, 0))

  sweepPidfile(repo)                             // simulates the next run's startup recovery
  await new Promise((r) => child.on('exit', r))
  assert.throws(() => process.kill(child.pid, 0), (e) => e.code === 'ESRCH', 'swept pid must be dead')
})

// END-TO-END: the real signal path (installHandlers → SIGTERM → cleanup → group-kill), which the
// direct-cleanup() tests above do NOT exercise. Reproduces the exact `pkill -f run.mjs` failure mode.
test('installHandlers: a REAL SIGTERM reaps the tracked group end-to-end (the pkill failure mode)', async (t) => {
  const fixture = new URL('./orphan-signal-fixture.mjs', import.meta.url).pathname
  const harness = spawn(process.execPath, [fixture], { stdio: ['ignore', 'pipe', 'inherit'] })
  let sleepPid
  t.after(() => { try { harness.kill('SIGKILL') } catch {} ; if (sleepPid) { try { process.kill(-sleepPid, 'SIGKILL') } catch {} } })

  sleepPid = await new Promise((resolve, reject) => {
    let buf = ''
    const to = setTimeout(() => reject(new Error('fixture never reported SLEEPPID')), 8000)
    harness.stdout.on('data', (b) => { buf += b; const m = buf.match(/SLEEPPID:(\d+)/); if (m) { clearTimeout(to); resolve(Number(m[1])) } })
  })
  assert.doesNotThrow(() => process.kill(sleepPid, 0), 'sleep grandchild alive before the signal')

  harness.kill('SIGTERM')                          // the real pkill / Ctrl-C path
  await new Promise((r) => harness.on('exit', r))

  // the handler's group-kill is synchronous, but the OS reap can lag a few ms — poll briefly.
  let dead = false
  for (let i = 0; i < 100 && !dead; i++) {
    try { process.kill(sleepPid, 0) } catch (e) { if (e.code === 'ESRCH') dead = true }
    if (!dead) await delay(25)
  }
  assert.ok(dead, 'sleep grandchild reaped via the SIGTERM handler — no orphan')
})
