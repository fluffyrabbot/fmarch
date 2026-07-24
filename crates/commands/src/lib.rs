//! `commands` — the command pipeline core (doc 03), pre-HTTP. Phase 4's `api`
//! will wrap [`handle`] in an axum route; here it is a plain async function so it
//! is exercisable directly against Postgres.
//!
//! Pipeline per command (doc 03 §"Command handling pipeline"):
//!
//! 1. **begin + lock** — open one transaction and take the game's
//!    transaction-scoped advisory lock.
//! 2. **resolve capability** — once, from that transaction via
//!    [`caps::resolve_in_tx`] (never ambient globals).
//! 3. **validate** — domain rules: phase open/unlocked, slot alive, the actor IS
//!    the slot's current occupant, target valid, host-gating.
//! 4. **produce events** — the platform [`eventstore::EventInput`]s.
//! 5. **persist** — [`projections::append_and_project_in_tx`] in that tx; an eventstore
//!    `Conflict` surfaces as the retryable [`Reject::StreamConflict`].
//! 6. **commit** — receipt and ack commit with the events and projections.
//!
//! Authority is RESOLVED once and PASSED INWARD: validation receives a
//! [`caps::CapabilitySet`] and asks `grants(required)`. Inner code never
//! re-derives authority (confused-deputy defense, doc 06).

use std::collections::{BTreeMap, BTreeSet};
use std::future::pending;
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use caps::{Capability, CapabilitySet, Principal};
use domain::{
    pack::{
        ActionTemplate, ActivationGateReason, GrantKind, GrantSpec, HostPromptDecisionKind,
        HostPromptResolutionEffect, HostPromptResolutionEffectPolicy, ItaSessionControlKind,
        PhaseParity, TargetRoleFilter, TargetSpec, TargetState, Window,
    },
    IrAbility, Modifier, RoleModifier,
};
use eventstore::{ActorId, EventInput};
use game_platform::day_schedule;
use projections::{append_and_project_in_tx, audit_rebuild, ProjectionError};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

pub mod day_program;
pub mod day_scheduler;
mod model;
pub mod operator_process;
pub mod operator_proof;
pub use model::{
    Ack, CohostPermissionClass, Command, HostPromptDecision, Reject, ThreadPostMedia,
    ThreadPostMediaVariant, VoteTarget,
};

pub const LARGE_ACTION_GRAPH_PERFORMANCE_SEED: u64 = 90_001;
pub const LARGE_ACTION_GRAPH_PERFORMANCE_THRESHOLD_MS: u64 = 20_000;
const MAX_THREAD_POST_MEDIA: usize = 4;
const MAX_THREAD_POST_MEDIA_ALT_BYTES: usize = 1_000;
const REQUIRED_THREAD_POST_MEDIA_VARIANTS: [&str; 3] = ["thumb", "tablet", "full-bounded"];

/// Deterministic suspension points used by the command-runtime cancellation
/// contract tests. Production callers should use [`handle`] or
/// [`handle_idempotent`]; this surface exists so tests can abort a task after a
/// resource-bearing await without timing races.
#[doc(hidden)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandRuntimeCheckpoint {
    TransactionBegun,
    ReceiptClaimed,
    StreamLocked,
    CompletionChecked,
    GameValidated,
    CapabilityResolved,
    EventsProjected,
    CommandApplied,
    ReceiptStored,
    Committed,
}

/// One-shot controller for a deterministic command-runtime suspension point.
#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct CommandRuntimeTestControl {
    target: CommandRuntimeCheckpoint,
    reached: Arc<AtomicBool>,
}

impl CommandRuntimeTestControl {
    pub fn new(target: CommandRuntimeCheckpoint) -> Self {
        Self {
            target,
            reached: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn wait_until_reached(&self) {
        while !self.reached.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    }

    async fn suspend_if_target(&self, checkpoint: CommandRuntimeCheckpoint) {
        if self.target == checkpoint {
            self.reached.store(true, Ordering::Release);
            pending::<()>().await;
        }
    }
}

tokio::task_local! {
    static COMMAND_RUNTIME_TEST_CONTROL: Option<CommandRuntimeTestControl>;
    static COMMAND_AUDIT_CONTEXT: CommandAuditContext;
}

async fn command_runtime_checkpoint(checkpoint: CommandRuntimeCheckpoint) {
    let control = COMMAND_RUNTIME_TEST_CONTROL
        .try_with(Clone::clone)
        .ok()
        .flatten();
    if let Some(control) = control {
        control.suspend_if_target(checkpoint).await;
    }
}

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

/// Command-layer builder for reducing a stored game stream into resolver input.
///
/// The domain resolver stays pure and storage-blind. This seam owns the command
/// boundary chores: pack loading, phase parsing, snapshot/submission/day-input
/// reduction, and deterministic run metadata derived from the stream cursor.
pub struct EngineInputBuilder<'a> {
    game: Uuid,
    stream: &'a [eventstore::StoredEvent],
    phase_id: &'a str,
}

#[derive(Debug, Clone)]
pub struct EnginePhaseInput {
    pub game: Uuid,
    pub pack_name: String,
    pub pack: domain::Pack,
    pub phase_id: String,
    pub phase_kind: domain::pack::PhaseKind,
    pub phase_number: u32,
    pub state: domain::StateSnapshot,
    pub submissions: Vec<domain::Submission>,
    pub day_phase_inputs: domain::DayPhaseInputs,
    pub next_stream_seq: i64,
}

#[derive(Debug, Clone)]
pub enum EngineRunKind<'a> {
    ResolvePhase {
        seed: u64,
    },
    HammerPreview,
    Instant {
        action_id: &'a str,
    },
    Replay {
        run_id: &'a str,
        seed: u64,
        logical_time: u64,
    },
}

impl<'a> EngineInputBuilder<'a> {
    pub fn new(game: Uuid, stream: &'a [eventstore::StoredEvent], phase_id: &'a str) -> Self {
        Self {
            game,
            stream,
            phase_id,
        }
    }

    pub fn build(self) -> Result<EnginePhaseInput, Reject> {
        let pack_name = pack_name_from_stream(self.stream)?;
        let pack = load_pack(&pack_name)?;
        let phase_kind = phase_kind(self.phase_id)?;
        let phase_number = phase_number(self.phase_id)?;
        let state = current_snapshot(self.stream, &pack, self.phase_id, phase_kind, phase_number)?;
        let submissions = current_submissions(self.stream, self.phase_id);
        let day_phase_inputs =
            current_day_phase_inputs(self.stream, &state, phase_kind, phase_number)?;
        let next_stream_seq = self.stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);

        Ok(EnginePhaseInput {
            game: self.game,
            pack_name,
            pack,
            phase_id: self.phase_id.to_string(),
            phase_kind,
            phase_number,
            state,
            submissions,
            day_phase_inputs,
            next_stream_seq,
        })
    }
}

impl EnginePhaseInput {
    pub fn logical_time(&self) -> u64 {
        self.next_stream_seq as u64
    }

    pub fn resolve_input(&self, run: EngineRunKind<'_>) -> domain::ResolutionInput {
        let (run_id, seed, logical_time) = match run {
            EngineRunKind::ResolvePhase { seed } => (
                format!(
                    "resolution:{}:{}:{seed}:{}",
                    self.game, self.phase_id, self.next_stream_seq
                ),
                seed,
                self.logical_time(),
            ),
            EngineRunKind::HammerPreview => (
                format!(
                    "hammer:{}:{}:{}",
                    self.game, self.phase_id, self.next_stream_seq
                ),
                self.logical_time(),
                self.logical_time(),
            ),
            EngineRunKind::Instant { action_id } => (
                format!(
                    "instant:{}:{}:{action_id}:{}",
                    self.game, self.phase_id, self.next_stream_seq
                ),
                self.logical_time(),
                self.logical_time(),
            ),
            EngineRunKind::Replay {
                run_id,
                seed,
                logical_time,
            } => (run_id.to_string(), seed, logical_time),
        };

        domain::ResolutionInput {
            game_id: self.game.to_string(),
            phase_id: self.phase_id.clone(),
            run_id,
            state: self.state.clone(),
            submissions: self.submissions.clone(),
            day_phase_inputs: self.day_phase_inputs.clone(),
            pack: self.pack.clone(),
            seed,
            logical_time,
        }
    }
}

#[derive(Debug, Clone)]
struct ReceiptClaim {
    principal_user_id: String,
    command_id: Uuid,
    command_fingerprint: Vec<u8>,
}

/// Audit facts shared by every event emitted from one accepted command.
///
/// `ActorId` describes the effective game actor (`Host`, `Slot`, `System`);
/// this context preserves the authenticated initiating principal and the exact
/// authority exercised. Keeping the stamping at the append boundary prevents
/// individual handlers from silently omitting cohost attribution.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CommandAuditContext {
    principal_user_id: String,
    command_id: Uuid,
    command_kind: String,
    authority_used: String,
    request_source: &'static str,
}

#[derive(Debug, Clone)]
struct ActiveAction {
    template_id: String,
    grant_id: Option<String>,
    targets: Vec<String>,
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

fn host_prompt_public_resolution(
    prompt: &projections::HostPromptRow,
    effect: &HostPromptEffect,
) -> domain::HostPromptPublicResolution {
    match effect {
        HostPromptEffect::PkKill { selected, .. } => {
            domain::HostPromptPublicResolution::DayVoteElimination {
                phase_id: prompt.phase_id.clone(),
                selected_slot: selected.clone(),
                reason: prompt.reason.clone(),
            }
        }
        HostPromptEffect::AdvancePhase {
            phase_id,
            reason,
            skipped_phase_id,
        } => domain::HostPromptPublicResolution::PhaseAdvance {
            source_phase_id: prompt.phase_id.clone(),
            target_phase_id: phase_id.clone(),
            reason: (*reason).to_string(),
            skipped_phase_id: skipped_phase_id.clone(),
        },
        HostPromptEffect::AcknowledgeOnly => domain::HostPromptPublicResolution::Acknowledged {
            phase_id: prompt.phase_id.clone(),
            reason: prompt.reason.clone(),
        },
    }
}

#[derive(Debug, Clone)]
struct RebuiltResolutionEnvelope {
    applied: domain::ResolutionApplied,
    trace: domain::ResolutionTrace,
}

#[derive(Debug, serde::Serialize)]
struct HostPromptPhaseControlPayload {
    phase_id: String,
    phase_opened_at: i64,
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
    fn new(principal: &Principal, command_id: Uuid, command: &Command) -> Result<Self, Reject> {
        let payload = serde_json::to_vec(command)
            .map_err(|error| Reject::Internal(format!("command fingerprint failed: {error}")))?;
        let mut fingerprint = Sha256::new();
        fingerprint.update(b"fmarch-command-payload:v1\0");
        fingerprint.update(payload);
        Ok(ReceiptClaim {
            principal_user_id: principal.user_id().to_string(),
            command_id,
            command_fingerprint: fingerprint.finalize().to_vec(),
        })
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
    let command_id = Uuid::new_v4();
    COMMAND_RUNTIME_TEST_CONTROL
        .scope(
            None,
            handle_inner(pool, principal, command_id, command, None),
        )
        .await
}

/// Execute one schedule observation under the sealed scheduler authority.
///
/// This boundary is intentionally separate from [`handle`]: no user principal
/// can acquire scheduler authority and the network wire has no corresponding
/// command. The game stream advisory lock remains the correctness boundary when
/// multiple worker replicas race the same due game.
pub async fn advance_day_event_automation_as_scheduler(
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
        principal_user_id: "service:day-event-automation".to_string(),
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

/// Handle a network command with durable idempotency. If `(principal,
/// command_id)` has already committed, return the original ack without
/// revalidating against current state or appending new events. Reusing that id
/// for a different command fingerprint is a typed conflict.
pub async fn handle_idempotent(
    pool: &PgPool,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
) -> Result<Ack, Reject> {
    let receipt = ReceiptClaim::new(principal, command_id, &command)?;
    COMMAND_RUNTIME_TEST_CONTROL
        .scope(
            None,
            handle_inner(pool, principal, command_id, command, Some(&receipt)),
        )
        .await
}

/// Run an idempotent command with a deterministic cancellation checkpoint.
/// This is intentionally hidden from the production API documentation.
#[doc(hidden)]
pub async fn handle_idempotent_with_test_control(
    pool: &PgPool,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
    control: CommandRuntimeTestControl,
) -> Result<Ack, Reject> {
    let receipt = ReceiptClaim::new(principal, command_id, &command)?;
    COMMAND_RUNTIME_TEST_CONTROL
        .scope(
            Some(control),
            handle_inner(pool, principal, command_id, command, Some(&receipt)),
        )
        .await
}

async fn handle_inner(
    pool: &PgPool,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    let game = command_game(&command);
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::TransactionBegun).await;

    if let Some(receipt) = receipt {
        let replay = claim_or_replay_receipt_in_tx(&mut tx, game, receipt).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::ReceiptClaimed).await;
        if let Some(ack) = replay {
            tx.commit()
                .await
                .map_err(|error| Reject::Internal(error.to_string()))?;
            command_runtime_checkpoint(CommandRuntimeCheckpoint::Committed).await;
            return Ok(ack);
        }
    }

    eventstore::lock_stream_in_tx(&mut tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::StreamLocked).await;
    if game_closed_by_completion(&command).is_some() {
        require_game_not_completed(&mut tx, game).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::CompletionChecked).await;
    }
    let audit_context = command_audit_context(&mut tx, principal, command_id, &command).await?;
    let ack = COMMAND_AUDIT_CONTEXT
        .scope(audit_context, handle_command(&mut tx, principal, command))
        .await?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::CommandApplied).await;

    if let Some(receipt) = receipt {
        store_receipt_ack_in_tx(&mut tx, receipt, &ack).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::ReceiptStored).await;
    }
    tx.commit()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::Committed).await;
    Ok(ack)
}

async fn handle_command(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    command: Command,
) -> Result<Ack, Reject> {
    match command {
        // ── bootstrap lifecycle (minimal, host-gated where appropriate) ──
        Command::CreateGame {
            game,
            pack,
            cohost_denied,
        } => create_game(tx, principal, game, pack, cohost_denied).await,
        Command::AddSlot { game, slot } => add_slot(tx, principal, game, slot).await,
        Command::AssignSlot { game, slot, user } => {
            assign_slot(tx, principal, game, slot, user).await
        }
        Command::AssignRole {
            game,
            slot,
            role_key,
        } => assign_role(tx, principal, game, slot, role_key).await,
        Command::SetSlotStatus { game, slot, status } => {
            host_slot_lifecycle(
                tx,
                principal,
                game,
                slot,
                "SlotStatusChanged",
                serde_json::json!({ "status": status }),
            )
            .await
        }
        Command::AddSlotStatusTag { game, slot, tag } => {
            host_slot_lifecycle(
                tx,
                principal,
                game,
                slot,
                "SlotStatusTagged",
                serde_json::json!({ "tag": tag }),
            )
            .await
        }
        Command::RemoveSlotStatusTag { game, slot, tag } => {
            host_slot_lifecycle(
                tx,
                principal,
                game,
                slot,
                "SlotStatusUntagged",
                serde_json::json!({ "tag": tag }),
            )
            .await
        }
        Command::AddCohost { game, user } => {
            host_structural_lifecycle(
                tx,
                principal,
                game,
                "CohostAdded",
                serde_json::json!({ "user_id": user }),
                ActorId::Host,
            )
            .await
        }
        Command::GrantSpectator { game, user } => grant_spectator(tx, principal, game, user).await,
        Command::RevokeSpectator { game, user } => {
            revoke_spectator(tx, principal, game, user).await
        }
        Command::StartGame { game, phase } => start_game(tx, principal, game, phase).await,
        Command::OpenDayPhase { game, phase } => {
            host_phase_lifecycle(tx, principal, game, "PhaseAdvanced", phase).await
        }
        Command::AdvancePhase { game } => advance_phase(tx, principal, game).await,
        Command::AdvancePhaseByDeadline {
            game,
            phase,
            observed_at,
        } => advance_phase_by_deadline(tx, principal, game, phase, observed_at).await,
        Command::LockThread { game } => lock_thread(tx, principal, game).await,
        Command::UnlockThread { game } => unlock_thread(tx, principal, game).await,
        Command::ResolvePhase { game, seed } => resolve_phase(tx, principal, game, seed).await,
        Command::CompleteGame { game } => complete_game(tx, principal, game).await,
        Command::PublishVotecount { game } => publish_votecount(tx, principal, game).await,
        Command::ResolveHostPrompt {
            game,
            prompt_id,
            decision,
        } => resolve_host_prompt(tx, principal, game, prompt_id, decision).await,
        Command::SetPostPolicy {
            game,
            channel_id,
            allow_media_only,
        } => set_post_policy(tx, principal, game, channel_id, allow_media_only).await,
        Command::PublishSpectatorPost { game, body, media } => {
            publish_spectator_post(tx, principal, game, body, media).await
        }
        Command::ControlItaSession {
            game,
            session_id,
            control,
            message,
        } => control_ita_session(tx, principal, game, session_id, control, message).await,
        Command::ApplyEffectPlan {
            game,
            effects,
            reason,
        } => apply_effect_plan(tx, principal, game, effects, reason).await,
        Command::AttachDayProgram { game, program } => {
            attach_day_program(tx, principal, game, program).await
        }
        Command::ScheduleDayEvent { game, event } => {
            schedule_day_event(tx, principal, game, event).await
        }
        Command::OpenDayEvent { game, event_id } => {
            open_day_event(tx, principal, game, event_id).await
        }
        Command::LockDayEvent { game, event_id } => {
            lock_day_event(tx, principal, game, event_id).await
        }
        Command::CancelDayEvent {
            game,
            event_id,
            reason,
        } => cancel_day_event(tx, principal, game, event_id, reason).await,
        Command::SubmitDayEventParticipation {
            game,
            event_id,
            actor_slot,
            payload,
        } => {
            submit_day_event_participation(tx, principal, game, event_id, actor_slot, payload).await
        }
        Command::WithdrawDayEventParticipation {
            game,
            event_id,
            actor_slot,
        } => withdraw_day_event_participation(tx, principal, game, event_id, actor_slot).await,
        Command::ResolveDayEvent {
            game,
            event_id,
            decision,
        } => resolve_day_event(tx, principal, game, event_id, decision).await,

        // ── slice commands ──
        Command::SubmitVote {
            game,
            actor_slot,
            target,
        } => submit_vote(tx, principal, game, actor_slot, target).await,
        Command::WithdrawVote { game, actor_slot } => {
            withdraw_vote(tx, principal, game, actor_slot).await
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
                tx,
                principal,
                game,
                action_id,
                actor_slot,
                template_id,
                targets,
                grant_id,
            )
            .await
        }
        Command::WithdrawAction {
            game,
            action_id,
            actor_slot,
        } => withdraw_action(tx, principal, game, action_id, actor_slot).await,
        Command::SubmitPost {
            game,
            channel_id,
            actor_slot,
            body,
            media,
        } => {
            submit_post(
                tx,
                principal,
                SubmitPostRequest {
                    game,
                    channel_id,
                    actor_slot,
                    body,
                    media,
                },
            )
            .await
        }
        Command::ExtendDeadline { game, phase, at } => {
            extend_deadline(tx, principal, game, phase, at).await
        }
        Command::ProcessReplacement {
            game,
            slot,
            outgoing_user,
            incoming_user,
        } => process_replacement(tx, principal, game, slot, outgoing_user, incoming_user).await,
    }
}

// ───────────────────────── bootstrap handlers ─────────────────────────

enum CommandAuditAuthority<'a> {
    GameCreator,
    HostTeam,
    SlotOccupant(&'a str),
}

async fn command_audit_context(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    command_id: Uuid,
    command: &Command,
) -> Result<CommandAuditContext, Reject> {
    let (command_kind, authority) = command_audit_shape(command);
    let game = command_game(command);
    let (authority_used, request_source) = match authority {
        CommandAuditAuthority::GameCreator => ("GameCreator".to_string(), "game_creation"),
        CommandAuditAuthority::SlotOccupant(slot) => {
            (format!("SlotOccupant({slot})"), "player_command")
        }
        CommandAuditAuthority::HostTeam => {
            // This is attribution, not a second capability resolution. The
            // handler still resolves and validates its CapabilitySet exactly
            // once; here we read the committed authority role that an accepted
            // host-team command will have exercised.
            let role: Option<String> = sqlx::query_scalar(
                "SELECT role FROM game_authority \
                 WHERE game_id = $1 AND user_id = $2 \
                 ORDER BY CASE role WHEN 'host' THEN 0 ELSE 1 END LIMIT 1",
            )
            .bind(game)
            .bind(principal.user_id())
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| Reject::Internal(error.to_string()))?;
            let authority = match role.as_deref() {
                Some("host") => format!("HostOf({game})"),
                Some("cohost") => format!("CohostOf({game})"),
                _ => {
                    // Accepted commands cannot retain this value: the handler's
                    // capability gate rejects before append. Keeping it explicit
                    // makes any future missing gate visible in event audits.
                    format!("UnresolvedHostTeam({game})")
                }
            };
            (authority, "host_command")
        }
    };

    Ok(CommandAuditContext {
        principal_user_id: principal.user_id().to_string(),
        command_id,
        command_kind: command_kind.to_string(),
        authority_used,
        request_source,
    })
}

fn command_audit_shape(command: &Command) -> (&'static str, CommandAuditAuthority<'_>) {
    match command {
        Command::CreateGame { .. } => ("CreateGame", CommandAuditAuthority::GameCreator),
        Command::SubmitVote { actor_slot, .. } => (
            "SubmitVote",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::WithdrawVote { actor_slot, .. } => (
            "WithdrawVote",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::SubmitAction { actor_slot, .. } => (
            "SubmitAction",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::WithdrawAction { actor_slot, .. } => (
            "WithdrawAction",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::SubmitPost { actor_slot, .. } => (
            "SubmitPost",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::AddSlot { .. } => ("AddSlot", CommandAuditAuthority::HostTeam),
        Command::AssignSlot { .. } => ("AssignSlot", CommandAuditAuthority::HostTeam),
        Command::AssignRole { .. } => ("AssignRole", CommandAuditAuthority::HostTeam),
        Command::SetSlotStatus { .. } => ("SetSlotStatus", CommandAuditAuthority::HostTeam),
        Command::AddSlotStatusTag { .. } => ("AddSlotStatusTag", CommandAuditAuthority::HostTeam),
        Command::RemoveSlotStatusTag { .. } => {
            ("RemoveSlotStatusTag", CommandAuditAuthority::HostTeam)
        }
        Command::AddCohost { .. } => ("AddCohost", CommandAuditAuthority::HostTeam),
        Command::GrantSpectator { .. } => ("GrantSpectator", CommandAuditAuthority::HostTeam),
        Command::RevokeSpectator { .. } => ("RevokeSpectator", CommandAuditAuthority::HostTeam),
        Command::StartGame { .. } => ("StartGame", CommandAuditAuthority::HostTeam),
        Command::OpenDayPhase { .. } => ("OpenDayPhase", CommandAuditAuthority::HostTeam),
        Command::AdvancePhase { .. } => ("AdvancePhase", CommandAuditAuthority::HostTeam),
        Command::AdvancePhaseByDeadline { .. } => {
            ("AdvancePhaseByDeadline", CommandAuditAuthority::HostTeam)
        }
        Command::LockThread { .. } => ("LockThread", CommandAuditAuthority::HostTeam),
        Command::UnlockThread { .. } => ("UnlockThread", CommandAuditAuthority::HostTeam),
        Command::ResolvePhase { .. } => ("ResolvePhase", CommandAuditAuthority::HostTeam),
        Command::CompleteGame { .. } => ("CompleteGame", CommandAuditAuthority::HostTeam),
        Command::PublishVotecount { .. } => ("PublishVotecount", CommandAuditAuthority::HostTeam),
        Command::ResolveHostPrompt { .. } => ("ResolveHostPrompt", CommandAuditAuthority::HostTeam),
        Command::SetPostPolicy { .. } => ("SetPostPolicy", CommandAuditAuthority::HostTeam),
        Command::PublishSpectatorPost { .. } => {
            ("PublishSpectatorPost", CommandAuditAuthority::HostTeam)
        }
        Command::ControlItaSession { .. } => ("ControlItaSession", CommandAuditAuthority::HostTeam),
        Command::ApplyEffectPlan { .. } => ("ApplyEffectPlan", CommandAuditAuthority::HostTeam),
        Command::AttachDayProgram { .. } => ("AttachDayProgram", CommandAuditAuthority::HostTeam),
        Command::ScheduleDayEvent { .. } => ("ScheduleDayEvent", CommandAuditAuthority::HostTeam),
        Command::OpenDayEvent { .. } => ("OpenDayEvent", CommandAuditAuthority::HostTeam),
        Command::LockDayEvent { .. } => ("LockDayEvent", CommandAuditAuthority::HostTeam),
        Command::CancelDayEvent { .. } => ("CancelDayEvent", CommandAuditAuthority::HostTeam),
        Command::SubmitDayEventParticipation { actor_slot, .. } => (
            "SubmitDayEventParticipation",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::WithdrawDayEventParticipation { actor_slot, .. } => (
            "WithdrawDayEventParticipation",
            CommandAuditAuthority::SlotOccupant(actor_slot),
        ),
        Command::ResolveDayEvent { .. } => ("ResolveDayEvent", CommandAuditAuthority::HostTeam),
        Command::ExtendDeadline { .. } => ("ExtendDeadline", CommandAuditAuthority::HostTeam),
        Command::ProcessReplacement { .. } => {
            ("ProcessReplacement", CommandAuditAuthority::HostTeam)
        }
    }
}

fn command_game(command: &Command) -> Uuid {
    match command {
        Command::CreateGame { game, .. }
        | Command::AddSlot { game, .. }
        | Command::AssignSlot { game, .. }
        | Command::AssignRole { game, .. }
        | Command::SetSlotStatus { game, .. }
        | Command::AddSlotStatusTag { game, .. }
        | Command::RemoveSlotStatusTag { game, .. }
        | Command::AddCohost { game, .. }
        | Command::GrantSpectator { game, .. }
        | Command::RevokeSpectator { game, .. }
        | Command::StartGame { game, .. }
        | Command::OpenDayPhase { game, .. }
        | Command::AdvancePhase { game }
        | Command::AdvancePhaseByDeadline { game, .. }
        | Command::LockThread { game }
        | Command::UnlockThread { game }
        | Command::ResolvePhase { game, .. }
        | Command::CompleteGame { game }
        | Command::PublishVotecount { game }
        | Command::ResolveHostPrompt { game, .. }
        | Command::SetPostPolicy { game, .. }
        | Command::PublishSpectatorPost { game, .. }
        | Command::ControlItaSession { game, .. }
        | Command::ApplyEffectPlan { game, .. }
        | Command::AttachDayProgram { game, .. }
        | Command::ScheduleDayEvent { game, .. }
        | Command::OpenDayEvent { game, .. }
        | Command::LockDayEvent { game, .. }
        | Command::CancelDayEvent { game, .. }
        | Command::SubmitDayEventParticipation { game, .. }
        | Command::WithdrawDayEventParticipation { game, .. }
        | Command::ResolveDayEvent { game, .. }
        | Command::SubmitVote { game, .. }
        | Command::WithdrawVote { game, .. }
        | Command::SubmitAction { game, .. }
        | Command::WithdrawAction { game, .. }
        | Command::SubmitPost { game, .. }
        | Command::ExtendDeadline { game, .. }
        | Command::ProcessReplacement { game, .. } => *game,
    }
}

fn game_closed_by_completion(command: &Command) -> Option<Uuid> {
    match command {
        Command::CreateGame { .. } | Command::CompleteGame { .. } => None,
        Command::AddSlot { game, .. }
        | Command::AssignSlot { game, .. }
        | Command::AssignRole { game, .. }
        | Command::SetSlotStatus { game, .. }
        | Command::AddSlotStatusTag { game, .. }
        | Command::RemoveSlotStatusTag { game, .. }
        | Command::AddCohost { game, .. }
        | Command::GrantSpectator { game, .. }
        | Command::RevokeSpectator { game, .. }
        | Command::StartGame { game, .. }
        | Command::OpenDayPhase { game, .. }
        | Command::AdvancePhase { game }
        | Command::AdvancePhaseByDeadline { game, .. }
        | Command::LockThread { game }
        | Command::UnlockThread { game }
        | Command::ResolvePhase { game, .. }
        | Command::PublishVotecount { game }
        | Command::ResolveHostPrompt { game, .. }
        | Command::SetPostPolicy { game, .. }
        | Command::PublishSpectatorPost { game, .. }
        | Command::ControlItaSession { game, .. }
        | Command::ApplyEffectPlan { game, .. }
        | Command::AttachDayProgram { game, .. }
        | Command::ScheduleDayEvent { game, .. }
        | Command::OpenDayEvent { game, .. }
        | Command::LockDayEvent { game, .. }
        | Command::CancelDayEvent { game, .. }
        | Command::SubmitDayEventParticipation { game, .. }
        | Command::WithdrawDayEventParticipation { game, .. }
        | Command::ResolveDayEvent { game, .. }
        | Command::SubmitVote { game, .. }
        | Command::WithdrawVote { game, .. }
        | Command::SubmitAction { game, .. }
        | Command::WithdrawAction { game, .. }
        | Command::SubmitPost { game, .. }
        | Command::ExtendDeadline { game, .. }
        | Command::ProcessReplacement { game, .. } => Some(*game),
    }
}

async fn require_game_not_completed(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<(), Reject> {
    let completed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM events WHERE stream_id = $1 AND kind = 'GameCompleted')",
    )
    .bind(game)
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| Reject::Internal(error.to_string()))?;
    if completed {
        Err(Reject::GameAlreadyCompleted)
    } else {
        Ok(())
    }
}

pub async fn game_completed(pool: &PgPool, game: Uuid) -> Result<bool, Reject> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM events WHERE stream_id = $1 AND kind = 'GameCompleted')",
    )
    .bind(game)
    .fetch_one(pool)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))
}

/// `CreateGame` requires no game-scoped capability — there is none yet. The
/// creating principal BECOMES the host (the `GameCreated.host` field), which is
/// what every subsequent host-gated command resolves against.
async fn create_game(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    pack: String,
    cohost_denied: Vec<CohostPermissionClass>,
) -> Result<Ack, Reject> {
    if projections::game_exists(&mut **tx, game).await? {
        return Err(Reject::UnknownGame); // already exists → treat as bad request
    }
    load_pack(&pack)?;
    let host = principal.user_id().to_string();
    let denied: Vec<&str> = cohost_denied.iter().map(|c| c.as_str()).collect();
    let ev = EventInput::new(
        "GameCreated",
        1,
        serde_json::json!({
            "host": host,
            "pack": pack,
            "cohost_denied": denied,
        }),
        ActorId::User(host.clone()),
        0,
    );
    persist(tx, game, &[ev]).await
}

/// Structural host-only lifecycle (e.g. `AddCohost`). Primary host / global only.
async fn host_structural_lifecycle(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    kind: &str,
    payload: serde_json::Value,
    actor: ActorId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_host_structural(&caps, game)?;
    persist(tx, game, &[EventInput::new(kind, 1, payload, actor, 0)]).await
}

async fn grant_spectator(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    user: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if user.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if projections::slot_occupancy(&mut **tx, game)
        .await?
        .into_iter()
        .any(|row| row.occupant_user_id == user)
        || projections::spectator_membership(&mut **tx, game, &user).await?
    {
        return Err(Reject::InvalidTarget);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "SpectatorGranted",
            1,
            serde_json::json!({ "user_id": user }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn revoke_spectator(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    user: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if user.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if !projections::spectator_membership(&mut **tx, game, &user).await? {
        return Err(Reject::InvalidTarget);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "SpectatorRevoked",
            1,
            serde_json::json!({ "user_id": user }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn add_slot(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::InvalidTarget);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "SlotAdded",
            1,
            serde_json::json!({ "slot_id": slot }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn complete_game(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    if stream.iter().any(|event| event.kind == "GameCompleted") {
        return Err(Reject::GameAlreadyCompleted);
    }

    persist(
        tx,
        game,
        &[EventInput::new(
            "GameCompleted",
            1,
            serde_json::json!({}),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn host_phase_lifecycle(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    kind: &str,
    phase: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    validate_pack_phase_id(&pack, &phase)?;
    let phase_opened_at = unix_seconds_now()?;

    persist(
        tx,
        game,
        &[EventInput::new(
            kind,
            1,
            serde_json::json!({
                "phase_id": phase,
                "phase_opened_at": phase_opened_at,
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn lock_thread(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;
    require_thread_lock_state(tx, game, false).await?;
    persist(
        tx,
        game,
        &[EventInput::new(
            "ThreadLocked",
            1,
            serde_json::json!({ "channel_id": "main" }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn unlock_thread(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;
    require_thread_lock_state(tx, game, true).await?;
    persist(
        tx,
        game,
        &[EventInput::new(
            "ThreadUnlocked",
            1,
            serde_json::json!({ "channel_id": "main" }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn require_thread_lock_state(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    expected_locked: bool,
) -> Result<(), Reject> {
    let Some(phase) = projections::phase_state(&mut **tx, game).await? else {
        return Err(Reject::PhaseLocked);
    };
    if phase.locked == expected_locked {
        Ok(())
    } else {
        Err(Reject::PhaseLocked)
    }
}

async fn start_game(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    phase: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    validate_pack_phase_id(&pack, &phase)?;
    let phase_opened_at = unix_seconds_now()?;

    let mut events = vec![EventInput::new(
        "GameStarted",
        1,
        serde_json::json!({
            "phase_id": phase,
            "phase_opened_at": phase_opened_at,
        }),
        ActorId::Host,
        0,
    )];
    events.extend(role_pm_declarations(&stream)?);
    events.extend(pack_private_channel_declarations(&pack, &stream)?);
    persist(tx, game, &events).await
}

async fn advance_phase(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let (phase, stream) = resolved_locked_phase_stream(tx, game).await?;
    let source_phase_id = phase.phase_id.clone();
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let next_phase_id = next_declared_phase_id(&pack.phases, &source_phase_id)?;
    let phase_opened_at = unix_seconds_now()?;
    let payload = serde_json::json!({
        "phase_id": next_phase_id,
        "source_phase_id": source_phase_id,
        "reason": "resolved_phase",
        "phase_opened_at": phase_opened_at,
    });
    persist(
        tx,
        game,
        &[EventInput::new(
            "PhaseAdvanced",
            1,
            payload,
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn advance_phase_by_deadline(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    phase_id: String,
    observed_at: i64,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let (phase, stream) = resolved_locked_phase_stream(tx, game).await?;
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
            "phase_opened_at": observed_at,
        }),
        ActorId::System,
        observed_at,
    );
    persist(tx, game, &[deadline_ev, advance_ev]).await
}

async fn resolved_locked_phase_stream(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<(projections::PhaseStateRow, Vec<eventstore::StoredEvent>), Reject> {
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or(Reject::PhaseLocked)?;
    if !phase.locked || phase_has_pending_prompt(tx, game, &phase.phase_id).await? {
        return Err(Reject::InvalidTarget);
    }

    let stream = eventstore::load_stream_in_tx(tx, game)
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
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    kind: &str,
    payload: serde_json::Value,
) -> Result<Ack, Reject> {
    let mut payload = payload;
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Lifecycle).await?;
    let current_status = current_slot_lifecycle_status(tx, game, &slot)
        .await?
        .ok_or(Reject::UnknownSlot)?;
    if kind == "SlotStatusChanged" {
        let requested_status =
            serde_json::from_value::<domain::SlotLifecycle>(payload["status"].clone())
                .map_err(|_| Reject::InvalidTarget)?;
        let event = plan_slot_status_change(&slot, &current_status, requested_status)?;
        return persist(tx, game, &[event]).await;
    }
    payload["slot_id"] = serde_json::Value::String(slot);
    persist(
        tx,
        game,
        &[EventInput::new(kind, 1, payload, ActorId::Host, 0)],
    )
    .await
}

fn plan_slot_status_change(
    slot: &str,
    current_status: &str,
    requested_status: domain::SlotLifecycle,
) -> Result<EventInput, Reject> {
    let requested = match requested_status {
        domain::SlotLifecycle::Alive => "alive",
        domain::SlotLifecycle::Dead => "dead",
        domain::SlotLifecycle::Modkilled => "modkilled",
    };
    if requested == current_status || (current_status != "alive" && requested != "alive") {
        return Err(Reject::InvalidTarget);
    }
    Ok(EventInput::new(
        "SlotStatusChanged",
        1,
        serde_json::json!({
            "slot_id": slot,
            "status": requested_status,
        }),
        ActorId::Host,
        0,
    ))
}

async fn apply_effect_plan(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    effects: Vec<game_platform::ConcreteEffect>,
    reason: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::EffectSpec).await?;

    let principal_id = game_platform::PrincipalId::new(principal.user_id().to_string())
        .map_err(effect_spec_validation)?;
    let plan = game_platform::EffectPlan::try_new(
        game_platform::EffectOrigin::HostFiat { principal_id },
        effects,
        reason,
    )
    .map_err(effect_spec_validation)?;
    let command_id = COMMAND_AUDIT_CONTEXT
        .try_with(|audit| audit.command_id)
        .map_err(|_| {
            Reject::Internal("command audit context missing in effect plan".to_string())
        })?;
    let application = EffectApplication::HostFiat {
        principal_user_id: principal.user_id().to_string(),
        command_id,
    };
    let mut lifecycle_states = BTreeMap::new();
    let events = plan_effect_events(tx, game, plan, &application, &mut lifecycle_states).await?;
    persist(tx, game, &events).await
}

#[derive(Debug, Clone)]
enum EffectApplication {
    HostFiat {
        principal_user_id: String,
        command_id: Uuid,
    },
    DayEvent {
        event_id: String,
        reward_key: String,
        command_id: Uuid,
    },
}

impl EffectApplication {
    fn meta_source(&self) -> &'static str {
        match self {
            Self::HostFiat { .. } => "host_fiat",
            Self::DayEvent { .. } => "day_event",
        }
    }

    fn source_action(&self, operation: &str) -> String {
        match self {
            Self::HostFiat { .. } => format!("host_fiat:{operation}"),
            Self::DayEvent {
                event_id,
                reward_key,
                ..
            } => format!("day_event:{event_id}:{reward_key}:{operation}"),
        }
    }

    fn grant_source(&self, index: usize) -> String {
        match self {
            Self::HostFiat {
                principal_user_id,
                command_id,
            } => host_fiat_grant_source(principal_user_id, *command_id, index),
            Self::DayEvent {
                event_id,
                reward_key,
                command_id,
            } => format!("day_event:{event_id}:{reward_key}:grant:{command_id}:{index}"),
        }
    }
}

async fn plan_effect_events(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    plan: game_platform::EffectPlan,
    application: &EffectApplication,
    lifecycle_states: &mut BTreeMap<String, String>,
) -> Result<Vec<EventInput>, Reject> {
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or_else(|| effect_spec_reject("effect plans require an active phase"))?;
    let phase_kind = phase_kind(&phase.phase_id)?;
    let phase_number = phase_number(&phase.phase_id)?;
    let pack = load_pack(&current_pack_name(tx, game).await?)?;
    // Preflight the entire plan before appending anything. Lifecycle validation
    // advances this in-memory view so multiple operations on one slot are
    // checked in plan order without consulting partially folded projections.
    let mut events = Vec::with_capacity(plan.effects.len());
    for (index, effect) in plan.effects.into_iter().enumerate() {
        let planned = match effect {
            game_platform::ConcreteEffect::SetSlotLifecycle { target, status } => {
                let target = target.as_str().to_string();
                let current = match lifecycle_states.get(&target) {
                    Some(current) => current.clone(),
                    None => current_slot_lifecycle_status(tx, game, &target)
                        .await?
                        .ok_or(Reject::UnknownSlot)?,
                };
                let status = match status {
                    game_platform::SlotLifecycleEffect::Alive => domain::SlotLifecycle::Alive,
                    game_platform::SlotLifecycleEffect::Dead => domain::SlotLifecycle::Dead,
                    game_platform::SlotLifecycleEffect::Modkilled => {
                        domain::SlotLifecycle::Modkilled
                    }
                };
                let mut event = plan_slot_status_change(&target, &current, status)?;
                event.payload["source_action"] =
                    serde_json::Value::String(application.source_action("set_slot_lifecycle"));
                event.payload["phase_id"] = serde_json::Value::String(phase.phase_id.clone());
                event.payload["phase_kind"] = serde_json::to_value(phase_kind)
                    .map_err(|error| Reject::Internal(format!("serialize phase kind: {error}")))?;
                event.payload["phase_number"] = serde_json::json!(phase_number);
                lifecycle_states.insert(
                    target,
                    match status {
                        domain::SlotLifecycle::Alive => "alive",
                        domain::SlotLifecycle::Dead => "dead",
                        domain::SlotLifecycle::Modkilled => "modkilled",
                    }
                    .to_string(),
                );
                vec![event]
            }
            game_platform::ConcreteEffect::Mark { target, effect } => {
                require_effect_target(tx, game, target.as_str()).await?;
                let policy = persistent_effect_policy(&pack, effect.as_str())?;
                vec![EventInput::new(
                    "EffectsMarked",
                    1,
                    serde_json::json!({
                        "effect": effect.as_str(),
                        "target": target.as_str(),
                        "actor": "external",
                        "source_action": application.source_action("mark"),
                        "phase_id": phase.phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "duration": "Persistent",
                        "visibility": policy.visibility,
                    }),
                    ActorId::Host,
                    0,
                )]
            }
            game_platform::ConcreteEffect::Clear { target, effect } => {
                require_effect_target(tx, game, target.as_str()).await?;
                persistent_effect_policy(&pack, effect.as_str())?;
                vec![EventInput::new(
                    "EffectsCleared",
                    1,
                    serde_json::json!({
                        "effect": effect.as_str(),
                        "targets": [target.as_str()],
                        "actor": "external",
                        "source_action": application.source_action("clear"),
                        "phase_id": phase.phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                    }),
                    ActorId::Host,
                    0,
                )]
            }
            game_platform::ConcreteEffect::Grant { target, grant } => {
                require_effect_target(tx, game, target.as_str()).await?;
                validate_platform_grant(&pack, &grant)?;
                let source_action = application.grant_source(index);
                let mut grant_events = vec![EventInput::new(
                    "ActionGranted",
                    1,
                    serde_json::json!({
                        "grant_id": grant.grant_id.as_str(),
                        "grant_option": null,
                        "kind": platform_grant_kind(grant.kind),
                        "actor": "external",
                        "target": target.as_str(),
                        "source_action": source_action,
                        "uses": grant.uses,
                        "vote_weight": grant.vote_weight,
                        "phase_id": phase.phase_id.clone(),
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                    }),
                    ActorId::Host,
                    0,
                )];
                let audience =
                    host_fiat_grant_audience(tx, game, grant.visibility, target.as_str()).await?;
                if !audience.is_empty() {
                    grant_events.push(EventInput::new(
                        "EffectNotification",
                        1,
                        serde_json::json!({
                            "effect": "grant",
                            "status": grant.grant_id.as_str(),
                            "audience": audience,
                            "phase_id": phase.phase_id.clone(),
                        }),
                        ActorId::Host,
                        0,
                    ));
                }
                grant_events
            }
            game_platform::ConcreteEffect::RevealAlignment { .. }
            | game_platform::ConcreteEffect::RevealRole { .. } => {
                return Err(effect_spec_reject(
                    "reveal adapters are not part of the persistent PR3 catalog",
                ));
            }
        };
        for mut event in planned {
            event.meta = serde_json::json!({
                "source": application.meta_source(),
                "effect_plan_reason": plan.reason,
                "effect_plan_index": index,
            });
            if let EffectApplication::DayEvent {
                event_id,
                reward_key,
                ..
            } = application
            {
                event.meta["day_event_id"] = serde_json::json!(event_id);
                event.meta["reward_key"] = serde_json::json!(reward_key);
            }
            events.push(event);
        }
    }

    Ok(events)
}

async fn schedule_day_event(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    event: game_platform::DayEvent,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::DayEventOps).await?;
    event.validate().map_err(day_event_validation)?;
    let pack = load_pack(&current_pack_name(tx, game).await?)?;
    let compatibility_issues = day_program::inspect_event(&pack, &event);
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

async fn attach_day_program(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    program: game_platform::DayProgram,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::ProgramAttach).await?;
    let pack = load_pack(&current_pack_name(tx, game).await?)?;
    let compatibility = day_program::inspect(&pack, &program);
    let compilation = compatibility
        .into_compilation()
        .map_err(|report| Reject::DayProgramValidation(report.summary()))?;
    let content_hash = compilation.content_hash;
    let compiled = compilation.events;
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
        EventInput::new(
            "DayEventScheduled",
            1,
            serde_json::json!({ "event": event }),
            ActorId::Host,
            0,
        )
    }));
    persist(tx, game, &events).await
}

async fn open_day_event(
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
    match event.definition.phase_scope {
        game_platform::PhaseScope::DuringDay { number } => {
            if phase_kind(&phase.phase_id)? != domain::pack::PhaseKind::Day
                || phase_number(&phase.phase_id)? != number
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
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventOpened",
            1,
            serde_json::json!({
                "event_id": event_id.as_str(),
                "phase_id": phase.phase_id,
                "opened_at": opened_at,
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
}

async fn lock_day_event(
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

async fn cancel_day_event(
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

async fn observe_day_event_schedules_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    observed_at: i64,
    seed_root: u64,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or_else(|| day_event_reject("schedule observation requires an active phase"))?;
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let timeline = day_schedule_timeline(&stream);
    let current_day_number = match phase_kind(&phase.phase_id)? {
        domain::pack::PhaseKind::Day => Some(phase_number(&phase.phase_id)?),
        _ => None,
    };
    let context = day_schedule::ScheduleContext {
        observed_at,
        current_phase_id: phase.phase_id.clone(),
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
                            "phase_id": phase.phase_id,
                            "opened_at": observed_at,
                            "source": "scheduler",
                        }),
                        ActorId::System,
                        observed_at,
                    ));
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

fn day_schedule_timeline(stream: &[eventstore::StoredEvent]) -> day_schedule::ScheduleTimeline {
    let mut timeline = day_schedule::ScheduleTimeline::default();
    let mut current_phase_id: Option<String> = None;
    for event in stream {
        match event.kind.as_str() {
            "GameStarted" | "PhaseAdvanced" => {
                let Some(phase_id) = event.payload["phase_id"].as_str() else {
                    continue;
                };
                current_phase_id = Some(phase_id.to_string());
                timeline.phase_signals.insert(day_schedule::PhaseSignal {
                    kind: day_schedule::PhaseSignalKind::Opened,
                    phase_id: phase_id.to_string(),
                });
                if let Some(opened_at) = event.payload["phase_opened_at"].as_i64() {
                    timeline
                        .phase_opened_at
                        .insert(phase_id.to_string(), opened_at);
                }
            }
            "ThreadLocked" => {
                let phase_id = event.payload["phase_id"]
                    .as_str()
                    .map(str::to_string)
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
                    timeline.phase_signals.insert(day_schedule::PhaseSignal {
                        kind: day_schedule::PhaseSignalKind::Resolved,
                        phase_id: phase_id.to_string(),
                    });
                }
            }
            _ => {}
        }
    }
    timeline
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

async fn submit_day_event_participation(
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
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventParticipationSubmitted",
            1,
            serde_json::json!({
                "event_id": event_id.as_str(),
                "actor_slot": actor_slot,
                "payload": payload,
                "phase_id": phase_id,
            }),
            ActorId::Slot(actor_slot),
            0,
        )],
    )
    .await
}

async fn withdraw_day_event_participation(
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
    persist(
        tx,
        game,
        &[EventInput::new(
            "DayEventParticipationWithdrawn",
            1,
            serde_json::json!({
                "event_id": event_id.as_str(),
                "actor_slot": actor_slot,
            }),
            ActorId::Slot(actor_slot),
            0,
        )],
    )
    .await
}

async fn resolve_day_event(
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
    apply_day_event_resolution_in_tx(
        tx,
        game,
        event,
        decision,
        winner_slots,
        participant_slot_ids,
        evidence,
        ActorId::Host,
    )
    .await
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
    apply_day_event_resolution_in_tx(
        tx,
        game,
        event,
        decision,
        winner_slots,
        participant_slots,
        evidence,
        ActorId::System,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn apply_day_event_resolution_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    event: projections::DayEventRow,
    decision: game_platform::DayEventDecision,
    winner_slots: Vec<game_platform::SlotId>,
    participant_slots: Vec<game_platform::SlotId>,
    evidence: game_platform::DayEventResolutionEvidence,
    actor: ActorId,
) -> Result<Ack, Reject> {
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

async fn load_day_event(
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

fn unix_seconds_now() -> Result<i64, Reject> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| Reject::Internal(format!("system clock precedes unix epoch: {error}")))?
        .as_secs();
    i64::try_from(seconds).map_err(|_| Reject::Internal("unix timestamp exceeds i64".to_string()))
}

fn effect_spec_validation(error: game_platform::ModelError) -> Reject {
    effect_spec_reject(error.to_string())
}

fn effect_spec_reject(message: impl Into<String>) -> Reject {
    Reject::EffectSpecValidation(message.into())
}

fn persistent_effect_policy<'a>(
    pack: &'a domain::Pack,
    effect: &str,
) -> Result<&'a domain::pack::EffectPolicy, Reject> {
    day_program::persistent_effect_policy(pack, effect)
        .map_err(|issue| effect_spec_reject(issue.message))
}

fn platform_grant_kind(kind: game_platform::GrantKind) -> domain::GrantKind {
    match kind {
        game_platform::GrantKind::ExtraAction => domain::GrantKind::ExtraAction,
        game_platform::GrantKind::Item => domain::GrantKind::Item,
        game_platform::GrantKind::VoteWeight => domain::GrantKind::VoteWeight,
    }
}

fn host_fiat_grant_source(principal_user_id: &str, command_id: Uuid, index: usize) -> String {
    let scope = format!(
        "{:x}",
        Sha256::digest(format!("{principal_user_id}\0{command_id}").as_bytes())
    );
    format!("host_fiat:grant:{scope}:{index}")
}

fn validate_platform_grant(
    pack: &domain::Pack,
    grant: &game_platform::GrantSpec,
) -> Result<(), Reject> {
    day_program::validate_platform_grant(pack, grant)
        .map_err(|issue| effect_spec_reject(issue.message))
}

async fn host_fiat_grant_audience(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    visibility: game_platform::EffectVisibility,
    target: &str,
) -> Result<Vec<String>, Reject> {
    match visibility {
        game_platform::EffectVisibility::Hidden | game_platform::EffectVisibility::Actor => {
            Ok(Vec::new())
        }
        game_platform::EffectVisibility::Target
        | game_platform::EffectVisibility::ActorAndTarget => Ok(vec![target.to_string()]),
        game_platform::EffectVisibility::Public => Ok(projections::slot_state(&mut **tx, game)
            .await?
            .into_iter()
            .filter(|slot| slot.alive)
            .map(|slot| slot.slot_id)
            .collect()),
    }
}

async fn require_effect_target(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    target: &str,
) -> Result<(), Reject> {
    if projections::slot_exists(&mut **tx, game, target).await? {
        Ok(())
    } else {
        Err(Reject::UnknownSlot)
    }
}

async fn current_slot_lifecycle_status(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    slot: &str,
) -> Result<Option<String>, Reject> {
    sqlx::query_scalar::<_, String>(
        "SELECT status FROM slot_state WHERE game_id = $1 AND slot_id = $2",
    )
    .bind(game)
    .bind(slot)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))
}

async fn assign_slot(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    user: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if !projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    if projections::spectator_membership(&mut **tx, game, &user).await? {
        return Err(Reject::InvalidTarget);
    }
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut events = vec![EventInput::new(
        "SlotAssigned",
        1,
        serde_json::json!({ "slot_id": &slot, "user_id": user }),
        ActorId::Host,
        0,
    )];
    if stream.iter().any(|event| event.kind == "GameStarted") {
        if let Some(role_key) = role_assignments_from_stream(&stream)?.get(&slot) {
            events.push(role_pm_declaration(&slot, role_key));
        }
    }
    persist(tx, game, &events).await
}

async fn assign_role(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    role_key: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if !projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack = load_pack(&pack_name_from_stream(&stream)?)?;
    let role = pack
        .roles
        .get(&role_key)
        .ok_or_else(|| Reject::InvalidRole(role_key.clone()))?;
    let mut events = vec![EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({
            "slot_id": &slot,
            "role_key": &role_key,
            "alignment": role.alignment.clone(),
            "role_effects": role.effects.clone(),
        }),
        ActorId::Host,
        0,
    )];
    if stream.iter().any(|event| event.kind == "GameStarted")
        && projections::slot_occupant(&mut **tx, game, &slot)
            .await?
            .is_some()
    {
        events.push(role_pm_declaration(&slot, &role_key));
    }
    persist(tx, game, &events).await
}

// ───────────────────────── slice handlers ─────────────────────────

async fn submit_vote(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    actor_slot: String,
    target: VoteTarget,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;

    // 1. resolve capability (boundary) and require the NARROWEST one.
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;

    // 2. validate domain rules.
    let phase = require_open_day_phase(tx, game).await?;
    require_slot_alive(tx, game, &actor_slot).await?;
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let phase_input = EngineInputBuilder::new(game, &stream, &phase).build()?;
    validate_vote_actor_policy(&phase_input.pack, &phase_input.state, &actor_slot)?;
    validate_vote_policy_target(&phase_input.pack.vote, &actor_slot, &target)?;
    let target_str = validate_target(tx, game, &target).await?;

    // 3. produce events.
    let ev = EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": actor_slot, "target": target_str, "phase_id": phase }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    let mut events = vec![ev];
    if let Some(lock_ev) = hammer_lock_event(&phase_input, &actor_slot, &target_str)? {
        events.push(lock_ev);
    }

    // 4. persist (one tx; Conflict → StreamConflict).
    persist(tx, game, &events).await
}

async fn withdraw_vote(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    actor_slot: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    // RULING: withdraw is gated on the SAME open-phase rule as submit — you may
    // only change your ballot while the phase is votable (doc 01 phases partition
    // votes; doc under-specifies, decided here). The withdrawal carries
    // { actor, phase_id } (doc 10 says { action_id } but the running tally is
    // ballot-keyed per the Phase-3 ruling, so actor+phase is the correct key).
    let phase = require_open_day_phase(tx, game).await?;
    require_slot_alive(tx, game, &actor_slot).await?;
    let ev = EventInput::new(
        "VoteWithdrawn",
        1,
        serde_json::json!({ "actor": actor_slot, "phase_id": phase }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );
    persist(tx, game, &[ev]).await
}

async fn submit_action(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    action_id: String,
    actor_slot: String,
    template_id: String,
    targets: Vec<String>,
    grant_id: Option<String>,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    if action_id.trim().is_empty() || template_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if grant_id.as_deref().is_some_and(|id| id.trim().is_empty()) {
        return Err(Reject::InvalidTarget);
    }

    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    let phase = require_open_phase(tx, game).await?;
    require_slot_alive(tx, game, &actor_slot).await?;
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack_name = pack_name_from_stream(&stream)?;
    let pack = load_pack(&pack_name)?;
    let action_window = validate_action_submission(
        tx,
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
        let mut phase_input = EngineInputBuilder::new(game, &stream, &phase).build()?;
        let submission = domain::Submission {
            action_id: action_id.clone(),
            actor: actor_slot.clone(),
            template_id: template_id.clone(),
            targets: targets.clone(),
            phase_id: phase.clone(),
            submitted_at: phase_input.logical_time(),
            withdrawn: false,
            metadata: metadata_from_payload(&payload),
        };
        phase_input.submissions = vec![submission];
        phase_input.day_phase_inputs = domain::DayPhaseInputs::default();
        let output = domain::resolve_instant(phase_input.resolve_input(EngineRunKind::Instant {
            action_id: &action_id,
        }));
        domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
            .map_err(|e| Reject::Internal(format!("invalid instant resolution result: {e}")))?;
        domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
            .map_err(|e| Reject::Internal(format!("invalid instant resolution trace: {e}")))?;
        events.push(EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(output.applied).map_err(|e| Reject::Internal(e.to_string()))?,
            ActorId::System,
            phase_input.next_stream_seq + 1,
        ));
        events.push(EventInput::new(
            "ResolutionTrace",
            1,
            serde_json::to_value(output.trace).map_err(|e| Reject::Internal(e.to_string()))?,
            ActorId::System,
            phase_input.next_stream_seq + 2,
        ));
    }
    persist(tx, game, &events).await
}

async fn withdraw_action(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    action_id: String,
    actor_slot: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    if action_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }

    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    let phase = require_open_phase(tx, game).await?;
    require_slot_alive(tx, game, &actor_slot).await?;
    if !active_action_exists(tx, game, &phase, &actor_slot, &action_id).await? {
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
    persist(tx, game, &[ev]).await
}

async fn set_post_policy(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    channel_id: String,
    allow_media_only: bool,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    if channel_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let occurred_at = next_stream_logical_time(&stream);
    let ev = EventInput::new(
        "PostPolicyChanged",
        1,
        serde_json::json!({
            "channel_id": channel_id,
            "allow_media_only": allow_media_only,
        }),
        ActorId::Host,
        occurred_at,
    );
    persist(tx, game, &[ev]).await
}

struct SubmitPostRequest {
    game: Uuid,
    channel_id: String,
    actor_slot: String,
    body: String,
    media: Vec<model::ThreadPostMedia>,
}

const MAX_GAME_POST_BODY_BYTES: usize = 50 * 1024;

fn validate_game_post_body(body: &str) -> Result<(), Reject> {
    if body.len() > MAX_GAME_POST_BODY_BYTES {
        return Err(Reject::InvalidTarget);
    }
    Ok(())
}

async fn submit_post(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    request: SubmitPostRequest,
) -> Result<Ack, Reject> {
    let SubmitPostRequest {
        game,
        channel_id,
        actor_slot,
        body,
        media,
    } = request;
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    // The fixed spectator room has no player-authoring path. It only accepts
    // host-authored notices through PublishSpectatorPost, before any
    // client-supplied slot or capability is inspected.
    if channel_id == "spectator" {
        return Err(Reject::NotAuthorized);
    }
    require_slot_occupant(tx, game, &actor_slot, &caps).await?;
    require_channel_post_access(game, &channel_id, &caps)?;
    require_channel_actor_can_post(tx, game, &channel_id, &actor_slot).await?;
    validate_thread_post_media(&media)?;
    validate_game_post_body(&body)?;
    if body.trim().is_empty() {
        let policy = projections::post_policy(&mut **tx, game, &channel_id).await?;
        if media.is_empty() || !policy.allow_media_only {
            return Err(Reject::InvalidTarget);
        }
    }
    // A post is attributed to the SLOT (doc 01: post authorship attaches to the
    // slot, not the user). `slot_or_user` carries the slot id so authorship
    // survives a replacement. Phase id is recorded for partitioning.
    let phase = current_phase(tx, game).await?.unwrap_or_default();
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let occurred_at = next_stream_logical_time(&stream);
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "slot_or_user": { "slot": actor_slot.clone() },
        "body": body,
        "phase_id": phase,
    });
    if !media.is_empty() {
        payload["media"] = serde_json::to_value(media).expect("thread post media serializes");
    }
    let ev = EventInput::new(
        "PostSubmitted",
        1,
        payload,
        ActorId::Slot(actor_slot.clone()),
        occurred_at,
    );
    persist(tx, game, &[ev]).await
}

async fn publish_spectator_post(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    body: String,
    media: Vec<ThreadPostMedia>,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Narrative).await?;
    validate_game_post_body(&body)?;
    validate_thread_post_media(&media)?;
    if body.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    let phase = current_phase(tx, game).await?.unwrap_or_default();
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let occurred_at = next_stream_logical_time(&stream);
    let mut payload = serde_json::json!({
        "channel_id": "spectator",
        "slot_or_user": { "user": "host" },
        "body": body,
        "phase_id": phase,
    });
    if !media.is_empty() {
        payload["media"] = serde_json::to_value(media).expect("thread post media serializes");
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            payload,
            ActorId::Host,
            occurred_at,
        )],
    )
    .await
}

fn validate_thread_post_media(media: &[model::ThreadPostMedia]) -> Result<(), Reject> {
    if media.len() > MAX_THREAD_POST_MEDIA {
        return Err(Reject::InvalidTarget);
    }
    let mut content_ids = BTreeSet::new();
    for item in media {
        if !valid_media_content_id(&item.content_id)
            || !content_ids.insert(item.content_id.as_str())
            || item.alt.trim().is_empty()
            || item.alt.len() > MAX_THREAD_POST_MEDIA_ALT_BYTES
            || item.variants.len() != REQUIRED_THREAD_POST_MEDIA_VARIANTS.len()
        {
            return Err(Reject::InvalidTarget);
        }
        for kind in REQUIRED_THREAD_POST_MEDIA_VARIANTS {
            let Some(variant) = item.variants.get(kind) else {
                return Err(Reject::InvalidTarget);
            };
            if variant.width == 0 || variant.height == 0 {
                return Err(Reject::InvalidTarget);
            }
        }
    }
    Ok(())
}

fn valid_media_content_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

async fn publish_votecount(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;
    let phase = current_phase(tx, game).await?.ok_or(Reject::PhaseLocked)?;
    let rows = projections::votecount(&mut **tx, game)
        .await?
        .into_iter()
        .filter(|row| row.phase_id == phase)
        .collect::<Vec<_>>();
    let body = official_votecount_body(&phase, &rows);
    if official_votecount_already_published(tx, game, &phase, &body).await? {
        return Err(Reject::InvalidTarget);
    }
    let ev = EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "main",
            "slot_or_user": { "user": "host" },
            "body": body,
            "phase_id": phase,
        }),
        ActorId::Host,
        0,
    );
    persist(tx, game, &[ev]).await
}

async fn official_votecount_already_published(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase: &str,
    body: &str,
) -> Result<bool, Reject> {
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM thread_view \
         WHERE game_id = $1 \
           AND channel_id = 'main' \
           AND author_user = 'host' \
           AND phase_id = $2 \
           AND body = $3",
    )
    .bind(game)
    .bind(phase)
    .bind(body)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;
    Ok(count > 0)
}

fn official_votecount_body(phase: &str, rows: &[projections::VoteCountRow]) -> String {
    let mut body = format!("Official votecount for {phase}");
    if rows.is_empty() {
        body.push_str("\n\nNo active ballots.");
        return body;
    }

    for row in rows {
        body.push_str(&format!("\n- {}: {}", row.candidate_slot, row.count));
    }
    body
}

async fn extend_deadline(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    phase: String,
    at: i64,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Deadline).await?;
    let current_phase = require_open_phase(tx, game).await?;
    if current_phase != phase {
        return Err(Reject::PhaseLocked);
    }
    let ev = EventInput::new(
        "DeadlineExtended",
        1,
        serde_json::json!({ "phase_id": phase, "at": at }),
        ActorId::Host,
        0,
    );
    persist(tx, game, &[ev]).await
}

/// The irreversible mechanic: swap the human behind a STABLE `SlotId`. The slot
/// id is UNCHANGED — only the occupant mapping moves — so the slot's votes,
/// posts, role, and lifecycle (all keyed by slot_id) are preserved. Host-team
/// (Replacement class); primary host always allowed.
async fn process_replacement(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    outgoing_user: String,
    incoming_user: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Replacement).await?;

    if !projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    // Validate the outgoing user really is the CURRENT occupant (an honest,
    // auditable replacement). If not, the request is targeting a stale mapping.
    match projections::slot_occupant(&mut **tx, game, &slot).await? {
        Some(current) if current == outgoing_user => {}
        Some(_) => return Err(Reject::InvalidTarget),
        None => return Err(Reject::InvalidTarget),
    }
    if projections::spectator_membership(&mut **tx, game, &incoming_user).await? {
        return Err(Reject::InvalidTarget);
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
    persist(tx, game, &[ev]).await
}

/// Host command: close the current phase by reconstructing the engine input from
/// the canonical event stream, running the pure resolver, and persisting
/// `ResolutionApplied` / `ResolutionTrace` plus a durable phase lock through
/// the normal append+projection tx.
async fn resolve_phase(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    seed: u64,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or(Reject::PhaseLocked)?;
    if phase.locked {
        return Err(Reject::PhaseLocked);
    }

    let stream = eventstore::load_stream_in_tx(tx, game)
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

    let phase_input = EngineInputBuilder::new(game, &stream, &phase.phase_id).build()?;
    let output = domain::resolve(phase_input.resolve_input(EngineRunKind::ResolvePhase { seed }));
    domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution result: {e}")))?;
    domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution trace: {e}")))?;
    let applied_ev = EventInput::new(
        "ResolutionApplied",
        1,
        serde_json::to_value(output.applied).map_err(|e| Reject::Internal(e.to_string()))?,
        ActorId::System,
        phase_input.next_stream_seq,
    );
    let trace_ev = EventInput::new(
        "ResolutionTrace",
        1,
        serde_json::to_value(output.trace).map_err(|e| Reject::Internal(e.to_string()))?,
        ActorId::System,
        phase_input.next_stream_seq,
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
        phase_input.next_stream_seq,
    );
    let mut events = vec![applied_ev, trace_ev];
    events.extend(private_channel_revocations(
        &phase_input.pack,
        &output.post_state,
    ));
    events.push(lock_ev);
    persist(tx, game, &events).await
}

async fn control_ita_session(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    session_id: String,
    control: ItaSessionControlKind,
    message: Option<String>,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    if session_id.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if message.as_deref().is_some_and(|msg| msg.trim().is_empty()) {
        return Err(Reject::InvalidTarget);
    }
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::ItaControl).await?;
    let phase = require_open_day_phase(tx, game).await?;
    let phase_number = phase_number(&phase)?;

    let pack = load_pack(&current_pack_name(tx, game).await?)?;
    if !pack.ita.lifecycle.allows(control) {
        return Err(Reject::InvalidTarget);
    }
    let Some(session) = pack
        .ita
        .sessions
        .iter()
        .find(|session| session.session_id == session_id)
    else {
        return Err(Reject::InvalidTarget);
    };
    if session.day.is_some_and(|day| day != phase_number) {
        return Err(Reject::InvalidTarget);
    }

    let mut payload = serde_json::json!({
        "phase_id": phase,
        "session_id": session_id,
        "control": control,
    });
    if let Some(message) = message {
        payload["message"] = serde_json::Value::String(message);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "ItaSessionControlRecorded",
            1,
            payload,
            ActorId::Host,
            0,
        )],
    )
    .await
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
    let stored_public_resolution: domain::HostPromptPublicResolution =
        serde_json::from_value(resolved.payload["public_resolution"].clone()).map_err(|e| {
            Reject::Internal(format!(
                "malformed HostPromptResolved public_resolution: {e}"
            ))
        })?;

    let effect = host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        prefix,
    )?;
    let rebuilt_public_resolution = host_prompt_public_resolution(&prompt, &effect);
    if stored_public_resolution != rebuilt_public_resolution {
        return Err(Reject::Internal(
            "HostPromptResolved public_resolution does not match rebuilt prompt effect".to_string(),
        ));
    }

    match effect {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => Ok(Some(build_pk_prompt_resolution(
            &pack,
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
                public_resolution: None,
                resolved_by: None,
                resolved_at: None,
            });
        }
    }

    Err(Reject::UnknownPrompt)
}

fn build_pk_prompt_resolution(
    pack: &domain::Pack,
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
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    prompt_id: String,
    decision: HostPromptDecision,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::HostPromptResolve).await?;

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
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack = load_pack(&pack_name_from_stream(&stream)?)?;
    let next_seq = stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);
    let resolved_by = principal.user_id().to_string();
    let decision_json =
        serde_json::to_value(&decision).map_err(|e| Reject::Internal(e.to_string()))?;
    let effect = host_prompt_effect(
        &pack.host_prompt_resolution_effects,
        &pack.phases,
        &prompt,
        &decision,
        &stream,
    )?;
    let public_resolution = host_prompt_public_resolution(&prompt, &effect);
    let phase_opened_at = unix_seconds_now()?;
    let resolved_ev = EventInput::new(
        "HostPromptResolved",
        1,
        serde_json::json!({
            "prompt_id": prompt.prompt_id,
            "phase_id": prompt.phase_id,
            "kind": prompt.kind,
            "reason": prompt.reason,
            "decision": decision_json,
            "public_resolution": public_resolution,
            "resolved_by": resolved_by,
        }),
        ActorId::Host,
        next_seq,
    );

    let mut events = vec![resolved_ev];
    match effect {
        HostPromptEffect::PkKill {
            selected,
            contenders,
        } => {
            require_slot_alive(tx, game, &selected).await?;
            let rebuilt = build_pk_prompt_resolution(
                &pack,
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
                phase_opened_at,
            ));
        }
        HostPromptEffect::AcknowledgeOnly => {}
    }

    persist(tx, game, &events).await
}

fn host_prompt_effect(
    policies: &[HostPromptResolutionEffectPolicy],
    phase_policy: &domain::pack::PhasePolicy,
    prompt: &projections::HostPromptRow,
    decision: &HostPromptDecision,
    stream: &[eventstore::StoredEvent],
) -> Result<HostPromptEffect, Reject> {
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
            let phase_id = next_revote_phase_id(stream, &prompt.phase_id);
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
            let phase_id = no_majority_advance_night_target(&prompt.phase_id)?;
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
            let (skipped_phase_id, phase_id) = skip_next_day_target(&prompt.phase_id)?;
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
    phase_id: String,
    reason: &'static str,
    skipped_phase_id: Option<String>,
    occurred_at: i64,
    phase_opened_at: i64,
) -> EventInput {
    let payload = serde_json::to_value(HostPromptPhaseControlPayload {
        phase_id,
        phase_opened_at,
        source_prompt_id: prompt.prompt_id.clone(),
        source_phase_id: prompt.phase_id.clone(),
        reason,
        skipped_phase_id,
    })
    .expect("host prompt phase-control payload is serializable");
    EventInput::new("PhaseAdvanced", 1, payload, ActorId::Host, occurred_at)
}

fn next_revote_phase_id(stream: &[eventstore::StoredEvent], source_phase_id: &str) -> String {
    let base_phase_id = revote_base_phase_id(source_phase_id);
    let prefix = format!("{base_phase_id}R");
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

fn revote_base_phase_id(source_phase_id: &str) -> &str {
    if let Some((base, suffix)) = source_phase_id.split_once('R') {
        if !base.is_empty() && suffix.parse::<u32>().is_ok() {
            return base;
        }
    }
    source_phase_id
}

fn no_majority_advance_night_target(source_phase_id: &str) -> Result<String, Reject> {
    let base_phase_id = revote_base_phase_id(source_phase_id);
    let number = phase_number(base_phase_id)?;
    Ok(format!("N{:02}", number))
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

fn pack_private_channel_declarations(
    pack: &domain::Pack,
    stream: &[eventstore::StoredEvent],
) -> Result<Vec<EventInput>, Reject> {
    if !pack.private_channels.enabled {
        return Ok(Vec::new());
    }
    let assignments = role_assignments_from_stream(stream)?;
    let mut events = Vec::new();
    for group in &pack.private_channels.groups {
        let mut source_slots = Vec::new();
        let mut members = Vec::new();
        for (slot, role) in &assignments {
            match group.kind {
                domain::pack::PrivateChannelKind::Mason
                | domain::pack::PrivateChannelKind::Neighbor => {
                    if group.roles.iter().any(|allowed| allowed == role) {
                        members.push(serde_json::json!({
                            "slot_id": slot,
                            "role_key": role,
                        }));
                    }
                }
                domain::pack::PrivateChannelKind::FactionDayChat => {
                    if group.enabled_by_roles.iter().any(|allowed| allowed == role) {
                        source_slots.push(slot.clone());
                    }
                    if group.excluded_roles.iter().any(|excluded| excluded == role) {
                        continue;
                    }
                    if let Some(alignment) = pack
                        .roles
                        .get(role)
                        .and_then(|role| role.alignment.as_ref())
                    {
                        if group
                            .member_alignments
                            .iter()
                            .any(|allowed| allowed == alignment)
                        {
                            members.push(serde_json::json!({
                                "slot_id": slot,
                                "role_key": role,
                            }));
                        }
                    }
                }
            }
        }
        if group.kind == domain::pack::PrivateChannelKind::FactionDayChat && source_slots.is_empty()
        {
            continue;
        }
        if members.len() < 2 {
            continue;
        }
        members.sort_by(|a, b| {
            a["slot_id"]
                .as_str()
                .unwrap_or_default()
                .cmp(b["slot_id"].as_str().unwrap_or_default())
        });
        source_slots.sort();
        events.push(EventInput::new(
            "PrivateChannelDeclared",
            1,
            serde_json::json!({
                "channel_id": format!("private:{}", group.id),
                "group_id": group.id,
                "kind": &group.kind,
                "roles": &group.roles,
                "excluded_roles": &group.excluded_roles,
                "member_alignments": &group.member_alignments,
                "enabled_by_roles": &group.enabled_by_roles,
                "active_while_source_alive": group.active_while_source_alive,
                "source_slots": source_slots,
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

fn role_pm_declarations(stream: &[eventstore::StoredEvent]) -> Result<Vec<EventInput>, Reject> {
    let roles = role_assignments_from_stream(stream)?;
    let occupied = occupied_slots_from_stream(stream)?;
    Ok(roles
        .into_iter()
        .filter(|(slot_id, _)| occupied.contains(slot_id))
        .map(|(slot_id, role_key)| role_pm_declaration(&slot_id, &role_key))
        .collect())
}

fn role_pm_declaration(slot_id: &str, role_key: &str) -> EventInput {
    EventInput::new(
        "PrivateChannelDeclared",
        1,
        serde_json::json!({
            "channel_id": domain::role_pm_channel_id(slot_id),
            "group_id": "role_pm",
            "kind": "RolePm",
            "members": [{
                "slot_id": slot_id,
                "role_key": role_key,
            }],
            "reveals_alignment": "None",
            "source": "engine.role_pm",
        }),
        ActorId::Host,
        0,
    )
}

fn occupied_slots_from_stream(
    stream: &[eventstore::StoredEvent],
) -> Result<BTreeSet<String>, Reject> {
    let mut occupied = BTreeSet::new();
    for event in stream {
        match event.kind.as_str() {
            "SlotAssigned" | "ReplacementCompleted" => {
                occupied.insert(str_payload(event, "slot_id")?);
            }
            _ => {}
        }
    }
    Ok(occupied)
}

fn private_channel_revocations(
    pack: &domain::Pack,
    state: &domain::StateSnapshot,
) -> Vec<EventInput> {
    if !pack.private_channels.enabled {
        return Vec::new();
    }
    let mut events = Vec::new();
    for group in &pack.private_channels.groups {
        if group.kind != domain::pack::PrivateChannelKind::FactionDayChat
            || !group.active_while_source_alive
        {
            continue;
        }
        let channel_id = format!("private:{}", group.id);
        if !state
            .private_channels
            .iter()
            .any(|record| record.channel_id == channel_id)
        {
            continue;
        }
        let source_alive = state.slots.iter().any(|slot| {
            slot.is_alive()
                && group
                    .enabled_by_roles
                    .iter()
                    .any(|role| role == &slot.role_key)
        });
        if source_alive {
            continue;
        }
        events.push(EventInput::new(
            "PrivateChannelRevoked",
            1,
            serde_json::json!({
                "channel_id": channel_id,
                "group_id": group.id,
                "kind": &group.kind,
                "reason": "source_role_not_alive",
                "source": format!("pack.private_channels.{}", group.id),
            }),
            ActorId::System,
            0,
        ));
    }
    events
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

async fn current_pack_name(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<String, Reject> {
    let stream = eventstore::load_stream_in_tx(tx, game)
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
        pack_name: phase_input.pack_name,
        state: phase_input.state,
        submissions: phase_input.submissions,
        day_phase_inputs: phase_input.day_phase_inputs,
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
    let snapshot = EngineInputBuilder::new(game, &stream, phase_id)
        .build()?
        .state;
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
    let mut buffered_ita_shots = Vec::new();
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
                        source_action: Some("role-assignment".to_string()),
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
                    buffered_ita_shots: buffered_ita_shots.clone(),
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
                buffered_ita_shots = folded.buffered_ita_shots;
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
            "PrivateChannelRevoked" => {
                let channel_id = str_payload(ev, "channel_id")?;
                private_channels.retain(|record: &domain::PrivateChannelRecord| {
                    record.channel_id != channel_id
                });
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
                if duration == domain::EffectDuration::Persistent {
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
                    effect_records
                        .retain(|record| record.effect != effect || record.target != target);
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
            "ActionGranted" => {
                let inner: domain::InnerEvent = serde_json::from_value(serde_json::json!({
                    "kind": ev.kind.clone(),
                    "payload": ev.payload.clone(),
                }))
                .map_err(|error| {
                    Reject::Internal(format!(
                        "malformed top-level ActionGranted at stream #{}: {error}",
                        ev.stream_seq
                    ))
                })?;
                let domain::InnerEvent::ActionGranted {
                    grant_id,
                    grant_option,
                    kind,
                    actor,
                    target,
                    source_action,
                    uses,
                    vote_weight,
                    phase_id: granted_phase_id,
                    phase_kind: granted_phase_kind,
                    phase_number: granted_phase_number,
                } = inner
                else {
                    unreachable!("ActionGranted payload decoded to another inner event")
                };
                action_grants.push(domain::ActionGrantRecord {
                    grant_id,
                    grant_option,
                    kind,
                    actor,
                    target,
                    source_action,
                    uses,
                    vote_weight,
                    phase_id: granted_phase_id,
                    phase_kind: granted_phase_kind,
                    phase_number: granted_phase_number,
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
        buffered_ita_shots,
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

fn next_stream_logical_time(stream: &[eventstore::StoredEvent]) -> i64 {
    stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1)
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
    let mut ita_session_controls = Vec::new();
    for ev in stream {
        if ev.kind == "ItaSessionControlRecorded"
            && ev.payload["phase_id"].as_str() == Some(&state.phase_id)
        {
            let control = serde_json::from_value::<domain::ItaSessionControlKind>(
                ev.payload["control"].clone(),
            )
            .map_err(|e| Reject::Internal(format!("malformed ITA session control: {e}")))?;
            ita_session_controls.push(domain::ItaSessionControlInput {
                session_id: str_payload(ev, "session_id")?,
                control,
                message: optional_str_payload(ev, "message"),
                recorded_at: ev.stream_seq as u64,
            });
            continue;
        }
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

    Ok(domain::DayPhaseInputs {
        night_victims,
        ita_session_controls,
    })
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
async fn require_game(tx: &mut Transaction<'_, Postgres>, game: Uuid) -> Result<(), Reject> {
    if projections::game_exists(&mut **tx, game).await? {
        command_runtime_checkpoint(CommandRuntimeCheckpoint::GameValidated).await;
        Ok(())
    } else {
        Err(Reject::UnknownGame)
    }
}

async fn resolve_capabilities_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
) -> Result<CapabilitySet, Reject> {
    let capabilities = caps::resolve_in_tx(tx, principal, game).await?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::CapabilityResolved).await;
    Ok(capabilities)
}

/// Least-authority gate: require `cap`, mapping a miss to `deny`.
fn require(caps: &CapabilitySet, cap: &Capability, deny: Reject) -> Result<(), Reject> {
    if caps.grants(cap) {
        Ok(())
    } else {
        Err(deny)
    }
}

/// Primary host (or global operator via HostOf grant). Never subject to cohost denylist.
fn require_host_structural(caps: &CapabilitySet, game: Uuid) -> Result<(), Reject> {
    require(caps, &Capability::HostOf(game), Reject::NotHost)
}

/// Game-run mutator: host always; cohost unless `class` is in the game's create-time denylist.
async fn require_game_run(
    tx: &mut Transaction<'_, Postgres>,
    caps: &CapabilitySet,
    game: Uuid,
    class: CohostPermissionClass,
) -> Result<(), Reject> {
    if caps.grants(&Capability::HostOf(game)) {
        return Ok(());
    }
    if caps.grants(&Capability::CohostOf(game)) {
        let denied = projections::cohost_denied_classes(&mut **tx, game).await?;
        if denied.iter().any(|d| d == class.as_str()) {
            return Err(Reject::CohostPermissionDenied(class.as_str().to_string()));
        }
        return Ok(());
    }
    Err(Reject::NotHost)
}

/// The principal must be the slot's CURRENT occupant. We distinguish "this slot
/// isn't yours" (`NotYourSlot`) from "no such slot" (`UnknownSlot`): if the slot
/// exists but the capability is absent it is `NotYourSlot`.
async fn require_slot_occupant(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    slot: &str,
    caps: &CapabilitySet,
) -> Result<(), Reject> {
    if !projections::slot_exists(&mut **tx, game, slot).await? {
        return Err(Reject::UnknownSlot);
    }
    if caps.grants(&Capability::SlotOccupant(slot.to_string())) {
        Ok(())
    } else {
        Err(Reject::NotYourSlot)
    }
}

fn require_channel_post_access(
    game: Uuid,
    channel_id: &str,
    caps: &CapabilitySet,
) -> Result<(), Reject> {
    if channel_id == "main"
        || caps.grants(&Capability::HostOf(game))
        || caps.grants(&Capability::CohostOf(game))
        || caps.grants(&Capability::ChannelMember(channel_id.to_string()))
        || (channel_id == "dead" && caps.grants(&Capability::DeadViewer(game)))
    {
        Ok(())
    } else {
        Err(Reject::NotAuthorized)
    }
}

async fn require_channel_actor_can_post(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    channel_id: &str,
    slot: &str,
) -> Result<(), Reject> {
    if channel_id == "dead" {
        return match projections::slot_alive(&mut **tx, game, slot).await? {
            Some(false) => Ok(()),
            Some(true) => Err(Reject::NotAuthorized),
            None => Err(Reject::UnknownSlot),
        };
    }

    require_slot_can_post(tx, game, slot).await
}

/// The current phase must exist and be UNLOCKED. Returns the phase id.
async fn require_open_phase(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<String, Reject> {
    match projections::phase_state(&mut **tx, game).await? {
        Some(ps) if ps.locked => Err(Reject::PhaseLocked),
        Some(ps) => {
            if phase_has_pending_prompt(tx, game, &ps.phase_id).await? {
                Err(Reject::PhaseLocked)
            } else {
                Ok(ps.phase_id)
            }
        }
        None => Err(Reject::PhaseLocked), // no phase open → cannot act
    }
}

async fn phase_has_pending_prompt(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &str,
) -> Result<bool, Reject> {
    Ok(projections::host_prompts(&mut **tx, game)
        .await?
        .into_iter()
        .any(|prompt| prompt.phase_id == phase_id && prompt.status == "pending"))
}

/// Votes are legal only while the current open phase is a Day window.
async fn require_open_day_phase(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<String, Reject> {
    let phase = require_open_phase(tx, game).await?;
    if phase_kind(&phase)? != domain::pack::PhaseKind::Day {
        return Err(Reject::PhaseLocked);
    }
    Ok(phase)
}

/// The current phase id, if any (no lock check — for post attribution).
async fn current_phase(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<Option<String>, Reject> {
    Ok(projections::phase_state(&mut **tx, game)
        .await?
        .map(|p| p.phase_id))
}

async fn require_slot_alive(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    slot: &str,
) -> Result<(), Reject> {
    match projections::slot_alive(&mut **tx, game, slot).await? {
        Some(true) => Ok(()),
        Some(false) => Err(Reject::SlotNotAlive),
        None => Err(Reject::UnknownSlot),
    }
}

async fn require_slot_can_post(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    slot: &str,
) -> Result<(), Reject> {
    match projections::slot_alive(&mut **tx, game, slot).await? {
        Some(true) => Ok(()),
        Some(false) => {
            let pack = load_pack(&current_pack_name(tx, game).await?)?;
            if !pack.treestump_policy.enabled {
                return Err(Reject::SlotNotAlive);
            }
            let tags = projections::slot_status_tags(&mut **tx, game, slot).await?;
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
    tx: &mut Transaction<'_, Postgres>,
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
    let slots = projections::slot_state(&mut **tx, game).await?;
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
            return Err(Reject::InvalidTarget);
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
    if template.constraints.x_shots.is_some() {
        let counter_id = action_counter_id(&template.id);
        let exhausted = projections::action_counters(&mut **tx, game)
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
        let on_cooldown = projections::action_counters(&mut **tx, game)
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
            let exhausted = projections::action_counters(&mut **tx, game)
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
        let exhausted = projections::action_counters(&mut **tx, game)
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
        let repeated = projections::action_history(&mut **tx, game)
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
        tx,
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
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &str,
    phase_number: u32,
    actor_slot: &str,
    template_id: &str,
    template: &ActionTemplate,
    grant_id: Option<&str>,
    source: ActionSource,
) -> Result<(), Reject> {
    let active = active_actions_for_actor_phase_in_tx(tx, game, phase_id, actor_slot).await?;
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

async fn active_actions_for_actor_phase_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<BTreeMap<String, ActiveAction>, Reject> {
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    Ok(active_actions_from_stream(stream, phase_id, actor_slot))
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
    Ok(active_actions_from_stream(stream, phase_id, actor_slot))
}

fn active_actions_from_stream(
    stream: Vec<eventstore::StoredEvent>,
    phase_id: &str,
    actor_slot: &str,
) -> BTreeMap<String, ActiveAction> {
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
                            targets: ev.payload["targets"]
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
    active
}

pub async fn active_action_templates_for_actor_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<BTreeSet<String>, Reject> {
    Ok(
        active_actions_for_actor_phase(pool, game, phase_id, actor_slot)
            .await?
            .into_values()
            .map(|action| action.template_id)
            .collect(),
    )
}

/// A night action the actor has currently submitted this phase, carrying the
/// targets it was submitted against. Survives until withdrawn; feeds the player
/// command-state `current_actions` surface so the client can render the pick and
/// build a `WithdrawAction`. Ordered by `action_id` (the `BTreeMap` key) so the
/// view is deterministic across reads and replays.
#[derive(Debug, Clone)]
pub struct CurrentAction {
    pub action_id: String,
    pub template_id: String,
    pub targets: Vec<String>,
    pub grant_id: Option<String>,
}

pub async fn active_actions_view_for_actor_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<Vec<CurrentAction>, Reject> {
    Ok(
        active_actions_for_actor_phase(pool, game, phase_id, actor_slot)
            .await?
            .into_iter()
            .map(|(action_id, action)| CurrentAction {
                action_id,
                template_id: action.template_id,
                targets: action.targets,
                grant_id: action.grant_id,
            })
            .collect(),
    )
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
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &str,
    actor_slot: &str,
    action_id: &str,
) -> Result<bool, Reject> {
    let stream = eventstore::load_stream_in_tx(tx, game)
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

/// A vote target is `no_lynch` or a currently alive slot in this game.
async fn validate_target(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    target: &VoteTarget,
) -> Result<String, Reject> {
    match target {
        VoteTarget::NoLynch => Ok("no_lynch".to_string()),
        VoteTarget::Slot(s) => match projections::slot_alive(&mut **tx, game, s).await? {
            Some(true) => Ok(s.clone()),
            Some(false) | None => Err(Reject::InvalidTarget),
        },
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
    phase_input: &EnginePhaseInput,
    actor_slot: &str,
    target: &str,
) -> Result<Option<EventInput>, Reject> {
    if !phase_input.pack.vote.hammer {
        return Ok(None);
    }

    if phase_input.phase_kind != domain::pack::PhaseKind::Day {
        return Ok(None);
    }
    let mut preview_input = phase_input.clone();
    preview_input.submissions.push(domain::Submission {
        action_id: format!("vote:{}:{actor_slot}", preview_input.next_stream_seq),
        actor: actor_slot.to_string(),
        template_id: "day_vote".to_string(),
        targets: vec![target.to_string()],
        phase_id: preview_input.phase_id.clone(),
        submitted_at: preview_input.logical_time(),
        withdrawn: false,
        metadata: BTreeMap::new(),
    });
    let output = domain::resolve(preview_input.resolve_input(EngineRunKind::HammerPreview));
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
                "phase_id": phase_input.phase_id,
                "reason": "hammer",
                "source": "vote_hammer",
                "actor": actor_slot,
                "target": target
            }),
            ActorId::System,
            phase_input.next_stream_seq,
        )
    }))
}

async fn claim_or_replay_receipt_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    receipt: &ReceiptClaim,
) -> Result<Option<Ack>, Reject> {
    let result = sqlx::query(
        "INSERT INTO command_receipt \
         (principal_user_id, command_id, command_fingerprint, stream_id, stream_seqs) \
         VALUES ($1, $2, $3, $4, ARRAY[]::BIGINT[]) \
         ON CONFLICT (principal_user_id, command_id) DO NOTHING",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .bind(&receipt.command_fingerprint)
    .bind(game)
    .execute(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    if result.rows_affected() == 1 {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT command_fingerprint, stream_seqs FROM command_receipt \
         WHERE principal_user_id = $1 AND command_id = $2",
    )
    .bind(&receipt.principal_user_id)
    .bind(receipt.command_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    let fingerprint: Vec<u8> = row.get("command_fingerprint");
    if fingerprint != receipt.command_fingerprint {
        return Err(Reject::CommandIdConflict);
    }
    Ok(Some(Ack {
        stream_seqs: row.get("stream_seqs"),
    }))
}

async fn store_receipt_ack_in_tx(
    tx: &mut Transaction<'_, Postgres>,
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

/// Append and synchronously fold projections inside the command transaction.
/// The caller owns receipt claim/ack storage and the single final commit.
async fn persist(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    events: &[EventInput],
) -> Result<Ack, Reject> {
    let audit = COMMAND_AUDIT_CONTEXT
        .try_with(Clone::clone)
        .map_err(|_| Reject::Internal("command audit context missing at append".to_string()))?;
    let mut stamped = Vec::with_capacity(events.len());
    for event in events {
        let mut event = event.clone();
        event.causation_id.get_or_insert(audit.command_id);
        let meta = event.meta.as_object_mut().ok_or_else(|| {
            Reject::Internal(format!("event {} audit meta must be an object", event.kind))
        })?;
        meta.insert(
            "principal_user_id".to_string(),
            serde_json::Value::String(audit.principal_user_id.clone()),
        );
        meta.insert(
            "command_id".to_string(),
            serde_json::Value::String(audit.command_id.to_string()),
        );
        meta.insert(
            "command_kind".to_string(),
            serde_json::Value::String(audit.command_kind.clone()),
        );
        meta.insert(
            "authority_used".to_string(),
            serde_json::Value::String(audit.authority_used.clone()),
        );
        meta.entry("source".to_string())
            .or_insert_with(|| serde_json::Value::String(audit.request_source.to_string()));
        stamped.push(event);
    }

    let stored = match append_and_project_in_tx(tx, game, &stamped).await {
        Ok(stored) => stored,
        Err(ProjectionError::Store(eventstore::StoreError::Conflict { .. })) => {
            return Err(Reject::StreamConflict);
        }
        Err(e) => return Err(Reject::Internal(e.to_string())),
    };
    command_runtime_checkpoint(CommandRuntimeCheckpoint::EventsProjected).await;
    Ok(Ack::from_seqs(
        stored.iter().map(|stored| stored.stream_seq).collect(),
    ))
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

    #[test]
    fn official_votecount_body_is_projection_derived_and_deterministic() {
        let rows = vec![
            projections::VoteCountRow {
                game_id: Uuid::nil(),
                phase_id: "D01".to_string(),
                candidate_slot: "slot_2".to_string(),
                count: 4,
            },
            projections::VoteCountRow {
                game_id: Uuid::nil(),
                phase_id: "D01".to_string(),
                candidate_slot: "no_lynch".to_string(),
                count: 1,
            },
        ];

        assert_eq!(
            official_votecount_body("D01", &rows),
            "Official votecount for D01\n- slot_2: 4\n- no_lynch: 1"
        );
        assert_eq!(
            official_votecount_body("D02", &[]),
            "Official votecount for D02\n\nNo active ballots."
        );
    }

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
            public_resolution: None,
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
                    phase_id: "D03R2".to_string(),
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
                    phase_id: "N02".to_string(),
                    reason: "skip_next_day",
                    skipped_phase_id: Some("D02".to_string()),
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
                serde_json::to_value(host_prompt_public_resolution(&prompt, &effect)).unwrap(),
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
                &phase_policy(vec![domain::pack::PhaseKind::Day]),
                &prompt,
                &HostPromptDecision::Acknowledge {
                    metadata: serde_json::json!({})
                },
                &stream
            )
            .unwrap(),
            HostPromptEffect::AdvancePhase {
                phase_id: "D01R2".to_string(),
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
            domain::pack::PhaseKind::Day,
            domain::pack::PhaseKind::Night,
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
                phase_id: "D03R3".to_string(),
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
                phase_id: "N03".to_string(),
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

    #[test]
    fn host_fiat_grant_sources_are_opaque_and_collision_free_across_principals() {
        let command_id = Uuid::nil();
        let host = host_fiat_grant_source("host_account", command_id, 0);
        let cohost = host_fiat_grant_source("cohost_account", command_id, 0);
        let second_effect = host_fiat_grant_source("host_account", command_id, 1);

        assert_ne!(host, cohost);
        assert_ne!(host, second_effect);
        assert!(host.starts_with("host_fiat:grant:"));
        assert!(host.ends_with(":0"));
        assert!(!host.contains("host_account"));
        assert!(!cohost.contains("cohost_account"));
    }
}
