#!/usr/bin/env python3
"""Run unittest discovery while treating an empty test suite as a hard failure."""
from __future__ import annotations

import argparse
import sys
import unittest


def discover_and_run(start_directory: str, pattern: str) -> int:
    suite = unittest.defaultTestLoader.discover(
        start_dir=start_directory,
        pattern=pattern,
    )
    discovered = suite.countTestCases()
    if discovered == 0:
        print(
            f"ERROR: unittest discovery found zero tests "
            f"(start_directory={start_directory!r}, pattern={pattern!r})",
            file=sys.stderr,
        )
        return 5

    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-directory", required=True)
    parser.add_argument("--pattern", required=True)
    args = parser.parse_args()
    return discover_and_run(args.start_directory, args.pattern)


if __name__ == "__main__":
    raise SystemExit(main())
