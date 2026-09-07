//! Private reading positions are last deliberate writes, not monotonic read receipts.
use crate::ProjectionError;
use attention::{ReadingCheckpoint, ReadingPosition};
use principal::PrincipalId;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn reading_checkpoint(
    pool: &PgPool,
    principal: PrincipalId,
    game: Uuid,
    channel: &str,
) -> Result<ReadingCheckpoint, ProjectionError> {
    let stream = attention::reading_checkpoint_stream_id(principal, game, channel);
    let mut tx = pool.begin().await?;
    // Serialize with append, then decrypt only the indexed latest event, not the history.
    eventstore::lock_stream_in_tx(&mut tx, stream).await?;
    let revision: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(stream_seq), 0) FROM events WHERE stream_id=$1")
            .bind(stream)
            .fetch_one(&mut *tx)
            .await?;
    if revision == 0 {
        return Ok(ReadingCheckpoint::default());
    }
    let events = eventstore::load_stream_after_in_tx(&mut tx, stream, revision - 1).await?;
    let event = events
        .last()
        .ok_or_else(|| ProjectionError::Privacy("missing reading checkpoint".into()))?;
    let position: ReadingPosition = serde_json::from_value(event.payload.clone())
        .map_err(|_| ProjectionError::Privacy("invalid reading checkpoint".into()))?;
    if event.kind != attention::READING_CHECKPOINT_SET || !position.is_valid() {
        return Err(ProjectionError::Privacy(
            "invalid reading checkpoint".into(),
        ));
    }
    tx.commit().await?;
    Ok(ReadingCheckpoint {
        revision,
        position: Some(position),
    })
}

pub async fn set_reading_checkpoint(
    pool: &PgPool,
    principal: PrincipalId,
    game: Uuid,
    channel: &str,
    expected_revision: i64,
    position: ReadingPosition,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    if !position.is_valid() || !(0..9_007_199_254_740_991).contains(&expected_revision) {
        return Err(ProjectionError::Privacy(
            "invalid reading checkpoint".into(),
        ));
    }
    let stream = attention::reading_checkpoint_stream_id(principal, game, channel);
    let input = eventstore::EventInput::new(
        attention::READING_CHECKPOINT_SET,
        1,
        serde_json::json!(position),
        eventstore::ActorId::Principal(principal),
        occurred_at,
    );
    let mut tx = pool.begin().await?;
    eventstore::append_expected_in_tx(&mut tx, stream, expected_revision, &[input]).await?;
    tx.commit().await?;
    Ok(())
}
