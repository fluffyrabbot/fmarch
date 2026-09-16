//! GlobalMod topic curation folds as filing, not activity.
//!
//! Rename, move, and pin update the topic row and its public surface without
//! touching `updated_seq`, so the area keyset never reorders on curation.
//! Pinned topics lead an area's first page and are absent from cursor pages;
//! a moved topic carries its posts' publication hrefs to the new area; and
//! every fold rebuilds byte-identically from the stream.

use eventstore::{ActorId, EventInput};
use projections::{
    append_discussion_and_project, discussion_area_by_id, discussion_topic_by_id,
    discussion_topics, public_search, rebuild_discussion_stream, PublicSearchFilter,
};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileHandle, ProfilePresentation,
    ProfileVisibility,
};
use sqlx::Row;
use uuid::Uuid;

fn test_principal(value: u128) -> PrincipalId {
    PrincipalId::from_uuid(Uuid::from_u128(value))
}

async fn ensure_test_principal(pool: &sqlx::PgPool, principal_id: PrincipalId) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .unwrap();
}

async fn create_test_profile(pool: &sqlx::PgPool, principal: PrincipalId, handle: &str) -> Uuid {
    let presentation = ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(handle).unwrap(),
        ProfileBio::new("curation proofs").unwrap(),
        ProfileVisibility::Public,
    );
    profile_application::create_profile(pool, principal, presentation, 1)
        .await
        .unwrap()
        .as_uuid()
}

async fn create_area(pool: &sqlx::PgPool, area: Uuid, slug: &str, actor: PrincipalId, at: i64) {
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": slug, "title": slug, "description": "Curation proofs" }),
            ActorId::Principal(actor),
            at,
        )],
    )
    .await
    .unwrap();
}

async fn create_topic(
    pool: &sqlx::PgPool,
    area: Uuid,
    topic: Uuid,
    title: &str,
    author: PrincipalId,
    profile: Uuid,
    at: i64,
) {
    append_discussion_and_project(
        pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": title, "author_profile_id": profile }),
                ActorId::Principal(author),
                at,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": format!("{title} opening"), "author_profile_id": profile }),
                ActorId::Principal(author),
                at + 1,
            ),
        ],
    )
    .await
    .unwrap();
}

async fn curate(
    pool: &sqlx::PgPool,
    topic: Uuid,
    kind: &str,
    payload: serde_json::Value,
    moderator: PrincipalId,
    at: i64,
) {
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            kind,
            1,
            payload,
            ActorId::Principal(moderator),
            at,
        )],
    )
    .await
    .unwrap();
}

async fn topic_ids(pool: &sqlx::PgPool, area: Uuid, cursor: Option<projections::DiscussionTopicCursor>, limit: i64) -> (Vec<Uuid>, Option<projections::DiscussionTopicCursor>) {
    let page = discussion_topics(pool, area, cursor, limit, None).await.unwrap();
    (page.topics.iter().map(|topic| topic.topic_id).collect(), page.next_cursor)
}

async fn surface_snapshot(pool: &sqlx::PgPool, topic: Uuid) -> serde_json::Value {
    let surface = sqlx::query(
        "SELECT title, href, visible, updated_seq FROM publication_surface WHERE surface_id = $1",
    )
    .bind(topic)
    .fetch_one(pool)
    .await
    .unwrap();
    let publications = sqlx::query(
        "SELECT source_seq, href FROM public_publication WHERE surface_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| serde_json::json!({ "source_seq": row.get::<i64, _>("source_seq"), "href": row.get::<String, _>("href") }))
    .collect::<Vec<_>>();
    let documents = sqlx::query(
        "SELECT source_seq, title_text, href, updated_seq FROM public_search_document WHERE surface_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        serde_json::json!({
            "source_seq": row.get::<i64, _>("source_seq"),
            "title_text": row.get::<String, _>("title_text"),
            "href": row.get::<String, _>("href"),
            "updated_seq": row.get::<i64, _>("updated_seq"),
        })
    })
    .collect::<Vec<_>>();
    let topic_row = discussion_topic_by_id(pool, topic).await.unwrap().unwrap();
    serde_json::json!({
        "surface": {
            "title": surface.get::<String, _>("title"),
            "href": surface.get::<String, _>("href"),
            "visible": surface.get::<bool, _>("visible"),
            "updated_seq": surface.get::<i64, _>("updated_seq"),
        },
        "publications": publications,
        "documents": documents,
        "topic": {
            "title": topic_row.title,
            "area_id": topic_row.area_id,
            "pinned": topic_row.pinned,
            "updated_seq": topic_row.updated_seq,
            "version": topic_row.version,
        },
    })
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn pinned_topics_lead_the_first_page_and_stay_out_of_cursor_pages(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(401);
    let author = test_principal(41);
    let moderator = test_principal(42);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, moderator).await;
    let profile = create_test_profile(&pool, author, "curation_author").await;
    create_area(&pool, area, "curation", author, 2).await;
    let topics: Vec<Uuid> = (0..5).map(|index| Uuid::from_u128(410 + index)).collect();
    for (index, topic) in topics.iter().enumerate() {
        create_topic(&pool, area, *topic, &format!("Topic {index}"), author, profile, 10 + index as i64 * 2).await;
    }
    // Newest first before any curation: 4, 3, 2, 1, 0.
    let (first, cursor) = topic_ids(&pool, area, None, 2).await;
    assert_eq!(first, vec![topics[4], topics[3]]);
    let (second, _) = topic_ids(&pool, area, cursor, 2).await;
    assert_eq!(second, vec![topics[2], topics[1]]);

    let before = discussion_topic_by_id(&pool, topics[1]).await.unwrap().unwrap();
    curate(&pool, topics[1], "DiscussionTopicPinnedChanged", serde_json::json!({ "pinned": true }), moderator, 30).await;
    curate(&pool, topics[0], "DiscussionTopicPinnedChanged", serde_json::json!({ "pinned": true }), moderator, 31).await;
    let after = discussion_topic_by_id(&pool, topics[1]).await.unwrap().unwrap();
    assert!(after.pinned);
    assert_eq!(after.updated_seq, before.updated_seq, "pinning is not activity");
    assert_eq!(after.version, before.version + 1);

    // Pinned lead the first page in their own newest-first order, ahead of
    // the unpinned keyset page, which is still `limit` long.
    let (first, cursor) = topic_ids(&pool, area, None, 2).await;
    assert_eq!(first, vec![topics[1], topics[0], topics[4], topics[3]]);
    let cursor = cursor.expect("more unpinned topics remain");
    let (second, cursor) = topic_ids(&pool, area, Some(cursor), 2).await;
    assert_eq!(second, vec![topics[2]], "cursor pages skip pinned topics");
    assert!(cursor.is_none());

    curate(&pool, topics[1], "DiscussionTopicPinnedChanged", serde_json::json!({ "pinned": false }), moderator, 32).await;
    let (first, _) = topic_ids(&pool, area, None, 5).await;
    assert_eq!(first, vec![topics[0], topics[4], topics[3], topics[2], topics[1]]);

    let snapshot = surface_snapshot(&pool, topics[1]).await;
    rebuild_discussion_stream(&pool, topics[1]).await.unwrap();
    assert_eq!(surface_snapshot(&pool, topics[1]).await, snapshot);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn rename_and_move_refile_the_surface_without_reordering_the_area(pool: sqlx::PgPool) {
    let general = Uuid::from_u128(402);
    let archive = Uuid::from_u128(403);
    let author = test_principal(43);
    let moderator = test_principal(44);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, moderator).await;
    let profile = create_test_profile(&pool, author, "refile_author").await;
    create_area(&pool, general, "general", author, 2).await;
    create_area(&pool, archive, "archive", author, 3).await;
    let topic = Uuid::from_u128(420);
    let sibling = Uuid::from_u128(421);
    create_topic(&pool, general, topic, "Lantern policy", author, profile, 10).await;
    create_topic(&pool, general, sibling, "Ballot policy", author, profile, 20).await;
    let before = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    let post_seq = before.last_post_seq.unwrap();

    curate(&pool, topic, "DiscussionTopicRenamed", serde_json::json!({ "title": "Lantern policy (archived)" }), moderator, 30).await;
    let renamed = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(renamed.title, "Lantern policy (archived)");
    assert_eq!(renamed.updated_seq, before.updated_seq, "rename is not activity");
    let (order, _) = topic_ids(&pool, general, None, 10).await;
    assert_eq!(order, vec![sibling, topic]);
    let surface_title: String =
        sqlx::query_scalar("SELECT title FROM publication_surface WHERE surface_id = $1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(surface_title, "Lantern policy (archived)");
    let archived = public_search(&pool, "archived", PublicSearchFilter::All, None, 10, None)
        .await
        .unwrap();
    assert!(archived.results.iter().any(|row| row.title == "Lantern policy (archived)"));

    curate(&pool, topic, "DiscussionTopicMoved", serde_json::json!({ "area_id": archive }), moderator, 31).await;
    let moved = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(moved.area_id, archive);
    assert_eq!(moved.updated_seq, before.updated_seq, "move is not activity");
    assert_eq!(
        discussion_area_by_id(&pool, moved.area_id).await.unwrap().unwrap().slug,
        "archive"
    );
    let (general_order, _) = topic_ids(&pool, general, None, 10).await;
    assert_eq!(general_order, vec![sibling]);
    let (archive_order, _) = topic_ids(&pool, archive, None, 10).await;
    assert_eq!(archive_order, vec![topic]);

    // The surface and every post link follow the topic to its new area.
    let expected_href = format!("/discussions/archive/t/{topic}");
    let surface_href: String =
        sqlx::query_scalar("SELECT href FROM publication_surface WHERE surface_id = $1")
            .bind(topic)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(surface_href, expected_href);
    let post_href: String = sqlx::query_scalar(
        "SELECT href FROM public_publication WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(post_seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(post_href, format!("{expected_href}#post-{post_seq}"));
    let document_hrefs: Vec<String> = sqlx::query_scalar(
        "SELECT href FROM public_search_document WHERE surface_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        document_hrefs,
        vec![expected_href.clone(), format!("{expected_href}#post-{post_seq}")]
    );

    let snapshot = surface_snapshot(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(surface_snapshot(&pool, topic).await, snapshot);
}
