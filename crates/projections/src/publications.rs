//! Rebuildable public-content bridge. Source aggregates retain their own read
//! models; this module records only material eligible for public engagement.

use sqlx::Row;
use uuid::Uuid;

use crate::ProjectionError;

pub(super) async fn record_forum_surface(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    topic_id: Uuid,
    updated_seq: i64,
) -> Result<(), ProjectionError> {
    let row = sqlx::query(
        r#"
        SELECT topic.title, area.slug, topic.visibility
        FROM discussion_topic AS topic
        JOIN discussion_area AS area ON area.area_id = topic.area_id
        WHERE topic.topic_id = $1
        "#,
    )
    .bind(topic_id)
    .fetch_one(&mut **tx)
    .await?;
    let slug: String = row.get("slug");
    let title: String = row.get("title");
    let visible: bool = row.get::<String, _>("visibility") == "visible";
    record_surface(
        tx,
        topic_id,
        "discussions",
        &title,
        &format!("/discussions/{slug}/t/{topic_id}"),
        visible,
        updated_seq,
    )
    .await
}

pub(super) async fn record_game_surface(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    updated_seq: i64,
) -> Result<(), ProjectionError> {
    let Some(row) = sqlx::query("SELECT pack_key, status FROM game_index WHERE game_id = $1")
        .bind(game_id)
        .fetch_optional(&mut **tx)
        .await?
    else {
        // A game aggregate may be projected without becoming a public game
        // (fixtures, pre-start state, and private-only flows). Its source
        // projection remains valid; it simply has no public surface yet.
        return Ok(());
    };
    let pack_key: String = row.get("pack_key");
    let status: String = row.get("status");
    let visible = matches!(status.as_str(), "active" | "completed");
    record_surface(
        tx,
        game_id,
        "games",
        &format!("{pack_key} game"),
        &format!("/games/{game_id}"),
        visible,
        updated_seq,
    )
    .await
}

pub(super) async fn record_profile_surface(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile_id: Uuid,
    updated_seq: i64,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let Some(row) =
        sqlx::query("SELECT handle, display_name, bio FROM public_profile WHERE profile_id = $1")
            .bind(profile_id)
            .fetch_optional(&mut **tx)
            .await?
    else {
        // Private and redacted profiles have no public materialization at all.
        // Deleting the surface cascades its publications/citations, so a
        // privacy transition cannot leave stale searchable material behind.
        sqlx::query("DELETE FROM publication_surface WHERE surface_id = $1")
            .bind(profile_id)
            .execute(&mut **tx)
            .await?;
        return Ok(());
    };
    let handle: String = row.get("handle");
    let display_name: String = row.get("display_name");
    let bio: String = row.get("bio");
    record_surface(
        tx,
        profile_id,
        "profiles",
        &display_name,
        &format!("/u/{handle}"),
        true,
        updated_seq,
    )
    .await?;
    record_publication(
        tx,
        profile_id,
        updated_seq,
        &format!("{handle} {bio}"),
        "",
        Some(profile_id),
        occurred_at,
    )
    .await
}

pub(super) async fn record_publication(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    surface_id: Uuid,
    source_seq: i64,
    body: &str,
    fragment_prefix: &str,
    author_profile_id: Option<Uuid>,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO public_publication
            (surface_id, source_seq, surface_title, body, href, author_profile_id, occurred_at, visible)
        SELECT $1, $2, surface.title, $3,
               CASE WHEN $4 = '' THEN surface.href ELSE surface.href || $4 || $2::text END,
               $5, $6, TRUE
        FROM publication_surface AS surface WHERE surface.surface_id = $1
        ON CONFLICT (surface_id, source_seq) DO UPDATE
        SET surface_title = EXCLUDED.surface_title, body = EXCLUDED.body, href = EXCLUDED.href,
            author_profile_id = EXCLUDED.author_profile_id,
            occurred_at = EXCLUDED.occurred_at, visible = TRUE
        "#,
    )
    .bind(surface_id)
    .bind(source_seq)
    .bind(body)
    .bind(fragment_prefix)
    .bind(author_profile_id)
    .bind(occurred_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn record_surface(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    surface_id: Uuid,
    search_group: &str,
    title: &str,
    href: &str,
    visible: bool,
    updated_seq: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO publication_surface (surface_id, search_group, title, href, visible, updated_seq)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (surface_id) DO UPDATE
        SET search_group = EXCLUDED.search_group, title = EXCLUDED.title, href = EXCLUDED.href,
            visible = EXCLUDED.visible, updated_seq = EXCLUDED.updated_seq
        "#,
    )
    .bind(surface_id)
    .bind(search_group)
    .bind(title)
    .bind(href)
    .bind(visible)
    .bind(updated_seq)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE public_publication SET surface_title = $2 \
         WHERE surface_id = $1 AND surface_title IS DISTINCT FROM $2",
    )
    .bind(surface_id)
    .bind(title)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Record one public quotation edge only when both endpoints are public. The
/// source write models remain free to hold private same-thread quotations;
/// they simply cannot enter the public engagement graph.
pub(super) async fn record_public_citations(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    quoting_surface_id: Uuid,
    quoting_source_seq: i64,
    quotations: &[content_reference::Quotation],
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    for quotation in quotations {
        sqlx::query(
            r#"
            INSERT INTO public_citation (
                quoted_surface_id, quoted_source_seq,
                quoting_surface_id, quoting_source_seq, occurred_at
            )
            SELECT $1, $2, $3, $4, $5
            WHERE EXISTS (
                SELECT 1 FROM public_publication
                WHERE surface_id = $1 AND source_seq = $2
            )
              AND EXISTS (
                SELECT 1 FROM public_publication
                WHERE surface_id = $3 AND source_seq = $4
            )
            ON CONFLICT DO NOTHING
            "#,
        )
        .bind(quotation.target.scope_id)
        .bind(quotation.target.source_seq)
        .bind(quoting_surface_id)
        .bind(quoting_source_seq)
        .bind(occurred_at)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
