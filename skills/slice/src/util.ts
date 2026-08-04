// Pure, host-agnostic helpers — no engine-state coupling, so they live outside the __main closure.
// Extracting them keeps the orchestrator (main.ts) carrying flow, not utilities. The tsup bundle
// re-inlines these; this is a SOURCE-readability split, behavior-identical (same proven multi-module
// pattern as prompts.ts/schemas.ts/types.ts).

// v2 surgery ① (2026-08-04, from live post-mortems of both real engine runs): arbitrary LLM text
// (trace JSON, briefing markdown, commit messages) is carried into the deterministic `sh` write proxy
// as a PLAIN single-quoted POSIX string — NOT base64. The old base64 relay ("printf %s '<blob>' |
// base64 -d") was injection-safe but OPAQUE: an agent-relayed shell sees "execute this encoded blob
// without interpreting it", which safety classifiers read as obfuscated command execution (observed:
// 12+ [trace-append] blocks in one run, and the final worktree merge blocked as a "bypass attempt").
// Strict single-quoting is equally inert — inside '…' the ONLY special character is the quote itself,
// escaped as '\'' — while the command stays human-readable, so nothing looks like obfuscation.
// (Dependency-free on purpose: the AsyncFunction host has no Buffer; plain string ops survive any host.)
export const shQuote = (str: string): string => `'${str.replace(/'/g, `'\\''`)}'`

// ITEM 11a: ONE circuit-breaker abstraction (this engine had three ad-hoc counter+constant+comment
// clusters that are the SAME breaker at different (class, scope)). A breaker counts a consecutive
// failure streak and, optionally, the DISTINCT call-classes seen during it; it trips when streak ≥
// `threshold` AND the distinct-class count ≥ `classThreshold` (default 0 = no class gate). main.ts
// instantiates it three ways: quota = circuitBreaker(3, 2) SESSION, untrusted =
// circuitBreaker(MAX_UNTRUSTED_STREAK) UNIT, t0red = circuitBreaker(2) RUN.
//   • `.record(klass?)` bumps the streak (and adds the class when given), returns the new streak;
//   • `.streak` exposes the live count (some ACTION log lines embed it verbatim);
//   • `.tripped()` is the trip predicate (threshold + class gate); `.reset()` clears streak+classes.
export const circuitBreaker = (threshold: number, classThreshold = 0) => {
  let streak = 0
  const classes = new Set<string>()
  return {
    record(klass?: string) { streak++; if (klass !== undefined) classes.add(klass); return streak },
    get streak() { return streak },
    tripped() { return streak >= threshold && classes.size >= classThreshold },
    reset() { streak = 0; classes.clear() },
  }
}
export type Breaker = ReturnType<typeof circuitBreaker>  // shape of a circuitBreaker instance (for typing it as a phase dep)

// The shell-truth→ENGINE-RAN→judge string in ONE helper (leaf + tidy gates emit an identical shape):
// the model JUDGES from this fixed deterministic result, never re-runs it (ITEM 8 keystone).
export const engineRanBlock = ({ cmd, note, exitCode, tail, duty }: { cmd: string; note?: string; exitCode: number; tail: string; duty: string }): string =>
  `\nENGINE-RAN: \`${cmd}\`${note ? ' ' + note : ''} exited ${exitCode}. Output tail: ${tail}\n${duty}`

// classifyFailure: maps a caught API error to a quota-halt kind — VERBATIM encoding of the
// host.ts catch-branch heuristics. budget/ceiling errors are NEVER passed here (host.ts re-throws
// those before reaching this function). Returns 'null' for unrecognised or non-Error throws.
export const classifyFailure = (err: unknown): 'quota' | 'model_unavailable' | 'null' => {
  const m = String(((err as any) && (err as any).message) || err)
  if (/session limit|rate.?limit|quota|too many requests|overloaded|credit/i.test(m)) return 'quota'
  if (/issue with the selected model|may not have access to it|selected model.*may not exist/i.test(m)) return 'model_unavailable'
  return 'null'
}

// leafConcurrency scheduler core (PURE). Given sibling leaves that EACH declare their `files` (the
// caller falls back to fully-serial if ANY leaf lacks files[], so a missing/empty files[] here is
// treated as not-concurrency-safe and skipped), return the indices that can START NOW: their
// `dependsOn` are ALL done, and their files are disjoint from the in-flight set AND from each other.
// Greedy scan in index order (deterministic), capped at K. `done` = completed indices (also satisfies
// deps); `started` = already-launched indices to skip; `inFlight` = files of started-but-unfinished leaves.
export const pickConcurrentLeaves = (
  leaves: ReadonlyArray<{ files?: string[]; dependsOn?: number[] }>,
  done: ReadonlySet<number>,
  inFlight: ReadonlySet<string>,
  K: number,
  started: ReadonlySet<number> = new Set<number>(),
): number[] => {
  const picked: number[] = []
  const claimed = new Set<string>(inFlight)
  for (let i = 0; i < leaves.length && picked.length < K; i++) {
    if (done.has(i) || started.has(i)) continue
    const files = leaves[i].files
    if (!files || files.length === 0) continue                              // no declared files → not concurrency-safe
    if ((leaves[i].dependsOn || []).some((dep) => !done.has(dep))) continue  // a prerequisite is not done yet
    if (files.some((f) => claimed.has(f))) continue                         // file clash (in-flight or a batch-mate)
    picked.push(i)
    for (const f of files) claimed.add(f)
  }
  return picked
}

// leafConcurrency gate (PURE): may this batch of sibling slices run with the concurrent scheduler, or
// must it fall back to fully-serial? Concurrent ONLY when the opt-in is >1, there is more than one slice,
// EVERY slice is an atomic leaf (a non-atomic child needs further decomposition — not a leaf to batch),
// and EVERY slice declares a non-empty files[] (the scheduler needs every file set to prove disjointness;
// a single missing files[] forces serial — the BACKLOG "any slice missing files[] → serial fallback").
export const shouldRunConcurrent = (
  slices: ReadonlyArray<{ atomic?: boolean; files?: string[] }>,
  leafConcurrency: number,
): boolean =>
  leafConcurrency > 1 &&
  slices.length > 1 &&
  slices.every((s) => s.atomic === true && Array.isArray(s.files) && s.files.length > 0)
