//! Codec-admitted context journals over the single encrypted storage path.
//! The caller owns its transaction; each append is additionally a savepoint,
//! including the integration facts derived from the committed source events.
use crate::{EventInput, StoreError, StoredEvent};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::error::Error;
use uuid::Uuid;

pub const CONTEXT_META_KEY: &str = "journal_context";
const OUTBOX_STORAGE_VERSION: i16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StreamId(Uuid);

impl StreamId {
    pub fn new(value: Uuid) -> Self {
        Self(value)
    }

    pub fn as_uuid(self) -> Uuid {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamVersion(i64);

impl StreamVersion {
    pub fn new(value: i64) -> Result<Self, JournalError> {
        if value < 0 {
            return Err(JournalError::InvalidEnvelope(
                "negative stream version".into(),
            ));
        }
        Ok(Self(value))
    }

    pub fn get(self) -> i64 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExpectedVersion(StreamVersion);

impl ExpectedVersion {
    pub fn new(value: i64) -> Result<Self, JournalError> {
        StreamVersion::new(value).map(Self)
    }

    pub fn get(self) -> i64 {
        self.0.get()
    }
}

impl From<StreamVersion> for ExpectedVersion {
    fn from(value: StreamVersion) -> Self {
        Self(value)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct EventEncoding {
    pub kind: String,
    pub version: i16,
    pub payload: Value,
}

impl EventEncoding {
    pub fn new(kind: impl Into<String>, version: i16, payload: Value) -> Self {
        Self {
            kind: kind.into(),
            version,
            payload,
        }
    }
}

/// This encoding is emitted only by a context codec. It cannot be submitted
/// directly to the typed journal append API.
#[derive(Debug, Clone, PartialEq)]
pub struct IntegrationFact {
    pub context: String,
    pub kind: String,
    pub version: i16,
    pub payload: Value,
}

impl IntegrationFact {
    pub fn new(
        context: impl Into<String>,
        kind: impl Into<String>,
        version: i16,
        payload: Value,
    ) -> Self {
        Self {
            context: context.into(),
            kind: kind.into(),
            version,
            payload,
        }
    }
}

pub trait EventCodec {
    const CONTEXT: &'static str;
    type Event;
    type Actor: Serialize + DeserializeOwned + Clone;
    type Error: Error + Send + Sync + 'static;

    fn encode(event: &Self::Event) -> Result<EventEncoding, Self::Error>;
    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Self::Event, Self::Error>;

    fn integration_facts(_event: &Self::Event) -> Result<Vec<IntegrationFact>, Self::Error> {
        Ok(Vec::new())
    }
}

pub trait IntegrationCodec {
    const CONTEXT: &'static str;
    type Fact;
    type Error: Error + Send + Sync + 'static;

    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Self::Fact, Self::Error>;
}

pub struct EventToAppend<C: EventCodec> {
    pub event: C::Event,
    pub actor: C::Actor,
    pub occurred_at: i64,
    pub causation_id: Option<Uuid>,
    pub meta: Value,
}

impl<C: EventCodec> EventToAppend<C> {
    pub fn new(event: C::Event, actor: C::Actor, occurred_at: i64) -> Self {
        Self {
            event,
            actor,
            occurred_at,
            causation_id: None,
            meta: json!({}),
        }
    }
}

pub struct LoadedEvent<C: EventCodec> {
    pub seq: i64,
    pub stream_id: StreamId,
    pub stream_seq: StreamVersion,
    pub event: C::Event,
    pub actor: C::Actor,
    pub occurred_at: i64,
    pub causation_id: Option<Uuid>,
    pub meta: Value,
}

pub struct LoadedIntegration<C: IntegrationCodec> {
    pub source_seq: i64,
    pub stream_id: StreamId,
    pub stream_seq: StreamVersion,
    pub fact_index: i32,
    pub fact: C::Fact,
    pub occurred_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum JournalError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("invalid journal envelope: {0}")]
    InvalidEnvelope(String),
    #[error("{context} codec rejected an envelope: {message}")]
    Codec {
        context: &'static str,
        message: String,
    },
}

fn codec_error<C: EventCodec>(error: impl std::fmt::Display) -> JournalError {
    JournalError::Codec {
        context: C::CONTEXT,
        message: error.to_string(),
    }
}

fn validate_header(context: &str, kind: &str, version: i16) -> Result<(), JournalError> {
    if context.is_empty() || kind.is_empty() || version <= 0 {
        return Err(JournalError::InvalidEnvelope(
            "context and kind must be nonempty and schema version positive".into(),
        ));
    }
    Ok(())
}

/// Admission is source-owned and fail-closed, including context and actor.
pub fn decode<C: EventCodec>(stored: &StoredEvent) -> Result<LoadedEvent<C>, JournalError> {
    validate_header(C::CONTEXT, &stored.kind, stored.version)?;
    if stored.meta.get(CONTEXT_META_KEY).and_then(Value::as_str) != Some(C::CONTEXT) {
        return Err(JournalError::InvalidEnvelope(format!(
            "expected sealed journal context {}",
            C::CONTEXT
        )));
    }
    if stored.seq <= 0 || stored.stream_seq <= 0 {
        return Err(JournalError::InvalidEnvelope(
            "persisted event positions must be positive".into(),
        ));
    }
    let event =
        C::decode(&stored.kind, stored.version, &stored.payload).map_err(codec_error::<C>)?;
    let actor = serde_json::from_value(stored.actor.clone()).map_err(codec_error::<C>)?;
    Ok(LoadedEvent {
        seq: stored.seq,
        stream_id: StreamId::new(stored.stream_id),
        stream_seq: StreamVersion::new(stored.stream_seq)?,
        event,
        actor,
        occurred_at: stored.occurred_at,
        causation_id: stored.causation_id,
        meta: stored.meta.clone(),
    })
}

pub async fn lock_stream_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<(), JournalError> {
    crate::lock_stream_in_tx(tx, stream.as_uuid()).await?;
    Ok(())
}

pub async fn load_in_tx<C: EventCodec>(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<Vec<LoadedEvent<C>>, JournalError> {
    decode_stream::<C>(&crate::load_stream_in_tx(tx, stream.as_uuid()).await?)
}

pub async fn load<C: EventCodec>(
    pool: &PgPool,
    stream: StreamId,
) -> Result<Vec<LoadedEvent<C>>, JournalError> {
    decode_stream::<C>(&crate::load_stream(pool, stream.as_uuid()).await?)
}

fn decode_stream<C: EventCodec>(
    events: &[StoredEvent],
) -> Result<Vec<LoadedEvent<C>>, JournalError> {
    events
        .iter()
        .enumerate()
        .map(|(index, event)| {
            if event.stream_seq != index as i64 + 1 {
                return Err(JournalError::InvalidEnvelope(
                    "journal stream positions are not contiguous".into(),
                ));
            }
            decode::<C>(event)
        })
        .collect()
}

struct PreparedEvent {
    input: EventInput,
    facts: Vec<IntegrationFact>,
}

fn prepare<C: EventCodec>(pending: &EventToAppend<C>) -> Result<PreparedEvent, JournalError> {
    let encoded = C::encode(&pending.event).map_err(codec_error::<C>)?;
    validate_header(C::CONTEXT, &encoded.kind, encoded.version)?;
    let decoded =
        C::decode(&encoded.kind, encoded.version, &encoded.payload).map_err(codec_error::<C>)?;
    if C::encode(&decoded).map_err(codec_error::<C>)? != encoded {
        return Err(JournalError::InvalidEnvelope(
            "event codec round trip changed its encoding".into(),
        ));
    }
    let actor = serde_json::to_value(&pending.actor).map_err(codec_error::<C>)?;
    let decoded_actor: C::Actor =
        serde_json::from_value(actor.clone()).map_err(codec_error::<C>)?;
    if serde_json::to_value(decoded_actor).map_err(codec_error::<C>)? != actor {
        return Err(JournalError::InvalidEnvelope(
            "actor codec round trip changed its encoding".into(),
        ));
    }
    let mut meta = pending.meta.clone();
    let fields = meta
        .as_object_mut()
        .ok_or_else(|| JournalError::InvalidEnvelope("event metadata must be an object".into()))?;
    if fields
        .get(CONTEXT_META_KEY)
        .is_some_and(|value| value.as_str() != Some(C::CONTEXT))
    {
        return Err(JournalError::InvalidEnvelope(
            "caller supplied a different journal context".into(),
        ));
    }
    fields.insert(
        CONTEXT_META_KEY.to_string(),
        Value::String(C::CONTEXT.to_string()),
    );
    let facts = C::integration_facts(&decoded).map_err(codec_error::<C>)?;
    for fact in &facts {
        validate_header(&fact.context, &fact.kind, fact.version)?;
    }
    if facts.len() > i32::MAX as usize {
        return Err(JournalError::InvalidEnvelope(
            "too many integration facts".into(),
        ));
    }
    let mut input = EventInput::new(
        encoded.kind,
        encoded.version,
        encoded.payload,
        actor,
        pending.occurred_at,
    );
    input.causation_id = pending.causation_id;
    input.meta = meta;
    Ok(PreparedEvent { input, facts })
}

/// All codec and actor admission precedes the first write. Events and their
/// derived integration facts share a savepoint even when an outer caller
/// catches an error and subsequently commits unrelated transaction work.
pub async fn append_expected_in_tx<C: EventCodec>(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
    expected: ExpectedVersion,
    pending: &[EventToAppend<C>],
) -> Result<Vec<LoadedEvent<C>>, JournalError> {
    if pending.is_empty() {
        return Err(JournalError::InvalidEnvelope(
            "an append batch must be nonempty".into(),
        ));
    }
    let batch_len = i64::try_from(pending.len())
        .map_err(|_| JournalError::InvalidEnvelope("append batch is too large".into()))?;
    expected
        .get()
        .checked_add(batch_len)
        .ok_or_else(|| JournalError::InvalidEnvelope("stream version is exhausted".into()))?;
    let prepared = pending
        .iter()
        .map(prepare::<C>)
        .collect::<Result<Vec<_>, _>>()?;
    let inputs: Vec<_> = prepared.iter().map(|event| event.input.clone()).collect();
    let mut batch = sqlx::Acquire::begin(&mut *tx).await?;
    let result = async {
        let stored =
            crate::append_expected_in_tx(&mut batch, stream.as_uuid(), expected.get(), &inputs)
                .await?;
        let loaded = stored
            .iter()
            .map(decode::<C>)
            .collect::<Result<Vec<_>, _>>()?;
        for (source, prepared) in stored.iter().zip(&prepared) {
            for (index, fact) in prepared.facts.iter().enumerate() {
                insert_fact(&mut batch, source, index as i32, fact).await?;
            }
        }
        Ok::<_, JournalError>(loaded)
    }
    .await;
    match result {
        Ok(events) => {
            batch.commit().await?;
            Ok(events)
        }
        Err(error) => {
            batch.rollback().await?;
            Err(error)
        }
    }
}

#[derive(Serialize)]
struct FactIdentity<'a> {
    purpose: &'static str,
    storage_version: i16,
    stream_id: Uuid,
    stream_seq: i64,
    source_seq: i64,
    fact_index: i32,
    context: &'a str,
    kind: &'a str,
    version: i16,
    occurred_at: i64,
    key_epoch: i64,
}

impl FactIdentity<'_> {
    fn aad(&self) -> Result<Vec<u8>, JournalError> {
        serde_json::to_vec(self).map_err(|error| JournalError::InvalidEnvelope(error.to_string()))
    }
}

async fn insert_fact(
    tx: &mut Transaction<'_, Postgres>,
    source: &StoredEvent,
    index: i32,
    fact: &IntegrationFact,
) -> Result<(), JournalError> {
    let key = crate::active_stream_data_key_in_tx(tx, source.stream_id).await?;
    let identity = FactIdentity {
        purpose: "fmarch-event-integration-fact",
        storage_version: OUTBOX_STORAGE_VERSION,
        stream_id: source.stream_id,
        stream_seq: source.stream_seq,
        source_seq: source.seq,
        fact_index: index,
        context: &fact.context,
        kind: &fact.kind,
        version: fact.version,
        occurred_at: source.occurred_at,
        key_epoch: key.key_epoch,
    };
    let plaintext = serde_json::to_vec(&fact.payload)
        .map_err(|error| JournalError::InvalidEnvelope(error.to_string()))?;
    let (nonce, ciphertext) =
        crate::encrypt_bytes_with_material(&key.bytes, &plaintext, &identity.aad()?)?;
    sqlx::query(
        "INSERT INTO event_integration_outbox (source_seq, fact_index, context, kind, version, sealed_version, stream_key_epoch, sealed_nonce, sealed_body) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(source.seq)
    .bind(index)
    .bind(&fact.context)
    .bind(&fact.kind)
    .bind(fact.version)
    .bind(OUTBOX_STORAGE_VERSION)
    .bind(key.key_epoch)
    .bind(nonce.as_slice())
    .bind(ciphertext)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Authenticate all integration facts for a stream and admit their context,
/// version, and payload through the consuming integration codec. No unknown
/// fact is filtered away by the SQL query.
struct OpenedIntegration {
    source_seq: i64,
    stream_seq: StreamVersion,
    fact_index: i32,
    fact: IntegrationFact,
    occurred_at: i64,
}

async fn open_outbox_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<Vec<OpenedIntegration>, JournalError> {
    let rows = sqlx::query(
        "SELECT o.source_seq, o.fact_index, o.context, o.kind, o.version, o.sealed_version, o.stream_key_epoch, o.sealed_nonce, o.sealed_body, e.stream_id, e.stream_seq, e.occurred_at, k.wrap_version, k.wrap_kid, k.wrap_nonce, k.wrapped_dek FROM event_integration_outbox AS o JOIN events AS e ON e.seq=o.source_seq LEFT JOIN event_stream_keys AS k ON k.stream_id=e.stream_id AND k.key_epoch=o.stream_key_epoch WHERE e.stream_id=$1 ORDER BY e.stream_seq, o.fact_index",
    )
    .bind(stream.as_uuid())
    .fetch_all(&mut **tx)
    .await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let context: String = row.try_get("context")?;
        let kind: String = row.try_get("kind")?;
        let version: i16 = row.try_get("version")?;
        let storage_version: i16 = row.try_get("sealed_version")?;
        validate_header(&context, &kind, version)?;
        if storage_version != OUTBOX_STORAGE_VERSION {
            return Err(JournalError::InvalidEnvelope(
                "unsupported integration storage version".into(),
            ));
        }
        let source_seq: i64 = row.try_get("source_seq")?;
        let stream_seq: i64 = row.try_get("stream_seq")?;
        let index: i32 = row.try_get("fact_index")?;
        let occurred_at: i64 = row.try_get("occurred_at")?;
        let epoch: i64 = row.try_get("stream_key_epoch")?;
        let key = crate::unwrap_stream_data_key(crate::WrappedStreamDataKey::from_parts(
            stream.as_uuid(),
            epoch,
            row.try_get("wrap_version")?,
            row.try_get("wrap_kid")?,
            row.try_get("wrap_nonce")?,
            row.try_get("wrapped_dek")?,
        )?)?;
        let identity = FactIdentity {
            purpose: "fmarch-event-integration-fact",
            storage_version,
            stream_id: stream.as_uuid(),
            stream_seq,
            source_seq,
            fact_index: index,
            context: &context,
            kind: &kind,
            version,
            occurred_at,
            key_epoch: epoch,
        };
        let nonce: Vec<u8> = row.try_get("sealed_nonce")?;
        let nonce: [u8; 24] = nonce.try_into().map_err(|_| {
            JournalError::InvalidEnvelope("invalid integration nonce length".into())
        })?;
        let body: Vec<u8> = row.try_get("sealed_body")?;
        let plaintext = crate::decrypt_bytes_with_material(
            &key.bytes,
            &nonce,
            &body,
            &identity.aad()?,
            "decrypt integration fact",
        )?;
        let payload: Value = serde_json::from_slice(&plaintext)
            .map_err(|error| JournalError::InvalidEnvelope(error.to_string()))?;
        out.push(OpenedIntegration {
            source_seq,
            stream_seq: StreamVersion::new(stream_seq)?,
            fact_index: index,
            fact: IntegrationFact::new(context, kind, version, payload),
            occurred_at,
        });
    }
    Ok(out)
}

/// Authenticate and decode every fact through the owning integration codec.
pub async fn load_outbox_in_tx<C: IntegrationCodec>(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<Vec<LoadedIntegration<C>>, JournalError> {
    open_outbox_in_tx(tx, stream)
        .await?
        .into_iter()
        .map(|opened| {
            if opened.fact.context != C::CONTEXT {
                return Err(JournalError::InvalidEnvelope(
                    "unsupported integration context".into(),
                ));
            }
            let fact = C::decode(&opened.fact.kind, opened.fact.version, &opened.fact.payload)
                .map_err(|error| JournalError::Codec {
                    context: C::CONTEXT,
                    message: error.to_string(),
                })?;
            Ok(LoadedIntegration {
                source_seq: opened.source_seq,
                stream_id: stream,
                stream_seq: opened.stream_seq,
                fact_index: opened.fact_index,
                fact,
                occurred_at: opened.occurred_at,
            })
        })
        .collect()
}

/// Audit completeness as well as authentication: missing, extra, reordered,
/// or source-inconsistent facts fail against the source codec's derivation.
/// This operation acquires the source stream fence before taking its baseline.
pub async fn audit_source_outbox_in_tx<C: EventCodec>(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<usize, JournalError> {
    lock_stream_in_tx(tx, stream).await?;
    let events = load_in_tx::<C>(tx, stream).await?;
    let actual = open_outbox_in_tx(tx, stream).await?;
    let mut expected = Vec::new();
    for event in events {
        for (index, fact) in C::integration_facts(&event.event)
            .map_err(codec_error::<C>)?
            .into_iter()
            .enumerate()
        {
            let index = i32::try_from(index)
                .map_err(|_| JournalError::InvalidEnvelope("too many integration facts".into()))?;
            expected.push((event.seq, event.stream_seq, index, event.occurred_at, fact));
        }
    }
    if expected.len() != actual.len()
        || expected.iter().zip(&actual).any(|(expected, actual)| {
            expected.0 != actual.source_seq
                || expected.1 != actual.stream_seq
                || expected.2 != actual.fact_index
                || expected.3 != actual.occurred_at
                || expected.4 != actual.fact
        })
    {
        return Err(JournalError::InvalidEnvelope(
            "integration outbox differs from its canonical source".into(),
        ));
    }
    Ok(actual.len())
}

pub async fn audit_outbox_in_tx<C: IntegrationCodec>(
    tx: &mut Transaction<'_, Postgres>,
    stream: StreamId,
) -> Result<usize, JournalError> {
    Ok(load_outbox_in_tx::<C>(tx, stream).await?.len())
}

#[cfg(test)]
mod tests;
