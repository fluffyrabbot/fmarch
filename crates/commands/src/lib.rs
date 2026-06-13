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
//! 4. **persist** — [`projections::append_and_project`] in one tx; same-stream
//!    appends serialize in the store, with [`Reject::StreamConflict`] reserved
//!    for defensive unique-constraint conflicts.
//! 5. **ack** — [`Ack`] or a TYPED [`Reject`].
//!
//! Authority is RESOLVED once and PASSED INWARD: validation receives a
//! [`caps::CapabilitySet`] and asks `grants(required)`. Inner code never
//! re-derives authority (confused-deputy defense, doc 06).

use caps::{Capability, CapabilitySet, Principal};
use eventstore::{ActorId, EventInput};
use projections::{append_and_project_in_tx, ProjectionError};
use sqlx::{postgres::PgPool, Row};
use uuid::Uuid;

mod model;
pub use model::{Ack, Command, Reject, VoteTarget};

#[derive(Debug, Clone)]
struct ReceiptClaim {
    principal_user_id: String,
    command_id: Uuid,
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
        } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "RoleAssigned",
                serde_json::json!({ "slot_id": slot, "role_key": role_key }),
                ActorId::Host,
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
            host_lifecycle(
                pool,
                principal,
                game,
                "GameStarted",
                serde_json::json!({ "phase_id": phase }),
                ActorId::Host,
                receipt,
            )
            .await
        }
        Command::OpenDayPhase { game, phase } => {
            host_lifecycle(
                pool,
                principal,
                game,
                "PhaseAdvanced",
                serde_json::json!({ "phase_id": phase }),
                ActorId::Host,
                receipt,
            )
            .await
        }
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

        // ── slice commands ──
        Command::SubmitVote {
            game,
            actor_slot,
            target,
        } => submit_vote(pool, principal, game, actor_slot, target, receipt).await,
        Command::WithdrawVote { game, actor_slot } => {
            withdraw_vote(pool, principal, game, actor_slot, receipt).await
        }
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
    let phase = require_open_phase(pool, game).await?;
    require_slot_alive(pool, game, &actor_slot).await?;
    let target_str = validate_target(pool, game, &target).await?;

    // 3. produce events.
    let ev = EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": actor_slot, "target": target_str, "phase_id": phase }),
        ActorId::Slot(actor_slot.clone()),
        0,
    );

    // 4. persist (one tx; same-stream appends serialize in the store).
    persist(pool, game, &[ev], receipt).await
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
    let phase = require_open_phase(pool, game).await?;
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
        Some(ps) => Ok(ps.phase_id),
        None => Err(Reject::PhaseLocked), // no phase open → cannot act
    }
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
