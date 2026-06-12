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

// A1+A7 — sh proxy death is fatal at decision points, not a silent green disguise.
// Claim: when the shell proxy agent dies (non-quota throw on a git decision call),
// (a) status --porcelain death → result.error names "shell-proxy", and NO reset --hard sh call fires
// (b) rev-parse HEAD death → result.error is returned (not a silent "git mode OFF")

test('sh proxy death at git-clean is fatal (A1+A7): no silent gitClean=true, no reset --hard fired', async () => {
  // Behavioral claim: agentSafe returning null (non-quota) for "status --porcelain" must NOT
  // be silently treated as "output is empty = git is clean"; it must surface as a fatal error
  // in result.error before any leaf runs (so no reset --hard or merge sh calls ever fire).
  let porcelainCalls = 0
  const shResets = []
  const dispatch = dispatcher((c) => {
    if (isSh(c)) {
      if (/status --porcelain/.test(c.prompt)) {
        porcelainCalls++
        throw new Error('shell-proxy transport died (non-quota test)')
      }
      if (/reset --hard/.test(c.prompt)) shResets.push(c.prompt)
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(result.error, 'engine must return result.error when sh proxy dies at git-clean decision')
  assert.ok(/shell.?proxy/i.test(result.error), `result.error must name shell-proxy; got: "${result.error}"`)
  assert.equal(shResets.length, 0, 'no reset --hard must fire after sh proxy death')
})

test('sh proxy death at git-sha is fatal (A1+A7): no silent git-mode-OFF, result.error returned', async () => {
  // Behavioral claim: agentSafe returning null for "rev-parse HEAD" must NOT silently downgrade
  // to "git mode OFF" (log + continue); it must return result.error before any leaf runs.
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /rev-parse HEAD/.test(c.prompt)) {
      throw new Error('shell-proxy transport died (non-quota test)')
    }
  })
  const { result, logs } = await runEngine({ args: ARGS, dispatch })
  assert.ok(result.error, 'engine must return result.error when sh proxy dies at git-sha decision')
  assert.ok(/shell.?proxy/i.test(result.error), `result.error must name shell-proxy; got: "${result.error}"`)
  // Must NOT merely log "git mode OFF" and continue — that is the pre-fix silent bug
  assert.ok(!logs.some((l) => /git mode OFF/.test(l)), 'must not silently log "git mode OFF" and continue')
})
