"""One passing unit test.

The test METHOD names (test_add_returns_sum, test_clamp_bounds_value) are bare
/^[A-Za-z0-9_.-]+$/ tokens so the slice engine's filterCommand
`scripts/verify.sh --scope test_add_returns_sum` matches verbatim via
pytest -k / unittest -k (recursive-slice.js:611 guard).
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from calc import add, clamp  # noqa: E402


class TestCalc(unittest.TestCase):
    def test_add_returns_sum(self):
        self.assertEqual(add(2, 3), 5)

    def test_clamp_bounds_value(self):
        # invariant: result is always within [lo, hi]
        self.assertEqual(clamp(10, 0, 5), 5)
        self.assertEqual(clamp(-3, 0, 5), 0)
        self.assertEqual(clamp(2, 0, 5), 2)


if __name__ == "__main__":
    unittest.main()
