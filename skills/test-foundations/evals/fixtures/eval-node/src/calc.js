// Tiny module under test: a pure function with an invariant worth a unit test.
export function add(a, b) {
  return a + b;
}

export function clamp(value, lo, hi) {
  if (lo > hi) throw new Error("invariant: lo must be <= hi");
  return Math.min(Math.max(value, lo), hi);
}
