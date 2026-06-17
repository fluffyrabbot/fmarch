import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "run_domain_ci_no_postgres.py"
SPEC = importlib.util.spec_from_file_location("domain_ci_no_postgres", SCRIPT)
runner = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(runner)


class DomainCiNoPostgresReportTests(unittest.TestCase):
    def write_golden_dirs(self, root: Path) -> None:
        for pack in ("alpha", "beta"):
            golden = root / "packs" / pack / "golden"
            golden.mkdir(parents=True)
            (golden / "case.json").write_text("{}\n", encoding="utf-8")
        invalid = root / "packs" / "test_invalid"
        invalid.mkdir(parents=True)
        (invalid / "pack.json").write_text("{}\n", encoding="utf-8")

    def test_discovers_only_pack_dirs_with_goldens(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_golden_dirs(root)
            self.assertEqual(
                runner.discover_golden_pack_dirs(root),
                ["packs/alpha", "packs/beta"],
            )

    def test_report_summarizes_lane_failures_and_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_golden_dirs(root)

            def fake_run(command, **kwargs):
                returncode = 1 if "--test" in command and "pack_validation" in command else 0
                return subprocess.CompletedProcess(
                    command,
                    returncode,
                    stdout="ok stdout\n",
                    stderr="bad stderr\n" if returncode else "",
                )

            report = runner.build_report(root, run_func=fake_run)
            self.assertFalse(report["ok"])
            self.assertEqual(report["lane_count"], 4)
            self.assertEqual(report["passed_count"], 3)
            self.assertEqual(report["failed_count"], 1)
            self.assertEqual(report["failed_lanes"], ["pack_validation_schema"])
            check_lane = next(
                lane
                for lane in report["lanes"]
                if lane["name"] == "check_goldens_all_fixture_packs"
            )
            self.assertEqual(check_lane["golden_pack_dirs"], ["packs/alpha", "packs/beta"])
            self.assertIn("bad stderr", report["lanes"][-1]["stderr_tail"])


if __name__ == "__main__":
    unittest.main()
