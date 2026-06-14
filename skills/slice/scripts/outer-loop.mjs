#!/usr/bin/env node
// The OUTER LOOP — DETERMINISTIC PLUMBING for an opt-in, human-gated dispatch heartbeat.
//
// `slice` is a single-run harness; this is the layer ABOVE it. It has TWO faces:
//
//   1) the PLANNER (`--plan`, the historical default): reads docs/BACKLOG.md, classifies each OPEN
//      item by a tier heuristic, and PRINTS a dispatch plan. Pure: no git, no network, no fs writes.
//
//   2) the EXECUTE PLUMBING (subcommands `worktree` / `assert-isolated` / `gated-merge` / `ledger`): the small set of
//      DETERMINISTIC git/fs steps the HARNESS ORCHESTRATION calls between model turns. This script
//      DISPATCHES NOTHING ITSELF — it never invokes slice (which needs the Workflow runtime) nor the
//      grader (a model). The model work is harness-orchestrated per references/outer-loop.md; this
//      file is only the plumbing those steps sit on, so each plumbing step is unit-testable + boring.
//
// The ENGINE IS UNTOUCHED — src/*.ts and recursive-slice.js are never modified or reached into. This
// is a SEPARATE layer that only CALLS git and reads/writes the loop's own files.
//
// THE SAFETY MODEL (full statement in references/outer-loop.md). Principle:
//   autonomy of TRYING (dispatch on a branch) is fine; autonomy of LANDING (merge to main) requires
//   a human-authored spec + a present human. `gated-merge` is the ONE place that touches main, and it
//   is a TRIPLE GATE that defaults to ABORT and leaves main byte-for-byte unchanged on any doubt:
//     [a] refuse if OUTER_LOOP_SCHEDULED is set (scheduled runs are BRANCH-ONLY) or if not on clean main
//     [b] merge --no-ff; on conflict -> abort, leave as branch
//     [c] re-run the integrate gate (build + 41 scenarios); on red -> reset --hard, leave as branch
//     [d] only clean-merge AND green-gate keeps it.
//
// Usage:
//   node scripts/outer-loop.mjs --plan [path/to/BACKLOG.md]     # dry-run classify (default)
//   node scripts/outer-loop.mjs worktree <slug>                 # git worktree add .loop/<slug> -b loop/<slug>
//   node scripts/outer-loop.mjs assert-isolated <work-repo> <main-sha0>  # PROVE a run stayed in its worktree
//   node scripts/outer-loop.mjs gated-merge <branch>            # THE SAFETY GATE (only thing touching main)
//   node scripts/outer-loop.mjs ledger <itemId> <status> [json] # append a status line (no clock)
//   node scripts/outer-loop.mjs ledger --done? <itemId>         # resume query: prints DONE / NOT-DONE
//   node scripts/outer-loop.mjs --execute                       # prints the orchestration procedure + refuses to auto-run

import { readFile, appendFile } from 'node:fs/promises'
import { readFileSync, existsSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BACKLOG = resolve(HERE, '..', '..', '..', 'docs', 'BACKLOG.md')

// ───────────────────────────────────────────────────────────────────────────────────────────────
// PLANNER (unchanged behaviour, now reachable via `--plan` or a bare BACKLOG path)
// ───────────────────────────────────────────────────────────────────────────────────────────────

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
    isolation: 'fresh git worktree on a new branch (NEVER merged to main without the human gate — invariant [b])',
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
      out.push(`      WOULD dispatch (in a branch, gated merge only): slice "${e.lane.task}"`)
      out.push(`        isolation: ${e.lane.isolation}`)
      out.push(`        stop: ${e.lane.stop}`)
    }
  })
  const tally = entries.reduce((a, e) => ((a[e.tier] = (a[e.tier] || 0) + 1), a), {})
  out.push('')
  out.push(`tally: ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join('  ') || '(none)'}`)
  out.push(`note: to EXECUTE a plan, the HARNESS drives the orchestration in references/outer-loop.md`)
  out.push(`      (this script only plumbs the deterministic git/fs steps — it dispatches no model itself)`)
  return out.join('\n')
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// SHARED git plumbing
// ───────────────────────────────────────────────────────────────────────────────────────────────

// Run git, capturing stdout. Throws on non-zero (caller decides how to react). `cwd` defaults to the
// repo containing this script — but every subcommand resolves an explicit repo root first.
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
// A non-throwing variant: returns { ok, out, err, code }.
function gitTry(args, cwd) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { ok: true, out: out.trim(), err: '', code: 0 }
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || e.message || '').toString().trim(), code: e.status ?? 1 }
  }
}

// The repo we operate on: the top-level of the working tree at the CURRENT WORKING DIRECTORY. The
// operator runs these subcommands from inside the checkout they mean to act on (the slice repo for
// real use; a temp fixture under test). In a linked worktree (loop/build) this is the worktree's
// path; git worktree/branch ops still see the shared object store + ref namespace, so `loop/<slug>`
// branches and `main` resolve correctly.
function repoRoot() {
  return git(['rev-parse', '--show-toplevel'], process.cwd())
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// SUBCOMMAND: worktree <slug>
//   git worktree add <root>/.loop/<slug> -b loop/<slug> <main HEAD>; print the path.
//   Idempotent-ish: fail CLEARLY (non-zero) if the branch already exists, rather than silently reusing.
// ───────────────────────────────────────────────────────────────────────────────────────────────
function cmdWorktree(slug) {
  if (!slug || /[^\w.\-/]/.test(slug)) {
    console.error('usage: outer-loop.mjs worktree <slug>   (slug: [A-Za-z0-9_.-/])')
    return 2
  }
  const root = repoRoot()
  const branch = `loop/${slug}`
  const path = join(root, '.loop', slug)

  // Fail clearly if the branch already exists (don't silently reuse / clobber).
  const exists = gitTry(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
  if (exists.ok) {
    console.error(`branch ${branch} already exists — refusing to clobber. Remove it (git branch -D ${branch}) or pick another slug.`)
    return 1
  }
  // Fail clearly if the worktree path is already registered/present.
  if (existsSync(path)) {
    console.error(`worktree path ${path} already exists — remove it (git worktree remove ${path}) or pick another slug.`)
    return 1
  }

  const head = git(['rev-parse', 'main'], root) // base every lane on the CURRENT main HEAD
  const add = gitTry(['worktree', 'add', path, '-b', branch, head], root)
  if (!add.ok) {
    console.error(`git worktree add failed: ${add.err || add.out}`)
    return 1
  }
  console.log(path)
  return 0
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// SUBCOMMAND: assert-isolated <work-repo-path> <expected-main-sha>  — PROVE a dispatched run stayed
//   in its worktree and did NOT leak onto the main clone. Called AFTER a dispatched slice run.
//
//   THE BUG THIS GUARDS (see references/outer-loop.md "Lesson: isolation is not free"): a slice run
//   dispatched with repo=<worktree ROOT> while the engine source lives in a SUBDIR let the baseliner
//   resolve the work-dir to the MAIN CLONE's canonical path, and the executor committed THERE — to
//   local main — bypassing the branch-only worktree entirely. origin was safe (the engine never
//   pushes) but local main diverged silently. This command turns "did it actually stay isolated?"
//   into a DETERMINISTIC, pure-git assertion, so the orchestration can HALT on a leak instead of
//   marking a leaked item done.
//
//   It is PURE GIT READS — no clock, no network, no writes. It:
//     1. resolves the git COMMON DIR from <work-repo-path> (the shared ref/object store all linked
//        worktrees of this checkout share),
//     2. parses `git -C <work-repo-path> worktree list --porcelain` to find, by their canonical
//        common dir (so only worktrees of the SAME checkout count):
//          (a) THIS worktree — the one whose path is <work-repo-path>'s toplevel — its branch + HEAD,
//          (b) the MAIN worktree — the primary checkout, on branch `main`,
//     3. asserts MAIN is STILL at <expected-main-sha> AND its tree is CLEAN (no leak), AND THIS
//        worktree's branch has ADVANCED (>=1 new commit: expected-main-sha is an ancestor of HEAD
//        and HEAD != expected-main-sha).
//   Exit 0 = ISOLATED. Exit non-zero + a LOUD 'LEAK:' line otherwise.
// ───────────────────────────────────────────────────────────────────────────────────────────────

// Parse `git worktree list --porcelain` into records: { path, head, branch|null (short), detached }.
// Porcelain is line-oriented, records separated by a blank line; `branch refs/heads/X` -> short X.
export function parseWorktreePorcelain(text) {
  const records = []
  let cur = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line === '') { if (cur) { records.push(cur); cur = null } ; continue }
    if (line.startsWith('worktree ')) { cur = { path: line.slice('worktree '.length), head: null, branch: null, detached: false } ; continue }
    if (!cur) continue
    if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    else if (line === 'detached') cur.detached = true
  }
  if (cur) records.push(cur)
  return records
}

function cmdAssertIsolated(workRepoPath, expectedMainSha) {
  if (!workRepoPath || !expectedMainSha) {
    console.error('usage: outer-loop.mjs assert-isolated <work-repo-path> <expected-main-sha>')
    return 2
  }
  // The work-repo-path MUST be inside a git worktree (the dispatched run's exact work subdir).
  const top = gitTry(['rev-parse', '--show-toplevel'], workRepoPath)
  if (!top.ok) { console.error(`LEAK-CHECK ABORT: ${workRepoPath} is not inside a git worktree: ${top.err}`); return 2 }
  const thisTop = realpathOrSelf(top.out)

  // The COMMON DIR is the shared ref/object store every linked worktree of this checkout shares.
  // Two worktrees belong to the SAME checkout iff their common dirs are the same canonical path.
  const common = gitTry(['rev-parse', '--git-common-dir'], workRepoPath)
  if (!common.ok) { console.error(`LEAK-CHECK ABORT: cannot resolve git common dir: ${common.err}`); return 2 }
  // git-common-dir may be relative to the worktree — resolve against it, then canonicalize.
  const myCommon = realpathOrSelf(resolve(workRepoPath, common.out))

  // Normalize the expected sha to a full sha so a short-vs-full comparison can't false-positive.
  const expFull = gitTry(['rev-parse', '--verify', '--quiet', `${expectedMainSha}^{commit}`], workRepoPath)
  if (!expFull.ok) { console.error(`LEAK-CHECK ABORT: <expected-main-sha> ${expectedMainSha} does not resolve to a commit.`); return 2 }
  const sha0 = expFull.out

  const wl = gitTry(['worktree', 'list', '--porcelain'], workRepoPath)
  if (!wl.ok) { console.error(`LEAK-CHECK ABORT: cannot list worktrees: ${wl.err}`); return 2 }
  const all = parseWorktreePorcelain(wl.out)

  // Keep only worktrees that share THIS checkout's common dir (defensive — `git -C` already scopes to
  // one checkout, but we re-verify each entry's common dir so a nested/foreign path can't slip in).
  const mine = all.filter((w) => {
    const c = gitTry(['rev-parse', '--git-common-dir'], w.path)
    return c.ok && realpathOrSelf(resolve(w.path, c.out)) === myCommon
  })

  // (a) THIS worktree: the entry whose toplevel matches <work-repo-path>'s toplevel.
  const here = mine.find((w) => realpathOrSelf(w.path) === thisTop)
  if (!here) { console.error(`LEAK-CHECK ABORT: ${workRepoPath} (top ${thisTop}) is not a registered worktree of this checkout.`); return 2 }

  // (b) the MAIN worktree: the primary checkout on branch `main`.
  const mainWt = mine.find((w) => w.branch === 'main')
  if (!mainWt) { console.error(`LEAK-CHECK ABORT: no worktree on branch 'main' found for this checkout — cannot prove isolation.`); return 2 }

  // Guard: a leak to main is invisible if THIS worktree *is* the main worktree (the exact bug shape).
  if (realpathOrSelf(mainWt.path) === thisTop || here.branch === 'main') {
    console.error(`LEAK: the dispatched run's work-dir (${thisTop}) IS the main worktree (branch 'main') — the run targeted main itself, NOT a branch-only worktree. This is the isolation bug: repo must be the worktree's exact work subdir, never a path that resolves to the main clone.`)
    return 1
  }

  // ── ASSERTION 1: MAIN is STILL at expected-main-sha (no commit leaked onto main).
  const sha1 = mainWt.head
  if (sha1 !== sha0) {
    console.error(`LEAK: main clone moved ${sha0.slice(0, 12)}..${sha1.slice(0, 12)} — the run committed to main, NOT the worktree (work-dir ${thisTop}, main worktree ${mainWt.path}).`)
    return 1
  }

  // ── ASSERTION 2: MAIN's tree is CLEAN (no uncommitted leak sitting in the main checkout).
  const mainStatus = gitTry(['status', '--porcelain'], mainWt.path)
  if (!mainStatus.ok) { console.error(`LEAK-CHECK ABORT: cannot read main worktree status: ${mainStatus.err}`); return 2 }
  if (mainStatus.out !== '') {
    console.error(`LEAK: main clone (${mainWt.path}) has an UNCOMMITTED change — the run wrote into the main checkout, NOT the worktree:\n${mainStatus.out}`)
    return 1
  }

  // ── ASSERTION 3: THIS worktree's branch ADVANCED — >=1 new commit on top of expected-main-sha.
  //    HEAD must differ from sha0 AND sha0 must be an ANCESTOR of HEAD (the branch grew FROM main).
  const headHere = here.head
  if (here.detached || !here.branch) {
    console.error(`LEAK: the work-dir worktree (${thisTop}) is detached / has no branch — a dispatched lane must commit on its own loop/<slug> branch.`)
    return 1
  }
  if (headHere === sha0) {
    console.error(`LEAK: the work-dir branch '${here.branch}' is STILL at ${sha0.slice(0, 12)} — the dispatched run produced NO commit in the worktree (it likely committed elsewhere — e.g. main).`)
    return 1
  }
  const ancestor = gitTry(['merge-base', '--is-ancestor', sha0, headHere], workRepoPath)
  if (!ancestor.ok) {
    console.error(`LEAK: expected-main-sha ${sha0.slice(0, 12)} is NOT an ancestor of the work-dir branch '${here.branch}' (${headHere.slice(0, 12)}) — the branch did not advance FROM main; isolation cannot be proven.`)
    return 1
  }
  // Count how many commits the branch advanced (informational, for the success line).
  const cnt = gitTry(['rev-list', '--count', `${sha0}..${headHere}`], workRepoPath)
  const n = cnt.ok ? cnt.out : '?'

  console.log(`isolated: ${n} commits on ${here.branch}, main clone unchanged`)
  return 0
}

// realpath a path; fall back to a normalized resolve if it doesn't exist (e.g. a removed worktree).
function realpathOrSelf(p) {
  try { return realpathSync(p) } catch { return resolve(p) }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// SUBCOMMAND: gated-merge <branch>  — THE SAFETY GATE (the ONLY thing that ever touches main)
//   Merge <branch> into main ONLY if ALL hold; else ABORT, leave main UNCHANGED, print why, exit !=0.
// ───────────────────────────────────────────────────────────────────────────────────────────────
function cmdGatedMerge(branch) {
  if (!branch) { console.error('usage: outer-loop.mjs gated-merge <branch>'); return 2 }
  const root = repoRoot()

  // [a1] SCHEDULED runs are BRANCH-ONLY — never auto-merge to main. Refuse immediately.
  if (process.env.OUTER_LOOP_SCHEDULED) {
    console.error('ABORT: OUTER_LOOP_SCHEDULED is set — scheduled runs are branch-only (never auto-merge to main). Left as branch.')
    return 3
  }

  // [a2] must be ON main and CLEAN. Anything else: refuse before touching the tree.
  const head = gitTry(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)
  if (!head.ok || head.out !== 'main') {
    console.error(`ABORT: not on main (HEAD=${head.ok ? head.out : 'detached'}). gated-merge must run on a clean main checkout. Left as branch.`)
    return 4
  }
  const status = gitTry(['status', '--porcelain'], root)
  if (!status.ok) { console.error(`ABORT: cannot read status: ${status.err}. Left as branch.`); return 4 }
  if (status.out !== '') {
    console.error('ABORT: main working tree is not clean. Commit/stash first. Left as branch.')
    return 4
  }

  // The branch must exist.
  if (!gitTry(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root).ok) {
    console.error(`ABORT: branch ${branch} does not exist. Left unchanged.`)
    return 4
  }

  // [b] MERGE --no-ff --no-edit. On conflict -> merge --abort, report 'conflict, left as branch'.
  const merge = gitTry(['merge', '--no-ff', '--no-edit', branch], root)
  if (!merge.ok) {
    gitTry(['merge', '--abort'], root) // restore main byte-for-byte
    console.error(`ABORT: merge conflict on ${branch} — git merge --abort run. conflict, left as branch.`)
    return 5
  }

  // [c] AFTER a clean merge, re-run the INTEGRATE GATE (build + 41 scenarios). On red -> hard-undo the
  //     merge commit (reset --hard HEAD@{1}) and report 'post-merge red, reverted, left as branch'.
  const skel = process.env.OUTER_LOOP_GATE_CMD // test/escape hatch: a custom gate command (sh -c)
  const gateCmd = skel || 'sh scripts/build-engine.sh && node --test test/scenarios.test.mjs'
  // Run the gate from the merged repo's slice skill dir (where scripts/, test/ live) if it exists,
  // else from the repo root (a custom OUTER_LOOP_GATE_CMD decides what to run).
  const skillDir = existsSync(join(root, 'skills', 'slice')) ? join(root, 'skills', 'slice') : root
  const gate = (() => {
    try {
      execFileSync('sh', ['-c', gateCmd], { cwd: skillDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { ok: true }
    } catch (e) {
      return { ok: false, err: ((e.stdout || '') + (e.stderr || '')).toString().slice(-800) }
    }
  })()
  if (!gate.ok) {
    // Undo the merge commit; HEAD@{1} is the pre-merge tip (reflog entry created by the merge).
    const revert = gitTry(['reset', '--hard', 'HEAD@{1}'], root)
    if (!revert.ok) {
      console.error(`FATAL: post-merge gate RED and the auto-revert (reset --hard HEAD@{1}) FAILED: ${revert.err}. main may be dirty — inspect manually.`)
      return 6
    }
    console.error('ABORT: post-merge gate RED — reset --hard HEAD@{1} run (merge commit undone). post-merge red, reverted, left as branch.')
    return 5
  }

  // [d] clean merge AND green gate — keep it.
  const sha = git(['rev-parse', 'HEAD'], root)
  console.log(`merged ${sha}`)
  return 0
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// SUBCOMMAND: ledger <itemId> <status> [json]  — append a line to docs/loop-status.jsonl
//   Deterministic: NO clock. A timestamp is taken from the optional json arg (`ts`) or omitted.
//   `ledger --done? <itemId>` — resume query: prints DONE if the item's last status is a terminal
//   'done'/'merged', else NOT-DONE. Exit 0 either way (callers read stdout, not exit code).
// ───────────────────────────────────────────────────────────────────────────────────────────────
function ledgerPath() {
  // The ledger lives in the operated repo's docs/. Resolve the repo root from cwd; if we are not in a
  // git repo (rare, e.g. a bare unit harness), fall back to the slice repo's docs/.
  let root
  try { root = repoRoot() } catch { root = resolve(HERE, '..', '..', '..') }
  return join(root, 'docs', 'loop-status.jsonl')
}

async function cmdLedgerAppend(itemId, status, jsonArg) {
  if (!itemId || !status) { console.error('usage: outer-loop.mjs ledger <itemId> <status> [json]'); return 2 }
  let extra = {}
  if (jsonArg) {
    try { extra = JSON.parse(jsonArg) } catch (e) { console.error(`ledger: [json] is not valid JSON: ${e.message}`); return 2 }
    if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) { console.error('ledger: [json] must be a JSON object'); return 2 }
  }
  // itemId/status are the canonical fields; json may carry branch, slug, overallTrust, graderVerdict,
  // synthesizedSpec, ts (a CALLER-supplied timestamp string — we NEVER read the clock), etc.
  const rec = { itemId, status, ...extra }
  await appendFile(ledgerPath(), JSON.stringify(rec) + '\n', 'utf8')
  console.log(`ledger += ${JSON.stringify(rec)}`)
  return 0
}

function readLedger() {
  const p = ledgerPath()
  if (!existsSync(p)) return []
  const lines = readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
  const recs = []
  for (const l of lines) { try { recs.push(JSON.parse(l)) } catch { /* skip a malformed line */ } }
  return recs
}

const TERMINAL_DONE = new Set(['done', 'merged'])

// Last-write-wins per itemId. An item is DONE iff its MOST RECENT status is terminal.
export function isDone(recs, itemId) {
  let last = null
  for (const r of recs) if (r.itemId === itemId) last = r
  return !!last && TERMINAL_DONE.has(String(last.status))
}

function cmdLedgerDone(itemId) {
  if (!itemId) { console.error('usage: outer-loop.mjs ledger --done? <itemId>'); return 2 }
  console.log(isDone(readLedger(), itemId) ? 'DONE' : 'NOT-DONE')
  return 0
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// `--execute` (bare): print the ORCHESTRATION PROCEDURE and REFUSE to auto-run. This script never
// invokes slice or a model — the harness drives the loop per the doc. Exit 0 (informational).
// ───────────────────────────────────────────────────────────────────────────────────────────────
function cmdExecuteRefuse() {
  console.log([
    'OUTER LOOP — --execute is HARNESS-ORCHESTRATED, not script-autonomous.',
    '',
    'This Node script is DETERMINISTIC PLUMBING only. It cannot (by design) invoke slice — slice needs',
    'the Workflow runtime — nor the separate-model grader. So `--execute` does NOT auto-run a loop here.',
    '',
    'To execute a plan, a Claude session (or a scheduled cloud-agent) drives the procedure documented in',
    'references/outer-loop.md, calling these deterministic subcommands between model turns:',
    '  1. --plan                 classify the backlog (this script)',
    '  2. ledger --done? <id>    skip items already landed (resume)',
    '  3. worktree <slug>        isolate the lane on loop/<slug> (this script)',
    '  4. <dispatch slice>       HARNESS runs slice via the Workflow tool IN that worktree, repo=<worktree>/<work-subdir> (NOT this script)',
    '  5. assert-isolated <work-subdir> <main-sha0>  PROVE the run stayed in the worktree; LEAK -> HALT, do NOT mark done (this script)',
    '  6. <grade>                a SEPARATE-MODEL grader judges "resolves the ORIGINAL item intent?" (NOT this script)',
    '  7. gated-merge loop/<slug>  ONLY if manual + --auto-merge-trusted + human-authored spec + trust + grader-OK (this script)',
    '  8. ledger <id> <status>   record the outcome (this script)',
    '',
    'SAFETY: scheduled runs set OUTER_LOOP_SCHEDULED=1 so step 6 is refused (branch-only). A synthesized',
    'lane-spec NEVER auto-merges. See references/outer-loop.md for the full safety model.',
  ].join('\n'))
  return 0
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Dispatch
// ───────────────────────────────────────────────────────────────────────────────────────────────
async function main(argv) {
  const [cmd, ...rest] = argv

  if (cmd === 'worktree') return cmdWorktree(rest[0])
  if (cmd === 'assert-isolated') return cmdAssertIsolated(rest[0], rest[1])
  if (cmd === 'gated-merge') return cmdGatedMerge(rest[0])
  if (cmd === 'ledger') {
    if (rest[0] === '--done?') return cmdLedgerDone(rest[1])
    return await cmdLedgerAppend(rest[0], rest[1], rest[2])
  }
  if (cmd === '--execute') return cmdExecuteRefuse()

  // PLANNER: `--plan [backlog]`, or a bare BACKLOG path, or nothing (default backlog).
  let backlogArg = cmd
  if (cmd === '--plan') backlogArg = rest[0]
  const backlogPath = backlogArg ? resolve(backlogArg) : DEFAULT_BACKLOG
  const md = await readFile(backlogPath, 'utf8').catch((e) => { console.error(`cannot read ${backlogPath}: ${e.message}`); process.exit(1) })
  console.log(render(plan(md), backlogPath))
  return 0
}

// Run only when invoked directly (not when imported by the test). realpathSync both sides so a
// symlinked invocation path (e.g. macOS /tmp -> /private/tmp) still matches import.meta.url.
function sameFile(a, b) {
  try { return realpathSync(a) === realpathSync(b) } catch { return resolve(a) === resolve(b) }
}
if (process.argv[1] && sameFile(process.argv[1], fileURLToPath(import.meta.url))) {
  const code = await main(process.argv.slice(2))
  process.exit(code || 0)
}
