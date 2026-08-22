//! Operator-facing resolution audit, trace inspection, and performance-proof
//! entry points. Consumed by `operator_api` routes and `operator_proof`
//! binaries; the game pipeline itself never calls into this module.

use crate::{
    fixture_principal_id, handle, host_prompt_resolution, Command, EngineInputBuilder,
    EngineRunKind, RebuiltResolutionEnvelope, Reject,
};
use caps::Principal;
use eventstore::ActorId;
use principal::PrincipalId;
use projections::audit_rebuild;
use serde::Serialize;
use sqlx::PgPool;
use std::collections::BTreeSet;
use std::time::{Duration, Instant};
use uuid::Uuid;

/// Resolution-envelope replay audit for one game stream.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionEnvelopeAuditReport {
    pub game_id: Uuid,
    pub ok: bool,
    pub audited: usize,
    pub skipped: usize,
    pub summary: ResolutionEnvelopeAuditSummary,
    pub phases: Vec<ResolutionEnvelopeAuditPhase>,
}

/// Operator-facing compact summary for a resolution-envelope replay audit.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionEnvelopeAuditSummary {
    pub matched: usize,
    pub drifted: usize,
    pub skipped: usize,
    pub first_drift_paths: Vec<ResolutionEnvelopeAuditDriftPath>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionEnvelopeAuditDriftPath {
    pub phase_id: String,
    pub run_id: String,
    pub envelope: ResolutionEnvelopeAuditEnvelope,
    pub path: String,
}

/// Replay status for one stored `ResolutionApplied` envelope.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionEnvelopeAuditPhase {
    pub phase_id: String,
    pub run_id: String,
    pub applied_stream_seq: i64,
    pub trace_stream_seq: Option<i64>,
    pub status: ResolutionEnvelopeAuditStatus,
    pub applied_matches: bool,
    pub trace_matches: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub diffs: Vec<ResolutionEnvelopeAuditDiff>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stored_applied: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebuilt_applied: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stored_trace: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebuilt_trace: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct LargeActionGraphPerformanceProof {
    pub game_id: Uuid,
    pub pack: String,
    pub phase_id: String,
    pub seed: u64,
    pub resolve_seed: u64,
    pub roster_count: usize,
    pub submitted_action_count: usize,
    pub resolution_inner_event_count: usize,
    pub stream_event_count: i64,
    pub trace_row_count: usize,
    pub phase_trace_anchored: bool,
    pub decision_trace_anchored: bool,
    pub resolve_elapsed_ms: u64,
    pub threshold_ms: u64,
    pub replay_audit_ok: bool,
    pub replay_audited: usize,
    pub replay_skipped: usize,
    pub projection_rebuild_ok: bool,
    pub pgo_triggered: bool,
    pub babysitter_death: bool,
    pub hider_death: bool,
    pub lovers_linked: bool,
    pub ok: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionEnvelopeAuditStatus {
    Matched,
    Drifted,
    Skipped,
}

/// Compact structural mismatch for a replayed resolution envelope.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionEnvelopeAuditDiff {
    pub envelope: ResolutionEnvelopeAuditEnvelope,
    pub path: String,
    pub expected: serde_json::Value,
    pub actual: serde_json::Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionEnvelopeAuditEnvelope {
    Applied,
    Trace,
}

/// Host/admin inspection report over stored `ResolutionTrace` envelopes.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceInspectionReport {
    pub game_id: Uuid,
    pub traces: Vec<ResolutionTraceInspectionRun>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceInspectionRun {
    pub phase_id: String,
    pub run_id: String,
    pub applied_stream_seq: Option<i64>,
    pub trace_stream_seq: i64,
    pub trace_version: u16,
    pub decisions: Vec<ResolutionTraceDecisionRow>,
    pub edges: Vec<ResolutionTraceEdgeRow>,
    pub generated: Vec<ResolutionTraceGeneratedRow>,
    pub effect_changes: Vec<ResolutionTraceEffectChangeRow>,
    pub visibility: Vec<ResolutionTraceVisibilityRow>,
    pub notes: Vec<ResolutionTraceNoteRow>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceDecisionRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub event_index: Option<usize>,
    pub stage: String,
    pub source: String,
    pub outcome: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceEdgeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub from: String,
    pub to: String,
    pub kind: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceGeneratedRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub action_id: String,
    pub source: String,
    pub actor: String,
    pub targets: Vec<String>,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceEffectChangeRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub effect: String,
    pub target: String,
    pub operation: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceVisibilityRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub event_index: usize,
    pub audience: Vec<String>,
    pub policy: String,
    pub detail: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ResolutionTraceNoteRow {
    pub row_index: usize,
    pub applied_stream_seq: Option<i64>,
    pub note: String,
}

/// Re-run ordinary `ResolvePhase` envelopes from the stored event stream and
/// compare the stored `ResolutionApplied` / `ResolutionTrace` payloads to the
/// freshly rebuilt resolver output.
pub async fn audit_resolution_envelopes(
    pool: &PgPool,
    game: Uuid,
) -> Result<ResolutionEnvelopeAuditReport, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut phases = Vec::new();
    let mut audited = 0;
    let mut skipped = 0;

    for (index, event) in stream.iter().enumerate() {
        if event.kind != "ResolutionApplied" {
            continue;
        }
        let stored_applied =
            domain::validate_resolution_json(&event.payload, domain::RESULT_VERSION)
                .map_err(|e| Reject::Internal(format!("malformed ResolutionApplied: {e}")))?;
        let trace_event = stream.iter().find(|candidate| {
            candidate.kind == "ResolutionTrace"
                && candidate.payload["run_id"].as_str() == Some(&stored_applied.run_id)
        });
        let stored_trace = trace_event
            .map(|trace| domain::validate_trace_json(&trace.payload, domain::TRACE_VERSION))
            .transpose()
            .map_err(|e| Reject::Internal(format!("malformed ResolutionTrace: {e}")))?;

        let prefix = &stream[..index];
        let rebuilt = if stored_applied.run_id.starts_with("resolution:") {
            Some(rerun_stored_phase(game, prefix, &stored_applied)?)
        } else if stored_applied.run_id.starts_with("host-prompt:") {
            host_prompt_resolution::rerun_stored_host_prompt(game, prefix)?
        } else {
            None
        };
        let Some(rebuilt) = rebuilt else {
            skipped += 1;
            phases.push(ResolutionEnvelopeAuditPhase {
                phase_id: stored_applied.phase_id,
                run_id: stored_applied.run_id,
                applied_stream_seq: event.stream_seq,
                trace_stream_seq: trace_event.map(|trace| trace.stream_seq),
                status: ResolutionEnvelopeAuditStatus::Skipped,
                applied_matches: false,
                trace_matches: false,
                reason: Some("unsupported resolution envelope producer".to_string()),
                diffs: Vec::new(),
                stored_applied: None,
                rebuilt_applied: None,
                stored_trace: None,
                rebuilt_trace: None,
            });
            continue;
        };

        audited += 1;
        let applied_diffs = resolution_payload_diffs(
            ResolutionEnvelopeAuditEnvelope::Applied,
            &rebuilt.applied,
            &stored_applied,
        );
        let trace_diffs = stored_trace
            .as_ref()
            .map(|trace| {
                resolution_payload_diffs(
                    ResolutionEnvelopeAuditEnvelope::Trace,
                    &rebuilt.trace,
                    trace,
                )
            })
            .unwrap_or_else(|| {
                vec![ResolutionEnvelopeAuditDiff {
                    envelope: ResolutionEnvelopeAuditEnvelope::Trace,
                    path: "$".to_string(),
                    expected: serde_json::to_value(&rebuilt.trace)
                        .expect("ResolutionTrace serializes"),
                    actual: missing_json_value(),
                }]
            });
        let applied_matches = applied_diffs.is_empty();
        let trace_matches = trace_diffs.is_empty();
        let status = if applied_matches && trace_matches {
            ResolutionEnvelopeAuditStatus::Matched
        } else {
            ResolutionEnvelopeAuditStatus::Drifted
        };
        let mut diffs = applied_diffs;
        diffs.extend(trace_diffs);

        phases.push(ResolutionEnvelopeAuditPhase {
            phase_id: stored_applied.phase_id.clone(),
            run_id: stored_applied.run_id.clone(),
            applied_stream_seq: event.stream_seq,
            trace_stream_seq: trace_event.map(|trace| trace.stream_seq),
            status,
            applied_matches,
            trace_matches,
            reason: (!trace_matches && stored_trace.is_none())
                .then(|| "matching ResolutionTrace envelope is missing".to_string()),
            diffs,
            stored_applied: (!applied_matches).then(|| {
                serde_json::to_value(&stored_applied).expect("ResolutionApplied serializes")
            }),
            rebuilt_applied: (!applied_matches).then(|| {
                serde_json::to_value(&rebuilt.applied).expect("ResolutionApplied serializes")
            }),
            stored_trace: (!trace_matches).then(|| {
                stored_trace
                    .as_ref()
                    .map(|trace| serde_json::to_value(trace).expect("ResolutionTrace serializes"))
                    .unwrap_or(serde_json::Value::Null)
            }),
            rebuilt_trace: (!trace_matches)
                .then(|| serde_json::to_value(&rebuilt.trace).expect("ResolutionTrace serializes")),
        });
    }

    let summary = resolution_audit_summary(&phases);
    Ok(ResolutionEnvelopeAuditReport {
        game_id: game,
        ok: phases
            .iter()
            .all(|phase| phase.status != ResolutionEnvelopeAuditStatus::Drifted),
        audited,
        skipped,
        summary,
        phases,
    })
}

const MAX_RESOLUTION_AUDIT_SUMMARY_PATHS: usize = 8;
const MAX_RESOLUTION_AUDIT_DIFFS: usize = 16;

fn resolution_audit_summary(
    phases: &[ResolutionEnvelopeAuditPhase],
) -> ResolutionEnvelopeAuditSummary {
    let mut summary = ResolutionEnvelopeAuditSummary {
        matched: 0,
        drifted: 0,
        skipped: 0,
        first_drift_paths: Vec::new(),
    };

    for phase in phases {
        match phase.status {
            ResolutionEnvelopeAuditStatus::Matched => summary.matched += 1,
            ResolutionEnvelopeAuditStatus::Drifted => summary.drifted += 1,
            ResolutionEnvelopeAuditStatus::Skipped => summary.skipped += 1,
        }
        if phase.status != ResolutionEnvelopeAuditStatus::Drifted {
            continue;
        }
        for diff in &phase.diffs {
            if summary.first_drift_paths.len() >= MAX_RESOLUTION_AUDIT_SUMMARY_PATHS {
                return summary;
            }
            summary
                .first_drift_paths
                .push(ResolutionEnvelopeAuditDriftPath {
                    phase_id: phase.phase_id.clone(),
                    run_id: phase.run_id.clone(),
                    envelope: diff.envelope,
                    path: diff.path.clone(),
                });
        }
    }

    summary
}

fn resolution_payload_diffs<T: serde::Serialize, U: serde::Serialize>(
    envelope: ResolutionEnvelopeAuditEnvelope,
    expected: &T,
    actual: &U,
) -> Vec<ResolutionEnvelopeAuditDiff> {
    let expected = serde_json::to_value(expected).expect("resolution audit payload serializes");
    let actual = serde_json::to_value(actual).expect("resolution audit payload serializes");
    let mut diffs = Vec::new();
    collect_json_value_diffs(envelope, "$", &expected, &actual, &mut diffs);
    diffs
}

fn json_values_match(left: &serde_json::Value, right: &serde_json::Value) -> bool {
    match (left, right) {
        (serde_json::Value::Number(left), serde_json::Value::Number(right)) => {
            left == right
                || left
                    .as_f64()
                    .zip(right.as_f64())
                    .is_some_and(|(left, right)| {
                        let tolerance = 1e-12_f64.max(left.abs().max(right.abs()) * 1e-12);
                        (left - right).abs() <= tolerance
                    })
        }
        (serde_json::Value::Array(left), serde_json::Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right.iter())
                    .all(|(left, right)| json_values_match(left, right))
        }
        (serde_json::Value::Object(left), serde_json::Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left)| {
                    right
                        .get(key)
                        .is_some_and(|right| json_values_match(left, right))
                })
        }
        _ => left == right,
    }
}

fn collect_json_value_diffs(
    envelope: ResolutionEnvelopeAuditEnvelope,
    path: &str,
    expected: &serde_json::Value,
    actual: &serde_json::Value,
    diffs: &mut Vec<ResolutionEnvelopeAuditDiff>,
) {
    if diffs.len() >= MAX_RESOLUTION_AUDIT_DIFFS || json_values_match(expected, actual) {
        return;
    }

    match (expected, actual) {
        (serde_json::Value::Array(expected), serde_json::Value::Array(actual)) => {
            let shared_len = expected.len().min(actual.len());
            for index in 0..shared_len {
                collect_json_value_diffs(
                    envelope,
                    &format!("{path}[{index}]"),
                    &expected[index],
                    &actual[index],
                    diffs,
                );
                if diffs.len() >= MAX_RESOLUTION_AUDIT_DIFFS {
                    return;
                }
            }
            if expected.len() != actual.len() {
                diffs.push(ResolutionEnvelopeAuditDiff {
                    envelope,
                    path: format!("{path}.length"),
                    expected: serde_json::json!(expected.len()),
                    actual: serde_json::json!(actual.len()),
                });
            }
        }
        (serde_json::Value::Object(expected), serde_json::Value::Object(actual)) => {
            let keys: BTreeSet<_> = expected.keys().chain(actual.keys()).collect();
            for key in keys {
                let child_path = json_path_key(path, key);
                match (expected.get(key), actual.get(key)) {
                    (Some(expected), Some(actual)) => {
                        collect_json_value_diffs(envelope, &child_path, expected, actual, diffs);
                    }
                    (Some(expected), None) => diffs.push(ResolutionEnvelopeAuditDiff {
                        envelope,
                        path: child_path,
                        expected: expected.clone(),
                        actual: missing_json_value(),
                    }),
                    (None, Some(actual)) => diffs.push(ResolutionEnvelopeAuditDiff {
                        envelope,
                        path: child_path,
                        expected: missing_json_value(),
                        actual: actual.clone(),
                    }),
                    (None, None) => {}
                }
                if diffs.len() >= MAX_RESOLUTION_AUDIT_DIFFS {
                    return;
                }
            }
        }
        _ => diffs.push(ResolutionEnvelopeAuditDiff {
            envelope,
            path: path.to_string(),
            expected: expected.clone(),
            actual: actual.clone(),
        }),
    }
}

fn json_path_key(parent: &str, key: &str) -> String {
    if key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        format!("{parent}.{key}")
    } else {
        format!(
            "{}[{}]",
            parent,
            serde_json::to_string(key).expect("JSON object key serializes")
        )
    }
}

fn missing_json_value() -> serde_json::Value {
    serde_json::json!({ "__audit_missing": true })
}

/// Inspect stored `ResolutionTrace` envelopes for host/admin tooling.
pub async fn inspect_resolution_traces(
    pool: &PgPool,
    game: Uuid,
    run_id: Option<&str>,
) -> Result<ResolutionTraceInspectionReport, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut traces = Vec::new();

    for event in stream
        .iter()
        .filter(|event| event.kind == "ResolutionTrace")
    {
        let trace = domain::validate_trace_json(&event.payload, domain::TRACE_VERSION)
            .map_err(|e| Reject::Internal(format!("malformed ResolutionTrace: {e}")))?;
        if run_id.is_some_and(|wanted| wanted != trace.run_id) {
            continue;
        }
        let applied_stream_seq = stream
            .iter()
            .find(|candidate| {
                candidate.kind == "ResolutionApplied"
                    && candidate.payload["run_id"].as_str() == Some(&trace.run_id)
            })
            .map(|candidate| candidate.stream_seq);
        traces.push(trace_inspection_run(
            trace,
            event.stream_seq,
            applied_stream_seq,
        ));
    }

    Ok(ResolutionTraceInspectionReport {
        game_id: game,
        traces,
    })
}

fn trace_inspection_run(
    trace: domain::ResolutionTrace,
    trace_stream_seq: i64,
    applied_stream_seq: Option<i64>,
) -> ResolutionTraceInspectionRun {
    ResolutionTraceInspectionRun {
        phase_id: trace.phase_id,
        run_id: trace.run_id,
        applied_stream_seq,
        trace_stream_seq,
        trace_version: trace.trace_version,
        decisions: trace
            .decisions
            .into_iter()
            .enumerate()
            .map(|(row_index, decision)| ResolutionTraceDecisionRow {
                row_index,
                applied_stream_seq,
                event_index: source_event_index(&decision.source),
                stage: decision.stage,
                source: decision.source,
                outcome: decision.outcome,
                detail: inspection_detail(decision.detail),
            })
            .collect(),
        edges: trace
            .edges
            .into_iter()
            .enumerate()
            .map(|(row_index, edge)| ResolutionTraceEdgeRow {
                row_index,
                applied_stream_seq,
                from: edge.from,
                to: edge.to,
                kind: edge.kind,
                detail: inspection_detail(edge.detail),
            })
            .collect(),
        generated: trace
            .generated
            .into_iter()
            .enumerate()
            .map(|(row_index, generated)| ResolutionTraceGeneratedRow {
                row_index,
                applied_stream_seq,
                action_id: generated.action_id,
                source: generated.source,
                actor: generated.actor,
                targets: generated.targets,
                detail: inspection_detail(generated.detail),
            })
            .collect(),
        effect_changes: trace
            .effect_changes
            .into_iter()
            .enumerate()
            .map(|(row_index, effect)| ResolutionTraceEffectChangeRow {
                row_index,
                applied_stream_seq,
                effect: effect.effect,
                target: effect.target,
                operation: effect.operation,
                detail: inspection_detail(effect.detail),
            })
            .collect(),
        visibility: trace
            .visibility
            .into_iter()
            .enumerate()
            .map(|(row_index, visibility)| ResolutionTraceVisibilityRow {
                row_index,
                applied_stream_seq,
                event_index: visibility.event_index,
                audience: visibility.audience,
                policy: visibility.policy,
                detail: inspection_detail(visibility.detail),
            })
            .collect(),
        notes: trace
            .notes
            .into_iter()
            .enumerate()
            .map(|(row_index, note)| ResolutionTraceNoteRow {
                row_index,
                applied_stream_seq,
                note,
            })
            .collect(),
    }
}

/// Persist traces omit null detail. Inspection maps that to an empty object so
/// the fail-closed wire adapter never sees `null` as a stand-in for a map.
fn inspection_detail(detail: impl Into<serde_json::Value>) -> serde_json::Value {
    let value = detail.into();
    if value.is_null() {
        serde_json::json!({})
    } else {
        value
    }
}

fn source_event_index(source: &str) -> Option<usize> {
    source
        .strip_prefix("event_index:")
        .and_then(|value| value.parse().ok())
}

pub async fn run_large_action_graph_performance_proof(
    pool: &PgPool,
    game: Uuid,
    seed: u64,
    threshold: Duration,
) -> Result<LargeActionGraphPerformanceProof, Reject> {
    let host = Principal::authenticated(fixture_principal_id("host_h"));
    let roster = large_action_graph_roster();
    let actions = large_action_graph_actions();

    handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await?;
    for (slot, role) in &roster {
        handle(
            pool,
            &host,
            Command::AddSlot {
                game,
                slot: (*slot).into(),
            },
        )
        .await?;
        handle(
            pool,
            &host,
            crate::seat_persona! {
                game,
                slot: (*slot).into(),
                user: format!("large_graph_user_{}", slot_number(slot)?),
            },
        )
        .await?;
        handle(
            pool,
            &host,
            Command::AssignRole {
                game,
                slot: (*slot).into(),
                role_key: (*role).into(),
            },
        )
        .await?;
    }
    handle(
        pool,
        &host,
        Command::StartGame {
            game,
            phase: "N01".into(),
        },
    )
    .await?;

    for (actor_slot, template_id, action_slug, targets) in &actions {
        handle(
            pool,
            &Principal::authenticated(fixture_principal_id(format!(
                "large_graph_user_{}",
                slot_number(actor_slot)?
            ))),
            Command::SubmitAction {
                game,
                action_id: format!("large_graph_{action_slug}"),
                actor_slot: (*actor_slot).into(),
                template_id: (*template_id).into(),
                targets: targets.iter().map(|target| (*target).to_string()).collect(),
                grant_id: None,
            },
        )
        .await?;
    }

    let resolve_seed = seed + 41_000;
    let resolve_started = Instant::now();
    let ack = handle(
        pool,
        &host,
        Command::ResolvePhase {
            game,
            seed: resolve_seed,
        },
    )
    .await?;
    let resolve_elapsed = resolve_started.elapsed();
    let resolution_events_appended = ack.stream_seqs.len() == 3;

    let applied_payload = resolution_payload_for_phase(pool, game, "N01").await?;
    let applied = domain::validate_resolution_json(&applied_payload, domain::RESULT_VERSION)
        .map_err(|err| Reject::Internal(format!("large graph ResolutionApplied invalid: {err}")))?;
    let resolution_inner_event_count = applied.events.len();
    let pgo_triggered = applied.events.iter().any(|event| {
        matches!(&event.event, domain::InnerEvent::Trigger { trigger_id, .. }
            if trigger_id == "pgo_shoots_visitor")
    });
    let babysitter_death = applied.events.iter().any(|event| {
        matches!(&event.event, domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_32" && cause == "babysit")
    });
    let hider_death = applied.events.iter().any(|event| {
        matches!(&event.event, domain::InnerEvent::PlayerKilled { slot_id, cause, .. }
            if slot_id == "slot_21" && cause == "hide")
    });
    let lovers_linked = applied.events.iter().any(|event| {
        matches!(&event.event, domain::InnerEvent::PlayersLinked { slots, source, .. }
            if slots == &vec!["slot_31".to_string(), "slot_35".to_string()]
                && source == "slot_30")
    });

    let audit = audit_resolution_envelopes(pool, game).await?;
    let trace_report = inspect_resolution_traces(pool, game, None).await?;
    let trace_row_count = trace_report
        .traces
        .iter()
        .map(|trace| {
            trace.decisions.len()
                + trace.edges.len()
                + trace.generated.len()
                + trace.effect_changes.len()
                + trace.visibility.len()
                + trace.notes.len()
        })
        .sum();
    let phase_trace_anchored = trace_report
        .traces
        .iter()
        .any(|trace| trace.applied_stream_seq.is_some());
    let decision_trace_anchored = trace_report.traces.iter().any(|trace| {
        trace
            .decisions
            .iter()
            .any(|decision| decision.applied_stream_seq.is_some())
    });
    let projection_audit = audit_rebuild(pool, game).await?;
    let stream_event_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(pool)
            .await
            .map_err(|err| Reject::Internal(err.to_string()))?;
    let resolve_elapsed_ms = resolve_elapsed.as_millis().try_into().unwrap_or(u64::MAX);
    let threshold_ms = threshold.as_millis().try_into().unwrap_or(u64::MAX);
    let ok = resolution_events_appended
        && resolution_inner_event_count < 200
        && pgo_triggered
        && babysitter_death
        && hider_death
        && lovers_linked
        && audit.ok
        && audit.audited == 1
        && audit.skipped == 0
        && trace_report.traces.len() == 1
        && trace_row_count < 5_000
        && phase_trace_anchored
        && decision_trace_anchored
        && projection_audit.ok
        // Persona registration plus immutable epoch facts are the canonical
        // roster history. Their fixed per-seat cost replaces the former one
        // mutable assignment fact; keep the performance ceiling explicit.
        && stream_event_count <= 300
        && resolve_elapsed <= threshold;

    Ok(LargeActionGraphPerformanceProof {
        game_id: game,
        pack: "mafiascum".to_string(),
        phase_id: "N01".to_string(),
        seed,
        resolve_seed,
        roster_count: roster.len(),
        submitted_action_count: actions.len(),
        resolution_inner_event_count,
        stream_event_count,
        trace_row_count,
        phase_trace_anchored,
        decision_trace_anchored,
        resolve_elapsed_ms,
        threshold_ms,
        replay_audit_ok: audit.ok,
        replay_audited: audit.audited,
        replay_skipped: audit.skipped,
        projection_rebuild_ok: projection_audit.ok,
        pgo_triggered,
        babysitter_death,
        hider_death,
        lovers_linked,
        ok,
    })
}

async fn resolution_payload_for_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
) -> Result<serde_json::Value, Reject> {
    eventstore::load_stream(pool, game)
        .await
        .map_err(|err| Reject::Internal(err.to_string()))?
        .into_iter()
        .find(|event| {
            event.kind == "ResolutionApplied"
                && event.payload["phase_id"].as_str() == Some(phase_id)
        })
        .map(|event| event.payload)
        .ok_or_else(|| {
            Reject::Internal(format!(
                "ResolutionApplied for phase `{phase_id}` is missing"
            ))
        })
}

fn slot_number(slot: &str) -> Result<usize, Reject> {
    slot.strip_prefix("slot_")
        .and_then(|number| number.parse().ok())
        .ok_or_else(|| Reject::Internal(format!("invalid large graph slot id {slot}")))
}

fn large_action_graph_roster() -> Vec<(&'static str, &'static str)> {
    vec![
        ("slot_1", "bus_driver"),
        ("slot_2", "bus_driver"),
        ("slot_3", "redirector"),
        ("slot_4", "redirector"),
        ("slot_5", "doctor"),
        ("slot_6", "doctor"),
        ("slot_7", "bodyguard"),
        ("slot_8", "babysitter"),
        ("slot_9", "jailkeeper"),
        ("slot_10", "roleblocker"),
        ("slot_11", "roleblocker"),
        ("slot_12", "tracker"),
        ("slot_13", "tracker"),
        ("slot_14", "watcher"),
        ("slot_15", "watcher"),
        ("slot_16", "motion_detector"),
        ("slot_17", "motion_detector"),
        ("slot_18", "cop"),
        ("slot_19", "cop"),
        ("slot_20", "commuter"),
        ("slot_21", "hider"),
        ("slot_22", "paranoid_gun_owner"),
        ("slot_23", "mafia_goon"),
        ("slot_24", "mafia_goon"),
        ("slot_25", "mafia_goon"),
        ("slot_26", "mafia_goon"),
        ("slot_27", "strongman"),
        ("slot_28", "strongman"),
        ("slot_29", "hunter"),
        ("slot_30", "cupid"),
        ("slot_31", "vanilla_townie"),
        ("slot_32", "vanilla_townie"),
        ("slot_33", "vanilla_townie"),
        ("slot_34", "vanilla_townie"),
        ("slot_35", "vanilla_townie"),
        ("slot_36", "vanilla_townie"),
        ("slot_37", "vanilla_townie"),
        ("slot_38", "vanilla_townie"),
        ("slot_39", "vanilla_townie"),
        ("slot_40", "vanilla_townie"),
    ]
}

fn large_action_graph_actions() -> Vec<(&'static str, &'static str, &'static str, Vec<&'static str>)>
{
    vec![
        (
            "slot_1",
            "bus_driver_swap",
            "swap_33_34",
            vec!["slot_33", "slot_34"],
        ),
        (
            "slot_2",
            "bus_driver_swap",
            "swap_37_38",
            vec!["slot_37", "slot_38"],
        ),
        (
            "slot_3",
            "redirect",
            "redirect_39_40",
            vec!["slot_39", "slot_40"],
        ),
        (
            "slot_4",
            "redirect",
            "redirect_5_6",
            vec!["slot_5", "slot_6"],
        ),
        (
            "slot_5",
            "doctor_protect",
            "doctor_protects_31",
            vec!["slot_31"],
        ),
        (
            "slot_6",
            "doctor_protect",
            "doctor_protects_pgo",
            vec!["slot_22"],
        ),
        (
            "slot_7",
            "bodyguard",
            "bodyguard_protects_31",
            vec!["slot_31"],
        ),
        ("slot_8", "babysit", "babysitter_guards_32", vec!["slot_32"]),
        ("slot_9", "jail", "jailkeeper_jails_23", vec!["slot_23"]),
        (
            "slot_10",
            "roleblocker_block",
            "roleblocker_visits_pgo",
            vec!["slot_22"],
        ),
        (
            "slot_11",
            "roleblocker_block",
            "roleblocker_blocks_cop",
            vec!["slot_18"],
        ),
        ("slot_12", "track", "tracker_tracks_23", vec!["slot_23"]),
        ("slot_13", "track", "tracker_tracks_28", vec!["slot_28"]),
        ("slot_14", "watch", "watcher_watches_31", vec!["slot_31"]),
        ("slot_15", "watch", "watcher_watches_pgo", vec!["slot_22"]),
        (
            "slot_16",
            "motion_detector",
            "motion_checks_23",
            vec!["slot_23"],
        ),
        (
            "slot_17",
            "motion_detector",
            "motion_checks_31",
            vec!["slot_31"],
        ),
        (
            "slot_18",
            "cop_investigate",
            "cop_checks_23",
            vec!["slot_23"],
        ),
        (
            "slot_19",
            "cop_investigate",
            "cop_checks_31",
            vec!["slot_31"],
        ),
        ("slot_20", "commute", "commuter_commutes", vec!["slot_20"]),
        ("slot_21", "hide", "hider_hides_behind_31", vec!["slot_31"]),
        (
            "slot_23",
            "factional_kill",
            "goon_kills_31",
            vec!["slot_31"],
        ),
        (
            "slot_24",
            "factional_kill",
            "goon_kills_babysitter",
            vec!["slot_8"],
        ),
        (
            "slot_25",
            "factional_kill",
            "goon_kills_32",
            vec!["slot_32"],
        ),
        (
            "slot_26",
            "factional_kill",
            "goon_kills_hider",
            vec!["slot_21"],
        ),
        (
            "slot_27",
            "strongman_kill",
            "strongman_kills_36",
            vec!["slot_36"],
        ),
        (
            "slot_28",
            "strongman_kill",
            "strongman_kills_31",
            vec!["slot_31"],
        ),
        (
            "slot_29",
            "hunter_retaliate",
            "hunter_arms_on_24",
            vec!["slot_24"],
        ),
        (
            "slot_30",
            "link_lovers",
            "cupid_links_31_35",
            vec!["slot_31", "slot_35"],
        ),
    ]
}

fn rerun_stored_phase(
    game: Uuid,
    prefix: &[eventstore::StoredEvent],
    stored: &domain::ResolutionApplied,
) -> Result<RebuiltResolutionEnvelope, Reject> {
    let phase_input = EngineInputBuilder::new(game, prefix, &stored.phase_id).build()?;
    let output = domain::resolve(phase_input.resolve_input(EngineRunKind::Replay {
        run_id: &stored.run_id,
        seed: stored.seed,
        logical_time: stored.started_at,
    }));
    domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid rebuilt resolution result: {e}")))?;
    domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid rebuilt resolution trace: {e}")))?;
    Ok(RebuiltResolutionEnvelope {
        applied: output.applied,
        trace: output.trace,
    })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineSnapshotIdentityAudit {
    pub phase_id: String,
    pub snapshot_slot_ids: Vec<String>,
    pub stream_principal_ids: Vec<PrincipalId>,
    pub leaked_principal_ids: Vec<PrincipalId>,
    pub slot_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnginePhaseInputAudit {
    pub phase_id: String,
    pub phase_kind: domain::pack::PhaseKind,
    pub phase_number: u32,
    pub pack_ref: content_registry::PackRef,
    pub state: domain::StateSnapshot,
    pub submissions: Vec<domain::Submission>,
    pub day_phase_inputs: domain::DayPhaseInputs,
}

/// Load the engine-facing, slot-only snapshot for a stored game stream and
/// phase id. This is the command-layer audit seam for proving that platform
/// events can be deterministically reduced to domain input without leaking
/// user/account identity into the resolver.
pub async fn load_engine_snapshot(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
) -> Result<domain::StateSnapshot, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    Ok(EngineInputBuilder::new(game, &stream, phase_id)
        .build()?
        .state)
}

/// Load the complete reducer output that feeds one resolver run. This is the
/// audit/debug seam for command-produced submissions: the platform keeps raw
/// submit/withdraw history in the stream, and the domain receives that ordered
/// history as `Submission` values instead of relying on a projection-only tally.
pub async fn load_engine_phase_input(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
) -> Result<EnginePhaseInputAudit, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let phase_input = EngineInputBuilder::new(game, &stream, phase_id).build()?;

    Ok(EnginePhaseInputAudit {
        phase_id: phase_input.phase_id,
        phase_kind: phase_input.phase_kind,
        phase_number: phase_input.phase_number,
        pack_ref: phase_input.pack_ref,
        state: phase_input.state,
        submissions: phase_input.submissions,
        day_phase_inputs: phase_input.day_phase_inputs,
    })
}

/// Audit the PrincipalId/SlotId boundary at the command-to-engine seam.
///
/// Platform identity is valid in the event stream for host, cohost,
/// occupant, and replacement events. The engine snapshot is resolver input,
/// so it must retain stable slot ids only.
pub async fn audit_engine_snapshot_identity_boundary(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
) -> Result<EngineSnapshotIdentityAudit, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let snapshot = EngineInputBuilder::new(game, &stream, phase_id)
        .build()?
        .state;
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| Reject::Internal(format!("serialize engine snapshot: {e}")))?;
    let stream_principal_ids = stream_platform_principal_ids(&stream);
    let leaked_principal_ids = stream_principal_ids
        .iter()
        .filter(|principal_id| snapshot_json.contains(&principal_id.to_string()))
        .cloned()
        .collect::<Vec<_>>();
    let snapshot_slot_ids = snapshot
        .slots
        .iter()
        .map(|slot| slot.slot_id.clone())
        .collect::<Vec<_>>();
    let slot_only = leaked_principal_ids.is_empty();

    Ok(EngineSnapshotIdentityAudit {
        phase_id: phase_id.to_string(),
        snapshot_slot_ids,
        stream_principal_ids,
        leaked_principal_ids,
        slot_only,
    })
}

fn stream_platform_principal_ids(stream: &[eventstore::StoredEvent]) -> Vec<PrincipalId> {
    let mut principal_ids = BTreeSet::new();
    for ev in stream {
        if let ActorId::Principal(principal_id) = &ev.actor {
            principal_ids.insert(*principal_id);
        }
        collect_platform_principal_ids(&ev.payload, &mut principal_ids);
        collect_platform_principal_ids(&ev.meta, &mut principal_ids);
    }
    principal_ids.into_iter().collect()
}

fn collect_platform_principal_ids(
    value: &serde_json::Value,
    principal_ids: &mut BTreeSet<PrincipalId>,
) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                if key == "principal_id" {
                    if let Some(raw_principal_id) = nested.as_str() {
                        if let Ok(principal_id) = raw_principal_id.parse() {
                            principal_ids.insert(principal_id);
                        }
                    }
                }
                collect_platform_principal_ids(nested, principal_ids);
            }
        }
        serde_json::Value::Array(values) => {
            for nested in values {
                collect_platform_principal_ids(nested, principal_ids);
            }
        }
        _ => {}
    }
}
