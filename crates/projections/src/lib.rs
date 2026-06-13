//! `projections` — synchronous, rebuildable read models over the event log
//! (doc 02 / doc 10).
//!
//! Projections here:
//! - `votecount`      — the RUNNING tally. Phase-3 ruling: UNWEIGHTED, keyed by
//!   each actor-slot's CURRENT ballot. A `VoteSubmitted` OVERWRITES that actor's
//!   ballot; `VoteWithdrawn { actor, phase_id }` removes it; the tally is the
//!   COUNT of targets. Backed by the `vote_ballot` table (one row per actor per
//!   phase) so overwrite/withdraw are pure local upsert/delete. Weights remain an
//!   engine/official-`DayVoteOutcome` concern, NOT the running tally.
//! - `slot_state`     — per-slot lifecycle + role reveal, folded from
//!   `RoleAssigned` and engine inner events wrapped in `ResolutionApplied`.
//! - `game_authority` — host + cohosts per game (`GameCreated`, `CohostAdded`).
//!   Backs `caps` HostOf / CohostOf resolution.
//! - `slot_occupancy` — the LIVE slot→user mapping (`SlotAssigned`,
//!   `ReplacementCompleted`). The slot id is STABLE across replacement; only the
//!   occupant moves. Backs `caps` SlotOccupant resolution.
//! - `phase_state`    — current phase, lock, deadline (`GameStarted`/
//!   `PhaseAdvanced`, `DeadlineSet`/`DeadlineExtended`, `ThreadLocked`/
//!   `ThreadUnlocked`). Backs command validation (phase open/unlocked).
//!
//! The centerpiece is [`append_and_project`]: it appends events AND folds them
//! into the projection tables **in one transaction** (doc 02 synchronous
//! projections → strong read-your-writes). [`rebuild`] truncates a game's
//! projections and re-folds the log; same log ⇒ same projection (determinism).
//!
//! Runtime sqlx queries only (no `query!` macro) so `cargo build` needs no DB.

use eventstore::{append_in_tx, EventInput, StoreError, StoredEvent};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

/// A row of the `votecount` running tally: the COUNT of current ballots cast at
/// `candidate_slot` in `phase_id` (unweighted; Phase-3 ruling).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoteCountRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub candidate_slot: String,
    /// Number of slots whose CURRENT ballot targets `candidate_slot`.
    pub count: i64,
}

/// A row of the `slot_state` projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotStateRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub alive: bool,
    pub role_key: Option<String>,
    pub role_revealed: bool,
}

/// A row of the `game_authority` projection (host/cohost per game).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GameAuthorityRow {
    pub game_id: Uuid,
    pub user_id: String,
    /// `"host"` | `"cohost"`.
    pub role: String,
}

/// A row of the `slot_occupancy` projection: the slot's CURRENT occupant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotOccupancyRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub occupant_user_id: String,
}

/// The `phase_state` projection row: the game's current phase window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhaseStateRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub locked: bool,
    pub deadline: Option<i64>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectionError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("malformed event payload for kind {kind}: {source}")]
    Payload {
        kind: String,
        #[source]
        source: serde_json::Error,
    },
}

// ───────────────────────── fold: one event → projection deltas ─────────────────────────

/// Fold a single stored event into the projection tables, inside `tx`.
///
/// Dispatch is on the event `kind`. Engine inner events (`PlayerKilled`,
/// `PlayerSaved`, ...) are not top-level kinds — they ride inside a
/// `ResolutionApplied` envelope, so that kind unwraps and folds each inner event.
///
/// Determinism: this is a pure function of the event data plus current table
/// state. No wall-clock, no RNG, no external calls (doc 02 rebuild rule).
async fn fold_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    ev: &StoredEvent,
) -> Result<(), ProjectionError> {
    match ev.kind.as_str() {
        // ── votecount (running, ballot-keyed) ──
        "VoteSubmitted" => {
            // OVERWRITE this actor's current ballot for the phase.
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let actor = str_field(p, "actor", &ev.kind)?;
            let target = vote_target(p, &ev.kind)?;
            upsert_ballot(tx, game_id, &phase_id, &actor, &target).await?;
        }
        "VoteWithdrawn" => {
            // REMOVE this actor's ballot for the phase (no target needed).
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let actor = str_field(p, "actor", &ev.kind)?;
            delete_ballot(tx, game_id, &phase_id, &actor).await?;
        }

        // ── slot_state ──
        "RoleAssigned" => {
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let role_key = str_field(p, "role_key", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            sqlx::query("UPDATE slot_state SET role_key = $3 WHERE game_id = $1 AND slot_id = $2")
                .bind(game_id)
                .bind(&slot_id)
                .bind(&role_key)
                .execute(&mut **tx)
                .await?;
        }

        // ── game_authority (caps: HostOf / CohostOf) ──
        "GameCreated" => {
            let host = str_field(&ev.payload, "host", &ev.kind)?;
            upsert_authority(tx, game_id, &host, "host").await?;
        }
        "CohostAdded" => {
            let cohost = str_field(&ev.payload, "user_id", &ev.kind)?;
            upsert_authority(tx, game_id, &cohost, "cohost").await?;
        }

        // ── slot lifecycle / occupancy ──
        "SlotAdded" => {
            let slot_id = str_field(&ev.payload, "slot_id", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
        }
        "SlotAssigned" => {
            // Occupancy begins: slot → user (the LIVE mapping).
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let user_id = str_field(p, "user_id", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            upsert_occupancy(tx, game_id, &slot_id, &user_id).await?;
        }
        "ReplacementCompleted" => {
            // The slot id is UNCHANGED; only the occupant mapping moves. The
            // slot's history (votes/posts) is keyed by slot_id elsewhere and is
            // therefore preserved — THIS is the User≠Slot payoff.
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let incoming = str_field(p, "incoming_user", &ev.kind)?;
            upsert_occupancy(tx, game_id, &slot_id, &incoming).await?;
        }

        // ── phase_state (validation: phase open / locked / deadline) ──
        "GameStarted" | "PhaseAdvanced" => {
            // Set the current phase; a new phase starts unlocked with no deadline.
            let phase_id = str_field(&ev.payload, "phase_id", &ev.kind)?;
            set_phase(tx, game_id, &phase_id).await?;
        }
        "DeadlineSet" | "DeadlineExtended" => {
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let at =
                p.get("at")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| ProjectionError::Payload {
                        kind: ev.kind.clone(),
                        source: serde::de::Error::custom("missing integer field `at`"),
                    })?;
            ensure_phase(tx, game_id, &phase_id).await?;
            sqlx::query("UPDATE phase_state SET deadline = $2 WHERE game_id = $1")
                .bind(game_id)
                .bind(at)
                .execute(&mut **tx)
                .await?;
        }
        "ThreadLocked" => set_locked(tx, game_id, true).await?,
        "ThreadUnlocked" => set_locked(tx, game_id, false).await?,

        // ── engine resolution envelope: unwrap and fold inner events ──
        "ResolutionApplied" => {
            let applied: domain::ResolutionApplied = serde_json::from_value(ev.payload.clone())
                .map_err(|e| ProjectionError::Payload {
                    kind: ev.kind.clone(),
                    source: e,
                })?;
            for indexed in &applied.events {
                fold_inner(tx, game_id, &indexed.event).await?;
            }
        }

        // ── reveal flip (doc 10): end-of-game flips role visibility ──
        "GameCompleted" => {
            sqlx::query("UPDATE slot_state SET role_revealed = TRUE WHERE game_id = $1")
                .bind(game_id)
                .execute(&mut **tx)
                .await?;
        }

        // Everything else (posts, channels) is not folded by THESE projections.
        // Ignored here, not rejected — other projections own it.
        _ => {}
    }
    Ok(())
}

/// Fold a single engine inner event (already unwrapped from `ResolutionApplied`).
async fn fold_inner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    ev: &domain::InnerEvent,
) -> Result<(), ProjectionError> {
    use domain::InnerEvent::*;
    match ev {
        PlayerKilled { slot_id, .. } => {
            ensure_slot(tx, game_id, slot_id).await?;
            sqlx::query("UPDATE slot_state SET alive = FALSE WHERE game_id = $1 AND slot_id = $2")
                .bind(game_id)
                .bind(slot_id)
                .execute(&mut **tx)
                .await?;
        }
        PlayerSaved { slot_id, .. } => {
            // A save cancels a would-be kill at resolution time; the slot was
            // never marked dead, so this just guarantees the row exists alive.
            ensure_slot(tx, game_id, slot_id).await?;
        }
        WinReached { .. } => {
            // Win reached → reveal roles (the reveal flag, doc 10).
            sqlx::query("UPDATE slot_state SET role_revealed = TRUE WHERE game_id = $1")
                .bind(game_id)
                .execute(&mut **tx)
                .await?;
        }
        // Other inner events (DayVoteOutcome, investigations, effects, ...) are
        // not folded by slot_state/votecount here.
        _ => {}
    }
    Ok(())
}

// ───────────────────────── public API ─────────────────────────

/// Append `events` to `stream_id` AND fold them into the projections, **in one
/// DB transaction** (doc 02 synchronous projections). Appends to the same stream
/// serialize in the event store before stream_seq assignment; if the defensive
/// unique constraint is still tripped by an out-of-band writer, the whole tx —
/// projection updates included — rolls back.
///
/// `game_id` keys the projections; it equals `stream_id` for game streams.
pub async fn append_and_project(
    pool: &PgPool,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let mut tx = pool.begin().await?;
    let stored = append_and_project_in_tx(&mut tx, stream_id, events).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Append `events` and fold synchronous projections inside an existing
/// transaction. This is the atomic seam used by network command receipts: the
/// receipt row, event append, and hot projections all commit or roll back
/// together.
pub async fn append_and_project_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let stored = append_in_tx(tx, stream_id, events).await?;
    for ev in &stored {
        fold_event(tx, stream_id, ev).await?;
    }
    Ok(stored)
}

/// Rebuild a game's projections from the log: truncate this game's projection
/// rows, then re-fold every event in `stream_seq` order. Deterministic — same
/// log ⇒ same projection (doc 02).
pub async fn rebuild(pool: &PgPool, game_id: Uuid) -> Result<(), ProjectionError> {
    let mut tx = pool.begin().await?;

    for table in [
        "vote_ballot",
        "slot_state",
        "game_authority",
        "slot_occupancy",
        "phase_state",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE game_id = $1"))
            .bind(game_id)
            .execute(&mut *tx)
            .await?;
    }

    // Load the stream in order (within this tx) and re-fold. We read inside the
    // tx so the rebuild is a consistent snapshot.
    let rows = sqlx::query(
        r#"
        SELECT seq, stream_id, stream_seq, kind, version, payload, actor, occurred_at, causation_id, meta
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(game_id)
    .fetch_all(&mut *tx)
    .await?;

    for row in rows {
        let stored = StoredEvent {
            seq: row.try_get("seq")?,
            stream_id: row.try_get("stream_id")?,
            stream_seq: row.try_get("stream_seq")?,
            kind: row.try_get("kind")?,
            version: row.try_get("version")?,
            payload: row.try_get("payload")?,
            actor: serde_json::from_value(row.try_get::<serde_json::Value, _>("actor")?)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            occurred_at: row.try_get("occurred_at")?,
            causation_id: row.try_get("causation_id")?,
            meta: row.try_get("meta")?,
        };
        let stored = eventstore::upcast(stored);
        fold_event(&mut tx, game_id, &stored).await?;
    }

    tx.commit().await?;
    Ok(())
}

// ───────────────────────── read helpers (for tests / queries / caps) ─────────────────────────

/// Read a game's running votecount: COUNT of current ballots per candidate,
/// ordered deterministically. Candidates with zero ballots are absent.
pub async fn votecount(pool: &PgPool, game_id: Uuid) -> Result<Vec<VoteCountRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT phase_id, target AS candidate_slot, COUNT(*) AS n \
         FROM vote_ballot WHERE game_id = $1 \
         GROUP BY phase_id, target ORDER BY phase_id, target",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| VoteCountRow {
            game_id,
            phase_id: r.get("phase_id"),
            candidate_slot: r.get("candidate_slot"),
            count: r.get("n"),
        })
        .collect())
}

/// Read a game's slot_state rows, ordered deterministically.
pub async fn slot_state(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotStateRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, alive, role_key, role_revealed FROM slot_state \
         WHERE game_id = $1 ORDER BY slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SlotStateRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            alive: r.get("alive"),
            role_key: r.get("role_key"),
            role_revealed: r.get("role_revealed"),
        })
        .collect())
}

/// Read a game's host/cohost authority rows (for `caps` resolution).
pub async fn game_authority(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<GameAuthorityRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, user_id, role FROM game_authority \
         WHERE game_id = $1 ORDER BY role, user_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| GameAuthorityRow {
            game_id: r.get("game_id"),
            user_id: r.get("user_id"),
            role: r.get("role"),
        })
        .collect())
}

/// The CURRENT occupant of a slot, if any (the live mapping for `caps`).
pub async fn slot_occupant(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Option<String>, ProjectionError> {
    let row = sqlx::query(
        "SELECT occupant_user_id FROM slot_occupancy WHERE game_id = $1 AND slot_id = $2",
    )
    .bind(game_id)
    .bind(slot_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("occupant_user_id")))
}

/// Read a game's slot_occupancy rows, ordered deterministically.
pub async fn slot_occupancy(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotOccupancyRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, occupant_user_id FROM slot_occupancy \
         WHERE game_id = $1 ORDER BY slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SlotOccupancyRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            occupant_user_id: r.get("occupant_user_id"),
        })
        .collect())
}

/// The game's current phase window, if a phase has started.
pub async fn phase_state(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Option<PhaseStateRow>, ProjectionError> {
    let row = sqlx::query(
        "SELECT game_id, phase_id, locked, deadline FROM phase_state WHERE game_id = $1",
    )
    .bind(game_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| PhaseStateRow {
        game_id: r.get("game_id"),
        phase_id: r.get("phase_id"),
        locked: r.get("locked"),
        deadline: r.get("deadline"),
    }))
}

/// Whether a slot exists in the game (has a `slot_state` row).
pub async fn slot_exists(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<bool, ProjectionError> {
    let row = sqlx::query("SELECT 1 AS x FROM slot_state WHERE game_id = $1 AND slot_id = $2")
        .bind(game_id)
        .bind(slot_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Whether a slot is alive (`true`), dead (`false`), or absent (`None`).
pub async fn slot_alive(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Option<bool>, ProjectionError> {
    let row = sqlx::query("SELECT alive FROM slot_state WHERE game_id = $1 AND slot_id = $2")
        .bind(game_id)
        .bind(slot_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("alive")))
}

/// Whether a game exists (has a `game_authority` host row).
pub async fn game_exists(pool: &PgPool, game_id: Uuid) -> Result<bool, ProjectionError> {
    let row = sqlx::query("SELECT 1 AS x FROM game_authority WHERE game_id = $1 LIMIT 1")
        .bind(game_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

// ───────────────────────── low-level upserts ─────────────────────────

async fn upsert_ballot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    actor_slot: &str,
    target: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO vote_ballot (game_id, phase_id, actor_slot, target)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_id, phase_id, actor_slot)
        DO UPDATE SET target = EXCLUDED.target
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(actor_slot)
    .bind(target)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_ballot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM vote_ballot WHERE game_id = $1 AND phase_id = $2 AND actor_slot = $3")
        .bind(game_id)
        .bind(phase_id)
        .bind(actor_slot)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn ensure_slot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO slot_state (game_id, slot_id, alive, role_key, role_revealed)
        VALUES ($1, $2, TRUE, NULL, FALSE)
        ON CONFLICT (game_id, slot_id) DO NOTHING
        "#,
    )
    .bind(game_id)
    .bind(slot_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_authority(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    user_id: &str,
    role: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO game_authority (game_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (game_id, user_id, role) DO NOTHING",
    )
    .bind(game_id)
    .bind(user_id)
    .bind(role)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_occupancy(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    user_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO slot_occupancy (game_id, slot_id, occupant_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (game_id, slot_id)
        DO UPDATE SET occupant_user_id = EXCLUDED.occupant_user_id
        "#,
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Set the current phase: a new phase starts unlocked with no deadline.
async fn set_phase(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO phase_state (game_id, phase_id, locked, deadline)
        VALUES ($1, $2, FALSE, NULL)
        ON CONFLICT (game_id)
        DO UPDATE SET phase_id = EXCLUDED.phase_id, locked = FALSE, deadline = NULL
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Ensure a phase_state row exists for the game (without clobbering an existing
/// phase). Used by deadline events that may arrive for the current phase.
async fn ensure_phase(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO phase_state (game_id, phase_id, locked, deadline)
        VALUES ($1, $2, FALSE, NULL)
        ON CONFLICT (game_id) DO NOTHING
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn set_locked(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    locked: bool,
) -> Result<(), ProjectionError> {
    sqlx::query("UPDATE phase_state SET locked = $2 WHERE game_id = $1")
        .bind(game_id)
        .bind(locked)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

// ───────────────────────── payload accessors ─────────────────────────

fn str_field(p: &serde_json::Value, key: &str, kind: &str) -> Result<String, ProjectionError> {
    p.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom(format!("missing string field `{key}`")),
        })
}

/// Vote target: a slot id, or the sentinel "no_lynch". Accepts `{ "target": "slot_x" }`
/// or `{ "target": "no_lynch" }` / `{ "target": { "no_lynch": true } }`.
fn vote_target(p: &serde_json::Value, kind: &str) -> Result<String, ProjectionError> {
    match p.get("target") {
        Some(serde_json::Value::String(s)) => Ok(s.clone()),
        Some(serde_json::Value::Object(_)) => Ok("no_lynch".to_string()),
        _ => Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom("missing `target` (slot id or no_lynch)"),
        }),
    }
}
