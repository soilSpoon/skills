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
import { readFileSync } from 'node:fs'
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
const result = await runEngine({ artifactPath, args, runQuery: query, persona, log: (m) => process.stderr.write(m + '\n') })
process.stdout.write(JSON.stringify(result, null, 2) + '\n')
