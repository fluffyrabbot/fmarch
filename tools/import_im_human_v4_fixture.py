#!/usr/bin/env python3
"""Import frozen im-human Engine V4 result JSON into fmarch result JSON.

The importer is intentionally strict. An im-human event kind must be listed in
the source-derived Engine V4 inventory mapping, and its payload must match an
explicit canonical fmarch shape before the fixture can become a
`ResolutionApplied` artifact.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from im_human_engine_inventory import RESULT_KIND_MAP


UNSUPPORTED_RESULT_KINDS = {
    "ita.shot.buffered",
    "ita.shot.invalidated",
    "ita.shot.refunded",
}

EVENT_KIND_KEYS = ("kind", "event", "result_kind")
PHASE_KINDS = {"Day", "Night", "Twilight", "Instant"}
VOTE_STATUSES = {"Lynch", "NoLynch", "NoMajority", "Tie", "Hammer"}
DUEL_RESULTS = {"Success", "Failure"}
ITA_OUTCOMES = {"Hit", "Miss", "Blocked"}
EFFECT_DURATIONS = {"Resolution", "Phase", "Persistent"}
EFFECT_VISIBILITIES = {"Hidden", "Target", "Actor", "ActorAndTarget", "Public"}
GRANT_KINDS = {"ExtraAction", "Item", "VoteWeight"}


class ImportErrorWithContext(ValueError):
    """Validation error that is safe to show to operators."""


def phase_fields() -> dict[str, str]:
    return {
        "phase_id": "str",
        "phase_kind": "phase_kind",
        "phase_number": "int",
    }


EVENT_PAYLOAD_SHAPES: dict[str, dict[str, Any]] = {
    "DayVoteRecorded": {
        "required": {"actor", "target", "withdrawn", "sequence"},
        "optional": set(),
        "types": {
            "actor": "str",
            "target": "nullable_str",
            "withdrawn": "bool",
            "sequence": "int",
        },
    },
    "DayVoteOutcome": {
        "required": {
            "status",
            "winner",
            "contenders",
            "tallies",
            "votes",
            "weights",
            "majority",
            "thresholds",
            "total_weight",
            "tiebreak",
            "reason",
        },
        "optional": set(),
        "types": {
            "status": "vote_status",
            "winner": "nullable_str",
            "contenders": "array",
            "tallies": "object",
            "votes": "object",
            "weights": "object",
            "majority": "nullable_number",
            "thresholds": "object",
            "total_weight": "number",
            "tiebreak": "nullable_str",
            "reason": "nullable_str",
        },
    },
    "DayAnnouncement": {
        "required": {
            "player_id",
            "cause",
            "source_action_id",
            "attackers",
            "unstoppable",
            "role_key",
            "recorded_at",
            "sequence",
            "day",
            "night",
            "phase_id",
        },
        "optional": set(),
        "types": {
            "player_id": "str",
            "cause": "str",
            "source_action_id": "nullable_str",
            "attackers": "array",
            "unstoppable": "bool",
            "role_key": "nullable_str",
            "recorded_at": "nullable_int",
            "sequence": "int",
            "day": "int",
            "night": "int",
            "phase_id": "str",
        },
    },
    "LastWordsRecorded": {
        "required": {"player_id", "reason", "sequence", "day", "phase_id", "vote"},
        "optional": set(),
        "types": {
            "player_id": "str",
            "reason": "str",
            "sequence": "int",
            "day": "int",
            "phase_id": "str",
            "vote": "object",
        },
    },
    "PhaseAnnouncement": {
        "required": {"phase_id", "deaths"},
        "optional": set(),
        "types": {"phase_id": "str", "deaths": "array"},
    },
    "PlayerKilled": {
        "required": {"slot_id", "cause", "attackers", "unstoppable"},
        "optional": {"death_reveal"},
        "types": {
            "slot_id": "str",
            "cause": "str",
            "attackers": "array",
            "unstoppable": "bool",
            "death_reveal": "str",
        },
    },
    "PlayerSaved": {
        "required": {"slot_id", "reasons", "sources"},
        "optional": set(),
        "types": {"slot_id": "str", "reasons": "array", "sources": "array"},
    },
    "PlayerConverted": {
        "required": {
            "target",
            "new_role",
            "new_alignment",
            "original_role",
            "original_alignment",
            "source",
        },
        "optional": set(),
        "types": {
            "target": "str",
            "new_role": "str",
            "new_alignment": "nullable_str",
            "original_role": "str",
            "original_alignment": "nullable_str",
            "source": "str",
        },
    },
    "ConversionBlocked": {
        "required": {"target", "status", "reason"},
        "optional": set(),
        "types": {"target": "str", "status": "str", "reason": "str"},
    },
    "EffectsMarked": {
        "required": {"effect", "target", "actor"},
        "optional": {
            "source_action",
            "phase_id",
            "phase_kind",
            "phase_number",
            "duration",
            "visibility",
        },
        "types": {
            "effect": "str",
            "target": "str",
            "actor": "str",
            "source_action": "nullable_str",
            "phase_id": "nullable_str",
            "phase_kind": "nullable_phase_kind",
            "phase_number": "nullable_int",
            "duration": "effect_duration",
            "visibility": "effect_visibility",
        },
    },
    "EffectsCleared": {
        "required": {"effect", "targets", "actor"},
        "optional": set(),
        "types": {"effect": "str", "targets": "array", "actor": "str"},
    },
    "EffectNotification": {
        "required": {"effect", "status", "audience"},
        "optional": set(),
        "types": {"effect": "str", "status": "str", "audience": "array"},
    },
    "InvestigationResult": {
        "required": {"mode", "investigator", "target", "result"},
        "optional": set(),
        "types": {
            "mode": "str",
            "investigator": "str",
            "target": "str",
            "result": "any",
        },
    },
    "Trigger": {
        "required": {"trigger_id", "payload"},
        "optional": set(),
        "types": {"trigger_id": "str", "payload": "any"},
    },
    "WinReached": {
        "required": {"winner", "reason", "metadata"},
        "optional": set(),
        "types": {"winner": "str", "reason": "str", "metadata": "any"},
    },
    "BadgeChanged": {
        "required": {
            "badge_id",
            "owner",
            "previous_owner",
            "vote_weight",
            "actor",
            "source_action",
            "reason",
            "destroyed",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "badge_id": "str",
            "owner": "nullable_str",
            "previous_owner": "nullable_str",
            "vote_weight": "nullable_number",
            "actor": "str",
            "source_action": "str",
            "reason": "str",
            "destroyed": "bool",
            **phase_fields(),
        },
    },
    "PlayersLinked": {
        "required": {"link_id", "slots", "source"},
        "optional": set(),
        "types": {"link_id": "str", "slots": "array", "source": "str"},
    },
    "DuelResolved": {
        "required": {
            "knight",
            "target",
            "result",
            "killed",
            "source_action",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "knight": "str",
            "target": "str",
            "result": "duel_result",
            "killed": "str",
            "source_action": "str",
            **phase_fields(),
        },
    },
    "WolfCarryUsed": {
        "required": {
            "owner_id",
            "target_id",
            "source_action_id",
            "effect_id",
            "role_key",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "owner_id": "str",
            "target_id": "str",
            "source_action_id": "str",
            "effect_id": "str",
            "role_key": "str",
            **phase_fields(),
        },
    },
    "WolfSelfDestructed": {
        "required": {
            "wolf_id",
            "target_id",
            "cause",
            "unstoppable",
            "source_action",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "wolf_id": "str",
            "target_id": "str",
            "cause": "str",
            "unstoppable": "bool",
            "source_action": "str",
            **phase_fields(),
        },
    },
    "WolfBeautyDragged": {
        "required": {
            "beauty_id",
            "dragged_ids",
            "cause",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "beauty_id": "str",
            "dragged_ids": "array",
            "cause": "str",
            **phase_fields(),
        },
    },
    "ItaSessionOpened": {
        "required": {
            "session_id",
            "label",
            "day",
            "window",
            "status",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "session_id": "str",
            "label": "nullable_str",
            "day": "nullable_int",
            "window": "nullable_str",
            "status": "str",
            **phase_fields(),
        },
    },
    "ItaSessionUpdated": {
        "required": {
            "session_id",
            "queue_length",
            "queue_delta",
            "shots_resolved",
            "global_shots_fired",
            "counters",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {
            "session_id": "str",
            "queue_length": "int",
            "queue_delta": "int",
            "shots_resolved": "int",
            "global_shots_fired": "int",
            "counters": "object",
            **phase_fields(),
        },
    },
    "ItaSessionClosed": {
        "required": {
            "session_id",
            "last_status",
            "phase_id",
            "phase_kind",
            "phase_number",
        },
        "optional": set(),
        "types": {"session_id": "str", "last_status": "str", **phase_fields()},
    },
    "ItaShotQueued": {
        "required": {
            "session_id",
            "action_id",
            "actor",
            "targets",
            "submitted_at",
            "queue_position",
            "queue_length",
            "previous_queue_length",
            "counters",
        },
        "optional": set(),
        "types": {
            "session_id": "str",
            "action_id": "str",
            "actor": "str",
            "targets": "array",
            "submitted_at": "int",
            "queue_position": "int",
            "queue_length": "int",
            "previous_queue_length": "int",
            "counters": "object",
        },
    },
    "ItaShotResolved": {
        "required": {
            "session_id",
            "action_id",
            "actor",
            "target",
            "outcome",
            "hit_chance",
            "roll",
            "kill",
            "submitted_at",
            "timestamp",
            "counters",
        },
        "optional": {
            "shield_before",
            "shield_after",
            "shield_spent",
            "protection_path",
        },
        "types": {
            "session_id": "str",
            "action_id": "str",
            "actor": "str",
            "target": "str",
            "outcome": "ita_outcome",
            "hit_chance": "number",
            "roll": "number",
            "kill": "bool",
            "shield_before": "nullable_int",
            "shield_after": "nullable_int",
            "shield_spent": "bool",
            "protection_path": "nullable_str",
            "submitted_at": "int",
            "timestamp": "int",
            "counters": "object",
        },
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path, help="frozen im-human V4 result JSON")
    parser.add_argument("--output", type=Path, help="canonical fmarch result JSON path")
    parser.add_argument(
        "--check",
        action="store_true",
        help="compare imported output to --output without rewriting it",
    )
    parser.add_argument(
        "--result-version",
        type=int,
        default=None,
        help="fmarch result_version to stamp on imported output; defaults to domain::RESULT_VERSION",
    )
    args = parser.parse_args()

    try:
        result_version = args.result_version
        if result_version is None:
            result_version = current_result_version()
        imported = import_fixture(args.fixture, result_version)
        encoded = json.dumps(imported, indent=2, sort_keys=False) + "\n"
        if args.check:
            if args.output is None:
                raise ImportErrorWithContext("--check requires --output")
            existing = args.output.read_text(encoding="utf-8")
            if existing != encoded:
                raise ImportErrorWithContext(
                    f"{args.output}: imported fixture output drifted"
                )
            print(f"ok: checked {args.fixture} -> {args.output}")
            return 0
        if args.output is None:
            sys.stdout.write(encoded)
            return 0
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
        print(f"ok: imported {args.fixture} -> {args.output}")
        return 0
    except (OSError, json.JSONDecodeError, ImportErrorWithContext) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


def import_fixture(path: Path, result_version: int) -> dict[str, Any]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ImportErrorWithContext(f"{path}: fixture must be a JSON object")

    phase_id = require_type(raw, "phase_id", str, path)
    phase_kind = require_type(raw, "phase_kind", str, path)
    if phase_kind not in PHASE_KINDS:
        raise ImportErrorWithContext(f"{path}: phase_kind {phase_kind!r} is not supported")
    phase_number = require_int(raw, "phase_number", path)
    run_id = require_type(raw, "run_id", str, path)
    seed = require_int(raw, "seed", path)
    started_at = require_int(raw, "started_at", path)
    finished_at = require_int(raw, "finished_at", path)
    if finished_at < started_at:
        raise ImportErrorWithContext(f"{path}: finished_at must be >= started_at")

    events_raw = raw.get("events")
    if not isinstance(events_raw, list):
        raise ImportErrorWithContext(f"{path}: events must be an array")
    events = [import_event(path, index, event) for index, event in enumerate(events_raw)]

    return {
        "phase_id": phase_id,
        "phase_kind": phase_kind,
        "phase_number": phase_number,
        "run_id": run_id,
        "result_version": result_version,
        "seed": seed,
        "counts": {
            "events": len(events),
            "kills": sum(1 for event in events if event["kind"] == "PlayerKilled"),
            "saves": sum(1 for event in events if event["kind"] == "PlayerSaved"),
        },
        "events": events,
        "started_at": started_at,
        "finished_at": finished_at,
    }


def import_event(path: Path, index: int, event: Any) -> dict[str, Any]:
    if not isinstance(event, dict):
        raise ImportErrorWithContext(f"{path}: events[{index}] must be an object")

    kind_keys = [key for key in EVENT_KIND_KEYS if key in event]
    if len(kind_keys) != 1:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] must contain exactly one kind key from {EVENT_KIND_KEYS}"
        )
    extra_event_keys = set(event) - {kind_keys[0], "payload"}
    if extra_event_keys:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] has unsupported fields {sorted(extra_event_keys)}"
        )

    source_kind = event[kind_keys[0]]
    if not isinstance(source_kind, str) or not source_kind:
        raise ImportErrorWithContext(f"{path}: events[{index}] kind must be a non-empty string")
    if source_kind in UNSUPPORTED_RESULT_KINDS:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] im-human event kind {source_kind!r} is unsupported"
        )
    canonical_kind = RESULT_KIND_MAP.get(source_kind)
    if canonical_kind is None:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] unknown im-human event kind {source_kind!r}"
        )

    payload = event.get("payload")
    validate_payload(path, index, source_kind, canonical_kind, payload)
    return {"index": index, "kind": canonical_kind, "payload": payload}


def validate_payload(
    path: Path, index: int, source_kind: str, canonical_kind: str, payload: Any
) -> None:
    if not isinstance(payload, dict):
        raise ImportErrorWithContext(f"{path}: events[{index}] payload must be an object")
    shape = EVENT_PAYLOAD_SHAPES.get(canonical_kind)
    if shape is None:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] canonical kind {canonical_kind!r} from "
            f"{source_kind!r} has no importer payload validator"
        )

    required = shape["required"]
    optional = shape["optional"]
    allowed = required | optional
    missing = sorted(required - set(payload))
    if missing:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] {source_kind!r} missing payload fields {missing}"
        )
    extra = sorted(set(payload) - allowed)
    if extra:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] {source_kind!r} has unsupported payload fields {extra}"
        )
    for field, expected_type in shape["types"].items():
        if field in payload:
            validate_type(path, index, source_kind, field, payload[field], expected_type)


def validate_type(
    path: Path, index: int, source_kind: str, field: str, value: Any, expected: str
) -> None:
    ok = False
    if expected == "any":
        ok = True
    elif expected == "str":
        ok = isinstance(value, str)
    elif expected == "nullable_str":
        ok = value is None or isinstance(value, str)
    elif expected == "int":
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif expected == "nullable_int":
        ok = value is None or (isinstance(value, int) and not isinstance(value, bool))
    elif expected == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif expected == "nullable_number":
        ok = value is None or (isinstance(value, (int, float)) and not isinstance(value, bool))
    elif expected == "bool":
        ok = isinstance(value, bool)
    elif expected == "array":
        ok = isinstance(value, list)
    elif expected == "object":
        ok = isinstance(value, dict)
    elif expected == "phase_kind":
        ok = isinstance(value, str) and value in PHASE_KINDS
    elif expected == "nullable_phase_kind":
        ok = value is None or (isinstance(value, str) and value in PHASE_KINDS)
    elif expected == "vote_status":
        ok = isinstance(value, str) and value in VOTE_STATUSES
    elif expected == "duel_result":
        ok = isinstance(value, str) and value in DUEL_RESULTS
    elif expected == "ita_outcome":
        ok = isinstance(value, str) and value in ITA_OUTCOMES
    elif expected == "effect_duration":
        ok = isinstance(value, str) and value in EFFECT_DURATIONS
    elif expected == "effect_visibility":
        ok = isinstance(value, str) and value in EFFECT_VISIBILITIES
    elif expected == "grant_kind":
        ok = isinstance(value, str) and value in GRANT_KINDS
    else:
        raise AssertionError(f"unknown importer type validator {expected!r}")

    if not ok:
        raise ImportErrorWithContext(
            f"{path}: events[{index}] {source_kind!r} payload field {field!r} "
            f"must be {expected}, got {type(value).__name__}"
        )


def require_type(raw: dict[str, Any], field: str, expected: type, path: Path) -> Any:
    value = raw.get(field)
    if not isinstance(value, expected):
        raise ImportErrorWithContext(
            f"{path}: {field} must be {expected.__name__}, got {type(value).__name__}"
        )
    return value


def require_int(raw: dict[str, Any], field: str, path: Path) -> int:
    value = raw.get(field)
    if not isinstance(value, int) or isinstance(value, bool):
        raise ImportErrorWithContext(f"{path}: {field} must be int")
    return value


def current_result_version() -> int:
    resolver = Path(__file__).resolve().parents[1] / "crates/domain/src/resolver.rs"
    marker = "pub const RESULT_VERSION: u16 = "
    for line in resolver.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(marker) and stripped.endswith(";"):
            return int(stripped[len(marker) : -1])
    raise ImportErrorWithContext(f"{resolver}: could not find domain RESULT_VERSION")


if __name__ == "__main__":
    raise SystemExit(main())
