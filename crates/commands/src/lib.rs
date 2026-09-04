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
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use caps::{Capability, CapabilitySet, Principal};
use content_reference::{self, ContentReferenceReject};
use domain::pack::ItaSessionControlKind;
use eventstore::{ActorId, EventInput};
use game_persona_application::GamePersonaApplicationError;
use game_platform::{
    GamePersonaId, GamePersonaName, GamePersonaPresentation, OccupancyId, OccupancyTransitionId,
};
use principal::PrincipalId;
use projections::{append_and_project_in_tx, ProjectionError};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

mod action_submission;
pub mod day_program;
pub mod day_runtime;
pub mod day_scheduler;
mod host_prompt_resolution;
mod model;
mod operator_audit;

pub use operator_audit::{
    audit_engine_snapshot_identity_boundary, audit_resolution_envelopes, inspect_resolution_traces,
    load_engine_phase_input, load_engine_snapshot, run_large_action_graph_performance_proof,
    EnginePhaseInputAudit, EngineSnapshotIdentityAudit, LargeActionGraphPerformanceProof,
    ResolutionEnvelopeAuditDiff, ResolutionEnvelopeAuditDriftPath, ResolutionEnvelopeAuditEnvelope,
    ResolutionEnvelopeAuditPhase, ResolutionEnvelopeAuditReport, ResolutionEnvelopeAuditStatus,
    ResolutionEnvelopeAuditSummary, ResolutionTraceDecisionRow, ResolutionTraceEdgeRow,
    ResolutionTraceEffectChangeRow, ResolutionTraceGeneratedRow, ResolutionTraceInspectionReport,
    ResolutionTraceInspectionRun, ResolutionTraceNoteRow, ResolutionTraceVisibilityRow,
};
pub mod operator_process;
pub use day_runtime::advance_day_event_automation_as_scheduler;
pub use model::{
    Ack, CohostPermissionClass, Command, HostPromptDecision, Reject, ThreadPostMedia,
    ThreadPostMediaVariant, VoteTarget,
};

/// Compact test/fixture construction for a named seating command.
///
/// Production call sites must provide a deliberate game-local public name.
/// Fixtures use a stable slot-derived persona name, keeping the principal
/// binding distinct while exercising the same `SeatPersona` command production
/// receives.
#[doc(hidden)]
#[macro_export]
macro_rules! seat_persona {
    ($game:ident, slot: $slot:expr, user: $user:expr $(,)?) => {
        $crate::seat_persona! { game: $game, slot: $slot, user: $user }
    };
    ($game:ident, slot: $slot:expr, user $user:expr $(,)?) => {
        $crate::seat_persona! { game: $game, slot: $slot, user: $user }
    };
    ($game:ident, slot: $slot:expr, $user:ident $(,)?) => {
        $crate::seat_persona! { game: $game, slot: $slot, user: $user }
    };
    (game: $game:expr, slot: $slot:expr, user: $user:expr $(,)?) => {{
        let slot: String = $slot;
        let principal_id = $crate::fixture_principal_id($user);
        let public_name = format!("Player {slot}");
        $crate::Command::SeatPersona {
            game: $game,
            public_name,
            principal_id,
            slot,
        }
    }};
}

/// Deterministically mint a UUID-backed authority for test and proof fixtures.
///
/// This is deliberately separate from the authenticated production boundary:
/// production identities are minted by the identity subsystem, while fixture
/// labels are merely stable input to repeatable local scenarios.
#[doc(hidden)]
pub fn fixture_principal_id(label: impl AsRef<str>) -> PrincipalId {
    PrincipalId::fixture(label)
}

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
    pub(crate) static COMMAND_AUDIT_CONTEXT: CommandAuditContext;
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

/// Command-layer builder for reducing a stored game stream into resolver input.
///
/// The domain resolver stays pure and storage-blind. This seam owns the command
/// boundary chores: pack loading, phase parsing, snapshot/submission/day-input
/// reduction, and deterministic run metadata derived from the stream cursor.
pub struct EngineInputBuilder<'a> {
    game: Uuid,
    stream: &'a [eventstore::StoredEvent],
    phase_id: domain::phase::PhaseId,
}

#[derive(Debug, Clone)]
pub struct EnginePhaseInput {
    pub game: Uuid,
    pub pack_ref: content_registry::PackRef,
    pub pack: Arc<domain::ValidatedPack>,
    pub phase_id: domain::phase::PhaseId,
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
    pub fn new(
        game: Uuid,
        stream: &'a [eventstore::StoredEvent],
        phase_id: domain::phase::PhaseId,
    ) -> Self {
        Self {
            game,
            stream,
            phase_id,
        }
    }

    pub fn build(self) -> Result<EnginePhaseInput, Reject> {
        let pack_artifact = pack_artifact_from_stream(self.stream)?;
        let pack_ref = pack_artifact.pack_ref.clone();
        let pack = load_pack(&pack_artifact)?;
        let phase_id = self.phase_id;
        let state = current_snapshot(None, self.stream, pack.document(), &phase_id)?;
        let submissions = current_submissions(self.stream, &phase_id);
        let day_phase_inputs = current_day_phase_inputs(self.stream, &state, &phase_id, None, 0)?;
        let next_stream_seq = self.stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1);

        Ok(EnginePhaseInput {
            game: self.game,
            pack_ref,
            pack,
            phase_id,
            state,
            submissions,
            day_phase_inputs,
            next_stream_seq,
        })
    }
}

pub(crate) async fn load_engine_phase_input_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &domain::phase::PhaseId,
) -> Result<(EnginePhaseInput, bool), Reject> {
    let pack_artifact = current_pack_artifact(tx, game).await?;
    let pack_ref = pack_artifact.pack_ref.clone();
    let pack = load_pack(&pack_artifact)?;
    let checkpoint = match projections::load_engine_snapshot_checkpoint(&mut **tx, game).await {
        Ok(row) => row,
        Err(projections::ProjectionError::Payload { .. }) => None,
        Err(error) => return Err(Reject::Internal(error.to_string())),
    };
    let usable = checkpoint.filter(|row| row.result_version == domain::RESULT_VERSION as i16);
    let after_seq = usable.as_ref().map(|row| row.stream_seq).unwrap_or(0);
    let tail = eventstore::load_stream_after_in_tx(tx, game, after_seq)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let phase_id = phase_id.clone();
    let last_resolution = usable.as_ref().and_then(|row| row.last_resolution.clone());
    let seed = usable.as_ref().map(|row| &row.snapshot);
    let state = current_snapshot(seed, &tail, pack.document(), &phase_id)?;
    let submissions = current_submissions(&tail, &phase_id);
    let day_phase_inputs = current_day_phase_inputs(
        &tail,
        &state,
        &phase_id,
        last_resolution.as_ref(),
        after_seq,
    )?;
    let next_stream_seq = eventstore::next_stream_seq_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let already_resolved = official_resolution_applied(last_resolution.as_ref(), &tail, &phase_id);
    Ok((
        EnginePhaseInput {
            game,
            pack_ref,
            pack,
            phase_id,
            state,
            submissions,
            day_phase_inputs,
            next_stream_seq,
        },
        already_resolved,
    ))
}

fn official_resolution_applied(
    last_resolution: Option<&serde_json::Value>,
    tail: &[eventstore::StoredEvent],
    phase_id: &domain::phase::PhaseId,
) -> bool {
    let payload_matches = |payload: &serde_json::Value| {
        payload["phase_id"].as_str() == Some(phase_id.as_str())
            && payload["run_id"]
                .as_str()
                .is_some_and(|run_id| run_id.starts_with("resolution:"))
    };
    last_resolution.is_some_and(payload_matches)
        || tail
            .iter()
            .any(|ev| ev.kind == "ResolutionApplied" && payload_matches(&ev.payload))
}

/// Persist a discardable `StateSnapshot` after an official phase resolve.
/// Instant and host-prompt envelopes stay in the stream tail so same-phase
/// ballots and actions are not dropped from the next reducer input.
pub(crate) async fn store_resolution_checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    applied_seq: i64,
    post_state: &domain::StateSnapshot,
    applied: &serde_json::Value,
) -> Result<(), Reject> {
    projections::store_engine_snapshot_checkpoint(
        tx,
        game,
        applied_seq,
        domain::RESULT_VERSION as i16,
        post_state,
        Some(applied),
    )
    .await
    .map_err(|error| Reject::Internal(error.to_string()))
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
            pack: Arc::clone(&self.pack),
            seed,
            logical_time,
        }
    }
}

#[derive(Debug, Clone)]
struct ReceiptClaim {
    principal_id: PrincipalId,
    command_id: Uuid,
    command_fingerprint: Vec<u8>,
}

/// Audit facts shared by every event emitted from one accepted command.
///
/// `ActorId` describes the effective game actor (`Host`, `Slot`, `System`);
/// this context preserves the authenticated initiating principal and the exact
/// authority exercised. Keeping the stamping at the append boundary prevents
/// individual handlers from silently omitting cohost attribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuditInitiator {
    Principal(PrincipalId),
    Service(SystemAuditService),
}

/// Fixed service identities that may initiate internal commands.  They are
/// intentionally a disjoint set from authenticated principals, so audit data
/// cannot represent a daemon as a synthetic user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SystemAuditService {
    DayEventAutomation,
    DayEventNarrative,
}

impl SystemAuditService {
    pub(crate) const fn id(self) -> &'static str {
        match self {
            Self::DayEventAutomation => "day-event-automation",
            Self::DayEventNarrative => "day-event-narrative",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CommandAuditContext {
    pub(crate) initiator: AuditInitiator,
    pub(crate) command_id: Uuid,
    pub(crate) command_kind: String,
    pub(crate) authority_used: String,
    pub(crate) request_source: &'static str,
}

#[derive(Debug, Clone)]
struct RebuiltResolutionEnvelope {
    applied: domain::ResolutionApplied,
    trace: domain::ResolutionTrace,
}

impl ReceiptClaim {
    fn new(principal: &Principal, command_id: Uuid, command: &Command) -> Result<Self, Reject> {
        let payload = serde_json::to_vec(command)
            .map_err(|error| Reject::Internal(format!("command fingerprint failed: {error}")))?;
        let mut fingerprint = Sha256::new();
        fingerprint.update(b"fmarch-command-payload:v1\0");
        fingerprint.update(payload);
        Ok(ReceiptClaim {
            principal_id: principal.id(),
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

/// Apply one authenticated, idempotent command inside a caller-owned
/// transaction. This is the production HTTP boundary's authority-safe entry
/// point: the caller can lock and revalidate its session in `tx`, execute the
/// command here, and commit both as one authorized unit of work.
///
/// The caller owns commit or rollback. Receipt replay is intentionally
/// returned without committing so it cannot escape the surrounding authority
/// fence.
pub async fn handle_idempotent_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
) -> Result<Ack, Reject> {
    let receipt = ReceiptClaim::new(principal, command_id, &command)?;
    COMMAND_RUNTIME_TEST_CONTROL
        .scope(
            None,
            handle_in_tx(tx, principal, command_id, command, Some(&receipt)),
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
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::TransactionBegun).await;

    let ack = handle_in_tx(&mut tx, principal, command_id, command, receipt).await?;
    tx.commit()
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::Committed).await;
    Ok(ack)
}

async fn handle_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    command_id: Uuid,
    command: Command,
    receipt: Option<&ReceiptClaim>,
) -> Result<Ack, Reject> {
    let game = command_game(&command);

    lock_command_stream_in_tx(tx, &command).await?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::StreamLocked).await;

    if let Some(receipt) = receipt {
        let replay = claim_or_replay_receipt_in_tx(tx, game, receipt).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::ReceiptClaimed).await;
        if let Some(ack) = replay {
            return Ok(ack);
        }
    }

    if game_closed_by_completion(&command).is_some() {
        require_game_not_completed(tx, game).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::CompletionChecked).await;
    }
    let audit_context = command_audit_context(tx, principal, command_id, &command).await?;
    let ack = COMMAND_AUDIT_CONTEXT
        .scope(audit_context, handle_command(tx, principal, command))
        .await?;
    command_runtime_checkpoint(CommandRuntimeCheckpoint::CommandApplied).await;

    if let Some(receipt) = receipt {
        store_receipt_ack_in_tx(tx, receipt, &ack).await?;
        command_runtime_checkpoint(CommandRuntimeCheckpoint::ReceiptStored).await;
    }
    Ok(ack)
}

/// Acquire the first lock in every command transaction's canonical order.
/// HTTP authorization uses this before locking any participating identity;
/// the command pipeline reacquires it defensively before receipt or domain
/// persistence. Transaction-scoped advisory locks are idempotent.
pub async fn lock_command_stream_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    command: &Command,
) -> Result<(), Reject> {
    eventstore::lock_stream_in_tx(tx, command_game(command))
        .await
        .map_err(|error| Reject::Internal(error.to_string()))
}

/// Fail-fast network admission for the first lock in the command order. A
/// caller that does not acquire the stream owns no other durable lock, so it
/// can safely return the typed retryable conflict without tying up a pool
/// connection behind another command.
pub async fn try_lock_command_stream_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    command: &Command,
) -> Result<(), Reject> {
    match eventstore::try_lock_stream_in_tx(tx, command_game(command))
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?
    {
        true => Ok(()),
        false => Err(Reject::StreamConflict),
    }
}

/// Bound waits while the HTTP boundary acquires the canonical authority lock
/// set, or restore PostgreSQL's unbounded default after that set is owned.
pub async fn set_command_lock_timeout_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    timeout: Option<Duration>,
) -> Result<(), Reject> {
    let value = timeout
        .map(|timeout| format!("{}ms", timeout.as_millis()))
        .unwrap_or_else(|| "0".to_string());
    sqlx::query("SELECT set_config('lock_timeout', $1, TRUE)")
        .bind(value)
        .execute(&mut **tx)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    Ok(())
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
        Command::SeatPersona {
            game,
            slot,
            principal_id,
            public_name,
        } => seat_persona(tx, principal, game, slot, principal_id, public_name).await,
        Command::RenameGamePersona {
            game,
            persona_id,
            public_name,
        } => rename_game_persona(tx, principal, game, persona_id, public_name).await,
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
        Command::AddCohost { game, principal_id } => {
            host_structural_lifecycle(
                tx,
                principal,
                game,
                "CohostAdded",
                serde_json::json!({ "principal_id": principal_id }),
                ActorId::Host,
            )
            .await
        }
        Command::GrantSpectator { game, principal_id } => {
            grant_spectator(tx, principal, game, principal_id).await
        }
        Command::RevokeSpectator { game, principal_id } => {
            revoke_spectator(tx, principal, game, principal_id).await
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
        } => admit_host_prompt_resolution(tx, principal, game, prompt_id, decision).await,
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
            day_runtime::attach_day_program(tx, principal, game, program).await
        }
        Command::ScheduleDayEvent { game, event } => {
            day_runtime::schedule_day_event(tx, principal, game, event).await
        }
        Command::OpenDayEvent { game, event_id } => {
            day_runtime::open_day_event(tx, principal, game, event_id).await
        }
        Command::LockDayEvent { game, event_id } => {
            day_runtime::lock_day_event(tx, principal, game, event_id).await
        }
        Command::CancelDayEvent {
            game,
            event_id,
            reason,
        } => day_runtime::cancel_day_event(tx, principal, game, event_id, reason).await,
        Command::SubmitDayEventParticipation {
            game,
            event_id,
            actor_slot,
            payload,
        } => {
            day_runtime::submit_day_event_participation(
                tx, principal, game, event_id, actor_slot, payload,
            )
            .await
        }
        Command::WithdrawDayEventParticipation {
            game,
            event_id,
            actor_slot,
        } => {
            day_runtime::withdraw_day_event_participation(tx, principal, game, event_id, actor_slot)
                .await
        }
        Command::ResolveDayEvent {
            game,
            event_id,
            decision,
        } => day_runtime::resolve_day_event(tx, principal, game, event_id, decision).await,

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
            action_submission::submit_action(action_submission::ActionSubmissionContext::new(
                tx,
                principal,
                action_submission::ActionSubmissionRequest {
                    game,
                    action_id,
                    actor_slot,
                    template_id,
                    targets,
                    grant_id,
                },
            ))
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
            quotations,
            embed_url,
            embed_snapshot,
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
                    quotations,
                    embed_url,
                    embed_snapshot,
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
            outgoing_persona_id,
            incoming_principal_id,
        } => {
            process_replacement(
                tx,
                principal,
                game,
                slot,
                outgoing_persona_id,
                incoming_principal_id,
            )
            .await
        }
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
                 WHERE game_id = $1 AND principal_id = $2 \
                 ORDER BY CASE role WHEN 'host' THEN 0 ELSE 1 END LIMIT 1",
            )
            .bind(game)
            .bind(principal.id().as_uuid())
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
        initiator: AuditInitiator::Principal(principal.id()),
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
        Command::SeatPersona { .. } => ("SeatPersona", CommandAuditAuthority::HostTeam),
        Command::RenameGamePersona { .. } => ("RenameGamePersona", CommandAuditAuthority::HostTeam),
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
        | Command::SeatPersona { game, .. }
        | Command::RenameGamePersona { game, .. }
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

/// State the owner-state requirement for a non-actor command principal. Some
/// commands grant new authority and require an active owner; authority removal
/// deliberately remains valid for an existing inactive owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum CommandIdentityTargetPolicy {
    Existing,
    Active,
}

/// Every non-actor platform principal whose owner rows a command may read,
/// lock, or reference, paired with the state that must still hold after the
/// lock. The exhaustive match is a compile-time change detector.
pub fn command_identity_targets(
    command: &Command,
) -> BTreeMap<PrincipalId, CommandIdentityTargetPolicy> {
    let mut targets = BTreeMap::new();
    match command {
        Command::SeatPersona { principal_id, .. }
        | Command::AddCohost { principal_id, .. }
        | Command::GrantSpectator { principal_id, .. } => {
            targets.insert(*principal_id, CommandIdentityTargetPolicy::Active);
        }
        Command::RevokeSpectator { principal_id, .. } => {
            targets.insert(*principal_id, CommandIdentityTargetPolicy::Existing);
        }
        Command::ProcessReplacement {
            incoming_principal_id,
            ..
        } => {
            targets.insert(*incoming_principal_id, CommandIdentityTargetPolicy::Active);
        }
        Command::CreateGame { .. }
        | Command::AddSlot { .. }
        | Command::RenameGamePersona { .. }
        | Command::AssignRole { .. }
        | Command::SetSlotStatus { .. }
        | Command::AddSlotStatusTag { .. }
        | Command::RemoveSlotStatusTag { .. }
        | Command::StartGame { .. }
        | Command::OpenDayPhase { .. }
        | Command::AdvancePhase { .. }
        | Command::AdvancePhaseByDeadline { .. }
        | Command::LockThread { .. }
        | Command::UnlockThread { .. }
        | Command::ResolvePhase { .. }
        | Command::CompleteGame { .. }
        | Command::PublishVotecount { .. }
        | Command::ResolveHostPrompt { .. }
        | Command::SetPostPolicy { .. }
        | Command::PublishSpectatorPost { .. }
        | Command::ControlItaSession { .. }
        | Command::ApplyEffectPlan { .. }
        | Command::AttachDayProgram { .. }
        | Command::ScheduleDayEvent { .. }
        | Command::OpenDayEvent { .. }
        | Command::LockDayEvent { .. }
        | Command::CancelDayEvent { .. }
        | Command::SubmitDayEventParticipation { .. }
        | Command::WithdrawDayEventParticipation { .. }
        | Command::ResolveDayEvent { .. }
        | Command::SubmitVote { .. }
        | Command::WithdrawVote { .. }
        | Command::SubmitAction { .. }
        | Command::WithdrawAction { .. }
        | Command::SubmitPost { .. }
        | Command::ExtendDeadline { .. } => {}
    }
    targets
}

fn game_closed_by_completion(command: &Command) -> Option<Uuid> {
    match command {
        Command::CreateGame { .. } | Command::CompleteGame { .. } => None,
        Command::AddSlot { game, .. }
        | Command::SeatPersona { game, .. }
        | Command::RenameGamePersona { game, .. }
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

pub(crate) async fn require_game_not_completed(
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
/// creating principal BECOMES the host (the `GameCreated.host_principal_id` field), which is
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
    let pack_artifact = selected_pack_artifact(&pack)?;
    let pack_ref = pack_artifact.pack_ref.clone();
    load_pack(&pack_artifact)?;
    let host_principal_id = principal.id();
    let denied: Vec<&str> = cohost_denied.iter().map(|c| c.as_str()).collect();
    let ev = EventInput::new(
        "GameCreated",
        1,
        serde_json::json!({
            "host_principal_id": host_principal_id,
            "pack_ref": pack_ref,
            "pack_artifact": pack_artifact,
            "cohost_denied": denied,
        }),
        ActorId::Principal(host_principal_id),
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
    principal_id: PrincipalId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if projections::principal_has_open_occupancy(&mut **tx, game, principal_id).await?
        || projections::spectator_membership(&mut **tx, game, principal_id).await?
    {
        return Err(Reject::InvalidTarget);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "SpectatorGranted",
            1,
            serde_json::json!({ "principal_id": principal_id }),
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
    principal_id: PrincipalId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if !projections::spectator_membership(&mut **tx, game, principal_id).await? {
        return Err(Reject::InvalidTarget);
    }
    persist(
        tx,
        game,
        &[EventInput::new(
            "SpectatorRevoked",
            1,
            serde_json::json!({ "principal_id": principal_id }),
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
    phase: domain::phase::PhaseId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    validate_phase_id_for_policy(&pack.document().phases, &phase)?;
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
    phase: domain::phase::PhaseId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::PhaseResolve).await?;

    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    validate_phase_id_for_policy(&pack.document().phases, &phase)?;
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
    events.extend(pack_private_channel_declarations(pack.document(), &stream)?);
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
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    let next_phase_id = next_declared_phase_id(&pack.document().phases, &source_phase_id)?;
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
    phase_id: domain::phase::PhaseId,
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
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    let next_phase_id = next_declared_phase_id(&pack.document().phases, &source_phase_id)?;
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
            && event.payload["phase_id"].as_str() == Some(phase.phase_id.as_str())
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

    let principal_id = principal.id();
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
        principal_id,
        command_id,
    };
    let mut lifecycle_states = BTreeMap::new();
    let events = plan_effect_events(tx, game, plan, &application, &mut lifecycle_states).await?;
    persist(tx, game, &events).await
}

#[derive(Debug, Clone)]
pub(crate) enum EffectApplication {
    HostFiat {
        principal_id: PrincipalId,
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
                principal_id,
                command_id,
            } => host_fiat_grant_source(principal_id, *command_id, index),
            Self::DayEvent {
                event_id,
                reward_key,
                command_id,
            } => format!("day_event:{event_id}:{reward_key}:grant:{command_id}:{index}"),
        }
    }
}

pub(crate) async fn plan_effect_events(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    plan: game_platform::EffectPlan,
    application: &EffectApplication,
    lifecycle_states: &mut BTreeMap<String, String>,
) -> Result<Vec<EventInput>, Reject> {
    let phase = projections::phase_state(&mut **tx, game)
        .await?
        .ok_or_else(|| effect_spec_reject("effect plans require an active phase"))?;
    let phase_id = phase.phase_id.clone();
    let pack = current_pack(tx, game).await?;
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
                event.payload["phase_id"] = serde_json::to_value(&phase_id)
                    .map_err(|error| Reject::Internal(format!("serialize phase id: {error}")))?;
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
                let policy = persistent_effect_policy(pack.document(), effect.as_str())?;
                vec![EventInput::new(
                    "EffectsMarked",
                    1,
                    serde_json::json!({
                        "effect": effect.as_str(),
                        "target": target.as_str(),
                        "actor": "external",
                        "source_action": application.source_action("mark"),
                        "phase_id": phase_id,
                        "duration": "Persistent",
                        "visibility": policy.visibility,
                    }),
                    ActorId::Host,
                    0,
                )]
            }
            game_platform::ConcreteEffect::Clear { target, effect } => {
                require_effect_target(tx, game, target.as_str()).await?;
                persistent_effect_policy(pack.document(), effect.as_str())?;
                vec![EventInput::new(
                    "EffectsCleared",
                    1,
                    serde_json::json!({
                        "effect": effect.as_str(),
                        "targets": [target.as_str()],
                        "actor": "external",
                        "source_action": application.source_action("clear"),
                        "phase_id": phase_id,
                    }),
                    ActorId::Host,
                    0,
                )]
            }
            game_platform::ConcreteEffect::Grant { target, grant } => {
                require_effect_target(tx, game, target.as_str()).await?;
                validate_platform_grant(pack.document(), &grant)?;
                let source_action = application.grant_source(index);
                let mut grant_events = vec![EventInput::new(
                    "ActionGranted",
                    1,
                    serde_json::json!({
                        "grant_id": grant.grant_id.as_str(),
                        "grant_option": null,
                        "kind": grant.kind,
                        "actor": "external",
                        "target": target.as_str(),
                        "source_action": source_action,
                        "uses": grant.uses,
                        "vote_weight": grant.vote_weight,
                        "phase_id": phase_id,
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
                            "phase_id": phase_id,
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

pub(crate) fn unix_seconds_now() -> Result<i64, Reject> {
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

fn host_fiat_grant_source(principal_id: &PrincipalId, command_id: Uuid, index: usize) -> String {
    let scope = format!(
        "{:x}",
        Sha256::digest(format!("{principal_id}\0{command_id}").as_bytes())
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

async fn persona_id_for_principal(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    principal_id: PrincipalId,
) -> Result<Option<GamePersonaId>, Reject> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT binding.persona_id FROM game_persona_subject_binding AS binding \
         JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id \
         WHERE binding.game_id = $1 AND binding.lifecycle = 'active' \
         AND subject.principal_id = $2",
    )
    .bind(game)
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await
    .map(|persona_id| persona_id.map(GamePersonaId::from_uuid))
    .map_err(|error| Reject::Internal(error.to_string()))
}

async fn game_persona_exists(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    persona_id: GamePersonaId,
) -> Result<bool, Reject> {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM game_persona WHERE game_id = $1 AND persona_id = $2)",
    )
    .bind(game)
    .bind(persona_id.as_uuid())
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| Reject::Internal(error.to_string()))
}

async fn persona_name_claim_owner(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    public_name: &str,
) -> Result<Option<GamePersonaId>, Reject> {
    sqlx::query_scalar::<_, Uuid>(
        "SELECT persona_id FROM game_persona_name_claim \
         WHERE game_id = $1 AND normalized_name = $2",
    )
    .bind(game)
    .bind(public_name.trim().to_lowercase())
    .fetch_optional(&mut **tx)
    .await
    .map(|persona_id| persona_id.map(GamePersonaId::from_uuid))
    .map_err(|error| Reject::Internal(error.to_string()))
}

async fn open_occupancy(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    slot: &str,
) -> Result<Option<(OccupancyId, GamePersonaId)>, Reject> {
    sqlx::query_as::<_, (Uuid, Uuid)>(
        "SELECT occupancy_id, persona_id FROM slot_occupancy_epoch \
         WHERE game_id = $1 AND slot_id = $2 AND ended_seq IS NULL",
    )
    .bind(game)
    .bind(slot)
    .fetch_optional(&mut **tx)
    .await
    .map(|occupancy| {
        occupancy.map(|(occupancy_id, persona_id)| {
            (
                OccupancyId::from_uuid(occupancy_id),
                GamePersonaId::from_uuid(persona_id),
            )
        })
    })
    .map_err(|error| Reject::Internal(error.to_string()))
}

fn generated_persona_name(slot: &str, persona_id: GamePersonaId) -> String {
    let suffix = persona_id
        .as_uuid()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    format!("Player {slot} {suffix}")
}

fn persona_application_error(error: GamePersonaApplicationError) -> Reject {
    match error {
        GamePersonaApplicationError::PersonaAlreadyRegistered
        | GamePersonaApplicationError::SubjectAlreadyBound
        | GamePersonaApplicationError::PersonaNotFound
        | GamePersonaApplicationError::PersonaUnavailable => Reject::InvalidTarget,
        error => Reject::Internal(error.to_string()),
    }
}

fn persona_presentation(public_name: String) -> Result<GamePersonaPresentation, Reject> {
    Ok(GamePersonaPresentation {
        public_name: GamePersonaName::new(public_name).map_err(|_| Reject::InvalidTarget)?,
    })
}

async fn assign_slot_with_name(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    principal_id: PrincipalId,
    public_name: Option<String>,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if !projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    if projections::spectator_membership(&mut **tx, game, principal_id).await? {
        return Err(Reject::InvalidTarget);
    }
    if projections::slot_occupant(&mut **tx, game, &slot)
        .await?
        .is_some()
    {
        return Err(Reject::InvalidTarget);
    }
    let persona_id = persona_id_for_principal(tx, game, principal_id)
        .await?
        .unwrap_or_else(GamePersonaId::random);
    let is_new_persona = !game_persona_exists(tx, game, persona_id).await?;
    let requested_public_name = public_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| generated_persona_name(&slot, persona_id));
    if is_new_persona
        && persona_name_claim_owner(tx, game, &requested_public_name)
            .await?
            .is_some()
    {
        return Err(Reject::InvalidTarget);
    }
    let transition_id = OccupancyTransitionId::random();
    let occupancy_id = OccupancyId::random();
    let mut events = Vec::new();
    if is_new_persona {
        let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
            .await
            .map_err(|error| Reject::Internal(error.to_string()))?;
        events.push(
            game_persona_application::register(
                tx,
                game,
                persona_id,
                &principal_id,
                persona_presentation(requested_public_name)?,
                ActorId::Host,
                occurred_at,
            )
            .await
            .map_err(persona_application_error)?,
        );
    }
    events.push(EventInput::new(
        "SlotOccupancyStarted",
        1,
        serde_json::json!({
            "transition_id": transition_id.as_uuid(),
            "occupancy_id": occupancy_id.as_uuid(),
            "slot_id": &slot,
            "persona_id": persona_id.as_uuid(),
            "reason": "initial",
        }),
        ActorId::Host,
        0,
    ));
    let stream = eventstore::load_stream_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    if stream.iter().any(|event| event.kind == "GameStarted") {
        if let Some(role_key) = role_assignments_from_stream(&stream)?.get(&slot) {
            events.push(role_pm_declaration(&slot, role_key));
        }
    }
    persist(tx, game, &events).await
}

async fn seat_persona(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    principal_id: PrincipalId,
    public_name: String,
) -> Result<Ack, Reject> {
    if public_name.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    assign_slot_with_name(tx, principal, game, slot, principal_id, Some(public_name)).await
}

async fn rename_game_persona(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    persona_id: GamePersonaId,
    public_name: String,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Setup).await?;
    if public_name.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    if !game_persona_exists(tx, game, persona_id).await? {
        return Err(Reject::InvalidTarget);
    }
    if let Some(owner) = persona_name_claim_owner(tx, game, &public_name).await? {
        if owner != persona_id {
            return Err(Reject::InvalidTarget);
        }
    }
    let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let event = game_persona_application::rename(
        tx,
        game,
        persona_id,
        persona_presentation(public_name)?,
        ActorId::Host,
        occurred_at,
    )
    .await
    .map_err(persona_application_error)?;
    persist(tx, game, &[event]).await
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
    let pack = load_pack(&pack_artifact_from_stream(&stream)?)?;
    let role = pack
        .document()
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

    // 2. validate domain rules from projections. Only hammer-on packs still
    // need the sealed tape, and only for the preview resolve.
    let phase = require_open_day_phase(tx, game).await?;
    require_slot_alive(tx, game, &actor_slot).await?;
    let pack = current_pack(tx, game).await?;
    validate_vote_actor_from_projections(tx, game, pack.document(), &actor_slot).await?;
    validate_vote_policy_target(&pack.document().vote, &actor_slot, &target)?;
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
    if pack.document().vote.hammer {
        let (phase_input, _) = load_engine_phase_input_in_tx(tx, game, &phase).await?;
        validate_vote_actor_policy(phase_input.pack.document(), &phase_input.state, &actor_slot)?;
        if let Some(lock_ev) = hammer_lock_event(&phase_input, &actor_slot, &target_str)? {
            events.push(lock_ev);
        }
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
    if !projections::action_submission_is_active(&mut **tx, game, &phase, &actor_slot, &action_id)
        .await?
    {
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
    let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
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
    quotations: Vec<content_reference::Quotation>,
    embed_url: Option<String>,
    embed_snapshot: Option<game_platform::embed::EmbedSnapshot>,
}

const MAX_GAME_POST_BODY_BYTES: usize = game_platform::MAX_RENDERED_NARRATIVE_BYTES;

pub(crate) struct HostNoticeSpec {
    pub(crate) channel_id: String,
    pub(crate) body: String,
    pub(crate) media: Vec<model::ThreadPostMedia>,
    pub(crate) phase_id: Option<domain::phase::PhaseId>,
    pub(crate) occurred_at: i64,
    pub(crate) narrative_receipt: Option<serde_json::Value>,
}

pub(crate) fn build_host_notice(spec: HostNoticeSpec) -> Result<EventInput, Reject> {
    let HostNoticeSpec {
        channel_id,
        body,
        media,
        phase_id,
        occurred_at,
        narrative_receipt,
    } = spec;
    validate_game_post_body(&body)?;
    validate_thread_post_media(&media)?;
    if body.trim().is_empty() {
        return Err(Reject::InvalidTarget);
    }
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "author": { "kind": "host_narrator" },
        "body": body,
        "phase_id": phase_id,
    });
    if !media.is_empty() {
        payload["media"] = serde_json::to_value(media).expect("thread post media serializes");
    }
    if let Some(receipt) = narrative_receipt {
        payload["day_event_narrative"] = receipt;
    }
    Ok(EventInput::new(
        "PostSubmitted",
        1,
        payload,
        ActorId::Host,
        occurred_at,
    ))
}

pub(crate) fn validate_game_post_body(body: &str) -> Result<(), Reject> {
    if body.len() > MAX_GAME_POST_BODY_BYTES {
        return Err(Reject::InvalidTarget);
    }
    Ok(())
}

async fn decide_game_quotations(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    channel_id: &str,
    quotations: Vec<content_reference::Quotation>,
) -> Result<Vec<content_reference::Quotation>, Reject> {
    if quotations.is_empty() {
        return Ok(Vec::new());
    }
    let thread = projections::quotation_thread_for_game_channel_in_tx(tx, game, channel_id)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?;
    let thread = content_reference::QuotationThreadState {
        thread: content_reference::PostRef {
            kind: match thread.thread.kind.as_str() {
                "discussion_post" => content_reference::PostKind::DiscussionPost,
                "game_post" => content_reference::PostKind::GamePost,
                _ => unreachable!("legacy projection emitted an unknown quotation source"),
            },
            scope_id: thread.thread.scope_id,
            source_seq: thread.thread.source_seq,
        },
        posts: thread
            .posts
            .into_iter()
            .map(|post| content_reference::QuotationPostState {
                source_seq: post.source_seq,
                body: post.body,
                visible: post.visible,
                outgoing: post
                    .outgoing
                    .into_iter()
                    .map(|target| content_reference::PostRef {
                        kind: match target.kind.as_str() {
                            "discussion_post" => content_reference::PostKind::DiscussionPost,
                            "game_post" => content_reference::PostKind::GamePost,
                            _ => unreachable!(
                                "legacy projection emitted an unknown quotation source"
                            ),
                        },
                        scope_id: target.scope_id,
                        source_seq: target.source_seq,
                    })
                    .collect(),
            })
            .collect(),
    };
    content_reference::decide_quotations(&thread, &quotations).map_err(quotation_reject)
}

fn quotation_reject(reject: ContentReferenceReject) -> Reject {
    match reject {
        ContentReferenceReject::QuotationNotFound
        | ContentReferenceReject::InvalidQuotationTarget
        | ContentReferenceReject::InvalidQuotationExcerpt
        | ContentReferenceReject::TooManyQuotations
        | ContentReferenceReject::QuotationChainTooDeep
        | ContentReferenceReject::DuplicateQuotation => Reject::InvalidTarget,
        // The game path never decides profile mentions (slice 4 adds slot
        // mentions on its own decision function), so these arms are
        // unreachable; they exist for exhaustiveness only.
        ContentReferenceReject::InvalidPostKind
        | ContentReferenceReject::UnknownMentionTarget
        | ContentReferenceReject::InvalidMentionSpan
        | ContentReferenceReject::DuplicateMention
        | ContentReferenceReject::TooManyMentions => Reject::Internal(reject.to_string()),
    }
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
        quotations,
        embed_url,
        embed_snapshot,
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
    let quotations = decide_game_quotations(tx, game, &channel_id, quotations).await?;
    let embed = game_platform::embed::attach_embed_snapshot(
        game_platform::embed::decide_post_embed(&channel_id, embed_url.as_deref())
            .map_err(|_| Reject::InvalidTarget)?,
        embed_snapshot,
    )
    .map_err(|_| Reject::InvalidTarget)?;
    if body.trim().is_empty() && quotations.is_empty() && embed.is_none() {
        let policy = projections::post_policy(&mut **tx, game, &channel_id).await?;
        if media.is_empty() || !policy.allow_media_only {
            return Err(Reject::InvalidTarget);
        }
    }
    // A post is attributed to the SLOT (doc 01: post authorship attaches to the
    // slot, not the user), so it survives a replacement. Phase id is recorded
    // for partitioning.
    let phase = current_phase(tx, game).await?;
    let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "author": { "kind": "slot", "slot_id": actor_slot.clone() },
        "body": body,
        "phase_id": phase,
    });
    if !media.is_empty() {
        payload["media"] = serde_json::to_value(media).expect("thread post media serializes");
    }
    if let Some(quotations) = content_reference::quotations_payload(&quotations) {
        payload["quotations"] = quotations;
    }
    if let Some(embed) = game_platform::embed::embed_payload(&embed) {
        payload["embed"] = embed;
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
    let phase = current_phase(tx, game).await?;
    let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
        .await
        .map_err(|e| Reject::Internal(e.to_string()))?;
    let notice = build_host_notice(HostNoticeSpec {
        channel_id: "spectator".to_string(),
        body,
        media,
        phase_id: phase,
        occurred_at,
        narrative_receipt: None,
    })?;
    persist(tx, game, &[notice]).await
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
    let body = official_votecount_body(phase.as_str(), &rows);
    if official_votecount_already_published(tx, game, phase.as_str(), &body).await? {
        return Err(Reject::InvalidTarget);
    }
    let ev = EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "main",
            "author": { "kind": "host_narrator" },
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
           AND author_kind = 'host_narrator' \
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
    phase: domain::phase::PhaseId,
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

/// The irreversible mechanic: end one named persona's immutable occupancy epoch
/// and begin another on the same stable `SlotId`. Votes, posts, role, and
/// lifecycle remain keyed by the slot; private principal authority is derived
/// only by joining the current epoch to the private persona projection.
async fn process_replacement(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    slot: String,
    outgoing_persona_id: GamePersonaId,
    incoming_principal_id: PrincipalId,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::Replacement).await?;

    if !projections::slot_exists(&mut **tx, game, &slot).await? {
        return Err(Reject::UnknownSlot);
    }
    // A replacement targets the immutable current occupancy epoch, never a
    // mutable principal-to-slot projection. This makes stale replacement
    // requests fail when their named persona no longer owns the open epoch.
    let (outgoing_occupancy_id, current_persona_id) = open_occupancy(tx, game, &slot)
        .await?
        .ok_or(Reject::InvalidTarget)?;
    if current_persona_id != outgoing_persona_id {
        return Err(Reject::InvalidTarget);
    }
    if projections::spectator_membership(&mut **tx, game, incoming_principal_id).await? {
        return Err(Reject::InvalidTarget);
    }
    let incoming_persona_id = persona_id_for_principal(tx, game, incoming_principal_id)
        .await?
        .unwrap_or_else(GamePersonaId::random);
    let transition_id = OccupancyTransitionId::random();
    let incoming_occupancy_id = OccupancyId::random();
    let mut events = Vec::new();
    if !game_persona_exists(tx, game, incoming_persona_id).await? {
        let occurred_at = eventstore::next_stream_seq_in_tx(tx, game)
            .await
            .map_err(|error| Reject::Internal(error.to_string()))?;
        events.push(
            game_persona_application::register(
                tx,
                game,
                incoming_persona_id,
                &incoming_principal_id,
                persona_presentation(generated_persona_name(&slot, incoming_persona_id))?,
                ActorId::Host,
                occurred_at,
            )
            .await
            .map_err(persona_application_error)?,
        );
    }
    events.push(EventInput::new(
        "SlotOccupancyEnded",
        1,
        serde_json::json!({
            "transition_id": transition_id.as_uuid(),
            "occupancy_id": outgoing_occupancy_id.as_uuid(),
            "slot_id": &slot,
            "persona_id": outgoing_persona_id.as_uuid(),
            "reason": "replaced",
        }),
        ActorId::Host,
        0,
    ));
    events.push(EventInput::new(
        "SlotOccupancyStarted",
        1,
        serde_json::json!({
            "transition_id": transition_id.as_uuid(),
            "occupancy_id": incoming_occupancy_id.as_uuid(),
            "slot_id": slot,
            "persona_id": incoming_persona_id.as_uuid(),
            "reason": "replacement",
        }),
        ActorId::Host,
        0,
    ));
    persist(tx, game, &events).await
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

    let phase_id = phase.phase_id.clone();
    let (phase_input, already_resolved) =
        load_engine_phase_input_in_tx(tx, game, &phase_id).await?;
    if already_resolved {
        return Err(Reject::InvalidTarget);
    }

    let output = domain::resolve(phase_input.resolve_input(EngineRunKind::ResolvePhase { seed }))
        .map_err(|error| Reject::Internal(format!("invalid resolution input: {error}")))?;
    domain::validate_resolution_applied(&output.applied, domain::RESULT_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution result: {e}")))?;
    domain::validate_resolution_trace(&output.trace, domain::TRACE_VERSION)
        .map_err(|e| Reject::Internal(format!("invalid resolution trace: {e}")))?;
    let applied_json =
        serde_json::to_value(&output.applied).map_err(|e| Reject::Internal(e.to_string()))?;
    let applied_ev = EventInput::resolution_applied(
        applied_json.clone(),
        ActorId::System,
        phase_input.next_stream_seq,
    );
    let trace_ev = EventInput::resolution_trace(
        serde_json::to_value(&output.trace).map_err(|e| Reject::Internal(e.to_string()))?,
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
        phase_input.pack.document(),
        &output.post_state,
    ));
    events.push(lock_ev);
    let ack = persist(tx, game, &events).await?;
    let applied_seq = ack.stream_seqs.first().copied().ok_or_else(|| {
        Reject::Internal("resolution persist returned no stream sequences".to_string())
    })?;
    store_resolution_checkpoint(tx, game, applied_seq, &output.post_state, &applied_json).await?;
    Ok(ack)
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
    let phase_number = phase_number(&phase);

    let pack = current_pack(tx, game).await?;
    if !pack.document().ita.lifecycle.allows(control) {
        return Err(Reject::InvalidTarget);
    }
    let Some(session) = pack
        .document()
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

/// Apply shared command admission before handing the prompt operation to its
/// bounded owner. Dispatch, capability resolution, and transaction ownership
/// intentionally remain in this composition root.
async fn admit_host_prompt_resolution(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: Uuid,
    prompt_id: String,
    decision: HostPromptDecision,
) -> Result<Ack, Reject> {
    require_game(tx, game).await?;
    let caps = resolve_capabilities_in_tx(tx, principal, game).await?;
    require_game_run(tx, &caps, game, CohostPermissionClass::HostPromptResolve).await?;
    host_prompt_resolution::resolve_host_prompt(
        host_prompt_resolution::HostPromptResolutionContext::new(
            tx,
            host_prompt_resolution::HostPromptResolutionRequest {
                game,
                prompt_id,
                decision,
            },
        ),
    )
    .await
}
fn next_declared_phase_id(
    phase_policy: &domain::pack::PhasePolicy,
    source_phase_id: &domain::phase::PhaseId,
) -> Result<domain::phase::PhaseId, Reject> {
    let source_kind = phase_kind(source_phase_id);
    let source_number = phase_number(source_phase_id);
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
        source_number.checked_add(1).ok_or(Reject::InvalidTarget)?
    } else {
        source_number
    };
    let phase_id = domain::phase::PhaseId::compose(next_kind, next_number)
        .map_err(|_| Reject::InvalidTarget)?;
    validate_phase_id_for_policy(phase_policy, &phase_id)?;
    Ok(phase_id)
}

pub(crate) fn pack_artifact_from_stream(
    stream: &[eventstore::StoredEvent],
) -> Result<content_registry::PackArtifactSnapshot, Reject> {
    let value = stream
        .iter()
        .find(|ev| ev.kind == "GameCreated")
        .and_then(|ev| ev.payload.get("pack_artifact"))
        .cloned()
        .ok_or_else(|| {
            Reject::Internal("game stream has no GameCreated.pack_artifact".to_string())
        })?;
    let artifact: content_registry::PackArtifactSnapshot =
        serde_json::from_value(value).map_err(|error| {
            Reject::Internal(format!("malformed GameCreated.pack_artifact: {error}"))
        })?;
    let pack_ref: content_registry::PackRef = stream
        .iter()
        .find(|ev| ev.kind == "GameCreated")
        .and_then(|ev| ev.payload.get("pack_ref"))
        .cloned()
        .ok_or_else(|| Reject::Internal("game stream has no GameCreated.pack_ref".to_string()))
        .and_then(|value| {
            serde_json::from_value(value).map_err(|error| {
                Reject::Internal(format!("malformed GameCreated.pack_ref: {error}"))
            })
        })?;
    if artifact.pack_ref != pack_ref {
        return Err(Reject::PackValidation(
            "GameCreated pack_ref does not match pack_artifact".to_string(),
        ));
    }
    Ok(artifact)
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
        if event.kind == "SlotOccupancyStarted" {
            occupied.insert(str_payload(event, "slot_id")?);
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

pub(crate) fn load_pack(
    artifact: &content_registry::PackArtifactSnapshot,
) -> Result<Arc<domain::ValidatedPack>, Reject> {
    content_registry::verify_pack_artifact(artifact)
        .map_err(|error| Reject::PackValidation(error.to_string()))
}

fn selected_pack_artifact(name: &str) -> Result<content_registry::PackArtifactSnapshot, Reject> {
    content_registry::select_pack_artifact(name).map_err(|error| match error {
        content_registry::RegistryError::Initialization(message) => Reject::Internal(format!(
            "initialize embedded content registry while selecting {name}: {message}"
        )),
        other => Reject::PackValidation(other.to_string()),
    })
}

pub(crate) async fn current_pack_artifact(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<content_registry::PackArtifactSnapshot, Reject> {
    projections::game_pack_artifact(&mut **tx, game)
        .await
        .map_err(|error| Reject::Internal(error.to_string()))?
        .ok_or(Reject::UnknownGame)
}

pub(crate) async fn current_pack(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<Arc<domain::ValidatedPack>, Reject> {
    load_pack(&current_pack_artifact(tx, game).await?)
}

pub(crate) fn parse_phase_id(phase_id: &str) -> Result<domain::phase::PhaseId, Reject> {
    domain::phase::PhaseId::parse(phase_id).map_err(|_| Reject::InvalidTarget)
}

pub(crate) const fn phase_kind(phase_id: &domain::phase::PhaseId) -> domain::phase::PhaseKind {
    phase_id.kind()
}

pub(crate) const fn phase_number(phase_id: &domain::phase::PhaseId) -> u32 {
    phase_id.number()
}

fn validate_phase_id_for_policy(
    phase_policy: &domain::pack::PhasePolicy,
    phase_id: &domain::phase::PhaseId,
) -> Result<(), Reject> {
    let kind = phase_kind(phase_id);
    if !phase_policy.cadence.contains(&kind) {
        return Err(Reject::InvalidTarget);
    }
    if kind == domain::phase::PhaseKind::Twilight && !phase_policy.twilight {
        return Err(Reject::InvalidTarget);
    }
    Ok(())
}

fn current_snapshot(
    seed: Option<&domain::StateSnapshot>,
    stream: &[eventstore::StoredEvent],
    pack: &domain::Pack,
    phase_id: &domain::phase::PhaseId,
) -> Result<domain::StateSnapshot, Reject> {
    validate_persisted_phase_ids(stream)?;
    let phase_policy = pack.phases.clone();
    let phase_deadline = current_phase_deadline(stream, phase_id).or_else(|| {
        seed.filter(|snapshot| snapshot.phase_id == *phase_id)
            .and_then(|snapshot| snapshot.phase_deadline)
    });
    let mut slots: BTreeMap<String, domain::SlotState> = seed
        .map(|snapshot| {
            snapshot
                .slots
                .iter()
                .cloned()
                .map(|slot| (slot.slot_id.clone(), slot))
                .collect()
        })
        .unwrap_or_default();
    let mut private_channels = seed
        .map(|snapshot| snapshot.private_channels.clone())
        .unwrap_or_default();
    let mut effect_records = seed
        .map(|snapshot| snapshot.effect_records.clone())
        .unwrap_or_default();
    let mut action_history = seed
        .map(|snapshot| snapshot.action_history.clone())
        .unwrap_or_default();
    let mut use_counters = seed
        .map(|snapshot| snapshot.use_counters.clone())
        .unwrap_or_default();
    let mut investigation_memory = seed
        .map(|snapshot| snapshot.investigation_memory.clone())
        .unwrap_or_default();
    let mut delayed_deaths = seed
        .map(|snapshot| snapshot.delayed_deaths.clone())
        .unwrap_or_default();
    let mut action_grants = seed
        .map(|snapshot| snapshot.action_grants.clone())
        .unwrap_or_default();
    let mut conversion_origins = seed
        .map(|snapshot| snapshot.conversion_origins.clone())
        .unwrap_or_default();
    let mut linked_slots = seed
        .map(|snapshot| snapshot.linked_slots.clone())
        .unwrap_or_default();
    let mut retaliations = seed
        .map(|snapshot| snapshot.retaliations.clone())
        .unwrap_or_default();
    let mut backup_targets = seed
        .map(|snapshot| snapshot.backup_targets.clone())
        .unwrap_or_default();
    let mut target_lynch_win_targets = seed
        .map(|snapshot| snapshot.target_lynch_win_targets.clone())
        .unwrap_or_default();
    let mut wolf_carry_tokens = seed
        .map(|snapshot| snapshot.wolf_carry_tokens.clone())
        .unwrap_or_default();
    let mut wolf_beauty_marks = seed
        .map(|snapshot| snapshot.wolf_beauty_marks.clone())
        .unwrap_or_default();
    let mut badges = seed
        .map(|snapshot| snapshot.badges.clone())
        .unwrap_or_default();
    let mut buffered_ita_shots = seed
        .map(|snapshot| snapshot.buffered_ita_shots.clone())
        .unwrap_or_default();
    let mut visit_history = seed
        .map(|snapshot| snapshot.visit_history.clone())
        .unwrap_or_default();

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
                        duration: domain::EffectDuration::Persistent,
                        visibility: domain::EffectVisibility::Hidden,
                    });
                }
            }
            "ResolutionApplied" => {
                let applied = domain::validate_resolution_json(&ev.payload, domain::RESULT_VERSION)
                    .map_err(|e| Reject::Internal(format!("malformed ResolutionApplied: {e}")))?;
                let snapshot = domain::StateSnapshot {
                    phase_id: phase_id.clone(),
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
            "PrivateChannelMemberGranted" => {
                let channel_id = str_payload(ev, "channel_id")?;
                let kind = str_payload(ev, "kind")?;
                let slot_id = str_payload(ev, "slot_id")?;
                let role_key = str_payload(ev, "role_key")?;
                let reveals_alignment = str_payload(ev, "reveals_alignment")?;
                let source = str_payload(ev, "source")?;
                private_channels.retain(|record: &domain::PrivateChannelRecord| {
                    record.channel_id != channel_id || record.slot_id != slot_id
                });
                private_channels.push(domain::PrivateChannelRecord {
                    channel_id,
                    kind,
                    slot_id,
                    role_key,
                    reveals_alignment,
                    source,
                });
            }
            "PrivateChannelMemberRevoked" => {
                let channel_id = str_payload(ev, "channel_id")?;
                let slot_id = str_payload(ev, "slot_id")?;
                private_channels.retain(|record: &domain::PrivateChannelRecord| {
                    record.channel_id != channel_id || record.slot_id != slot_id
                });
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
                let marked_phase_id = optional_str_payload(ev, "phase_id")
                    .map(|phase_id| parse_phase_id(&phase_id))
                    .transpose()?;
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
        phase_id: phase_id.clone(),
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

/// Stored platform events remain JSON for the event store, but every phase
/// coordinate embedded in those payloads must still satisfy the domain value
/// grammar before command reduction can observe it. This makes corrupted
/// historical payloads fail atomically rather than silently influencing a
/// subset of projections or resolver input.
pub(crate) fn validate_persisted_phase_ids(
    stream: &[eventstore::StoredEvent],
) -> Result<(), Reject> {
    for event in stream {
        validate_phase_ids_in_json(
            &event.payload,
            &format!("{}#{}", event.kind, event.stream_seq),
        )?;
    }
    Ok(())
}

fn validate_phase_ids_in_json(value: &serde_json::Value, path: &str) -> Result<(), Reject> {
    match value {
        serde_json::Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                validate_phase_ids_in_json(value, &format!("{path}[{index}]"))?;
            }
        }
        serde_json::Value::Object(fields) => {
            validate_primary_phase_context(fields, path)?;
            for (field, value) in fields {
                let field_path = format!("{path}.{field}");
                if matches!(
                    field.as_str(),
                    "phase_id" | "source_phase_id" | "target_phase_id" | "skipped_phase_id"
                ) {
                    match value {
                        serde_json::Value::Null => {}
                        serde_json::Value::String(phase_id) => {
                            domain::phase::PhaseId::parse(phase_id).map_err(|error| {
                                Reject::Internal(format!(
                                    "invalid persisted phase id at {field_path}: {error}"
                                ))
                            })?;
                        }
                        _ => {
                            return Err(Reject::Internal(format!(
                                "invalid persisted phase id at {field_path}: expected string or null"
                            )));
                        }
                    }
                }
                validate_phase_ids_in_json(value, &field_path)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// A persisted phase coordinate is only its canonical opaque id.  SQL may
/// materialize kind/number for indexing, but stream JSON must never carry a
/// second coordinate representation.
fn validate_primary_phase_context(
    fields: &serde_json::Map<String, serde_json::Value>,
    path: &str,
) -> Result<(), Reject> {
    // A payload may name an id as the primary coordinate or as one side of a
    // phase transition. In every form the opaque id is authoritative; a
    // sibling kind/number pair would be an independently constructible second
    // coordinate and must fail before any reducer observes it.
    for prefix in ["", "source_", "target_", "skipped_"] {
        let id_key = format!("{prefix}phase_id");
        let Some(raw_phase_id) = fields.get(&id_key) else {
            continue;
        };
        let kind_key = format!("{prefix}phase_kind");
        let number_key = format!("{prefix}phase_number");
        if fields.contains_key(&kind_key) || fields.contains_key(&number_key) {
            return Err(Reject::Internal(format!(
                "redundant persisted phase coordinates at {path}; use {id_key} only"
            )));
        }
        match raw_phase_id {
            serde_json::Value::String(raw_phase_id) => {
                domain::phase::PhaseId::parse(raw_phase_id).map_err(|error| {
                    Reject::Internal(format!(
                        "invalid persisted phase id at {path}.{id_key}: {error}"
                    ))
                })?;
            }
            serde_json::Value::Null => {}
            _ => {
                return Err(Reject::Internal(format!(
                    "malformed persisted phase id at {path}.{id_key}"
                )));
            }
        }
    }
    Ok(())
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

fn current_phase_deadline(
    stream: &[eventstore::StoredEvent],
    phase_id: &domain::phase::PhaseId,
) -> Option<i64> {
    stream
        .iter()
        .filter(|ev| matches!(ev.kind.as_str(), "DeadlineSet" | "DeadlineExtended"))
        .filter(|ev| ev.payload["phase_id"].as_str() == Some(phase_id.as_str()))
        .filter_map(|ev| ev.payload["at"].as_i64())
        .next_back()
}

pub(crate) fn next_stream_logical_time(stream: &[eventstore::StoredEvent]) -> i64 {
    stream.last().map(|ev| ev.stream_seq + 1).unwrap_or(1)
}

fn current_submissions(
    stream: &[eventstore::StoredEvent],
    phase_id: &domain::phase::PhaseId,
) -> Vec<domain::Submission> {
    let mut submissions = Vec::new();

    for ev in stream {
        match ev.kind.as_str() {
            "VoteSubmitted" if ev.payload["phase_id"].as_str() == Some(phase_id.as_str()) => {
                if let (Some(actor), Some(target)) =
                    (ev.payload["actor"].as_str(), ev.payload["target"].as_str())
                {
                    submissions.push(domain::Submission {
                        action_id: format!("vote:{}:{actor}", ev.stream_seq),
                        actor: actor.to_string(),
                        template_id: "day_vote".to_string(),
                        targets: vec![target.to_string()],
                        phase_id: phase_id.clone(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: false,
                        metadata: metadata_from_payload(&ev.payload),
                    });
                }
            }
            "VoteWithdrawn" if ev.payload["phase_id"].as_str() == Some(phase_id.as_str()) => {
                if let Some(actor) = ev.payload["actor"].as_str() {
                    submissions.push(domain::Submission {
                        action_id: format!("vote:{}:{actor}", ev.stream_seq),
                        actor: actor.to_string(),
                        template_id: "day_vote".to_string(),
                        targets: Vec::new(),
                        phase_id: phase_id.clone(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: true,
                        metadata: BTreeMap::new(),
                    });
                }
            }
            "ActionSubmitted" if ev.payload["phase_id"].as_str() == Some(phase_id.as_str()) => {
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
                        phase_id: phase_id.clone(),
                        submitted_at: ev.stream_seq as u64,
                        withdrawn: false,
                        metadata: metadata_from_payload(&ev.payload),
                    });
                }
            }
            "ActionWithdrawn" => {
                let applies_to_phase = ev.payload["phase_id"]
                    .as_str()
                    .map(|withdraw_phase| withdraw_phase == phase_id.as_str())
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

fn collect_night_victims_from_applied(
    applied: &domain::ResolutionApplied,
    state: &domain::StateSnapshot,
    phase_number: u32,
    recorded_at: u64,
    night_victims: &mut Vec<domain::DayAnnouncementInput>,
) {
    if applied.phase_id.kind() != domain::phase::PhaseKind::Night
        || applied.phase_id.number().checked_add(1) != Some(phase_number)
    {
        return;
    }
    for indexed in &applied.events {
        if let domain::InnerEvent::PlayerKilled {
            slot_id,
            cause,
            attackers,
            unstoppable,
            ..
        } = &indexed.event
        {
            let role_key = state
                .slots
                .iter()
                .find(|slot| slot.slot_id == *slot_id)
                .map(|slot| slot.role_key.clone())
                .filter(|role_key| !role_key.is_empty());
            night_victims.push(domain::DayAnnouncementInput {
                player_id: slot_id.clone(),
                cause: cause.clone(),
                source_action_id: None,
                attackers: attackers.clone(),
                unstoppable: *unstoppable,
                role_key,
                recorded_at: Some(recorded_at),
            });
        }
    }
}

fn current_day_phase_inputs(
    stream: &[eventstore::StoredEvent],
    state: &domain::StateSnapshot,
    phase_id: &domain::phase::PhaseId,
    last_resolution: Option<&serde_json::Value>,
    last_resolution_seq: i64,
) -> Result<domain::DayPhaseInputs, Reject> {
    if phase_id.kind() != domain::phase::PhaseKind::Day {
        return Ok(domain::DayPhaseInputs::default());
    }
    let phase_number = phase_id.number();

    let mut night_victims = Vec::new();
    let mut ita_session_controls = Vec::new();
    if let Some(value) = last_resolution {
        let applied =
            domain::validate_resolution_json(value, domain::RESULT_VERSION).map_err(|e| {
                Reject::Internal(format!("malformed checkpoint ResolutionApplied: {e}"))
            })?;
        collect_night_victims_from_applied(
            &applied,
            state,
            phase_number,
            last_resolution_seq as u64,
            &mut night_victims,
        );
    }
    for ev in stream {
        if ev.kind == "ItaSessionControlRecorded"
            && ev.payload["phase_id"].as_str() == Some(state.phase_id.as_str())
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
        collect_night_victims_from_applied(
            &applied,
            state,
            phase_number,
            ev.stream_seq as u64,
            &mut night_victims,
        );
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
pub(crate) async fn require_game(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<(), Reject> {
    if projections::game_exists(&mut **tx, game).await? {
        command_runtime_checkpoint(CommandRuntimeCheckpoint::GameValidated).await;
        Ok(())
    } else {
        Err(Reject::UnknownGame)
    }
}

pub(crate) async fn resolve_capabilities_in_tx(
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
pub(crate) async fn require_game_run(
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
pub(crate) async fn require_slot_occupant(
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
    if let Some(event_id) = game_platform::event_id_from_private_channel(channel_id) {
        let event = day_runtime::load_day_event(tx, game, event_id).await?;
        if event.state != "open" {
            return Err(Reject::NotAuthorized);
        }
    }
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
) -> Result<domain::phase::PhaseId, Reject> {
    match projections::phase_state(&mut **tx, game).await? {
        Some(ps) if ps.locked => Err(Reject::PhaseLocked),
        Some(ps) => {
            let phase_id = ps.phase_id;
            if phase_has_pending_prompt(tx, game, &phase_id).await? {
                Err(Reject::PhaseLocked)
            } else {
                Ok(phase_id)
            }
        }
        None => Err(Reject::PhaseLocked), // no phase open → cannot act
    }
}

async fn phase_has_pending_prompt(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    phase_id: &domain::phase::PhaseId,
) -> Result<bool, Reject> {
    Ok(projections::host_prompts(&mut **tx, game)
        .await?
        .into_iter()
        .any(|prompt| prompt.phase_id == *phase_id && prompt.status == "pending"))
}

/// Votes are legal only while the current open phase is a Day window.
async fn require_open_day_phase(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<domain::phase::PhaseId, Reject> {
    let phase = require_open_phase(tx, game).await?;
    if phase_kind(&phase) != domain::phase::PhaseKind::Day {
        return Err(Reject::PhaseLocked);
    }
    Ok(phase)
}

/// The current phase id, if any (no lock check — for post attribution).
pub(crate) async fn current_phase(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
) -> Result<Option<domain::phase::PhaseId>, Reject> {
    Ok(projections::phase_state(&mut **tx, game)
        .await?
        .map(|phase| phase.phase_id))
}

pub(crate) async fn require_slot_alive(
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
            let pack = current_pack(tx, game).await?;
            if !pack.document().treestump_policy.enabled {
                return Err(Reject::SlotNotAlive);
            }
            let tags = projections::slot_status_tags(&mut **tx, game, slot).await?;
            if tags
                .iter()
                .any(|tag| tag == &pack.document().treestump_policy.status_tag)
            {
                Ok(())
            } else {
                Err(Reject::SlotNotAlive)
            }
        }
        None => Err(Reject::UnknownSlot),
    }
}

pub async fn active_action_templates_for_actor_phase(
    pool: &PgPool,
    game: Uuid,
    phase_id: &domain::phase::PhaseId,
    actor_slot: &str,
) -> Result<BTreeSet<String>, Reject> {
    Ok(
        action_submission::active_actions_for_actor_phase(pool, game, phase_id, actor_slot)
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
    phase_id: &domain::phase::PhaseId,
    actor_slot: &str,
) -> Result<Vec<CurrentAction>, Reject> {
    Ok(
        action_submission::active_actions_for_actor_phase(pool, game, phase_id, actor_slot)
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

async fn validate_vote_actor_from_projections(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    pack: &domain::Pack,
    actor_slot: &str,
) -> Result<(), Reject> {
    if !pack.idiot_policy.enabled {
        return Ok(());
    }
    let effects = projections::slot_effects_for_slot(&mut **tx, game, actor_slot).await?;
    if effects
        .iter()
        .any(|effect| effect.effect == pack.idiot_policy.vote_loss_effect)
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
    if !phase_input.pack.document().vote.hammer {
        return Ok(None);
    }

    if phase_input.phase_id.kind() != domain::phase::PhaseKind::Day {
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
    let output = domain::resolve(preview_input.resolve_input(EngineRunKind::HammerPreview))
        .map_err(|error| Reject::Internal(format!("invalid hammer preview input: {error}")))?;
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
         (principal_id, command_id, command_fingerprint, stream_id, stream_seqs) \
         VALUES ($1, $2, $3, $4, ARRAY[]::BIGINT[]) \
         ON CONFLICT (principal_id, command_id) DO NOTHING",
    )
    .bind(receipt.principal_id.as_uuid())
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
         WHERE principal_id = $1 AND command_id = $2",
    )
    .bind(receipt.principal_id.as_uuid())
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
         WHERE principal_id = $1 AND command_id = $2",
    )
    .bind(receipt.principal_id.as_uuid())
    .bind(receipt.command_id)
    .bind(&ack.stream_seqs)
    .execute(&mut **tx)
    .await
    .map_err(|e| Reject::Internal(e.to_string()))?;

    Ok(())
}

/// Append and synchronously fold projections inside the command transaction.
/// The caller owns receipt claim/ack storage and the single final commit.
pub(crate) async fn persist(
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
        let initiator = match audit.initiator {
            AuditInitiator::Principal(principal_id) => serde_json::json!({
                "kind": "principal",
                "principal_id": principal_id,
            }),
            AuditInitiator::Service(service) => serde_json::json!({
                "kind": "service",
                "service_id": service.id(),
            }),
        };
        meta.insert("initiator".to_string(), initiator);
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
    fn phase_progression_rejects_storage_ordinal_limit() {
        let policy = domain::pack::PhasePolicy {
            twilight: false,
            cadence: vec![
                domain::phase::PhaseKind::Night,
                domain::phase::PhaseKind::Day,
            ],
            subsegments: std::collections::BTreeMap::new(),
        };
        let source =
            domain::phase::PhaseId::compose(domain::phase::PhaseKind::Day, i32::MAX as u32)
                .expect("the largest persistence-safe ordinal is canonical");

        assert_eq!(
            next_declared_phase_id(&policy, &source),
            Err(Reject::InvalidTarget)
        );
    }

    #[test]
    fn persisted_phase_payloads_reject_noncanonical_ids_before_reduction() {
        let event = eventstore::StoredEvent {
            seq: 1,
            stream_id: Uuid::nil(),
            stream_seq: 1,
            kind: "PhaseAdvanced".to_string(),
            version: 1,
            payload: serde_json::json!({ "phase_id": "D01R02" }),
            actor: eventstore::ActorId::Host,
            occurred_at: 0,
            causation_id: None,
            meta: serde_json::json!({}),
        };

        assert!(matches!(
            validate_persisted_phase_ids(&[event]),
            Err(Reject::Internal(message)) if message.contains("D01R02")
        ));
    }

    #[test]
    fn persisted_phase_payloads_reject_redundant_primary_coordinates() {
        let payload = serde_json::json!({
            "phase_id": "D01",
            "phase_kind": "Night",
            "phase_number": 1,
        });

        assert!(matches!(
            validate_phase_ids_in_json(&payload, "test"),
            Err(Reject::Internal(message)) if message.contains("phase_id only")
        ));
    }

    #[test]
    fn persisted_phase_payloads_reject_redundant_transition_coordinates() {
        let payload = serde_json::json!({
            "source_phase_id": "D01",
            "source_phase_kind": "Day",
            "target_phase_id": "N01",
            "target_phase_number": 1,
        });

        assert!(matches!(
            validate_phase_ids_in_json(&payload, "test"),
            Err(Reject::Internal(message)) if message.contains("source_phase_id only")
        ));
    }

    #[test]
    fn official_votecount_body_is_projection_derived_and_deterministic() {
        let rows = vec![
            projections::VoteCountRow {
                game_id: Uuid::nil(),
                phase_id: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
                candidate_slot: "slot_2".to_string(),
                count: 4,
            },
            projections::VoteCountRow {
                game_id: Uuid::nil(),
                phase_id: domain::phase::PhaseId::parse("D01")
                    .expect("static test phase id is canonical"),
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

    #[test]
    fn host_fiat_grant_sources_are_opaque_and_collision_free_across_principals() {
        let command_id = Uuid::nil();
        let host_principal = fixture_principal_id("host_account");
        let cohost_principal = fixture_principal_id("cohost_account");
        let host = host_fiat_grant_source(&host_principal, command_id, 0);
        let cohost = host_fiat_grant_source(&cohost_principal, command_id, 0);
        let second_effect = host_fiat_grant_source(&host_principal, command_id, 1);

        assert_ne!(host, cohost);
        assert_ne!(host, second_effect);
        assert!(host.starts_with("host_fiat:grant:"));
        assert!(host.ends_with(":0"));
        assert!(!host.contains("host_account"));
        assert!(!cohost.contains("cohost_account"));
    }
}
