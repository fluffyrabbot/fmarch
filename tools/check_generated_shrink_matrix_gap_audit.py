#!/usr/bin/env python3
"""Audit Phase 4 generated-shrink matrix coverage against the Rust manifest.

The generated-shrink matrix is intentionally a compact proof surface. This
tool keeps that compactness honest by comparing the checked Phase 4 expectation
set against the Rust operator-proof manifest and lightweight source needles.
It is a no-Postgres audit: it does not run the resolver or regenerate matrix
cases.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ARTIFACT_VERSION = 1
DEFAULT_OUTPUT = "target/operator-proof/current-generated-shrink-gap-audit-report.json"
CHECKLIST_PATH = "docs/arch/11-engine-port-checklist.md"
OPERATOR_PROOF_PATH = "crates/commands/src/operator_proof.rs"
PIPELINE_TEST_PATH = "crates/commands/tests/pipeline.rs"
PROOF_BOUNDARY = (
    "No-Postgres mechanical audit over the Phase 4 checklist expectation set, "
    "source/test evidence needles, and generated_shrink_matrix_expected_families(); "
    "it does not execute resolver cases or prove gameplay semantics beyond the "
    "existing generated-shrink matrix."
)


@dataclass(frozen=True)
class EvidenceNeedle:
    path: str
    needle: str


@dataclass(frozen=True)
class ExpectedFamily:
    family: str
    expected_case_count: int
    bucket: str
    checklist_needles: tuple[str, ...]
    source_needles: tuple[EvidenceNeedle, ...]
    recommended_next_slice: str


def needle(path: str, text: str) -> EvidenceNeedle:
    return EvidenceNeedle(path=path, needle=text)


def phase4_family(
    family: str,
    bucket: str,
    checklist_needles: tuple[str, ...],
    source_needles: tuple[EvidenceNeedle, ...],
    recommended_next_slice: str,
) -> ExpectedFamily:
    return ExpectedFamily(
        family=family,
        expected_case_count=2,
        bucket=bucket,
        checklist_needles=checklist_needles,
        source_needles=source_needles,
        recommended_next_slice=recommended_next_slice,
    )


EXPECTED_FAMILIES: tuple[ExpectedFamily, ...] = (
    phase4_family(
        "poison_cure",
        "Poison/douse/ignite/heal/cleanse",
        ("Poison/douse/ignite/heal/cleanse", "poison", "cure_poison"),
        (
            needle(PIPELINE_TEST_PATH, '("poison_cure"'),
            needle(PIPELINE_TEST_PATH, "pending_poison_applied"),
            needle(PIPELINE_TEST_PATH, "cure_poison"),
        ),
        "Restore poison/cure generated matrix rows and projection checks.",
    ),
    phase4_family(
        "ignite",
        "Poison/douse/ignite/heal/cleanse",
        ("Poison/douse/ignite/heal/cleanse", "douse", "ignite"),
        (
            needle(PIPELINE_TEST_PATH, '("ignite"'),
            needle(PIPELINE_TEST_PATH, "douse"),
            needle(PIPELINE_TEST_PATH, "ignite"),
        ),
        "Restore douse/ignite generated matrix rows and death projection checks.",
    ),
    phase4_family(
        "mark_clear_visibility",
        "Mark/Clear with expiry and visibility",
        ("Mark/Clear with expiry and visibility", "visibility"),
        (
            needle(PIPELINE_TEST_PATH, '("mark_clear_visibility"'),
            needle(PIPELINE_TEST_PATH, "mark_clear_visibility"),
        ),
        "Restore mark/clear visibility generated rows and visible/private projection checks.",
    ),
    phase4_family(
        "mark_clear_expiry",
        "Mark/Clear with expiry and visibility",
        ("Mark/Clear with expiry and visibility", "expiry"),
        (
            needle(PIPELINE_TEST_PATH, '("mark_clear_expiry"'),
            needle(PIPELINE_TEST_PATH, "mark_clear_expiry"),
        ),
        "Restore mark/clear expiry generated rows and expiry projection checks.",
    ),
    phase4_family(
        "extra_action",
        "Motivator/grant item/extra action and private notifications",
        ("Motivator/grant item/extra action and private notifications", "extra action"),
        (
            needle(PIPELINE_TEST_PATH, '("extra_action"'),
            needle(PIPELINE_TEST_PATH, "grant_id\": \"extra_action"),
        ),
        "Restore extra-action generated rows and grant-consumption projection checks.",
    ),
    phase4_family(
        "item_grant",
        "Motivator/grant item/extra action and private notifications",
        ("Motivator/grant item/extra action and private notifications", "grant item"),
        (
            needle(PIPELINE_TEST_PATH, '("item_grant"'),
            needle(PIPELINE_TEST_PATH, "ActionGranted"),
        ),
        "Restore item-grant generated rows and inventory projection checks.",
    ),
    phase4_family(
        "private_notification",
        "Motivator/grant item/extra action and private notifications",
        ("Motivator/grant item/extra action and private notifications", "private notifications"),
        (
            needle(PIPELINE_TEST_PATH, '("private_notification"'),
            needle(PIPELINE_TEST_PATH, "private_notification"),
        ),
        "Restore private-notification generated rows and recipient projection checks.",
    ),
    phase4_family(
        "conversion_deprogramming",
        "Conversion/deprogramming/backup inheritance",
        ("Conversion/deprogramming/backup inheritance", "deprogramming"),
        (
            needle(PIPELINE_TEST_PATH, '("conversion_deprogramming"'),
            needle(PIPELINE_TEST_PATH, "deprogramming"),
        ),
        "Restore conversion/deprogramming generated rows and alignment projection checks.",
    ),
    phase4_family(
        "conversion_projection_state",
        "Conversion/deprogramming/backup inheritance",
        ("Conversion/deprogramming/backup inheritance", "conversion"),
        (
            needle(PIPELINE_TEST_PATH, '("conversion_projection_state"'),
            needle(PIPELINE_TEST_PATH, "conversion_projection_state"),
        ),
        "Restore conversion projection-state generated rows.",
    ),
    phase4_family(
        "backup_inheritance",
        "Conversion/deprogramming/backup inheritance",
        ("Conversion/deprogramming/backup inheritance", "backup inheritance"),
        (
            needle(PIPELINE_TEST_PATH, '("backup_inheritance"'),
            needle(PIPELINE_TEST_PATH, "generated_mafiascum_backup_inheritance_fixture_json"),
        ),
        "Restore backup-inheritance generated rows and role inheritance projection checks.",
    ),
    phase4_family(
        "backup_projection_state",
        "Conversion/deprogramming/backup inheritance",
        ("Conversion/deprogramming/backup inheritance", "backup inheritance"),
        (
            needle(PIPELINE_TEST_PATH, '("backup_projection_state"'),
            needle(PIPELINE_TEST_PATH, "backup_projection_state"),
        ),
        "Restore backup projection-state generated rows.",
    ),
    phase4_family(
        "bomb",
        "Trigger fixpoint",
        ("Trigger fixpoint", "bomb"),
        (
            needle(PIPELINE_TEST_PATH, '("bomb"'),
            needle(PIPELINE_TEST_PATH, "bomb_retaliates"),
        ),
        "Restore bomb trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "bomb_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "bomb"),
        (
            needle(PIPELINE_TEST_PATH, '("bomb_projection_state"'),
            needle(PIPELINE_TEST_PATH, "bomb_projection_state"),
        ),
        "Restore bomb projection-state generated rows.",
    ),
    phase4_family(
        "hunter",
        "Trigger fixpoint",
        ("Trigger fixpoint", "hunter"),
        (
            needle(PIPELINE_TEST_PATH, '("hunter"'),
            needle(PIPELINE_TEST_PATH, "hunter_retaliate"),
        ),
        "Restore hunter trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "hunter_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "hunter"),
        (
            needle(PIPELINE_TEST_PATH, '("hunter_projection_state"'),
            needle(PIPELINE_TEST_PATH, "hunter_projection_state"),
        ),
        "Restore hunter projection-state generated rows.",
    ),
    phase4_family(
        "vengeful_fixpoint",
        "Trigger fixpoint",
        ("Trigger fixpoint", "vengeful"),
        (
            needle(PIPELINE_TEST_PATH, '("vengeful_fixpoint"'),
            needle(PIPELINE_TEST_PATH, "vengeful_retaliates"),
        ),
        "Restore vengeful trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "vengeful_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "vengeful"),
        (
            needle(PIPELINE_TEST_PATH, '("vengeful_projection_state"'),
            needle(PIPELINE_TEST_PATH, "vengeful_projection_state"),
        ),
        "Restore vengeful projection-state generated rows.",
    ),
    phase4_family(
        "strongman_vengeful_fixpoint",
        "Trigger fixpoint",
        ("Trigger fixpoint", "vengeful"),
        (
            needle(PIPELINE_TEST_PATH, '("strongman_vengeful_fixpoint"'),
            needle(PIPELINE_TEST_PATH, "strongman_vengeful"),
        ),
        "Restore strongman/vengeful trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "strongman_vengeful_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "vengeful"),
        (
            needle(PIPELINE_TEST_PATH, '("strongman_vengeful_projection_state"'),
            needle(PIPELINE_TEST_PATH, "strongman_vengeful_projection_state"),
        ),
        "Restore strongman/vengeful projection-state generated rows.",
    ),
    phase4_family(
        "bodyguard_strongman_vengeful_fixpoint",
        "Trigger fixpoint",
        ("Trigger fixpoint", "bodyguard"),
        (
            needle(PIPELINE_TEST_PATH, '("bodyguard_strongman_vengeful_fixpoint"'),
            needle(PIPELINE_TEST_PATH, "bodyguard_strongman_vengeful"),
        ),
        "Restore bodyguard/strongman/vengeful trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "bodyguard_strongman_vengeful_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "bodyguard"),
        (
            needle(PIPELINE_TEST_PATH, '("bodyguard_strongman_vengeful_projection_state"'),
            needle(PIPELINE_TEST_PATH, "bodyguard_strongman_vengeful_projection_state"),
        ),
        "Restore bodyguard/strongman/vengeful projection-state generated rows.",
    ),
    phase4_family(
        "pgo",
        "Trigger fixpoint",
        ("Trigger fixpoint", "PGO"),
        (
            needle(PIPELINE_TEST_PATH, '("pgo"'),
            needle(PIPELINE_TEST_PATH, "pgo_shoots_visitor"),
        ),
        "Restore PGO trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "pgo_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "PGO"),
        (
            needle(PIPELINE_TEST_PATH, '("pgo_projection_state"'),
            needle(PIPELINE_TEST_PATH, "pgo_projection_state"),
        ),
        "Restore PGO projection-state generated rows.",
    ),
    phase4_family(
        "lovers",
        "Trigger fixpoint",
        ("Trigger fixpoint", "lovers"),
        (
            needle(PIPELINE_TEST_PATH, '("lovers"'),
            needle(PIPELINE_TEST_PATH, "PlayersLinked"),
        ),
        "Restore lovers trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "lovers_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "lovers"),
        (
            needle(PIPELINE_TEST_PATH, '("lovers_projection_state"'),
            needle(PIPELINE_TEST_PATH, "lovers_projection_state"),
        ),
        "Restore lovers projection-state generated rows.",
    ),
    phase4_family(
        "babysitter",
        "Trigger fixpoint",
        ("Trigger fixpoint", "babysitter"),
        (
            needle(PIPELINE_TEST_PATH, '("babysitter"'),
            needle(PIPELINE_TEST_PATH, "babysitter"),
        ),
        "Restore babysitter trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "babysitter_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "babysitter"),
        (
            needle(PIPELINE_TEST_PATH, '("babysitter_projection_state"'),
            needle(PIPELINE_TEST_PATH, "babysitter_projection_state"),
        ),
        "Restore babysitter projection-state generated rows.",
    ),
    phase4_family(
        "hider",
        "Trigger fixpoint",
        ("Trigger fixpoint", "hider"),
        (
            needle(PIPELINE_TEST_PATH, '("hider"'),
            needle(PIPELINE_TEST_PATH, "hider"),
        ),
        "Restore hider trigger-fixpoint generated rows.",
    ),
    phase4_family(
        "hider_projection_state",
        "Trigger fixpoint",
        ("Trigger fixpoint", "hider"),
        (
            needle(PIPELINE_TEST_PATH, '("hider_projection_state"'),
            needle(PIPELINE_TEST_PATH, "hider_projection_state"),
        ),
        "Restore hider projection-state generated rows.",
    ),
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def compact(text: str) -> str:
    return " ".join(text.split())


def parse_generated_shrink_manifest(path: Path) -> dict[str, int]:
    text = read_text(path)
    fn_match = re.search(
        r"pub fn generated_shrink_matrix_expected_families\(\).*?\{\s*\[(?P<body>.*?)\]\s*"
        r"\.into_iter\(\)",
        text,
        flags=re.DOTALL,
    )
    if not fn_match:
        raise ValueError(f"could not find generated_shrink_matrix_expected_families() in {path}")
    entries: dict[str, int] = {}
    for family, count in re.findall(r'\("([^"]+)",\s*(\d+)(?:_usize)?\)', fn_match.group("body")):
        entries[family] = int(count)
    return entries


def find_missing_needles(root: Path, family: ExpectedFamily) -> list[dict[str, str]]:
    missing: list[dict[str, str]] = []
    checklist_text = read_text(root / CHECKLIST_PATH)
    for expected in family.checklist_needles:
        if expected.lower() not in checklist_text.lower():
            missing.append(
                {
                    "family": family.family,
                    "path": CHECKLIST_PATH,
                    "needle": expected,
                    "kind": "checklist",
                }
            )
    for evidence in family.source_needles:
        try:
            source_text = read_text(root / evidence.path)
        except FileNotFoundError:
            missing.append(
                {
                    "family": family.family,
                    "path": evidence.path,
                    "needle": evidence.needle,
                    "kind": "source",
                }
            )
            continue
        if evidence.needle not in source_text:
            missing.append(
                {
                    "family": family.family,
                    "path": evidence.path,
                    "needle": evidence.needle,
                    "kind": "source",
                }
            )
    return missing


def build_report(root: Path, output: str) -> dict[str, Any]:
    expected_by_family = {family.family: family for family in EXPECTED_FAMILIES}
    manifest = parse_generated_shrink_manifest(root / OPERATOR_PROOF_PATH)
    missing_families = sorted(set(expected_by_family) - set(manifest))
    unexpected_families = sorted(set(manifest) - set(expected_by_family))
    count_mismatches = [
        {
            "family": family,
            "expected_case_count": expected_by_family[family].expected_case_count,
            "manifest_case_count": manifest[family],
        }
        for family in sorted(set(expected_by_family) & set(manifest))
        if manifest[family] != expected_by_family[family].expected_case_count
    ]
    evidence_failures = [
        failure
        for family in EXPECTED_FAMILIES
        for failure in find_missing_needles(root, family)
    ]
    next_missing_family = missing_families[0] if missing_families else None
    recommended_next_slice = (
        expected_by_family[next_missing_family].recommended_next_slice
        if next_missing_family
        else "No generated-shrink family is missing from the audited Phase 4 persistent/generated-action set; next wire this no-Postgres gap audit into the operator proof manifest and browser/status truth surfaces so future matrix drift is visible with the rest of the proof lane."
    )
    ok = not (
        missing_families
        or unexpected_families
        or count_mismatches
        or evidence_failures
    )
    return {
        "artifact_version": ARTIFACT_VERSION,
        "artifact_path": output,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "ok": ok,
        "proof_boundary": PROOF_BOUNDARY,
        "inputs": {
            "checklist": CHECKLIST_PATH,
            "operator_proof_manifest": OPERATOR_PROOF_PATH,
            "source_evidence": sorted(
                {evidence.path for family in EXPECTED_FAMILIES for evidence in family.source_needles}
            ),
        },
        "expected_family_count": len(expected_by_family),
        "manifest_family_count": len(manifest),
        "expected_case_count": sum(family.expected_case_count for family in EXPECTED_FAMILIES),
        "manifest_case_count": sum(manifest.values()),
        "missing_families": missing_families,
        "unexpected_families": unexpected_families,
        "count_mismatches": count_mismatches,
        "evidence_failures": evidence_failures,
        "next_missing_family": next_missing_family,
        "recommended_next_slice": recommended_next_slice,
        "families": [
            {
                "family": family.family,
                "bucket": family.bucket,
                "expected_case_count": family.expected_case_count,
                "manifest_case_count": manifest.get(family.family),
                "checklist_needles": list(family.checklist_needles),
                "source_needles": [
                    {"path": evidence.path, "needle": evidence.needle}
                    for evidence in family.source_needles
                ],
                "recommended_next_slice_if_missing": family.recommended_next_slice,
            }
            for family in EXPECTED_FAMILIES
        ],
    }


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root to audit")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="report output path")
    parser.add_argument("--check", action="store_true", help="exit nonzero when the audit fails")
    parser.add_argument("--print-only", action="store_true", help="print report without writing it")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    report = build_report(root, args.output)
    if args.print_only:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        write_report(root / args.output, report)
        print(f"wrote {args.output}")
    if args.check and not report["ok"]:
        print(compact(report["recommended_next_slice"]), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
