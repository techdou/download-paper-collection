from __future__ import annotations

import importlib.util
import re
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_TOP_LEVEL_KEYS = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
}


def load_validator_module():
    path = ROOT / "scripts" / "validate_skill.py"
    spec = importlib.util.spec_from_file_location("validate_skill", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load validate_skill.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSkillStructure(unittest.TestCase):
    def test_skill_frontmatter_matches_portable_allowlist(self):
        skill_path = ROOT / "SKILL.md"
        text = skill_path.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\n"))
        _, frontmatter, body = text.split("---", 2)
        data = yaml.safe_load(frontmatter)

        self.assertEqual(set(data) - ALLOWED_TOP_LEVEL_KEYS, set())
        self.assertNotIn("compatibility", data)

        name = data["name"]
        description = data["description"]
        self.assertEqual(name, ROOT.name)
        self.assertRegex(name, r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
        self.assertLessEqual(len(name), 64)
        self.assertTrue(1 <= len(description) <= 1024)
        self.assertNotIn("<", description)
        self.assertNotIn(">", description)

        metadata = data.get("metadata", {})
        self.assertIsInstance(metadata, dict)
        self.assertIn("version", metadata)
        self.assertIn("compatibility", metadata)
        self.assertTrue(all(isinstance(key, str) for key in metadata))
        self.assertTrue(all(isinstance(value, str) for value in metadata.values()))

        self.assertLess(len(text.splitlines()), 500)
        self.assertTrue(body.strip())
        self.assertIn("## Dependencies", body)

    def test_standalone_format_validator_passes(self):
        validator = load_validator_module()
        self.assertEqual(validator.validate_skill(ROOT), [])

    def test_validator_rejects_custom_top_level_field(self):
        validator = load_validator_module()
        original = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        altered = original.replace(
            "metadata:\n",
            "compatibility: Should not be top-level\nmetadata:\n",
            1,
        )
        from tempfile import TemporaryDirectory

        with TemporaryDirectory() as temp_dir:
            skill_dir = Path(temp_dir) / ROOT.name
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(altered, encoding="utf-8")
            errors = validator.validate_skill(skill_dir)
        self.assertTrue(any("compatibility" in error for error in errors))

    def test_referenced_files_exist(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        references = re.findall(r"\]\(([^)]+)\)", text)
        for reference in references:
            if "://" in reference or reference.startswith("#"):
                continue
            self.assertTrue((ROOT / reference).is_file(), reference)

    def test_openai_interface_yaml_is_valid(self):
        data = yaml.safe_load((ROOT / "agents" / "openai.yaml").read_text(encoding="utf-8"))
        interface = data["interface"]
        self.assertTrue(interface["display_name"])
        self.assertTrue(interface["short_description"])
        self.assertIn("$download-paper-collection", interface["default_prompt"])


if __name__ == "__main__":
    unittest.main()
