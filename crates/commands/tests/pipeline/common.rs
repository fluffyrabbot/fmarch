//! Shared harness for pipeline integration tests.

use caps::Principal;
use commands::{handle, CohostPermissionClass, Command, ThreadPostMedia, ThreadPostMediaVariant};
use projections::votecount;
use sqlx::PgPool;
use std::collections::BTreeMap;
use uuid::Uuid;

// ───────────────────────── helpers ─────────────────────────

pub fn user(id: &str) -> Principal {
    Principal::user(id)
}

/// Stand up a running game: host H creates it, adds slot S, seats a named
/// persona for principal A, assigns a role, starts the game, and opens a Day
/// phase. Returns (game_id).
pub async fn setup_game(pool: &PgPool, host: &str, slot: &str, occupant: &str) -> Uuid {
    setup_game_with_pack(pool, host, slot, occupant, "mafiascum").await
}

pub async fn setup_game_with_pack(
    pool: &PgPool,
    host: &str,
    slot: &str,
    occupant: &str,
    pack: &str,
) -> Uuid {
    setup_game_with_pack_and_denied(pool, host, slot, occupant, pack, vec![]).await
}

pub async fn setup_game_with_pack_and_denied(
    pool: &PgPool,
    host: &str,
    slot: &str,
    occupant: &str,
    pack: &str,
    cohost_denied: Vec<CohostPermissionClass>,
) -> Uuid {
    let game = Uuid::new_v4();
    let h = user(host);

    handle(
        pool,
        &h,
        Command::CreateGame {
            game,
            pack: pack.into(),
            cohost_denied,
        },
    )
    .await
    .expect("create game");
    handle(
        pool,
        &h,
        Command::AddSlot {
            game,
            slot: slot.into(),
        },
    )
    .await
    .expect("add slot");
    handle(
        pool,
        &h,
        Command::SeatPersona {
            game,
            slot: slot.into(),
            principal_user_id: occupant.into(),
            public_name: format!("Persona {slot}"),
        },
    )
    .await
    .expect("seat persona");
    handle(
        pool,
        &h,
        Command::AssignRole {
            game,
            slot: slot.into(),
            role_key: "vanilla_townie".into(),
        },
    )
    .await
    .expect("assign role");
    handle(
        pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start game");
    game
}

/// Read the current immutable occupancy epoch's persona. Replacement commands
/// use this value as their concurrency target; principals are not slot ids.
pub async fn current_slot_persona_id(pool: &PgPool, game: Uuid, slot: &str) -> String {
    projections::slot_occupancy(pool, game)
        .await
        .expect("read slot occupancy")
        .into_iter()
        .find(|row| row.slot_id == slot)
        .expect("slot has an open occupancy epoch")
        .persona_id
}

pub async fn add_vanilla_slot(pool: &PgPool, game: Uuid, host: &str, slot: &str) {
    let h = user(host);
    handle(
        pool,
        &h,
        Command::AddSlot {
            game,
            slot: slot.into(),
        },
    )
    .await
    .expect("add slot");
    handle(
        pool,
        &h,
        Command::AssignRole {
            game,
            slot: slot.into(),
            role_key: "vanilla_townie".into(),
        },
    )
    .await
    .expect("assign vanilla role");
}

pub fn thread_media(content_id: &str, alt: &str) -> ThreadPostMedia {
    ThreadPostMedia {
        content_id: content_id.into(),
        alt: alt.into(),
        variants: BTreeMap::from([
            (
                "thumb".to_string(),
                ThreadPostMediaVariant {
                    width: 256,
                    height: 192,
                },
            ),
            (
                "tablet".to_string(),
                ThreadPostMediaVariant {
                    width: 1_024,
                    height: 768,
                },
            ),
            (
                "full-bounded".to_string(),
                ThreadPostMediaVariant {
                    width: 1_600,
                    height: 1_200,
                },
            ),
        ]),
    }
}

/// Count of current ballots targeting `target` in `phase`.
pub async fn tally_for(pool: &PgPool, game: Uuid, phase: &str, target: &str) -> i64 {
    votecount(pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|r| r.phase_id == phase && r.candidate_slot == target)
        .map(|r| r.count)
        .unwrap_or(0)
}

pub fn assert_win_revealed_all_slots(slots: &[projections::SlotStateRow], context: &str) {
    assert!(
        slots
            .iter()
            .all(|slot| slot.role_revealed && slot.alignment_revealed),
        "{context}: WinReached should reveal all projected roles and alignments: {slots:?}"
    );
}

#[derive(Debug, Clone)]
pub struct TriggerGeneratedTraceExpectation<'a> {
    pub action_id: &'a str,
    pub on: &'a str,
    pub source_target: &'a str,
    pub source_actor: &'a str,
    pub source_cause: &'a str,
    pub produced_actor: &'a str,
    pub produced_target: &'a str,
    pub actor_filter: Option<serde_json::Value>,
    pub event_index: i64,
}

pub fn assert_trigger_generated_trace(
    trace: &domain::ResolutionTrace,
    expected: TriggerGeneratedTraceExpectation<'_>,
) {
    let generated = trace
        .generated
        .iter()
        .find(|generated| {
            generated.source == "Trigger" && generated.action_id == expected.action_id
        })
        .unwrap_or_else(|| {
            panic!(
                "ResolutionTrace should persist trigger generated row {}",
                expected.action_id
            )
        });
    assert_eq!(generated.actor, expected.produced_actor, "generated actor");
    assert_eq!(
        generated.targets,
        vec![expected.produced_target.to_string()],
        "generated targets"
    );
    assert_eq!(generated.detail["on"], expected.on, "trigger on");
    assert_eq!(
        generated.detail["source_target"], expected.source_target,
        "trigger source_target"
    );
    assert_eq!(
        generated.detail["source_actor"], expected.source_actor,
        "trigger source_actor"
    );
    assert_eq!(
        generated.detail["source_cause"], expected.source_cause,
        "trigger source_cause"
    );
    assert_eq!(
        generated.detail["produced_actor"], expected.produced_actor,
        "trigger produced_actor"
    );
    assert_eq!(
        generated.detail["produced_target"], expected.produced_target,
        "trigger produced_target"
    );
    assert_eq!(
        generated.detail["actor_filter"],
        expected.actor_filter.unwrap_or(serde_json::Value::Null),
        "trigger actor_filter"
    );
    assert_eq!(
        generated.detail["event_index"],
        serde_json::json!(expected.event_index),
        "trigger event_index"
    );
}

#[derive(Debug, Clone)]
pub struct DecisionTraceExpectation<'a> {
    pub stage: &'a str,
    pub source: &'a str,
    pub outcome: &'a str,
    pub detail: Vec<(&'a str, serde_json::Value)>,
}

pub fn assert_decision_trace(
    trace: &domain::ResolutionTrace,
    expected: DecisionTraceExpectation<'_>,
) {
    let decision = trace
        .decisions
        .iter()
        .find(|decision| {
            decision.stage == expected.stage
                && decision.source == expected.source
                && decision.outcome == expected.outcome
                && expected.detail.iter().all(|(key, value)| {
                    decision
                        .detail
                        .get(*key)
                        .is_some_and(|actual| actual == value)
                })
        })
        .unwrap_or_else(|| {
            panic!(
                "ResolutionTrace should persist decision {} from {} at {}",
                expected.outcome, expected.source, expected.stage
            )
        });
    for (key, value) in expected.detail {
        assert_eq!(
            decision.detail[key], value,
            "decision {} detail {key}",
            expected.outcome
        );
    }
}

pub fn assert_no_decision_trace(
    trace: &domain::ResolutionTrace,
    expected: DecisionTraceExpectation<'_>,
) {
    let forbidden = trace.decisions.iter().find(|decision| {
        decision.stage == expected.stage
            && decision.source == expected.source
            && decision.outcome == expected.outcome
            && expected.detail.iter().all(|(key, value)| {
                decision
                    .detail
                    .get(*key)
                    .is_some_and(|actual| actual == value)
            })
    });
    if let Some(decision) = forbidden {
        panic!(
            "ResolutionTrace should not persist decision {} from {} at {}: {:?}",
            expected.outcome, expected.source, expected.stage, decision
        );
    }
}

#[derive(Debug, Clone)]
pub struct InspectionDecisionExpectation<'a> {
    pub phase_id: &'a str,
    pub stage: &'a str,
    pub source: &'a str,
    pub outcome: &'a str,
    pub detail: serde_json::Value,
}

pub fn assert_anchored_inspection_decision(
    report: &commands::ResolutionTraceInspectionReport,
    expected: InspectionDecisionExpectation<'_>,
    context: &str,
) {
    check_anchored_inspection_decision(report, expected)
        .unwrap_or_else(|reason| panic!("{context}\n{reason}"));
}

pub fn check_anchored_inspection_decision(
    report: &commands::ResolutionTraceInspectionReport,
    expected: InspectionDecisionExpectation<'_>,
) -> Result<(), String> {
    let decision = match report
        .traces
        .iter()
        .filter(|trace| trace.phase_id == expected.phase_id && trace.applied_stream_seq.is_some())
        .flat_map(|trace| trace.decisions.iter())
        .find(|decision| {
            decision.applied_stream_seq.is_some()
                && decision.stage == expected.stage
                && decision.source == expected.source
                && decision.outcome == expected.outcome
        }) {
        Some(decision) => decision,
        None => {
            return Err(format!(
                "trace inspection should expose anchored decision {} from {} at {}",
                expected.outcome, expected.source, expected.stage
            ));
        }
    };
    if decision.detail != expected.detail {
        return Err(format!(
            "inspected decision {} detail expected {} got {}",
            expected.outcome, expected.detail, decision.detail
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct InspectionGeneratedExpectation<'a> {
    pub phase_id: &'a str,
    pub action_id: &'a str,
    pub source: &'a str,
    pub actor: &'a str,
    pub targets: Vec<String>,
    pub detail: serde_json::Value,
}

pub fn check_anchored_inspection_generated(
    report: &commands::ResolutionTraceInspectionReport,
    expected: InspectionGeneratedExpectation<'_>,
) -> Result<(), String> {
    let generated = match report
        .traces
        .iter()
        .filter(|trace| trace.phase_id == expected.phase_id && trace.applied_stream_seq.is_some())
        .flat_map(|trace| trace.generated.iter())
        .find(|generated| {
            generated.applied_stream_seq.is_some()
                && generated.action_id == expected.action_id
                && generated.source == expected.source
                && generated.actor == expected.actor
                && generated.targets == expected.targets
        }) {
        Some(generated) => generated,
        None => {
            return Err(format!(
                "trace inspection should expose anchored generated row {} from {}",
                expected.action_id, expected.source
            ));
        }
    };
    if generated.detail != expected.detail {
        return Err(format!(
            "inspected generated row {} detail expected {} got {}",
            expected.action_id, expected.detail, generated.detail
        ));
    }
    Ok(())
}

pub fn assert_anchored_inspection_note(
    report: &commands::ResolutionTraceInspectionReport,
    phase_id: &str,
    expected_note: &str,
    context: &str,
) {
    check_anchored_inspection_note(report, phase_id, expected_note)
        .unwrap_or_else(|reason| panic!("{context}\n{reason}"));
}

pub fn check_anchored_inspection_note(
    report: &commands::ResolutionTraceInspectionReport,
    phase_id: &str,
    expected_note: &str,
) -> Result<(), String> {
    let note = match report
        .traces
        .iter()
        .filter(|trace| trace.phase_id == phase_id && trace.applied_stream_seq.is_some())
        .flat_map(|trace| trace.notes.iter())
        .find(|note| note.applied_stream_seq.is_some() && note.note == expected_note)
    {
        Some(note) => note,
        None => {
            return Err(format!(
                "trace inspection should expose anchored note {expected_note}"
            ));
        }
    };
    if note.note != expected_note {
        return Err(format!(
            "inspected note expected {expected_note} got {}",
            note.note
        ));
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct TraceEdgeExpectation {
    pub kind: &'static str,
    pub from: &'static str,
    pub to: &'static str,
    pub detail: serde_json::Value,
}

pub fn assert_trace_edge(trace: &domain::ResolutionTrace, expected: TraceEdgeExpectation) {
    let edge = trace
        .edges
        .iter()
        .find(|edge| {
            edge.kind == expected.kind && edge.from == expected.from && edge.to == expected.to
        })
        .unwrap_or_else(|| {
            panic!(
                "ResolutionTrace should persist {} edge from {} to {}",
                expected.kind, expected.from, expected.to
            )
        });
    assert_eq!(
        edge.detail, expected.detail,
        "{} edge detail",
        expected.kind
    );
}
