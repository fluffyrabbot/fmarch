//! Cross-source attention materialization. Source streams are locked before
//! this per-surface gate; nothing behind it acquires another source lock.
//! Watch eligibility is event-time membership, independent of commit order.

use crate::{game_origin, publications, ProjectionError};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub(super) async fn lock_surface(
    tx: &mut Transaction<'_, Postgres>,
    surface: Uuid,
) -> Result<(), ProjectionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("surface-attention:{surface}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// The caller holds the surface gate before changing source projections.
pub(super) async fn publish_forum_post(
    tx: &mut Transaction<'_, Postgres>,
    surface: Uuid,
    delivery: publications::ForumWatchDelivery,
) -> Result<(), ProjectionError> {
    insert_watch_deliveries(tx, surface, None, &[delivery]).await
}

/// Replace only the watch-owned reasons for this subscription. A late commit
/// can both add a previously missing recipient and retract a recipient whose
/// watch period ended before the post. Mentions retain their independent owner.
pub(super) async fn reconcile_subscription(
    tx: &mut Transaction<'_, Postgres>,
    subscription: Uuid,
) -> Result<(), ProjectionError> {
    let surface: Uuid =
        sqlx::query_scalar("SELECT surface_id FROM public_watch WHERE subscription_id = $1")
            .bind(subscription)
            .fetch_one(&mut **tx)
            .await?;
    lock_surface(tx, surface).await?;
    // This is a nonlocking source read. An uncommitted post is invisible here
    // and publishes after obtaining the gate. Never take its stream lock here.
    let deliveries = publications::forum_watch_deliveries(tx, surface).await?;
    sqlx::query(
        r#"
        DELETE FROM member_inbox_item AS item
        USING public_watch AS watch
        WHERE watch.subscription_id = $1
          AND item.principal_id = watch.principal_id
          AND item.surface_id = watch.surface_id AND item.reason = 'watch'
        "#,
    )
    .bind(subscription)
    .execute(&mut **tx)
    .await?;
    insert_watch_deliveries(tx, surface, Some(subscription), &deliveries).await?;
    game_origin::reconcile_attention(tx, surface, Some(subscription)).await
}

async fn insert_watch_deliveries(
    tx: &mut Transaction<'_, Postgres>,
    surface: Uuid,
    subscription: Option<Uuid>,
    deliveries: &[publications::ForumWatchDelivery],
) -> Result<(), ProjectionError> {
    if deliveries.is_empty() {
        return Ok(());
    }
    let sequences: Vec<_> = deliveries
        .iter()
        .map(|delivery| delivery.source_seq)
        .collect();
    let times: Vec<_> = deliveries
        .iter()
        .map(|delivery| delivery.occurred_at)
        .collect();
    let authors: Vec<_> = deliveries
        .iter()
        .map(|delivery| delivery.author.map(|author| author.as_uuid()))
        .collect();
    sqlx::query(
        r#"
        INSERT INTO member_inbox_item (
            principal_id, surface_id, source_seq, delivery_seq, reason, occurred_at
        )
        SELECT watch.principal_id, $1, post.source_seq, post.source_seq, 'watch', post.occurred_at
        FROM UNNEST($3::bigint[], $4::bigint[], $5::uuid[])
             AS post(source_seq, occurred_at, author_principal_id)
        JOIN public_watch AS watch ON watch.surface_id = $1
        JOIN public_watch_period AS period ON period.subscription_id = watch.subscription_id
          AND period.started_seq < post.source_seq
          AND (period.ended_seq IS NULL OR period.ended_seq > post.source_seq)
        WHERE ($2::uuid IS NULL OR watch.subscription_id = $2)
          AND (post.author_principal_id IS NULL OR watch.principal_id <> post.author_principal_id)
        ON CONFLICT (principal_id, surface_id, source_seq, reason) DO NOTHING
        "#,
    )
    .bind(surface)
    .bind(subscription)
    .bind(sequences)
    .bind(times)
    .bind(authors)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests;
