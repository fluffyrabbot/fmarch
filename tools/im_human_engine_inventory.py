#!/usr/bin/env python3
"""Extract im-human Engine V4 inventory and emit fmarch parity artifacts.

The script is intentionally mechanical: it reads known Engine V4 source surfaces
and writes a JSON inventory plus a Markdown parity matrix. It uses only the
Python standard library so it can run in a fresh checkout.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


PRIMITIVE_MAP = {
    "block": "Block",
    "roleblock": "Block",
    "kill": "Kill",
    "self_destruct": "SelfDestruct",
    "day_self_destruct": "SelfDestruct",
    "knight_duel": "Duel",
    "duel": "Duel",
    "pierce": "Kill",
    "poison": "Mark",
    "strongman": "Kill",
    "guard": "Protect",
    "bodyguard": "Protect",
    "protect": "Protect",
    "retarget": "Redirect",
    "redirect": "Redirect",
    "swap": "Redirect",
    "busdrive": "Redirect",
    "mirror": "Redirect",
    "investigate": "Investigate",
    "parity": "Investigate",
    "track": "Investigate",
    "watch": "Investigate",
    "motion": "Investigate",
    "convert": "Convert",
    "vanillaize": "Convert::AssignRole",
    "veto": "Veto",
    "restore_mutation": "Convert::RestoreOriginal",
    "mark": "Mark",
    "info": "InfoResult",
    "beauty_mark": "Mark",
    "douse": "Mark",
    "clear": "Clear",
    "cleanse": "Clear",
    "heal_poison": "Clear",
    "cure_poison": "Clear",
    "mark_cleansed": "EffectsCleared",
    "ignite": "Kill",
    "commute": "target_state_gate:commuted",
    "untargetable": "target_state_gate:untargetable",
    "ita_shot": "ItaShot",
    "condemner": "TargetLynchWinTargeted",
    "condemner_win": "WinReached",
    "executioner": "TargetLynchWinTargeted",
    "executioner_win": "WinReached",
    "lynch_target_win": "TargetLynchWinTargeted+WinReached",
    "beloved_princess": "HostPromptIssued",
    "bomb": "TriggerOn::Kill+bomb_retaliates",
    "hunter": "Retaliate+RetaliationArmed",
    "pgo": "TriggerOn::Visit+pgo_shoots_visitor",
    "super_saint": "TriggerOn::Lynch+super_saint_retaliates",
    "vengeful": "TriggerOn::Kill+vengeful_retaliates",
    "visitor_kill": "TriggerOn::Visit+TargetFilteredKill",
    "trigger": "trigger_table+trigger_fixpoint_policy",
    "conceal": "death_reveal:Concealed",
}

INFO_SOCIAL_VISIT_ACTIONS = {
    "mafiascum:friendly_neighbor": "host_resolve_phase_records_friendly_neighbor_visit",
    "mafiascum:neighborize": "host_resolve_phase_records_neighborize_visit",
    "mafiascum:visit": "host_resolve_phase_records_visit_history_for_prior_motion",
}

INFO_PUBLIC_ALIGNMENT_REVEAL_ACTIONS = {
    "mafiascum:reveal_town": "host_resolve_phase_reveals_town_alignment_without_role",
    "mafia_universe:reveal_town": "host_resolve_phase_carries_mafia_universe_reveal_town",
}

INFO_PRIVATE_EFFECT_NOTIFICATION_ACTIONS = {
    "mafiascum:send_fruit": "host_resolve_phase_carries_mafiascum_fruit_vendor_notification",
    "mafia_universe:send_fruit": "host_resolve_phase_carries_mafia_universe_fruit_vendor_notifications",
}

INFO_GENERIC_RESULT_ACTIONS = {
    "mafiascum:mailman": "host_resolve_phase_projects_mafiascum_info_results",
    "mafiascum:observe": "host_resolve_phase_projects_mafiascum_info_results",
    "mafiascum:report": "host_resolve_phase_projects_mafiascum_info_results",
}

INFO_PUBLIC_VOTE_DUEL_ACTIONS = {
    "mafiascum:duel": "host_resolve_phase_applies_gladiator_vote_duel",
}

MODIFIER_MAP = {
    "announcing": "Announcing",
    "activated": "active_from",
    "compulsive": "Compulsive",
    "disabled_endgame": "DisabledEndgame",
    "even_cycle": "cycle_parity:Even",
    "even_night": "EvenNight",
    "day": "action_window:Day",
    "alignment_only_flip": "death_reveal:AlignmentOnly",
    "flipless": "death_reveal:Concealed",
    "loud": "Loud",
    "godfather": "role_effect:godfather",
    "janitor": "death_reveal:Concealed",
    "macho": "role_effect:macho",
    "night_specific": "action_window:Night",
    "non_consecutive": "NonConsecutive",
    "non_consecutive_night": "NonConsecutive",
    "novice": "active_from",
    "odd_cycle": "cycle_parity:Odd",
    "odd_night": "OddNight",
    "strongman": "Strongman",
    "stealthy": "Ninja",
    "ninja": "Ninja",
    "loyal": "Loyal",
    "disloyal": "Disloyal",
    "self_targetable": "Reflexive",
    "reflexive": "Reflexive",
    "blocked": "Roleblockable",
    "strong_willed": "StrongWilled",
    "weak": "Weak",
    "x_cycle_cooldown": "cooldown_cycles",
    "x_shot": "XShot",
    "bulletproof": "bulletproof",
    "bulletproof_vest": "bulletproof_vest",
    "backup": "backup_policy",
    "better_ita_chance": "ita.modifier_components.hit_bonus",
    "combined": "additional_abilities",
    "complex": "target_role_filter:PowerRole",
    "cycle_x": "cooldown_cycles",
    "tiebreaker": "vote.tiebreaker_roles",
    "worse_ita_chance": "ita.modifier_components.hit_penalty",
    "percent_ita_vulnerability": "ita.modifier_components.target_evade",
    "xn_ita_shields": "ita.modifier_components.shields",
    "doublevoter": "vote.weight=2",
    "triplevoter": "vote.weight=3",
    "x_voter": "vote.weight=2",
    "voteless": "vote.weight=0",
    "loved": "vote.threshold+1",
    "hated": "vote.threshold-1",
    "indecisive": "Indecisive",
    "lazy": "Lazy",
    "lover": "lover_policy",
    "lost": "RoleModifier::Lost",
    "mason": "private_channels:Mason",
    "neighbor": "private_channels:Neighbor",
    "treestump": "treestump_policy",
    "personal": "Personal",
    "recluse": "RoleModifier::Recluse",
    "roaming": "Roaming",
    "simultaneous": "Simultaneous",
    "uncooperative": "Uncooperative",
}

RESULT_KIND_MAP = {
    "day.vote.recorded": "DayVoteRecorded",
    "day.vote.outcome": "DayVoteOutcome",
    "note.day.announcement": "DayAnnouncement",
    "note.day.last_words": "LastWordsRecorded",
    "phase.announcement": "PhaseAnnouncement",
    "ingest.halt": "ActionIngestHalted",
    "player.killed": "PlayerKilled",
    "player.saved": "PlayerSaved",
    "player.converted": "PlayerConverted",
    "effects.conversion_blocked": "ConversionBlocked",
    "effects.marked": "EffectsMarked",
    "effects.cleared": "EffectsCleared",
    "player.effect_notification": "EffectNotification",
    "investigation.result": "InvestigationResult",
    "trigger.fired": "Trigger",
    "win.condemner": "WinReached",
    "win.executioner": "WinReached",
    "win.jester": "WinReached",
    "note.sheriff.pass": "BadgeChanged",
    "note.cupid.link": "PlayersLinked",
    "note.knight.duel": "DuelResolved",
    "note.wolf.carry": "WolfCarryUsed",
    "note.wolf.self_destruct": "WolfSelfDestructed",
    "note.wolf_beauty.drag": "WolfBeautyDragged",
    "ita.session.opened": "ItaSessionOpened",
    "ita.session.updated": "ItaSessionUpdated",
    "ita.session.closed": "ItaSessionClosed",
    "ita.shot.queued": "ItaShotQueued",
    "ita.shot.buffered": "ItaShotBuffered",
    "ita.shot.invalidated": "ItaShotInvalidated",
    "ita.shot.refunded": "ItaShotRefunded",
    "ita.shot.resolved": "ItaShotResolved",
    "win.reached": "WinReached",
}

ITA_DEFERRED_SHOT_RESULT_KINDS = {
    "ita.shot.invalidated",
    "ita.shot.refunded",
}

DAY_STEP_MAP = {
    "vote": "DayVoteOutcome",
    "announcement": "DayAnnouncement",
    "last_words": "LastWordsRecorded",
    "sheriff_badge": "BadgeChanged",
    "wolf_self_destruct": "WolfSelfDestructed",
    "knight_duel": "DuelResolved",
    "ita_session": "ItaSessionOpened",
}

CULTURE_NOTE_MAP = {
    "chinese_structured:guard": "guard_policy",
    "chinese_structured:wolf": "wolf_night_kill+coordinated_vote",
    "chinese_structured:white_wolf_carry": "WolfCarryUsed",
    "chinese_structured:white_wolf_king": "SelfDestruct",
    "chinese_structured:wolf_beauty": "WolfBeautyDragged",
    "chinese_structured:hunter": "Retaliate",
    "chinese_structured:idiot": "PlayerSaved",
    "chinese_structured:knight": "DuelResolved",
    "chinese_structured:prophet": "InvestigationResult",
    "chinese_structured:sheriff_badge_helper": "BadgeChanged",
    "chinese_structured:cupid": "PlayersLinked",
    "chinese_structured:lovers_helper": "lover_policy",
}

TEST_FAMILY_COVERAGE = {
    "action_spec_primitives_test": {
        "canonical": "pack_validation+parity_matrix",
        "modeled": True,
        "implemented": True,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "shipped_packs_validate",
            },
            {
                "path": "docs/arch/im-human-engine-parity-matrix.md",
                "needle": "| primitive |",
            },
        ],
        "notes": "primitive action specs are covered by strict pack validation plus source-derived primitive parity rows",
    },
    "action_spec_test": {
        "canonical": "pack_validation",
        "modeled": True,
        "implemented": True,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "shipped_packs_validate",
            }
        ],
        "notes": "action shape/cardinality/window contracts are covered by pack-validation tests",
    },
    "culture_rules_test": {
        "canonical": "culture_pack_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {
                "path": "crates/domain/tests/golden.rs",
                "needle": "day_substep_goldens_expose_canonical_host_console_ordering",
            },
            {
                "path": "crates/commands/tests/pipeline.rs",
                "needle": "chinese",
            },
        ],
        "notes": "culture rule coverage is split across culture pack goldens and command/projection verticals",
    },
    "cultures": {
        "canonical": "mafia_universe_pack",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "packs/mafia_universe/pack.json", "needle": "town_cop"},
            {
                "path": "crates/commands/tests/pipeline.rs",
                "needle": "mafia_universe",
            },
        ],
        "notes": "Mafia Universe data coverage is represented by the shipped pack, goldens, and command verticals",
    },
    "e2e": {
        "canonical": "operator_replay_proof_artifacts",
        "modeled": True,
        "implemented": True,
        "golden": False,
        "integrated": True,
        "evidence": [
            {
                "path": "target/operator-proof/current-determinism-fuzz-report.json",
                "needle": "\"ok\": true",
            },
            {
                "path": "target/operator-proof/current-projection-rebuild-report.json",
                "needle": "\"ok\": true",
            },
        ],
        "notes": "end-to-end simulation parity maps to stored operator replay, determinism, and projection proof artifacts",
    },
    "effects": {
        "canonical": "persistent_effect_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {
                "path": "crates/domain/tests/golden.rs",
                "needle": "golden_cleanse_preempts_ignite",
            },
            {
                "path": "crates/commands/tests/pipeline.rs",
                "needle": "poison",
            },
        ],
        "notes": "effect tests map to Mark/Clear, poison, douse, ignite, cleanse, and projection-fold coverage",
    },
    "feature_flags_test": {
        "canonical": "out_of_scope: im-human feature flags",
        "modeled": False,
        "implemented": False,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "docs/arch/11-engine-port-checklist.md",
                "needle": "Anything im-human carried for AI players",
            }
        ],
        "notes": "feature flag plumbing is outside the human game resolution result surface",
    },
    "init": {
        "canonical": "out_of_scope: im-human init/chat provisioning",
        "modeled": False,
        "implemented": False,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "docs/arch/11-engine-port-checklist.md",
                "needle": "platform layer: users, slots, replacements",
            }
        ],
        "notes": "im-human init/chat provisioning belongs to platform setup rather than the slot-only resolver",
    },
    "intent": {
        "canonical": "source_alias_parity_matrix",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "docs/arch/im-human-engine-parity-matrix.md", "needle": "| action_id |"},
            {
                "path": "tools/im_human_engine_inventory.py",
                "needle": "source_ids",
            },
        ],
        "notes": "intent aliases map through source-derived action_id rows and pack `source_ids`",
    },
    "intent_catalog_test": {
        "canonical": "source_alias_parity_matrix",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "docs/arch/im-human-engine-parity-matrix.md", "needle": "| action_id |"},
            {
                "path": "tools/im_human_engine_inventory.py",
                "needle": "ACTION_COVERAGE_OVERRIDES",
            },
        ],
        "notes": "intent catalog rows are source-derived into the action parity matrix",
    },
    "ita": {
        "canonical": "ItaSession+ItaShot",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_ita_session"},
            {"path": "crates/commands/tests/pipeline.rs", "needle": "ita"},
        ],
        "notes": "ITA runtime coverage maps to ITA session/shot goldens and command/projection verticals",
    },
    "modifiers/action": {
        "canonical": "primitive_modifier_interaction_report",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {
                "path": "target/operator-proof/current-primitive-modifier-interaction-report.json",
                "needle": "\"uncovered_count\": 0",
            }
        ],
        "notes": "action modifier family coverage is checked by the primitive/modifier interaction report",
    },
    "modifiers/effect": {
        "canonical": "death_reveal+effect_policy_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_death_reveal_policy"},
            {"path": "crates/domain/tests/result_contract.rs", "needle": "EffectNotification"},
        ],
        "notes": "effect modifiers map to death reveal, persistent effect, and notification result contracts",
    },
    "policy/conflict": {
        "canonical": "standard_nar_precedence_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_kill_vs_doctor_base"},
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "standard_nar",
            },
        ],
        "notes": "conflict policy maps to standard-NAR precedence, protection, suppression, and pack validation",
    },
    "policy/win": {
        "canonical": "win_policy_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "WinReached"},
            {"path": "crates/commands/tests/pipeline.rs", "needle": "win"},
        ],
        "notes": "win policy coverage maps to WinReached goldens and command/projection verticals",
    },
    "registry_role_api_test": {
        "canonical": "pack_loader_validation",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "shipped_packs_validate",
            },
            {"path": "crates/domain/tests/golden.rs", "needle": "pack_deserializes"},
        ],
        "notes": "role registry/API coverage maps to pack loading and shipped-pack validation",
    },
    "resolve": {
        "canonical": "domain_golden_harness",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_"},
            {"path": "crates/commands/tests/pipeline.rs", "needle": "ResolvePhase"},
        ],
        "notes": "general resolve families map to the domain golden harness plus ResolvePhase verticals",
    },
    "resolve/culture": {
        "canonical": "culture_pack_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_chinese"},
            {"path": "crates/commands/tests/pipeline.rs", "needle": "chinese"},
        ],
        "notes": "culture resolve tests map to Chinese and Mafia Universe culture-pack goldens and verticals",
    },
    "resolve/culture/chinese": {
        "canonical": "chinese_structured_pack",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "packs/chinese_structured/pack.json", "needle": "white_wolf_king"},
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_chinese"},
        ],
        "notes": "Chinese full-flow coverage maps to the Chinese structured pack and culture goldens",
    },
    "resolve/day_steps": {
        "canonical": "day_step_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {
                "path": "crates/domain/tests/golden.rs",
                "needle": "day_substep_goldens_expose_canonical_host_console_ordering",
            }
        ],
        "notes": "day-step ordering maps to the day substep golden family",
    },
    "resolve/effects": {
        "canonical": "ItaShot+effect_resolution_goldens",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_ita_session_lethal_shot"}
        ],
        "notes": "resolve/effects currently maps to ITA shot and effect-resolution goldens",
    },
    "resolve/graph": {
        "canonical": "redirect_graph+determinism_guard",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {
                "path": "crates/domain/tests/determinism_guard.rs",
                "needle": "seeded_property_family_replays_ordering_and_fixpoints_deterministically",
            },
            {"path": "crates/domain/tests/golden.rs", "needle": "golden_redirect_cycle_stable"},
        ],
        "notes": "graph coverage maps to redirect graph goldens and seeded determinism/fixpoint tests",
    },
    "resolve/phases": {
        "canonical": "phase_policy_goldens+commands",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/golden.rs", "needle": "phase_window"},
            {"path": "crates/commands/tests/pipeline.rs", "needle": "AdvancePhase"},
        ],
        "notes": "phase resolution maps to phase-window goldens and command phase-transition tests",
    },
    "result": {
        "canonical": "result_contract_tests",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": True,
        "evidence": [
            {"path": "crates/domain/tests/result_contract.rs", "needle": "unknown"},
            {"path": "crates/domain/tests/golden.rs", "needle": "expected_events"},
        ],
        "notes": "result tests map to schema/result-contract tests plus golden result comparison",
    },
    "roles": {
        "canonical": "pack_role_catalog_validation",
        "modeled": True,
        "implemented": True,
        "golden": True,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "shipped_packs_validate",
            },
            {"path": "docs/arch/im-human-engine-parity-matrix.md", "needle": "| role_id |"},
        ],
        "notes": "role catalog coverage maps to shipped pack validation and source-derived role parity rows",
    },
    "spec_validation_test": {
        "canonical": "pack_validation",
        "modeled": True,
        "implemented": True,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/pack_validation.rs",
                "needle": "invalid",
            }
        ],
        "notes": "spec validation maps to strict pack validator tests",
    },
    "time_test": {
        "canonical": "determinism_guard",
        "modeled": False,
        "implemented": True,
        "golden": False,
        "integrated": False,
        "evidence": [
            {
                "path": "crates/domain/tests/determinism_guard.rs",
                "needle": "domain_source_rejects_ambient_rng_and_wall_clock",
            }
        ],
        "notes": "time behavior maps to deterministic logical_time and ambient wall-clock rejection",
    },
    "util": {
        "canonical": "schema_validator_tests",
        "modeled": False,
        "implemented": True,
        "golden": False,
        "integrated": False,
        "evidence": [
            {"path": "crates/domain/tests/result_contract.rs", "needle": "malformed"},
            {"path": "tools/tests/test_import_im_human_v4_fixture.py", "needle": "malformed"},
        ],
        "notes": "utility validator coverage maps to result-contract and fixture-import validator tests",
    },
}

ROLE_ID_MAP = {
    "mafiascum:goon": "mafia_goon",
    "mafiascum:janitor": "mafia_janitor",
    "mafiascum:mafia_ninja": "ninja",
    "mafiascum:mafia_strongman": "strongman",
    "mafiascum:pgo": "paranoid_gun_owner",
    "mafiascum:werewolf": "mafia_goon",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def load_json(path: Path) -> Any | None:
    try:
        return json.loads(read_text(path))
    except (json.JSONDecodeError, OSError):
        return None


def find_im_human_root(candidate: Path) -> Path:
    root = candidate.expanduser().resolve()
    if (root / "imhuman_umbrella").is_dir():
        return root
    if root.name == "imhuman_umbrella":
        return root.parent
    raise SystemExit(f"cannot find imhuman_umbrella under {root}")


def extract_schema_consts(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        const = value.get("const")
        if isinstance(const, str) and "." in const:
            found.append(const)
        for child in value.values():
            found.extend(extract_schema_consts(child))
    elif isinstance(value, list):
        for child in value:
            found.extend(extract_schema_consts(child))
    return found


def extract_primitives(engine_root: Path) -> list[dict[str, Any]]:
    role_spec = engine_root / "lib/engine_v4/role_spec.ex"
    text = read_text(role_spec)
    items = []
    in_map = False
    for line_no, line in enumerate(text.splitlines(), 1):
        if "@primitive_handlers" in line:
            in_map = True
            continue
        if in_map and line.startswith("  }"):
            break
        match = re.match(r"\s*([a-zA-Z0-9_]+):\s*\[", line) if in_map else None
        if match:
            items.append(
                {
                    "name": match.group(1),
                    "source": rel(role_spec, engine_root),
                    "line": line_no,
                }
            )
    return sorted(items, key=lambda item: item["name"])


def extract_result_event_kinds(im_root: Path, engine_root: Path) -> list[dict[str, Any]]:
    schema = im_root / "schemas/json/engine_v4/engine_v4_result.schema.json"
    emitter = engine_root / "lib/engine_v4/result_emitter.ex"
    counts: Counter[str] = Counter()
    sources: dict[str, set[str]] = defaultdict(set)

    schema_json = load_json(schema)
    if schema_json is not None:
        for kind in extract_schema_consts(schema_json):
            counts[kind] += 1
            sources[kind].add(rel(schema, im_root))

    if emitter.exists():
        for kind in re.findall(r'type:\s*"([^"]+)"', read_text(emitter)):
            counts[kind] += 1
            sources[kind].add(rel(emitter, engine_root))

    for path in [
        engine_root / "lib/engine_v4/resolve/triggers.ex",
        engine_root / "test/engine_v4/result/result_win_triggers_test.exs",
        engine_root / "test/engine_v4/result/result_mafiascum_passives_test.exs",
    ]:
        if path.exists():
            for kind in re.findall(r'type:\s*:?"(win\.[^"]+)"', read_text(path)):
                counts[kind] += 1
                sources[kind].add(rel(path, engine_root))

    return [
        {"name": name, "source_count": counts[name], "sources": sorted(sources[name])}
        for name in sorted(counts)
    ]


def extract_day_steps(engine_root: Path) -> list[dict[str, Any]]:
    day_steps = engine_root / "lib/engine_v4/resolve/day_steps"
    items = []
    for path in sorted(day_steps.glob("*.ex")):
        if path.stem == "util":
            continue
        name = path.stem.removesuffix("_step")
        items.append({"name": name, "source": rel(path, engine_root)})
    return items


def extract_modifiers(engine_root: Path) -> list[dict[str, Any]]:
    modifiers_root = engine_root / "lib/engine_v4/modifiers"
    skip = {"action", "effect", "helpers", "option_helpers"}
    items = []
    for path in sorted(modifiers_root.rglob("*.ex")):
        name = path.stem
        if name in skip:
            continue
        kind = path.parent.name
        items.append({"name": name, "kind": kind, "source": rel(path, engine_root)})
    return items


def extract_catalog(catalog_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    roles = []
    actions = []
    culture_notes = []

    for path in sorted(catalog_root.glob("v4/drafts/**/*.json")):
        data = load_json(path)
        if not isinstance(data, dict):
            continue
        culture = str(data.get("culture") or path.parent.name)
        role_key = data.get("role_key") or path.stem
        if isinstance(role_key, str):
            roles.append({"name": role_key, "culture": culture, "source": rel(path, catalog_root)})
        notes = data.get("notes") or []
        if isinstance(notes, list):
            for note in notes:
                if note:
                    culture_notes.append(
                        {
                            "name": f"{culture}:{role_key}",
                            "note": str(note),
                            "source": rel(path, catalog_root),
                        }
                    )
        for action in data.get("base_actions") or []:
            if isinstance(action, dict) and isinstance(action.get("id"), str):
                actions.append(
                    {
                        "name": action["id"],
                        "role": role_key,
                        "culture": culture,
                        "primitives": [str(p) for p in action.get("primitives") or []],
                        "source": rel(path, catalog_root),
                    }
                )

    return roles, actions, culture_notes


def extract_test_families(engine_root: Path) -> list[dict[str, Any]]:
    test_root = engine_root / "test/engine_v4"
    counts: Counter[str] = Counter()
    examples: dict[str, str] = {}
    for path in sorted(test_root.rglob("*_test.exs")):
        family = path.relative_to(test_root).with_suffix("").as_posix()
        parts = family.split("/")
        if len(parts) > 1:
            family = "/".join(parts[:-1])
        counts[family] += 1
        examples.setdefault(family, rel(path, engine_root))
    return [
        {"name": family, "test_count": counts[family], "example": examples[family]}
        for family in sorted(counts)
    ]


def rust_enum_variants(text: str, enum_name: str) -> set[str]:
    match = re.search(rf"enum\s+{enum_name}\s*\{{(?P<body>.*?)\n\}}", text, re.S)
    if not match:
        return set()
    variants = set()
    for line in match.group("body").splitlines():
        line = line.split("//", 1)[0].strip()
        if not line:
            continue
        name = re.match(r"([A-Z][A-Za-z0-9_]*)", line)
        if name:
            variants.add(name.group(1))
    return variants


def load_fmarch_context(fmarch_root: Path) -> dict[str, Any]:
    ir_text = read_text(fmarch_root / "crates/domain/src/ir.rs")
    events_text = read_text(fmarch_root / "crates/domain/src/events.rs")
    pack_src_text = read_text(fmarch_root / "crates/domain/src/pack.rs")
    resolver_text = read_text(fmarch_root / "crates/domain/src/resolver.rs")
    commands_text = read_text(fmarch_root / "crates/commands/src/lib.rs")
    command_tests_text = read_text(fmarch_root / "crates/commands/tests/pipeline.rs")
    projections_text = read_text(fmarch_root / "crates/projections/src/lib.rs")
    docs_text = "\n".join(
        read_text(p) for p in sorted((fmarch_root / "docs/arch").glob("*.md"))
    )
    domain_tests_text = "\n".join(
        read_text(p) for p in sorted((fmarch_root / "crates/domain/tests").glob("*.rs"))
    )
    pack_text = "\n".join(read_text(p) for p in sorted((fmarch_root / "packs").glob("*/pack.json")))
    golden_text = "\n".join(read_text(p) for p in sorted((fmarch_root / "packs").glob("*/golden/*.json")))
    golden_text_by_pack: dict[str, str] = {}
    golden_names_by_pack: dict[str, set[str]] = {}
    for pack_dir in sorted((fmarch_root / "packs").iterdir()):
        if not pack_dir.is_dir():
            continue
        golden_dir = pack_dir / "golden"
        if golden_dir.is_dir():
            golden_paths = sorted(golden_dir.glob("*.json"))
            golden_text_by_pack[pack_dir.name] = "\n".join(
                read_text(p) for p in golden_paths
            ).lower()
            golden_names_by_pack[pack_dir.name] = {
                p.stem.lower() for p in golden_paths
            }

    pack_roles: set[str] = set()
    pack_actions: set[str] = set()
    pack_action_alignment_failback: set[str] = set()
    pack_action_source_ids: dict[str, str] = {}
    pack_abilities: set[str] = set()
    pack_modifiers: set[str] = set()
    pack_policies: set[str] = set()
    pack_standard_nar_kill_cause_ids: set[str] = set()
    pack_standard_nar_target_state_save_tags: set[str] = set()
    pack_standard_nar_target_state_gate_tags: set[str] = set()
    pack_vote_methods: dict[str, str] = {}
    pack_vote_weights: dict[str, float] = {}
    pack_dynamic_vote_effects: set[str] = set()
    pack_dynamic_vote_grants: set[str] = set()
    pack_vote_threshold_adjustments: dict[str, float] = {}

    def harvest_pack_action(pack_name: str, action: Any, role_key: str | None = None) -> None:
        if not isinstance(action, dict):
            return
        action_id = str(action.get("id"))
        pack_actions.add(f"{pack_name}:{action_id}")
        if isinstance(action.get("alignment_failback"), dict):
            pack_action_alignment_failback.add(f"{pack_name}:{action_id}")
        for source_id in action.get("source_ids") or []:
            if isinstance(source_id, str):
                pack_action_source_ids[f"{pack_name}:{source_id}"] = action_id
                if role_key:
                    pack_action_source_ids[f"{pack_name}:{role_key}:{source_id}"] = action_id
        if action.get("ability"):
            pack_abilities.add(str(action["ability"]))
        for modifier in action.get("modifiers") or []:
            pack_modifiers.add(str(modifier))
        grant = action.get("grant")
        if (
            isinstance(grant, dict)
            and grant.get("kind") == "VoteWeight"
            and isinstance(grant.get("grant_id"), str)
        ):
            pack_dynamic_vote_grants.add(f"{pack_name}:{grant['grant_id']}")

    for pack_path in sorted((fmarch_root / "packs").glob("*/pack.json")):
        pack = load_json(pack_path)
        if not isinstance(pack, dict):
            continue
        pack_name = str(pack.get("name") or pack_path.parent.name)
        lover_policy = pack.get("lover_policy")
        if isinstance(lover_policy, dict) and lover_policy.get("enabled") is True:
            pack_policies.add(f"{pack_name}:lover_policy")
            source_helper_role = lover_policy.get("source_helper_role")
            if isinstance(source_helper_role, str) and source_helper_role:
                pack_policies.add(f"{pack_name}:{source_helper_role}")
        backup_policy = pack.get("backup_policy")
        if isinstance(backup_policy, dict) and backup_policy.get("enabled") is True:
            pack_policies.add(f"{pack_name}:backup_policy")
        private_channels = pack.get("private_channels")
        if isinstance(private_channels, dict) and private_channels.get("enabled") is True:
            pack_policies.add(f"{pack_name}:private_channels")
        ita_policy = pack.get("ita")
        if isinstance(ita_policy, dict) and isinstance(
            ita_policy.get("role_overrides"), dict
        ):
            if ita_policy["role_overrides"]:
                pack_policies.add(f"{pack_name}:ita.role_overrides")
        if isinstance(ita_policy, dict) and isinstance(
            ita_policy.get("modifier_components"), dict
        ):
            if ita_policy["modifier_components"]:
                pack_policies.add(f"{pack_name}:ita.modifier_components")
        if isinstance(ita_policy, dict) and isinstance(
            ita_policy.get("role_modifier_refs"), dict
        ):
            if ita_policy["role_modifier_refs"]:
                pack_policies.add(f"{pack_name}:ita.role_modifier_refs")
        treestump_policy = pack.get("treestump_policy")
        if isinstance(treestump_policy, dict) and treestump_policy.get("enabled") is True:
            pack_policies.add(f"{pack_name}:treestump_policy")
        conversion_policy = pack.get("conversion_policy")
        if isinstance(conversion_policy, dict):
            on_dead_target = conversion_policy.get("on_dead_target")
            if isinstance(on_dead_target, str) and on_dead_target:
                pack_policies.add(f"{pack_name}:conversion_policy:on_dead_target:{on_dead_target}")
            on_pending_death = conversion_policy.get("on_pending_death")
            if isinstance(on_pending_death, str) and on_pending_death:
                pack_policies.add(
                    f"{pack_name}:conversion_policy:on_pending_death:{on_pending_death}"
                )
        target_lynch_win_policies = pack.get("target_lynch_win_policies")
        if isinstance(target_lynch_win_policies, list):
            for policy in target_lynch_win_policies:
                if isinstance(policy, dict) and isinstance(policy.get("id"), str):
                    pack_policies.add(f"{pack_name}:{policy['id']}")
            if target_lynch_win_policies:
                pack_policies.add(f"{pack_name}:target_lynch_win_policies")
        self_lynch_win_policies = pack.get("self_lynch_win_policies")
        if isinstance(self_lynch_win_policies, list):
            for policy in self_lynch_win_policies:
                if isinstance(policy, dict) and isinstance(policy.get("id"), str):
                    pack_policies.add(f"{pack_name}:{policy['id']}")
            if self_lynch_win_policies:
                pack_policies.add(f"{pack_name}:self_lynch_win_policies")
        beloved_princess_policy = pack.get("beloved_princess_policy")
        if isinstance(beloved_princess_policy, dict) and beloved_princess_policy.get("enabled") is True:
            pack_policies.add(f"{pack_name}:beloved_princess_policy")
            for role_key in beloved_princess_policy.get("eligible_roles") or []:
                if isinstance(role_key, str):
                    pack_policies.add(f"{pack_name}:{role_key}")
        guard_policy = pack.get("guard_policy")
        if isinstance(guard_policy, dict) and guard_policy.get("enabled") is True:
            pack_policies.add(f"{pack_name}:guard_policy")
        vote = pack.get("vote") or {}
        method = vote.get("method") if isinstance(vote, dict) else None
        if isinstance(method, str):
            pack_vote_methods[pack_name] = method
        standard_nar = pack.get("standard_nar")
        if isinstance(standard_nar, dict):
            for cause_id in standard_nar.get("kill_cause_ids") or []:
                if isinstance(cause_id, str):
                    pack_standard_nar_kill_cause_ids.add(f"{pack_name}:{cause_id}")
            for tag in standard_nar.get("target_state_save_tags") or []:
                if isinstance(tag, str):
                    pack_standard_nar_target_state_save_tags.add(f"{pack_name}:{tag}")
            for tag in standard_nar.get("target_state_gate_tags") or []:
                if isinstance(tag, str):
                    pack_standard_nar_target_state_gate_tags.add(f"{pack_name}:{tag}")
        weights = vote.get("weights") if isinstance(vote, dict) else None
        if isinstance(weights, dict) and isinstance(weights.get("PerRole"), dict):
            for role_key, weight in weights["PerRole"].items():
                if isinstance(weight, (int, float)):
                    pack_vote_weights[f"{pack_name}:{role_key}"] = float(weight)
        if isinstance(weights, dict) and isinstance(weights.get("Dynamic"), dict):
            dynamic = weights["Dynamic"]
            for rule in dynamic.get("effect_rules") or []:
                if isinstance(rule, dict) and isinstance(rule.get("effect"), str):
                    pack_dynamic_vote_effects.add(f"{pack_name}:{rule['effect']}")
            for rule in dynamic.get("grant_rules") or []:
                if isinstance(rule, dict) and isinstance(rule.get("grant_id"), str):
                    pack_dynamic_vote_grants.add(f"{pack_name}:{rule['grant_id']}")
        threshold_adjustments = vote.get("threshold_adjustments") if isinstance(vote, dict) else None
        if isinstance(threshold_adjustments, dict):
            for role_key, adjustment in threshold_adjustments.items():
                if isinstance(adjustment, (int, float)):
                    pack_vote_threshold_adjustments[f"{pack_name}:{role_key}"] = float(adjustment)
        for effect in (pack.get("effects") or {}).keys():
            pack_modifiers.add(str(effect))
        for role_key, role in (pack.get("roles") or {}).items():
            pack_roles.add(f"{pack_name}:{role_key}")
            for modifier in role.get("modifiers") or []:
                pack_modifiers.add(str(modifier))
            for effect in role.get("effects") or []:
                pack_modifiers.add(str(effect))
            for action in role.get("actions") or []:
                harvest_pack_action(pack_name, action, str(role_key))
        for action in (pack.get("item_actions") or {}).values():
            harvest_pack_action(pack_name, action)

    return {
        "ir": rust_enum_variants(ir_text, "IrAbility"),
        "modes": rust_enum_variants(ir_text, "InvestigateMode"),
        "modifiers": rust_enum_variants(ir_text, "Modifier"),
        "events": rust_enum_variants(events_text, "InnerEvent"),
        "events_text": events_text,
        "ir_text": ir_text,
        "pack_src_text": pack_src_text,
        "resolver_text": resolver_text,
        "commands_text": commands_text,
        "command_tests_text": command_tests_text,
        "projections_text": projections_text,
        "docs_text": docs_text,
        "domain_tests_text": domain_tests_text,
        "pack_text": pack_text,
        "golden_text": golden_text,
        "golden_text_by_pack": golden_text_by_pack,
        "golden_names_by_pack": golden_names_by_pack,
        "pack_roles": pack_roles,
        "pack_actions": pack_actions,
        "pack_action_alignment_failback": pack_action_alignment_failback,
        "pack_action_source_ids": pack_action_source_ids,
        "pack_standard_nar_kill_cause_ids": pack_standard_nar_kill_cause_ids,
        "pack_standard_nar_target_state_save_tags": pack_standard_nar_target_state_save_tags,
        "pack_standard_nar_target_state_gate_tags": pack_standard_nar_target_state_gate_tags,
        "pack_abilities": pack_abilities,
        "pack_modifiers": pack_modifiers,
        "pack_policies": pack_policies,
        "pack_vote_methods": pack_vote_methods,
        "pack_vote_weights": pack_vote_weights,
        "pack_dynamic_vote_effects": pack_dynamic_vote_effects,
        "pack_dynamic_vote_grants": pack_dynamic_vote_grants,
        "pack_vote_threshold_adjustments": pack_vote_threshold_adjustments,
    }


def mark(value: bool) -> str:
    return "yes" if value else "no"


def row(
    category: str,
    item: str,
    canonical: str,
    source_count: int,
    modeled: bool,
    implemented: bool,
    golden: bool,
    integrated: bool,
    notes: str = "",
) -> dict[str, Any]:
    return {
        "category": category,
        "item": item,
        "canonical_fmarch": canonical,
        "source_count": source_count,
        "unsupported": not (modeled or implemented or golden or integrated),
        "modeled_in_pack": modeled,
        "implemented_in_resolver": implemented,
        "covered_by_golden": golden,
        "integrated_command_projection": integrated,
        "notes": notes,
    }


STANDARD_NAR_PRIMITIVE_CAUSES = {
    "hunter": ["mafiascum:hunter_retaliate"],
    "ignite": ["mafiascum:ignite"],
    "kill": ["mafiascum:factional_kill", "mafiascum:night_kill"],
    "pgo": ["mafiascum:pgo_shoots_visitor"],
    "strongman": ["mafiascum:strongman_kill"],
    "super_saint": ["mafiascum:super_saint_retaliates"],
    "vengeful": [
        "mafiascum:unstoppable_vengeful_retaliates",
        "mafiascum:vengeful_retaliates",
    ],
}


def standard_nar_catalog_note_for_primitive(name: str, fmarch: dict[str, Any]) -> str:
    required = STANDARD_NAR_PRIMITIVE_CAUSES.get(name)
    if not required:
        return ""
    catalog = fmarch["pack_standard_nar_kill_cause_ids"]
    if all(cause in catalog for cause in required):
        return "standard-NAR kill causes are catalog-owned through `standard_nar.kill_cause_ids`"
    return ""


def standard_nar_catalog_note_for_modifier(name: str, fmarch: dict[str, Any]) -> str:
    if name == "vengeful":
        return standard_nar_catalog_note_for_primitive(name, fmarch)
    scoped = f"mafiascum:{name}"
    if scoped in fmarch["pack_standard_nar_target_state_save_tags"]:
        return "standard-NAR target-state saves are catalog-owned through `standard_nar.target_state_save_tags`"
    if scoped in fmarch["pack_standard_nar_target_state_gate_tags"]:
        return "standard-NAR target-state gates are catalog-owned through `standard_nar.target_state_gate_tags`"
    return ""


def conversion_policy_note_for_primitive(name: str, fmarch: dict[str, Any]) -> str:
    if name not in {"convert", "vanillaize", "restore_mutation"}:
        return ""
    if (
        "mafiascum:conversion_policy:on_dead_target:Block" in fmarch["pack_policies"]
        and "mafiascum:conversion_policy:on_pending_death:Block" in fmarch["pack_policies"]
    ):
        return "`conversion_policy` owns same-resolution dead-target and pending-death conversion blocks"
    return ""


def target_state_gate_note_for_primitive(name: str, fmarch: dict[str, Any]) -> str:
    tags = {"commute": "commuted", "untargetable": "untargetable"}
    tag = tags.get(name)
    if tag and f"mafiascum:{tag}" in fmarch["pack_standard_nar_target_state_gate_tags"]:
        return "standard-NAR target-state gates are catalog-owned through `standard_nar.target_state_gate_tags`"
    return ""


def trigger_policy_note_for_primitive(name: str, fmarch: dict[str, Any]) -> str:
    if name != "trigger":
        return ""
    if '"trigger_fixpoint_policy": {' in fmarch["pack_text"]:
        return "pack trigger table and `standard_nar.trigger_fixpoint_policy` own generated-trigger fixpoints"
    return ""


def death_reveal_note_for_primitive(name: str, fmarch: dict[str, Any]) -> str:
    if name != "conceal":
        return ""
    if '"death_reveal": {' in fmarch["pack_text"]:
        return "pack `death_reveal` policy owns concealed death flips through cause/effect rules"
    return ""


def append_note(existing: str, addition: str) -> str:
    if not addition:
        return existing
    if not existing:
        return addition
    return f"{existing}; {addition}"


def build_matrix(inventory: dict[str, Any], fmarch: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    resolver = fmarch["resolver_text"]
    commands = fmarch["commands_text"]
    command_tests = fmarch["command_tests_text"]
    projections = fmarch["projections_text"]
    goldens = fmarch["golden_text"].lower()

    for item in inventory["primitives"]:
        name = item["name"]
        category = "primitive"
        if name == "babysitter":
            canonical = "Protect+Babysitter"
            modeled = "Protect" in fmarch["pack_abilities"] and "Babysitter" in fmarch["pack_modifiers"]
            implemented = "Modifier::Babysitter" in resolver
        elif name == "hider":
            canonical = "Mark+Hider"
            modeled = "Mark" in fmarch["pack_abilities"] and "Hider" in fmarch["pack_modifiers"]
            implemented = "Modifier::Hider" in resolver
        elif name in {"condemner", "executioner"}:
            canonical = "TargetLynchWinTargeted"
            modeled = f"mafiascum:{name}" in fmarch["pack_policies"]
            implemented = modeled and "TargetLynchWinTargeted" in resolver
        elif name in {"condemner_win", "executioner_win"}:
            policy = name.removesuffix("_win")
            canonical = "WinReached"
            modeled = f"mafiascum:{policy}" in fmarch["pack_policies"]
            implemented = modeled and "resolve_target_lynch_wins" in resolver
        elif name == "lynch_target_win":
            canonical = "TargetLynchWinTargeted+WinReached"
            modeled = "mafiascum:target_lynch_win_policies" in fmarch["pack_policies"]
            implemented = (
                modeled
                and "TargetLynchWinTargeted" in resolver
                and "resolve_target_lynch_wins" in resolver
            )
        elif name == "beloved_princess":
            canonical = "HostPromptIssued"
            modeled = "mafiascum:beloved_princess_policy" in fmarch["pack_policies"]
            implemented = modeled and "resolve_beloved_princess_prompt" in resolver
        elif name == "vanillaize":
            canonical = "Convert::AssignRole"
            modeled = "mafiascum:vanillaize" in fmarch["pack_actions"]
            implemented = modeled and "ConversionMode::AssignRole" in resolver
        elif name == "restore_mutation":
            canonical = "Convert::RestoreOriginal"
            modeled = "RestoreOriginal" in resolver and "deprogram" in goldens
            implemented = "ConversionMode::RestoreOriginal" in resolver
        elif name == "schedule":
            canonical = "Grant+DelayedDeathQueued"
            modeled = (
                "Grant" in fmarch["pack_abilities"]
                and "DelayedDeathQueued" in fmarch["events"]
                and "delayed_death_queue" in projections
            )
            implemented = (
                modeled
                and "IrAbility::Grant" in resolver
                and "DelayedDeathQueued" in resolver
                and "apply_pending_poison" in resolver
            )
        elif name == "phase_skip":
            canonical = "HostPromptIssued+HostPromptResolved+PhaseAdvanced"
            modeled = (
                "mafiascum:beloved_princess_policy" in fmarch["pack_policies"]
                and "HostPromptIssued" in fmarch["events"]
            )
            implemented = (
                modeled
                and "resolve_beloved_princess_prompt" in resolver
                and "ResolveHostPrompt" in commands
                and "PhaseAdvanced" in commands
                and "host_phase_control" in projections
            )
        elif name in {"commute", "untargetable"}:
            gate_tag = "commuted" if name == "commute" else "untargetable"
            canonical = f"target_state_gate:{gate_tag}"
            modeled = (
                f"mafiascum:{gate_tag}"
                in fmarch["pack_standard_nar_target_state_gate_tags"]
                and f'"{gate_tag}": {{' in fmarch["pack_text"]
                and '"blocks": ["Kill", "Investigate"]' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "target_state_gate_reason" in resolver
                and "target_state_gate_policy" in resolver
                and f'effect == "{gate_tag}"' in resolver
                and "ActionInterfered" in resolver
            )
            category = "policy:target_state_gate"
        elif name == "conceal":
            canonical = "death_reveal:Concealed"
            modeled = (
                '"janitor_kill": "Concealed"' in fmarch["pack_text"]
                and '"flipless": "Concealed"' in fmarch["pack_text"]
                and '"death_reveal": {' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "death_reveal_mode" in resolver
                and "DeathRevealMode::Concealed" in resolver
                and "strictest_death_reveal" in resolver
                and "death_reveal" in projections
            )
            category = "policy:death_reveal"
        elif name == "trigger":
            canonical = "trigger_table+trigger_fixpoint_policy"
            modeled = (
                '"triggers": [' in fmarch["pack_text"]
                and '"trigger_fixpoint_policy": {' in fmarch["pack_text"]
                and '"generated_kill_cause_policy": {' in fmarch["pack_text"]
                and '"on": "Death"' in fmarch["pack_text"]
                and '"on": "EffectMarked"' in fmarch["pack_text"]
                and '"on": "PhaseEnd"' in fmarch["pack_text"]
                and '"on": "Win"' in fmarch["pack_text"]
                and '"on": "Visit"' in fmarch["pack_text"]
                and '"on": "Lynch"' in fmarch["pack_text"]
                and '"on": "Kill"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_trigger_fixpoint" in resolver
                and "trigger_observation_matches" in resolver
                and "InnerEvent::Trigger" in resolver
                and "GeneratedActionTrace" in resolver
                and "trigger_fixpoint_policy" in resolver
            )
            category = "policy:trigger_fixpoint"
        elif name == "bomb":
            canonical = "TriggerOn::Kill+bomb_retaliates"
            modeled = (
                "bomb" in fmarch["pack_modifiers"]
                and '"id": "bomb_retaliates"' in fmarch["pack_text"]
                and '"if_target_has": ["bomb"]' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "TriggerOn::Ability(IrAbility::Kill)" in resolver
                and "TargetRef::Killer" in resolver
            )
        elif name == "hunter":
            canonical = "Retaliate+RetaliationArmed"
            modeled = (
                "Retaliate" in fmarch["pack_abilities"]
                and "hunter_retaliate" in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "RetaliationArmed" in resolver
                and "apply_chosen_retaliations" in resolver
            )
        elif name == "pgo":
            canonical = "TriggerOn::Visit+pgo_shoots_visitor"
            modeled = (
                "pgo" in fmarch["pack_modifiers"]
                and '"id": "pgo_shoots_visitor"' in fmarch["pack_text"]
                and '"on": "Visit"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "TriggerOn::Event(TriggerEvent::Visit)" in resolver
                and "visit_observations" in resolver
            )
        elif name == "super_saint":
            canonical = "TriggerOn::Lynch+super_saint_retaliates"
            modeled = (
                "super_saint" in fmarch["pack_modifiers"]
                and '"id": "super_saint_retaliates"' in fmarch["pack_text"]
                and '"if_target_has": ["super_saint"]' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "TriggerOn::Event(TriggerEvent::Lynch)" in resolver
                and "apply_trigger_fixpoint" in resolver
            )
        elif name == "visitor_kill":
            canonical = "TriggerOn::Visit+TargetFilteredKill"
            modeled = (
                "visitor_kill" in fmarch["pack_modifiers"]
                and '"id": "visitor_kill_marked_visitor"' in fmarch["pack_text"]
                and '"if_target_has": ["visitor_kill"]' in fmarch["pack_text"]
                and '"if_actor_has": ["visitor_kill_target"]' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "trigger_observation_matches" in resolver
                and "if_actor_has" in resolver
            )
        elif name == "vengeful":
            canonical = "TriggerOn::Kill+vengeful_retaliates"
            modeled = (
                "vengeful" in fmarch["pack_modifiers"]
                and '"id": "vengeful_retaliates"' in fmarch["pack_text"]
                and '"if_target_has": ["vengeful"]' in fmarch["pack_text"]
            )
            implemented = modeled and "TriggerOn::Ability(IrAbility::Kill)" in resolver
        elif name == "result_mod":
            canonical = "Mark+investigation_overrides"
            modeled = (
                "Mark" in fmarch["pack_abilities"]
                and '"investigation_overrides"' in fmarch["pack_text"]
                and '"result_mod"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "IrAbility::Mark" in resolver
                and "investigation_overrides" in resolver
                and "transient_effects" in resolver
            )
        elif name == "info":
            canonical = "InfoResult"
            modeled = "Info" in fmarch["pack_abilities"]
            implemented = (
                modeled
                and "IrAbility::Info" in resolver
                and "InnerEvent::InfoResult" in resolver
                and "player_info_result" in projections
            )
        elif name == "mark_cleansed":
            canonical = "EffectsCleared"
            modeled = (
                "Clear" in fmarch["pack_abilities"]
                and "EffectsCleared" in fmarch["events"]
                and "slot_effect" in projections
            )
            implemented = (
                modeled
                and "IrAbility::Clear" in resolver
                and "InnerEvent::EffectsCleared" in resolver
                and "cleared_effects.insert" in resolver
                and "emit_effect_notification" in resolver
            )
        else:
            canonical = PRIMITIVE_MAP.get(name, "")
            modeled = canonical in fmarch["ir"] or canonical in fmarch["pack_abilities"]
            implemented = bool(canonical and f"IrAbility::{canonical}" in resolver)
        if name in {"condemner_win", "executioner_win"}:
            policy = name.removesuffix("_win")
            golden = policy in goldens and "winreached" in goldens
            integrated = implemented and f"{policy}_target" in command_tests
        elif name in {"condemner", "executioner"}:
            golden = f"{name}_target" in goldens or name in goldens
            integrated = implemented and f"{name}_target" in command_tests
        elif name == "lynch_target_win":
            golden = (
                "executioner" in goldens
                and "condemner" in goldens
                and "targetlynchwintargeted" in goldens
                and "winreached" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_carries_executioner_target_lynch_win" in command_tests
                and "host_resolve_phase_carries_condemner_target_lynch_win" in command_tests
            )
        elif name == "beloved_princess":
            golden = name in goldens and "hostpromptissued" in goldens
            integrated = implemented and "beloved_princess_host_prompt" in command_tests
        elif name == "restore_mutation":
            golden = "deprogram" in goldens and "playerconverted" in goldens
            integrated = implemented and "deprogram" in command_tests
        elif name == "vanillaize":
            golden = "vanillaize" in goldens and "playerconverted" in goldens
            integrated = implemented and "vanillaize" in command_tests
        elif name == "schedule":
            golden = (
                "actiongranted" in goldens
                and "extra_action" in goldens
                and "single_use_item" in goldens
                and "delayeddeathqueued" in goldens
                and "delayeddeathresolved" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_projects_motivator_grant" in command_tests
                and "action_submission_spends_inventor_item_grant" in command_tests
                and "host_resolve_phase_carries_poison_cure_and_delayed_death" in command_tests
            )
        elif name == "phase_skip":
            golden = (
                "beloved_princess_lynched" in goldens
                and "hostpromptissued" in goldens
                and "skip_next_day" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_projects_beloved_princess_host_prompt" in command_tests
                and "host_prompt_skip_next_day_rejects_unsupported_pack_cadence" in command_tests
            )
        elif name == "commute":
            golden = "commuter" in goldens and "commute" in goldens and "actioninterfered" in goldens
            integrated = (
                implemented
                and "host_resolve_phase_persists_target_state_trace_decisions"
                in command_tests
            )
        elif name == "untargetable":
            golden = (
                "untargetable" in goldens
                and "actioninterfered" in goldens
                and "rolestopper" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_persists_target_state_trace_decisions"
                in command_tests
                and "host_resolve_phase_persists_rolestop_and_shield_target_state"
                in command_tests
            )
        elif name == "conceal":
            golden = "concealed" in goldens and "janitor_kill" in goldens and "flipless" in goldens
            integrated = (
                implemented
                and "host_resolve_phase_conceals_janitor_and_flipless_death_reveals"
                in command_tests
            )
        elif name == "trigger":
            golden = (
                "vengeful_retaliates" in goldens
                and "death_curse_retaliates" in goldens
                and "death_mark_detonates" in goldens
                and "phase_end_doom_claims" in goldens
                and "win_witness_observes" in goldens
                and "super_saint_retaliates" in goldens
                and "pgo_shoots_visitor" in goldens
                and "trigger" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_projects_pgo_visit_trigger" in command_tests
                and "host_resolve_phase_protects_ordinary_vengeful_trigger_kill"
                in command_tests
                and "host_resolve_phase_carries_super_saint_lynch_trigger"
                in command_tests
                and "host_resolve_phase_projects_death_trigger_kill"
                in command_tests
                and "host_resolve_phase_projects_effect_marked_trigger_kill"
                in command_tests
                and "host_resolve_phase_projects_phase_end_trigger_kill"
                in command_tests
                and "host_resolve_phase_projects_win_trigger_before_final_win"
                in command_tests
                and "host_resolve_phase_persists_trigger_loop_cap_trace_note"
                in command_tests
            )
        elif name == "bomb":
            golden = "bomb_retaliates" in goldens and "trigger" in goldens
            integrated = (
                implemented
                and "generated_epicmafia_pk_bomb_cult_replay_audit_and_rebuild_deterministically"
                in command_tests
            )
        elif name == "hunter":
            golden = "hunter_retaliate" in goldens and "retaliationarmed" in goldens
            integrated = implemented and "host_resolve_phase_carries_hunter_retaliation" in command_tests
        elif name == "pgo":
            golden = "pgo_shoots_visitor" in goldens and "trigger" in goldens
            integrated = implemented and "host_resolve_phase_projects_pgo_visit_trigger" in command_tests
        elif name == "super_saint":
            golden = "super_saint_retaliates" in goldens and "trigger" in goldens
            integrated = implemented and "host_resolve_phase_carries_super_saint_lynch_trigger" in command_tests
        elif name == "visitor_kill":
            golden = (
                "visitor_kill_marked_visitor" in goldens
                and "actor_filter" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_projects_target_filtered_visitor_kill" in command_tests
            )
        elif name == "vengeful":
            golden = "vengeful_retaliates" in goldens and "trigger" in goldens
            integrated = implemented and "host_resolve_phase_persists_trigger_loop_cap_trace_note" in command_tests
        elif name == "result_mod":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get("mafiascum", set())
            golden = (
                "framer_parity_override" in mafiascum_golden_names
                and "lawyer_parity_override" in mafiascum_golden_names
                and "investigationresult" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_preserves_prior_investigation_memory" in command_tests
                and "host_resolve_phase_applies_lawyer_result_mod_override"
                in command_tests
            )
        elif name == "info":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get("mafiascum", set())
            golden = "info_actions_private_results" in mafiascum_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_projects_mafiascum_info_results" in command_tests
            )
        elif name == "mark_cleansed":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get("mafiascum", set())
            mafia_universe_golden_names = fmarch["golden_names_by_pack"].get(
                "mafia_universe", set()
            )
            golden = (
                "cleanse_preempts_ignite" in mafiascum_golden_names
                and "cure_poison_preempts_death" in mafiascum_golden_names
                and "extinguish_town_preempts_ignite" in mafia_universe_golden_names
                and "effectscleared" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_persists_cleanse_read_effect_trace_decision"
                in command_tests
                and "host_resolve_phase_carries_poison_cure_and_delayed_death"
                in command_tests
                and "slot_effect rebuild must preserve poison/cure history" in command_tests
            )
        else:
            golden = name.lower() in goldens or (canonical and canonical.lower() in goldens)
            integrated = "ActionSubmitted" in commands if implemented else False
        notes = append_note(
            append_note(
                standard_nar_catalog_note_for_primitive(name, fmarch),
                conversion_policy_note_for_primitive(name, fmarch),
            ),
            target_state_gate_note_for_primitive(name, fmarch),
        )
        notes = append_note(notes, trigger_policy_note_for_primitive(name, fmarch))
        notes = append_note(notes, death_reveal_note_for_primitive(name, fmarch))
        if name == "mark_cleansed":
            notes = append_note(
                notes,
                "im-human emits `mark_cleansed` from Cleanse/HealPoison; fmarch's canonical "
                "`EffectsCleared` event carries the cleared effect, targets, actor, "
                "notifications, and rebuildable slot-effect removal",
            )
        rows.append(
            row(
                category,
                name,
                canonical,
                1,
                modeled,
                implemented,
                golden,
                integrated,
                notes,
            )
        )

    mafiascum_goldens = fmarch["golden_text_by_pack"].get("mafiascum", "").lower()
    social_visit_modeled = all(
        action in fmarch["pack_actions"] for action in INFO_SOCIAL_VISIT_ACTIONS
    )
    social_visit_implemented = (
        social_visit_modeled
        and "IrAbility::Visit" in resolver
        and "InnerEvent::VisitRecorded" in resolver
        and "visit_history" in projections
    )
    social_visit_golden = social_visit_modeled and all(
        action.rsplit(":", 1)[1] in mafiascum_goldens
        for action in INFO_SOCIAL_VISIT_ACTIONS
    )
    social_visit_integrated = social_visit_implemented and all(
        selector in command_tests for selector in INFO_SOCIAL_VISIT_ACTIONS.values()
    )
    rows.append(
        row(
            "surface:info",
            "social_visit",
            "VisitRecorded",
            len(INFO_SOCIAL_VISIT_ACTIONS),
            social_visit_modeled,
            social_visit_implemented,
            social_visit_golden,
            social_visit_integrated,
            (
                "info-tagged Visit actions only: friendly_neighbor, "
                "neighborize, and visit; generic info scan/mail/report "
                "actions are covered by the generic_info_result surface"
            ),
        )
    )
    public_alignment_reveal_modeled = all(
        action in fmarch["pack_actions"] for action in INFO_PUBLIC_ALIGNMENT_REVEAL_ACTIONS
    )
    public_alignment_reveal_implemented = (
        public_alignment_reveal_modeled
        and "IrAbility::RevealTown" in resolver
        and "InnerEvent::AlignmentRevealed" in resolver
        and "alignment_revealed = TRUE" in projections
    )
    public_alignment_reveal_golden = public_alignment_reveal_modeled and all(
        action.rsplit(":", 1)[1]
        in fmarch["golden_text_by_pack"].get(action.split(":", 1)[0], "")
        and "alignmentrevealed"
        in fmarch["golden_text_by_pack"].get(action.split(":", 1)[0], "")
        for action in INFO_PUBLIC_ALIGNMENT_REVEAL_ACTIONS
    )
    public_alignment_reveal_integrated = public_alignment_reveal_implemented and all(
        selector in command_tests
        for selector in INFO_PUBLIC_ALIGNMENT_REVEAL_ACTIONS.values()
    )
    rows.append(
        row(
            "surface:info",
            "public_alignment_reveal",
            "AlignmentRevealed",
            len(INFO_PUBLIC_ALIGNMENT_REVEAL_ACTIONS),
            public_alignment_reveal_modeled,
            public_alignment_reveal_implemented,
            public_alignment_reveal_golden,
            public_alignment_reveal_integrated,
            (
                "info-tagged RevealTown day action only: mafiascum and "
                "Mafia Universe Innocent Child; generic info scan/mail/report "
                "actions are covered by the generic_info_result surface"
            ),
        )
    )
    private_effect_notification_modeled = all(
        action in fmarch["pack_actions"] for action in INFO_PRIVATE_EFFECT_NOTIFICATION_ACTIONS
    )
    private_effect_notification_implemented = (
        private_effect_notification_modeled
        and "IrAbility::Mark" in resolver
        and "InnerEvent::EffectNotification" in resolver
        and "player_notification" in projections
    )
    private_effect_notification_golden = private_effect_notification_modeled and all(
        action.rsplit(":", 1)[1]
        in fmarch["golden_text_by_pack"].get(action.split(":", 1)[0], "")
        and "effectnotification"
        in fmarch["golden_text_by_pack"].get(action.split(":", 1)[0], "")
        and "fruit_received"
        in fmarch["golden_text_by_pack"].get(action.split(":", 1)[0], "")
        for action in INFO_PRIVATE_EFFECT_NOTIFICATION_ACTIONS
    )
    private_effect_notification_integrated = (
        private_effect_notification_implemented
        and all(
            selector in command_tests
            for selector in INFO_PRIVATE_EFFECT_NOTIFICATION_ACTIONS.values()
        )
    )
    rows.append(
        row(
            "surface:info",
            "private_effect_notification",
            "EffectNotification",
            len(INFO_PRIVATE_EFFECT_NOTIFICATION_ACTIONS),
            private_effect_notification_modeled,
            private_effect_notification_implemented,
            private_effect_notification_golden,
            private_effect_notification_integrated,
            (
                "info-tagged private notification actions only: Mafiascum and "
                "Mafia Universe Fruit Vendor `send_fruit`; generic info scan/mail/report actions "
                "are covered by the generic_info_result surface"
            ),
        )
    )
    generic_info_modeled = all(
        action in fmarch["pack_actions"] for action in INFO_GENERIC_RESULT_ACTIONS
    )
    generic_info_implemented = (
        generic_info_modeled
        and "IrAbility::Info" in resolver
        and "InnerEvent::InfoResult" in resolver
        and "player_info_result" in projections
    )
    generic_info_golden = (
        generic_info_modeled
        and "info_actions_private_results"
        in fmarch["golden_names_by_pack"].get("mafiascum", set())
    )
    generic_info_integrated = generic_info_implemented and all(
        selector in command_tests for selector in INFO_GENERIC_RESULT_ACTIONS.values()
    )
    rows.append(
        row(
            "surface:info",
            "generic_info_result",
            "InfoResult",
            len(INFO_GENERIC_RESULT_ACTIONS),
            generic_info_modeled,
            generic_info_implemented,
            generic_info_golden,
            generic_info_integrated,
            "generic info scan/mail/report actions: Mafiascum Mailman, Observer, and Reporter",
        )
    )
    public_vote_duel_modeled = all(
        action in fmarch["pack_actions"] for action in INFO_PUBLIC_VOTE_DUEL_ACTIONS
    )
    public_vote_duel_implemented = (
        public_vote_duel_modeled
        and "IrAbility::VoteDuel" in resolver
        and "InnerEvent::VoteDuelDeclared" in resolver
        and "Vote duel:" in projections
    )
    public_vote_duel_golden = (
        public_vote_duel_modeled
        and all(
            action.rsplit(":", 1)[1] in mafiascum_goldens
            and "votedueldeclared" in mafiascum_goldens
            for action in INFO_PUBLIC_VOTE_DUEL_ACTIONS
        )
        and "no live ballot" in mafiascum_goldens
        and "official duel ballots are tied at the top tally" in mafiascum_goldens
        and '"tiebreak": "random"' in mafiascum_goldens
    )
    public_vote_duel_integrated = public_vote_duel_implemented and all(
        selector in command_tests
        for selector in INFO_PUBLIC_VOTE_DUEL_ACTIONS.values()
    ) and (
        "host_resolve_phase_applies_gladiator_vote_duel_no_ballots" in command_tests
        and "host_resolve_phase_applies_gladiator_vote_duel_tied_ballots" in command_tests
    )
    rows.append(
        row(
            "surface:info",
            "public_vote_duel",
            "VoteDuelDeclared+DayVoteOutcome",
            len(INFO_PUBLIC_VOTE_DUEL_ACTIONS),
            public_vote_duel_modeled,
            public_vote_duel_implemented,
            public_vote_duel_golden,
            public_vote_duel_integrated,
            (
                "info-tagged mafiascum Gladiator duel only: restricts "
                "official day vote to challenger and target, and no-ballot/tied "
                "duels force seeded random elimination via vote_duel_tie_breaker; "
                "lethal Chinese Knight duel remains separate DuelResolved surface"
            ),
        )
    )

    dynamic_vote_goldens = (
        fmarch["golden_text_by_pack"].get("test_dynamic_vote_effect", "")
        + fmarch["golden_text_by_pack"].get("test_dynamic_vote_hammer", "")
        + fmarch["golden_text_by_pack"].get("test_dynamic_vote_prompt", "")
        + fmarch["golden_text_by_pack"].get("test_dynamic_vote_pk", "")
    ).lower()
    dynamic_vote_modeled = "test_dynamic_vote_effect:vote_empowered" in fmarch["pack_dynamic_vote_effects"]
    dynamic_vote_grant_modeled = (
        "test_dynamic_vote_effect:vote_power_boost" in fmarch["pack_dynamic_vote_grants"]
    )
    dynamic_vote_implemented = (
        dynamic_vote_modeled
        and dynamic_vote_grant_modeled
        and "WeightPolicy::Dynamic(dynamic)" in resolver
        and "dynamic_vote_weight" in resolver
        and "effect_rules" in resolver
        and "grant_rules" in resolver
        and "GrantKind::VoteWeight" in resolver
    )
    dynamic_vote_golden = (
        dynamic_vote_modeled
        and dynamic_vote_grant_modeled
        and "vote_empowered" in dynamic_vote_goldens
        and "vote_power_boost" in dynamic_vote_goldens
        and "dayvoteoutcome" in dynamic_vote_goldens
    )
    dynamic_vote_integrated = (
        dynamic_vote_implemented
        and "host_resolve_phase_uses_dynamic_effect_vote_weight" in command_tests
        and "host_resolve_phase_uses_vote_weight_action_grant" in command_tests
        and "submit_vote_hammer_uses_folded_vote_weight_grant" in command_tests
        and "host_resolve_phase_uses_dynamic_vote_weight_for_no_majority_prompt" in command_tests
        and "host_resolve_phase_uses_dynamic_vote_weight_for_pk_tie_prompt" in command_tests
        and "slot_effects" in command_tests
        and "vote_weight" in command_tests
    )
    rows.append(
        row(
            "policy:vote",
            "dynamic_effect_vote_weight",
            "WeightPolicy::Dynamic(effect_rules+grant_rules)",
            len(fmarch["pack_dynamic_vote_effects"]) + len(fmarch["pack_dynamic_vote_grants"]),
            dynamic_vote_modeled,
            dynamic_vote_implemented,
            dynamic_vote_golden,
            dynamic_vote_integrated,
            (
                "dynamic vote weight policy reads folded persistent slot effects "
                "created by legal Mark actions and folded VoteWeight grants created "
                "by legal Grant actions, applying the highest-priority matching rule; "
                "live SubmitVote hammer simulation, NoMajority revote prompt "
                "generation, and HostDecides PK prompt generation read the same "
                "folded grant state"
            ),
        )
    )

    for item in inventory["modifiers"]:
        name = item["name"]
        canonical = MODIFIER_MAP.get(name, "")
        category = f"modifier:{item['kind']}"
        notes = ""
        if name in {"doublevoter", "triplevoter", "x_voter", "voteless"}:
            expected, selector = {
                "doublevoter": (2.0, "host_resolve_phase_uses_pack_declared_vote_weights"),
                "triplevoter": (3.0, "host_resolve_phase_uses_pack_declared_triplevoter_weight"),
                "x_voter": (2.0, "host_resolve_phase_uses_pack_declared_x_voter_weight"),
                "voteless": (0.0, "host_resolve_phase_uses_pack_declared_vote_weights"),
            }[name]
            modeled = fmarch["pack_vote_weights"].get(f"mafiascum:{name}") == expected
            implemented = modeled and "WeightPolicy::PerRole" in resolver and "map.get(&slot.role_key)" in resolver
            integrated = implemented and selector in command_tests
        elif name in {"loved", "hated"}:
            expected = {"loved": 1.0, "hated": -1.0}[name]
            modeled = fmarch["pack_vote_threshold_adjustments"].get(f"mafiascum:{name}") == expected
            implemented = modeled and "threshold_adjustments" in resolver and "thresholds.insert" in resolver
            integrated = modeled and "Command::ResolvePhase" in commands if implemented else False
        elif name == "combined":
            modeled = '"additional_abilities"' in fmarch["pack_text"]
            implemented = (
                modeled
                and "pub additional_abilities: Vec<IrAbility>" in fmarch["pack_src_text"]
                and "composite_action_abilities_are_strict" in fmarch["domain_tests_text"]
                and "self.additional_abilities.contains(&ability)" in fmarch["pack_src_text"]
            )
            golden = (
                "cpr_saves_attacked_target"
                in fmarch["golden_names_by_pack"].get("mafiascum", set())
                and "jailkeeper_block_protect"
                in fmarch["golden_names_by_pack"].get("mafiascum", set())
            )
            integrated = (
                implemented
                and "host_resolve_phase_persists_cpr_harm_policy" in command_tests
                and "host_resolve_phase_persists_jailkeeper_block_plus_protect_policy"
                in command_tests
            )
            notes = (
                "im-human Combined metadata becomes explicit multi-primitive "
                "`additional_abilities`; CPR Protect+Kill and Jailkeeper "
                "Block+Protect prove pack, resolver, golden, and command seams"
            )
        elif name == "complex":
            modeled = (
                '"target_role_filter": "PowerRole"' in fmarch["pack_text"]
                and '"vanilla_roles"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "target_role_filter_error" in resolver
                and 'reason: "invalid_target_role"' in resolver
                and "target_role_filter_is_strict_and_versioned"
                in fmarch["domain_tests_text"]
            )
            golden = (
                "power_role_killer_kills_power_roles"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
                and "power_role_killer_rejects_vanilla_target"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
            )
            integrated = (
                implemented
                and "host_resolve_phase_carries_mafia_universe_power_role_killer_filter"
                in command_tests
            )
            notes = (
                "im-human Complex metadata maps to pack-owned "
                "`target_role_filter: PowerRole`; Mafia Universe Power Role "
                "Killer proves vanilla rejection and power-role kills"
            )
        else:
            modeled = canonical in fmarch["modifiers"] or canonical in fmarch["pack_modifiers"]
            implemented = bool(canonical and f"Modifier::{canonical}" in resolver)
            integrated = False
        if name == "x_shot":
            implemented = "constraints.x_shots" in resolver
            integrated = (
                implemented
                and "x_shot:night_kill" in command_tests
                and "action_counter" in commands
            )
        elif name == "blocked":
            modeled = "roleblockable" in fmarch["pack_text"]
            implemented = "action.roleblockable" in resolver and "roleblocked" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_persists_suppression_and_conflict_trace_decisions"
                in command_tests
                and "host_resolve_phase_non_roleblockable_block_survives_roleblock"
                in command_tests
            )
        elif name == "self_targetable":
            modeled = "self_allowed" in fmarch["pack_text"]
            implemented = "self_target_error" in resolver and '"self_target"' in resolver
            integrated = (
                implemented
                and "self_allowed=false rejects actor self-targeting" in command_tests
                and "bad_self_kill" in command_tests
            )
        elif name in {"cycle_x", "x_cycle_cooldown"}:
            modeled = "cooldown_cycles" in fmarch["pack_text"]
            implemented = "constraints.cooldown_cycles" in resolver and "cooldown:" in resolver
            golden = "cooldown_cop" in goldens
            integrated = implemented and "cooldown_cop_n02" in command_tests and "action_counter" in commands
            if name == "cycle_x":
                notes = (
                    "im-human CycleX and XCycleCooldown both write dynamic "
                    "cycle-cooldown metadata; fmarch models that as "
                    "`constraints.cooldown_cycles` with folded action counters"
                )
        elif name == "tiebreaker":
            modeled = '"tiebreaker_roles"' in fmarch["pack_text"]
            implemented = (
                modeled
                and "role_tiebreaker_winner" in resolver
                and "RoleTiebreaker" in resolver
                and "vote_tiebreaker_roles_must_reference_roles"
                in fmarch["domain_tests_text"]
            )
            golden = (
                "role_tiebreaker_selects_tied_candidate"
                in fmarch["golden_names_by_pack"].get("test_role_tiebreaker_vote", set())
            )
            integrated = (
                implemented
                and "host_resolve_phase_uses_pack_declared_role_tiebreaker"
                in command_tests
            )
            notes = (
                "im-human Tiebreaker vote metadata maps to pack-owned "
                "`vote.tiebreaker_roles`; a plurality fixture proves the role "
                "candidate tie policy before ordinary fallback resolution"
            )
        elif name == "compulsive":
            integrated = (
                implemented
                and "host_resolve_phase_records_missing_compulsive_action" in command_tests
            )
        elif name == "indecisive":
            integrated = implemented and "indecisive_cop_n02" in command_tests
        elif name == "lazy":
            modeled = "lazy_requires_multiple_non_town" in fmarch["pack_text"]
            implemented = "lazy_endgame_error" in resolver
            integrated = implemented and "lazy_cop_n02" in command_tests
        elif name == "lover":
            modeled = "mafiascum:lover_policy" in fmarch["pack_policies"]
            implemented = (
                "apply_lover_suicides" in resolver
                and "InnerEvent::PlayersLinked" in resolver
                and "lover_suicide" in resolver
            )
            integrated = (
                implemented
                and "host_resolve_phase_carries_lover_link_and_suicide"
                in command_tests
                and "host_resolve_phase_stacks_lover_suicide_with_direct_death"
                in command_tests
            )
        elif name == "lost":
            modeled = "Lost" in fmarch["pack_modifiers"] and "team_kill_action_ids" in fmarch["pack_text"]
            implemented = (
                modeled
                and "RoleModifier::Lost" in resolver
                and "role_modifier_team_kill_error" in resolver
            )
            integrated = implemented and "lost_factional_n01" in command_tests
        elif name == "recluse":
            modeled = "Recluse" in fmarch["pack_modifiers"] and "team_kill_action_ids" in fmarch["pack_text"]
            implemented = (
                modeled
                and "RoleModifier::Recluse" in resolver
                and "role_modifier_team_kill_error" in resolver
            )
            integrated = implemented and "recluse_factional_n01" in command_tests
        elif name == "simultaneous":
            implemented = (
                modeled
                and "Modifier::Simultaneous" in resolver
                and "duplicate_submission" in resolver
            )
            integrated = implemented and "simul_vig_n01_b" in command_tests
        elif name == "disabled_endgame":
            modeled = "disabled_at_or_below_alive" in fmarch["pack_text"]
            implemented = "disabled_endgame_error" in resolver
            integrated = implemented and "disabled_endgame_cop_n01" in command_tests
        elif name in {"day", "night_specific"}:
            window = "Day" if name == "day" else "Night"
            reason = "day_specific" if name == "day" else "night_specific"
            selector = (
                "action_submission_rejects_day_specific_action_in_night_window"
                if name == "day"
                else "action_submission_rejects_invalid_target_shape_state_and_window"
            )
            modeled = f'"window": "{window}"' in fmarch["pack_text"]
            implemented = (
                "phase_window_matches" in resolver
                and "phase_window_mismatch_reason" in resolver
                and f'Some("{reason}")' in resolver
            )
            integrated = implemented and selector in command_tests
            category = "pack:action_window"
            notes = (
                "im-human action modifier maps to fmarch action window plus "
                "phase-cadence validation"
            )
        elif name == "personal":
            modeled = "personal_only" in fmarch["pack_text"]
            implemented = "personal_target_error" in resolver
            integrated = implemented and "personal-only commuter" in command_tests
        elif name == "roaming":
            implemented = implemented and '"roaming"' in resolver
            integrated = implemented and "roaming_cop_n03" in command_tests
        elif name == "uncooperative":
            modeled = "uncooperative_result" in fmarch["pack_text"]
            implemented = (
                modeled
                and "Modifier::Uncooperative" in resolver
                and "uncooperative_result" in resolver
            )
            integrated = implemented and "uncooperative_cop_n01" in command_tests
        elif name in {"activated", "novice"}:
            reason = "Activated" if name == "activated" else "Novice"
            modeled = f'"reason": "{reason}"' in fmarch["pack_text"]
            implemented = "constraints.active_from" in resolver and f"{name}_inactive" in resolver
            golden = f"{name}_cop" in goldens
            integrated = implemented and f"{name}_cop_n01" in command_tests
        elif name == "odd_cycle":
            modeled = '"cycle_parity": "Odd"' in fmarch["pack_text"]
            implemented = "constraints.cycle_parity" in resolver and "PhaseParity::Odd" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_uses_pack_declared_cycle_parity" in command_tests
            )
        elif name == "even_cycle":
            modeled = '"cycle_parity": "Even"' in fmarch["pack_text"]
            implemented = "constraints.cycle_parity" in resolver and "PhaseParity::Even" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_uses_pack_declared_cycle_parity" in command_tests
            )
        elif name == "odd_night":
            implemented = "PhaseParity::Odd" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_uses_pack_declared_night_parity" in command_tests
            )
        elif name == "even_night":
            implemented = "PhaseParity::Even" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_uses_pack_declared_night_parity" in command_tests
            )
        elif name == "loud":
            integrated = (
                implemented
                and "host_resolve_phase_projects_loud_and_announcing_notifications" in command_tests
            )
        elif name == "announcing":
            integrated = (
                implemented
                and "host_resolve_phase_projects_loud_and_announcing_notifications" in command_tests
            )
        elif name == "macho":
            modeled = '"effects": ["macho"]' in fmarch["pack_text"]
            implemented = 'contains("macho")' in resolver
            integrated = (
                implemented
                and "host_resolve_phase_macho_target_ignores_doctor_protection" in command_tests
            )
        elif name == "godfather":
            modeled = '"effects": ["godfather"]' in fmarch["pack_text"]
            implemented = (
                "investigation_overrides" in resolver
                and "overrides.get(tag)" in resolver
                and "parity_result" in resolver
            )
            integrated = (
                implemented
                and "host_resolve_phase_applies_godfather_investigation_override"
                in command_tests
            )
        elif name in {"alignment_only_flip", "flipless", "janitor"}:
            if name == "alignment_only_flip":
                modeled = (
                    '"alignment_only_flip": "AlignmentOnly"' in fmarch["pack_text"]
                    and '"effects": ["alignment_only_flip"]' in fmarch["pack_text"]
                )
                integrated = (
                    "host_resolve_phase_projects_alignment_only_death_reveal"
                    in command_tests
                )
            elif name == "flipless":
                modeled = (
                    '"flipless": "Concealed"' in fmarch["pack_text"]
                    and '"effects": ["flipless"]' in fmarch["pack_text"]
                )
                integrated = (
                    "host_resolve_phase_conceals_janitor_and_flipless_death_reveals"
                    in command_tests
                )
            else:
                modeled = (
                    '"janitor_kill": "Concealed"' in fmarch["pack_text"]
                    and '"id": "janitor_kill"' in fmarch["pack_text"]
                )
                integrated = (
                    "host_resolve_phase_conceals_janitor_and_flipless_death_reveals"
                    in command_tests
                )
            implemented = (
                "death_reveal_mode" in resolver
                and "DeathRevealMode::Concealed" in resolver
                and "DeathRevealMode::AlignmentOnly" in resolver
                and "death_reveal" in projections
            )
            integrated = implemented and integrated
            category = "policy:death_reveal"
            notes = (
                "im-human effect modifier maps to mafiascum death_reveal policy "
                "and PlayerKilled.death_reveal projection fold"
            )
        elif name == "loyal":
            modeled = (
                "Loyal" in fmarch["pack_modifiers"]
                or '"effects": ["loyal"]' in fmarch["pack_text"]
            )
            implemented = "Modifier::Loyal" in resolver and '"loyal"' in resolver
            integrated = (
                implemented
                and "host_resolve_phase_persists_loyal_conversion_block_trace"
                in command_tests
            )
        elif name == "disloyal":
            modeled = "Disloyal" in fmarch["pack_modifiers"]
            implemented = (
                "Modifier::Disloyal" in resolver
                and '"disloyal"' in resolver
                and "disloyal_target_error" in resolver
            )
            golden = (
                "disloyal_cult_recruit_cross_alignment" in goldens
                and "actioninterfered" in goldens
                and "playerconverted" in goldens
            )
            integrated = (
                implemented
                and "host_resolve_phase_persists_disloyal_modifier_trace_and_projection"
                in command_tests
            )
        elif name == "stealthy":
            implemented = implemented and "visibility_policy" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_preserves_ninja_hidden_visit_results"
                in command_tests
            )
        elif name == "ninja":
            implemented = implemented and "visibility_policy" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_preserves_ninja_hidden_visit_results"
                in command_tests
            )
            notes = (
                "im-human effect modifier maps to fmarch Ninja action modifier "
                "plus visibility policy"
            )
        elif name == "strongman":
            implemented = implemented and "strongman_bypasses_protect" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_persists_suppression_and_conflict_trace_decisions"
                in command_tests
            )
        elif name == "strong_willed":
            implemented = implemented and "action.strong_willed" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_strong_willed_bypasses_roleblock"
                in command_tests
            )
        elif name == "non_consecutive":
            integrated = (
                implemented
                and "host_resolve_phase_carries_action_history_for_non_consecutive"
                in command_tests
            )
        elif name == "non_consecutive_night":
            integrated = (
                implemented
                and "host_resolve_phase_carries_action_history_for_non_consecutive"
                in command_tests
            )
        elif name == "weak":
            integrated = (
                implemented
                and "host_resolve_phase_weak_cop_dies_on_scum_result" in command_tests
            )
        elif name in {"bulletproof", "bulletproof_vest"}:
            implemented = bool(canonical and f'"{canonical}"' in resolver)
            integrated = bool(implemented and canonical in command_tests)
        elif name == "backup":
            modeled = "mafiascum:backup_policy" in fmarch["pack_policies"]
            implemented = modeled and "BackupTargeted" in resolver
            integrated = implemented and "host_resolve_phase_targeted_backup" in command_tests
        elif name in {
            "better_ita_chance",
            "worse_ita_chance",
            "percent_ita_vulnerability",
            "xn_ita_shields",
        }:
            field = {
                "better_ita_chance": "hit_bonus",
                "worse_ita_chance": "hit_penalty",
                "percent_ita_vulnerability": "target_evade",
                "xn_ita_shields": "shields",
            }[name]
            modeled = (
                "mafia_universe:ita.modifier_components" in fmarch["pack_policies"]
                and "mafia_universe:ita.role_modifier_refs" in fmarch["pack_policies"]
                and f'"{field}"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "ita_hit_chance" in resolver
                and "effective_role_override" in resolver
                and (
                    name != "xn_ita_shields"
                    or "ItaShotOutcome::Blocked" in resolver
                )
            )
            golden = modeled and "ita_better_shielded" in goldens
            integrated = (
                implemented
                and "host_resolve_phase_carries_ita_chance_overrides_and_shields"
                in command_tests
            )
        elif name == "treestump":
            modeled = "mafia_universe:treestump_policy" in fmarch["pack_policies"]
            implemented = (
                modeled
                and "InnerEvent::SlotStatusTagged" in resolver
                and "treestump_policy" in resolver
            )
            integrated = (
                implemented
                and "resolve_phase_tags_treestump_and_preserves_dead_vote_action_bar"
                in command_tests
            )
        elif name in {"mason", "neighbor"}:
            kind = "Mason" if name == "mason" else "Neighbor"
            reveal = "Town" if name == "mason" else "None"
            modeled = (
                f'"kind": "{kind}"' in fmarch["pack_text"]
                and f'"roles": ["{name}"]' in fmarch["pack_text"]
                and f'"reveals_alignment": "{reveal}"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "PrivateChannelDeclared" in commands
                and "private_channel_member" in projections
            )
            integrated = (
                implemented
                and "start_game_declares_mason_neighbor_private_channels" in command_tests
            )
            category = "platform:private_channel"
            notes = (
                "setup-time private-channel metadata; command/projection proof "
                "applies, resolver golden output is not applicable"
            )
        elif name == "vengeful":
            canonical = "TriggerOn::Kill+vengeful_retaliates"
            modeled = (
                "vengeful" in fmarch["pack_modifiers"]
                and '"id": "vengeful_retaliates"' in fmarch["pack_text"]
                and '"if_target_has": ["vengeful"]' in fmarch["pack_text"]
            )
            implemented = modeled and "TriggerOn::Ability(IrAbility::Kill)" in resolver
            integrated = (
                implemented
                and "host_resolve_phase_protects_ordinary_vengeful_trigger_kill"
                in command_tests
            )
        golden = (
            name.lower() in goldens
            or (canonical and canonical.lower() in goldens)
            or (
                name == "combined"
                and "cpr_saves_attacked_target"
                in fmarch["golden_names_by_pack"].get("mafiascum", set())
                and "jailkeeper_block_protect"
                in fmarch["golden_names_by_pack"].get("mafiascum", set())
            )
            or (
                name == "complex"
                and "power_role_killer_kills_power_roles"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
                and "power_role_killer_rejects_vanilla_target"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
            )
            or (name in {"cycle_x", "x_cycle_cooldown"} and "cooldown_cop" in goldens)
            or (
                name == "tiebreaker"
                and "role_tiebreaker_selects_tied_candidate"
                in fmarch["golden_names_by_pack"].get("test_role_tiebreaker_vote", set())
            )
            or (
                name
                in {
                    "better_ita_chance",
                    "worse_ita_chance",
                    "percent_ita_vulnerability",
                    "xn_ita_shields",
                }
                and "ita_better_shielded" in goldens
            )
        )
        notes = append_note(notes, standard_nar_catalog_note_for_modifier(name, fmarch))
        rows.append(
            row(
                category,
                name,
                canonical,
                1,
                modeled,
                implemented,
                golden,
                integrated,
                notes,
            )
        )

    for item in inventory["result_event_kinds"]:
        name = item["name"]
        canonical = RESULT_KIND_MAP.get(name, "")
        notes = ""
        if name == "ingest.halt":
            modeled = (
                canonical in fmarch["events"]
                and "`ingest.halt` | `ActionIngestHalted`" in fmarch["docs_text"]
            )
            implemented = (
                modeled
                and "InnerEvent::ActionIngestHalted" in resolver
                and "invalid_submission_ingest_halts" in resolver
                and "submission_template_rejected" in resolver
                and "action_ingest_halted_payload_passes_contract_validation"
                in fmarch["domain_tests_text"]
            )
            golden = implemented and "ActionIngestHalted should pass" in fmarch["domain_tests_text"]
            integrated = (
                implemented
                and "action_submission_rejects_and_traces_invalid_template_ids"
                in command_tests
                and "historical invalid template id should emit ActionIngestHalted"
                in command_tests
                and "submission_template_rejected" in command_tests
            )
            notes = (
                "im-human `ingest.halt` maps to fmarch `ActionIngestHalted` for "
                "historical/replay submissions halted inside resolver ingest; "
                "front-door command validation still rejects illegal live submissions before append"
            )
        else:
            modeled = canonical in fmarch["events"]
            implemented = bool(canonical and f"InnerEvent::{canonical}" in resolver)
            golden = name.lower() in goldens or (canonical and canonical.lower() in goldens)
            integrated = bool(canonical and (canonical in projections or canonical in command_tests))
        if name == "ita.shot.buffered":
            modeled = (
                canonical in fmarch["events"]
                and "buffer_delay_ms" in fmarch["pack_text"]
                and "test_ita_buffered" in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "InnerEvent::ItaShotBuffered" in resolver
                and "buffer_delay_ms" in resolver
                and "ItaShotBuffered" in fmarch["domain_tests_text"]
            )
            golden = (
                implemented
                and "ita_session_buffered_shot"
                in fmarch["golden_names_by_pack"].get("test_ita_buffered", set())
            )
            integrated = (
                implemented
                and "host_resolve_phase_buffers_ita_shot_without_same_pass_resolution"
                in command_tests
                and "ItaShotBuffered" in command_tests
            )
            notes = (
                "pack-declared ITA session buffer delay emits canonical `ItaShotBuffered` "
                "and defers same-pass queue/resolve/kill; later release mechanics remain pending"
            )
        elif name == "ita.shot.invalidated":
            modeled = (
                canonical in fmarch["events"]
                and "ita" in fmarch["pack_text"]
                and "mafia_universe" in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "InnerEvent::ItaShotInvalidated" in resolver
                and "ita_kills_by_target" in resolver
                and "target_dead" in resolver
            )
            golden = (
                implemented
                and "ita_session_invalidates_later_dead_target"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
                and "ItaShotInvalidated" in fmarch["domain_tests_text"]
            )
            integrated = (
                implemented
                and "host_resolve_phase_invalidates_later_ita_shot_at_dead_target"
                in command_tests
                and "ItaShotInvalidated" in command_tests
            )
            notes = (
                "queued ITA shots at a target killed earlier in the same session emit "
                "canonical `ItaShotInvalidated` with `reason=target_dead` and "
                "`invalidated_by` pointing at the killing action; buffered release mechanics "
                "remain pending"
            )
        elif name == "ita.shot.refunded":
            modeled = (
                canonical in fmarch["events"]
                and "resolution_policy" in fmarch["pack_text"]
                and "on_target_already_dead" in fmarch["pack_text"]
                and "REFUND_SHOT" in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "InnerEvent::ItaShotRefunded" in resolver
                and "should_refund_dead_target" in resolver
                and "refunded_by_reason" in resolver
            )
            golden = (
                implemented
                and "ita_session_refunds_already_dead_target"
                in fmarch["golden_names_by_pack"].get("mafia_universe", set())
                and "ItaShotRefunded" in fmarch["domain_tests_text"]
            )
            integrated = (
                implemented
                and "host_resolve_phase_refunds_ita_shot_at_already_dead_target"
                in command_tests
                and "ItaShotRefunded" in command_tests
            )
            notes = (
                "pack-declared `resolution_policy.on_target_already_dead=REFUND_SHOT` emits "
                "canonical `ItaShotRefunded` with `reason=target_dead`, HP metadata, "
                "and quota-neutral refund counters when a queued ITA shot executes into an "
                "already-dead target"
            )
        elif name in ITA_DEFERRED_SHOT_RESULT_KINDS:
            modeled = False
            implemented = False
            golden = False
            integrated = False
            notes = (
                "canonical Rust result event and im-human fixture importer/schema validation "
                "are frozen; pack policy, resolver production, goldens, and command/projection "
                "integration remain pending"
            )
        rows.append(
            row(
                "result_event_kind",
                name,
                canonical,
                item["source_count"],
                modeled,
                implemented,
                golden,
                integrated,
                notes,
            )
        )

    for item in inventory["day_steps"]:
        name = item["name"]
        canonical = DAY_STEP_MAP.get(name, "")
        modeled = canonical in fmarch["events"] or name == "vote"
        implemented = bool(canonical and canonical in resolver) or (name == "vote" and "resolve_day" in resolver)
        golden = name.lower() in goldens or (canonical and canonical.lower() in goldens)
        integrated = implemented and "Command::ResolvePhase" in commands
        rows.append(row("day_step", name, canonical, 1, modeled, implemented, golden, integrated))

    for item in inventory["roles"]:
        name = item["name"]
        scoped_name = f"{item['culture']}:{name}"
        canonical_name = ROLE_ID_MAP.get(scoped_name, name)
        modeled = f"{item['culture']}:{canonical_name}" in fmarch["pack_roles"]
        canonical = canonical_name if modeled else ""
        pack_goldens = fmarch["golden_text_by_pack"].get(item["culture"], "")
        golden = modeled and (
            name.lower() in pack_goldens or canonical.lower() in pack_goldens
        )
        notes = "source alias" if canonical and canonical != name else ""
        implemented = modeled
        integrated = modeled and "RoleAssigned" in commands
        if scoped_name == "chinese_structured:lovers_helper":
            chinese_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            canonical = "lover_policy.source_helper_role"
            modeled = (
                "chinese_structured:lover_policy" in fmarch["pack_policies"]
                and "chinese_structured:lovers_helper" in fmarch["pack_policies"]
                and '"source_helper_role": "lovers_helper"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_lover_suicides" in resolver
                and "input.state.linked_slots" in resolver
            )
            golden = modeled and all(
                fixture in chinese_golden_names
                for fixture in [
                    "cupid_lovers_death_cascade",
                    "cupid_lovers_lynch_cascade",
                    "cupid_lovers_cascade_disabled",
                ]
            )
            integrated = implemented and all(
                selector in command_tests
                for selector in [
                    "host_resolve_phase_carries_chinese_cupid_link_and_lovers_cascade",
                    "host_resolve_phase_carries_chinese_lover_lynch_cascade",
                ]
            )
            notes = (
                "non-draftable im-human helper role represented as "
                "lover_policy.source_helper_role metadata, not a pack.roles entry"
            )
        elif scoped_name == "mafia_universe:lover":
            mu_golden_names = fmarch["golden_names_by_pack"].get(
                "mafia_universe",
                set(),
            )
            canonical = "lover"
            modeled = (
                "mafia_universe:lover" in fmarch["pack_roles"]
                and "mafia_universe:lover_policy" in fmarch["pack_policies"]
                and '"lovers_link"' in fmarch["pack_text"]
                and '"suicide_cause": "lover_suicide"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_lover_suicides" in resolver
                and "input.state.linked_slots" in resolver
                and "lover_suicide" in resolver
            )
            golden = modeled and "lover_suicide_on_partner_death" in mu_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_carries_mafia_universe_lover_setup_cascade"
                in command_tests
            )
            notes = (
                "Passive Lover role from the Mafia Universe catalog; fmarch keeps "
                "the setup pair as folded PlayersLinked state and uses lover_policy "
                "for the linked-death cascade."
            )
        elif scoped_name == "mafiascum:encryptor":
            canonical = "private_channels:FactionDayChat"
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and '"kind": "FactionDayChat"' in fmarch["pack_text"]
                and '"member_alignments":' in fmarch["pack_text"]
                and '"mafia"' in fmarch["pack_text"]
                and '"enabled_by_roles":' in fmarch["pack_text"]
                and '"encryptor"' in fmarch["pack_text"]
                and '"active_while_source_alive": true' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "PrivateChannelDeclared" in commands
                and "PrivateChannelRevoked" in commands
                and "PrivateChannelRevoked" in projections
                and "private_channel_member" in projections
            )
            golden = implemented
            integrated = (
                implemented
                and "encryptor_declares_and_revokes_mafia_day_chat" in command_tests
            )
            notes = (
                "Passive faction_day_chat role from the Mafiascum catalog; "
                "fmarch models it as source-alive-gated FactionDayChat private-channel "
                "metadata with command/projection declaration and revocation."
            )
        elif scoped_name == "mafiascum:bomb":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get(
                "mafiascum",
                set(),
            )
            canonical = "bomb"
            modeled = (
                "mafiascum:bomb" in fmarch["pack_roles"]
                and "bomb" in fmarch["pack_modifiers"]
                and '"id": "bomb_retaliates"' in fmarch["pack_text"]
                and '"target": "Killer"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_trigger_fixpoint" in resolver
                and "InnerEvent::Trigger" in resolver
                and "bomb_retaliates" in fmarch["pack_text"]
            )
            golden = modeled and "bomb_retaliates_on_night_kill" in mafiascum_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_projects_mafiascum_bomb_trigger"
                in command_tests
            )
            notes = (
                "Passive night_retribution role from the Mafiascum catalog; "
                "fmarch folds it as a hidden bomb role effect consumed by the "
                "bomb_retaliates Kill trigger."
            )
        elif scoped_name == "mafiascum:follower":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get(
                "mafiascum",
                set(),
            )
            canonical = "follower"
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and "mafiascum:follow" in fmarch["pack_actions"]
                and '"id": "follow"' in fmarch["pack_text"]
                and '"mode": "ActionType"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "InvestigateMode::ActionType" in resolver
                and "followed_action_types" in resolver
                and "action_type_category" in resolver
                and '"action_types"' in fmarch["events_text"]
            )
            golden = modeled and "follower_reads_action_type" in mafiascum_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_projects_follower_action_type_result"
                in command_tests
            )
            notes = (
                "Mafiascum Follower uses im-human action_type investigation; "
                "fmarch models it as InvestigateMode::ActionType returning "
                "visible action-type categories such as killing."
            )
        elif scoped_name in {
            "mafia_universe:mafia_bomber",
            "mafia_universe:town_bomber",
        }:
            mu_golden_names = fmarch["golden_names_by_pack"].get(
                "mafia_universe",
                set(),
            )
            golden_name = f"{name}_retaliates_on_night_kill"
            canonical = name
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and '"bomb"' in fmarch["pack_text"]
                and '"id": "bomb_retaliates"' in fmarch["pack_text"]
                and '"if_target_has": ["bomb"]' in fmarch["pack_text"]
                and '"target": "Killer"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_trigger_fixpoint" in resolver
                and "InnerEvent::Trigger" in resolver
                and "bomb_retaliates" in fmarch["pack_text"]
            )
            golden = modeled and golden_name in mu_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_projects_mafia_universe_bomber_triggers"
                in command_tests
            )
            notes = (
                "Passive night_retribution role from the Mafia Universe catalog; "
                "fmarch folds it as a hidden bomb role effect consumed by the "
                "bomb_retaliates Kill trigger."
            )
        elif scoped_name in {
            "mafia_universe:mason",
            "mafia_universe:neighbor",
        }:
            kind = "Mason" if name == "mason" else "Neighbor"
            reveal = "Town" if name == "mason" else "None"
            canonical = name
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and "mafia_universe:private_channels" in fmarch["pack_policies"]
                and f'"kind": "{kind}"' in fmarch["pack_text"]
                and f'"roles": ["{name}"]' in fmarch["pack_text"]
                and f'"reveals_alignment": "{reveal}"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "PrivateChannelDeclared" in commands
                and "private_channel_member" in projections
            )
            golden = implemented
            integrated = (
                implemented
                and "start_game_declares_mafia_universe_mason_neighbor_private_channels"
                in command_tests
            )
            notes = (
                "Passive private-chat role from the Mafia Universe catalog; "
                "fmarch models it as setup-time private_channels metadata. "
                "Resolver golden output is not applicable, so command/projection "
                "coverage is the proof surface."
            )
        elif scoped_name == "mafiascum:ascetic":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get(
                "mafiascum",
                set(),
            )
            canonical = "ascetic"
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and "mafiascum:ascetic" in fmarch["pack_standard_nar_target_state_gate_tags"]
                and '"ascetic": {' in fmarch["pack_text"]
                and '"Protect"' in fmarch["pack_text"]
                and '"Investigate"' in fmarch["pack_text"]
                and '"Convert"' in fmarch["pack_text"]
                and '"Mark"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "target_state_gate_reason" in resolver
                and "IrAbility::Protect" in resolver
                and "IrAbility::Convert" in resolver
                and "IrAbility::Mark" in resolver
                and "IrAbility::Investigate" in resolver
                and "conversion_blocked" in resolver
            )
            golden = modeled and all(
                fixture in mafiascum_golden_names
                for fixture in [
                    "ascetic_blocks_non_lethal_actions",
                    "ascetic_blocks_protect_and_convert",
                ]
            )
            integrated = (
                implemented
                and "host_resolve_phase_carries_mafiascum_ascetic_non_lethal_immunity"
                in command_tests
            )
            notes = (
                "Mafiascum Ascetic is a town passive non-lethal immunity role; "
                "fmarch models it as a persistent `ascetic` target-state gate "
                "that blocks Protect, Investigate, Convert, and Mark while leaving "
                "Kill ungated."
            )
        elif scoped_name == "mafia_universe:town_strongman":
            mu_golden_names = fmarch["golden_names_by_pack"].get(
                "mafia_universe",
                set(),
            )
            canonical = "town_strongman"
            modeled = (
                scoped_name in fmarch["pack_roles"]
                and '"id": "strongman_kill"' in fmarch["pack_text"]
                and '"modifiers": ["Strongman"]' in fmarch["pack_text"]
                and '"alignment": "town"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "strongman_bypasses_protect" in resolver
                and "standard_nar_strongman_bypasses" in resolver
            )
            golden = modeled and "town_strongman_pierces_doctor" in mu_golden_names
            integrated = (
                implemented
                and "host_resolve_phase_carries_mafia_universe_town_strongman_pierce"
                in command_tests
            )
            notes = (
                "Mafia Universe Town Strongman is a town-aligned strongman_kill "
                "role with kill,pierce semantics; fmarch maps it to the existing "
                "Strongman kill modifier and standard-NAR protection bypass policy."
            )
        elif scoped_name == "core:jack_of_all_trades":
            mafiascum_golden_names = fmarch["golden_names_by_pack"].get("mafiascum", set())
            mafia_universe_golden_names = fmarch["golden_names_by_pack"].get(
                "mafia_universe",
                set(),
            )
            concrete_roles = [
                "mafiascum:jack_of_all_trades",
                "mafia_universe:town_jack_of_all_trades",
                "mafia_universe:mafia_jack_of_all_trades",
            ]
            canonical = "jack_of_all_trades"
            modeled = any(role in fmarch["pack_roles"] for role in concrete_roles)
            implemented = modeled
            golden = modeled and (
                "jack_of_all_trades_block_consumes_one_shot" in mafiascum_golden_names
                or "jack_of_all_trades_block_consumes_one_shot" in mafia_universe_golden_names
                or "jack_of_all_trades_town_block_consumes_one_shot"
                in mafia_universe_golden_names
            )
            integrated = implemented and (
                "host_resolve_phase_carries_mafiascum_joat_block_counter" in command_tests
                or "host_resolve_phase_carries_mafia_universe_joat_block_counter"
                in command_tests
            )
            notes = "abstract core base represented by concrete culture-pack JOAT roles"
        rows.append(
            row(
                "role_id",
                f"{item['culture']}:{name}",
                canonical,
                1,
                modeled,
                implemented,
                golden,
                integrated,
                notes,
            )
        )

    action_source_counts = Counter(
        f"{item['culture']}:{item['name']}" for item in inventory["actions"]
    )
    for item in inventory["actions"]:
        name = item["name"]
        scoped_name = f"{item['culture']}:{name}"
        source_role = item.get("role", "")
        canonical_role = ROLE_ID_MAP.get(f"{item['culture']}:{source_role}", source_role)
        role_scoped_name = f"{item['culture']}:{canonical_role}:{name}"
        source_is_ambiguous = action_source_counts[scoped_name] > 1
        canonical = (
            "follow"
            if role_scoped_name == "mafiascum:follower:follow"
            and "mafiascum:follow" in fmarch["pack_actions"]
            else name
            if scoped_name in fmarch["pack_actions"]
            else fmarch["pack_action_source_ids"].get(
                role_scoped_name,
                "" if source_is_ambiguous else fmarch["pack_action_source_ids"].get(scoped_name, ""),
            )
        )
        modeled = bool(canonical)
        primitives = item.get("primitives") or []
        implemented = modeled
        pack_goldens = fmarch["golden_text_by_pack"].get(item["culture"], "")
        golden = modeled and (
            name.lower() in pack_goldens or canonical.lower() in pack_goldens
        )
        notes = ",".join(primitives)
        if f"{item['culture']}:{canonical}" in fmarch["pack_standard_nar_kill_cause_ids"]:
            notes = append_note(notes, "standard-NAR kill cause catalog")
        if f"{item['culture']}:{canonical}" in fmarch["pack_action_alignment_failback"]:
            notes = append_note(notes, "alignment_failback")
        rows.append(
            row(
                "action_id",
                f"{item['culture']}:{name}",
                canonical,
                1,
                modeled,
                implemented,
                golden,
                modeled and "ActionSubmitted" in commands,
                notes,
            )
        )

    for item in inventory["test_families"]:
        coverage = TEST_FAMILY_COVERAGE.get(item["name"], {})
        rows.append(
            row(
                "test_family",
                item["name"],
                coverage.get("canonical", ""),
                item["test_count"],
                coverage.get("modeled", False),
                coverage.get("implemented", False),
                coverage.get("golden", False),
                coverage.get("integrated", False),
                append_note(
                    f"example {item['example']}",
                    coverage.get("notes", "missing fmarch test-family coverage mapping"),
                ),
            )
        )

    for item in inventory["culture_notes"]:
        canonical = CULTURE_NOTE_MAP.get(item["name"], "")
        pack_policy_key = f"{item['name'].split(':', 1)[0]}:{canonical}" if canonical else ""
        modeled = bool(
            canonical
            and (
                canonical in fmarch["ir"]
                or canonical in fmarch["pack_abilities"]
                or canonical in fmarch["events"]
                or pack_policy_key in fmarch["pack_policies"]
                or item["name"] in fmarch["pack_policies"]
            )
        )
        implemented = bool(
            canonical
            and (
                f"IrAbility::{canonical}" in resolver
                or f"InnerEvent::{canonical}" in resolver
                or canonical in resolver
                or pack_policy_key in fmarch["pack_policies"]
                or item["name"] in fmarch["pack_policies"]
            )
        )
        golden = modeled and item["name"].split(":", 1)[-1].lower() in fmarch[
            "golden_text_by_pack"
        ].get(
            item["name"].split(":", 1)[0],
            "",
        )
        integrated = modeled and "Command::ResolvePhase" in commands
        notes = item["note"].replace("|", "/")
        if item["name"] == "chinese_structured:witch":
            note_lower = notes.lower()
            witch_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            if "heal potion" in note_lower:
                canonical = "heal_potion"
                modeled = (
                    '"id": "heal_potion"' in fmarch["pack_text"]
                    and '"ability": "Protect"' in fmarch["pack_text"]
                    and '"self_allowed": true' in fmarch["pack_text"]
                    and '"x_shots": 1' in fmarch["pack_text"]
                    and '"witch_heal_action_ids": ["heal_potion"]' in fmarch["pack_text"]
                )
                implemented = (
                    modeled
                    and "IrAbility::Protect" in resolver
                    and "ActionUseCounted" in resolver
                    and "action_use_counted" in resolver
                )
                golden = modeled and all(
                    fixture in witch_golden_names
                    for fixture in [
                        "witch_heal_potion_protects_wolf_kill",
                        "guard_witch_double_save_succeeds",
                    ]
                )
                integrated = (
                    implemented
                    and "host_resolve_phase_carries_guard_witch_double_save_policy"
                    in command_tests
                )
                notes = (
                    notes
                    + " fmarch models heal_potion as a one-shot reflexive Protect and proves wolf-kill prevention plus Guard/Witch double-save; a distinct Witch-specific night-one policy is not modeled separately from action windows."
                )
            elif "poison potion" in note_lower:
                canonical = "poison_potion+guard_policy"
                modeled = (
                    '"id": "poison_potion"' in fmarch["pack_text"]
                    and '"ability": "Kill"' in fmarch["pack_text"]
                    and '"x_shots": 1' in fmarch["pack_text"]
                    and '"guard_blockable_causes": ["poison_potion"]' in fmarch["pack_text"]
                    and '"same_target_witch": "NoDeath"' in fmarch["pack_text"]
                )
                implemented = (
                    modeled
                    and "ActionUseCounted" in resolver
                    and "protection_blocks_cause" in resolver
                    and "apply_guard_witch_same_target_policy" in resolver
                    and "GuardWitchSameTargetPolicy" in resolver
                )
                golden = modeled and all(
                    fixture in witch_golden_names
                    for fixture in [
                        "witch_heal_does_not_block_poison",
                        "guard_blocks_witch_poison",
                        "witch_poison_triggers_wolf_beauty_drag",
                        "hunter_poison_suppresses_retaliation",
                        "cupid_lovers_poison_cascade",
                    ]
                )
                integrated = implemented and all(
                    selector in command_tests
                    for selector in [
                        "host_resolve_phase_carries_witch_poison_beauty_drag",
                        "host_resolve_phase_carries_guard_witch_poison_policy",
                        "host_resolve_phase_carries_chinese_hunter_poison_policy",
                    ]
                )
                notes = (
                    notes
                    + " fmarch models poison_potion as a one-shot Kill and guard_policy defines the Guard-blocked poison plus Guard/Witch timing behavior."
                )
        if item["name"] == "chinese_structured:knight":
            knight_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            modeled = (
                '"id": "knight_duel"' in fmarch["pack_text"]
                and '"ability": "Duel"' in fmarch["pack_text"]
                and '"window": "Day"' in fmarch["pack_text"]
                and '"hostile_alignments": ["wolf"]' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "IrAbility::Duel" in resolver
                and "InnerEvent::DuelResolved" in resolver
                and "resolve_duel_actions" in resolver
            )
            golden = modeled and all(
                fixture in knight_golden_names
                for fixture in [
                    "knight_duel_success",
                    "knight_duel_failure",
                ]
            )
            integrated = implemented and all(
                selector in command_tests
                for selector in [
                    "host_resolve_phase_carries_knight_duel_death",
                    "host_resolve_phase_carries_knight_duel_failure_before_vote",
                    "generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically",
                ]
            )
            notes = (
                notes
                + " fmarch models this as Day-window Duel with hostile_alignment success/failure, resolves it before DayVoteOutcome, and folds duel deaths into slot_state/rebuild."
            )
        if item["name"] == "chinese_structured:sheriff_badge_helper":
            sheriff_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            modeled = (
                '"id": "sheriff_election"' in fmarch["pack_text"]
                and '"id": "sheriff_pass"' in fmarch["pack_text"]
                and '"id": "sheriff_destroy"' in fmarch["pack_text"]
                and '"ability": "Badge"' in fmarch["pack_text"]
                and '"operation": "Elect"' in fmarch["pack_text"]
                and '"operation": "Pass"' in fmarch["pack_text"]
                and '"operation": "Destroy"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "IrAbility::Badge" in resolver
                and "InnerEvent::BadgeChanged" in resolver
                and "resolve_badge_actions" in resolver
                and "active_badge_vote_weights" in resolver
            )
            golden = modeled and all(
                fixture in sheriff_golden_names
                for fixture in [
                    "sheriff_badge_election_weighted_vote",
                    "sheriff_badge_pass",
                    "sheriff_badge_destroy",
                ]
            )
            integrated = implemented and all(
                selector in command_tests
                for selector in [
                    "host_resolve_phase_carries_sheriff_badge_lifecycle",
                    "generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically",
                ]
            )
            notes = (
                notes
                + " fmarch models election/pass/destroy as Day-window Badge actions, folds BadgeChanged into sheriff_badge projection state, and removes destroyed badge vote weight before DayVoteOutcome."
            )
        if item["name"] == "chinese_structured:lovers_helper":
            lovers_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            modeled = (
                "chinese_structured:lover_policy" in fmarch["pack_policies"]
                and "chinese_structured:lovers_helper" in fmarch["pack_policies"]
                and '"link_effect": "lovers_link"' in fmarch["pack_text"]
                and '"suicide_cause": "lover_suicide"' in fmarch["pack_text"]
                and '"source_helper_role": "lovers_helper"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_lover_suicides" in resolver
                and "input.state.linked_slots" in resolver
                and "lover_policy" in resolver
                and "lover_suicide" in resolver
            )
            golden = modeled and all(
                fixture in lovers_golden_names
                for fixture in [
                    "cupid_lovers_death_cascade",
                    "cupid_lovers_lynch_cascade",
                    "cupid_lovers_poison_cascade",
                    "cupid_lovers_cascade_disabled",
                ]
            )
            integrated = implemented and all(
                selector in command_tests
                for selector in [
                    "host_resolve_phase_carries_chinese_cupid_link_and_lovers_cascade",
                    "host_resolve_phase_carries_chinese_lover_lynch_cascade",
                    "generated_chinese_structured_night_graphs_replay_audit_and_rebuild_deterministically",
                ]
            )
            notes = (
                notes
                + " fmarch keeps lovers_helper as lover_policy.source_helper_role metadata, while folded linked_slots drive night, day, poison, and disabled-cascade goldens plus Chinese command/rebuild cascades."
            )
        if item["name"] == "chinese_structured:wolf":
            wolf_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            canonical = "wolf_night_kill+coordinated_vote"
            modeled = (
                '"id": "wolf_night_kill"' in fmarch["pack_text"]
                and '"source_ids": ["night_kill"]' in fmarch["pack_text"]
                and '"ability": "Kill"' in fmarch["pack_text"]
                and '"faction_actions"' in fmarch["pack_text"]
                and '"action_id": "wolf_night_kill"' in fmarch["pack_text"]
                and '"alignment": "wolf"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "apply_faction_action_coordination" in resolver
                and "faction_vote_superseded" in resolver
                and "faction_vote_tie" in resolver
                and "FactionVoteTieBreaker::BlockAll" in resolver
            )
            golden = implemented and all(
                fixture in wolf_golden_names
                for fixture in [
                    "wolf_faction_vote_same_target_collapses_to_one_kill",
                    "wolf_faction_vote_tie_blocks_kill",
                ]
            )
            integrated = (
                golden
                and "host_resolve_phase_carries_chinese_wolf_faction_vote_policy"
                in command_tests
            )
            notes = (
                notes
                + " fmarch models the shared wolf_night_kill template, im-human night_kill source alias, and pack-declared single shared wolf kill coordination with BlockAll split-vote ties, proven through same-target and tied command/projection rebuild verticals."
            )
        if item["name"] == "chinese_structured:guard":
            guard_golden_names = fmarch["golden_names_by_pack"].get(
                "chinese_structured",
                set(),
            )
            modeled = (
                "chinese_structured:guard_policy" in fmarch["pack_policies"]
                and '"id": "night_guard"' in fmarch["pack_text"]
                and '"guard_self_allowed": true' in fmarch["pack_text"]
                and '"guard_night_one_allowed": true' in fmarch["pack_text"]
                and '"guard_blockable_causes": ["poison_potion"]' in fmarch["pack_text"]
                and '"same_target_witch": "NoDeath"' in fmarch["pack_text"]
            )
            implemented = (
                modeled
                and "protection_blocks_cause" in resolver
                and "apply_guard_witch_same_target_policy" in resolver
                and "GuardWitchSameTargetPolicy" in resolver
            )
            golden = modeled and all(
                fixture in guard_golden_names
                for fixture in [
                    "guard_blocks_witch_poison",
                    "guard_witch_double_save_succeeds",
                    "guard_self_save_night_one_allowed",
                    "guard_night_one_disabled",
                    "guard_self_save_disabled",
                    "guard_witch_same_target_kills",
                ]
            )
            integrated = implemented and all(
                selector in command_tests
                for selector in [
                    "host_resolve_phase_carries_guard_witch_poison_policy",
                    "host_resolve_phase_carries_guard_witch_double_save_policy",
                    "host_resolve_phase_carries_chinese_guard_self_save_night_one_policy",
                    "host_resolve_phase_carries_guard_witch_killtarget_policy",
                ]
            )
            notes = (
                notes
                + " fmarch models this with guard_policy: poison blocking, Guard/Witch same-target policy, self-save, and night-one toggles."
            )
        if (
            item["name"] == "chinese_structured:hunter"
            and "ImmediateBeforePhaseAnnouncement" in fmarch["pack_text"]
        ):
            notes = (
                notes
                + " fmarch declares ImmediateBeforePhaseAnnouncement timing for allowed chosen shots and emits no Hunter host prompt."
            )
        rows.append(
            row(
                "culture_note",
                item["name"],
                canonical,
                1,
                modeled,
                implemented,
                golden,
                integrated,
                notes,
            )
        )

    default_pack = "default_open"
    default_roles = {"citizen", "guardian", "seer", "agent"}
    default_actions = {
        "guardian_protect": "Protect",
        "seer_check": "Investigate",
        "agent_kill": "Kill",
    }
    modeled_pack = all(f"{default_pack}:{role}" in fmarch["pack_roles"] for role in default_roles)
    golden_pack = default_pack in fmarch["golden_text_by_pack"]
    integrated_pack = default_pack in command_tests
    rows.append(
        row(
            "fmarch_default_pack",
            default_pack,
            default_pack,
            0,
            modeled_pack,
            modeled_pack,
            golden_pack,
            integrated_pack,
            "Copyright-free default candidate; not sourced from im-human.",
        )
    )
    for action_id, ability in default_actions.items():
        modeled = f"{default_pack}:{action_id}" in fmarch["pack_actions"]
        implemented = modeled and f"IrAbility::{ability}" in resolver
        golden = golden_pack and action_id in fmarch["golden_text_by_pack"].get(default_pack, "")
        integrated = integrated_pack and action_id in command_tests
        rows.append(
            row(
                "fmarch_default_action",
                f"{default_pack}:{action_id}",
                ability,
                0,
                modeled,
                implemented,
                golden,
                integrated,
                "Copyright-free default candidate action; not sourced from im-human.",
            )
        )
    modeled_day_vote = fmarch["pack_vote_methods"].get(default_pack) == "Majority"
    implemented_day_vote = (
        modeled_day_vote
        and "VoteMethod::Majority" in resolver
        and "InnerEvent::DayVoteOutcome" in resolver
    )
    default_golden_text = fmarch["golden_text_by_pack"].get(default_pack, "")
    golden_day_vote = (
        golden_pack
        and "default open d01" in default_golden_text
        and "dayvoteoutcome" in default_golden_text
    )
    integrated_day_vote = (
        integrated_pack
        and "host_resolve_phase_carries_default_open_day_majority" in command_tests
        and "generated_default_open_day_replay_audit_and_rebuild_deterministically" in command_tests
    )
    rows.append(
        row(
            "fmarch_default_day_policy",
            f"{default_pack}:majority_day_vote",
            "DayVoteOutcome",
            0,
            modeled_day_vote,
            implemented_day_vote,
            golden_day_vote,
            integrated_day_vote,
            "Copyright-free default candidate D01 majority-elimination path; not sourced from im-human.",
        )
    )

    return sorted(rows, key=lambda r: (r["category"], r["item"]))


def write_inventory(path: Path, inventory: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(inventory, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_matrix(path: Path, rows: list[dict[str, Any]], inventory_path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# im-human Engine V4 parity matrix",
        "",
        "Generated by `tools/im_human_engine_inventory.py`. Keep this matrix source-derived:",
        "edit the script or Rust/pack evidence, then regenerate the file.",
        "",
        f"Inventory source: `{inventory_path.as_posix()}`.",
        "",
        "| Category | im-human item | Canonical fmarch | Sources | Unsupported | Modeled in pack | Implemented in resolver | Covered by golden | Integrated command/projection | Notes |",
        "|---|---|---|---:|---|---|---|---|---|---|",
    ]
    for row_data in rows:
        lines.append(
            "| {category} | `{item}` | {canonical} | {source_count} | {unsupported} | {modeled} | {implemented} | {golden} | {integrated} | {notes} |".format(
                category=row_data["category"],
                item=str(row_data["item"]).replace("|", "/"),
                canonical=f"`{row_data['canonical_fmarch']}`" if row_data["canonical_fmarch"] else "",
                source_count=row_data["source_count"],
                unsupported=mark(row_data["unsupported"]),
                modeled=mark(row_data["modeled_in_pack"]),
                implemented=mark(row_data["implemented_in_resolver"]),
                golden=mark(row_data["covered_by_golden"]),
                integrated=mark(row_data["integrated_command_projection"]),
                notes=str(row_data["notes"]).replace("|", "/"),
            )
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--im-human-root", default="/Users/fluffypro/apps/im-human")
    parser.add_argument("--fmarch-root", default=".")
    parser.add_argument("--inventory-out", default="docs/arch/im-human-engine-inventory.json")
    parser.add_argument("--matrix-out", default="docs/arch/im-human-engine-parity-matrix.md")
    args = parser.parse_args()

    im_root = find_im_human_root(Path(args.im_human_root))
    umbrella = im_root / "imhuman_umbrella"
    engine_root = umbrella / "apps/engine"
    catalog_root = umbrella / "catalog"
    fmarch_root = Path(args.fmarch_root).resolve()

    roles, actions, culture_notes = extract_catalog(catalog_root)
    inventory = {
        "source_root": str(im_root),
        "primitives": extract_primitives(engine_root),
        "modifiers": extract_modifiers(engine_root),
        "result_event_kinds": extract_result_event_kinds(im_root, engine_root),
        "day_steps": extract_day_steps(engine_root),
        "roles": roles,
        "actions": actions,
        "culture_notes": culture_notes,
        "test_families": extract_test_families(engine_root),
    }

    inventory_out = fmarch_root / args.inventory_out
    matrix_out = fmarch_root / args.matrix_out
    write_inventory(inventory_out, inventory)
    rows = build_matrix(inventory, load_fmarch_context(fmarch_root))
    write_matrix(matrix_out, rows, Path(args.inventory_out))

    print(f"wrote {inventory_out}")
    print(f"wrote {matrix_out}")
    print(f"matrix rows: {len(rows)}")


if __name__ == "__main__":
    main()
