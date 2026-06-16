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
// One JSONL run-trace line (shared by main.ts's `trace` + extracted phases that emit traces).
export type TraceRecord = {
  phase: string
  role?: string
  model?: string
  leafIndex?: number
  gateLevel?: GateLevel
  trustworthy?: boolean
  repairAttempt?: number
}
