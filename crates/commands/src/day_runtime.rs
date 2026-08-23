//! Sole commands-side home for DayEvent write/runtime.
//!
//! This module is the **sole emitter** of `DayEvent*` stream kinds on the write
//! path and the **sole caller** of `game_platform::{day_schedule,
//! day_auto_resolution, day_narrative}` from that path. Operational lease claim
//! lives in [`crate::day_scheduler`]; pure policy lives in `game_platform`;
//! projections fold and wake only. See `docs/arch/17-day-runtime-ownership.md`.

use std::collections::{BTreeMap, BTreeSet};

use caps::Principal;
use eventstore::{ActorId, EventInput};
use game_platform::day_schedule;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::day_program;
use crate::model::CohostPermissionClass;
use crate::{
    build_host_notice, current_pack, current_phase, next_stream_logical_time, persist, phase_kind,
    phase_number, plan_effect_events, require_game, require_game_not_completed, require_game_run,
    require_slot_alive, require_slot_occupant, resolve_capabilities_in_tx, unix_seconds_now,
    validate_game_post_body, Ack, AuditInitiator, CommandAuditContext, EffectApplication,
    HostNoticeSpec, Reject, SystemAuditService, COMMAND_AUDIT_CONTEXT,
};

/// Execute one schedule observation under the sealed scheduler authority.
///
/// This boundary is intentionally separate from [`crate::handle`]: no user
/// principal can acquire scheduler authority and the network wire has no
/// corresponding command. The game stream advisory lock remains the correctness
/// boundary when multiple worker replicas race the same due game.
pub async fn advance_day_event_automation_as_scheduler(
    pool: &PgPool,
    game: Uuid,
    observed_at: i64,
    seed_root: u64,
) -> Result<Ack, Reject> {
    let mut stream_seqs =
        advance_day_event_mechanics_as_scheduler(pool, game, observed_at, seed_root)
            .await?
            .stream_seqs;
    // Narrative is deliberately a second transaction. Lifecycle mechanics are
    // already durable even if host-notice publication fails and must retry.
    stream_seqs.extend(
        publish_day_event_narratives_as_scheduler(pool, game)
            .await?
            .stream_seqs,
    );
    Ok(Ack { stream_seqs })
}

async fn advance_day_event_mechanics_as_scheduler(
    pool: &PgPool,
    game: Uuid,
    observed_at: i64,
    seed_root: u64,
) -> Result<Ack, Reject> {
    let command_id = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    eventstore::lock_stream_in_tx(&mut tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    require_game_not_completed(&mut tx, game).await?;
    let audit_context = CommandAuditContext {
        initiator: AuditInitiator::Service(SystemAuditService::DayEventAutomation),
        command_id,
        command_kind: "AdvanceDayEventAutomation".to_string(),
        authority_used: format!("DayEventAutomation({game})"),
        request_source: "day_event_automation",
    };
    let ack = COMMAND_AUDIT_CONTEXT
        .scope(
            audit_context,
            advance_day_event_automation_in_tx(&mut tx, game, observed_at, seed_root),
        )
        .await?;
    tx.commit()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    Ok(ack)
}

async fn publish_day_event_narratives_as_scheduler(
    pool: &PgPool,
    game: Uuid,
) -> Result<Ack, Reject> {
    let command_id = Uuid::new_v4();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    eventstore::lock_stream_in_tx(&mut tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    require_game_not_completed(&mut tx, game).await?;
    let audit_context = CommandAuditContext {
        initiator: AuditInitiator::Service(SystemAuditService::DayEventNarrative),
        command_id,
        command_kind: "PublishDayEventNarratives".to_string(),
        authority_used: format!("DayEventNarrative({game})"),
        request_source: "day_event_narrative",
    };
    let ack = COMMAND_AUDIT_CONTEXT
        .scope(
            audit_context,
            publish_day_event_narratives_in_tx(&mut tx, game),
        )
        .await?;
    tx.commit()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    Ok(ack)
}

async fn advance_day_event_automation_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    observed_at: i64,
    seed_root: u64,
) -> Result<Ack, Reject> {
    // Resolve only work that was already locked when this transaction began.
    // A schedule observation that locks an event commits its seed first; the
    // next leased pass reuses that exact seed even after process failure.
    let pending_auto = projections::day_events(&mut **tx, game)
        .await?
        .into_iter()
        .filter(|event| {
            event.state == "locked"
                && matches!(
                    event.definition.resolution,
                    game_platform::DayEventResolutionMode::Auto { .. }
                )
        })
        .collect::<Vec<_>>();
    let mut stream_seqs = observe_day_event_schedules_in_tx(tx, game, observed_at, seed_root)
        .await?
        .stream_seqs;
    for event in pending_auto {
        stream_seqs.extend(
            resolve_auto_day_event_in_tx(tx, game, event)
                .await?
                .stream_seqs,
        );
    }
    Ok(Ack { stream_seqs })
}

async fn publish_day_event_narratives_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<Ack, Reject> {
    let pending = projections::pending_day_event_narratives(&mut **tx, game).await?;
    let mut stream_seqs = Vec::new();
    for narrative in pending {
        let event = load_day_event(tx, game, &narrative.event_id).await?;
        if !day_program::host_notice_channel_supported(
            &event.definition,
            narrative.channel_id.as_str(),
        ) {
            return Err(day_event_reject(format!(
                "narrative channel `{}` does not match its DayEvent policy",
                narrative.channel_id
            )));
        }
        let body = narrative.rendered_body.as_deref().ok_or_else(|| {
            Reject::Internal("pending DayEvent narrative has no rendered body".to_string())
        })?;
        validate_game_post_body(body)?;
        let source_seq = narrative.source_seq.ok_or_else(|| {
            Reject::Internal("pending DayEvent narrative has no source sequence".to_string())
        })?;
        let receipt_id = game_platform::day_narrative::receipt_id(
            &narrative.event_id,
            narrative.lifecycle,
            source_seq,
            &narrative.template_hash,
        );
        let phase = current_phase(tx, game).await?;
        let stream = eventstore::load_stream_in_tx(tx, game)
            .await
            .map_err(|error| Reject::Internal(error.to_string()))?;
        let occurred_at = next_stream_logical_time(&stream);
        let narrative_receipt = serde_json::json!({
            "receipt_id": receipt_id,
            "event_id": narrative.event_id,
            "lifecycle": narrative.lifecycle,
            "template_key": narrative.template_key,
            "template_hash": narrative.template_hash,
            "source_seq": source_seq,
        });
        let mut post = build_host_notice(HostNoticeSpec {
            channel_id: narrative.channel_id.clone(),
            body: body.to_string(),
            media: Vec::new(),
            phase_id: phase,
            occurred_at,
            narrative_receipt: Some(narrative_receipt),
        })?;
        post.meta = serde_json::json!({
            "source": "day_event_narrative",
            "day_event_id": narrative.event_id,
            "narrative_lifecycle": narrative.lifecycle.as_str(),
            "narrative_receipt_id": receipt_id,
        });
        let published = EventInput::new(
            "DayEventNarrativePublished",
            1,
            serde_json::json!({
                "receipt_id": receipt_id,
                "event_id": narrative.event_id,
                "lifecycle": narrative.lifecycle,
                "template_key": narrative.template_key,
                "template_hash": narrative.template_hash,
                "channel_id": narrative.channel_id,
                "source_seq": source_seq,
            }),
            ActorId::System,
            occurred_at,
        );
        stream_seqs.extend(persist(tx, game, &[post, published]).await?.stream_seqs);
    }
    Ok(Ack { stream_seqs })
}

pub(crate) async fn schedule_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event: game_platform::DayEvent,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventOps).await?;
    event.validate().map_err(day_event_validation)?;
    let pack = current_pack(tx, game).await?;
    let compatibility_issues = day_program::inspect_event(pack.document(), &event);
    if !compatibility_issues.is_empty() {
        return Err(day_event_reject(day_program::summarize_issues(
            &compatibility_issues,
        )));
    }
    if projections::day_events(&mut **tx, game)
        .await?
        .iter()
        .any(|row| row.event_id == event.id.as_str())
    {
        return Err(Reject::DayEventAlreadyExists);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventScheduled",
            1,
            serde_json::json!({ "event": event }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

pub(crate) async fn attach_day_program(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    program: game_platform::DayProgram,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::ProgramAttach).await?;
    let pack = current_pack(tx, game).await?;
    let compatibility = day_program::inspect(pack.document(), &program);
    let compilation = compatibility
        .into_compilation()
        .map_err(|report| Reject::DayProgramValidation(report.summary()))?;
    let content_hash = compilation.content_hash;
    let compiled = compilation.events;
    let mut compiled_narratives = compilation.narratives;
    if projections::day_programs(&mut **tx, game)
        .await?
        .iter()
        .any(|row| {
            row.program_id == program.id.as_str() && row.version == i64::from(program.version)
        })
    {
        return Err(Reject::DayProgramAlreadyAttached);
    }
    let existing_event_ids: BTreeSet<_> = projections::day_events(&mut **tx, game)
        .await?
        .into_iter()
        .map(|row| row.event_id)
        .collect();
    if compiled
        .iter()
        .any(|event| existing_event_ids.contains(event.id.as_str()))
    {
        return Err(Reject::DayEventAlreadyExists);
    }

    let mut events = Vec::with_capacity(compiled.len() + 1);
    events.push(EventInput::new(
        "DayProgramAttached",
        1,
        serde_json::json!({
            "program": program,
            "content_hash": content_hash,
        }),
        ActorId::Host,
        0,
    ));
    events.extend(compiled.into_iter().map(|event| {
        let narratives = compiled_narratives
            .remove(event.id.as_str())
            .unwrap_or_default();
        EventInput::new(
            "DayEventScheduled",
            1,
            serde_json::json!({
                "event": event,
                "narrative_templates": narratives,
            }),
            ActorId::Host,
            0,
        )
    }));
    persist(tx, game, &events).await
}

pub(crate) async fn open_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventOps).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    require_day_event_state(&event, "scheduled")?;
    if !matches!(
        event.definition.schedule,
        game_platform::DayEventSchedule::HostOpened
    ) {
        return Err(day_event_reject("DayEvent is not host-opened"));
    }
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or_else(|| day_event_reject("DayEvent open requires an active phase"))?;
    let phase_id = phase.phase_id.clone();
    match event.definition.phase_scope {
        game_platform::PhaseScope::DuringDay { number } => {
            if phase_kind(&phase_id) != domain::phase::PhaseKind::Day
                || phase_number(&phase_id) != number
            {
                return Err(day_event_reject(format!(
                    "DayEvent is scoped to Day {number}, current phase is {}",
                    phase.phase_id
                )));
            }
        }
        game_platform::PhaseScope::AnyRunning => {}
        game_platform::PhaseScope::ExplicitWindow { .. } => {
            return Err(day_event_reject(
                "explicit DayEvent windows require the scheduling slice",
            ));
        }
    }
    let opened_at = unix_seconds_now()?;
    let mut events = vec![EventInput::new(
        "DayEventOpened",
        1,
        serde_json::json!({
            "event_id": event_id.as_str(),
            "phase_id": phase_id,
            "opened_at": opened_at,
        }),
        ActorId::Host,
        0,
    )];
    events.extend(
        private_event_channel_open_events(tx, game, &event.definition, ActorId::Host, 0).await?,
    );
    persist(tx, game, &events).await
}

pub(crate) async fn lock_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventOps).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    require_day_event_state(&event, "open")?;
    let participation =
        projections::day_event_participation(&mut **tx, game, event_id.as_str()).await?;
    if participation.len() < event.definition.participation.limits.minimum as usize {
        return Err(day_event_reject(format!(
            "DayEvent requires at least {} participants before lock",
            event.definition.participation.limits.minimum
        )));
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventLocked",
            1,
            serde_json::json!({
                "event_id": event_id.as_str(),
                "locked_at": unix_seconds_now()?,
                "auto_seed": auto_seed_for_resolution(
                    event.definition.resolution,
                    fresh_auto_seed_root(),
                    event_id.as_str(),
                ),
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

pub(crate) async fn cancel_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
    reason: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventOps).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    if matches!(event.state.as_str(), "resolved" | "cancelled") {
        return Err(Reject::DayEventStateConflict(event.state));
    }
    if reason.trim().is_empty() {
        return Err(day_event_reject("cancellation reason must not be blank"));
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventCancelled",
            1,
            serde_json::json!({
                "event_id": event_id.as_str(),
                "reason": reason,
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn private_event_channel_open_events(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    event: &game_platform::DayEvent,
    actor: ActorId,
    occurred_at: i64,
) -> Result<Vec<EventInput>, Reject> {
    if event.channel_policy.membership()
        != Some(game_platform::EventChannelMembership::EligibleSlots)
    {
        return Ok(Vec::new());
    }
    let alive_slots = projections::slot_state(&mut **tx, game)
        .await?
        .into_iter()
        .filter(|slot| slot.alive)
        .map(|slot| slot.slot_id)
        .collect::<BTreeSet<_>>();
    let member_slots = projections::slot_occupancy(&mut **tx, game)
        .await?
        .into_iter()
        .filter(|row| match event.participation.who {
            game_platform::ParticipantFilter::AliveSlots => alive_slots.contains(&row.slot_id),
            game_platform::ParticipantFilter::AllOccupied => true,
            game_platform::ParticipantFilter::HostInvited
            | game_platform::ParticipantFilter::ChannelMembers => false,
        })
        .map(|row| row.slot_id)
        .collect::<Vec<_>>();
    Ok(member_slots
        .into_iter()
        .map(|slot_id| {
            private_event_channel_member_granted(event, &slot_id, actor.clone(), occurred_at)
        })
        .collect())
}

fn private_event_channel_member_granted(
    event: &game_platform::DayEvent,
    slot_id: &str,
    actor: ActorId,
    occurred_at: i64,
) -> EventInput {
    EventInput::new(
        "PrivateChannelMemberGranted",
        1,
        serde_json::json!({
            "channel_id": event.channel_policy.channel_id(&event.id),
            "group_id": event.id,
            "kind": "DayEvent",
            "slot_id": slot_id,
            "role_key": "event_participant",
            "reveals_alignment": "None",
            "source": format!("day_event.{}", event.id),
        }),
        actor,
        occurred_at,
    )
}

fn private_event_channel_member_revoked(
    event: &game_platform::DayEvent,
    slot_id: &str,
    actor: ActorId,
    reason: &str,
    occurred_at: i64,
) -> EventInput {
    EventInput::new(
        "PrivateChannelMemberRevoked",
        1,
        serde_json::json!({
            "channel_id": event.channel_policy.channel_id(&event.id),
            "group_id": event.id,
            "kind": "DayEvent",
            "slot_id": slot_id,
            "reason": reason,
            "source": format!("day_event.{}", event.id),
        }),
        actor,
        occurred_at,
    )
}

pub(crate) async fn observe_day_event_schedules_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    observed_at: i64,
    seed_root: u64,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or_else(|| day_event_reject("schedule observation requires an active phase"))?;
    let phase_id = phase.phase_id.clone();
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let timeline = day_schedule_timeline(&stream)?;
    let current_day_number = match phase_kind(&phase_id) {
        domain::phase::PhaseKind::Day => Some(phase_number(&phase_id)),
        _ => None,
    };
    let context = day_schedule::ScheduleContext {
        observed_at,
        current_phase_id: phase_id.clone(),
        current_day_number,
        timeline,
    };

    let mut facts = Vec::new();
    for row in projections::day_events(&mut **tx, game).await? {
        let state = day_event_state(&row.state)?;
        for intent in day_schedule::evaluate(&row.definition, state, &context) {
            match intent.kind {
                day_schedule::ScheduleIntentKind::Open => {
                    if row.open_observed_at.is_none() {
                        facts.push(EventInput::new(
                            "DayEventOpenDue",
                            1,
                            serde_json::json!({
                                "event_id": row.event_id,
                                "due_at": intent.due_at,
                                "observed_at": observed_at,
                                "source": intent.source,
                            }),
                            ActorId::System,
                            observed_at,
                        ));
                    }
                    facts.push(EventInput::new(
                        "DayEventOpened",
                        1,
                        serde_json::json!({
                            "event_id": row.event_id,
                            "phase_id": phase_id,
                            "opened_at": observed_at,
                            "source": "scheduler",
                        }),
                        ActorId::System,
                        observed_at,
                    ));
                    facts.extend(
                        private_event_channel_open_events(
                            tx,
                            game,
                            &row.definition,
                            ActorId::System,
                            observed_at,
                        )
                        .await?,
                    );
                }
                day_schedule::ScheduleIntentKind::Lock => {
                    if row.lock_observed_at.is_none() {
                        facts.push(EventInput::new(
                            "DayEventLockDue",
                            1,
                            serde_json::json!({
                                "event_id": row.event_id,
                                "due_at": intent.due_at,
                                "observed_at": observed_at,
                                "source": intent.source,
                            }),
                            ActorId::System,
                            observed_at,
                        ));
                    }
                    facts.push(EventInput::new(
                        "DayEventLocked",
                        1,
                        serde_json::json!({
                            "event_id": row.event_id,
                            "locked_at": observed_at,
                            "source": "scheduler",
                            "auto_seed": auto_seed_for_resolution(
                                row.definition.resolution,
                                seed_root,
                                &row.event_id,
                            ),
                        }),
                        ActorId::System,
                        observed_at,
                    ));
                }
            }
        }
    }
    if facts.is_empty() {
        Ok(Ack {
            stream_seqs: Vec::new(),
        })
    } else {
        persist(tx, game, &facts).await
    }
}

fn day_schedule_timeline(
    stream: &[eventstore::StoredEvent],
) -> Result<day_schedule::ScheduleTimeline, Reject> {
    let mut timeline = day_schedule::ScheduleTimeline::default();
    let mut current_phase_id: Option<domain::phase::PhaseId> = None;
    for event in stream {
        match event.kind.as_str() {
            "GameStarted" | "PhaseAdvanced" => {
                let Some(phase_id) = event.payload["phase_id"].as_str() else {
                    continue;
                };
                let phase_id = domain::phase::PhaseId::parse(phase_id).map_err(|error| {
                    Reject::Internal(format!(
                        "invalid persisted phase id in {}: {error}",
                        event.kind
                    ))
                })?;
                current_phase_id = Some(phase_id.clone());
                timeline.phase_signals.insert(day_schedule::PhaseSignal {
                    kind: day_schedule::PhaseSignalKind::Opened,
                    phase_id: phase_id.clone(),
                });
                if let Some(opened_at) = event.payload["phase_opened_at"].as_i64() {
                    timeline.phase_opened_at.insert(phase_id, opened_at);
                }
            }
            "ThreadLocked" => {
                let phase_id = event.payload["phase_id"]
                    .as_str()
                    .map(domain::phase::PhaseId::parse)
                    .transpose()
                    .map_err(|error| {
                        Reject::Internal(format!(
                            "invalid persisted phase id in ThreadLocked: {error}"
                        ))
                    })?
                    .or_else(|| current_phase_id.clone());
                if let Some(phase_id) = phase_id {
                    timeline.phase_signals.insert(day_schedule::PhaseSignal {
                        kind: day_schedule::PhaseSignalKind::Locked,
                        phase_id,
                    });
                }
            }
            "ResolutionApplied"
                if event.payload["run_id"]
                    .as_str()
                    .is_some_and(|run_id| run_id.starts_with("resolution:")) =>
            {
                if let Some(phase_id) = event.payload["phase_id"].as_str() {
                    let phase_id = domain::phase::PhaseId::parse(phase_id).map_err(|error| {
                        Reject::Internal(format!(
                            "invalid persisted phase id in ResolutionApplied: {error}"
                        ))
                    })?;
                    timeline.phase_signals.insert(day_schedule::PhaseSignal {
                        kind: day_schedule::PhaseSignalKind::Resolved,
                        phase_id,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(timeline)
}

fn day_event_state(state: &str) -> Result<game_platform::DayEventState, Reject> {
    match state {
        "scheduled" => Ok(game_platform::DayEventState::Scheduled),
        "open" => Ok(game_platform::DayEventState::Open),
        "locked" => Ok(game_platform::DayEventState::Locked),
        "resolved" => Ok(game_platform::DayEventState::Resolved),
        "cancelled" => Ok(game_platform::DayEventState::Cancelled),
        other => Err(Reject::Internal(format!(
            "unknown projected DayEvent state `{other}`"
        ))),
    }
}

pub(crate) async fn submit_day_event_participation(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
    actor_slot: String,
    payload: game_platform::ParticipationPayload,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    require_day_event_state(&event, "open")?;
    event
        .definition
        .participation
        .validate_payload(&payload)
        .map_err(|error| Reject::ParticipationNotAllowed(error.to_string()))?;
    if event.definition.participation.who == game_platform::ParticipantFilter::AliveSlots {
        require_slot_alive(tx, game, &actor_slot)
            .await
            .map_err(|error| match error {
                Reject::SlotNotAlive => {
                    Reject::ParticipationNotAllowed("slot is not alive".to_string())
                }
                other => other,
            })?;
    }
    let current = projections::day_event_participation(&mut **tx, game, event_id.as_str()).await?;
    if current.iter().any(|row| row.actor_slot == actor_slot) {
        return Err(Reject::DuplicateParticipation);
    }
    if event
        .definition
        .participation
        .limits
        .maximum
        .is_some_and(|maximum| current.len() >= maximum as usize)
    {
        return Err(Reject::ParticipationNotAllowed(
            "DayEvent participation capacity is full".to_string(),
        ));
    }
    let phase_id = event
        .phase_id
        .ok_or_else(|| day_event_reject("open DayEvent has no phase"))?;
    let mut events = vec![EventInput::new(
        "DayEventParticipationSubmitted",
        1,
        serde_json::json!({
            "event_id": event_id.as_str(),
            "actor_slot": actor_slot,
            "payload": payload,
            "phase_id": phase_id,
        }),
        ActorId::Slot(actor_slot.clone()),
        0,
    )];
    if event.definition.channel_policy.is_private() {
        events.push(private_event_channel_member_granted(
            &event.definition,
            &actor_slot,
            ActorId::Slot(actor_slot.clone()),
            0,
        ));
    }
    persist(tx, game, &events).await
}

pub(crate) async fn withdraw_day_event_participation(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
    actor_slot: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    require_day_event_state(&event, "open")?;
    let current = projections::day_event_participation(&mut **tx, game, event_id.as_str()).await?;
    if !current.iter().any(|row| row.actor_slot == actor_slot) {
        return Err(Reject::ParticipationNotFound);
    }
    let mut events = vec![EventInput::new(
        "DayEventParticipationWithdrawn",
        1,
        serde_json::json!({
            "event_id": event_id.as_str(),
            "actor_slot": actor_slot,
        }),
        ActorId::Slot(actor_slot.clone()),
        0,
    )];
    if event.definition.channel_policy.membership()
        == Some(game_platform::EventChannelMembership::Participants)
    {
        events.push(private_event_channel_member_revoked(
            &event.definition,
            &actor_slot,
            ActorId::Slot(actor_slot.clone()),
            "participation_withdrawn",
            0,
        ));
    }
    persist(tx, game, &events).await
}

pub(crate) async fn resolve_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event_id: game_platform::DayEventId,
    decision: game_platform::DayEventDecision,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventResolve).await?;
    let event = load_day_event(tx, game, event_id.as_str()).await?;
    require_day_event_state(&event, "locked")?;
    if !matches!(
        event.definition.resolution,
        game_platform::DayEventResolutionMode::HostDecision
    ) {
        return Err(day_event_reject(
            "automatic DayEvents cannot be host-resolved; cancel and use fiat instead",
        ));
    }
    let winner_slots = match &decision {
        game_platform::DayEventDecision::SelectWinners { slots } => slots.clone(),
        game_platform::DayEventDecision::SelectMapping { .. } => {
            return Err(day_event_reject(
                "SelectMapping requires the multi-reward decision slice",
            ));
        }
        game_platform::DayEventDecision::CancelInstead { .. } => {
            return Err(day_event_reject(
                "use CancelDayEvent instead of resolving with cancellation",
            ));
        }
    };
    let unique_winners = winner_slots.iter().collect::<BTreeSet<_>>();
    if winner_slots.is_empty() || unique_winners.len() != winner_slots.len() {
        return Err(day_event_reject(
            "SelectWinners requires a non-empty unique slot list",
        ));
    }
    let participants =
        projections::day_event_participation(&mut **tx, game, event_id.as_str()).await?;
    let participant_slots = participants
        .iter()
        .map(|row| row.actor_slot.as_str())
        .collect::<BTreeSet<_>>();
    if winner_slots
        .iter()
        .any(|winner| !participant_slots.contains(winner.as_str()))
    {
        return Err(day_event_reject(
            "every selected winner must be a current participant",
        ));
    }
    let participant_slot_ids = participants
        .iter()
        .map(|row| game_platform::SlotId::new(row.actor_slot.clone()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(day_event_validation)?;
    let evidence = game_platform::DayEventResolutionEvidence::HostDecision {
        participant_slots: participant_slot_ids.clone(),
    };
    let request = DayEventResolutionRequest {
        game,
        event,
        decision,
        winner_slots,
        participant_slots: participant_slot_ids,
        evidence,
        actor: ActorId::Host,
    };
    apply_day_event_resolution_in_tx(tx, request).await
}

async fn resolve_auto_day_event_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    event: projections::DayEventRow,
) -> Result<Ack, Reject> {
    let game_platform::DayEventResolutionMode::Auto { policy } = event.definition.resolution else {
        return Err(day_event_reject("DayEvent is not automatic"));
    };
    let participants =
        projections::day_event_participation(&mut **tx, game, &event.event_id).await?;
    let mut participant_slots = participants
        .into_iter()
        .map(|row| game_platform::SlotId::new(row.actor_slot))
        .collect::<Result<Vec<_>, _>>()
        .map_err(day_event_validation)?;
    participant_slots.sort();
    let winner_slots = game_platform::day_auto_resolution::select_winners(
        policy,
        &participant_slots,
        event.auto_seed,
    )
    .map_err(day_event_validation)?;
    let decision = game_platform::DayEventDecision::SelectWinners {
        slots: winner_slots.clone(),
    };
    let evidence = game_platform::DayEventResolutionEvidence::Auto {
        policy,
        seed: event.auto_seed,
        participant_slots: participant_slots.clone(),
    };
    let request = DayEventResolutionRequest {
        game,
        event,
        decision,
        winner_slots,
        participant_slots,
        evidence,
        actor: ActorId::System,
    };
    apply_day_event_resolution_in_tx(tx, request).await
}

#[derive(Debug)]
struct DayEventResolutionRequest {
    game: Uuid,
    event: projections::DayEventRow,
    decision: game_platform::DayEventDecision,
    winner_slots: Vec<game_platform::SlotId>,
    participant_slots: Vec<game_platform::SlotId>,
    evidence: game_platform::DayEventResolutionEvidence,
    actor: ActorId,
}

async fn apply_day_event_resolution_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    request: DayEventResolutionRequest,
) -> Result<Ack, Reject> {
    let DayEventResolutionRequest {
        game,
        event,
        decision,
        winner_slots,
        participant_slots,
        evidence,
        actor,
    } = request;
    let event_id = event.event_id.clone();
    let resolution_source = match &evidence {
        game_platform::DayEventResolutionEvidence::HostDecision { .. } => "host decision",
        game_platform::DayEventResolutionEvidence::Auto { .. } => "automatic policy",
    };
    let command_id = COMMAND_AUDIT_CONTEXT
        .try_with(|audit| audit.command_id)
        .map_err(|_| Reject::Internal("command audit context missing in DayEvent".to_string()))?;
    let bindings = game_platform::RecipientBindings {
        winners: winner_slots.clone(),
        participants: participant_slots,
        host_chosen: winner_slots.clone(),
    };
    let mut lifecycle_states = BTreeMap::new();
    let mut events = Vec::new();
    let mut reward_keys_applied = Vec::new();
    for reward in &event.definition.rewards {
        let plan = reward
            .compile_plan(
                event.definition.id.clone(),
                &bindings,
                format!(
                    "DayEvent {} {} reward {}",
                    event_id,
                    resolution_source,
                    reward.reward_key.as_str()
                ),
            )
            .map_err(day_event_validation)?;
        let application = EffectApplication::DayEvent {
            event_id: event_id.clone(),
            reward_key: reward.reward_key.as_str().to_string(),
            command_id,
        };
        events
            .extend(plan_effect_events(tx, game, plan, &application, &mut lifecycle_states).await?);
        reward_keys_applied.push(reward.reward_key.as_str().to_string());
    }
    let mut resolved = EventInput::new(
        "DayEventResolved",
        1,
        serde_json::json!({
            "event_id": event_id.clone(),
            "decision": decision,
            "winner_slots": winner_slots.iter().map(|slot| slot.as_str()).collect::<Vec<_>>(),
            "reward_keys_applied": reward_keys_applied,
            "evidence": evidence,
        }),
        actor,
        0,
    );
    resolved.meta = serde_json::json!({
        "source": "day_event",
        "day_event_id": event_id,
        "resolution_source": resolution_source,
    });
    events.push(resolved);
    persist(tx, game, &events).await
}

fn fresh_auto_seed_root() -> u64 {
    let bytes = Uuid::new_v4().into_bytes();
    u64::from_le_bytes(bytes[..8].try_into().expect("UUID prefix is eight bytes")) & i64::MAX as u64
}

fn auto_seed_for_resolution(
    resolution: game_platform::DayEventResolutionMode,
    seed_root: u64,
    event_id: &str,
) -> Option<u64> {
    let game_platform::DayEventResolutionMode::Auto { policy } = resolution else {
        return None;
    };
    if !policy.requires_seed() {
        return None;
    }
    let mut digest = Sha256::new();
    digest.update(b"fmarch-day-event-auto-seed:v1\0");
    digest.update(seed_root.to_le_bytes());
    digest.update(event_id.as_bytes());
    let bytes = digest.finalize();
    Some(
        u64::from_le_bytes(
            bytes[..8]
                .try_into()
                .expect("SHA-256 prefix is eight bytes"),
        ) & i64::MAX as u64,
    )
}

pub(crate) async fn load_day_event(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    event_id: &str,
) -> Result<projections::DayEventRow, Reject> {
    projections::day_events(&mut **tx, game)
        .await?
        .into_iter()
        .find(|event| event.event_id == event_id)
        .ok_or(Reject::UnknownDayEvent)
}

fn require_day_event_state(event: &projections::DayEventRow, required: &str) -> Result<(), Reject> {
    if event.state == required {
        Ok(())
    } else {
        Err(Reject::DayEventStateConflict(format!(
            "{} requires {required}, current state is {}",
            event.event_id, event.state
        )))
    }
}

fn day_event_validation(error: game_platform::ModelError) -> Reject {
    day_event_reject(error.to_string())
}

fn day_event_reject(message: impl Into<String>) -> Reject {
    Reject::DayEventValidation(message.into())
}
