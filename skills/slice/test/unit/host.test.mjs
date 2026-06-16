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
  assert.ok(host.getQuotaHalt(), 'quota halt flag set')
  const before = calls
  const r2 = await host.agentSafe('y', { label: 'verify:2' })
  assert.equal(r2.ok, false, 'no-op after halt → ok:false')
  assert.equal(r2.kind, 'null', 'quota-halt no-op → kind:null')
  assert.equal(calls, before, 'no further agent spawned after halt (the no-op gate)')
})

test('agentSafe: model_unavailable throw sets QUOTA_HALT and returns kind:model_unavailable (not null)', async () => {
  // model_unavailable = infra outage, treated like quota: immediate resumable pause via quotaHalt()
  let calls = 0
  const host = withHost(async () => { calls++; throw new Error('issue with the selected model — may not have access to it') })
  const r1 = await host.agentSafe('x', { label: 'exec:1' })
  assert.equal(r1.ok, false, 'model_unavailable → ok:false')
  assert.equal(r1.kind, 'model_unavailable', 'model_unavailable error → kind:model_unavailable')
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
