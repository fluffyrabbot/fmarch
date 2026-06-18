#!/usr/bin/env python3
"""Audit fmarch's im-human engine-port checklist against current proof surfaces.

This is intentionally report-only by default: it makes incomplete checklist
claims explicit without pretending that local artifact health proves the whole
port is done. Pass --require-complete when a release gate should fail on any
remaining unchecked or partly-proven checklist row, actionable unsupported
parity row, partial build-order phase, or missing proof surface.
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
DEFAULT_OUTPUT = "target/operator-proof/current-engine-port-completion-audit.json"
CHECKLIST_PATH = "docs/arch/11-engine-port-checklist.md"
PARITY_MATRIX_PATH = "docs/arch/im-human-engine-parity-matrix.md"
PROOF_MANIFEST_PATH = "docs/ops/proof-runs.json"
DEFAULT_BOUNDARY = (
    "Report-only completion audit over the source-derived checklist, parity matrix, "
    "proof-run manifest, and saved local artifacts; it does not execute proof commands "
    "and does not prove unchecked or partly-proven checklist rows complete."
)
FRESHNESS_BOUNDARY = (
    "Compares the saved completion-audit artifact mtime against the checklist, parity "
    "matrix, proof manifest, and manifest/summarized proof artifacts; write mode records "
    "the freshly written artifact as current, while --print-only and --check report the "
    "state of the saved artifact without rewriting it."
)
SAVED_ARTIFACTS = {
    "operator_go_no_go": "target/operator-proof/current-artifact-go-no-go-report.json",
    "operator_status_audit": "target/operator-proof/current-status-audit-report.json",
    "operator_retention": "target/operator-proof/current-artifact-retention-report.json",
    "determinism_fuzz": "target/operator-proof/current-determinism-fuzz-report.json",
    "primitive_modifier_interactions": "target/operator-proof/current-primitive-modifier-interaction-report.json",
    "engine_v4_test_family_coverage": "target/operator-proof/current-engine-v4-test-family-coverage-report.json",
    "unported_im_human_inventory": "target/operator-proof/current-unported-im-human-inventory-report.json",
    "domain_ci_no_postgres": "target/operator-proof/current-domain-ci-no-postgres-report.json",
    "generated_shrink_matrix": "target/operator-proof/current-generated-shrink-matrix-report.tmp.json",
    "browser_smoke": "target/operator-browser-smoke/playwright-dom-proof.json",
}
REQUIRED_BROWSER_GO_NO_GO_METADATA = [
    "resolve_elapsed_ms: 321",
    "threshold_ms: 20000",
    "trace_row_count: 74",
    "phase_trace_anchored: true",
    "decision_trace_anchored: true",
    "family_count: 12",
    "seed_count: 57",
    "expected_family_count: 12",
    "expected_seed_count: 57",
    "family_manifest_matched: true",
    "case_count: 14",
    "expected_case_count: 14",
]
REQUIRED_BROWSER_STATUS_METADATA_ROWS = [
    "proof-run-operator-proof-large-action-graph-performance",
    "proof-run-operator-proof-determinism-fuzz",
    "proof-run-operator-proof-generated-shrink-matrix",
]


@dataclass
class ChecklistItem:
    section_id: str
    section_title: str
    state: str
    text: str
    line: int
    partly_proven: bool


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_json(path: Path) -> tuple[bool, Any, str | None]:
    try:
        return True, json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError as err:
        return False, None, str(err)
    except json.JSONDecodeError as err:
        return False, None, str(err)


def parse_checklist(path: Path) -> dict[str, Any]:
    text = read_text(path)
    section_re = re.compile(r"^### ([A-Z])\. (.+)$")
    item_re = re.compile(r"^- \[(?P<state>[ xX])\] (?P<text>.+)$")
    current_id = ""
    current_title = ""
    items: list[ChecklistItem] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if match := section_re.match(line):
            current_id, current_title = match.group(1), match.group(2)
            continue
        if not current_id:
            continue
        if match := item_re.match(line):
            raw_state = match.group("state")
            state = "checked" if raw_state.lower() == "x" else "unchecked"
            item_text = match.group("text").strip()
            items.append(
                ChecklistItem(
                    section_id=current_id,
                    section_title=current_title,
                    state=state,
                    text=item_text,
                    line=line_no,
                    partly_proven="partly proven" in item_text.lower(),
                )
            )
    by_section: dict[str, dict[str, Any]] = {}
    for item in items:
        section = by_section.setdefault(
            item.section_id,
            {
                "id": item.section_id,
                "title": item.section_title,
                "total": 0,
                "checked": 0,
                "unchecked": 0,
                "partly_proven": 0,
                "open_examples": [],
                "partly_examples": [],
            },
        )
        section["total"] += 1
        section[item.state] += 1
        if item.partly_proven:
            section["partly_proven"] += 1
            if len(section["partly_examples"]) < 5:
                section["partly_examples"].append(
                    {"line": item.line, "text": compact(item.text)}
                )
        if item.state == "unchecked" and len(section["open_examples"]) < 5:
            section["open_examples"].append({"line": item.line, "text": compact(item.text)})

    totals = {
        "total": len(items),
        "checked": sum(1 for item in items if item.state == "checked"),
        "unchecked": sum(1 for item in items if item.state == "unchecked"),
        "partly_proven": sum(1 for item in items if item.partly_proven),
    }
    return {
        "path": path.as_posix(),
        **totals,
        "sections": list(by_section.values()),
    }


def parse_phase_status(path: Path) -> list[dict[str, Any]]:
    text = read_text(path)
    phase_re = re.compile(r"^### Phase (?P<phase>[0-7]) - (?P<title>.+)$", re.MULTILINE)
    phases: list[dict[str, Any]] = []
    matches = list(phase_re.finditer(text))
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[start:end]
        done_count = len(re.findall(r"\[done\b", body, flags=re.IGNORECASE))
        partly_count = len(re.findall(r"\[partly\b", body, flags=re.IGNORECASE))
        pending_count = len(re.findall(r"\bpending\b|\bremain(?:s|ing)?\b|\bfuture work\b", body, flags=re.IGNORECASE))
        exit_proof = ""
        if exit_match := re.search(r"Exit proof:(.+?)(?:\n\n|$)", body, flags=re.DOTALL):
            exit_proof = compact(exit_match.group(1))
        status = "complete" if partly_count == 0 and pending_count == 0 else "partial"
        phases.append(
            {
                "phase": int(match.group("phase")),
                "title": match.group("title").strip(),
                "status": status,
                "done_markers": done_count,
                "partly_markers": partly_count,
                "pending_markers": pending_count,
                "exit_proof": exit_proof,
            }
        )
    return phases


def parse_parity_matrix(path: Path) -> dict[str, Any]:
    text = read_text(path)
    rows = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if not line.startswith("| "):
            continue
        if line.startswith("| Category ") or line.startswith("|---"):
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
                "unsupported": cells[4],
                "modeled_in_pack": cells[5],
                "implemented_in_resolver": cells[6],
                "covered_by_golden": cells[7],
                "integrated_command_projection": cells[8],
                "notes": cells[9],
            }
        )

    def count(field: str, value: str) -> int:
        return sum(1 for row in rows if row[field] == value)

    unsupported_rows = [row for row in rows if row["unsupported"] == "yes"]
    for row in unsupported_rows:
        row["classification"] = classify_parity_row(row)
    actionable_unsupported = [
        row
        for row in unsupported_rows
        if row["classification"] != "explicit_out_of_scope"
    ]
    explicit_out_of_scope = [
        row
        for row in unsupported_rows
        if row["classification"] == "explicit_out_of_scope"
    ]
    unsupported_examples = parity_examples(unsupported_rows)
    actionable_examples = parity_examples(actionable_unsupported)
    out_of_scope_examples = parity_examples(explicit_out_of_scope)
    return {
        "path": path.as_posix(),
        "rows": len(rows),
        "unsupported": count("unsupported", "yes"),
        "actionable_unsupported": len(actionable_unsupported),
        "explicit_out_of_scope_unsupported": len(explicit_out_of_scope),
        "modeled_in_pack": count("modeled_in_pack", "yes"),
        "implemented_in_resolver": count("implemented_in_resolver", "yes"),
        "covered_by_golden": count("covered_by_golden", "yes"),
        "integrated_command_projection": count("integrated_command_projection", "yes"),
        "unsupported_examples": unsupported_examples,
        "actionable_unsupported_examples": actionable_examples,
        "explicit_out_of_scope_examples": out_of_scope_examples,
    }


def classify_parity_row(row: dict[str, Any]) -> str:
    text = f"{row.get('canonical_fmarch', '')} {row.get('notes', '')}".lower()
    if "out_of_scope" in text or "outside" in text or "non-resolution" in text:
        return "explicit_out_of_scope"
    return "not_yet_ported"


def parity_examples(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "line": row["line"],
            "category": row["category"],
            "item": row["item"],
            "classification": row.get("classification"),
        }
        for row in rows
    ][:20]


def parse_proof_manifest(path: Path) -> dict[str, Any]:
    present, data, error = read_json(path)
    if not present:
        return {"path": path.as_posix(), "present": False, "error": error}
    runs = [
        run
        for family in data.get("families", [])
        for run in family.get("runs", [])
    ]
    artifact_runs = [run for run in runs if "artifact_path" in run]
    return {
        "path": path.as_posix(),
        "present": True,
        "version": data.get("version"),
        "families": len(data.get("families", [])),
        "runs": len(runs),
        "artifact_runs": len(artifact_runs),
        "artifact_ids": [run.get("id") for run in artifact_runs],
        "artifact_paths": [
            run.get("artifact_path")
            for run in artifact_runs
            if isinstance(run.get("artifact_path"), str)
        ],
    }


def summarize_saved_artifacts(root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, relative in SAVED_ARTIFACTS.items():
        present, data, error = read_json(root / relative)
        row: dict[str, Any] = {"path": relative, "present": present}
        if not present:
            row["error"] = error
            result[name] = row
            continue
        row["ok"] = data.get("ok")
        if name == "operator_go_no_go":
            row["production"] = data.get("production")
            row["fixtures"] = data.get("fixtures")
        elif name == "operator_status_audit":
            row["diff_count"] = len(data.get("diffs", []))
        elif name == "operator_retention":
            row["regressions"] = len(data.get("regressions", []))
            row["recoveries"] = len(data.get("recoveries", []))
        elif name == "determinism_fuzz":
            row["family_count"] = data.get("family_count")
            row["seed_count"] = data.get("seed_count")
            row["passed_family_count"] = data.get("passed_family_count")
            row["failed_family_count"] = data.get("failed_family_count")
        elif name == "primitive_modifier_interactions":
            row["pack_count"] = data.get("pack_count")
            row["interaction_count"] = data.get("interaction_count")
            row["unique_interaction_count"] = data.get("unique_interaction_count")
            row["uncovered_count"] = data.get("uncovered_count")
            row["unsupported_parity_count"] = data.get("unsupported_parity_count")
        elif name == "engine_v4_test_family_coverage":
            row["family_count"] = data.get("family_count")
            row["mapped_count"] = data.get("mapped_count")
            row["covered_count"] = data.get("covered_count")
            row["explicit_unsupported_count"] = data.get("explicit_unsupported_count")
            row["failure_count"] = data.get("failure_count")
        elif name == "unported_im_human_inventory":
            row["unsupported_count"] = data.get("unsupported_count")
            row["category_counts"] = data.get("category_counts")
            row["classification_counts"] = data.get("classification_counts")
            row["requested_category_counts"] = data.get("requested_category_counts")
        elif name == "domain_ci_no_postgres":
            row["lane_count"] = data.get("lane_count")
            row["passed_count"] = data.get("passed_count")
            row["failed_count"] = data.get("failed_count")
            row["failed_lanes"] = data.get("failed_lanes")
            row["golden_pack_dirs"] = data.get("golden_pack_dirs")
        elif name == "generated_shrink_matrix":
            row["family_count"] = data.get("family_count")
            row["case_count"] = data.get("case_count")
            row["expected_family_count"] = data.get("expected_family_count")
            row["expected_case_count"] = data.get("expected_case_count")
            row["family_manifest_matched"] = data.get("family_manifest_matched")
        elif name == "browser_smoke":
            row.update(summarize_browser_smoke(data))
        result[name] = row
    return result


def summarize_browser_smoke(data: dict[str, Any]) -> dict[str, Any]:
    surfaces = data.get("surfaces")
    pages = data.get("pages")
    surface_rows = surfaces if isinstance(surfaces, list) else pages or []
    json_surfaces = data.get("jsonSurfaces")
    json_surface_rows = json_surfaces if isinstance(json_surfaces, list) else []
    go_no_go_surface = find_named_row(surface_rows, "operator-proof-go-no-go")
    go_no_go_checks = (
        go_no_go_surface.get("checks", []) if isinstance(go_no_go_surface, dict) else []
    )
    present_needles = {
        check.get("needle")
        for check in go_no_go_checks
        if isinstance(check, dict) and check.get("present") is True
    }
    missing_go_no_go_metadata = [
        needle
        for needle in REQUIRED_BROWSER_GO_NO_GO_METADATA
        if needle not in present_needles
    ]

    status_surface = find_named_row(json_surface_rows, "operator-proof-run-status")
    row_checks = status_surface.get("rowChecks", []) if isinstance(status_surface, dict) else []
    status_rows = {
        row.get("row_id"): row
        for row in row_checks
        if isinstance(row, dict) and row.get("row_id") in REQUIRED_BROWSER_STATUS_METADATA_ROWS
    }
    missing_status_rows = [
        row_id
        for row_id in REQUIRED_BROWSER_STATUS_METADATA_ROWS
        if row_id not in status_rows
    ]
    status_rows_without_metadata = [
        row_id
        for row_id, status_row in status_rows.items()
        if status_row.get("trusted_metadata_present") is not True
    ]
    status_rows_not_trusted = [
        row_id
        for row_id, status_row in status_rows.items()
        if status_row.get("state") != "trusted"
    ]
    go_no_go_metadata_ok = not missing_go_no_go_metadata
    status_metadata_ok = (
        not missing_status_rows
        and not status_rows_without_metadata
        and not status_rows_not_trusted
    )
    return {
        "ok": go_no_go_metadata_ok and status_metadata_ok,
        "game": data.get("game"),
        "base_url": data.get("base_url"),
        "evidence_pages": len(surface_rows),
        "json_evidence_pages": len(json_surface_rows),
        "go_no_go_metadata_needles_required": len(REQUIRED_BROWSER_GO_NO_GO_METADATA),
        "go_no_go_metadata_needles_present": (
            len(REQUIRED_BROWSER_GO_NO_GO_METADATA) - len(missing_go_no_go_metadata)
        ),
        "missing_go_no_go_metadata_needles": missing_go_no_go_metadata,
        "status_metadata_rows": {
            row_id: {
                "state": status_rows[row_id].get("state"),
                "trusted_metadata_present": status_rows[row_id].get(
                    "trusted_metadata_present"
                ),
            }
            for row_id in REQUIRED_BROWSER_STATUS_METADATA_ROWS
            if row_id in status_rows
        },
        "missing_status_metadata_rows": missing_status_rows,
        "status_rows_without_trusted_metadata": status_rows_without_metadata,
        "status_rows_not_trusted": status_rows_not_trusted,
    }


def find_named_row(rows: list[Any], name: str) -> dict[str, Any] | None:
    for row in rows:
        if isinstance(row, dict) and row.get("name") == name:
            return row
    return None


def recommended_next(
    checklist: dict[str, Any],
    parity: dict[str, Any],
    phases: list[dict[str, Any]],
) -> str:
    if checklist["unchecked"] > 0:
        for section in checklist["sections"]:
            if section["unchecked"] > 0:
                example = section["open_examples"][0]["text"] if section["open_examples"] else section["title"]
                return (
                    f"Start with checklist section {section['id']} ({section['title']}): "
                    f"convert an unchecked row into code plus proof, beginning with `{example}`."
                )
    if checklist["partly_proven"] > 0:
        for section in checklist["sections"]:
            if section["partly_proven"] > 0:
                example = section["partly_examples"][0]["text"] if section["partly_examples"] else section["title"]
                return (
                    f"Finish the partly-proven row in checklist section {section['id']} "
                    f"({section['title']}), beginning with `{example}`."
                )
    if parity["actionable_unsupported"] > 0:
        example = parity["actionable_unsupported_examples"][0]
        return (
            "Promote the next unsupported parity-matrix row into a scoped implementation slice: "
            f"{example['category']} `{example['item']}`."
        )
    for phase in phases:
        if phase["status"] != "complete":
            return (
                f"Continue Phase {phase['phase']} ({phase['title']}): convert the next pending "
                "or partly-proven phase marker into code plus proof."
            )
    return "Run --require-complete and then mark the goal complete only if the audit remains ok."


def compact(text: str, limit: int = 220) -> str:
    value = " ".join(text.split())
    return value if len(value) <= limit else value[: limit - 3] + "..."


def collect_input_paths(manifest: dict[str, Any]) -> list[str]:
    paths = [
        CHECKLIST_PATH,
        PARITY_MATRIX_PATH,
        PROOF_MANIFEST_PATH,
        *manifest.get("artifact_paths", []),
        *SAVED_ARTIFACTS.values(),
    ]
    return list(dict.fromkeys(path for path in paths if isinstance(path, str)))


def utc_mtime(path: Path) -> str:
    return (
        datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def summarize_freshness(
    root: Path,
    artifact_path: str,
    input_paths: list[str],
    *,
    artifact_is_current: bool,
) -> dict[str, Any]:
    artifact = root / artifact_path
    freshness: dict[str, Any] = {
        "artifact_path": artifact_path,
        "boundary": FRESHNESS_BOUNDARY,
        "input_count": len(input_paths),
        "newer_inputs": [],
        "missing_inputs": [],
    }
    missing_inputs = [
        relative
        for relative in input_paths
        if not (root / relative).exists()
    ]
    if artifact_is_current:
        freshness.update(
            {
                "artifact_present": True,
                "stale": False,
                "status": "fresh" if not missing_inputs else "freshness_unknown_missing_inputs",
                "missing_inputs": missing_inputs,
            }
        )
        return freshness

    if not artifact.exists():
        freshness.update(
            {
                "artifact_present": False,
                "stale": True,
                "status": "missing",
                "missing_inputs": missing_inputs,
            }
        )
        return freshness

    artifact_mtime = artifact.stat().st_mtime
    newer_inputs = []
    for relative in input_paths:
        input_path = root / relative
        if not input_path.exists():
            continue
        if input_path.stat().st_mtime > artifact_mtime:
            newer_inputs.append(
                {
                    "path": relative,
                    "input_mtime_utc": utc_mtime(input_path),
                    "artifact_mtime_utc": utc_mtime(artifact),
                }
            )
    status = "fresh"
    if newer_inputs:
        status = "stale"
    elif missing_inputs:
        status = "freshness_unknown_missing_inputs"
    freshness.update(
        {
            "artifact_present": True,
            "stale": bool(newer_inputs),
            "status": status,
            "newer_inputs": newer_inputs,
            "missing_inputs": missing_inputs,
        }
    )
    return freshness


def build_report(root: Path, artifact_path: str, *, artifact_is_current: bool) -> dict[str, Any]:
    checklist = parse_checklist(root / CHECKLIST_PATH)
    phases = parse_phase_status(root / CHECKLIST_PATH)
    parity = parse_parity_matrix(root / PARITY_MATRIX_PATH)
    manifest = parse_proof_manifest(root / PROOF_MANIFEST_PATH)
    input_paths = collect_input_paths(manifest)
    saved_artifacts = summarize_saved_artifacts(root)
    proof_artifacts_ok = all(
        row.get("present") and row.get("ok") is not False
        for row in saved_artifacts.values()
    )
    operator_go_no_go = saved_artifacts.get("operator_go_no_go", {})
    browser_smoke = saved_artifacts.get("browser_smoke", {})
    production = operator_go_no_go.get("production") or {}
    go_no_go_complete = (
        operator_go_no_go.get("ok") is True
        and production.get("total_artifact_rows") == production.get("trusted")
        and production.get("non_trusted") == 0
    )
    browser_smoke_complete = browser_smoke.get("ok") is True
    partial_phases = [phase for phase in phases if phase["status"] != "complete"]
    incomplete_reasons = []
    if checklist["unchecked"]:
        incomplete_reasons.append(f"{checklist['unchecked']} unchecked exhaustive-checklist rows remain")
    if checklist["partly_proven"]:
        incomplete_reasons.append(f"{checklist['partly_proven']} checklist rows still say partly proven")
    if parity["actionable_unsupported"]:
        incomplete_reasons.append(
            f"{parity['actionable_unsupported']} actionable parity-matrix rows are still unsupported"
        )
    if partial_phases:
        phase_labels = ", ".join(
            f"{phase['phase']} ({phase['title']})" for phase in partial_phases
        )
        incomplete_reasons.append(
            f"{len(partial_phases)} build-order phases are still partial: {phase_labels}"
        )
    if not go_no_go_complete:
        incomplete_reasons.append("operator artifact go/no-go is not fully trusted")
    if not browser_smoke_complete:
        incomplete_reasons.append("operator browser smoke metadata proof is missing or incomplete")
    if not proof_artifacts_ok:
        incomplete_reasons.append("one or more saved local proof artifacts are missing, malformed, or failed")
    ok = not incomplete_reasons
    return {
        "artifact_version": ARTIFACT_VERSION,
        "artifact_path": artifact_path,
        "ok": ok,
        "completion_claim": ok,
        "proof_boundary": DEFAULT_BOUNDARY,
        "inputs": input_paths,
        "freshness": summarize_freshness(
            root,
            artifact_path,
            input_paths,
            artifact_is_current=artifact_is_current,
        ),
        "checklist": checklist,
        "build_order_phases": phases,
        "parity_matrix": parity,
        "proof_manifest": manifest,
        "saved_artifacts": saved_artifacts,
        "incomplete_reasons": incomplete_reasons,
        "recommended_next_slice": recommended_next(checklist, parity, phases),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT,
    )
    parser.add_argument(
        "--print-only",
        action="store_true",
        help="print the audit report without writing the saved artifact",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "print the audit report without writing and exit nonzero if the saved "
            "artifact is missing, stale, or differs from the generated report"
        ),
    )
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="exit nonzero if the audit report is not complete",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve()
    output = root / args.output
    write_artifact = not args.print_only and not args.check
    report = build_report(root, args.output, artifact_is_current=write_artifact)
    check_errors = []
    if write_artifact:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    if args.check:
        present, saved_report, error = read_json(output)
        if not present:
            check_errors.append(f"saved audit artifact is not readable: {error}")
        elif saved_report != report:
            check_errors.append("saved audit artifact differs from the generated report")
        if report["freshness"]["status"] != "fresh":
            check_errors.append(
                f"saved audit artifact freshness status is {report['freshness']['status']}"
            )
    print(json.dumps(report, indent=2, sort_keys=True))
    for error in check_errors:
        print(f"check failed: {error}", file=sys.stderr)
    if args.require_complete and not report["ok"]:
        check_errors.append("completion audit is not complete")
    if check_errors:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
