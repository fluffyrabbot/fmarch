//! `commands` — the command pipeline core (doc 03), pre-HTTP. Phase 4's `api`
//! will wrap [`handle`] in an axum route; here it is a plain async function so it
//! is exercisable directly against Postgres.
//!
//! Pipeline per command (doc 03 §"Command handling pipeline"):
//!
//! 1. **resolve capability** — once, at the boundary, via [`caps::resolve`]
//!    reading projections (never ambient globals).
//! 2. **validate** — domain rules: phase open/unlocked, slot alive, the actor IS
//!    the slot's current occupant, target valid, host-gating.
//! 3. **produce events** — the platform [`eventstore::EventInput`]s.
//! 4. **persist** — [`projections::append_and_project`] in one tx; an eventstore
//!    `Conflict` surfaces as the retryable [`Reject::StreamConflict`].
//! 5. **ack** — [`Ack`] or a TYPED [`Reject`].
//!
//! Authority is RESOLVED once and PASSED INWARD: validation receives a
//! [`caps::CapabilitySet`] and asks `grants(required)`. Inner code never
//! re-derives authority (confused-deputy defense, doc 06).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::{Duration, Instant};

use caps::{Capability, CapabilitySet, Principal};
use domain::{
    pack::{
        ActionTemplate, ActivationGateReason, GrantKind, GrantSpec, HostPromptDecisionKind,
        HostPromptResolutionEffect, HostPromptResolutionEffectPolicy, PhaseParity,
        TargetRoleFilter, TargetSpec, TargetState, Window,
    },
    IrAbility, Modifier, RoleModifier,
};
use eventstore::{ActorId, EventInput};
use projections::{append_and_project_in_tx, audit_rebuild, ProjectionError};
use serde::Serialize;
use sqlx::{postgres::PgPool, Row};
use uuid::Uuid;

mod model;
pub mod operator_proof;
pub use model::{Ack, Command, HostPromptDecision, Reject, VoteTarget};

pub const LARGE_ACTION_GRAPH_PERFORMANCE_SEED: u64 = 90_001;
pub const LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS: u64 = 20_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EngineSnapshotIdentityAudit {
    pub phase_id: String,
    pub snapshot_slot_ids: Vec<String>,
    pub stream_user_ids: Vec<String>,
    pub leaked_user_ids: Vec<String>,
    pub slot_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnginePhaseInputAudit {
    pub phase_id: String,
    pub phase_kind: domain::pack::PhaseKind,
    pub phase_number: u32,
    pub pack_name: String,
    pub state: domain::StateSnapshot,
    pub submissions: Vec<domain::Submission>,
    pub day_phase_inputs: domain::DayPhaseInputs,
}

#[derive(Debug, Clone)]
struct ReceiptClaim {
    principal_user_id: String,
    command_id: Uuid,
}

#[derive(Debug, Clone)]
struct ActiveAction {
    template_id: String,
    grant_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionSource {
    Role,
    ItemGrant,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum HostPromptEffect {
    PkKill {
        selected: String,
        contenders: Vec<String>,
    },
    AdvancePhase {
        phase_id: String,
        reason: &'static str,
        skipped_phase_id: Option<String>,
    },
    AcknowledgeOnly,
}

#[derive(Debug, Clone)]
struct RebuiltResolutionEnvelope {
    applied: domain::ResolutionApplied,
    trace: domain::ResolutionTrace,
}

#[derive(Debug, serde::Serialize)]
struct HostPromptPhaseControlPayload {
    phase_id: String,
    source_prompt_id: String,
    source_phase_id: String,
    reason: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    skipped_phase_id: Option<String>,
}

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

impl ReceiptClaim {
    fn new(principal: &Principal, command_id: Uuid) -> Self {
        ReceiptClaim {
            principal_user_id: principal.user_id().to_string(),
            command_id,
        }
    }
}

/// The result of a successful command: the stream sequences it appended.
impl Ack {
    fn from_seqs(seqs: Vec<i64>) -> Self {
        Ack { stream_seqs: seqs }
    }
}

/// Handle one command end-to-end. The single entry point Phase 4 will wrap.
pub async fn handle(pool: &PgPool, principal: &Principal, command: Command) -> Result<Ack, Reject> {
    handle_inner(pool, principal, command, None).await
}

/// Handle a network command with durable idempotency. If `(principal,
/// command_id)` has already committed, return the original ack without
/// revalidating against current state or appending new events.
pub async fn handle_idempotent(
    pool: &PgPool,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
) -> Result<Ack, Reject> {
    let receipt = ReceiptClaim::new(principal, command_id);
    if let Some(ack) = load_receipt(pool, &receipt).await? {
        return Ok(ack);
    }
    handle_inner(pool, principal, command, Some(&receipt)).await
}

async fn handle_inner(
    pool: &PgPool,
    principal: &Principal,
    command: Command,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    match command {
        // ── bootstrap lifecycle (minimal, host-gated where appropriate) ──
        Command::CreateGame { game, pack } => {
            create_game(pool, principal, game, pack, receipt).await
        }
        Command::AddSlot { game, slot } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "SlotAdded",
                serde_json::json!({ "slot_id": slot }),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::AssignSlot { game, slot, user } => {
            assign_slot(pool, principal, game, slot, user, receipt).await
        }
        Command::AssignRole {
            game,
            slot,
            role_key,
        } => assign_role(pool, principal, game, slot, role_key, receipt).await,
        Command::SetSlotStatus { game, slot, status } => {
            host_slot_lifecycle(
                pool,
                principal,
                game,
                slot,
                "SlotStatusChanged",
                serde_json::json!({ "status": status }),
                receipt,
            )
            .await
        }
        Command::AddSlotStatusTag { game, slot, tag } => {
            host_slot_lifecycle(
                pool,
                principal,
                game,
                slot,
                "SlotStatusTagged",
                serde_json::json!({ "tag": tag }),
                receipt,
            )
            .await
        }
        Command::RemoveSlotStatusTag { game, slot, tag } => {
            host_slot_lifecycle(
                pool,
                principal,
                game,
                slot,
                "SlotStatusUntagged",
                serde_json::json!({ "tag": tag }),
                receipt,
            )
            .await
        }
        Command::AddCohost { game, user } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "CohostAdded",
                serde_json::json!({ "user_id": user }),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::StartGame { game, phase } => {
            start_game(pool, principal, game, phase, receipt).await
        }
        Command::OpenDayPhase { game, phase } => {
            host_phase_lifecycle(pool, principal, game, "PhaseAdvanced", phase, receipt).await
        }
        Command::AdvancePhase { game } => advance_phase(pool, principal, game, receipt).await,
        Command::AdvancePhaseByDeadline {
            game,
            phase,
            observed_at,
        } => advance_phase_by_deadline(pool, principal, game, phase, observed_at, receipt).await,
        Command::LockThread { game } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "ThreadLocked",
                serde_json::json!({ "channel_id": "main" }),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::UnlockThread { game } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "ThreadUnlocked",
                serde_json::json!({ "channel_id": "main" }),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::ResolvePhase { game, seed } => {
            resolve_phase(pool, principal, game, seed, receipt).await
        }
        Command::CompleteGame { game } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "GameCompleted",
                serde_json::json!({}),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::ResolveHostPrompt {
            game,
            prompt_id,
            decision,
        } => resolve_host_prompt(pool, principal, game, prompt_id, decision, receipt).await,

        // ── slice commands ──
        Command::SubmitVote {
            game,
            actor_slot,
            target,
        } => submit_vote(pool, principal, game, actor_slot, target, receipt).await,
        Command::WithdrawVote { game, actor_slot } => {
            withdraw_vote(pool, principal, game, actor_slot, receipt).await
        }
        Command::SubmitAction {
            game,
            action_id,
            actor_slot,
            template_id,
            targets,
            grant_id,
        } => {
            submit_action(
                pool,
                principal,
                game,
                action_id,
                actor_slot,
                template_id,
                targets,
                grant_id,
                receipt,
            )
            .await
        }
        Command::WithdrawAction {
            game,
            action_id,
            actor_slot,
        } => withdraw_action(pool, principal, game, action_id, actor_slot, receipt).await,
        Command::SubmitPost {
            game,
            actor_slot,
            body,
        } => submit_post(pool, principal, game, actor_slot, body, receipt).await,
        Command::ExtendDeadline { game, phase, at } => {
            extend_deadline(pool, principal, game, phase, at, receipt).await
        }
        Command::ProcessReplacement {
            game,
            slot,
            outgoing_user,
            incoming_user,
        } => {
            process_replacement(
                pool,
                principal,
                game,
                slot,
                outgoing_user,
                incoming_user,
                receipt,
            )
            .await
        }
    }
}

// ───────────────────────── bootstrap handlers ─────────────────────────

/// `CreateGame` requires no game-scoped capability — there is none yet. The
/// creating principal BECOMES the host (the `GameCreated.host` field), which is
/// what every subsequent host-gated command resolves against.
async fn create_game(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    pack: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    if projections::game_exists(pool, game).await? {
        return Err(Reject::UnknownGame); // already exists → treat as bad request
    }
    let host = principal.user_id().to_string();
    let ev = EventInput::new(
        "GameCreated",
        1,
        serde_json::json!({ "host": host, "pack": pack }),
        ActorId::User(host.clone()),
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

/// A host-gated lifecycle command that appends a single event. Resolves
/// `HostOf(game)` (cohost/global may escalate via `grants`) then appends.
async fn host_lifecycle(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    kind: &str,
    payload: serde_json::Value,
    actor: ActorId,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;
    persist(
        pool,
        game,
        &[EventInput::new(kind, 1, payload, actor, 0)],
        receipt,
    )
    .await
}

async fn host_phase_lifecycle(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    kind: &str,
    phase: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    validate_pack_phase_id(&pack, &phase)?;

    persist(
        pool,
        game,
        &[EventInput::new(
            kind,
            1,
            serde_json::json!({ "phase_id": phase }),
            ActorId::Host,
            0,
        )],
        receipt,
    )
    .await
}

async fn start_game(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    phase: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    validate_pack_phase_id(&pack, &phase)?;

    let mut events = vec![EventInput::new(
        "GameStarted",
        1,
        serde_json::json!({ "phase_id": phase }),
        ActorId::Host,
        0,
    )];
    events.extend(private_channel_declarations(&pack, &stream)?);
    persist(pool, game, &events, receipt).await
}

async fn advance_phase(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let (phase, stream) = resolved_locked_phase_stream(pool, game).await?;
    let source_phase_id = phase.phase_id.clone();
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let next_phase_id = next_declared_phase_id(&pack.phases, &source_phase_id)?;
    let payload = serde_json::json!({
        "phase_id": next_phase_id,
        "source_phase_id": source_phase_id,
        "reason": "resolved_phase",
    });
    persist(
        pool,
        game,
        &[EventInput::new(
            "PhaseAdvanced",
            1,
            payload,
            ActorId::Host,
            0,
        )],
        receipt,
    )
    .await
}

async fn advance_phase_by_deadline(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    phase_id: String,
    observed_at: i64,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let (phase, stream) = resolved_locked_phase_stream(pool, game).await?;
    if phase.phase_id != phase_id {
        return Err(Reject::InvalidTarget);
    }
    let Some(deadline_at) = phase.deadline else {
        return Err(Reject::InvalidTarget);
    };
    if observed_at < deadline_at {
        return Err(Reject::InvalidTarget);
    }

    let source_phase_id = phase.phase_id.clone();
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let next_phase_id = next_declared_phase_id(&pack.phases, &source_phase_id)?;
    let deadline_ev = EventInput::new(
        "PhaseDeadlineElapsed",
        1,
        serde_json::json!({
            "phase_id": source_phase_id.clone(),
            "deadline_at": deadline_at,
            "observed_at": observed_at,
            "source": "scheduler",
        }),
        ActorId::System,
        observed_at,
    );
    let advance_ev = EventInput::new(
        "PhaseAdvanced",
        1,
        serde_json::json!({
            "phase_id": next_phase_id,
            "source_phase_id": source_phase_id,
            "reason": "deadline_elapsed",
            "source_event_kind": "PhaseDeadlineElapsed",
            "source_deadline_at": deadline_at,
            "observed_at": observed_at,
        }),
        ActorId::System,
        observed_at,
    );
    persist(pool, game, &[deadline_ev, advance_ev], receipt).await
}

async fn resolved_locked_phase_stream(
    pool: &PgPool,
    game: Uuid,
) -> Result<(projections::PhaseStateRow, Vec<eventstore::StoredEvent>), Reject> {
    let phase = projections::phase_state(pool, game)
        .await?
        .ok_or(Reject::PhaseLocked)?;
    if !phase.locked || phase_has_pending_prompt(pool, game, &phase.phase_id).await? {
        return Err(Reject::InvalidTarget);
    }

    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    if !stream.iter().any(|event| {
        event.kind == "ResolutionApplied"
            && event.payload["phase_id"].as_str() == Some(&phase.phase_id)
    }) {
        return Err(Reject::InvalidTarget);
    }

    Ok((phase, stream))
}

async fn host_slot_lifecycle(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    slot: String,
    kind: &str,
    mut payload: serde_json::Value,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;
    if !projections::slot_exists(pool, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    payload["slot_id"] = serde_json::Value::String(slot);
    persist(
        pool,
        game,
        &[EventInput::new(kind, 1, payload, ActorId::Host, 0)],
        receipt,
    )
    .await
}

async fn assign_slot(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    slot: String,
    user: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;
    if !projections::slot_exists(pool, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    let ev = EventInput::new(
        "SlotAssigned",
        1,
        serde_json::json!({ "slot_id": slot, "user_id": user }),
        ActorId::Host,
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

async fn assign_role(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    slot: String,
    role_key: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;
    if !projections::slot_exists(pool, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    let pack = load_pack(&current_pack_name(pool, game).await?)?;
    let role = pack
        .roles
        .get(&role_key)
        .ok_or_else(|| Reject::InvalidRole(role_key.clone()))?;
    let ev = EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({
            "slot_id": slot,
            "role_key": role_key,
            "alignment": role.alignment.clone(),
            "role_effects": role.effects.clone(),
        }),
        ActorId::Host,
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

// ───────────────────────── slice handlers ─────────────────────────

async fn submit_vote(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    actor_slot: String,
    target: VoteTarget,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;

    // 1. resolve capability (boundary) and require the NARROWEST one.
    let caps = caps::resolve(pool, principal, game).await?;
    require_slot_occupant(pool, game, &actor_slot, &caps).await?;

    // 2. validate domain rules.
    let phase = require_open_day_phase(pool, game).await?;
    require_slot_alive(pool, game, &actor_slot).await?;
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let phase_kind = phase_kind(&phase)?;
    let phase_number = phase_number(&phase)?;
    let state = current_snapshot(&stream, &pack, &phase, phase_kind, phase_number)?;
    validate_vote_actor_policy(&pack, &state, &actor_slot)?;
    validate_vote_policy_target(&pack.vote, &actor_slot, &target)?;
    let target_str = validate_target(pool, game, &target).await?;

    // 3. produce events.
    let ev = EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": actor_slot, "target": target_str, "phase_id": phase }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    let mut events = vec![ev];
    if let Some(lock_ev) =
        hammer_lock_event(&stream, game, &phase, &pack, &actor_slot, &target_str)?
    {
        events.push(lock_ev);
    }

    // 4. persist (one tx; Conflict → StreamConflict).
    persist(pool, game, &events, receipt).await
}

async fn withdraw_vote(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    actor_slot: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require_slot_occupant(pool, game, &actor_slot, &caps).await?;
    // RULING: withdraw is gated on the SAME open-phase rule as submit — you may
    // only change your ballot while the phase is votable (doc 01 phases partition
    // votes; doc under-specifies, decided here). The withdrawal carries
    // { actor, phase_id } (doc 10 says { action_id } but the running tally is
    // ballot-keyed per the Phase-3 ruling, so actor+phase is the correct key).
    let phase = require_open_day_phase(pool, game).await?;
    require_slot_alive(pool, game, &actor_slot).await?;
    let ev = EventInput::new(
        "VoteWithdrawn",
        1,
        serde_json::json!({ "actor": actor_slot, "phase_id": phase }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

async fn submit_action(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    action_id: String,
    actor_slot: String,
    template_id: String,
    targets: Vec<String>,
    grant_id: Option<String>,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    if action_id.trim().is_empty() || template_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if grant_id.as_deref().is_some_and(|id| id.trim().is_empty()) {
        return Err(Reject::InvalidTarget);
    }

    let caps = caps::resolve(pool, principal, game).await?;
    require_slot_occupant(pool, game, &actor_slot, &caps).await?;
    let phase = require_open_phase(pool, game).await?;
    require_slot_alive(pool, game, &actor_slot).await?;
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let action_window = validate_action_submission(
        pool,
        game,
        &pack,
        &phase,
        &actor_slot,
        &template_id,
        &targets,
        grant_id.as_deref(),
    )
    .await?;

    let mut payload = serde_json::json!({
        "action_id": action_id,
        "template_id": template_id,
        "actor": actor_slot,
        "targets": targets,
        "phase_id": phase
    });
    if action_window == Window::Instant {
        payload["instant_resolved"] = serde_json::Value::Bool(true);
    }
    if let Some(grant_id) = &grant_id {
        payload["grant_id"] = serde_json::Value::String(grant_id.clone());
    }
    let ev = EventInput::new(
        "ActionSubmitted",
        1,
        payload.clone(),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    let mut events = vec![ev];
    if action_window == Window::Instant {
        let next_seq = stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);
        let phase_kind = phase_kind(&phase)?;
        let phase_number = phase_number(&phase)?;
        let state = current_snapshot(&stream, &pack, &phase, phase_kind, phase_number)?;
        let submission = domain::Submission {
            action_id: action_id.clone(),
            actor: actor_slot.clone(),
            template_id: template_id.clone(),
            targets: targets.clone(),
            phase_id: phase.clone(),
            submitted_at: next_seq as u64,
            withdrawn: false,
            metadata: metadata_from_payload(&payload),
        };
        let run_id = format!("instant:{game}:{phase}:{action_id}:{next_seq}");
        let output = domain::resolve_instant(domain::ResolutionInput {
            game_id: game.to_string(),
            phase_id: phase.clone(),
            run_id,
            state,
            submissions: vec![submission],
            day_phase_inputs: domain::DayPhaseInputs::default(),
            pack,
            seed: next_seq as u64,
            logical_time: next_seq as u64,
        });
        domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
            .map_err(|e| Reject::Internal(format!("invalid instant resolution result: {e}")))?;
        domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
            .map_err(|e| Reject::Internal(format!("invalid instant resolution trace: {e}")))?;
        events.push(EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(output.applied).map_err(|e| Reject::Internal(e.to_string()))?,
            ActorId::System,
            next_seq + 1,
        ));
        events.push(EventInput::new(
            "ResolutionTrace",
            1,
            serde_json::to_value(output.trace).map_err(|e| Reject::Internal(e.to_string()))?,
            ActorId::System,
            next_seq + 2,
        ));
    }
    persist(pool, game, &events, receipt).await
}

async fn withdraw_action(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    action_id: String,
    actor_slot: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    if action_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }

    let caps = caps::resolve(pool, principal, game).await?;
    require_slot_occupant(pool, game, &actor_slot, &caps).await?;
    let phase = require_open_phase(pool, game).await?;
    require_slot_alive(pool, game, &actor_slot).await?;
    if !active_action_exists(pool, game, &phase, &actor_slot, &action_id).await? {
        return Err(Reject::InvalidTarget);
    }

    let ev = EventInput::new(
        "ActionWithdrawn",
        1,
        serde_json::json!({
            "action_id": action_id,
            "actor": actor_slot,
            "phase_id": phase
        }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

async fn submit_post(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    actor_slot: String,
    body: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require_slot_occupant(pool, game, &actor_slot, &caps).await?;
    require_slot_can_post(pool, game, &actor_slot).await?;
    // A post is attributed to the SLOT (doc 01: post authorship attaches to the
    // slot, not the user). `slot_or_user` carries the slot id so authorship
    // survives a replacement. Phase id is recorded for partitioning.
    let phase = current_phase(pool, game).await?.unwrap_or_default();
    let ev = EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "main",
            "slot_or_user": { "slot": actor_slot.clone() },
            "body": body,
            "phase_id": phase,
        }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

async fn extend_deadline(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    phase: String,
    at: i64,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    // Requires HostOf|CohostOf — the narrowest is CohostOf (host subsumes it).
    require(&caps, &Capability::CohostOf(game), Reject::NotHost)?;
    let ev = EventInput::new(
        "DeadlineExtended",
        1,
        serde_json::json!({ "phase_id": phase, "at": at }),
        ActorId::Host,
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

/// The irreversible mechanic: swap the human behind a STABLE `SlotId`. The slot
/// id is UNCHANGED — only the occupant mapping moves — so the slot's votes,
/// posts, role, and lifecycle (all keyed by slot_id) are preserved. Requires
/// `HostOf` (doc 06: replacements are host authority).
async fn process_replacement(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    slot: String,
    outgoing_user: String,
    incoming_user: String,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    if !projections::slot_exists(pool, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    // Validate the outgoing user really is the CURRENT occupant (an honest,
    // auditable replacement). If not, the request is targeting a stale mapping.
    match projections::slot_occupant(pool, game, &slot).await? {
        Some(current) if current == outgoing_user => {}
        Some(_) => return Err(Reject::InvalidTarget),
        None => return Err(Reject::InvalidTarget),
    }

    let ev = EventInput::new(
        "ReplacementCompleted",
        1,
        serde_json::json!({
            "slot_id": slot,            // ← seat id UNCHANGED
            "outgoing_user": outgoing_user,
            "incoming_user": incoming_user,
        }),
        ActorId::Host,
        0,
    );
    persist(pool, game, &[ev], receipt).await
}

/// Host command: close the current phase by reconstructing the engine input from
/// the canonical event stream, running the pure resolver, and persisting
/// `ResolutionApplied` / `ResolutionTrace` plus a durable phase lock through
/// the normal append+projection tx.
async fn resolve_phase(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    seed: u64,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let phase = projections::phase_state(pool, game)
        .await?
        .ok_or(Reject::PhaseLocked)?;
    if phase.locked {
        return Err(Reject::PhaseLocked);
    }

    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    if stream.iter().any(|ev| {
        ev.kind == "ResolutionApplied"
            && ev.payload["phase_id"].as_str() == Some(&phase.phase_id)
            && ev.payload["run_id"]
                .as_str()
                .is_some_and(|run_id| run_id.starts_with("resolution:"))
    }) {
        return Err(Reject::InvalidTarget);
    }

    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let phase_kind = phase_kind(&phase.phase_id)?;
    let phase_number = phase_number(&phase.phase_id)?;
    let state = current_snapshot(&stream, &pack, &phase.phase_id, phase_kind, phase_number)?;
    let submissions = current_submissions(&stream, &phase.phase_id);
    let day_phase_inputs = current_day_phase_inputs(&stream, &state, phase_kind, phase_number)?;
    let next_seq = stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);
    let run_id = format!("resolution:{game}:{}:{seed}:{next_seq}", phase.phase_id);

    let output = domain::resolve(domain::ResolutionInput {
        game_id: game.to_string(),
        phase_id: phase.phase_id.clone(),
        run_id,
        state,
        submissions,
        day_phase_inputs,
        pack,
        seed,
        logical_time: next_seq as u64,
    });
    domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution result: {e}")))?;
    domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution trace: {e}")))?;
    let applied_ev = EventInput::new(
        "ResolutionApplied",
        1,
        serde_json::to_value(output.applied).map_err(|e| Reject::Internal(e.to_string()))?,
        ActorId::System,
        next_seq,
    );
    let trace_ev = EventInput::new(
        "ResolutionTrace",
        1,
        serde_json::to_value(output.trace).map_err(|e| Reject::Internal(e.to_string()))?,
        ActorId::System,
        next_seq,
    );
    let lock_ev = EventInput::new(
        "ThreadLocked",
        1,
        serde_json::json!({
            "channel_id": "main",
            "phase_id": phase.phase_id,
            "reason": "phase_resolved",
            "source": "resolve_phase",
        }),
        ActorId::System,
        next_seq,
    );
    persist(pool, game, &[applied_ev, trace_ev, lock_ev], receipt).await
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
            rerun_stored_host_prompt(game, prefix, &stored_applied)?
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
                detail: decision.detail,
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
                detail: edge.detail,
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
                detail: generated.detail,
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
                detail: effect.detail,
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
                detail: visibility.detail,
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
    let host = Principal::user("host_h");
    let roster = large_action_graph_roster();
    let actions = large_action_graph_actions();

    handle(
        pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
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
            Command::AssignSlot {
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
            &Principal::user(format!("large_graph_user_{}", slot_number(actor_slot)?)),
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
        && stream_event_count <= 200
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
    sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'ResolutionApplied' \
         AND payload->>'phase_id' = $2",
    )
    .bind(game)
    .bind(phase_id)
    .fetch_one(pool)
    .await
    .map_err(|err| Reject::Internal(err.to_string()))
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
    let pack = load_pack(&pack_name_from_stream(prefix)?)?;
    let state = current_snapshot(
        prefix,
        &pack,
        &stored.phase_id,
        stored.phase_kind,
        stored.phase_number,
    )?;
    let submissions = current_submissions(prefix, &stored.phase_id);
    let day_phase_inputs =
        current_day_phase_inputs(prefix, &state, stored.phase_kind, stored.phase_number)?;

    let output = domain::resolve(domain::ResolutionInput {
        game_id: game.to_string(),
        phase_id: stored.phase_id.clone(),
        run_id: stored.run_id.clone(),
        state,
        submissions,
        day_phase_inputs,
        pack,
        seed: stored.seed,
        logical_time: stored.started_at,
    });
    domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid rebuilt resolution result: {e}")))?;
    domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid rebuilt resolution trace: {e}")))?;
    Ok(RebuiltResolutionEnvelope {
        applied: output.applied,
        trace: output.trace,
    })
}

fn rerun_stored_host_prompt(
    game: Uuid,
    prefix: &[eventstore::StoredEvent],
    _stored: &domain::ResolutionApplied,
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
    let decision: HostPromptDecision = serde_json::from_value(decision_json.clone())
        .map_err(|e| Reject::Internal(format!("malformed HostPromptResolved decision: {e}")))?;
    let resolved_by = str_payload(resolved, "resolved_by")?;
    let pack = load_pack(&pack_name_from_stream(prefix)?)?;

    match host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        prefix,
    )? {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => Ok(Some(build_pk_prompt_resolution(
            game,
            &prompt,
            selected,
            contenders,
            decision_json,
            resolved_by,
            resolved.stream_seq,
        )?)),
        HostPromptEffect::AdvancePhase { .. } | HostPromptEffect::AcknowledgeOnly => Ok(None),
    }
}

fn host_prompt_from_stream(
    stream: &[eventstore::StoredEvent],
    prompt_id: &str,
) -> Result<projections::HostPromptRow, Reject> {
    for event in stream {
        if event.kind != "ResolutionApplied" {
            continue;
        }
        let applied = domain::validate_resolution_json(&event.payload, domain::RESULT_VERSION)
            .map_err(|e| Reject::Internal(format!("malformed ResolutionApplied: {e}")))?;
        for indexed in applied.events {
            let domain::InnerEvent::HostPromptIssued(prompt) = indexed.event else {
                continue;
            };
            if prompt.prompt_id != prompt_id {
                continue;
            }
            return Ok(projections::HostPromptRow {
                game_id: event.stream_id,
                phase_id: prompt.phase_id,
                event_index: indexed.index as i32,
                prompt_id: prompt.prompt_id,
                kind: prompt.kind,
                subject_slot: prompt.subject,
                reason: prompt.reason,
                phase_kind: format!("{:?}", prompt.phase_kind),
                phase_number: prompt.phase_number as i32,
                metadata: prompt.metadata,
                status: "resolved".to_string(),
                decision: None,
                resolved_by: None,
                resolved_at: None,
            });
        }
    }

    Err(Reject::UnknownPrompt)
}

fn build_pk_prompt_resolution(
    game: Uuid,
    prompt: &projections::HostPromptRow,
    selected: String,
    contenders: Vec<String>,
    decision_json: serde_json::Value,
    resolved_by: String,
    prompt_resolved_seq: i64,
) -> Result<RebuiltResolutionEnvelope, Reject> {
    let phase_kind = phase_kind(&prompt.phase_id)?;
    let phase_number = prompt.phase_number as u32;
    let run_id = format!(
        "host-prompt:{game}:{}:{}:{prompt_resolved_seq}",
        prompt.phase_id, prompt.prompt_id
    );
    let applied = domain::ResolutionApplied {
        phase_id: prompt.phase_id.clone(),
        phase_kind,
        phase_number,
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
                    phase_id: prompt.phase_id.clone(),
                    deaths: vec![domain::Death {
                        slot_id: selected.clone(),
                        cause: "pk".to_string(),
                    }],
                }),
            },
        ],
        started_at: prompt_resolved_seq as u64,
        finished_at: prompt_resolved_seq as u64 + 1,
    };
    domain::validate_resolution_applied(&applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid prompt resolution result: {e}")))?;
    let trace = domain::ResolutionTrace {
        phase_id: prompt.phase_id.clone(),
        run_id: run_id.clone(),
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
                "resolved_by": resolved_by,
            }),
        }],
        notes: Vec::new(),
    };
    domain::validate_resolution_trace(&trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid prompt resolution trace: {e}")))?;

    Ok(RebuiltResolutionEnvelope { applied, trace })
}

/// Host command: mark a durable host/admin prompt resolved and, when the prompt
/// decision has engine consequences, append those consequences through the same
/// validated `ResolutionApplied` envelope used by ordinary phase resolution.
async fn resolve_host_prompt(
    pool: &PgPool,
    principal: &Principal,
    game: Uuid,
    prompt_id: String,
    decision: HostPromptDecision,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    require_game(pool, game).await?;
    let caps = caps::resolve(pool, principal, game).await?;
    require(&caps, &Capability::HostOf(game), Reject::NotHost)?;

    let prompt = projections::host_prompts(pool, game)
        .await?
        .into_iter()
        .find(|prompt| prompt.prompt_id == prompt_id)
        .ok_or(Reject::UnknownPrompt)?;
    if prompt.status != "pending" {
        return Err(Reject::PromptAlreadyResolved);
    }

    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack = load_pack(&pack_name_from_stream(&stream)?)?;
    let next_seq = stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);
    let resolved_by = principal.user_id().to_string();
    let decision_json =
        serde_json::to_value(&decision).map_err(|e| Reject::Internal(e.to_string()))?;
    let resolved_ev = EventInput::new(
        "HostPromptResolved",
        1,
        serde_json::json!({
            "prompt_id": prompt.prompt_id,
            "phase_id": prompt.phase_id,
            "kind": prompt.kind,
            "reason": prompt.reason,
            "decision": decision_json,
            "resolved_by": resolved_by,
        }),
        ActorId::Host,
        next_seq,
    );

    let effect = host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        &stream,
    )?;

    let mut events = vec![resolved_ev];
    match effect {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => {
            require_slot_alive(pool, game, &selected).await?;
            let rebuilt = build_pk_prompt_resolution(
                game,
                &prompt,
                selected,
                contenders,
                decision_json.clone(),
                resolved_by.clone(),
                next_seq,
            )?;

            events.push(EventInput::new(
                "ResolutionApplied",
                1,
                serde_json::to_value(rebuilt.applied)
                    .map_err(|e| Reject::Internal(e.to_string()))?,
                ActorId::System,
                next_seq + 1,
            ));
            events.push(EventInput::new(
                "ResolutionTrace",
                1,
                serde_json::to_value(rebuilt.trace).map_err(|e| Reject::Internal(e.to_string()))?,
                ActorId::System,
                next_seq + 2,
            ));
        }
        HostPromptEffect::AdvancePhase {
            phase_id,
            reason,
            skipped_phase_id,
        } => {
            events.push(phase_advanced_from_prompt(
                &prompt,
                phase_id,
                reason,
                skipped_phase_id,
                next_seq + 1,
            ));
        }
        HostPromptEffect::AcknowledgeOnly => {}
    }

    persist(pool, game, &events, receipt).await
}

fn host_prompt_effect(
    policies: &[HostPromptResolutionEffectPolicy],
    phase_policy: &domain::pack::PhasePolicy,
    prompt: &projections::HostPromptRow,
    decision: &HostPromptDecision,
    stream: &[eventstore::StoredEvent],
) -> Result<HostPromptEffect, Reject> {
    let policy = policies
        .iter()
        .find(|policy| policy.prompt_kind == prompt.kind && policy.prompt_reason == prompt.reason)
        .ok_or_else(|| {
            Reject::Internal(format!(
                "pack has no host prompt resolution effect for {}:{}",
                prompt.kind, prompt.reason
            ))
        })?;
    match (policy.decision, policy.effect) {
        (HostPromptDecisionKind::SelectSlot, HostPromptResolutionEffect::PkKill) => {
            let selected = match decision {
                HostPromptDecision::SelectSlot { slot } => slot.clone(),
                HostPromptDecision::Acknowledge { .. } => {
                    return Err(Reject::InvalidPromptDecision)
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
        (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AdvanceRevote) => {
            if !matches!(decision, HostPromptDecision::Acknowledge { .. }) {
                return Err(Reject::InvalidPromptDecision);
            }
            let phase_id = next_revote_phase_id(stream, &prompt.phase_id);
            validate_phase_id_for_policy(phase_policy, &phase_id)?;
            Ok(HostPromptEffect::AdvancePhase {
                phase_id,
                reason: "revote",
                skipped_phase_id: None,
            })
        }
        (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::SkipNextDay) => {
            if !matches!(decision, HostPromptDecision::Acknowledge { .. }) {
                return Err(Reject::InvalidPromptDecision);
            }
            let (skipped_phase_id, phase_id) = skip_next_day_target(&prompt.phase_id)?;
            validate_phase_id_for_policy(phase_policy, &skipped_phase_id)?;
            validate_phase_id_for_policy(phase_policy, &phase_id)?;
            Ok(HostPromptEffect::AdvancePhase {
                phase_id,
                reason: "skip_next_day",
                skipped_phase_id: Some(skipped_phase_id),
            })
        }
        (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AcknowledgeOnly) => {
            if !matches!(decision, HostPromptDecision::Acknowledge { .. }) {
                return Err(Reject::InvalidPromptDecision);
            }
            Ok(HostPromptEffect::AcknowledgeOnly)
        }
        _ => Err(Reject::Internal(format!(
            "invalid host prompt resolution effect policy `{}`",
            policy.id
        ))),
    }
}

fn phase_advanced_from_prompt(
    prompt: &projections::HostPromptRow,
    phase_id: String,
    reason: &'static str,
    skipped_phase_id: Option<String>,
    occurred_at: i64,
) -> EventInput {
    let payload = serde_json::to_value(HostPromptPhaseControlPayload {
        phase_id,
        source_prompt_id: prompt.prompt_id.clone(),
        source_phase_id: prompt.phase_id.clone(),
        reason,
        skipped_phase_id,
    })
    .expect("host prompt phase-control payload is serializable");
    EventInput::new("PhaseAdvanced", 1, payload, ActorId::Host, occurred_at)
}

fn next_revote_phase_id(stream: &[eventstore::StoredEvent], source_phase_id: &str) -> String {
    let prefix = format!("{source_phase_id}R");
    let max_existing = stream
        .iter()
        .filter_map(|event| {
            if !matches!(event.kind.as_str(), "GameStarted" | "PhaseAdvanced") {
                return None;
            }
            event
                .payload
                .get("phase_id")
                .and_then(|value| value.as_str())
                .and_then(|phase_id| phase_id.strip_prefix(&prefix))
                .and_then(|suffix| suffix.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("{prefix}{}", max_existing + 1)
}

fn skip_next_day_target(source_phase_id: &str) -> Result<(String, String), Reject> {
    let number = phase_number(source_phase_id)?;
    let skipped_day = format!("D{:02}", number + 1);
    let next_night = format!("N{:02}", number + 1);
    Ok((skipped_day, next_night))
}

fn next_declared_phase_id(
    phase_policy: &domain::pack::PhasePolicy,
    source_phase_id: &str,
) -> Result<String, Reject> {
    let source_kind = phase_kind(source_phase_id).map_err(|_| Reject::InvalidTarget)?;
    let source_number = phase_number(source_phase_id).map_err(|_| Reject::InvalidTarget)?;
    if phase_policy.cadence.is_empty() {
        return Err(Reject::InvalidTarget);
    }
    let source_index = phase_policy
        .cadence
        .iter()
        .position(|kind| *kind == source_kind)
        .ok_or(Reject::InvalidTarget)?;
    let next_index = (source_index + 1) % phase_policy.cadence.len();
    let next_kind = phase_policy.cadence[next_index];
    let next_number = if next_index <= source_index {
        source_number + 1
    } else {
        source_number
    };
    let prefix = match next_kind {
        domain::pack::PhaseKind::Day => "D",
        domain::pack::PhaseKind::Night => "N",
        domain::pack::PhaseKind::Twilight => "T",
    };
    let phase_id = format!("{prefix}{next_number:02}");
    validate_phase_id_for_policy(phase_policy, &phase_id)?;
    Ok(phase_id)
}

fn pack_name_from_stream(stream: &[eventstore::StoredEvent]) -> Result<String, Reject> {
    stream
        .iter()
        .find(|ev| ev.kind == "GameCreated")
        .and_then(|ev| ev.payload["pack"].as_str())
        .map(str::to_string)
        .ok_or_else(|| Reject::Internal("game stream has no GameCreated.pack".to_string()))
}

fn private_channel_declarations(
    pack: &domain::Pack,
    stream: &[eventstore::StoredEvent],
) -> Result<Vec<EventInput>, Reject> {
    if !pack.private_channels.enabled {
        return Ok(Vec::new());
    }
    let assignments = role_assignments_from_stream(stream)?;
    let mut events = Vec::new();
    for group in &pack.private_channels.groups {
        let mut members = assignments
            .iter()
            .filter(|(_, role)| group.roles.iter().any(|allowed| allowed == *role))
            .map(|(slot, role)| {
                serde_json::json!({
                    "slot_id": slot,
                    "role_key": role,
                })
            })
            .collect::<Vec<_>>();
        if members.len() < 2 {
            continue;
        }
        members.sort_by(|a, b| {
            a["slot_id"]
                .as_str()
                .unwrap_or_default()
                .cmp(b["slot_id"].as_str().unwrap_or_default())
        });
        events.push(EventInput::new(
            "PrivateChannelDeclared",
            1,
            serde_json::json!({
                "channel_id": format!("private:{}", group.id),
                "group_id": group.id,
                "kind": &group.kind,
                "roles": &group.roles,
                "members": members,
                "reveals_alignment": &group.reveals_alignment,
                "source": format!("pack.private_channels.{}", group.id),
            }),
            ActorId::Host,
            0,
        ));
    }
    Ok(events)
}

fn role_assignments_from_stream(
    stream: &[eventstore::StoredEvent],
) -> Result<BTreeMap<String, String>, Reject> {
    let mut assignments = BTreeMap::new();
    for event in stream {
        if event.kind == "RoleAssigned" {
            assignments.insert(
                str_payload(event, "slot_id")?,
                str_payload(event, "role_key")?,
            );
        }
    }
    Ok(assignments)
}

fn load_pack(name: &str) -> Result<domain::Pack, Reject> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packs")
        .join(name)
        .join("pack.json");
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| Reject::Internal(format!("read pack {}: {e}", path.display())))?;
    domain::load_pack_from_json(&raw)
        .map_err(|e| Reject::Internal(format!("load pack {name}: {e}")))
}

async fn current_pack_name(pool: &PgPool, game: Uuid) -> Result<String, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    pack_name_from_stream(&stream)
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
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let phase_kind = phase_kind(phase_id)?;
    let phase_number = phase_number(phase_id)?;
    current_snapshot(&stream, &pack, phase_id, phase_kind, phase_number)
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
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let phase_kind = phase_kind(phase_id)?;
    let phase_number = phase_number(phase_id)?;
    let state = current_snapshot(&stream, &pack, phase_id, phase_kind, phase_number)?;
    let submissions = current_submissions(&stream, phase_id);
    let day_phase_inputs = current_day_phase_inputs(&stream, &state, phase_kind, phase_number)?;

    Ok(EnginePhaseInputAudit {
        phase_id: phase_id.to_string(),
        phase_kind,
        phase_number,
        pack_name,
        state,
        submissions,
        day_phase_inputs,
    })
}

/// Audit the UserId/SlotId boundary at the command-to-engine seam.
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
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let phase_kind = phase_kind(phase_id)?;
    let phase_number = phase_number(phase_id)?;
    let snapshot = current_snapshot(&stream, &pack, phase_id, phase_kind, phase_number)?;
    let snapshot_json = serde_json::to_string(&snapshot)
        .map_err(|e| Reject::Internal(format!("serialize engine snapshot: {e}")))?;
    let stream_user_ids = stream_platform_user_ids(&stream);
    let leaked_user_ids = stream_user_ids
        .iter()
        .filter(|user_id| snapshot_json.contains(user_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let snapshot_slot_ids = snapshot
        .slots
        .iter()
        .map(|slot| slot.slot_id.clone())
        .collect::<Vec<_>>();
    let slot_only = leaked_user_ids.is_empty();

    Ok(EngineSnapshotIdentityAudit {
        phase_id: phase_id.to_string(),
        snapshot_slot_ids,
        stream_user_ids,
        leaked_user_ids,
        slot_only,
    })
}

fn stream_platform_user_ids(stream: &[eventstore::StoredEvent]) -> Vec<String> {
    let mut user_ids = BTreeSet::new();
    for ev in stream {
        if let ActorId::User(user_id) = &ev.actor {
            user_ids.insert(user_id.clone());
        }
        collect_platform_user_ids(&ev.payload, &mut user_ids);
        collect_platform_user_ids(&ev.meta, &mut user_ids);
    }
    user_ids.into_iter().collect()
}

fn collect_platform_user_ids(value: &serde_json::Value, user_ids: &mut BTreeSet<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                if matches!(
                    key.as_str(),
                    "host"
                        | "user"
                        | "user_id"
                        | "principal_user_id"
                        | "outgoing_user"
                        | "incoming_user"
                ) {
                    if let Some(user_id) = nested.as_str() {
                        user_ids.insert(user_id.to_string());
                    }
                }
                collect_platform_user_ids(nested, user_ids);
            }
        }
        serde_json::Value::Array(values) => {
            for nested in values {
                collect_platform_user_ids(nested, user_ids);
            }
        }
        _ => {}
    }
}

fn phase_kind(phase_id: &str) -> Result<domain::pack::PhaseKind, Reject> {
    match phase_id.chars().next() {
        Some('D') => Ok(domain::pack::PhaseKind::Day),
        Some('N') => Ok(domain::pack::PhaseKind::Night),
        Some('T') => Ok(domain::pack::PhaseKind::Twilight),
        _ => Err(Reject::Internal(format!("unknown phase id `{phase_id}`"))),
    }
}

fn phase_number(phase_id: &str) -> Result<u32, Reject> {
    let digits: String = phase_id
        .chars()
        .skip(1)
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits
        .parse()
        .map_err(|_| Reject::Internal(format!("phase id `{phase_id}` has no numeric number")))
}

fn validate_pack_phase_id(pack: &domain::Pack, phase_id: &str) -> Result<(), Reject> {
    validate_phase_id_for_policy(&pack.phases, phase_id)
}

fn validate_phase_id_for_policy(
    phase_policy: &domain::pack::PhasePolicy,
    phase_id: &str,
) -> Result<(), Reject> {
    let kind = phase_kind(phase_id).map_err(|_| Reject::InvalidTarget)?;
    let number = phase_number(phase_id).map_err(|_| Reject::InvalidTarget)?;
    if number == 0 {
        return Err(Reject::InvalidTarget);
    }
    if !phase_policy.cadence.contains(&kind) {
        return Err(Reject::InvalidTarget);
    }
    if kind == domain::pack::PhaseKind::Twilight && !phase_policy.twilight {
        return Err(Reject::InvalidTarget);
    }
    Ok(())
}

fn current_snapshot(
    stream: &[eventstore::StoredEvent],
    pack: &domain::Pack,
    phase_id: &str,
    phase_kind: domain::pack::PhaseKind,
    phase_number: u32,
) -> Result<domain::StateSnapshot, Reject> {
    let phase_policy = pack.phases.clone();
    let phase_deadline = current_phase_deadline(stream, phase_id);
    let mut slots: BTreeMap<String, domain::SlotState> = BTreeMap::new();
    let mut private_channels = Vec::new();
    let mut effect_records = Vec::new();
    let mut action_history = Vec::new();
    let mut use_counters = Vec::new();
    let mut investigation_memory = Vec::new();
    let mut delayed_deaths = Vec::new();
    let mut action_grants = Vec::new();
    let mut conversion_origins = Vec::new();
    let mut linked_slots = Vec::new();
    let mut retaliations = Vec::new();
    let mut backup_targets = Vec::new();
    let mut target_lynch_win_targets = Vec::new();
    let mut wolf_carry_tokens = Vec::new();
    let mut wolf_beauty_marks = Vec::new();
    let mut badges = Vec::new();
    let mut visit_history = Vec::new();

    for ev in stream {
        match ev.kind.as_str() {
            "SlotAdded" => {
                let slot_id = str_payload(ev, "slot_id")?;
                slots.entry(slot_id.clone()).or_insert(domain::SlotState {
                    slot_id,
                    role_key: String::new(),
                    alignment: None,
                    role_reveal: domain::RevealState::Private,
                    alignment_reveal: domain::RevealState::Private,
                    status: domain::SlotLifecycle::Alive,
                    status_tags: Vec::new(),
                    effects: Vec::new(),
                });
            }
            "RoleAssigned" => {
                let slot_id = str_payload(ev, "slot_id")?;
                let role_key = str_payload(ev, "role_key")?;
                let role = pack.roles.get(&role_key).ok_or_else(|| {
                    Reject::Internal(format!(
                        "role `{role_key}` is missing from pack {}",
                        pack.name
                    ))
                })?;
                let slot = slots.entry(slot_id.clone()).or_insert(domain::SlotState {
                    slot_id: slot_id.clone(),
                    role_key: String::new(),
                    alignment: None,
                    role_reveal: domain::RevealState::Private,
                    alignment_reveal: domain::RevealState::Private,
                    status: domain::SlotLifecycle::Alive,
                    status_tags: Vec::new(),
                    effects: Vec::new(),
                });
                slot.role_key = role_key.clone();
                slot.alignment = role.alignment.clone();
                for effect in &role.effects {
                    if !slot.effects.contains(effect) {
                        slot.effects.push(effect.clone());
                    }
                    effect_records.retain(|record: &domain::EffectRecord| {
                        record.effect != *effect || record.target != slot_id
                    });
                    effect_records.push(domain::EffectRecord {
                        effect: effect.clone(),
                        target: slot_id.clone(),
                        source: slot_id.clone(),
                        source_action: Some(format!("role:{role_key}")),
                        phase_id: None,
                        phase_kind: None,
                        phase_number: None,
                        duration: domain::EffectDuration::Persistent,
                        visibility: domain::EffectVisibility::Hidden,
                    });
                }
            }
            "ResolutionApplied" => {
                let applied = domain::validate_resolution_json(&ev.payload, domain::RESULT_VERSION)
                    .map_err(|e| Reject::Internal(format!("malformed ResolutionApplied: {e}")))?;
                let snapshot = domain::StateSnapshot {
                    phase_id: phase_id.to_string(),
                    phase_kind,
                    phase_number,
                    phase_deadline,
                    phase_policy: phase_policy.clone(),
                    slots: slots.values().cloned().collect(),
                    private_channels: private_channels.clone(),
                    effect_records: effect_records.clone(),
                    action_history: action_history.clone(),
                    use_counters: use_counters.clone(),
                    investigation_memory: investigation_memory.clone(),
                    delayed_deaths: delayed_deaths.clone(),
                    visit_history: visit_history.clone(),
                    action_grants: action_grants.clone(),
                    conversion_origins: conversion_origins.clone(),
                    linked_slots: linked_slots.clone(),
                    retaliations: retaliations.clone(),
                    backup_targets: backup_targets.clone(),
                    target_lynch_win_targets: target_lynch_win_targets.clone(),
                    wolf_carry_tokens: wolf_carry_tokens.clone(),
                    wolf_beauty_marks: wolf_beauty_marks.clone(),
                    badges: badges.clone(),
                };
                let folded = domain::apply_events(
                    &snapshot,
                    &applied
                        .events
                        .into_iter()
                        .map(|indexed| indexed.event)
                        .collect::<Vec<_>>(),
                );
                effect_records = folded.effect_records;
                action_history = folded.action_history;
                use_counters = folded.use_counters;
                investigation_memory = folded.investigation_memory;
                delayed_deaths = folded.delayed_deaths;
                visit_history = folded.visit_history;
                action_grants = folded.action_grants;
                conversion_origins = folded.conversion_origins;
                linked_slots = folded.linked_slots;
                retaliations = folded.retaliations;
                backup_targets = folded.backup_targets;
                target_lynch_win_targets = folded.target_lynch_win_targets;
                wolf_carry_tokens = folded.wolf_carry_tokens;
                wolf_beauty_marks = folded.wolf_beauty_marks;
                badges = folded.badges;
                slots = folded
                    .slots
                    .into_iter()
                    .map(|slot| (slot.slot_id.clone(), slot))
                    .collect();
                private_channels = folded.private_channels;
            }
            "PrivateChannelDeclared" => {
                let channel_id = str_payload(ev, "channel_id")?;
                let kind = str_payload(ev, "kind")?;
                let reveals_alignment = str_payload(ev, "reveals_alignment")?;
                let source = str_payload(ev, "source")?;
                let Some(members) = ev.payload["members"].as_array() else {
                    return Err(Reject::Internal(format!(
                        "event {}#{} missing private channel members",
                        ev.kind, ev.stream_seq
                    )));
                };
                private_channels.retain(|record: &domain::PrivateChannelRecord| {
                    record.channel_id != channel_id
                });
                for member in members {
                    let Some(slot_id) = member.get("slot_id").and_then(|value| value.as_str())
                    else {
                        return Err(Reject::Internal(format!(
                            "event {}#{} has private channel member without slot_id",
                            ev.kind, ev.stream_seq
                        )));
                    };
                    let Some(role_key) = member.get("role_key").and_then(|value| value.as_str())
                    else {
                        return Err(Reject::Internal(format!(
                            "event {}#{} has private channel member without role_key",
                            ev.kind, ev.stream_seq
                        )));
                    };
                    private_channels.push(domain::PrivateChannelRecord {
                        channel_id: channel_id.clone(),
                        kind: kind.clone(),
                        slot_id: slot_id.to_string(),
                        role_key: role_key.to_string(),
                        reveals_alignment: reveals_alignment.clone(),
                        source: source.clone(),
                    });
                }
            }
            "EffectsMarked" => {
                let effect = str_payload(ev, "effect")?;
                let target = str_payload(ev, "target")?;
                let actor = str_payload(ev, "actor")?;
                let source_action = optional_str_payload(ev, "source_action");
                let marked_phase_id = optional_str_payload(ev, "phase_id");
                let marked_phase_kind =
                    optional_payload_enum::<domain::pack::PhaseKind>(ev, "phase_kind")?;
                let marked_phase_number = optional_u32_payload(ev, "phase_number")?;
                let duration = payload_enum_or_default::<domain::EffectDuration>(ev, "duration")?;
                let visibility =
                    payload_enum_or_default::<domain::EffectVisibility>(ev, "visibility")?;
                let slot = slots.entry(target.clone()).or_insert(domain::SlotState {
                    slot_id: target.clone(),
                    role_key: String::new(),
                    alignment: None,
                    role_reveal: domain::RevealState::Private,
                    alignment_reveal: domain::RevealState::Private,
                    status: domain::SlotLifecycle::Alive,
                    status_tags: Vec::new(),
                    effects: Vec::new(),
                });
                if !slot.effects.contains(&effect) {
                    slot.effects.push(effect.clone());
                }
                effect_records.retain(|record| record.effect != effect || record.target != target);
                effect_records.push(domain::EffectRecord {
                    effect,
                    target,
                    source: actor,
                    source_action,
                    phase_id: marked_phase_id,
                    phase_kind: marked_phase_kind,
                    phase_number: marked_phase_number,
                    duration,
                    visibility,
                });
            }
            "EffectsCleared" => {
                let effect = str_payload(ev, "effect")?;
                let targets = string_array_payload(ev, "targets")?;
                for target in &targets {
                    if let Some(slot) = slots.get_mut(target) {
                        slot.effects.retain(|existing| existing != &effect);
                    }
                }
                effect_records.retain(|record| {
                    record.effect != effect
                        || !targets.iter().any(|target| target == &record.target)
                });
            }
            "SlotStatusChanged" => {
                let slot_id = str_payload(ev, "slot_id")?;
                let status = slot_lifecycle_payload(ev, "status")?;
                let slot = slots.entry(slot_id.clone()).or_insert(domain::SlotState {
                    slot_id,
                    role_key: String::new(),
                    alignment: None,
                    role_reveal: domain::RevealState::Private,
                    alignment_reveal: domain::RevealState::Private,
                    status: domain::SlotLifecycle::Alive,
                    status_tags: Vec::new(),
                    effects: Vec::new(),
                });
                slot.status = status;
            }
            "GameCompleted" => {
                for slot in slots.values_mut() {
                    slot.role_reveal = domain::RevealState::Public;
                    slot.alignment_reveal = domain::RevealState::Public;
                }
            }
            "SlotStatusTagged" => {
                let slot_id = str_payload(ev, "slot_id")?;
                let tag = str_payload(ev, "tag")?;
                let slot = slots.entry(slot_id.clone()).or_insert(domain::SlotState {
                    slot_id,
                    role_key: String::new(),
                    alignment: None,
                    role_reveal: domain::RevealState::Private,
                    alignment_reveal: domain::RevealState::Private,
                    status: domain::SlotLifecycle::Alive,
                    status_tags: Vec::new(),
                    effects: Vec::new(),
                });
                if !slot.status_tags.contains(&tag) {
                    slot.status_tags.push(tag);
                    slot.status_tags.sort();
                }
            }
            "SlotStatusUntagged" => {
                let slot_id = str_payload(ev, "slot_id")?;
                let tag = str_payload(ev, "tag")?;
                if let Some(slot) = slots.get_mut(&slot_id) {
                    slot.status_tags.retain(|existing| existing != &tag);
                }
            }
            _ => {}
        }
    }

    let unassigned: Vec<_> = slots
        .values()
        .filter(|slot| slot.role_key.is_empty())
        .map(|slot| slot.slot_id.clone())
        .collect();
    if !unassigned.is_empty() {
        return Err(Reject::Internal(format!(
            "cannot resolve {phase_id}; slots without roles: {}",
            unassigned.join(", ")
        )));
    }

    let mut slots = slots.into_values().collect::<Vec<_>>();
    for slot in &mut slots {
        refresh_pack_visible_status_tags(pack, slot);
    }

    Ok(domain::StateSnapshot {
        phase_id: phase_id.to_string(),
        phase_kind,
        phase_number,
        phase_deadline,
        phase_policy,
        slots,
        private_channels,
        effect_records,
        action_history,
        use_counters,
        investigation_memory,
        delayed_deaths,
        visit_history,
        action_grants,
        conversion_origins,
        linked_slots,
        retaliations,
        backup_targets,
        target_lynch_win_targets,
        wolf_carry_tokens,
        wolf_beauty_marks,
        badges,
    })
}

fn refresh_pack_visible_status_tags(pack: &domain::Pack, slot: &mut domain::SlotState) {
    let mut tags = slot.status_tags.iter().cloned().collect::<BTreeSet<_>>();
    if let domain::pack::WeightPolicy::PerRole(weights) = &pack.vote.weights {
        if let Some(weight) = weights.get(&slot.role_key) {
            if (*weight - 0.0).abs() < f64::EPSILON {
                tags.insert(format!("limited_vote:{}", slot.role_key));
            } else if (*weight - 1.0).abs() > f64::EPSILON {
                tags.insert(format!("vote_weight:{}", slot.role_key));
            }
        }
    }
    if pack.vote.threshold_adjustments.contains_key(&slot.role_key) {
        tags.insert(format!("vote_threshold:{}", slot.role_key));
    }
    if pack.idiot_policy.enabled
        && slot
            .effects
            .iter()
            .any(|effect| effect == &pack.idiot_policy.vote_loss_effect)
    {
        tags.insert(format!(
            "limited_vote:{}",
            pack.idiot_policy.vote_loss_effect
        ));
    }
    slot.status_tags = tags.into_iter().collect();
}

fn current_phase_deadline(stream: &[eventstore::StoredEvent], phase_id: &str) -> Option<i64> {
    stream
        .iter()
        .filter(|ev| matches!(ev.kind.as_str(), "DeadlineSet" | "DeadlineExtended"))
        .filter(|ev| ev.payload["phase_id"].as_str() == Some(phase_id))
        .filter_map(|ev| ev.payload["at"].as_i64())
        .last()
}

fn current_submissions(
    stream: &[eventstore::StoredEvent],
    phase_id: &str,
) -> Vec<domain::Submission> {
    let mut submissions = Vec::new();

    for ev in stream {
        match ev.kind.as_str() {
            "VoteSubmitted" if ev.payload["phase_id"].as_str() == Some(phase_id) => {
                if let (Some(actor), Some(target)) =
                    (ev.payload["actor"].as_str(), ev.payload["target"].as_str())
                {
                    submissions.push(domain::Submission {
                        action_id: format!("vote:{}:{actor}", ev.stream_seq),
                        actor: actor.to_string(),
                        template_id: "day_vote".to_string(),
                        targets: vec![target.to_string()],
                        phase_id: phase_id.to_string(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: false,
                        metadata: metadata_from_payload(&ev.payload),
                    });
                }
            }
            "VoteWithdrawn" if ev.payload["phase_id"].as_str() == Some(phase_id) => {
                if let Some(actor) = ev.payload["actor"].as_str() {
                    submissions.push(domain::Submission {
                        action_id: format!("vote:{}:{actor}", ev.stream_seq),
                        actor: actor.to_string(),
                        template_id: "day_vote".to_string(),
                        targets: Vec::new(),
                        phase_id: phase_id.to_string(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: true,
                        metadata: BTreeMap::new(),
                    });
                }
            }
            "ActionSubmitted" if ev.payload["phase_id"].as_str() == Some(phase_id) => {
                if ev.payload["instant_resolved"].as_bool().unwrap_or(false) {
                    continue;
                }
                if let (Some(action_id), Some(template_id), Some(actor)) = (
                    ev.payload["action_id"].as_str(),
                    ev.payload["template_id"].as_str(),
                    ev.payload["actor"].as_str(),
                ) {
                    submissions.push(domain::Submission {
                        action_id: action_id.to_string(),
                        actor: actor.to_string(),
                        template_id: template_id.to_string(),
                        targets: ev.payload["targets"]
                            .as_array()
                            .map(|targets| {
                                targets
                                    .iter()
                                    .filter_map(|target| target.as_str().map(str::to_string))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        phase_id: phase_id.to_string(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: false,
                        metadata: metadata_from_payload(&ev.payload),
                    });
                }
            }
            "ActionWithdrawn" => {
                let applies_to_phase = ev.payload["phase_id"]
                    .as_str()
                    .map(|withdraw_phase| withdraw_phase == phase_id)
                    .unwrap_or(true);
                let actor = ev.payload["actor"].as_str();
                if applies_to_phase {
                    if let Some(action_id) = ev.payload["action_id"].as_str() {
                        for submission in &mut submissions {
                            if submission.action_id == action_id
                                && actor
                                    .map(|withdraw_actor| withdraw_actor == submission.actor)
                                    .unwrap_or(true)
                            {
                                submission.withdrawn = true;
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    submissions
}

fn metadata_from_payload(payload: &serde_json::Value) -> BTreeMap<String, serde_json::Value> {
    let mut metadata: BTreeMap<String, serde_json::Value> = payload["metadata"]
        .as_object()
        .map(|metadata| {
            metadata
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default();
    if let Some(grant_id) = payload["grant_id"].as_str() {
        metadata.insert(
            "grant_id".to_string(),
            serde_json::Value::String(grant_id.to_string()),
        );
    }
    metadata
}

fn current_day_phase_inputs(
    stream: &[eventstore::StoredEvent],
    state: &domain::StateSnapshot,
    phase_kind: domain::pack::PhaseKind,
    phase_number: u32,
) -> Result<domain::DayPhaseInputs, Reject> {
    if phase_kind != domain::pack::PhaseKind::Day || phase_number == 0 {
        return Ok(domain::DayPhaseInputs::default());
    }

    let mut night_victims = Vec::new();
    for ev in stream {
        if ev.kind != "ResolutionApplied" {
            continue;
        }
        let applied = domain::validate_resolution_json(&ev.payload, domain::RESULT_VERSION)
            .map_err(|e| Reject::Internal(format!("malformed ResolutionApplied: {e}")))?;
        if applied.phase_kind != domain::pack::PhaseKind::Night
            || applied.phase_number.saturating_add(1) != phase_number
        {
            continue;
        }

        for indexed in applied.events {
            if let domain::InnerEvent::PlayerKilled {
                slot_id,
                cause,
                attackers,
                unstoppable,
                ..
            } = indexed.event
            {
                let role_key = state
                    .slots
                    .iter()
                    .find(|slot| slot.slot_id == slot_id)
                    .map(|slot| slot.role_key.clone())
                    .filter(|role_key| !role_key.is_empty());
                night_victims.push(domain::DayAnnouncementInput {
                    player_id: slot_id,
                    cause,
                    source_action_id: None,
                    attackers,
                    unstoppable,
                    role_key,
                    recorded_at: Some(ev.stream_seq as u64),
                });
            }
        }
    }

    Ok(domain::DayPhaseInputs { night_victims })
}

fn str_payload(ev: &eventstore::StoredEvent, key: &str) -> Result<String, Reject> {
    ev.payload[key].as_str().map(str::to_string).ok_or_else(|| {
        Reject::Internal(format!(
            "event {}#{} missing string payload `{key}`",
            ev.kind, ev.stream_seq
        ))
    })
}

fn optional_str_payload(ev: &eventstore::StoredEvent, key: &str) -> Option<String> {
    ev.payload
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
}

fn optional_u32_payload(ev: &eventstore::StoredEvent, key: &str) -> Result<Option<u32>, Reject> {
    let Some(value) = ev.payload.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let Some(number) = value.as_u64() else {
        return Err(Reject::Internal(format!(
            "event {}#{} has non-u32 payload `{key}`",
            ev.kind, ev.stream_seq
        )));
    };
    u32::try_from(number).map(Some).map_err(|_| {
        Reject::Internal(format!(
            "event {}#{} has out-of-range u32 payload `{key}`",
            ev.kind, ev.stream_seq
        ))
    })
}

fn string_array_payload(ev: &eventstore::StoredEvent, key: &str) -> Result<Vec<String>, Reject> {
    let Some(values) = ev.payload[key].as_array() else {
        return Err(Reject::Internal(format!(
            "event {}#{} missing string-array payload `{key}`",
            ev.kind, ev.stream_seq
        )));
    };
    values
        .iter()
        .map(|value| {
            value.as_str().map(str::to_string).ok_or_else(|| {
                Reject::Internal(format!(
                    "event {}#{} has non-string entry in `{key}`",
                    ev.kind, ev.stream_seq
                ))
            })
        })
        .collect()
}

fn optional_payload_enum<T>(ev: &eventstore::StoredEvent, key: &str) -> Result<Option<T>, Reject>
where
    T: serde::de::DeserializeOwned,
{
    let Some(value) = ev.payload.get(key) else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    serde_json::from_value(value.clone())
        .map(Some)
        .map_err(|err| {
            Reject::Internal(format!(
                "event {}#{} has malformed enum payload `{key}`: {err}",
                ev.kind, ev.stream_seq
            ))
        })
}

fn payload_enum_or_default<T>(ev: &eventstore::StoredEvent, key: &str) -> Result<T, Reject>
where
    T: serde::de::DeserializeOwned + Default,
{
    Ok(optional_payload_enum(ev, key)?.unwrap_or_default())
}

fn slot_lifecycle_payload(
    ev: &eventstore::StoredEvent,
    key: &str,
) -> Result<domain::SlotLifecycle, Reject> {
    match ev.payload[key].as_str() {
        Some("alive") => Ok(domain::SlotLifecycle::Alive),
        Some("dead") => Ok(domain::SlotLifecycle::Dead),
        Some("modkilled") => Ok(domain::SlotLifecycle::Modkilled),
        Some(other) => Err(Reject::Internal(format!(
            "event {}#{} has unknown slot lifecycle `{other}`",
            ev.kind, ev.stream_seq
        ))),
        None => Err(Reject::Internal(format!(
            "event {}#{} missing string payload `{key}`",
            ev.kind, ev.stream_seq
        ))),
    }
}

// ───────────────────────── shared validation helpers ─────────────────────────

/// Reject if the game does not exist (no `GameCreated` yet).
async fn require_game(pool: &PgPool, game: Uuid) -> Result<(), Reject> {
    if projections::game_exists(pool, game).await? {
        Ok(())
    } else {
        Err(Reject::UnknownGame)
    }
}

/// Least-authority gate: require `cap`, mapping a miss to `deny`.
fn require(caps: &CapabilitySet, cap: &Capability, deny: Reject) -> Result<(), Reject> {
    if caps.grants(cap) {
        Ok(())
    } else {
        Err(deny)
    }
}

/// The principal must be the slot's CURRENT occupant. We distinguish "this slot
/// isn't yours" (`NotYourSlot`) from "no such slot" (`UnknownSlot`): if the slot
/// exists but the capability is absent it is `NotYourSlot`.
async fn require_slot_occupant(
    pool: &PgPool,
    game: Uuid,
    slot: &str,
    caps: &CapabilitySet,
) -> Result<(), Reject> {
    if !projections::slot_exists(pool, game, slot).await? {
        return Err(Reject::UnknownSlot);
    }
    if caps.grants(&Capability::SlotOccupant(slot.to_string())) {
        Ok(())
    } else {
        Err(Reject::NotYourSlot)
    }
}

/// The current phase must exist and be UNLOCKED. Returns the phase id.
async fn require_open_phase(pool: &PgPool, game: Uuid) -> Result<String, Reject> {
    match projections::phase_state(pool, game).await? {
        Some(ps) if ps.locked => Err(Reject::PhaseLocked),
        Some(ps) => {
            if phase_has_pending_prompt(pool, game, &ps.phase_id).await? {
                Err(Reject::PhaseLocked)
            } else {
                Ok(ps.phase_id)
            }
        }
        None => Err(Reject::PhaseLocked), // no phase open → cannot act
    }
}

async fn phase_has_pending_prompt(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
) -> Result<bool, Reject> {
    Ok(projections::host_prompts(pool, game)
        .await?
        .into_iter()
        .any(|prompt| prompt.phase_id == phase_id && prompt.status == "pending"))
}

/// Votes are legal only while the current open phase is a Day window.
async fn require_open_day_phase(pool: &PgPool, game: Uuid) -> Result<String, Reject> {
    let phase = require_open_phase(pool, game).await?;
    if phase_kind(&phase)? != domain::pack::PhaseKind::Day {
        return Err(Reject::PhaseLocked);
    }
    Ok(phase)
}

/// The current phase id, if any (no lock check — for post attribution).
async fn current_phase(pool: &PgPool, game: Uuid) -> Result<Option<String>, Reject> {
    Ok(projections::phase_state(pool, game)
        .await?
        .map(|p| p.phase_id))
}

async fn require_slot_alive(pool: &PgPool, game: Uuid, slot: &str) -> Result<(), Reject> {
    match projections::slot_alive(pool, game, slot).await? {
        Some(true) => Ok(()),
        Some(false) => Err(Reject::SlotNotAlive),
        None => Err(Reject::UnknownSlot),
    }
}

async fn require_slot_can_post(pool: &PgPool, game: Uuid, slot: &str) -> Result<(), Reject> {
    match projections::slot_alive(pool, game, slot).await? {
        Some(true) => Ok(()),
        Some(false) => {
            let pack = load_pack(&current_pack_name(pool, game).await?)?;
            if !pack.treestump_policy.enabled {
                return Err(Reject::SlotNotAlive);
            }
            let tags = projections::slot_status_tags(pool, game, slot).await?;
            if tags
                .iter()
                .any(|tag| tag == &pack.treestump_policy.status_tag)
            {
                Ok(())
            } else {
                Err(Reject::SlotNotAlive)
            }
        }
        None => Err(Reject::UnknownSlot),
    }
}

async fn validate_action_submission(
    pool: &PgPool,
    game: Uuid,
    pack: &domain::Pack,
    phase_id: &str,
    actor_slot: &str,
    template_id: &str,
    targets: &[String],
    grant_id: Option<&str>,
) -> Result<Window, Reject> {
    let phase_kind = phase_kind(phase_id)?;
    let phase_number = phase_number(phase_id)?;
    let slots = projections::slot_state(pool, game).await?;
    let actor = slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .cloned()
        .ok_or(Reject::UnknownSlot)?;
    let role_key = actor.role_key.as_deref().ok_or(Reject::InvalidTarget)?;
    let role = pack.roles.get(role_key).ok_or_else(|| {
        Reject::Internal(format!(
            "role `{role_key}` is missing from pack {}",
            pack.name
        ))
    })?;
    let (template, source) = submission_template(pack, role, template_id, grant_id)?;
    let uses_grant_option = matches!(source, ActionSource::Role)
        && template.has_ability(IrAbility::Grant)
        && !template.grant_options.is_empty();
    if uses_grant_option
        && grant_id
            .and_then(|id| selected_grant_option(template, id))
            .is_none()
    {
        return Err(Reject::InvalidTarget);
    }

    let window_matches = template.window.matches_phase_kind(phase_kind);
    if !window_matches {
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
        TargetSpec::None if !targets.is_empty() => return Err(Reject::InvalidTarget),
        TargetSpec::One if targets.len() != 1 => return Err(Reject::InvalidTarget),
        TargetSpec::Many | TargetSpec::Group
            if targets.is_empty() || targets.len() > template.constraints.max_targets as usize =>
        {
            return Err(Reject::InvalidTarget)
        }
        _ => {}
    }
    if template.ability == IrAbility::Link && targets.len() < 2 {
        return Err(Reject::InvalidTarget);
    }
    if !template.constraints.self_allowed && targets.iter().any(|target| target == actor_slot) {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.personal_only && targets.iter().any(|target| target != actor_slot) {
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
        let unique: std::collections::BTreeSet<&str> = targets.iter().map(String::as_str).collect();
        if unique.len() != targets.len() {
            return Err(Reject::InvalidTarget);
        }
    }
    if target_role_filter_rejected(pack, template, targets, &slots) {
        return Err(Reject::InvalidTarget);
    }
    if template.constraints.x_shots == Some(1) {
        let counter_id = action_counter_id(&template.id);
        let exhausted = projections::action_counters(pool, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == actor_slot
                    && counter.counter_id == counter_id
                    && counter.remaining == 0
            });
        if exhausted {
            return Err(Reject::InvalidTarget);
        }
    }
    if let Some(cooldown_cycles) = template.constraints.cooldown_cycles {
        let counter_id = cooldown_counter_id(&template.id);
        let on_cooldown = projections::action_counters(pool, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == actor_slot
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
            let exhausted = projections::action_counters(pool, game)
                .await?
                .iter()
                .any(|counter| {
                    counter.slot_id == actor_slot
                        && counter.counter_id == counter_id
                        && counter.remaining == 0
                });
            if exhausted {
                return Err(Reject::InvalidTarget);
            }
        }
    }
    if source == ActionSource::ItemGrant {
        let grant_id = grant_id.ok_or(Reject::InvalidTarget)?;
        let counter_id = inventory_counter_id(grant_id);
        let exhausted = projections::action_counters(pool, game)
            .await?
            .iter()
            .any(|counter| {
                counter.slot_id == actor_slot
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
        let repeated = projections::action_history(pool, game)
            .await?
            .iter()
            .any(|record| {
                let in_scope = if template.has_modifier(Modifier::Roaming) {
                    record.phase_kind == "Night"
                } else {
                    record.phase_kind == "Night" && record.phase_number + 1 == phase_number as i32
                };
                record.slot_id == actor_slot
                    && record.template_id == template.id
                    && in_scope
                    && record.status == "resolved"
                    && targets.iter().any(|target| record.targets.contains(target))
            });
        if repeated {
            return Err(Reject::InvalidTarget);
        }
    }
    validate_action_slot_capacity(
        pool,
        game,
        phase_id,
        phase_number,
        actor_slot,
        template_id,
        template,
        grant_id,
        source,
    )
    .await?;
    let target_state = template
        .constraints
        .target_state
        .unwrap_or(TargetState::Alive);
    for target in targets {
        let alive = projections::slot_alive(pool, game, target)
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
            .standard_nar
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
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    phase_number: u32,
    actor_slot: &str,
    template_id: &str,
    template: &ActionTemplate,
    grant_id: Option<&str>,
    source: ActionSource,
) -> Result<(), Reject> {
    let active = active_actions_for_actor_phase(pool, game, phase_id, actor_slot).await?;
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
                return Err(Reject::InvalidTarget);
            }
        }
        (ActionSource::Role, None) => {
            let base_already_active = active
                .values()
                .any(|action| action.grant_id.is_none() && action.template_id == template_id);
            if base_already_active && !template.has_modifier(Modifier::Simultaneous) {
                return Err(Reject::InvalidTarget);
            }
        }
        (ActionSource::Role, Some(grant_id)) | (ActionSource::ItemGrant, Some(grant_id)) => {
            let required_kind = match source {
                ActionSource::Role => GrantKind::ExtraAction,
                ActionSource::ItemGrant => GrantKind::Item,
            };
            let granted_uses = projections::action_grants(pool, game)
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

async fn active_actions_for_actor_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<BTreeMap<String, ActiveAction>, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut active = BTreeMap::new();
    for ev in stream {
        match ev.kind.as_str() {
            "ActionSubmitted"
                if ev.payload["phase_id"].as_str() == Some(phase_id)
                    && ev.payload["actor"].as_str() == Some(actor_slot) =>
            {
                if let (Some(action_id), Some(template_id)) = (
                    ev.payload["action_id"].as_str(),
                    ev.payload["template_id"].as_str(),
                ) {
                    active.insert(
                        action_id.to_string(),
                        ActiveAction {
                            template_id: template_id.to_string(),
                            grant_id: ev.payload["grant_id"].as_str().map(str::to_string),
                        },
                    );
                }
            }
            "ActionWithdrawn"
                if ev
                    .payload
                    .get("phase_id")
                    .and_then(|value| value.as_str())
                    .map(|withdraw_phase| withdraw_phase == phase_id)
                    .unwrap_or(true)
                    && ev
                        .payload
                        .get("actor")
                        .and_then(|value| value.as_str())
                        .map(|withdraw_actor| withdraw_actor == actor_slot)
                        .unwrap_or(true) =>
            {
                if let Some(action_id) = ev.payload["action_id"].as_str() {
                    active.remove(action_id);
                }
            }
            _ => {}
        }
    }
    Ok(active)
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

async fn active_action_exists(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
    action_id: &str,
) -> Result<bool, Reject> {
    let stream = eventstore::load_stream(pool, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut active = false;
    for ev in stream {
        match ev.kind.as_str() {
            "ActionSubmitted"
                if ev.payload["phase_id"].as_str() == Some(phase_id)
                    && ev.payload["actor"].as_str() == Some(actor_slot)
                    && ev.payload["action_id"].as_str() == Some(action_id) =>
            {
                active = !ev.payload["instant_resolved"].as_bool().unwrap_or(false);
            }
            "ActionWithdrawn"
                if ev.payload["action_id"].as_str() == Some(action_id)
                    && ev
                        .payload
                        .get("actor")
                        .and_then(|value| value.as_str())
                        .map(|withdraw_actor| withdraw_actor == actor_slot)
                        .unwrap_or(true)
                    && ev
                        .payload
                        .get("phase_id")
                        .and_then(|value| value.as_str())
                        .map(|withdraw_phase| withdraw_phase == phase_id)
                        .unwrap_or(true) =>
            {
                active = false;
            }
            _ => {}
        }
    }
    Ok(active)
}

/// A vote target is `no_lynch` or a slot that exists in this game.
async fn validate_target(pool: &PgPool, game: Uuid, target: &VoteTarget) -> Result<String, Reject> {
    match target {
        VoteTarget::NoLynch => Ok("no_lynch".to_string()),
        VoteTarget::Slot(s) => {
            if projections::slot_exists(pool, game, s).await? {
                Ok(s.clone())
            } else {
                Err(Reject::InvalidTarget)
            }
        }
    }
}

fn validate_vote_actor_policy(
    pack: &domain::Pack,
    state: &domain::StateSnapshot,
    actor_slot: &str,
) -> Result<(), Reject> {
    let slot = state
        .slots
        .iter()
        .find(|slot| slot.slot_id == actor_slot)
        .ok_or(Reject::UnknownSlot)?;
    if pack.idiot_policy.enabled
        && slot
            .effects
            .iter()
            .any(|effect| effect == &pack.idiot_policy.vote_loss_effect)
    {
        return Err(Reject::VoteNotAllowed);
    }
    Ok(())
}

fn validate_vote_policy_target(
    policy: &domain::pack::VotePolicy,
    actor_slot: &str,
    target: &VoteTarget,
) -> Result<(), Reject> {
    match target {
        VoteTarget::NoLynch if !policy.no_lynch_allowed => Err(Reject::InvalidTarget),
        VoteTarget::Slot(target_slot) if target_slot == actor_slot && !policy.self_vote_allowed => {
            Err(Reject::InvalidTarget)
        }
        _ => Ok(()),
    }
}

fn hammer_lock_event(
    stream: &[eventstore::StoredEvent],
    game: Uuid,
    phase_id: &str,
    pack: &domain::Pack,
    actor_slot: &str,
    target: &str,
) -> Result<Option<EventInput>, Reject> {
    if !pack.vote.hammer {
        return Ok(None);
    }

    let phase_kind = phase_kind(phase_id)?;
    if phase_kind != domain::pack::PhaseKind::Day {
        return Ok(None);
    }
    let phase_number = phase_number(phase_id)?;
    let state = current_snapshot(stream, pack, phase_id, phase_kind, phase_number)?;
    let mut submissions = current_submissions(stream, phase_id);
    let next_seq = stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);
    submissions.push(domain::Submission {
        action_id: format!("vote:{next_seq}:{actor_slot}"),
        actor: actor_slot.to_string(),
        template_id: "day_vote".to_string(),
        targets: vec![target.to_string()],
        phase_id: phase_id.to_string(),
        submitted_at: next_seq as u64,
        withdrawn: false,
        metadata: BTreeMap::new(),
    });
    let day_phase_inputs = current_day_phase_inputs(stream, &state, phase_kind, phase_number)?;
    let output = domain::resolve(domain::ResolutionInput {
        game_id: game.to_string(),
        phase_id: phase_id.to_string(),
        run_id: format!("hammer:{game}:{phase_id}:{next_seq}"),
        state,
        submissions,
        day_phase_inputs,
        pack: pack.clone(),
        seed: next_seq as u64,
        logical_time: next_seq as u64,
    });
    let hammers = output.applied.events.iter().any(|event| {
        matches!(
            &event.event,
            domain::InnerEvent::DayVoteOutcome(outcome)
                if matches!(
                    outcome.status,
                    domain::VoteStatus::Hammer
                        | domain::VoteStatus::Lynch
                        | domain::VoteStatus::NoLynch
                )
        )
    });

    Ok(hammers.then(|| {
        EventInput::new(
            "ThreadLocked",
            1,
            serde_json::json!({
                "channel_id": "main",
                "phase_id": phase_id,
                "reason": "hammer",
                "source": "vote_hammer",
                "actor": actor_slot,
                "target": target
            }),
            ActorId::System,
            next_seq,
        )
    }))
}

async fn load_receipt(pool: &PgPool, receipt: &ReceiptClaim) -> Result<Option<Ack>, Reject> {
    let row = sqlx::query(
        "SELECT stream_seqs FROM command_receipt \
         WHERE principal_user_id = $1 AND command_id = $2",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    Ok(row.map(|row| Ack {
        stream_seqs: row.get("stream_seqs"),
    }))
}

async fn claim_receipt_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game: Uuid,
    receipt: &ReceiptClaim,
) -> Result<bool, Reject> {
    let result = sqlx::query(
        "INSERT INTO command_receipt \
         (principal_user_id, command_id, stream_id, stream_seqs) \
         VALUES ($1, $2, $3, ARRAY[]::BIGINT[]) \
         ON CONFLICT (principal_user_id, command_id) DO NOTHING",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .bind(game)
    .execute(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    Ok(result.rows_affected() == 1)
}

async fn load_receipt_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &ReceiptClaim,
) -> Result<Ack, Reject> {
    let row = sqlx::query(
        "SELECT stream_seqs FROM command_receipt \
         WHERE principal_user_id = $1 AND command_id = $2",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    Ok(Ack {
        stream_seqs: row.get("stream_seqs"),
    })
}

async fn store_receipt_ack_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    receipt: &ReceiptClaim,
    ack: &Ack,
) -> Result<(), Reject> {
    sqlx::query(
        "UPDATE command_receipt SET stream_seqs = $3 \
         WHERE principal_user_id = $1 AND command_id = $2",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .bind(&ack.stream_seqs)
    .execute(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    Ok(())
}

/// Persist via `append_and_project_in_tx`; when a receipt claim is present, the
/// claim, event append, projection fold, and ack storage are atomic. A duplicate
/// `(principal, command_id)` returns the stored ack and appends nothing.
async fn persist(
    pool: &PgPool,
    game: Uuid,
    events: &[EventInput],
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;

    let owns_receipt = if let Some(receipt) = receipt {
        if !claim_receipt_in_tx(&mut tx, game, receipt).await? {
            let ack = load_receipt_in_tx(&mut tx, receipt).await?;
            tx.commit()
                .await
                .map_err(|e| Reject::Internal(e.to_string()))?;
            return Ok(ack);
        }
        true
    } else {
        false
    };

    let stored = match append_and_project_in_tx(&mut tx, game, events).await {
        Ok(stored) => stored,
        Err(ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => {
            return Err(Reject::StreamConflict);
        }
        Err(e) => return Err(Reject::Internal(e.to_string())),
    };
    let ack = Ack::from_seqs(stored.iter().map(|s| s.stream_seq).collect());

    if owns_receipt {
        if let Some(receipt) = receipt {
            store_receipt_ack_in_tx(&mut tx, receipt, &ack).await?;
        }
    }

    tx.commit()
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    Ok(ack)
}

impl From<ProjectionError> for Reject {
    fn from(e: ProjectionError) -> Self {
        Reject::Internal(e.to_string())
    }
}

impl From<caps::CapError> for Reject {
    fn from(e: caps::CapError) -> Self {
        Reject::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prompt(
        kind: &str,
        phase_id: &str,
        metadata: serde_json::Value,
    ) -> projections::HostPromptRow {
        projections::HostPromptRow {
            game_id: Uuid::nil(),
            phase_id: phase_id.to_string(),
            event_index: 0,
            prompt_id: format!("{phase_id}:{kind}:test"),
            kind: kind.to_string(),
            subject_slot: None,
            reason: "test".to_string(),
            phase_kind: "Day".to_string(),
            phase_number: phase_number(phase_id).unwrap() as i32,
            metadata,
            status: "pending".to_string(),
            decision: None,
            resolved_by: None,
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

    fn phase_policy(kinds: Vec<domain::pack::PhaseKind>) -> domain::pack::PhasePolicy {
        domain::pack::PhasePolicy {
            twilight: kinds.contains(&domain::pack::PhaseKind::Twilight),
            cadence: kinds,
            subsegments: BTreeMap::new(),
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: "D01R3".to_string(),
                reason: "revote",
                skipped_phase_id: None,
            }
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
                    domain::pack::PhaseKind::Day,
                    domain::pack::PhaseKind::Night
                ]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &[]
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: "N02".to_string(),
                reason: "skip_next_day",
                skipped_phase_id: Some("D02".to_string()),
            }
        );
        assert_eq!(
            host_prompt_effect(
                &effects,
                &phase_policy(vec![
                    domain::pack::PhaseKind::Day,
                    domain::pack::PhaseKind::Night
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
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
