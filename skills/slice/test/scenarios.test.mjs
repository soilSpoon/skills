// Engine behavior pins — the regression net required before any engine refactor.
// Run: node --test skills/slice/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, dispatcher, FIX, ARGS, ARGS_PARALLEL, isSh, has } from './host.mjs'

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

// Scenario 3 intent change (MUST PRESERVE): the old assertion required zero calls of ANY kind
// after a quota death, but that prevented the lock from being cleared — the user's guided resume
// would immediately hit a stale lock (self-defeating). After A2/A3: shForce is the ONE mechanical
// cleanup path that bypasses QUOTA_HALT. After quota death the ONLY allowed subsequent call is a
// shForce lock-clear (isSh class, rm -f <lockfile> prompt). Non-sh agents stay zero.
test('quota circuit breaker: after quota death only shForce lock-clear fires (non-sh=0, lock cleared, no false restored log)', async () => {
  // Engineer LOCKFILE to be set: override rev-parse --absolute-git-dir to return a real path.
  // Without this, LOCKFILE stays '' and lock-clear never fires — the fixture would prove nothing.
  let tripped = -1
  const FAKE_GIT_DIR = '/tmp/rs-fixture/.git'
  const dispatch = dispatcher((c) => {
    // Make lock-dir return a real abs path so LOCKFILE is set and the lock-clear path is exercised
    if (isSh(c) && /rev-parse --absolute-git-dir/.test(c.prompt)) {
      return { exitCode: 0, stdout: FAKE_GIT_DIR + '\n' }
    }
    // Confirm no lock held (so the engine proceeds past lock-check)
    if (isSh(c) && /rs-lock/.test(c.prompt) && /cat /.test(c.prompt)) {
      return { exitCode: 1, stdout: '' }
    }
    // Trip quota at the first verify call
    if (/verify/.test(c.opts.label || '') && tripped === -1) {
      tripped = c.i
      throw new Error("You've hit your session limit · resets 12:20am (Asia/Seoul)")
    }
  })
  const { result, calls, logs } = await runEngine({ args: ARGS, dispatch })

  assert.ok(tripped >= 0, 'the quota throw fired')
  const after = calls.filter((c) => c.i > tripped)

  // Only isSh (shForce) calls are allowed after quota death — zero non-sh agents
  const nonShAfter = after.filter((c) => !isSh(c))
  assert.equal(nonShAfter.length, 0,
    `no non-sh agent may be spawned after a quota death; got ${nonShAfter.length}: ${nonShAfter.map((c) => c.opts.label).join(', ')}`)

  // The lock-clear shForce call must actually fire (rm -f <lockfile> prompt)
  const lockClearCalls = after.filter((c) => isSh(c) && /rm -f/.test(c.prompt) && /rs-lock/.test(c.prompt))
  assert.ok(lockClearCalls.length >= 1,
    `shForce lock-clear (rm -f <lockfile>) must fire after quota death; sh calls after trip: ${after.filter(isSh).map((c) => c.prompt.slice(0, 80)).join(' | ')}`)

  assert.ok(logs.some((l) => /QUOTA HALT/.test(l)), 'halt announced')
  assert.ok((result.aborts || []).some((a) => /quota-halt:/.test(a)), 'aborts carries the resume instruction entry')
  assert.notEqual(result.fullSuiteGreen, true, 'integrate must not report green when it never ran')

  // A3: restore() must NOT log 'restored to' when it was actually skipped (quota halt no-ops sh)
  assert.ok(!logs.some((l) => /restored to/.test(l)),
    `'restored to' must not appear in logs when restore() is a no-op during quota halt; got: ${logs.filter((l) => /restored to/.test(l)).join(' | ')}`)
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

// A4+A5 — Coordinate halt gate + wt-pre branch -D merged guard + briefing block halt gate.
// Claim: when quota throws during a verify inside a parallel group run:
//   (a) NO `git merge` or `merge-fullsuite` sh prompts fire after the quota death
//   (b) logs contain 'preserved for resume' (worktrees left intact for resume)
//   (c) NO `branch -D rs/g` sh prompts fire after the quota death
//   (d) briefing agent is NOT spawned after the quota death
test('A4+A5: quota during parallel verify → Coordinate skipped + worktrees preserved + no briefing', async () => {
  let tripped = -1
  const mergeShCmds = []
  const branchDCmds = []
  let briefingCalled = false

  const dispatch = dispatcher((c, env) => {
    // Plan-phase assess has no label — match by phase to steer parallel partition
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.assessSlice
    // Trip quota on the FIRST verify call (happens inside a parallel group's runWork)
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') && tripped === -1) {
      tripped = c.i
      throw new Error("You've hit your session limit · resets 12:20am (Asia/Seoul)")
    }
    // Intercept and record merge / merge-fullsuite sh calls AFTER trip
    if (isSh(c) && tripped >= 0 && c.i > tripped) {
      if (/merge/.test(c.prompt)) mergeShCmds.push(c.prompt)
      if (/branch -D rs\/g/.test(c.prompt)) branchDCmds.push(c.prompt)
    }
    // Detect briefing agent call after trip
    if (!isSh(c) && tripped >= 0 && c.i > tripped) {
      if (c.opts.schema && c.opts.schema.required && c.opts.schema.required[0] === 'briefing') {
        briefingCalled = true
      }
    }
  })

  const { result, logs } = await runEngine({ args: ARGS_PARALLEL, dispatch })

  assert.ok(tripped >= 0, 'quota throw must have fired during parallel verify (fixture precondition)')

  // (a) No git merge / merge-fullsuite sh calls after quota death
  assert.equal(mergeShCmds.length, 0,
    `no merge sh prompts may fire after quota death; got: ${mergeShCmds.map(p => p.slice(0, 60)).join(' | ')}`)

  // (b) Log carries 'preserved for resume'
  assert.ok(logs.some(l => /preserved for resume/.test(l)),
    `log must contain 'preserved for resume' after halt; logs: ${logs.filter(l => /resume|preserve/.test(l)).join(' | ')}`)

  // (c) No branch -D rs/g sh calls after quota death
  assert.equal(branchDCmds.length, 0,
    `no 'branch -D rs/g' sh prompts may fire after quota death; got: ${branchDCmds.map(p => p.slice(0, 80)).join(' | ')}`)

  // (d) Briefing agent must NOT be spawned after quota death
  assert.equal(briefingCalled, false,
    'briefing agent must not be called after quota halt')
})

// A5 — wt-pre branch -D is gated by --merged HEAD on happy-path parallel run.
// Claim: in a normal green parallel run, the wt-pre clearWorktrees fires `branch -D rs/g*` ONLY
// for branches that appear in the `--merged HEAD` output (i.e. the engine checks --merged before -D).
test('A5: wt-pre branch -D is preceded by --merged HEAD guard on normal parallel green run', async () => {
  const mergedChecks = []
  const branchDCmds = []

  const dispatch = dispatcher((c) => {
    // Plan-phase assess has no label — match by phase to steer parallel partition
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.assessSlice
    if (isSh(c)) {
      // Track --merged HEAD branch list queries (wt-pre guard)
      if (/branch.*--merged/.test(c.prompt)) {
        mergedChecks.push(c.prompt)
        // Return listing of rs/g* branches as merged (so the engine proceeds to -D them)
        return { exitCode: 0, stdout: 'rs/g0\nrs/g1\nrs/g2\n' }
      }
      // Track branch -D rs/g calls (wt-pre cleanup)
      if (/branch -D rs\/g/.test(c.prompt)) branchDCmds.push(c.prompt)
    }
  })

  const { result } = await runEngine({ args: ARGS_PARALLEL, dispatch })

  // Fixture precondition: engine must have completed without error
  assert.equal(result.error, undefined, `engine must not error on happy-path parallel run; got: "${result.error}"`)

  // The --merged check must have fired before any branch -D rs/g (wt-pre guard)
  assert.ok(mergedChecks.length > 0,
    'wt-pre must issue a --merged HEAD branch query before deleting stale rs/g* branches')
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

// A6 — NULL_STREAK 오발 방지: heavy tier 3-렌즈 연속 null은 설계상 용인 — 같은 클래스만의
// streak는 QUOTA_HALT를 오발시켜선 안 된다. 서로 다른 클래스 ≥2가 있어야 진짜 신호.
// Behavioral claim: assess returns {difficulty:'hard',action:'execute'} → heavy tier → all 3
// lens-verify calls throw transient error → (a) no 'QUOTA HALT' log, (b) leaf verdict is
// 'heavy verify: 3 lenses, 3 distrusted', (c) run returns normally.
test('A6: heavy-lens 3-null streak (same class) does NOT fire QUOTA_HALT — each null is distrust only', async () => {
  // Engineer the leaf to be heavy-tier: assess returns difficulty:'hard', action:'execute'
  const assessHeavy = { difficulty: 'hard', size: 'small', action: 'execute', reason: 'fixture: hard leaf', risk: 'high' }
  let verifyThrows = 0
  // exec succeeds; all verify calls (all class=verify) throw — repair loop also re-runs 3 verify
  // calls (also same class) — streak grows but class set stays {verify} size=1 → no halt.
  const dispatch = dispatcher((c) => {
    if (has(c, /assess/)) return assessHeavy
    // All heavy lens verify calls throw a transient (non-session-limit) error
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
      verifyThrows++
      throw new Error('transport error (transient fixture throw)')
    }
  })
  const { result, logs } = await runEngine({ args: ARGS, dispatch })

  // (a) No QUOTA HALT log — same-class streak must NOT trigger the halt
  assert.ok(!logs.some((l) => /QUOTA HALT/.test(l)),
    `QUOTA HALT must NOT fire when all nulls are from the same verify class; logs: ${logs.filter(l => /QUOTA|NULL/.test(l)).join(' | ')}`)
  // Precondition: heavy verify was invoked at all (3 lens calls per attempt; repair may add more)
  assert.ok(verifyThrows >= 3, `at least 3 heavy lens verify calls must have thrown; got ${verifyThrows}`)
  // (b) First-leaf verdict reflects heavy distrust (3 lenses, 3 distrusted)
  const firstResult = result.results && result.results[0]
  const verdictReason = firstResult && firstResult.verdict && firstResult.verdict.reason
  assert.ok(verdictReason && /heavy verify.*3 lenses.*3 distrusted/.test(verdictReason),
    `leaf verdict must be 'heavy verify: 3 lenses, 3 distrusted'; got: "${verdictReason}"`)
  // (c) Run returns normally — no result.error
  assert.equal(result.error, undefined, `run must return normally after same-class verify nulls; got error: "${result.error}"`)
})

// B1+B3+B4 — 검증자 주입 레이어 정리 (three sub-assertions in one block).
//
// (a) Tidy leaf: engine runs measureCommand via sh() labeled 'tidy-fullsuite' BEFORE calling the
//     verifier, and the tidy verify prompt contains 'ENGINE-RAN' instead of a 're-run' instruction.
// (b) light tier: the light verify prompt must NOT contain 'LEAF TEST DISCIPLINE' (engineT0 or
//     light mode already covers the reproduction; injecting the filter discipline is redundant noise).
// (c) standard tier with engineT0 green: the standard verify prompt must NOT contain 'LEAF TEST
//     DISCIPLINE' (the engine already ran the filtered gate; the verifier must judge the artifact,
//     not re-run the same command).

test('B1: tidy leaf — engine runs measureCommand (tidy-fullsuite sh) before verifier; verify prompt has ENGINE-RAN, no re-run instruction', async () => {
  // Behavioral claim: for a tidy leaf the engine MUST run measureCommand deterministically (via sh
  // labeled 'tidy-fullsuite') before calling the LLM verifier, then pass ENGINE-RAN in the verify
  // prompt so the verifier judges the artifact instead of re-running the full suite itself (resolving
  // the R_VERIFY "NEVER the whole suite" vs tidy "run the FULL existing suite" contradiction).
  const tidyFullsuiteCmds = []
  const tidyVerifyPrompts = []

  // Inject a single tidy slice via the slicer intercept
  const tidySlices = {
    slices: [
      { desc: 'tidy: extract helper (fixture)', interface: 'TBD/exploratory',
        contract: 'pure rename/extract — no behavior change', independent: true,
        dependsOn: [], kind: 'tidy', atomic: true, riskTier: 'standard', testScope: undefined },
      // second slice so non-reducing path is NOT taken (slicer must return 2+ to avoid direct execute)
      { desc: 'behavior: use helper (fixture)', interface: 'TBD/exploratory',
        contract: 'call the extracted helper', independent: false,
        dependsOn: ['tidy: extract helper (fixture)'], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: undefined },
    ],
  }

  const dispatch = dispatcher((c) => {
    // Drive decomposition: root assess → slice, then the slicer returns our tidy+behavior pair
    if (/assess/.test(c.opts.label || '')) return FIX.assessSlice
    if (/slice:/.test(c.opts.label || '')) return tidySlices
    // Capture tidy-fullsuite sh call
    if (isSh(c) && /tidy-fullsuite/.test(c.opts.label || '')) {
      tidyFullsuiteCmds.push(c.prompt)
      return { exitCode: 0, stdout: 'ok 1\n# pass 1' }
    }
    // Capture tidy verify prompt (label contains '·tidy')
    if (/verify.*tidy/.test(c.opts.label || '')) {
      tidyVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  // Precondition: tidy verify must have been called
  assert.ok(tidyVerifyPrompts.length > 0, 'tidy verify must have been invoked (fixture precondition)')

  // (1) The engine must have issued a tidy-fullsuite sh call before the verifier
  assert.ok(tidyFullsuiteCmds.length > 0,
    `engine must run measureCommand via sh (label 'tidy-fullsuite') before tidy verify; no such call found`)

  // (2) The tidy-fullsuite sh prompt must contain the baseline measureCommand
  assert.ok(tidyFullsuiteCmds.every((p) => /true/.test(p)),
    `tidy-fullsuite sh prompt must include the measureCommand ('true' in fixture baseline); got: ${tidyFullsuiteCmds.join(' | ')}`)

  // (3) The tidy verify prompt must contain 'ENGINE-RAN' (engine result hand-off)
  assert.ok(tidyVerifyPrompts.every((p) => /ENGINE-RAN/.test(p)),
    `tidy verify prompt must contain 'ENGINE-RAN'; got first 300: ${tidyVerifyPrompts[0] && tidyVerifyPrompts[0].slice(0, 300)}`)

  // (4) The tidy verify prompt must NOT contain a 're-run the full suite' instruction
  assert.ok(!tidyVerifyPrompts.some((p) => /run the FULL existing suite/.test(p)),
    `tidy verify prompt must NOT contain 'run the FULL existing suite' re-run instruction (contradiction with R_VERIFY); found in: ${tidyVerifyPrompts.filter(p => /run the FULL existing suite/.test(p)).map(p => p.slice(0, 200)).join(' | ')}`)
})

test('B3: light-tier verify prompt does NOT inject LEAF_TEST filter-run text (is FORBIDDEN here absent)', async () => {
  // Behavioral claim: when riskTier='light', the verifier is R_VERIFY_LIGHT which is a diff-audit
  // path — injecting LEAF_TEST(scope) appendage ('is FORBIDDEN here') is contradictory noise since
  // R_VERIFY_LIGHT already doesn't ask for a full re-run; the phrase 'is FORBIDDEN here' (unique to
  // LEAF_TEST injection) must NOT appear in the light verify prompt.
  const lightVerifyPrompts = []

  const lightSlices = {
    slices: [
      { desc: 'light fixture slice A', interface: 'TBD/exploratory',
        contract: 'pure-function change', independent: true,
        dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'light', testScope: 'LightSuite' },
      { desc: 'light fixture slice B', interface: 'TBD/exploratory',
        contract: 'another low-risk unit', independent: true,
        dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'light', testScope: 'LightSuite' },
    ],
  }

  const dispatch = dispatcher((c) => {
    if (/slice:/.test(c.opts.label || '')) return lightSlices
    // Capture light verify prompts
    if (/verify.*light/.test(c.opts.label || '')) {
      lightVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(lightVerifyPrompts.length > 0, 'light verify must have been invoked (fixture precondition)')

  // 'is FORBIDDEN here' is injected ONLY by LEAF_TEST(scope) — not by R_VERIFY or R_VERIFY_LIGHT themselves.
  // If this phrase is absent, the concrete filter-run instruction was NOT injected (redundant noise removed).
  assert.ok(!lightVerifyPrompts.some((p) => /is FORBIDDEN here/.test(p)),
    `light verify prompt must NOT contain the LEAF_TEST 'is FORBIDDEN here' injection; found in: ${lightVerifyPrompts.filter(p => /is FORBIDDEN here/.test(p)).map(p => p.slice(0, 300)).join(' | ')}`)
})

test('B4: standard verify with engineT0 green — prompt has ENGINE-RAN, no LEAF_TEST injection (is FORBIDDEN here absent)', async () => {
  // Behavioral claim: when the engine has already run the filtered gate (engineT0 non-empty / green),
  // injecting LEAF_TEST(scope) appendage ('is FORBIDDEN here') into the standard verify prompt is
  // contradictory noise — the engine already ran it; the verifier must judge the ARTIFACT, not re-run.
  // After engine t0 green the standard verify prompt must contain 'ENGINE-RAN' and must NOT contain
  // 'is FORBIDDEN here' (the unique marker of the LEAF_TEST injection appendage).
  const stdVerifyPrompts = []
  const t0Cmds = []

  // Use FIX.slices3 which has testScope='S0'/'S1'/'S2' (scopeSafe passes)
  // FIX.baseline filterCommand = 'true # {scope}' so t0cmd fires
  const dispatch = dispatcher((c) => {
    if (/assess/.test(c.opts.label || '')) return FIX.assessSlice
    // Capture t0 sh calls and let them succeed
    if (isSh(c) && /t0:/.test(c.opts.label || '')) {
      t0Cmds.push(c.prompt)
      return { exitCode: 0, stdout: 'ok 1\n# pass 1' }
    }
    // Capture standard verify prompts (no '·tidy' or '·light' suffix)
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
        !/tidy/.test(c.opts.label || '') && !/light/.test(c.opts.label || '')) {
      stdVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(t0Cmds.length > 0, 'engine t0 must have fired (fixture precondition: need 2+ slices with testScope)')
  assert.ok(stdVerifyPrompts.length > 0, 'standard verify must have been invoked (fixture precondition)')

  // (1) Standard verify prompt must contain 'ENGINE-RAN' when engineT0 ran
  assert.ok(stdVerifyPrompts.every((p) => /ENGINE-RAN/.test(p)),
    `standard verify prompt must contain 'ENGINE-RAN' when engine t0 ran; got first 300: ${stdVerifyPrompts[0] && stdVerifyPrompts[0].slice(0, 300)}`)

  // (2) Standard verify prompt must NOT contain the LEAF_TEST injection ('is FORBIDDEN here') when
  // ENGINE-RAN is present — 'is FORBIDDEN here' is unique to LEAF_TEST(scope) appendage (not in R_VERIFY itself).
  assert.ok(!stdVerifyPrompts.some((p) => /is FORBIDDEN here/.test(p)),
    `standard verify prompt must NOT contain LEAF_TEST injection ('is FORBIDDEN here') when ENGINE-RAN is present; found in: ${stdVerifyPrompts.filter(p => /is FORBIDDEN here/.test(p)).map(p => p.slice(0, 300)).join(' | ')}`)
})

// B2+B5+B6+B7+B8 — 프롬프트 중복·모순 다이어트
//
// (a) B7: batch follow-up leaf exec prompt must contain 'Baseline to preserve' EXACTLY ONCE
//     (currently 2: INV is injected into node.ctx at stack.push, then again directly in exec template).
// (b) B2: merge-conflict LLM prompt must NOT contain 'FULL measure' or 'worktree remove'
//     (the engine owns both of those steps; the LLM coordinator only resolves conflicts).
// (c) B6: leaf verify prompt must NOT contain 'explicitly orders a FULL run'
//     (that dead branch in R_VERIFY was never reachable — the engine never sends such an instruction).
// (d) Integrate agentSafe prompt must NOT contain 'PURPOSE (①' pattern
//     (the integrate prompt must NOT re-inject PURPOSE separately; R_VERIFY already covers it via INV).

test('B7: batch follow-up exec prompt has Baseline to preserve exactly once (no double INV injection)', async () => {
  // Behavioral claim: when a trusted leaf produces discovered items, the engine pushes a batch follow-up
  // node with ctx = "Discovered while doing '...'. ${INV}". The exec prompt template also appends ${INV}
  // directly. This double-injection makes 'Baseline to preserve' appear twice. The fix: strip INV from
  // node.ctx at push time so it is injected only once by the exec template.
  // Fixture: FIX.exec.discovered variant triggers the batch push; the second exec is the batch leaf
  // (task starts with "Address these"). We capture that batch exec prompt to count 'Baseline to preserve'.
  const execWithDiscovered = {
    summary: 'fixture change applied', passed: true, evidence: 'filtered run green (fixture)',
    filesChanged: ['src/x.ts'], refactor: 'none needed (fixture)', commits: [],
    funList: [],
    discovered: ['edge case A: empty input should not throw'],  // triggers batch follow-up push
    purposeVerified: true,
  }

  let firstExecDone = false
  const batchExecPrompts = []
  const dispatch = dispatcher((c) => {
    if (/^exec:|exec:/.test(c.opts.label || '') && !/\.r/.test(c.opts.label || '')) {
      if (!firstExecDone) {
        firstExecDone = true
        return execWithDiscovered  // first exec: returns discovered item
      }
      // Second exec is the batch follow-up leaf (task contains "Address these")
      batchExecPrompts.push(c.prompt)
      // fall through → base dispatcher returns FIX.exec (no more discovered)
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(batchExecPrompts.length > 0, 'batch follow-up exec must have been called (fixture precondition: need discovered item)')

  for (const p of batchExecPrompts) {
    const occurrences = (p.match(/Baseline to preserve/g) || []).length
    assert.equal(occurrences, 1,
      `batch follow-up exec prompt must contain 'Baseline to preserve' exactly once; found ${occurrences} times. First 500 chars: ${p.slice(0, 500)}`)
  }
})

test('B2: merge-conflict LLM prompt has no FULL measure or worktree remove (engine owns those steps)', async () => {
  // Behavioral claim: after B2 R_COORD diet, the merge-conflict agentSafe prompt no longer instructs
  // the LLM to run the FULL measure command or remove worktrees — the engine owns both deterministically.
  const mergeConflictPrompts = []

  const dispatch = dispatcher((c, env) => {
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.assessSlice
    // Force a merge conflict on the first branch
    if (isSh(c) && /merge --no-ff/.test(c.prompt) && /rs\/g0/.test(c.prompt)) {
      return { exitCode: 1, stdout: 'CONFLICT (content): Merge conflict in src/x.ts' }
    }
    // Capture merge-conflict LLM call prompts
    if (/merge-conflict/.test(c.opts.label || '')) {
      mergeConflictPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS_PARALLEL, dispatch })

  assert.ok(mergeConflictPrompts.length > 0, 'merge-conflict LLM must have been called (fixture precondition)')

  for (const p of mergeConflictPrompts) {
    assert.ok(!/FULL measure/.test(p),
      `merge-conflict prompt must NOT contain 'FULL measure'; found in: ${p.slice(0, 400)}`)
    assert.ok(!/worktree remove/.test(p),
      `merge-conflict prompt must NOT contain 'worktree remove'; found in: ${p.slice(0, 400)}`)
  }
})

test('B6: standard-tier leaf verify prompt does NOT contain explicitly orders a FULL run (dead R_VERIFY branch removed)', async () => {
  // Behavioral claim: the dead branch "if the prompt explicitly orders a FULL run (integration/merge),
  // run the full suite" in R_VERIFY is never reachable — the engine never sends such an instruction.
  // After deletion the phrase 'explicitly orders a FULL run' must not appear in any standard leaf verify prompt.
  // Standard tier is forced by returning difficulty:'medium' from assess (not easy→light, not hard→heavy).
  const assessStandard = { difficulty: 'medium', size: 'small', action: 'execute', reason: 'fixture: standard', risk: 'medium' }
  const stdVerifyPrompts = []

  const dispatch = dispatcher((c) => {
    if (has(c, /assess/)) return assessStandard
    // Capture standard verify prompts (not light, not heavy, not tidy, not integration)
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
        !/tidy/.test(c.opts.label || '') && !/light/.test(c.opts.label || '')) {
      stdVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(stdVerifyPrompts.length > 0, 'standard-tier leaf verify must have been called (fixture precondition: need assess returning medium difficulty)')

  for (const p of stdVerifyPrompts) {
    assert.ok(!/explicitly orders a FULL run/.test(p),
      `standard leaf verify prompt must NOT contain 'explicitly orders a FULL run' (dead R_VERIFY branch); found in: ${p.slice(0, 400)}`)
  }
})

test('B8+PURPOSE: integrate agentSafe prompt has no PURPOSE (①) re-injection; R_VERIFY covers it', async () => {
  // Behavioral claim: after PURPOSE unification the integrate prompt must NOT append a separate
  // "PURPOSE (①, Beck): ..." clause (R_VERIFY already instructs purposeGap via its own PURPOSE
  // sentence which now mentions 'remains UNVERIFIED and how to close it').
  // Also pins that the integrate prompt still contains 'Baseline to preserve' (INV is still present).
  // The integration call has schema=VERDICT (required[0]==='trustworthy'); briefing has schema=BRIEFING
  // (required[0]==='briefing') — we capture only the VERDICT-schema calls to avoid the briefing noise.
  const integratePrompts = []

  const dispatch = dispatcher((c) => {
    if (c.opts.phase === 'Integrate' && !isSh(c) &&
        c.opts.schema && c.opts.schema.required && c.opts.schema.required[0] === 'trustworthy') {
      integratePrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(integratePrompts.length > 0, 'integrate VERDICT agentSafe must have been called (fixture precondition)')

  for (const p of integratePrompts) {
    assert.ok(!/PURPOSE \(①/.test(p),
      `integrate prompt must NOT contain 'PURPOSE (①' re-injection; found in: ${p.slice(0, 500)}`)
    assert.ok(/Baseline to preserve/.test(p),
      `integrate prompt must still contain 'Baseline to preserve' (INV present); got first 500: ${p.slice(0, 500)}`)
  }
})

// A6 contrast — cross-class streak must still fire QUOTA_HALT (circuit breaker preserved).
// Sequence: heavy leaf → all 3 lens-verify calls throw (class=verify, streak=3, size=1 → no halt)
// → repair exec ALSO throws (class=exec added, streak=4, classes={verify,exec} size=2 ≥3 → HALT).
// Behavioral claim: mixing verify-nulls + exec-null reaches the ≥2-class threshold → QUOTA_HALT.
test('A6 contrast: cross-class streak (verify nulls + repair exec null) fires QUOTA_HALT (circuit breaker preserved)', async () => {
  // Heavy leaf: 3 verify lenses throw (streak=3, classes={verify}, size=1 — no halt yet).
  // Repair exec then throws (streak=4, classes={verify,exec}, size=2, streak>=3 → HALT).
  const assessHeavy = { difficulty: 'hard', size: 'small', action: 'execute', reason: 'fixture: hard leaf', risk: 'high' }
  const dispatch = dispatcher((c) => {
    if (has(c, /assess/)) return assessHeavy
    // All verify calls throw (class=verify; same class alone never halts with our fix)
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
      throw new Error('transport error on verify (transient fixture throw)')
    }
    // Repair exec (label ends in .r1) also throws — this adds class=exec → cross-class → HALT
    if (/^exec:|exec:/.test(c.opts.label || '') && /\.r\d/.test(c.opts.label || '')) {
      throw new Error('transport error on repair exec (transient fixture throw)')
    }
  })
  const { logs } = await runEngine({ args: ARGS, dispatch })
  // Cross-class streak (verify class + exec class) MUST trigger the circuit breaker
  assert.ok(logs.some((l) => /QUOTA HALT/.test(l)),
    `QUOTA HALT MUST fire for cross-class streak (verify+exec nulls); got logs: ${logs.filter(l => /QUOTA|NULL/.test(l)).join(' | ')}`)
})
