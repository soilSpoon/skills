// Regression guard: a SHARED COMPILE CACHE (Xcode CAS / ccache / sccache / Bazel) decouples "expensive
// build" from "worktrees must serialize on ONE shared build dir". The engine used to force a shared
// scratch dir for ANY compile-bound repo (serializing builds on its lock) — wrong when a content-addressed
// cache already de-dupes compilation across checkouts. When baseline.sharedCompileCache is true the engine
// must (a) NOT auto-enable the shared-scratch dir, and (b) still allow parallel for a compile-bound repo
// (worktrees build concurrently in their own dirs, sharing the cache). Probe-confirmed: concurrent
// shared-CAS builds run clean (exit 0, no corruption) and don't CPU-thrash once warm (compile → cache
// hits). These string guards stop the decoupling from silently regressing in the inline Plan decision.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const main = readFileSync(join(SRC, 'main.ts'), 'utf8')
const types = readFileSync(join(SRC, 'types.ts'), 'utf8')
const schemas = readFileSync(join(SRC, 'schemas.ts'), 'utf8')
const prompts = readFileSync(join(SRC, 'prompts.ts'), 'utf8')

test('sharedCompileCache disables the forced shared-scratch DIR (no build serialization when a cache exists)', () => {
  assert.match(main, /const sharedCache = baseline\.sharedCompileCache === true/)
  const line = main.split('\n').find((l) => l.includes('autoSharedScratch =') && l.includes('coldBuildCost'))
  assert.ok(line && line.includes('!sharedCache'),
    'autoSharedScratch must be gated on !sharedCache so a shared cache skips the serialized shared dir')
})

test('a shared compile cache LIFTS the compile-bound parallel block (parallel stays enabled)', () => {
  const line = main.split('\n').find((l) => l.includes('const goParallel ='))
  assert.ok(line && line.includes('sharedCache'),
    'goParallel must let a compile-bound repo parallelize when a shared compile cache is present')
})

test('the sharedCompileCache signal is surfaced in the baseline type, schema, and baseliner prompt', () => {
  assert.match(types, /sharedCompileCache\?: boolean/)
  assert.match(schemas, /sharedCompileCache: \{ type: 'boolean' \}/)
  assert.match(prompts, /SHARED COMPILE CACHE/)
})
