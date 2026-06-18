import importlib.util
import json
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "engine_port_completion_audit.py"
SPEC = importlib.util.spec_from_file_location("completion_audit", SCRIPT)
audit = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = audit
SPEC.loader.exec_module(audit)


class EnginePortCompletionAuditTests(unittest.TestCase):
    def write_fixture(
        self,
        root: Path,
        *,
        matrix_row: str,
        phase_3_body: str = "All phase proof is complete.",
    ) -> None:
        (root / "docs/arch").mkdir(parents=True)
        (root / "docs/ops").mkdir(parents=True)
        (root / "target/operator-proof").mkdir(parents=True)
        (root / "target/operator-browser-smoke").mkdir(parents=True)
        (root / "docs/arch/11-engine-port-checklist.md").write_text(
            textwrap.dedent(
                f"""
                ### A. Engine input and snapshot construction

                - [x] Minimal checked row.

                ### Phase 0 - Freeze the target contract

                Exit proof: complete.

                ### Phase 1 - Wire the resolution seam end to end

                Exit proof: complete.

                ### Phase 2 - Make pack validation strict

                Exit proof: complete.

                ### Phase 3 - Reach common mafiascum night parity

                {phase_3_body}

                Exit proof: common parity complete.
                """
            ).strip()
            + "\n",
            encoding="utf-8",
        )
        (root / "docs/arch/im-human-engine-parity-matrix.md").write_text(
            "\n".join(
                [
                    "| Category | im-human item | Canonical fmarch | Sources | Unsupported | Modeled in pack | Implemented in resolver | Covered by golden | Integrated command/projection | Notes |",
                    "|---|---|---:|---|---|---|---|---|---|---|",
                    matrix_row,
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        (root / "docs/ops/proof-runs.json").write_text(
            json.dumps({"version": 1, "families": []}) + "\n",
            encoding="utf-8",
        )
        self.write_saved_artifacts(root)

    def write_saved_artifacts(self, root: Path) -> None:
        artifacts = {
            "target/operator-proof/current-artifact-go-no-go-report.json": {
                "ok": True,
                "production": {
                    "total_artifact_rows": 1,
                    "trusted": 1,
                    "non_trusted": 0,
                },
                "fixtures": {},
            },
            "target/operator-proof/current-status-audit-report.json": {
                "ok": True,
                "diffs": [],
            },
            "target/operator-proof/current-artifact-retention-report.json": {
                "ok": True,
                "regressions": [],
                "recoveries": [],
            },
            "target/operator-proof/current-determinism-fuzz-report.json": {
                "ok": True,
                "family_count": 0,
                "seed_count": 0,
                "passed_family_count": 0,
                "failed_family_count": 0,
            },
            "target/operator-proof/current-primitive-modifier-interaction-report.json": {
                "ok": True,
                "pack_count": 0,
                "interaction_count": 0,
                "unique_interaction_count": 0,
                "uncovered_count": 0,
                "unsupported_parity_count": 0,
            },
            "target/operator-proof/current-engine-v4-test-family-coverage-report.json": {
                "ok": True,
                "family_count": 0,
                "mapped_count": 0,
                "covered_count": 0,
                "explicit_unsupported_count": 0,
                "failure_count": 0,
            },
            "target/operator-proof/current-unported-im-human-inventory-report.json": {
                "ok": True,
                "unsupported_count": 0,
                "category_counts": {},
                "classification_counts": {},
                "requested_category_counts": {},
            },
            "target/operator-proof/current-domain-ci-no-postgres-report.json": {
                "ok": True,
                "lane_count": 1,
                "passed_count": 1,
                "failed_count": 0,
                "failed_lanes": [],
                "golden_pack_dirs": [],
            },
            "target/operator-proof/current-generated-shrink-matrix-report.tmp.json": {
                "artifact_version": 1,
                "artifact_path": "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
                "ok": True,
                "proof_boundary": "fixture boundary",
                "family_count": 25,
                "case_count": 50,
                "expected_family_count": 25,
                "expected_case_count": 50,
                "family_manifest_matched": True,
                "families": {},
                "entries": [],
            },
        }
        for relative, data in artifacts.items():
            (root / relative).write_text(
                json.dumps(data) + "\n",
                encoding="utf-8",
            )

        browser_data = {
            "surfaces": [
                {
                    "name": "operator-proof-go-no-go",
                    "checks": [
                        {"needle": needle, "present": True}
                        for needle in audit.REQUIRED_BROWSER_GO_NO_GO_METADATA
                    ],
                }
            ],
            "jsonSurfaces": [
                {
                    "name": "operator-proof-run-status",
                    "rowChecks": [
                        {
                            "row_id": row_id,
                            "state": "trusted",
                            "trusted_metadata_present": True,
                        }
                        for row_id in audit.REQUIRED_BROWSER_STATUS_METADATA_ROWS
                    ],
                }
            ],
        }
        (root / "target/operator-browser-smoke/playwright-dom-proof.json").write_text(
            json.dumps(browser_data) + "\n",
            encoding="utf-8",
        )

    def test_explicit_out_of_scope_rows_do_not_block_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(
                root,
                matrix_row=(
                    "| test_family | `init` | `out_of_scope: im-human init/chat provisioning` | "
                    "4 | yes | no | no | no | no | outside slot-only resolver |"
                ),
            )
            report = audit.build_report(root, "target/audit.json", artifact_is_current=True)
            self.assertTrue(report["ok"])
            self.assertEqual(report["parity_matrix"]["unsupported"], 1)
            self.assertEqual(report["parity_matrix"]["actionable_unsupported"], 0)
            self.assertEqual(report["parity_matrix"]["explicit_out_of_scope_unsupported"], 1)
            self.assertEqual(report["incomplete_reasons"], [])

    def test_partial_phase_blocks_completion_after_out_of_scope_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(
                root,
                matrix_row=(
                    "| test_family | `feature_flags_test` | `out_of_scope: feature flags` | "
                    "1 | yes | no | no | no | no | non-resolution platform plumbing |"
                ),
                phase_3_body="[done] Existing proof. Pending redirect-cycle proof remains.",
            )
            report = audit.build_report(root, "target/audit.json", artifact_is_current=True)
            self.assertFalse(report["ok"])
            self.assertEqual(
                report["incomplete_reasons"],
                [
                    "1 build-order phases are still partial: "
                    "3 (Reach common mafiascum night parity)"
                ],
            )
            self.assertEqual(
                report["recommended_next_slice"],
                "Continue Phase 3 (Reach common mafiascum night parity): convert the next "
                "pending or partly-proven phase marker into code plus proof.",
            )

    def test_actionable_unsupported_rows_remain_completion_blockers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_fixture(
                root,
                matrix_row=(
                    "| primitive | `redirect_cycles` |  | 1 | yes | no | no | no | no | "
                    "missing graph proof |"
                ),
            )
            report = audit.build_report(root, "target/audit.json", artifact_is_current=True)
            self.assertFalse(report["ok"])
            self.assertEqual(report["parity_matrix"]["actionable_unsupported"], 1)
            self.assertIn(
                "1 actionable parity-matrix rows are still unsupported",
                report["incomplete_reasons"],
            )
            self.assertEqual(
                report["recommended_next_slice"],
                "Promote the next unsupported parity-matrix row into a scoped "
                "implementation slice: primitive `redirect_cycles`.",
            )


if __name__ == "__main__":
    unittest.main()
