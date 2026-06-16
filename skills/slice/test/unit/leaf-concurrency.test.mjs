// Full-engine SCENARIOS for leafConcurrency (opt-in file-disjoint concurrent leaves). Placed under
// test/unit/ so the `test/unit/*.test.mjs` glob runs them; they drive the WHOLE engine through the host
// (runEngine) — like scenarios.test.mjs, not an isolated module. They pin the concurrent path's
// COMMIT-IF-TRUSTED contract: disjoint leaves run + commit SCOPED; an untrusted leaf is reverted; a
// slice missing files[] forces the serial fallback (the concurrent scheduler must not run).
import test from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, dispatcher, FIX, ARGS, isSh, has } from '../host.mjs'

const slice = (extra) => ({
  desc: 'x', interface: 'TBD/exploratory', contract: 'do x', independent: true, dependsOn: [],
  kind: 'behavior', atomic: true, riskTier: 'standard', testScope: 'X', ...extra,
})
// a decompose decision whose two atomic children touch DISJOINT files → eligible for concurrency
const concurrentDecision = {
  action: 'slice', reason: 'fixture: two file-disjoint atomic leaves',
  slices: [slice({ desc: 'A', files: ['src/a.ts'], testScope: 'A' }), slice({ desc: 'B', files: ['src/b.ts'], testScope: 'B' })],
}

test('leafConcurrency: file-disjoint atomic leaves run concurrently (commit-if-trusted) — both committed, both trusted', async () => {
  const dispatch = dispatcher((c) => { if (has(c, /decompose/)) return concurrentDecision })
  const { calls, logs } = await runEngine({ args: { ...ARGS, leafConcurrency: 2 }, dispatch })
  const execs = calls.filter((c) => /^exec:c\d+$/.test(c.opts.label || ''))
  assert.equal(execs.length, 2, 'both disjoint leaves executed via the concurrent path (exec:c0, exec:c1)')
  const commits = calls.filter((c) => isSh(c) && /ccommit/.test(c.opts.label || ''))
  assert.equal(commits.length, 2, 'each trusted leaf was engine-committed SCOPED (ccommit)')
  for (const c of commits) assert.match(c.prompt, /git -C .* add -- /, 'commit is scoped (git add -- <files>), never -A')
  assert.equal(calls.filter((c) => isSh(c) && /crevert/.test(c.opts.label || '')).length, 0, 'no revert — both trusted')
  assert.ok(logs.some((l) => /leafConcurrency: 2 file-disjoint leaves, K=2/.test(l)), 'the concurrent scheduler ran')
})

test('leafConcurrency: an untrusted concurrent leaf is reverted (crevert); the trusted sibling is not', async () => {
  const dispatch = dispatcher((c) => {
    if (has(c, /decompose/)) return concurrentDecision
    if (has(c, /verify/) && !has(c, /integration/)) return /c0/.test(c.opts.label || '') ? FIX.distrust : FIX.trust
  })
  const { calls } = await runEngine({ args: { ...ARGS, leafConcurrency: 2 }, dispatch })
  const reverts = calls.filter((c) => isSh(c) && /crevert/.test(c.opts.label || ''))
  assert.equal(reverts.length, 1, 'exactly the untrusted leaf was reverted (commit-if-trusted: only it committed-then-undone)')
  assert.ok(/c0/.test(reverts[0].opts.label || ''), 'the reverted leaf is c0 (the distrusted one), not its trusted sibling')
})

test('leafConcurrency: a slice missing files[] forces the SERIAL fallback (no concurrent commit, scheduler not run)', async () => {
  const noFiles = {
    action: 'slice', reason: 'fixture: one slice lacks files[]',
    slices: [slice({ desc: 'A', files: ['src/a.ts'], testScope: 'A' }), slice({ desc: 'B', testScope: 'B' /* NO files[] */ })],
  }
  const dispatch = dispatcher((c) => { if (has(c, /decompose/)) return noFiles })
  const { calls, logs } = await runEngine({ args: { ...ARGS, leafConcurrency: 2 }, dispatch })
  assert.equal(calls.filter((c) => isSh(c) && /ccommit/.test(c.opts.label || '')).length, 0, 'serial fallback — engine made no scoped concurrent commit')
  assert.ok(!logs.some((l) => /leafConcurrency: \d+ file-disjoint/.test(l)), 'the concurrent scheduler did NOT run (shouldRunConcurrent false)')
})

test('leafConcurrency OFF by default: even disjoint slices with files[] run serially (no concurrent path)', async () => {
  const dispatch = dispatcher((c) => { if (has(c, /decompose/)) return concurrentDecision })
  const { calls, logs } = await runEngine({ args: ARGS, dispatch })   // no leafConcurrency → default 1 = OFF
  assert.equal(calls.filter((c) => isSh(c) && /ccommit/.test(c.opts.label || '')).length, 0, 'default off — serial path')
  assert.ok(!logs.some((l) => /leafConcurrency: \d+ file-disjoint/.test(l)), 'opt-in default OFF: scheduler dormant')
})
