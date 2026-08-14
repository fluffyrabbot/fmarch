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
    pub events: Vec<ExportEvent>,
    pub checksum_sha256: String,
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
    pub kid: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SealedEventBody {
    version: i16,
    kid: String,
    nonce: [u8; 24],
    ciphertext: Vec<u8>,
}

struct ValidatedExportEvent {
    sealed: SealedEventBody,
    body: EventBody,
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
    let mut out = Vec::with_capacity(events.len());

    for (i, ev) in events.iter().enumerate() {
        let stream_seq = base + 1 + i as i64;
        let sealed = seal_event_body(ev, stream_id, stream_seq)?;

        let res = sqlx::query(
            r#"
            INSERT INTO events
                (stream_id, stream_seq, kind, version, occurred_at,
                 sealed_version, sealed_kid, sealed_nonce, sealed_body)
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
        .bind(&sealed.kid)
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
        SELECT seq, stream_id, stream_seq, kind, version, occurred_at,
               sealed_version, sealed_kid, sealed_nonce, sealed_body
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(stream_id)
    .fetch_all(executor)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let seq = row.try_get("seq")?;
        let stream_id = row.try_get("stream_id")?;
        let stream_seq = row.try_get("stream_seq")?;
        let kind = row.try_get("kind")?;
        let version = row.try_get("version")?;
        let occurred_at = row.try_get("occurred_at")?;
        let sealed = SealedEventBody::from_storage_parts(
            row.try_get("sealed_version")?,
            row.try_get("sealed_kid")?,
            row.try_get("sealed_nonce")?,
            row.try_get("sealed_body")?,
        )?;
        out.push(upcast(open_stored_event(
            seq,
            stream_id,
            stream_seq,
            kind,
            version,
            occurred_at,
            &sealed,
        )?));
    }
    Ok(out)
}

/// Export one stream as its exact stored ciphertext. No event body is opened.
pub async fn export_stream(pool: &PgPool, stream_id: Uuid) -> Result<StreamExport, StoreError> {
    let rows = sqlx::query(
        r#"
        SELECT stream_seq, kind, version, occurred_at,
               sealed_version, sealed_kid, sealed_nonce, sealed_body
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(stream_id)
    .fetch_all(pool)
    .await?;
    let mut export = StreamExport {
        version: 2,
        stream_id,
        events: rows
            .into_iter()
            .map(|row| {
                let sealed = SealedEventBody::from_storage_parts(
                    row.try_get("sealed_version")?,
                    row.try_get("sealed_kid")?,
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
    Ok(export)
}

/// Verify version, sequence continuity, and canonical checksum before import.
pub fn validate_stream_export(export: &StreamExport) -> Result<(), StoreError> {
    validate_stream_export_events(export).map(|_| ())
}

fn validate_stream_export_events(
    export: &StreamExport,
) -> Result<Vec<ValidatedExportEvent>, StoreError> {
    if export.version != 2 {
        return Err(StoreError::InvalidExport(
            "unsupported manifest version".to_string(),
        ));
    }
    for (index, event) in export.events.iter().enumerate() {
        if event.stream_seq != index as i64 + 1 {
            return Err(StoreError::InvalidExport(
                "event stream sequences must begin at one and be contiguous".to_string(),
            ));
        }
    }
    let expected = stream_export_checksum(export)?;
    if export.checksum_sha256 != expected {
        return Err(StoreError::InvalidExport("checksum mismatch".to_string()));
    }

    export
        .events
        .iter()
        .map(|event| {
            let sealed = SealedEventBody::from_export(&event.sealed_body)?;
            let body = open_event_body(
                export.stream_id,
                event.stream_seq,
                &event.kind,
                event.version,
                event.occurred_at,
                &sealed,
            )?;
            Ok(ValidatedExportEvent { sealed, body })
        })
        .collect()
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
    let validated = validate_stream_export_events(export)?;
    lock_stream_in_tx(tx, export.stream_id).await?;
    if current_stream_seq(&mut **tx, export.stream_id).await? != 0 {
        return Err(StoreError::InvalidExport(
            "target stream is not empty".to_string(),
        ));
    }
    let mut imported = Vec::with_capacity(export.events.len());
    for (event, validated) in export.events.iter().zip(validated) {
        let row = sqlx::query(
            r#"
            INSERT INTO events
                (stream_id, stream_seq, kind, version, occurred_at,
                 sealed_version, sealed_kid, sealed_nonce, sealed_body)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING seq
            "#,
        )
        .bind(export.stream_id)
        .bind(event.stream_seq)
        .bind(&event.kind)
        .bind(event.version)
        .bind(event.occurred_at)
        .bind(validated.sealed.version)
        .bind(&validated.sealed.kid)
        .bind(validated.sealed.nonce.as_slice())
        .bind(&validated.sealed.ciphertext)
        .fetch_one(&mut **tx)
        .await?;
        imported.push(upcast(StoredEvent {
            seq: row.try_get("seq")?,
            stream_id: export.stream_id,
            stream_seq: event.stream_seq,
            kind: event.kind.clone(),
            version: event.version,
            payload: validated.body.payload,
            actor: validated.body.actor,
            occurred_at: event.occurred_at,
            causation_id: validated.body.causation_id,
            meta: validated.body.meta,
        }));
    }
    Ok(imported)
}

fn stream_export_checksum(export: &StreamExport) -> Result<String, StoreError> {
    #[derive(Serialize)]
    struct ChecksumManifest<'a> {
        version: u16,
        stream_id: Uuid,
        events: &'a [ExportEvent],
    }

    let bytes = serde_json::to_vec(&ChecksumManifest {
        version: export.version,
        stream_id: export.stream_id,
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

/// Fail startup/readiness closed when an existing row references a key id that
/// the configured active+historical ring cannot open.
pub async fn ensure_event_encryption_key_coverage(pool: &PgPool) -> Result<(), StoreError> {
    let stored_kids = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT sealed_kid FROM events ORDER BY sealed_kid",
    )
    .fetch_all(pool)
    .await?;
    let keyring = event_encryption_keyring()?;
    let missing = stored_kids
        .into_iter()
        .filter(|kid| !keyring.by_kid.contains_key(kid))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(StoreError::Crypto(format!(
            "event encryption keyring is missing stored kid(s): {}",
            missing.join(", ")
        )))
    }
}

const PRIVATE_SCHEME: &str = "fmarch-event-aead-v1";
const EVENT_BODY_SCHEME: &str = "fmarch-event-body-v2";
const EVENT_BODY_STORAGE_VERSION: i16 = 2;
const PRIVATE_ALG: &str = "XChaCha20Poly1305";
/// Debug-only default / fallback encryption key id. Banned as the *active* write kid
/// outside explicit debug dev mode; historical `FMARCH_EVENT_ENCRYPTION_KEYS` ring
/// entries may still carry this kid for decrypt.
const LOCAL_DEV_EVENT_ENCRYPTION_KID: &str = "local-dev";

impl SealedEventBody {
    fn from_storage_parts(
        version: i16,
        kid: String,
        nonce: Vec<u8>,
        ciphertext: Vec<u8>,
    ) -> Result<Self, StoreError> {
        Self::from_parts(version, kid, nonce, ciphertext).map_err(StoreError::Crypto)
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
            export.kid.clone(),
            nonce,
            ciphertext,
        )
        .map_err(StoreError::InvalidExport)
    }

    fn from_parts(
        version: i16,
        kid: String,
        nonce: Vec<u8>,
        ciphertext: Vec<u8>,
    ) -> Result<Self, String> {
        if version != EVENT_BODY_STORAGE_VERSION {
            return Err(format!("unsupported sealed event body version {version}"));
        }
        if kid.is_empty() || kid.trim() != kid || kid.len() > 128 {
            return Err("sealed event body kid must be 1..=128 unpadded bytes".to_string());
        }
        let nonce = nonce
            .try_into()
            .map_err(|_| "sealed event body nonce must be 24 bytes".to_string())?;
        if ciphertext.len() < 16 {
            return Err("sealed event body must contain a 16-byte authentication tag".to_string());
        }
        Ok(Self {
            version,
            kid,
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
            kid: self.kid.clone(),
            nonce: STANDARD.encode(self.nonce),
            ciphertext: STANDARD.encode(&self.ciphertext),
        }
    }
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
) -> Result<SealedEventBody, StoreError> {
    let plaintext = serde_json::to_vec(&EventBodyRef {
        payload: &ev.payload,
        actor: &ev.actor,
        causation_id: ev.causation_id,
        meta: &ev.meta,
    })
    .map_err(|err| StoreError::Crypto(format!("serialize event body: {err}")))?;
    let keyring = event_encryption_keyring()?;
    let key = &keyring.active;
    let aad = event_body_aad(
        stream_id,
        stream_seq,
        &ev.kind,
        ev.version,
        ev.occurred_at,
        &key.kid,
    )?;
    let (nonce, ciphertext) = encrypt_bytes_with_key(key, &plaintext, &aad)?;
    Ok(SealedEventBody {
        version: EVENT_BODY_STORAGE_VERSION,
        kid: key.kid.clone(),
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
) -> Result<StoredEvent, StoreError> {
    let body = open_event_body(
        stream_id,
        stream_seq,
        &kind,
        version,
        occurred_at,
        sealed_body,
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
) -> Result<EventBody, StoreError> {
    if sealed_body.version != EVENT_BODY_STORAGE_VERSION {
        return Err(StoreError::Crypto(format!(
            "unsupported sealed event body version {}",
            sealed_body.version
        )));
    }
    let aad = event_body_aad(
        stream_id,
        stream_seq,
        kind,
        version,
        occurred_at,
        &sealed_body.kid,
    )?;
    let plaintext = decrypt_bytes(
        &sealed_body.kid,
        &sealed_body.nonce,
        &sealed_body.ciphertext,
        &aad,
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

fn encrypt_json(plaintext: serde_json::Value, aad: &[u8]) -> Result<serde_json::Value, StoreError> {
    encrypt_json_with_scheme(plaintext, aad, PRIVATE_SCHEME)
}

fn encrypt_json_with_scheme(
    plaintext: serde_json::Value,
    aad: &[u8],
    scheme: &str,
) -> Result<serde_json::Value, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let plaintext = serde_json::to_vec(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("serialize private payload: {err}")))?;
    let (kid, nonce, ciphertext) = encrypt_bytes(&plaintext, aad)?;

    Ok(serde_json::json!({
        "scheme": scheme,
        "alg": PRIVATE_ALG,
        "kid": kid,
        "nonce": STANDARD.encode(nonce),
        "ciphertext": STANDARD.encode(ciphertext),
    }))
}

fn encrypt_bytes(plaintext: &[u8], aad: &[u8]) -> Result<(String, [u8; 24], Vec<u8>), StoreError> {
    let keyring = event_encryption_keyring()?;
    let key = &keyring.active;
    let (nonce, ciphertext) = encrypt_bytes_with_key(key, plaintext, aad)?;
    Ok((key.kid.clone(), nonce, ciphertext))
}

fn encrypt_bytes_with_key(
    key: &EventEncryptionKey,
    plaintext: &[u8],
    aad: &[u8],
) -> Result<([u8; 24], Vec<u8>), StoreError> {
    use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
    use chacha20poly1305::XChaCha20Poly1305;

    let cipher = XChaCha20Poly1305::new((&key.bytes).into());
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
pub fn encrypt_private_projection(
    plaintext: serde_json::Value,
    authenticated_context: &str,
) -> Result<serde_json::Value, StoreError> {
    encrypt_json(plaintext, authenticated_context.as_bytes())
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
/// authentication mode. Active write kid [`LOCAL_DEV_EVENT_ENCRYPTION_KID`] is
/// banned outside that same explicit debug dev mode even when KEY+KID are set.
pub fn require_secure_event_encryption_configuration() -> Result<(), StoreError> {
    let key = std::env::var("FMARCH_EVENT_ENCRYPTION_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let kid = std::env::var("FMARCH_EVENT_ENCRYPTION_KID")
        .ok()
        .filter(|value| !value.trim().is_empty());
    let explicit_dev = cfg!(debug_assertions)
        && (std::env::var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY")
            .ok()
            .is_some_and(|value| value.eq_ignore_ascii_case("true"))
            || std::env::var("FMARCH_DEV_AUTH").ok().as_deref() == Some("1"));

    if key.is_some() && kid.is_some() {
        let active = active_event_encryption_key()?;
        if active.kid == LOCAL_DEV_EVENT_ENCRYPTION_KID && !explicit_dev {
            return Err(StoreError::Crypto(format!(
                "active event encryption kid `{LOCAL_DEV_EVENT_ENCRYPTION_KID}` is banned outside explicit debug dev mode; set FMARCH_DEV_AUTH=1 or FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY=true in a debug build, or use a non-dev kid"
            )));
        }
        return Ok(());
    }

    if explicit_dev {
        return Ok(());
    }

    Err(StoreError::Crypto(
        "FMARCH_EVENT_ENCRYPTION_KEY and FMARCH_EVENT_ENCRYPTION_KID are required; the debug-only fallback requires FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY=true or FMARCH_DEV_AUTH=1"
            .to_string(),
    ))
}

/// Encrypts a one-time identity credential for a committed delivery intent.
/// The caller supplies stable AAD so the envelope cannot be moved to another intent.
pub fn encrypt_delivery_credential(
    credential: &str,
    aad: &str,
) -> Result<serde_json::Value, StoreError> {
    encrypt_json(
        serde_json::json!({ "credential": credential }),
        aad.as_bytes(),
    )
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

fn decrypt_json_with_scheme(
    envelope: &serde_json::Value,
    aad: &[u8],
    expected_scheme: &str,
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
    let plaintext = decrypt_bytes(&kid, &nonce, &ciphertext, aad)?;
    serde_json::from_slice(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("decode private payload JSON: {err}")))
}

fn decrypt_bytes(
    kid: &str,
    nonce: &[u8; 24],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, StoreError> {
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};

    let keyring = event_encryption_keyring()?;
    let key = keyring.by_kid.get(kid).ok_or_else(|| {
        StoreError::Crypto(format!("missing event encryption key for kid `{kid}`"))
    })?;
    let cipher = XChaCha20Poly1305::new((&key.bytes).into());
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| StoreError::Crypto("decrypt private payload".to_string()))
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
        active_kid: std::env::var("FMARCH_EVENT_ENCRYPTION_KID").ok(),
        active_key: std::env::var("FMARCH_EVENT_ENCRYPTION_KEY").ok(),
        historical_keys: std::env::var("FMARCH_EVENT_ENCRYPTION_KEYS").ok(),
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
                StoreError::Crypto(
                    "FMARCH_EVENT_ENCRYPTION_KEYS entries must be kid=key".to_string(),
                )
            })?;
            let kid = kid.trim();
            if kid.is_empty() {
                return Err(StoreError::Crypto(
                    "FMARCH_EVENT_ENCRYPTION_KEYS kid must not be empty".to_string(),
                ));
            }
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
        .unwrap_or_else(|| LOCAL_DEV_EVENT_ENCRYPTION_KID.to_string());
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
                "FMARCH_EVENT_ENCRYPTION_KEY is required in release builds".to_string(),
            ))
        }
    };
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
    sealed_kid: &str,
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
        sealed_kid: &'a str,
    }

    serde_json::to_vec(&EventBodyAad {
        context: "fmarch:eventstore:event-body:v2",
        stream_id,
        stream_seq,
        kind,
        version,
        occurred_at,
        sealed_version: EVENT_BODY_STORAGE_VERSION,
        sealed_kid,
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
                prior_key: std::env::var("FMARCH_EVENT_ENCRYPTION_KEY").ok(),
                prior_kid: std::env::var("FMARCH_EVENT_ENCRYPTION_KID").ok(),
                prior_keys: std::env::var("FMARCH_EVENT_ENCRYPTION_KEYS").ok(),
                prior_dev_auth: std::env::var("FMARCH_DEV_AUTH").ok(),
                prior_allow_insecure: std::env::var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY").ok(),
                _lock: lock,
            };
            std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEY");
            std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KID");
            std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS");
            std::env::remove_var("FMARCH_DEV_AUTH");
            std::env::remove_var("FMARCH_ALLOW_INSECURE_DEV_EVENT_KEY");
            guard
        }

        fn set_active(&self, kid: &str, key: &str) {
            std::env::set_var("FMARCH_EVENT_ENCRYPTION_KID", kid);
            std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEY", key);
        }

        fn set_keyring(&self, keys: &str) {
            std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEYS", keys);
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
            restore_env("FMARCH_EVENT_ENCRYPTION_KEY", &self.prior_key);
            restore_env("FMARCH_EVENT_ENCRYPTION_KID", &self.prior_kid);
            restore_env("FMARCH_EVENT_ENCRYPTION_KEYS", &self.prior_keys);
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
        env.set_active(
            LOCAL_DEV_EVENT_ENCRYPTION_KID,
            "unit-test-event-key-material",
        );
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            LOCAL_DEV_EVENT_ENCRYPTION_KID,
        );
    }

    #[test]
    fn local_dev_active_kid_allowed_with_dev_auth() {
        let env = EnvGuard::new();
        env.set_active(
            LOCAL_DEV_EVENT_ENCRYPTION_KID,
            "unit-test-event-key-material",
        );
        env.set_dev_auth("1");
        require_secure_event_encryption_configuration().expect("dev auth opts into local-dev");
    }

    #[test]
    fn local_dev_active_kid_allowed_with_allow_insecure_flag() {
        let env = EnvGuard::new();
        env.set_active(
            LOCAL_DEV_EVENT_ENCRYPTION_KID,
            "unit-test-event-key-material",
        );
        env.set_allow_insecure("true");
        require_secure_event_encryption_configuration()
            .expect("allow-insecure flag opts into local-dev");
    }

    #[test]
    fn local_dev_active_kid_allowed_with_allow_insecure_case_insensitive() {
        let env = EnvGuard::new();
        env.set_active(
            LOCAL_DEV_EVENT_ENCRYPTION_KID,
            "unit-test-event-key-material",
        );
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
    fn missing_key_material_rejected_without_explicit_dev() {
        let _env = EnvGuard::new();
        assert_crypto_err(
            require_secure_event_encryption_configuration(),
            "FMARCH_EVENT_ENCRYPTION_KEY and FMARCH_EVENT_ENCRYPTION_KID are required",
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
        assert_eq!(active.kid, LOCAL_DEV_EVENT_ENCRYPTION_KID);
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
    fn sealed_event_key_id_is_authenticated_even_for_same_material_aliases() {
        let env = EnvGuard::new();
        let material = "same-event-key-material";
        env.set_active("canonical-kid", material);
        let stream_id = Uuid::new_v4();
        let event = EventInput::new(
            "AliasCounterexample",
            1,
            serde_json::json!({"secret": "bound-to-canonical-kid"}),
            ActorId::System,
            7,
        );
        let mut sealed = seal_event_body(&event, stream_id, 1).expect("seal canonical event");

        env.set_keyring(&format!("alias-kid={material}"));
        sealed.kid = "alias-kid".to_string();
        let error = open_event_body(
            stream_id,
            1,
            &event.kind,
            event.version,
            event.occurred_at,
            &sealed,
        )
        .expect_err("rewriting kid must invalidate authenticated context");
        assert!(error.to_string().contains("decrypt private payload"));
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
