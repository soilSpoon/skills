// Engine behavior pins — the regression net required before any engine refactor.
// Run: node --test skills/slice/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import { runEngine, dispatcher, FIX, ARGS, ARGS_DEFAULT, ARGS_PARALLEL, isSh, has, isBatch } from './host.mjs'

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
    // !isSh: the engine's deterministic ENGINE-DIFF fetch (label 'verify-diff:…') is an sh call, NOT the
    // LLM verifier — let it fall through to the base dispatcher; intercept only the real verify role here.
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
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
  // Engineer LOCKFILE to be set: the batched prologue's lock-dir marker must carry a real abs path
  // (ITEM 6: `rev-parse --absolute-git-dir` is now a sub-command inside the prologue batch, so its
  // OUTCOME is supplied via shOver, not by intercepting a standalone prompt). With a real gitdir the
  // engine emits the lock-check + lock-write sub-commands and LOCKFILE is set, so the lock-clear path
  // is exercised. lock-check defaults to "not held" (exit 1) so the engine proceeds to lock-write.
  let tripped = -1
  const FAKE_GIT_DIR = '/tmp/rs-fixture/.git'
  const dispatch = dispatcher((c) => {
    // Trip quota at the first verify call
    if (/verify/.test(c.opts.label || '') && tripped === -1) {
      tripped = c.i
      throw new Error("You've hit your session limit · resets 12:20am (Asia/Seoul)")
    }
  }, { 'lock-dir': { out: FAKE_GIT_DIR, code: 0 } })  // shOver: real gitdir ⇒ LOCKFILE set, lock block runs
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
    // ITEM 10: root decompose:d0 → slice (carries the 3 fixture children) so leaves run and get distrusted.
    if (/decompose/.test(l) && /d0/.test(l)) return FIX.decomposeSlice
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

// A1 lock-dir sentinel fatal (4th unlisted A1 point): when `rev-parse --absolute-git-dir` sh dies
// (sentinel returned), the engine must retry ONCE then abort with result.error — NOT silently skip
// the lock block (which would set LOCKFILE='' and allow concurrent runs to clobber the working tree).
// Behavioral claim: both absolute-git-dir attempts return sentinel → result.error is set AND no leaf runs.
test('lock-dir sh death is fatal after retry: result.error set, no leaf executes without lock (A1-lock-dir)', async () => {
  // Behavioral claim: when rev-parse --absolute-git-dir returns sentinel on both the initial attempt
  // AND the 1-retry, the engine must abort (result.error) rather than silently proceeding lock-less.
  // This pins that 'git mode ON' + sh proxy death at lock-dir can never reach a leaf execution.
  let lockDirAttempts = 0
  const execLabels = []
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /rev-parse --absolute-git-dir/.test(c.prompt)) {
      lockDirAttempts++
      throw new Error('shell-proxy transport died on lock-dir (fixture: A1 lock-dir sentinel)')
    }
    // Track any exec calls (must be zero — no leaf should run without lock)
    if (!isSh(c) && /^exec:|exec:/.test(c.opts.label || '')) {
      execLabels.push(c.opts.label)
    }
  })
  const { result } = await runEngine({ args: ARGS, dispatch })
  // Engine must abort with result.error — not silently proceed lock-less
  assert.ok(result.error, `engine must return result.error when lock-dir sh dies on both attempts; got undefined`)
  assert.ok(/shell.?proxy|lock.?dir/i.test(result.error),
    `result.error must name shell-proxy or lock-dir; got: "${result.error}"`)
  // Retry must have fired (2 total attempts)
  assert.ok(lockDirAttempts >= 2,
    `engine must retry lock-dir once before aborting (expected ≥2 attempts); got ${lockDirAttempts}`)
  // No leaf must have executed — lock-less execution is forbidden after 'git mode ON'
  assert.equal(execLabels.length, 0,
    `no exec must fire after lock-dir fatal abort; got: ${execLabels.join(', ')}`)
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
    // ITEM 10: the root decompose must return action:'slice' WITH the 2 children in the SAME call (the
    // merged decision carries the cut), so the engine slices instead of executing the testScope-less root
    // (1 child would take the non-reducing→execute path — the empirically verified fix the reviewer prescribed).
    if (/decompose/.test(c.opts.label || '')) return { action: 'slice', reason: 'fixture: decompose', slices: twoSlices.slices }
    if (isSh(c) && /t0:/.test(c.opts.label || '')) {
      // Intercept the t0 engine-gate sh calls — capture the prompt and return ok
      t0Cmds.push(c.prompt)
      return { exitCode: 0, stdout: 'ok 1\n# tests 1\n# pass 1' }
    }
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

// A1 lock-write sentinel fatal (same class as lock-dir): if the sh proxy dies writing the lock
// file, the engine believes it holds the lock when it does not — a second concurrent run can
// clobber the working tree. Guard: treat lock-write sentinel as fatal, same class as lock-check.
// Behavioral claim: lock-write sh returns sentinel → result.error set, no leaf executes (A1-lock-write).
test('lock-write sh death is fatal: result.error set, no leaf executes (engine must not believe lock held when it is not) (A1-lock-write)', async () => {
  // Behavioral claim: when the sh call writing the lock file returns sentinel, the engine must abort
  // (result.error) rather than continuing under the false belief that it holds mutual exclusion.
  let lockWriteFired = false
  const execLabels = []
  // ITEM 6: the prologue batch (git-sha+clean+lock-dir+lock-check) runs first; a real gitdir (shOver
  // lock-dir) makes the engine emit lock-check (defaults to "not held", exit 1) and then proceed to the
  // SEPARATE lock-write batch (batch-2). We kill THAT batch (its prompt carries `echo rs-…` + `rs-lock`)
  // to simulate the shell proxy dying at lock-write → the whole batch returns SH_UNAVAILABLE (sentinel) →
  // the engine's lock-write fatal guard must fire (same CLAIM as before the batching: result.error, no leaf).
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /rs-lock/.test(c.prompt) && /echo /.test(c.prompt)) {
      lockWriteFired = true
      throw new Error('shell-proxy transport died on lock-write (fixture: A1 lock-write sentinel)')
    }
    // Track any exec calls (must be zero — no leaf should run if lock was never written)
    if (!isSh(c) && /^exec:|exec:/.test(c.opts.label || '')) {
      execLabels.push(c.opts.label)
    }
  }, { 'lock-dir': { out: '/tmp/rs-fixture/.git', code: 0 } })  // shOver: real gitdir ⇒ lock-check + lock-write fire
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(lockWriteFired, 'lock-write sh call must have been attempted (fixture precondition)')
  // Engine must abort with result.error — not proceed believing lock is held
  assert.ok(result.error,
    `engine must return result.error when lock-write sh dies (sentinel); got undefined`)
  assert.ok(/shell.?proxy|lock.?write/i.test(result.error),
    `result.error must name shell-proxy or lock-write; got: "${result.error}"`)
  // No leaf must have executed — execution without an established lock is forbidden
  assert.equal(execLabels.length, 0,
    `no exec must fire after lock-write fatal abort; got: ${execLabels.join(', ')}`)
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
    // Plan-phase decompose has no label — match by phase to steer parallel partition
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
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
    // Plan-phase decompose has no label — match by phase to steer parallel partition
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
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
// Behavioral claim: decompose returns {action:'execute',riskTier:'heavy'} → heavy tier → all 3
// lens-verify calls throw transient error → (a) no 'QUOTA HALT' log, (b) leaf verdict is
// 'heavy verify: 3 lenses, 3 distrusted', (c) run returns normally.
test('A6: heavy-lens 3-null streak (same class) does NOT fire QUOTA_HALT — each null is distrust only', async () => {
  // ITEM 10: engineer a heavy-tier leaf via the merged decompose decision (action:'execute', riskTier:'heavy').
  const decomposeHeavy = { action: 'execute', riskTier: 'heavy', reason: 'fixture: hard leaf' }
  let verifyThrows = 0
  // exec succeeds; all verify calls (all class=verify) throw — repair loop also re-runs 3 verify
  // calls (also same class) — streak grows but class set stays {verify} size=1 → no halt.
  const dispatch = dispatcher((c) => {
    if (has(c, /decompose/)) return decomposeHeavy
    // All heavy lens verify calls throw a transient (non-session-limit) error. !isSh excludes the engine's
    // deterministic ENGINE-DIFF fetch (label 'verify-diff:…', an sh call) — it must run, not throw here.
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
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

// A6 paired positive — 섞인 호출 클래스 3 연속 null이 정확히 streak=3에서 QUOTA_HALT를 발생시킨다.
// 이 테스트가 없으면 NULL_STREAK 임계값을 ≥4로 올려도 기존 contrast 테스트(4 nulls, 2 classes)는 통과한다.
// Behavioral claim: 3 consecutive agentSafe nulls from 3 DIFFERENT classes (verify, exec, decompose)
// sets NULL_STREAK=3 and NULL_STREAK_CLASSES.size=3 ≥ 2 → QUOTA HALT log fires AND no further
// agent() is called after the halt-triggering call. (ITEM 10: the third distinct class is now the
// merged 'decompose' call — formerly 'assess'; the mixed-class claim is unchanged, just renamed.)
// Engineering:
//   • GIT=false (empty rev-parse HEAD stdout) removes per-leaf sh calls that would reset the streak
//   • non-atomic slices: each leaf gets its own decompose call
//   • leaf0: exec→OK, verify→null(streak=1,{verify}), repair-exec→null(streak=2,{verify,exec})
//   • leaf1: decompose→null(streak=3,{verify,exec,decompose},size=3≥2 → QUOTA_HALT fires)
// Paired negative: the A6 test immediately above (same-class heavy 3-lens → no halt).
test('A6 pin: mixed call classes (verify→exec→decompose, 3 nulls) fires QUOTA_HALT at streak=3 (threshold pin)', async () => {
  // Non-atomic slices so each leaf gets a decompose call (atomic:true would skip decompose → class never fires)
  const nonAtomicSlices = {
    slices: [0, 1].map((i) => ({
      desc: `mixed-class fixture slice ${i}`, interface: 'TBD/exploratory',
      contract: `fixture task ${i}`, independent: true,
      dependsOn: [], kind: 'behavior', atomic: false, riskTier: 'standard', testScope: undefined,
    })),
  }
  let decomposeLeafCount = 0  // counts decompose:d1 calls (leaf-level decomposes, NOT the root decompose:d0)

  // GIT=false: the batched prologue's git-sha marker carries NO 40-char sha → BASE_SHA='' → GIT=false.
  // (ITEM 6: rev-parse HEAD is now inside the batched prologue script, so the git-sha OUTCOME is supplied
  // via shOver, not by intercepting a standalone `rev-parse HEAD` prompt.) This eliminates the per-leaf
  // leafStart+restore sh() calls that would otherwise reset the streak between leaves.
  const dispatch = dispatcher((c) => {
    // Root decompose (decompose:d0) → slice so children fire (must NOT fall through to base decomposeExecute).
    // The merged decision carries the 2 non-atomic children in the SAME call (no separate slicer).
    if (has(c, /decompose:d0/)) return { action: 'slice', reason: 'fixture: decompose', slices: nonAtomicSlices.slices }
    // Leaf decomposes (decompose:d1): first (leaf0) succeeds (fall through), second (leaf1) throws
    if (has(c, /decompose:d1/)) {
      decomposeLeafCount++
      if (decomposeLeafCount >= 2) throw new Error('transport error on leaf1 decompose (fixture: mixed-class streak pin)')
      return undefined  // fall through → base dispatcher → FIX.decomposeExecute (leaf0 succeeds)
    }
    // Leaf0 verify throws — first null, class=verify (streak=1, classes={verify})
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
      throw new Error('transport error on verify (fixture: mixed-class streak pin)')
    }
    // Leaf0 repair exec (label ends in .rN) throws — second null, class=exec (streak=2, classes={verify,exec})
    if (/^exec:|exec:/.test(c.opts.label || '') && /\.r\d/.test(c.opts.label || '')) {
      throw new Error('transport error on repair exec (fixture: mixed-class streak pin)')
    }
  }, { 'git-sha': { out: '', code: 0 } })  // shOver: empty sha ⇒ GIT=false (no per-leaf restore sh)

  const { result, logs, calls } = await runEngine({ args: ARGS, dispatch })

  // Fixture preconditions
  assert.ok(decomposeLeafCount >= 2,
    `both leaf decomposes must have fired (fixture precondition: need 2 non-atomic slices); got decomposeLeafCount=${decomposeLeafCount}`)

  // (a) QUOTA HALT must fire — 3 nulls from 3 different classes must trigger the circuit breaker
  assert.ok(logs.some((l) => /QUOTA HALT/.test(l)),
    `QUOTA HALT must fire for 3-class streak (verify→exec→decompose); logs: ${logs.filter(l => /QUOTA|NULL/.test(l)).join(' | ')}`)

  // (b) Agent spawning stops after halt: the engine's QUOTA_HALT gate (line ~391 in main.ts) breaks
  // the leaf loop before exec fires — no exec:1 call should appear in calls after the halt.
  // The 'quota halt — stopping' log (from the loop's QUOTA_HALT break) confirms the gate fired.
  assert.ok(logs.some((l) => /quota halt.*stopping/.test(l)),
    `engine must log 'quota halt — stopping' when the loop breaks on QUOTA_HALT; logs: ${logs.filter(l => /quota/.test(l)).join(' | ')}`)
  // No exec call for leaf1 (exec:1) should appear — spawn truly stopped before it
  const exec1Calls = calls.filter((c) => !isSh(c) && /^exec:1$/.test(c.opts.label || ''))
  assert.equal(exec1Calls.length, 0,
    `exec for leaf1 (exec:1) must NOT fire after quota halt; got: ${exec1Calls.map(c => c.opts.label).join(', ')}`)

  // (c) Run ends without result.error (quota halt is a graceful stop, not a crash)
  assert.equal(result.error, undefined,
    `run must end without result.error after quota halt; got: "${result.error}"`)

  // (d) aborts carries the resume instruction
  assert.ok((result.aborts || []).some((a) => /quota-halt:/.test(a)),
    `aborts must carry quota-halt resume instruction; got: ${JSON.stringify(result.aborts)}`)
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
    // ITEM 10: drive decomposition — the merged decompose decision returns action:'slice' WITH our
    // tidy+behavior pair in the SAME call (no separate slicer round-trip).
    if (/decompose/.test(c.opts.label || '')) return { action: 'slice', reason: 'fixture: decompose', slices: tidySlices.slices }
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

  // ITEM 10: the base decompose decision (FIX.decomposeExecute) is action:'execute', riskTier:'light' —
  // so the root runs as ONE light-tier leaf and the light verifier (R_VERIFY_LIGHT) fires. No slice
  // intercept is needed (the merged decision routes straight to a light leaf).
  const dispatch = dispatcher((c) => {
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

  // Use FIX.decomposeSlice (carries FIX.slices3 — testScope='S0'/'S1'/'S2', scopeSafe passes, atomic
  // riskTier:'standard' → standard verify). FIX.baseline filterCommand = 'true # {scope}' so t0cmd fires.
  const dispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
    // Capture t0 sh calls and let them succeed
    if (isSh(c) && /t0:/.test(c.opts.label || '')) {
      t0Cmds.push(c.prompt)
      return { exitCode: 0, stdout: 'ok 1\n# pass 1' }
    }
    // Capture standard verify prompts (no '·tidy' or '·light' suffix). !isSh excludes the engine's
    // deterministic ENGINE-DIFF fetch (label 'verify-diff:…', an sh call) — that is not the verify role.
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
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

  // (3) KEYSTONE PIN (ITEM 8): byte-pin the extracted `engineRanBlock` helper's exact output structure
  // — `ENGINE-RAN: `<cmd>` exited <N>. Output tail: …` — not merely the bare literal 'ENGINE-RAN' (which
  // also lives in R_VERIFY boilerplate, so a corrupted helper passed CI). 'Output tail:' + the
  // `cmd`/exited/N shape are produced ONLY by engineRanBlock, so this fails if the helper template regresses.
  assert.ok(stdVerifyPrompts.every((p) => /ENGINE-RAN: `[^`]+` exited \d+\. Output tail:/.test(p)),
    `standard verify prompt must contain engineRanBlock's exact structure (ENGINE-RAN: \`cmd\` exited N. Output tail:); got first 300: ${stdVerifyPrompts[0] && stdVerifyPrompts[0].slice(0, 300)}`)
})

// ITEM 9 — the engine pre-computes the leaf's scoped diff ONCE (deterministic shell-truth) and injects it
// as an ENGINE-DIFF block into the verify prompt, so the verifier judges the supplied diff instead of
// re-greping it (R_VERIFY's #1 measured hidden cost). The diff fetch is an sh() call labeled 'verify-diff:…'
// over the leaf's own range with test files excluded. Independence is preserved — the diff is deterministic
// engine shell-truth, not a sibling model's claim — so executor!=verifier still holds.
test('ITEM 9: standard verify prompt carries an ENGINE-DIFF block — engine runs the leaf-scoped diff once (verify-diff sh), no re-grep', async () => {
  const stdVerifyPrompts = []
  let diffFetchCmd = ''            // the exact shell command of the engine's ENGINE-DIFF fetch
  let diffFetches = 0             // how many verify-diff sh calls fired
  const LEAF_DIFF = 'diff --git a/src/s0.ts b/src/s0.ts\n+++ fixture leaf change, non-tidy, in scope\n'

  // Force STANDARD-tier atomic leaves (like B4): the merged decompose decision (FIX.decomposeSlice) slices
  // the root into FIX.slices3, whose slices are atomic with riskTier:'standard' → standard verify (the base
  // decomposeExecute is riskTier:'light' = LIGHT tier, which would not exercise the standard verify path).
  const dispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
    // Engine's deterministic ENGINE-DIFF fetch: an sh() call labeled 'verify-diff:…'. Capture its command
    // and hand back a small (sub-cap) diff body so the engine injects it verbatim into the verify prompt.
    if (isSh(c) && /verify-diff:/.test(c.opts.label || '')) {
      diffFetches++
      diffFetchCmd = c.prompt
      return { exitCode: 0, stdout: LEAF_DIFF }
    }
    // Capture standard verify prompts (the real verifier role — NOT the verify-diff sh call).
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
        !/tidy/.test(c.opts.label || '') && !/light/.test(c.opts.label || '')) {
      stdVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(diffFetches > 0, 'engine must run the leaf-scoped diff once per leaf (verify-diff sh call) — fixture precondition')
  assert.ok(stdVerifyPrompts.length > 0, 'standard verify must have been invoked (fixture precondition)')

  // (1) The diff fetch must be the leaf-scoped git diff with test files excluded (matches the wiring-audit
  // exclusion form) — engine shell-truth over the leaf's OWN range, not the whole-run baseline.
  assert.ok(/git -C \S+ diff \S+\.\.HEAD/.test(diffFetchCmd),
    `ENGINE-DIFF fetch must be a leaf-scoped 'git diff <leafStart>..HEAD'; got: ${diffFetchCmd.slice(0, 200)}`)
  assert.ok(/exclude.*[Tt]est/.test(diffFetchCmd),
    `ENGINE-DIFF fetch must exclude test files (the wiring-audit way); got: ${diffFetchCmd.slice(0, 200)}`)

  // (2) Every standard verify prompt must carry an ENGINE-DIFF block holding the engine-supplied diff body —
  // this is the material R_VERIFY promises ('use it instead of re-greping').
  assert.ok(stdVerifyPrompts.every((p) => /ENGINE-DIFF:/.test(p)),
    `standard verify prompt must contain an 'ENGINE-DIFF:' block; got first 400: ${stdVerifyPrompts[0] && stdVerifyPrompts[0].slice(0, 400)}`)
  assert.ok(stdVerifyPrompts.every((p) => p.includes('fixture leaf change, non-tidy, in scope')),
    `the ENGINE-DIFF block must carry the engine-fetched diff body verbatim; got first 400: ${stdVerifyPrompts[0] && stdVerifyPrompts[0].slice(0, 400)}`)
  // The "too large" fallback must NOT appear when the diff is under the cap.
  assert.ok(!stdVerifyPrompts.some((p) => /diff too large/.test(p)),
    `sub-cap diff must be injected in full, never the 'too large' fallback; found in: ${stdVerifyPrompts.filter(p => /diff too large/.test(p)).map(p => p.slice(0, 200)).join(' | ')}`)
})

// ITEM 9 (cap) — a diff larger than the 6000-char bound must NOT flood the verify prompt; the engine
// injects a fixed pointer back at git instead, preserving the verifier's ability to inspect the range itself.
test('ITEM 9 cap: oversized leaf diff → ENGINE-DIFF block is the "too large — inspect via git" pointer, not the giant body', async () => {
  const stdVerifyPrompts = []
  const HUGE = 'x'.repeat(7000)   // > ENGINE_DIFF_CAP (6000)

  const dispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice   // standard-tier atomic leaves (see ITEM 9 above)
    if (isSh(c) && /verify-diff:/.test(c.opts.label || '')) return { exitCode: 0, stdout: HUGE }
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
        !/tidy/.test(c.opts.label || '') && !/light/.test(c.opts.label || '')) {
      stdVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(stdVerifyPrompts.length > 0, 'standard verify must have been invoked (fixture precondition)')
  // Above the cap: the pointer, not the body.
  assert.ok(stdVerifyPrompts.every((p) => /ENGINE-DIFF: \(diff too large — inspect via git yourself\)/.test(p)),
    `oversized diff must inject the 'too large' pointer; got first 400: ${stdVerifyPrompts[0] && stdVerifyPrompts[0].slice(0, 400)}`)
  // The 7000-char body must NOT be dumped into the prompt.
  assert.ok(!stdVerifyPrompts.some((p) => p.includes(HUGE)),
    'oversized diff body must NEVER be injected verbatim (it would flood the prompt)')
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
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
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
  // ITEM 10: standard tier is forced via the merged decompose decision (action:'execute', riskTier:'standard').
  const decomposeStandard = { action: 'execute', riskTier: 'standard', reason: 'fixture: standard' }
  const stdVerifyPrompts = []

  const dispatch = dispatcher((c) => {
    if (has(c, /decompose/)) return decomposeStandard
    // Capture standard verify prompts (not light, not heavy, not tidy, not integration)
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '') &&
        !/tidy/.test(c.opts.label || '') && !/light/.test(c.opts.label || '')) {
      stdVerifyPrompts.push(c.prompt)
      return FIX.trust
    }
  })

  await runEngine({ args: ARGS, dispatch })

  assert.ok(stdVerifyPrompts.length > 0, 'standard-tier leaf verify must have been called (fixture precondition: need decompose returning riskTier:standard)')

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
  // ITEM 10: heavy tier comes from the merged decompose decision (action:'execute', riskTier:'heavy').
  const decomposeHeavy = { action: 'execute', riskTier: 'heavy', reason: 'fixture: hard leaf' }
  const dispatch = dispatcher((c) => {
    if (has(c, /decompose/)) return decomposeHeavy
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

// C1-C4 — schema tax cleanup: engine must not emit serialization-tax fields to agents.
// (a) RESULT schema used in exec opts must have no 'diff' key; the DECOMPOSE schema (ITEM 10: the merged
//     decompose decision — formerly the ASSESSMENT schema) must have no 'risk' key; VERDICT schema must
//     have no 'silentErrorRisk' key.
// (b) When the decompose decision drives slicing and slices carry a concrete interface (not TBD),
//     each leaf exec prompt must contain 'Interface (FIXED):' with that value. A slice whose
//     interface is 'TBD/exploratory' must NOT inject the Interface line.
test('C1-C4: schema tax fields absent + SLICES interface threaded into exec prompt (not TBD)', async () => {
  // Behavioral claim: exec opts.schema must have no 'diff' key (serialization tax removed);
  // decompose opts.schema must have no 'risk' key; verify opts.schema must have no 'silentErrorRisk' key;
  // and leaf exec prompts receive 'Interface (FIXED): <interface>' only for non-TBD slices.
  const execSchemas = []
  const decomposeSchemas = []
  const verdictSchemas = []
  const execPrompts = []

  const concreteInterface = 'parse(s: string): Ast'
  const mixedSlices = {
    slices: [
      { desc: 'concrete iface slice', interface: concreteInterface,
        contract: 'implement parse', independent: true,
        dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: 'S0' },
      { desc: 'exploratory slice', interface: 'TBD/exploratory',
        contract: 'explore', independent: true,
        dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: 'S1' },
    ],
  }

  const dispatch = dispatcher((c) => {
    // Collect the decompose schema + return a slice decision carrying our mixed slices (the merged
    // decision returns BOTH the action AND the cut in one call — no separate slicer schema/call).
    if (has(c, /decompose/)) {
      if (c.opts.schema) decomposeSchemas.push(c.opts.schema)
      return { action: 'slice', reason: 'fixture: decompose', slices: mixedSlices.slices }
    }
    // Collect exec schema + prompt
    if (/^exec:|exec:/.test(c.opts.label || '') && !/\.r/.test(c.opts.label || '')) {
      if (c.opts.schema) execSchemas.push(c.opts.schema)
      execPrompts.push(c.prompt)
    }
    // Collect verdict schemas from verify calls
    if (/verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) {
      if (c.opts.schema) verdictSchemas.push(c.opts.schema)
    }
  })

  await runEngine({ args: ARGS, dispatch })

  // Fixture precondition: exec and verify must have been invoked
  assert.ok(execSchemas.length > 0, 'exec must have been called (fixture precondition)')
  assert.ok(verdictSchemas.length > 0, 'verify must have been called (fixture precondition)')

  // (a) RESULT schema: no 'diff' key
  for (const s of execSchemas) {
    assert.ok(!s.properties || !('diff' in s.properties),
      `exec opts.schema must NOT have 'diff' property (serialization tax); found in: ${JSON.stringify(Object.keys(s.properties || {}))}`)
  }

  // (a) DECOMPOSE schema (ITEM 10: merged decompose decision — formerly ASSESSMENT): no 'risk' key
  assert.ok(decomposeSchemas.length > 0, 'decompose must have been called (fixture precondition)')
  for (const s of decomposeSchemas) {
    assert.ok(!s.properties || !('risk' in s.properties),
      `decompose opts.schema must NOT have 'risk' property; found in: ${JSON.stringify(Object.keys(s.properties || {}))}`)
  }

  // (a) VERDICT schema: no 'silentErrorRisk' key
  for (const s of verdictSchemas) {
    assert.ok(!s.properties || !('silentErrorRisk' in s.properties),
      `verify opts.schema must NOT have 'silentErrorRisk' property; found in: ${JSON.stringify(Object.keys(s.properties || {}))}`)
  }

  // (b) Exec prompts: concrete-iface slice must contain 'Interface (FIXED): parse('
  const concretePrompts = execPrompts.filter((p) => /concrete iface slice|parse\(s: string\)/.test(p) ||
    execPrompts.indexOf(p) === 0)  // first slice is concrete
  assert.ok(execPrompts.some((p) => /Interface \(FIXED\): parse\(/.test(p)),
    `at least one exec prompt must contain 'Interface (FIXED): parse(' for the concrete-iface slice; got:\n${execPrompts.map(p => p.slice(0, 300)).join('\n---\n')}`)

  // (b) Exec prompts: TBD/exploratory slice must NOT inject 'Interface (FIXED):'
  // The TBD slice is the second one — find its exec prompt by matching 'exploratory slice' in task
  const tbdPrompts = execPrompts.filter((p) => /exploratory slice/.test(p))
  assert.ok(tbdPrompts.length === 0 || !tbdPrompts.some((p) => /Interface \(FIXED\):/.test(p)),
    `exec prompt for TBD/exploratory interface slice must NOT contain 'Interface (FIXED):'; found in: ${tbdPrompts.filter(p => /Interface \(FIXED\):/.test(p)).map(p => p.slice(0, 300)).join(' | ')}`)
})

// GROUP E (negation) — worktreeSetupCommand empty string: falsy guard already handles this, zero
// wt-setup calls must fire (contrast to absent; ensures empty='' behaves identically to absent).
// Behavioral claim: worktreeSetupCommand='' is falsy → the if-guard skips the sh call → zero
// wt-setup prompts. This is a pure contrast assertion — no production change needed.
test('GROUP E (negation): empty-string worktreeSetupCommand → zero wt-setup sh calls (same as absent)', async () => {
  // Behavioral claim: baseline.worktreeSetupCommand='' (empty string) is falsy — the if-guard
  // (`if (baseline.worktreeSetupCommand)`) must not fire the wt-setup sh call.
  const baselineWithEmptySetup = { ...FIX.baseline, worktreeSetupCommand: '' }
  const wtSetupCalls = []

  const dispatch = dispatcher((c) => {
    if (c.opts.phase === 'Baseline') return baselineWithEmptySetup
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
    if (isSh(c) && /wt-setup/.test(c.opts.label || '')) {
      wtSetupCalls.push(c)
    }
  })

  const { result } = await runEngine({ args: ARGS_PARALLEL, dispatch })
  assert.equal(result.error, undefined, `engine must not error with empty worktreeSetupCommand; got: "${result.error}"`)
  assert.equal(wtSetupCalls.length, 0,
    `wt-setup must NOT fire when worktreeSetupCommand is '' (empty string); got ${wtSetupCalls.length} calls`)
})

// GROUP E (failure path) — wt-setup exitCode !== 0: the setup command failed in the fresh checkout.
// Behavioral claim: when wt-setup sh returns exitCode !== 0, the engine must NOT silently continue
// using that worktree (the checkout has no deps installed — running measure there cold-thrashes,
// exactly the mode this feature was designed to prevent). The group must be marked as failed: its
// leaf must NOT appear as trusted in the final result. The engine must log a setup-failed message.
test('GROUP E (failure): wt-setup exitCode!==0 → group leaf NOT trusted (setup-failed mark, no silent cold-thrash)', async () => {
  // Behavioral claim: when the wt-setup sh call fails (exitCode=1) for group g0, that group's leaf
  // must not be trusted in result.trustedLeaves. The engine must skip execution or mark the result
  // as not-trusted — running measure in a broken checkout and trusting the result is forbidden.
  const SETUP_CMD = 'npm ci --fixture'
  const baselineWithSetup = { ...FIX.baseline, worktreeSetupCommand: SETUP_CMD }

  const setupFailedCalls = []
  const execCalls = []

  const dispatch = dispatcher((c) => {
    if (c.opts.phase === 'Baseline') return baselineWithSetup
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
    if (isSh(c) && /wt-setup/.test(c.opts.label || '')) {
      // ALL worktrees' setup fails
      setupFailedCalls.push(c)
      return { exitCode: 1, stdout: 'npm ERR! missing deps (fixture)' }
    }
    // Track exec calls (if exec fires, the broken worktree was silently used)
    if (!isSh(c) && has(c, /exec:/)) {
      execCalls.push(c)
    }
  })

  const { result, logs } = await runEngine({ args: ARGS_PARALLEL, dispatch })

  // Fixture precondition: at least one wt-setup must have fired and returned failure
  assert.ok(setupFailedCalls.length >= 1,
    `fixture precondition: wt-setup must have fired and been intercepted; got ${setupFailedCalls.length}`)

  // Core assertion: no group leaf from a failed-setup worktree may be trusted
  // (the group is either skipped entirely or marked passed=false / trustworthy=false)
  assert.equal(result.trustedLeaves, 0,
    `no leaf must be trusted when all worktree setups fail; got trustedLeaves=${result.trustedLeaves}`)

  // Engine must log a setup-failed notice (not silently proceed)
  assert.ok(logs.some(l => /setup.?fail|wt-setup.*fail|setup.*exit|failed.*setup/i.test(l)),
    `engine must log a setup-failed message when wt-setup sh fails; logs: ${logs.join(' | ')}`)
})

// GROUP E — BASELINE.worktreeSetupCommand: parallel worktree setup command fires exactly once per
// worktree, immediately after wt-add, carrying the worktree path and the setup command.
// Behavioral claim: when baseline.worktreeSetupCommand is set and parallel mode is active, the
// engine issues one 'wt-setup' sh prompt per worktree (total = N independent groups), each prompt
// containing the worktree path and the setup command string. When the field is absent, zero
// wt-setup sh prompts fire (contrast assertion). Order: all wt-setup calls precede the first
// exec/assess call in any parallel group.
test('GROUP E: worktreeSetupCommand fires exactly once per worktree after wt-add, before work begins; absent = 0 calls', async () => {
  const SETUP_CMD = 'npm ci --fixture'
  const baselineWithSetup = { ...FIX.baseline, worktreeSetupCommand: SETUP_CMD }

  // ── sub-case A: worktreeSetupCommand present ──────────────────────────────
  const wtSetupCalls = []
  const wtAddCalls = []
  const firstExecOrAssessIdx = { val: Infinity }
  let callCounter = 0

  const dispatchWithSetup = dispatcher((c) => {
    const idx = callCounter++
    if (c.opts.phase === 'Baseline') return baselineWithSetup
    // Plan-phase decompose (no label) steers to slice for parallel partition
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
    if (isSh(c)) {
      if (/worktree add/.test(c.prompt)) { wtAddCalls.push({ idx, prompt: c.prompt }); return { exitCode: 0, stdout: '' } }
      if (/wt-setup/.test(c.opts.label || '')) {
        wtSetupCalls.push({ idx, prompt: c.prompt, label: c.opts.label || '' })
        return { exitCode: 0, stdout: '' }
      }
    }
    // Track the first non-sh leaf work call (exec or decompose inside a group)
    if (!isSh(c) && (has(c, /exec:/) || has(c, /decompose/)) && idx < firstExecOrAssessIdx.val) {
      firstExecOrAssessIdx.val = idx
    }
  })

  const { result: resultA } = await runEngine({ args: ARGS_PARALLEL, dispatch: dispatchWithSetup })
  assert.equal(resultA.error, undefined, `engine must not error with worktreeSetupCommand set; got: "${resultA.error}"`)

  // Fixture precondition: wt-add must have fired (parallel mode entered)
  assert.ok(wtAddCalls.length >= 2, `at least 2 wt-add calls must have fired (parallel mode); got ${wtAddCalls.length}`)

  // Core assertion: exactly one wt-setup sh call per worktree (= N = wtAddCalls.length)
  assert.equal(wtSetupCalls.length, wtAddCalls.length,
    `wt-setup must fire exactly once per worktree (N=${wtAddCalls.length}); got ${wtSetupCalls.length} calls`)

  // Each wt-setup prompt must contain the setup command
  for (const c of wtSetupCalls) {
    assert.ok(c.prompt.includes(SETUP_CMD),
      `wt-setup prompt must contain the setup command '${SETUP_CMD}'; got: ${c.prompt.slice(0, 200)}`)
  }

  // Each wt-setup prompt must contain a worktree path (rs-wt/gN pattern)
  for (const c of wtSetupCalls) {
    assert.ok(/rs-wt\/g\d/.test(c.prompt),
      `wt-setup prompt must contain the worktree path (rs-wt/gN); got: ${c.prompt.slice(0, 200)}`)
  }

  // Order: all wt-setup calls must precede any exec/assess (setup completes before work begins)
  const lastSetupIdx = Math.max(...wtSetupCalls.map(c => c.idx))
  assert.ok(lastSetupIdx < firstExecOrAssessIdx.val,
    `all wt-setup calls (last idx=${lastSetupIdx}) must precede first exec/assess call (idx=${firstExecOrAssessIdx.val})`)

  // ── sub-case B: worktreeSetupCommand absent → zero wt-setup calls ─────────
  const wtSetupCallsAbsent = []
  const dispatchWithoutSetup = dispatcher((c) => {
    // FIX.baseline has no worktreeSetupCommand
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
    if (isSh(c) && /wt-setup/.test(c.opts.label || '')) {
      wtSetupCallsAbsent.push(c)
    }
  })

  const { result: resultB } = await runEngine({ args: ARGS_PARALLEL, dispatch: dispatchWithoutSetup })
  assert.equal(resultB.error, undefined, `engine must not error without worktreeSetupCommand; got: "${resultB.error}"`)
  assert.equal(wtSetupCallsAbsent.length, 0,
    `wt-setup must NOT fire when worktreeSetupCommand is absent; got ${wtSetupCallsAbsent.length} calls`)
})

// Artifact-freshness canary (BACKLOG): the suite executes the BUILT artifact, so editing
// src/*.ts without rebuilding yields green against stale code. mtime guard with a clear
// remedy message; RS_SKIP_FRESHNESS=1 opts out (e.g. exotic checkout tools).
test('artifact freshness: recursive-slice.js is not older than src/*.ts', async () => {
  if (process.env.RS_SKIP_FRESHNESS) return
  const { statSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const base = join(dirname(fileURLToPath(import.meta.url)), '..')
  const artifact = statSync(join(base, 'recursive-slice.js')).mtimeMs
  for (const f of readdirSync(join(base, 'src')).filter((f) => f.endsWith('.ts'))) {
    const src = statSync(join(base, 'src', f)).mtimeMs
    assert.ok(artifact >= src,
      `src/${f} is newer than recursive-slice.js — rebuild: cd skills/slice && bash scripts/build-engine.sh`)
  }
})

// Model-access infra failure (observed live wf_01e123a1): the session model was not
// subagent-spawnable; VERIFY/INTEGRATE/BRIEFING inherit it and threw "issue with the selected
// model … may not have access". WITHOUT the halt-regex branch this fell through to distrust →
// 3 untrusted verify-class leaves → untrusted-streak HALT (infra misread as "approach failed",
// briefing lost). WITH it, the FIRST such error trips a resumable QUOTA HALT, not a grind.
test('model-access error on verify → resumable QUOTA HALT (not an untrusted-streak grind)', async () => {
  let tripped = -1
  const dispatch = dispatcher((c) => {
    if (/verify/.test(c.opts.label || '') && tripped === -1) {
      tripped = c.i
      throw new Error("There's an issue with the selected model (claude-fable-5). It may not exist or you may not have access to it. Run /model to pick a different model.")
    }
  })
  const { result, logs } = await runEngine({ args: ARGS, dispatch })
  assert.ok(tripped >= 0, 'the model-access throw fired')
  assert.ok(logs.some((l) => /QUOTA HALT/.test(l)), 'first model-access error trips a halt (not a 3-streak grind)')
  assert.ok(logs.some((l) => /model unavailable to subagents/.test(l)), 'halt reason names the model-inheritance cause')
  assert.ok((result.aborts || []).some((a) => /quota-halt:/.test(a)), 'aborts carries the resumable instruction')
  // must NOT have reached the "consecutive untrusted leaves" streak halt — that would mean it ground 3 leaves
  assert.ok(!(result.aborts || []).some((a) => /consecutive untrusted/.test(a)),
    `infra failure must not be misread as untrusted-streak; aborts=${JSON.stringify(result.aborts)}`)
})

// Parallel-by-default (engine disposition: parallelize the independent). Args with NO `parallel`
// field must enter the parallel partition; the downstream guards still auto-fall-back to sequential
// when unsafe (dirty tree / compile-bound / <2 independent groups).
test('parallel is the DEFAULT: args without a `parallel` field enter the parallel partition', async () => {
  const dispatch = dispatcher((c) => {
    if (c.opts.phase === 'Plan' && !isSh(c) && !has(c, /partition/)) return FIX.decomposeSlice
  })
  const { result, logs } = await runEngine({ args: ARGS_DEFAULT, dispatch })
  assert.equal(result.error, undefined, `default-args run must not error; got: "${result.error}"`)
  assert.ok(logs.some((l) => /parallel plan:/.test(l)),
    'args without `parallel` must default to the parallel partition (expected a "parallel plan:" log)')
})

// ITEM 1 (the BLOCKER): the SILENT tier-0 downgrade must be LOUD + auditable. When the per-leaf
// deterministic gate cannot run (no filterCommand, or an unsafe/multi-suite scope), the leaf used to
// fall through to the LLM verifier ALONE with NO log and NO record — the Lesson-3 silent trust-floor
// downgrade. Now: (a) the leaf is tagged gate='llm-only' and collected into the run-level
// `degradations` payload, and (b) a WARN naming the leaf appears in the logs. Drive a run whose
// baseline.filterCommand is EMPTY (so t0cmd is empty for every leaf) and a leaf is still trusted.
test('ITEM 1: empty filterCommand → trusted leaf runs gate=llm-only → degradations names it + WARN logged', async () => {
  // Two slices so the engine takes the slice path (sliced nodes carry a testScope); even WITH a scope,
  // an empty filterCommand makes t0cmd empty → the deterministic gate cannot run → llm-only downgrade.
  const twoSlices = {
    slices: [0, 1].map((i) => ({
      desc: `degradation slice ${i}`, interface: 'TBD',
      contract: `do thing ${i}`, independent: true,
      dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: `Scope${i}`,
    })),
  }
  // Baseline with EMPTY filterCommand — no per-leaf filtered tier-0 gate can be built.
  const noFilterBaseline = { ...FIX.baseline, filterCommand: '' }

  const dispatch = dispatcher((c) => {
    if (c.opts.phase === 'Baseline') return noFilterBaseline
    // ITEM 10: the root decompose returns action:'slice' WITH the 2 scoped children in the SAME call, so
    // the sliced nodes carry a testScope (the root node has none) — the merged decision is the cut.
    if (/decompose/.test(c.opts.label || '')) return { action: 'slice', reason: 'fixture: decompose', slices: twoSlices.slices }
  })

  const { result, logs } = await runEngine({ args: ARGS, dispatch })

  // Engine completed and at least one leaf was trusted (the leaf actually shipped on the LLM verifier alone).
  assert.equal(result.error, undefined, `engine errored: ${result.error}`)
  assert.ok(result.trustedLeaves >= 1, 'fixture precondition: at least one leaf trusted on the llm-only floor')

  // (3) The run-level `degradations` array must be present and NAME the degraded leaf.
  assert.ok(Array.isArray(result.degradations), 'payload must carry a `degradations` array')
  assert.ok(result.degradations.length >= 1,
    `degradations must record the llm-only leaf(s); got: ${JSON.stringify(result.degradations)}`)
  assert.ok(result.degradations.every((d) => /gate=llm-only/.test(d)),
    `every degradation entry must mark gate=llm-only; got: ${JSON.stringify(result.degradations)}`)
  assert.ok(result.degradations.some((d) => /degradation slice/.test(d)),
    `degradations must NAME the leaf (its task text); got: ${JSON.stringify(result.degradations)}`)

  // (2) A WARN naming the leaf and the llm-only reason must appear in the logs.
  assert.ok(
    logs.some((l) => /WARN: leaf \d+ .*gate=llm-only \(no filterCommand\/scope\)/.test(l)),
    `a WARN naming the leaf + 'gate=llm-only (no filterCommand/scope)' must be logged; got logs:\n${logs.join('\n')}`
  )
  // The trust rests-on-the-net phrasing must be present (auditable, not just a bare flag).
  assert.ok(
    logs.some((l) => /trust rests on the LLM verifier \+ the integrate net/.test(l)),
    `the WARN must explain trust now rests on the LLM verifier + the integrate net; got logs:\n${logs.join('\n')}`
  )

  // (1) The per-leaf gateLevel is recorded on the ledger entry (auditable per-leaf, not just run-level).
  assert.ok(result.results.some((r) => r.gateLevel === 'llm-only'),
    `each degraded leaf record must carry gateLevel='llm-only'; got: ${JSON.stringify(result.results.map((r) => r.gateLevel))}`)

  // CONTRAST (no-false-positive, same test to keep the suite at 32): the GREEN path (FIX.baseline's
  // 'true # {scope}' is a RUNNABLE template) must report NO degradation and tag the leaf
  // gate='deterministic-filtered' — the audit fires ONLY on the real downgrade, never on a healthy run.
  const healthyDispatch = dispatcher((c) => {
    // ITEM 10: force the slice path via the merged decompose decision (FIX.decomposeSlice carries the
    // FIX.slices3 cut); baseline → FIX.baseline with a runnable 'true # {scope}' filterCommand by default.
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
  })
  const healthy = await runEngine({ args: ARGS, dispatch: healthyDispatch })
  assert.equal(healthy.result.error, undefined, `healthy run errored: ${healthy.result.error}`)
  assert.deepEqual(healthy.result.degradations, [],
    `a healthy run with a runnable filterCommand must report NO degradations; got: ${JSON.stringify(healthy.result.degradations)}`)
  assert.ok(healthy.result.results.some((r) => r.gateLevel === 'deterministic-filtered'),
    `a leaf whose filtered t0 ran green must be gateLevel='deterministic-filtered'; got: ${JSON.stringify(healthy.result.results.map((r) => r.gateLevel))}`)
  assert.ok(!healthy.logs.some((l) => /WARN: leaf \d+ .*gate=llm-only/.test(l)),
    'a healthy run must emit NO llm-only WARN')
})

// ITEM 2 — single rollup verdict + owner headline + deterministic briefing persist.
// The payload exposed every trust signal SEPARATELY but no single verdict, so a catastrophic run could
// look perfect. Claims pinned here:
//   (a) the returned payload ALWAYS carries overallTrust:boolean + ownersHeadline:string — on a GREEN
//       run AND on a deliberately-failing (integration-distrust) run (the payload contract);
//   (b) a clean GREEN run computes overallTrust:true and the all-green headline ('N/M … 0 degradations');
//   (c) an integration-distrust run computes overallTrust:false and NAMES integration as the first failure
//       (a rollup can never manufacture a false green — it goes false on a dimension that already failed);
//   (d) the briefing is DETERMINISTICALLY persisted to docs/briefings/<ts>.md via the sh proxy (base64 →
//       base64 -d, injection-safe), and that write NEVER aborts the run even if it fails.
test('ITEM 2: payload always has overallTrust:boolean + ownersHeadline:string (green + failing); briefing persisted deterministically', async () => {
  // --- GREEN run: slice path → leaves carry testScope → deterministic-filtered gate → 0 degradations.
  const greenDispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
  })
  const green = await runEngine({ args: ARGS, dispatch: greenDispatch })

  // (a) payload contract — types present and correct on the GREEN run.
  assert.equal(green.result.error, undefined, `green run errored: ${green.result.error}`)
  assert.equal(typeof green.result.overallTrust, 'boolean',
    `green payload must carry overallTrust:boolean; got ${typeof green.result.overallTrust}`)
  assert.equal(typeof green.result.ownersHeadline, 'string',
    `green payload must carry ownersHeadline:string; got ${typeof green.result.ownersHeadline}`)
  assert.ok(green.result.ownersHeadline.length > 0, 'ownersHeadline must not be empty on a green run')

  // (b) a clean green run is TRUSTED and the headline reports the all-green dimensions.
  assert.equal(green.result.overallTrust, true,
    `a clean green run (all leaves trusted, full-suite GREEN, integration OK, 0 degradations) must be overallTrust:true; headline="${green.result.ownersHeadline}", degradations=${JSON.stringify(green.result.degradations)}`)
  assert.match(green.result.ownersHeadline, /leaves trusted/, 'headline must report the leaf trust count')
  assert.match(green.result.ownersHeadline, /full-suite GREEN/, 'green headline must report full-suite GREEN')
  assert.match(green.result.ownersHeadline, /integration OK/, 'green headline must report integration OK')
  assert.match(green.result.ownersHeadline, /0 degradations/, 'green headline must report 0 degradations')

  // (d) the briefing was persisted DETERMINISTICALLY via an sh write (NOT through an agent): a
  //     base64-decode write to docs/briefings/<ts>.md, labeled 'briefing-persist'.
  const persistCalls = green.calls.filter((c) => isSh(c) && /briefing-persist/.test(c.opts.label || ''))
  assert.equal(persistCalls.length, 1,
    `exactly one deterministic briefing-persist sh write must fire on a run with a briefing; got ${persistCalls.length}`)
  assert.match(persistCalls[0].prompt, /docs\/briefings\/.*\.md/,
    `the persist must target docs/briefings/<ts>.md; got: ${persistCalls[0].prompt}`)
  assert.match(persistCalls[0].prompt, /base64 -d/,
    `the persist must decode base64 (injection-safe, no raw briefing text in the shell command); got: ${persistCalls[0].prompt}`)
  // INJECTION-SAFETY: the literal 'fixture briefing' text must NEVER appear verbatim in the shell command.
  assert.ok(!/fixture briefing/.test(persistCalls[0].prompt),
    `briefing markdown must be base64-encoded, never injected verbatim into the shell command; got: ${persistCalls[0].prompt}`)
  assert.ok(green.logs.some((l) => /briefing persisted →/.test(l)),
    `a successful persist must log 'owner briefing persisted'; logs: ${green.logs.filter((l) => /briefing/.test(l)).join(' | ')}`)

  // --- FAILING run: integration verdict distrusts → catastrophe the rollup must catch.
  const failDispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
    if (/integration/.test(c.opts.label || '')) return FIX.distrust
  })
  const fail = await runEngine({ args: ARGS, dispatch: failDispatch })

  // (a) payload contract — types STILL present and correct on the failing run.
  assert.equal(fail.result.error, undefined, `failing run errored unexpectedly: ${fail.result.error}`)
  assert.equal(typeof fail.result.overallTrust, 'boolean',
    `failing payload must STILL carry overallTrust:boolean; got ${typeof fail.result.overallTrust}`)
  assert.equal(typeof fail.result.ownersHeadline, 'string',
    `failing payload must STILL carry ownersHeadline:string; got ${typeof fail.result.ownersHeadline}`)

  // (c) the rollup goes FALSE and names integration as the failing dimension (no false green).
  assert.equal(fail.result.overallTrust, false,
    `an integration-distrust run must be overallTrust:false (the leaves were trusted but the whole is not); headline="${fail.result.ownersHeadline}"`)
  assert.match(fail.result.ownersHeadline, /NOT TRUSTED/,
    `a failing headline must say NOT TRUSTED; got: "${fail.result.ownersHeadline}"`)
  assert.match(fail.result.ownersHeadline, /integration/i,
    `the failing headline must name integration as the (first) failing dimension; got: "${fail.result.ownersHeadline}"`)

  // The rollup is ADDITIVE: it never overrides a separate signal — integration is still distrusted in the
  // payload, the leaves are still individually trusted; overallTrust is strictly the AND of those.
  assert.equal(fail.result.integration && fail.result.integration.trustworthy, false,
    'integration signal stays separately distrusted (rollup did not mask it)')
  assert.equal(fail.result.trustedLeaves, fail.result.totalLeaves,
    'leaves are individually trusted — proving overallTrust:false came from the integration dimension, not the leaves')
})

// ITEM 6 (LATENCY): deterministic git is BATCHED into ONE sh() per logical phase, with a per-command
// EXIT MARKER so a failure in ANY sub-command is still detected exactly as before. These pins guard
// (1) the prologue collapses 5 serial spawns into one marker-protocol script carrying every decision
// sub-command, (2) the per-leaf reset+clean collapses into one marker-protocol script carrying both,
// (3) the marker shapes survive (git-sha/git-clean/lock-dir/lock-check all in ONE prompt), and (4) the
// new lock-write RACE-detection path aborts if a concurrent run grabs the lock between the two batches.
test('ITEM 6: prologue is ONE batched sh carrying every decision sub-command + its exit marker', async () => {
  const shCalls = []
  const dispatch = dispatcher((c) => { if (isSh(c)) shCalls.push(c) })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.equal(result.error, undefined, `green run must not error; got ${result.error}`)
  // The FIRST sh call is the batched prologue — one round-trip, not 5.
  const prologue = shCalls.find((c) => /prologue/.test(c.opts.label || ''))
  assert.ok(prologue, 'a batched prologue sh call must fire')
  assert.ok(isBatch(prologue.prompt), 'the prologue prompt must use the marker protocol (<<RS:NAME:%s>>)')
  // All four prologue decision sub-commands live in the ONE prompt (verbatim commands preserved)…
  for (const cmd of [/rev-parse HEAD/, /status --porcelain/, /rev-parse --absolute-git-dir/, /rs-lock/]) {
    assert.match(prologue.prompt, cmd, `prologue batch must contain the verbatim ${cmd} command`)
  }
  // …each followed by its OWN exit marker so per-command outcome detection survives.
  for (const name of ['git-sha', 'git-clean', 'lock-dir', 'lock-check']) {
    assert.ok(prologue.prompt.includes(`<<RS:${name}:%s>>`), `prologue batch must emit the ${name} exit marker`)
  }
  // There must NOT be SEPARATE standalone git-sha / git-clean / lock-dir / lock-check sh round-trips
  // (the whole point of the batch). The only other prologue-era single sh is the per-leaf head capture.
  const standaloneProbe = shCalls.filter((c) => !isBatch(c.prompt) &&
    (/status --porcelain/.test(c.prompt) || /rev-parse --absolute-git-dir/.test(c.prompt) ||
     (/rs-lock/.test(c.prompt) && /cat /.test(c.prompt))))
  assert.equal(standaloneProbe.length, 0,
    `prologue git probes must be batched, not standalone; stray: ${standaloneProbe.map((c) => c.opts.label).join(', ')}`)
})

test('ITEM 6: per-leaf reset+clean is ONE batched sh carrying both reset AND clean markers (no 2 spawns)', async () => {
  // Force a distrusted leaf so restore() runs; a real gitdir (shOver) + clean tree make cleanOK true.
  const resetBatches = []
  const standaloneResets = []
  const dispatch = dispatcher((c) => {
    if (isSh(c) && /reset --hard/.test(c.prompt)) (isBatch(c.prompt) ? resetBatches : standaloneResets).push(c)
    if (!isSh(c) && /verify/.test(c.opts.label || '') && !/integration/.test(c.opts.label || '')) return FIX.distrust
  }, { 'lock-dir': { out: '/tmp/rs-fixture/.git', code: 0 } })
  const { logs } = await runEngine({ args: ARGS, dispatch })
  assert.ok(resetBatches.length >= 1, 'a batched reset+clean sh call must fire on an untrusted leaf')
  assert.equal(standaloneResets.length, 0, 'reset must NOT be a standalone sh call (it is batched with clean)')
  const b = resetBatches[0]
  assert.ok(/reset --hard/.test(b.prompt) && /clean -fdq/.test(b.prompt),
    'the batch must carry BOTH the verbatim reset --hard AND clean -fdq commands')
  assert.ok(b.prompt.includes('<<RS:reset:%s>>') && b.prompt.includes('<<RS:clean:%s>>'),
    'the batch must emit BOTH the reset and clean exit markers (per-command outcome detection)')
  // The reset marker being parsed is what makes restore() report it ran — proven by the 'restored to' log.
  assert.ok(logs.some((l) => /restored to/.test(l)),
    `an untrusted leaf with a clean tree + real gitdir must log 'restored to'; got: ${logs.filter((l) => /restored|clean/.test(l)).join(' | ')}`)
})

test('ITEM 6: a RED in ONE batched sub-command is detected per-marker — lock-write failure stays fatal', async () => {
  // The lock-write batch (batch-2) writes the lock; a non-zero exit on JUST that sub-command (proxy alive,
  // command failed) must surface per-marker as a FATAL abort — NOT silently read as "lock held". This is
  // the marker protocol's core promise: per-command RED detection survives the batch.
  const execLabels = []
  const dispatch = dispatcher((c) => {
    if (!isSh(c) && /^exec:/.test(c.opts.label || '')) execLabels.push(c.opts.label)
  }, { 'lock-dir': { out: '/tmp/rs-fixture/.git', code: 0 }, 'lock-write': { out: '', code: 1 } })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(result.error, 'a non-zero lock-write sub-command exit must abort (result.error set)')
  assert.match(result.error, /lock.?write|shell.?proxy/i, `error must name lock-write; got "${result.error}"`)
  assert.equal(execLabels.length, 0, 'no leaf may execute when lock-write failed')
})

test('ITEM 6: lock-write RACE — a concurrent grab between the two batches aborts (tightened atomicity)', async () => {
  // The conditional lock-write re-tests `[ ! -s lockfile ]` inside its own shell. If a racing run grabbed
  // the lock between the read-batch and the write-batch, the file is non-empty → the engine's `else` branch
  // emits the RACE sentinel (NOT a numeric marker). JS detects it and aborts rather than clobbering.
  const execLabels = []
  const dispatch = dispatcher((c) => {
    if (!isSh(c) && /^exec:/.test(c.opts.label || '')) execLabels.push(c.opts.label)
  }, { 'lock-dir': { out: '/tmp/rs-fixture/.git', code: 0 }, 'lock-write': { race: true } })
  const { result } = await runEngine({ args: ARGS, dispatch })
  assert.ok(result.error, 'a lock-write race must abort (result.error set)')
  assert.match(result.error, /lock|concurrent|race/i, `error must name the lock race; got "${result.error}"`)
  assert.equal(execLabels.length, 0, 'no leaf may execute when a concurrent run grabbed the lock')
})

// ITEM 7 (observability/memory — PURE OBSERVATION, zero invariant risk). The engine auto-emits its own
// cost/verdict profile: ONE JSONL line per agent() call appended to docs/run-traces/<baseSha>.jsonl via the
// SAME deterministic, injection-safe sh proxy as ITEM 2's briefing-persist (base64 in JS → `base64 -d` →
// `>>` append). This is the per-leaf profile Lesson 8 needed a HUMAN to reconstruct from logs the engine
// never emitted. Claims pinned here:
//   (a) the run ATTEMPTS trace appends — labeled 'trace-append', targeting docs/run-traces/<baseSha>.jsonl,
//       INJECTION-SAFE (base64 → `base64 -d`), and `>>` APPENDING (not truncating);
//   (b) each appended payload is PARSEABLE JSONL carrying baseSha (the pinned baseline, no clock), and at
//       least one leaf line carries gateLevel (the ITEM-1 deterministic gate) + trustworthy (the verdict);
//   (c) a sh-FAILURE on the append (dead trace proxy) does NOT fail the run — the leaves stay trusted, the
//       payload is intact, no error: the observer is passive and its try/catch never aborts.
test('ITEM 7: run attempts injection-safe JSONL trace appends (gateLevel for a leaf parseable); an append sh-failure does NOT fail the run', async () => {
  // --- GREEN run: slice path → leaves carry testScope → deterministic-filtered gate (so a leaf line has
  //     a real gateLevel). Capture every trace-append sh call.
  const dispatch = dispatcher((c) => { if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice })
  const { result, calls, logs } = await runEngine({ args: ARGS, dispatch })
  assert.equal(result.error, undefined, `green run must not error; got ${result.error}`)

  // (a) the engine ATTEMPTS trace appends through the sh proxy, labeled 'trace-append'.
  const traceCalls = calls.filter((c) => isSh(c) && /trace-append/.test(c.opts.label || ''))
  assert.ok(traceCalls.length >= 2,
    `the run must attempt at least two trace appends (one exec + one leaf-verify per leaf); got ${traceCalls.length}`)
  for (const c of traceCalls) {
    // Each append targets docs/run-traces/<baseSha>.jsonl …
    assert.match(c.prompt, /docs\/run-traces\/[0-9a-f]+\.jsonl/,
      `each trace append must target docs/run-traces/<baseSha>.jsonl; got: ${c.prompt}`)
    // … decodes base64 (injection-safe: no raw role/label/model text in the shell command) …
    assert.match(c.prompt, /base64 -d/,
      `each trace append must decode base64 (injection-safe); got: ${c.prompt}`)
    // … and APPENDS (`>>`), never truncates (`>` alone would clobber prior lines).
    assert.match(c.prompt, />>\s*\S+\.jsonl/,
      `each trace append must APPEND (>>) to the jsonl file, not truncate; got: ${c.prompt}`)
    // INJECTION-SAFETY: the literal role-marker text must NEVER appear verbatim outside the base64 blob.
    const b64 = (c.prompt.match(/printf %s '([A-Za-z0-9+/=]+)'/) || [])[1]
    assert.ok(b64, `the append must carry a base64 blob (the JSON line); got: ${c.prompt}`)
    assert.ok(!/leaf-verify|"phase"|"baseSha"/.test(c.prompt.replace(b64, '')),
      `the JSON line must be base64-encoded, never injected verbatim into the shell command; got: ${c.prompt}`)
  }

  // (b) every appended payload is PARSEABLE JSONL; at least one LEAF line carries gateLevel + trustworthy.
  const records = traceCalls.map((c) => {
    const b64 = c.prompt.match(/printf %s '([A-Za-z0-9+/=]+)'/)[1]
    const decoded = Buffer.from(b64, 'base64').toString('utf8').trim()
    return JSON.parse(decoded)   // throws (failing the test) if the line is not valid JSON
  })
  assert.ok(records.every((r) => typeof r.baseSha === 'string' && r.baseSha.length > 0),
    `every trace line must carry the pinned baseSha (no clock in run context); got: ${JSON.stringify(records.map((r) => r.baseSha))}`)
  const leafWithGate = records.find((r) => typeof r.leafIndex === 'number' && r.gateLevel)
  assert.ok(leafWithGate,
    `at least one trace line must carry a leafIndex + gateLevel (the ITEM-1 deterministic gate); got: ${JSON.stringify(records)}`)
  assert.equal(leafWithGate.gateLevel, 'deterministic-filtered',
    `the leaf's gateLevel must be the real ITEM-1 gate, not a placeholder; got: ${leafWithGate.gateLevel}`)
  assert.equal(typeof leafWithGate.trustworthy, 'boolean',
    `a leaf-verify trace line must carry the trust verdict (trustworthy:boolean); got: ${typeof leafWithGate.trustworthy}`)

  // --- FAILURE run: the trace-append sh itself FAILS (dead trace proxy). The passive observer's try/catch
  //     must swallow it — the run stays green, every leaf stays trusted, no error surfaces.
  const failDispatch = dispatcher((c) => {
    if (/decompose/.test(c.opts.label || '')) return FIX.decomposeSlice
    if (isSh(c) && /trace-append/.test(c.opts.label || '')) throw new Error('trace proxy dead (fixture: append sh-failure)')
  })
  const failRun = await runEngine({ args: ARGS, dispatch: failDispatch })
  assert.equal(failRun.result.error, undefined,
    `a trace-append sh failure must NOT fail the run (pure observation); got error: ${failRun.result.error}`)
  assert.equal(failRun.result.trustedLeaves, failRun.result.totalLeaves,
    `all leaves must stay trusted despite the trace-append failure; got ${failRun.result.trustedLeaves}/${failRun.result.totalLeaves}`)
  assert.ok(failRun.result.trustedLeaves >= 1,
    `the run must still have produced trusted leaves (the observer failure was harmless); got ${failRun.result.trustedLeaves}`)
  assert.equal(failRun.result.overallTrust, true,
    `the run must remain overallTrust:true — a dead trace proxy is not a trust failure; headline="${failRun.result.ownersHeadline}"`)
})
