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
//! trigger that rejects either at the database level (doc 02). Runtime KEK
//! rotation updates only the wrapping envelope in `event_stream_keys`.

use serde::ser::SerializeMap;
use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPool;
use sqlx::Row;
use std::collections::HashMap;
#[cfg(debug_assertions)]
use std::sync::Mutex;
use std::sync::{Arc, OnceLock};
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
/// (`current_max + 1..`), never by the caller — that is the optimistic
/// concurrency mechanism.
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

/// The complete logical event body. None of these fields are persisted in the
/// clear; the storage row authenticates and seals this value as one unit.
#[derive(Debug, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
struct EventBody {
    payload: serde_json::Value,
    actor: ActorId,
    causation_id: Option<Uuid>,
    meta: serde_json::Value,
}

/// Borrowed serialization view used on the append hot path. This prevents an
/// event body from being deep-cloned and converted through a second
/// `serde_json::Value` tree before encryption.
#[derive(Serialize)]
struct EventBodyRef<'a> {
    payload: &'a serde_json::Value,
    actor: &'a ActorId,
    causation_id: Option<Uuid>,
    #[serde(serialize_with = "serialize_normalized_meta")]
    meta: &'a serde_json::Value,
}

/// Versioned ciphertext archive of one aggregate stream. The checksum is over
/// the canonical manifest content excluding the checksum field itself. Opening
/// or importing it requires the keyring containing every referenced `kid`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StreamExport {
    pub version: u16,
    pub stream_id: Uuid,
    pub active_epoch: Option<i64>,
    /// One archive-KEK-wrapped DEK for each stream epoch. Runtime KEK ids and
    /// plaintext DEKs never cross the archive boundary.
    pub stream_keys: Vec<ExportStreamKey>,
    pub events: Vec<ExportEvent>,
    pub checksum_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportStreamKey {
    pub key_epoch: i64,
    pub scheme: String,
    pub alg: String,
    pub archive_kid: String,
    pub nonce: String,
    pub wrapped_dek: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportEvent {
    pub stream_seq: i64,
    pub kind: String,
    pub version: i16,
    pub occurred_at: i64,
    /// The exact authenticated ciphertext stored in Postgres, encoded as a
    /// self-contained JSON envelope only at the archive boundary. Imports
    /// decode and preserve the underlying nonce/body bytes exactly.
    pub sealed_body: ExportSealedBody,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExportSealedBody {
    pub scheme: String,
    pub alg: String,
    pub key_epoch: i64,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SealedEventBody {
    version: i16,
    key_epoch: i64,
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

struct ValidatedExportEvent {
    sealed: SealedEventBody,
    body: EventBody,
}

#[derive(Clone)]
struct StreamDataKey {
    stream_id: Uuid,
    key_epoch: i64,
    bytes: [u8; 32],
}

struct WrappedStreamDataKey {
    stream_id: Uuid,
    key_epoch: i64,
    wrap_version: i16,
    wrap_kid: String,
    wrap_nonce: [u8; 24],
    wrapped_dek: Vec<u8>,
}

struct ValidatedStreamExport {
    active_epoch: Option<i64>,
    keys: HashMap<i64, StreamDataKey>,
    events: Vec<ValidatedExportEvent>,
}

/// Forward-only online custody state for one runtime event-wrapping KID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeKekLifecycle {
    Writable,
    Retiring,
    Retired,
}

impl RuntimeKekLifecycle {
    fn as_str(self) -> &'static str {
        match self {
            Self::Writable => "writable",
            Self::Retiring => "retiring",
            Self::Retired => "retired",
        }
    }

    fn from_storage(value: &str) -> Result<Self, StoreError> {
        match value {
            "writable" => Ok(Self::Writable),
            "retiring" => Ok(Self::Retiring),
            "retired" => Ok(Self::Retired),
            other => Err(StoreError::Crypto(format!(
                "unknown runtime KEK lifecycle `{other}`"
            ))),
        }
    }
}

/// Durable registry status for one runtime event-wrapping KID.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeKekStatus {
    pub kid: String,
    pub lifecycle: RuntimeKekLifecycle,
    pub retirement_target_kid: Option<String>,
    pub rehearsal_token: Option<Uuid>,
}

/// Combined eventstore-owned and orchestration-verified live-reference count.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeKekReferenceReport {
    pub kid: String,
    pub status: Option<RuntimeKekStatus>,
    pub stream_key_references: u64,
    pub direct_reference_count: u64,
}

/// Result of one bounded, resumable stream-DEK rewrap batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeKekStreamRewrapBatch {
    pub retiring_kid: String,
    pub target_kid: String,
    pub rewrapped: u64,
    pub batch_full: bool,
}

/// Opaque durable evidence required to finalize one runtime KEK retirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeKekRetirementEvidence {
    pub retiring_kid: String,
    pub target_kid: String,
    pub token: Uuid,
}

/// Transaction-scoped, amortized direct-envelope resealer. Construction takes
/// and retains the transaction borrow after authenticating and locking both
/// source and target registry rows; each envelope transformation is then pure.
pub struct DirectEnvelopeResealContext<'tx, 'conn> {
    _transaction: &'tx mut sqlx::Transaction<'conn, sqlx::Postgres>,
    retiring_key: EventEncryptionKey,
    target_key: EventEncryptionKey,
}

/// Typed errors from the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Optimistic-concurrency conflict: a concurrent append already took the
    /// `(stream_id, stream_seq)` slot. **Retryable** — reload and retry (doc 02/03).
    #[error("append conflict on stream {stream_id} at stream_seq {stream_seq} (retryable)")]
    Conflict { stream_id: Uuid, stream_seq: i64 },
    #[error("event-body cryptography error: {0}")]
    Crypto(String),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("invalid stream export: {0}")]
    InvalidExport(String),
}

impl StoreError {
    /// Whether the caller should reload + revalidate + retry (bounded).
    pub fn is_retryable(&self) -> bool {
        matches!(self, StoreError::Conflict { .. })
    }
}

/// The unique-violation SQLSTATE for the `(stream_id, stream_seq)` constraint.
const PG_UNIQUE_VIOLATION: &str = "23505";
/// One database-wide transaction lock serializes the deliberately singular
/// runtime KEK lifecycle. Its stable value is the ASCII tag `FMKEK_V1`.
const RUNTIME_KEK_LIFECYCLE_ADVISORY_LOCK: i64 = 0x464d_4b45_4b5f_5631;

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
    row.try_get::<i64, _>("max_seq")
}

/// Next stream sequence / logical time to stamp on an append: `MAX+1`, or 1
/// when the stream is empty. Command handlers that only need a timestamp must
/// use this instead of decrypting the sealed tape.
pub async fn next_stream_seq_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
) -> Result<i64, StoreError> {
    Ok(current_stream_seq(&mut **tx, stream_id).await? + 1)
}

/// Append `events` to `stream_id` at `current_max + 1..`, inside `tx`.
///
/// The stream is guarded by a transaction-scoped advisory lock before reading
/// `current_max`, so normal writers serialize per stream and avoid exposing
/// same-stream races to command callers. The `(stream_id, stream_seq)` unique
/// constraint remains a defensive backstop for bypass writers and still maps to
/// [`StoreError::Conflict`] (retryable) — never a panic.
///
/// This is the shared core; [`append`] wraps it in its own transaction and
/// `projections::append_and_project` reuses it so the projection fold commits in
/// the *same* transaction as the append (doc 02 synchronous projections).
pub async fn append_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, StoreError> {
    append_in_tx_checked(tx, stream_id, None, events).await
}

/// Append only when the stream is still at `expected_stream_seq`.
///
/// The expected-version check runs after acquiring the stream advisory lock,
/// making a projection read followed by this append a safe optimistic command
/// boundary. A concurrent state change wins and the stale command conflicts.
pub async fn append_expected_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    expected_stream_seq: i64,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, StoreError> {
    append_in_tx_checked(tx, stream_id, Some(expected_stream_seq), events).await
}

async fn append_in_tx_checked(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    expected_stream_seq: Option<i64>,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, StoreError> {
    if events.is_empty() {
        return Ok(Vec::new());
    }

    lock_stream_in_tx(tx, stream_id).await?;
    let base = current_stream_seq(&mut **tx, stream_id).await?;
    if expected_stream_seq.is_some_and(|expected| expected != base) {
        return Err(StoreError::Conflict {
            stream_id,
            stream_seq: base + 1,
        });
    }
    let data_key = active_stream_data_key_in_tx(tx, stream_id).await?;
    let mut out = Vec::with_capacity(events.len());

    for (i, ev) in events.iter().enumerate() {
        let stream_seq = base + 1 + i as i64;
        let sealed = seal_event_body(ev, stream_id, stream_seq, &data_key)?;

        let res = sqlx::query(
            r#"
            INSERT INTO events
                (stream_id, stream_seq, kind, version, occurred_at,
                 sealed_version, stream_key_epoch, sealed_nonce, sealed_body)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING seq
            "#,
        )
        .bind(stream_id)
        .bind(stream_seq)
        .bind(&ev.kind)
        .bind(ev.version)
        .bind(ev.occurred_at)
        .bind(sealed.version)
        .bind(sealed.key_epoch)
        .bind(sealed.nonce.as_slice())
        .bind(&sealed.ciphertext)
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

/// Serialize all decisions and writes for one stream for the lifetime of `tx`.
/// Command runtimes acquire this before reading; append reacquires the same
/// transaction-scoped lock defensively and therefore cannot drift to a
/// different lock namespace.
pub async fn lock_stream_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
) -> Result<(), StoreError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))")
        .bind(stream_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn active_stream_data_key_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
) -> Result<StreamDataKey, StoreError> {
    let row = sqlx::query(
        r#"
        SELECT k.key_epoch, k.wrap_version, k.wrap_kid, k.wrap_nonce, k.wrapped_dek
        FROM event_stream_key_state s
        JOIN event_stream_keys k
          ON k.stream_id = s.stream_id AND k.key_epoch = s.active_epoch
        WHERE s.stream_id = $1
        "#,
    )
    .bind(stream_id)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(row) = row {
        return unwrap_stream_data_key(WrappedStreamDataKey::from_storage_row(stream_id, &row)?);
    }

    let data_key = new_stream_data_key(stream_id, 1);
    insert_wrapped_stream_data_key_in_tx(tx, &data_key).await?;
    sqlx::query("INSERT INTO event_stream_key_state (stream_id, active_epoch) VALUES ($1, $2)")
        .bind(stream_id)
        .bind(data_key.key_epoch)
        .execute(&mut **tx)
        .await?;
    Ok(data_key)
}

/// Advance one stream to a fresh random DEK. Existing event rows and earlier
/// epochs remain unchanged and readable; subsequent appends use the new epoch.
pub async fn rotate_stream_data_key(pool: &PgPool, stream_id: Uuid) -> Result<i64, StoreError> {
    let mut tx = pool.begin().await?;
    lock_stream_in_tx(&mut tx, stream_id).await?;
    let active = sqlx::query_scalar::<_, i64>(
        "SELECT active_epoch FROM event_stream_key_state WHERE stream_id = $1",
    )
    .bind(stream_id)
    .fetch_optional(&mut *tx)
    .await?;
    let next_epoch = match active {
        Some(epoch) => epoch.checked_add(1).ok_or_else(|| {
            StoreError::Crypto("event stream key epoch exhausted i64 range".to_string())
        })?,
        None => 1,
    };
    let data_key = new_stream_data_key(stream_id, next_epoch);
    insert_wrapped_stream_data_key_in_tx(&mut tx, &data_key).await?;
    match active {
        Some(_) => {
            sqlx::query("UPDATE event_stream_key_state SET active_epoch = $2 WHERE stream_id = $1")
                .bind(stream_id)
                .bind(next_epoch)
                .execute(&mut *tx)
                .await?;
        }
        None => {
            sqlx::query(
                "INSERT INTO event_stream_key_state (stream_id, active_epoch) VALUES ($1, $2)",
            )
            .bind(stream_id)
            .bind(next_epoch)
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(next_epoch)
}

/// Rewrap every DEK epoch for one stream under the active runtime KEK. This is
/// intentionally the only event-crypto mutation path: it updates key envelopes
/// and never rewrites append-only event rows or changes plaintext DEKs.
pub async fn rewrap_stream_data_keys(pool: &PgPool, stream_id: Uuid) -> Result<u64, StoreError> {
    let mut tx = pool.begin().await?;
    lock_stream_in_tx(&mut tx, stream_id).await?;
    let rows = sqlx::query(
        r#"
        SELECT key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        WHERE stream_id = $1
        ORDER BY key_epoch
        FOR UPDATE
        "#,
    )
    .bind(stream_id)
    .fetch_all(&mut *tx)
    .await?;
    let active_key = event_encryption_keyring()?.active.clone();
    require_runtime_kek_writable_in_tx(&mut tx, &active_key).await?;
    let mut updated = 0_u64;
    for row in rows {
        let data_key =
            unwrap_stream_data_key(WrappedStreamDataKey::from_storage_row(stream_id, &row)?)?;
        let wrapped = wrap_stream_data_key(&data_key, &active_key)?;
        sqlx::query(
            r#"
            UPDATE event_stream_keys
            SET wrap_version = $3, wrap_kid = $4, wrap_nonce = $5, wrapped_dek = $6
            WHERE stream_id = $1 AND key_epoch = $2
            "#,
        )
        .bind(stream_id)
        .bind(data_key.key_epoch)
        .bind(wrapped.wrap_version)
        .bind(&wrapped.wrap_kid)
        .bind(wrapped.wrap_nonce.as_slice())
        .bind(&wrapped.wrapped_dek)
        .execute(&mut *tx)
        .await?;
        updated += 1;
    }
    tx.commit().await?;
    Ok(updated)
}

async fn insert_wrapped_stream_data_key_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    data_key: &StreamDataKey,
) -> Result<(), StoreError> {
    let wrapped = wrap_stream_data_key(data_key, &event_encryption_keyring()?.active)?;
    insert_stream_data_key_envelope_in_tx(tx, &wrapped).await
}

async fn insert_stream_data_key_envelope_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    wrapped: &WrappedStreamDataKey,
) -> Result<(), StoreError> {
    let keyring = event_encryption_keyring()?;
    let key = keyring.by_kid.get(&wrapped.wrap_kid).ok_or_else(|| {
        StoreError::Crypto(format!(
            "event encryption key `{}` is unavailable for stream-key persistence",
            wrapped.wrap_kid
        ))
    })?;
    ensure_runtime_kek_writable_in_tx(tx, key).await?;
    sqlx::query(
        r#"
        INSERT INTO event_stream_keys
            (stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(wrapped.stream_id)
    .bind(wrapped.key_epoch)
    .bind(wrapped.wrap_version)
    .bind(&wrapped.wrap_kid)
    .bind(wrapped.wrap_nonce.as_slice())
    .bind(&wrapped.wrapped_dek)
    .execute(&mut **tx)
    .await?;
    Ok(())
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
/// passed through the upcaster seam (`eventstore::upcast`).
pub async fn load_stream(pool: &PgPool, stream_id: Uuid) -> Result<Vec<StoredEvent>, StoreError> {
    load_stream_with(pool, stream_id).await
}

/// Transactional stream read used by command runtimes whose validation and
/// append must share one cancellation-safe transaction.
pub async fn load_stream_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
) -> Result<Vec<StoredEvent>, StoreError> {
    load_stream_with(&mut **tx, stream_id).await
}

async fn load_stream_with<'e, E>(
    executor: E,
    stream_id: Uuid,
) -> Result<Vec<StoredEvent>, StoreError>
where
    E: sqlx::PgExecutor<'e>,
{
    let rows = sqlx::query(
        r#"
        SELECT e.seq, e.stream_id, e.stream_seq, e.kind, e.version, e.occurred_at,
               e.sealed_version, e.stream_key_epoch, e.sealed_nonce, e.sealed_body,
               k.wrap_version, k.wrap_kid, k.wrap_nonce, k.wrapped_dek
        FROM events e
        JOIN event_stream_keys k
          ON k.stream_id = e.stream_id AND k.key_epoch = e.stream_key_epoch
        WHERE e.stream_id = $1
        ORDER BY e.stream_seq ASC
        "#,
    )
    .bind(stream_id)
    .fetch_all(executor)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    let mut data_keys = HashMap::<i64, StreamDataKey>::new();
    for row in rows {
        let seq = row.try_get("seq")?;
        let stream_id = row.try_get("stream_id")?;
        let stream_seq = row.try_get("stream_seq")?;
        let kind = row.try_get("kind")?;
        let version = row.try_get("version")?;
        let occurred_at = row.try_get("occurred_at")?;
        let sealed = SealedEventBody::from_storage_parts(
            row.try_get("sealed_version")?,
            row.try_get("stream_key_epoch")?,
            row.try_get("sealed_nonce")?,
            row.try_get("sealed_body")?,
        )?;
        let data_key = match data_keys.entry(sealed.key_epoch) {
            std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::hash_map::Entry::Vacant(entry) => {
                let wrapped = WrappedStreamDataKey::from_storage_row(stream_id, &row)?;
                entry.insert(unwrap_stream_data_key(wrapped)?)
            }
        };
        out.push(upcast(open_stored_event(
            seq,
            stream_id,
            stream_seq,
            kind,
            version,
            occurred_at,
            &sealed,
            data_key,
        )?));
    }
    Ok(out)
}

/// Export one stream as exact event ciphertext plus an archive-KEK-wrapped DEK
/// bundle. Runtime wrapping KEKs and plaintext DEKs never enter the manifest.
pub async fn export_stream(pool: &PgPool, stream_id: Uuid) -> Result<StreamExport, StoreError> {
    let mut tx = pool.begin().await?;
    lock_stream_in_tx(&mut tx, stream_id).await?;
    let active_epoch = sqlx::query_scalar::<_, i64>(
        "SELECT active_epoch FROM event_stream_key_state WHERE stream_id = $1",
    )
    .bind(stream_id)
    .fetch_optional(&mut *tx)
    .await?;
    let key_rows = sqlx::query(
        r#"
        SELECT key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        WHERE stream_id = $1
        ORDER BY key_epoch
        "#,
    )
    .bind(stream_id)
    .fetch_all(&mut *tx)
    .await?;
    let stream_keys = key_rows
        .iter()
        .map(|row| {
            let wrapped = WrappedStreamDataKey::from_storage_row(stream_id, row)?;
            let data_key = unwrap_stream_data_key(wrapped)?;
            archive_wrap_stream_data_key(&data_key)
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    let rows = sqlx::query(
        r#"
        SELECT stream_seq, kind, version, occurred_at,
               sealed_version, stream_key_epoch, sealed_nonce, sealed_body
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(stream_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut export = StreamExport {
        version: STREAM_EXPORT_VERSION,
        stream_id,
        active_epoch,
        stream_keys,
        events: rows
            .into_iter()
            .map(|row| {
                let sealed = SealedEventBody::from_storage_parts(
                    row.try_get("sealed_version")?,
                    row.try_get("stream_key_epoch")?,
                    row.try_get("sealed_nonce")?,
                    row.try_get("sealed_body")?,
                )?;
                Ok(ExportEvent {
                    stream_seq: row.try_get("stream_seq")?,
                    kind: row.try_get("kind")?,
                    version: row.try_get("version")?,
                    occurred_at: row.try_get("occurred_at")?,
                    sealed_body: sealed.to_export(),
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?,
        checksum_sha256: String::new(),
    };
    export.checksum_sha256 = stream_export_checksum(&export)?;
    tx.commit().await?;
    Ok(export)
}

/// Verify version, sequence continuity, and canonical checksum before import.
pub fn validate_stream_export(export: &StreamExport) -> Result<(), StoreError> {
    validate_stream_export_contents(export).map(|_| ())
}

fn validate_stream_export_contents(
    export: &StreamExport,
) -> Result<ValidatedStreamExport, StoreError> {
    if export.version != STREAM_EXPORT_VERSION {
        return Err(StoreError::InvalidExport(
            "unsupported manifest version".to_string(),
        ));
    }
    let expected = stream_export_checksum(export)?;
    if export.checksum_sha256 != expected {
        return Err(StoreError::InvalidExport("checksum mismatch".to_string()));
    }

    let mut keys = HashMap::with_capacity(export.stream_keys.len());
    for (index, wrapped) in export.stream_keys.iter().enumerate() {
        let expected_epoch = index as i64 + 1;
        if wrapped.key_epoch != expected_epoch {
            return Err(StoreError::InvalidExport(
                "stream key epochs must begin at one and be contiguous".to_string(),
            ));
        }
        let data_key = archive_unwrap_stream_data_key(export.stream_id, wrapped)?;
        keys.insert(data_key.key_epoch, data_key);
    }
    match (export.active_epoch, export.stream_keys.last()) {
        (None, None) => {}
        (Some(active), Some(last)) if active == last.key_epoch => {}
        _ => {
            return Err(StoreError::InvalidExport(
                "active epoch must identify the final stream key epoch".to_string(),
            ));
        }
    }
    for (index, event) in export.events.iter().enumerate() {
        if event.stream_seq != index as i64 + 1 {
            return Err(StoreError::InvalidExport(
                "event stream sequences must begin at one and be contiguous".to_string(),
            ));
        }
    }
    let events = export
        .events
        .iter()
        .map(|event| {
            let sealed = SealedEventBody::from_export(&event.sealed_body)?;
            let data_key = keys.get(&sealed.key_epoch).ok_or_else(|| {
                StoreError::InvalidExport(format!(
                    "event references missing stream key epoch {}",
                    sealed.key_epoch
                ))
            })?;
            let body = open_event_body(
                export.stream_id,
                event.stream_seq,
                &event.kind,
                event.version,
                event.occurred_at,
                &sealed,
                data_key,
            )?;
            Ok(ValidatedExportEvent { sealed, body })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    Ok(ValidatedStreamExport {
        active_epoch: export.active_epoch,
        keys,
        events,
    })
}

/// Append a validated export to an empty stream. The caller chooses the target
/// database and can synchronously rebuild projections immediately afterward.
pub async fn import_stream(
    pool: &PgPool,
    export: &StreamExport,
) -> Result<Vec<StoredEvent>, StoreError> {
    let mut tx = pool.begin().await?;
    let imported = import_stream_in_tx(&mut tx, export).await?;
    tx.commit().await?;
    Ok(imported)
}

/// Append a validated export to an empty stream inside the caller's
/// transaction.
///
/// This is the archive-composition seam: callers can commit the event rows
/// atomically with auxiliary authenticated archive facts and the first
/// projection rebuild without gaining access to event-encryption internals.
/// Every ciphertext is authenticated before the first insert.
pub async fn import_stream_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    export: &StreamExport,
) -> Result<Vec<StoredEvent>, StoreError> {
    // Fully authenticate the archive and construct every target KEK envelope
    // before taking a database lock or writing. From the first INSERT onward,
    // all remaining failure modes are database errors that abort the transaction.
    let validated = validate_stream_export_contents(export)?;
    let target_wrapping_key = event_encryption_keyring()?.active.clone();
    let target_wrapped_keys = export
        .stream_keys
        .iter()
        .map(|archive_key| {
            let data_key = validated
                .keys
                .get(&archive_key.key_epoch)
                .expect("validated archive key exists");
            wrap_stream_data_key(data_key, &target_wrapping_key)
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    lock_stream_in_tx(tx, export.stream_id).await?;
    let target_facts = sqlx::query(
        r#"
        SELECT
          EXISTS(SELECT 1 FROM events WHERE stream_id = $1) AS has_events,
          EXISTS(SELECT 1 FROM event_stream_keys WHERE stream_id = $1) AS has_keys,
          EXISTS(SELECT 1 FROM event_stream_key_state WHERE stream_id = $1) AS has_state
        "#,
    )
    .bind(export.stream_id)
    .fetch_one(&mut **tx)
    .await?;
    if target_facts.try_get::<bool, _>("has_events")?
        || target_facts.try_get::<bool, _>("has_keys")?
        || target_facts.try_get::<bool, _>("has_state")?
    {
        return Err(StoreError::InvalidExport(
            "target stream is not empty".to_string(),
        ));
    }
    for wrapped in &target_wrapped_keys {
        insert_stream_data_key_envelope_in_tx(tx, wrapped).await?;
    }
    if let Some(active_epoch) = validated.active_epoch {
        sqlx::query("INSERT INTO event_stream_key_state (stream_id, active_epoch) VALUES ($1, $2)")
            .bind(export.stream_id)
            .bind(active_epoch)
            .execute(&mut **tx)
            .await?;
    }
    let mut imported = Vec::with_capacity(export.events.len());
    for (event, validated_event) in export.events.iter().zip(validated.events) {
        let row = sqlx::query(
            r#"
            INSERT INTO events
                (stream_id, stream_seq, kind, version, occurred_at,
                 sealed_version, stream_key_epoch, sealed_nonce, sealed_body)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING seq
            "#,
        )
        .bind(export.stream_id)
        .bind(event.stream_seq)
        .bind(&event.kind)
        .bind(event.version)
        .bind(event.occurred_at)
        .bind(validated_event.sealed.version)
        .bind(validated_event.sealed.key_epoch)
        .bind(validated_event.sealed.nonce.as_slice())
        .bind(&validated_event.sealed.ciphertext)
        .fetch_one(&mut **tx)
        .await?;
        imported.push(upcast(StoredEvent {
            seq: row.try_get("seq")?,
            stream_id: export.stream_id,
            stream_seq: event.stream_seq,
            kind: event.kind.clone(),
            version: event.version,
            payload: validated_event.body.payload,
            actor: validated_event.body.actor,
            occurred_at: event.occurred_at,
            causation_id: validated_event.body.causation_id,
            meta: validated_event.body.meta,
        }));
    }
    Ok(imported)
}

fn stream_export_checksum(export: &StreamExport) -> Result<String, StoreError> {
    #[derive(Serialize)]
    struct ChecksumManifest<'a> {
        version: u16,
        stream_id: Uuid,
        active_epoch: Option<i64>,
        stream_keys: &'a [ExportStreamKey],
        events: &'a [ExportEvent],
    }

    let bytes = serde_json::to_vec(&ChecksumManifest {
        version: export.version,
        stream_id: export.stream_id,
        active_epoch: export.active_epoch,
        stream_keys: &export.stream_keys,
        events: &export.events,
    })
    .map_err(|error| StoreError::InvalidExport(format!("cannot serialize manifest: {error}")))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
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

/// Install and authenticate the process-active runtime KEK sentinel before
/// readiness, audits, or administrative rotation work begins.
pub async fn attest_active_runtime_kek(pool: &PgPool) -> Result<RuntimeKekStatus, StoreError> {
    let active = event_encryption_keyring()?.active.clone();
    let mut tx = pool.begin().await?;
    let status = ensure_runtime_kek_writable_in_tx(&mut tx, &active).await?;
    tx.commit().await?;
    Ok(status)
}

/// Read the durable lifecycle status for `kid`, if it has ever entered the
/// runtime KEK registry.
pub async fn runtime_kek_status(
    pool: &PgPool,
    kid: &str,
) -> Result<Option<RuntimeKekStatus>, StoreError> {
    validate_key_id(kid, "runtime KEK kid")?;
    let row = sqlx::query(
        r#"
        SELECT kid, lifecycle, retirement_target_kid, rehearsal_token
        FROM event_direct_key_sentinel
        WHERE kid = $1
        "#,
    )
    .bind(kid)
    .fetch_optional(pool)
    .await?;
    row.as_ref().map(runtime_kek_status_from_row).transpose()
}

/// Report every authoritative eventstore and direct-envelope reference.
pub async fn runtime_kek_reference_report(
    pool: &PgPool,
    kid: &str,
) -> Result<RuntimeKekReferenceReport, StoreError> {
    validate_key_id(kid, "runtime KEK kid")?;
    let stream_key_references = stream_key_reference_count(pool, kid).await?;
    let direct_reference_count = direct_reference_count(pool, kid).await?;
    Ok(RuntimeKekReferenceReport {
        kid: kid.to_string(),
        status: runtime_kek_status(pool, kid).await?,
        stream_key_references,
        direct_reference_count,
    })
}

/// Fence a source KID against new writes and bind its forward-only retirement
/// to the process-active target KID. The source key must still be configured so
/// its sentinel can be authenticated before migration begins.
pub async fn begin_runtime_kek_retirement(
    pool: &PgPool,
    retiring_kid: &str,
    target_kid: &str,
) -> Result<RuntimeKekStatus, StoreError> {
    validate_retirement_pair(retiring_kid, target_kid)?;
    let keyring = event_encryption_keyring()?;
    if keyring.active.kid != target_kid {
        return Err(StoreError::Crypto(format!(
            "runtime KEK retirement target `{target_kid}` is not the active KID `{}`",
            keyring.active.kid
        )));
    }
    let retiring_key = keyring.by_kid.get(retiring_kid).ok_or_else(|| {
        StoreError::Crypto(format!(
            "retiring runtime KEK `{retiring_kid}` must remain configured while retirement begins"
        ))
    })?;

    let mut tx = pool.begin().await?;
    lock_runtime_kek_lifecycle_in_tx(&mut tx).await?;
    reject_other_runtime_kek_retirement_in_tx(&mut tx, retiring_kid).await?;
    authenticate_representative_stream_wrap_for_kid_in_tx(&mut tx, retiring_kid, retiring_key)
        .await?;
    require_runtime_kek_writable_in_tx(&mut tx, &keyring.active).await?;
    insert_runtime_kek_registry_row_if_missing_in_tx(&mut tx, retiring_key).await?;
    let row = select_runtime_kek_for_update_in_tx(&mut tx, retiring_kid).await?;
    authenticate_direct_key_sentinel_row(&row, retiring_key)?;
    let status = runtime_kek_status_from_row(&row)?;
    let status = match status.lifecycle {
        RuntimeKekLifecycle::Writable => {
            let row = sqlx::query(
                r#"
                UPDATE event_direct_key_sentinel
                SET lifecycle = 'retiring',
                    retirement_target_kid = $2,
                    retirement_started_at = clock_timestamp()
                WHERE kid = $1
                RETURNING kid, lifecycle, retirement_target_kid, rehearsal_token
                "#,
            )
            .bind(retiring_kid)
            .bind(target_kid)
            .fetch_one(&mut *tx)
            .await?;
            runtime_kek_status_from_row(&row)?
        }
        RuntimeKekLifecycle::Retiring
            if status.retirement_target_kid.as_deref() == Some(target_kid) =>
        {
            status
        }
        RuntimeKekLifecycle::Retiring => {
            return Err(StoreError::Crypto(format!(
                "runtime KEK `{retiring_kid}` is already retiring to `{}`",
                status.retirement_target_kid.as_deref().unwrap_or("unknown")
            )));
        }
        RuntimeKekLifecycle::Retired => {
            return Err(StoreError::Crypto(format!(
                "runtime KEK `{retiring_kid}` is retired and cannot be reused"
            )));
        }
    };
    tx.commit().await?;
    Ok(status)
}

/// Rewrap a bounded batch of stream DEKs from a retiring KID to the active
/// target. Rows are locked with `SKIP LOCKED`, making parallel workers and
/// interruption/retry safe without rewriting event history.
pub async fn rewrap_stream_data_keys_by_kid_batch(
    pool: &PgPool,
    retiring_kid: &str,
    batch_size: u32,
) -> Result<RuntimeKekStreamRewrapBatch, StoreError> {
    validate_key_id(retiring_kid, "retiring runtime KEK kid")?;
    if batch_size == 0 || batch_size > 10_000 {
        return Err(StoreError::Crypto(
            "runtime KEK stream rewrap batch size must be 1..=10000".to_string(),
        ));
    }
    let keyring = event_encryption_keyring()?;
    if keyring.active.kid == retiring_kid {
        return Err(StoreError::Crypto(
            "active runtime KEK cannot be its own rewrap source".to_string(),
        ));
    }
    let retiring_key = keyring.by_kid.get(retiring_kid).ok_or_else(|| {
        StoreError::Crypto(format!(
            "retiring runtime KEK `{retiring_kid}` is unavailable for stream rewrap"
        ))
    })?;

    let mut tx = pool.begin().await?;
    let retiring_row = select_runtime_kek_for_share_in_tx(&mut tx, retiring_kid).await?;
    authenticate_direct_key_sentinel_row(&retiring_row, retiring_key)?;
    let retiring_status = runtime_kek_status_from_row(&retiring_row)?;
    require_unrehearsed_retiring_status(&retiring_status, retiring_kid, &keyring.active.kid)?;
    require_runtime_kek_writable_in_tx(&mut tx, &keyring.active).await?;

    let rows = sqlx::query(
        r#"
        SELECT stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        WHERE wrap_kid = $1
        ORDER BY stream_id, key_epoch
        LIMIT $2
        FOR UPDATE SKIP LOCKED
        "#,
    )
    .bind(retiring_kid)
    .bind(i64::from(batch_size))
    .fetch_all(&mut *tx)
    .await?;
    let batch_full = rows.len() == batch_size as usize;
    let mut rewrapped = 0_u64;
    for row in rows {
        let stream_id: Uuid = row.try_get("stream_id")?;
        let data_key =
            unwrap_stream_data_key(WrappedStreamDataKey::from_storage_row(stream_id, &row)?)?;
        let wrapped = wrap_stream_data_key(&data_key, &keyring.active)?;
        let result = sqlx::query(
            r#"
            UPDATE event_stream_keys
            SET wrap_version = $3, wrap_kid = $4, wrap_nonce = $5, wrapped_dek = $6
            WHERE stream_id = $1 AND key_epoch = $2 AND wrap_kid = $7
            "#,
        )
        .bind(stream_id)
        .bind(data_key.key_epoch)
        .bind(wrapped.wrap_version)
        .bind(&wrapped.wrap_kid)
        .bind(wrapped.wrap_nonce.as_slice())
        .bind(&wrapped.wrapped_dek)
        .bind(retiring_kid)
        .execute(&mut *tx)
        .await?;
        rewrapped = rewrapped
            .checked_add(result.rows_affected())
            .ok_or_else(|| StoreError::Crypto("stream rewrap count overflow".to_string()))?;
    }
    tx.commit().await?;
    Ok(RuntimeKekStreamRewrapBatch {
        retiring_kid: retiring_kid.to_string(),
        target_kid: keyring.active.kid.clone(),
        rewrapped,
        batch_full,
    })
}

/// Prove that a retiring KID has left the online keyring and every live custody
/// edge. The returned token is persisted before commit and is required for the
/// final destructive nulling of online sentinel material.
/// Both stream-wrap and direct-envelope censuses are queried authoritatively
/// under the source registry row's exclusive lock.
pub async fn rehearse_runtime_kek_retirement(
    pool: &PgPool,
    retiring_kid: &str,
    target_kid: &str,
) -> Result<RuntimeKekRetirementEvidence, StoreError> {
    validate_retirement_pair(retiring_kid, target_kid)?;
    let keyring = event_encryption_keyring()?;
    require_retirement_keyring_shape(&keyring, retiring_kid, target_kid)?;

    let mut tx = pool.begin().await?;
    lock_runtime_kek_lifecycle_in_tx(&mut tx).await?;
    reject_other_runtime_kek_retirement_in_tx(&mut tx, retiring_kid).await?;
    let retiring_row = select_runtime_kek_for_update_in_tx(&mut tx, retiring_kid).await?;
    let retiring_status = runtime_kek_status_from_row(&retiring_row)?;
    require_retiring_target(&retiring_status, retiring_kid, target_kid)?;
    require_runtime_kek_writable_in_tx(&mut tx, &keyring.active).await?;
    require_zero_stream_references_in_tx(&mut tx, retiring_kid).await?;
    require_zero_direct_references_in_tx(&mut tx, retiring_kid).await?;
    authenticate_remaining_runtime_kek_coverage_in_tx(&mut tx, retiring_kid).await?;

    let token = match retiring_status.rehearsal_token {
        Some(token) => token,
        None => {
            let token = Uuid::new_v4();
            sqlx::query(
                r#"
                UPDATE event_direct_key_sentinel
                SET rehearsal_token = $2, rehearsed_at = clock_timestamp()
                WHERE kid = $1 AND lifecycle = 'retiring' AND retirement_target_kid = $3
                "#,
            )
            .bind(retiring_kid)
            .bind(token)
            .bind(target_kid)
            .execute(&mut *tx)
            .await?;
            token
        }
    };
    tx.commit().await?;
    Ok(RuntimeKekRetirementEvidence {
        retiring_kid: retiring_kid.to_string(),
        target_kid: target_kid.to_string(),
        token,
    })
}

/// Finalize a rehearsed retirement. This repeats the zero-reference and online
/// keyring proofs under the source row's exclusive lock, then leaves an
/// immutable tombstone while nulling only the obsolete online sentinel bytes.
pub async fn finalize_runtime_kek_retirement(
    pool: &PgPool,
    evidence: &RuntimeKekRetirementEvidence,
) -> Result<RuntimeKekStatus, StoreError> {
    validate_retirement_pair(&evidence.retiring_kid, &evidence.target_kid)?;
    let keyring = event_encryption_keyring()?;
    require_retirement_keyring_shape(&keyring, &evidence.retiring_kid, &evidence.target_kid)?;

    let mut tx = pool.begin().await?;
    lock_runtime_kek_lifecycle_in_tx(&mut tx).await?;
    reject_other_runtime_kek_retirement_in_tx(&mut tx, &evidence.retiring_kid).await?;
    let retiring_row = select_runtime_kek_for_update_in_tx(&mut tx, &evidence.retiring_kid).await?;
    let retiring_status = runtime_kek_status_from_row(&retiring_row)?;
    require_retiring_target(
        &retiring_status,
        &evidence.retiring_kid,
        &evidence.target_kid,
    )?;
    if retiring_status.rehearsal_token != Some(evidence.token) {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{}` retirement evidence token does not match the durable rehearsal",
            evidence.retiring_kid
        )));
    }
    require_runtime_kek_writable_in_tx(&mut tx, &keyring.active).await?;
    require_zero_stream_references_in_tx(&mut tx, &evidence.retiring_kid).await?;
    require_zero_direct_references_in_tx(&mut tx, &evidence.retiring_kid).await?;
    authenticate_remaining_runtime_kek_coverage_in_tx(&mut tx, &evidence.retiring_kid).await?;

    let row = sqlx::query(
        r#"
        UPDATE event_direct_key_sentinel
        SET lifecycle = 'retired',
            retired_at = clock_timestamp(),
            sentinel_version = NULL,
            sentinel_nonce = NULL,
            sentinel_ciphertext = NULL
        WHERE kid = $1
          AND lifecycle = 'retiring'
          AND retirement_target_kid = $2
          AND rehearsal_token = $3
        RETURNING kid, lifecycle, retirement_target_kid, rehearsal_token
        "#,
    )
    .bind(&evidence.retiring_kid)
    .bind(&evidence.target_kid)
    .bind(evidence.token)
    .fetch_one(&mut *tx)
    .await?;
    let status = runtime_kek_status_from_row(&row)?;
    tx.commit().await?;
    Ok(status)
}

fn runtime_kek_status_from_row(
    row: &sqlx::postgres::PgRow,
) -> Result<RuntimeKekStatus, StoreError> {
    Ok(RuntimeKekStatus {
        kid: row.try_get("kid")?,
        lifecycle: RuntimeKekLifecycle::from_storage(row.try_get("lifecycle")?)?,
        retirement_target_kid: row.try_get("retirement_target_kid")?,
        rehearsal_token: row.try_get("rehearsal_token")?,
    })
}

fn validate_retirement_pair(retiring_kid: &str, target_kid: &str) -> Result<(), StoreError> {
    validate_key_id(retiring_kid, "retiring runtime KEK kid")?;
    validate_key_id(target_kid, "target runtime KEK kid")?;
    if retiring_kid == target_kid {
        return Err(StoreError::Crypto(
            "retiring and target runtime KEK KIDs must differ".to_string(),
        ));
    }
    Ok(())
}

fn require_retirement_keyring_shape(
    keyring: &EventEncryptionKeyring,
    retiring_kid: &str,
    target_kid: &str,
) -> Result<(), StoreError> {
    if keyring.active.kid != target_kid {
        return Err(StoreError::Crypto(format!(
            "runtime KEK retirement target `{target_kid}` is not the active KID `{}`",
            keyring.active.kid
        )));
    }
    if keyring.by_kid.contains_key(retiring_kid) {
        return Err(StoreError::Crypto(format!(
            "retiring runtime KEK `{retiring_kid}` must be absent from the configured keyring"
        )));
    }
    Ok(())
}

fn require_retiring_target(
    status: &RuntimeKekStatus,
    retiring_kid: &str,
    target_kid: &str,
) -> Result<(), StoreError> {
    if status.lifecycle != RuntimeKekLifecycle::Retiring {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{retiring_kid}` is not retiring"
        )));
    }
    if status.retirement_target_kid.as_deref() != Some(target_kid) {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{retiring_kid}` is not bound to retirement target `{target_kid}`"
        )));
    }
    Ok(())
}

fn require_unrehearsed_retiring_status(
    status: &RuntimeKekStatus,
    retiring_kid: &str,
    target_kid: &str,
) -> Result<(), StoreError> {
    require_retiring_target(status, retiring_kid, target_kid)?;
    if status.rehearsal_token.is_some() {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{retiring_kid}` has already rehearsed retirement"
        )));
    }
    Ok(())
}

async fn stream_key_reference_count(pool: &PgPool, kid: &str) -> Result<u64, StoreError> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM event_stream_keys WHERE wrap_kid = $1")
            .bind(kid)
            .fetch_one(pool)
            .await?;
    u64::try_from(count)
        .map_err(|_| StoreError::Crypto("stream key reference count is negative".to_string()))
}

async fn direct_reference_count(pool: &PgPool, kid: &str) -> Result<u64, StoreError> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM event_direct_key_reference WHERE kid = $1")
            .bind(kid)
            .fetch_one(pool)
            .await?;
    u64::try_from(count)
        .map_err(|_| StoreError::Crypto("direct reference count is negative".to_string()))
}

async fn stream_key_reference_count_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<u64, StoreError> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM event_stream_keys WHERE wrap_kid = $1")
            .bind(kid)
            .fetch_one(&mut **tx)
            .await?;
    u64::try_from(count)
        .map_err(|_| StoreError::Crypto("stream key reference count is negative".to_string()))
}

async fn direct_reference_count_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<u64, StoreError> {
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM event_direct_key_reference WHERE kid = $1")
            .bind(kid)
            .fetch_one(&mut **tx)
            .await?;
    u64::try_from(count)
        .map_err(|_| StoreError::Crypto("direct reference count is negative".to_string()))
}

async fn require_zero_stream_references_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<(), StoreError> {
    let count = stream_key_reference_count_in_tx(tx, kid).await?;
    if count != 0 {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{kid}` still has {count} stream-key references"
        )));
    }
    Ok(())
}

async fn require_zero_direct_references_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<(), StoreError> {
    let count = direct_reference_count_in_tx(tx, kid).await?;
    if count != 0 {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{kid}` still has {count} direct-envelope references"
        )));
    }
    Ok(())
}

async fn lock_runtime_kek_lifecycle_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), StoreError> {
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(RUNTIME_KEK_LIFECYCLE_ADVISORY_LOCK)
        .fetch_one(&mut **tx)
        .await?;
    Ok(())
}

async fn reject_other_runtime_kek_retirement_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    requested_kid: &str,
) -> Result<(), StoreError> {
    let other = sqlx::query_scalar::<_, String>(
        r#"
        SELECT kid
        FROM event_direct_key_sentinel
        WHERE lifecycle = 'retiring' AND kid <> $1
        ORDER BY kid
        LIMIT 1
        "#,
    )
    .bind(requested_kid)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(other) = other {
        return Err(StoreError::Crypto(format!(
            "another runtime KEK rotation is already in flight (`{other}`)"
        )));
    }
    Ok(())
}

async fn authenticate_representative_stream_wrap_for_kid_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
    key: &EventEncryptionKey,
) -> Result<(), StoreError> {
    let row = sqlx::query(
        r#"
        SELECT stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        WHERE wrap_kid = $1
        ORDER BY stream_id, key_epoch
        LIMIT 1
        "#,
    )
    .bind(kid)
    .fetch_optional(&mut **tx)
    .await?;
    if let Some(row) = row {
        let stream_id: Uuid = row.try_get("stream_id")?;
        unwrap_stream_data_key_with_key(
            WrappedStreamDataKey::from_storage_row(stream_id, &row)?,
            key,
        )?;
    }
    Ok(())
}

async fn select_runtime_kek_for_share_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<sqlx::postgres::PgRow, StoreError> {
    sqlx::query(
        r#"
        SELECT kid, sentinel_version, sentinel_nonce, sentinel_ciphertext,
               lifecycle, retirement_target_kid, rehearsal_token
        FROM event_direct_key_sentinel
        WHERE kid = $1
        FOR SHARE
        "#,
    )
    .bind(kid)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| StoreError::Crypto(format!("runtime KEK `{kid}` is not registered")))
}

async fn select_runtime_kek_for_update_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kid: &str,
) -> Result<sqlx::postgres::PgRow, StoreError> {
    sqlx::query(
        r#"
        SELECT kid, sentinel_version, sentinel_nonce, sentinel_ciphertext,
               lifecycle, retirement_target_kid, rehearsal_token
        FROM event_direct_key_sentinel
        WHERE kid = $1
        FOR UPDATE
        "#,
    )
    .bind(kid)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| StoreError::Crypto(format!("runtime KEK `{kid}` is not registered")))
}

async fn authenticate_remaining_runtime_kek_coverage_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    excluded_kid: &str,
) -> Result<(), StoreError> {
    let keyring = event_encryption_keyring()?;
    let sentinels = sqlx::query(
        r#"
        SELECT kid, sentinel_version, sentinel_nonce, sentinel_ciphertext
        FROM event_direct_key_sentinel
        WHERE lifecycle <> 'retired' AND kid <> $1
        ORDER BY kid
        FOR SHARE
        "#,
    )
    .bind(excluded_kid)
    .fetch_all(&mut **tx)
    .await?;
    for row in sentinels {
        let kid: String = row.try_get("kid")?;
        let key = keyring.by_kid.get(&kid).ok_or_else(|| {
            StoreError::Crypto(format!(
                "event encryption key `{kid}` required by an active runtime KEK sentinel is unavailable"
            ))
        })?;
        authenticate_direct_key_sentinel_row(&row, key)?;
    }

    let representative_keys = sqlx::query(
        r#"
        SELECT DISTINCT ON (wrap_kid)
               stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        ORDER BY wrap_kid, stream_id, key_epoch
        "#,
    )
    .fetch_all(&mut **tx)
    .await?;
    for row in representative_keys {
        let kid: String = row.try_get("wrap_kid")?;
        if kid == excluded_kid {
            return Err(StoreError::Crypto(format!(
                "runtime KEK `{excluded_kid}` still has a representative stream-key reference"
            )));
        }
        if !keyring.by_kid.contains_key(&kid) {
            return Err(StoreError::Crypto(format!(
                "event encryption key `{kid}` is unavailable"
            )));
        }
        let stream_id = row.try_get("stream_id")?;
        unwrap_stream_data_key(WrappedStreamDataKey::from_storage_row(stream_id, &row)?)?;
    }
    Ok(())
}

/// Exhaustive startup/operator audit of the event-encryption custody graph.
///
/// This intentionally scans the stream-key catalog. Internet-facing readiness
/// must use [`ensure_event_encryption_key_readiness`] instead so probe cost is
/// bounded by the configured keyring, not tenant or stream cardinality.
pub async fn audit_event_encryption_key_coverage(pool: &PgPool) -> Result<(), StoreError> {
    authenticate_direct_key_sentinels(pool).await?;

    let invalid_state = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT keys.stream_id
        FROM event_stream_keys keys
        LEFT JOIN event_stream_key_state state USING (stream_id)
        GROUP BY keys.stream_id, state.active_epoch
        HAVING state.active_epoch IS NULL OR state.active_epoch <> MAX(keys.key_epoch)
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await?;
    if let Some(stream_id) = invalid_state {
        return Err(StoreError::Crypto(format!(
            "event stream `{stream_id}` has missing or stale active key state"
        )));
    }

    let representative_keys = sqlx::query(
        r#"
        SELECT DISTINCT ON (wrap_kid)
               stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek
        FROM event_stream_keys
        ORDER BY wrap_kid, stream_id, key_epoch
        "#,
    )
    .fetch_all(pool)
    .await?;
    let keyring = event_encryption_keyring()?;
    for row in representative_keys {
        let kid: String = row.try_get("wrap_kid")?;
        if !keyring.by_kid.contains_key(&kid) {
            return Err(StoreError::Crypto(format!(
                "event encryption key `{kid}` is unavailable"
            )));
        }
        let stream_id = row.try_get("stream_id")?;
        unwrap_stream_data_key(WrappedStreamDataKey::from_storage_row(stream_id, &row)?)?;
    }
    Ok(())
}

/// Bounded readiness proof for the process-static runtime event keyring.
///
/// The immutable sentinel catalog has one authenticated row per KID used by a
/// direct private-projection or delivery-credential envelope. Its size is
/// bounded by rotations (K), independent of event/projection row counts.
pub async fn ensure_event_encryption_key_readiness(pool: &PgPool) -> Result<(), StoreError> {
    authenticate_direct_key_sentinels(pool).await?;
    Ok(())
}

async fn authenticate_direct_key_sentinels(pool: &PgPool) -> Result<(), StoreError> {
    let keyring = event_encryption_keyring()?;
    let active_row = sqlx::query(
        r#"
        SELECT kid, lifecycle, retirement_target_kid, rehearsal_token
        FROM event_direct_key_sentinel
        WHERE kid = $1
        "#,
    )
    .bind(&keyring.active.kid)
    .fetch_optional(pool)
    .await?;
    let active_row = active_row.ok_or_else(|| {
        StoreError::Crypto(format!(
            "active runtime KEK `{}` has not been attested",
            keyring.active.kid
        ))
    })?;
    let status = runtime_kek_status_from_row(&active_row)?;
    if status.lifecycle != RuntimeKekLifecycle::Writable {
        return Err(StoreError::Crypto(format!(
            "active runtime KEK `{}` is {} and cannot satisfy readiness",
            keyring.active.kid,
            status.lifecycle.as_str()
        )));
    }

    let retired_kids = sqlx::query_scalar::<_, String>(
        "SELECT kid FROM event_direct_key_sentinel WHERE lifecycle = 'retired' ORDER BY kid",
    )
    .fetch_all(pool)
    .await?;
    for retired_kid in retired_kids {
        if keyring.by_kid.contains_key(&retired_kid) {
            return Err(StoreError::Crypto(format!(
                "configured runtime KEK `{retired_kid}` is retired"
            )));
        }
    }

    let rows = sqlx::query(
        r#"
        SELECT kid, sentinel_version, sentinel_nonce, sentinel_ciphertext
        FROM event_direct_key_sentinel
        WHERE lifecycle = 'writable'
           OR (lifecycle = 'retiring' AND rehearsal_token IS NULL)
        ORDER BY kid
        "#,
    )
    .fetch_all(pool)
    .await?;
    for row in rows {
        let kid: String = row.try_get("kid")?;
        let key = keyring.by_kid.get(&kid).ok_or_else(|| {
            StoreError::Crypto(format!(
                "event encryption key `{kid}` required by the direct-key sentinel catalog is unavailable"
            ))
        })?;
        authenticate_direct_key_sentinel_row(&row, key)?;
    }
    Ok(())
}

const PRIVATE_SCHEME: &str = "fmarch-event-aead-v1";
const EVENT_BODY_SCHEME: &str = "fmarch-event-body-v3";
const EVENT_BODY_STORAGE_VERSION: i16 = 3;
const STREAM_KEY_WRAP_SCHEME: &str = "fmarch-event-stream-dek-wrap-v1";
const STREAM_KEY_WRAP_VERSION: i16 = 1;
const ARCHIVE_KEY_WRAP_SCHEME: &str = "fmarch-event-archive-dek-wrap-v1";
const STREAM_EXPORT_VERSION: u16 = 3;
const PRIVATE_ALG: &str = "XChaCha20Poly1305";
const DIRECT_KEY_SENTINEL_SCHEME: &str = "fmarch-event-direct-key-sentinel-v1";
const DIRECT_KEY_SENTINEL_VERSION: i16 = 1;
const DIRECT_KEY_SENTINEL_PLAINTEXT: &[u8] = b"fmarch:eventstore:direct-key-sentinel:v1";
/// Debug-only default / fallback encryption key id. Banned as the *active* write kid
/// outside explicit debug dev mode; historical `FMARCH_EVENT_WRAP_KEYS` ring
/// entries may still carry this kid for decrypt.
const LOCAL_DEV_EVENT_WRAP_KID: &str = "local-dev";
const LOCAL_DEV_EVENT_ARCHIVE_KID: &str = "local-dev-archive";

impl SealedEventBody {
    fn from_storage_parts(
        version: i16,
        key_epoch: i64,
        nonce: Vec<u8>,
        ciphertext: Vec<u8>,
    ) -> Result<Self, StoreError> {
        Self::from_parts(version, key_epoch, nonce, ciphertext).map_err(StoreError::Crypto)
    }

    fn from_export(export: &ExportSealedBody) -> Result<Self, StoreError> {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;

        if export.scheme != EVENT_BODY_SCHEME {
            return Err(StoreError::InvalidExport(format!(
                "unsupported sealed body scheme `{}`",
                export.scheme
            )));
        }
        if export.alg != PRIVATE_ALG {
            return Err(StoreError::InvalidExport(format!(
                "unsupported sealed body algorithm `{}`",
                export.alg
            )));
        }
        let nonce = STANDARD
            .decode(&export.nonce)
            .map_err(|error| StoreError::InvalidExport(format!("invalid nonce base64: {error}")))?;
        if STANDARD.encode(&nonce) != export.nonce {
            return Err(StoreError::InvalidExport(
                "nonce base64 must use canonical padded encoding".to_string(),
            ));
        }
        let ciphertext = STANDARD.decode(&export.ciphertext).map_err(|error| {
            StoreError::InvalidExport(format!("invalid ciphertext base64: {error}"))
        })?;
        if STANDARD.encode(&ciphertext) != export.ciphertext {
            return Err(StoreError::InvalidExport(
                "ciphertext base64 must use canonical padded encoding".to_string(),
            ));
        }
        Self::from_parts(
            EVENT_BODY_STORAGE_VERSION,
            export.key_epoch,
            nonce,
            ciphertext,
        )
        .map_err(StoreError::InvalidExport)
    }

    fn from_parts(
        version: i16,
        key_epoch: i64,
        nonce: Vec<u8>,
        ciphertext: Vec<u8>,
    ) -> Result<Self, String> {
        if version != EVENT_BODY_STORAGE_VERSION {
            return Err(format!("unsupported sealed event body version {version}"));
        }
        if key_epoch <= 0 {
            return Err("sealed event body key epoch must be positive".to_string());
        }
        let nonce = nonce
            .try_into()
            .map_err(|_| "sealed event body nonce must be 24 bytes".to_string())?;
        if ciphertext.len() < 16 {
            return Err("sealed event body must contain a 16-byte authentication tag".to_string());
        }
        Ok(Self {
            version,
            key_epoch,
            nonce,
            ciphertext,
        })
    }

    fn to_export(&self) -> ExportSealedBody {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;

        ExportSealedBody {
            scheme: EVENT_BODY_SCHEME.to_string(),
            alg: PRIVATE_ALG.to_string(),
            key_epoch: self.key_epoch,
            nonce: STANDARD.encode(self.nonce),
            ciphertext: STANDARD.encode(&self.ciphertext),
        }
    }
}

impl WrappedStreamDataKey {
    fn from_storage_row(stream_id: Uuid, row: &sqlx::postgres::PgRow) -> Result<Self, StoreError> {
        let key_epoch = row
            .try_get("key_epoch")
            .or_else(|_| row.try_get("stream_key_epoch"))?;
        Self::from_parts(
            stream_id,
            key_epoch,
            row.try_get("wrap_version")?,
            row.try_get("wrap_kid")?,
            row.try_get("wrap_nonce")?,
            row.try_get("wrapped_dek")?,
        )
    }

    fn from_parts(
        stream_id: Uuid,
        key_epoch: i64,
        wrap_version: i16,
        wrap_kid: String,
        wrap_nonce: Vec<u8>,
        wrapped_dek: Vec<u8>,
    ) -> Result<Self, StoreError> {
        if key_epoch <= 0 {
            return Err(StoreError::Crypto(
                "stream data key epoch must be positive".to_string(),
            ));
        }
        if wrap_version != STREAM_KEY_WRAP_VERSION {
            return Err(StoreError::Crypto(format!(
                "unsupported stream data key wrap version {wrap_version}"
            )));
        }
        validate_key_id(&wrap_kid, "stream data key wrap kid")?;
        let wrap_nonce = wrap_nonce.try_into().map_err(|_| {
            StoreError::Crypto("stream data key wrap nonce must be 24 bytes".to_string())
        })?;
        if wrapped_dek.len() != 48 {
            return Err(StoreError::Crypto(
                "wrapped stream data key must be exactly 48 bytes".to_string(),
            ));
        }
        Ok(Self {
            stream_id,
            key_epoch,
            wrap_version,
            wrap_kid,
            wrap_nonce,
            wrapped_dek,
        })
    }
}

fn validate_key_id(kid: &str, label: &str) -> Result<(), StoreError> {
    let mut bytes = kid.bytes();
    if kid.len() > 128
        || !bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || !bytes
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    {
        return Err(StoreError::Crypto(format!(
            "{label} must be 1..=128 ASCII characters matching [A-Za-z0-9][A-Za-z0-9._:-]*"
        )));
    }
    Ok(())
}

fn direct_key_sentinel_aad(kid: &str) -> Result<Vec<u8>, StoreError> {
    #[derive(Serialize)]
    struct DirectKeySentinelAad<'a> {
        context: &'static str,
        scheme: &'static str,
        alg: &'static str,
        version: i16,
        kid: &'a str,
    }

    serde_json::to_vec(&DirectKeySentinelAad {
        context: "fmarch:eventstore:direct-key-sentinel:v1",
        scheme: DIRECT_KEY_SENTINEL_SCHEME,
        alg: PRIVATE_ALG,
        version: DIRECT_KEY_SENTINEL_VERSION,
        kid,
    })
    .map_err(|error| StoreError::Crypto(format!("serialize direct-key sentinel AAD: {error}")))
}

fn authenticate_direct_key_sentinel_row(
    row: &sqlx::postgres::PgRow,
    key: &EventEncryptionKey,
) -> Result<(), StoreError> {
    let kid: String = row.try_get("kid")?;
    validate_key_id(&kid, "direct-key sentinel kid")?;
    if kid != key.kid {
        return Err(StoreError::Crypto(format!(
            "direct-key sentinel kid `{kid}` does not match key `{}`",
            key.kid
        )));
    }
    let version: i16 = row.try_get("sentinel_version")?;
    if version != DIRECT_KEY_SENTINEL_VERSION {
        return Err(StoreError::Crypto(format!(
            "unsupported direct-key sentinel version {version}"
        )));
    }
    let nonce: [u8; 24] = row
        .try_get::<Vec<u8>, _>("sentinel_nonce")?
        .try_into()
        .map_err(|_| StoreError::Crypto("direct-key sentinel nonce must be 24 bytes".into()))?;
    let ciphertext: Vec<u8> = row.try_get("sentinel_ciphertext")?;
    if ciphertext.len() != DIRECT_KEY_SENTINEL_PLAINTEXT.len() + 16 {
        return Err(StoreError::Crypto(
            "direct-key sentinel ciphertext has invalid length".into(),
        ));
    }
    let plaintext = decrypt_bytes_with_key(
        key,
        &nonce,
        &ciphertext,
        &direct_key_sentinel_aad(&kid)?,
        "authenticate direct-key sentinel",
    )?;
    if plaintext != DIRECT_KEY_SENTINEL_PLAINTEXT {
        return Err(StoreError::Crypto(
            "direct-key sentinel plaintext is invalid".into(),
        ));
    }
    Ok(())
}

async fn insert_runtime_kek_registry_row_if_missing_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: &EventEncryptionKey,
) -> Result<(), StoreError> {
    validate_key_id(&key.kid, "direct-key sentinel kid")?;
    let aad = direct_key_sentinel_aad(&key.kid)?;
    let (nonce, ciphertext) = encrypt_bytes_with_key(key, DIRECT_KEY_SENTINEL_PLAINTEXT, &aad)?;
    sqlx::query(
        r#"
        INSERT INTO event_direct_key_sentinel
            (kid, sentinel_version, sentinel_nonce, sentinel_ciphertext)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (kid) DO NOTHING
        "#,
    )
    .bind(&key.kid)
    .bind(DIRECT_KEY_SENTINEL_VERSION)
    .bind(nonce.as_slice())
    .bind(ciphertext)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Fence an active runtime KEK against a concurrent retirement transition.
/// The shared row lock lasts for the caller's transaction, and the durable
/// lifecycle check makes a retired KID impossible to recreate through the
/// insert-on-conflict path.
async fn ensure_runtime_kek_writable_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: &EventEncryptionKey,
) -> Result<RuntimeKekStatus, StoreError> {
    insert_runtime_kek_registry_row_if_missing_in_tx(tx, key).await?;
    require_runtime_kek_writable_in_tx(tx, key).await
}

async fn require_runtime_kek_writable_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    key: &EventEncryptionKey,
) -> Result<RuntimeKekStatus, StoreError> {
    let row = select_runtime_kek_for_share_in_tx(tx, &key.kid)
        .await
        .map_err(|error| match error {
            StoreError::Crypto(_) => StoreError::Crypto(format!(
                "active runtime KEK `{}` has not been attested",
                key.kid
            )),
            other => other,
        })?;
    let status = runtime_kek_status_from_row(&row)?;
    if status.lifecycle != RuntimeKekLifecycle::Writable {
        return Err(StoreError::Crypto(format!(
            "runtime KEK `{}` is {} and cannot seal new data",
            key.kid,
            status.lifecycle.as_str()
        )));
    }
    authenticate_direct_key_sentinel_row(&row, key)?;
    Ok(status)
}

fn new_stream_data_key(stream_id: Uuid, key_epoch: i64) -> StreamDataKey {
    use rand::RngCore;

    let mut bytes = [0_u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    StreamDataKey {
        stream_id,
        key_epoch,
        bytes,
    }
}

fn stream_key_wrap_aad(
    stream_id: Uuid,
    key_epoch: i64,
    wrap_kid: &str,
    scheme: &'static str,
) -> Result<Vec<u8>, StoreError> {
    #[derive(Serialize)]
    struct StreamKeyWrapAad<'a> {
        context: &'static str,
        scheme: &'static str,
        stream_id: Uuid,
        key_epoch: i64,
        wrap_kid: &'a str,
    }

    serde_json::to_vec(&StreamKeyWrapAad {
        context: "fmarch:eventstore:stream-key-wrap:v1",
        scheme,
        stream_id,
        key_epoch,
        wrap_kid,
    })
    .map_err(|error| StoreError::Crypto(format!("serialize stream key wrap AAD: {error}")))
}

fn wrap_stream_data_key(
    data_key: &StreamDataKey,
    wrapping_key: &EventEncryptionKey,
) -> Result<WrappedStreamDataKey, StoreError> {
    let aad = stream_key_wrap_aad(
        data_key.stream_id,
        data_key.key_epoch,
        &wrapping_key.kid,
        STREAM_KEY_WRAP_SCHEME,
    )?;
    let (wrap_nonce, wrapped_dek) = encrypt_bytes_with_key(wrapping_key, &data_key.bytes, &aad)?;
    Ok(WrappedStreamDataKey {
        stream_id: data_key.stream_id,
        key_epoch: data_key.key_epoch,
        wrap_version: STREAM_KEY_WRAP_VERSION,
        wrap_kid: wrapping_key.kid.clone(),
        wrap_nonce,
        wrapped_dek,
    })
}

fn unwrap_stream_data_key(wrapped: WrappedStreamDataKey) -> Result<StreamDataKey, StoreError> {
    let keyring = event_encryption_keyring()?;
    let wrapping_key = keyring.by_kid.get(&wrapped.wrap_kid).ok_or_else(|| {
        StoreError::Crypto(format!(
            "missing event wrapping key for kid `{}`",
            wrapped.wrap_kid
        ))
    })?;
    unwrap_stream_data_key_with_key(wrapped, wrapping_key)
}

fn unwrap_stream_data_key_with_key(
    wrapped: WrappedStreamDataKey,
    wrapping_key: &EventEncryptionKey,
) -> Result<StreamDataKey, StoreError> {
    if wrapping_key.kid != wrapped.wrap_kid {
        return Err(StoreError::Crypto(format!(
            "stream data key wrap KID `{}` does not match supplied key `{}`",
            wrapped.wrap_kid, wrapping_key.kid
        )));
    }
    let aad = stream_key_wrap_aad(
        wrapped.stream_id,
        wrapped.key_epoch,
        &wrapped.wrap_kid,
        STREAM_KEY_WRAP_SCHEME,
    )?;
    let plaintext = decrypt_bytes_with_key(
        wrapping_key,
        &wrapped.wrap_nonce,
        &wrapped.wrapped_dek,
        &aad,
        "unwrap stream data key",
    )?;
    let bytes = plaintext.try_into().map_err(|_| {
        StoreError::Crypto("unwrapped stream data key must be exactly 32 bytes".to_string())
    })?;
    Ok(StreamDataKey {
        stream_id: wrapped.stream_id,
        key_epoch: wrapped.key_epoch,
        bytes,
    })
}

fn archive_wrap_stream_data_key(data_key: &StreamDataKey) -> Result<ExportStreamKey, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let archive_keyring = archive_encryption_keyring()?;
    let archive_key = &archive_keyring.active;
    let aad = stream_key_wrap_aad(
        data_key.stream_id,
        data_key.key_epoch,
        &archive_key.kid,
        ARCHIVE_KEY_WRAP_SCHEME,
    )?;
    let (nonce, wrapped_dek) = encrypt_bytes_with_key(archive_key, &data_key.bytes, &aad)?;
    Ok(ExportStreamKey {
        key_epoch: data_key.key_epoch,
        scheme: ARCHIVE_KEY_WRAP_SCHEME.to_string(),
        alg: PRIVATE_ALG.to_string(),
        archive_kid: archive_key.kid.clone(),
        nonce: STANDARD.encode(nonce),
        wrapped_dek: STANDARD.encode(wrapped_dek),
    })
}

fn archive_unwrap_stream_data_key(
    stream_id: Uuid,
    wrapped: &ExportStreamKey,
) -> Result<StreamDataKey, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    if wrapped.scheme != ARCHIVE_KEY_WRAP_SCHEME || wrapped.alg != PRIVATE_ALG {
        return Err(StoreError::InvalidExport(
            "unsupported archive stream-key envelope".to_string(),
        ));
    }
    if wrapped.key_epoch <= 0 {
        return Err(StoreError::InvalidExport(
            "archive stream key epoch must be positive".to_string(),
        ));
    }
    validate_key_id(&wrapped.archive_kid, "archive wrapping kid")
        .map_err(|error| StoreError::InvalidExport(error.to_string()))?;
    let nonce_bytes = STANDARD
        .decode(&wrapped.nonce)
        .map_err(|error| StoreError::InvalidExport(format!("invalid key nonce base64: {error}")))?;
    if STANDARD.encode(&nonce_bytes) != wrapped.nonce {
        return Err(StoreError::InvalidExport(
            "key nonce base64 must use canonical padded encoding".to_string(),
        ));
    }
    let nonce: [u8; 24] = nonce_bytes
        .try_into()
        .map_err(|_| StoreError::InvalidExport("archive key nonce must be 24 bytes".to_string()))?;
    let ciphertext = STANDARD.decode(&wrapped.wrapped_dek).map_err(|error| {
        StoreError::InvalidExport(format!("invalid wrapped DEK base64: {error}"))
    })?;
    if STANDARD.encode(&ciphertext) != wrapped.wrapped_dek || ciphertext.len() != 48 {
        return Err(StoreError::InvalidExport(
            "wrapped DEK must be canonical base64 for exactly 48 bytes".to_string(),
        ));
    }
    let archive_keyring = archive_encryption_keyring()?;
    let archive_key = archive_keyring
        .by_kid
        .get(&wrapped.archive_kid)
        .ok_or_else(|| {
            StoreError::InvalidExport(format!(
                "missing archive wrapping key for kid `{}`",
                wrapped.archive_kid
            ))
        })?;
    let aad = stream_key_wrap_aad(
        stream_id,
        wrapped.key_epoch,
        &wrapped.archive_kid,
        ARCHIVE_KEY_WRAP_SCHEME,
    )?;
    let plaintext = decrypt_bytes_with_key(
        archive_key,
        &nonce,
        &ciphertext,
        &aad,
        "unwrap archive stream data key",
    )
    .map_err(|error| StoreError::InvalidExport(error.to_string()))?;
    let bytes = plaintext.try_into().map_err(|_| {
        StoreError::InvalidExport("archive DEK must open to exactly 32 bytes".to_string())
    })?;
    Ok(StreamDataKey {
        stream_id,
        key_epoch: wrapped.key_epoch,
        bytes,
    })
}

#[derive(Debug, Clone)]
struct EventEncryptionKey {
    kid: String,
    bytes: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct EventEncryptionSource {
    active_kid: Option<String>,
    active_key: Option<String>,
    historical_keys: Option<String>,
}

#[derive(Debug)]
struct EventEncryptionKeyring {
    active: EventEncryptionKey,
    by_kid: HashMap<String, EventEncryptionKey>,
}

#[cfg(debug_assertions)]
type CachedEventKeyring = Option<(EventEncryptionSource, Arc<EventEncryptionKeyring>)>;
#[cfg(debug_assertions)]
static EVENT_KEYRING_CACHE: OnceLock<Mutex<CachedEventKeyring>> = OnceLock::new();
#[cfg(not(debug_assertions))]
static RELEASE_EVENT_KEYRING: OnceLock<Result<Arc<EventEncryptionKeyring>, String>> =
    OnceLock::new();

fn seal_event_body(
    ev: &EventInput,
    stream_id: Uuid,
    stream_seq: i64,
    data_key: &StreamDataKey,
) -> Result<SealedEventBody, StoreError> {
    let plaintext = serde_json::to_vec(&EventBodyRef {
        payload: &ev.payload,
        actor: &ev.actor,
        causation_id: ev.causation_id,
        meta: &ev.meta,
    })
    .map_err(|err| StoreError::Crypto(format!("serialize event body: {err}")))?;
    let aad = event_body_aad(
        stream_id,
        stream_seq,
        &ev.kind,
        ev.version,
        ev.occurred_at,
        data_key.key_epoch,
    )?;
    let (nonce, ciphertext) = encrypt_bytes_with_material(&data_key.bytes, &plaintext, &aad)?;
    Ok(SealedEventBody {
        version: EVENT_BODY_STORAGE_VERSION,
        key_epoch: data_key.key_epoch,
        nonce,
        ciphertext,
    })
}

#[allow(clippy::too_many_arguments)]
fn open_stored_event(
    seq: i64,
    stream_id: Uuid,
    stream_seq: i64,
    kind: String,
    version: i16,
    occurred_at: i64,
    sealed_body: &SealedEventBody,
    data_key: &StreamDataKey,
) -> Result<StoredEvent, StoreError> {
    let body = open_event_body(
        stream_id,
        stream_seq,
        &kind,
        version,
        occurred_at,
        sealed_body,
        data_key,
    )?;
    Ok(StoredEvent {
        seq,
        stream_id,
        stream_seq,
        kind,
        version,
        payload: body.payload,
        actor: body.actor,
        occurred_at,
        causation_id: body.causation_id,
        meta: body.meta,
    })
}

fn open_event_body(
    stream_id: Uuid,
    stream_seq: i64,
    kind: &str,
    version: i16,
    occurred_at: i64,
    sealed_body: &SealedEventBody,
    data_key: &StreamDataKey,
) -> Result<EventBody, StoreError> {
    if sealed_body.version != EVENT_BODY_STORAGE_VERSION {
        return Err(StoreError::Crypto(format!(
            "unsupported sealed event body version {}",
            sealed_body.version
        )));
    }
    if data_key.stream_id != stream_id || data_key.key_epoch != sealed_body.key_epoch {
        return Err(StoreError::Crypto(
            "stream data key identity does not match sealed event".to_string(),
        ));
    }
    let aad = event_body_aad(
        stream_id,
        stream_seq,
        kind,
        version,
        occurred_at,
        sealed_body.key_epoch,
    )?;
    let plaintext = decrypt_bytes_with_material(
        &data_key.bytes,
        &sealed_body.nonce,
        &sealed_body.ciphertext,
        &aad,
        "decrypt sealed event body",
    )?;
    serde_json::from_slice(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("decode sealed event body: {err}")))
}

fn serialize_normalized_meta<S>(meta: &&serde_json::Value, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    if meta.is_null() {
        serializer.serialize_map(Some(0))?.end()
    } else {
        meta.serialize(serializer)
    }
}

async fn encrypt_json_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    plaintext: serde_json::Value,
    aad: &[u8],
    scheme: &str,
) -> Result<serde_json::Value, StoreError> {
    let key = event_encryption_keyring()?.active.clone();
    ensure_runtime_kek_writable_in_tx(tx, &key).await?;
    encrypt_json_with_key(plaintext, aad, scheme, &key)
}

fn encrypt_json_with_key(
    plaintext: serde_json::Value,
    aad: &[u8],
    scheme: &str,
    key: &EventEncryptionKey,
) -> Result<serde_json::Value, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let plaintext = serde_json::to_vec(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("serialize private payload: {err}")))?;
    let (nonce, ciphertext) = encrypt_bytes_with_key(key, &plaintext, aad)?;

    Ok(serde_json::json!({
        "scheme": scheme,
        "alg": PRIVATE_ALG,
        "kid": key.kid,
        "nonce": STANDARD.encode(nonce),
        "ciphertext": STANDARD.encode(ciphertext),
    }))
}

fn encrypt_bytes_with_key(
    key: &EventEncryptionKey,
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; 24], Vec<u8>), StoreError> {
    encrypt_bytes_with_material(&key.bytes, plaintext, aad)
}

fn encrypt_bytes_with_material(
    key: &[u8; 32],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; 24], Vec<u8>), StoreError> {
    use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
    use chacha20poly1305::XChaCha20Poly1305;

    let cipher = XChaCha20Poly1305::new(key.into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| StoreError::Crypto("encrypt private payload".to_string()))?;
    Ok((nonce.into(), ciphertext))
}

/// Seal private projection state while keeping key material and rotation
/// semantics inside the event-store crypto boundary.
pub async fn encrypt_private_projection(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    plaintext: serde_json::Value,
    authenticated_context: &str,
) -> Result<serde_json::Value, StoreError> {
    encrypt_json_in_tx(
        tx,
        plaintext,
        authenticated_context.as_bytes(),
        PRIVATE_SCHEME,
    )
    .await
}

impl<'tx, 'conn> DirectEnvelopeResealContext<'tx, 'conn> {
    /// Authenticate and lock one retiring source and the active target once for
    /// a caller-owned batch transaction.
    pub async fn begin(
        transaction: &'tx mut sqlx::Transaction<'conn, sqlx::Postgres>,
        retiring_kid: &str,
    ) -> Result<Self, StoreError> {
        validate_key_id(retiring_kid, "retiring runtime KEK kid")?;
        let keyring = event_encryption_keyring()?;
        if keyring.active.kid == retiring_kid {
            return Err(StoreError::Crypto(
                "active runtime KEK cannot be resealed as retiring".to_string(),
            ));
        }
        let retiring_key = keyring.by_kid.get(retiring_kid).ok_or_else(|| {
            StoreError::Crypto(format!(
                "retiring runtime KEK `{retiring_kid}` is unavailable for direct-envelope reseal"
            ))
        })?;
        let row = select_runtime_kek_for_share_in_tx(transaction, retiring_kid).await?;
        authenticate_direct_key_sentinel_row(&row, retiring_key)?;
        let status = runtime_kek_status_from_row(&row)?;
        require_unrehearsed_retiring_status(&status, retiring_kid, &keyring.active.kid)?;
        require_runtime_kek_writable_in_tx(transaction, &keyring.active).await?;
        Ok(Self {
            _transaction: transaction,
            retiring_key: retiring_key.clone(),
            target_key: keyring.active.clone(),
        })
    }

    /// Reseal one private projection without further database round trips.
    pub fn reseal_private_projection(
        &self,
        envelope: &serde_json::Value,
        authenticated_context: &str,
    ) -> Result<serde_json::Value, StoreError> {
        let plaintext = self.open(envelope, authenticated_context.as_bytes())?;
        encrypt_json_with_key(
            plaintext,
            authenticated_context.as_bytes(),
            PRIVATE_SCHEME,
            &self.target_key,
        )
    }

    /// Reseal one typed delivery credential without further database round trips.
    pub fn reseal_delivery_credential(
        &self,
        envelope: &serde_json::Value,
        aad: &str,
    ) -> Result<serde_json::Value, StoreError> {
        let plaintext = self.open(envelope, aad.as_bytes())?;
        if plaintext
            .get("credential")
            .and_then(serde_json::Value::as_str)
            .is_none()
        {
            return Err(StoreError::Crypto(
                "delivery envelope missing credential".to_string(),
            ));
        }
        encrypt_json_with_key(plaintext, aad.as_bytes(), PRIVATE_SCHEME, &self.target_key)
    }

    fn open(
        &self,
        envelope: &serde_json::Value,
        aad: &[u8],
    ) -> Result<serde_json::Value, StoreError> {
        require_direct_envelope_kid(envelope, &self.retiring_key.kid)?;
        decrypt_json_with_key_and_scheme(envelope, aad, PRIVATE_SCHEME, &self.retiring_key)
    }
}

/// Authenticate and reseal one private-projection envelope from an explicitly
/// retiring KID to the active writable KID. The caller owns the surrounding
/// row lock and transaction; this function never commits.
pub async fn reseal_private_projection_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    retiring_kid: &str,
    envelope: &serde_json::Value,
    authenticated_context: &str,
) -> Result<serde_json::Value, StoreError> {
    require_direct_envelope_kid(envelope, retiring_kid)?;
    let context = DirectEnvelopeResealContext::begin(tx, retiring_kid).await?;
    context.reseal_private_projection(envelope, authenticated_context)
}

/// Open projection state sealed by [`encrypt_private_projection`]. The caller
/// reconstructs the stable row identity used as authenticated context, so an
/// envelope cannot be relocated to another row.
pub fn decrypt_private_projection(
    envelope: &serde_json::Value,
    authenticated_context: &str,
) -> Result<serde_json::Value, StoreError> {
    decrypt_json(envelope, authenticated_context.as_bytes())
}

/// Fail an internet-facing process closed unless it has explicit key material.
/// The deterministic fallback exists only in debug builds and server operators
/// must opt into it explicitly through the dedicated flag or debug-only dev
/// authentication mode. Runtime wrapping and archive custody are deliberately
/// separate key domains; production configuration must supply both.
pub fn require_secure_event_encryption_configuration() -> Result<(), StoreError> {
    let wrap_key = std::env::var("FMARCH_EVENT_WRAP_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let wrap_kid = std::env::var("FMARCH_EVENT_WRAP_KID")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let archive_key = std::env::var("FMARCH_EVENT_ARCHIVE_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let archive_kid = std::env::var("FMARCH_EVENT_ARCHIVE_KID")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let explicit_dev = cfg!(debug_assertions)
        && (std::env::var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY")
            .ok()
            .is_some_and(|value| value.eq_ignore_ascii_case("true"))
            || std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"));

    if wrap_key.is_some() && wrap_kid.is_some() && archive_key.is_some() && archive_kid.is_some() {
        let runtime = active_event_encryption_key()?;
        let archive = archive_encryption_keyring()?.active.clone();
        if (runtime.kid == LOCAL_DEV_EVENT_WRAP_KID || archive.kid == LOCAL_DEV_EVENT_ARCHIVE_KID)
            && !explicit_dev
        {
            return Err(StoreError::Crypto(
                "local-dev event wrapping kids are banned outside explicit debug dev mode; set FMARCH_DEV_AUTH=1 or FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY=true in a debug build, or use non-dev kids".to_string(),
            ));
        }
        if runtime.bytes == archive.bytes {
            return Err(StoreError::Crypto(
                "runtime event wrapping key and archive custody key must use distinct material"
                    .to_string(),
            ));
        }
        return Ok(());
    }

    if explicit_dev {
        return Ok(());
    }

    Err(StoreError::Crypto(
        "FMARCH_EVENT_WRAP_KEY/KID and FMARCH_EVENT_ARCHIVE_KEY/KID are required; the debug-only fallback requires FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY=true or FMARCH_DEV_AUTH=1"
            .to_string(),
    ))
}

/// Encrypts a one-time identity credential for a committed delivery intent.
/// The caller supplies stable AAD so the envelope cannot be moved to another intent.
pub async fn encrypt_delivery_credential(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    credential: &str,
    aad: &str,
) -> Result<serde_json::Value, StoreError> {
    encrypt_json_in_tx(
        tx,
        serde_json::json!({ "credential": credential }),
        aad.as_bytes(),
        PRIVATE_SCHEME,
    )
    .await
}

/// Authenticate, type-check, and reseal one delivery credential from an
/// explicitly retiring KID to the active writable KID. The caller owns the
/// delivery row lock and transaction; this function never commits.
pub async fn reseal_delivery_credential_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    retiring_kid: &str,
    envelope: &serde_json::Value,
    aad: &str,
) -> Result<serde_json::Value, StoreError> {
    require_direct_envelope_kid(envelope, retiring_kid)?;
    let context = DirectEnvelopeResealContext::begin(tx, retiring_kid).await?;
    context.reseal_delivery_credential(envelope, aad)
}

/// Decrypts a delivery credential only at the provider boundary.
pub fn decrypt_delivery_credential(
    envelope: &serde_json::Value,
    aad: &str,
) -> Result<String, StoreError> {
    decrypt_json(envelope, aad.as_bytes())?
        .get("credential")
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| StoreError::Crypto("delivery envelope missing credential".to_string()))
}

fn decrypt_json(envelope: &serde_json::Value, aad: &[u8]) -> Result<serde_json::Value, StoreError> {
    decrypt_json_with_scheme(envelope, aad, PRIVATE_SCHEME)
}

fn require_direct_envelope_kid(
    envelope: &serde_json::Value,
    retiring_kid: &str,
) -> Result<(), StoreError> {
    validate_key_id(retiring_kid, "retiring runtime KEK kid")?;
    let envelope_kid = json_string(envelope, "kid")?;
    if envelope_kid != retiring_kid {
        return Err(StoreError::Crypto(format!(
            "direct envelope KID `{envelope_kid}` does not match retiring KID `{retiring_kid}`"
        )));
    }
    Ok(())
}

fn decrypt_json_with_scheme(
    envelope: &serde_json::Value,
    aad: &[u8],
    expected_scheme: &str,
) -> Result<serde_json::Value, StoreError> {
    let kid = json_string(envelope, "kid")?;
    let keyring = event_encryption_keyring()?;
    let key = keyring
        .by_kid
        .get(&kid)
        .ok_or_else(|| StoreError::Crypto(format!("missing event wrapping key for kid `{kid}`")))?;
    decrypt_json_with_key_and_scheme(envelope, aad, expected_scheme, key)
}

fn decrypt_json_with_key_and_scheme(
    envelope: &serde_json::Value,
    aad: &[u8],
    expected_scheme: &str,
    key: &EventEncryptionKey,
) -> Result<serde_json::Value, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    if envelope.get("scheme").and_then(|value| value.as_str()) != Some(expected_scheme) {
        return Err(StoreError::Crypto(
            "unknown private payload scheme".to_string(),
        ));
    }
    if envelope.get("alg").and_then(|value| value.as_str()) != Some(PRIVATE_ALG) {
        return Err(StoreError::Crypto(
            "unknown private payload algorithm".to_string(),
        ));
    }

    let nonce: [u8; 24] = STANDARD
        .decode(json_string(envelope, "nonce")?)
        .map_err(|err| StoreError::Crypto(format!("decode nonce: {err}")))?
        .try_into()
        .map_err(|_| StoreError::Crypto("private payload nonce must be 24 bytes".to_string()))?;
    let ciphertext = STANDARD
        .decode(json_string(envelope, "ciphertext")?)
        .map_err(|err| StoreError::Crypto(format!("decode ciphertext: {err}")))?;
    let kid = json_string(envelope, "kid")?;
    if kid != key.kid {
        return Err(StoreError::Crypto(format!(
            "direct envelope KID `{kid}` does not match supplied key `{}`",
            key.kid
        )));
    }
    let plaintext =
        decrypt_bytes_with_key(key, &nonce, &ciphertext, aad, "decrypt private payload")?;
    serde_json::from_slice(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("decode private payload JSON: {err}")))
}

fn decrypt_bytes_with_key(
    key: &EventEncryptionKey,
    nonce: &[u8; 24],
    ciphertext: &[u8],
    aad: &[u8],
    operation: &str,
) -> Result<Vec<u8>, StoreError> {
    decrypt_bytes_with_material(&key.bytes, nonce, ciphertext, aad, operation)
}

fn decrypt_bytes_with_material(
    key: &[u8; 32],
    nonce: &[u8; 24],
    ciphertext: &[u8],
    aad: &[u8],
    operation: &str,
) -> Result<Vec<u8>, StoreError> {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};

    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| StoreError::Crypto(operation.to_string()))
}

fn event_encryption_keyring() -> Result<Arc<EventEncryptionKeyring>, StoreError> {
    #[cfg(not(debug_assertions))]
    {
        return RELEASE_EVENT_KEYRING
            .get_or_init(|| {
                build_event_encryption_keyring(event_encryption_source())
                    .map_err(|error| error.to_string())
            })
            .as_ref()
            .map(Arc::clone)
            .map_err(|message| StoreError::Crypto(message.clone()));
    }

    #[cfg(debug_assertions)]
    {
        event_encryption_keyring_for_debug_source(event_encryption_source())
    }
}

fn event_encryption_source() -> EventEncryptionSource {
    EventEncryptionSource {
        active_kid: std::env::var("FMARCH_EVENT_WRAP_KID").ok(),
        active_key: std::env::var("FMARCH_EVENT_WRAP_KEY").ok(),
        historical_keys: std::env::var("FMARCH_EVENT_WRAP_KEYS").ok(),
    }
}

#[cfg(debug_assertions)]
fn event_encryption_keyring_for_debug_source(
    source: EventEncryptionSource,
) -> Result<Arc<EventEncryptionKeyring>, StoreError> {
    let cache = EVENT_KEYRING_CACHE.get_or_init(|| Mutex::new(None));
    let mut cached = cache
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((cached_source, keyring)) = cached.as_ref() {
        if cached_source == &source {
            return Ok(Arc::clone(keyring));
        }
    }

    let keyring = build_event_encryption_keyring(source.clone())?;
    *cached = Some((source, Arc::clone(&keyring)));
    Ok(keyring)
}

fn build_event_encryption_keyring(
    source: EventEncryptionSource,
) -> Result<Arc<EventEncryptionKeyring>, StoreError> {
    let active = active_event_encryption_key_from_source(&source)?;
    let mut keys = HashMap::new();
    insert_event_encryption_key(&mut keys, active.clone())?;

    if let Some(raw) = source.historical_keys.as_deref() {
        for entry in raw
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
        {
            let (kid, raw_key) = entry.split_once('=').ok_or_else(|| {
                StoreError::Crypto("FMARCH_EVENT_WRAP_KEYS entries must be kid=key".to_string())
            })?;
            let kid = kid.trim();
            validate_key_id(kid, "runtime wrapping kid")?;
            let key = EventEncryptionKey {
                kid: kid.to_string(),
                bytes: event_encryption_key_bytes(raw_key.trim())?,
            };
            insert_event_encryption_key(&mut keys, key)?;
        }
    }

    let keyring = Arc::new(EventEncryptionKeyring {
        active,
        by_kid: keys,
    });
    Ok(keyring)
}

fn archive_encryption_keyring() -> Result<Arc<EventEncryptionKeyring>, StoreError> {
    let source = EventEncryptionSource {
        active_kid: std::env::var("FMARCH_EVENT_ARCHIVE_KID").ok(),
        active_key: std::env::var("FMARCH_EVENT_ARCHIVE_KEY").ok(),
        historical_keys: std::env::var("FMARCH_EVENT_ARCHIVE_KEYS").ok(),
    };
    let kid = source
        .active_kid
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(LOCAL_DEV_EVENT_ARCHIVE_KID)
        .to_string();
    let bytes = match source.active_key.as_deref().map(str::trim) {
        Some(raw) if !raw.is_empty() => event_encryption_key_bytes(raw)?,
        _ if cfg!(debug_assertions) => Sha256::digest(b"fmarch-local-dev-event-archive-key-v1")
            .to_vec()
            .try_into()
            .map_err(|_| StoreError::Crypto("archive key must be 32 bytes".to_string()))?,
        _ => {
            return Err(StoreError::Crypto(
                "FMARCH_EVENT_ARCHIVE_KEY is required in release builds".to_string(),
            ));
        }
    };
    validate_key_id(&kid, "archive wrapping kid")?;
    let active = EventEncryptionKey { kid, bytes };
    let mut keys = HashMap::new();
    insert_event_encryption_key(&mut keys, active.clone())?;
    if let Some(raw) = source.historical_keys.as_deref() {
        for entry in raw
            .split(',')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
        {
            let (kid, raw_key) = entry.split_once('=').ok_or_else(|| {
                StoreError::Crypto("FMARCH_EVENT_ARCHIVE_KEYS entries must be kid=key".to_string())
            })?;
            let kid = kid.trim();
            validate_key_id(kid, "archive wrapping kid")?;
            insert_event_encryption_key(
                &mut keys,
                EventEncryptionKey {
                    kid: kid.to_string(),
                    bytes: event_encryption_key_bytes(raw_key.trim())?,
                },
            )?;
        }
    }
    let keyring = Arc::new(EventEncryptionKeyring {
        active,
        by_kid: keys,
    });
    let runtime = event_encryption_keyring()?;
    if keyring.by_kid.values().any(|archive| {
        runtime
            .by_kid
            .values()
            .any(|runtime| archive.bytes == runtime.bytes)
    }) {
        return Err(StoreError::Crypto(
            "event archive custody keys must not reuse runtime wrapping key material".to_string(),
        ));
    }
    Ok(keyring)
}

fn insert_event_encryption_key(
    keys: &mut HashMap<String, EventEncryptionKey>,
    key: EventEncryptionKey,
) -> Result<(), StoreError> {
    if let Some(existing) = keys.get(&key.kid) {
        if existing.bytes != key.bytes {
            return Err(StoreError::Crypto(format!(
                "conflicting event encryption key material for kid `{}`",
                key.kid
            )));
        }
        return Ok(());
    }
    if let Some(existing) = keys.values().find(|existing| existing.bytes == key.bytes) {
        return Err(StoreError::Crypto(format!(
            "event encryption kids `{}` and `{}` must use distinct key material",
            existing.kid, key.kid
        )));
    }
    keys.insert(key.kid.clone(), key);
    Ok(())
}

fn active_event_encryption_key() -> Result<EventEncryptionKey, StoreError> {
    Ok(event_encryption_keyring()?.active.clone())
}

fn active_event_encryption_key_from_source(
    source: &EventEncryptionSource,
) -> Result<EventEncryptionKey, StoreError> {
    use sha2::{Digest, Sha256};

    let kid = source
        .active_kid
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| LOCAL_DEV_EVENT_WRAP_KID.to_string());
    let bytes = match source.active_key.as_deref() {
        Some(raw) if !raw.trim().is_empty() => {
            let raw = raw.trim();
            event_encryption_key_bytes(raw)?
        }
        _ if cfg!(debug_assertions) => Sha256::digest(b"fmarch-local-dev-event-encryption-key-v1")
            .to_vec()
            .try_into()
            .map_err(|_| StoreError::Crypto("event encryption key must be 32 bytes".to_string()))?,
        _ => {
            return Err(StoreError::Crypto(
                "FMARCH_EVENT_WRAP_KEY is required in release builds".to_string(),
            ))
        }
    };
    validate_key_id(&kid, "runtime wrapping kid")?;
    Ok(EventEncryptionKey { kid, bytes })
}

fn event_encryption_key_bytes(raw: &str) -> Result<[u8; 32], StoreError> {
    event_encryption_key_bytes_for_mode(raw, cfg!(debug_assertions))
}

fn event_encryption_key_bytes_for_mode(
    raw: &str,
    allow_debug_passphrase: bool,
) -> Result<[u8; 32], StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    if raw.trim().is_empty() {
        return Err(StoreError::Crypto(
            "event encryption key material must not be empty".to_string(),
        ));
    }
    let decoded = STANDARD
        .decode(raw)
        .ok()
        .filter(|bytes| bytes.len() == 32)
        .filter(|bytes| STANDARD.encode(bytes) == raw);
    let bytes =
        match decoded {
            Some(bytes) => bytes,
            None if allow_debug_passphrase => Sha256::digest(raw.as_bytes()).to_vec(),
            None => return Err(StoreError::Crypto(
                "event encryption keys must be canonical padded base64 encoding exactly 32 bytes"
                    .to_string(),
            )),
        };
    bytes
        .try_into()
        .map_err(|_| StoreError::Crypto("event encryption key must be 32 bytes".to_string()))
}

fn event_body_aad(
    stream_id: Uuid,
    stream_seq: i64,
    kind: &str,
    version: i16,
    occurred_at: i64,
    stream_key_epoch: i64,
) -> Result<Vec<u8>, StoreError> {
    // Every clear archive row header participates in the authentication tag.
    // Typed JSON serialization avoids delimiter ambiguity and a transient
    // `serde_json::Value` map on every seal/open.
    #[derive(Serialize)]
    struct EventBodyAad<'a> {
        context: &'static str,
        stream_id: Uuid,
        stream_seq: i64,
        kind: &'a str,
        version: i16,
        occurred_at: i64,
        sealed_version: i16,
        stream_key_epoch: i64,
    }

    serde_json::to_vec(&EventBodyAad {
        context: "fmarch:eventstore:event-body:v3",
        stream_id,
        stream_seq,
        kind,
        version,
        occurred_at,
        sealed_version: EVENT_BODY_STORAGE_VERSION,
        stream_key_epoch,
    })
    .map_err(|error| StoreError::Crypto(format!("serialize event body AAD: {error}")))
}

fn json_string(value: &serde_json::Value, key: &str) -> Result<String, StoreError> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| StoreError::Crypto(format!("missing string field `{key}`")))
}

#[cfg(test)]
mod secure_event_encryption_config_tests {
    use super::*;
    use base64::Engine as _;
    use std::sync::{Mutex, MutexGuard};

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct EnvGuard {
        prior_key: Option<String>,
        prior_kid: Option<String>,
        prior_keys: Option<String>,
        prior_archive_key: Option<String>,
        prior_archive_kid: Option<String>,
        prior_archive_keys: Option<String>,
        prior_dev_auth: Option<String>,
        prior_allow_insecure: Option<String>,
        _lock: MutexGuard<'static, ()>,
    }

    impl EnvGuard {
        fn new() -> Self {
            let lock = ENV_LOCK
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let guard = Self {
                prior_key: std::env::var("FMARCH_EVENT_WRAP_KEY").ok(),
                prior_kid: std::env::var("FMARCH_EVENT_WRAP_KID").ok(),
                prior_keys: std::env::var("FMARCH_EVENT_WRAP_KEYS").ok(),
                prior_archive_key: std::env::var("FMARCH_EVENT_ARCHIVE_KEY").ok(),
                prior_archive_kid: std::env::var("FMARCH_EVENT_ARCHIVE_KID").ok(),
                prior_archive_keys: std::env::var("FMARCH_EVENT_ARCHIVE_KEYS").ok(),
                prior_dev_auth: std::env::var("FMARCH_DEV_AUTH").ok(),
                prior_allow_insecure: std::env::var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY").ok(),
                _lock: lock,
            };
            std::env::remove_var("FMARCH_EVENT_WRAP_KEY");
            std::env::remove_var("FMARCH_EVENT_WRAP_KID");
            std::env::remove_var("FMARCH_EVENT_WRAP_KEYS");
            std::env::remove_var("FMARCH_EVENT_ARCHIVE_KEY");
            std::env::remove_var("FMARCH_EVENT_ARCHIVE_KID");
            std::env::remove_var("FMARCH_EVENT_ARCHIVE_KEYS");
            std::env::remove_var("FMARCH_DEV_AUTH");
            std::env::remove_var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY");
            guard
        }

        fn set_active(&self, kid: &str, key: &str) {
            std::env::set_var("FMARCH_EVENT_WRAP_KID", kid);
            std::env::set_var("FMARCH_EVENT_WRAP_KEY", key);
            std::env::set_var("FMARCH_EVENT_ARCHIVE_KID", "unit-archive");
            std::env::set_var("FMARCH_EVENT_ARCHIVE_KEY", format!("archive:{key}"));
        }

        fn set_keyring(&self, keys: &str) {
            std::env::set_var("FMARCH_EVENT_WRAP_KEYS", keys);
        }

        fn set_dev_auth(&self, value: &str) {
            std::env::set_var("FMARCH_DEV_AUTH", value);
        }

        fn set_allow_insecure(&self, value: &str) {
            std::env::set_var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY", value);
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            restore_env("FMARCH_EVENT_WRAP_KEY", &self.prior_key);
            restore_env("FMARCH_EVENT_WRAP_KID", &self.prior_kid);
            restore_env("FMARCH_EVENT_WRAP_KEYS", &self.prior_keys);
            restore_env("FMARCH_EVENT_ARCHIVE_KEY", &self.prior_archive_key);
            restore_env("FMARCH_EVENT_ARCHIVE_KID", &self.prior_archive_kid);
            restore_env("FMARCH_EVENT_ARCHIVE_KEYS", &self.prior_archive_keys);
            restore_env("FMARCH_DEV_AUTH", &self.prior_dev_auth);
            restore_env(
                "FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY",
                &self.prior_allow_insecure,
            );
        }
    }

    fn restore_env(name: &str, prior: &Option<String>) {
        match prior {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }

    fn assert_crypto_err(result: Result<(), StoreError>, needle: &str) {
        match result {
            Err(StoreError::Crypto(message)) => {
                assert!(
                    message.contains(needle),
                    "expected crypto error containing `{needle}`, got `{message}`"
                );
            }
            other => panic!("expected StoreError::Crypto containing `{needle}`, got {other:?}"),
        }
    }

    /// Ban matrix (debug builds): active `local-dev` kid requires explicit_dev.
    #[test]
    fn local_dev_active_kid_banned_without_explicit_dev() {
        let env = EnvGuard::new();
        env.set_active(LOCAL_DEV_EVENT_WRAP_KID, "unit-test-event-key-material");
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "local-dev event wrapping",
        );
    }

    #[test]
    fn local_dev_active_kid_allowed_with_dev_auth() {
        let env = EnvGuard::new();
        env.set_active(LOCAL_DEV_EVENT_WRAP_KID, "unit-test-event-key-material");
        env.set_dev_auth("1");
        require_secure_event_encryption_configuration().expect("dev auth opts into local-dev");
    }

    #[test]
    fn local_dev_active_kid_allowed_with_allow_insecure_flag() {
        let env = EnvGuard::new();
        env.set_active(LOCAL_DEV_EVENT_WRAP_KID, "unit-test-event-key-material");
        env.set_allow_insecure("true");
        require_secure_event_encryption_configuration()
            .expect("allow-insecure flag opts into local-dev");
    }

    #[test]
    fn local_dev_active_kid_allowed_with_allow_insecure_case_insensitive() {
        let env = EnvGuard::new();
        env.set_active(LOCAL_DEV_EVENT_WRAP_KID, "unit-test-event-key-material");
        env.set_allow_insecure("TRUE");
        require_secure_event_encryption_configuration().expect("allow-insecure accepts TRUE");
    }

    #[test]
    fn non_local_dev_active_kid_ok_without_explicit_dev() {
        let env = EnvGuard::new();
        env.set_active("staging-v1", "unit-test-event-key-material");
        require_secure_event_encryption_configuration()
            .expect("non-dev kid does not require explicit_dev");
    }

    #[test]
    fn runtime_wrapping_kids_must_fit_the_persisted_key_schema() {
        let env = EnvGuard::new();
        env.set_active(&"x".repeat(129), "unit-test-event-key-material");
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "runtime wrapping kid must be 1..=128",
        );

        env.set_active("runtime-v1", "unit-test-event-key-material");
        env.set_keyring(&format!(
            "{}=prior-unit-test-event-key-material",
            "y".repeat(129)
        ));
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "runtime wrapping kid must be 1..=128",
        );

        for invalid in [".leading", "_leading", ":leading", "-leading"] {
            env.set_active(invalid, "unit-test-event-key-material");
            assert_crypto_err(
                require_secure_event_encryption_configuration(),
                "matching [A-Za-z0-9][A-Za-z0-9._:-]*",
            );
        }
    }

    #[test]
    fn archive_custody_cannot_reuse_runtime_wrapping_material() {
        let env = EnvGuard::new();
        env.set_active("runtime-v1", "shared-key-material");
        std::env::set_var("FMARCH_EVENT_ARCHIVE_KEY", "shared-key-material");
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "must not reuse runtime wrapping key material",
        );
    }

    #[test]
    fn missing_key_material_rejected_without_explicit_dev() {
        let _env = EnvGuard::new();
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "FMARCH_EVENT_WRAP_KEY/KID and FMARCH_EVENT_ARCHIVE_KEY/KID are required",
        );
    }

    #[test]
    fn missing_key_material_allowed_with_dev_auth() {
        let env = EnvGuard::new();
        env.set_dev_auth("1");
        require_secure_event_encryption_configuration()
            .expect("FMARCH_DEV_AUTH=1 allows debug fallback");
    }

    #[test]
    fn missing_key_material_allowed_with_allow_insecure_flag() {
        let env = EnvGuard::new();
        env.set_allow_insecure("true");
        require_secure_event_encryption_configuration()
            .expect("allow-insecure allows debug fallback");
    }

    #[test]
    fn default_active_kid_is_local_dev_constant() {
        let _env = EnvGuard::new();
        let active = active_event_encryption_key().expect("debug fallback key material");
        assert_eq!(active.kid, LOCAL_DEV_EVENT_WRAP_KID);
    }

    #[test]
    fn parsed_keyring_is_cached_until_its_environment_source_changes() {
        let env = EnvGuard::new();
        env.set_active("active-v1", "active-key-material");
        let first = event_encryption_keyring().unwrap();
        let second = event_encryption_keyring().unwrap();
        assert!(Arc::ptr_eq(&first, &second));

        env.set_keyring("historical-v0=historical-key-material");
        let rotated_source = event_encryption_keyring().unwrap();
        assert!(!Arc::ptr_eq(&first, &rotated_source));
        assert!(rotated_source.by_kid.contains_key("historical-v0"));
    }

    #[test]
    fn runtime_keyring_rejects_same_material_aliases() {
        let env = EnvGuard::new();
        let material = "same-event-key-material";
        env.set_active("canonical-kid", material);
        env.set_keyring(&format!("alias-kid={material}"));
        assert_crypto_err(
            event_encryption_keyring().map(|_| ()),
            "must use distinct key material",
        );
    }

    #[test]
    fn release_key_parser_rejects_weak_or_noncanonical_configured_material() {
        for malformed in [
            "prod",
            "c2hvcnQ=",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "___________________________________________=",
        ] {
            let error = event_encryption_key_bytes_for_mode(malformed, false)
                .expect_err("release configuration must reject noncanonical key material");
            assert!(matches!(error, StoreError::Crypto(_)));
        }
        let canonical = base64::engine::general_purpose::STANDARD.encode([61_u8; 32]);
        assert_eq!(
            event_encryption_key_bytes_for_mode(&canonical, false).unwrap(),
            [61_u8; 32]
        );
    }
}
