//! Game-owned origin edges and their public attention adapter. Forum writes do
//! not depend on games; replay of either source preserves the other source's facts.
use crate::{DiscussionTopicRow, GameIndexRow, ProjectionError};
use principal::PrincipalId;
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct GameOriginTopicRow {
    pub topic_id: Uuid,
    pub title: String,
    pub href: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SpawnedGameRow {
    pub game_id: Uuid,
    pub pack: String,
    pub status: String,
}

/// Structural lookup used before identity locks when acquiring CreateGame's
/// existing source stream. Ownership and visibility are checked under that lock.
pub async fn game_origin_topic_exists(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
) -> Result<bool, ProjectionError> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM discussion_topic WHERE topic_id = $1)")
            .bind(topic)
            .fetch_one(&mut **tx)
            .await?,
    )
}

pub async fn game_origin_topic_is_eligible(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
    host: PrincipalId,
) -> Result<bool, ProjectionError> {
    Ok(sqlx::query_scalar(
        r#"
        SELECT EXISTS(SELECT 1 FROM discussion_topic AS topic
        JOIN member_profile AS owner ON owner.profile_id = topic.author_profile_id
        JOIN publication_surface AS surface ON surface.surface_id = topic.topic_id
        WHERE topic.topic_id = $1 AND topic.visibility = 'visible' AND surface.visible
          AND owner.active_principal_id = $2 AND owner.lifecycle = 'active')
    "#,
    )
    .bind(topic)
    .bind(host.as_uuid())
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn game_origin_topic_options(
    pool: &PgPool,
    host: PrincipalId,
) -> Result<Vec<GameOriginTopicRow>, ProjectionError> {
    let rows = sqlx::query(
        r#"
        SELECT topic.topic_id, topic.title, surface.href
        FROM discussion_topic AS topic
        JOIN member_profile AS owner ON owner.profile_id = topic.author_profile_id
        JOIN publication_surface AS surface ON surface.surface_id = topic.topic_id
        WHERE topic.visibility = 'visible' AND surface.visible
          AND owner.active_principal_id = $1 AND owner.lifecycle = 'active'
        ORDER BY topic.updated_seq DESC, topic.topic_id DESC LIMIT 100
    "#,
    )
    .bind(host.as_uuid())
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(origin_row).collect())
}

pub async fn game_origin_topic(
    pool: &PgPool,
    game: Uuid,
) -> Result<Option<GameOriginTopicRow>, ProjectionError> {
    let row = sqlx::query(
        r#"
        SELECT topic.topic_id, topic.title, surface.href FROM game_index AS game
        JOIN discussion_topic AS topic ON topic.topic_id = game.origin_topic_id
        JOIN publication_surface AS surface ON surface.surface_id = topic.topic_id
        WHERE game.game_id = $1 AND topic.visibility = 'visible' AND surface.visible
    "#,
    )
    .bind(game)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(origin_row))
}

fn origin_row(row: sqlx::postgres::PgRow) -> GameOriginTopicRow {
    GameOriginTopicRow {
        topic_id: row.get("topic_id"),
        title: row.get("title"),
        href: row.get("href"),
    }
}

pub(super) async fn fill_game_origins(
    pool: &PgPool,
    games: &mut [GameIndexRow],
) -> Result<(), ProjectionError> {
    let ids: Vec<_> = games.iter().map(|game| game.game_id).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let rows = sqlx::query(
        r#"
        SELECT game.game_id, topic.topic_id, topic.title, surface.href FROM game_index AS game
        JOIN discussion_topic AS topic ON topic.topic_id = game.origin_topic_id
        JOIN publication_surface AS surface ON surface.surface_id = topic.topic_id
        WHERE game.game_id = ANY($1) AND topic.visibility = 'visible' AND surface.visible
    "#,
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    for row in rows {
        let id: Uuid = row.get("game_id");
        if let Some(game) = games.iter_mut().find(|game| game.game_id == id) {
            game.origin_topic = Some(origin_row(row));
        }
    }
    Ok(())
}

pub(super) async fn fill_spawned_games(
    pool: &PgPool,
    topics: &mut [DiscussionTopicRow],
) -> Result<(), ProjectionError> {
    let ids: Vec<_> = topics.iter().map(|topic| topic.topic_id).collect();
    if ids.is_empty() {
        return Ok(());
    }
    let rows = sqlx::query(r#"
        SELECT origin.topic_id, game.game_id, game.pack_key, game.status
        FROM discussion_topic_spawned_game AS origin JOIN game_index AS game ON game.game_id = origin.game_id
        JOIN publication_surface AS surface ON surface.surface_id = game.game_id
        WHERE origin.topic_id = ANY($1) AND origin.started_seq IS NOT NULL
          AND game.status IN ('active', 'completed') AND surface.visible
        ORDER BY origin.started_seq, game.game_id
    "#).bind(ids).fetch_all(pool).await?;
    for row in rows {
        let topic_id: Uuid = row.get("topic_id");
        if let Some(topic) = topics.iter_mut().find(|topic| topic.topic_id == topic_id) {
            topic.spawned_games.push(SpawnedGameRow {
                game_id: row.get("game_id"),
                pack: row.get("pack_key"),
                status: row.get("status"),
            });
        }
    }
    Ok(())
}

pub(super) async fn record_origin(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    topic: Uuid,
    created_seq: i64,
    host: PrincipalId,
) -> Result<(), ProjectionError> {
    sqlx::query("INSERT INTO discussion_topic_spawned_game (game_id, topic_id, created_seq, host_principal_id) VALUES ($1, $2, $3, $4)")
        .bind(game).bind(topic).bind(created_seq).bind(host.as_uuid()).execute(&mut **tx).await?;
    Ok(())
}

/// Every source owns its stream lock before this adapter gate. Nothing behind
/// the gate acquires another event stream, so opposite publication/watch commit
/// orders can converge without a cross-stream lock cycle.
pub(super) async fn lock_attention(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
) -> Result<(), ProjectionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("game-origin-attention:{topic}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(super) fn creation_origin(
    event: &eventstore::StoredEvent,
    game: Uuid,
) -> Result<Option<content_reference::PublicContentRef>, ProjectionError> {
    let origin: Option<content_reference::PublicContentRef> = serde_json::from_value(
        event
            .payload
            .get("origin")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
    )
    .map_err(|source| ProjectionError::Payload {
        kind: event.kind.clone(),
        source,
    })?;
    if origin.is_some_and(|origin| origin.source_seq != 0 || origin.surface_id == game) {
        return Err(ProjectionError::Payload {
            kind: event.kind.clone(),
            source: serde::de::Error::custom("invalid GameCreated origin topic"),
        });
    }
    Ok(origin)
}

pub(super) async fn fence_rebuild(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    events: &[eventstore::StoredEvent],
) -> Result<(), ProjectionError> {
    if let Some(created) = events.iter().find(|event| event.kind == "GameCreated") {
        if let Some(origin) = creation_origin(created, game)? {
            lock_attention(tx, origin.surface_id).await?;
        }
    }
    Ok(())
}

pub(super) async fn clear_origin_attention(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    events: &[eventstore::StoredEvent],
) -> Result<(), ProjectionError> {
    // Canonical event identity works even if the reverse projection is missing.
    if let Some(created) = events.iter().find(|event| event.kind == "GameCreated") {
        if let Some(origin) = creation_origin(created, game)? {
            sqlx::query("DELETE FROM member_inbox_item WHERE surface_id = $1 AND source_seq = $2 AND reason = 'game_spawned_from_watched_topic'")
                .bind(origin.surface_id).bind(created.seq).execute(&mut **tx).await?;
        }
    }
    Ok(())
}

pub(super) async fn publish_origin(
    tx: &mut Transaction<'_, Postgres>,
    game: Uuid,
    started_seq: i64,
    at: i64,
) -> Result<(), ProjectionError> {
    let topic: Option<Uuid> =
        sqlx::query_scalar("SELECT topic_id FROM discussion_topic_spawned_game WHERE game_id = $1")
            .bind(game)
            .fetch_optional(&mut **tx)
            .await?;
    let Some(topic) = topic else {
        return Ok(());
    };
    lock_attention(tx, topic).await?;
    sqlx::query("UPDATE discussion_topic_spawned_game SET started_seq = COALESCE(started_seq, $2), started_at = COALESCE(started_at, $3) WHERE game_id = $1")
        .bind(game).bind(started_seq).bind(at).execute(&mut **tx).await?;
    reconcile_attention(tx, topic, None).await
}

/// Requires the origin attention gate. Replace derived recipients in both
/// directions: a lower-sequence watch change may commit after the start event,
/// so insertion-only fanout cannot converge for unsubscribe races.
pub(super) async fn reconcile_attention(
    tx: &mut Transaction<'_, Postgres>,
    topic: Uuid,
    subscription: Option<Uuid>,
) -> Result<(), ProjectionError> {
    sqlx::query(r#"DELETE FROM member_inbox_item AS item
        WHERE item.surface_id = $1 AND item.reason = 'game_spawned_from_watched_topic'
          AND ($2::uuid IS NULL OR item.principal_id = (SELECT principal_id FROM public_watch WHERE subscription_id = $2))"#)
        .bind(topic).bind(subscription).execute(&mut **tx).await?;
    sqlx::query(r#"
        INSERT INTO member_inbox_item (principal_id, surface_id, source_seq, delivery_seq, reason, occurred_at)
        SELECT watch.principal_id, origin.topic_id, origin.created_seq, origin.started_seq,
               'game_spawned_from_watched_topic', origin.started_at
        FROM discussion_topic_spawned_game AS origin
        JOIN public_watch AS watch ON watch.surface_id = origin.topic_id
        JOIN public_watch_period AS period ON period.subscription_id = watch.subscription_id
          AND period.started_seq < origin.started_seq
          AND (period.ended_seq IS NULL OR period.ended_seq > origin.started_seq)
        WHERE origin.topic_id = $1
          AND ($2::uuid IS NULL OR watch.subscription_id = $2)
          AND origin.started_seq IS NOT NULL AND watch.principal_id <> origin.host_principal_id
        ON CONFLICT (principal_id, surface_id, source_seq, reason) DO NOTHING
    "#).bind(topic).bind(subscription).execute(&mut **tx).await?;
    Ok(())
}

pub(super) async fn reconcile_subscription(
    tx: &mut Transaction<'_, Postgres>,
    subscription: Uuid,
) -> Result<(), ProjectionError> {
    let topic: Uuid =
        sqlx::query_scalar("SELECT surface_id FROM public_watch WHERE subscription_id = $1")
            .bind(subscription)
            .fetch_one(&mut **tx)
            .await?;
    lock_attention(tx, topic).await?;
    reconcile_attention(tx, topic, Some(subscription)).await
}

#[cfg(test)]
mod tests;
