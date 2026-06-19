// Domain types — the engine's data contracts (erased at build time).
// ===== Domain types ==========================================================
export type SliceKind = 'tidy' | 'behavior'
export type RiskTier = 'light' | 'standard' | 'heavy'

export interface EngineArgs {
  task?: string
  repo?: string
  maxDepth?: number
  parallel?: boolean
  forceParallel?: boolean
  sharedScratch?: boolean
  confirmTier?: boolean      // opt-in ack: proceed with the engine even when the depth-0 over-tier gate fires (compile-bound + breadth<=3 + every slice explicitly riskTier:'light')
  confirmNoRig?: boolean     // opt-in ack: proceed even when the post-baseline testing-readiness gate fires (baseliner judged no runnable test rig → empty trust floor)
  skills?: unknown          // validated at use: string[] of guide-file paths
  leafConcurrency?: number  // opt-in (default 1 = OFF): run file-disjoint atomic sibling leaves concurrently (K=2-4, commit-if-trusted)
}
/** Baseliner output (BASELINE schema). filterCommand is mutable: the engine kills a broken template at runtime. */
export interface Baseline {
  summary: string
  invariants: string[]
  measureCommand: string
  filterCommand?: string
  currentState?: string
  projectCard?: string
  coldBuildCost?: 'cheap' | 'expensive'
  sharedCompileCache?: boolean    // worktrees share COMPILED artifacts across fresh checkouts via a persistent content-addressed cache (Xcode CAS/ccache/sccache/Bazel) — even when coldBuildCost is 'expensive' (the first build populates it). Decouples "expensive build" from "no cross-checkout sharing": when true, parallel worktrees build in their OWN dirs sharing the cache instead of serializing on one shared build dir.
  purposeCheck?: string
  inProcessVerifiable?: boolean
  rigPresent?: boolean            // baseliner's explicit judgment: does a real RUNNABLE test rig exist (a real test cmd that runs real tests, OR a test-foundations scripts/verify.sh)? false ONLY if NO verify.sh, NO test files, AND NO test command — the testing-readiness gate keys off `=== false`
  worktreeSetupCommand?: string   // E: shell command run once per parallel git-worktree right after creation
}
/** ITEM 10: the merged 'decompose' decision (DECOMPOSE schema) — Assessor folded INTO the Slicer.
 *  ONE agent decides per node: a LEAF ({action:'execute'|'spike', riskTier}) or a cut
 *  ({action:'slice', slices}). Replaces the old two-role assess(execute|slice|spike) + slice(the cut). */
export interface Decompose {
  action: 'execute' | 'slice' | 'spike'
  riskTier?: RiskTier        // for action:'execute' — this leaf's verification tier
  reason: string
  slices?: SliceSpec[]       // for action:'slice' — the thin vertical children
}
export interface SeamPointer {
  file: string          // relative path to the file containing the seam
  line?: number         // approx line (may be stale — Executor must confirm via Read before trusting)
  symbol?: string       // function/type/const name at the seam
  currentText?: string  // short snippet of current text at the seam (for quick visual confirm)
}
export interface SliceSpec {
  desc: string
  interface?: string   // absent on completeness-critic additions (never reach the partition path)
  contract: string
  independent?: boolean
  dependsOn?: number[]
  kind?: SliceKind
  atomic?: boolean
  riskTier?: RiskTier
  testScope?: string
  seamPointers?: SeamPointer[]  // OPTIONAL: seams the Slicer already resolved — threaded to Executor as anchors
  files?: string[]              // OPTIONAL: concrete files this slice will touch — leafConcurrency scheduler reads these for file-disjoint scheduling
}
export interface ExecResult {
  summary: string
  passed: boolean
  evidence: string
  filesChanged?: string[]
  refactor?: string
  funList?: string[]
  discovered?: string[]
  commits?: string[]
  interfaceConcern?: string
  purposeVerified?: boolean
  testScope?: string  // bare-token filter the leaf's tests run under — engine's deterministic-gate fallback when the slicer assigned no WorkNode.testScope (closes the spec-first→slice→gate token thread)
}
export interface Verdict {
  trustworthy: boolean
  issues?: string[]
  reason: string
  purposeGap?: string
  prescription?: string
  followUps?: string[]
  lensVotes?: boolean[]   // heavy tier only: per-lens trust votes [correctness, security, interface-drift] — recorded by the trace so heavy's marginal flip rate vs standard can be measured offline (never auto-acted on)
}
export interface ShResult { stdout?: string; exitCode: number }
/** One item on the explicit recursion stack. */
export interface WorkNode {
  task: string
  ctx: string
  depth: number
  spikes: number
  kind: SliceKind
  atomic?: boolean
  riskTier?: RiskTier
  testScope?: string
  seamPointers?: SeamPointer[]  // OPTIONAL: seams already resolved by the Slicer — passed through to exec prompt as anchors
  files?: string[]              // OPTIONAL: concrete files this leaf will touch — leafConcurrency scheduler reads these (absent → serial fallback)
}
/** Which deterministic trust-floor gate actually ran for a leaf before the LLM verifier.
 *  'deterministic-filtered' = engine ran the filtered tier-0 (green); 'full-suite' = tidy leaf,
 *  engine ran the full measure command; 'llm-only' = NO deterministic gate ran (silent trust-floor
 *  downgrade made LOUD + auditable — surfaced in the run-level `degradations`). */
export type GateLevel = 'deterministic-filtered' | 'full-suite' | 'llm-only'
/** One executed leaf in the ledger. verdict is null only for an executor that died before verification. */
export interface LeafRecord extends Partial<ExecResult> {
  task: string
  verdict: Verdict | null
  gateLevel?: GateLevel
}
export interface Groups { indep: SliceSpec[]; seq: SliceSpec[]; all: SliceSpec[] }
export interface Briefing { briefing: string }
/** The workflow's return payload (success and early-error shapes share it). */
export interface EngineResult {
  error?: string
  lock?: string
  lockFile?: string
  task?: string
  mode?: 'parallel' | 'sequential'
  baseline?: Baseline
  results?: LeafRecord[]
  coordinator?: Verdict | null
  integration?: Verdict | null
  fullSuiteGreen?: boolean
  integrationExit?: number
  trustedLeaves?: number
  totalLeaves?: number
  purposeGaps?: string[]
  wiringGaps?: string[]
  aborts?: string[]
  degradations?: string[]
  overTierStop?: boolean   // depth-0 over-tier gate fired: compile-bound + small breadth + all-light slices; nothing executed (re-run with confirmTier:true to override)
  noRigStop?: boolean      // post-baseline testing-readiness gate fired: baseliner judged no runnable test rig; nothing executed, no lock taken (re-run with confirmNoRig:true to override)
  slices?: number          // breadth that tripped the over-tier stop (for the human's machine-readable ETA)
  overallTrust?: boolean   // ITEM 2: single rollup verdict — true IFF every trust dimension held (additive; never a false green)
  ownersHeadline?: string  // ITEM 2: one human line — the green summary, or the first failing dimension named
  briefing?: string
}

// Host agent-call shape (shared by main.ts + extracted phase modules so AgentOpts has ONE definition).
export type ModelTier = 'sonnet' | 'opus' | 'haiku' | 'fable'
export interface AgentOpts {
  label?: string
  phase?: string
  schema?: Record<string, unknown>
  model?: ModelTier
  isolation?: 'worktree'
  agentType?: string
}
// The injected platform contract — the ONE seam each host satisfies (Claude Code Workflow, opencode).
// The engine core (main/phases/host) depends ONLY on this type; no ambient globals. The Claude Code
// adapter (runtime.ts → makeWorkflowRuntime) binds it to the Workflow runtime's injected globals; a
// future opencode adapter supplies its own Runtime over the SDK — same engine, different transport.
export interface Runtime {
  agent(prompt: string, opts?: AgentOpts): Promise<any>
  parallel<T>(thunks: Array<() => Promise<T>>): Promise<Array<T | null>>
  phase(title: string): void
  log(message: string): void
  budget: { total: number | null; spent(): number; remaining(): number }
  args: unknown
}
// One JSONL run-trace line (shared by main.ts's `trace` + extracted phases that emit traces).
export type TraceRecord = {
  phase: string
  role?: string
  model?: string
  leafIndex?: number
  gateLevel?: GateLevel
  trustworthy?: boolean
  repairAttempt?: number
  tier?: RiskTier               // the leaf's verification tier — lets flip/abandon rates be bucketed by tier offline
  lensVotes?: boolean[]         // heavy tier only: the 3 per-lens votes, recorded BEFORE the unanimous collapse
  flippedByLens?: boolean       // heavy only: lenses disagreed (>=1 trust AND >=1 distrust) — a single-vote tier might have passed it (heavy's marginal catch)
}
// Cohesive parameter-objects threaded into phases (introduce-parameter-object — collapses the flat
// 17-26 dep bags into named bundles that travel together: the run's tuning limits, and the git/repo context).
export type Limits = {
  FLOOR: number
  MAX_LEAVES: number
  MAX_DISCOVERED: number
  MAX_SPIKES: number
  MAX_REPAIR: number
  MAX_REPAIR_HARD: number
  MAX_UNTRUSTED_STREAK: number
  CONFIRM_TIER: boolean
  LEAF_CONCURRENCY: number   // opt-in leaf concurrency (1 = OFF, the default); >1 enables the file-disjoint concurrent leaf scheduler
}
// GitCtx = the target repo's GIT-mode state (all members are git-gated). REPO (the repo path, used
// git-independently) is threaded SEPARATELY so the bundle name doesn't over-imply git-gating.
export type GitCtx = {
  BASE_SHA: string
  GIT: boolean
  GIT_EXEC: string
  LOCKFILE: string
  gitVerify: (repo: string, from?: string) => string
}

// AgentOutcome<T>: discriminated union returned by agentSafe once callers are migrated from T|null.
// ok:true carries the typed value; ok:false carries a kind (matching classifyFailure's vocabulary
// plus schema/timeout/refusal for the non-API failure modes) and a detail string for logging.
export type AgentOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; kind: 'schema' | 'quota' | 'model_unavailable' | 'timeout' | 'refusal' | 'null'; detail: string }
