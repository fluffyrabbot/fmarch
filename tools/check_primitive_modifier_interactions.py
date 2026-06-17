#!/usr/bin/env python3
"""Check golden coverage for product pack primitive/modifier interactions."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


ARTIFACT_VERSION = 1
DEFAULT_OUTPUT = (
    "target/operator-proof/current-primitive-modifier-interaction-report.json"
)
PRODUCT_PACK_SKIP_PREFIXES = ("test_",)
MODIFIER_CONSTRAINTS = {
    "active_from": "active_from",
    "cooldown_cycles": "cooldown_cycles",
    "target_role_filter": "target_role_filter",
    "personal_only": "Personal",
    "lazy_requires_multiple_non_town": "Lazy",
    "disabled_at_or_below_alive": "DisabledEndgame",
    "uncooperative_result": "Uncooperative",
}
VALUE_MODIFIER_CONSTRAINTS = {
    "phase_parity": "phase_parity",
    "cycle_parity": "cycle_parity",
    "target_state": "target_state",
}


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def product_pack_dirs(root: Path) -> list[Path]:
    packs_root = root / "packs"
    return sorted(
        pack_dir
        for pack_dir in packs_root.iterdir()
        if (pack_dir / "pack.json").is_file()
        and not pack_dir.name.startswith(PRODUCT_PACK_SKIP_PREFIXES)
    )


def golden_template_index(pack_dir: Path) -> dict[str, list[str]]:
    index: dict[str, set[str]] = defaultdict(set)
    golden_dir = pack_dir / "golden"
    if not golden_dir.is_dir():
        return {}
    for path in sorted(golden_dir.glob("*.json")):
        data = read_json(path)
        for submission in data.get("input", {}).get("submissions", []) or []:
            template_id = submission.get("template_id")
            if isinstance(template_id, str):
                index[template_id].add(path.name)
    return {template_id: sorted(fixtures) for template_id, fixtures in index.items()}


def action_modifier_rows(action: dict[str, Any]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(modifier: str, source: str) -> None:
        if modifier not in seen:
            seen.add(modifier)
            rows.append({"modifier": modifier, "source": source})

    for modifier in action.get("modifiers", []) or []:
        if isinstance(modifier, str):
            add(modifier, "action.modifiers")

    constraints = action.get("constraints", {}) or {}
    if constraints.get("x_shots") is not None:
        add("XShot", "constraints.x_shots")
    for key, modifier in MODIFIER_CONSTRAINTS.items():
        value = constraints.get(key)
        if value not in (None, False, [], {}):
            add(modifier, f"constraints.{key}")
    for key, prefix in VALUE_MODIFIER_CONSTRAINTS.items():
        value = constraints.get(key)
        if value not in (None, False, [], {}):
            add(f"{prefix}:{value}", f"constraints.{key}")
    return rows


def unsupported_parity_rows(root: Path) -> list[dict[str, Any]]:
    path = root / "docs/arch/im-human-engine-parity-matrix.md"
    rows: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.startswith("| ") or line.startswith("| Category ") or line.startswith("|---"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) < 10:
            continue
        if cells[4] != "yes":
            continue
        if cells[0] not in {"modifier:action", "primitive"}:
            continue
        rows.append(
            {
                "line": line_no,
                "category": cells[0],
                "item": cells[1].strip("`"),
                "canonical_fmarch": cells[2].strip("`"),
            }
        )
    return rows


def build_report(root: Path) -> dict[str, Any]:
    interactions: list[dict[str, Any]] = []
    pack_summaries: list[dict[str, Any]] = []
    for pack_dir in product_pack_dirs(root):
        pack = read_json(pack_dir / "pack.json")
        golden_index = golden_template_index(pack_dir)
        pack_interactions = 0
        uncovered = 0
        for role_key, role in sorted((pack.get("roles") or {}).items()):
            for action in role.get("actions", []) or []:
                action_id = action.get("id")
                primitive = action.get("ability")
                if not isinstance(action_id, str) or not isinstance(primitive, str):
                    continue
                for modifier_row in action_modifier_rows(action):
                    fixtures = golden_index.get(action_id, [])
                    covered = bool(fixtures)
                    pack_interactions += 1
                    uncovered += 0 if covered else 1
                    interactions.append(
                        {
                            "pack": pack_dir.name,
                            "role": role_key,
                            "action_id": action_id,
                            "primitive": primitive,
                            "modifier": modifier_row["modifier"],
                            "source": modifier_row["source"],
                            "covered_by_golden": covered,
                            "golden_fixtures": fixtures,
                        }
                    )
        pack_summaries.append(
            {
                "pack": pack_dir.name,
                "interaction_count": pack_interactions,
                "uncovered_count": uncovered,
                "golden_fixture_count": len(list((pack_dir / "golden").glob("*.json")))
                if (pack_dir / "golden").is_dir()
                else 0,
            }
        )

    uncovered_rows = [row for row in interactions if not row["covered_by_golden"]]
    unsupported = unsupported_parity_rows(root)
    return {
        "artifact_version": ARTIFACT_VERSION,
        "ok": not uncovered_rows,
        "proof_boundary": (
            "Checks non-test product packs only. An interaction is a pack-declared "
            "action ability paired with an explicit action modifier or modifier-like "
            "constraint; the report proves each such action template is exercised by "
            "at least one golden fixture. Policy-only role modifiers and unsupported "
            "parity rows are listed separately."
        ),
        "pack_count": len(pack_summaries),
        "packs": pack_summaries,
        "interaction_count": len(interactions),
        "unique_interaction_count": len(
            {(row["primitive"], row["modifier"]) for row in interactions}
        ),
        "uncovered_count": len(uncovered_rows),
        "uncovered": uncovered_rows,
        "unsupported_parity_rows": unsupported,
        "unsupported_parity_count": len(unsupported),
        "interactions": interactions,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit nonzero when a covered product interaction is missing a golden",
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="print the report without writing --output",
    )
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
