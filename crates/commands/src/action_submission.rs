//! Action submission orchestration and validation boundary.
//!
//! This module owns submission admission, action-template and grant selection,
//! active-action capacity, and instant-action event construction. The command
//! composition root retains dispatch, transaction/idempotency orchestration,
//! and the shared append-and-project persistence boundary.

use super::{
    load_pack, metadata_from_payload, pack_artifact_from_stream, persist, phase_kind, phase_number,
    require_game, require_open_phase, require_slot_alive, require_slot_occupant,
    resolve_capabilities_in_tx, EngineInputBuilder, EngineRunKind, Reject,
};
use caps::Principal;
use domain::{
    pack::{
        ActionTemplate, ActivationGateReason, GrantKind, GrantSpec, PhaseParity, TargetRoleFilter,
        TargetSpec, TargetState, Window,
    },
    IrAbility, Modifier, RoleModifier,
};
use eventstore::{ActorId, EventInput};
use sqlx::{postgres::PgPool, Postgres, Transaction};
use std::collections::BTreeMap;
use uuid::Uuid;

pub(super) struct ActionSubmissionRequest {
    pub(super) game: Uuid,
    pub(super) action_id: String,
    pub(super) actor_slot: String,
    pub(super) template_id: String,
    pub(super) targets: Vec<String>,
    pub(super) grant_id: Option<String>,
}

pub(super) struct ActionSubmissionContext<'operation, 'transaction> {
    tx: &'operation mut Transaction<'transaction, Postgres>,
    principal: &'operation Principal,
    request: ActionSubmissionRequest,
}

impl<'operation, 'transaction> ActionSubmissionContext<'operation, 'transaction> {
    pub(super) fn new(
        tx: &'operation mut Transaction<'transaction, Postgres>,
        principal: &'operation Principal,
        request: ActionSubmissionRequest,
    ) -> Self {
        Self {
            tx,
            principal,
            request,
        }
    }
}

struct ActionValidationContext<'operation, 'transaction> {
    tx: &'operation mut Transaction<'transaction, Postgres>,
    game: Uuid,
    pack: &'operation domain::Pack,
    stream: &'operation [eventstore::StoredEvent],
    phase_id: &'operation str,
    request: &'operation ActionSubmissionRequest,
}

struct ActionCapacityContext<'operation, 'transaction> {
    tx: &'operation mut Transaction<'transaction, Postgres>,
    game: Uuid,
    stream: &'operation [eventstore::StoredEvent],
    phase_id: &'operation str,
    phase_number: u32,
    actor_slot: &'operation str,
    template_id: &'operation str,
    template: &'operation ActionTemplate,
    grant_id: Option<&'operation str>,
    source: ActionSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionSource {
    Role,
    ItemGrant,
}

#[derive(Debug, Clone)]
pub(super) struct ActiveAction {
    pub(super) template_id: String,
    pub(super) grant_id: Option<String>,
    pub(super) targets: Vec<String>,
}

pub(super) async fn submit_action(
    context: ActionSubmissionContext<'_, '_>,
) -> Result<super::Ack, Reject> {
    let ActionSubmissionContext {
        tx,
        principal,
        request,
    } = context;
    require_game(tx, request.game).await?;
    if request.action_id.trim().is_empty() || request.template_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if request
        .grant_id
        .as_deref()
        .is_some_and(|id| id.trim().is_empty())
    {
        return Err(Reject::InvalidTarget);
    }

    let caps = resolve_capabilities_in_tx(tx, principal, request.game).await?;
    require_slot_occupant(tx, request.game, &request.actor_slot, &caps).await?;
    let phase = require_open_phase(tx, request.game).await?;
    require_slot_alive(tx, request.game, &request.actor_slot).await?;
    let stream = eventstore::load_stream_in_tx(tx, request.game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    let action_window = validate_action_submission(ActionValidationContext {
        tx,
        game: request.game,
        pack: &pack,
        stream: &stream,
        phase_id: &phase,
        request: &request,
    })
    .await?;

    let mut payload = serde_json::json!({
        "action_id": request.action_id,
        "template_id": request.template_id,
        "actor": request.actor_slot,
        "targets": request.targets,
        "phase_id": phase
    });
    if action_window == Window::Instant {
        payload["instant_resolved"] = serde_json::Value::Bool(true);
    }
    if let Some(grant_id) = &request.grant_id {
        payload["grant_id"] = serde_json::Value::String(grant_id.clone());
    }
    let event = EventInput::new(
        "ActionSubmitted",
        1,
        payload.clone(),
        ActorId::Slot(request.actor_slot.clone()),
        0,
    );
    let mut events = vec![event];
    if action_window == Window::Instant {
        let mut phase_input = EngineInputBuilder::new(request.game, &stream, &phase).build()?;
        let submission = domain::Submission {
            action_id: request.action_id.clone(),
            actor: request.actor_slot.clone(),
            template_id: request.template_id.clone(),
            targets: request.targets.clone(),
            phase_id: phase.clone(),
            submitted_at: phase_input.logical_time(),
            withdrawn: false,
            metadata: metadata_from_payload(&payload),
        };
        phase_input.submissions = vec![submission];
        phase_input.day_phase_inputs = domain::DayPhaseInputs::default();
        let output = domain::resolve_instant(phase_input.resolve_input(EngineRunKind::Instant {
            action_id: &request.action_id,
        }));
        domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION).map_err(
            |error| Reject::Internal(format!("invalid instant resolution result: {error}")),
        )?;
        domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION).map_err(
            |error| Reject::Internal(format!("invalid instant resolution trace: {error}")),
        )?;
        events.push(EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(output.applied)
                .map_err(|error| Reject::Internal(error.to_string()))?,
            ActorId::System,
            phase_input.next_stream_seq + 1,
        ));
        events.push(EventInput::new(
            "ResolutionTrace",
            1,
            serde_json::to_value(output.trace)
                .map_err(|error| Reject::Internal(error.to_string()))?,
            ActorId::System,
            phase_input.next_stream_seq + 2,
        ));
    }
    persist(tx, request.game, &events).await
}

async fn validate_action_submission(
    context: ActionValidationContext<'_, '_>,
) -> Result<Window, Reject> {
    let ActionValidationContext {
        tx,
        game,
        pack,
        stream,
        phase_id,
        request,
    } = context;
    let phase_kind = phase_kind(phase_id)?;
    let phase_number = phase_number(phase_id)?;
    let slots = projections::slot_state(&mut **tx, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == request.actor_slot)
        .cloned()
        .ok_or(Reject::UnknownSlot)?;
    let role_key = actor.role_key.as_deref().ok_or(Reject::InvalidTarget)?;
    let role = pack.roles.get(role_key).ok_or_else(|| {
        Reject::Internal(format!(
            "role `{role_key}` is missing from pack {}",
            pack.name
        ))
    })?;
    let (template, source) = submission_template(
        pack,
        role,
        &request.template_id,
        request.grant_id.as_deref(),
    )?;
    let uses_grant_option = matches!(source, ActionSource::Role)
        && template.has_ability(IrAbility::Grant)
        && !template.grant_options.is_empty();
    if uses_grant_option
        && request
            .grant_id
            .as_deref()
            .and_then(|id| selected_grant_option(template, id))
            .is_none()
    {
        return Err(Reject::InvalidTarget);
    }

    if !template.window.matches_phase_kind(phase_kind) {
        return Err(Reject::PhaseLocked);
    }
    if let Some(parity) = template.constraints.phase_parity {
        let matches = match parity {
            PhaseParity::Odd => phase_number % 2 == 1,
            PhaseParity::Even => phase_number % 2 == 0,
        };
        if !matches {
            return Err(Reject::InvalidTarget);
        }
    }
    if let Some(parity) = template.constraints.cycle_parity {
        let matches = match parity {
            PhaseParity::Odd => phase_number % 2 == 1,
            PhaseParity::Even => phase_number % 2 == 0,
        };
        if !matches {
            return Err(Reject::InvalidTarget);
        }
    }
    if activation_gate_reason(template, phase_kind, phase_number).is_some() {
        return Err(Reject::InvalidTarget);
    }

    match template.targets {
        TargetSpec::None if !request.targets.is_empty() => return Err(Reject::InvalidTarget),
        TargetSpec::One if request.targets.len() != 1 => return Err(Reject::InvalidTarget),
        TargetSpec::Many | TargetSpec::Group
            if request.targets.is_empty()
                || request.targets.len() > template.constraints.max_targets as usize =>
        {
            return Err(Reject::InvalidTarget);
        }
        _ => {}
    }
    if template.ability == IrAbility::Link && request.targets.len() < 2 {
        return Err(Reject::InvalidTarget);
    }
    if !template.constraints.self_allowed
        && request
            .targets
            .iter()
            .any(|target| target == &request.actor_slot)
    {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.personal_only
        && request
            .targets
            .iter()
            .any(|target| target != &request.actor_slot)
    {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.lazy_requires_multiple_non_town
        && slots
            .iter()
            .filter(|slot| slot.alive)
            .filter(|slot| slot.alignment.as_deref() != Some("town"))
            .count()
            <= 1
    {
        return Err(Reject::InvalidTarget);
    }
    if template
        .constraints
        .disabled_at_or_below_alive
        .map(|threshold| slots.iter().filter(|slot| slot.alive).count() <= threshold as usize)
        .unwrap_or(false)
    {
        return Err(Reject::InvalidTarget);
    }
    if role_modifier_team_kill_rejected(pack, role, template, &actor, &slots) {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.unique_targets {
        let unique: std::collections::BTreeSet<&str> =
            request.targets.iter().map(String::as_str).collect();
        if unique.len() != request.targets.len() {
            return Err(Reject::InvalidTarget);
        }
    }
    if target_role_filter_rejected(pack, template, &request.targets, &slots) {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.x_shots.is_some() {
        let counter_id = action_counter_id(&template.id);
        let exhausted = projections::action_counters(&mut **tx, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == request.actor_slot
                    && counter.counter_id == counter_id
                    && counter.remaining == 0
            });
        if exhausted {
            return Err(Reject::InvalidTarget);
        }
    }
    if let Some(cooldown_cycles) = template.constraints.cooldown_cycles {
        let counter_id = cooldown_counter_id(&template.id);
        let on_cooldown = projections::action_counters(&mut **tx, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == request.actor_slot
                    && counter.counter_id == counter_id
                    && counter.phase_kind == phase_kind_name(phase_kind)
                    && phase_number as i32 <= counter.phase_number + i32::from(cooldown_cycles)
            });
        if on_cooldown {
            return Err(Reject::InvalidTarget);
        }
    }
    if template.has_ability(IrAbility::ItaShot) {
        let session = ita_session_for_phase(pack, phase_number).ok_or(Reject::InvalidTarget)?;
        if session.shot_limit.is_some() {
            let counter_id = day_session_counter_id(&session.session_id, &template.id);
            let exhausted = projections::action_counters(&mut **tx, game)
                .await?
                .iter()
                .any(|counter| {
                    counter.slot_id == request.actor_slot
                        && counter.counter_id == counter_id
                        && counter.remaining == 0
                });
            if exhausted {
                return Err(Reject::InvalidTarget);
            }
        }
    }
    if source == ActionSource::ItemGrant {
        let grant_id = request.grant_id.as_deref().ok_or(Reject::InvalidTarget)?;
        let counter_id = inventory_counter_id(grant_id);
        let exhausted = projections::action_counters(&mut **tx, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == request.actor_slot
                    && counter.counter_id == counter_id
                    && counter.remaining == 0
            });
        if exhausted {
            return Err(Reject::InvalidTarget);
        }
    }
    if template.has_modifier(Modifier::NonConsecutive)
        || template.has_modifier(Modifier::Indecisive)
        || template.has_modifier(Modifier::Roaming)
    {
        let repeated = projections::action_history(&mut **tx, game)
            .await?
            .iter()
            .any(|record| {
                let in_scope = if template.has_modifier(Modifier::Roaming) {
                    record.phase_kind == "Night"
                } else {
                    record.phase_kind == "Night" && record.phase_number + 1 == phase_number as i32
                };
                record.slot_id == request.actor_slot
                    && record.template_id == template.id
                    && in_scope
                    && record.status == "resolved"
                    && request
                        .targets
                        .iter()
                        .any(|target| record.targets.contains(target))
            });
        if repeated {
            return Err(Reject::InvalidTarget);
        }
    }
    validate_action_slot_capacity(ActionCapacityContext {
        tx,
        game,
        stream,
        phase_id,
        phase_number,
        actor_slot: &request.actor_slot,
        template_id: &request.template_id,
        template,
        grant_id: request.grant_id.as_deref(),
        source,
    })
    .await?;
    let target_state = template
        .constraints
        .target_state
        .unwrap_or(TargetState::Alive);
    for target in &request.targets {
        let alive = projections::slot_alive(&mut **tx, game, target)
            .await?
            .ok_or(Reject::InvalidTarget)?;
        match target_state {
            TargetState::Any => {}
            TargetState::Alive if !alive => return Err(Reject::InvalidTarget),
            TargetState::Dead if alive => return Err(Reject::InvalidTarget),
            TargetState::Alive | TargetState::Dead => {}
        }
    }
    Ok(template.window)
}

fn target_role_filter_rejected(
    pack: &domain::Pack,
    template: &ActionTemplate,
    targets: &[String],
    slots: &[projections::SlotStateRow],
) -> bool {
    let Some(filter) = template.constraints.target_role_filter else {
        return false;
    };
    let vanilla_roles = &pack.investigation_results.role_sets.vanilla_roles;
    if vanilla_roles.is_empty() {
        return true;
    }
    targets.iter().any(|target| {
        let Some(role_key) = slots
            .iter()
            .find(|slot| slot.slot_id == *target)
            .and_then(|slot| slot.role_key.as_deref())
        else {
            return true;
        };
        let is_vanilla = vanilla_roles.iter().any(|candidate| candidate == role_key);
        match filter {
            TargetRoleFilter::PowerRole => is_vanilla,
            TargetRoleFilter::Vanilla => !is_vanilla,
        }
    })
}

fn role_modifier_team_kill_rejected(
    pack: &domain::Pack,
    role: &domain::pack::Role,
    template: &ActionTemplate,
    actor: &projections::SlotStateRow,
    slots: &[projections::SlotStateRow],
) -> bool {
    let lost = role.has_modifier(RoleModifier::Lost);
    let recluse = role.has_modifier(RoleModifier::Recluse);
    if (!lost && !recluse)
        || !pack
            .night_resolution
            .team_kill_action_ids
            .iter()
            .any(|id| id == &template.id)
    {
        return false;
    }
    if actor.alignment.as_deref() != Some("mafia") {
        return true;
    }
    let mut living_teammates = slots.iter().filter(|slot| {
        slot.slot_id != actor.slot_id && slot.alive && slot.alignment.as_deref() == Some("mafia")
    });
    if lost {
        return living_teammates.count() > 0;
    }
    living_teammates.any(|slot| {
        slot.role_key
            .as_deref()
            .and_then(|role_key| pack.roles.get(role_key))
            .map(|role| !role.has_modifier(RoleModifier::Recluse))
            .unwrap_or(true)
    })
}

fn submission_template<'a>(
    pack: &'a domain::Pack,
    role: &'a domain::pack::Role,
    template_id: &str,
    grant_id: Option<&str>,
) -> Result<(&'a ActionTemplate, ActionSource), Reject> {
    if let Some(template) = role.actions.iter().find(|action| action.id == template_id) {
        return Ok((template, ActionSource::Role));
    }
    let Some(grant_id) = grant_id else {
        return Err(Reject::InvalidTarget);
    };
    let Some(template) = pack.item_actions.get(grant_id) else {
        return Err(Reject::InvalidTarget);
    };
    if template.id != template_id {
        return Err(Reject::InvalidTarget);
    }
    Ok((template, ActionSource::ItemGrant))
}

fn selected_grant_option<'a>(
    template: &'a ActionTemplate,
    grant_id: &str,
) -> Option<&'a GrantSpec> {
    template
        .grant_options
        .iter()
        .find(|grant| grant.grant_id == grant_id)
}

async fn validate_action_slot_capacity(
    context: ActionCapacityContext<'_, '_>,
) -> Result<(), Reject> {
    let ActionCapacityContext {
        tx,
        game,
        stream,
        phase_id,
        phase_number,
        actor_slot,
        template_id,
        template,
        grant_id,
        source,
    } = context;
    let active = active_actions_from_stream(stream, phase_id, actor_slot);
    let uses_grant_option = matches!(source, ActionSource::Role)
        && grant_id
            .and_then(|id| selected_grant_option(template, id))
            .is_some();
    match (source, grant_id) {
        (ActionSource::Role, _) if uses_grant_option => {
            let base_already_active = active
                .values()
                .any(|action| action.template_id == template_id);
            if base_already_active && !template.has_modifier(Modifier::Simultaneous) {
                return Err(Reject::ActionAlreadySubmitted);
            }
        }
        (ActionSource::Role, None) => {
            let base_already_active = active
                .values()
                .any(|action| action.grant_id.is_none() && action.template_id == template_id);
            if base_already_active && !template.has_modifier(Modifier::Simultaneous) {
                return Err(Reject::ActionAlreadySubmitted);
            }
        }
        (ActionSource::Role, Some(grant_id)) | (ActionSource::ItemGrant, Some(grant_id)) => {
            let required_kind = match source {
                ActionSource::Role => GrantKind::ExtraAction,
                ActionSource::ItemGrant => GrantKind::Item,
            };
            let granted_uses = projections::action_grants(&mut **tx, game)
                .await?
                .into_iter()
                .filter(|grant| {
                    grant.slot_id == actor_slot
                        && grant.grant_id == grant_id
                        && grant.kind == grant_kind_name(required_kind)
                        && grant.phase_number < phase_number as i32
                })
                .map(|grant| grant.uses.max(0) as usize)
                .sum::<usize>();
            let active_grant_uses = active
                .values()
                .filter(|action| action.grant_id.as_deref() == Some(grant_id))
                .count();
            if granted_uses == 0 || active_grant_uses >= granted_uses {
                return Err(Reject::InvalidTarget);
            }
        }
        (ActionSource::ItemGrant, None) => return Err(Reject::InvalidTarget),
    }
    Ok(())
}

fn grant_kind_name(kind: GrantKind) -> &'static str {
    match kind {
        GrantKind::ExtraAction => "ExtraAction",
        GrantKind::Item => "Item",
        GrantKind::VoteWeight => "VoteWeight",
    }
}

pub(super) async fn active_actions_for_actor_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<BTreeMap<String, ActiveAction>, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    Ok(active_actions_from_stream(&stream, phase_id, actor_slot))
}

fn active_actions_from_stream(
    stream: &[eventstore::StoredEvent],
    phase_id: &str,
    actor_slot: &str,
) -> BTreeMap<String, ActiveAction> {
    let mut active = BTreeMap::new();
    for event in stream {
        match event.kind.as_str() {
            "ActionSubmitted"
                if event.payload["phase_id"].as_str() == Some(phase_id)
                    && event.payload["actor"].as_str() == Some(actor_slot) =>
            {
                if let (Some(action_id), Some(template_id)) = (
                    event.payload["action_id"].as_str(),
                    event.payload["template_id"].as_str(),
                ) {
                    active.insert(
                        action_id.to_string(),
                        ActiveAction {
                            template_id: template_id.to_string(),
                            grant_id: event.payload["grant_id"].as_str().map(str::to_string),
                            targets: event.payload["targets"]
                                .as_array()
                                .map(|targets| {
                                    targets
                                        .iter()
                                        .filter_map(|target| target.as_str().map(str::to_string))
                                        .collect()
                                })
                                .unwrap_or_default(),
                        },
                    );
                }
            }
            "ActionWithdrawn"
                if event
                    .payload
                    .get("phase_id")
                    .and_then(|value| value.as_str())
                    .map(|withdraw_phase| withdraw_phase == phase_id)
                    .unwrap_or(true)
                    && event
                        .payload
                        .get("actor")
                        .and_then(|value| value.as_str())
                        .map(|withdraw_actor| withdraw_actor == actor_slot)
                        .unwrap_or(true) =>
            {
                if let Some(action_id) = event.payload["action_id"].as_str() {
                    active.remove(action_id);
                }
            }
            _ => {}
        }
    }
    active
}

fn action_counter_id(template_id: &str) -> String {
    format!("x_shot:{template_id}")
}

fn cooldown_counter_id(template_id: &str) -> String {
    format!("cooldown:{template_id}")
}

fn day_session_counter_id(session_id: &str, template_id: &str) -> String {
    format!("day_session:{session_id}:{template_id}")
}

fn inventory_counter_id(grant_id: &str) -> String {
    format!("inventory:{grant_id}")
}

fn ita_session_for_phase(
    pack: &domain::Pack,
    phase_number: u32,
) -> Option<&domain::pack::ItaSessionSpec> {
    pack.ita.sessions.iter().find(|session| match session.day {
        Some(day) => day == phase_number,
        None => true,
    })
}

fn phase_kind_name(phase_kind: domain::pack::PhaseKind) -> &'static str {
    match phase_kind {
        domain::pack::PhaseKind::Day => "Day",
        domain::pack::PhaseKind::Night => "Night",
        domain::pack::PhaseKind::Twilight => "Twilight",
    }
}

fn activation_gate_reason(
    template: &ActionTemplate,
    phase_kind: domain::pack::PhaseKind,
    phase_number: u32,
) -> Option<&'static str> {
    let gate = template.constraints.active_from.as_ref()?;
    if gate.phase_kind == phase_kind && phase_number >= gate.phase_number {
        return None;
    }
    Some(match gate.reason {
        ActivationGateReason::Novice => "novice_inactive",
        ActivationGateReason::Activated => "activated_inactive",
    })
}
