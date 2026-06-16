// Unit tests for src/util.ts — the pure, host-agnostic helpers. Loaded directly via Node's native
// TS type-stripping (util.ts has no relative imports). These pin the contracts the whole-engine
// scenario tests only exercise indirectly: the ONE circuit-breaker abstraction (quota/untrusted/t0red
// all instantiate it), the dependency-free base64, and the ENGINE-RAN string shape.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { circuitBreaker, b64encode, engineRanBlock } from '../../src/util.ts'

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
