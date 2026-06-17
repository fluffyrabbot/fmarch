import importlib.util
import json
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "check_engine_v4_test_family_coverage.py"
SPEC = importlib.util.spec_from_file_location("family_checker", SCRIPT)
checker = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(checker)


class EngineV4TestFamilyCoverageTests(unittest.TestCase):
    def write_fixture(self, root: Path, *, with_needle: bool = True) -> None:
        (root / "docs/arch").mkdir(parents=True)
        (root / "tools").mkdir()
        (root / "proof.txt").write_text(
            "needle present" if with_needle else "no match",
            encoding="utf-8",
        )
        (root / "docs/arch/im-human-engine-inventory.json").write_text(
            json.dumps(
                {
                    "test_families": [
                        {
                            "name": "family_a",
                            "test_count": 2,
                            "example": "test/engine_v4/family_a_test.exs",
                        }
                    ]
                }
            ),
            encoding="utf-8",
        )
        (root / "tools/im_human_engine_inventory.py").write_text(
            textwrap.dedent(
                """
                TEST_FAMILY_COVERAGE = {
                    "family_a": {
                        "canonical": "ProofA",
                        "modeled": True,
                        "implemented": True,
                        "golden": False,
                        "integrated": False,
                        "evidence": [{"path": "proof.txt", "needle": "needle present"}],
                        "notes": "covered by proof fixture",
                    }
                }
                """
            ),
            encoding="utf-8",
        )
        (root / "docs/arch/im-human-engine-parity-matrix.md").write_text(
            "\n".join(
                [
                    "| Category | im-human item | Canonical fmarch | Sources | Unsupported | Modeled in pack | Implemented in resolver | Covered by golden | Integrated command/projection | Notes |",
                    "|---|---|---:|---|---|---|---|---|---|---|",
                    "| test_family | `family_a` | `ProofA` | 2 | no | yes | yes | no | no | example test/engine_v4/family_a_test.exs; covered by proof fixture |",
                ]
            ),
            encoding="utf-8",
        )

    def test_report_passes_when_family_mapping_evidence_and_matrix_align(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(root)
            report = checker.build_report(root)
            self.assertTrue(report["ok"])
            self.assertEqual(report["family_count"], 1)
            self.assertEqual(report["mapped_count"], 1)
            self.assertEqual(report["failure_count"], 0)

    def test_report_fails_when_evidence_needle_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(root, with_needle=False)
            report = checker.build_report(root)
            self.assertFalse(report["ok"])
            self.assertEqual(report["failure_count"], 1)
            self.assertIn("missing evidence needle", report["failures"][0]["problems"][0])


if __name__ == "__main__":
    unittest.main()
