// Tests for the OUTER LOOP driver (scripts/outer-loop.mjs).
// Two contracts: (1) the tier CLASSIFIER buckets sample backlog lines correctly; (2) the DEFAULT
// invocation is a pure DRY RUN — it PRINTS a plan and dispatches NOTHING (no slice/git/network/fs
// side-effects). Run: node --test skills/slice/test/outer-loop.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const pexec = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const DRIVER = join(HERE, '..', 'scripts', 'outer-loop.mjs')

const { classify, splitItems, plan } = await import('../scripts/outer-loop.mjs')

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
  assert.match(stdout, /WOULD dispatch .*never merged/i, 'plan is would-dispatch, never-merge')
  assert.match(stdout, /--execute .*NOT implemented/i, 'documents execute is out of scope')
  assert.equal(stderr, '', 'no errors on a clean dry run')

  const after = (await readdir(dir)).sort()
  assert.deepEqual(after, before, 'driver created NO files — pure dry run, zero side-effects')
})

test('--execute is refused (dispatch-only by design — exits non-zero, writes nothing)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'outer-loop-exec-'))
  const backlog = join(dir, 'BACKLOG.md')
  await writeFile(backlog, '- [ ] migrate something\n')
  const before = (await readdir(dir)).sort()

  await assert.rejects(
    pexec('node', [DRIVER, '--execute', backlog]),
    (err) => {
      assert.equal(err.code, 2, '--execute exits with code 2')
      assert.match(err.stderr, /not implemented/i)
      return true
    },
  )
  assert.deepEqual((await readdir(dir)).sort(), before, '--execute refusal wrote nothing')
})
