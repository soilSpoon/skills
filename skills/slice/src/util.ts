// Pure, host-agnostic helpers — no engine-state coupling, so they live outside the __main closure.
// Extracting them keeps the orchestrator (main.ts) carrying flow, not utilities. The tsup bundle
// re-inlines these; this is a SOURCE-readability split, behavior-identical (same proven multi-module
// pattern as prompts.ts/schemas.ts/types.ts).

// ITEM 2 / 2026-06-16 MailKit dogfood: the host runs the emitted engine as a Node AsyncFunction body,
// but the Workflow runtime sandbox does NOT expose Node's `Buffer` global — `Buffer.from(...)` threw
// "Buffer is not defined" and SILENTLY degraded the JSONL run-trace + owner-briefing persist (both
// observability; run unaffected, but the comprehension-debt ledger was lost). Use a dependency-free
// UTF-8→base64 encoder (no Buffer/btoa/TextEncoder) so both paths survive any host. The base64 alphabet
// is shell-safe, so arbitrary role/label/briefing text never reaches the deterministic `sh` write proxy
// verbatim (the keep-text-out-of-shell discipline). Verified byte-identical to Buffer across ASCII /
// multibyte UTF-8 / surrogate-pair vectors + round-trip through `base64 -d`.
export const b64encode = (str: string): string => {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c < 0x80) bytes.push(c)
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (str.charCodeAt(++i) & 0x3ff)
      bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes.length - i
    const b0 = bytes[i], b1 = n > 1 ? bytes[i + 1] : 0, b2 = n > 2 ? bytes[i + 2] : 0
    out += A[b0 >> 2] + A[((b0 & 3) << 4) | (b1 >> 4)]
    out += n > 1 ? A[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += n > 2 ? A[b2 & 63] : '='
  }
  return out
}

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
