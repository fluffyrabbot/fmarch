//! Game-owned resolver event encoding and retained-version admission. The
//! storage journal never interprets game versions or silently repairs failures.
//! Other game event families still await their own exhaustive typed codec cut.
use event_actor::ActorId;
use eventstore::journal::{EventCodec, EventEncoding};
use eventstore::{EventInput, StoredEvent};
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum GameCodecError {
    #[error("unsupported game resolver event kind {0}")]
    UnknownKind(String),
    #[error("invalid game resolver event header: {0}")]
    Header(String),
    #[error(transparent)]
    Contract(#[from] domain::ResultValidationError),
    #[error(transparent)]
    Payload(#[from] serde_json::Error),
    #[error(transparent)]
    Store(#[from] eventstore::StoreError),
}

#[derive(Debug, Clone, PartialEq)]
pub enum ResolverEvent {
    Applied(domain::ResolutionApplied),
    Trace(domain::ResolutionTrace),
}

pub struct ResolverCodec;

impl EventCodec for ResolverCodec {
    const CONTEXT: &'static str = "game.resolver";
    type Event = ResolverEvent;
    type Actor = ActorId;
    type Error = GameCodecError;

    fn encode(event: &ResolverEvent) -> Result<EventEncoding, Self::Error> {
        match event {
            ResolverEvent::Applied(applied) => {
                domain::validate_resolution_applied(applied, domain::RESULT_VERSION)?;
                Ok(EventEncoding::new(
                    "ResolutionApplied",
                    current_result_header()?,
                    serde_json::to_value(applied)?,
                ))
            }
            ResolverEvent::Trace(trace) => {
                domain::validate_resolution_trace(trace, domain::TRACE_VERSION)?;
                Ok(EventEncoding::new(
                    "ResolutionTrace",
                    current_trace_header()?,
                    serde_json::to_value(trace)?,
                ))
            }
        }
    }

    fn decode(kind: &str, version: i16, payload: &Value) -> Result<ResolverEvent, Self::Error> {
        match kind {
            "ResolutionApplied" => {
                decode_applied_payload(version, payload).map(ResolverEvent::Applied)
            }
            "ResolutionTrace" => {
                if version != current_trace_header()? {
                    return Err(GameCodecError::Header(format!(
                        "unsupported trace version {version}"
                    )));
                }
                Ok(ResolverEvent::Trace(domain::validate_trace_json(
                    payload,
                    domain::TRACE_VERSION,
                )?))
            }
            _ => Err(GameCodecError::UnknownKind(kind.to_string())),
        }
    }
}

fn current_result_header() -> Result<i16, GameCodecError> {
    i16::try_from(domain::RESULT_VERSION)
        .map_err(|_| GameCodecError::Header("result version exceeds journal header".into()))
}

fn current_trace_header() -> Result<i16, GameCodecError> {
    i16::try_from(domain::TRACE_VERSION)
        .map_err(|_| GameCodecError::Header("trace version exceeds journal header".into()))
}

fn decode_applied_payload(
    header: i16,
    payload: &Value,
) -> Result<domain::ResolutionApplied, GameCodecError> {
    let payload_version = payload
        .get("result_version")
        .and_then(Value::as_u64)
        .and_then(|version| u16::try_from(version).ok())
        .ok_or_else(|| {
            GameCodecError::Header("missing or invalid payload result_version".into())
        })?;
    // Retained legacy header 1 used the payload version as its contract tag.
    // Every later header must agree exactly; a current body cannot bypass an
    // unknown, negative, or inconsistent outer version.
    let source_version = if header == 1 {
        payload_version
    } else {
        let version = u16::try_from(header)
            .map_err(|_| GameCodecError::Header(format!("unsupported result header {header}")))?;
        if version == 0 || version != payload_version {
            return Err(GameCodecError::Header(format!(
                "result header {header} disagrees with payload version {payload_version}"
            )));
        }
        version
    };
    let upcast = domain::upcast_resolution_applied(payload.clone(), source_version)?;
    Ok(domain::validate_resolution_json(
        &upcast,
        domain::RESULT_VERSION,
    )?)
}

pub fn decode_applied(event: &StoredEvent) -> Result<domain::ResolutionApplied, GameCodecError> {
    ActorId::decode(&event.actor)?;
    match ResolverCodec::decode(&event.kind, event.version, &event.payload)? {
        ResolverEvent::Applied(applied) => Ok(applied),
        ResolverEvent::Trace(_) => Err(GameCodecError::UnknownKind(event.kind.clone())),
    }
}

pub fn decode_trace(event: &StoredEvent) -> Result<domain::ResolutionTrace, GameCodecError> {
    ActorId::decode(&event.actor)?;
    match ResolverCodec::decode(&event.kind, event.version, &event.payload)? {
        ResolverEvent::Trace(trace) => Ok(trace),
        ResolverEvent::Applied(_) => Err(GameCodecError::UnknownKind(event.kind.clone())),
    }
}

pub fn resolution_applied(
    applied: &domain::ResolutionApplied,
    actor: impl Into<Value>,
    occurred_at: i64,
) -> Result<EventInput, GameCodecError> {
    domain::validate_resolution_applied(applied, domain::RESULT_VERSION)?;
    let actor = actor.into();
    ActorId::decode(&actor)?;
    Ok(EventInput::new(
        "ResolutionApplied",
        current_result_header()?,
        serde_json::to_value(applied)?,
        actor,
        occurred_at,
    ))
}

pub fn resolution_trace(
    trace: &domain::ResolutionTrace,
    actor: impl Into<Value>,
    occurred_at: i64,
) -> Result<EventInput, GameCodecError> {
    domain::validate_resolution_trace(trace, domain::TRACE_VERSION)?;
    let actor = actor.into();
    ActorId::decode(&actor)?;
    Ok(EventInput::new(
        "ResolutionTrace",
        current_trace_header()?,
        serde_json::to_value(trace)?,
        actor,
        occurred_at,
    ))
}

/// Normalize only the resolver family owned here. This is deliberately not an
/// assertion that the other, as-yet untyped game families have been validated.
pub fn normalize(mut event: StoredEvent) -> Result<StoredEvent, GameCodecError> {
    match event.kind.as_str() {
        "ResolutionApplied" => {
            event.payload = serde_json::to_value(decode_applied(&event)?)?;
            event.version = current_result_header()?;
        }
        "ResolutionTrace" => {
            event.payload = serde_json::to_value(decode_trace(&event)?)?;
            event.version = current_trace_header()?;
        }
        _ => {}
    }
    Ok(event)
}

pub fn normalize_stream(events: Vec<StoredEvent>) -> Result<Vec<StoredEvent>, GameCodecError> {
    events.into_iter().map(normalize).collect()
}

pub async fn load_stream(pool: &PgPool, stream: Uuid) -> Result<Vec<StoredEvent>, GameCodecError> {
    normalize_stream(eventstore::load_stream(pool, stream).await?)
}

pub async fn load_stream_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: Uuid,
) -> Result<Vec<StoredEvent>, GameCodecError> {
    normalize_stream(eventstore::load_stream_in_tx(tx, stream).await?)
}

pub async fn load_stream_after_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: Uuid,
    after: i64,
) -> Result<Vec<StoredEvent>, GameCodecError> {
    normalize_stream(eventstore::load_stream_after_in_tx(tx, stream, after).await?)
}

#[cfg(test)]
mod tests;
