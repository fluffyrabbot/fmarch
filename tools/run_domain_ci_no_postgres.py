#!/usr/bin/env python3
"""Run no-Postgres domain golden and schema-validator proof lanes."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from typing import Any, Callable


ARTIFACT_VERSION = 1
DEFAULT_OUTPUT = "target/operator-proof/current-domain-ci-no-postgres-report.json"
PROOF_BOUNDARY = (
    "Runs no-Postgres domain proof lanes in this workspace: the Rust golden harness, "
    "check_goldens over every pack directory with checked-in golden fixtures, result-contract "
    "schema tests, and pack-validation schema/linter tests. It intentionally does not run "
    "Postgres command/projection integration tests."
)


RunFunc = Callable[..., subprocess.CompletedProcess[str]]


def discover_golden_pack_dirs(root: Path) -> list[str]:
    pack_dirs = {
        fixture.parent.parent.relative_to(root).as_posix()
        for fixture in (root / "packs").glob("*/golden/*.json")
    }
    return sorted(pack_dirs)


def default_lanes(root: Path) -> list[dict[str, Any]]:
    golden_pack_dirs = discover_golden_pack_dirs(root)
    return [
        {
            "name": "rust_domain_golden_harness",
            "description": "Runs crates/domain/tests/golden.rs, including pure goldens and negative resolver guards.",
            "command": ["cargo", "test", "-p", "domain", "--test", "golden"],
        },
        {
            "name": "check_goldens_all_fixture_packs",
            "description": "Replays every checked-in golden fixture and fails on expected_events drift.",
            "command": [
                "cargo",
                "run",
                "-p",
                "commands",
                "--bin",
                "check_goldens",
                "--",
                "--check",
                *golden_pack_dirs,
            ],
            "golden_pack_dirs": golden_pack_dirs,
        },
        {
            "name": "result_contract_schema",
            "description": "Validates canonical resolution result event schema and malformed/unknown event rejection.",
            "command": ["cargo", "test", "-p", "domain", "--test", "result_contract"],
        },
        {
            "name": "pack_validation_schema",
            "description": "Runs strict pack schema, linter, additive IR, and compatibility tests.",
            "command": ["cargo", "test", "-p", "domain", "--test", "pack_validation"],
        },
    ]


def tail(text: str, max_lines: int = 80) -> str:
    lines = text.splitlines()
    return "\n".join(lines[-max_lines:])


def run_lane(
    root: Path,
    lane: dict[str, Any],
    run_func: RunFunc = subprocess.run,
) -> dict[str, Any]:
    started = time.monotonic()
    result = run_func(
        lane["command"],
        cwd=root,
        text=True,
        capture_output=True,
    )
    elapsed_ms = round((time.monotonic() - started) * 1000)
    return {
        **lane,
        "ok": result.returncode == 0,
        "returncode": result.returncode,
        "elapsed_ms": elapsed_ms,
        "stdout_tail": tail(result.stdout),
        "stderr_tail": tail(result.stderr),
    }


def build_report(root: Path, run_func: RunFunc = subprocess.run) -> dict[str, Any]:
    lanes = [run_lane(root, lane, run_func=run_func) for lane in default_lanes(root)]
    failed = [lane for lane in lanes if not lane["ok"]]
    return {
        "artifact_version": ARTIFACT_VERSION,
        "ok": not failed,
        "proof_boundary": PROOF_BOUNDARY,
        "lane_count": len(lanes),
        "passed_count": len(lanes) - len(failed),
        "failed_count": len(failed),
        "failed_lanes": [lane["name"] for lane in failed],
        "golden_pack_dirs": discover_golden_pack_dirs(root),
        "lanes": lanes,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--print-only", action="store_true")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    report = build_report(root)
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if not args.print_only:
        output = root / args.output
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    if args.check and not report["ok"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
