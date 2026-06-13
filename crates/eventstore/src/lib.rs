//! `eventstore` — the append-only event log over Postgres (doc 02 / doc 10).
//!
//! IO crate. Depends on `domain` for event *types*; `domain` stays pure (no
//! sqlx/tokio leaks back into it). All queries are sqlx **runtime** queries
//! (`sqlx::query` / `query_as`) — NOT the compile-time `query!` macros — so
//! `cargo build` succeeds with no database running. Compile-time query checking
//! is deferred hardening (see FRICTION).
//!
//! Invariant: this crate issues only `INSERT` and `SELECT` against `events`.
//! There is no `UPDATE` and no `DELETE` code path, and the migration installs a
//! trigger that rejects either at the database level (doc 02).

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

pub mod upcaster;

pub use upcaster::upcast;

/// Who or what caused an event (doc 10 `ActorId`).
///
/// RULING (doc 10 left the JSON shape unspecified): adjacently-tagged
/// `{ "type": <variant>, "id": <uuid-or-omitted> }`. The engine only ever emits
/// `Slot`/`System`; `User`/`Host` appear only on platform events. Slot/User ids
/// are strings in `domain` (`SlotId`), so we carry them as strings here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "id")]
pub enum ActorId {
    Slot(String),
    Host,
    System,
    User(String),
}

/// An event ready to be appended. `stream_seq` is assigned by the store
/// (`current_max + 1..`) while holding the stream's append lock, never by the
/// caller.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EventInput {
    /// `EventKind` discriminant tag, e.g. `"VoteSubmitted"`, `"ResolutionApplied"`.
    pub kind: String,
    /// Schema version of this event kind (additive evolution, doc 02).
    pub version: i16,
    /// Typed body. Shape is determined by `kind`.
    pub payload: serde_json::Value,
    pub actor: ActorId,
    /// LogicalTime (u64) captured as data at write time (determinism, doc 02).
    pub occurred_at: i64,
    #[serde(default)]
    pub causation_id: Option<Uuid>,
    #[serde(default)]
    pub meta: serde_json::Value,
}

impl EventInput {
    /// Convenience constructor with a generated id and empty meta.
    pub fn new(
        kind: impl Into<String>,
        version: i16,
        payload: serde_json::Value,
        actor: ActorId,
        occurred_at: i64,
    ) -> Self {
        EventInput {
            kind: kind.into(),
            version,
            payload,
            actor,
            occurred_at,
            causation_id: None,
            meta: serde_json::json!({}),
        }
    }
}

/// A persisted event row, loaded back from the log (ordered by `stream_seq`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StoredEvent {
    pub seq: i64,
    pub stream_id: Uuid,
    pub stream_seq: i64,
    pub kind: String,
    pub version: i16,
    pub payload: serde_json::Value,
    pub actor: ActorId,
    pub occurred_at: i64,
    pub causation_id: Option<Uuid>,
    pub meta: serde_json::Value,
}

/// Typed errors from the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Defensive conflict guard: the `(stream_id, stream_seq)` slot was already
    /// taken despite the stream append lock. This should only happen if a writer
    /// bypasses the store path.
    #[error("append conflict on stream {stream_id} at stream_seq {stream_seq} (retryable)")]
    Conflict { stream_id: Uuid, stream_seq: i64 },
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

impl StoreError {
    /// Whether the caller should reload + revalidate + retry (bounded).
    pub fn is_retryable(&self) -> bool {
        matches!(self, StoreError::Conflict { .. })
    }
}

/// The unique-violation SQLSTATE for the `(stream_id, stream_seq)` constraint.
const PG_UNIQUE_VIOLATION: &str = "23505";

fn stream_lock_key(stream_id: Uuid) -> i64 {
    let bytes = stream_id.as_u128().to_be_bytes();
    let high = i64::from_be_bytes(bytes[0..8].try_into().expect("slice length"));
    let low = i64::from_be_bytes(bytes[8..16].try_into().expect("slice length"));
    high ^ low
}

async fn lock_stream_append(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(stream_lock_key(stream_id))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Read the current max `stream_seq` for a stream within the given executor.
/// Returns 0 for an empty stream (so the first event lands at `stream_seq = 1`).
async fn current_stream_seq<'e, E>(exec: E, stream_id: Uuid) -> Result<i64, sqlx::Error>
where
    E: sqlx::PgExecutor<'e>,
{
    let row = sqlx::query(
        "SELECT COALESCE(MAX(stream_seq), 0) AS max_seq FROM events WHERE stream_id = $1",
    )
    .bind(stream_id)
    .fetch_one(exec)
    .await?;
    Ok(row.try_get::<i64, _>("max_seq")?)
}

/// Append `events` to `stream_id` at `current_max + 1..`, inside `tx`.
///
/// Returns the assigned `stream_seq` values in order. Concurrent appends to the
/// same stream are serialized with a transaction-scoped advisory lock before
/// `current_max` is read, so ordinary same-game bursts wait and land at the next
/// free stream sequence instead of surfacing a retry to the caller. The UNIQUE
/// constraint remains as a defensive backstop and still maps to
/// [`StoreError::Conflict`] if another writer bypasses this store path.
///
/// This is the shared core; [`append`] wraps it in its own transaction and
/// `projections::append_and_project` reuses it so the projection fold commits in
/// the *same* transaction as the append (doc 02 synchronous projections).
pub async fn append_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, StoreError> {
    if events.is_empty() {
        return Ok(Vec::new());
    }

    lock_stream_append(tx, stream_id).await?;
    let base = current_stream_seq(&mut **tx, stream_id).await?;
    let mut out = Vec::with_capacity(events.len());

    for (i, ev) in events.iter().enumerate() {
        let stream_seq = base + 1 + i as i64;
        let actor_json = serde_json::to_value(&ev.actor).expect("ActorId serializes");

        let res = sqlx::query(
            r#"
            INSERT INTO events
                (stream_id, stream_seq, kind, version, payload, actor, occurred_at, causation_id, meta)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING seq
            "#,
        )
        .bind(stream_id)
        .bind(stream_seq)
        .bind(&ev.kind)
        .bind(ev.version)
        .bind(&ev.payload)
        .bind(&actor_json)
        .bind(ev.occurred_at)
        .bind(ev.causation_id)
        .bind(if ev.meta.is_null() {
            serde_json::json!({})
        } else {
            ev.meta.clone()
        })
        .fetch_one(&mut **tx)
        .await;

        let seq = match res {
            Ok(row) => row.try_get::<i64, _>("seq")?,
            Err(sqlx::Error::Database(dberr))
                if dberr.code().as_deref() == Some(PG_UNIQUE_VIOLATION) =>
            {
                return Err(StoreError::Conflict {
                    stream_id,
                    stream_seq,
                });
            }
            Err(e) => return Err(StoreError::Db(e)),
        };

        out.push(StoredEvent {
            seq,
            stream_id,
            stream_seq,
            kind: ev.kind.clone(),
            version: ev.version,
            payload: ev.payload.clone(),
            actor: ev.actor.clone(),
            occurred_at: ev.occurred_at,
            causation_id: ev.causation_id,
            meta: ev.meta.clone(),
        });
    }

    Ok(out)
}

/// Append `events` to `stream_id` in their own transaction.
pub async fn append(
    pool: &PgPool,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, StoreError> {
    let mut tx = pool.begin().await?;
    let stored = append_in_tx(&mut tx, stream_id, events).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Load a full stream in canonical order (`stream_seq` ascending), each row
/// passed through the upcaster seam (identity in v1).
pub async fn load_stream(pool: &PgPool, stream_id: Uuid) -> Result<Vec<StoredEvent>, StoreError> {
    let rows = sqlx::query(
        r#"
        SELECT seq, stream_id, stream_seq, kind, version, payload, actor, occurred_at, causation_id, meta
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(stream_id)
    .fetch_all(pool)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
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
        out.push(upcast(stored));
    }
    Ok(out)
}

/// Apply the schema migrations bundled in this crate to `pool`.
///
/// Convenience for binaries/tests that don't use `#[sqlx::test]`'s automatic
/// migration. (`#[sqlx::test(migrations = "...")]` applies them itself.)
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .map_err(|e| sqlx::Error::Migrate(Box::new(e)))
}
