import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "check_generated_shrink_matrix_gap_audit.py"
SPEC = importlib.util.spec_from_file_location("generated_shrink_gap_audit", SCRIPT)
audit = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


class GeneratedShrinkMatrixGapAuditTests(unittest.TestCase):
    def write_fixture(
        self,
        root: Path,
        *,
        omit_family: str | None = None,
        unexpected_family: str | None = None,
        count_override: tuple[str, int] | None = None,
        omit_source_needle: str | None = None,
    ) -> None:
        (root / "docs/arch").mkdir(parents=True)
        (root / "crates/commands/src").mkdir(parents=True)
        (root / "crates/commands/tests").mkdir(parents=True)

        checklist_needles = {
            needle
            for family in audit.EXPECTED_FAMILIES
            for needle in family.checklist_needles
        }
        (root / audit.CHECKLIST_PATH).write_text(
            "\n".join(sorted(checklist_needles)) + "\n",
            encoding="utf-8",
        )

        entries = []
        for family in audit.EXPECTED_FAMILIES:
            if family.family == omit_family:
                continue
            count = family.expected_case_count
            if count_override and count_override[0] == family.family:
                count = count_override[1]
            entries.append(f'        ("{family.family}", {count}_usize),')
        if unexpected_family:
            entries.append(f'        ("{unexpected_family}", 2_usize),')
        (root / audit.OPERATOR_PROOF_PATH).write_text(
            "pub fn generated_shrink_matrix_expected_families() -> BTreeMap<String, usize> {\n"
            "    [\n"
            + "\n".join(entries)
            + "\n    ]\n    .into_iter()\n    .map(|(family, count)| (family.to_string(), count))\n    .collect()\n}\n",
            encoding="utf-8",
        )

        source_needles = {
            evidence.needle
            for family in audit.EXPECTED_FAMILIES
            for evidence in family.source_needles
            if evidence.needle != omit_source_needle
        }
        (root / audit.PIPELINE_TEST_PATH).write_text(
            "\n".join(sorted(source_needles)) + "\n",
            encoding="utf-8",
        )

    def test_complete_manifest_passes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(root)
            report = audit.build_report(root, "target/report.json")
            self.assertTrue(report["ok"])
            self.assertEqual(report["expected_family_count"], 29)
            self.assertEqual(report["manifest_family_count"], 29)
            self.assertEqual(report["expected_case_count"], 58)
            self.assertEqual(report["manifest_case_count"], 58)
            self.assertEqual(report["missing_families"], [])
            self.assertEqual(report["unexpected_families"], [])
            self.assertIsNone(report["next_missing_family"])

    def test_missing_family_names_next_slice(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(root, omit_family="hider_projection_state")
            report = audit.build_report(root, "target/report.json")
            self.assertFalse(report["ok"])
            self.assertEqual(report["missing_families"], ["hider_projection_state"])
            self.assertEqual(report["next_missing_family"], "hider_projection_state")
            self.assertIn("hider projection-state", report["recommended_next_slice"])

    def test_count_mismatch_and_unexpected_family_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(
                root,
                unexpected_family="future_generated_family",
                count_override=("poison_cure", 3),
            )
            report = audit.build_report(root, "target/report.json")
            self.assertFalse(report["ok"])
            self.assertEqual(report["unexpected_families"], ["future_generated_family"])
            self.assertEqual(
                report["count_mismatches"],
                [
                    {
                        "family": "poison_cure",
                        "expected_case_count": 2,
                        "manifest_case_count": 3,
                    }
                ],
            )

    def test_missing_source_evidence_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(root, omit_source_needle="ActionGranted")
            report = audit.build_report(root, "target/report.json")
            self.assertFalse(report["ok"])
            self.assertEqual(
                [
                    failure
                    for failure in report["evidence_failures"]
                    if failure["needle"] == "ActionGranted"
                ],
                [
                    {
                        "family": "item_grant",
                        "path": audit.PIPELINE_TEST_PATH,
                        "needle": "ActionGranted",
                        "kind": "source",
                    }
                ],
            )


if __name__ == "__main__":
    unittest.main()
