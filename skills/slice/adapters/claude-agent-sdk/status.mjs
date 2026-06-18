#!/usr/bin/env node
// slice-status — a glanceable progress view for a native-exec (run.mjs) slice run. The Workflow runtime
// gets a /workflows progress tree for free from the harness; a standalone Node process does NOT. This
// reconstructs an equivalent view from OUT-OF-BAND signals that exist regardless: the process table, the
// git worktree/branch state, and the engine log. Read-only, no deps.
//
//   node status.mjs --repo <path> [--log <file>] [--out <final-json>]
//   (--log defaults to <repo>/.slice/engine.log, which run.mjs now tees to; pass an explicit --log for
//    runs whose stderr was redirected elsewhere.)
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d }
const repo = arg('--repo', process.cwd())
const logFile = arg('--log', `${repo}/.slice/engine.log`)
const outFile = arg('--out', null)
const sh = (c) => { try { return execFileSync('/bin/sh', ['-c', c], { encoding: 'utf8' }).trim() } catch { return '' } }
const psCount = (pat) => Number(sh(`ps aux | grep -E '${pat}' | grep -v grep | wc -l`)) || 0
const mins = (ms) => `${Math.round(ms / 60000)}min`

const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
const lines = log.split('\n')
const lastMatch = (re) => { for (let i = lines.length - 1; i >= 0; i--) { const m = lines[i].match(re); if (m) return m } return null }

// ── process + build state ──────────────────────────────────────────────────────────────────────
const alive = psCount('run\\.mjs') > 0
const builds = psCount('xcodebuild') + psCount('swift-frontend')
const logAgeMs = existsSync(logFile) ? Date.now() - statSync(logFile).mtimeMs : null

// ── completion ─────────────────────────────────────────────────────────────────────────────────
let done = null
if (outFile && existsSync(outFile)) { try { const d = JSON.parse(readFileSync(outFile, 'utf8')); done = d.error ? `ERROR: ${d.error}`.slice(0, 80) : 'ok' } catch {} }

// ── phases (parsed from the log) ───────────────────────────────────────────────────────────────
const baselineDone = /Baseline:\s*(GREEN|GATE: green)/i.test(log) || /baseline pinned at/.test(log)
const planM = lastMatch(/parallel plan: (\d+) independent group/)
const seq = /falling back to sequential/.test(log)
const casAware = /shared compile cache is present/.test(log)
const baseSha = (log.match(/baseline pinned at ([0-9a-f]+)/) || [])[1] || ''

// ── lanes (per parallel group gN) ──────────────────────────────────────────────────────────────
const gids = [...new Set([...log.matchAll(/\bg(\d+):/g)].map((m) => m[1]))].sort()
const mainLog = sh(`git -C ${repo} log --oneline -8`)
const lane = (g) => {
  const leaf = lastMatch(new RegExp(`g${g}:leaf (\\d+) (green|untrusted)([^|]*)`))
  const repair = lastMatch(new RegExp(`g${g}:leaf \\d+ untrusted.*self-repair (\\d+/\\d+)`))
  const merged = new RegExp(`Merge branch 'rs/g${g}'`).test(mainLog)
  let commits = ''
  if (baseSha) { const c = Number(sh(`git -C ${repo} log --oneline ${baseSha}..rs/g${g} 2>/dev/null | wc -l`)); if (c > 0) commits = `${c} commits` }
  const state = merged ? 'MERGED ✓' : repair ? `leaf ${leaf ? leaf[1] : '?'} repairing ${repair[1]}` : leaf ? `leaf ${leaf[1]} ${leaf[2]}` : 'starting'
  return { g, state, commits, merged }
}
const lanes = gids.map(lane)

// ── render ─────────────────────────────────────────────────────────────────────────────────────
const dot = (ok) => (ok ? '✓' : '·')
const out = []
const status = done ? `DONE (${done})` : alive ? (builds ? `ALIVE · building (${builds} compiler procs)` : 'ALIVE · between builds') : 'NOT RUNNING'
out.push(`slice · ${repo.split('/').pop()} · ${status}` + (logAgeMs != null ? ` · last log ${mins(logAgeMs)} ago` : ''))
out.push(`├─ Baseline ${dot(baselineDone)}`)
out.push(`├─ Plan ${dot(!!planM || seq)}` + (planM ? ` · parallel: ${planM[1]} groups${casAware ? ' (CAS-aware: own dirs + shared cache)' : ''}` : seq ? ' · sequential' : ''))
out.push(`├─ Work${lanes.length ? '' : ' · (no leaves yet)'}`)
lanes.forEach((l, i) => out.push(`│  ${i === lanes.length - 1 ? '└' : '├'}─ g${l.g} · ${l.state}${l.commits ? ' · ' + l.commits : ''}`))
const merges = (mainLog.match(/Merge branch 'rs\/g\d+'/g) || []).length
out.push(`└─ Coordinate/Integrate ${dot(merges > 0)}` + (merges ? ` · ${merges}/${lanes.length || '?'} lane(s) merged` : ''))
if (logAgeMs != null && logAgeMs > 15 * 60000 && !builds && alive && !done) out.push(`\n⚠ STUCK? log silent ${mins(logAgeMs)}, no build active, no completion — consider 'node run.mjs --cleanup --repo ${repo}' + investigate`)
// recent events (tail of the leaf log)
const recent = lines.filter((l) => /:(leaf|\+\d+ discovered)|Merge branch|GATE: green/.test(l)).slice(-4)
if (recent.length) { out.push('\nrecent:'); recent.forEach((r) => out.push('  ' + r.slice(0, 96))) }
console.log(out.join('\n'))
