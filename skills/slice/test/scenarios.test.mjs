// Engine behavior pins — the regression net required before any engine refactor.
// Run: node --test skills/slice/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, dispatcher, FIX, ARGS, isSh } from './host.mjs'

test('happy path: atomic root → trusted leaf → green integrate → briefing', async () => {
  const { result, logs } = await runEngine({ args: ARGS, dispatch: dispatcher() })
  assert.equal(result.error, undefined, `engine errored: ${result.error}`)
  assert.equal(result.fullSuiteGreen, true)
  assert.ok(result.totalLeaves >= 1, 'at least one leaf completed')
  assert.equal(result.trustedLeaves, result.totalLeaves, 'all leaves trusted')
  assert.deepEqual(result.aborts, [])
  assert.equal(result.briefing, 'fixture briefing')
  assert.ok(!logs.some((l) => /QUOTA HALT/.test(l)), 'no quota halt on a healthy run')
})

test('repair loop: first verify distrusts, repair re-executes, second verify trusts', async () => {
  let verifies = 0
  const dispatch = dispatcher((c) => {
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
      verifies++
      return verifies === 1 ? FIX.distrust : FIX.trust
    }
  })
  const { result, calls } = await runEngine({ args: ARGS, dispatch })
  assert.ok(verifies >= 2, 'verifier consulted again after repair')
  assert.ok(calls.some((c) => /\.r1$/.test(c.opts.label || '')), 'a repair executor (label *.r1) ran')
  assert.ok(result.trustedLeaves >= 1, 'leaf ends trusted after repair')
})

test('quota circuit breaker: one session-limit death stops ALL subsequent agent spawns', async () => {
  let tripped = -1
  const dispatch = dispatcher((c) => {
    if (/verify/.test(c.opts.label || '') && tripped === -1) {
      tripped = c.i
      throw new Error("You've hit your session limit · resets 12:20am (Asia/Seoul)")
    }
  })
  const { result, calls, logs } = await runEngine({ args: ARGS, dispatch })
  assert.ok(tripped >= 0, 'the quota throw fired')
  const after = calls.filter((c) => c.i > tripped)
  assert.equal(after.length, 0,
    `no agent (not even sh) may be spawned after a quota death; got ${after.length}: ${after.map((c) => c.opts.label).join(', ')}`)
  assert.ok(logs.some((l) => /QUOTA HALT/.test(l)), 'halt announced')
  assert.ok((result.aborts || []).some((a) => /quota-halt:/.test(a)), 'aborts carries the resume instruction entry')
  assert.notEqual(result.fullSuiteGreen, true, 'integrate must not report green when it never ran')
})

test('untrusted streak: persistently distrusted leaves halt the unit, run still returns', async () => {
  const dispatch = dispatcher((c) => {
    const l = c.opts.label || ''
    if (/assess/.test(l) && /d0/.test(l)) return FIX.assessSlice
    if (/verify/.test(l) && !/integration/.test(l)) return FIX.distrust
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok((result.aborts || []).some((a) => /consecutive untrusted/.test(a)), 'streak abort recorded')
  assert.equal(result.trustedLeaves, 0, 'no leaf falsely trusted')
})

test('sh proxy routing sanity: deterministic commands go through the SH schema', async () => {
  const shCmds = []
  const dispatch = dispatcher((c) => { if (isSh(c)) shCmds.push(c.prompt) })
  await runEngine({ args: ARGS, dispatch })
  assert.ok(shCmds.some((p) => /rev-parse HEAD/.test(p)), 'git sha captured deterministically')
})
