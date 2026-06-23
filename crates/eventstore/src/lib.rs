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

/// Typed errors from the store.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    /// Optimistic-concurrency conflict: a concurrent append already took the
    /// `(stream_id, stream_seq)` slot. **Retryable** — reload and retry (doc 02/03).
    #[error("append conflict on stream {stream_id} at stream_seq {stream_seq} (retryable)")]
    Conflict { stream_id: Uuid, stream_seq: i64 },
    #[error("event payload encryption error: {0}")]
    Crypto(String),
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
/// Returns the assigned `stream_seq` values in order. A concurrent append racing
/// for the same slot trips the UNIQUE constraint and surfaces as
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
    if events.is_empty() {
        return Ok(Vec::new());
    }

    let base = current_stream_seq(&mut **tx, stream_id).await?;
    let mut out = Vec::with_capacity(events.len());

    for (i, ev) in events.iter().enumerate() {
        let stream_seq = base + 1 + i as i64;
        let actor_json = serde_json::to_value(&ev.actor).expect("ActorId serializes");
        let storage_payload = encode_payload_for_storage(ev, stream_id, stream_seq)?;

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
        .bind(&storage_payload)
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
        out.push(upcast(decode_stored_payload(stored)?));
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

const PRIVATE_SCHEME: &str = "fmarch-event-aead-v1";
const PRIVATE_ALG: &str = "XChaCha20Poly1305";
const ROLE_PRIVATE_FIELD: &str = "private";
const POST_BODY_PRIVATE_FIELD: &str = "body_private";

#[derive(Debug, Clone)]
struct EventEncryptionKey {
    kid: String,
    bytes: [u8; 32],
}

fn encode_payload_for_storage(
    ev: &EventInput,
    stream_id: Uuid,
    stream_seq: i64,
) -> Result<serde_json::Value, StoreError> {
    match ev.kind.as_str() {
        "RoleAssigned" => encode_role_assigned_payload(ev, stream_id, stream_seq),
        "PostSubmitted" if private_post_payload(&ev.payload) => {
            encode_private_post_payload(ev, stream_id, stream_seq)
        }
        _ => Ok(ev.payload.clone()),
    }
}

fn encode_role_assigned_payload(
    ev: &EventInput,
    stream_id: Uuid,
    stream_seq: i64,
) -> Result<serde_json::Value, StoreError> {
    if ev.payload.get(ROLE_PRIVATE_FIELD).is_some() {
        return Ok(ev.payload.clone());
    }
    let slot_id = json_string(&ev.payload, "slot_id")?;
    let private = serde_json::json!({
        "role_key": ev
            .payload
            .get("role_key")
            .cloned()
            .ok_or_else(|| StoreError::Crypto("RoleAssigned missing role_key".to_string()))?,
        "alignment": ev.payload.get("alignment").cloned().unwrap_or(serde_json::Value::Null),
        "role_effects": ev
            .payload
            .get("role_effects")
            .cloned()
            .unwrap_or_else(|| serde_json::json!([])),
    });
    let aad = aad(
        stream_id,
        stream_seq,
        &ev.kind,
        ev.version,
        "role-assignment",
    );
    Ok(serde_json::json!({
        "slot_id": slot_id,
        ROLE_PRIVATE_FIELD: encrypt_json(private, aad.as_bytes())?,
    }))
}

fn encode_private_post_payload(
    ev: &EventInput,
    stream_id: Uuid,
    stream_seq: i64,
) -> Result<serde_json::Value, StoreError> {
    if ev.payload.get(POST_BODY_PRIVATE_FIELD).is_some() {
        return Ok(ev.payload.clone());
    }
    let mut public =
        ev.payload.as_object().cloned().ok_or_else(|| {
            StoreError::Crypto("PostSubmitted payload must be an object".to_string())
        })?;
    let body = public
        .remove("body")
        .ok_or_else(|| StoreError::Crypto("PostSubmitted missing body".to_string()))?;
    if !body.is_string() {
        return Err(StoreError::Crypto(
            "PostSubmitted body must be a string".to_string(),
        ));
    }
    let aad = aad(
        stream_id,
        stream_seq,
        &ev.kind,
        ev.version,
        "private-post-body",
    );
    public.insert(
        POST_BODY_PRIVATE_FIELD.to_string(),
        encrypt_json(serde_json::json!({ "body": body }), aad.as_bytes())?,
    );
    Ok(serde_json::Value::Object(public))
}

fn private_post_payload(payload: &serde_json::Value) -> bool {
    payload
        .get("channel_id")
        .and_then(|value| value.as_str())
        .is_some_and(|channel| channel != "main")
}

/// Decode storage-private payload envelopes back to the current in-memory event
/// shape. Projection rebuild and stream loading both pass through this seam.
pub fn decode_stored_payload(mut ev: StoredEvent) -> Result<StoredEvent, StoreError> {
    match ev.kind.as_str() {
        "RoleAssigned" if ev.payload.get(ROLE_PRIVATE_FIELD).is_some() => {
            ev.payload = decode_role_assigned_payload(&ev)?;
        }
        "PostSubmitted" if ev.payload.get(POST_BODY_PRIVATE_FIELD).is_some() => {
            ev.payload = decode_private_post_payload(&ev)?;
        }
        _ => {}
    }
    Ok(ev)
}

fn decode_role_assigned_payload(ev: &StoredEvent) -> Result<serde_json::Value, StoreError> {
    let slot_id = json_string(&ev.payload, "slot_id")?;
    let aad = aad(
        ev.stream_id,
        ev.stream_seq,
        &ev.kind,
        ev.version,
        "role-assignment",
    );
    let private = decrypt_json(
        ev.payload.get(ROLE_PRIVATE_FIELD).ok_or_else(|| {
            StoreError::Crypto("RoleAssigned missing private envelope".to_string())
        })?,
        aad.as_bytes(),
    )?;
    Ok(serde_json::json!({
        "slot_id": slot_id,
        "role_key": private.get("role_key").cloned().unwrap_or(serde_json::Value::Null),
        "alignment": private.get("alignment").cloned().unwrap_or(serde_json::Value::Null),
        "role_effects": private.get("role_effects").cloned().unwrap_or_else(|| serde_json::json!([])),
    }))
}

fn decode_private_post_payload(ev: &StoredEvent) -> Result<serde_json::Value, StoreError> {
    let mut payload =
        ev.payload.as_object().cloned().ok_or_else(|| {
            StoreError::Crypto("PostSubmitted payload must be an object".to_string())
        })?;
    let envelope = payload
        .remove(POST_BODY_PRIVATE_FIELD)
        .ok_or_else(|| StoreError::Crypto("PostSubmitted missing body_private".to_string()))?;
    let aad = aad(
        ev.stream_id,
        ev.stream_seq,
        &ev.kind,
        ev.version,
        "private-post-body",
    );
    let private = decrypt_json(&envelope, aad.as_bytes())?;
    let body = private
        .get("body")
        .cloned()
        .ok_or_else(|| StoreError::Crypto("private PostSubmitted missing body".to_string()))?;
    payload.insert("body".to_string(), body);
    Ok(serde_json::Value::Object(payload))
}

fn encrypt_json(plaintext: serde_json::Value, aad: &[u8]) -> Result<serde_json::Value, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use chacha20poly1305::aead::{Aead, AeadCore, KeyInit, OsRng, Payload};
    use chacha20poly1305::XChaCha20Poly1305;

    let key = event_encryption_key()?;
    let cipher = XChaCha20Poly1305::new((&key.bytes).into());
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let plaintext = serde_json::to_vec(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("serialize private payload: {err}")))?;
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(|_| StoreError::Crypto("encrypt private payload".to_string()))?;

    Ok(serde_json::json!({
        "scheme": PRIVATE_SCHEME,
        "alg": PRIVATE_ALG,
        "kid": key.kid,
        "nonce": STANDARD.encode(nonce),
        "ciphertext": STANDARD.encode(ciphertext),
    }))
}

fn decrypt_json(envelope: &serde_json::Value, aad: &[u8]) -> Result<serde_json::Value, StoreError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use chacha20poly1305::aead::{Aead, KeyInit, Payload};
    use chacha20poly1305::{XChaCha20Poly1305, XNonce};

    if envelope.get("scheme").and_then(|value| value.as_str()) != Some(PRIVATE_SCHEME) {
        return Err(StoreError::Crypto(
            "unknown private payload scheme".to_string(),
        ));
    }
    if envelope.get("alg").and_then(|value| value.as_str()) != Some(PRIVATE_ALG) {
        return Err(StoreError::Crypto(
            "unknown private payload algorithm".to_string(),
        ));
    }

    let nonce = STANDARD
        .decode(json_string(envelope, "nonce")?)
        .map_err(|err| StoreError::Crypto(format!("decode nonce: {err}")))?;
    if nonce.len() != 24 {
        return Err(StoreError::Crypto(
            "private payload nonce must be 24 bytes".to_string(),
        ));
    }
    let ciphertext = STANDARD
        .decode(json_string(envelope, "ciphertext")?)
        .map_err(|err| StoreError::Crypto(format!("decode ciphertext: {err}")))?;
    let key = event_encryption_key()?;
    let cipher = XChaCha20Poly1305::new((&key.bytes).into());
    let plaintext = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ciphertext,
                aad,
            },
        )
        .map_err(|_| StoreError::Crypto("decrypt private payload".to_string()))?;
    serde_json::from_slice(&plaintext)
        .map_err(|err| StoreError::Crypto(format!("decode private payload JSON: {err}")))
}

fn event_encryption_key() -> Result<EventEncryptionKey, StoreError> {
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
    use base64::Engine;
    use sha2::{Digest, Sha256};

    let kid = std::env::var("FMARCH_EVENT_ENCRYPTION_KID")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "local-dev".to_string());
    let bytes = match std::env::var("FMARCH_EVENT_ENCRYPTION_KEY") {
        Ok(raw) if !raw.trim().is_empty() => {
            let raw = raw.trim();
            let decoded = STANDARD
                .decode(raw)
                .or_else(|_| URL_SAFE_NO_PAD.decode(raw))
                .ok()
                .filter(|bytes| bytes.len() == 32);
            match decoded {
                Some(bytes) => bytes,
                None => Sha256::digest(raw.as_bytes()).to_vec(),
            }
        }
        _ => Sha256::digest(b"fmarch-local-dev-event-encryption-key-v1").to_vec(),
    };
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| StoreError::Crypto("event encryption key must be 32 bytes".to_string()))?;
    Ok(EventEncryptionKey { kid, bytes })
}

fn aad(stream_id: Uuid, stream_seq: i64, kind: &str, version: i16, field: &str) -> String {
    format!("fmarch:eventstore:v1:{stream_id}:{stream_seq}:{kind}:{version}:{field}")
}

fn json_string(value: &serde_json::Value, key: &str) -> Result<String, StoreError> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .ok_or_else(|| StoreError::Crypto(format!("missing string field `{key}`")))
}
