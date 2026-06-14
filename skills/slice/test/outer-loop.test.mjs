// Tests for the OUTER LOOP driver (scripts/outer-loop.mjs).
// Two contracts: (1) the tier CLASSIFIER buckets sample backlog lines correctly; (2) the DEFAULT
// invocation is a pure DRY RUN — it PRINTS a plan and dispatches NOTHING (no slice/git/network/fs
// side-effects). Run: node --test skills/slice/test/outer-loop.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pexec = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const DRIVER = join(HERE, '..', 'scripts', 'outer-loop.mjs')

const { classify, splitItems, plan, isDone, parseWorktreePorcelain } = await import('../scripts/outer-loop.mjs')

// ───────────────────────────────────────────────────────────────────────────────────────────────
// GIT FIXTURE — a throwaway repo on `main` with a couple of feature branches. Every git-touching
// subcommand resolves the repo from CWD, so each test runs the driver with `{ cwd: repo }` and the
// fixture is fully hermetic (its own object store, refs, and docs/). No network, no shared state.
// ───────────────────────────────────────────────────────────────────────────────────────────────
function g(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
// Build a fresh repo on `main` with a base commit and a docs/ dir; return its path.
async function makeRepo() {
  const repo = join(await mkdtemp(join(tmpdir(), 'outer-loop-git-')), 'repo')
  await mkdir(join(repo, 'docs'), { recursive: true })
  g(['init', '-q', '-b', 'main'], repo)
  g(['config', 'user.email', 'loop@test'], repo)
  g(['config', 'user.name', 'loop test'], repo)
  await writeFile(join(repo, 'file.txt'), 'base\n')
  g(['add', '-A'], repo)
  g(['commit', '-qm', 'base'], repo)
  return repo
}
// Create branch <name> off the current HEAD, apply a (path -> content) change, commit, return to main.
async function branchWithChange(repo, name, file, content) {
  g(['switch', '-qc', name], repo)
  await writeFile(join(repo, file), content)
  g(['add', '-A'], repo)
  g(['commit', '-qm', `${name} change`], repo)
  g(['switch', '-q', 'main'], repo)
}
// Run the driver inside <repo>; resolves like execFile (rejects on non-zero, err carries code/stdout/stderr).
function run(args, repo, env = {}) {
  return pexec('node', [DRIVER, ...args], { cwd: repo, env: { ...process.env, ...env } })
}

test('classifier: T2-slice for migrate / refactor-across / multi-leaf / decompose shapes', () => {
  assert.equal(classify('migrate the auth subsystem to OAuth').tier, 'T2-slice')
  assert.equal(classify('refactor across the app to remove the global store').tier, 'T2-slice')
  assert.equal(classify('split main.ts: unknown decomposition into phase modules').tier, 'T2-slice')
  assert.equal(classify('rewrite the multi-file scheduler with ≥2 risky leaves').tier, 'T2-slice')
})

test('classifier: T1-inline for a diagnosed single/known fix', () => {
  assert.equal(classify('add a fallback guard for exitCode===-2, single-line fix').tier, 'T1-inline')
  assert.equal(classify('diagnosed: one assertion missing in the scope check').tier, 'T1-inline')
  assert.equal(classify('add one field to the schema, already located the line').tier, 'T1-inline')
})

test('classifier: T0 for trivial cosmetic', () => {
  assert.equal(classify('docs: clarify the README install steps').tier, 'T0')
  assert.equal(classify('typo fix in the briefing header').tier, 'T0')
  assert.equal(classify('rename the helper for consistency').tier, 'T0')
})

test('classifier: ambiguous shape defaults to the SAFER harness (T2-slice), never inline', () => {
  const c = classify('improve robustness of the verify path somehow')
  assert.equal(c.tier, 'T2-slice')
  assert.match(c.reason, /ambiguous/)
})

test('splitItems: parses checklist lines, folds continuations, marks done, ends items at headings', () => {
  const md = [
    '# BACKLOG', '',
    '- [ ] open item one',
    '  continuation of one',
    '- [x] closed item two',
    '## section', '',
    '- [ ] open item three',
  ].join('\n')
  const items = splitItems(md)
  assert.equal(items.length, 3)
  assert.equal(items[0].done, false)
  assert.match(items[0].text, /open item one continuation of one/)
  assert.equal(items[1].done, true)
  assert.equal(items[2].text, 'open item three')
})

test('plan: skips DONE items; only open items become dispatch candidates', () => {
  const md = '- [x] migrate everything (done)\n- [ ] migrate the other thing'
  const entries = plan(md)
  assert.equal(entries.length, 1, 'closed item is not a candidate')
  assert.equal(entries[0].tier, 'T2-slice')
  assert.ok(entries[0].lane, 'a T2 entry carries a lane-spec')
  assert.match(entries[0].lane.isolation, /never merged/i)
})

test('default invocation is a DRY RUN: prints a plan, dispatches NOTHING (no fs/git side-effects)', async () => {
  // A scratch dir that is NOT a git repo and holds ONLY our backlog file. After the run we assert the
  // directory is unchanged (no docs/run-traces, no .git, no worktree) — i.e. the driver wrote nothing.
  const dir = await mkdtemp(join(tmpdir(), 'outer-loop-'))
  const backlog = join(dir, 'BACKLOG.md')
  await writeFile(backlog, '- [ ] migrate the database layer\n- [x] docs: tidy readme (done)\n')
  const before = (await readdir(dir)).sort()

  const { stdout, stderr } = await pexec('node', [DRIVER, backlog])

  assert.match(stdout, /DRY RUN/, 'announces dry run')
  assert.match(stdout, /dispatches NOTHING/i, 'states it dispatches nothing')
  assert.match(stdout, /open items: 1/, 'counted exactly the one OPEN item')
  assert.match(stdout, /T2-slice/, 'classified the migrate item as slice-worthy')
  assert.match(stdout, /WOULD dispatch .*gated merge only/i, 'plan is would-dispatch, gated-merge only')
  assert.match(stdout, /HARNESS drives the orchestration/i, 'points at the harness-orchestrated procedure')
  assert.equal(stderr, '', 'no errors on a clean dry run')

  const after = (await readdir(dir)).sort()
  assert.deepEqual(after, before, 'driver created NO files — pure dry run, zero side-effects')
})

test('bare --execute PRINTS the orchestration procedure and REFUSES to auto-run (no model, no fs writes)', async () => {
  // The settled design: `--execute` as a bare flag prints the harness-orchestrated procedure and
  // refuses to autonomously run slice/the grader. It must dispatch NOTHING and write NOTHING.
  const dir = await mkdtemp(join(tmpdir(), 'outer-loop-exec-'))
  const before = (await readdir(dir)).sort()

  const { stdout, stderr } = await pexec('node', [DRIVER, '--execute'], { cwd: dir })

  assert.match(stdout, /HARNESS-ORCHESTRATED/i, 'states it is harness-orchestrated, not autonomous')
  assert.match(stdout, /DETERMINISTIC PLUMBING/i, 'states the script is only plumbing')
  assert.match(stdout, /references\/outer-loop\.md/, 'points the operator at the procedure doc')
  assert.match(stdout, /OUTER_LOOP_SCHEDULED=1/, 'mentions the scheduled branch-only guard')
  assert.match(stdout, /synthesized[\s\S]*NEVER auto-merges/i, 'states synthesized specs never auto-merge')
  assert.equal(stderr, '', 'no error output')
  assert.deepEqual((await readdir(dir)).sort(), before, 'execute-refuse wrote nothing')
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// EXECUTE PLUMBING — the deterministic git/fs subcommands, exercised against a real git fixture.
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test('worktree: creates .loop/<slug> on loop/<slug> off main; fails clearly on a duplicate branch', async () => {
  const repo = await makeRepo()
  const { stdout } = await run(['worktree', 'feat-a'], repo)
  assert.match(stdout.trim(), /\.loop\/feat-a$/, 'prints the new worktree path')
  assert.ok(existsSync(join(repo, '.loop', 'feat-a')), 'the worktree directory exists')
  const wts = g(['worktree', 'list'], repo)
  assert.match(wts, /\[loop\/feat-a\]/, 'a worktree on branch loop/feat-a is registered')
  // Duplicate slug -> the branch already exists -> clear non-zero failure, no clobber.
  await assert.rejects(run(['worktree', 'feat-a'], repo), (err) => {
    assert.notEqual(err.code, 0, 'duplicate exits non-zero')
    assert.match(err.stderr, /already exists/i, 'explains the branch already exists')
    return true
  })
})

test('gated-merge ABORTS on a CONFLICTING branch — main left byte-for-byte unchanged', async () => {
  const repo = await makeRepo()
  // branch edits file.txt; main then edits the SAME line -> a real merge conflict.
  await branchWithChange(repo, 'loop/conflict', 'file.txt', 'branch version\n')
  await writeFile(join(repo, 'file.txt'), 'main version\n')
  g(['add', '-A'], repo); g(['commit', '-qm', 'main edit'], repo)
  const mainBefore = g(['rev-parse', 'main'], repo)

  await assert.rejects(run(['gated-merge', 'loop/conflict'], repo, { OUTER_LOOP_GATE_CMD: 'true' }), (err) => {
    assert.notEqual(err.code, 0, 'conflict aborts non-zero')
    assert.match(err.stderr, /conflict, left as branch/i, 'reports conflict + left as branch')
    return true
  })
  assert.equal(g(['rev-parse', 'main'], repo), mainBefore, 'main HEAD is unchanged after the abort')
  assert.equal(g(['status', '--porcelain'], repo), '', 'working tree is clean (merge --abort ran)')
})

test('gated-merge ABORTS + REVERTS when the post-merge gate goes RED — main unchanged', async () => {
  const repo = await makeRepo()
  // A branch that merges cleanly (a new, non-conflicting file) but whose merge makes the gate red.
  await branchWithChange(repo, 'loop/red', 'newfile.txt', 'adds a file\n')
  const mainBefore = g(['rev-parse', 'main'], repo)

  await assert.rejects(run(['gated-merge', 'loop/red'], repo, { OUTER_LOOP_GATE_CMD: 'exit 1' }), (err) => {
    assert.notEqual(err.code, 0, 'a red post-merge gate aborts non-zero')
    assert.match(err.stderr, /post-merge red, reverted, left as branch/i, 'reports revert + left as branch')
    return true
  })
  assert.equal(g(['rev-parse', 'main'], repo), mainBefore, 'main HEAD is reset to the pre-merge tip')
  assert.ok(!existsSync(join(repo, 'newfile.txt')), 'the merged file is gone (reset --hard undid it)')
  assert.equal(g(['status', '--porcelain'], repo), '', 'working tree is clean after the revert')
})

test('gated-merge REFUSES under OUTER_LOOP_SCHEDULED=1 (branch-only) — main untouched, no merge attempted', async () => {
  const repo = await makeRepo()
  await branchWithChange(repo, 'loop/clean', 'newfile.txt', 'clean change\n')
  const mainBefore = g(['rev-parse', 'main'], repo)

  await assert.rejects(run(['gated-merge', 'loop/clean'], repo, { OUTER_LOOP_SCHEDULED: '1', OUTER_LOOP_GATE_CMD: 'true' }), (err) => {
    assert.notEqual(err.code, 0, 'scheduled run refuses non-zero')
    assert.match(err.stderr, /scheduled runs are branch-only/i, 'cites the branch-only rule')
    return true
  })
  assert.equal(g(['rev-parse', 'main'], repo), mainBefore, 'main is untouched — no merge was even attempted')
})

test('gated-merge MERGES a CLEAN + GREEN branch (no-ff) — reports the merge sha, main advances', async () => {
  const repo = await makeRepo()
  await branchWithChange(repo, 'loop/clean', 'newfile.txt', 'clean change\n')
  const mainBefore = g(['rev-parse', 'main'], repo)

  const { stdout } = await run(['gated-merge', 'loop/clean'], repo, { OUTER_LOOP_GATE_CMD: 'true' })
  assert.match(stdout, /^merged [0-9a-f]{40}/m, 'reports merged <sha>')
  assert.notEqual(g(['rev-parse', 'main'], repo), mainBefore, 'main HEAD advanced past the merge')
  // --no-ff means a dedicated merge commit (two parents).
  assert.match(g(['log', '-1', '--pretty=%P', 'main'], repo), /\S+\s+\S+/, 'the tip is a 2-parent merge commit (--no-ff)')
  assert.ok(existsSync(join(repo, 'newfile.txt')), 'the branch change is now on main')
})

test('gated-merge REFUSES off a non-main / dirty checkout — never touches main', async () => {
  const repo = await makeRepo()
  await branchWithChange(repo, 'loop/clean', 'newfile.txt', 'clean change\n')
  // not on main: switch to the feature branch and try to merge -> refuse.
  g(['switch', '-q', 'loop/clean'], repo)
  await assert.rejects(run(['gated-merge', 'loop/clean'], repo, { OUTER_LOOP_GATE_CMD: 'true' }), (err) => {
    assert.match(err.stderr, /not on main/i, 'refuses when HEAD is not main')
    return true
  })
  // dirty main: go back to main, dirty the tree, try -> refuse.
  g(['switch', '-q', 'main'], repo)
  await writeFile(join(repo, 'file.txt'), 'dirty\n')
  const mainBefore = g(['rev-parse', 'main'], repo)
  await assert.rejects(run(['gated-merge', 'loop/clean'], repo, { OUTER_LOOP_GATE_CMD: 'true' }), (err) => {
    assert.match(err.stderr, /not clean/i, 'refuses when the tree is dirty')
    return true
  })
  assert.equal(g(['rev-parse', 'main'], repo), mainBefore, 'main HEAD unchanged across both refusals')
})

test('ledger: records a line to docs/loop-status.jsonl (caller timestamp, no clock) and resume skips done', async () => {
  const repo = await makeRepo()
  // append two lines for the same item: dispatched (non-terminal) then merged (terminal).
  await run(['ledger', 'item-7', 'dispatched', '{"branch":"loop/feat-a","ts":"2026-06-14T00:00:00Z"}'], repo)
  // before terminal: NOT-DONE (resume would re-attempt it).
  let q = await run(['ledger', '--done?', 'item-7'], repo)
  assert.equal(q.stdout.trim(), 'NOT-DONE', 'a dispatched-but-not-landed item is NOT done')

  await run(['ledger', 'item-7', 'merged', '{"sha":"deadbeef"}'], repo)
  q = await run(['ledger', '--done?', 'item-7'], repo)
  assert.equal(q.stdout.trim(), 'DONE', 'after a terminal merged status the item is DONE (resume skips it)')
  // an unseen item is NOT-DONE.
  q = await run(['ledger', '--done?', 'never-seen'], repo)
  assert.equal(q.stdout.trim(), 'NOT-DONE', 'an item with no ledger line is NOT done')

  // the file is real JSONL with the caller-supplied ts and NO injected clock field.
  const body = await readFile(join(repo, 'docs', 'loop-status.jsonl'), 'utf8')
  const lines = body.trim().split('\n').map((l) => JSON.parse(l))
  assert.equal(lines.length, 2, 'two ledger lines were appended')
  assert.equal(lines[0].itemId, 'item-7')
  assert.equal(lines[0].ts, '2026-06-14T00:00:00Z', 'the timestamp is the caller-supplied arg')
  assert.equal(lines[1].status, 'merged')
  // the exported isDone() agrees with the CLI (last-write-wins on terminal status).
  assert.equal(isDone(lines, 'item-7'), true)
  assert.equal(isDone(lines, 'never-seen'), false)
})

test('ledger: a non-terminal status after a terminal one flips DONE back to NOT-DONE (last-write-wins)', async () => {
  const repo = await makeRepo()
  await run(['ledger', 'item-9', 'merged'], repo)
  assert.equal((await run(['ledger', '--done?', 'item-9'], repo)).stdout.trim(), 'DONE')
  // a re-open (e.g. the merge was reverted) appended later wins.
  await run(['ledger', 'item-9', 'reopened'], repo)
  assert.equal((await run(['ledger', '--done?', 'item-9'], repo)).stdout.trim(), 'NOT-DONE', 'last status wins')
})

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// assert-isolated — PROVE a dispatched run stayed in its worktree and did NOT leak onto the main
// clone. The fixture reproduces the REAL layout: the engine source lives in a SUBDIR (skills/slice)
// of the checkout, and a LINKED worktree on a loop/<slug> branch is where the lane is supposed to
// commit. We exercise BOTH directions non-vacuously: a commit on the MAIN worktree's branch is a LEAK
// (exit non-zero); commits ONLY on the linked worktree's branch are ISOLATED (exit 0, main unchanged).
// ═════════════════════════════════════════════════════════════════════════════════════════════════

// A main worktree whose engine source sits in skills/slice/, plus a linked worktree on loop/<slug>.
// Returns { main, link, workSubdir, sha0 } where workSubdir is the linked worktree's skills/slice dir
// (the EXACT work subdir a correct dispatch passes as `repo`) and sha0 is main's HEAD at setup time.
async function makeWorktreePair(slug = 'lane') {
  const main = join(await mkdtemp(join(tmpdir(), 'assert-iso-')), 'main')
  await mkdir(join(main, 'skills', 'slice'), { recursive: true })
  g(['init', '-q', '-b', 'main'], main)
  g(['config', 'user.email', 'loop@test'], main)
  g(['config', 'user.name', 'loop test'], main)
  await writeFile(join(main, 'skills', 'slice', 'engine.txt'), 'base\n')
  g(['add', '-A'], main)
  g(['commit', '-qm', 'base'], main)
  const sha0 = g(['rev-parse', 'main'], main)
  const link = join(main, '..', `link-${slug}`)
  g(['worktree', 'add', '-q', link, '-b', `loop/${slug}`, 'main'], main)
  return { main, link, workSubdir: join(link, 'skills', 'slice'), sha0 }
}
// Add a commit to <repo>'s currently-checked-out branch that edits the engine source.
async function commitChange(repo, content, msg) {
  await writeFile(join(repo, 'skills', 'slice', 'engine.txt'), content)
  g(['add', '-A'], repo)
  g(['commit', '-qm', msg], repo)
}

test('parseWorktreePorcelain: parses path/HEAD/branch records and detached entries', () => {
  const text = [
    'worktree /repo/main', 'HEAD aaaa', 'branch refs/heads/main', '',
    'worktree /repo/link', 'HEAD bbbb', 'branch refs/heads/loop/x', '',
    'worktree /repo/det', 'HEAD cccc', 'detached', '',
  ].join('\n')
  const recs = parseWorktreePorcelain(text)
  assert.equal(recs.length, 3)
  assert.deepEqual(recs[0], { path: '/repo/main', head: 'aaaa', branch: 'main', detached: false })
  assert.equal(recs[1].branch, 'loop/x', 'short branch name (refs/heads/ stripped)')
  assert.equal(recs[2].detached, true)
  assert.equal(recs[2].branch, null, 'a detached worktree carries no branch')
})

test('assert-isolated: ISOLATED (exit 0) when commits land ONLY on the linked worktree branch — main unchanged', async () => {
  const { main, link, workSubdir, sha0 } = await makeWorktreePair('good')
  // The lane commits TWICE in the linked worktree's work subdir — main is never touched.
  await commitChange(link, 'lane work 1\n', 'lane 1')
  await commitChange(link, 'lane work 2\n', 'lane 2')

  const { stdout } = await run(['assert-isolated', workSubdir, sha0], main)
  assert.match(stdout, /isolated: 2 commits on loop\/good, main clone unchanged/, 'reports isolated with the advance count + branch')
  assert.equal(g(['rev-parse', 'main'], main), sha0, 'main HEAD is exactly where it started')
})

test('assert-isolated: LEAK (exit non-zero) when a commit lands on the MAIN worktree branch', async () => {
  const { main, link, workSubdir, sha0 } = await makeWorktreePair('leak')
  // The lane DID advance its own branch (so the only failing assertion is the main-moved leak).
  await commitChange(link, 'lane work\n', 'lane')
  // THE BUG: a commit lands on MAIN's branch instead of the worktree — the leak we must catch.
  await commitChange(main, 'leaked onto main\n', 'LEAK onto main')

  await assert.rejects(run(['assert-isolated', workSubdir, sha0], main), (err) => {
    assert.notEqual(err.code, 0, 'a leak exits non-zero')
    assert.match(err.stderr, /LEAK: main clone moved [0-9a-f]+\.\.[0-9a-f]+ — the run committed to main, NOT the worktree/, 'the loud LEAK line names the sha range')
    return true
  })
})

test('assert-isolated: LEAK (exit non-zero) when an UNCOMMITTED change sits in the main checkout', async () => {
  const { main, link, workSubdir, sha0 } = await makeWorktreePair('dirty')
  await commitChange(link, 'lane work\n', 'lane') // branch advanced legitimately
  // A write that landed in the MAIN checkout (not the worktree) but was never committed — still a leak.
  await writeFile(join(main, 'skills', 'slice', 'engine.txt'), 'dirtied main checkout\n')

  await assert.rejects(run(['assert-isolated', workSubdir, sha0], main), (err) => {
    assert.notEqual(err.code, 0, 'a dirty main checkout exits non-zero')
    assert.match(err.stderr, /LEAK: main clone .* has an UNCOMMITTED change/, 'reports the uncommitted leak')
    return true
  })
  assert.equal(g(['rev-parse', 'main'], main), sha0, 'main HEAD itself is unchanged (the leak is uncommitted)')
})

test('assert-isolated: LEAK (exit non-zero) when the work-dir branch produced NO commit (did not advance)', async () => {
  const { main, workSubdir, sha0 } = await makeWorktreePair('noadvance')
  // Nobody committed anywhere: main is unchanged AND the lane branch is still at sha0 -> not isolated,
  // because a dispatched run that produced no commit in the worktree likely committed nothing useful
  // (or committed elsewhere). Proving isolation REQUIRES the branch to have advanced.
  await assert.rejects(run(['assert-isolated', workSubdir, sha0], main), (err) => {
    assert.notEqual(err.code, 0, 'a non-advanced branch exits non-zero')
    assert.match(err.stderr, /produced NO commit in the worktree/, 'explains the branch did not advance')
    return true
  })
})

test('assert-isolated: LEAK (exit non-zero) when the work-dir IS the main worktree (the exact bug shape)', async () => {
  // Reproduce the original bug: `repo` resolved to the MAIN clone (the work-dir IS the main worktree).
  const main = join(await mkdtemp(join(tmpdir(), 'assert-iso-bug-')), 'main')
  await mkdir(join(main, 'skills', 'slice'), { recursive: true })
  g(['init', '-q', '-b', 'main'], main)
  g(['config', 'user.email', 'loop@test'], main)
  g(['config', 'user.name', 'loop test'], main)
  await writeFile(join(main, 'skills', 'slice', 'engine.txt'), 'base\n')
  g(['add', '-A'], main); g(['commit', '-qm', 'base'], main)
  const sha0 = g(['rev-parse', 'main'], main)

  await assert.rejects(run(['assert-isolated', join(main, 'skills', 'slice'), sha0], main), (err) => {
    assert.notEqual(err.code, 0, 'targeting main itself exits non-zero')
    assert.match(err.stderr, /work-dir .* IS the main worktree/i, 'names the isolation bug')
    return true
  })
})

test('assert-isolated: usage error (exit 2) without both args', async () => {
  const { main, workSubdir } = await makeWorktreePair('args')
  await assert.rejects(run(['assert-isolated', workSubdir], main), (err) => {
    assert.equal(err.code, 2, 'missing expected-main-sha is a usage error')
    assert.match(err.stderr, /usage: .*assert-isolated/, 'prints usage')
    return true
  })
})
