#!/usr/bin/env node
// slice-status — a glanceable, optionally LIVE progress view for a native-exec (run.mjs) slice run. The
// Workflow runtime gets a /workflows tree from the harness; a standalone Node process does NOT. This
// reconstructs an equivalent view from out-of-band signals (the process table, git worktree/branch state,
// the engine log) — as a one-shot snapshot, or a LIVE auto-refreshing dashboard with --watch (the
// native-exec answer to /workflows: run it in a terminal beside the run). DX is a trust axis. Read-only.
//
//   node status.mjs --repo <path> [--log <file>] [--out <final-json>] [--watch]
//   --log defaults to <repo>/.slice/engine.log (run.mjs tees there); --watch redraws in place every 2s.
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d }
const has = (f) => process.argv.includes(f)
const repo = arg('--repo', process.cwd())
const logFile = arg('--log', `${repo}/.slice/engine.log`)
const outFile = arg('--out', null)
const sh = (c) => { try { return execFileSync('/bin/sh', ['-c', c], { encoding: 'utf8' }).trim() } catch { return '' } }
const psCount = (pat) => Number(sh(`ps aux | grep -E '${pat}' | grep -v grep | wc -l`)) || 0
const mins = (ms) => `${Math.round(ms / 60000)}min`

// snapshot() recomputes from live signals each call so --watch reflects the moving run.
function snapshot() {
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  const lines = log.split('\n')
  const lastMatch = (re) => { for (let i = lines.length - 1; i >= 0; i--) { const m = lines[i].match(re); if (m) return m } return null }
  const alive = psCount('run\\.mjs') > 0
  const builds = psCount('xcodebuild') + psCount('swift-frontend')
  const logAgeMs = existsSync(logFile) ? Date.now() - statSync(logFile).mtimeMs : null
  let done = null
  if (outFile && existsSync(outFile)) { try { const d = JSON.parse(readFileSync(outFile, 'utf8')); done = d.error ? `ERROR: ${d.error}`.slice(0, 80) : 'ok' } catch {} }
  const baselineDone = /Baseline:\s*(GREEN|GATE: green)/i.test(log) || /baseline pinned at/.test(log)
  const planM = lastMatch(/parallel plan: (\d+) independent group/)
  const seq = /falling back to sequential/.test(log)
  const casAware = /shared compile cache is present/.test(log)
  const baseSha = (log.match(/baseline pinned at ([0-9a-f]+)/) || [])[1] || ''
  const gids = [...new Set([...log.matchAll(/\bg(\d+):/g)].map((m) => m[1]))].sort()
  const baseLog = baseSha ? sh(`git -C ${repo} log --oneline ${baseSha}..HEAD 2>/dev/null`) : ''
  const lane = (g) => {
    const leaf = lastMatch(new RegExp(`g${g}:leaf (\\d+) (green|untrusted)`))
    const repair = lastMatch(new RegExp(`g${g}:leaf \\d+ untrusted.*self-repair (\\d+/\\d+)`))
    const merged = new RegExp(`Merge branch 'rs/g${g}'`).test(baseLog)
    return { g, merged, state: merged ? 'MERGED ✓' : repair ? `leaf ${leaf ? leaf[1] : '?'} repairing ${repair[1]}` : leaf ? `leaf ${leaf[1]} ${leaf[2]}` : 'starting' }
  }
  const lanes = gids.map(lane)
  const seqLeaf = !gids.length ? lastMatch(/(?:^|[\s\]])leaf (\d+) (green|untrusted)/) : null
  const seqDone = !gids.length ? [...log.matchAll(/(?:^|[\s\]])leaf \d+ green/g)].length : 0
  const tstamps = [...log.matchAll(/\[\+(\d{2}:\d{2})\]/g)]
  const elapsed = tstamps.length ? tstamps[tstamps.length - 1][1] : null
  const timings = lines.filter((l) => l.includes('· agent ')).slice(-8).map((l) => l.replace(/^\[\+[\d:]+\]\s*· agent /, ''))

  const dot = (ok) => (ok ? '✓' : '·')
  const out = []
  const head = done ? `DONE (${done})` : alive ? (builds ? `building (${builds} compiler procs)` : 'between builds') : 'NOT RUNNING'
  out.push(`slice · ${repo.split('/').pop()} · ${head}` + (elapsed ? ` · +${elapsed}` : '') + (logAgeMs != null ? ` · last log ${mins(logAgeMs)} ago` : ''))
  out.push(`├─ Baseline ${dot(baselineDone)}`)
  const planned = !!planM || seq || !!seqLeaf || (baselineDone && /decompose|leaf \d+/.test(log))
  out.push(`├─ Plan ${dot(planned)}` + (planM ? ` · parallel: ${planM[1]} groups${casAware ? ' (CAS-aware)' : ''}` : baselineDone && !gids.length ? ' · sequential' : ''))
  if (lanes.length) { out.push('├─ Work'); lanes.forEach((l, i) => out.push(`│  ${i === lanes.length - 1 ? '└' : '├'}─ g${l.g} · ${l.state}`)) }
  else { out.push(`├─ Work · ${seqLeaf ? `leaf ${seqLeaf[1]} ${seqLeaf[2]} (${seqDone} done)` : '(no leaves yet)'}`) }
  const merges = (baseLog.match(/Merge branch 'rs\/g\d+'/g) || []).length
  out.push(`└─ Coordinate/Integrate ${dot(!!done || (lanes.length > 0 && merges >= lanes.length))}` + (merges ? ` · ${merges} merged` : ''))
  if (logAgeMs != null && logAgeMs > 15 * 60000 && !builds && alive && !done) out.push(`\n⚠ STUCK? log silent ${mins(logAgeMs)}, no build, no completion`)
  if (timings.length) { out.push('\nrole timings (④, recent):'); timings.forEach((t) => out.push('  ' + t.slice(0, 90))) }
  const recent = lines.filter((l) => /leaf \d+ (green|untrusted)|\+\d+ discovered|Merge branch|GATE: green/.test(l)).slice(-4)
  if (recent.length) { out.push('\nrecent:'); recent.forEach((r) => out.push('  ' + r.slice(0, 100))) }
  return { text: out.join('\n'), alive, done }
}

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>slice · live</title>
<style>
 body{background:#0b0e14;color:#cdd6f4;font:13px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:18px}
 h1{font-size:14px;color:#89b4fa;margin:0 0 14px;font-weight:600}
 .grid{display:grid;grid-template-columns:minmax(280px,420px) 1fr;gap:16px}
 @media(max-width:720px){.grid{grid-template-columns:1fr}}
 .lbl{color:#6c7086;font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 6px}
 pre{background:#11151c;border:1px solid #1e2430;border-radius:10px;padding:14px;margin:0;white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:82vh}
 #tree{color:#a6e3a1}
 #log{color:#bac2de;font-size:12px}
 .dim{color:#6c7086}
 .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:#a6e3a1;margin-left:6px;animation:p 2s infinite;vertical-align:middle}
 @keyframes p{50%{opacity:.25}}
</style>
<h1>slice · live dashboard <span class=pulse id=pulse></span> <span class=dim id=meta></span></h1>
<div class=grid>
 <div><p class=lbl>progress</p><pre id=tree>loading…</pre></div>
 <div><p class=lbl>engine log (live · [+mm:ss] = elapsed)</p><pre id=log></pre></div>
</div>
<script>
async function tick(){
 try{
  const d=await (await fetch('/api')).json();
  document.getElementById('tree').textContent=d.tree;
  const log=document.getElementById('log'),atBottom=log.scrollTop+log.clientHeight>=log.scrollHeight-24;
  log.textContent=d.log; if(atBottom) log.scrollTop=log.scrollHeight;
  document.getElementById('meta').textContent=d.done?('· done: '+d.done):(d.alive?'· running':'· not running');
  document.getElementById('pulse').style.background=d.done?'#89b4fa':(d.alive?'#a6e3a1':'#f38ba8');
 }catch(e){document.getElementById('meta').textContent='· (server stopped)';document.getElementById('pulse').style.background='#f38ba8';}
}
tick();setInterval(tick,2000);
</script>`

if (has('--serve')) {
  // LOCAL WEB DASHBOARD — the low-friction frontend: open a browser tab, live + rich, no babysat command.
  // Zero-dep (node:http). Serves the same structured snapshot() + a live tail of the engine log.
  const port = Number(arg('--port', 8787))
  createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      const s = snapshot()
      const tail = (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).slice(-80) : []).join('\n')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ tree: s.text, alive: s.alive, done: s.done, log: tail }))
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
    }
  }).listen(port, () => console.log(`slice dashboard → http://localhost:${port}\n  repo: ${repo}\n  open it in a browser (live, auto-refresh every 2s). Ctrl-C to stop.`))
} else if (has('--watch')) {
  // LIVE terminal dashboard — redraw in place every 2s until the run ends.
  let wasAlive = false
  const tick = () => {
    const s = snapshot()
    wasAlive = wasAlive || s.alive
    process.stdout.write('\x1b[2J\x1b[H' + s.text + '\n\n(live · 2s refresh · Ctrl-C to stop)\n')
    if (s.done || (wasAlive && !s.alive)) { process.stdout.write('\n— run ended —\n'); process.exit(0) }
  }
  tick()
  const iv = setInterval(tick, 2000)
  process.on('SIGINT', () => { clearInterval(iv); process.stdout.write('\n'); process.exit(0) })
} else {
  console.log(snapshot().text)
}
