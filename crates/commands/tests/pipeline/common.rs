//! Shared harness for pipeline integration tests.

use caps::Principal;
use commands::{
    Ack, CohostPermissionClass, Command, Reject, ThreadPostMedia, ThreadPostMediaVariant,
};
use projections::votecount;
use sqlx::{PgPool, Row};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

// ───────────────────────── helpers ─────────────────────────

/// Read logical events through the canonical sealed-body decoder. Tests must
/// not couple behavioral assertions to the physical event table shape.
pub async fn stored_events(pool: &PgPool, game: Uuid) -> Vec<eventstore::StoredEvent> {
    eventstore::load_stream(pool, game)
        .await
        .expect("load logical event stream")
}

pub async fn stored_payloads(pool: &PgPool, game: Uuid, kind: &str) -> Vec<serde_json::Value> {
    stored_events(pool, game)
        .await
        .into_iter()
        .filter(|event| event.kind == kind)
        .map(|event| event.payload)
        .collect()
}

pub async fn stored_event(pool: &PgPool, game: Uuid, kind: &str) -> eventstore::StoredEvent {
    stored_events(pool, game)
        .await
        .into_iter()
        .find(|event| event.kind == kind)
        .unwrap_or_else(|| panic!("missing {kind} in stream {game}"))
}

pub async fn latest_stored_event(pool: &PgPool, game: Uuid, kind: &str) -> eventstore::StoredEvent {
    stored_events(pool, game)
        .await
        .into_iter()
        .rfind(|event| event.kind == kind)
        .unwrap_or_else(|| panic!("missing {kind} in stream {game}"))
}

pub async fn stored_payloads_where(
    pool: &PgPool,
    game: Uuid,
    kind: &str,
    fields: &[(&str, &str)],
) -> Vec<serde_json::Value> {
    stored_payloads(pool, game, kind)
        .await
        .into_iter()
        .filter(|payload| {
            fields.iter().all(|(field, expected)| {
                payload.get(*field).and_then(|v| v.as_str()) == Some(*expected)
            })
        })
        .collect()
}

pub async fn stored_payload(pool: &PgPool, game: Uuid, kind: &str) -> serde_json::Value {
    stored_payloads(pool, game, kind)
        .await
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("missing {kind} in stream {game}"))
}

pub async fn stored_payload_where(
    pool: &PgPool,
    game: Uuid,
    kind: &str,
    fields: &[(&str, &str)],
) -> serde_json::Value {
    stored_payloads_where(pool, game, kind, fields)
        .await
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("missing matching {kind} in stream {game}"))
}

pub async fn latest_stored_payload(pool: &PgPool, game: Uuid, kind: &str) -> serde_json::Value {
    stored_payloads(pool, game, kind)
        .await
        .into_iter()
        .next_back()
        .unwrap_or_else(|| panic!("missing {kind} in stream {game}"))
}

pub async fn latest_stored_payload_with_prefix(
    pool: &PgPool,
    game: Uuid,
    kind: &str,
    field: &str,
    prefix: &str,
) -> serde_json::Value {
    stored_payloads(pool, game, kind)
        .await
        .into_iter()
        .rfind(|payload| {
            payload
                .get(field)
                .and_then(|value| value.as_str())
                .is_some_and(|value| value.starts_with(prefix))
        })
        .unwrap_or_else(|| panic!("missing matching {kind} in stream {game}"))
}

pub async fn stored_payload_with_prefix(
    pool: &PgPool,
    game: Uuid,
    kind: &str,
    field: &str,
    prefix: &str,
) -> serde_json::Value {
    stored_payloads(pool, game, kind)
        .await
        .into_iter()
        .find(|payload| {
            payload
                .get(field)
                .and_then(|value| value.as_str())
                .is_some_and(|value| value.starts_with(prefix))
        })
        .unwrap_or_else(|| panic!("missing matching {kind} in stream {game}"))
}

pub async fn stored_event_count(pool: &PgPool, game: Uuid) -> usize {
    stored_events(pool, game).await.len()
}

pub async fn stored_event_count_by_kind(pool: &PgPool, game: Uuid, kind: &str) -> usize {
    stored_events(pool, game)
        .await
        .into_iter()
        .filter(|event| event.kind == kind)
        .count()
}

pub async fn stored_event_count_by_kinds(pool: &PgPool, game: Uuid, kinds: &[&str]) -> usize {
    stored_events(pool, game)
        .await
        .into_iter()
        .filter(|event| kinds.contains(&event.kind.as_str()))
        .count()
}

pub async fn stored_event_count_where(
    pool: &PgPool,
    game: Uuid,
    kind: &str,
    fields: &[(&str, &str)],
) -> usize {
    stored_payloads_where(pool, game, kind, fields).await.len()
}

pub async fn stored_event_count_all_where(
    pool: &PgPool,
    game: Uuid,
    fields: &[(&str, &str)],
) -> usize {
    stored_events(pool, game)
        .await
        .into_iter()
        .filter(|event| {
            fields.iter().all(|(field, expected)| {
                event.payload.get(*field).and_then(|value| value.as_str()) == Some(*expected)
            })
        })
        .count()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSealedEvent {
    pub sealed_version: i16,
    pub key_epoch: i64,
    pub nonce: Vec<u8>,
    pub body: Vec<u8>,
}

impl StoredSealedEvent {
    pub fn body_contains(&self, plaintext: &str) -> bool {
        self.body
            .windows(plaintext.len())
            .any(|window| window == plaintext.as_bytes())
    }
}

/// Physical storage canary for tests whose subject is encryption at rest.
/// Behavioral tests must use `stored_events`; this is intentionally the only
/// helper in the command corpus that reads the event table's typed seal.
pub async fn sealed_event_bodies(pool: &PgPool, game: Uuid, kind: &str) -> Vec<StoredSealedEvent> {
    sqlx::query(
        "SELECT sealed_version, stream_key_epoch, sealed_nonce, sealed_body FROM events \
         WHERE stream_id = $1 AND kind = $2 ORDER BY stream_seq",
    )
    .bind(game)
    .bind(kind)
    .fetch_all(pool)
    .await
    .expect("read physical sealed event bodies")
    .into_iter()
    .map(|row| StoredSealedEvent {
        sealed_version: row.get("sealed_version"),
        key_epoch: row.get("stream_key_epoch"),
        nonce: row.get("sealed_nonce"),
        body: row.get("sealed_body"),
    })
    .collect()
}

pub async fn latest_sealed_event_body(pool: &PgPool, game: Uuid, kind: &str) -> StoredSealedEvent {
    sealed_event_bodies(pool, game, kind)
        .await
        .into_iter()
        .next_back()
        .unwrap_or_else(|| panic!("missing sealed {kind} in stream {game}"))
}

pub fn user(id: &str) -> Principal {
    Principal::user(id)
}

/// Provision a test account through the same identity seam used by real
/// authentication. Persona/profile commands deliberately require this owner
/// row and its external subject key before accepting private claims.
pub async fn ensure_test_principal(pool: &PgPool, principal_user_id: &str) {
    ensure_test_principals(pool, [principal_user_id]).await;
}

/// Provision a set of test accounts while sharing one database connection.
/// Deduplication keeps generated fixtures cheap when the same owner appears in
/// several private claims.
pub async fn ensure_test_principals<'a>(
    pool: &PgPool,
    principal_user_ids: impl IntoIterator<Item = &'a str>,
) {
    let principal_user_ids: BTreeSet<_> = principal_user_ids.into_iter().collect();
    let mut connection = pool.acquire().await.expect("acquire identity connection");
    for principal_user_id in principal_user_ids {
        let already_active: bool = sqlx::query_scalar(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM platform_principal AS principal
                JOIN privacy_subject AS subject
                  ON subject.principal_user_id = principal.principal_user_id
                WHERE principal.principal_user_id = $1
                  AND principal.status = 'active'
                  AND subject.lifecycle_state = 'active'
            )
            "#,
        )
        .bind(principal_user_id)
        .fetch_one(&mut *connection)
        .await
        .expect("inspect test principal privacy binding");
        if already_active {
            continue;
        }
        identity::methods::ensure_principal(&mut connection, principal_user_id, &[], 1)
            .await
            .expect("provision test principal and privacy subject");
    }
}

async fn ensure_command_principals(pool: &PgPool, command: &Command) {
    let referenced = match command {
        Command::SeatPersona {
            principal_user_id, ..
        } => Some(principal_user_id.as_str()),
        Command::ProcessReplacement {
            incoming_principal_user_id,
            ..
        } => Some(incoming_principal_user_id.as_str()),
        _ => None,
    };
    if let Some(principal_user_id) = referenced {
        ensure_test_principal(pool, principal_user_id).await;
    }
}

/// Test boundary around the production command entry point. Authentication
/// fixtures are provisioned explicitly; command behavior remains production-identical.
pub async fn handle(pool: &PgPool, principal: &Principal, command: Command) -> Result<Ack, Reject> {
    ensure_command_principals(pool, &command).await;
    commands::handle(pool, principal, command).await
}

pub async fn handle_idempotent(
    pool: &PgPool,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
) -> Result<Ack, Reject> {
    ensure_command_principals(pool, &command).await;
    commands::handle_idempotent(pool, principal, command_id, command).await
}

/// Test boundary for direct projection fixtures. Any legacy logical event that
/// carries a private principal first provisions its subject/key authority.
pub async fn append_and_project(
    pool: &PgPool,
    stream_id: Uuid,
    events: &[eventstore::EventInput],
) -> Result<Vec<eventstore::StoredEvent>, projections::ProjectionError> {
    for event in events {
        if matches!(
            event.kind.as_str(),
            "GamePersonaRegistered" | "ProfileCreated" | "ProfileUpdated"
        ) {
            if let Some(principal_user_id) = event
                .payload
                .get("principal_user_id")
                .and_then(serde_json::Value::as_str)
            {
                ensure_test_principal(pool, principal_user_id).await;
            }
        }
    }
    projections::append_and_project(pool, stream_id, events).await
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
