import { test } from "node:test";
import assert from "node:assert/strict";
import { add, clamp } from "./calc.js";

// {scope} note: the test NAME ("add_returns_sum") is a bare /^[A-Za-z0-9_.-]+$/
// token so the slice engine's filterCommand --scope add_returns_sum matches it
// verbatim via node --test-name-pattern (recursive-slice.js:611 guard).
test("add_returns_sum", () => {
  assert.equal(add(2, 3), 5);
});

test("clamp_bounds_value", () => {
  // invariant: result is always within [lo, hi]
  assert.equal(clamp(10, 0, 5), 5);
  assert.equal(clamp(-3, 0, 5), 0);
  assert.equal(clamp(2, 0, 5), 2);
});
