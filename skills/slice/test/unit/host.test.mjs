// Unit tests for src/host.ts — the agent+quota wrapper and the deterministic shell proxies, in
// ISOLATION (mock `agent`/`log` globals; no Workflow runtime). Run with the .ts resolve hook:
//   node --import ./test/ts-hooks.mjs --test test/unit/host.test.mjs
// These pin the non-obvious host contracts the whole-engine scenarios only touch indirectly: the
// quota circuit breaker's cross-class trip rule, agentSafe's halt-then-no-op, and shBatch marker parsing.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeHost } from '../../src/host.ts'

// makeHost(rt) takes the two platform primitives it uses (agent/log) from the injected Runtime —
// no ambient globals anymore, so the mock is just an object with those two fields.
function withHost(agentImpl) {
  return makeHost({ agent: agentImpl, log: () => {} })
}

test('agentSafe: a session-limit throw flips quota halt; subsequent calls no-op without spawning', async () => {
  // agentSafe now returns AgentOutcome<T>: { ok:false, kind:'quota' } on session-limit, not null
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('session limit reached') })
  const r1 = await host.agentSafe('x', { label: 'verify:1' })
  assert.equal(r1.ok, false, 'quota-class error → ok:false')
  assert.equal(r1.kind, 'quota', 'quota-class error → kind:quota')
  assert.ok(r1.detail, 'quota outcome carries a detail string (context for logging)')
  assert.ok(host.getQuotaHalt(), 'quota halt flag set')
  const before = calls
  const r2 = await host.agentSafe('y', { label: 'verify:2' })
  assert.equal(r2.ok, false, 'no-op after halt → ok:false')
  assert.equal(r2.kind, 'null', 'quota-halt no-op → kind:null')
  assert.ok(r2.detail, 'no-op null outcome also carries a detail string')
  assert.equal(calls, before, 'no further agent spawned after halt (the no-op gate)')
})

test('agentSafe: model_unavailable throw sets QUOTA_HALT and returns kind:model_unavailable (not null)', async () => {
  // model_unavailable = infra outage, treated like quota: immediate resumable pause via quotaHalt()
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('issue with the selected model — may not have access to it') })
  const r1 = await host.agentSafe('x', { label: 'exec:1' })
  assert.equal(r1.ok, false, 'model_unavailable → ok:false')
  assert.equal(r1.kind, 'model_unavailable', 'model_unavailable error → kind:model_unavailable')
  assert.ok(r1.detail, 'model_unavailable outcome carries a detail string (context for logging)')
  assert.ok(host.getQuotaHalt(), 'quota halt flag set on model_unavailable')
  // Gate fires: subsequent calls are no-op (same as quota path)
  const before = calls
  const r2 = await host.agentSafe('y', { label: 'exec:2' })
  assert.equal(r2.ok, false)
  assert.equal(r2.kind, 'null', 'quota-halt no-op → kind:null')
  assert.equal(calls, before, 'no further agent spawned after model_unavailable halt')
})

test('agentSafe: quota/model_unavailable do NOT bump null streak (no double-trip)', async () => {
  // quotaHalt() fires directly — bumpNullStreak() must NOT also be called for these kinds.
  // Proof: after quota fires QUOTA_HALT, subsequent null-returning calls are no-op (gated),
  // so the breaker never accumulates a streak. If bumpNullStreak were called on quota/model_unavailable
  // the quota breaker state would be inconsistent with the halt-based gate.
  // We verify this indirectly: the breaker does NOT trip (and is not double-incremented) when
  // a single quota error fires — QUOTA_HALT is the sole signal, not a breaker trip.
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('rate limit exceeded') })
  const r = await host.agentSafe('x', { label: 'verify:1' })
  assert.equal(r.kind, 'quota')
  // Only ONE agent call was made (no retry loop inside agentSafe that would inflate bumpNullStreak)
  assert.equal(calls, 1, 'quota error: agent called exactly once (no double-invoke)')
  assert.ok(host.getQuotaHalt(), 'QUOTA_HALT set exactly once via quotaHalt(), not via bumpNullStreak')
  // A second call is gated (no-op) — the halt is stable, not compounded
  await host.agentSafe('y', { label: 'exec:1' })
  assert.equal(calls, 1, 'QUOTA_HALT gate is stable: no additional spawns after halt')
})

test('agentSafe: model_unavailable does NOT bump null streak — quotaHalt() is the sole halt signal', async () => {
  // Parallel to the quota no-double-trip test: model_unavailable must call quotaHalt() directly,
  // never bumpNullStreak() — so the null-streak breaker is not incremented, only QUOTA_HALT is set.
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('issue with the selected model — may not have access to it') })
  const r = await host.agentSafe('x', { label: 'exec:1' })
  assert.equal(r.kind, 'model_unavailable', 'error classifies as model_unavailable')
  // Agent called exactly once — no retry-loop that would feed bumpNullStreak
  assert.equal(calls, 1, 'model_unavailable: agent called exactly once (no double-invoke)')
  assert.ok(host.getQuotaHalt(), 'QUOTA_HALT set via quotaHalt(), not via bumpNullStreak')
  // Second call is gated — the halt is a one-way latch, not compounded by the breaker
  await host.agentSafe('y', { label: 'exec:2' })
  assert.equal(calls, 1, 'QUOTA_HALT gate is stable after model_unavailable: no additional spawns')
})

test('agentSafe: QUOTA_HALT is set once per session — a second quota-kind error is gated, not double-set', async () => {
  // QUOTA_HALT is a one-way latch: after the first quota/model_unavailable error sets it, every
  // subsequent agentSafe call is short-circuited (returns kind:'null', no agent spawn). A second
  // quota-class error therefore CANNOT fire (the gate prevents it reaching the catch block), so
  // QUOTA_HALT is set exactly once per session, not once per outcome kind.
  let phase = 0
  const host = withHost(async () => {
    phase++
    // First call: quota error; second call: should be gated before reaching agent
    throw new Error(phase === 1 ? 'rate limit exceeded' : 'issue with the selected model — may not have access to it')
  })
  const r1 = await host.agentSafe('x', { label: 'verify:1' })
  assert.equal(r1.kind, 'quota', 'first call → quota')
  const haltMsg = host.getQuotaHalt()
  assert.ok(haltMsg, 'QUOTA_HALT set after first error')
  // Second call: gated by QUOTA_HALT, no agent spawn, returns kind:'null'
  const r2 = await host.agentSafe('y', { label: 'exec:1' })
  assert.equal(r2.kind, 'null', 'gated call → kind:null (no-op)')
  assert.equal(phase, 1, 'agent was never invoked a second time (QUOTA_HALT gate fires first)')
  // QUOTA_HALT message unchanged — the latch is stable, not re-set by the no-op
  assert.equal(host.getQuotaHalt(), haltMsg, 'QUOTA_HALT message is the first error\'s, unchanged by the gated call')
})

test('agentSafe quota breaker: 3 nulls across >=2 classes halts; 3 same-class does NOT', async () => {
  const same = withHost(async () => null)
  await same.agentSafe('a', { label: 'verify:1' })
  await same.agentSafe('a', { label: 'verify:2' })
  await same.agentSafe('a', { label: 'verify:3' })
  assert.equal(same.getQuotaHalt(), '', '3 same-class nulls (e.g. the heavy 3-lens loop) do NOT trip the session breaker')

  const cross = withHost(async () => null)
  await cross.agentSafe('a', { label: 'verify:1' })
  await cross.agentSafe('a', { label: 'exec:1' })
  await cross.agentSafe('a', { label: 'decompose:1' })
  assert.ok(cross.getQuotaHalt(), '3 nulls across 3 classes → session-instability halt')
})

test('agentSafe: a budget/ceiling throw is RE-THROWN (means STOP, not a work verdict)', async () => {
  const host = withHost(async () => { throw new Error('budget ceiling exceeded') })
  await assert.rejects(() => host.agentSafe('x', { label: 'exec:1' }), /budget|ceiling/)
})

test('agentSafe: plain null from agent() returns { ok:false, kind:"null" }', async () => {
  // Plain null return (not a throw) produces ok:false, kind:'null', not re-thrown
  const host = withHost(async () => null)
  const r = await host.agentSafe('x', { label: 'exec:1' })
  assert.equal(r.ok, false, 'null agent return → ok:false')
  assert.equal(r.kind, 'null', 'null agent return → kind:null')
  assert.ok(typeof r.detail === 'string', 'null outcome carries a detail string (has context, never undefined)')
})

test('agentSafe: successful agent call returns { ok:true, value }', async () => {
  // A non-null return produces ok:true with the typed value
  const host = withHost(async () => ({ exitCode: 0, stdout: 'hello' }))
  const r = await host.agentSafe('x', { label: 'exec:1' })
  assert.equal(r.ok, true, 'non-null agent return → ok:true')
  assert.deepEqual(r.value, { exitCode: 0, stdout: 'hello' }, 'value carries the agent result')
})

test('sh: null proxy → SH_UNAVAILABLE sentinel (outage, not "ran but failed")', async () => {
  const host = withHost(async () => null)
  const r = await host.sh('git rev-parse HEAD')
  assert.ok(host.shUnavailable(r), 'detectable outage sentinel')
})

test('sh: passes the proxy shell result through verbatim', async () => {
  const host = withHost(async () => ({ exitCode: 0, stdout: 'deadbeef' }))
  const r = await host.sh('git rev-parse HEAD')
  assert.equal(r.exitCode, 0)
  assert.equal(r.stdout, 'deadbeef')
  assert.equal(host.shUnavailable(r), false)
})

test('shBatch: parses per-command {code,out} from EXIT MARKERs; empty stdout preserved', async () => {
  const stdout = 'abc123\n<<RS:git-sha:0>>\n\n<<RS:git-clean:0>>\n'
  const host = withHost(async () => ({ exitCode: 0, stdout }))
  const b = await host.shBatch('git rev-parse HEAD; ...')
  assert.equal(b.get('git-sha').code, 0)
  assert.equal(b.get('git-sha').out, 'abc123', 'SHA read verbatim before its marker')
  assert.equal(b.get('git-clean').out, '', 'clean porcelain (empty stdout) preserved as ""')
  assert.equal(b.get('missing'), null, 'absent name → null')
})

test('shBatch: a RED sub-command exit code is surfaced per name', async () => {
  const host = withHost(async () => ({ exitCode: 0, stdout: '<<RS:lock-check:0>>\nheld\n<<RS:lock-write:1>>\n' }))
  const b = await host.shBatch('...')
  assert.equal(b.get('lock-check').code, 0)
  assert.equal(b.get('lock-write').code, 1, 'a non-zero sub-command exit is detected exactly')
})

test('shBatch: dead proxy → get() null for every name (whole-batch outage detectable)', async () => {
  const host = withHost(async () => null)
  const b = await host.shBatch('x')
  assert.ok(host.shUnavailable(b.raw), 'raw is the sentinel')
  assert.equal(b.get('anything'), null)
})

test('shUnavailable: value-equality branch detects byte-identical clone even when reference differs', async () => {
  // Pins the sentinel's value-equality fallback: a clone of SH_UNAVAILABLE (same bytes, different
  // object identity) must still satisfy shUnavailable(). This remains correct after the AgentOutcome
  // refactor because sh() unwraps r.value (not the raw outcome) — a serialized/cloned sentinel must
  // not slip through a reference-only check at any call site (git-sha, gitClean, lock reads etc.).
  const host = withHost(async () => ({ exitCode: 0, stdout: 'anything' }))
  const clone = { exitCode: -2, stdout: '\x00SH_UNAVAILABLE' }
  assert.ok(host.shUnavailable(clone), 'value-equality branch: byte-identical clone is detected as unavailable sentinel')
  assert.equal(host.shUnavailable({ exitCode: -2, stdout: 'not-sentinel' }), false, 'wrong stdout: not a sentinel')
  assert.equal(host.shUnavailable({ exitCode: 0, stdout: '\x00SH_UNAVAILABLE' }), false, 'wrong exitCode: not a sentinel')
})

test('agentSafe quotaHaltNoOpOutcome: quota-halt early return carries AgentOutcome ok:false kind:null detail:quota-halt-active', async () => {
  // Pins the SPECIFIC AgentOutcome shape returned by the QUOTA_HALT gate (the early-return branch at
  // the top of agentSafe, before any agent spawn): ok:false, kind:'null', detail:'quota halt active'.
  // This distinguishes the no-op outcome from a plain agent-null (which also has kind:'null' but with
  // detail:'agent returned null') — callers that need to know WHY kind is 'null' can inspect detail.
  // Behavior: after the first quota error flips QUOTA_HALT, every subsequent agentSafe call MUST
  // return this exact shape without spawning any agent.
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('rate limit exceeded') })
  // First call — triggers quota halt
  const r1 = await host.agentSafe('x', { label: 'verify:1' })
  assert.equal(r1.kind, 'quota', 'first error → quota kind (precondition: halt is now set)')
  assert.ok(host.getQuotaHalt(), 'QUOTA_HALT is set (precondition)')
  const before = calls
  // Second call — must be gated by QUOTA_HALT early-return, NOT reach the agent
  const r2 = await host.agentSafe('y', { label: 'exec:1' })
  assert.equal(calls, before, 'no agent spawned: early-return gate fires before agent()')
  assert.equal(r2.ok, false, 'no-op outcome → ok:false')
  assert.equal(r2.kind, 'null', 'no-op outcome → kind:null (distinguishes from quota/model_unavailable)')
  assert.equal(r2.detail, 'quota halt active', 'no-op detail string is exactly "quota halt active" (distinguishes from plain null)')
})

test('sh: null agentSafe (agent returns null) → SH_UNAVAILABLE returned and shUnavailable is true', async () => {
  // Pins the full sh() path after AgentOutcome type change: agentSafe wraps null as { ok:false,
  // kind:'null' }; sh() must unwrap and return SH_UNAVAILABLE (not the outcome), so shUnavailable()
  // still fires correctly at decision sites (git-sha / gitClean / lock reads).
  const host = withHost(async () => null)
  const r = await host.sh('git rev-parse HEAD')
  assert.ok(host.shUnavailable(r), 'sh() with null agent → shUnavailable(result) is true')
  assert.equal(r.exitCode, -2, 'exitCode is the sentinel value -2')
  assert.ok(r.stdout.startsWith('\x00SH_UNAVAILABLE'), 'stdout starts with the sentinel prefix')
})

test('same-class-null-kind-streak: 3 generic-catch (kind:null) outcomes from the SAME call-class do NOT trip quota breaker', async () => {
  // Pins the distinction between null-kind and quota/model_unavailable-kind for the circuit breaker.
  // The quota breaker requires >=2 DISTINCT call-classes before tripping — 3 nulls from one class
  // (e.g. the 3-lens verify loop all throwing generic errors) must not be mistaken for a session
  // instability signal. Only cross-class null streaks indicate session-scope trouble.
  // The catch fallthrough path (non-quota, non-model_unavailable throw) produces kind:'null' and
  // calls bumpNullStreak — but the class-gate (>=2 distinct classes) must prevent the trip.
  const host = withHost(async () => { throw new Error('ECONNRESET: connection reset by peer') })
  const r1 = await host.agentSafe('a', { label: 'verify:lens1' })
  const r2 = await host.agentSafe('a', { label: 'verify:lens2' })
  const r3 = await host.agentSafe('a', { label: 'verify:lens3' })
  // All three outcomes must be kind:'null' (generic catch, not quota or model_unavailable)
  assert.equal(r1.kind, 'null', 'generic-throw outcome 1 → kind:null')
  assert.equal(r2.kind, 'null', 'generic-throw outcome 2 → kind:null')
  assert.equal(r3.kind, 'null', 'generic-throw outcome 3 → kind:null')
  // The quota breaker must NOT have tripped — QUOTA_HALT remains empty
  assert.equal(host.getQuotaHalt(), '', '3 same-class null-kind outcomes do NOT trip the quota breaker (class-gate requires >=2 distinct classes)')
})

// ── Edge-case hardenings: null/undefined response, mixed error types, quota-then-timeout ────────

test('agentSafe-outcome-edge null-despite-schema: null return with schema opts → kind:null (schema presence does not change distrust)', async () => {
  // agentSafe does not validate the returned value against opts.schema — that is the caller's job.
  // When agent() returns null even though opts.schema was provided (e.g. the LLM refused to emit
  // structured output), agentSafe still maps it to {ok:false, kind:'null'}, not ok:true. This pins
  // that schema opts do not create a special branch: null is always distrust regardless of schema.
  const host = withHost(async () => null)
  const r = await host.agentSafe('x', {
    label: 'exec:1',
    schema: { type: 'object', required: ['passed'], properties: { passed: { type: 'boolean' } } },
  })
  assert.equal(r.ok, false, 'null despite schema → ok:false (schema opts do not bypass distrust)')
  assert.equal(r.kind, 'null', 'null despite schema → kind:null (no special schema-error branch in agentSafe)')
  assert.ok(typeof r.detail === 'string', 'null-with-schema outcome carries a detail string')
})

test('agentSafe-outcome-edge retry-on-parse-fail: first ok:false then ok:true (the integrate.ts retry shape)', async () => {
  // The engine's integrate phase (and owner-briefing) retries ONCE when agentSafe returns ok:false
  // (null/API error). This test pins the two-call sequence that the retry pattern relies on:
  // call 1 → {ok:false, kind:'null'} (simulates parse-fail / null return); caller retries;
  // call 2 → {ok:true, value} (the second attempt succeeds). Both calls are distinct invocations
  // on the SAME host instance, confirming the state machine does not permanently latch on null.
  let callCount = 0
  const host = withHost(async () => {
    callCount++
    if (callCount === 1) return null          // first call: parse-fail / null
    return { summary: 'ok', passed: true }   // second call: success
  })
  const r1 = await host.agentSafe('parse this', { label: 'exec:1' })
  assert.equal(r1.ok, false, 'first call (parse-fail) → ok:false')
  assert.equal(r1.kind, 'null', 'first call → kind:null (null return, not a throw)')
  const r2 = await host.agentSafe('parse this (retry)', { label: 'exec:1' })
  assert.equal(r2.ok, true, 'second call (retry succeeds) → ok:true')
  assert.deepEqual(r2.value, { summary: 'ok', passed: true }, 'retry carries the value verbatim')
  assert.equal(callCount, 2, 'exactly two agent invocations: fail then success')
})

test('agentSafe-outcome-edge quota-then-timeout: quota sets QUOTA_HALT, subsequent timeout throw is gated (never spawned)', async () => {
  // Sequence: call 1 throws a quota error (rate-limit) → QUOTA_HALT is set, returns kind:'quota'.
  // Call 2 WOULD throw a timeout/network error (ECONNRESET) but QUOTA_HALT fires FIRST — the agent
  // is never invoked, and the outcome is kind:'null' with detail:'quota halt active'. This pins that
  // QUOTA_HALT is a one-way gate: once tripped by quota, ALL subsequent errors (timeout, network,
  // model_unavailable) are also pre-empted — they can never compound or reset the halt state.
  let secondCallThrew = false
  let phase = 0
  const host = withHost(async () => {
    phase++
    if (phase === 1) throw new Error('rate limit exceeded')   // call 1: quota error
    secondCallThrew = true                                     // call 2: should never reach here
    throw new Error('ECONNRESET: connection reset by peer')
  })
  // Call 1: quota fires, QUOTA_HALT set
  const r1 = await host.agentSafe('work', { label: 'exec:1' })
  assert.equal(r1.ok, false, 'quota throw → ok:false')
  assert.equal(r1.kind, 'quota', 'quota throw → kind:quota')
  assert.ok(host.getQuotaHalt(), 'QUOTA_HALT is set after quota error')
  // Call 2: timeout/ECONNRESET throw, but QUOTA_HALT gate pre-empts it entirely
  const r2 = await host.agentSafe('work', { label: 'exec:2' })
  assert.equal(secondCallThrew, false, 'QUOTA_HALT gate prevents the second agent from being spawned (timeout throw never fires)')
  assert.equal(r2.ok, false, 'gated call → ok:false')
  assert.equal(r2.kind, 'null', 'gated call → kind:null (the no-op gate kind, not timeout)')
  assert.equal(r2.detail, 'quota halt active', 'gated call detail is exactly "quota halt active"')
})

test('agentSafe-outcome-edge refusal-from-sdk: content-policy throws fall through to kind:null (classifyFailure has no refusal branch)', async () => {
  // classifyFailure (util.ts L0) recognises only quota and model_unavailable patterns; a refusal
  // message ("content policy violation", "request refused") matches neither regex and falls through
  // to the 'null' default. host.ts then maps that to {ok:false, kind:'null'} via the generic-catch
  // branch (bumpNullStreak, not quotaHalt). This pins the CURRENT behavior: SDK-level refusal kinds
  // (the opencode adapter's classifySdkError returns kind:'refusal') are invisible to the core host;
  // the core safely treats them as generic null-distrust, not a halt-worthy error class.
  for (const msg of [
    'content policy violation',
    'request was refused by the safety filter',
    'I cannot help with that',
    'This request has been declined',
  ]) {
    const host = withHost(async () => { throw new Error(msg) })
    const r = await host.agentSafe('sensitive task', { label: 'exec:1' })
    assert.equal(r.ok, false, `refusal-like throw → ok:false (msg: ${msg})`)
    assert.equal(r.kind, 'null', `refusal-like throw → kind:null, not kind:refusal (msg: ${msg})`)
    assert.ok(!host.getQuotaHalt(), `refusal-like throw does NOT set QUOTA_HALT (msg: ${msg})`)
  }
})
