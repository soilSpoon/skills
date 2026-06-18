#!/usr/bin/env node
// slice-status — progress view for a native-exec (run.mjs) slice run. The Workflow runtime gets a
// /workflows tree from the harness; a standalone Node process does NOT. This reconstructs an equivalent
// from out-of-band signals (process table, git, the engine log). Three modes: one-shot CLI snapshot,
// --watch (live terminal redraw), and --serve (a LOCAL GRAPHICAL WEB DASHBOARD: a HIERARCHICAL phase
// tree — Baseline / Plan / Work→leaves / Coordinate / Integrate — each node collapsible with its own
// agents + log window + duration, plus a phase stepper, role-timing bars, light/dark). DX is a trust axis.
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
  const seq = /falling back to sequential|requested but skipped → SEQUENTIAL/.test(log)
  const gids = [...new Set([...log.matchAll(/\bg(\d+):/g)].map((m) => m[1]))].sort()
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

// ── STRUCTURED parse → a HIERARCHICAL phase tree (the graphical dashboard renders this) ───────────
// Phases (Baseline/Plan/Work/Coordinate/Integrate) are segmented by log markers + time-windows; agents
// and log lines are bucketed into each phase's [t0,t1]; Work's leaves are sub-nodes with their OWN
// window. Every node is {id,title,status,sec,summary,agents,log,children} — uniform + recursive so the
// page renderer is a single recursive function and every level collapses independently.
function parseRun() {
  const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : ''
  const raw = log.split('\n').filter((l) => l.trim())
  const secOf = (l) => { const m = l.match(/\[\+(\d+):(\d+)\]/); return m ? +m[1] * 60 + +m[2] : null }
  const body = (l) => l.replace(/^\[\+[\d:]+\]\s*/, '')
  // carry timestamps forward so continuation lines inherit the last stamp
  let cur = 0
  const lines = raw.map((l) => { const s = secOf(l); if (s != null) cur = s; return { t: cur, stamped: s != null, text: body(l) } })
  const alive = psCount('run\\.mjs') > 0
  const builds = psCount('xcodebuild') + psCount('swift-frontend')
  let done = null
  if (outFile && existsSync(outFile)) { try { const d = JSON.parse(readFileSync(outFile, 'utf8')); done = d.error ? 'error' : 'ok' } catch {} }
  const verdictLine = lines.find((l) => /^Overall verdict:/.test(l.text))
  if (!done && verdictLine) done = /NOT TRUSTED/.test(verdictLine.text) ? 'not-trusted' : 'trusted'
  let elapsed = 0
  for (let i = raw.length - 1; i >= 0; i--) { const s = secOf(raw[i]); if (s != null) { elapsed = s; break } }

  const roleOf = (lbl) => {
    const x = lbl.replace(/^(g\d+|seq\d+):/, '')
    if (/^exec/.test(x)) return 'executor'
    if (/^(verify|leaf-verify|merge-verify|integration|verifier)/.test(x)) return 'verifier'
    if (/slice|partition|decompose/.test(x)) return 'slicer'
    if (/critic/.test(x)) return 'critic'
    if (/baselin/.test(x)) return 'baseliner'
    if (/spike/.test(x)) return 'spiker'
    if (/coord|merge-conflict/.test(x)) return 'coordinator'
    if (/owner-briefing|brief/.test(x)) return 'briefing'
    if (/wiring/.test(x)) return 'auditor'
    return x.split(':')[0] || 'agent'
  }
  const agents = lines.map((l) => { const m = l.text.match(/^· agent (.+?) (\d+)s\s*$/); return m ? { t: l.t, label: m[1], sec: +m[2], role: roleOf(m[1]) } : null }).filter(Boolean)
  const roleMap = {}
  for (const a of agents) roleMap[a.role] = (roleMap[a.role] || 0) + a.sec
  const roles = Object.entries(roleMap).map(([role, sec]) => ({ role, sec })).sort((a, b) => b.sec - a.sec)

  // bucket agents + meaningful (non-agent-timing) log lines into a window (t0, t1]. exTop makes the
  // top STRICT so an agent landing exactly on a phase boundary (e.g. the first executor, whose timing
  // line lands at the Plan→Work split) is attributed to the NEXT phase, not double-counted in this one.
  const inWin = (t0, t1, exTop) => ({
    agents: agents.filter((a) => a.t > t0 && (exTop ? a.t < t1 : a.t <= t1)).map((a) => ({ role: a.role, label: a.label, sec: a.sec })),
    log: lines.filter((l) => l.stamped && l.t > t0 && (exTop ? l.t < t1 : l.t <= t1) && !/^· agent /.test(l.text)).map((l) => l.text).slice(0, 60),
  })

  // ── markers ──
  const at = (re) => { const l = lines.find((x) => re.test(x.text)); return l ? l.t : null }
  const tBaseline = at(/baseline pinned at|^Baseline:/)
  const parallelM = (log.match(/parallel plan: (\d+) independent/) || [])[1]
  const sequential = /falling back to sequential|requested but skipped → SEQUENTIAL|→ SEQUENTIAL/.test(log) || !parallelM
  const planReason = (log.match(/SEQUENTIAL\. Reason: ([^\n.]+)/) || [])[1]
  const planSummary = parallelM ? `parallel · ${parallelM} groups` : 'sequential' + (planReason ? ` · ${planReason}` : '')
  const leafEvents = lines.map((l) => {
    const m = l.text.match(/^(?:(g\d+):)?leaf (\d+) (green|untrusted)\b/)
    return m ? { t: l.t, lane: m[1] || '', n: +m[2], status: m[3], tier: (l.text.match(/tier=([\w-]+)/) || [])[1] || '', gate: (l.text.match(/gate=([\w-]+)/) || [])[1] || '', task: ((l.text.match(/trusted:\s*(.*)$/) || [])[1] || '').slice(0, 90) } : null
  }).filter(Boolean)
  const tFirstExec = (agents.find((a) => /^exec/.test(a.label.replace(/^(g\d+|seq\d+):/, ''))) || {}).t
  const tWorkEnd = leafEvents.length ? leafEvents[leafEvents.length - 1].t : null
  const merges = (log.match(/Merge branch/g) || []).length
  const tCoordEnd = merges ? Math.max(...lines.filter((l) => /Merge branch/.test(l.text)).map((l) => l.t)) : null
  const integ = /FULL SUITE RED|full-suite RED/.test(log) ? 'red' : (/integration OK|Integration:/.test(log) ? 'ok' : null)
  const purposeGaps = (log.match(/(\d+) PURPOSE GAP/) || [])[1]

  // ── boundaries (fallbacks for early/partial runs) ──
  const bBaseEnd = tBaseline != null ? tBaseline : (tFirstExec != null ? tFirstExec : elapsed)
  const bPlanEnd = tFirstExec != null ? tFirstExec : (leafEvents[0] ? leafEvents[0].t : (tBaseline != null ? elapsed : null))
  const workStart = bPlanEnd != null ? bPlanEnd : bBaseEnd

  // ── leaves within Work (each its own sub-window) ──
  // seed one below workStart so the FIRST leaf's window includes the first executor (whose timing
  // lands exactly on workStart); subsequent leaves split on their own end timestamps.
  let prevT = (workStart != null ? workStart : 0) - 1
  const leaves = leafEvents.map((e) => {
    const s0 = prevT, s1 = e.t; prevT = e.t
    const w = inWin(s0, s1)
    const disc = (w.log.join(' ').match(/\+(\d+) discovered/) || [])[1]
    const repaired = w.log.some((l) => /self-repair/.test(l))
    return { id: 'leaf-' + e.n, kind: 'leaf', title: 'leaf ' + e.n + (e.lane ? ' · ' + e.lane : ''), status: e.status === 'green' ? 'green' : 'untrusted', sec: Math.max(0, s1 - s0), summary: [e.tier && 'tier=' + e.tier, e.gate, disc && '+' + disc + ' disc', repaired && '↻ repaired'].filter(Boolean).join(' · '), task: e.task, agents: w.agents, log: w.log, children: [] }
  })

  // ── assemble phase nodes ──
  const phases = []
  // Baseline
  {
    const w = inWin(-1, bBaseEnd)
    const bsLine = (lines.find((l) => /^Baseline:/.test(l.text)) || {}).text || ''
    const st = tBaseline != null ? (/Baseline:.*\bRED\b/.test(log) ? 'red' : 'green') : (alive ? 'active' : 'pending')
    phases.push({ id: 'baseline', kind: 'phase', title: 'Baseline', status: st, sec: tBaseline != null ? tBaseline : (alive ? elapsed : 0), summary: (bsLine.match(/\*\*([^*]+)\*\*/) || [])[1] || (tBaseline != null ? 'pinned' : 'measuring…'), agents: w.agents, log: w.log, children: [] })
  }
  // Plan
  if (tBaseline != null || leafEvents.length) {
    const end = bPlanEnd != null ? bPlanEnd : elapsed
    const w = inWin(bBaseEnd, end, true)
    const st = tFirstExec != null || leafEvents.length ? 'green' : (alive ? 'active' : 'green')
    phases.push({ id: 'plan', kind: 'phase', title: 'Plan', status: st, sec: Math.max(0, end - bBaseEnd), summary: planSummary, agents: w.agents, log: w.log, children: [] })
  }
  // Work
  if (workStart != null && (leafEvents.length || (alive && tFirstExec != null))) {
    const wEnd = tWorkEnd != null ? tWorkEnd : elapsed
    const children = leaves.slice()
    if (alive && !done && tWorkEnd == null && tFirstExec != null) {
      const s0 = leaves.length ? leafEvents[leafEvents.length - 1].t : workStart
      const w = inWin(s0, elapsed)
      if (w.agents.length || w.log.length) children.push({ id: 'leaf-running', kind: 'leaf', title: 'leaf ' + leaves.length + ' · running', status: 'running', sec: Math.max(0, elapsed - s0), summary: 'in progress', task: '', agents: w.agents, log: w.log, children: [] })
    }
    const trusted = leaves.filter((l) => l.status === 'green').length
    phases.push({ id: 'work', kind: 'phase', title: 'Work', status: tWorkEnd != null && !alive ? (leaves.length && leaves.every((l) => l.status === 'green') ? 'green' : 'mixed') : 'active', sec: Math.max(0, wEnd - workStart), summary: children.length + ' leaves · ' + trusted + ' trusted', agents: [], log: [], children })
  }
  // Coordinate (parallel merges only)
  if (merges) {
    const w = inWin(tWorkEnd != null ? tWorkEnd : 0, tCoordEnd != null ? tCoordEnd : elapsed)
    phases.push({ id: 'coordinate', kind: 'phase', title: 'Coordinate', status: done ? 'green' : 'active', sec: Math.max(0, (tCoordEnd != null ? tCoordEnd : elapsed) - (tWorkEnd != null ? tWorkEnd : 0)), summary: merges + ' merged', agents: w.agents, log: w.log, children: [] })
  }
  // Integrate
  const integStart = tCoordEnd != null ? tCoordEnd : tWorkEnd
  if ((integStart != null && (elapsed > integStart || integ != null)) || (done && tWorkEnd != null)) {
    const w = inWin(integStart != null ? integStart : 0, elapsed)
    const st = integ === 'red' ? 'red' : integ === 'ok' ? 'green' : (alive ? 'active' : 'pending')
    phases.push({ id: 'integrate', kind: 'phase', title: 'Integrate', status: st, sec: Math.max(0, elapsed - (integStart != null ? integStart : elapsed)), summary: [integ === 'red' ? 'full-suite RED' : integ === 'ok' ? 'full-suite green' : null, purposeGaps && purposeGaps + ' purpose-gap'].filter(Boolean).join(' · ') || 'integrating…', agents: w.agents, log: w.log, children: [] })
  }

  // canonical 5-step stepper (shows the whole pipeline even before a phase starts)
  const byTitle = {}; phases.forEach((p) => { byTitle[p.title] = p.status })
  const stepper = ['Baseline', 'Plan', 'Work', 'Coordinate', 'Integrate'].map((t) => ({ title: t, status: byTitle[t] || (t === 'Coordinate' && sequential ? 'skipped' : 'pending') }))

  const status = done ? 'done · ' + done : alive ? (builds ? 'building (' + builds + ')' : 'thinking') : 'not running'
  const verdict = verdictLine ? { trusted: !/NOT TRUSTED/.test(verdictLine.text), line: verdictLine.text.replace(/^Overall verdict:\s*/, '').slice(0, 160) } : null
  return { status, alive: !!alive, done, elapsed, agentCount: agents.length, verdict, stepper, tree: phases, roles, recent: lines.slice(-60).map((l) => l.text) }
}

// ── the graphical dashboard page (zero-dep; inner JS uses string concat to avoid nested backticks) ─
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>slice · live</title>
<style>
 :root{--bg:#0b0e14;--panel:#11151c;--border:#1e2430;--fg:#cdd6f4;--dim:#6c7086;--accent:#89b4fa;--green:#a6e3a1;--red:#f38ba8;--yellow:#f9e2af;--bar:#45475a}
 [data-theme=light]{--bg:#f6f7f9;--panel:#fff;--border:#e2e5ea;--fg:#1c1f26;--dim:#8a8f99;--accent:#1e66f5;--green:#107a3e;--red:#d20f39;--yellow:#b07d00;--bar:#cfd3da}
 *{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:0;padding:16px;transition:background .15s,color .15s}
 .top{display:flex;align-items:center;gap:10px;margin:0 0 12px;flex-wrap:wrap}h1{font-size:14px;color:var(--accent);margin:0;font-weight:600}
 .dim{color:var(--dim)}button{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer;font:inherit;font-size:12px}
 .top button{margin-left:auto}.pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);animation:p 2s infinite}@keyframes p{50%{opacity:.25}}
 .verdict{padding:8px 12px;border-radius:8px;border:1px solid var(--border);margin-bottom:12px;font-size:12px}
 .verdict.bad{border-color:var(--red);color:var(--red)}.verdict.good{border-color:var(--green);color:var(--green)}
 .stepper{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
 .step{padding:4px 14px;border-radius:20px;border:1px solid var(--border);color:var(--dim);font-size:12px}
 .step .d{font-size:11px;opacity:.7;margin-left:6px}
 .step.green{color:var(--green);border-color:var(--green)}.step.red{color:var(--red);border-color:var(--red)}.step.mixed{color:var(--yellow);border-color:var(--yellow)}
 .step.active{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}.step.skipped{opacity:.4}
 .cols{display:grid;grid-template-columns:minmax(360px,1.4fr) minmax(280px,1fr);gap:16px}@media(max-width:820px){.cols{grid-template-columns:1fr}}
 .lbl{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
 .lbl button{padding:2px 8px;font-size:11px}
 input{background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px}
 .node{border-left:2px solid transparent}
 .nrow{display:flex;align-items:center;gap:7px;padding:5px 8px;border-radius:7px;cursor:pointer;flex-wrap:wrap}
 .nrow:hover{background:var(--panel)}
 .tw{display:inline-block;width:10px;color:var(--dim);transition:transform .12s;flex-shrink:0}.node.open>.nrow .tw{transform:rotate(90deg)}
 .dot{width:9px;height:9px;border-radius:50%;background:var(--bar);flex-shrink:0}
 .dot.green{background:var(--green)}.dot.red{background:var(--red)}.dot.untrusted{background:var(--red)}.dot.mixed{background:var(--yellow)}
 .dot.active,.dot.running{background:var(--yellow);animation:p 1.5s infinite}.dot.pending,.dot.skipped{background:var(--bar)}
 .nrow .sec{margin-left:auto;color:var(--dim);font-size:12px}
 .ndetail{display:none;padding:4px 0 8px 18px;margin-left:6px;border-left:1px solid var(--border)}.node.open>.ndetail{display:block}
 .task{color:var(--dim);font-size:12px;margin:2px 0 8px;white-space:pre-wrap}
 .arow{display:flex;align-items:center;gap:8px;margin:3px 0;font-size:12px}.arole{width:120px;color:var(--dim);flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .abar{height:10px;background:var(--accent);border-radius:3px;min-width:3px}
 pre{background:var(--bg);border:1px solid var(--border);border-radius:7px;padding:9px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:300px;font-size:11px;color:var(--dim)}
 #log{max-height:74vh}
</style>
<div class=top><h1>slice <span class=pulse id=pulse></span></h1><span class=dim id=meta></span><button id=theme>◐ theme</button></div>
<div id=verdict></div>
<div class=stepper id=stepper></div>
<div class=cols>
 <div><div class=lbl>phases <button id=expand>expand all</button><button id=collapse>collapse all</button></div><div id=tree></div></div>
 <div><div class=lbl>role time</div><div id=roles></div><div class=lbl style="margin-top:14px">engine log <input id=filter placeholder=filter style="margin-left:auto"></div><pre id=log></pre></div>
</div>
<script>
var root=document.documentElement,sv=localStorage.getItem('slice-theme');
if(sv)root.dataset.theme=sv;else if(matchMedia('(prefers-color-scheme: light)').matches)root.dataset.theme='light';
function $(i){return document.getElementById(i)}
$('theme').onclick=function(){var t=root.dataset.theme==='light'?'dark':'light';root.dataset.theme=t;localStorage.setItem('slice-theme',t)};
function esc(s){return (s||'').replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
function fmt(s){return s>=60?(Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60)):(s+'s')}
var openSet=JSON.parse(localStorage.getItem('slice-open')||'null'),seeded=!!openSet;openSet=openSet||{};
function saveOpen(){localStorage.setItem('slice-open',JSON.stringify(openSet))}
var data={stepper:[],tree:[],roles:[],recent:[],agentCount:0,elapsed:0,status:'',verdict:null};
function node(n){
 var has=(n.agents&&n.agents.length)||(n.log&&n.log.length)||(n.children&&n.children.length)||n.task;
 var open=has&&openSet[n.id]?' open':'';
 var tw=has?'<span class=tw>&#9654;</span>':'<span class=tw style="opacity:.25">&#183;</span>';
 var row='<div class=nrow data-id="'+n.id+'">'+tw+'<span class="dot '+n.status+'"></span><b>'+esc(n.title)+'</b>'+(n.summary?' <span class=dim>'+esc(n.summary)+'</span>':'')+(n.sec?'<span class=sec>'+fmt(n.sec)+'</span>':'')+'</div>';
 var inner='';
 if(has){
  if(n.task)inner+='<div class=task>'+esc(n.task)+'</div>';
  if(n.agents&&n.agents.length){inner+=n.agents.map(function(a){return '<div class=arow><span class=arole title="'+esc(a.label||a.role)+'">'+esc(a.label||a.role)+'</span><span class=abar style="width:'+Math.min(220,Math.max(3,a.sec/2))+'px"></span><span class=dim>'+a.sec+'s</span></div>'}).join('')}
  if(n.children&&n.children.length)inner+=n.children.map(node).join('');
  if(n.log&&n.log.length)inner+='<pre>'+esc(n.log.join('\\n'))+'</pre>';
 }
 return '<div class="node'+open+'">'+row+(has?'<div class=ndetail>'+inner+'</div>':'')+'</div>';
}
function ids(tree,acc){tree.forEach(function(n){if((n.agents&&n.agents.length)||(n.log&&n.log.length)||(n.children&&n.children.length)||n.task)acc[n.id]=1;if(n.children)ids(n.children,acc)});return acc}
function render(){
 if(!seeded){data.tree.forEach(function(p){if(p.status==='active'||p.status==='red')openSet[p.id]=1});seeded=true}
 $('stepper').innerHTML=data.stepper.map(function(s){return '<span class="step '+s.status+'">'+s.title+'<span class=d>'+(s.status==='pending'?'':s.status)+'</span></span>'}).join('');
 if(data.verdict){$('verdict').innerHTML='<div class="verdict '+(data.verdict.trusted?'good':'bad')+'">'+(data.verdict.trusted?'\\u2713 TRUSTED':'\\u2717 NOT TRUSTED')+' \\u2014 '+esc(data.verdict.line)+'</div>'}else{$('verdict').innerHTML=''}
 $('tree').innerHTML=data.tree.map(node).join('')||'<div class=dim>no run yet</div>';
 var max=Math.max.apply(null,[1].concat(data.roles.map(function(r){return r.sec})));
 $('roles').innerHTML=data.roles.map(function(r){return '<div class=arow><span class=arole>'+r.role+'</span><span class=abar style="width:'+(r.sec/max*150)+'px"></span><span class=dim>'+fmt(r.sec)+'</span></div>'}).join('')||'<div class=dim>\\u2014</div>';
 var f=($('filter').value||'').toLowerCase(),lg=$('log'),atB=lg.scrollTop+lg.clientHeight>=lg.scrollHeight-24;
 lg.textContent=data.recent.filter(function(l){return !f||l.toLowerCase().indexOf(f)>=0}).join('\\n');if(atB)lg.scrollTop=lg.scrollHeight;
 $('meta').textContent='\\u00b7 '+data.status+' \\u00b7 +'+fmt(data.elapsed)+' \\u00b7 '+data.agentCount+' agents';
 $('pulse').style.background=data.done?'var(--accent)':(data.alive?'var(--green)':'var(--red)');
}
$('tree').onclick=function(e){var r=e.target.closest('.nrow');if(!r)return;var id=r.getAttribute('data-id');if(openSet[id])delete openSet[id];else openSet[id]=1;saveOpen();r.parentNode.classList.toggle('open')};
$('expand').onclick=function(){openSet=ids(data.tree,{});saveOpen();render()};
$('collapse').onclick=function(){openSet={};saveOpen();render()};
$('filter').oninput=render;
function tick(){fetch('/api').then(function(r){return r.json()}).then(function(d){data=d;render()}).catch(function(){$('meta').textContent='\\u00b7 (server stopped)';$('pulse').style.background='var(--red)'})}
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
  }).listen(port, () => console.log(`slice dashboard → http://localhost:${port}\n  repo: ${repo}  log: ${logFile}\n  open it in a browser (hierarchical phase tree, live, auto-refresh 2s). Ctrl-C to stop.`))
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
