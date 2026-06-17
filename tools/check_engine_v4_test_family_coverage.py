#!/usr/bin/env python3
"""Check fmarch coverage mapping for im-human Engine V4 test families."""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any


ARTIFACT_VERSION = 1
DEFAULT_OUTPUT = "target/operator-proof/current-engine-v4-test-family-coverage-report.json"
INVENTORY_PATH = "docs/arch/im-human-engine-inventory.json"
PARITY_MATRIX_PATH = "docs/arch/im-human-engine-parity-matrix.md"


def load_inventory_module(root: Path) -> Any:
    path = root / "tools/im_human_engine_inventory.py"
    spec = importlib.util.spec_from_file_location("im_human_engine_inventory", path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_test_family_rows(path: Path) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.startswith("| test_family "):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 10:
            continue
        rows[cells[1].strip("`")] = {
            "line": line_no,
            "canonical_fmarch": cells[2].strip("`"),
            "unsupported": cells[4],
            "modeled_in_pack": cells[5],
            "implemented_in_resolver": cells[6],
            "covered_by_golden": cells[7],
            "integrated_command_projection": cells[8],
            "notes": cells[9],
        }
    return rows


def evidence_ok(root: Path, evidence: dict[str, str]) -> tuple[bool, str | None]:
    relative = evidence.get("path")
    if not relative:
        return False, "missing evidence path"
    path = root / relative
    if not path.exists():
        return False, f"missing evidence path {relative}"
    needle = evidence.get("needle")
    if needle and needle not in path.read_text(encoding="utf-8"):
        return False, f"missing evidence needle {needle!r} in {relative}"
    return True, None


def build_report(root: Path) -> dict[str, Any]:
    inventory = read_json(root / INVENTORY_PATH)
    inventory_module = load_inventory_module(root)
    coverage_map = inventory_module.TEST_FAMILY_COVERAGE
    parity_rows = parse_test_family_rows(root / PARITY_MATRIX_PATH)

    rows: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    for family in inventory.get("test_families", []):
        name = family["name"]
        coverage = coverage_map.get(name)
        parity = parity_rows.get(name)
        row: dict[str, Any] = {
            "family": name,
            "source_test_count": family["test_count"],
            "source_example": family["example"],
            "mapped": coverage is not None,
            "parity_row_present": parity is not None,
        }
        if not coverage:
            row["problems"] = ["missing coverage mapping"]
            failures.append(row)
            rows.append(row)
            continue

        evidence_results = []
        problems = []
        for evidence in coverage.get("evidence", []):
            ok, problem = evidence_ok(root, evidence)
            evidence_results.append({**evidence, "ok": ok, "problem": problem})
            if problem:
                problems.append(problem)
        if not coverage.get("evidence"):
            problems.append("coverage mapping has no evidence entries")
        if not parity:
            problems.append("missing parity matrix test_family row")
        else:
            expected = {
                "canonical_fmarch": coverage.get("canonical", ""),
                "modeled_in_pack": "yes" if coverage.get("modeled", False) else "no",
                "implemented_in_resolver": "yes"
                if coverage.get("implemented", False)
                else "no",
                "covered_by_golden": "yes" if coverage.get("golden", False) else "no",
                "integrated_command_projection": "yes"
                if coverage.get("integrated", False)
                else "no",
            }
            for field, expected_value in expected.items():
                if parity.get(field) != expected_value:
                    problems.append(
                        f"parity matrix {field}={parity.get(field)!r}, expected {expected_value!r}"
                    )
            unsupported_expected = "no" if any(
                coverage.get(field, False)
                for field in ("modeled", "implemented", "golden", "integrated")
            ) else "yes"
            if parity.get("unsupported") != unsupported_expected:
                problems.append(
                    f"parity matrix unsupported={parity.get('unsupported')!r}, expected {unsupported_expected!r}"
                )
        row.update(
            {
                "canonical_fmarch": coverage.get("canonical", ""),
                "modeled_in_pack": coverage.get("modeled", False),
                "implemented_in_resolver": coverage.get("implemented", False),
                "covered_by_golden": coverage.get("golden", False),
                "integrated_command_projection": coverage.get("integrated", False),
                "notes": coverage.get("notes", ""),
                "evidence": evidence_results,
                "problems": problems,
            }
        )
        if problems:
            failures.append(row)
        rows.append(row)

    mapped = [row for row in rows if row.get("mapped")]
    unsupported = [
        row
        for row in mapped
        if not any(
            row.get(field, False)
            for field in (
                "modeled_in_pack",
                "implemented_in_resolver",
                "covered_by_golden",
                "integrated_command_projection",
            )
        )
    ]
    return {
        "artifact_version": ARTIFACT_VERSION,
        "ok": not failures,
        "proof_boundary": (
            "Maps source-derived im-human Engine V4 test-family buckets to fmarch evidence. "
            "Evidence is path/needle based and proves the mapped proof surface exists; it does "
            "not execute every mapped Rust selector or prove full im-human behavioral parity."
        ),
        "inventory_path": INVENTORY_PATH,
        "parity_matrix_path": PARITY_MATRIX_PATH,
        "family_count": len(rows),
        "mapped_count": len(mapped),
        "covered_count": len(mapped) - len(unsupported),
        "explicit_unsupported_count": len(unsupported),
        "failure_count": len(failures),
        "failures": failures,
        "families": rows,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
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
