//! Attention application service for public watches and read cursors.

use attention::{self, WatchCommand, WatchEvent, WatchTarget};
use eventstore::EventInput;
use sqlx::postgres::PgPool;
use uuid::Uuid;

use crate::{
    fold_subscription_event, public_subscription_target_latest_seq, subscription_domain_state,
    subscription_target_state, ProjectionError, SubscriptionTargetStateRow,
};

pub async fn subscribe_to_public_target(
    pool: &PgPool,
    target: WatchTarget,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    let existing = subscription_domain_state(&mut tx, principal_user_id, &target).await?;
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
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

pub async fn unsubscribe_from_public_target(
    pool: &PgPool,
    target: WatchTarget,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let state = subscription_domain_state(&mut tx, principal_user_id, &target)
        .await?
        .ok_or(ProjectionError::NotSubscribed)?;
    let events = attention::decide_watch(Some(&state), WatchCommand::Unsubscribe)
        .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        state.watch_id,
        state.version,
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

pub async fn advance_subscription_read_cursor(
    pool: &PgPool,
    target: WatchTarget,
    principal_user_id: &str,
    read_through_seq: i64,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    if read_through_seq <= 0 || read_through_seq > latest_source_seq {
        return Err(ProjectionError::InvalidSubscriptionReadCursor);
    }
    let state = subscription_domain_state(&mut tx, principal_user_id, &target)
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
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

async fn lock_subscription_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_user_id: &str,
    target: &WatchTarget,
) -> Result<(), ProjectionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "public-watch:{principal_user_id}:{}",
            target.surface_id
        ))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn append_subscription_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subscription_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<WatchEvent>,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::Principal(principal_user_id.to_string()),
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
