//! `projections` — synchronous, rebuildable read models over the event log
//! (doc 02 / doc 10).
//!
//! Two projections here:
//! - `votecount`  — running tally folded from `VoteSubmitted` / `VoteWithdrawn`.
//! - `slot_state` — per-slot lifecycle + role-reveal, folded from `RoleAssigned`
//!   and the engine inner events (`PlayerKilled` / `PlayerSaved`) that arrive
//!   wrapped in a `ResolutionApplied` envelope.
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

/// A row of the `votecount` running tally.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoteCountRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub candidate_slot: String,
    pub weight: f64,
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
        // ── votecount (running tally) ──
        "VoteSubmitted" => {
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let candidate = vote_target(p, &ev.kind)?;
            let weight = p.get("weight").and_then(|w| w.as_f64()).unwrap_or(1.0);
            upsert_votecount(tx, game_id, &phase_id, &candidate, weight).await?;
        }
        "VoteWithdrawn" => {
            // A withdrawal removes the prior ballot's weight from its candidate.
            // The withdrawal carries the original target+phase so the fold stays
            // a pure local delta (no cross-row scan needed for determinism).
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let candidate = vote_target(p, &ev.kind)?;
            let weight = p.get("weight").and_then(|w| w.as_f64()).unwrap_or(1.0);
            upsert_votecount(tx, game_id, &phase_id, &candidate, -weight).await?;
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

        // Everything else (posts, channels, lifecycle) is not folded by THESE
        // two projections. Ignored here, not rejected — other projections own it.
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
/// DB transaction** (doc 02 synchronous projections). The append's optimistic
/// concurrency still applies: a conflicting concurrent append returns
/// [`StoreError::Conflict`] (via [`ProjectionError::Store`]) and the whole tx —
/// projection updates included — rolls back.
///
/// `game_id` keys the projections; it equals `stream_id` for game streams.
pub async fn append_and_project(
    pool: &PgPool,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let mut tx = pool.begin().await?;
    let stored = append_in_tx(&mut tx, stream_id, events).await?;
    for ev in &stored {
        fold_event(&mut tx, stream_id, ev).await?;
    }
    tx.commit().await?;
    Ok(stored)
}

/// Rebuild a game's projections from the log: truncate this game's projection
/// rows, then re-fold every event in `stream_seq` order. Deterministic — same
/// log ⇒ same projection (doc 02).
pub async fn rebuild(pool: &PgPool, game_id: Uuid) -> Result<(), ProjectionError> {
    let mut tx = pool.begin().await?;

    sqlx::query("DELETE FROM votecount WHERE game_id = $1")
        .bind(game_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM slot_state WHERE game_id = $1")
        .bind(game_id)
        .execute(&mut *tx)
        .await?;

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

// ───────────────────────── read helpers (for tests / queries) ─────────────────────────

/// Read a game's votecount rows, ordered deterministically.
pub async fn votecount(pool: &PgPool, game_id: Uuid) -> Result<Vec<VoteCountRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, candidate_slot, weight FROM votecount \
         WHERE game_id = $1 ORDER BY phase_id, candidate_slot",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| VoteCountRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            candidate_slot: r.get("candidate_slot"),
            weight: r.get("weight"),
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

// ───────────────────────── low-level upserts ─────────────────────────

async fn upsert_votecount(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    candidate: &str,
    delta: f64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO votecount (game_id, phase_id, candidate_slot, weight)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_id, phase_id, candidate_slot)
        DO UPDATE SET weight = votecount.weight + EXCLUDED.weight
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(candidate)
    .bind(delta)
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
