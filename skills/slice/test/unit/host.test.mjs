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
