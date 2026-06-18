#!/usr/bin/env node
// slice-status — progress view for a native-exec (run.mjs) slice run. The Workflow runtime gets a
// /workflows tree from the harness; a standalone Node process does NOT. This reconstructs an equivalent
// from out-of-band signals (process table, git, the engine log). Three modes: one-shot CLI snapshot,
// --watch (live terminal redraw), and --serve (a LOCAL GRAPHICAL WEB DASHBOARD: at-a-glance header +
// per-leaf cards with their own logs + role-timing bars + filter, light/dark). DX is a trust axis.
//
//   node status.mjs --repo <path> [--log <file>] [--out <json>] [--serve [--port N]] [--watch]
//   --log defaults to <repo>/.slice/engine.log (run.mjs tees there). --serve = the browser dashboard.
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

// ── CLI text snapshot (for --watch + one-shot) ───────────────────────────────────────────────────
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
  const baseSha = (log.match(/baseline pinned at ([0-9a-f]+)/) || [])[1] || ''
  const gids = [...new Set([...log.matchAll(/\bg(\d+):/g)].map((m) => m[1]))].sort()
  const baseLog = baseSha ? sh(`git -C ${repo} log --oneline ${baseSha}..HEAD 2>/dev/null`) : ''
  const seqLeaf = !gids.length ? lastMatch(/(?:^|[\s\]])leaf (\d+) (green|untrusted)/) : null
  const seqDone = !gids.length ? [...log.matchAll(/(?:^|[\s\]])leaf \d+ green/g)].length : 0
  const tstamps = [...log.matchAll(/\[\+(\d{2}:\d{2})\]/g)]
  const elapsed = tstamps.length ? tstamps[tstamps.length - 1][1] : null
  const out = []
  const head = done ? `DONE (${done})` : alive ? (builds ? `building (${builds} compiler procs)` : 'between builds') : 'NOT RUNNING'
  out.push(`slice · ${repo.split('/').pop()} · ${head}` + (elapsed ? ` · +${elapsed}` : '') + (logAgeMs != null ? ` · last log ${mins(logAgeMs)} ago` : ''))
  out.push(`baseline ${baselineDone ? '✓' : '·'} · plan ${(planM || seq || seqLeaf) ? '✓' : '·'} · work ${seqLeaf ? `leaf ${seqLeaf[1]} (${seqDone} done)` : gids.length ? gids.length + ' lanes' : '·'}`)
  return { text: out.join('\n'), alive, done }
}

// ── STRUCTURED parse (the graphical dashboard renders this) ──────────────────────────────────────
// Groups agent-timing + log lines per leaf by the [+MM:SS] time-window between consecutive leaf events.
function parseRun() {
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  const raw = log.split('\n').filter((l) => l.trim())
  const secOf = (l) => { const m = l.match(/\[\+(\d+):(\d+)\]/); return m ? +m[1] * 60 + +m[2] : null }
  const body = (l) => l.replace(/^\[\+[\d:]+\]\s*/, '')
  const alive = psCount('run\\.mjs') > 0
  const builds = psCount('xcodebuild') + psCount('swift-frontend')
  let done = null
  if (outFile && existsSync(outFile)) { try { const d = JSON.parse(readFileSync(outFile, 'utf8')); done = d.error ? 'error' : 'ok' } catch {} }
  let elapsed = 0
  for (let i = raw.length - 1; i >= 0; i--) { const s = secOf(raw[i]); if (s != null) { elapsed = s; break } }
  const baselineDone = /Baseline:\s*(GREEN|GATE: green)|baseline pinned at/.test(log)
  const planM = log.match(/parallel plan: (\d+) independent/)
  const merges = (log.match(/Merge branch/g) || []).length
  const PHASES = ['Baseline', 'Plan', 'Work', 'Coordinate', 'Done']
  let phaseIdx = 0
  if (baselineDone) phaseIdx = 1
  if (/leaf \d+ (green|untrusted)|decompose|exec:/.test(log)) phaseIdx = 2
  if (merges > 0) phaseIdx = 3
  if (done) phaseIdx = 4
  const roleOf = (lbl) => {
    const x = lbl.replace(/^(g\d+|seq\d+):/, '')
    if (/^exec/.test(x)) return 'executor'
    if (/^(verify|leaf-verify|merge-verify|integration)/.test(x)) return 'verifier'
    if (/slice|partition|decompose/.test(x)) return 'slicer'
    if (/critic/.test(x)) return 'critic'
    if (/baselin/.test(x)) return 'baseliner'
    if (/spike/.test(x)) return 'spiker'
    if (/coord|merge-conflict/.test(x)) return 'coordinator'
    if (/wiring|brief/.test(x)) return 'integrator'
    return x.split(':')[0] || 'agent'
  }
  const agents = raw.map((l) => { const m = body(l).match(/^· agent (.+?) (\d+)s\s*$/); return m ? { t: secOf(l), label: m[1], sec: +m[2], role: roleOf(m[1]) } : null }).filter(Boolean)
  const roleMap = {}
  for (const a of agents) roleMap[a.role] = (roleMap[a.role] || 0) + a.sec
  const roles = Object.entries(roleMap).map(([role, sec]) => ({ role, sec })).sort((a, b) => b.sec - a.sec)
  const ends = []
  raw.forEach((l) => {
    const m = body(l).match(/^(?:(g\d+):)?leaf (\d+) (green|untrusted)\b/)
    if (m) ends.push({ t: secOf(l) || 0, lane: m[1] || '', idx: +m[2], status: m[3], tier: (body(l).match(/tier=([\w-]+)/) || [])[1] || '', gate: (body(l).match(/gate=([\w-]+)/) || [])[1] || '', task: ((body(l).match(/trusted:\s*(.*)$/) || [])[1] || '').slice(0, 90) })
  })
  let prevT = 0
  const leaves = ends.map((e) => {
    const s0 = prevT, s1 = e.t; prevT = e.t
    const ag = agents.filter((a) => a.t != null && a.t > s0 && a.t <= s1 + 1).map((a) => ({ role: a.role, sec: a.sec }))
    const lg = raw.filter((l) => { const s = secOf(l); return s != null && s > s0 && s <= s1 + 1 }).map(body)
    const disc = (lg.join(' ').match(/\+(\d+) discovered/g) || []).reduce((acc, x) => acc + +(x.match(/\d+/)[0]), 0)
    return { n: e.idx, lane: e.lane, status: e.status, tier: e.tier, gate: e.gate, task: e.task, sec: Math.max(0, s1 - s0), discovered: disc, repaired: lg.some((l) => /self-repair/.test(l)), agents: ag, log: lg.slice(0, 80) }
  })
  const lastEnd = ends.length ? ends[ends.length - 1].t : 0
  if ((alive || builds) && !done) {
    const lg = raw.filter((l) => { const s = secOf(l); return s != null && s > lastEnd }).map(body)
    if (lg.length) leaves.push({ n: leaves.length, lane: '', status: 'running', tier: '', gate: '', task: ((lg.find((l) => /leaf|exec|decompose/.test(l)) || lg[lg.length - 1] || '')).slice(0, 90), sec: Math.max(0, elapsed - lastEnd), discovered: 0, repaired: false, agents: agents.filter((a) => a.t > lastEnd).map((a) => ({ role: a.role, sec: a.sec })), log: lg.slice(-60) })
  }
  const status = done ? `done (${done})` : alive ? (builds ? `building (${builds})` : 'thinking') : 'not running'
  return { status, alive: !!alive, done, elapsed, phases: PHASES, phaseIdx, parallel: planM ? +planM[1] : 0, merges, agentCount: agents.length, leaves, roles, recent: raw.slice(-50).map(body) }
}

// ── the graphical dashboard page (zero-dep; inner JS uses string concat to avoid nested backticks) ─
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>slice · live</title>
<style>
 :root{--bg:#0b0e14;--panel:#11151c;--border:#1e2430;--fg:#cdd6f4;--dim:#6c7086;--accent:#89b4fa;--green:#a6e3a1;--red:#f38ba8;--yellow:#f9e2af;--bar:#45475a}
 [data-theme=light]{--bg:#f6f7f9;--panel:#fff;--border:#e2e5ea;--fg:#1c1f26;--dim:#8a8f99;--accent:#1e66f5;--green:#107a3e;--red:#d20f39;--yellow:#b07d00;--bar:#d4d7dd}
 *{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:16px;transition:background .15s,color .15s}
 .top{display:flex;align-items:center;gap:10px;margin:0 0 12px}h1{font-size:14px;color:var(--accent);margin:0;font-weight:600}
 .dim{color:var(--dim)}button{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12px;margin-left:auto}
 .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);animation:p 2s infinite}@keyframes p{50%{opacity:.25}}
 .head{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:14px}
 .stepper{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
 .step{padding:3px 12px;border-radius:20px;border:1px solid var(--border);color:var(--dim);font-size:12px}
 .step.done{color:var(--green);border-color:var(--green)}.step.active{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
 .summary{color:var(--dim);font-size:12px;margin-bottom:10px}
 .tiles{display:flex;gap:4px;flex-wrap:wrap}
 .tile{width:18px;height:18px;border-radius:4px;background:var(--bar);cursor:pointer;border:1px solid transparent}
 .tile.green{background:var(--green)}.tile.untrusted{background:var(--red)}.tile.repairing,.tile.running{background:var(--yellow);animation:p 1.5s infinite}
 .cols{display:grid;grid-template-columns:minmax(320px,1fr) minmax(300px,1fr);gap:14px}@media(max-width:760px){.cols{grid-template-columns:1fr}}
 .lbl{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;display:flex;align-items:center;gap:8px}
 input{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px}
 .leaf{background:var(--panel);border:1px solid var(--border);border-radius:9px;padding:9px 11px;margin-bottom:7px;cursor:pointer;border-left:3px solid var(--bar)}
 .leaf.green{border-left-color:var(--green)}.leaf.untrusted{border-left-color:var(--red)}.leaf.running{border-left-color:var(--yellow)}
 .leafhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
 .badge{font-size:11px;padding:1px 7px;border-radius:10px;background:var(--bar);color:var(--fg)}
 .badge.green{background:var(--green);color:#fff}.badge.untrusted{background:var(--red);color:#fff}.badge.running{background:var(--yellow);color:#000}
 .task{color:var(--dim);font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .detail{display:none;margin-top:9px;padding-top:9px;border-top:1px solid var(--border)}.leaf.open .detail{display:block}.leaf.open .task{white-space:normal}
 .arow{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px}.arole{width:90px;color:var(--dim);flex-shrink:0}
 .abar{height:10px;background:var(--accent);border-radius:3px;min-width:2px}
 pre{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:9px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:280px;font-size:11px;color:var(--dim)}
 #log{max-height:78vh}
</style>
<div class=top><h1>slice <span class=pulse id=pulse></span></h1><span class=dim id=meta></span><button id=theme>◐ theme</button></div>
<div class=head><div class=stepper id=stepper></div><div class=summary id=summary></div><div class=tiles id=tiles></div></div>
<div class=cols>
 <div><div class=lbl>leaves <input id=filter placeholder="filter leaves/log"></div><div id=leaves></div></div>
 <div><div class=lbl>role time</div><div id=roles></div><div class=lbl style="margin-top:14px">engine log (live)</div><pre id=log></pre></div>
</div>
<script>
var root=document.documentElement,sv=localStorage.getItem('slice-theme');
if(sv)root.dataset.theme=sv;else if(matchMedia('(prefers-color-scheme: light)').matches)root.dataset.theme='light';
document.getElementById('theme').onclick=function(){var t=root.dataset.theme==='light'?'dark':'light';root.dataset.theme=t;localStorage.setItem('slice-theme',t)};
function $(i){return document.getElementById(i)}
function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function fmt(s){return s>=60?(Math.floor(s/60)+':'+String(s%60<10?'0':'')+(s%60)):(s+'s')}
var data={phases:['Baseline','Plan','Work','Coordinate','Done'],phaseIdx:0,leaves:[],roles:[],recent:[],agentCount:0,elapsed:0,status:''};
function render(){
 var f=($('filter').value||'').toLowerCase();
 $('stepper').innerHTML=data.phases.map(function(p,i){var c=i===data.phaseIdx?'step active':(i<data.phaseIdx?'step done':'step');return '<span class="'+c+'">'+p+'</span>'}).join('');
 $('summary').textContent=data.status+' · +'+fmt(data.elapsed)+' · '+data.leaves.length+' leaves · '+data.agentCount+' agents'+(data.parallel?' · parallel '+data.parallel:'');
 $('tiles').innerHTML=data.leaves.map(function(l,i){return '<span class="tile '+l.status+'" title="leaf '+l.n+' '+l.status+'" data-i="'+i+'"></span>'}).join('');
 var shown=data.leaves.map(function(l,i){return {l:l,i:i}}).filter(function(o){return !f||(o.l.task+' '+o.l.log.join(' ')+' leaf'+o.l.n).toLowerCase().indexOf(f)>=0});
 $('leaves').innerHTML=shown.map(function(o){var l=o.l;
  var ag=l.agents.map(function(a){return '<div class=arow><span class=arole>'+a.role+'</span><span class=abar style="width:'+Math.min(200,Math.max(2,a.sec/2))+'px"></span><span class=dim>'+a.sec+'s</span></div>'}).join('');
  return '<div class="leaf '+l.status+'" data-i="'+o.i+'"><div class=leafhead><b>leaf '+l.n+'</b><span class="badge '+l.status+'">'+l.status+'</span>'+(l.tier?'<span class=dim>'+l.tier+'</span>':'')+'<span class=dim>'+fmt(l.sec)+'</span>'+(l.repaired?' <span class=dim>↻ repaired</span>':'')+(l.discovered?' <span class=dim>+'+l.discovered+' disc</span>':'')+'</div><div class=task>'+esc(l.task||'(no title)')+'</div><div class=detail>'+ag+'<pre>'+esc(l.log.join('\\n'))+'</pre></div></div>'
 }).join('')||'<div class=dim>no leaves yet</div>';
 var max=Math.max.apply(null,[1].concat(data.roles.map(function(r){return r.sec})));
 $('roles').innerHTML=data.roles.map(function(r){return '<div class=arow><span class=arole>'+r.role+'</span><span class=abar style="width:'+(r.sec/max*150)+'px;background:var(--accent)"></span><span class=dim>'+fmt(r.sec)+'</span></div>'}).join('')||'<div class=dim>—</div>';
 var lg=$('log'),atB=lg.scrollTop+lg.clientHeight>=lg.scrollHeight-24;
 lg.textContent=data.recent.filter(function(l){return !f||l.toLowerCase().indexOf(f)>=0}).join('\\n');if(atB)lg.scrollTop=lg.scrollHeight;
 $('meta').textContent='· '+data.status;
 $('pulse').style.background=data.done?'var(--accent)':(data.alive?'var(--green)':'var(--red)');
}
$('leaves').onclick=function(e){var c=e.target.closest('.leaf');if(c)c.classList.toggle('open')};
$('tiles').onclick=function(e){var i=e.target.getAttribute('data-i');if(i!=null){var c=$('leaves').children[i];if(c){c.classList.add('open');c.scrollIntoView({block:'center'})}}};
$('filter').oninput=render;
function tick(){fetch('/api').then(function(r){return r.json()}).then(function(d){data=d;render()}).catch(function(){$('meta').textContent='· (server stopped)';$('pulse').style.background='var(--red)'})}
tick();setInterval(tick,2000);
</script>`

if (has('--serve')) {
  const port = Number(arg('--port', 8787))
  createServer((req, res) => {
    if (req.url.startsWith('/api')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(parseRun()))
    } else {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
    }
  }).listen(port, () => console.log(`slice dashboard → http://localhost:${port}\n  repo: ${repo}  log: ${logFile}\n  open it in a browser (live graphical UI, auto-refresh 2s). Ctrl-C to stop.`))
} else if (has('--watch')) {
  let wasAlive = false
  const tick = () => {
    const s = snapshot()
    wasAlive = wasAlive || s.alive
    process.stdout.write('\x1b[2J\x1b[H' + s.text + '\n\n(live · 2s · Ctrl-C to stop)\n')
    if (s.done || (wasAlive && !s.alive)) { process.stdout.write('\n— run ended —\n'); process.exit(0) }
  }
  tick()
  const iv = setInterval(tick, 2000)
  process.on('SIGINT', () => { clearInterval(iv); process.stdout.write('\n'); process.exit(0) })
} else {
  console.log(snapshot().text)
}
