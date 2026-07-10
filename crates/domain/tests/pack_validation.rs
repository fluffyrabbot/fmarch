use std::path::PathBuf;

use domain::pack::PhaseKind;
use domain::{
    load_pack_from_json, night_ability_order, upcast_pack_json, validate_pack, IrAbility, Pack,
};
use serde_json::{json, Value};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn load_pack_named(name: &str) -> Pack {
    let path = repo_root().join("packs").join(name).join("pack.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    serde_json::from_str(&raw).unwrap()
}

fn load_pack_raw(name: &str) -> String {
    let path = repo_root().join("packs").join(name).join("pack.json");
    std::fs::read_to_string(&path).unwrap()
}

fn pack_from_value(value: Value) -> Pack {
    serde_json::from_value(value).unwrap()
}

fn set_effect_policy(value: &mut Value, tag: &str, duration: &str, visibility: &str) {
    if !value["effects"].is_object() {
        value["effects"] = json!({});
    }
    value["effects"][tag] = json!({
        "duration": duration,
        "visibility": visibility
    });
}

fn valid_pack_value() -> Value {
    json!({
        "name": "testpack",
        "version": 1,
        "ir_version": 1,
        "roles": {
            "townie": {
                "description": "Town.",
                "alignment": "town",
                "actions": []
            },
            "cop": {
                "description": "Cop.",
                "alignment": "town",
                "actions": [{
                    "id": "investigate",
                    "ability": "Investigate",
                    "window": "Night",
                    "targets": "One",
                    "modifiers": [],
                    "constraints": {
                        "max_targets": 1,
                        "self_allowed": false,
                        "unique_targets": true,
                        "roleblockable": true,
                        "priority": 50
                    },
                    "mode": "Parity"
                }]
            },
            "cult_leader": {
                "description": "Cult leader.",
                "alignment": "cult",
                "actions": [{
                    "id": "convert",
                    "ability": "Convert",
                    "window": "Night",
                    "targets": "One",
                    "modifiers": [],
                    "constraints": {
                        "max_targets": 1,
                        "self_allowed": false,
                        "unique_targets": true,
                        "roleblockable": true,
                        "priority": 25
                    },
                    "effect": "cultist"
                }]
            },
            "cultist": {
                "description": "Cultist.",
                "alignment": "cult",
                "actions": []
            },
            "arsonist": {
                "description": "Arsonist.",
                "alignment": "mafia",
                "actions": [
                    {
                        "id": "douse",
                        "ability": "Mark",
                        "window": "Night",
                        "targets": "One",
                        "modifiers": [],
                        "constraints": {
                            "max_targets": 1,
                            "self_allowed": false,
                            "unique_targets": true,
                            "roleblockable": true,
                            "priority": 60
                        },
                        "effect": "doused"
                    },
                    {
                        "id": "ignite",
                        "ability": "Kill",
                        "window": "Night",
                        "targets": "None",
                        "modifiers": [],
                        "constraints": {
                            "max_targets": 0,
                            "self_allowed": false,
                            "unique_targets": true,
                            "roleblockable": true,
                            "priority": 30
                        },
                        "reads_effect": "doused"
                    }
                ]
            }
        },
        "precedence": [],
        "visibility": {},
        "redirects": {
            "order": [],
            "loop_cap": 8,
            "tie_breaker": "Stable"
        },
        "effects": {
            "doused": {
                "duration": "Persistent",
                "visibility": "ActorAndTarget"
            }
        },
        "conversion_policy": {
            "on_dead_target": "Block",
            "on_pending_death": "Block"
        },
        "triggers": [],
        "vote": {
            "method": "Plurality",
            "no_lynch_allowed": true,
            "self_vote_allowed": false,
            "hammer": false,
            "weights": "Equal",
            "threshold_adjustments": {},
            "tie_breaker": "NoElimination"
        },
        "phases": {
            "cadence": ["Day", "Night"],
            "subsegments": {},
            "twilight": false
        },
        "win": {
            "rules": [
                {
                    "winner": "town",
                    "when": { "FactionEliminated": "mafia" }
                },
                {
                    "winner": "mafia",
                    "when": { "FactionReachesParity": "mafia" }
                }
            ]
        }
    })
}

#[test]
fn shipped_packs_validate() {
    for name in [
        "mafiascum",
        "epicmafia",
        "chinese_structured",
        "mafia_universe",
        "default_open",
    ] {
        let pack = load_pack_named(name);
        validate_pack(&pack).unwrap_or_else(|err| panic!("{name} pack should validate: {err}"));
    }
}

#[test]
fn test_ita_buffered_pack_validates() {
    validate_pack(&load_pack_named("test_ita_buffered")).unwrap();
}

#[test]
fn death_reveal_policy_requires_v26_known_causes_and_effects() {
    let mut value = valid_pack_value();
    value["death_reveal"] = json!({
        "default": "Full",
        "by_cause": {
            "ignite": "Concealed",
            "missing_kill": "AlignmentOnly"
        },
        "by_effect": {
            "doused": "AlignmentOnly",
            "missing_effect": "Concealed"
        }
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "death_reveal", "requires ir_version >= 26");
    assert_issue(
        &err,
        "death_reveal.by_cause.missing_kill",
        "unknown kill cause",
    );
    assert_issue(
        &err,
        "death_reveal.by_effect.missing_effect",
        "unknown effect tag",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(26);
    value["death_reveal"] = json!({
        "default": "Full",
        "by_cause": {
            "ignite": "AlignmentOnly"
        },
        "by_effect": {
            "doused": "Concealed"
        }
    });
    validate_pack(&pack_from_value(value)).expect("known death reveal policy validates");
}

#[test]
fn valid_pack_fixture_validates() {
    validate_pack(&pack_from_value(valid_pack_value())).unwrap();
}

#[test]
fn pack_loader_upcasts_current_pack_before_validation() {
    let raw = serde_json::to_string(&valid_pack_value()).unwrap();
    let pack = load_pack_from_json(&raw).expect("current pack version should identity-upcast");
    assert_eq!(pack.version, domain::SUPPORTED_PACK_VERSION);
    assert_eq!(pack.name, "testpack");
    validate_pack(&pack).unwrap();
}

#[test]
fn pack_loader_migrates_v0_legacy_shape_fixture() {
    let raw = load_pack_raw("test_pack_v0_legacy_shape");
    assert!(
        serde_json::from_str::<Pack>(&raw).is_err(),
        "legacy fixture should not deserialize without the upcast boundary"
    );

    let pack = load_pack_from_json(&raw).expect("v0 legacy fixture should upcast and validate");
    assert_eq!(pack.version, domain::SUPPORTED_PACK_VERSION);
    assert_eq!(pack.ir_version, domain::MIN_SUPPORTED_IR_VERSION);
    assert_eq!(pack.name, "test_pack_v0_legacy_shape");
    assert!(pack.roles["mafia_goon"]
        .actions
        .iter()
        .any(|action| action.id == "factional_kill"));
    validate_pack(&pack).unwrap();
}

#[test]
fn pack_upcast_v0_renames_legacy_fields_without_decoding() {
    let raw = load_pack_raw("test_pack_v0_legacy_shape");
    let value: Value = serde_json::from_str(&raw).unwrap();
    let value = upcast_pack_json(value).expect("v0 fixture should upcast");
    assert_eq!(value["version"], json!(domain::SUPPORTED_PACK_VERSION));
    assert_eq!(value["ir_version"], json!(domain::MIN_SUPPORTED_IR_VERSION));
    assert!(value.get("vote_policy").is_none());
    assert!(value.get("phase_policy").is_none());
    assert!(value.get("action_order").is_none());
    assert!(value.get("vote").is_some());
    assert!(value.get("phases").is_some());
    assert!(value.get("precedence").is_some());
    assert!(value["roles"]["mafia_goon"]
        .get("action_templates")
        .is_none());
    assert!(value["roles"]["mafia_goon"].get("actions").is_some());
}

#[test]
fn pack_upcast_requires_version_field_before_decode() {
    let mut value = valid_pack_value();
    value.as_object_mut().unwrap().remove("version");
    let err = upcast_pack_json(value).unwrap_err();
    assert!(
        err.to_string().contains("version: missing required field"),
        "unexpected migration error: {err}"
    );
}

#[test]
fn pack_loader_rejects_pack_versions_without_registered_migration() {
    let mut value = valid_pack_value();
    value["version"] = json!(2);
    let raw = serde_json::to_string(&value).unwrap();
    let err = load_pack_from_json(&raw).unwrap_err();
    assert!(
        err.to_string().contains(
            "unsupported pack version 2; supported version is 1; no migration path is registered"
        ),
        "unexpected pack load error: {err}"
    );
}

#[test]
fn reflexive_modifier_matches_self_allowed_contract() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["self_allowed"] = json!(true);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "self_allowed actions must declare Reflexive",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Reflexive"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.self_allowed",
        "Reflexive actions must allow self-targeting",
    );
}

#[test]
fn personal_modifier_matches_personal_only_contract() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Personal"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.personal_only",
        "Personal actions must declare personal_only",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["personal_only"] = json!(true);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "personal_only actions must declare Personal",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Personal"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["personal_only"] = json!(true);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.self_allowed",
        "personal_only actions must allow self-targeting",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Reflexive", "Personal"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["self_allowed"] = json!(true);
    value["roles"]["cop"]["actions"][0]["constraints"]["personal_only"] = json!(true);
    value["roles"]["cop"]["actions"][0]["targets"] = json!("Many");
    value["roles"]["cop"]["actions"][0]["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "personal_only actions must target exactly one self slot",
    );
}

#[test]
fn disloyal_modifier_requires_targets_and_current_ir_version() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(56);
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Disloyal"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "Disloyal requires ir_version >= 57",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(57);
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Info");
    value["roles"]["cop"]["actions"][0]["targets"] = json!("None");
    value["roles"]["cop"]["actions"][0]["constraints"]["max_targets"] = json!(0);
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Disloyal"]);
    value["roles"]["cop"]["actions"][0]["info"] = json!({ "kind": "test_info" });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "Disloyal actions must target at least one slot",
    );
}

#[test]
fn lazy_modifier_matches_lazy_endgame_contract() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Lazy"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.lazy_requires_multiple_non_town",
        "Lazy actions must declare lazy_requires_multiple_non_town",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["lazy_requires_multiple_non_town"] =
        json!(true);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "lazy_requires_multiple_non_town actions must declare Lazy",
    );
}

#[test]
fn disabled_endgame_modifier_matches_alive_threshold_contract() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["DisabledEndgame"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.disabled_at_or_below_alive",
        "DisabledEndgame actions must declare disabled_at_or_below_alive",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["disabled_at_or_below_alive"] = json!(3);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "disabled_at_or_below_alive actions must declare DisabledEndgame",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["DisabledEndgame"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["disabled_at_or_below_alive"] = json!(0);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.disabled_at_or_below_alive",
        "disabled_at_or_below_alive must be greater than zero",
    );
}

#[test]
fn target_role_filter_is_strict_and_versioned() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(40);
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": []
    });
    value["roles"]["cop"]["actions"][0]["constraints"]["target_role_filter"] = json!("PowerRole");
    validate_pack(&pack_from_value(value)).expect("target role filter with role set validates");

    let mut value = valid_pack_value();
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": []
    });
    value["roles"]["cop"]["actions"][0]["constraints"]["target_role_filter"] = json!("PowerRole");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.target_role_filter",
        "target_role_filter requires ir_version >= 40",
    );
    assert_issue(&err, "ir_version", "target_role_filter");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(40);
    value["roles"]["cop"]["actions"][0]["constraints"]["target_role_filter"] = json!("PowerRole");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.target_role_filter",
        "requires investigation_results.role_sets.vanilla_roles",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(40);
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": []
    });
    value["roles"]["arsonist"]["actions"][1]["constraints"]["target_role_filter"] =
        json!("PowerRole");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.arsonist.actions[1].constraints.target_role_filter",
        "target_role_filter requires a targetful action",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].constraints.target_role_filter",
        "TargetSpec::None cannot declare target_role_filter",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(40);
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": []
    });
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Reflexive", "Personal"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["self_allowed"] = json!(true);
    value["roles"]["cop"]["actions"][0]["constraints"]["personal_only"] = json!(true);
    value["roles"]["cop"]["actions"][0]["constraints"]["target_role_filter"] = json!("PowerRole");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.target_role_filter",
        "target_role_filter is not legal on personal-only actions",
    );
}

#[test]
fn alignment_failback_is_strict_and_versioned() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(41);
    value["roles"]["cop"]["actions"][0] = json!({
        "id": "day_desperado",
        "ability": "Kill",
        "window": "Day",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": false,
            "priority": 60
        },
        "alignment_failback": {
            "hostile_alignments": ["mafia"]
        }
    });
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut old_ir = value.clone();
    old_ir["ir_version"] = json!(40);
    let err = validate_pack(&pack_from_value(old_ir)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].alignment_failback",
        "alignment_failback requires ir_version >= 41",
    );
    assert_issue(&err, "ir_version", "alignment_failback");

    let mut bad_alignment = value.clone();
    bad_alignment["roles"]["cop"]["actions"][0]["alignment_failback"]["hostile_alignments"] =
        json!(["aliens"]);
    let err = validate_pack(&pack_from_value(bad_alignment)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].alignment_failback.hostile_alignments",
        "unknown hostile alignment",
    );

    let mut empty = value.clone();
    empty["roles"]["cop"]["actions"][0]["alignment_failback"]["hostile_alignments"] = json!([]);
    let err = validate_pack(&pack_from_value(empty)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].alignment_failback.hostile_alignments",
        "must declare at least one hostile alignment",
    );

    let mut night = value.clone();
    night["roles"]["cop"]["actions"][0]["window"] = json!("Night");
    night["roles"]["cop"]["actions"][0]["constraints"]["priority"] = json!(30);
    validate_pack(&pack_from_value(night)).unwrap();

    let mut non_kill = value;
    non_kill["roles"]["cop"]["actions"][0]["ability"] = json!("Investigate");
    non_kill["roles"]["cop"]["actions"][0]["mode"] = json!("Parity");
    let err = validate_pack(&pack_from_value(non_kill)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].alignment_failback",
        "alignment_failback is only legal on Kill actions",
    );
}

#[test]
fn uncooperative_modifier_matches_setup_defined_feedback_contract() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Uncooperative"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.uncooperative_result",
        "Uncooperative actions must declare uncooperative_result",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["uncooperative_result"] = json!("ambiguous");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "uncooperative_result actions must declare Uncooperative",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Kill");
    value["roles"]["cop"]["actions"][0]["mode"] = json!(null);
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Uncooperative"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["uncooperative_result"] = json!("ambiguous");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.uncooperative_result",
        "uncooperative_result is only legal on Investigate actions",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["modifiers"] = json!(["Uncooperative"]);
    value["roles"]["cop"]["actions"][0]["constraints"]["uncooperative_result"] = json!(" ");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.uncooperative_result",
        "uncooperative_result must not be empty",
    );
}

#[test]
fn lost_role_modifier_matches_team_kill_contract() {
    let value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut malformed = value.clone();
    malformed["roles"]["lost_mafia_goon"]["alignment"] = json!("town");
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.lost_mafia_goon.alignment",
        "team-kill restricted role modifiers require mafia alignment",
    );

    let mut malformed = value.clone();
    malformed["roles"]["recluse_mafia_goon"]["alignment"] = json!("town");
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.recluse_mafia_goon.alignment",
        "team-kill restricted role modifiers require mafia alignment",
    );

    let mut malformed = value.clone();
    malformed["standard_nar"]["team_kill_action_ids"] = json!([]);
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.team_kill_action_ids",
        "team-kill restricted role modifiers require standard_nar.team_kill_action_ids",
    );

    let mut malformed = value.clone();
    malformed["roles"]["lost_mafia_goon"]["actions"] = json!([]);
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.lost_mafia_goon",
        "team-kill restricted role modifiers must expose a standard_nar team kill action",
    );

    let mut malformed = value.clone();
    malformed["roles"]["recluse_mafia_goon"]["actions"] = json!([]);
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.recluse_mafia_goon",
        "team-kill restricted role modifiers must expose a standard_nar team kill action",
    );

    let mut malformed = value;
    malformed["standard_nar"]["team_kill_action_ids"] = json!(["night_kill"]);
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.lost_mafia_goon",
        "team-kill restricted role modifiers must expose a standard_nar team kill action",
    );
    assert_issue(
        &err,
        "roles.recluse_mafia_goon",
        "team-kill restricted role modifiers must expose a standard_nar team kill action",
    );
}

#[test]
fn simultaneous_modifier_is_not_legal_on_team_kills() {
    let value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut malformed = value;
    malformed["roles"]["mafia_goon"]["actions"][0]["modifiers"] = json!(["Simultaneous"]);
    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "roles.mafia_goon.actions[0].modifiers",
        "Simultaneous actions must not be standard_nar team kills",
    );
}

#[test]
fn chinese_faction_action_policy_is_validated() {
    let value = serde_json::to_value(load_pack_named("chinese_structured")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut malformed = value;
    malformed["ir_version"] = json!(34);
    malformed["faction_actions"]["actions"] = json!([
        {
            "action_id": "wolf_night_kill",
            "alignment": "missing_faction",
            "max_resolved_submissions": 2,
            "target_tie": "BlockAll"
        },
        {
            "action_id": "wolf_night_kill",
            "alignment": "wolf",
            "max_resolved_submissions": 1,
            "target_tie": "BlockAll"
        },
        {
            "action_id": "day_self_destruct",
            "alignment": "wolf",
            "max_resolved_submissions": 1,
            "target_tie": "BlockAll"
        },
        {
            "action_id": "missing_faction_kill",
            "alignment": "wolf",
            "max_resolved_submissions": 1,
            "target_tie": "BlockAll"
        }
    ]);

    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(&err, "ir_version", "faction_actions");
    assert_issue(
        &err,
        "faction_actions",
        "enabled faction action policy requires ir_version >= 35",
    );
    assert_issue(
        &err,
        "faction_actions.actions[0].alignment",
        "unknown faction action alignment `missing_faction`",
    );
    assert_issue(
        &err,
        "faction_actions.actions[0].max_resolved_submissions",
        "faction action max_resolved_submissions must be 1",
    );
    assert_issue(
        &err,
        "faction_actions.actions[1].action_id",
        "duplicate faction action `wolf_night_kill`",
    );
    assert_issue(
        &err,
        "faction_actions.actions[2].action_id",
        "faction action `day_self_destruct` must be a night/any Kill action",
    );
    assert_issue(
        &err,
        "faction_actions.actions[3].action_id",
        "unknown faction action `missing_faction_kill`",
    );
}

#[test]
fn visibility_policy_is_strict_for_ninja_visit_hiding() {
    let mut value = valid_pack_value();
    value["visibility"]["Kill"] = json!({
        "sees": ["Result", "Result"],
        "unless_modifiers": ["Ninja", "Ninja"]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "visibility.Kill.sees",
        "Result visibility is currently supported only for Investigate",
    );
    assert_issue(&err, "visibility.Kill.sees", "duplicate field `Result`");
    assert_issue(
        &err,
        "visibility.Kill.unless_modifiers",
        "duplicate modifier `Ninja`",
    );

    let mut value = valid_pack_value();
    value["roles"]["ninja"] = json!({
        "description": "Ninja.",
        "alignment": "mafia",
        "actions": [{
            "id": "ninja_kill",
            "ability": "Kill",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Ninja"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 30
            }
        }]
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "visibility.Investigate",
        "Ninja actions require Investigate visibility policy",
    );

    value["visibility"]["Investigate"] = json!({
        "sees": ["Result"],
        "unless_modifiers": []
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "visibility.Investigate.unless_modifiers",
        "Ninja actions require Investigate visibility unless_modifiers Ninja",
    );
    assert_issue(
        &err,
        "visibility.Investigate.sees",
        "Ninja visit hiding requires Investigate visibility to expose TargetId",
    );

    value["visibility"]["Investigate"] = json!({
        "sees": ["TargetId", "Result"],
        "unless_modifiers": ["Ninja"]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn investigation_overrides_require_result_visibility_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["visibility"]["Investigate"]["sees"] = json!(["TargetId"]);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "visibility.Investigate.sees",
        "investigation_overrides require Investigate visibility to expose Result",
    );

    value["visibility"]
        .as_object_mut()
        .unwrap()
        .remove("Investigate");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "visibility.Investigate",
        "investigation_overrides require Investigate visibility policy",
    );
}

#[test]
fn win_policy_rules_must_award_the_matching_faction_shape() {
    let mut value = valid_pack_value();
    value["win"]["rules"] = json!([
        {
            "winner": "mafia",
            "when": { "FactionEliminated": "mafia" }
        },
        {
            "winner": "town",
            "when": { "FactionReachesParity": "mafia" }
        },
        {
            "winner": "mafia",
            "when": { "AllOtherFactionsEliminated": "town" }
        }
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "win.rules[0].winner",
        "FactionEliminated rules must not award the eliminated faction",
    );
    assert_issue(
        &err,
        "win.rules[1].winner",
        "FactionReachesParity rules must award the parity faction",
    );
    assert_issue(
        &err,
        "win.rules[2].winner",
        "AllOtherFactionsEliminated rules must award the surviving faction",
    );
}

#[test]
fn win_policy_rules_must_not_duplicate_terminal_conditions() {
    let mut value = valid_pack_value();
    value["win"]["rules"] = json!([
        {
            "winner": "town",
            "when": { "FactionEliminated": "mafia" }
        },
        {
            "winner": "town",
            "when": { "FactionEliminated": "mafia" }
        }
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "win.rules[1].when",
        "duplicate win condition `FactionEliminated(mafia)`",
    );
}

#[test]
fn survival_win_awards_require_v63_role_refs_and_source_event_shape() {
    let mut value = valid_pack_value();
    value["win"]["survival_awards"] = json!([
        {
            "id": "survivor",
            "winner": "",
            "eligible_roles": ["missing_survivor", ""],
            "source_event": "survivor"
        },
        {
            "id": "survivor",
            "winner": "survivor",
            "eligible_roles": []
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "win.survival_awards[0]",
        "survival awards require ir_version >= 63",
    );
    assert_issue(
        &err,
        "win.survival_awards[0].winner",
        "winner must not be empty",
    );
    assert_issue(
        &err,
        "win.survival_awards[0].eligible_roles",
        "unknown eligible role `missing_survivor`",
    );
    assert_issue(
        &err,
        "win.survival_awards[0].source_event",
        "source_event must be a win.* result event string",
    );
    assert_issue(
        &err,
        "win.survival_awards[1].id",
        "duplicate survival award id `survivor`",
    );
    assert_issue(
        &err,
        "win.survival_awards[1].eligible_roles",
        "survival award must declare eligible_roles",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(63);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["roles"]["survivor"] = json!({
        "description": "Survivor.",
        "alignment": "independent",
        "actions": []
    });
    value["win_families"] = json!(["FactionElimination", "FactionParity", "SurvivalIndependent"]);
    value["win"]["survival_awards"] = json!([
        {
            "id": "survivor",
            "winner": "survivor",
            "eligible_roles": ["survivor"],
            "source_event": "win.survivor"
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn win_rule_alive_blockers_are_strict_and_versioned() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(52);
    value["roles"]["serial_killer"] = json!({
        "description": "Independent test killer.",
        "alignment": "independent",
        "actions": []
    });
    value["win"]["rules"][1]["blocked_by_alive"] = json!(["independent"]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "ir_version", "requiring ir_version >= 53");
    assert_issue(&err, "ir_version", "win_rule_blockers");

    value["ir_version"] = json!(53);
    value["win"]["rules"][1]["blocked_by_alive"] =
        json!(["independent", "independent", "ghost", "mafia"]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "win.rules[1].blocked_by_alive",
        "duplicate win rule blocker `independent`",
    );
    assert_issue(
        &err,
        "win.rules[1].blocked_by_alive",
        "unknown alignment `ghost`",
    );
    assert_issue(
        &err,
        "win.rules[1].blocked_by_alive",
        "win rule blockers must not include the winning alignment",
    );
}

#[test]
fn win_families_are_strict_and_versioned() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(45);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >=",
    );
    assert_issue(&err, "win_families", "requires ir_version >= 46");

    value["ir_version"] = json!(47);
    value["win_families"]
        .as_array_mut()
        .unwrap()
        .retain(|family| family != "TargetLynchIndependent");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "win_families",
        "must include `TargetLynchIndependent`",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["win_families"]
        .as_array_mut()
        .unwrap()
        .push(json!("FactionParity"));
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "win_families", "duplicate win family `FactionParity`");

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["self_lynch_win_policies"] = json!([]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "win_families",
        "declared win family `SelfLynchIndependent` has no matching policy surface",
    );
}

#[test]
fn phase_policy_shape_is_strict() {
    let mut value = valid_pack_value();
    value["phases"] = json!({
        "cadence": ["Day", "Day", "Twilight"],
        "subsegments": {
            "Day": ["main", "main", "", "Bad-Step"],
            "Night": ["actions"],
            "Twilight": []
        },
        "twilight": false
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "phases.cadence", "duplicate phase kind `Day`");
    assert_issue(
        &err,
        "phases.cadence",
        "Twilight cadence requires phases.twilight = true",
    );
    assert_issue(
        &err,
        "phases.subsegments.Night",
        "subsegments declared for absent phase kind `Night`",
    );
    assert_issue(
        &err,
        "phases.subsegments.Twilight",
        "subsegments must declare at least one step",
    );
    assert_issue(
        &err,
        "phases.subsegments.Day[1]",
        "duplicate subsegment `main`",
    );
    assert_issue(
        &err,
        "phases.subsegments.Day[2]",
        "subsegment names must not be empty",
    );
    assert_issue(
        &err,
        "phases.subsegments.Day[3]",
        "lowercase snake_case ASCII",
    );

    let mut value = valid_pack_value();
    value["phases"]["twilight"] = json!(true);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "phases.twilight",
        "twilight requires Twilight in phases.cadence",
    );
}

#[test]
fn twilight_action_window_is_strict_and_versioned() {
    let mut value: Value = serde_json::from_str(&load_pack_raw("test_twilight_window")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(47);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "ir_version", "Twilight action window");

    let mut value: Value = serde_json::from_str(&load_pack_raw("test_twilight_window")).unwrap();
    value["phases"]["cadence"] = json!(["Day", "Night"]);
    value["phases"]["twilight"] = json!(false);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "roles.twilight_self_destructor.actions[0].window",
        "action window Twilight is absent from phases.cadence",
    );

    let mut value: Value = serde_json::from_str(&load_pack_raw("test_twilight_window")).unwrap();
    value["roles"]["twilight_self_destructor"]["actions"][0]["constraints"]["active_from"] = json!({
        "phase_kind": "Night",
        "phase_number": 1,
        "reason": "Activated"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.twilight_self_destructor.actions[0].constraints.active_from.phase_kind",
        "active_from.phase_kind must match the action window",
    );
}

#[test]
fn instant_action_window_is_strict_and_versioned() {
    let mut value: Value = serde_json::from_str(&load_pack_raw("test_instant_window")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(48);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "ir_version", "Instant action window");

    let mut value: Value = serde_json::from_str(&load_pack_raw("test_instant_window")).unwrap();
    value["phases"]["cadence"] = json!(["Day"]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value: Value = serde_json::from_str(&load_pack_raw("test_instant_window")).unwrap();
    value["roles"]["instant_self_destructor"]["actions"][0]["window"] = json!("Night");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.instant_self_destructor.actions[0].window",
        "Day, Twilight, or Instant window",
    );
}

#[test]
fn shipped_pack_night_order_is_pack_derived() {
    let mafiascum = load_pack_named("mafiascum");
    assert_eq!(
        night_ability_order(&mafiascum).unwrap(),
        vec![
            IrAbility::Block,
            IrAbility::Redirect,
            IrAbility::Protect,
            IrAbility::Mark,
            IrAbility::Clear,
            IrAbility::Link,
            IrAbility::Grant,
            IrAbility::Retaliate,
            IrAbility::Kill,
            IrAbility::Convert,
            IrAbility::Investigate,
            IrAbility::Visit,
            IrAbility::Info,
        ]
    );

    let epicmafia = load_pack_named("epicmafia");
    assert_eq!(
        night_ability_order(&epicmafia).unwrap(),
        vec![
            IrAbility::Block,
            IrAbility::Protect,
            IrAbility::Mark,
            IrAbility::Kill,
            IrAbility::Convert,
            IrAbility::Investigate,
        ]
    );

    let chinese_structured = load_pack_named("chinese_structured");
    assert_eq!(
        night_ability_order(&chinese_structured).unwrap(),
        vec![
            IrAbility::Link,
            IrAbility::Protect,
            IrAbility::Mark,
            IrAbility::Kill,
            IrAbility::Retaliate,
            IrAbility::Investigate,
        ]
    );

    let default_open = load_pack_named("default_open");
    assert_eq!(
        night_ability_order(&default_open).unwrap(),
        vec![IrAbility::Protect, IrAbility::Kill, IrAbility::Investigate]
    );
}

#[test]
fn night_order_reacts_to_pack_priorities_and_precedence_edges() {
    let mut value = valid_pack_value();
    let base_pack = pack_from_value(value.clone());
    validate_pack(&base_pack).unwrap();
    assert_eq!(
        night_ability_order(&base_pack).unwrap(),
        vec![
            IrAbility::Mark,
            IrAbility::Investigate,
            IrAbility::Kill,
            IrAbility::Convert,
        ]
    );

    value["roles"]["cult_leader"]["actions"][0]["constraints"]["priority"] = json!(70);
    let priority_pack = pack_from_value(value.clone());
    validate_pack(&priority_pack).unwrap();
    assert_eq!(
        night_ability_order(&priority_pack).unwrap(),
        vec![
            IrAbility::Convert,
            IrAbility::Mark,
            IrAbility::Investigate,
            IrAbility::Kill,
        ]
    );

    value["precedence"] = json!([{
        "id": "kill_blocks_conversion",
        "when": { "effect": "Kill", "target_state": null },
        "beats": ["Convert"],
        "blocked_by": [],
        "unless_modifiers": []
    }]);
    let precedence_pack = pack_from_value(value);
    validate_pack(&precedence_pack).unwrap();
    assert_eq!(
        night_ability_order(&precedence_pack).unwrap(),
        vec![
            IrAbility::Mark,
            IrAbility::Investigate,
            IrAbility::Kill,
            IrAbility::Convert,
        ]
    );
}

#[test]
fn precedence_order_contract_fixture_is_valid_and_non_legacy() {
    let pack = load_pack_named("test_precedence_order_contract");
    validate_pack(&pack).unwrap();
    assert_eq!(
        night_ability_order(&pack).unwrap(),
        vec![IrAbility::Kill, IrAbility::Protect]
    );
}

#[test]
fn guard_witch_killtarget_fixture_is_valid_and_non_legacy() {
    let pack = load_pack_named("test_guard_witch_killtarget");
    validate_pack(&pack).unwrap();
    assert_eq!(pack.ir_version, 46);
    assert!(pack.guard_policy.enabled);
}

#[test]
fn skip_next_day_day_only_fixture_is_valid_and_non_legacy() {
    let pack = load_pack_named("test_skip_next_day_day_only");
    validate_pack(&pack).unwrap();
    assert_eq!(pack.ir_version, 46);
    assert_eq!(pack.phases.cadence, vec![PhaseKind::Day]);
}

#[test]
fn invalid_versions_are_rejected() {
    let mut value = valid_pack_value();
    value["version"] = json!(2);
    value["ir_version"] = json!(domain::SUPPORTED_IR_VERSION + 1);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "version", "unsupported pack version 2");
    assert_issue(
        &err,
        "ir_version",
        &format!(
            "unsupported IR version {}",
            domain::SUPPORTED_IR_VERSION + 1
        ),
    );
}

#[test]
fn unsupported_version_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_unsupported_ir_version");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(&err, "version", "unsupported pack version 2");
    assert_issue(&err, "ir_version", "unsupported IR version 69");
}

#[test]
fn pack_ir_version_must_cover_declared_additive_features() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(24);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 68",
    );
    assert_issue(
        &err,
        "ir_version",
        "beloved_princess_policy.all_death_causes",
    );
    assert_issue(&err, "ir_version", "private_channels");
    assert_issue(&err, "ir_version", "private_channels.excluded_roles");
    assert_issue(&err, "ir_version", "Simultaneous");
    assert_issue(&err, "ir_version", "role_modifiers");
    assert_issue(&err, "ir_version", "death_reveal");
    assert_issue(&err, "ir_version", "win.survival_awards");
    assert_issue(&err, "ir_version", "self_lynch_win_policies");
    assert_issue(&err, "ir_version", "Rotate");
    assert_issue(&err, "ir_version", "win_rule_blockers");
    assert_issue(&err, "ir_version", "Info");
    assert_issue(
        &err,
        "ir_version",
        "visitor role/identity investigation modes",
    );
    assert_issue(&err, "ir_version", "vote.tiebreaker_roles");
    assert_issue(&err, "ir_version", "Disloyal");
    assert_issue(&err, "ir_version", "backup_policy.priority");
}

#[test]
fn action_field_combinations_are_strict() {
    let mut value = valid_pack_value();
    let actions = value["roles"]["arsonist"]["actions"]
        .as_array_mut()
        .unwrap();
    actions[0]["effect"] = Value::Null;
    actions[1]["reads_effect"] = Value::Null;
    actions[1]["mode"] = json!("Parity");
    actions[1]["effect"] = json!("doused");
    actions[1]["redirect"] = json!("Swap");
    actions[1]["effect_duration"] = json!("Resolution");
    actions[1]["constraints"]["max_targets"] = json!(1);
    actions[1]["constraints"]["target_state"] = json!("Dead");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.arsonist.actions[0].effect",
        "must declare effect",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].mode",
        "only legal on Investigate",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].effect",
        "only legal on Mark",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].redirect",
        "only legal on Redirect",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].effect_duration",
        "only legal on Mark",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].constraints.max_targets",
        "TargetSpec::None requires max_targets = 0",
    );
    assert_issue(
        &err,
        "roles.arsonist.actions[1].constraints.target_state",
        "TargetSpec::None requires target_state = Any",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["x_shots"] = json!(2);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["target_state"] = json!("Dead");
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["cooldown_cycles"] = json!(0);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.cooldown_cycles",
        "cooldown_cycles must be greater than zero",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["active_from"] = json!({
        "phase_kind": "Night",
        "phase_number": 0,
        "reason": "Novice"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.active_from.phase_number",
        "active_from.phase_number must be greater than zero",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["active_from"] = json!({
        "phase_kind": "Day",
        "phase_number": 2,
        "reason": "Activated"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.active_from.phase_kind",
        "active_from.phase_kind must match the action window",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["cycle_parity"] = json!("Odd");
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["constraints"]["phase_parity"] = json!("Odd");
    value["roles"]["cop"]["actions"][0]["constraints"]["cycle_parity"] = json!("Even");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].constraints.cycle_parity",
        "cycle_parity must not be combined with phase_parity",
    );
}

#[test]
fn info_action_field_combinations_are_strict() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(54);
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Info");
    value["roles"]["cop"]["actions"][0]["mode"] = Value::Null;

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].info",
        "Info actions must declare info",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["info"] = json!({ "kind": "observe" });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].info",
        "info is only legal on Info actions",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(54);
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Info");
    value["roles"]["cop"]["actions"][0]["mode"] = Value::Null;
    value["roles"]["cop"]["actions"][0]["info"] = json!({
        "kind": "",
        "audience": "Target"
    });
    value["roles"]["cop"]["actions"][0]["targets"] = json!("None");
    value["roles"]["cop"]["actions"][0]["constraints"]["max_targets"] = json!(0);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].info.kind",
        "info kind must not be empty",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].info.audience",
        "target-audience Info actions require targets",
    );
}

#[test]
fn invalid_action_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_action_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "roles.malformed_investigator.actions[0].mode",
        "Investigate actions must declare mode",
    );
    assert_issue(
        &err,
        "roles.malformed_investigator.actions[1].mode",
        "mode is only legal on Investigate actions",
    );
}

#[test]
fn invalid_effect_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_effect_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "roles.malformed_effect_user.actions[0].effect",
        "Mark/Clear actions must declare effect",
    );
    assert_issue(
        &err,
        "roles.malformed_effect_user.actions[1].effect",
        "effect is only legal on Mark, Clear, Convert, and Link actions",
    );
    assert_issue(
        &err,
        "roles.malformed_effect_user.actions[2].reads_effect",
        "reads_effect is only legal on Kill actions",
    );
}

#[test]
fn invalid_target_window_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_target_window_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "roles.malformed_target_window_user.actions[0].window",
        "action window Night is absent from phases.cadence",
    );
    assert_issue(
        &err,
        "roles.malformed_target_window_user.actions[1].constraints.max_targets",
        "TargetSpec::None requires max_targets = 0",
    );
    assert_issue(
        &err,
        "roles.malformed_target_window_user.actions[1].constraints.target_state",
        "TargetSpec::None requires target_state = Any",
    );
}

#[test]
fn invalid_reference_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_reference_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "roles.malformed_reference_user.actions[0].reads_effect",
        "unknown effect tag `missing_effect`",
    );
    assert_issue(
        &err,
        "investigation_results.parity.alignment_results.missing_alignment",
        "unknown alignment `missing_alignment`",
    );
    assert_issue(
        &err,
        "guard_policy.guard_action_ids",
        "unknown guard action `missing_guard`",
    );
    assert_issue(&err, "vote.weights", "unknown role `ghost_role`");
}

#[test]
fn invalid_trigger_reference_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_trigger_reference_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(&err, "triggers[0].if_target_has", "unknown effect tag");
    assert_issue(&err, "triggers[0].if_actor_has", "unknown effect tag");
    assert_issue(
        &err,
        "triggers[0].if_target_has",
        "trigger filter tags must not be empty",
    );
    assert_issue(
        &err,
        "triggers[0].if_actor_has",
        "trigger filter tags must not be empty",
    );
    assert_issue(
        &err,
        "triggers[0].if_target_has",
        "duplicate value `known_trigger_target`",
    );
    assert_issue(
        &err,
        "triggers[0].if_actor_has",
        "duplicate value `known_trigger_actor`",
    );
    assert_issue(&err, "triggers[1].id", "duplicate trigger id");
    assert_issue(
        &err,
        "triggers[1].produces.actor",
        "only support Actor or Target actor refs",
    );
    assert_issue(
        &err,
        "triggers[1].produces.target",
        "only support Actor, Target, or Killer target refs",
    );
    assert_issue(
        &err,
        "triggers[1].produces.ability",
        "support generated Kill or self-targeted Visit",
    );
    assert_issue(
        &err,
        "triggers[2].produces.modifiers",
        "only support Strongman modifier, got `Ninja`",
    );
    assert_issue(
        &err,
        "triggers[2].produces.modifiers",
        "duplicate generated Kill modifier `Strongman`",
    );
}

#[test]
fn invalid_win_policy_contract_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_win_policy_contract");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "win.rules[0].winner",
        "FactionEliminated rules must not award the eliminated faction",
    );
    assert_issue(
        &err,
        "win.rules[1].winner",
        "FactionReachesParity rules must award the parity faction",
    );
    assert_issue(
        &err,
        "win.rules[2].winner",
        "AllOtherFactionsEliminated rules must award the surviving faction",
    );
    assert_issue(
        &err,
        "win.rules[3].when",
        "duplicate win condition `FactionEliminated(mafia)`",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[1].eligible_roles",
        "duplicate target lynch win source `execution_target` for eligible role `executioner`",
    );
    assert_issue(
        &err,
        "self_lynch_win_policies[1].eligible_roles",
        "duplicate self lynch win source `win.jester` for eligible role `jester`",
    );
}

#[test]
fn source_action_ids_are_validated() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["source_ids"] = json!(["", "investigate", "legacy_scan", "legacy_scan"]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].source_ids",
        "source action ids must not be empty",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].source_ids",
        "source action id `investigate` duplicates canonical id",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].source_ids",
        "duplicate source action id `legacy_scan`",
    );
}

#[test]
fn investigation_result_policy_references_known_alignments_and_nonempty_labels() {
    let mut value = valid_pack_value();
    value["investigation_results"] = json!({
        "parity": {
            "town": "",
            "non_town": "",
            "alignment_results": {
                "missing": "mystery",
                "town": ""
            }
        }
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "investigation_results.parity.town",
        "town result label must not be empty",
    );
    assert_issue(
        &err,
        "investigation_results.parity.non_town",
        "non_town result label must not be empty",
    );
    assert_issue(
        &err,
        "investigation_results.parity.alignment_results.missing",
        "unknown alignment `missing`",
    );
    assert_issue(
        &err,
        "investigation_results.parity.alignment_results.town",
        "alignment result label must not be empty",
    );

    let mut value = valid_pack_value();
    value["investigation_results"] = json!({
        "parity": {
            "town": "good",
            "non_town": "evil",
            "alignment_results": {
                "town": "good",
                "mafia": "evil",
                "cult": "evil"
            }
        }
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn role_set_investigation_modes_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Vanilla");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie", "missing_role", "townie"],
        "gun_bearing_roles": ["missing_gun_role"],
        "killer_roles": ["missing_killer_role", "missing_killer_role"],
        "specialist_roles": ["missing_specialist_role", "missing_specialist_role"]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "role-set investigation modes require ir_version >= 36",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.vanilla_roles",
        "duplicate value `townie`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.vanilla_roles",
        "unknown vanilla role `missing_role`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.gun_bearing_roles",
        "unknown gun-bearing role `missing_gun_role`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.killer_roles",
        "duplicate value `missing_killer_role`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.killer_roles",
        "unknown killer role `missing_killer_role`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.specialist_roles",
        "duplicate value `missing_specialist_role`",
    );
    assert_issue(
        &err,
        "investigation_results.role_sets.specialist_roles",
        "unknown specialist role `missing_specialist_role`",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(36);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Gunsmith");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": ["cultist"],
        "specialist_roles": []
    });
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(49);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Killer");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": ["cultist"],
        "killer_roles": ["arsonist"],
        "specialist_roles": []
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "killer role-set investigation mode requires ir_version >= 50",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(50);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Killer");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": ["cultist"],
        "killer_roles": ["arsonist"],
        "specialist_roles": []
    });
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(50);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Specialist");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": ["cultist"],
        "killer_roles": ["arsonist"],
        "specialist_roles": ["cop"]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "specialist role-set investigation mode requires ir_version >= 51",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(51);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Specialist");
    value["investigation_results"]["role_sets"] = json!({
        "vanilla_roles": ["townie"],
        "gun_bearing_roles": ["cultist"],
        "killer_roles": ["arsonist"],
        "specialist_roles": ["cop"]
    });
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(51);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("PtAccess");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "PT access investigation mode requires ir_version >= 52",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(52);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("PtAccess");
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn role_disclosure_investigation_modes_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Role");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "role disclosure investigation modes require ir_version >= 37",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(37);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Role");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn full_role_disclosure_investigation_modes_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["mode"] = json!("FullRole");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "full role disclosure investigation modes require ir_version >= 38",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(38);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("FullRole");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn visitor_role_identity_investigation_modes_are_strict() {
    for mode in ["RoleWatcher", "RoleGuard", "SecurityGuard"] {
        let mut value = valid_pack_value();
        value["roles"]["cop"]["actions"][0]["mode"] = json!(mode);
        let err = validate_pack(&pack_from_value(value)).unwrap_err();
        assert_issue(
            &err,
            "roles.cop.actions[0].mode",
            "visitor role/identity investigation modes require ir_version >= 55",
        );

        let mut value = valid_pack_value();
        value["ir_version"] = json!(55);
        value["roles"]["cop"]["actions"][0]["mode"] = json!(mode);
        value["visibility_families"] = json!(["EffectAudiences"]);
        value["win_families"] = json!(["FactionElimination", "FactionParity"]);
        validate_pack(&pack_from_value(value)).unwrap();
    }
}

#[test]
fn voyeur_investigation_mode_is_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Voyeur");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "voyeur action investigation mode requires ir_version >= 56",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(56);
    value["roles"]["cop"]["actions"][0]["mode"] = json!("Voyeur");
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn effect_source_death_reveal_policy_is_strict() {
    let mut value = valid_pack_value();
    value["effect_source_death_reveals"] = json!([{
        "id": "oracle_reveal",
        "effect": "doused",
        "reveal": "Alignment"
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "effect_source_death_reveals",
        "effect source-death reveal policies require ir_version >= 57",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(57);
    value["effect_source_death_reveals"] = json!([
        {
            "id": "oracle_reveal",
            "effect": "missing_effect",
            "reveal": "Alignment"
        },
        {
            "id": "oracle_reveal",
            "effect": "doused",
            "reveal": "Alignment"
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "effect_source_death_reveals[0].effect",
        "unknown effect source-death reveal effect `missing_effect`",
    );
    assert_issue(
        &err,
        "effect_source_death_reveals[1].id",
        "duplicate effect source-death reveal policy `oracle_reveal`",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(57);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["effect_source_death_reveals"] = json!([{
        "id": "oracle_reveal",
        "effect": "doused",
        "reveal": "Alignment"
    }]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(57);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["effect_source_death_reveals"] = json!([{
        "id": "role_oracle_reveal",
        "effect": "doused",
        "reveal": "Role"
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "effect_source_death_reveals[0].reveal",
        "effect source-death role reveal policies require ir_version >= 58",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(58);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["effect_source_death_reveals"] = json!([{
        "id": "role_oracle_reveal",
        "effect": "doused",
        "reveal": "Role"
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn investigation_result_memory_is_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": true,
        "compare_previous": true
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].result_memory",
        "result_memory requires ir_version >= 23",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(23);
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": false,
        "compare_previous": false
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].result_memory",
        "result_memory must enable record or compare_previous",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(23);
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Protect");
    value["roles"]["cop"]["actions"][0]["mode"] = Value::Null;
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": true,
        "compare_previous": true
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].result_memory",
        "result_memory is only legal on Investigate actions",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(23);
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": true,
        "compare_previous": true
    });
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(38);
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": true,
        "compare_previous": true,
        "scope": "Investigator",
        "output": "SameDifferent"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].result_memory",
        "investigator-scoped or same/different result memory requires ir_version >= 39",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(39);
    value["roles"]["cop"]["actions"][0]["result_memory"] = json!({
        "record": true,
        "compare_previous": true,
        "scope": "Investigator",
        "output": "SameDifferent"
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn visit_history_ir_is_strict() {
    let mut value = valid_pack_value();
    value["roles"]["visitor"] = json!({
        "description": "Visitor.",
        "alignment": "town",
        "actions": [{
            "id": "visit",
            "ability": "Visit",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 45
            }
        }]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.visitor.actions[0].ability",
        "Visit requires ir_version >= 24",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["mode"] = json!("PriorMotion");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].mode",
        "PriorMotion requires ir_version >= 24",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["visitor"] = json!({
        "description": "Visitor.",
        "alignment": "town",
        "actions": [{
            "id": "visit",
            "ability": "Visit",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 45
            }
        }]
    });
    value["roles"]["cop"]["actions"][0]["mode"] = json!("PriorMotion");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn pgo_visit_trigger_contract_is_strict() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["paranoid_gun_owner"] = json!({
        "description": "Paranoid Gun Owner.",
        "alignment": "town",
        "actions": [],
        "effects": ["pgo"]
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "pgo effects require a Visit trigger that produces Kill from Target to Actor",
    );

    value["triggers"] = json!([{
        "id": "pgo_shoots_visitor",
        "on": "Visit",
        "if_target_has": ["pgo"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn kill_retaliation_trigger_contracts_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["bomb"] = json!({
        "description": "Bomb.",
        "alignment": "town",
        "actions": [],
        "effects": ["bomb"]
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "bomb effects require a Kill trigger that produces Kill from Target to Killer",
    );

    value["triggers"] = json!([{
        "id": "bomb_retaliates",
        "on": "Kill",
        "if_target_has": ["bomb"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Killer",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["roles"]["vengeful_townie"] = json!({
        "description": "Vengeful Townie.",
        "alignment": "town",
        "actions": [],
        "effects": ["vengeful"]
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "vengeful effects require a Kill trigger that produces Kill from Target to Actor",
    );
    value["triggers"] = json!([{
        "id": "vengeful_retaliates",
        "on": "Kill",
        "if_target_has": ["vengeful"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["roles"]["unstoppable_vengeful_townie"] = json!({
        "description": "Unstoppable Vengeful Townie.",
        "alignment": "town",
        "actions": [],
        "effects": ["unstoppable_vengeful"]
    });
    value["triggers"] = json!([{
        "id": "unstoppable_vengeful_retaliates",
        "on": "Kill",
        "if_target_has": ["unstoppable_vengeful"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "unstoppable_vengeful effects require a Kill trigger that produces Strongman Kill from Target to Actor",
    );
    value["triggers"][0]["produces"]["modifiers"] = json!(["Strongman"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn lynch_retaliation_trigger_contracts_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["super_saint"] = json!({
        "description": "Super-Saint.",
        "alignment": "town",
        "actions": [],
        "effects": ["super_saint"]
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "super_saint effects require a Lynch trigger that produces Kill from Target to Actor",
    );

    value["triggers"] = json!([{
        "id": "super_saint_retaliates",
        "on": "Lynch",
        "if_target_has": ["super_saint"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn hero_vote_duel_trigger_contract_is_strict() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["triggers"]
        .as_array_mut()
        .unwrap()
        .retain(|trigger| trigger["id"] != "hero_instigator_kill");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "hero effects require a VoteDuel trigger that produces Strongman Kill from Target to Actor",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    let trigger = value["triggers"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|trigger| trigger["id"] == "hero_instigator_kill")
        .unwrap();
    trigger["produces"]["modifiers"] = json!([]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "triggers",
        "hero effects require a VoteDuel trigger that produces Strongman Kill from Target to Actor",
    );
}

#[test]
fn visitor_kill_requires_target_filtered_policy() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["selective_visit_killer"] = json!({
        "description": "Selective visit killer.",
        "alignment": "town",
        "actions": [],
        "effects": ["visitor_kill"]
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "triggers", "target-filtered Visit trigger");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["selective_visit_killer"] = json!({
        "description": "Selective visit killer.",
        "alignment": "town",
        "actions": [],
        "effects": ["visitor_kill"]
    });
    value["triggers"] = json!([{
        "id": "visitor_kill_marked_visitor",
        "on": "Visit",
        "if_target_has": ["visitor_kill"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "triggers", "target-filtered Visit trigger");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["selective_visit_killer"] = json!({
        "description": "Selective visit killer.",
        "alignment": "town",
        "actions": [],
        "effects": ["visitor_kill"]
    });
    value["roles"]["visitor_kill_target_visitor"] = json!({
        "description": "Marked visitor.",
        "alignment": "town",
        "actions": [],
        "effects": ["visitor_kill_target"]
    });
    value["triggers"] = json!([{
        "id": "visitor_kill_marked_visitor",
        "on": "Visit",
        "if_target_has": ["visitor_kill"],
        "if_actor_has": ["visitor_kill_target"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Actor",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn effect_policy_tags_are_strict() {
    let mut value = valid_pack_value();
    value["effects"] = json!({
        "": { "duration": "Persistent", "visibility": "Hidden" }
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "effects", "effect policy tags must not be empty");
}

#[test]
fn standard_nar_empower_effects_are_strict() {
    let mut value = serde_json::to_value(load_pack_named("mafia_universe")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["empower_effects"] = json!([
        "",
        "missing_effect",
        "poisoned",
        "godfather",
        "empowered",
        "empowered"
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "empower effect tag must not be empty",
    );
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "unknown standard_nar empower effect `missing_effect`",
    );
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "standard_nar empower effect `poisoned` must be resolution-scoped",
    );
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "standard_nar empower effect `godfather` must be resolution-scoped",
    );
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "standard_nar empower effect `godfather` must be produced by a night Mark action",
    );
    assert_issue(
        &err,
        "standard_nar.empower_effects",
        "duplicate value `empowered`",
    );
}

#[test]
fn mark_clear_link_effects_require_visibility_metadata() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["effects"].as_object_mut().unwrap().remove("doused");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.arsonist.actions[0].effect",
        "Mark/Clear/Link action effects must declare effects metadata",
    );
    assert_issue(
        &err,
        "roles.cleanser.actions[0].effect",
        "Mark/Clear/Link action effects must declare effects metadata",
    );
}

#[test]
fn delayed_poison_marks_must_be_persistent() {
    let mut value = valid_pack_value();
    value["effects"] = json!({
        "poisoned": { "duration": "Resolution", "visibility": "Target" }
    });
    value["roles"]["poisoner"] = json!({
        "description": "Poisoner.",
        "alignment": "mafia",
        "actions": [{
            "id": "poison",
            "ability": "Mark",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 45
            },
            "effect": "poisoned"
        }]
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.poisoner.actions[0].effect_duration",
        "poisoned delayed-death marks must be persistent",
    );
}

#[test]
fn grant_actions_require_v2_and_payload() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Grant");
    action["grant"] = json!({
        "grant_id": "",
        "kind": "ExtraAction",
        "uses": 0,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Grant requires");
    assert_issue(
        &err,
        "roles.cop.actions[0].grant.grant_id",
        "must not be empty",
    );
    assert_issue(&err, "roles.cop.actions[0].grant.uses", "greater than zero");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Grant");
    action["grant"] = json!({
        "grant_id": "vote_power_boost",
        "kind": "VoteWeight",
        "uses": 1,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant.vote_weight",
        "must declare vote_weight",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Grant");
    action["grant"] = json!({
        "grant_id": "vote_power_boost",
        "kind": "VoteWeight",
        "uses": 1,
        "vote_weight": -1.0,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant.vote_weight",
        "invalid vote_weight",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Grant");
    action["grant"] = json!({
        "grant_id": "extra_action",
        "kind": "ExtraAction",
        "uses": 1,
        "vote_weight": 2.0,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant.vote_weight",
        "ExtraAction grants must not declare vote_weight",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    value["roles"]["cop"]["actions"][0]["grant"] = json!({
        "grant_id": "extra_action",
        "kind": "ExtraAction",
        "uses": 1,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant",
        "only legal on Grant actions",
    );
}

#[test]
fn item_grants_require_declared_item_action() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    value["roles"]["cop"]["actions"][0] = json!({
        "id": "grant_item",
        "ability": "Grant",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 50
        },
        "grant": {
            "grant_id": "single_use_item",
            "kind": "Item",
            "uses": 1,
            "visibility": "Target"
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant.grant_id",
        "must reference an item_actions entry",
    );

    value["item_actions"] = json!({
        "single_use_item": {
            "id": "wrong_item_id",
            "ability": "Investigate",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 20
            },
            "mode": "Parity"
        }
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "item_actions.single_use_item.id",
        "must match its item_actions key",
    );

    value["item_actions"]["single_use_item"]["id"] = json!("single_use_item");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn grant_options_are_strict_and_versioned() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(42);
    value["item_actions"] = json!({
        "parity_scanner_item": {
            "id": "parity_scanner_item",
            "ability": "Investigate",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 20
            },
            "mode": "Parity"
        },
        "bulletproof_vest_item": {
            "id": "bulletproof_vest_item",
            "ability": "Mark",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 55
            },
            "effect": "bulletproof_vest"
        }
    });
    set_effect_policy(&mut value, "bulletproof_vest", "Persistent", "Target");
    set_effect_policy(&mut value, "cultist", "Persistent", "Public");
    set_effect_policy(&mut value, "doused", "Persistent", "Hidden");
    value["roles"]["cop"]["actions"][0] = json!({
        "id": "grant_item",
        "ability": "Grant",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 50
        },
        "grant_options": [
            {
                "grant_id": "parity_scanner_item",
                "kind": "Item",
                "uses": 1,
                "visibility": "Target"
            },
            {
                "grant_id": "bulletproof_vest_item",
                "kind": "Item",
                "uses": 1,
                "visibility": "Target"
            }
        ]
    });
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut old_ir = value.clone();
    old_ir["ir_version"] = json!(41);
    let err = validate_pack(&pack_from_value(old_ir)).unwrap_err();
    assert_issue(&err, "ir_version", "grant_options");

    let mut unknown_item = value.clone();
    unknown_item["roles"]["cop"]["actions"][0]["grant_options"][0]["grant_id"] =
        json!("unknown_item");
    let err = validate_pack(&pack_from_value(unknown_item)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant_options[0].grant_id",
        "must reference an item_actions entry",
    );

    let mut duplicate = value.clone();
    duplicate["roles"]["cop"]["actions"][0]["grant_options"][1]["grant_id"] =
        json!("parity_scanner_item");
    let err = validate_pack(&pack_from_value(duplicate)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant_options[1].grant_id",
        "duplicate grant option",
    );

    let mut both = value.clone();
    both["roles"]["cop"]["actions"][0]["grant"] = json!({
        "grant_id": "extra_action",
        "kind": "ExtraAction",
        "uses": 1,
        "visibility": "Target"
    });
    let err = validate_pack(&pack_from_value(both)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant_options",
        "either grant or grant_options, not both",
    );

    let mut non_grant = value;
    non_grant["roles"]["cop"]["actions"][0]["ability"] = json!("Investigate");
    non_grant["roles"]["cop"]["actions"][0]["mode"] = json!("Parity");
    let err = validate_pack(&pack_from_value(non_grant)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].grant_options",
        "grant is only legal on Grant actions",
    );
}

#[test]
fn item_actions_contribute_pack_abilities_and_effect_tags() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(2);
    value["roles"]["cop"]["actions"][0] = json!({
        "id": "grant_mark_item",
        "ability": "Grant",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 50
        },
        "grant": {
            "grant_id": "mark_item",
            "kind": "Item",
            "uses": 1,
            "visibility": "Target"
        }
    });
    value["item_actions"] = json!({
        "mark_item": {
            "id": "mark_item",
            "ability": "Mark",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 60
            },
            "effect": "item_only_effect"
        }
    });
    value["effects"]["item_only_effect"] = json!({
        "duration": "Persistent",
        "visibility": "Target"
    });
    value["precedence"] = json!([
        {
            "id": "item_mark_before_investigate",
            "when": { "effect": "Mark", "target_state": null },
            "beats": ["Investigate"],
            "unless_modifiers": []
        }
    ]);

    let pack = pack_from_value(value);
    validate_pack(&pack).unwrap();
    assert!(
        night_ability_order(&pack)
            .unwrap()
            .contains(&IrAbility::Mark),
        "item actions must participate in pack-derived night ability ordering"
    );
}

#[test]
fn link_actions_require_v3_and_multi_target_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Link");
    action["mode"] = Value::Null;
    action["targets"] = json!("One");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Link requires");
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "at least two unique slots",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(3);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Link");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn retaliate_actions_require_v4_and_single_target_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Retaliate");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Retaliate requires");
    assert_issue(&err, "roles.cop.actions[0].targets", "exactly one slot");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(4);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Retaliate");
    action["mode"] = Value::Null;
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn badge_actions_require_v7_payload_and_operation_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Badge");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Badge requires");
    assert_issue(
        &err,
        "roles.cop.actions[0].badge",
        "Badge actions must declare badge",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(7);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Badge");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    action["badge"] = json!({
        "badge_id": "",
        "operation": "Elect",
        "vote_weight": 0.0
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].badge.badge_id",
        "must not be empty",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].badge.vote_weight",
        "greater than zero",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "must target exactly one slot",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(7);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Badge");
    action["mode"] = Value::Null;
    action["targets"] = json!("None");
    action["constraints"]["max_targets"] = json!(0);
    action["badge"] = json!({
        "badge_id": "sheriff_badge",
        "operation": "Destroy",
        "vote_weight": null
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn duel_actions_require_v8_payload_and_day_target_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Duel");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Duel requires");
    assert_issue(
        &err,
        "roles.cop.actions[0].duel",
        "Duel actions must declare duel",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(8);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Duel");
    action["mode"] = Value::Null;
    action["window"] = json!("Night");
    action["duel"] = json!({
        "hostile_alignments": ["mafia", "mafia", "unknown", ""]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].window", "Day window");
    assert_issue(
        &err,
        "roles.cop.actions[0].duel.hostile_alignments",
        "duplicate hostile alignment",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].duel.hostile_alignments",
        "unknown hostile alignment `unknown`",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].duel.hostile_alignments",
        "must not be empty",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(8);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Duel");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    action["duel"] = json!({ "hostile_alignments": ["mafia"] });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn vote_duel_actions_require_explicit_duel_tie_breaker() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(34);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("VoteDuel");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "vote.vote_duel_tie_breaker",
        "VoteDuel actions require an explicit vote_duel_tie_breaker",
    );

    value["vote"]["vote_duel_tie_breaker"] = json!("Random");
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["vote"]["vote_duel_tie_breaker"] = json!("Random");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.vote_duel_tie_breaker",
        "requires a VoteDuel action",
    );
}

#[test]
fn veto_actions_require_v47_day_target_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Veto");
    action["mode"] = Value::Null;
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "Veto requires");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(47);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Veto");
    action["mode"] = Value::Null;
    action["window"] = json!("Night");
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].window", "Day window");
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "target exactly one slot",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(47);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Veto");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_shot_actions_require_v9_day_target_shape_and_sessions() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].ability", "ItaShot requires");
    assert_issue(
        &err,
        "ita.sessions",
        "packs with ItaShot actions must declare at least one ITA session",
    );
    assert_issue(
        &err,
        "ita.vote_conflict",
        "must declare vote_conflict ResolveShotsBeforeVote",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(9);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["ita"] = json!({
        "default_hit_chance": 1.5,
        "sessions": [
            { "session_id": "", "day": 0, "hit_chance": -0.1, "shot_limit": 0, "buffer_delay_ms": 0 },
            { "session_id": "d1" },
            { "session_id": "d1" }
        ]
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Night");
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "ita.default_hit_chance", "between 0.0 and 1.0");
    assert_issue(&err, "ita.sessions[0].session_id", "must not be empty");
    assert_issue(&err, "ita.sessions[0].day", "greater than zero");
    assert_issue(&err, "ita.sessions[0].hit_chance", "between 0.0 and 1.0");
    assert_issue(&err, "ita.sessions[0].shot_limit", "greater than zero");
    assert_issue(&err, "ita.sessions[0].buffer_delay_ms", "greater than zero");
    assert_issue(&err, "ita.sessions[2].session_id", "duplicate ITA session");
    assert_issue(
        &err,
        "ita.vote_conflict",
        "must declare vote_conflict ResolveShotsBeforeVote",
    );
    assert_issue(&err, "roles.cop.actions[0].window", "Day window");
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "target exactly one slot",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(9);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["ita"] = json!({
        "default_hit_chance": 1.0,
        "vote_conflict": "ResolveShotsBeforeVote",
        "sessions": [{ "session_id": "d1", "hit_chance": 1.0 }]
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_session_buffer_delay_with_resolution_policy_hp_and_lifecycle_requires_v62_and_positive_delay(
) {
    let mut value = serde_json::to_value(load_pack_named("test_ita_buffered")).unwrap();
    value["ir_version"] = json!(60);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 62",
    );
    assert_issue(&err, "ir_version", "ita.session.buffer_delay_ms");
    assert_issue(&err, "ir_version", "ita.resolution_policy");
    assert_issue(&err, "ir_version", "ita.hit_points");
    assert_issue(&err, "ir_version", "ita.lifecycle");

    value["ir_version"] = json!(62);
    value["ita"]["sessions"][0]["buffer_delay_ms"] = json!(0);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "ita.sessions[0].buffer_delay_ms", "greater than zero");

    value["ita"]["sessions"][0]["buffer_delay_ms"] = json!(1000);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_resolution_policy_requires_v60() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(59);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["ita"] = json!({
        "default_hit_chance": 1.0,
        "vote_conflict": "ResolveShotsBeforeVote",
        "sessions": [{ "session_id": "d1", "day": 1 }],
        "resolution_policy": {
            "on_target_already_dead": "REFUND_SHOT"
        }
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 60",
    );
    assert_issue(&err, "ir_version", "ita.resolution_policy");

    value["ir_version"] = json!(60);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_role_overrides_require_v31_sessions_roles_and_probability_contracts() {
    let mut value = valid_pack_value();
    value["ita"] = json!({
        "role_overrides": {
            "cop": { "hit_bonus": 1.5 },
            "missing_role": { "hit_penalty": 0.25 },
            "townie": {}
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 31",
    );
    assert_issue(&err, "ir_version", "ita.role_overrides");
    assert_issue(&err, "ita", "require at least one ITA session");
    assert_issue(
        &err,
        "ita.role_overrides",
        "unknown ITA role override `missing_role`",
    );
    assert_issue(
        &err,
        "ita.role_overrides.cop.hit_bonus",
        "between 0.0 and 1.0",
    );
    assert_issue(
        &err,
        "ita.role_overrides.townie",
        "at least one nonzero modifier",
    );

    value["ir_version"] = json!(31);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["ita"] = json!({
        "default_hit_chance": 0.5,
        "vote_conflict": "ResolveShotsBeforeVote",
        "sessions": [{ "session_id": "d1", "day": 1, "shot_limit": 1 }],
        "role_overrides": {
            "cop": { "hit_bonus": 0.25 },
            "townie": { "hit_penalty": 0.25, "target_evade": 0.25, "shields": 1 }
        }
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_modifier_components_require_v32_and_fold_strictly() {
    let mut value = valid_pack_value();
    value["ita"] = json!({
        "modifier_components": {
            "better": { "hit_bonus": 0.25 },
            "shield": { "shields": 1 },
            "empty": {}
        },
        "role_modifier_refs": {
            "cop": ["better", "better"],
            "townie": ["missing_component"],
            "missing_role": ["shield"]
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 32",
    );
    assert_issue(&err, "ir_version", "ita.modifier_components");
    assert_issue(&err, "ita", "require at least one ITA session");
    assert_issue(
        &err,
        "ita.modifier_components.empty",
        "at least one nonzero modifier",
    );
    assert_issue(
        &err,
        "ita.role_modifier_refs.cop",
        "duplicate ITA modifier component ref `better`",
    );
    assert_issue(
        &err,
        "ita.role_modifier_refs.townie",
        "unknown ITA modifier component `missing_component`",
    );
    assert_issue(
        &err,
        "ita.role_modifier_refs",
        "unknown ITA role modifier ref `missing_role`",
    );

    value["ir_version"] = json!(32);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["ita"] = json!({
        "default_hit_chance": 0.5,
        "vote_conflict": "ResolveShotsBeforeVote",
        "sessions": [{ "session_id": "d1", "day": 1, "shot_limit": 1 }],
        "modifier_components": {
            "better": { "hit_bonus": 0.25 },
            "shield": { "shields": 1 }
        },
        "role_modifier_refs": {
            "cop": ["better", "shield"]
        }
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_hit_points_require_v61_and_fold_through_modifier_components() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(60);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["ita"] = json!({
        "default_hit_chance": 1.0,
        "vote_conflict": "ResolveShotsBeforeVote",
        "sessions": [{ "session_id": "d1", "day": 1 }],
        "modifier_components": {
            "hp": { "hit_points": 2 },
            "shield": { "shields": 1 }
        },
        "role_modifier_refs": {
            "townie": ["hp", "shield"]
        }
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 61",
    );
    assert_issue(&err, "ir_version", "ita.hit_points");

    value["ir_version"] = json!(61);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn ita_lifecycle_controls_require_v62_and_sessions() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(61);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["ita"] = json!({
        "default_hit_chance": 1.0,
        "vote_conflict": "ResolveShotsBeforeVote",
        "lifecycle": {
            "manual_open": true,
            "pause": true,
            "cancel": true,
            "update": true,
            "manual_close": true
        }
    });
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("ItaShot");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 62",
    );
    assert_issue(&err, "ir_version", "ita.lifecycle");
    assert_issue(&err, "ita", "require at least one ITA session");

    value["ir_version"] = json!(62);
    value["ita"]["sessions"] = json!([{ "session_id": "d1", "day": 1 }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn self_destruct_actions_require_v10_payload_and_day_or_twilight_target_shape() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("SelfDestruct");
    action["mode"] = Value::Null;
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].ability",
        "SelfDestruct requires",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].self_destruct",
        "SelfDestruct actions must declare self_destruct",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(10);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("SelfDestruct");
    action["mode"] = Value::Null;
    action["window"] = json!("Night");
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    action["self_destruct"] = json!({
        "cause": "",
        "kill_target": false,
        "sacrifice_actor": false,
        "unstoppable": true
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].window",
        "Day, Twilight, or Instant window",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].targets",
        "target exactly one slot",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].self_destruct.cause",
        "must not be empty",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].self_destruct",
        "must kill the target or sacrifice the actor",
    );

    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["self_destruct"] = json!({ "cause": "wrong" });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].self_destruct",
        "only legal on SelfDestruct actions",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(10);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("SelfDestruct");
    action["mode"] = Value::Null;
    action["window"] = json!("Day");
    action["self_destruct"] = json!({
        "cause": "self_destruct",
        "kill_target": true,
        "sacrifice_actor": true,
        "unstoppable": true
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn wolf_carry_policy_requires_v11_role_refs_and_day_night_cadence() {
    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    value["wolf_carry"] = json!({
        "enabled": true,
        "token_id": "",
        "cause": "",
        "eligible_roles": ["missing_white_wolf"],
        "wolf_kill_roles": ["missing_wolf"]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "wolf_carry.token_id", "must not be empty");
    assert_issue(&err, "wolf_carry", "requires ir_version >= 11");
    assert_issue(&err, "wolf_carry.cause", "must not be empty");
    assert_issue(
        &err,
        "wolf_carry.eligible_roles",
        "unknown eligible role `missing_white_wolf`",
    );
    assert_issue(
        &err,
        "wolf_carry.wolf_kill_roles",
        "unknown wolf kill role `missing_wolf`",
    );
    assert_issue(&err, "wolf_carry", "requires Day and Night");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(11);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["wolf_carry"] = json!({
        "enabled": true,
        "token_id": "white_wolf_carry_token",
        "cause": "wolf_carry",
        "eligible_roles": ["cop"],
        "wolf_kill_roles": ["arsonist"]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn wolf_beauty_policy_requires_v12_effect_role_refs_and_day_night_cadence() {
    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    value["wolf_beauty"] = json!({
        "enabled": true,
        "mark_effect": "missing_mark",
        "drag_cause": "",
        "eligible_roles": ["missing_beauty"],
        "death_causes": [""]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "wolf_beauty", "requires ir_version >= 12");
    assert_issue(
        &err,
        "wolf_beauty.mark_effect",
        "unknown mark effect `missing_mark`",
    );
    assert_issue(&err, "wolf_beauty.drag_cause", "must not be empty");
    assert_issue(
        &err,
        "wolf_beauty.eligible_roles",
        "unknown eligible role `missing_beauty`",
    );
    assert_issue(&err, "wolf_beauty.death_causes", "must not be empty");
    assert_issue(&err, "wolf_beauty", "requires Day and Night");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(12);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["roles"]["cop"]["actions"][0]["effect"] = json!("wolf_beauty_mark");
    value["roles"]["cop"]["actions"][0]["ability"] = json!("Mark");
    value["roles"]["cop"]["actions"][0]["mode"] = Value::Null;
    set_effect_policy(&mut value, "wolf_beauty_mark", "Persistent", "Hidden");
    value["wolf_beauty"] = json!({
        "enabled": true,
        "mark_effect": "wolf_beauty_mark",
        "drag_cause": "trigger:wolf_beauty_drag",
        "eligible_roles": ["cop"],
        "death_causes": ["lynch"]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn guard_policy_requires_v13_action_refs_and_supported_same_target_rule() {
    let mut value = valid_pack_value();
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["missing_guard", ""],
        "witch_heal_action_ids": ["missing_heal", ""],
        "guard_blockable_causes": ["poison_potion", ""],
        "same_target_witch": "KillTarget"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "guard_policy", "requires ir_version >= 13");
    assert_issue(
        &err,
        "guard_policy.guard_action_ids",
        "unknown guard action `missing_guard`",
    );
    assert_issue(
        &err,
        "guard_policy.guard_action_ids",
        "guard action id must not be empty",
    );
    assert_issue(
        &err,
        "guard_policy.witch_heal_action_ids",
        "unknown witch heal action `missing_heal`",
    );
    assert_issue(
        &err,
        "guard_policy.witch_heal_action_ids",
        "witch heal action id must not be empty",
    );
    assert_issue(
        &err,
        "guard_policy.guard_blockable_causes",
        "must not be empty",
    );
    assert_issue(
        &err,
        "guard_policy.guard_self_allowed",
        "must declare guard_self_allowed",
    );
    assert_issue(
        &err,
        "guard_policy.guard_night_one_allowed",
        "must declare guard_night_one_allowed",
    );
    assert_issue(
        &err,
        "guard_policy.same_target_witch_kill_cause",
        "requires same_target_witch_kill_cause",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(13);
    value["roles"]["guard"] = json!({
        "description": "Guard.",
        "alignment": "town",
        "actions": [{
            "id": "night_guard",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70
            }
        }]
    });
    value["roles"]["witch"] = json!({
        "description": "Witch.",
        "alignment": "town",
        "actions": [{
            "id": "heal_potion",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70,
                "x_shots": 1
            }
        }]
    });
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["night_guard"],
        "witch_heal_action_ids": ["heal_potion"],
        "guard_blockable_causes": ["poison_potion"],
        "guard_self_allowed": true,
        "guard_night_one_allowed": true,
        "same_target_witch": "NoDeath"
    });
    value["precedence"] = json!([
        {
            "id": "protect_before_guard_blockable_kills",
            "when": { "effect": "Protect", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(13);
    value["roles"]["guard"] = json!({
        "description": "Guard.",
        "alignment": "town",
        "actions": [{
            "id": "night_guard",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70
            }
        }]
    });
    value["roles"]["witch"] = json!({
        "description": "Witch.",
        "alignment": "town",
        "actions": [{
            "id": "heal_potion",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70,
                "x_shots": 1
            }
        }]
    });
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["night_guard"],
        "witch_heal_action_ids": ["heal_potion"],
        "guard_blockable_causes": ["poison_potion"],
        "guard_self_allowed": true,
        "guard_night_one_allowed": true,
        "same_target_witch": "KillTarget",
        "same_target_witch_kill_cause": "guard_witch_same_target"
    });
    value["precedence"] = json!([
        {
            "id": "protect_before_guard_blockable_kills",
            "when": { "effect": "Protect", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(13);
    value["roles"]["guard"] = json!({
        "description": "Guard.",
        "alignment": "town",
        "actions": [{
            "id": "night_guard",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70
            }
        }]
    });
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["night_guard"],
        "witch_heal_action_ids": [],
        "guard_blockable_causes": ["poison_potion"],
        "guard_self_allowed": true,
        "guard_night_one_allowed": true,
        "same_target_witch": "NoDeath"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "guard_policy.precedence",
        "requires a Protect precedence rule that beats Kill",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(13);
    value["roles"]["guard"] = json!({
        "description": "Guard.",
        "alignment": "town",
        "actions": [{
            "id": "night_guard",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": ["Reflexive"],
            "constraints": {
                "max_targets": 1,
                "self_allowed": true,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70
            }
        }]
    });
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["night_guard"],
        "witch_heal_action_ids": [],
        "guard_blockable_causes": ["poison_potion"],
        "guard_self_allowed": false,
        "guard_night_one_allowed": false,
        "same_target_witch": "NoDeath"
    });
    value["precedence"] = json!([
        {
            "id": "protect_before_guard_blockable_kills",
            "when": { "effect": "Protect", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "guard_policy.guard_self_allowed",
        "constraints.self_allowed must be false",
    );
    assert_issue(
        &err,
        "guard_policy.guard_night_one_allowed",
        "active_from must match guard_night_one_allowed=false",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(13);
    value["roles"]["guard"] = json!({
        "description": "Guard.",
        "alignment": "town",
        "actions": [{
            "id": "night_guard",
            "ability": "Protect",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 70,
                "active_from": {
                    "phase_kind": "Night",
                    "phase_number": 2,
                    "reason": "Activated"
                }
            }
        }]
    });
    value["guard_policy"] = json!({
        "enabled": true,
        "guard_action_ids": ["night_guard"],
        "witch_heal_action_ids": [],
        "guard_blockable_causes": ["poison_potion"],
        "guard_self_allowed": false,
        "guard_night_one_allowed": false,
        "same_target_witch": "NoDeath"
    });
    value["precedence"] = json!([
        {
            "id": "protect_before_guard_blockable_kills",
            "when": { "effect": "Protect", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn standard_nar_policy_requires_action_shapes_and_precedence_edges() {
    let value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    let mut malformed = value;
    malformed["standard_nar"]["kill_stacking"] = Value::Null;
    malformed["standard_nar"]["block_action_ids"] = json!(["missing_block"]);
    malformed["standard_nar"]["protect_action_ids"] = json!([]);
    malformed["standard_nar"]["kill_action_ids"] = json!(["doctor_protect"]);
    malformed["standard_nar"]["bodyguard_action_ids"] = json!(["doctor_protect"]);
    malformed["standard_nar"]["martyr_action_ids"] = json!(["bodyguard"]);
    malformed["standard_nar"]["cpr_action_ids"] = json!(["doctor_protect"]);
    malformed["standard_nar"]["jailkeep_action_ids"] = json!(["roleblocker_block"]);
    malformed["standard_nar"]["strongman_action_ids"] = json!(["factional_kill"]);
    malformed["standard_nar"]["strongman_bypasses_protect"] = json!(false);
    malformed["standard_nar"]["kill_cause_ids"] = json!([]);
    malformed["standard_nar"]["target_state_save_tags"] = json!([]);
    malformed["standard_nar"]["target_state_gate_tags"] = json!([]);
    malformed["standard_nar"]["intercept_cause_policy"] = json!({});
    malformed["standard_nar"]["cpr_harm_cause_policy"] = json!({});
    malformed["standard_nar"]["guard_dependency_cause_policy"] = json!({});
    malformed["standard_nar"]["hide_dependency_cause_policy"] = json!({});
    malformed["standard_nar"]["chosen_retaliation_cause_policy"] = json!({});
    malformed["standard_nar"]["generated_kill_cause_policy"] = json!({});
    malformed["standard_nar"]["trigger_fixpoint_policy"] = json!({});
    malformed["standard_nar"]["protection_cause_policy"] = json!({});
    malformed["standard_nar"]["target_state_save_policy"] = json!({});
    malformed["standard_nar"]["target_state_gate_policy"] = json!({});
    malformed["standard_nar"]["suppression_policy"] = json!({});
    malformed["precedence"] = json!([]);

    let err = validate_pack(&pack_from_value(malformed)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.kill_stacking",
        "requires kill_stacking AggregateAttackers",
    );
    assert_issue(
        &err,
        "standard_nar.block_action_ids",
        "unknown standard_nar action `missing_block`",
    );
    assert_issue(
        &err,
        "standard_nar.protect_action_ids",
        "must declare protect_action_ids",
    );
    assert_issue(
        &err,
        "standard_nar.kill_action_ids",
        "must be a night/any Kill without Strongman/Cpr action",
    );
    assert_issue(
        &err,
        "standard_nar.bodyguard_action_ids",
        "must be a night/any Protect with Bodyguard action",
    );
    assert_issue(
        &err,
        "standard_nar.martyr_action_ids",
        "must be a night/any Protect with Martyr action",
    );
    assert_issue(
        &err,
        "standard_nar.cpr_action_ids",
        "must be a night/any Protect plus Kill with Cpr action",
    );
    assert_issue(
        &err,
        "standard_nar.jailkeep_action_ids",
        "must be a night/any Block plus Protect action",
    );
    assert_issue(
        &err,
        "standard_nar.strongman_action_ids",
        "must be a night/any Kill with Strongman action",
    );
    assert_issue(
        &err,
        "standard_nar.strongman_bypasses_protect",
        "requires strongman_bypasses_protect true",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "must declare kill_cause_ids",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_tags",
        "must declare target-state save tags",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_tags",
        "must declare target-state gate tags",
    );
    assert_issue(
        &err,
        "standard_nar.intercept_cause_policy",
        "must classify intercept causes",
    );
    assert_issue(
        &err,
        "standard_nar.cpr_harm_cause_policy",
        "must classify CPR harm causes",
    );
    assert_issue(
        &err,
        "standard_nar.guard_dependency_cause_policy",
        "must classify guard dependency causes",
    );
    assert_issue(
        &err,
        "standard_nar.hide_dependency_cause_policy",
        "must classify hide dependency causes",
    );
    assert_issue(
        &err,
        "standard_nar.chosen_retaliation_cause_policy",
        "must classify chosen retaliation causes",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy",
        "must classify generated kill causes",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy",
        "must classify trigger fixpoint participation",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy",
        "must classify protection causes",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy",
        "must classify roleblock suppression",
    );
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Block precedence over Protect and Kill",
    );
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Protect beats Kill and is blocked_by Block",
    );
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Kill blocked_by Block and Protect",
    );
}

#[test]
fn standard_nar_kill_cause_catalog_matches_pack_sources() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["kill_cause_ids"] = json!([
        "factional_kill",
        "hunter_retaliate",
        "ignite",
        "janitor_kill",
        "night_kill",
        "strongman_kill",
        "super_saint_retaliates",
        "unstoppable_vengeful_retaliates",
        "vengeful_retaliates",
        "missing_cause",
        "night_kill",
        ""
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "standard_nar kill_cause_ids must include `pgo_shoots_visitor`",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "unknown standard_nar kill cause `missing_cause`",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "duplicate value `night_kill`",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "standard_nar kill cause id must not be empty",
    );
}

#[test]
fn standard_nar_target_state_tag_catalogs_match_pack_sources() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["target_state_save_tags"] =
        json!(["bulletproof", "missing_save", "bulletproof", ""]);
    value["standard_nar"]["target_state_gate_tags"] =
        json!(["commuted", "missing_gate", "commuted", ""]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.target_state_save_tags",
        "standard_nar target_state_save_tags must include `bulletproof_vest`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_tags",
        "unknown standard_nar target-state save tag `missing_save`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_tags",
        "duplicate value `bulletproof`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_tags",
        "standard_nar target-state save tag must not be empty",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_tags",
        "standard_nar target_state_gate_tags must include `untargetable`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_tags",
        "unknown standard_nar target-state gate tag `missing_gate`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_tags",
        "duplicate value `commuted`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_tags",
        "standard_nar target-state gate tag must not be empty",
    );
}

#[test]
fn standard_nar_cpr_harm_cause_policy_classifies_every_cpr_action() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["cpr_harm_cause_policy"]["cpr_protect"] = json!("factional_kill");
    value["standard_nar"]["cpr_harm_cause_policy"]["unknown_cpr"] = json!("custom_cpr_harm");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.cpr_harm_cause_policy.cpr_protect",
        "must not reuse a direct kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.cpr_harm_cause_policy.unknown_cpr",
        "unknown standard_nar CPR source",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["cpr_harm_cause_policy"]["cpr_protect"] = json!("");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.cpr_harm_cause_policy.cpr_protect",
        "CPR harm cause must not be empty",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["cpr_harm_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("cpr_protect");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.cpr_harm_cause_policy",
        "CPR action `cpr_protect` must declare harm cause",
    );
}

#[test]
fn standard_nar_guard_dependency_cause_policy_classifies_every_babysitter_action() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["guard_dependency_cause_policy"]["babysit"] = json!("factional_kill");
    value["standard_nar"]["guard_dependency_cause_policy"]["unknown_guard"] =
        json!("custom_guard_dependency");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.guard_dependency_cause_policy.babysit",
        "must not reuse a direct kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.guard_dependency_cause_policy.unknown_guard",
        "unknown standard_nar guard dependency source",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["guard_dependency_cause_policy"]["babysit"] = json!("");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.guard_dependency_cause_policy.babysit",
        "guard dependency cause must not be empty",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["guard_dependency_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("babysit");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.guard_dependency_cause_policy",
        "guard dependency action `babysit` must declare dependency cause",
    );
}

#[test]
fn standard_nar_hide_dependency_cause_policy_classifies_every_hider_action() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["hide_dependency_cause_policy"]["hide"] = json!("factional_kill");
    value["standard_nar"]["hide_dependency_cause_policy"]["unknown_hide"] =
        json!("custom_hide_dependency");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.hide_dependency_cause_policy.hide",
        "must not reuse a direct kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.hide_dependency_cause_policy.unknown_hide",
        "unknown standard_nar hide dependency source",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["hide_dependency_cause_policy"]["hide"] = json!("");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.hide_dependency_cause_policy.hide",
        "hide dependency cause must not be empty",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["hide_dependency_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("hide");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.hide_dependency_cause_policy",
        "hide dependency action `hide` must declare dependency cause",
    );
}

#[test]
fn standard_nar_intercept_cause_policy_classifies_every_interceptor() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["intercept_cause_policy"]["bodyguard"] = json!("factional_kill");
    value["standard_nar"]["intercept_cause_policy"]["unknown_interceptor"] =
        json!("custom_intercept");
    value["standard_nar"]["intercept_cause_policy"]["martyr_protect"] = json!("");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.intercept_cause_policy.bodyguard",
        "must not reuse a direct kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.intercept_cause_policy.unknown_interceptor",
        "unknown standard_nar intercept source",
    );
    assert_issue(
        &err,
        "standard_nar.intercept_cause_policy.martyr_protect",
        "intercept cause must not be empty",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["intercept_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("martyr_protect");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.intercept_cause_policy",
        "intercept action `martyr_protect` must declare intercept cause",
    );
}

#[test]
fn standard_nar_guard_retaliation_policy_requires_intercept_source_and_kill_cause() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["guard_retaliation_cause_policy"]["doctor_protect"] =
        json!("doctor_retaliates");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.guard_retaliation_cause_policy.doctor_protect",
        "must also be an intercept source",
    );
    assert_issue(
        &err,
        "standard_nar.guard_retaliation_cause_policy.doctor_protect",
        "must be declared in kill_cause_ids",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["guard_retaliation_cause_policy"]["huntsman_guard"] = json!("");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.guard_retaliation_cause_policy.huntsman_guard",
        "guard retaliation cause must not be empty",
    );
}

#[test]
fn standard_nar_protection_cause_policy_classifies_every_pair() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["protection_cause_policy"]["doctor_protect"] = json!({
        "blocks": ["factional_kill", "hunter_retaliate", "missing_cause", "strongman_kill"],
        "bypasses": ["factional_kill", "night_kill"]
    });
    value["standard_nar"]["protection_cause_policy"]["unknown_protect"] = json!({
        "blocks": ["factional_kill"],
        "bypasses": ["strongman_kill", "unstoppable_vengeful_retaliates"]
    });
    value["standard_nar"]["protection_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("jail");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy",
        "Protect action `jail` must classify every kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.unknown_protect",
        "unknown standard_nar protection source `unknown_protect`",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect.blocks",
        "unknown standard_nar kill cause `missing_cause`",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect.blocks",
        "strongman bypass cause `strongman_kill` must be classified in bypasses",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect.bypasses",
        "bypassed kill cause `night_kill` must be a Strongman bypass cause",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect",
        "kill cause `factional_kill` cannot be both blocked and bypassed",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect",
        "does not classify kill cause `pgo_shoots_visitor`",
    );
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect",
        "must classify generated kill trigger `pgo_shoots_visitor`",
    );
}

#[test]
fn standard_nar_target_state_save_policy_classifies_every_pair() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["target_state_save_policy"]["bulletproof"] = json!({
        "blocks": ["factional_kill", "hunter_retaliate", "missing_cause", "strongman_kill"],
        "bypasses": ["factional_kill", "night_kill"]
    });
    value["standard_nar"]["target_state_save_policy"]["unknown_save"] = json!({
        "blocks": ["factional_kill"],
        "bypasses": ["strongman_kill", "unstoppable_vengeful_retaliates"]
    });
    value["standard_nar"]["target_state_save_policy"]
        .as_object_mut()
        .unwrap()
        .remove("bulletproof_vest");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy",
        "target-state save `bulletproof_vest` must classify every kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.unknown_save",
        "unknown standard_nar target-state save `unknown_save`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof.blocks",
        "unknown standard_nar kill cause `missing_cause`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof.blocks",
        "strongman bypass cause `strongman_kill` must be classified in bypasses",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof.bypasses",
        "bypassed kill cause `night_kill` must be a Strongman bypass cause",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof",
        "kill cause `factional_kill` cannot be both blocked and bypassed",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof",
        "does not classify kill cause `pgo_shoots_visitor`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof",
        "must classify generated kill trigger `pgo_shoots_visitor`",
    );
}

#[test]
fn standard_nar_target_state_gate_policy_classifies_supported_gates() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["target_state_gate_policy"]["commuted"] = json!({
        "blocks": ["Kill", "Kill", "Protect"]
    });
    value["standard_nar"]["target_state_gate_policy"]["unknown_gate"] = json!({
        "blocks": []
    });
    value["standard_nar"]["target_state_gate_policy"]
        .as_object_mut()
        .unwrap()
        .remove("untargetable");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy",
        "target-state gate `untargetable` must classify blocked abilities",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy.unknown_gate",
        "unknown standard_nar target-state gate `unknown_gate`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy.unknown_gate.blocks",
        "must declare blocked abilities",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy.commuted.blocks",
        "duplicate blocked ability `Kill`",
    );
}

#[test]
fn standard_nar_suppression_policy_classifies_every_night_action() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["suppression_policy"]["roleblocker_block"] = json!({
        "scope": "FirstMatchingAction",
        "suppresses": ["cop_investigate", "missing_action", "roleblocker_block", "strong_willed_investigate"],
        "bypasses": ["cop_investigate", "doctor_protect"]
    });
    value["standard_nar"]["suppression_policy"]["unknown_block"] = json!({
        "suppresses": ["cop_investigate"],
        "bypasses": ["roleblocker_block"]
    });
    value["standard_nar"]["suppression_policy"]
        .as_object_mut()
        .unwrap()
        .remove("jail");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.suppression_policy",
        "Block action `jail` must classify every night action",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.unknown_block",
        "unknown standard_nar block source `unknown_block`",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.unknown_block.scope",
        "must declare scope",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block.suppresses",
        "unknown standard_nar night action `missing_action`",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block.suppresses",
        "suppression-immune action `roleblocker_block` must be classified in bypasses",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block.suppresses",
        "suppression-immune action `strong_willed_investigate` must be classified in bypasses",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block.bypasses",
        "roleblockable action `doctor_protect` must be classified in suppresses",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block",
        "night action `cop_investigate` cannot be both suppressed and bypassed",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block",
        "does not classify night action `babysit`",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block",
        "night action `babysit` that can feed generated kill trigger `pgo_shoots_visitor`",
    );
}

#[test]
fn standard_nar_suppression_policy_requires_block_precedence_before_suppressed_abilities() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    for rule in value["precedence"].as_array_mut().unwrap() {
        if rule["when"]["effect"] == "Block" {
            rule["beats"]
                .as_array_mut()
                .unwrap()
                .retain(|ability| ability != "Redirect");
        }
        if rule["when"]["effect"] == "Redirect" {
            rule["blocked_by"]
                .as_array_mut()
                .unwrap()
                .retain(|ability| ability != "Block");
        }
    }

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Block precedence before suppressed ability `Redirect`",
    );
}

#[test]
fn invalid_precedence_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_precedence");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Block precedence before suppressed ability `Protect`",
    );
    assert_issue(
        &err,
        "standard_nar.precedence",
        "requires Block precedence before suppressed ability `Kill`",
    );
    assert_issue(
        &err,
        "standard_nar.strongman_bypasses_protect",
        "requires strongman_bypasses_protect true",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block.scope",
        "standard_nar suppression policy must declare scope",
    );
}

#[test]
fn invalid_generated_kill_ownership_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_generated_kill_ownership");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "is not owned by protection source `doctor_protect`",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "is not owned by target-state save `bulletproof`",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "feeder action `visit` is not owned by block source `roleblocker_block`",
    );
}

#[test]
fn standard_nar_policy_requires_every_block_and_protect_action_to_be_declared() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["protect_action_ids"] = json!(["doctor_protect", "jail"]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.protect_action_ids",
        "standard_nar Protect action `babysit` on role `babysitter` must be declared",
    );
}

#[test]
fn standard_nar_action_chance_policy_is_strict_and_versioned() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(42);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >=",
    );
    assert_issue(
        &err,
        "standard_nar.action_chance",
        "requires ir_version >= 43",
    );
    assert_issue(
        &err,
        "standard_nar.conflict_families",
        "requires ir_version >= 44",
    );
    assert_issue(&err, "visibility_families", "requires ir_version >= 45");
    assert_issue(&err, "win_families", "requires ir_version >= 46");

    value["ir_version"] = json!(47);
    value["standard_nar"]["action_chance"]["faith_healer_protect"]["chance"] = json!(1.25);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.action_chance.faith_healer_protect.chance",
        "between 0.0 and 1.0",
    );

    value["standard_nar"]["action_chance"]["faith_healer_protect"]["chance"] = json!(0.5);
    value["standard_nar"]["action_chance"]["missing_protect"] = json!({ "chance": 0.5 });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.action_chance.missing_protect",
        "unknown standard_nar action",
    );
}

#[test]
fn standard_nar_conflict_families_are_strict_and_versioned() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(43);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >=",
    );
    assert_issue(
        &err,
        "standard_nar.conflict_families",
        "requires ir_version >= 44",
    );
    assert_issue(&err, "visibility_families", "requires ir_version >= 45");
    assert_issue(&err, "win_families", "requires ir_version >= 46");

    value["ir_version"] = json!(47);
    value["standard_nar"]["conflict_families"]
        .as_array_mut()
        .unwrap()
        .retain(|family| family != "ProtectBlocksKills");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.conflict_families",
        "must include `ProtectBlocksKills`",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["conflict_families"]
        .as_array_mut()
        .unwrap()
        .push(json!("ProtectBlocksKills"));
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.conflict_families",
        "duplicate conflict family `ProtectBlocksKills`",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["action_chance"] = json!({});
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.conflict_families",
        "declared conflict family `ActionChance` has no matching policy surface",
    );
}

#[test]
fn visibility_families_are_strict_and_versioned() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["ir_version"] = json!(44);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >=",
    );
    assert_issue(&err, "visibility_families", "requires ir_version >= 45");
    assert_issue(&err, "win_families", "requires ir_version >= 46");

    value["ir_version"] = json!(47);
    value["visibility_families"]
        .as_array_mut()
        .unwrap()
        .retain(|family| family != "StealthNinjaVisits");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "visibility_families",
        "must include `StealthNinjaVisits`",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["visibility_families"]
        .as_array_mut()
        .unwrap()
        .push(json!("StealthNinjaVisits"));
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "visibility_families",
        "duplicate visibility family `StealthNinjaVisits`",
    );

    value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["private_channels"] = json!({
        "enabled": false,
        "groups": []
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "visibility_families",
        "declared visibility family `PrivateChannels` has no matching policy surface",
    );
}

#[test]
fn standard_nar_jailkeep_must_be_explicit_block_and_protect_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["block_action_ids"] = json!(["roleblocker_block", "catastrophic_block"]);
    value["standard_nar"]["protect_action_ids"] = json!(["doctor_protect", "babysit"]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.jailkeep_action_ids",
        "Jailkeeper action `jail` must also be declared in block_action_ids",
    );
    assert_issue(
        &err,
        "standard_nar.jailkeep_action_ids",
        "Jailkeeper action `jail` must also be declared in protect_action_ids",
    );
}

#[test]
fn standard_nar_strongman_kills_must_be_explicit_bypass_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["strongman_action_ids"] = json!([]);
    value["standard_nar"]["protection_cause_policy"]["doctor_protect"] = json!({
        "blocks": ["factional_kill", "hunter_retaliate", "ignite", "night_kill", "pgo_shoots_visitor", "strongman_kill", "super_saint_retaliates", "vengeful_retaliates"],
        "bypasses": ["unstoppable_vengeful_retaliates"]
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.strongman_action_ids",
        "Strongman Kill action `strongman_kill` on role `strongman` must be declared",
    );
}

#[test]
fn standard_nar_kill_actions_must_be_explicit_conflict_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["kill_action_ids"]
        .as_array_mut()
        .unwrap()
        .retain(|action_id| action_id != "night_kill");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.kill_action_ids",
        "Kill action `night_kill` on role `vigilante` must be declared",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["item_actions"]["ordinary_item_kill"] = json!({
        "id": "ordinary_item_kill",
        "ability": "Kill",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 30
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.kill_action_ids",
        "Kill action `ordinary_item_kill` on item_actions `ordinary_item_kill` must be declared",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "standard_nar kill_cause_ids must include `ordinary_item_kill`",
    );

    value["standard_nar"]["kill_action_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("ordinary_item_kill"));
    value["standard_nar"]["kill_cause_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("ordinary_item_kill"));
    for source in [
        "doctor_protect",
        "faith_healer_protect",
        "babysit",
        "bodyguard",
        "martyr_protect",
        "cpr_protect",
        "jail",
        "huntsman_guard",
    ] {
        value["standard_nar"]["protection_cause_policy"][source]["blocks"]
            .as_array_mut()
            .unwrap()
            .push(json!("ordinary_item_kill"));
    }
    for save in ["bulletproof", "bulletproof_vest"] {
        value["standard_nar"]["target_state_save_policy"][save]["blocks"]
            .as_array_mut()
            .unwrap()
            .push(json!("ordinary_item_kill"));
    }
    for source in ["roleblocker_block", "jail", "catastrophic_block"] {
        value["standard_nar"]["suppression_policy"][source]["suppresses"]
            .as_array_mut()
            .unwrap()
            .push(json!("ordinary_item_kill"));
    }

    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn standard_nar_item_kill_causes_must_be_explicit_conflict_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["item_actions"]["strongman_item_kill"] = json!({
        "id": "strongman_item_kill",
        "ability": "Kill",
        "window": "Night",
        "targets": "One",
        "modifiers": ["Strongman"],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 30
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.strongman_action_ids",
        "Strongman Kill action `strongman_item_kill` on item_actions `strongman_item_kill` must be declared",
    );
    assert_issue(
        &err,
        "standard_nar.kill_cause_ids",
        "standard_nar kill_cause_ids must include `strongman_item_kill`",
    );
    assert_issue(
        &err,
        "standard_nar.suppression_policy.roleblocker_block",
        "does not classify night action `strongman_item_kill`",
    );

    value["standard_nar"]["strongman_action_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("strongman_item_kill"));
    value["standard_nar"]["kill_cause_ids"]
        .as_array_mut()
        .unwrap()
        .push(json!("strongman_item_kill"));
    for policy in value["standard_nar"]["protection_cause_policy"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        policy["bypasses"]
            .as_array_mut()
            .unwrap()
            .push(json!("strongman_item_kill"));
    }
    for policy in value["standard_nar"]["target_state_save_policy"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        policy["bypasses"]
            .as_array_mut()
            .unwrap()
            .push(json!("strongman_item_kill"));
    }
    for policy in value["standard_nar"]["suppression_policy"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        policy["suppresses"]
            .as_array_mut()
            .unwrap()
            .push(json!("strongman_item_kill"));
    }

    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn standard_nar_strongman_triggers_must_be_explicit_bypass_policy() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["protection_cause_policy"]["doctor_protect"]["bypasses"]
        .as_array_mut()
        .unwrap()
        .retain(|cause| cause != "unstoppable_vengeful_retaliates");
    value["standard_nar"]["target_state_save_policy"]["bulletproof"]["bypasses"]
        .as_array_mut()
        .unwrap()
        .retain(|cause| cause != "unstoppable_vengeful_retaliates");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.protection_cause_policy.doctor_protect",
        "does not classify kill cause `unstoppable_vengeful_retaliates`",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy.bulletproof",
        "does not classify kill cause `unstoppable_vengeful_retaliates`",
    );
}

#[test]
fn standard_nar_chosen_retaliation_cause_policy_classifies_every_retaliate_action() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["chosen_retaliation_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("hunter_retaliate");
    value["standard_nar"]["chosen_retaliation_cause_policy"]["unknown_retaliate"] =
        json!({ "strongman_bypasses_protect": false });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.chosen_retaliation_cause_policy",
        "Retaliate action `hunter_retaliate` must declare chosen retaliation cause policy",
    );
    assert_issue(
        &err,
        "standard_nar.chosen_retaliation_cause_policy.unknown_retaliate",
        "unknown standard_nar Retaliate action",
    );

    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    value["standard_nar"]["chosen_retaliation_cause_policy"]["hunter_retaliate"] =
        json!({ "strongman_bypasses_protect": true });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.chosen_retaliation_cause_policy.hunter_retaliate.strongman_bypasses_protect",
        "must match Strongman modifier",
    );
}

#[test]
fn standard_nar_generated_kill_cause_policy_classifies_every_kill_trigger() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["generated_kill_cause_policy"]
        .as_object_mut()
        .unwrap()
        .remove("pgo_shoots_visitor");
    value["standard_nar"]["generated_kill_cause_policy"]["unknown_generated_kill"] = json!({ "on": "Kill", "actor": "Target", "target": "Actor", "strongman_bypasses_protect": false });
    value["standard_nar"]["generated_kill_cause_policy"]["super_saint_retaliates"] =
        json!({ "strongman_bypasses_protect": false });
    value["standard_nar"]["generated_kill_cause_policy"]["vengeful_retaliates"] = json!({ "on": "Visit", "actor": "Actor", "target": "Killer", "strongman_bypasses_protect": true });
    value["standard_nar"]["generated_kill_cause_policy"]["unstoppable_vengeful_retaliates"] = json!({ "on": "Kill", "actor": "Target", "target": "Actor", "strongman_bypasses_protect": false });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy",
        "generated kill trigger `pgo_shoots_visitor` must declare generated kill cause policy",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.pgo_shoots_visitor",
        "must also declare generated kill cause policy",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.unknown_generated_kill",
        "unknown standard_nar generated kill trigger",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.super_saint_retaliates.on",
        "must declare trigger on",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.super_saint_retaliates.actor",
        "must declare produced actor",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.super_saint_retaliates.target",
        "must declare produced target",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.vengeful_retaliates.on",
        "on must match trigger rule",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.vengeful_retaliates.actor",
        "actor must match trigger production",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.vengeful_retaliates.target",
        "target must match trigger production",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.vengeful_retaliates.strongman_bypasses_protect",
        "must match produced Strongman modifier",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.unstoppable_vengeful_retaliates.strongman_bypasses_protect",
        "must match produced Strongman modifier",
    );
}

#[test]
fn standard_nar_trigger_fixpoint_policy_classifies_every_generated_kill_trigger() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["trigger_fixpoint_policy"]
        .as_object_mut()
        .unwrap()
        .remove("pgo_shoots_visitor");
    value["standard_nar"]["trigger_fixpoint_policy"]["unknown_trigger"] = json!({
        "on": "Kill",
        "produced_kill_reenters": true,
        "loop_cap": "RedirectLoopCap",
        "trace": true
    });
    value["standard_nar"]["trigger_fixpoint_policy"]["super_saint_retaliates"] = json!({
        "produced_kill_reenters": false,
        "loop_cap": "RedirectLoopCap",
        "trace": true
    });
    value["standard_nar"]["trigger_fixpoint_policy"]["vengeful_retaliates"] = json!({
        "on": "Visit",
        "produced_kill_reenters": true,
        "trace": true
    });
    value["standard_nar"]["trigger_fixpoint_policy"]["unstoppable_vengeful_retaliates"] = json!({
        "on": "Kill",
        "produced_kill_reenters": true,
        "loop_cap": "RedirectLoopCap",
        "trace": false
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy",
        "generated kill trigger `pgo_shoots_visitor` must declare trigger fixpoint policy",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_cause_policy.pgo_shoots_visitor",
        "must also declare trigger fixpoint policy",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.unknown_trigger",
        "unknown standard_nar trigger fixpoint source",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.super_saint_retaliates.on",
        "must declare observed trigger on",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.super_saint_retaliates.produced_kill_reenters",
        "must declare produced_kill_reenters true",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.vengeful_retaliates.on",
        "on must match trigger rule",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.vengeful_retaliates.loop_cap",
        "must declare loop_cap policy",
    );
    assert_issue(
        &err,
        "standard_nar.trigger_fixpoint_policy.unstoppable_vengeful_retaliates.trace",
        "must declare trace true",
    );
}

#[test]
fn standard_nar_generated_kill_ownership_matrix_tracks_cross_table_coverage() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["protection_cause_policy"]["doctor_protect"]["blocks"]
        .as_array_mut()
        .unwrap()
        .retain(|cause| cause != "pgo_shoots_visitor");
    value["standard_nar"]["target_state_save_policy"]["bulletproof"]["blocks"]
        .as_array_mut()
        .unwrap()
        .retain(|cause| cause != "pgo_shoots_visitor");
    value["standard_nar"]["suppression_policy"]["roleblocker_block"]["suppresses"]
        .as_array_mut()
        .unwrap()
        .retain(|action_id| action_id != "visit");

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "is not owned by protection source `doctor_protect`",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "is not owned by target-state save `bulletproof`",
    );
    assert_issue(
        &err,
        "standard_nar.generated_kill_ownership.pgo_shoots_visitor",
        "feeder action `visit` is not owned by block source `roleblocker_block`",
    );
}

#[test]
fn standard_nar_strongman_bypass_is_explicit_policy_not_precedence_exception() {
    let mut value = serde_json::to_value(load_pack_named("mafiascum")).unwrap();
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["standard_nar"]["strongman_bypasses_protect"] = json!(false);
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.strongman_bypasses_protect",
        "requires strongman_bypasses_protect true",
    );

    value["standard_nar"]["strongman_bypasses_protect"] = json!(true);
    for rule in value["precedence"].as_array_mut().unwrap() {
        if rule["when"]["effect"] == "Protect"
            && rule["beats"]
                .as_array()
                .unwrap()
                .iter()
                .any(|ability| ability == "Kill")
        {
            rule["unless_modifiers"] = json!([]);
        }
    }
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn death_retaliation_policy_requires_v14_roles_and_consistent_causes() {
    let mut value = valid_pack_value();
    value["death_retaliation"] = json!({
        "enabled": true,
        "eligible_roles": ["missing_hunter", ""],
        "allowed_death_causes": ["wolf_night_kill", "", "poison_potion"],
        "suppressed_death_causes": ["poison_potion", ""]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "death_retaliation", "requires ir_version >= 14");
    assert_issue(
        &err,
        "death_retaliation.eligible_roles",
        "unknown eligible role `missing_hunter`",
    );
    assert_issue(&err, "death_retaliation", "causes must not be empty");
    assert_issue(
        &err,
        "death_retaliation",
        "death cause `poison_potion` cannot be both allowed and suppressed",
    );
    assert_issue(&err, "death_retaliation.timing", "must declare timing");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(14);
    value["roles"]["hunter"] = json!({
        "description": "Hunter.",
        "alignment": "town",
        "actions": [{
            "id": "hunter_retaliate",
            "ability": "Retaliate",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 35
            }
        }]
    });
    value["death_retaliation"] = json!({
        "enabled": true,
        "eligible_roles": ["hunter"],
        "timing": "ImmediateBeforePhaseAnnouncement",
        "allowed_death_causes": ["wolf_night_kill"],
        "suppressed_death_causes": ["poison_potion"]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn idiot_policy_requires_v15_role_effect_and_day_cadence() {
    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    value["idiot_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["missing_idiot", ""],
        "vote_loss_effect": "missing_effect",
        "survival_reason": ""
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "idiot_policy", "requires ir_version >= 15");
    assert_issue(
        &err,
        "idiot_policy.eligible_roles",
        "unknown eligible role `missing_idiot`",
    );
    assert_issue(
        &err,
        "idiot_policy.vote_loss_effect",
        "unknown vote loss effect `missing_effect`",
    );
    assert_issue(
        &err,
        "idiot_policy.survival_reason",
        "survival_reason must not be empty",
    );
    assert_issue(&err, "idiot_policy", "requires Day in phases.cadence");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(15);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["roles"]["idiot"] = json!({
        "description": "Idiot.",
        "alignment": "town",
        "actions": []
    });
    value["effects"] = json!({
        "idiot_vote_loss": {
            "duration": "Persistent",
            "visibility": "Public"
        }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["idiot_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["idiot"],
        "vote_loss_effect": "idiot_vote_loss",
        "survival_reason": "idiot_survival"
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn saulus_policy_requires_v62_role_alignment_and_day_cadence() {
    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    value["saulus_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["missing_saulus", ""],
        "target_alignment": "missing_alignment",
        "survival_reason": ""
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "saulus_policy", "requires ir_version >= 62");
    assert_issue(
        &err,
        "saulus_policy.eligible_roles",
        "unknown eligible role `missing_saulus`",
    );
    assert_issue(
        &err,
        "saulus_policy.target_alignment",
        "unknown alignment `missing_alignment`",
    );
    assert_issue(
        &err,
        "saulus_policy.survival_reason",
        "survival_reason must not be empty",
    );
    assert_issue(&err, "saulus_policy", "requires Day in phases.cadence");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(62);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["roles"]["saulus"] = json!({
        "description": "Saulus.",
        "alignment": "mafia",
        "actions": []
    });
    value["saulus_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["saulus"],
        "target_alignment": "town",
        "survival_reason": "saulus_conversion"
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn lover_policy_requires_v16_link_effect_and_night_cadence() {
    let mut value = valid_pack_value();
    value["lover_policy"] = json!({
        "enabled": true,
        "link_effect": "missing_lovers_link",
        "suicide_cause": "",
        "suicide_on_lover_death": true,
        "lovers_known_to_each_other": true,
        "source_helper_role": ""
    });
    value["phases"]["cadence"] = json!(["Day"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "lover_policy", "requires ir_version >= 16");
    assert_issue(
        &err,
        "lover_policy.link_effect",
        "unknown lover link effect `missing_lovers_link`",
    );
    assert_issue(
        &err,
        "lover_policy.suicide_cause",
        "suicide_cause must not be empty",
    );
    assert_issue(
        &err,
        "lover_policy.source_helper_role",
        "source_helper_role must not be empty",
    );
    assert_issue(&err, "lover_policy", "requires Night in phases.cadence");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(16);
    value["effects"] = json!({
        "lovers_link": {
            "duration": "Persistent",
            "visibility": "Hidden"
        }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["lover_policy"] = json!({
        "enabled": true,
        "link_effect": "lovers_link",
        "suicide_cause": "lover_suicide",
        "suicide_on_lover_death": false,
        "lovers_known_to_each_other": false,
        "source_helper_role": "lovers_helper"
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn backup_policy_requires_v17_declared_effect_and_role_refs() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(16);
    value["effects"] = json!({
        "backup_target": { "duration": "Persistent", "visibility": "Hidden" },
        "backup:missing_role": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["backup_policy"] = json!({
        "enabled": true,
        "passive_effect_prefix": "backup:",
        "targeted_effect": "backup_target"
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "backup_policy", "requires ir_version >= 17");
    assert_issue(
        &err,
        "backup_policy.passive_effect_prefix",
        "unknown role `missing_role`",
    );

    value["ir_version"] = json!(17);
    value["effects"] = json!({
        "backup:cop": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "backup_policy.targeted_effect",
        "unknown targeted backup effect",
    );

    value["effects"] = json!({
        "backup_target": { "duration": "Persistent", "visibility": "Hidden" },
        "backup:cop": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn backup_priority_policy_is_explicit_and_versioned() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(67);
    value["effects"] = json!({
        "backup_target": { "duration": "Persistent", "visibility": "Hidden" },
        "backup:cop": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["backup_policy"] = json!({
        "enabled": true,
        "passive_effect_prefix": "backup:",
        "targeted_effect": "backup_target",
        "priority": "PassiveThenTargeted"
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "backup_policy.priority", "requires ir_version >= 68");
    assert_issue(&err, "ir_version", "backup_policy.priority");

    value["ir_version"] = json!(68);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn backup_priority_defaults_to_targeted_then_passive_when_omitted() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(17);
    value["effects"] = json!({
        "backup_target": { "duration": "Persistent", "visibility": "Hidden" },
        "backup:cop": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["backup_policy"] = json!({
        "enabled": true,
        "passive_effect_prefix": "backup:",
        "targeted_effect": "backup_target"
    });

    let pack = pack_from_value(value);
    validate_pack(&pack).unwrap();
    assert_eq!(
        pack.backup_policy.effective_priority(),
        domain::pack::BackupPriorityPolicy::TargetedThenPassive
    );
}

#[test]
fn private_channel_policy_requires_v29_roles_and_group_contracts() {
    let mut value = valid_pack_value();
    value["roles"]["mason"] = json!({
        "description": "Mason.",
        "alignment": "town",
        "actions": [],
        "effects": ["mason"]
    });
    value["roles"]["encryptor"] = json!({
        "description": "Encryptor.",
        "alignment": "mafia",
        "actions": []
    });
    value["roles"]["traitor"] = json!({
        "description": "Traitor.",
        "alignment": "mafia",
        "actions": []
    });
    value["private_channels"] = json!({
        "enabled": true,
        "groups": [
            {
                "id": "mason",
                "kind": "Mason",
                "roles": ["mason", "missing_role", "mason"],
                "excluded_roles": ["traitor"],
                "reveals_alignment": "None"
            },
            {
                "id": "neighbor",
                "kind": "Neighbor",
                "roles": [],
                "reveals_alignment": "Town"
            },
            {
                "id": "neighbor",
                "kind": "Neighbor",
                "roles": ["townie"],
                "reveals_alignment": "None"
            },
            {
                "id": "mafia_day_chat",
                "kind": "FactionDayChat",
                "roles": ["encryptor"],
                "member_alignments": [],
                "enabled_by_roles": ["encryptor", "missing_encryptor", "encryptor"],
                "excluded_roles": ["missing_traitor", "traitor", "traitor", ""],
                "active_while_source_alive": false,
                "reveals_alignment": "Town"
            }
        ]
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "private_channels", "requires ir_version >= 29");
    assert_issue(
        &err,
        "private_channels.mason.roles",
        "unknown private channel role `missing_role`",
    );
    assert_issue(
        &err,
        "private_channels.mason.roles",
        "duplicate private channel role `mason`",
    );
    assert_issue(
        &err,
        "private_channels.mason.reveals_alignment",
        "mason private channels must reveal Town alignment",
    );
    assert_issue(
        &err,
        "private_channels.mason.excluded_roles",
        "private channel role exclusions require ir_version >= 64",
    );
    assert_issue(
        &err,
        "private_channels.mason.excluded_roles",
        "role-based private channels must not declare excluded_roles",
    );
    assert_issue(
        &err,
        "private_channels.neighbor",
        "private channel group roles must not be empty",
    );
    assert_issue(
        &err,
        "private_channels.neighbor",
        "duplicate private channel group id `neighbor`",
    );
    assert_issue(
        &err,
        "private_channels.neighbor.reveals_alignment",
        "neighbor private channels must not reveal alignment",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.enabled_by_roles",
        "unknown private channel enabling role `missing_encryptor`",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.enabled_by_roles",
        "duplicate private channel enabling role `encryptor`",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.excluded_roles",
        "private channel role exclusions require ir_version >= 64",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.excluded_roles",
        "unknown private channel excluded role `missing_traitor`",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.excluded_roles",
        "duplicate private channel excluded role `traitor`",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.excluded_roles",
        "private channel excluded role must not be empty",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.reveals_alignment",
        "faction day-chat private channels must not reveal alignment",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.roles",
        "faction day-chat private channels use member_alignments, not roles",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.member_alignments",
        "faction day-chat private channels must declare member_alignments",
    );
    assert_issue(
        &err,
        "private_channels.mafia_day_chat.active_while_source_alive",
        "faction day-chat private channels must be source-alive gated",
    );

    value["ir_version"] = json!(64);
    value["visibility_families"] = json!(["EffectAudiences", "PrivateChannels"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["roles"]["neighbor"] = json!({
        "description": "Neighbor.",
        "actions": [],
        "effects": ["neighbor"]
    });
    value["private_channels"] = json!({
        "enabled": true,
        "groups": [
            {
                "id": "mason",
                "kind": "Mason",
                "roles": ["mason"],
                "reveals_alignment": "Town"
            },
            {
                "id": "neighbor",
                "kind": "Neighbor",
                "roles": ["neighbor"],
                "reveals_alignment": "None"
            },
            {
                "id": "mafia_day_chat",
                "kind": "FactionDayChat",
                "member_alignments": ["mafia"],
                "enabled_by_roles": ["encryptor"],
                "excluded_roles": ["traitor"],
                "active_while_source_alive": true,
                "reveals_alignment": "None"
            }
        ]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn treestump_policy_requires_v30_roles_and_status_tag_contract() {
    let mut value = valid_pack_value();
    value["roles"]["town_treestump"] = json!({
        "description": "Treestump.",
        "alignment": "town",
        "actions": []
    });
    value["treestump_policy"] = json!({
        "enabled": true,
        "status_tag": "",
        "eligible_roles": ["town_treestump", "missing_role", "town_treestump"]
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "treestump_policy", "requires ir_version >= 30");
    assert_issue(&err, "treestump_policy.status_tag", "must not be empty");
    assert_issue(
        &err,
        "treestump_policy.eligible_roles",
        "unknown treestump role `missing_role`",
    );
    assert_issue(
        &err,
        "treestump_policy.eligible_roles",
        "duplicate treestump role `town_treestump`",
    );

    value["ir_version"] = json!(30);
    value["treestump_policy"] = json!({
        "enabled": true,
        "status_tag": "treestump",
        "eligible_roles": ["town_treestump"]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn target_lynch_win_policies_require_v19_declared_effect_role_winner_and_unique_id_refs() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(18);
    value["roles"]["executioner"] = json!({
        "description": "Executioner.",
        "alignment": "executioner",
        "actions": []
    });
    value["target_lynch_win_policies"] = json!([
        {
            "id": "executioner",
            "target_effect": "missing_execution_target",
            "eligible_roles": ["missing_role"],
            "winner": "missing_alignment"
        },
        {
            "id": "executioner",
            "target_effect": "",
            "eligible_roles": [],
            "winner": "executioner"
        }
    ]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "target_lynch_win_policies",
        "require ir_version >= 19",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[0].target_effect",
        "unknown target effect",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[0].eligible_roles",
        "unknown eligible role",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[0].winner",
        "unknown alignment",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[1].target_effect",
        "must not be empty",
    );
    assert_issue(
        &err,
        "target_lynch_win_policies[1].eligible_roles",
        "must declare eligible_roles",
    );
    assert_issue(&err, "target_lynch_win_policies.id", "duplicate");

    value["ir_version"] = json!(19);
    value["phases"]["cadence"] = json!(["Day", "Night"]);
    value["roles"]["condemner"] = json!({
        "description": "Condemner.",
        "alignment": "condemner",
        "actions": []
    });
    value["effects"] = json!({
        "condemner_target": { "duration": "Persistent", "visibility": "Hidden" },
        "execution_target": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["target_lynch_win_policies"] = json!([
        {
            "id": "condemner",
            "target_effect": "condemner_target",
            "eligible_roles": ["condemner"],
            "winner": "condemner"
        },
        {
            "id": "executioner",
            "target_effect": "execution_target",
            "eligible_roles": ["executioner"],
            "winner": "executioner"
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn target_lynch_win_policies_must_not_duplicate_role_effect_sources() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(19);
    value["roles"]["executioner"] = json!({
        "description": "Executioner.",
        "alignment": "executioner",
        "actions": []
    });
    value["effects"] = json!({
        "execution_target": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["target_lynch_win_policies"] = json!([
        {
            "id": "executioner_primary",
            "target_effect": "execution_target",
            "eligible_roles": ["executioner"],
            "winner": "executioner"
        },
        {
            "id": "executioner_shadow",
            "target_effect": "execution_target",
            "eligible_roles": ["executioner"],
            "winner": "executioner"
        }
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "target_lynch_win_policies[1].eligible_roles",
        "duplicate target lynch win source `execution_target` for eligible role `executioner`",
    );
}

#[test]
fn self_lynch_win_policies_require_v25_declared_role_winner_day_and_source_event() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["self_lynch_win_policies"] = json!([
        {
            "id": "jester",
            "eligible_roles": ["missing_role"],
            "winner": "missing_alignment",
            "source_event": "jester"
        },
        {
            "id": "jester",
            "eligible_roles": [],
            "winner": "town"
        }
    ]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "self_lynch_win_policies", "require ir_version >= 25");
    assert_issue(
        &err,
        "self_lynch_win_policies[0].eligible_roles",
        "unknown eligible role",
    );
    assert_issue(
        &err,
        "self_lynch_win_policies[0].winner",
        "unknown alignment",
    );
    assert_issue(
        &err,
        "self_lynch_win_policies[0].source_event",
        "must start with `win.`",
    );
    assert_issue(
        &err,
        "self_lynch_win_policies[1].eligible_roles",
        "must declare eligible_roles",
    );
    assert_issue(&err, "self_lynch_win_policies.id", "duplicate");

    value["ir_version"] = json!(25);
    value["roles"]["jester"] = json!({
        "description": "Jester.",
        "alignment": "jester",
        "actions": []
    });
    value["self_lynch_win_policies"] = json!([
        {
            "id": "jester",
            "eligible_roles": ["jester"],
            "winner": "jester",
            "source_event": "win.jester"
        }
    ]);
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["phases"]["cadence"] = json!(["Night"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "self_lynch_win_policies",
        "require Day in phases.cadence",
    );
}

#[test]
fn self_lynch_win_policies_reject_duplicate_role_source_pairs() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(25);
    value["roles"]["jester"] = json!({
        "description": "Jester.",
        "alignment": "jester",
        "actions": []
    });
    value["self_lynch_win_policies"] = json!([
        {
            "id": "jester_primary",
            "eligible_roles": ["jester"],
            "winner": "jester",
            "source_event": "win.jester"
        },
        {
            "id": "jester_shadow",
            "eligible_roles": ["jester"],
            "winner": "jester",
            "source_event": "win.jester"
        }
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "self_lynch_win_policies[1].eligible_roles",
        "duplicate self lynch win source `win.jester` for eligible role `jester`",
    );
}

#[test]
fn beloved_princess_policy_requires_v20_roles_prompt_and_causes() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(19);
    value["beloved_princess_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["missing_role"],
        "all_death_causes": true,
        "prompt_kind": "",
        "prompt_reason": "",
        "death_causes": ["lynch", "lynch", ""]
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "beloved_princess_policy", "requires ir_version >= 20");
    assert_issue(
        &err,
        "beloved_princess_policy.all_death_causes",
        "requires ir_version >= 65",
    );
    assert_issue(
        &err,
        "beloved_princess_policy.eligible_roles",
        "unknown eligible role",
    );
    assert_issue(
        &err,
        "beloved_princess_policy.prompt_kind",
        "must not be empty",
    );
    assert_issue(
        &err,
        "beloved_princess_policy.prompt_reason",
        "must not be empty",
    );
    assert_issue(&err, "beloved_princess_policy.death_causes", "duplicate");
    assert_issue(
        &err,
        "beloved_princess_policy.death_causes",
        "must not be empty",
    );

    value["ir_version"] = json!(65);
    value["phases"]["cadence"] = json!(["Day", "Night"]);
    value["roles"]["beloved_princess"] = json!({
        "description": "Beloved Princess.",
        "alignment": "town",
        "actions": []
    });
    value["beloved_princess_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["beloved_princess"],
        "all_death_causes": true,
        "prompt_kind": "skip_next_day",
        "prompt_reason": "beloved_princess_death",
        "death_causes": []
    });
    value["host_prompt_resolution_effects"] = json!([{
        "id": "beloved_princess_skip_next_day",
        "prompt_kind": "skip_next_day",
        "prompt_reason": "beloved_princess_death",
        "decision": "Acknowledge",
        "effect": "SkipNextDay"
    }]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn day_vote_prompt_policies_require_v21_statuses_prompt_fields_and_unique_ids() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(20);
    value["day_vote_prompt_policies"] = json!([
        {
            "id": "no_majority_revote",
            "statuses": ["NoMajority", "NoMajority"],
            "prompt_kind": "",
            "prompt_reason": ""
        },
        {
            "id": "no_majority_revote",
            "statuses": [],
            "prompt_kind": "revote",
            "prompt_reason": "no_majority"
        }
    ]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(&err, "day_vote_prompt_policies", "require ir_version >= 21");
    assert_issue(&err, "day_vote_prompt_policies[0].statuses", "duplicate");
    assert_issue(
        &err,
        "day_vote_prompt_policies[0].prompt_kind",
        "must not be empty",
    );
    assert_issue(
        &err,
        "day_vote_prompt_policies[0].prompt_reason",
        "must not be empty",
    );
    assert_issue(
        &err,
        "day_vote_prompt_policies[1].statuses",
        "must declare statuses",
    );
    assert_issue(&err, "day_vote_prompt_policies.id", "duplicate");

    value["ir_version"] = json!(21);
    value["phases"]["cadence"] = json!(["Day", "Night"]);
    value["day_vote_prompt_policies"] = json!([
        {
            "id": "no_majority_revote",
            "statuses": ["NoMajority"],
            "prompt_kind": "revote",
            "prompt_reason": "no_majority"
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn host_prompt_resolution_effects_require_v22_fields_decisions_and_unique_implicit_prompts() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(21);
    value["host_prompt_resolution_effects"] = json!([
        {
            "id": "",
            "prompt_kind": "",
            "prompt_reason": "",
            "decision": "Acknowledge",
            "effect": "PkKill"
        },
        {
            "id": "dup",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "SelectSlot",
            "effect": "AdvanceRevote"
        },
        {
            "id": "dup",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AdvanceRevote"
        },
        {
            "id": "dup_ack",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AcknowledgeOnly"
        },
        {
            "id": "select_skip",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "SelectPolicy",
            "effect": "SkipNextDay"
        }
    ]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "host_prompt_resolution_effects",
        "require ir_version >= 22",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects[0].id",
        "must not be empty",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects[0].prompt_kind",
        "must not be empty",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects[0].prompt_reason",
        "must not be empty",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects[0].decision",
        "PkKill prompt effects require SelectSlot",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects[1].decision",
        "SelectSlot decisions are only valid for PkKill",
    );
    assert_issue(&err, "host_prompt_resolution_effects.id", "duplicate");
    assert_issue(
        &err,
        "host_prompt_resolution_effects[4].decision",
        "SelectPolicy decisions are only valid",
    );
    assert_issue(
        &err,
        "host_prompt_resolution_effects.implicit_prompt_decision",
        "duplicate",
    );

    value["ir_version"] = json!(22);
    value["host_prompt_resolution_effects"] = json!([
        {
            "id": "no_majority_revote",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AdvanceRevote"
        },
        {
            "id": "no_majority_continue_revote",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "SelectPolicy",
            "effect": "AdvanceRevote"
        },
        {
            "id": "no_majority_no_lynch",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "SelectPolicy",
            "effect": "AdvanceNight"
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn host_prompt_resolution_effects_must_cover_declared_prompt_producers() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(65);
    value["phases"]["cadence"] = json!(["Day", "Night"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["roles"]["beloved_princess"] = json!({
        "description": "Beloved Princess.",
        "alignment": "town",
        "actions": []
    });
    value["beloved_princess_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["beloved_princess"],
        "all_death_causes": true,
        "prompt_kind": "skip_next_day",
        "prompt_reason": "beloved_princess_death",
        "death_causes": []
    });
    value["day_vote_prompt_policies"] = json!([
        {
            "id": "no_majority_revote",
            "statuses": ["NoMajority"],
            "prompt_kind": "revote",
            "prompt_reason": "no_majority"
        }
    ]);
    value["host_prompt_resolution_effects"] = json!([
        {
            "id": "no_majority_revote",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AdvanceRevote"
        }
    ]);

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "host_prompt_resolution_effects",
        "missing resolution effect for prompt skip_next_day:beloved_princess_death",
    );

    value["host_prompt_resolution_effects"] = json!([
        {
            "id": "beloved_princess_skip_next_day",
            "prompt_kind": "skip_next_day",
            "prompt_reason": "beloved_princess_death",
            "decision": "Acknowledge",
            "effect": "SkipNextDay"
        },
        {
            "id": "no_majority_revote",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AdvanceRevote"
        }
    ]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn link_action_effect_must_reference_declared_effect_metadata() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(16);
    value["roles"]["cupid"] = json!({
        "description": "Cupid.",
        "alignment": "town",
        "actions": [{
            "id": "link_lovers",
            "ability": "Link",
            "effect": "missing_lovers_link",
            "window": "Night",
            "targets": "Many",
            "modifiers": [],
            "constraints": {
                "max_targets": 2,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": false,
                "priority": 55
            }
        }]
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cupid.actions[0].effect",
        "unknown effect tag `missing_lovers_link`",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(16);
    value["effects"] = json!({
        "lovers_link": {
            "duration": "Persistent",
            "visibility": "Hidden"
        }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    value["roles"]["cupid"] = json!({
        "description": "Cupid.",
        "alignment": "town",
        "actions": [{
            "id": "link_lovers",
            "ability": "Link",
            "effect": "lovers_link",
            "window": "Night",
            "targets": "Many",
            "modifiers": [],
            "constraints": {
                "max_targets": 2,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": false,
                "priority": 55
            }
        }]
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn day_note_policy_requires_day_cadence_and_consistent_announcement_gates() {
    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    value["day_notes"] = json!({
        "announcements": {
            "enabled": true,
            "night_deaths_after_n1": false,
            "multiple_night_deaths_n2plus": true
        },
        "last_words": { "day_deaths": true }
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "day_notes", "requires Day in phases.cadence");
    assert_issue(
        &err,
        "day_notes.announcements.multiple_night_deaths_n2plus",
        "requires night_deaths_after_n1",
    );

    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["day_notes"] = json!({
        "announcements": {
            "enabled": true,
            "night_deaths_n1": true,
            "night_deaths_after_n1": true,
            "multiple_night_deaths_n2plus": true
        },
        "last_words": { "day_deaths": true }
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn day_note_templates_audiences_windows_require_v63_and_enabled_policies() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(62);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["day_notes"] = json!({
        "announcements": {
            "enabled": false,
            "template_id": "",
            "audience": "public",
            "role_payload": "Hidden",
            "night_deaths_n1": true,
            "night_deaths_after_n1": true
        },
        "last_words": {
            "day_deaths": false,
            "template_id": "last_words",
            "audience": "",
            "window": "post_lynch"
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 63",
    );
    assert_issue(&err, "ir_version", "day_notes.templates");
    assert_issue(
        &err,
        "day_notes.announcements.template_id",
        "must not be empty",
    );
    assert_issue(
        &err,
        "day_notes.announcements",
        "metadata requires enabled announcements",
    );
    assert_issue(&err, "day_notes.last_words.audience", "must not be empty");
    assert_issue(&err, "day_notes.last_words", "metadata requires day_deaths");

    value["ir_version"] = json!(63);
    value["day_notes"]["announcements"]["enabled"] = json!(true);
    value["day_notes"]["announcements"]["template_id"] = json!("night_death");
    value["day_notes"]["last_words"]["day_deaths"] = json!(true);
    value["day_notes"]["last_words"]["audience"] = json!("public");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn day_death_announcement_metadata_requires_v67_and_complete_policy() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(65);
    value["phases"]["cadence"] = json!(["Night"]);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["day_notes"] = json!({
        "day_deaths": {
            "enabled": true
        }
    });

    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 66",
    );
    assert_issue(&err, "ir_version", "day_notes.day_death_announcements");
    assert_issue(&err, "day_notes", "requires Day in phases.cadence");
    assert_issue(
        &err,
        "day_notes.day_deaths.template_id",
        "enabled day-death announcements require template_id",
    );
    assert_issue(
        &err,
        "day_notes.day_deaths.audience",
        "enabled day-death announcements require audience",
    );

    value["ir_version"] = json!(66);
    value["phases"]["cadence"] = json!(["Night", "Day"]);
    value["day_notes"]["day_deaths"] = json!({
        "enabled": false,
        "template_id": "",
        "audience": ""
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "day_notes.day_deaths.template_id",
        "must not be empty",
    );
    assert_issue(&err, "day_notes.day_deaths.audience", "must not be empty");
    assert_issue(
        &err,
        "day_notes.day_deaths",
        "metadata requires enabled day_deaths",
    );

    value["ir_version"] = json!(66);
    value["day_notes"]["day_deaths"] = json!({
        "enabled": true,
        "template_id": "day_death",
        "audience": "public",
        "cause_templates": {
            "missing_cause": {
                "template_id": "",
                "audience": ""
            }
        }
    });
    let err = validate_pack(&pack_from_value(value.clone())).unwrap_err();
    assert_issue(
        &err,
        "ir_version",
        "pack declares features requiring ir_version >= 67",
    );
    assert_issue(&err, "ir_version", "day_notes.day_death_cause_templates");
    assert_issue(
        &err,
        "day_notes.day_deaths.cause_templates.missing_cause",
        "unknown day-death cause `missing_cause`",
    );
    assert_issue(
        &err,
        "day_notes.day_deaths.cause_templates.missing_cause.template_id",
        "must not be empty",
    );
    assert_issue(
        &err,
        "day_notes.day_deaths.cause_templates.missing_cause.audience",
        "must not be empty",
    );

    value["ir_version"] = json!(67);
    value["day_notes"]["day_deaths"] = json!({
        "enabled": true,
        "template_id": "day_death",
        "audience": "public",
        "cause_templates": {
            "lynch": {
                "template_id": "lynch_death",
                "audience": "public"
            }
        }
    });
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn babysitter_modifier_requires_v5_and_protect_action() {
    let mut value = valid_pack_value();
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Protect");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Babysitter"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "Babysitter requires",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(5);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Kill");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Babysitter"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].modifiers",
        "only legal on Protect",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(5);
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Protect");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Babysitter"]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn hider_modifier_requires_v6_mark_single_host_and_resolution_effect() {
    let mut value = valid_pack_value();
    value["effects"] = json!({
        "hide_link": { "duration": "Resolution", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Mark");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Hider"]);
    action["effect"] = json!("hide_link");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].modifiers", "Hider requires");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(6);
    value["effects"] = json!({
        "hide_link": { "duration": "Resolution", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Kill");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Hider"]);
    action["effect"] = json!("hide_link");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].modifiers", "only legal on Mark");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(6);
    value["effects"] = json!({
        "hide_link": { "duration": "Persistent", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Mark");
    action["mode"] = Value::Null;
    action["targets"] = json!("Many");
    action["constraints"]["max_targets"] = json!(2);
    action["modifiers"] = json!(["Hider"]);
    action["effect"] = json!("hide_link");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cop.actions[0].targets", "exactly one host");
    assert_issue(
        &err,
        "roles.cop.actions[0].effect_duration",
        "resolution-scoped",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(6);
    value["effects"] = json!({
        "hide_link": { "duration": "Resolution", "visibility": "Hidden" }
    });
    set_effect_policy(&mut value, "doused", "Persistent", "ActorAndTarget");
    let action = &mut value["roles"]["cop"]["actions"][0];
    action["ability"] = json!("Mark");
    action["mode"] = Value::Null;
    action["modifiers"] = json!(["Hider"]);
    action["effect"] = json!("hide_link");
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn conversion_policy_requires_dead_target_policy_for_convert_actions() {
    let mut value = valid_pack_value();
    value["conversion_policy"] = json!({});

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "conversion_policy.on_dead_target",
        "must declare on_dead_target Block",
    );
    assert_issue(
        &err,
        "conversion_policy.on_pending_death",
        "must declare on_pending_death Block",
    );
}

#[test]
fn structured_conversion_is_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cult_leader"]["actions"][0]["effect"] = Value::Null;
    value["roles"]["cult_leader"]["actions"][0]["conversion"] = json!({
        "mode": "AssignRole"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cult_leader.actions[0].conversion.role",
        "must declare role",
    );

    let mut value = valid_pack_value();
    value["roles"]["cult_leader"]["actions"][0]["conversion"] = json!({
        "mode": "RestoreOriginal",
        "role": "townie"
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cult_leader.actions[0].conversion",
        "must not declare both",
    );
    assert_issue(
        &err,
        "roles.cult_leader.actions[0].conversion.role",
        "must not declare role",
    );
}

#[test]
fn composite_action_abilities_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["cop"]["actions"][0]["additional_abilities"] =
        json!(["Protect", "Protect", "Investigate"]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.cop.actions[0].additional_abilities",
        "duplicate ability `Protect`",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].additional_abilities",
        "cannot repeat the primary ability",
    );

    let mut value = valid_pack_value();
    value["roles"]["townie"]["actions"] = json!([{
        "id": "composed_info",
        "ability": "Protect",
        "additional_abilities": ["Investigate"],
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 40
        }
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.townie.actions[0].mode",
        "Investigate actions must declare mode",
    );

    let mut value = valid_pack_value();
    value["roles"]["townie"]["actions"] = json!([{
        "id": "swap",
        "ability": "Redirect",
        "window": "Night",
        "targets": "Many",
        "modifiers": [],
        "constraints": {
            "max_targets": 2,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 40
        }
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.townie.actions[0].redirect",
        "Redirect actions must declare redirect kind",
    );

    let mut value = valid_pack_value();
    value["roles"]["townie"]["actions"] = json!([
        {
            "id": "bad_swap",
            "ability": "Redirect",
            "redirect": "Swap",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 40
            }
        },
        {
            "id": "bad_pull",
            "ability": "Redirect",
            "redirect": "Pull",
            "window": "Night",
            "targets": "Many",
            "modifiers": [],
            "constraints": {
                "max_targets": 2,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 35
            }
        },
        {
            "id": "bad_rotate",
            "ability": "Redirect",
            "redirect": "Rotate",
            "window": "Night",
            "targets": "Many",
            "modifiers": [],
            "constraints": {
                "max_targets": 2,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 30
            }
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.townie.actions[0].constraints.max_targets",
        "Swap/Retarget redirects require max_targets = 2",
    );
    assert_issue(
        &err,
        "roles.townie.actions[1].constraints.max_targets",
        "Pull redirects require max_targets <= 1",
    );
    assert_issue(
        &err,
        "roles.townie.actions[2].redirect",
        "Rotate redirects require ir_version >= 25",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(25);
    value["roles"]["townie"]["actions"] = json!([{
        "id": "bad_rotate_one",
        "ability": "Redirect",
        "redirect": "Rotate",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 30
        }
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.townie.actions[0].constraints.max_targets",
        "Rotate redirects require Many targets with max_targets >= 3",
    );
}

#[test]
fn untargetable_target_state_actions_are_strict() {
    let mut value = valid_pack_value();
    value["roles"]["townie"]["actions"] = json!([
        {
            "id": "persistent_rolestop",
            "ability": "Mark",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 75
            },
            "effect": "untargetable"
        },
        {
            "id": "wrong_ability_rolestop",
            "ability": "Kill",
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 50
            },
            "effect": "untargetable"
        },
        {
            "id": "no_target_rolestop",
            "ability": "Mark",
            "window": "Night",
            "targets": "None",
            "modifiers": [],
            "constraints": {
                "max_targets": 0,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 75
            },
            "effect": "untargetable",
            "effect_duration": "Resolution"
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "roles.townie.actions[0].effect_duration",
        "untargetable target-state actions must be resolution-scoped",
    );
    assert_issue(
        &err,
        "roles.townie.actions[1].effect",
        "untargetable target-state actions must use Mark ability",
    );
    assert_issue(
        &err,
        "roles.townie.actions[2].targets",
        "untargetable target-state actions must target at least one slot",
    );

    let mut value = valid_pack_value();
    set_effect_policy(&mut value, "untargetable", "Resolution", "Hidden");
    value["roles"]["townie"]["actions"] = json!([{
        "id": "shield",
        "ability": "Mark",
        "window": "Night",
        "targets": "Many",
        "modifiers": [],
        "constraints": {
            "max_targets": 2,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 75
        },
        "effect": "untargetable",
        "effect_duration": "Resolution"
    }]);
    validate_pack(&pack_from_value(value)).expect("resolution-scoped targetful shield validates");
}

#[test]
fn ambiguous_or_unsupported_precedence_is_rejected() {
    let mut value = valid_pack_value();
    value["roles"]["arsonist"]["actions"][0]["constraints"]["priority"] = json!(30);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "precedence", "share priority 30 without precedence");

    let mut value = valid_pack_value();
    value["precedence"] = json!([
        {
            "id": "mark_before_kill",
            "when": { "effect": "Mark", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        },
        {
            "id": "duplicate_mark",
            "when": { "effect": "Mark", "target_state": null },
            "beats": ["Convert"],
            "blocked_by": [],
            "unless_modifiers": []
        },
        {
            "id": "unsupported_target_state",
            "when": { "effect": "Kill", "target_state": "alive" },
            "beats": ["Investigate"],
            "blocked_by": [],
            "unless_modifiers": []
        },
        {
            "id": "unsupported_unless",
            "when": { "effect": "Kill", "target_state": null },
            "beats": ["Convert"],
            "blocked_by": [],
            "unless_modifiers": ["Strongman"]
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "precedence[1].when", "duplicate precedence rule");
    assert_issue(
        &err,
        "precedence[2].when.target_state",
        "target_state precedence is not supported",
    );
    assert_issue(
        &err,
        "precedence[3].unless_modifiers",
        "supported only for Protect beating Kill",
    );
}

#[test]
fn precedence_cycles_are_rejected() {
    let mut value = valid_pack_value();
    value["precedence"] = json!([
        {
            "id": "mark_before_kill",
            "when": { "effect": "Mark", "target_state": null },
            "beats": ["Kill"],
            "blocked_by": [],
            "unless_modifiers": []
        },
        {
            "id": "kill_before_mark",
            "when": { "effect": "Kill", "target_state": null },
            "beats": ["Mark"],
            "blocked_by": [],
            "unless_modifiers": []
        }
    ]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "precedence",
        "cycle prevents deriving night ability order",
    );
}

#[test]
fn invalid_target_state_policy_fixture_is_rejected_by_pack_linter() {
    let pack = load_pack_named("test_invalid_target_state_policy");
    let err = validate_pack(&pack).unwrap_err();
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy",
        "enabled standard_nar policy must classify target-state saves",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_save_policy",
        "standard_nar target-state save `bulletproof` must classify every kill cause",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy",
        "enabled standard_nar policy must classify target-state gates",
    );
    assert_issue(
        &err,
        "standard_nar.target_state_gate_policy",
        "standard_nar target-state gate `commuted` must classify blocked abilities",
    );
}

#[test]
fn references_and_windows_are_checked() {
    let mut value = valid_pack_value();
    value["roles"]["cult_leader"]["actions"][0]["effect"] = json!("missing_role");
    value["roles"]["arsonist"]["actions"][1]["reads_effect"] = json!("missing_tag");
    value["roles"]["cop"]["actions"][0]["window"] = json!("Day");
    value["phases"]["cadence"] = json!(["Night"]);
    value["vote"]["weights"] = json!({ "PerRole": { "missing_role": 2.0 } });
    value["vote"]["threshold_adjustments"] = json!({ "missing_threshold_role": 1.0 });
    value["win"]["rules"][0]["winner"] = json!("missing_alignment");
    value["roles"]["trigger_tag_source"] = json!({
        "description": "Trigger tag source.",
        "alignment": "town",
        "actions": [],
        "effects": ["known_trigger_target", "known_trigger_actor"]
    });
    value["triggers"] = json!([{
        "id": "missing_effect_trigger",
        "on": "Kill",
        "if_target_has": ["", "missing_tag", "known_trigger_target", "known_trigger_target"],
        "if_actor_has": ["", "missing_actor_tag", "known_trigger_actor", "known_trigger_actor"],
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Killer",
            "modifiers": []
        }
    }, {
        "id": "missing_effect_trigger",
        "on": "Kill",
        "produces": {
            "ability": "Kill",
            "actor": "Target",
            "target": "Killer",
            "modifiers": []
        }
    }]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "roles.cult_leader.actions[0].effect", "unknown role");
    assert_issue(
        &err,
        "roles.arsonist.actions[1].reads_effect",
        "unknown effect tag",
    );
    assert_issue(
        &err,
        "roles.cop.actions[0].window",
        "absent from phases.cadence",
    );
    assert_issue(&err, "vote.weights", "unknown role");
    assert_issue(
        &err,
        "vote.threshold_adjustments",
        "unknown role `missing_threshold_role`",
    );
    assert_issue(&err, "win.rules[0].winner", "unknown alignment");
    assert_issue(&err, "triggers[0].if_target_has", "unknown effect tag");
    assert_issue(&err, "triggers[0].if_actor_has", "unknown effect tag");
    assert_issue(
        &err,
        "triggers[0].if_target_has",
        "trigger filter tags must not be empty",
    );
    assert_issue(
        &err,
        "triggers[0].if_actor_has",
        "trigger filter tags must not be empty",
    );
    assert_issue(
        &err,
        "triggers[0].if_target_has",
        "duplicate value `known_trigger_target`",
    );
    assert_issue(
        &err,
        "triggers[0].if_actor_has",
        "duplicate value `known_trigger_actor`",
    );
    assert_issue(&err, "triggers[1].id", "duplicate trigger id");
}

#[test]
fn trigger_production_shapes_are_strict() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["trigger_target"] = json!({
        "description": "Trigger target.",
        "alignment": "town",
        "actions": [],
        "effects": ["trigger_target"]
    });
    value["triggers"] = json!([
        {
            "id": "bad_visit_shape",
            "on": "Win",
            "if_target_has": ["trigger_target"],
            "produces": {
                "ability": "Visit",
                "actor": "Actor",
                "target": "Actor",
                "modifiers": ["Strongman"]
            }
        },
        {
            "id": "unsupported_generated_protect",
            "on": "Win",
            "if_target_has": ["trigger_target"],
            "produces": {
                "ability": "Protect",
                "actor": "Target",
                "target": "Target",
                "modifiers": []
            }
        },
        {
            "id": "unsupported_refs",
            "on": "Kill",
            "if_target_has": ["trigger_target"],
            "produces": {
                "ability": "Kill",
                "actor": "TargetGuard",
                "target": "Other",
                "modifiers": []
            }
        },
        {
            "id": "bad_kill_modifiers",
            "on": "Kill",
            "if_target_has": ["trigger_target"],
            "produces": {
                "ability": "Kill",
                "actor": "Target",
                "target": "Actor",
                "modifiers": ["Ninja", "Strongman", "Strongman"]
            }
        }
    ]);

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "triggers[0].produces.actor",
        "generated Visit triggers must use actor Target",
    );
    assert_issue(
        &err,
        "triggers[0].produces.target",
        "generated Visit triggers must use target Target",
    );
    assert_issue(
        &err,
        "triggers[0].produces.modifiers",
        "generated Visit triggers must not declare modifiers",
    );
    assert_issue(
        &err,
        "triggers[1].produces.ability",
        "support generated Kill or self-targeted Visit",
    );
    assert_issue(
        &err,
        "triggers[2].produces.actor",
        "only support Actor or Target actor refs",
    );
    assert_issue(
        &err,
        "triggers[2].produces.target",
        "only support Actor, Target, or Killer target refs",
    );
    assert_issue(
        &err,
        "triggers[3].produces.modifiers",
        "only support Strongman modifier, got `Ninja`",
    );
    assert_issue(
        &err,
        "triggers[3].produces.modifiers",
        "duplicate generated Kill modifier `Strongman`",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(24);
    value["roles"]["win_witness"] = json!({
        "description": "Win witness.",
        "alignment": "town",
        "actions": [],
        "effects": ["win_witness"]
    });
    value["triggers"] = json!([{
        "id": "win_witness_observes",
        "on": "Win",
        "if_target_has": ["win_witness"],
        "produces": {
            "ability": "Visit",
            "actor": "Target",
            "target": "Target",
            "modifiers": []
        }
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn vote_policy_combinations_are_strict() {
    let mut value = valid_pack_value();
    value["vote"]["method"] = json!({ "Supermajority": { "num": 1, "den": 2 } });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.method",
        "supermajority must be greater than one-half",
    );

    let mut value = valid_pack_value();
    value["vote"]["method"] = json!("Plurality");
    value["vote"]["hammer"] = json!(true);
    value["vote"]["threshold_adjustments"] = json!({ "townie": 1.0 });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.hammer",
        "hammer requires Majority or Supermajority",
    );
    assert_issue(
        &err,
        "vote.threshold_adjustments",
        "threshold adjustments require Majority or Supermajority",
    );

    let mut value = valid_pack_value();
    value["vote"]["weights"] = json!({
        "Dynamic": {
            "base": 1.0,
            "effect_rules": []
        }
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.weights.Dynamic",
        "dynamic vote weights must declare at least one effect or grant rule",
    );

    let mut value = valid_pack_value();
    value["vote"]["weights"] = json!({ "PerRole": {} });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.weights",
        "PerRole vote weights must declare at least one role override",
    );

    let mut value = valid_pack_value();
    value["vote"]["tie_breaker"] = json!("EarliestReached");
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["phases"]["cadence"] = json!(["Night"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "vote", "vote policy requires Day in phases.cadence");
}

#[test]
fn host_decided_vote_ties_require_prompt_resolution_policy() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(22);
    value["vote"]["method"] = json!("Plurality");
    value["vote"]["tie_breaker"] = json!("HostDecides");
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.tie_breaker",
        "HostDecides vote tie breaker requires a Tie day_vote_prompt_policy",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(22);
    value["vote"]["method"] = json!("Plurality");
    value["vote"]["tie_breaker"] = json!("HostDecides");
    value["day_vote_prompt_policies"] = json!([{
        "id": "pk_host_decides_tie",
        "statuses": ["Tie"],
        "prompt_kind": "pk",
        "prompt_reason": "host_decides_tie"
    }]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.tie_breaker",
        "requires a SelectSlot/PkKill host_prompt_resolution_effect",
    );

    let mut value = valid_pack_value();
    value["ir_version"] = json!(22);
    value["vote"]["method"] = json!("Plurality");
    value["vote"]["tie_breaker"] = json!("HostDecides");
    value["day_vote_prompt_policies"] = json!([{
        "id": "pk_host_decides_tie",
        "statuses": ["Tie"],
        "prompt_kind": "pk",
        "prompt_reason": "host_decides_tie"
    }]);
    value["host_prompt_resolution_effects"] = json!([{
        "id": "pk_host_decides_tie",
        "prompt_kind": "pk",
        "prompt_reason": "host_decides_tie",
        "decision": "SelectSlot",
        "effect": "PkKill"
    }]);
    validate_pack(&pack_from_value(value)).unwrap();
}

#[test]
fn per_role_vote_weights_must_reference_roles_and_be_nonnegative() {
    let mut value = valid_pack_value();
    value["vote"]["weights"] = json!({
        "PerRole": {
            "townie": 0.0,
            "cop": 2.0,
            "missing_role": 1.0,
            "cultist": -1.0
        }
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "vote.weights", "unknown role `missing_role`");
    assert_issue(
        &err,
        "vote.weights",
        "role `cultist` has invalid vote weight",
    );
}

#[test]
fn dynamic_vote_weights_must_reference_declared_effects_and_be_unambiguous() {
    let mut value = valid_pack_value();
    set_effect_policy(&mut value, "empowered_vote", "Persistent", "Public");
    value["ir_version"] = json!(2);
    value["roles"]["cop"]["actions"][0] = json!({
        "id": "grant_vote_power",
        "ability": "Grant",
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 50
        },
        "grant": {
            "grant_id": "vote_power_boost",
            "kind": "VoteWeight",
            "uses": 1,
            "vote_weight": 2.0,
            "visibility": "Target"
        }
    });
    value["vote"]["weights"] = json!({
        "Dynamic": {
            "base": 1.0,
            "effect_rules": [{
                "effect": "empowered_vote",
                "weight": 2.0,
                "priority": 10
            }],
            "grant_rules": [{
                "grant_id": "vote_power_boost",
                "priority": 20
            }]
        }
    });
    validate_pack(&pack_from_value(value.clone())).unwrap();

    value["vote"]["weights"] = json!({
        "Dynamic": {
            "base": -1.0,
            "effect_rules": [
                {
                    "effect": "missing_effect",
                    "weight": 2.0,
                    "priority": 10
                },
                {
                    "effect": "empowered_vote",
                    "weight": -0.5,
                    "priority": 10
                },
                {
                    "effect": "empowered_vote",
                    "weight": 0.0,
                    "priority": 20
                }
            ],
            "grant_rules": [
                {
                    "grant_id": "missing_vote_grant",
                    "priority": 20
                },
                {
                    "grant_id": "vote_power_boost",
                    "priority": 30
                },
                {
                    "grant_id": "vote_power_boost",
                    "priority": 30
                }
            ]
        }
    });
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.weights.Dynamic.base",
        "dynamic vote base weight must be finite and >= 0",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.effect_rules[0].effect",
        "unknown effect `missing_effect`",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.effect_rules[1].weight",
        "invalid weight",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.effect_rules[1].priority",
        "duplicate dynamic vote priority",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.effect_rules[2].effect",
        "duplicate dynamic vote effect `empowered_vote`",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.grant_rules[0].grant_id",
        "unknown VoteWeight grant `missing_vote_grant`",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.grant_rules[0].priority",
        "duplicate dynamic vote priority",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.grant_rules[2].grant_id",
        "duplicate dynamic vote grant `vote_power_boost`",
    );
    assert_issue(
        &err,
        "vote.weights.Dynamic.grant_rules[2].priority",
        "duplicate dynamic vote priority",
    );
}

#[test]
fn vote_threshold_adjustments_must_reference_roles() {
    let mut value = valid_pack_value();
    value["vote"]["threshold_adjustments"] = json!({
        "townie": 1.0,
        "cop": -1.0,
        "missing_role": 1.0
    });

    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(
        &err,
        "vote.threshold_adjustments",
        "unknown role `missing_role`",
    );
}

#[test]
fn vote_tiebreaker_roles_must_reference_roles() {
    let mut value = valid_pack_value();
    value["ir_version"] = json!(58);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["vote"]["tiebreaker_roles"] = json!(["townie"]);
    validate_pack(&pack_from_value(value)).unwrap();

    let mut value = valid_pack_value();
    value["ir_version"] = json!(57);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["vote"]["tiebreaker_roles"] = json!(["townie"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "ir_version", "vote.tiebreaker_roles");

    let mut value = valid_pack_value();
    value["ir_version"] = json!(58);
    value["visibility_families"] = json!(["EffectAudiences"]);
    value["win_families"] = json!(["FactionElimination", "FactionParity"]);
    value["vote"]["tiebreaker_roles"] = json!(["townie", "missing_role", "townie"]);
    let err = validate_pack(&pack_from_value(value)).unwrap_err();
    assert_issue(&err, "vote.tiebreaker_roles", "unknown role `missing_role`");
    assert_issue(
        &err,
        "vote.tiebreaker_roles",
        "duplicate tiebreaker role `townie`",
    );
}

fn assert_issue(err: &domain::PackValidationError, path: &str, message: &str) {
    assert!(
        err.issues
            .iter()
            .any(|issue| issue.path == path && issue.message.contains(message)),
        "expected issue {path:?} containing {message:?}, got {:#?}",
        err.issues
    );
}
