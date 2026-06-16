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

// mkNullParallel: simulates the real Workflow runtime's parallel() that catches thunk throws
// and returns null for that slot (T|null per thunk). Used to test the null-from-throw path
// (line 88: `v ?? fallback`) independently from the ok:false path (line 85: `r.ok ? r.value : fallback`).
function mkNullParallel(agentImpl) {
  return makeVerifyLeaf({
    rt: {
      parallel: async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null))),
    },
    host: { sh: async () => ({ exitCode: 0, stdout: '' }), agentSafe: agentImpl, shUnavailable: () => false },
    git: { GIT: false, gitVerify: () => '' },
    LEAF_TEST: () => '',
    INV: '',
    ENGINE_DIFF_CAP: 6000,
  })
}
const node = (over = {}) => ({ task: 't', kind: 'behavior', testScope: 's', ...over })
const res = { summary: 's', passed: true, evidence: 'e' }

// agentSafe now returns AgentOutcome<T>: { ok:true, value } or { ok:false, kind, detail }.
// The mock must wrap the verdict in the outcome shape so verify.ts's r.ok/r.value unwrapping works.
const ok = (v) => ({ ok: true, value: v })
const fail = () => ({ ok: false, kind: 'null', detail: '' })

test('tidy leaf routes to the behavior-preservation gate (label ·tidy)', async () => {
  let label
  const v = mk(async (_p, opts) => { label = opts.label; return ok({ trustworthy: true, reason: 'ok' }) })
  const out = await v('L', node({ kind: 'tidy' }), res, undefined, '/r', 'sha', '', '')
  assert.match(label, /·tidy$/)
  assert.equal(out.trustworthy, true)
})

test('light leaf routes to ·light', async () => {
  let label
  const v = mk(async (_p, opts) => { label = opts.label; return ok({ trustworthy: true, reason: 'ok' }) })
  await v('L', node(), res, 'light', '/r', 'sha', '', '')
  assert.match(label, /·light$/)
})

test('heavy leaf is UNANIMOUS — one distrusting lens fails the whole leaf', async () => {
  let n = 0
  const v = mk(async () => { n++; return ok(n === 2 ? { trustworthy: false, reason: 'lens nope' } : { trustworthy: true, reason: 'ok' }) })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'unanimity: any distrust → untrusted')
  assert.match(out.reason, /heavy verify: 3 lenses, 1 distrusted/)
})

test('heavy leaf: all 3 lenses trust → trustworthy', async () => {
  const v = mk(async () => ok({ trustworthy: true, reason: 'ok' }))
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, true)
})

test('heavy leaf: a NULL lens counts as distrust (a flake cannot launder a hard leaf)', async () => {
  // ok:false outcome from agentSafe counts as distrust (equivalent to old null return)
  let n = 0
  const v = mk(async () => { n++; return n === 1 ? fail() : ok({ trustworthy: true, reason: 'ok' }) })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'ok:false outcome = distrust')
})

test('standard leaf: a null verdict → untrusted (verification unavailable)', async () => {
  // ok:false from agentSafe → fallback { trustworthy:false }
  const v = mk(async () => fail())
  const out = await v('L', node(), res, undefined, '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false)
  assert.match(out.reason, /unavailable|untrusted/)
})

test('heavy lens: ok:false (api death, any kind) from agentSafe fails unanimity — kind:quota not just kind:null', async () => {
  // Pins the r.ok branch (line 85 of verify.ts): any ok:false outcome — regardless of kind
  // (quota/model_unavailable/timeout/refusal/null) — converts to a distrusting Verdict inside the thunk,
  // before parallel() even sees it. The null-coalesce on line 88 is not reached; the distrust
  // comes from the explicit fallback in the thunk body. Both code paths must count as distrust.
  let n = 0
  const failQuota = () => ({ ok: false, kind: 'quota', detail: 'rate limit' })
  const v = mk(async () => { n++; return n === 2 ? failQuota() : ok({ trustworthy: true, reason: 'ok' }) })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'ok:false with kind:quota → distrusting Verdict → not unanimous')
  assert.match(out.reason, /heavy verify: 3 lenses, 1 distrusted/, 'exactly 1 lens distrusted')
})

test('heavy lens: null slot from parallel() (thunk-level throw, api death) counts as distrust — not a bypass', async () => {
  // Pins the null-coalesce branch (line 88 of verify.ts): when parallel() catches a thunk throw
  // and returns null for that slot, the `v ?? fallback` guard converts it to a distrusting Verdict.
  // This is the "null-from-throw" path — distinct from ok:false (which the thunk itself converts).
  // Uses mkNullParallel whose parallel() silently catches thunk throws → null (same as real runtime).
  let n = 0
  const v = mkNullParallel(async () => {
    n++
    if (n === 3) throw new Error('simulated api death at thunk boundary')
    return ok({ trustworthy: true, reason: 'ok' })
  })
  const out = await v('L', node(), res, 'heavy', '/r', 'sha', '', '')
  assert.equal(out.trustworthy, false, 'null slot from parallel() → distrusting Verdict → not unanimous')
  assert.match(out.reason, /heavy verify: 3 lenses, 1 distrusted/, 'exactly 1 lens distrusted via null-slot path')
})
