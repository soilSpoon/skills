// Regression guard for ① the prior-leaf FOOTPRINT (deterministic orientation hint that cuts a fresh
// stateless agent's cold re-orientation — the measured ~85%-AI re-derivation cost). The SAFETY-relevant
// constraints, asserted so they cannot silently erode:
//   (a) threaded into the HOT TRIAD only (slicer / critic / serial-executor),
//   (b) NEVER reaches the VERIFIER — the trust gate must judge from ENGINE-DIFF/ENGINE-RAN alone, not a
//       hint about what prior leaves touched (independence = the false-green catch),
//   (c) pure function of `done`: TRUSTED leaves only (untrusted were reverted = noise), filesChanged only
//       (funList/symbols flagged unreliable in review), capped.
// String guards in the spirit of architecture.test.mjs; the behavioural win is measured live via the
// per-agent [+MM:SS] timing the adapter now emits.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const leafLoop = readFileSync(join(SRC, 'phases', 'leaf-loop.ts'), 'utf8')
const verify = readFileSync(join(SRC, 'phases', 'verify.ts'), 'utf8')

test('footprint is a deterministic pure function over `done`: TRUSTED-only + filesChanged + capped', () => {
  const m = leafLoop.match(/const footprint = [^]*?\n  \}/)
  assert.ok(m, 'footprint() helper present')
  const body = m[0]
  assert.ok(/trustworthy/.test(body), 'TRUSTED leaves only (an untrusted leaf was reverted = noise)')
  assert.ok(/filesChanged/.test(body) && !/funList/.test(body), 'filesChanged ONLY — not funList/symbols (unreliable)')
  assert.ok(/slice\(0, 12\)/.test(body), 'capped (≤12 files) so the prompt cannot bloat')
})

test('footprint is threaded into the HOT TRIAD but NEVER the verifier (independence)', () => {
  const injections = (leafLoop.match(/\$\{footprint\(\)\}/g) || []).length
  assert.ok(injections >= 3, `footprint() must be injected into ≥3 hot-triad prompts (slicer/critic/executor); found ${injections}`)
  // verify.ts uses the WORD "footprint" for the git diff --stat footprint (unrelated); the precise
  // assertion is that the verifier neither defines nor injects the footprint() HELPER.
  assert.ok(!/footprint\(\)/.test(verify), 'the adversarial VERIFIER must NOT receive the footprint() injection — it judges from ENGINE-DIFF/ENGINE-RAN independently')
})
