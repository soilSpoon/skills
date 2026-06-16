// Unit tests for src/phases/verify.ts — the adversarial verifier's tier routing, in ISOLATION
// (mock deps + a mock `parallel`). Run with the .ts resolve hook. These pin the trust-critical
// decisions the whole-engine scenarios only sample: tidy/light/heavy/standard routing, heavy-lens
// UNANIMITY (one distrust fails the leaf), null-lens = distrust, and null-verdict = untrusted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeVerifyLeaf } from '../../src/phases/verify.ts'

function mk(agentImpl) {
  return makeVerifyLeaf({
    rt: { parallel: async (thunks) => Promise.all(thunks.map((t) => t())) },
    host: { sh: async () => ({ exitCode: 0, stdout: '' }), agentSafe: agentImpl, shUnavailable: () => false },
    git: { GIT: false, gitVerify: () => '' },   // GIT:false skips the engine-diff git fetch
    LEAF_TEST: () => '',
    INV: '',
    ENGINE_DIFF_CAP: 6000,
  })
}
const node = (over = {}) => ({ task: 't', kind: 'behavior', testScope: 's', ...over })
const res = { summary: 's', passed: true, evidence: 'e' }

test('tidy leaf routes to the behavior-preservation gate (label ·tidy)', async () => {
  let label
  const v = mk(async (_p, opts) => { label = opts.label; return { trustworthy: true, reason: 'ok' } })
  const out = await v('L', node({ kind: 'tidy' }), res, undefined, '/r', 'sha', '', '')
  assert.match(label, /·tidy$/)
  assert.equal(out.trustworthy, true)
})

test('light leaf routes to ·light', async () => {
  let label
  const v = mk(async (_p, opts) => { label = opts.label; return { trustworthy: true, reason: 'ok' } })
  await v('L', node(), res, 'light', '/r', 'sha', '', '')
  assert.match(label, /·light$/)
})

test('heavy leaf is UNANIMOUS — one distrusting lens fails the whole leaf', async () => {
  let n = 0
  const v = mk(async () => { n++; return n === 2 ? { trustworthy: false, reason: 'lens nope' } : { trustworthy: true, reason: 'ok' } })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'unanimity: any distrust → untrusted')
  assert.match(out.reason, /heavy verify: 3 lenses, 1 distrusted/)
})

test('heavy leaf: all 3 lenses trust → trustworthy', async () => {
  const v = mk(async () => ({ trustworthy: true, reason: 'ok' }))
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, true)
})

test('heavy leaf: a NULL lens counts as distrust (a flake cannot launder a hard leaf)', async () => {
  let n = 0
  const v = mk(async () => { n++; return n === 1 ? null : { trustworthy: true, reason: 'ok' } })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'null lens = distrust')
})

test('standard leaf: a null verdict → untrusted (verification unavailable)', async () => {
  const v = mk(async () => null)
  const out = await v('L', node(), res, undefined, '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false)
  assert.match(out.reason, /unavailable|untrusted/)
})
