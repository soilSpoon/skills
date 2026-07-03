#!/usr/bin/env node
/**
 * Ensure dev-router target skills exist for the active harness.
 * Cross-tool: npx skills add (most agents) · git copy (Grok) · path probe (all).
 */
import { spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILL_DIR = resolve(__dirname, '..')
const HOME = homedir()

/** @type {Record<string, string>} */
const SOURCES = {
  'dev-router': 'soilSpoon/skills@dev-router',
  'ux-fundamentals': 'soilSpoon/skills@ux-fundamentals',
  'code-fundamentals': 'soilSpoon/skills@code-fundamentals',
  'toss-frontend-fundamentals': 'soilSpoon/skills@toss-frontend-fundamentals',
  'technical-writing': 'soilSpoon/skills@technical-writing',
  'ux-writing': 'soilSpoon/skills@ux-writing',
  'commit-pr-checklist': 'soilSpoon/skills@commit-pr-checklist',
  'build-config-drift': 'soilSpoon/skills@build-config-drift',
  'issue-rootcause-workflow': 'soilSpoon/skills@issue-rootcause-workflow',
  'test-foundations': 'soilSpoon/skills@test-foundations',
  'spec-first': 'soilSpoon/skills@spec-first',
  slice: 'soilSpoon/skills@slice',
  'vercel-react-best-practices': 'vercel-labs/agent-skills@react-best-practices',
  'vercel-composition-patterns': 'vercel-labs/agent-skills@composition-patterns',
}

/** @type {Record<string, string[]>} */
const ROUTE_BUNDLES = {
  react: [
    'ux-fundamentals',
    'vercel-react-best-practices',
    'vercel-composition-patterns',
    'toss-frontend-fundamentals',
  ],
  ship: ['commit-pr-checklist', 'code-fundamentals', 'technical-writing'],
  bug: ['issue-rootcause-workflow', 'test-foundations'],
  ux: ['ux-fundamentals'],
  minimal: ['dev-router', 'ux-fundamentals', 'code-fundamentals'],
}

/** Vercel skills install under different folder names */
const DIR_ALIASES = {
  'vercel-react-best-practices': ['react-best-practices', 'vercel-react-best-practices'],
  'vercel-composition-patterns': [
    'composition-patterns',
    'vercel-composition-patterns',
  ],
}

const SOILSPOON_MARKETPLACE = join(
  HOME,
  '.claude/plugins/marketplaces/soilspoon-skills/skills',
)

function repoRoot() {
  let dir = process.cwd()
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

/** @returns {{ id: string, npxAgent: string | null, global: string[], project: string[] }[]} */
function harnessDefs(root) {
  return [
    {
      id: 'grok',
      npxAgent: null,
      when: () =>
        existsSync(join(HOME, '.grok')) || existsSync(join(root, '.grok')),
      global: [join(HOME, '.grok/skills')],
      project: [join(root, '.grok/skills')],
    },
    {
      id: 'claude-code',
      npxAgent: 'claude-code',
      when: () =>
        existsSync(join(HOME, '.claude')) || existsSync(join(root, '.claude')),
      global: [join(HOME, '.claude/skills')],
      project: [join(root, '.claude/skills')],
    },
    {
      id: 'droid',
      npxAgent: 'droid',
      when: () =>
        existsSync(join(HOME, '.factory')) || existsSync(join(root, '.factory')),
      global: [join(HOME, '.factory/skills')],
      project: [join(root, '.factory/skills')],
    },
    {
      id: 'opencode',
      npxAgent: 'opencode',
      when: () =>
        existsSync(join(HOME, '.config/opencode')) ||
        existsSync(join(root, '.opencode')),
      global: [
        join(HOME, '.config/opencode/skills'),
        join(HOME, '.agents/skills'),
      ],
      project: [join(root, '.opencode/skills'), join(root, '.agents/skills')],
    },
    {
      id: 'kimi',
      npxAgent: 'kimi-code-cli',
      when: () => false, // env-only; see detectHarness
      global: [join(HOME, '.agents/skills')],
      project: [join(root, '.agents/skills')],
    },
    {
      id: 'cursor',
      npxAgent: 'cursor',
      when: () => existsSync(join(HOME, '.cursor')),
      global: [join(HOME, '.cursor/skills'), join(HOME, '.agents/skills')],
      project: [join(root, '.agents/skills')],
    },
    {
      id: 'codex',
      npxAgent: 'codex',
      when: () => existsSync(join(HOME, '.codex')),
      global: [join(HOME, '.codex/skills'), join(HOME, '.agents/skills')],
      project: [join(root, '.agents/skills')],
    },
  ]
}

/** @returns {{ id: string, npxAgent: string | null, globalDirs: string[], projectDirs: string[] }} */
function detectHarness() {
  const root = repoRoot()
  const checks = harnessDefs(root)

  // Explicit env wins — many dev machines have ~/.claude and ~/.grok together.
  const envFirst = [
    ['grok', () => Boolean(process.env.GROK_SESSION_ID || process.env.GROK_HOME)],
    ['droid', () => Boolean(process.env.DROID_HOME)],
    ['opencode', () => Boolean(process.env.OPENCODE_HOME)],
    ['kimi', () => Boolean(process.env.KIMI_HOME || process.env.KIMI_API_KEY)],
    ['claude-code', () => process.env.CLAUDE_CODE === '1'],
  ]
  for (const [id, when] of envFirst) {
    if (when()) {
      const h = checks.find((c) => c.id === id)
      if (h) return pack(h, root)
    }
  }

  for (const h of checks) {
    if (h.when()) return pack(h, root)
  }

  return {
    id: 'universal',
    npxAgent: 'universal',
    globalDirs: [join(HOME, '.agents/skills')],
    projectDirs: [join(root, '.agents/skills')],
  }
}

/** @param {{ id: string, npxAgent: string | null, global: string[], project: string[] }} h */
function pack(h, root) {
  return {
    id: h.id,
    npxAgent: h.npxAgent,
    globalDirs: h.global,
    projectDirs: h.project ?? [join(root, '.agents/skills')],
  }
}

function dirNames(logical) {
  return DIR_ALIASES[logical] ?? [logical]
}

function skillFileInDir(base, logical) {
  for (const name of dirNames(logical)) {
    const p = join(base, name, 'SKILL.md')
    if (existsSync(p)) return p
  }
  return null
}

/** @returns {string | null} */
function findSkillPath(logical) {
  const root = repoRoot()
  const harness = detectHarness()

  const candidates = [
    join(SOILSPOON_MARKETPLACE, logical, 'SKILL.md'),
    join(SKILL_DIR, '..', logical, 'SKILL.md'),
    ...harness.projectDirs.flatMap((d) =>
      dirNames(logical).map((n) => join(d, n, 'SKILL.md')),
    ),
    ...harness.globalDirs.flatMap((d) =>
      dirNames(logical).map((n) => join(d, n, 'SKILL.md')),
    ),
    join(HOME, '.claude/skills', logical, 'SKILL.md'),
    join(root, '.claude/skills', logical, 'SKILL.md'),
    join(HOME, '.agents/skills', logical, 'SKILL.md'),
    join(root, '.agents/skills', logical, 'SKILL.md'),
    join(HOME, '.grok/skills', logical, 'SKILL.md'),
    join(root, '.grok/skills', logical, 'SKILL.md'),
    // Vercel nested layouts
    join(HOME, '.claude/skills', 'vercel-react-best-practices', 'react-best-practices', 'SKILL.md'),
    join(HOME, '.claude/skills', 'react-best-practices', 'SKILL.md'),
    join(HOME, '.claude/skills', 'vercel-composition-patterns', 'composition-patterns', 'SKILL.md'),
    join(HOME, '.claude/skills', 'composition-patterns', 'SKILL.md'),
  ]

  for (const p of candidates) {
    if (existsSync(p)) return resolve(p)
  }
  return null
}

function soilspoonSourceDir(logical) {
  const marketplace = join(SOILSPOON_MARKETPLACE, logical)
  if (existsSync(join(marketplace, 'SKILL.md'))) return marketplace
  return null
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  })
  return r.status === 0
}

function installViaNpx(logical, harness) {
  const source = SOURCES[logical]
  if (!source) {
    console.error(`Unknown skill: ${logical}`)
    return false
  }
  if (!harness.npxAgent) return false

  const args = [
    'skills',
    'add',
    source,
    '-g',
    '-y',
    '-a',
    harness.npxAgent,
    '--copy',
  ]
  console.log(`→ npx ${args.join(' ')}`)
  return run('npx', args)
}

function installViaCopy(logical, harness) {
  const source = soilspoonSourceDir(logical)
  if (!source) {
    console.error(
      `No local Soilspoon copy for ${logical}. Clone marketplace or run: npx skills add ${SOURCES[logical]}`,
    )
    return false
  }

  const targetBase = harness.globalDirs[0] ?? join(HOME, '.grok/skills')
  const dest = join(targetBase, logical)
  mkdirSync(targetBase, { recursive: true })
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(source, dest, { recursive: true })
  console.log(`→ copied ${source} → ${dest}`)
  return true
}

function ensureSkill(logical) {
  const existing = findSkillPath(logical)
  if (existing) {
    console.log(`✓ ${logical}: ${existing}`)
    return true
  }

  console.log(`✗ ${logical}: not found — installing…`)
  const harness = detectHarness()

  if (harness.id === 'grok') {
    if (installViaCopy(logical, harness)) {
      return Boolean(findSkillPath(logical))
    }
    return false
  }

  if (harness.npxAgent && installViaNpx(logical, harness)) {
    return Boolean(findSkillPath(logical))
  }

  // Fallback: copy from marketplace if npx failed or agent unknown
  if (installViaCopy(logical, harness)) {
    return Boolean(findSkillPath(logical))
  }

  return false
}

function parseArgs(argv) {
  const skills = []
  let detectOnly = false
  let bundle = null

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--detect') detectOnly = true
    else if (a === '--route-bundle') bundle = argv[++i]
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: ensure-skill.mjs [--detect] [--route-bundle <name>] [skill ...]

Bundles: ${Object.keys(ROUTE_BUNDLES).join(', ')}`)
      process.exit(0)
    } else if (!a.startsWith('-')) skills.push(a)
  }

  if (bundle) {
    const list = ROUTE_BUNDLES[bundle]
    if (!list) {
      console.error(`Unknown bundle: ${bundle}`)
      process.exit(1)
    }
    skills.push(...list)
  }

  return { detectOnly, skills: [...new Set(skills)] }
}

function main() {
  const { detectOnly, skills } = parseArgs(process.argv.slice(2))
  const harness = detectHarness()

  console.log(`Harness: ${harness.id} (npx agent: ${harness.npxAgent ?? 'copy-only'})`)
  console.log(`Repo: ${repoRoot()}`)

  if (detectOnly && skills.length === 0) {
    process.exit(0)
  }

  const targets = skills.length > 0 ? skills : ['dev-router']
  let ok = true
  for (const name of targets) {
    if (!ensureSkill(name)) ok = false
  }

  process.exit(ok ? 0 : 1)
}

main()