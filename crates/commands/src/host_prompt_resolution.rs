//! Host-prompt resolution and replay reconstruction boundary.
//!
//! The command composition root performs shared game/capability admission and
//! retains transaction, idempotency, dispatch, and append/project ownership.
//! This module owns the admitted prompt operation: prompt lookup, pack-declared
//! effect selection, public-resolution derivation, PK envelope construction,
//! phase-advance adaptation, and deterministic replay reconstruction.

use super::{
    load_pack, pack_artifact_from_stream, persist, phase_kind, phase_number, require_slot_alive,
    str_payload, unix_seconds_now, validate_phase_id_for_policy, Ack, HostPromptDecision,
    RebuiltResolutionEnvelope, Reject,
};
use domain::pack::{
    HostPromptDecisionKind, HostPromptResolutionEffect, HostPromptResolutionEffectPolicy,
};
use eventstore::{ActorId, EventInput, StoredEvent};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) struct HostPromptResolutionRequest {
    pub(super) game: Uuid,
    pub(super) prompt_id: String,
    pub(super) decision: HostPromptDecision,
}

pub(super) struct HostPromptResolutionContext<'operation, 'transaction> {
    tx: &'operation mut Transaction<'transaction, Postgres>,
    request: HostPromptResolutionRequest,
}

impl<'operation, 'transaction> HostPromptResolutionContext<'operation, 'transaction> {
    pub(super) fn new(
        tx: &'operation mut Transaction<'transaction, Postgres>,
        request: HostPromptResolutionRequest,
    ) -> Self {
        Self { tx, request }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HostPromptEffect {
    PkKill {
        selected: String,
        contenders: Vec<String>,
    },
    AdvancePhase {
        phase_id: domain::phase::PhaseId,
        reason: &'static str,
        skipped_phase_id: Option<domain::phase::PhaseId>,
    },
    AcknowledgeOnly,
}

struct PkResolutionContext<'prompt> {
    pack: &'prompt domain::Pack,
    game: Uuid,
    prompt: &'prompt projections::HostPromptRow,
    selected: String,
    contenders: Vec<String>,
    decision_json: serde_json::Value,
    prompt_resolved_seq: i64,
}

#[derive(Debug, serde::Serialize)]
struct HostPromptPhaseControlPayload {
    phase_id: domain::phase::PhaseId,
    phase_opened_at: i64,
    source_prompt_id: String,
    source_phase_id: domain::phase::PhaseId,
    reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped_phase_id: Option<domain::phase::PhaseId>,
}

/// Resolve an already-admitted host prompt and persist the resulting events
/// through the command root's shared append/project boundary.
pub(super) async fn resolve_host_prompt(
    context: HostPromptResolutionContext<'_, '_>,
) -> Result<Ack, Reject> {
    let HostPromptResolutionContext { tx, request } = context;
    let HostPromptResolutionRequest {
        game,
        prompt_id,
        decision,
    } = request;

    let prompt = projections::host_prompts(&mut **tx, game)
        .await?
        .into_iter()
        .find(|prompt| prompt.prompt_id == prompt_id)
        .ok_or(Reject::UnknownPrompt)?;
    if prompt.status != "pending" {
        return Err(Reject::PromptAlreadyResolved);
    }

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    let next_seq = stream.last().map(|event| event.stream_seq + 1).unwrap_or(1);
    let decision_json =
        serde_json::to_value(&decision).map_err(|error| Reject::Internal(error.to_string()))?;
    let effect = host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        &stream,
    )?;
    let public_resolution = host_prompt_public_resolution(&prompt, &effect)?;
    let phase_opened_at = unix_seconds_now()?;
    let resolved_event = EventInput::new(
        "HostPromptResolved",
        1,
        serde_json::json!({
            "prompt_id": prompt.prompt_id,
            "phase_id": prompt.phase_id,
            "kind": prompt.kind,
            "reason": prompt.reason,
            "decision": decision_json,
            "public_resolution": public_resolution,
        }),
        ActorId::Host,
        next_seq,
    );

    let mut events = vec![resolved_event];
    match effect {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => {
            require_slot_alive(tx, game, &selected).await?;
            let rebuilt = build_pk_prompt_resolution(PkResolutionContext {
                pack: &pack,
                game,
                prompt: &prompt,
                selected,
                contenders,
                decision_json: decision_json.clone(),
                prompt_resolved_seq: next_seq,
            })?;

            events.push(EventInput::resolution_applied(
                serde_json::to_value(rebuilt.applied)
                    .map_err(|error| Reject::Internal(error.to_string()))?,
                ActorId::System,
                next_seq + 1,
            ));
            events.push(EventInput::resolution_trace(
                serde_json::to_value(rebuilt.trace)
                    .map_err(|error| Reject::Internal(error.to_string()))?,
                ActorId::System,
                next_seq + 2,
            ));
        }
        HostPromptEffect::AdvancePhase {
            phase_id,
            reason,
            skipped_phase_id,
        } => events.push(phase_advanced_from_prompt(
            &prompt,
            phase_id,
            reason,
            skipped_phase_id,
            next_seq + 1,
            phase_opened_at,
        )?),
        HostPromptEffect::AcknowledgeOnly => {}
    }

    persist(tx, game, &events).await
}

/// Rebuild a stored host-prompt envelope from the preceding event stream.
/// Non-PK prompt effects intentionally return `None` because they do not
/// produce resolution envelopes.
pub(super) fn rerun_stored_host_prompt(
    game: Uuid,
    prefix: &[StoredEvent],
) -> Result<Option<RebuiltResolutionEnvelope>, Reject> {
    let resolved = match prefix
        .last()
        .filter(|event| event.kind == "HostPromptResolved")
    {
        Some(resolved) => resolved,
        None => return Ok(None),
    };
    let prompt_id = str_payload(resolved, "prompt_id")?;
    let prompt = host_prompt_from_stream(prefix, &prompt_id)?;
    let decision_json = resolved.payload["decision"].clone();
    let decision: HostPromptDecision =
        serde_json::from_value(decision_json.clone()).map_err(|error| {
            Reject::Internal(format!("malformed HostPromptResolved decision: {error}"))
        })?;
    let pack = load_pack(&pack_artifact_from_stream(prefix)?)?;
    let stored_public_resolution: domain::HostPromptPublicResolution =
        serde_json::from_value(resolved.payload["public_resolution"].clone()).map_err(|error| {
            Reject::Internal(format!(
                "malformed HostPromptResolved public_resolution: {error}"
            ))
        })?;

    let effect = host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        prefix,
    )?;
    let rebuilt_public_resolution = host_prompt_public_resolution(&prompt, &effect)?;
    if stored_public_resolution != rebuilt_public_resolution {
        return Err(Reject::Internal(
            "HostPromptResolved public_resolution does not match rebuilt prompt effect".to_string(),
        ));
    }

    match effect {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => Ok(Some(build_pk_prompt_resolution(PkResolutionContext {
            pack: &pack,
            game,
            prompt: &prompt,
            selected,
            contenders,
            decision_json,
            prompt_resolved_seq: resolved.stream_seq,
        })?)),
        HostPromptEffect::AdvancePhase { .. } | HostPromptEffect::AcknowledgeOnly => Ok(None),
    }
}

fn host_prompt_from_stream(
    stream: &[StoredEvent],
    prompt_id: &str,
) -> Result<projections::HostPromptRow, Reject> {
    for event in stream {
        if event.kind != "ResolutionApplied" {
            continue;
        }
        let applied = domain::validate_resolution_json(&event.payload, domain::RESULT_VERSION)
            .map_err(|error| Reject::Internal(format!("malformed ResolutionApplied: {error}")))?;
        for indexed in applied.events {
            let domain::InnerEvent::HostPromptIssued(prompt) = indexed.event else {
                continue;
            };
            if prompt.prompt_id != prompt_id {
                continue;
            }
            return Ok(projections::HostPromptRow {
                game_id: event.stream_id,
                phase_id: prompt.phase_id.clone(),
                event_index: indexed.index as i32,
                prompt_id: prompt.prompt_id,
                kind: prompt.kind,
                subject_slot: prompt.subject,
                reason: prompt.reason,
                phase_kind: prompt.phase_id.kind().name().to_string(),
                phase_number: i32::try_from(prompt.phase_id.number()).map_err(|_| {
                    Reject::Internal("prompt phase ordinal exceeds projection storage range".into())
                })?,
                metadata: serde_json::to_value(&prompt.metadata).map_err(|error| {
                    Reject::Internal(format!("serialize HostPromptIssued metadata: {error}"))
                })?,
                status: "resolved".to_string(),
                decision: None,
                public_resolution: None,
                resolved_at: None,
            });
        }
    }

    Err(Reject::UnknownPrompt)
}

fn build_pk_prompt_resolution(
    context: PkResolutionContext<'_>,
) -> Result<RebuiltResolutionEnvelope, Reject> {
    let PkResolutionContext {
        pack,
        game,
        prompt,
        selected,
        contenders,
        decision_json,
        prompt_resolved_seq,
    } = context;
    let phase_id = prompt.phase_id.clone();
    let phase_kind = phase_kind(&phase_id);
    let (template_id, audience, deaths) = domain::day_death_announcement_metadata(
        pack,
        phase_kind,
        vec![domain::Death {
            slot_id: selected.clone(),
            cause: "host_prompt:pk".to_string(),
            template_id: None,
            audience: None,
        }],
    );
    let run_id = format!(
        "host-prompt:{game}:{}:{}:{prompt_resolved_seq}",
        prompt.phase_id, prompt.prompt_id
    );
    let applied = domain::ResolutionApplied {
        phase_id: phase_id.clone(),
        run_id: run_id.clone(),
        result_version: domain::RESULT_VERSION,
        seed: 0,
        counts: domain::events::ResolutionCounts {
            events: 2,
            kills: 1,
            saves: 0,
        },
        events: vec![
            domain::events::IndexedEvent {
                index: 0,
                event: domain::InnerEvent::PlayerKilled {
                    slot_id: selected.clone(),
                    cause: "host_prompt:pk".to_string(),
                    attackers: Vec::new(),
                    unstoppable: true,
                    death_reveal: domain::DeathRevealMode::Full,
                },
            },
            domain::events::IndexedEvent {
                index: 1,
                event: domain::InnerEvent::PhaseAnnouncement(domain::PhaseAnnouncement {
                    phase_id: phase_id.clone(),
                    template_id,
                    audience,
                    deaths,
                }),
            },
        ],
        started_at: prompt_resolved_seq as u64,
        finished_at: prompt_resolved_seq as u64 + 1,
    };
    domain::validate_resolution_applied(&applied, domain::RESULT_VERSION)
        .map_err(|error| Reject::Internal(format!("invalid prompt resolution result: {error}")))?;
    let trace = domain::ResolutionTrace {
        phase_id,
        run_id,
        trace_version: domain::TRACE_VERSION,
        edges: Vec::new(),
        generated: Vec::new(),
        effect_changes: Vec::new(),
        visibility: Vec::new(),
        decisions: vec![domain::DecisionTrace {
            stage: "host_prompt:resolve".to_string(),
            source: prompt.prompt_id.clone(),
            outcome: "pk_selected".to_string(),
            detail: serde_json::json!({
                "prompt_id": prompt.prompt_id,
                "kind": prompt.kind,
                "reason": prompt.reason,
                "selected_slot": selected,
                "contenders": contenders,
                "decision": decision_json,
            })
            .into(),
        }],
        notes: Vec::new(),
    };
    domain::validate_resolution_trace(&trace, domain::TRACE_VERSION)
        .map_err(|error| Reject::Internal(format!("invalid prompt resolution trace: {error}")))?;

    Ok(RebuiltResolutionEnvelope { applied, trace })
}

fn host_prompt_effect(
    policies: &[HostPromptResolutionEffectPolicy],
    phase_policy: &domain::pack::PhasePolicy,
    prompt: &projections::HostPromptRow,
    decision: &HostPromptDecision,
    stream: &[StoredEvent],
) -> Result<HostPromptEffect, Reject> {
    // Projection ingress has already decoded and canonicalized this opaque
    // coordinate. Do not reparse it through a lossy string boundary here.
    let prompt_phase_id = prompt.phase_id.clone();
    let prompt_policies: Vec<&HostPromptResolutionEffectPolicy> = policies
        .iter()
        .filter(|policy| policy.prompt_kind == prompt.kind && policy.prompt_reason == prompt.reason)
        .collect();
    if prompt_policies.is_empty() {
        return Err(Reject::Internal(format!(
            "pack has no host prompt resolution effect for {}:{}",
            prompt.kind, prompt.reason
        )));
    }
    let decision_kind = host_prompt_decision_kind(decision);
    let selected_policy = host_prompt_selected_policy(decision);
    let policy = prompt_policies
        .into_iter()
        .find(|policy| {
            policy.decision == decision_kind
                && selected_policy
                    .map(|selected| policy.id == selected)
                    .unwrap_or(true)
        })
        .ok_or(Reject::InvalidPromptDecision)?;
    match (policy.decision, policy.effect) {
        (HostPromptDecisionKind::SelectPolicy, HostPromptResolutionEffect::AdvanceRevote)
        | (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AdvanceRevote) => {
            if !matches!(
                decision,
                HostPromptDecision::Acknowledge { .. } | HostPromptDecision::SelectPolicy { .. }
            ) {
                return Err(Reject::InvalidPromptDecision);
            }
            let phase_id = next_revote_phase_id(stream, &prompt_phase_id)?;
            validate_phase_id_for_policy(phase_policy, &phase_id)?;
            Ok(HostPromptEffect::AdvancePhase {
                phase_id,
                reason: "revote",
                skipped_phase_id: None,
            })
        }
        (HostPromptDecisionKind::SelectPolicy, HostPromptResolutionEffect::AdvanceNight) => {
            if !matches!(decision, HostPromptDecision::SelectPolicy { .. }) {
                return Err(Reject::InvalidPromptDecision);
            }
            let phase_id = no_majority_advance_night_target(&prompt_phase_id)?;
            validate_phase_id_for_policy(phase_policy, &phase_id)?;
            Ok(HostPromptEffect::AdvancePhase {
                phase_id,
                reason: "no_majority_no_lynch",
                skipped_phase_id: None,
            })
        }
        (HostPromptDecisionKind::SelectPolicy, HostPromptResolutionEffect::AcknowledgeOnly)
        | (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AcknowledgeOnly) => {
            if !matches!(
                decision,
                HostPromptDecision::Acknowledge { .. } | HostPromptDecision::SelectPolicy { .. }
            ) {
                return Err(Reject::InvalidPromptDecision);
            }
            Ok(HostPromptEffect::AcknowledgeOnly)
        }
        (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::SkipNextDay) => {
            if !matches!(decision, HostPromptDecision::Acknowledge { .. }) {
                return Err(Reject::InvalidPromptDecision);
            }
            let (skipped_phase_id, phase_id) = skip_next_day_target(&prompt_phase_id)?;
            validate_phase_id_for_policy(phase_policy, &skipped_phase_id)?;
            validate_phase_id_for_policy(phase_policy, &phase_id)?;
            Ok(HostPromptEffect::AdvancePhase {
                phase_id,
                reason: "skip_next_day",
                skipped_phase_id: Some(skipped_phase_id),
            })
        }
        (HostPromptDecisionKind::SelectSlot, HostPromptResolutionEffect::PkKill) => {
            let selected = match decision {
                HostPromptDecision::SelectSlot { slot } => slot.clone(),
                HostPromptDecision::Acknowledge { .. }
                | HostPromptDecision::SelectPolicy { .. } => {
                    return Err(Reject::InvalidPromptDecision);
                }
            };
            let contenders = prompt
                .metadata
                .get("contenders")
                .and_then(|value| value.as_array())
                .map(|values| {
                    values
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if contenders.is_empty() || !contenders.iter().any(|contender| contender == &selected) {
                return Err(Reject::InvalidPromptDecision);
            }
            Ok(HostPromptEffect::PkKill {
                selected,
                contenders,
            })
        }
        _ => Err(Reject::Internal(format!(
            "invalid host prompt resolution effect policy `{}`",
            policy.id
        ))),
    }
}

fn host_prompt_public_resolution(
    prompt: &projections::HostPromptRow,
    effect: &HostPromptEffect,
) -> Result<domain::HostPromptPublicResolution, Reject> {
    let prompt_phase_id = prompt.phase_id.clone();
    match effect {
        HostPromptEffect::PkKill { selected, .. } => {
            Ok(domain::HostPromptPublicResolution::DayVoteElimination {
                phase_id: prompt_phase_id,
                selected_slot: selected.clone(),
                reason: prompt.reason.clone(),
            })
        }
        HostPromptEffect::AdvancePhase {
            phase_id,
            reason,
            skipped_phase_id,
        } => Ok(domain::HostPromptPublicResolution::PhaseAdvance {
            source_phase_id: prompt_phase_id,
            target_phase_id: phase_id.clone(),
            reason: (*reason).to_string(),
            skipped_phase_id: skipped_phase_id.clone(),
        }),
        HostPromptEffect::AcknowledgeOnly => Ok(domain::HostPromptPublicResolution::Acknowledged {
            phase_id: prompt_phase_id,
            reason: prompt.reason.clone(),
        }),
    }
}

fn host_prompt_decision_kind(decision: &HostPromptDecision) -> HostPromptDecisionKind {
    match decision {
        HostPromptDecision::SelectSlot { .. } => HostPromptDecisionKind::SelectSlot,
        HostPromptDecision::SelectPolicy { .. } => HostPromptDecisionKind::SelectPolicy,
        HostPromptDecision::Acknowledge { .. } => HostPromptDecisionKind::Acknowledge,
    }
}

fn host_prompt_selected_policy(decision: &HostPromptDecision) -> Option<&str> {
    match decision {
        HostPromptDecision::SelectPolicy { policy, .. } => Some(policy.as_str()),
        _ => None,
    }
}

fn phase_advanced_from_prompt(
    prompt: &projections::HostPromptRow,
    phase_id: domain::phase::PhaseId,
    reason: &'static str,
    skipped_phase_id: Option<domain::phase::PhaseId>,
    occurred_at: i64,
    phase_opened_at: i64,
) -> Result<EventInput, Reject> {
    let source_phase_id = prompt.phase_id.clone();
    let payload = serde_json::to_value(HostPromptPhaseControlPayload {
        phase_id,
        phase_opened_at,
        source_prompt_id: prompt.prompt_id.clone(),
        source_phase_id,
        reason,
        skipped_phase_id,
    })
    .map_err(|error| Reject::Internal(format!("serialize prompt phase control: {error}")))?;
    Ok(EventInput::new(
        "PhaseAdvanced",
        1,
        payload,
        ActorId::Host,
        occurred_at,
    ))
}

fn next_revote_phase_id(
    stream: &[StoredEvent],
    source_phase_id: &domain::phase::PhaseId,
) -> Result<domain::phase::PhaseId, Reject> {
    let base_phase_id = source_phase_id.revote_base();
    let max_existing = stream
        .iter()
        .filter(|event| matches!(event.kind.as_str(), "GameStarted" | "PhaseAdvanced"))
        .filter_map(|event| {
            event
                .payload
                .get("phase_id")
                .and_then(|value| value.as_str())
        })
        .map(|phase_id| {
            domain::phase::PhaseId::parse(phase_id).map_err(|error| {
                Reject::Internal(format!(
                    "invalid persisted phase id in phase advancement: {error}"
                ))
            })
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|phase_id| phase_id.revote_base() == base_phase_id)
        .filter_map(|phase_id| phase_id.revote_attempt())
        .max()
        .unwrap_or(0);
    let next_attempt = max_existing.checked_add(1).ok_or_else(|| {
        Reject::Internal("revote attempt overflowed the canonical phase-id range".to_string())
    })?;
    domain::phase::PhaseId::compose_with_revote(
        base_phase_id.kind(),
        base_phase_id.number(),
        Some(next_attempt),
    )
    .map_err(|error| Reject::Internal(format!("cannot compose revote phase id: {error}")))
}

fn no_majority_advance_night_target(
    source_phase_id: &domain::phase::PhaseId,
) -> Result<domain::phase::PhaseId, Reject> {
    domain::phase::PhaseId::compose(
        domain::phase::PhaseKind::Night,
        phase_number(source_phase_id),
    )
    .map_err(|error| Reject::Internal(format!("cannot compose next night phase: {error}")))
}

fn skip_next_day_target(
    source_phase_id: &domain::phase::PhaseId,
) -> Result<(domain::phase::PhaseId, domain::phase::PhaseId), Reject> {
    let next_number = phase_number(source_phase_id)
        .checked_add(1)
        .ok_or_else(|| {
            Reject::Internal("phase ordinal overflowed the canonical range".to_string())
        })?;
    let skipped_day = domain::phase::PhaseId::compose(domain::phase::PhaseKind::Day, next_number)
        .map_err(|error| {
        Reject::Internal(format!("cannot compose skipped day phase: {error}"))
    })?;
    let next_night = domain::phase::PhaseId::compose(domain::phase::PhaseKind::Night, next_number)
        .map_err(|error| Reject::Internal(format!("cannot compose next night phase: {error}")))?;
    Ok((skipped_day, next_night))
}

#[cfg(test)]
mod tests {
    use super::{
        host_prompt_effect, host_prompt_public_resolution, phase_number, ActorId,
        HostPromptDecision, HostPromptDecisionKind, HostPromptEffect, HostPromptResolutionEffect,
        HostPromptResolutionEffectPolicy, Reject, Uuid,
    };
    use domain::phase::PhaseId;
    use std::collections::BTreeMap;

    fn phase(value: &str) -> PhaseId {
        PhaseId::parse(value).unwrap()
    }

    fn prompt(
        kind: &str,
        phase_id: &str,
        metadata: serde_json::Value,
    ) -> projections::HostPromptRow {
        projections::HostPromptRow {
            game_id: Uuid::nil(),
            phase_id: phase(phase_id),
            event_index: 0,
            prompt_id: format!("{phase_id}:{kind}:test"),
            kind: kind.to_string(),
            subject_slot: None,
            reason: "test".to_string(),
            phase_kind: phase(phase_id).kind().name().to_string(),
            phase_number: i32::try_from(phase_number(&phase(phase_id)))
                .expect("test phase ordinal fits projection storage"),
            metadata,
            status: "pending".to_string(),
            decision: None,
            public_resolution: None,
            resolved_at: None,
        }
    }

    fn phase_event(phase_id: &str) -> eventstore::StoredEvent {
        eventstore::StoredEvent {
            seq: 0,
            stream_id: Uuid::nil(),
            stream_seq: 0,
            kind: "PhaseAdvanced".to_string(),
            version: 1,
            payload: serde_json::json!({ "phase_id": phase_id }),
            actor: ActorId::Host,
            occurred_at: 0,
            causation_id: None,
            meta: serde_json::json!({}),
        }
    }

    fn prompt_effect(
        kind: &str,
        decision: HostPromptDecisionKind,
        effect: HostPromptResolutionEffect,
    ) -> HostPromptResolutionEffectPolicy {
        HostPromptResolutionEffectPolicy {
            id: format!("{kind}_test_effect"),
            prompt_kind: kind.to_string(),
            prompt_reason: "test".to_string(),
            decision,
            effect,
        }
    }

    fn phase_policy(kinds: Vec<domain::phase::PhaseKind>) -> domain::pack::PhasePolicy {
        domain::pack::PhasePolicy {
            twilight: kinds.contains(&domain::phase::PhaseKind::Twilight),
            cadence: kinds,
            subsegments: BTreeMap::new(),
        }
    }

    #[test]
    fn host_prompt_public_resolution_is_typed_for_every_effect_family() {
        let cases = [
            (
                "day vote elimination",
                prompt("pk", "D01", serde_json::json!({})),
                HostPromptEffect::PkKill {
                    selected: "slot_2".to_string(),
                    contenders: vec!["slot_2".to_string(), "slot_4".to_string()],
                },
                serde_json::json!({
                    "kind": "day_vote_elimination",
                    "phase_id": "D01",
                    "selected_slot": "slot_2",
                    "reason": "test"
                }),
            ),
            (
                "phase advance",
                prompt("revote", "D03R1", serde_json::json!({})),
                HostPromptEffect::AdvancePhase {
                    phase_id: phase("D03R2"),
                    reason: "revote",
                    skipped_phase_id: None,
                },
                serde_json::json!({
                    "kind": "phase_advance",
                    "source_phase_id": "D03R1",
                    "target_phase_id": "D03R2",
                    "reason": "revote"
                }),
            ),
            (
                "skipped phase advance",
                prompt("skip_next_day", "D01", serde_json::json!({})),
                HostPromptEffect::AdvancePhase {
                    phase_id: phase("N02"),
                    reason: "skip_next_day",
                    skipped_phase_id: Some(phase("D02")),
                },
                serde_json::json!({
                    "kind": "phase_advance",
                    "source_phase_id": "D01",
                    "target_phase_id": "N02",
                    "reason": "skip_next_day",
                    "skipped_phase_id": "D02"
                }),
            ),
            (
                "acknowledgement",
                prompt("notice", "N02", serde_json::json!({})),
                HostPromptEffect::AcknowledgeOnly,
                serde_json::json!({
                    "kind": "acknowledged",
                    "phase_id": "N02",
                    "reason": "test"
                }),
            ),
        ];

        for (label, prompt, effect, expected) in cases {
            assert_eq!(
                serde_json::to_value(host_prompt_public_resolution(&prompt, &effect).unwrap())
                    .unwrap(),
                expected,
                "{label}"
            );
        }
    }

    #[test]
    fn host_prompt_effect_selects_pk_only_from_contenders() {
        let prompt = prompt(
            "pk",
            "D01",
            serde_json::json!({ "contenders": ["slot_2", "slot_4"] }),
        );
        let effects = vec![prompt_effect(
            "pk",
            HostPromptDecisionKind::SelectSlot,
            HostPromptResolutionEffect::PkKill,
        )];

        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::SelectSlot {
                    slot: "slot_4".to_string()
                },
                &[]
            )
            .unwrap(),
            HostPromptEffect::PkKill {
                selected: "slot_4".to_string(),
                contenders: vec!["slot_2".to_string(), "slot_4".to_string()],
            }
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::SelectSlot {
                    slot: "slot_1".to_string()
                },
                &[]
            ),
            Err(Reject::InvalidPromptDecision)
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &[]
            ),
            Err(Reject::InvalidPromptDecision)
        );
    }

    #[test]
    fn host_prompt_effect_advances_revote_after_existing_revote_windows() {
        let prompt = prompt("revote", "D01", serde_json::json!({}));
        let stream = vec![phase_event("D01R1"), phase_event("D01R2")];
        let effects = vec![prompt_effect(
            "revote",
            HostPromptDecisionKind::Acknowledge,
            HostPromptResolutionEffect::AdvanceRevote,
        )];

        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: phase("D01R3"),
                reason: "revote",
                skipped_phase_id: None,
            }
        );
    }

    #[test]
    fn host_prompt_effect_advances_revote_prompt_from_revote_phase_flatly() {
        let prompt = prompt("revote", "D01R1", serde_json::json!({}));
        let stream = vec![phase_event("D01R1")];
        let effects = vec![prompt_effect(
            "revote",
            HostPromptDecisionKind::Acknowledge,
            HostPromptResolutionEffect::AdvanceRevote,
        )];

        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: phase("D01R2"),
                reason: "revote",
                skipped_phase_id: None,
            }
        );
    }

    #[test]
    fn host_prompt_effect_select_policy_can_continue_or_end_no_majority_revote() {
        let prompt = prompt(
            "revote",
            "D03R2",
            serde_json::json!({ "policy": "no_majority_revote" }),
        );
        let stream = vec![phase_event("D03R1"), phase_event("D03R2")];
        let effects = vec![
            HostPromptResolutionEffectPolicy {
                id: "no_majority_continue_revote".to_string(),
                prompt_kind: "revote".to_string(),
                prompt_reason: "test".to_string(),
                decision: HostPromptDecisionKind::SelectPolicy,
                effect: HostPromptResolutionEffect::AdvanceRevote,
            },
            HostPromptResolutionEffectPolicy {
                id: "no_majority_no_lynch".to_string(),
                prompt_kind: "revote".to_string(),
                prompt_reason: "test".to_string(),
                decision: HostPromptDecisionKind::SelectPolicy,
                effect: HostPromptResolutionEffect::AdvanceNight,
            },
        ];
        let phase_policy = phase_policy(vec![
            domain::phase::PhaseKind::Day,
            domain::phase::PhaseKind::Night,
        ]);

        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy,
                &prompt,
                &HostPromptDecision::SelectPolicy {
                    policy: "no_majority_continue_revote".to_string(),
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: phase("D03R3"),
                reason: "revote",
                skipped_phase_id: None,
            }
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy,
                &prompt,
                &HostPromptDecision::SelectPolicy {
                    policy: "no_majority_no_lynch".to_string(),
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: phase("N03"),
                reason: "no_majority_no_lynch",
                skipped_phase_id: None,
            }
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy,
                &prompt,
                &HostPromptDecision::SelectPolicy {
                    policy: "unknown".to_string(),
                    metadata: serde_json::json!({})
                },
                &stream
            ),
            Err(Reject::InvalidPromptDecision)
        );
    }

    #[test]
    fn host_prompt_effect_advances_skip_next_day_to_next_numbered_night() {
        let prompt = prompt("skip_next_day", "D01", serde_json::json!({}));
        let effects = vec![prompt_effect(
            "skip_next_day",
            HostPromptDecisionKind::Acknowledge,
            HostPromptResolutionEffect::SkipNextDay,
        )];

        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![
                    domain::phase::PhaseKind::Day,
                    domain::phase::PhaseKind::Night
                ]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &[]
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: phase("N02"),
                reason: "skip_next_day",
                skipped_phase_id: Some(phase("D02")),
            }
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![
                    domain::phase::PhaseKind::Day,
                    domain::phase::PhaseKind::Night
                ]),
                &prompt,
                &HostPromptDecision::SelectSlot {
                    slot: "slot_2".to_string()
                },
                &[]
            ),
            Err(Reject::InvalidPromptDecision)
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![domain::phase::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &[]
            ),
            Err(Reject::InvalidTarget)
        );
    }
}
