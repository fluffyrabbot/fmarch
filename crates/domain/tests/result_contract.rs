use std::{fs, path::Path};

use domain::{validate_resolution_json, validate_trace_json, RESULT_VERSION, TRACE_VERSION};
use serde_json::json;

fn valid_resolution() -> serde_json::Value {
    json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:1",
        "result_version": RESULT_VERSION,
        "seed": 7,
        "counts": {
            "events": 2,
            "kills": 1,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": "slot_3",
                    "cause": "day_vote",
                    "attackers": [],
                    "unstoppable": true
                }
            },
            {
                "index": 1,
                "kind": "PhaseAnnouncement",
                "payload": {
                    "phase_id": "D01",
                    "template_id": "mafia_universe_day_death_v1",
                    "audience": "public",
                    "deaths": [
                        { "slot_id": "slot_3", "cause": "lynch" }
                    ]
                }
            }
        ],
        "started_at": 10,
        "finished_at": 11
    })
}

fn with_phase_announcement(mut payload: serde_json::Value) -> serde_json::Value {
    if payload["events"].as_array().is_some_and(|events| {
        events
            .iter()
            .any(|event| event["kind"] == "PhaseAnnouncement")
    }) {
        return payload;
    }

    let phase_id = payload["phase_id"].clone();
    let events = payload["events"].as_array_mut().unwrap();
    let insert_at = events
        .last()
        .is_some_and(|event| event["kind"] == "WinReached")
        .then(|| events.len() - 1)
        .unwrap_or(events.len());
    events.insert(
        insert_at,
        json!({
            "index": insert_at,
            "kind": "PhaseAnnouncement",
            "payload": {
                "phase_id": phase_id,
                "deaths": []
            }
        }),
    );
    for (index, event) in events.iter_mut().enumerate() {
        event["index"] = json!(index);
    }
    payload["counts"]["events"] = json!(events.len());
    payload
}

#[test]
fn valid_resolution_payload_passes_contract_validation() {
    let applied = validate_resolution_json(&valid_resolution(), RESULT_VERSION)
        .expect("valid resolution should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn imported_im_human_v4_fixture_payload_passes_contract_validation() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("domain crate should live under crates/domain")
        .join("tools/fixtures/im_human_v4/day_vote_resolution.fmarch.json");
    let payload: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&path).unwrap_or_else(|err| panic!("read {}: {err}", path.display())),
    )
    .unwrap_or_else(|err| panic!("parse {}: {err}", path.display()));

    let applied = validate_resolution_json(&payload, RESULT_VERSION)
        .expect("imported im-human V4 fixture should pass fmarch result validation");
    assert_eq!(applied.phase_id, "D01");
    assert_eq!(applied.counts.events, 4);
    assert_eq!(applied.counts.kills, 1);
    assert_eq!(applied.counts.saves, 0);
}

#[test]
fn concealed_death_reveal_payload_passes_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][0]["payload"]["cause"] = json!("janitor_kill");
    payload["events"][0]["payload"]["death_reveal"] = json!("Concealed");
    let applied = validate_resolution_json(&payload, RESULT_VERSION)
        .expect("concealed death reveal should pass");
    let death_reveal = match &applied.events[0].event {
        domain::InnerEvent::PlayerKilled { death_reveal, .. } => *death_reveal,
        other => panic!("expected PlayerKilled, got {other:?}"),
    };
    assert_eq!(death_reveal, domain::DeathRevealMode::Concealed);

    payload["events"][0]["payload"]["death_reveal"] = json!("AlignmentOnly");
    let applied = validate_resolution_json(&payload, RESULT_VERSION)
        .expect("alignment-only death reveal should pass");
    let death_reveal = match &applied.events[0].event {
        domain::InnerEvent::PlayerKilled { death_reveal, .. } => *death_reveal,
        other => panic!("expected PlayerKilled, got {other:?}"),
    };
    assert_eq!(death_reveal, domain::DeathRevealMode::AlignmentOnly);

    payload["events"][0]["payload"]["death_reveal"] = json!("Mystery");
    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("unknown variant `Mystery`"),
        "unexpected validation error: {err}"
    );
}

#[test]
fn info_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:info",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InfoResult",
                "payload": {
                    "actor": "slot_1",
                    "target": "slot_2",
                    "kind": "mailman",
                    "audience": ["slot_2"],
                    "result": {
                        "kind": "mailman",
                        "message": "anonymous",
                        "source_action": "mailman_n01",
                        "target": "slot_2"
                    },
                    "source_action": "mailman_n01",
                    "template_id": "mailman",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("InfoResult should pass");
    assert!(matches!(
        applied.events[0].event,
        domain::InnerEvent::InfoResult { .. }
    ));
}

#[test]
fn effect_notification_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:effect-notification",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "EffectNotification",
                "payload": {
                    "effect": "bulletproof_vest",
                    "status": "marked",
                    "audience": ["slot_2"]
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("EffectNotification should pass");
    assert!(matches!(
        applied.events[0].event,
        domain::InnerEvent::EffectNotification { .. }
    ));
}

#[test]
fn effect_notification_missing_audience_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:effect-notification",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "EffectNotification",
                "payload": {
                    "effect": "bulletproof_vest",
                    "status": "marked"
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err =
        validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field `audience`"),
        "unexpected validation error: {err}"
    );
}

#[test]
fn info_result_missing_audience_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:info",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InfoResult",
                "payload": {
                    "actor": "slot_1",
                    "target": "slot_2",
                    "kind": "mailman",
                    "result": {},
                    "source_action": "mailman_n01",
                    "template_id": "mailman",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err =
        validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field `audience`"),
        "unexpected error: {err}"
    );
}

#[test]
fn action_recorded_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:1",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionRecorded",
                "payload": {
                    "actor": "slot_1",
                    "template_id": "investigate_alignment",
                    "targets": ["slot_2"],
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2,
                    "status": "resolved"
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ActionRecorded should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn action_ingest_halted_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:ingest_halt",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionIngestHalted",
                "payload": {
                    "action_id": "historical_bad_kill",
                    "actor": "slot_2",
                    "actor_role": "doctor",
                    "template_id": "factional_kill",
                    "targets": ["slot_1"],
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1,
                    "reason": "template_not_available_to_actor",
                    "grant_id": null
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ActionIngestHalted should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn investigation_memory_recorded_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:memory",
        "result_version": RESULT_VERSION,
        "seed": 9,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationMemoryRecorded",
                "payload": {
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "mode": "Parity",
                    "result": "town",
                    "source_action": "compare_n02",
                    "template_id": "compare_parity",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("InvestigationMemoryRecorded should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn investigator_scoped_investigation_memory_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:investigator-memory",
        "result_version": RESULT_VERSION,
        "seed": 9,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationMemoryRecorded",
                "payload": {
                    "investigator": "slot_1",
                    "target": "slot_3",
                    "mode": "Parity",
                    "scope": "Investigator",
                    "result": "scum",
                    "source_action": "parity_n02",
                    "template_id": "parity_scan",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("investigator-scoped InvestigationMemoryRecorded should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn delayed_death_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:delayed-death",
        "result_version": RESULT_VERSION,
        "seed": 10,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "DelayedDeathQueued",
                "payload": {
                    "queue_id": "poisoned:slot_2:poison_n01",
                    "target": "slot_2",
                    "cause": "poison",
                    "effect": "poisoned",
                    "source": "slot_1",
                    "source_action": "poison_n01",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "DelayedDeathResolved",
                "payload": {
                    "queue_id": "poisoned:slot_2:poison_n01",
                    "target": "slot_2",
                    "cause": "poison",
                    "effect": "poisoned",
                    "outcome": "preempted_by_clear",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("delayed death events pass");
    assert_eq!(applied.counts.events, 3);
}

#[test]
fn visit_recorded_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:visit",
        "result_version": RESULT_VERSION,
        "seed": 11,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "VisitRecorded",
                "payload": {
                    "actor": "slot_1",
                    "target": "slot_3",
                    "template_id": "visit",
                    "source_action": "visit_n01",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1,
                    "visible": true
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("VisitRecorded should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn day_vote_outcome_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:vote",
        "result_version": RESULT_VERSION,
        "seed": 12,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "DayVoteOutcome",
                "payload": {
                    "status": "NoMajority",
                    "winner": null,
                    "contenders": ["slot_5"],
                    "tallies": { "slot_5": 3.0 },
                    "votes": {
                        "slot_1": "slot_5",
                        "slot_2": "slot_5",
                        "slot_3": "slot_5"
                    },
                    "weights": {
                        "slot_1": 1.0,
                        "slot_2": 1.0,
                        "slot_3": 1.0,
                        "slot_4": 1.0,
                        "slot_5": 1.0
                    },
                    "majority": 3.0,
                    "thresholds": {
                        "slot_1": 3.0,
                        "slot_2": 3.0,
                        "slot_3": 3.0,
                        "slot_4": 3.0,
                        "slot_5": 4.0
                    },
                    "total_weight": 5.0,
                    "tiebreak": null,
                    "reason": null
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("DayVoteOutcome should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn day_vote_recorded_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:vote-history",
        "result_version": RESULT_VERSION,
        "seed": 12,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "DayVoteRecorded",
                "payload": {
                    "actor": "slot_1",
                    "target": "slot_5",
                    "withdrawn": false,
                    "sequence": 1
                }
            },
            {
                "index": 1,
                "kind": "DayVoteRecorded",
                "payload": {
                    "actor": "slot_1",
                    "withdrawn": true,
                    "sequence": 2
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("DayVoteRecorded should pass");
    let recorded: Vec<_> = applied
        .events
        .iter()
        .filter_map(|event| match &event.event {
            domain::InnerEvent::DayVoteRecorded {
                actor,
                target,
                withdrawn,
                sequence,
            } => Some((actor.as_str(), target.as_deref(), *withdrawn, *sequence)),
            _ => None,
        })
        .collect();
    assert_eq!(
        recorded,
        vec![
            ("slot_1", Some("slot_5"), false, 1),
            ("slot_1", None, true, 2),
        ]
    );
}

#[test]
fn day_note_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "D02",
        "phase_kind": "Day",
        "phase_number": 2,
        "run_id": "resolution:test:D02:day_notes",
        "result_version": RESULT_VERSION,
        "seed": 16,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "DayAnnouncement",
                "payload": {
                    "player_id": "slot_5",
                    "cause": "factional_kill",
                    "template_id": "mafia_universe_night_death_v1",
                    "audience": "public",
                    "source_action_id": "nightkill_001",
                    "attackers": ["slot_4"],
                    "unstoppable": false,
                    "role_key": "mafia_goon",
                    "role_payload": "RoleKey",
                    "recorded_at": 77,
                    "sequence": 0,
                    "day": 2,
                    "night": 1,
                    "phase_id": "D02"
                }
            },
            {
                "index": 1,
                "kind": "LastWordsRecorded",
                "payload": {
                    "player_id": "slot_3",
                    "reason": "lynch",
                    "template_id": "mafia_universe_last_words_v1",
                    "audience": "public",
                    "window": "post_lynch",
                    "sequence": 0,
                    "day": 2,
                    "phase_id": "D02",
                    "vote": {
                        "status": "Lynch",
                        "winner": "slot_3",
                        "tallies": { "slot_3": 3.0 },
                        "majority": 3.0,
                        "total_weight": 4.0
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("day notes should pass");
    assert_eq!(applied.counts.events, 3);
}

#[test]
fn alignment_revealed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:alignment_reveal",
        "result_version": RESULT_VERSION,
        "seed": 17,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "AlignmentRevealed",
                "payload": {
                    "slot_id": "slot_1",
                    "alignment": "town",
                    "source_action": "reveal_town_001",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("AlignmentRevealed should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn role_revealed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:role_reveal",
        "result_version": RESULT_VERSION,
        "seed": 18,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "RoleRevealed",
                "payload": {
                    "slot_id": "slot_1",
                    "role_key": "doctor",
                    "source_action": "role_oracle_001",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("RoleRevealed should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn malformed_role_revealed_payload_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:bad_role_reveal",
        "result_version": RESULT_VERSION,
        "seed": 19,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "RoleRevealed",
                "payload": {
                    "slot_id": "slot_1",
                    "role_key": "doctor",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2
                }
            },
            {
                "index": 1,
                "kind": "PhaseAnnouncement",
                "payload": {
                    "phase_id": "N02",
                    "deaths": []
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field `source_action`"),
        "unexpected error: {err}"
    );
}

#[test]
fn vote_duel_declared_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:vote_duel",
        "result_version": RESULT_VERSION,
        "seed": 23,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "VoteDuelDeclared",
                "payload": {
                    "challenger": "slot_1",
                    "target": "slot_2",
                    "source_action": "duel_001",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("VoteDuelDeclared should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn vote_vetoed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:veto",
        "result_version": RESULT_VERSION,
        "seed": 24,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "VoteVetoed",
                "payload": {
                    "governor": "slot_1",
                    "target": "slot_2",
                    "source_action": "veto_001",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("VoteVetoed should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn host_prompt_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:host-prompt",
        "result_version": RESULT_VERSION,
        "seed": 12,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "HostPromptIssued",
                "payload": {
                    "prompt_id": "D01:skip_next_day:slot_1",
                    "kind": "skip_next_day",
                    "subject": "slot_1",
                    "reason": "beloved_princess_death",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1,
                    "metadata": {
                        "policy": "beloved_princess",
                        "death_cause": "lynch",
                        "role": "beloved_princess"
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("HostPromptIssued should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn malformed_day_note_payload_fails_contract_validation() {
    let payload = json!({
        "phase_id": "D02",
        "phase_kind": "Day",
        "phase_number": 2,
        "run_id": "resolution:test:D02:bad_day_notes",
        "result_version": RESULT_VERSION,
        "seed": 17,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "LastWordsRecorded",
                "payload": {
                    "player_id": "slot_3",
                    "reason": "lynch",
                    "sequence": 0,
                    "day": 2,
                    "phase_id": "D02",
                    "vote": {
                        "status": "Lynch",
                        "winner": "slot_3",
                        "tallies": { "slot_3": 3.0 },
                        "majority": 3.0
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("total_weight"),
        "expected missing total_weight failure, got {err}"
    );
}

#[test]
fn badge_changed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:sheriff",
        "result_version": RESULT_VERSION,
        "seed": 13,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "BadgeChanged",
                "payload": {
                    "badge_id": "sheriff_badge",
                    "owner": "slot_2",
                    "previous_owner": null,
                    "vote_weight": 1.5,
                    "actor": "slot_1",
                    "source_action": "badge_el_001",
                    "reason": "elected",
                    "destroyed": false,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("BadgeChanged should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn duel_resolved_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:duel",
        "result_version": RESULT_VERSION,
        "seed": 14,
        "counts": {
            "events": 2,
            "kills": 1,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "DuelResolved",
                "payload": {
                    "knight": "slot_1",
                    "target": "slot_4",
                    "result": "Success",
                    "killed": "slot_4",
                    "source_action": "duel_001",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": "slot_4",
                    "cause": "knight_duel",
                    "attackers": ["slot_1"],
                    "unstoppable": true
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("DuelResolved should pass");
    assert_eq!(applied.counts.events, 3);
    assert_eq!(applied.counts.kills, 1);
}

#[test]
fn wolf_self_destruct_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:self_destruct",
        "result_version": RESULT_VERSION,
        "seed": 18,
        "counts": {
            "events": 3,
            "kills": 2,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "WolfSelfDestructed",
                "payload": {
                    "wolf_id": "slot_1",
                    "target_id": "slot_2",
                    "cause": "self_destruct",
                    "unstoppable": true,
                    "source_action": "self_001",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": "slot_2",
                    "cause": "self_destruct",
                    "attackers": ["slot_1"],
                    "unstoppable": true
                }
            },
            {
                "index": 2,
                "kind": "PlayerKilled",
                "payload": {
                    "slot_id": "slot_1",
                    "cause": "self_destruct",
                    "attackers": ["slot_1"],
                    "unstoppable": true
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("WolfSelfDestructed should pass");
    assert_eq!(applied.counts.events, 4);
    assert_eq!(applied.counts.kills, 2);
}

#[test]
fn wolf_carry_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:wolf_carry",
        "result_version": RESULT_VERSION,
        "seed": 19,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "WolfCarryQueued",
                "payload": {
                    "owner_id": "slot_1",
                    "token_id": "white_wolf_carry_token",
                    "cause": "wolf_carry",
                    "role_key": "white_wolf_king",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "WolfCarryUsed",
                "payload": {
                    "owner_id": "slot_1",
                    "target_id": "slot_4",
                    "source_action_id": "wolfkill_001:wolf_carry:1",
                    "effect_id": "white_wolf_carry_token:wolfkill_001:wolf_carry:1",
                    "role_key": "white_wolf_king",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("wolf carry should pass");
    assert_eq!(applied.counts.events, 3);
}

#[test]
fn wolf_beauty_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:wolf_beauty",
        "result_version": RESULT_VERSION,
        "seed": 20,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "WolfBeautyMarked",
                "payload": {
                    "beauty_id": "slot_1",
                    "target_id": "slot_2",
                    "effect": "wolf_beauty_mark",
                    "source_action": "beauty_001",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "WolfBeautyDragged",
                "payload": {
                    "beauty_id": "slot_1",
                    "dragged_ids": ["slot_2"],
                    "cause": "trigger:wolf_beauty_drag",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("wolf beauty should pass");
    assert_eq!(applied.counts.events, 3);
}

#[test]
fn ita_session_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:ita",
        "result_version": RESULT_VERSION,
        "seed": 15,
        "counts": {
            "events": 5,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ItaSessionOpened",
                "payload": {
                    "session_id": "d1",
                    "label": "Day 1 ITA",
                    "day": 1,
                    "window": "ita_sessions",
                    "status": "open",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "ItaShotQueued",
                "payload": {
                    "session_id": "d1",
                    "action_id": "ita_001",
                    "actor": "slot_1",
                    "targets": ["slot_4"],
                    "submitted_at": 10,
                    "queue_position": 1,
                    "queue_length": 1,
                    "previous_queue_length": 0,
                    "counters": {
                        "global_shots_fired": 1,
                        "shots_resolved": 0,
                        "hits_landed": 0,
                        "shots_missed": 0,
                        "per_shooter": { "slot_1": 1 },
                        "per_target": { "slot_4": 1 }
                    }
                }
            },
            {
                "index": 2,
                "kind": "ItaShotResolved",
                "payload": {
                    "session_id": "d1",
                    "action_id": "ita_001",
                    "actor": "slot_1",
                    "target": "slot_4",
                    "outcome": "Hit",
                    "hit_chance": 1.0,
                    "roll": 0.42,
                    "kill": true,
                    "hp_before": 1,
                    "hp_after": 0,
                    "protection_path": "hp",
                    "submitted_at": 10,
                    "timestamp": 10,
                    "counters": {
                        "global_shots_fired": 1,
                        "shots_resolved": 1,
                        "hits_landed": 1,
                        "shots_missed": 0,
                        "hp_remaining": { "slot_4": 0 },
                        "hp_damage": { "slot_4": 1 },
                        "per_shooter": { "slot_1": 1 },
                        "per_target": { "slot_4": 1 }
                    }
                }
            },
            {
                "index": 3,
                "kind": "ItaSessionUpdated",
                "payload": {
                    "session_id": "d1",
                    "queue_length": 0,
                    "queue_delta": -1,
                    "shots_resolved": 1,
                    "global_shots_fired": 1,
                    "counters": {
                        "global_shots_fired": 1,
                        "shots_resolved": 1,
                        "hits_landed": 1,
                        "shots_missed": 0,
                        "per_shooter": { "slot_1": 1 },
                        "per_target": { "slot_4": 1 }
                    },
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 4,
                "kind": "ItaSessionClosed",
                "payload": {
                    "session_id": "d1",
                    "last_status": "open",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ITA payloads should pass");
    assert_eq!(applied.counts.events, 6);
}

#[test]
fn ita_session_lifecycle_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:ita_lifecycle",
        "result_version": RESULT_VERSION,
        "seed": 16,
        "counts": {
            "events": 3,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ItaSessionLifecycleChanged",
                "payload": {
                    "session_id": "d1",
                    "control": "Pause",
                    "from_status": "open",
                    "to_status": "paused",
                    "message": "Pause for votecount correction",
                    "recorded_at": 42,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "ItaSessionAnnouncement",
                "payload": {
                    "session_id": "d1",
                    "status": "paused",
                    "message": "Pause for votecount correction",
                    "recorded_at": 42,
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            },
            {
                "index": 2,
                "kind": "ItaSessionClosed",
                "payload": {
                    "session_id": "d1",
                    "last_status": "paused",
                    "phase_id": "D01",
                    "phase_kind": "Day",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ITA lifecycle payloads should pass");
    assert_eq!(applied.counts.events, 4);
}

#[test]
fn ita_buffered_invalidated_and_refunded_payloads_pass_contract_validation() {
    let payload = json!({
        "phase_id": "D01",
        "phase_kind": "Day",
        "phase_number": 1,
        "run_id": "resolution:test:D01:ita_extended",
        "result_version": RESULT_VERSION,
        "seed": 19,
        "counts": {
            "events": 3,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ItaShotBuffered",
                "payload": {
                    "session_id": "d1",
                    "action_id": "ita_buffered_001",
                    "template_id": "ita_shot",
                    "actor_id": "slot_1",
                    "targets": ["slot_4"],
                    "submitted_at": 10,
                    "release_at": 1010,
                    "delay_ms": 1000
                }
            },
            {
                "index": 1,
                "kind": "ItaShotInvalidated",
                "payload": {
                    "session_id": "d1",
                    "action_id": "ita_invalidated_001",
                    "actor_id": "slot_2",
                    "target_id": "slot_4",
                    "reason": "target_dead",
                    "invalidated_by": "ita_buffered_001",
                    "submitted_at": 11,
                    "timestamp": 12
                }
            },
            {
                "index": 2,
                "kind": "ItaShotRefunded",
                "payload": {
                    "session_id": "d1",
                    "action_id": "ita_refunded_001",
                    "actor_id": "slot_3",
                    "target_id": "slot_4",
                    "reason": "target_dead",
                    "policy": "REFUND_SHOT",
                    "hit_chance": 0.5,
                    "roll": 0.3,
                    "hp_before": 0,
                    "hp_after": 0,
                    "protection_path": "hp",
                    "submitted_at": 13,
                    "timestamp": 14,
                    "counters": {
                        "global_shots_fired": 3,
                        "shots_resolved": 1,
                        "hits_landed": 0,
                        "shots_missed": 0,
                        "shots_refunded": 1,
                        "per_shooter": { "slot_3": 1 },
                        "per_target": { "slot_4": 1 },
                        "refunded_by_reason": { "target_dead": 1 }
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("extended ITA shot payloads should pass");
    assert_eq!(applied.counts.events, 4);
}

#[test]
fn action_granted_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:grant",
        "result_version": RESULT_VERSION,
        "seed": 9,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionGranted",
                "payload": {
                    "grant_id": "extra_action",
                    "kind": "ExtraAction",
                    "actor": "slot_1",
                    "target": "slot_2",
                    "uses": 1,
                    "source_action": "motivate_n01",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ActionGranted should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn action_grant_consumed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:grant-consumed",
        "result_version": RESULT_VERSION,
        "seed": 9,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionGrantConsumed",
                "payload": {
                    "grant_id": "extra_action",
                    "actor": "slot_2",
                    "action_id": "cop_extra_n02",
                    "source_action": "motivate_n01",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2,
                    "remaining_uses": 0
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("ActionGrantConsumed should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn action_grant_consumed_without_source_action_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:grant-consumed-missing-source",
        "result_version": RESULT_VERSION,
        "seed": 9,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionGrantConsumed",
                "payload": {
                    "grant_id": "extra_action",
                    "actor": "slot_2",
                    "action_id": "cop_extra_n02",
                    "phase_id": "N02",
                    "phase_kind": "Night",
                    "phase_number": 2,
                    "remaining_uses": 0
                }
            },
            {
                "index": 1,
                "kind": "PhaseAnnouncement",
                "payload": {
                    "phase_id": "N02",
                    "deaths": []
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field `source_action`"),
        "unexpected error: {err}"
    );
}

#[test]
fn backup_targeted_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:backup-targeted",
        "result_version": RESULT_VERSION,
        "seed": 10,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "BackupTargeted",
                "payload": {
                    "backup": "slot_1",
                    "source_target": "slot_2",
                    "source_role": "cop",
                    "source_action": "target_backup_n01",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("BackupTargeted should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn target_lynch_win_targeted_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:target-lynch-win-targeted",
        "result_version": RESULT_VERSION,
        "seed": 10,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "TargetLynchWinTargeted",
                "payload": {
                    "policy": "executioner",
                    "owner": "slot_1",
                    "target": "slot_2",
                    "effect": "execution_target",
                    "source_action": "executioner_target_n01",
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("TargetLynchWinTargeted should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn players_linked_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:link",
        "result_version": RESULT_VERSION,
        "seed": 10,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "PlayersLinked",
                "payload": {
                    "link_id": "link_001",
                    "slots": ["slot_2", "slot_3"],
                    "source": "slot_1"
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("PlayersLinked should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn retaliation_armed_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:retaliate",
        "result_version": RESULT_VERSION,
        "seed": 11,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "RetaliationArmed",
                "payload": {
                    "retaliation_id": "hunt_001",
                    "actor": "slot_1",
                    "target": "slot_2",
                    "source_action": "hunter_retaliate"
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("RetaliationArmed should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn player_converted_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:convert",
        "result_version": RESULT_VERSION,
        "seed": 10,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "PlayerConverted",
                "payload": {
                    "target": "slot_2",
                    "new_role": "cultist",
                    "new_alignment": "cult",
                    "original_role": "cop",
                    "original_alignment": "town",
                    "source": "slot_1"
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("PlayerConverted should pass");
    assert_eq!(applied.counts.events, 2);
}

#[test]
fn unknown_inner_event_kind_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][0]["kind"] = json!("player.killed");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("unknown variant"),
        "unexpected error: {err}"
    );
}

#[test]
fn malformed_inner_event_payload_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][0]["payload"]
        .as_object_mut()
        .unwrap()
        .remove("slot_id");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field"),
        "unexpected error: {err}"
    );
}

#[test]
fn malformed_investigation_result_payload_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:investigation-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "FullRole",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "role": "mafia_strongman",
                        "team": "mafia"
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err =
        validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("unknown result key `team`"),
        "unexpected error: {err}"
    );
}

#[test]
fn full_role_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:full-role-investigation-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "FullRole",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "role": "mafia_strongman",
                        "alignment": "mafia"
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical FullRole investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn killer_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:killer-investigation-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Killer",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "killer": true
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical Killer investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn specialist_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:specialist-investigation-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Specialist",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "specialist": true
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical Specialist investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn pt_access_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:pt-access-investigation-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "PtAccess",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "pt_access": ["private:mason"]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical PtAccess investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn visitor_role_investigation_result_payload_passes_contract_validation() {
    for (mode, run_id) in [
        ("RoleWatcher", "resolution:test:N01:role-watcher-result"),
        ("RoleGuard", "resolution:test:N01:role-guard-result"),
    ] {
        let payload = json!({
            "phase_id": "N01",
            "phase_kind": "Night",
            "phase_number": 1,
            "run_id": run_id,
            "result_version": RESULT_VERSION,
            "seed": 8,
            "counts": {
                "events": 1,
                "kills": 0,
                "saves": 0
            },
            "events": [
                {
                    "index": 0,
                    "kind": "InvestigationResult",
                    "payload": {
                        "mode": mode,
                        "investigator": "slot_1",
                        "target": "slot_2",
                        "result": {
                            "visitor_roles": ["doctor", "mafia_goon"]
                        }
                    }
                }
            ],
            "started_at": 12,
            "finished_at": 12
        });

        let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
            .unwrap_or_else(|err| panic!("canonical {mode} result should pass: {err}"));
        assert_eq!(applied.events.len(), 2);
    }
}

#[test]
fn security_guard_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:security-guard-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "SecurityGuard",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "visitors": ["slot_3", "slot_4"]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical SecurityGuard investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn voyeur_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:voyeur-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Voyeur",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "actions": ["doctor_protect", "factional_kill"]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical Voyeur investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn action_type_investigation_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:action-type-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "ActionType",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "action_types": ["killing", "protection"]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical ActionType investigation result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn malformed_visitor_role_investigation_result_payload_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:malformed-role-watcher-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "RoleWatcher",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "visitor_roles": ["doctor", 7]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err =
        validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("event 0 mode RoleWatcher result key `visitor_roles` has invalid shape"),
        "unexpected error: {err}"
    );
}

#[test]
fn malformed_voyeur_investigation_result_payload_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:malformed-voyeur-result",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Voyeur",
                    "investigator": "slot_1",
                    "target": "slot_2",
                    "result": {
                        "actions": ["doctor_protect", 7]
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err =
        validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("event 0 mode Voyeur result key `actions` has invalid shape"),
        "unexpected error: {err}"
    );
}

#[test]
fn parity_comparison_result_payload_passes_contract_validation() {
    let payload = json!({
        "phase_id": "N02",
        "phase_kind": "Night",
        "phase_number": 2,
        "run_id": "resolution:test:N02:parity-comparison",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 1,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "InvestigationResult",
                "payload": {
                    "mode": "Parity",
                    "investigator": "slot_1",
                    "target": "slot_3",
                    "result": {
                        "previous": "town",
                        "current": "scum",
                        "changed": true
                    }
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("canonical parity comparison result should pass");
    assert_eq!(applied.events.len(), 2);
}

#[test]
fn action_granted_without_source_action_fails_contract_validation() {
    let payload = json!({
        "phase_id": "N01",
        "phase_kind": "Night",
        "phase_number": 1,
        "run_id": "resolution:test:N01:grant",
        "result_version": RESULT_VERSION,
        "seed": 8,
        "counts": {
            "events": 2,
            "kills": 0,
            "saves": 0
        },
        "events": [
            {
                "index": 0,
                "kind": "ActionGranted",
                "payload": {
                    "grant_id": "extra_action",
                    "kind": "ExtraAction",
                    "actor": "slot_1",
                    "target": "slot_2",
                    "uses": 1,
                    "phase_id": "N01",
                    "phase_kind": "Night",
                    "phase_number": 1
                }
            },
            {
                "index": 1,
                "kind": "PhaseAnnouncement",
                "payload": {
                    "phase_id": "N01",
                    "deaths": []
                }
            }
        ],
        "started_at": 12,
        "finished_at": 12
    });

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("missing field `source_action`"),
        "unexpected error: {err}"
    );
}

#[test]
fn unknown_inner_event_payload_field_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][0]["payload"]["extra"] = json!("not canonical");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("unknown field"),
        "unexpected error: {err}"
    );
}

#[test]
fn non_canonical_event_index_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][1]["index"] = json!(3);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("event index mismatch"),
        "unexpected error: {err}"
    );
}

#[test]
fn aggregate_count_mismatch_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["counts"]["kills"] = json!(0);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("counts.kills mismatch"),
        "unexpected error: {err}"
    );
}

#[test]
fn missing_phase_announcement_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["counts"]["events"] = json!(1);
    payload["events"].as_array_mut().unwrap().pop();

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("exactly one PhaseAnnouncement"),
        "unexpected error: {err}"
    );
}

#[test]
fn duplicate_phase_announcement_fails_contract_validation() {
    let mut payload = valid_resolution();
    let duplicate = payload["events"][1].clone();
    payload["events"].as_array_mut().unwrap().push(duplicate);
    payload["events"][2]["index"] = json!(2);
    payload["counts"]["events"] = json!(3);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("exactly one PhaseAnnouncement"),
        "unexpected error: {err}"
    );
}

#[test]
fn non_trailing_phase_announcement_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"].as_array_mut().unwrap().swap(0, 1);
    payload["events"][0]["index"] = json!(0);
    payload["events"][1]["index"] = json!(1);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("PhaseAnnouncement must be at index 1"),
        "unexpected error: {err}"
    );
}

#[test]
fn malformed_phase_announcement_metadata_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][1]["payload"]["template_id"] = json!(" ");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("PhaseAnnouncement.template_id must not be empty"),
        "unexpected error: {err}"
    );

    let mut payload = valid_resolution();
    payload["events"][1]["payload"]["audience"] = json!("");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("PhaseAnnouncement.audience must not be empty"),
        "unexpected error: {err}"
    );
}

#[test]
fn final_win_after_phase_announcement_passes_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"].as_array_mut().unwrap().push(json!({
        "index": 2,
        "kind": "WinReached",
        "payload": {
            "winner": "town",
            "reason": "all threats eliminated",
            "metadata": {}
        }
    }));
    payload["counts"]["events"] = json!(3);

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("single final WinReached after announcement should pass");
    assert_eq!(applied.events.len(), 3);
}

#[test]
fn final_win_survival_awards_metadata_passes_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"].as_array_mut().unwrap().push(json!({
        "index": 2,
        "kind": "WinReached",
        "payload": {
            "winner": "town",
            "reason": "all threats eliminated",
            "metadata": {
                "survival_awards": [
                    {
                        "policy": "survivor",
                        "winner": "survivor",
                        "slot_id": "slot_3",
                        "role": "survivor",
                        "source_event": "win.survivor"
                    }
                ]
            }
        }
    }));
    payload["counts"]["events"] = json!(3);

    let applied = validate_resolution_json(&with_phase_announcement(payload), RESULT_VERSION)
        .expect("survival-award WinReached metadata should pass");
    let metadata = match &applied.events[2].event {
        domain::InnerEvent::WinReached { metadata, .. } => metadata,
        other => panic!("expected terminal WinReached, got {other:?}"),
    };
    assert_eq!(
        metadata["survival_awards"][0]["source_event"],
        "win.survivor"
    );
}

#[test]
fn non_final_win_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"].as_array_mut().unwrap().insert(
        1,
        json!({
            "index": 1,
            "kind": "WinReached",
            "payload": {
                "winner": "town",
                "reason": "too early",
                "metadata": {}
            }
        }),
    );
    payload["events"][2]["index"] = json!(2);
    payload["counts"]["events"] = json!(3);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("WinReached must be the final event"),
        "unexpected error: {err}"
    );
}

#[test]
fn multiple_wins_fail_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"].as_array_mut().unwrap().push(json!({
        "index": 2,
        "kind": "WinReached",
        "payload": {
            "winner": "town",
            "reason": "all threats eliminated",
            "metadata": {}
        }
    }));
    payload["events"].as_array_mut().unwrap().push(json!({
        "index": 3,
        "kind": "WinReached",
        "payload": {
            "winner": "mafia",
            "reason": "duplicate terminal win",
            "metadata": {}
        }
    }));
    payload["counts"]["events"] = json!(4);

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string()
            .contains("expected at most one trailing WinReached, found 2"),
        "unexpected error: {err}"
    );
}

#[test]
fn phase_announcement_phase_mismatch_fails_contract_validation() {
    let mut payload = valid_resolution();
    payload["events"][1]["payload"]["phase_id"] = json!("N01");

    let err = validate_resolution_json(&payload, RESULT_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("must match envelope phase_id"),
        "unexpected error: {err}"
    );
}

#[test]
fn valid_trace_payload_passes_contract_validation() {
    let trace = json!({
        "phase_id": "D01",
        "run_id": "resolution:test:D01:1",
        "trace_version": TRACE_VERSION,
        "edges": [],
        "generated": [],
        "effect_changes": [],
        "visibility": [],
        "decisions": [
            {
                "stage": "result_contract",
                "source": format!("domain::resolve/result_version:{RESULT_VERSION}"),
                "outcome": "2 inner events validated"
            }
        ],
        "notes": []
    });

    let trace = validate_trace_json(&trace, TRACE_VERSION).expect("valid trace should pass");
    assert_eq!(trace.run_id, "resolution:test:D01:1");
}

#[test]
fn unknown_trace_field_fails_contract_validation() {
    let trace = json!({
        "phase_id": "D01",
        "run_id": "resolution:test:D01:1",
        "trace_version": TRACE_VERSION,
        "edges": [],
        "generated": [],
        "effect_changes": [],
        "visibility": [],
        "decisions": [],
        "notes": [],
        "surprise": true
    });

    let err = validate_trace_json(&trace, TRACE_VERSION).unwrap_err();
    assert!(
        err.to_string().contains("unknown field"),
        "unexpected error: {err}"
    );
}
