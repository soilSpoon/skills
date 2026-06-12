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

// Scenario 1 (lock-dir graceful): when `rev-parse --absolute-git-dir` sh call dies, gd='' so the
// lock block is skipped entirely — the sentinel flows through without needing a fatal guard there.
// Claim: engine completes normally (no result.error) despite the lock-dir sh death.
test('lock-dir sh death skips lock block gracefully (sentinel flows through, no fatal)', async () => {
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /rev-parse --absolute-git-dir/.test(c.prompt)) {
      throw new Error('shell-proxy transport died on lock-dir (fixture: transport error)')
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  // Engine must NOT surface result.error — the lock block gracefully skips when gd=''
  assert.equal(result.error, undefined, `engine must complete normally when lock-dir sh dies; got error: "${result.error}"`)
  // Engine must have produced a leaf result (work ran, not aborted at the lock stage)
  assert.ok(result.totalLeaves >= 1, 'at least one leaf must complete when lock-dir sh dies gracefully')
})

// Scenario 3 (lock-check fatal guard unpinned): the fatal guard at lock-check (main.ts ~line 212)
// was implemented but never pinned by a test. Claim: when `cat .../rs-lock` sh call dies, the engine
// returns result.error naming "shell-proxy" — it must NOT proceed with held='' (false empty lock read).
test('lock-check sh death is fatal: result.error names shell-proxy (unpinned guard now pinned)', async () => {
  // To reach the lock-check sh call, lock-dir must succeed and return an absolute path first.
  const dispatch = dispatcher((c) => {
    if (isSh(c)) {
      if (/rev-parse --absolute-git-dir/.test(c.prompt)) {
        // Return a valid absolute git dir so the lock block is entered
        return { exitCode: 0, stdout: '/tmp/rs-fixture/.git\n' }
      }
      if (/rs-lock/.test(c.prompt) && /cat /.test(c.prompt)) {
        throw new Error('shell-proxy transport died on lock-check (fixture: transport error)')
      }
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(result.error, 'engine must return result.error when sh proxy dies at lock-check decision')
  assert.ok(/shell.?proxy/i.test(result.error), `result.error must name shell-proxy; got: "${result.error}"`)
})

// Scenarios 2/5/7 (filterCommand file-path scope/leaf-gate fix): the engine's deterministic tier-0 gate
// substitutes {scope} into filterCommand and runs the resulting command via sh(). The scope token is a
// FILE PATH (e.g. 'scenarios.test.mjs'), not a test name — the correct form is `node --test {scope}`
// (file arg), NOT `--test-name-pattern {scope}` (name pattern, matches zero tests named after a filename).
// Claim: with filterCommand='node --test {scope}' and testScope='scenarios.test.mjs', the t0 sh call
// fires for each executed leaf and its prompt contains `node --test scenarios.test.mjs`.
test('filterCommand {scope} substitutes as file path, t0 fires per-leaf with correct shell cmd', async () => {
  const fileScope = 'scenarios.test.mjs'
  const t0Cmds = []

  // Custom baseline: filterCommand uses file-path (node --test) form, not --test-name-pattern
  const customBaseline = {
    ...{ summary: 'fixture baseline', invariants: ['existing suite stays green'],
      measureCommand: 'true', currentState: 'all green', projectCard: 'fixture conventions',
      coldBuildCost: 'cheap', purposeCheck: 'n/a (pure fixture)', inProcessVerifiable: true },
    filterCommand: `node --test {scope}`,
  }

  // Two slices so the engine does NOT take the non-reducing (single-slice → execute original) path.
  // The original node has no testScope; only the sliced nodes do — so 2+ slices is required for t0 to fire.
  const twoSlices = {
    slices: [0, 1].map((i) => ({
      desc: `slice ${i}`, interface: 'TBD',
      contract: `x${i}`, independent: true,
      dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: fileScope,
    })),
  }

  const sliceDispatch = dispatcher((c) => {
    if (c.opts.phase === 'Baseline') return customBaseline
    // The root assess must return 'slice' so the slicer is invoked (otherwise engine executes
    // the root node directly and testScope is undefined — t0 never fires).
    if (/assess/.test(c.opts.label || '')) return FIX.assessSlice
    if (isSh(c) && /t0:/.test(c.opts.label || '')) {
      // Intercept the t0 engine-gate sh calls — capture the prompt and return ok
      t0Cmds.push(c.prompt)
      return { exitCode: 0, stdout: 'ok 1\n# tests 1\n# pass 1' }
    }
    // slice: handler returns exactly 2 slices (1 would cause non-reducing path → execute original,
    // which has no testScope — the empirically verified fix the reviewer prescribed)
    if (/slice:/.test(c.opts.label || '')) return twoSlices
  })

  await runEngine({ args: ARGS, dispatch: sliceDispatch })

  // Hard precondition: t0 must have fired — if this fails the fixture is broken (non-reducing path taken)
  assert.ok(t0Cmds.length > 0, 't0 engine gate must fire — fixture precondition: need 2+ slices with testScope')
  // The t0 command must use file-path form (node --test <file>), not --test-name-pattern
  assert.ok(
    t0Cmds.every((p) => /node --test scenarios\.test\.mjs/.test(p)),
    `every t0 sh prompt must contain 'node --test scenarios.test.mjs' (file-path form); got: ${t0Cmds.join(' | ')}`
  )
  // Must NOT use --test-name-pattern with the filename (that matches zero tests named after a file)
  assert.ok(
    !t0Cmds.some((p) => /--test-name-pattern/.test(p)),
    `t0 sh prompt must not use --test-name-pattern with a filename scope; got: ${t0Cmds.join(' | ')}`
  )
})

// Scenario 8 (lock-write fire-and-forget): `await sh('echo rs-... > rs-lock', 'lock-write')` is
// fire-and-forget — if the sh proxy dies between lock-check and lock-write, the engine proceeds
// without actually holding the lock (mutual exclusion silently not established). This pins the
// current behavior: engine produces no result.error (proceeds despite lock-write death). Noted as a
// discovered implementation gap: the lock-write result should be guarded fatally to prevent a
// second concurrent engine from clobbering the working tree.
test('lock-write sh death is fire-and-forget: engine proceeds (gap: mutual exclusion not established)', async () => {
  let lockWriteFired = false
  const dispatch = dispatcher((c) => {
    if (isSh(c)) {
      if (/rev-parse --absolute-git-dir/.test(c.prompt)) {
        return { exitCode: 0, stdout: '/tmp/rs-fixture/.git\n' }
      }
      if (/rs-lock/.test(c.prompt) && /cat /.test(c.prompt)) {
        // No lock currently held — proceed to lock-write
        return { exitCode: 1, stdout: '' }
      }
      if (/rs-lock/.test(c.prompt) && /echo /.test(c.prompt)) {
        lockWriteFired = true
        throw new Error('shell-proxy transport died on lock-write (fixture: transport error)')
      }
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(lockWriteFired, 'lock-write sh call must have been attempted (fixture precondition)')
  // Current behavior: engine proceeds despite lock-write death (fire-and-forget — no fatal guard)
  // DISCOVERED: this means mutual exclusion is NOT established; a second concurrent engine could
  // clobber the working tree. A follow-up leaf should add a fatal guard on the lock-write result.
  assert.equal(result.error, undefined, 'current behavior: engine proceeds without error despite lock-write death (gap — no fatal guard)')
  assert.ok(result.totalLeaves >= 1, 'engine continues executing leaves after lock-write sh death')
})

// Scenario 4 (wiring-scan sentinel drift): on sh-proxy death, wiring-scan returns SH_UNAVAILABLE
// (stdout='\x00SH_UNAVAILABLE', truthy), which previously caused the wiring-auditor LLM to fire
// with garbage input. Fixed by guarding with shUnavailable(newPub) before reading stdout.
// Claim: when wiring-scan sh dies (non-quota), the wiring-audit agent is NOT called.
test('wiring-scan sh death skips wiring-audit: SH_UNAVAILABLE sentinel guards the advisory LLM call', async () => {
  let wiringAuditCalled = false
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /wiring-scan/.test(c.opts.label || '')) {
      throw new Error('shell-proxy transport died on wiring-scan (fixture: transport error)')
    }
    if (/wiring-audit/.test(c.opts.label || '')) {
      wiringAuditCalled = true
      return { gaps: [] }
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  // Engine must complete normally (wiring is advisory)
  assert.equal(result.error, undefined, 'engine must not error on wiring-scan sh death')
  // With the sentinel guard in place, the wiring-auditor must NOT have been called with garbage
  assert.equal(wiringAuditCalled, false, 'wiring-audit LLM call must be skipped when wiring-scan sh returns SH_UNAVAILABLE')
})
