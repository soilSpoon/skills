// Fixture host for the recursive-slice engine artifact.
// The engine is a PORT: it only touches the world through ambient `agent/log/phase/budget/args`
// (even shell runs go through agent() — the SH proxy). So the WHOLE engine runs here with a
// scripted dispatcher and zero filesystem/git: every decision path is testable in-process.
// Run: node --test skills/slice/test/scenarios.test.mjs  (passing the DIR fails on Node 22 — MODULE_NOT_FOUND)
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const ARTIFACT = join(dirname(fileURLToPath(import.meta.url)), '..', 'recursive-slice.js')

export async function runEngine({ args, dispatch }) {
  let src = await readFile(ARTIFACT, 'utf8')
  // `export const meta` is the ONLY export in the artifact (the build asserts this) — neutralize that one
  // token exactly as the runtime does; everything else is byte-identical. The harness stays FAITHFUL to
  // the runtime, never more lenient: a stray export would fail the build, not be silently stripped here.
  src = src.replace(/^export const meta/m, 'const meta')
  const logs = []
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const call = { prompt, opts, i: calls.length }
    calls.push(call)
    return dispatch(call, { calls, logs })
  }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const fn = new AsyncFunction('agent', 'log', 'phase', 'budget', 'args', 'pipeline', 'parallel', 'workflow', src)
  const result = await fn(
    agent,
    (m) => logs.push(String(m)),
    () => {},
    budget,
    args,
    async () => { throw new Error('pipeline unused by engine') },
    async (thunks) => Promise.all(thunks.map((t) => t().catch(() => null))),
    async () => { throw new Error('nested workflow unused by engine') },
  )
  return { result, logs, calls }
}

// ---- role detection (label/schema shapes the engine actually uses) ----------
export const isSh = (c) => {
  const r = c.opts.schema && c.opts.schema.required
  return Array.isArray(r) && r.length === 1 && r[0] === 'exitCode'
}
export const has = (c, re) => re.test(c.opts.label || '')

// ---- canned role outputs (schema-complete) -----------------------------------
export const FIX = {
  baseline: {
    summary: 'fixture baseline', invariants: ['existing suite stays green'],
    measureCommand: 'true', filterCommand: 'true # {scope}', currentState: 'all green',
    projectCard: 'fixture conventions', coldBuildCost: 'cheap',
    purposeCheck: 'n/a (pure fixture)', inProcessVerifiable: true,
  },
  assessExecute: { difficulty: 'easy', size: 'small', action: 'execute', reason: 'fixture: atomic', risk: 'low' },
  assessSlice: { difficulty: 'easy', size: 'big', action: 'slice', reason: 'fixture: decompose', risk: 'low' },
  exec: {
    summary: 'fixture change applied', passed: true, evidence: 'filtered run green (fixture)',
    filesChanged: ['src/x.ts'], refactor: 'none needed (fixture)', commits: [],
    funList: [], discovered: [], purposeVerified: true,
  },
  trust: { trustworthy: true, reason: 'fixture: independently confirmed', issues: [] },
  distrust: {
    trustworthy: false, reason: 'fixture: vacuous test suspected',
    issues: ['fixture issue'], prescription: 'src/x.ts:1 fix the thing',
  },
  slices3: {
    slices: [0, 1, 2].map((i) => ({
      desc: `fixture slice ${i}`, interface: 'TBD/exploratory',
      contract: `achieve thing ${i} in src/s${i}.ts alone`, independent: true,
      dependsOn: [], kind: 'behavior', atomic: true, riskTier: 'standard', testScope: `S${i}`,
    })),
  },
  noMissing: { missing: [] },
  briefing: { briefing: 'fixture briefing' },
  learn: { summary: 'fixture learning' },
}

const GIT_SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678'

// Base dispatcher: green-path answers for every role; `over` intercepts first (return
// undefined to fall through). Throw inside `over` to simulate API/quota deaths.
export function dispatcher(over) {
  return async (c, env) => {
    if (over) { const r = await over(c, env); if (r !== undefined) return r }
    if (isSh(c)) {
      const p = c.prompt
      if (/rev-parse HEAD/.test(p)) return { exitCode: 0, stdout: GIT_SHA }
      if (/status --porcelain/.test(p)) return { exitCode: 0, stdout: '' }
      if (/rs-lock/.test(p) && /cat /.test(p)) return { exitCode: 1, stdout: '' }
      return { exitCode: 0, stdout: '' }
    }
    if (c.opts.phase === 'Baseline') return FIX.baseline
    if (has(c, /assess/)) return FIX.assessExecute
    if (has(c, /slice:/)) return FIX.slices3
    if (has(c, /critic/)) return FIX.noMissing
    if (has(c, /spike/)) return FIX.learn
    if (has(c, /^exec:|exec:/)) return FIX.exec
    if (has(c, /verify|integration/)) return FIX.trust
    if (c.opts.schema && c.opts.schema.required && c.opts.schema.required[0] === 'briefing') return FIX.briefing
    if (has(c, /partition/)) return FIX.slices3
    if (has(c, /wiring/i)) return FIX.trust
    throw new Error(`fixture dispatcher: unrecognized call label="${c.opts.label}" phase="${c.opts.phase}"`)
  }
}

// Sequential fixtures are now EXPLICIT (parallel:false) — the engine default is parallel-on, so
// the sequential-path tests opt out to keep exercising the sequential path unchanged.
export const ARGS = { task: 'fixture task — change one thing', repo: '/tmp/rs-fixture', maxDepth: 2, parallel: false }
// Default-mode args: NO `parallel` field — exercises the engine's DEFAULT (parallel-on).
export const ARGS_DEFAULT = { task: 'fixture task — change one thing', repo: '/tmp/rs-fixture', maxDepth: 2 }
// Parallel-mode args: explicit opt-in (overrides ARGS's parallel:false).
// FIX.slices3 already has 3 independent:true slices — the Plan phase partition picks them up.
export const ARGS_PARALLEL = { ...ARGS, parallel: true }
