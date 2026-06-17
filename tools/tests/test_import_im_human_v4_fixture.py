import json
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "tools" / "import_im_human_v4_fixture.py"
FIXTURES = ROOT / "tools" / "fixtures" / "im_human_v4"


class ImportImHumanV4FixtureTest(unittest.TestCase):
    def test_import_matches_checked_canonical_artifact(self) -> None:
        source = FIXTURES / "day_vote_resolution.imhuman.json"
        expected = FIXTURES / "day_vote_resolution.fmarch.json"

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "imported.json"
            subprocess.run(
                ["python3", str(SCRIPT), str(source), "--output", str(output)],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            )
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                json.loads(expected.read_text(encoding="utf-8")),
            )

        checked = subprocess.run(
            ["python3", str(SCRIPT), str(source), "--check", "--output", str(expected)],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertIn("ok: checked", checked.stdout)

    def test_ita_shot_lifecycle_import_matches_checked_canonical_artifact(self) -> None:
        source = FIXTURES / "ita_shot_lifecycle.imhuman.json"
        expected = FIXTURES / "ita_shot_lifecycle.fmarch.json"

        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "imported.json"
            subprocess.run(
                ["python3", str(SCRIPT), str(source), "--output", str(output)],
                cwd=ROOT,
                check=True,
                text=True,
                capture_output=True,
            )
            self.assertEqual(
                json.loads(output.read_text(encoding="utf-8")),
                json.loads(expected.read_text(encoding="utf-8")),
            )

        checked = subprocess.run(
            ["python3", str(SCRIPT), str(source), "--check", "--output", str(expected)],
            cwd=ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertIn("ok: checked", checked.stdout)

    def test_unknown_im_human_event_kind_fails_closed(self) -> None:
        result = subprocess.run(
            ["python3", str(SCRIPT), str(FIXTURES / "unknown_event.imhuman.json")],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown im-human event kind", result.stderr)

    def test_malformed_known_event_payload_fails_closed(self) -> None:
        result = subprocess.run(
            ["python3", str(SCRIPT), str(FIXTURES / "malformed_saved.imhuman.json")],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing payload fields ['sources']", result.stderr)

    def test_malformed_ita_buffered_payload_fails_closed(self) -> None:
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                str(FIXTURES / "unsupported_buffered_ita.imhuman.json"),
            ],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "missing payload fields ['actor_id', 'delay_ms', 'release_at', 'submitted_at', 'targets']",
            result.stderr,
        )


if __name__ == "__main__":
    unittest.main()
