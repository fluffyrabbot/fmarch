use std::collections::BTreeSet;

use serde_json::{json, Value};

use super::model::*;
use super::validation::pack_required_ir_version;

fn test_pack_value() -> Value {
    json!({
        "name": "version-map-test",
        "version": SUPPORTED_PACK_VERSION,
        "ir_version": SUPPORTED_IR_VERSION,
        "night_resolution": { "mode": "Generic" },
        "roles": {
            "townie": {
                "description": "Town.",
                "alignment": "town",
                "actions": []
            }
        },
        "precedence": [],
        "visibility": {},
        "redirects": {
            "order": [],
            "loop_cap": 8,
            "tie_breaker": "Stable"
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
            "rules": []
        }
    })
}

fn test_pack_from_value(value: Value) -> Pack {
    serde_json::from_value(value).unwrap()
}

fn pack_required_from_value(value: Value) -> (u16, BTreeSet<&'static str>) {
    pack_required_ir_version(&test_pack_from_value(value))
}

fn test_action(ability: &str) -> Value {
    json!({
        "id": "versioned_action",
        "ability": ability,
        "window": "Night",
        "targets": "One",
        "modifiers": [],
        "constraints": {
            "max_targets": 1,
            "self_allowed": false,
            "unique_targets": true,
            "roleblockable": true,
            "priority": 10
        }
    })
}

fn pack_required_for_action(action: Value) -> (u16, BTreeSet<&'static str>) {
    let mut value = test_pack_value();
    value["roles"]["townie"]["actions"] = json!([action]);
    pack_required_from_value(value)
}

fn assert_versioned_action(action: Value, expected_version: u16, reason: &'static str) {
    let (required, reasons) = pack_required_for_action(action);
    assert_eq!(
            required, expected_version,
            "expected {reason} to require ir_version >= {expected_version}; got {required} from {reasons:?}"
        );
    assert!(
        reasons.contains(reason),
        "expected {reason} in required feature reasons {reasons:?}"
    );
}

fn assert_versioned_pack_feature(value: Value, expected_version: u16, reason: &'static str) {
    let (required, reasons) = pack_required_from_value(value);
    assert_eq!(
            required, expected_version,
            "expected {reason} to require ir_version >= {expected_version}; got {required} from {reasons:?}"
        );
    assert!(
        reasons.contains(reason),
        "expected {reason} in required feature reasons {reasons:?}"
    );
}

#[test]
fn pack_required_ir_version_covers_versioned_action_features() {
    for (ability, expected_version, reason) in [
        ("Grant", 2, "Grant"),
        ("Link", 3, "Link"),
        ("Retaliate", 4, "Retaliate"),
        ("Badge", 7, "Badge"),
        ("Duel", 8, "Duel"),
        ("ItaShot", 9, "ItaShot"),
        ("SelfDestruct", 10, "SelfDestruct"),
        ("Visit", 24, "Visit"),
        ("RevealTown", 33, "RevealTown"),
        ("VoteDuel", 34, "VoteDuel"),
        ("Veto", 47, "Veto"),
        ("Info", 54, "Info"),
    ] {
        let mut action = test_action(ability);
        if ability == "Info" {
            action["info"] = json!({ "kind": "test_info" });
        }
        assert_versioned_action(action, expected_version, reason);
    }

    let mut twilight_action = test_action("SelfDestruct");
    twilight_action["window"] = json!("Twilight");
    twilight_action["self_destruct"] = json!({
        "cause": "twilight_self_destruct",
        "kill_target": true,
        "sacrifice_actor": true,
        "unstoppable": true
    });
    assert_versioned_action(twilight_action, 48, "Twilight action window");

    let mut instant_action = test_action("SelfDestruct");
    instant_action["window"] = json!("Instant");
    instant_action["self_destruct"] = json!({
        "cause": "instant_self_destruct",
        "kill_target": true,
        "sacrifice_actor": true,
        "unstoppable": true
    });
    assert_versioned_action(instant_action, 49, "Instant action window");

    let mut babysitter = test_action("Protect");
    babysitter["modifiers"] = json!(["Babysitter"]);
    assert_versioned_action(babysitter, 5, "Babysitter");

    let mut hider = test_action("Mark");
    hider["modifiers"] = json!(["Hider"]);
    hider["effect"] = json!("hide_link");
    assert_versioned_action(hider, 6, "Hider");

    let mut disloyal = test_action("Convert");
    disloyal["modifiers"] = json!(["Disloyal"]);
    disloyal["conversion"] = json!({
        "mode": "AssignRole",
        "role": "cultist"
    });
    assert_versioned_action(disloyal, 57, "Disloyal");

    let mut result_memory = test_action("Investigate");
    result_memory["result_memory"] = json!({ "record": true });
    assert_versioned_action(result_memory, 23, "result_memory");

    let mut investigator_scoped_memory = test_action("Investigate");
    investigator_scoped_memory["result_memory"] = json!({
        "record": true,
        "compare_previous": true,
        "scope": "Investigator",
        "output": "SameDifferent"
    });
    assert_versioned_action(
        investigator_scoped_memory,
        39,
        "investigator-scoped or same/different result memory",
    );

    let mut prior_motion = test_action("Investigate");
    prior_motion["mode"] = json!("PriorMotion");
    assert_versioned_action(prior_motion, 24, "PriorMotion");

    let mut role_set_mode = test_action("Investigate");
    role_set_mode["mode"] = json!("Vanilla");
    assert_versioned_action(role_set_mode, 36, "role-set investigation modes");

    let mut killer_mode = test_action("Investigate");
    killer_mode["mode"] = json!("Killer");
    assert_versioned_action(killer_mode, 50, "killer role-set investigation mode");

    let mut specialist_mode = test_action("Investigate");
    specialist_mode["mode"] = json!("Specialist");
    assert_versioned_action(
        specialist_mode,
        51,
        "specialist role-set investigation mode",
    );

    let mut pt_access_mode = test_action("Investigate");
    pt_access_mode["mode"] = json!("PtAccess");
    assert_versioned_action(pt_access_mode, 52, "PT access investigation mode");

    let mut role_disclosure_mode = test_action("Investigate");
    role_disclosure_mode["mode"] = json!("Role");
    assert_versioned_action(
        role_disclosure_mode,
        37,
        "role disclosure investigation modes",
    );

    let mut full_role_disclosure_mode = test_action("Investigate");
    full_role_disclosure_mode["mode"] = json!("FullRole");
    assert_versioned_action(
        full_role_disclosure_mode,
        38,
        "full role disclosure investigation modes",
    );

    for mode in ["RoleWatcher", "RoleGuard", "SecurityGuard"] {
        let mut visitor_identity_mode = test_action("Investigate");
        visitor_identity_mode["mode"] = json!(mode);
        assert_versioned_action(
            visitor_identity_mode,
            55,
            "visitor role/identity investigation modes",
        );
    }

    let mut voyeur_mode = test_action("Investigate");
    voyeur_mode["mode"] = json!("Voyeur");
    assert_versioned_action(voyeur_mode, 56, "voyeur action investigation mode");

    let mut action_type_mode = test_action("Investigate");
    action_type_mode["mode"] = json!("ActionType");
    assert_versioned_action(
        action_type_mode,
        61,
        "action-type follow investigation mode",
    );

    let mut rotate = test_action("Redirect");
    rotate["targets"] = json!("Many");
    rotate["constraints"]["max_targets"] = json!(3);
    rotate["redirect"] = json!("Rotate");
    assert_versioned_action(rotate, 25, "Rotate");

    let mut target_role_filter = test_action("Kill");
    target_role_filter["constraints"]["target_role_filter"] = json!("PowerRole");
    assert_versioned_action(target_role_filter, 40, "target_role_filter");

    let mut alignment_failback = test_action("Kill");
    alignment_failback["window"] = json!("Day");
    alignment_failback["alignment_failback"] = json!({ "hostile_alignments": ["mafia"] });
    assert_versioned_action(alignment_failback, 41, "alignment_failback");

    let mut grant_options = test_action("Grant");
    grant_options["grant_options"] = json!([{
        "grant_id": "extra_action",
        "kind": "ExtraAction",
        "uses": 1,
        "visibility": "Target"
    }]);
    assert_versioned_action(grant_options, 42, "grant_options");
}

#[test]
fn pack_required_ir_version_covers_versioned_policy_features() {
    let mut value = test_pack_value();
    value["wolf_carry"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 11, "wolf_carry");

    let mut value = test_pack_value();
    value["wolf_beauty"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 12, "wolf_beauty");

    let mut value = test_pack_value();
    value["guard_policy"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 13, "guard_policy");

    let mut value = test_pack_value();
    value["death_retaliation"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 14, "death_retaliation");

    let mut value = test_pack_value();
    value["idiot_policy"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 15, "idiot_policy");

    let mut value = test_pack_value();
    value["saulus_policy"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 62, "saulus_policy");

    let mut value = test_pack_value();
    value["lover_policy"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 16, "lover_policy");

    let mut value = test_pack_value();
    value["backup_policy"] = json!({
        "enabled": true,
        "priority": "PassiveThenTargeted"
    });
    assert_versioned_pack_feature(value, 68, "backup_policy.priority");

    let mut value = test_pack_value();
    value["private_channels"] = json!({
        "enabled": true,
        "groups": [{
            "id": "mason",
            "kind": "Mason",
            "roles": ["townie"],
            "reveals_alignment": "Town"
        }]
    });
    assert_versioned_pack_feature(value, 29, "private_channels");

    let mut value = test_pack_value();
    value["roles"]["traitor"] = json!({
        "description": "Traitor.",
        "alignment": "mafia",
        "actions": []
    });
    value["private_channels"] = json!({
        "enabled": true,
        "groups": [{
            "id": "mafia_day_chat",
            "kind": "FactionDayChat",
            "member_alignments": ["mafia"],
            "enabled_by_roles": ["townie"],
            "excluded_roles": ["traitor"],
            "active_while_source_alive": true,
            "reveals_alignment": "None"
        }]
    });
    assert_versioned_pack_feature(value, 64, "private_channels.excluded_roles");

    let mut value = test_pack_value();
    value["ita"] = json!({
        "modifier_components": {
            "better": { "hit_bonus": 0.25 }
        },
        "role_modifier_refs": {
            "townie": ["better"]
        }
    });
    assert_versioned_pack_feature(value, 32, "ita.modifier_components");

    let mut value = test_pack_value();
    value["target_lynch_win_policies"] = json!([{
        "id": "executioner",
        "target_effect": "executioner_target",
        "eligible_roles": ["townie"],
        "winner": "town"
    }]);
    assert_versioned_pack_feature(value, 19, "target_lynch_win_policies");

    let mut value = test_pack_value();
    value["beloved_princess_policy"] = json!({ "enabled": true });
    assert_versioned_pack_feature(value, 20, "beloved_princess_policy");

    let mut value = test_pack_value();
    value["beloved_princess_policy"] = json!({
        "enabled": true,
        "eligible_roles": ["townie"],
        "all_death_causes": true,
        "prompt_kind": "skip_next_day",
        "prompt_reason": "beloved_princess_death",
        "death_causes": []
    });
    assert_versioned_pack_feature(value, 65, "beloved_princess_policy.all_death_causes");

    let mut value = test_pack_value();
    value["day_vote_prompt_policies"] = json!([{
        "id": "no_majority",
        "statuses": ["NoMajority"],
        "prompt_kind": "revote",
        "prompt_reason": "no_majority"
    }]);
    assert_versioned_pack_feature(value, 21, "day_vote_prompt_policies");

    let mut value = test_pack_value();
    value["host_prompt_resolution_effects"] = json!([{
        "id": "no_majority_revote",
        "prompt_kind": "revote",
        "prompt_reason": "no_majority",
        "decision": "Acknowledge",
        "effect": "AdvanceRevote"
    }]);
    assert_versioned_pack_feature(value, 22, "host_prompt_resolution_effects");

    let mut value = test_pack_value();
    value["self_lynch_win_policies"] = json!([{
        "id": "jester",
        "eligible_roles": ["townie"],
        "winner": "town"
    }]);
    assert_versioned_pack_feature(value, 25, "self_lynch_win_policies");

    let mut value = test_pack_value();
    value["death_reveal"] = json!({
        "default": "AlignmentOnly",
        "by_cause": {},
        "by_effect": {}
    });
    assert_versioned_pack_feature(value, 26, "death_reveal");

    let mut value = test_pack_value();
    value["night_resolution"] = json!({
        "mode": "Generic",
        "conflict_families": ["BlockSuppressesActions"]
    });
    assert_versioned_pack_feature(value, 44, "night_resolution.conflict_families");

    let mut value = test_pack_value();
    value["visibility_families"] = json!(["PrivateInvestigationResults"]);
    assert_versioned_pack_feature(value, 45, "visibility_families");

    let mut value = test_pack_value();
    value["win_families"] = json!(["FactionParity"]);
    assert_versioned_pack_feature(value, 46, "win_families");

    let mut value = test_pack_value();
    value["win"]["survival_awards"] = json!([{
        "id": "survivor",
        "winner": "survivor",
        "eligible_roles": ["townie"],
        "source_event": "win.survivor"
    }]);
    assert_versioned_pack_feature(value, 63, "win.survival_awards");

    let mut value = test_pack_value();
    value["day_notes"] = json!({
        "day_deaths": {
            "enabled": true,
            "template_id": "day_death",
            "audience": "public"
        }
    });
    assert_versioned_pack_feature(value, 66, "day_notes.day_death_announcements");

    let mut value = test_pack_value();
    value["day_notes"] = json!({
        "day_deaths": {
            "enabled": true,
            "template_id": "day_death",
            "audience": "public",
            "cause_templates": {
                "lynch": {
                    "template_id": "lynch_death",
                    "audience": "public"
                }
            }
        }
    });
    assert_versioned_pack_feature(value, 67, "day_notes.day_death_cause_templates");

    let mut value = test_pack_value();
    value["night_resolution"] = json!({
        "mode": "Generic",
        "action_chance": {
            "faith_healer_protect": { "chance": 0.5 }
        }
    });
    assert_versioned_pack_feature(value, 43, "night_resolution.action_chance");
}
