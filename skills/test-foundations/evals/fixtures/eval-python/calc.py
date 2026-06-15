"""Tiny module under test: pure functions with invariants worth a unit test."""


def add(a, b):
    return a + b


def clamp(value, lo, hi):
    if lo > hi:
        raise ValueError("invariant: lo must be <= hi")
    return min(max(value, lo), hi)
