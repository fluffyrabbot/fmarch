//! Attention application service for public watches, read cursors, and private reviews.

use attention::{
    self, InboxCursorCommand, InboxCursorEvent, WatchCommand, WatchEvent, WatchTarget,
};
use eventstore::EventInput;
use principal::PrincipalId;
use sqlx::postgres::PgPool;
use uuid::Uuid;

use crate::{
    fold_member_inbox_cursor_event, fold_subscription_event, public_inbox,
    public_subscription_target_latest_seq, subscription_domain_state, subscription_target_state,
    ProjectionError, PublicInboxPage, SubscriptionTargetStateRow,
};

pub async fn subscribe_to_public_target(
    pool: &PgPool,
    target: WatchTarget,
    principal_id: PrincipalId,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    let existing = subscription_domain_state(&mut tx, principal_id, &target).await?;
    let subscription_id = existing
        .as_ref()
        .map_or_else(Uuid::new_v4, |state| state.watch_id);
    let events = attention::decide_watch(
        existing.as_ref(),
        WatchCommand::Subscribe {
            target: target.clone(),
            initial_read_through_seq: latest_source_seq,
        },
    )
    .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        subscription_id,
        existing.as_ref().map_or(0, |state| state.version),
        events,
        principal_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_id, target).await
}

pub async fn unsubscribe_from_public_target(
    pool: &PgPool,
    target: WatchTarget,
    principal_id: PrincipalId,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_id, &target).await?;
    let state = subscription_domain_state(&mut tx, principal_id, &target)
        .await?
        .ok_or(ProjectionError::NotSubscribed)?;
    let events = attention::decide_watch(Some(&state), WatchCommand::Unsubscribe)
        .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        state.watch_id,
        state.version,
        events,
        principal_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_id, target).await
}

pub async fn advance_subscription_read_cursor(
    pool: &PgPool,
    target: WatchTarget,
    principal_id: PrincipalId,
    read_through_seq: i64,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    if read_through_seq <= 0 || read_through_seq > latest_source_seq {
        return Err(ProjectionError::InvalidSubscriptionReadCursor);
    }
    let state = subscription_domain_state(&mut tx, principal_id, &target)
        .await?
        .ok_or(ProjectionError::NotSubscribed)?;
    let events =
        attention::decide_watch(Some(&state), WatchCommand::AdvanceRead { read_through_seq })
            .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        state.watch_id,
        state.version,
        events,
        principal_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_id, target).await
}

/// Advance the per-principal inbox cursor and return the inbox as it now
/// reads. This is the only cursor a mention row on an unwatched surface can
/// clear, so "mark all read" targets it rather than any watch. The caller
/// supplies the sequence it saw, not a fabricated "now": the cursor never
/// exceeds a row the reader was actually shown.
pub async fn advance_member_inbox_read_cursor(
    pool: &PgPool,
    principal_id: PrincipalId,
    read_through_seq: i64,
    occurred_at: i64,
) -> Result<PublicInboxPage, ProjectionError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("member-inbox-cursor:{principal_id}"))
        .execute(&mut *tx)
        .await?;
    if read_through_seq <= 0 {
        return Err(ProjectionError::InvalidSubscriptionReadCursor);
    }
    let state = inbox_cursor_domain_state(&mut tx, principal_id).await?;
    let events = attention::decide_inbox_cursor(
        state.as_ref(),
        InboxCursorCommand::AdvanceRead { read_through_seq },
    )
    .map_err(subscription_domain_error)?;
    append_inbox_cursor_events(
        &mut tx,
        attention::inbox_cursor_stream_id(principal_id),
        state.as_ref().map_or(0, |state| state.version),
        events,
        principal_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    public_inbox(pool, principal_id, None, 50).await
}

async fn inbox_cursor_domain_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_id: PrincipalId,
) -> Result<Option<attention::InboxCursorState>, ProjectionError> {
    let row = sqlx::query_as::<_, (i64, i64)>(
        "SELECT read_through_seq, version FROM member_inbox_cursor WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    Ok(
        row.map(|(read_through_seq, version)| attention::InboxCursorState {
            principal_id,
            read_through_seq,
            version,
        }),
    )
}

async fn append_inbox_cursor_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<InboxCursorEvent>,
    principal_id: PrincipalId,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::Principal(principal_id),
                occurred_at,
            )
        })
        .collect();
    let stored =
        eventstore::append_expected_in_tx(tx, stream_id, expected_stream_seq, &inputs).await?;
    for event in &stored {
        fold_member_inbox_cursor_event(tx, event).await?;
    }
    Ok(())
}

async fn lock_subscription_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_id: PrincipalId,
    target: &WatchTarget,
) -> Result<(), ProjectionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("public-watch:{principal_id}:{}", target.surface_id))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn append_subscription_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subscription_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<WatchEvent>,
    principal_id: PrincipalId,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::Principal(principal_id),
                occurred_at,
            )
        })
        .collect();
    let stored =
        eventstore::append_expected_in_tx(tx, subscription_id, expected_stream_seq, &inputs)
            .await?;
    for event in &stored {
        fold_subscription_event(tx, subscription_id, event).await?;
    }
    Ok(())
}

fn subscription_domain_error(reject: attention::AttentionReject) -> ProjectionError {
    match reject {
        attention::AttentionReject::AlreadySubscribed => ProjectionError::AlreadySubscribed,
        attention::AttentionReject::NotSubscribed
        | attention::AttentionReject::SubscriptionNotFound => ProjectionError::NotSubscribed,
        attention::AttentionReject::ReadCursorMustAdvance => {
            ProjectionError::InvalidSubscriptionReadCursor
        }
        _ => ProjectionError::Payload {
            kind: "public watch".to_string(),
            source: serde::de::Error::custom(reject.to_string()),
        },
    }
}

/// Private attention is a grow-only set of immutable, one-event receipts.
/// Deterministic stream identity gives idempotence without a second mutable
/// projection or an unbounded per-reader event stream. Existing indexed event
/// headers are the read model; no private message bodies enter these receipts.
pub async fn reviewed_private_items(
    pool: &PgPool,
    principal: PrincipalId,
    game: Uuid,
    item_ids: &[String],
) -> Result<Vec<String>, ProjectionError> {
    let streams: Vec<_> = item_ids
        .iter()
        .map(|id| attention::private_review_stream_id(principal, game, id))
        .collect();
    let reviewed: Vec<Uuid> = sqlx::query_scalar(
        "SELECT stream_id FROM events WHERE stream_id = ANY($1) AND kind = $2 AND stream_seq = 1",
    )
    .bind(&streams)
    .bind(attention::PRIVATE_ITEM_REVIEWED)
    .fetch_all(pool)
    .await?;
    let reviewed: std::collections::HashSet<_> = reviewed.into_iter().collect();
    Ok(item_ids
        .iter()
        .zip(streams)
        .filter(|(_, stream)| reviewed.contains(stream))
        .map(|(id, _)| id.clone())
        .collect())
}

pub async fn review_private_item(
    pool: &PgPool,
    principal: PrincipalId,
    game: Uuid,
    item_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let stream = attention::private_review_stream_id(principal, game, item_id);
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("private-attention:{stream}"))
        .execute(&mut *tx)
        .await?;
    let existing = eventstore::load_stream_in_tx(&mut tx, stream).await?;
    if existing.is_empty() {
        let input = EventInput::new(
            attention::PRIVATE_ITEM_REVIEWED,
            1,
            serde_json::json!({ "game": game, "item_id": item_id }),
            eventstore::ActorId::Principal(principal),
            occurred_at,
        );
        eventstore::append_expected_in_tx(&mut tx, stream, 0, &[input]).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Only immutable delivery keys are needed for review authorization. In
/// particular, this read never opens sealed investigation result payloads.
pub async fn private_delivery_ids_for_slots(
    pool: &PgPool,
    game: Uuid,
    slots: &[String],
) -> Result<Vec<String>, ProjectionError> {
    Ok(sqlx::query_scalar(
        "SELECT 'notification-' || phase_id || '-' || event_index::text || '-' || audience_slot FROM player_notification WHERE game_id = $1 AND audience_slot = ANY($2) \
         UNION ALL SELECT 'investigation-' || phase_id || '-' || event_index::text || '-' || audience_slot FROM player_investigation_result WHERE game_id = $1 AND audience_slot = ANY($2) \
         UNION ALL SELECT 'slot-mention-' || source_seq::text || '-' || audience_slot FROM slot_mention_notification WHERE game_id = $1 AND audience_slot = ANY($2)"
    ).bind(game).bind(slots).fetch_all(pool).await?)
}
