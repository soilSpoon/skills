// Unit tests for src/util.ts — the pure, host-agnostic helpers. Loaded directly via Node's native
// TS type-stripping (util.ts has no relative imports). These pin the contracts the whole-engine
// scenario tests only exercise indirectly: the ONE circuit-breaker abstraction (quota/untrusted/t0red
// all instantiate it), the dependency-free base64, and the ENGINE-RAN string shape.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { circuitBreaker, b64encode, engineRanBlock, classifyFailure, pickConcurrentLeaves } from '../../src/util.ts'

test('circuitBreaker: trips at threshold when classThreshold is 0 (the t0red/untrusted shape)', () => {
  const b = circuitBreaker(2)
  assert.equal(b.tripped(), false)
  assert.equal(b.record(), 1); assert.equal(b.tripped(), false)
  assert.equal(b.record(), 2); assert.equal(b.tripped(), true, 'trips at streak 2')
  b.reset()
  assert.equal(b.streak, 0); assert.equal(b.tripped(), false, 'reset clears streak')
})

test('circuitBreaker: the quota shape (3,2) needs streak>=3 AND >=2 distinct classes', () => {
  // A6: a same-class streak (e.g. the heavy 3-lens loop) must NOT trip — only a cross-class streak does.
  const same = circuitBreaker(3, 2)
  same.record('verify'); same.record('verify'); same.record('verify')
  assert.equal(same.streak, 3)
  assert.equal(same.tripped(), false, '3 records but ONE class → not session instability')

  const cross = circuitBreaker(3, 2)
  cross.record('verify'); cross.record('exec'); cross.record('decompose')
  assert.equal(cross.tripped(), true, '3 records across 3 classes → trips')

  const twoClassesShortStreak = circuitBreaker(3, 2)
  twoClassesShortStreak.record('a'); twoClassesShortStreak.record('b')
  assert.equal(twoClassesShortStreak.tripped(), false, '2 classes but streak 2 < threshold 3')
})

test('circuitBreaker: reset clears both streak and the class set', () => {
  const b = circuitBreaker(3, 2)
  b.record('a'); b.record('b'); b.record('c')
  assert.equal(b.tripped(), true)
  b.reset()
  b.record('a'); b.record('a'); b.record('a')   // post-reset: 3 same-class
  assert.equal(b.tripped(), false, 'class set was cleared by reset (not 4 classes carried over)')
})

test('b64encode: byte-identical to Buffer + round-trips through base64 -d, across ASCII/UTF-8/surrogates', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'Hi\r\nBcc: x', 'héllo', '日本語', 'emoji 😀🎉', 'a'.repeat(100)]) {
    assert.equal(b64encode(s), Buffer.from(s, 'utf8').toString('base64'), `mismatch for ${JSON.stringify(s.slice(0, 20))}`)
    assert.equal(Buffer.from(b64encode(s), 'base64').toString('utf8'), s, 'round-trip')
  }
})

test('engineRanBlock: emits the ENGINE-RAN shell-truth shape the verifier judges from', () => {
  const out = engineRanBlock({ cmd: 'scripts/test.sh', exitCode: 0, tail: 'all green', duty: 'JUDGE from this.' })
  assert.match(out, /ENGINE-RAN: `scripts\/test\.sh`/)
  assert.match(out, /exited 0\./)
  assert.match(out, /Output tail: all green/)
  assert.match(out, /JUDGE from this\.$/)
  // optional note is appended only when present
  assert.match(engineRanBlock({ cmd: 'c', note: '(retry)', exitCode: 1, tail: 't', duty: 'd' }), /`c` \(retry\) exited 1/)
})

// classifyFailure: maps API error message heuristics to quota-halt kind — VERBATIM from host.ts catch branch
test('classifyFailure: session-limit string → quota', () => {
  // host.ts: /session limit|rate.?limit|quota|too many requests|overloaded|credit/i → 'quota'
  assert.equal(classifyFailure(new Error('session limit reached')), 'quota')
})

test('classifyFailure: rate-limit string → quota', () => {
  // host.ts: /rate.?limit/ covers "rate limit" and "rate-limit"
  assert.equal(classifyFailure(new Error('rate limit exceeded')), 'quota')
})

test('classifyFailure: credit string → quota', () => {
  // host.ts: /credit/i covers credit-balance exhaustion messages
  assert.equal(classifyFailure(new Error('insufficient credit balance')), 'quota')
})

test('classifyFailure: overloaded string → quota', () => {
  // host.ts: /overloaded/i covers API-overloaded responses
  assert.equal(classifyFailure(new Error('The API is overloaded right now')), 'quota')
})

test('classifyFailure: issue-with-model string → model_unavailable', () => {
  // host.ts: /issue with the selected model/i → 'model_unavailable'
  assert.equal(classifyFailure(new Error('There is an issue with the selected model')), 'model_unavailable')
})

test('classifyFailure: may-not-have-access string → model_unavailable', () => {
  // host.ts: /may not have access to it/i → 'model_unavailable'
  assert.equal(classifyFailure(new Error('You may not have access to it')), 'model_unavailable')
})

test('classifyFailure: unknown error string → null', () => {
  // host.ts: anything else falls through to null (generic failure, not a classified API error)
  assert.equal(classifyFailure(new Error('something completely unrelated went wrong')), 'null')
})

test('classifyFailure: non-Error object → null', () => {
  // host.ts: String(e && e.message || e) — non-Error coerces to message-less string → null
  assert.equal(classifyFailure({ code: 42 }), 'null')
})

// classifyFailure falsy-input contract: `(err as any) && (err as any).message` short-circuits to
// the falsy value itself for null/0/false — String(null||null)→'null', String(0||0)→'0',
// String(false||false)→'false' — none match quota or model_unavailable, so all return 'null'.
// Pins: "what does classifyFailure(null) return?" is 'null' (the kind string, not JS null).
test('classifier: classifyFailure(null) returns the kind-string null, not JS null', () => {
  // The `&&` short-circuit exits at null; String(null || null) = 'null'; matches no regex → 'null'.
  assert.equal(classifyFailure(null), 'null')
})

test('classifier: classifyFailure(0) returns null kind (falsy non-Error short-circuit)', () => {
  // `0 && 0.message` → 0; String(0 || 0) = '0'; matches no quota/model regex → 'null'.
  assert.equal(classifyFailure(0), 'null')
})

test('classifier: classifyFailure(false) returns null kind (falsy non-Error short-circuit)', () => {
  // `false && false.message` → false; String(false || false) = 'false'; matches no regex → 'null'.
  assert.equal(classifyFailure(false), 'null')
})

// ── additional pattern-group coverage (contract-required) ────────────────────

test('classifyFailure: literal quota keyword → quota', () => {
  // /quota/i literal in the message — the most direct match for billing-quota exhaustion
  assert.equal(classifyFailure(new Error('quota exceeded for this billing period')), 'quota')
})

test('classifyFailure: too-many-requests string → quota', () => {
  // /too many requests/i covers HTTP-429 style messages (the contract lists this variant)
  assert.equal(classifyFailure(new Error('too many requests, please slow down')), 'quota')
})

test('classifyFailure: rate-limit hyphenated → quota', () => {
  // /rate.?limit/ covers "rate-limit" (the .? allows zero or one separator character)
  assert.equal(classifyFailure(new Error('rate-limit hit for this API key')), 'quota')
})

test('classifyFailure: selected-model-may-not-exist string → model_unavailable', () => {
  // /selected model.*may not exist/i — the third model_unavailable branch in the regex
  assert.equal(classifyFailure(new Error('The selected model may not exist in this region')), 'model_unavailable')
})

test('classifyFailure: empty string → null (no regex match on empty input)', () => {
  // String('') = ''; neither quota nor model_unavailable regex match; falls through to 'null'
  assert.equal(classifyFailure(''), 'null')
})

test('classifier: classifyFailure(undefined) returns null kind (falsy short-circuit)', () => {
  // `undefined && undefined.message` → undefined; String(undefined || undefined) = 'undefined';
  // matches no quota/model regex → 'null'.
  assert.equal(classifyFailure(undefined), 'null')
})

test('classifyFailure: budget/ceiling error → null (classifier is blind; agentSafe re-throws before calling it)', () => {
  // agentSafe re-throws budget/ceiling errors before ever invoking classifyFailure.
  // classifyFailure itself has no special branch for budget/ceiling — it simply matches no
  // quota/model_unavailable regex and falls through to the 'null' default.
  // This test pins that the pure classifier is intentionally blind to these strings.
  assert.equal(classifyFailure(new Error('budget ceiling exceeded')), 'null')
  assert.equal(classifyFailure(new Error('budget limit reached')), 'null')
  assert.equal(classifyFailure(new Error('ceiling hit for this project')), 'null')
})

// ── pickConcurrentLeaves: the leafConcurrency scheduler core (PURE) ───────────
test('pickConcurrentLeaves: picks deps-satisfied, file-disjoint leaves up to K', () => {
  const leaves = [
    { files: ['a.ts'], dependsOn: [] },   // 0
    { files: ['b.ts'], dependsOn: [] },   // 1 — disjoint with 0
    { files: ['a.ts'], dependsOn: [] },   // 2 — conflicts a.ts with 0
    { files: ['c.ts'], dependsOn: [1] },  // 3 — prereq 1 not done
  ]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set(), new Set(), 3), [0, 1])
})

test('pickConcurrentLeaves: honors the K cap', () => {
  const leaves = [{ files: ['a'] }, { files: ['b'] }, { files: ['c'] }]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set(), new Set(), 2), [0, 1])
})

test('pickConcurrentLeaves: excludes leaves whose files clash with the in-flight set', () => {
  const leaves = [{ files: ['a'] }, { files: ['b'] }]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set(), new Set(['a']), 3), [1])
})

test('pickConcurrentLeaves: a prereq being done unblocks its dependents', () => {
  const leaves = [{ files: ['a'], dependsOn: [] }, { files: ['b'], dependsOn: [0] }]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set([0]), new Set(), 3, new Set([0])), [1])
})

test('pickConcurrentLeaves: a leaf with no declared files is NOT concurrency-safe (excluded)', () => {
  const leaves = [{ files: [] }, { files: ['b'] }]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set(), new Set(), 3), [1])
})

test('pickConcurrentLeaves: two batch-mates never share a file (greedy claims within the batch)', () => {
  const leaves = [{ files: ['a', 'shared'] }, { files: ['shared', 'b'] }, { files: ['c'] }]
  assert.deepEqual(pickConcurrentLeaves(leaves, new Set(), new Set(), 3), [0, 2])
})
