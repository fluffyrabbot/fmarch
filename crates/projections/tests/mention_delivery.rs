//! First-class community mentions fan out into the reason-derived inbox.
//!
//! Mirrors `quotation_citation.rs`: decided `ProfileMention` values on a
//! discussion post resolve to the addressed profile's active principal and
//! land as `reason = 'mention'` inbox rows, while the edge itself is stored
//! as jsonb on the post row. Publicity is decided at write time; the fold
//! resolves identity only.

use attention::WatchTarget;
use eventstore::{ActorId, EventInput};
use projections::{
    advance_subscription_read_cursor, append_discussion_and_project, public_inbox,
    rebuild_discussion_stream, subscribe_to_public_target,
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

async fn create_test_profile(
    pool: &sqlx::PgPool,
    principal: PrincipalId,
    handle: &str,
    occurred_at: i64,
) -> Uuid {
    let presentation = ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(handle).unwrap(),
        ProfileBio::new("mention proofs").unwrap(),
        ProfileVisibility::Public,
    );
    profile_application::create_profile(pool, principal, presentation, occurred_at)
        .await
        .unwrap()
        .as_uuid()
}

async fn create_topic_with_opening_post(
    pool: &sqlx::PgPool,
    area: Uuid,
    topic: Uuid,
    author: PrincipalId,
    profile: Uuid,
    occurred_at: i64,
) {
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "mentions", "title": "Mentions", "description": "Mention proofs" }),
            ActorId::Principal(author),
            occurred_at,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Addressed claims", "author_profile_id": profile }),
                ActorId::Principal(author),
                occurred_at + 1,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Opening claim", "author_profile_id": profile }),
                ActorId::Principal(author),
                occurred_at + 2,
            ),
        ],
    )
    .await
    .unwrap();
}

async fn mention_inbox_rows(
    pool: &sqlx::PgPool,
    principal: PrincipalId,
) -> Vec<(Uuid, i64, String, i64)> {
    sqlx::query(
        r#"
        SELECT surface_id, source_seq, reason, occurred_at
        FROM member_inbox_item
        WHERE principal_id = $1
        ORDER BY surface_id, source_seq, reason
        "#,
    )
    .bind(principal.as_uuid())
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<Uuid, _>("surface_id"),
            row.get::<i64, _>("source_seq"),
            row.get::<String, _>("reason"),
            row.get::<i64, _>("occurred_at"),
        )
    })
    .collect()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn profile_mention_delivers_to_non_watcher_and_rebuilds_identically(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(201);
    let topic = Uuid::from_u128(202);
    let author = test_principal(11);
    let mentioned = test_principal(12);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, mentioned).await;
    let author_profile = create_test_profile(&pool, author, "mention_author", 1).await;
    let mentioned_profile = create_test_profile(&pool, mentioned, "mention_target", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;

    let mentioning = append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "@mention_target consider this",
                "author_profile_id": author_profile,
                "mentions": [{ "profile_id": mentioned_profile, "span": { "offset": 0, "len": 15 } }]
            }),
            ActorId::Principal(author),
            6,
        )],
    )
    .await
    .unwrap();

    let rows = mention_inbox_rows(&pool, mentioned).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, topic);
    assert_eq!(rows[0].1, mentioning[0].seq);
    assert_eq!(rows[0].2, "mention");
    assert_eq!(rows[0].3, 6);

    let stored_json: serde_json::Value = sqlx::query_scalar(
        "SELECT mentions FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(mentioning[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored_json[0]["span"],
        serde_json::json!({ "offset": 0, "len": 15 })
    );
    assert_eq!(
        stored_json[0]["profile_id"],
        serde_json::json!(mentioned_profile),
    );

    let page = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert_eq!(page.unread_count, 1);
    assert_eq!(page.items.len(), 1);
    assert!(page.items[0].unread);

    let opening_events = eventstore::load_stream(&pool, topic).await.unwrap();
    let opening_post = opening_events
        .iter()
        .find(|event| {
            event.kind == "DiscussionPostSubmitted" && event.payload["body"] == "Opening claim"
        })
        .unwrap();
    assert!(opening_post.payload.get("mentions").is_none());

    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(mention_inbox_rows(&pool, mentioned).await, rows);
    let rebuilt_json: serde_json::Value = sqlx::query_scalar(
        "SELECT mentions FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(mentioning[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(stored_json, rebuilt_json);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn self_mention_is_accepted_and_delivers_nothing(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(203);
    let topic = Uuid::from_u128(204);
    let author = test_principal(13);
    ensure_test_principal(&pool, author).await;
    let author_profile = create_test_profile(&pool, author, "self_mentioner", 1).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 2).await;

    let mentioning = append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "@self_mentioner note to self",
                "author_profile_id": author_profile,
                "mentions": [{ "profile_id": author_profile, "span": { "offset": 0, "len": 15 } }]
            }),
            ActorId::Principal(author),
            5,
        )],
    )
    .await
    .unwrap();

    assert!(mention_inbox_rows(&pool, author).await.is_empty());
    let stored_json: serde_json::Value = sqlx::query_scalar(
        "SELECT mentions FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(mentioning[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored_json[0]["span"],
        serde_json::json!({ "offset": 0, "len": 15 })
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn watch_and_mention_rows_coexist_and_clear_together(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(205);
    let topic = Uuid::from_u128(206);
    let author = test_principal(14);
    let member = test_principal(15);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, member).await;
    let author_profile = create_test_profile(&pool, author, "coexist_author", 1).await;
    let member_profile = create_test_profile(&pool, member, "coexist_member", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;

    let target = WatchTarget { surface_id: topic };
    let watcher = subscribe_to_public_target(&pool, target.clone(), member, 4)
        .await
        .unwrap();
    assert!(watcher.subscribed);

    let mentioning = append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "@coexist_member see this",
                "author_profile_id": author_profile,
                "mentions": [{ "profile_id": member_profile, "span": { "offset": 0, "len": 16 } }]
            }),
            ActorId::Principal(author),
            6,
        )],
    )
    .await
    .unwrap();

    let rows = mention_inbox_rows(&pool, member).await;
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .any(|row| row.2 == "watch" && row.1 == mentioning[0].seq));
    assert!(rows
        .iter()
        .any(|row| row.2 == "mention" && row.1 == mentioning[0].seq));

    let page = public_inbox(&pool, member, None, 10).await.unwrap();
    assert_eq!(page.unread_count, 2);

    advance_subscription_read_cursor(&pool, target, member, mentioning[0].seq, 7)
        .await
        .unwrap();
    let cleared = public_inbox(&pool, member, None, 10).await.unwrap();
    assert_eq!(cleared.unread_count, 0);
    assert!(cleared.items.iter().all(|item| !item.unread));
}
