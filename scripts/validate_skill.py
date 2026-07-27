#!/usr/bin/env python3
"""Validate portable SKILL.md structure and frontmatter.

The accepted top-level fields intentionally match the conservative Codex
validator allowlist while remaining compatible with Agent Skills clients.
Custom extension fields belong under ``metadata``.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml

ALLOWED_TOP_LEVEL_KEYS = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
}
MAX_NAME_LENGTH = 64
MAX_DESCRIPTION_LENGTH = 1024


def _load_frontmatter(skill_md: Path) -> tuple[dict[str, Any], str]:
    text = skill_md.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---(?:\n|$)", text, re.DOTALL)
    if not match:
        raise ValueError("SKILL.md must begin with valid YAML frontmatter")
    try:
        data = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML frontmatter: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("SKILL.md frontmatter must be a YAML mapping")
    return data, text[match.end() :]


def validate_skill(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return ["SKILL.md not found"]

    try:
        frontmatter, body = _load_frontmatter(skill_md)
    except (OSError, UnicodeError, ValueError) as exc:
        return [str(exc)]

    unexpected = sorted(set(frontmatter) - ALLOWED_TOP_LEVEL_KEYS)
    if unexpected:
        errors.append(
            "Unexpected top-level frontmatter key(s): "
            + ", ".join(unexpected)
            + ". Move custom fields under metadata."
        )

    name = frontmatter.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append("name is required and must be a non-empty string")
    else:
        name = name.strip()
        if len(name) > MAX_NAME_LENGTH:
            errors.append(f"name exceeds {MAX_NAME_LENGTH} characters")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name):
            errors.append("name must use lowercase hyphen-case")
        if name != skill_dir.name:
            errors.append(f"name '{name}' must match directory '{skill_dir.name}'")

    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip():
        errors.append("description is required and must be a non-empty string")
    else:
        description = description.strip()
        if len(description) > MAX_DESCRIPTION_LENGTH:
            errors.append(f"description exceeds {MAX_DESCRIPTION_LENGTH} characters")
        if "<" in description or ">" in description:
            errors.append("description cannot contain angle brackets")

    metadata = frontmatter.get("metadata")
    if metadata is not None:
        if not isinstance(metadata, dict):
            errors.append("metadata must be a YAML mapping")
        else:
            for key, value in metadata.items():
                if not isinstance(key, str) or not key.strip():
                    errors.append("metadata keys must be non-empty strings")
                if not isinstance(value, str):
                    errors.append(f"metadata.{key} must be a string")

    if not body.strip():
        errors.append("SKILL.md body is empty")

    return errors


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("skill_directory", type=Path)
    args = parser.parse_args()

    errors = validate_skill(args.skill_directory.resolve())
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)

    print("Skill format validation passed.")


if __name__ == "__main__":
    main()
