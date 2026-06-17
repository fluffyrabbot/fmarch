#!/usr/bin/env python3
"""Report remaining unsupported im-human inventory rows from the parity matrix."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ARTIFACT_VERSION = 1
DEFAULT_OUTPUT = "target/operator-proof/current-unported-im-human-inventory-report.json"
PARITY_MATRIX_PATH = "docs/arch/im-human-engine-parity-matrix.md"
REQUESTED_CATEGORIES = {
    "primitive",
    "modifier:action",
    "modifier:effect",
    "result_event_kind",
    "culture_note",
}


def parse_matrix(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.startswith("| ") or line.startswith("| Category ") or line.startswith("|---"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 10:
            continue
        rows.append(
            {
                "line": line_no,
                "category": cells[0],
                "item": cells[1].strip("`"),
                "canonical_fmarch": cells[2].strip("`"),
                "source_count": int(cells[3]) if cells[3].isdigit() else cells[3],
                "unsupported": cells[4],
                "modeled_in_pack": cells[5],
                "implemented_in_resolver": cells[6],
                "covered_by_golden": cells[7],
                "integrated_command_projection": cells[8],
                "notes": cells[9],
            }
        )
    return rows


def classify(row: dict[str, Any]) -> str:
    text = f"{row['canonical_fmarch']} {row['notes']}".lower()
    if "out_of_scope" in text or "outside" in text or "non-resolution" in text:
        return "explicit_out_of_scope"
    return "not_yet_ported"


def rationale(row: dict[str, Any], classification: str) -> str:
    if classification == "explicit_out_of_scope":
        return row["notes"] or row["canonical_fmarch"]
    if row["category"].startswith("modifier:"):
        return "source modifier remains unsupported by pack/resolver/golden/command coverage"
    if row["category"] == "primitive":
        return "source primitive remains unsupported by pack/resolver/golden/command coverage"
    if row["category"] == "result_event_kind":
        if row["canonical_fmarch"]:
            return (
                "source result event kind has canonical fmarch schema coverage but remains "
                "unsupported by pack/resolver/golden/command coverage"
            )
        return "source result event kind has no canonical fmarch event/schema coverage"
    if row["category"] == "culture_note":
        return "source culture note has no modeled fmarch policy or proof coverage"
    if row["category"] == "role_id":
        return "source role id has no modeled pack role or playable proof coverage"
    if row["category"] == "test_family":
        return "source test family is explicitly outside the slot-only resolution target"
    return "source inventory row remains unsupported by all tracked parity columns"


def build_report(root: Path) -> dict[str, Any]:
    matrix_path = root / PARITY_MATRIX_PATH
    rows = parse_matrix(matrix_path)
    unsupported_rows = [row for row in rows if row["unsupported"] == "yes"]
    unsupported: list[dict[str, Any]] = []
    for row in unsupported_rows:
        classification = classify(row)
        unsupported.append(
            {
                **row,
                "classification": classification,
                "rationale": rationale(row, classification),
            }
        )

    by_category: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_classification: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in unsupported:
        by_category[row["category"]].append(row)
        by_classification[row["classification"]].append(row)

    category_counts = Counter(row["category"] for row in unsupported)
    requested = {
        category: {
            "unsupported_count": category_counts.get(category, 0),
            "rows": by_category.get(category, []),
        }
        for category in sorted(REQUESTED_CATEGORIES)
    }
    return {
        "artifact_version": ARTIFACT_VERSION,
        "ok": True,
        "proof_boundary": (
            "Report-only unsupported inventory over the generated parity matrix. "
            "It proves every currently unsupported row is visible with a category, line number, "
            "classification, and rationale; it does not implement the remaining rows."
        ),
        "parity_matrix_path": PARITY_MATRIX_PATH,
        "parity_row_count": len(rows),
        "unsupported_count": len(unsupported),
        "requested_category_counts": {
            category: requested[category]["unsupported_count"]
            for category in sorted(REQUESTED_CATEGORIES)
        },
        "category_counts": dict(sorted(category_counts.items())),
        "classification_counts": {
            name: len(values) for name, values in sorted(by_classification.items())
        },
        "requested_categories": requested,
        "unsupported_by_category": {
            category: by_category[category] for category in sorted(by_category)
        },
        "unsupported": unsupported,
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
