// Central child-process lifecycle: a registry of reapable handles + idempotent cleanup +
// signal/exit handlers + a pidfile sweep for the uncatchable SIGKILL case. Imported by BOTH
// run.mjs (installs handlers) and slice-engine-sdk.ts (registers children). No deps.
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// A reapable is either a detached build child {kind:'pg', pid} or an in-flight SDK query
// {kind:'query', abort, close}. The Set is the single source of truth the handlers iterate.
const reapables = new Set()
let pidfile = null            // <repo>/.slice/children.pids — set once by configurePidfile()
let cleaning = false          // re-entrancy guard (a handler may fire while cleanup runs)

// Swallow ESRCH (already-dead process/group) — proven to throw on double-kill; never let it
// abort the rest of the cleanup loop.
const killSwallow = (target, sig) => {
  // Guard: -0/0 would signal our OWN process group; NaN (from an undefined pid) throws — never either.
  if (!Number.isInteger(target) || target === 0) return
  // ESRCH = already gone; EPERM = the group leader exited and its pgid was RECYCLED to a process we
  // don't own (the kernel correctly refused our signal — benign, and exactly why we must not retry).
  // Both mean "the thing we wanted to reap is no longer ours to reap"; anything else is unexpected.
  try { process.kill(target, sig) }
  catch (e) { if (e.code !== 'ESRCH' && e.code !== 'EPERM') process.stderr.write(`lifecycle: kill ${target} ${sig} failed: ${e.code || e.message}\n`) }
}

export function configurePidfile(repo) {
  pidfile = `${repo}/.slice/children.pids`
  try { mkdirSync(dirname(pidfile), { recursive: true }) } catch {}
}

// Register a DETACHED build child (pgid === pid). Returns an unregister fn for child.on('exit').
export function trackProcessGroup(pid) {
  // A failed spawn yields an undefined pid; never register a non-reapable handle (its -pid would be NaN).
  if (!Number.isInteger(pid) || pid <= 0) return () => {}
  const r = { kind: 'pg', pid }
  reapables.add(r)
  if (pidfile) { try { appendFileSync(pidfile, pid + '\n') } catch {} }
  return () => reapables.delete(r)
}

// Register an in-flight SDK query. abort=AbortController, close=Query.close handle.
export function trackQuery(abort, close) {
  const r = { kind: 'query', abort, close }
  reapables.add(r)
  return () => reapables.delete(r)
}

// Idempotent cleanup. Aborts queries (graceful) + hard-closes their CLI subprocess, then
// group-kills every detached build tree via the NEGATIVE pid. SYNC-only kills (safe from 'exit').
export function cleanup() {
  if (cleaning) return
  cleaning = true
  for (const r of reapables) {
    if (r.kind === 'query') {
      try { r.abort?.abort() } catch {}
      try { r.close?.() } catch {}
    } else {
      killSwallow(-r.pid, 'SIGTERM')   // graceful to the whole group
    }
  }
}

// Last-chance SYNC backstop for process.on('exit'): escalate build groups to SIGKILL.
export function hardKillAll() {
  for (const r of reapables) {
    if (r.kind === 'pg') killSwallow(-r.pid, 'SIGKILL')
  }
}

// Recover from a PRIOR run that was SIGKILL'd (node died, groups orphaned). Reads stale pgids
// from the pidfile and SIGKILLs each group; swallows ESRCH for ones that already exited.
export function sweepPidfile(repo) {
  const file = `${repo}/.slice/children.pids`
  let lines = []
  try { lines = readFileSync(file, 'utf8').split('\n') } catch { return }
  for (const line of lines) {
    const pid = Number(line.trim())
    if (pid > 0) killSwallow(-pid, 'SIGKILL')
  }
  try { writeFileSync(file, '') } catch {}   // truncate after sweep
}

// Wire all catchable signals + exit + crash hooks ONCE. exitCode: SIGINT→130, else→143.
export function installHandlers() {
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => { cleanup(); process.exit(sig === 'SIGINT' ? 130 : 143) })
  }
  process.on('uncaughtException', (e) => { console.error(e); cleanup(); process.exit(1) })
  process.on('unhandledRejection', (e) => { console.error(e); cleanup(); process.exit(1) })
  process.on('exit', () => hardKillAll())   // SYNC-only backstop; group SIGKILL
}

// Test-only reset: clears the one-shot cleaning guard + empties the registry so the
// reaping tests stay independent within a single node process. Not used in production.
export function __resetForTests() {
  cleaning = false
  reapables.clear()
}
