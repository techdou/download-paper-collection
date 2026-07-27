#!/usr/bin/env python3
"""Run the skill's regression tests without requiring pytest."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]

    validation = subprocess.run(
        [sys.executable, str(root / "scripts" / "validate_skill.py"), str(root)],
        cwd=root,
        check=False,
    )
    if validation.returncode != 0:
        raise SystemExit(validation.returncode)

    command = [sys.executable, "-m", "unittest", "discover", "-s", str(root / "tests")]
    if args.verbose:
        command.append("-v")
    completed = subprocess.run(command, cwd=root, check=False)
    raise SystemExit(completed.returncode)


if __name__ == "__main__":
    main()
