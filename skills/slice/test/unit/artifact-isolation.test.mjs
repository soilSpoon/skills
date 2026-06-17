// Regression guard: the engine must ISOLATE its own artifacts (run-traces, briefings, scratch/worktree
// dirs) from the user's git state — on two axes:
//   (1) they must not DIRTY the clean-check that gates parallel. A prior run's untracked trace once made
//       `git status --porcelain` non-empty → gitClean=false → parallel was silently demoted to sequential
//       (the engine sabotaging its own parallelism via its own observability output).
//   (2) they must not be SWEPT INTO A USER COMMIT by an agent's `git add -A` (the GIT_EXEC guidance) —
//       which is how a trace once became tracked (`D docs/run-traces/<sha>.jsonl` drift on the next run).
// These string-level guards fail loudly if either isolation is ever removed from src, so the fix cannot
// silently erode. (The behavioural effect — clean-modulo-artifacts → goParallel honored — is exercised
// live; this is the cheap structural canary, in the spirit of architecture.test.mjs.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const main = readFileSync(join(SRC, 'main.ts'), 'utf8')
const integrate = readFileSync(join(SRC, 'phases', 'integrate.ts'), 'utf8')

test('gitClean probe EXCLUDES engine artifact paths (a prior run\'s trace must not demote parallel→sequential)', () => {
  const probeLine = main.split('\n').find(l => l.includes('status --porcelain') && l.includes('git-clean'))
  assert.ok(probeLine, 'the git-clean segment of the prologue probe must be present')
  for (const p of ['docs/run-traces', 'docs/briefings']) {
    assert.ok(probeLine.includes(`:(exclude)${p}`), `gitClean probe must exclude '${p}' so the engine's own output is not read as user dirt`)
  }
})

test('trace + briefing writes SELF-IGNORE their dir (so `git add -A` cannot commit engine output)', () => {
  assert.ok(main.includes('docs/run-traces/.gitignore'),
    'the trace-append must drop a self-ignoring .gitignore in docs/run-traces')
  assert.ok(integrate.includes('${dir}/.gitignore'),
    'the briefing-persist must drop a self-ignoring .gitignore in docs/briefings')
})
