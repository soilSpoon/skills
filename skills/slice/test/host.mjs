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

// ITEM 6 (LATENCY): the engine now BATCHES deterministic git into ONE sh() per logical phase (prologue:
// git-sha+git-clean+lock-dir+lock-check; the conditional lock-write; per-leaf reset+clean). Each
// sub-command emits an EXIT MARKER `<<RS:NAME:$?>>` and the engine parses those markers. The fixture
// stays FAITHFUL: it synthesizes the SAME marker-formatted stdout a real batched shell would emit, so
// per-command outcome detection is exercised exactly as in production. A batched-script prompt is one
// that carries the marker protocol (`<<RS:`); a single-command prompt is handled the legacy way.
//
// Per-marker canned outcome (NAME → { out, code }). `out` is the stdout that PRECEDES that marker; for
// lock-dir the engine prints `$GD` before the marker, so out = the gitdir (default '' ⇒ no lock block).
// `shOver` lets a scenario override a single sub-command's outcome inside the batch (e.g. a non-zero
// reset, a held lock) WITHOUT killing the whole batch — the realistic per-command failure path. A
// scenario that wants the WHOLE batch to die (dead proxy) still throws on the batched prompt in `over`.
const BATCH_DEFAULTS = {
  'git-sha':    { out: GIT_SHA, code: 0 },
  'git-clean':  { out: '', code: 0 },
  'lock-dir':   { out: '', code: 0 },   // gitdir empty by default ⇒ engine skips the lock block
  'lock-check': { out: '', code: 1 },   // no lock currently held
  'lock-write': { out: '', code: 0 },
  'reset':      { out: '', code: 0 },
  'clean':      { out: '', code: 0 },
}
// Build the marker-formatted stdout for a batched script, honoring per-name overrides from shOver.
// Only emits markers for NAMEs the script actually contains (so a conditional lock-check/lock-write
// that the engine guarded with `if [ -n "$GD" ]` is omitted exactly as a real shell would omit it).
export function synthBatch(prompt, shOver = {}) {
  // Names appear in the script as `<<RS:NAME:%s>>` (the engine's printf template).
  const names = [...prompt.matchAll(/<<RS:([A-Za-z0-9_-]+):%s>>/g)].map((m) => m[1])
  // The lock-check / lock-write sub-commands are emitted by the engine ONLY when a real gitdir was
  // resolved. The fixture default (lock-dir out='') means no gitdir ⇒ those markers must NOT appear,
  // matching the real shell's `if [ -n "$GD" ]` guard. A scenario that sets lock-dir to a real path
  // (via shOver) opts those sub-commands back in.
  const ld = { ...BATCH_DEFAULTS['lock-dir'], ...(shOver['lock-dir'] || {}) }
  const gitdirPresent = String(ld.out || '').trim().startsWith('/')
  let out = ''
  for (const name of names) {
    if ((name === 'lock-check' || name === 'lock-write') && !gitdirPresent) continue
    const def = { ...(BATCH_DEFAULTS[name] || { out: '', code: 0 }), ...(shOver[name] || {}) }
    // lock-write RACE: a scenario can set lock-write to { race: true } to exercise the concurrent-grab
    // path (the engine's `else` branch emits the non-numeric RACE sentinel instead of a code marker).
    if (name === 'lock-write' && def.race) { out += `<<RS-RACE:lock-write>>\n`; continue }
    out += `${def.out}\n<<RS:${name}:${def.code}>>\n`
  }
  return { exitCode: 0, stdout: out }
}
// Is this sh prompt a batched (marker-protocol) script?
export const isBatch = (p) => /<<RS:[A-Za-z0-9_-]+:%s>>/.test(p)

// Base dispatcher: green-path answers for every role; `over` intercepts first (return
// undefined to fall through). Throw inside `over` to simulate API/quota deaths.
// `shOver` (2nd dispatcher arg) supplies per-sub-command overrides for batched sh scripts.
export function dispatcher(over, shOver = {}) {
  return async (c, env) => {
    if (over) { const r = await over(c, env); if (r !== undefined) return r }
    if (isSh(c)) {
      const p = c.prompt
      // Batched (marker-protocol) script: synthesize the per-command marker output the engine parses.
      if (isBatch(p)) return synthBatch(p, shOver)
      // Single-command (legacy) sh calls: head capture, lock-clear (rm -f), wiring scan, t0, integrate…
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
