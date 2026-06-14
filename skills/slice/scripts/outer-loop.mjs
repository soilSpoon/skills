#!/usr/bin/env node
// The OUTER LOOP — a minimal, DRY-RUN-BY-DEFAULT, zero-dependency dispatch planner.
//
// `slice` is a single-run harness; this is the heartbeat ABOVE it: it reads docs/BACKLOG.md,
// classifies each OPEN item by a tier heuristic, and PRINTS the dispatch plan. By default it
// dispatches NOTHING — no slice run, no git, no network, no filesystem writes. See
// references/outer-loop.md for the four SAFETY INVARIANTS this layer upholds:
//   [a] OPT-IN/explicit (never runs on its own; default = print-only)
//   [b] DISPATCH-ONLY (a slice run goes in a worktree/branch, NEVER auto-merged to main)
//   [c] SURFACE (the owner's briefing is surfaced for human review before any merge)
//   [d] maker != checker (the "is this item done?" call is graded by a SEPARATE small model)
//
// The ENGINE IS UNTOUCHED — this driver only CALLS existing pieces; it never reaches inside them.
//
// FUTURE (out of scope; documented, NOT implemented here): a `--execute` mode would, for T2 items
// only, create a fresh worktree on a new branch, run `slice` there, surface the briefing, and STOP
// — NEVER merging. Autonomy stays a deliberate, later, human-thrown switch. Default is always dry.
//
// Usage:  node scripts/outer-loop.mjs [path/to/BACKLOG.md]   (dry run — prints the plan)

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BACKLOG = resolve(HERE, '..', '..', '..', 'docs', 'BACKLOG.md')

// Split a BACKLOG.md body into items: one per top-level checklist line. An item's text is its own
// line plus any continuation up to the next checklist line or heading (so multi-line items stay whole).
export function splitItems(md) {
  const lines = md.split('\n')
  const items = []
  let cur = null
  for (const line of lines) {
    const m = /^\s*-\s*\[( |x|X)\]\s*(.*)$/.exec(line)
    if (m) {
      if (cur) items.push(cur)
      cur = { done: m[1].toLowerCase() === 'x', text: m[2], raw: line }
    } else if (cur && line.trim() && !/^#/.test(line)) {
      cur.text += ' ' + line.trim() // fold continuation into the current item
    } else if (/^#/.test(line)) {
      if (cur) { items.push(cur); cur = null } // a heading ends the current item
    }
  }
  if (cur) items.push(cur)
  return items
}

// Classify ONE item's text into a tier. Pure, deterministic, string-only — unit-testable in isolation.
//   T2-slice   — multi-leaf / unknown decomposition / "migrate"/"refactor across" shape -> dispatch slice
//   T1-inline  — a diagnosed single-line / known fix -> a single inline agent, NOT the engine
//   T0         — trivial (doc/comment/rename) -> noted, not worth a harness
export function classify(text) {
  const t = text.toLowerCase()
  // T2: the slice-shaped work. Cross-cutting verbs, explicit multi-leaf, or "unknown decomposition".
  const t2 = /\bmigrat|refactor across|across the (app|codebase|repo)|rewrite|multi-?file|several (files|modules)|decompos|≥\s*2|>=\s*2\b|two or more (leaves|files)|unknown decomposition|risky (leaves|leaf)/.test(t)
    || /\bleaf\b/.test(t) && /\bconcurren|schedul|pipeline/.test(t)
  if (t2) return { tier: 'T2-slice', reason: 'multi-leaf / unknown decomposition / cross-cutting' }
  // T0: trivial cosmetic-only changes.
  if (/^\s*(doc|docs|typo|comment|rename|whitespace|formatting|spelling)\b/.test(t)
      || /\b(doc-only|comment-only|typo fix|fix a typo|update the readme)\b/.test(t)) {
    return { tier: 'T0', reason: 'trivial cosmetic' }
  }
  // T1: a diagnosed, single, known fix — the "do it directly" case.
  if (/\bsingle[- ]line|one[- ]line(r)?|diagnosed|known fix|add (a |one )?(guard|fallback|field|flag)|one assertion|already (located|pinpointed)|pin(ned)? to a line|exactly one\b/.test(t)) {
    return { tier: 'T1-inline', reason: 'diagnosed single/known fix' }
  }
  // Default: when shape is ambiguous, prefer the SAFER, more-scrutinized harness (slice), never inline.
  return { tier: 'T2-slice', reason: 'ambiguous shape — default to the more-scrutinized harness' }
}

// The slice lane-spec a T2 item WOULD be dispatched with (printed only; never executed here).
export function laneSpec(item) {
  const task = item.text.replace(/\s+/g, ' ').trim().slice(0, 160)
  return {
    tool: 'slice',
    task,
    isolation: 'fresh git worktree on a new branch (NEVER merged to main — invariant [b])',
    stop: 'surface owner\'s briefing for human review (invariant [c]); done/not-done graded by a SEPARATE small model (invariant [d])',
  }
}

export function plan(md) {
  return splitItems(md)
    .filter((it) => !it.done) // only OPEN items are candidates for dispatch
    .map((it) => {
      const c = classify(it.text)
      return { tier: c.tier, reason: c.reason, text: it.text, lane: c.tier === 'T2-slice' ? laneSpec(it) : null }
    })
}

function render(entries, backlogPath) {
  const out = []
  out.push(`OUTER LOOP — DRY RUN (dispatches NOTHING; prints plan only)`)
  out.push(`backlog: ${backlogPath}`)
  out.push(`open items: ${entries.length}`)
  out.push('')
  entries.forEach((e, i) => {
    const head = e.text.replace(/\s+/g, ' ').trim().slice(0, 90)
    out.push(`${String(i + 1).padStart(2)}. [${e.tier}] ${head}${e.text.length > 90 ? '…' : ''}`)
    out.push(`      reason: ${e.reason}`)
    if (e.lane) {
      out.push(`      WOULD dispatch (in a branch, never merged): slice "${e.lane.task}"`)
      out.push(`        isolation: ${e.lane.isolation}`)
      out.push(`        stop: ${e.lane.stop}`)
    }
  })
  const tally = entries.reduce((a, e) => ((a[e.tier] = (a[e.tier] || 0) + 1), a), {})
  out.push('')
  out.push(`tally: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`)
  out.push(`note: --execute (T2-in-a-branch, never-merge) is NOT implemented — dispatch-only, see references/outer-loop.md`)
  return out.join('\n')
}

// Run only when invoked directly (not when imported by the test). DRY: no git/slice/network/fs-write.
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--execute')) {
    console.error('--execute is not implemented (dispatch-only by design). See references/outer-loop.md.')
    process.exit(2)
  }
  const backlogPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_BACKLOG
  const md = await readFile(backlogPath, 'utf8').catch((e) => { console.error(`cannot read ${backlogPath}: ${e.message}`); process.exit(1) })
  console.log(render(plan(md), backlogPath))
}
