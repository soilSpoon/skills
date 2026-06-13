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
  worktreeSetupCommand?: string   // E: shell command run once per parallel git-worktree right after creation
}
export interface Assessment {
  difficulty: 'easy' | 'hard'
  size?: 'small' | 'big'
  action: 'execute' | 'slice' | 'spike'
  reason: string
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
  briefing?: string
}
