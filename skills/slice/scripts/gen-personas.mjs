#!/usr/bin/env node
// Generate the 4 standalone role-agent files agents/slice-<role>.md from the SINGLE
// source of truth — the R_* persona constants in src/prompts.ts.
// (ITEM 10: the Assessor was folded INTO the Slicer — there is no slice-assessor.md anymore.)
//
// WHY this exists: agents/*.md and src/prompts.ts used to be hand-maintained mirrors of
// the same persona text. They drifted silently (the build had a grep "drift-guard" that
// could only catch ONE class of drift — a dropped schema field reappearing). Generation
// makes drift IMPOSSIBLE: the body of each .md is now literally the R_* constant, so the
// constant is the only place persona text lives. build-engine.sh calls this after tsc and
// then asserts `git diff --quiet` over agents/ — i.e. generation is idempotent and the
// committed .md already match the constants (a build fails LOUDLY if anyone hand-edited an
// .md or changed a constant without regenerating).
//
// Frontmatter (name/description/tools/model) is NOT in the constants — it is the agent's
// REGISTRATION metadata (read by the plugin/marketplace so the Agent tool registers each
// subagent). It is pinned per-role in ROLES below so the generated files register and
// behave IDENTICALLY to the hand-written originals. The BODY is the constant verbatim.
//
// Only the 4 REAL standalone agents are generated. R_VERIFY_LIGHT / R_CRITIC / R_COORD are
// INTERNAL personas (inlined into engine prompts at runtime; never dispatched as a standalone
// agentType — the only standalone agentType the engine spawns is the built-in 'Explore'), so
// they have no .md today and none is generated for them.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const AGENTS_DIR = join(ROOT, 'agents')

// Import the persona constants straight from the TS source (Node strips the types). This is the
// ONLY source of the body text — change a persona by editing src/prompts.ts, then rebuild.
const P = await import(join(ROOT, 'src', 'prompts.ts'))

// Per-role REGISTRATION frontmatter (pinned — NOT derived from the constants) + which constant
// supplies the body. Editing the body text here is impossible by construction: it comes from `const`.
const ROLES = [
  {
    file: 'slice-baseliner.md',
    const: 'R_BASELINE',
    name: 'slice-baseliner',
    description:
      'Establishes the trust invariant before any work begins — what must stay true (tests, behaviors, metrics) and how to measure it (the green/red signal). Run once at the root of a decomposition.',
    tools: 'Read, Grep, Glob, Bash',
    model: 'sonnet',
  },
  {
    // ITEM 10: the Assessor is folded INTO the Slicer — ONE 'decompose' role is both the recursion
    // termination condition (execute|slice|spike, bias HARD to execute) AND the cut. There is no
    // separate slice-assessor.md anymore; R_SLICE carries the former assessor's anti-over-decomposition
    // bias verbatim.
    file: 'slice-slicer.md',
    const: 'R_SLICE',
    name: 'slice-slicer',
    description:
      "Decides one task's next action (execute / slice / spike — biased HARD toward execute, the recursion termination condition) AND, when slicing, decomposes it into thin, VERTICAL, independently-verifiable slices, ordered by dependency, each with a compact contract AND a fixed interface. Owns interface design (it sees all siblings; leaves don't). Embodies Beck's Slicing + Symmetry + Isolation.",
    tools: 'Read, Grep, Glob, Bash',
    model: 'sonnet',
  },
  {
    file: 'slice-executor.md',
    const: 'R_EXEC',
    name: 'slice-executor',
    description:
      'Executes ONE atomic task end-to-end with Canon TDD discipline — call-your-shot, one-test-at-a-time, two hats (behavior then structure), non-optional refactor — against a fixed interface, producing evidence verified against the baseline. The leaf worker.',
    tools: 'Read, Edit, Write, Grep, Glob, Bash',
    model: 'sonnet',
  },
  {
    file: 'slice-verifier.md',
    const: 'R_VERIFY',
    name: 'slice-verifier',
    description:
      'Adversarially verifies a completed leaf against the baseline — hunts false greens (vacuous tests, over-fit implementations), silent behavior changes, and interface drift. The trust gate; defaults to skeptical.',
    tools: 'Read, Grep, Glob, Bash',
    model: 'sonnet',
  },
]

// Deterministic byte-for-byte render: frontmatter block, generated-banner, then the constant verbatim.
function render(role) {
  const body = P[role.const]
  if (typeof body !== 'string' || !body) {
    throw new Error(`gen-personas: constant ${role.const} missing/empty in src/prompts.ts`)
  }
  const frontmatter = [
    '---',
    `name: ${role.name}`,
    `description: ${role.description}`,
    `tools: ${role.tools}`,
    `model: ${role.model}`,
    '---',
  ].join('\n')
  // The banner makes the file's GENERATED status self-documenting; it points editors at the
  // single source of truth so no one re-introduces a hand-mirror.
  const banner =
    `> **GENERATED — do not edit.** This file is produced by \`scripts/gen-personas.mjs\` from ` +
    `\`${role.const}\` in \`src/prompts.ts\` (the single source of truth). Edit the constant and run ` +
    `\`sh scripts/build-engine.sh\` to regenerate; the build fails if this file is hand-edited or out of sync.`
  return `${frontmatter}\n\n${banner}\n\n${body}\n`
}

let changed = 0
for (const role of ROLES) {
  const path = join(AGENTS_DIR, role.file)
  const next = render(role)
  let prev = ''
  try {
    prev = await readFile(path, 'utf8')
  } catch {
    /* new file */
  }
  if (prev !== next) {
    await writeFile(path, next, 'utf8')
    changed++
    console.log(`gen-personas: wrote ${role.file}`)
  }
}
console.log(`gen-personas: ${ROLES.length} role agent(s) generated from src/prompts.ts (${changed} changed)`)
