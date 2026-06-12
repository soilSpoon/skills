// JSON-Schemas forcing machine-usable decisions out of each role (Workflow agent() schema opt).
// ---- schemas: force machine-usable decisions out of each role ---------------
export const BASELINE = { type: 'object', required: ['invariants', 'measureCommand'], properties: {
  summary: { type: 'string' },
  invariants: { type: 'array', items: { type: 'string' } },   // falsifiable things that must stay true
  measureCommand: { type: 'string' },                          // exact green/red command
  filterCommand: { type: 'string' },                           // I1: filtered-test TEMPLATE containing literal "{scope}" (e.g. "./scripts/test.sh --filter {scope}") — the engine substitutes a suite name and runs it verbatim as a deterministic per-leaf gate; empty if the runner cannot filter
  currentState: { type: 'string' },                            // pass/fail counts as observed now
  projectCard: { type: 'string' },                             // distilled STATIC repo conventions shared to all workers
  coldBuildCost: { type: 'string', enum: ['cheap', 'expensive'] }, // would a FRESH worktree's first build be cheap (interpreted/no-build/shared-cache) or expensive (compiled lang, per-checkout dependency compile)?
  purposeCheck: { type: 'string' },                            // ① how to verify the work ACTUALLY works for the user (PURPOSE) beyond unit tests — e.g. a live integration test / a human action
  inProcessVerifiable: { type: 'boolean' },                    // ① can that purpose be verified deterministically in-process (pure logic / recorded-real bytes), or does it need a real env / human?
  worktreeSetupCommand: { type: 'string' },                    // E: shell command run ONCE per parallel git-worktree immediately after creation (e.g. 'npm ci'); empty/absent = no setup needed
} }
export const ASSESSMENT = { type: 'object', required: ['difficulty', 'action', 'reason'], properties: {
  difficulty: { type: 'string', enum: ['easy', 'hard'] },
  size: { type: 'string', enum: ['small', 'big'] },
  action: { type: 'string', enum: ['execute', 'slice', 'spike'] },
  reason: { type: 'string' },
} }
export const SLICES = { type: 'object', required: ['slices'], properties: {
  slices: { type: 'array', items: { type: 'object', required: ['desc', 'interface', 'contract'], properties: {
    desc: { type: 'string' },                                  // one-line what
    interface: { type: 'string' },                             // FIXED public surface — or "TBD/exploratory"
    contract: { type: 'string' },                              // achieve + seam/files + invariant + how to verify ALONE
    independent: { type: 'boolean' },                          // safe to build concurrently (no shared files)?
    dependsOn: { type: 'array', items: { type: 'integer' } },  // indices of prerequisite slices
    kind: { type: 'string', enum: ['tidy', 'behavior'] },      // ③ Tidy-First: 'tidy' = behavior-PRESERVING structural prep (verified by existing suite, no new tests); 'behavior' = the actual change
    atomic: { type: 'boolean' },                               // ② true = a single directly-executable unit (skip the redundant re-assess); false = still decompose
    riskTier: { type: 'string', enum: ['light', 'standard', 'heavy'] }, // ② slicer's risk judgment → verification tier (used when atomic, so no re-assess needed)
    testScope: { type: 'string' },                             // ④ the test suite/filter this slice's tests live under → leaf+verifier run FILTERED (not the full suite — the MEASURED #1 time cost)
  } } },
} }
export const LEARNING = { type: 'object', required: ['summary'], properties: {
  summary: { type: 'string' },
} }
export const RESULT = { type: 'object', required: ['summary', 'passed', 'evidence'], properties: {
  summary: { type: 'string' }, passed: { type: 'boolean' },   // passed = DETERMINISTIC shell result (build+tests), the tier-0 gate
  evidence: { type: 'string' },                                // what you ran and what you observed — the shell command + output tail that proves green/red
  filesChanged: { type: 'array', items: { type: 'string' } },
  refactor: { type: 'string' },                                // structure hat: what was tidied after green, or why none needed
  funList: { type: 'array', items: { type: 'string' } },       // tangents noticed, NOT chased (do not act on these — just list them)
  discovered: { type: 'array', items: { type: 'string' } },    // NEW test-list scenarios found mid-work → fed back (Canon TDD)
  commits: { type: 'array', items: { type: 'string' } },       // git mode: SHAs created (behavior commit, then refactor commit)
  interfaceConcern: { type: 'string' },                        // if the FIXED interface seemed wrong — reported up, NOT changed
  purposeVerified: { type: 'boolean' },                        // ① did this verify against REAL/recorded-real behavior (purpose), or only hand-fakes/mocks (prompt only)?
} }
export const VERDICT = { type: 'object', required: ['trustworthy', 'reason'], properties: {
  trustworthy: { type: 'boolean' },
  issues: { type: 'array', items: { type: 'string' } },
  reason: { type: 'string' },
  purposeGap: { type: 'string' },                              // ① real-user behavior the tests do NOT verify (e.g. only fakes used) — prompt satisfied ≠ purpose served
  prescription: { type: 'string' },                            // I3: when untrustworthy and the fix is VISIBLE — the exact minimal fix (file:line + change); a precise prescription is what makes repair converge (proven live)
  followUps: { type: 'array', items: { type: 'string' } },     // I4: concrete, independently-testable defects worth a follow-up leaf even when trustworthy=true (NOT style nits) — fed into the discovered batch
} }
export const MISSING = { type: 'object', required: ['missing'], properties: {
  missing: { type: 'array', items: { type: 'object', required: ['desc', 'contract'], properties: {
    desc: { type: 'string' }, contract: { type: 'string' },
  } } },
} }
export const BRIEFING = { type: 'object', required: ['briefing'], properties: {
  briefing: { type: 'string' },                                // B: markdown owner's reading guide (comprehension-debt repayment aid)
} }

