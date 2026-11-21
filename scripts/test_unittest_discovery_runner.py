#!/usr/bin/env python3
"""Regression test: empty unittest discovery must never return success."""
from __future__ import annotations

import contextlib
import io
import unittest
from unittest.mock import patch
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_unittest_discovery


class EmptyDiscoveryMustFailTests(unittest.TestCase):
    def test_zero_discovered_tests_returns_nonzero(self) -> None:
        empty_suite = unittest.TestSuite()
        stderr = io.StringIO()
        with patch.object(
            run_unittest_discovery.unittest.defaultTestLoader,
            "discover",
            return_value=empty_suite,
        ), contextlib.redirect_stderr(stderr):
            exit_code = run_unittest_discovery.discover_and_run(
                "scripts",
                "test_missing_suite.py",
            )

        self.assertNotEqual(exit_code, 0)
        self.assertEqual(exit_code, 5)
        self.assertIn("found zero tests", stderr.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=2)
