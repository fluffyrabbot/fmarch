import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "report_unported_im_human_inventory.py"
SPEC = importlib.util.spec_from_file_location("unported_report", SCRIPT)
reporter = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(reporter)


class UnportedImHumanInventoryReportTests(unittest.TestCase):
    def write_matrix(self, root: Path) -> None:
        matrix = root / "docs/arch/im-human-engine-parity-matrix.md"
        matrix.parent.mkdir(parents=True)
        matrix.write_text(
            "\n".join(
                [
                    "| Category | im-human item | Canonical fmarch | Sources | Unsupported | Modeled in pack | Implemented in resolver | Covered by golden | Integrated command/projection | Notes |",
                    "|---|---|---:|---|---|---|---|---|---|---|",
                    "| primitive | `mark_cleansed` |  | 1 | yes | no | no | no | no |  |",
                    "| result_event_kind | `ita.shot.buffered` |  | 1 | yes | no | no | no | no |  |",
                    "| culture_note | `culture:done` | `Policy` | 1 | no | yes | yes | yes | yes | covered |",
                    "| test_family | `init` | `out_of_scope: init` | 4 | yes | no | no | no | no | outside slot-only resolver |",
                ]
            ),
            encoding="utf-8",
        )

    def test_report_groups_requested_categories_and_out_of_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_matrix(root)
            report = reporter.build_report(root)
            self.assertTrue(report["ok"])
            self.assertEqual(report["unsupported_count"], 3)
            self.assertEqual(report["requested_category_counts"]["primitive"], 1)
            self.assertEqual(report["requested_category_counts"]["result_event_kind"], 1)
            self.assertEqual(report["requested_category_counts"]["culture_note"], 0)
            self.assertEqual(report["classification_counts"]["not_yet_ported"], 2)
            self.assertEqual(report["classification_counts"]["explicit_out_of_scope"], 1)


if __name__ == "__main__":
    unittest.main()
