//! Debug-only fixture construction. Production commands enter forum_application;
//! fixtures still exercise typed admission, sealed outbox and atomic projection.

use crate::ProjectionError;
use event_actor::ActorId;
use eventstore::journal::{self, EventToAppend, ExpectedVersion, StreamId};
use eventstore::{EventInput, StoredEvent};
use forum_journal::ForumCodec;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

fn journal_error(error: journal::JournalError) -> ProjectionError {
    match error {
        journal::JournalError::Store(error) => ProjectionError::Store(error),
        error => ProjectionError::Journal(error),
    }
}

pub async fn append_discussion_and_project(
    pool: &PgPool,
    stream: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let mut tx = pool.begin().await?;
    let stored = append_discussion_and_project_in_tx(&mut tx, stream, events).await?;
    tx.commit().await?;
    Ok(stored)
}

pub async fn append_discussion_and_project_expected(
    pool: &PgPool,
    stream: Uuid,
    expected: i64,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let mut tx = pool.begin().await?;
    let stored = append_in_tx(&mut tx, stream, Some(expected), events).await?;
    tx.commit().await?;
    Ok(stored)
}

pub async fn append_discussion_and_project_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    append_in_tx(tx, stream, None, events).await
}

async fn append_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    stream: Uuid,
    expected: Option<i64>,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let pending: Vec<_> = events
        .iter()
        .map(|input| {
            let event = forum::decode_event(&input.kind, input.version, &input.payload)?;
            let actor =
                ActorId::decode(&input.actor).map_err(|source| ProjectionError::Payload {
                    kind: input.kind.clone(),
                    source,
                })?;
            let mut pending = EventToAppend::<ForumCodec>::new(event, actor, input.occurred_at);
            pending.causation_id = input.causation_id;
            pending.meta = input.meta.clone();
            Ok::<_, ProjectionError>(pending)
        })
        .collect::<Result<_, _>>()?;
    let mut batch = sqlx::Acquire::begin(&mut *tx).await?;
    let result = async {
        journal::lock_stream_in_tx(&mut batch, StreamId::new(stream)).await?;
        let expected = match expected {
            Some(version) => version,
            None => journal::load_in_tx::<ForumCodec>(&mut batch, StreamId::new(stream))
                .await?
                .last()
                .map_or(0, |event| event.stream_seq.get()),
        };
        for pending in &pending {
            if let forum::DecodedForumEvent::AreaCreated { slug, .. } = &pending.event {
                sqlx::query("INSERT INTO forum_area_reservation(area_id, slug) VALUES ($1, $2)")
                    .bind(stream)
                    .bind(slug)
                    .execute(&mut *batch)
                    .await?;
            }
        }
        let stored = journal::append_expected_in_tx::<ForumCodec>(
            &mut batch,
            StreamId::new(stream),
            ExpectedVersion::new(expected)?,
            &pending,
        )
        .await
        .map_err(journal_error)?;
        let mut records = Vec::with_capacity(stored.len());
        for event in &stored {
            let record = forum_journal::projection_record(event);
            crate::project_discussion_event(&mut batch, stream, &record).await?;
            records.push(record);
        }
        Ok::<_, ProjectionError>(records)
    }
    .await;
    match result {
        Ok(stored) => {
            batch.commit().await?;
            Ok(stored)
        }
        Err(error) => {
            batch.rollback().await?;
            Err(error)
        }
    }
}
