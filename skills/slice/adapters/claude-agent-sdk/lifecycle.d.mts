// Type surface for the plain-JS lifecycle.mjs (kept .mjs to match run.mjs / importable from the
// --experimental-strip-types TS module). Declarations only — no runtime.
export function configurePidfile(repo: string): void
export function trackProcessGroup(pid: number): () => void
export function trackQuery(abort: { abort?: () => void } | null, close: (() => void) | null): () => void
export function cleanup(): void
export function hardKillAll(): void
export function sweepPidfile(repo: string): void
export function installHandlers(): void
export function __resetForTests(): void
