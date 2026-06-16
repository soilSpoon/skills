// Architecture fitness test — the module-boundary PRINCIPLE, ENFORCED instead of agonized.
// The engine's src is a strict layered DAG; imports must flow STRICTLY DOWNWARD. This test turns
// "should this be its own module / can it import that?" from a per-case judgment into a checked
// invariant: a phase that reaches sideways (sibling phase) or up (main), or a "pure leaf" that grows
// a dependency, fails HERE — loudly, at the boundary — so the structure can't silently erode.
//
// LAYERS (a file may import ONLY from a strictly lower layer):
//   L0  pure leaves — types/util/prompts/schemas/leaf-prompt (no relative imports at all)
//   L1  host        — the I/O layer (agentSafe + sh proxies); imports L0 only
//   L2  phases      — verify/leaf-loop/integrate, each a cohesive trust/logic unit; import L0+L1,
//                     NEVER a sibling phase (they are wired together via deps in main, not by import)
//   L3  main        — the orchestrator spine; imports everything below; imported by NOTHING
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { posix, dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const LAYER = {
  'types.ts': 0, 'util.ts': 0, 'prompts.ts': 0, 'schemas.ts': 0, 'leaf-prompt.ts': 0,
  'host.ts': 1, 'runtime.ts': 1,
  'phases/verify.ts': 2, 'phases/leaf-loop.ts': 2, 'phases/integrate.ts': 2,
  'main.ts': 3,
}

// every .ts under src (recursively), as keys relative to src/
function srcFiles(dir = SRC, base = '') {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? srcFiles(join(dir, e.name), posix.join(base, e.name))
    : e.name.endsWith('.ts') ? [posix.join(base, e.name)] : [])
}
const relImports = (key) => [...readFileSync(join(SRC, key), 'utf8').matchAll(/from\s+'(\.[^']+)'/g)]
  .map((m) => posix.normalize(posix.join(posix.dirname(key), m[1])) + '.ts')

test('every src/*.ts is classified into a layer (a new unclassified file fails — forces the decision)', () => {
  for (const f of srcFiles()) assert.ok(f in LAYER, `unclassified src file: ${f} — assign it a layer in this test`)
})

test('imports flow STRICTLY downward — no phase→sibling-phase, no →main, no cycle', () => {
  for (const f of srcFiles()) {
    for (const dep of relImports(f)) {
      assert.ok(dep in LAYER, `${f} imports unknown module ${dep}`)
      assert.ok(LAYER[dep] < LAYER[f], `LAYER VIOLATION: ${f} (L${LAYER[f]}) imports ${dep} (L${LAYER[dep]}) — imports must go strictly DOWN`)
    }
  }
})

test('the pure leaves (L0) import nothing relative — they stay pure', () => {
  for (const f of srcFiles()) if (LAYER[f] === 0) assert.deepEqual(relImports(f), [], `${f} is an L0 pure leaf but imports ${relImports(f)}`)
})

test('main.ts is the spine — imported by NO other module', () => {
  for (const f of srcFiles()) if (f !== 'main.ts')
    assert.ok(!relImports(f).includes('main.ts'), `${f} imports main.ts — the orchestrator must be a sink, not a dependency`)
})

test('phases are leaves of the logic layer — no phase imports another phase (they compose via deps, not imports)', () => {
  for (const f of srcFiles()) if (f.startsWith('phases/'))
    for (const dep of relImports(f)) assert.ok(!dep.startsWith('phases/'), `${f} imports sibling phase ${dep} — phases compose through main's dep-wiring, never directly`)
})

// The Workflow ambient globals (agent/parallel/phase/log/budget/args) are the PORT to one harness. They
// live in EXACTLY ONE adapter (runtime.ts); the engine core depends on the injected Runtime type instead.
// This test fails if any other file re-grows a `declare`d global — so a second host (opencode) can't be
// undercut by the core quietly re-coupling to Claude Code's runtime.
test('the ambient-global PORT lives ONLY in runtime.ts — no core file re-grows the seam', () => {
  const AMBIENT = /\bdeclare\s+(?:function\s+(?:agent|parallel|phase|log)\b|const\s+(?:budget|args)\b)/
  for (const f of srcFiles()) {
    if (f === 'runtime.ts') continue
    assert.ok(!AMBIENT.test(readFileSync(join(SRC, f), 'utf8')),
      `${f} declares a Workflow ambient global — the core must depend on the injected Runtime, not globals. Route it through runtime.ts.`)
  }
})

// AgentOutcome<T> is the discriminated union that every agentSafe call site depends on. It belongs in
// types.ts (L0: pure, no relative imports) so BOTH host.ts (L1) and all phases (L2) can import it
// without a layer violation. Moving it to host.ts (L1) would block phases from importing it directly
// (phase→L1 is a sideways import for the type), and moving it to a phase (L2) would block host.ts
// from using it at all. This test pins that invariant — if the file changes, the failure is explicit.
test('AgentOutcome<T> is defined in types.ts (L0) — the discriminated union boundary the whole stack imports', () => {
  const typesContent = readFileSync(join(SRC, 'types.ts'), 'utf8')
  // Export must be present (the type definition, not just a comment about it)
  assert.ok(/export\s+type\s+AgentOutcome/.test(typesContent),
    'types.ts must export AgentOutcome<T> — moving it to a higher layer breaks host.ts import or phase imports')
  // No other L0/L1/L2 file may RE-export or re-define AgentOutcome (it should have exactly one home)
  for (const f of srcFiles()) {
    if (f === 'types.ts') continue
    const content = readFileSync(join(SRC, f), 'utf8')
    assert.ok(!/export\s+type\s+AgentOutcome/.test(content),
      `${f} re-exports or re-defines AgentOutcome — it must live ONLY in types.ts (L0)`)
  }
})

// classifyFailure maps caught API errors to quota-halt kinds. It belongs in util.ts (L0) so host.ts
// (L1) can import it without a layer violation and unit tests (util.test.mjs) can test it in isolation.
// Promoting it to host.ts (L1) removes direct testability; promoting it to a phase (L2) blocks host.ts
// from using it. This test pins the home — a future "clean-up" that inlines it into host.ts is a trap.
test('classifyFailure is exported from util.ts (L0) — the failure-classifier boundary', () => {
  const utilContent = readFileSync(join(SRC, 'util.ts'), 'utf8')
  assert.ok(/export\s+const\s+classifyFailure/.test(utilContent),
    'util.ts must export classifyFailure — it is the L0 failure-classifier that host.ts (L1) imports')
  // It must not be defined at L2 or above (would block host.ts from importing it)
  for (const f of srcFiles()) {
    if (f === 'util.ts') continue
    const content = readFileSync(join(SRC, f), 'utf8')
    assert.ok(!/export\s+const\s+classifyFailure/.test(content),
      `${f} also exports classifyFailure — the classifier must live only in util.ts (L0), not in ${f}`)
  }
})
