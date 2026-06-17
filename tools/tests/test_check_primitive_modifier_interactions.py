import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "check_primitive_modifier_interactions.py"
SPEC = importlib.util.spec_from_file_location("interaction_checker", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(checker)


class PrimitiveModifierInteractionTests(unittest.TestCase):
    def write_pack(self, root: Path, *, with_golden: bool) -> None:
        pack_dir = root / "packs" / "sample"
        golden_dir = pack_dir / "golden"
        golden_dir.mkdir(parents=True)
        (root / "docs" / "arch").mkdir(parents=True)
        (pack_dir / "pack.json").write_text(
            json.dumps(
                {
                    "roles": {
                        "strongman": {
                            "actions": [
                                {
                                    "id": "strongman_kill",
                                    "ability": "Kill",
                                    "modifiers": ["Strongman"],
                                    "constraints": {"max_targets": 1, "x_shots": 1},
                                }
                            ]
                        }
                    }
                }
            ),
            encoding="utf-8",
        )
        (root / "docs/arch/im-human-engine-parity-matrix.md").write_text(
            "\n".join(
                [
                    "| Category | im-human item | Canonical fmarch | Sources | Unsupported | Modeled in pack | Implemented in resolver | Covered by golden | Integrated command/projection | Notes |",
                    "|---|---|---:|---|---|---|---|---|---|---|",
                    "| modifier:action | `cycle_x` |  | 1 | yes | no | no | no | no | |",
                ]
            ),
            encoding="utf-8",
        )
        if with_golden:
            (golden_dir / "strongman.json").write_text(
                json.dumps(
                    {
                        "input": {
                            "submissions": [
                                {
                                    "template_id": "strongman_kill",
                                    "actor": "slot_1",
                                }
                            ]
                        }
                    }
                ),
                encoding="utf-8",
            )

    def test_report_passes_when_modified_template_has_golden(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_pack(root, with_golden=True)
            report = checker.build_report(root)
            self.assertTrue(report["ok"])
            self.assertEqual(report["interaction_count"], 2)
            self.assertEqual(report["uncovered_count"], 0)
            self.assertEqual(report["unsupported_parity_count"], 1)

    def test_report_fails_when_modified_template_has_no_golden(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_pack(root, with_golden=False)
            report = checker.build_report(root)
            self.assertFalse(report["ok"])
            self.assertEqual(report["uncovered_count"], 2)
            self.assertEqual(
                {row["modifier"] for row in report["uncovered"]},
                {"Strongman", "XShot"},
            )


if __name__ == "__main__":
    unittest.main()
