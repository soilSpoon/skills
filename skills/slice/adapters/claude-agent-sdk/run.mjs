#!/usr/bin/env node
// Run the recursive-slice engine via the Claude Agent SDK — in a REAL Node process, so the engine's
// deterministic sh() runs as NATIVE execFile (no shell-as-agent tax). Model calls go through query().
//
// Usage:
//   node run.mjs --repo <path> --task "<task>" [--parallel] [--max-depth N] [--skills a.md,b.md]
//
// Auth/billing (Max plan): uses your Claude login (run `claude setup-token` once, or the subscription
// OAuth). The 2026-06-15 "Agent SDK → credit pool" change is PAUSED, so this currently draws on the Max
// subscription — verify in Settings>Usage. Do NOT set ANTHROPIC_API_KEY unless you intend pay-as-you-go
// API billing: it takes precedence over the subscription (a known Claude Code gotcha).
import { query } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runEngine } from './slice-engine-sdk.ts'
import { installHandlers, configurePidfile, sweepPidfile, cleanup } from './lifecycle.mjs'

const argv = process.argv.slice(2)
const opt = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def }
const flag = (f) => argv.includes(f)

if (flag('--cleanup')) {
  const repo = resolve(opt('--repo', process.cwd()))
  sweepPidfile(repo)
  process.exit(0)
}

if (flag('--status')) {
  // Glanceable progress view — recovers the /workflows-style tree the harness gives the Workflow
  // runtime but NOT a standalone Node process. Reads .slice/engine.log (tee'd below) + git + ps.
  const repo = resolve(opt('--repo', process.cwd()))
  const here = dirname(fileURLToPath(import.meta.url))
  execFileSync(process.execPath, [join(here, 'status.mjs'), '--repo', repo, ...(opt('--out') ? ['--out', opt('--out')] : [])], { stdio: 'inherit' })
  process.exit(0)
}

const task = opt('--task')
if (!task) { console.error('usage: node run.mjs --repo <path> --task "<task>" [--parallel] [--max-depth N] [--skills a.md,b.md]'); process.exit(2) }
const args = {
  task,
  repo: resolve(opt('--repo', process.cwd())),
  ...(flag('--parallel') ? { parallel: true } : {}),
  ...(opt('--max-depth') ? { maxDepth: Number(opt('--max-depth')) } : {}),
  ...(opt('--skills') ? { skills: opt('--skills').split(',') } : {}),
}

configurePidfile(args.repo)   // <repo>/.slice/children.pids
sweepPidfile(args.repo)       // recover any groups orphaned by a PRIOR SIGKILL'd run
installHandlers()             // SIGTERM/SIGINT/SIGHUP + exit backstop + crash hooks

// Personas: load the engine's standalone role mirrors (agents/slice-<role>.md) as each call's systemPrompt.
const HERE = dirname(fileURLToPath(import.meta.url))
const AGENTS = join(HERE, '..', '..', 'agents')
const ROLE_FILE = {
  baseliner: 'slice-baseliner', slicer: 'slice-slicer', critic: 'slice-slicer',
  executor: 'slice-executor', spiker: 'slice-executor',
  verifier: 'slice-verifier', heavyLens: 'slice-verifier',
}
const cache = new Map()
const persona = (role) => {
  const name = ROLE_FILE[role]
  if (!name) return undefined
  if (!cache.has(name)) {
    try { cache.set(name, readFileSync(join(AGENTS, name + '.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '').trim()) }
    catch { cache.set(name, undefined) }
  }
  return cache.get(name)
}

const artifactPath = join(HERE, '..', '..', 'recursive-slice.js')
// Tee the engine log to a KNOWN location so `run.mjs --status` (or status.mjs) can render progress
// without knowing where this process's stderr was redirected. .slice/ was already created above.
const slog = `${args.repo}/.slice/engine.log`
try { writeFileSync(slog, '') } catch {}   // fresh per run
// Timestamp each log line at the HOST level. The engine itself must stay CLOCK-FREE — Date.now() is
// blocked in the Workflow runtime and would break resume — but run.mjs is native Node WITH a clock, so
// the elapsed +MM:SS belongs here. This makes per-phase/per-leaf durations readable straight from the
// log (no git-timestamp archaeology) and computable by status.mjs.
const t0 = Date.now()
const stamp = () => { const s = Math.round((Date.now() - t0) / 1000); return `+${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }
const log = (m) => { const line = `[${stamp()}] ${m}`; process.stderr.write(line + '\n'); try { appendFileSync(slog, line + '\n') } catch {} }
const result = await runEngine({ artifactPath, args, runQuery: query, persona, log })
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
