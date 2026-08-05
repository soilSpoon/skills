// Golden-trajectory regression (AX LABS: "harness regressions are caught by replay").
//
// The baseline TRAJECTORY here is derived from a REVIEWED PRODUCTION RUN — the first live
// SDK lane (MailKit, 2026-08-05, base b96449ab: 4 parallel groups, 10/10 trusted, squash-
// landed; its auto-emitted run-trace JSONL + engine.log are the source). Per the article,
// the test verifies "same operational promises", not "same answers": stage ORDER, the
// Work/Coordinate boundary, no unauthorized reordering, bounded retries.
//
// Run: npm test (scenarios harness — fixture dispatcher, zero tokens).
import test from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, dispatcher, FIX, ARGS, ARGS_PARALLEL, isSh } from '../host.mjs'

// First/last index in `calls` whose label matches `re` (optionally constrained to sh / non-sh).
const firstIdx = (calls, re, sh = null) =>
  calls.findIndex(c => (sh === null || isSh(c) === sh) && re.test(c.opts.label || ''))
const lastIdx = (calls, re, sh = null) => {
  let last = -1
  calls.forEach((c, i) => { if ((sh === null || isSh(c) === sh) && re.test(c.opts.label || '')) last = i })
  return last
}

test('golden trajectory (sequential green): Baseline → decompose → exec → leaf-verify → integrate → briefing; no reordering; bounded retries', async () => {
  const dispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
  })
  const { result, calls } = await runEngine({ args: ARGS, dispatch })
  assert.equal(result.error, undefined)

  const baseline = calls.findIndex(c => c.opts.phase === 'Baseline')
  const decompose = firstIdx(calls, /decompose/)
  const exec = firstIdx(calls, /exec:/)
  const verify = firstIdx(calls, /verify/, false)          // model leaf-verify, not the sh verify-diff
  const integrate = firstIdx(calls, /integrate-fullsuite/, true)
  const briefing = firstIdx(calls, /briefing-persist/, true)

  // The operational promise: every stage exists, in this order (the production trajectory).
  for (const [name, i] of [['baseline', baseline], ['decompose', decompose], ['exec', exec],
                           ['leaf-verify', verify], ['integrate-fullsuite', integrate], ['briefing-persist', briefing]]) {
    assert.ok(i >= 0, `trajectory stage missing: ${name}`)
  }
  assert.ok(baseline < decompose && decompose < exec && exec < verify && verify < integrate && integrate < briefing,
    `stage ORDER violated: baseline=${baseline} decompose=${decompose} exec=${exec} verify=${verify} integrate=${integrate} briefing=${briefing}`)

  // No unauthorized reordering: nothing executes or decomposes AFTER the integrate net ran.
  assert.ok(lastIdx(calls, /exec:/) < integrate, 'an executor ran AFTER the integrate full-suite net — unauthorized reordering')
  assert.ok(lastIdx(calls, /decompose/) < integrate, 'a decompose ran AFTER the integrate net — unauthorized reordering')

  // Bounded retries: the integrate net runs once, plus at most one 137-retry.
  const integrateRuns = calls.filter(c => isSh(c) && /integrate-fullsuite/.test(c.opts.label || '')).length
  assert.ok(integrateRuns <= 2, `integrate net ran ${integrateRuns}× — excessive retries (allowed: 1 + one 137 retry)`)
})

test('golden trajectory (parallel green): leaf-verifies precede the coordinator merge; merge precedes integrate', async () => {
  const dispatch = dispatcher((c) => {
    // Parallel-mode root decompose is a Plan-phase call with NO 'decompose' label — steer it
    // by phase (the established scenarios idiom) so the 3 independent fixture groups form and
    // the coordinator path runs; group-level decomposes fall to the default leaf decision.
    if (c.opts.phase === 'Plan' && !isSh(c) && !/partition/.test(c.opts.label || '')) return FIX.decomposeSlice
  })
  const { result, calls } = await runEngine({ args: ARGS_PARALLEL, dispatch })
  assert.equal(result.error, undefined)

  const mergeNet = firstIdx(calls, /merge-fullsuite/, true)
  const integrate = firstIdx(calls, /integrate-fullsuite/, true)
  // Parallel runs must actually take the coordinator path (the production trajectory did).
  assert.ok(mergeNet >= 0, 'parallel run must run the coordinator merge net (merge-fullsuite)')
  assert.ok(integrate >= 0, 'integrate net missing')
  assert.ok(mergeNet < integrate, `coordinator merge (${mergeNet}) must precede integrate (${integrate})`)
  // Work completes before Coordinate: no group leaf-verify may follow the coordinator stage.
  const lastLeafVerify = lastIdx(calls, /verify/, false)
  const mergeVerify = firstIdx(calls, /merge-verify/, false)
  assert.ok(lastLeafVerify <= Math.max(mergeVerify, mergeNet),
    `a leaf verify (${lastLeafVerify}) ran after the coordinator stage (net=${mergeNet}, verify=${mergeVerify}) — Work/Coordinate boundary violated`)
})
