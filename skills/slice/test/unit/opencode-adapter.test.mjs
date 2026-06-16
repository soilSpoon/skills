// Architecture and readiness tests for adapters/opencode/ — pins four discovered/review-flagged
// scenarios as explicit failing-loud checks rather than silent assumptions.
//
// These tests do NOT modify the adapter package.json — they verify the CURRENT state and
// document the next-slice requirements so they cannot be silently lost.
//
// Scenario coverage:
//   1. @types/node is NOT yet in the adapter's devDependencies — documented gap that tsc needs.
//   2. host-smoke.mjs EXISTS at adapters/opencode/ and the npm test script points to it.
//   3. Without @types/node the adapter's tsc exits non-zero (concrete evidence of the gap).
//   4. node host-smoke.mjs runs successfully (passes all 5 smoke assertions) when given the
//      real artifact path — establishing that the CI gate is exercisable right now.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SLICE_ROOT = join(HERE, '..', '..')
const ADAPTER_DIR = join(SLICE_ROOT, 'adapters', 'opencode')
const ADAPTER_PKG = join(ADAPTER_DIR, 'package.json')
const SMOKE_PATH = join(ADAPTER_DIR, 'host-smoke.mjs')
const ARTIFACT = join(SLICE_ROOT, 'recursive-slice.js')

// ── Scenario 1: @types/node is NOT yet in devDependencies ──────────────────────────────────
// Documents the gap: the next slice that wires the adapter MUST add @types/node so that
// tsc --noEmit exits 0 cleanly. Pinned here so the requirement is not silently lost.
test('opencode-adapter: devDependencies @types/node is absent — the gap that blocks tsc exit-0 (next-slice must add it)', () => {
  // Behavioral claim: adapters/opencode/package.json currently lacks @types/node in devDependencies.
  const pkg = JSON.parse(readFileSync(ADAPTER_PKG, 'utf8'))
  const devDeps = pkg.devDependencies || {}
  assert.equal('@types/node' in devDeps, false,
    'Expected @types/node to be ABSENT from adapter devDependencies. ' +
    'If this fails it means @types/node was added — update/remove this test and the tsc-fails test below.')
})

// ── Scenario 2: host-smoke.mjs exists and is wired as the npm test script ──────────────────
// Pins that the smoke file is present and the test pointer is correct — a rename or move
// without updating package.json scripts.test would break the CI gate silently.
test('opencode-adapter: host-smoke.mjs exists at adapters/opencode/host-smoke.mjs (the CI gate entry point)', () => {
  // Behavioral claim: the smoke file must exist before it can be a CI gate.
  assert.ok(existsSync(SMOKE_PATH),
    `host-smoke.mjs not found at ${SMOKE_PATH} — the CI gate entry point is missing`)
})

test('opencode-adapter: package.json scripts.test is "node host-smoke.mjs" (CI gate wired correctly)', () => {
  // Behavioral claim: npm test in the adapter directory invokes host-smoke.mjs, not something else.
  const pkg = JSON.parse(readFileSync(ADAPTER_PKG, 'utf8'))
  assert.equal(pkg.scripts?.test, 'node host-smoke.mjs',
    'adapter package.json scripts.test must be "node host-smoke.mjs" — the CI gate pointer is wrong or missing')
})

// ── Scenario 3: tsc --noEmit fails without @types/node ─────────────────────────────────────
// Concrete evidence of the @types/node gap: run the adapter's typecheck script and assert
// it exits non-zero, confirming that the missing type definitions produce real errors.
// This test MUST be updated (to assert exit-0) once @types/node is added.
test('opencode-adapter: tsc --noEmit exits non-zero without @types/node (concrete evidence of the types gap)', () => {
  // Behavioral claim: node: builtins (fs/crypto/child_process) and `process` are unresolved
  // until @types/node is present — tsc reports TS2591 errors and exits non-zero.
  let exitCode = 0
  try {
    execFileSync(
      join(ADAPTER_DIR, 'node_modules', '.bin', 'tsc'),
      ['--noEmit', '--project', join(ADAPTER_DIR, 'tsconfig.json')],
      { cwd: ADAPTER_DIR, stdio: 'pipe' }
    )
  } catch (err) {
    exitCode = err.status ?? 1
  }
  assert.ok(exitCode !== 0,
    'Expected tsc --noEmit to exit non-zero (missing @types/node). ' +
    'If this passes it means @types/node was added — flip this test to assert exit-0 instead.')
})

// ── Scenario 4: host-smoke.mjs runs correctly as a CI gate ─────────────────────────────────
// The npm test script already points to host-smoke.mjs but it has never been exercised.
// This test runs it with the built artifact and confirms all 5 smoke assertions pass.
// A process exit-1 from inside the smoke means a specific assertion failed — surfaced here.
test('opencode-adapter: host-smoke.mjs passes all 5 smoke assertions with the built artifact (CI gate exercised)', () => {
  // Behavioral claim: host-smoke.mjs drives the real AsyncFunction host against the artifact,
  // and all 5 in-process assertions (I7 guard / parallel flag / noRig gate / confirmNoRig /
  // no-false-gate) fire correctly — zero agent calls for no-task, noRigStop for missing rig, etc.
  assert.ok(existsSync(ARTIFACT),
    `Artifact not found at ${ARTIFACT} — run scripts/build-engine.sh first`)
  let exitCode = 0
  let stderr = ''
  try {
    execFileSync('node', [SMOKE_PATH, ARTIFACT],
      { cwd: ADAPTER_DIR, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    exitCode = err.status ?? 1
    stderr = String(err.stderr || '')
  }
  assert.equal(exitCode, 0,
    `host-smoke.mjs exited ${exitCode} — one or more smoke assertions failed.\nstderr: ${stderr}`)
})
