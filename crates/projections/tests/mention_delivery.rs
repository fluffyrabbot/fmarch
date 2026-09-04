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
    advance_member_inbox_read_cursor, advance_subscription_read_cursor,
    append_discussion_and_project, discussion_posts, mute_public_profile, public_inbox,
    rebuild_discussion_stream, subscribe_to_public_target,
};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileEdit, ProfileHandle, ProfileId,
    ProfilePresentation, ProfileRevision, ProfileVisibility,
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

async fn hide_post(pool: &sqlx::PgPool, topic: Uuid, source_seq: i64, moderator: PrincipalId) {
    sqlx::query(
        r#"
        INSERT INTO moderation_target_state (
            surface_id, source_seq, visibility, reason,
            moderator_principal_id, updated_seq
        ) VALUES ($1, $2, 'hidden', 'mention_abuse', $3, $2)
        "#,
    )
    .bind(topic)
    .bind(source_seq)
    .bind(moderator.as_uuid())
    .execute(pool)
    .await
    .unwrap();
    set_publication_visible(pool, topic, source_seq, false).await;
}

async fn set_publication_visible(pool: &sqlx::PgPool, topic: Uuid, source_seq: i64, visible: bool) {
    sqlx::query(
        "UPDATE public_publication SET visible = $3 WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(source_seq)
    .bind(visible)
    .execute(pool)
    .await
    .unwrap();
}

/// One mentioning post: `body` addresses `target_profile` over `[0, len)`.
struct MentioningPost<'a> {
    topic: Uuid,
    author: PrincipalId,
    author_profile: Uuid,
    target_profile: Uuid,
    body: &'a str,
    len: usize,
    occurred_at: i64,
}

async fn submit_mentioning_post(pool: &sqlx::PgPool, post: MentioningPost<'_>) -> i64 {
    append_discussion_and_project(
        pool,
        post.topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": post.body,
                "author_profile_id": post.author_profile,
                "mentions": [{
                    "profile_id": post.target_profile,
                    "span": { "offset": 0, "len": post.len }
                }]
            }),
            ActorId::Principal(post.author),
            post.occurred_at,
        )],
    )
    .await
    .unwrap()[0]
        .seq
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

    // Two stored rows, one delivered row: the reader is told once, and told
    // the more specific reason.
    let page = public_inbox(&pool, member, None, 10).await.unwrap();
    assert_eq!(page.unread_count, 1);
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].reason, "mention");
    assert!(page.items[0].subscribed);

    advance_subscription_read_cursor(&pool, target, member, mentioning[0].seq, 7)
        .await
        .unwrap();
    let cleared = public_inbox(&pool, member, None, 10).await.unwrap();
    assert_eq!(cleared.unread_count, 0);
    assert!(cleared.items.iter().all(|item| !item.unread));
    assert_eq!(cleared.items[0].reason, "mention");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn mention_read_resolves_a_public_target_and_unlinks_an_unresolvable_one(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(207);
    let topic = Uuid::from_u128(208);
    let author = test_principal(16);
    let mentioned = test_principal(17);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, mentioned).await;
    let author_profile = create_test_profile(&pool, author, "read_author", 1).await;
    let mentioned_profile = create_test_profile(&pool, mentioned, "read_target", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    let seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            topic,
            author,
            author_profile,
            target_profile: mentioned_profile,
            body: "@read_target consider this",
            len: 12,
            occurred_at: 6,
        },
    )
    .await;

    let page = discussion_posts(&pool, topic, None, 10, None)
        .await
        .unwrap();
    let post = page
        .posts
        .iter()
        .find(|post| post.source_seq == seq)
        .unwrap();
    assert_eq!(post.mentions.len(), 1);
    assert_eq!(post.mentions[0].offset, 0);
    assert_eq!(post.mentions[0].len, 12);
    let profile = post.mentions[0].profile.as_ref().unwrap();
    assert_eq!(profile.handle, "read_target");
    assert_eq!(profile.profile_id, mentioned_profile);

    // Going private removes the public row, which is the only thing the read
    // resolves through. The span survives; the link does not.
    profile_application::update_profile(
        &pool,
        ProfileId::from_uuid(mentioned_profile),
        mentioned,
        ProfileRevision::new(1),
        ProfileEdit::new(
            ProfileDisplayName::new("read_target").unwrap(),
            ProfileBio::new("mention proofs").unwrap(),
            ProfileVisibility::Private,
        ),
        7,
    )
    .await
    .unwrap();

    let page = discussion_posts(&pool, topic, None, 10, None)
        .await
        .unwrap();
    let post = page
        .posts
        .iter()
        .find(|post| post.source_seq == seq)
        .unwrap();
    assert_eq!(post.mentions.len(), 1);
    assert_eq!(post.mentions[0].offset, 0);
    assert_eq!(post.mentions[0].len, 12);
    assert!(post.mentions[0].profile.is_none());
    // The stored edge is untouched: only the read collapsed.
    let stored: serde_json::Value = sqlx::query_scalar(
        "SELECT mentions FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        stored[0]["profile_id"],
        serde_json::json!(mentioned_profile)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn muting_the_author_suppresses_a_mention_row_without_changing_the_write(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(209);
    let topic = Uuid::from_u128(210);
    let author = test_principal(18);
    let mentioned = test_principal(19);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, mentioned).await;
    let author_profile = create_test_profile(&pool, author, "muted_author", 1).await;
    let mentioned_profile = create_test_profile(&pool, mentioned, "muting_reader", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    mute_public_profile(&pool, mentioned, "muted_author", 4)
        .await
        .unwrap();

    let seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            topic,
            author,
            author_profile,
            target_profile: mentioned_profile,
            body: "@muting_reader look",
            len: 14,
            occurred_at: 6,
        },
    )
    .await;

    // Mute is a read overlay, never a write reject: the author's post is
    // written and the delivery row exists, but it does not reach the muter.
    let rows = mention_inbox_rows(&pool, mentioned).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].2, "mention");
    let page = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert_eq!(page.unread_count, 0);
    assert!(page.items.is_empty());
    assert_eq!(seq, rows[0].1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn hiding_the_mentioning_post_suppresses_delivery_and_restoring_reveals_the_same_row(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(211);
    let topic = Uuid::from_u128(212);
    let author = test_principal(20);
    let mentioned = test_principal(21);
    let moderator = test_principal(22);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, mentioned).await;
    ensure_test_principal(&pool, moderator).await;
    let author_profile = create_test_profile(&pool, author, "hidden_author", 1).await;
    let mentioned_profile = create_test_profile(&pool, mentioned, "hidden_reader", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    let seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            topic,
            author,
            author_profile,
            target_profile: mentioned_profile,
            body: "@hidden_reader look",
            len: 14,
            occurred_at: 6,
        },
    )
    .await;

    let before = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert_eq!(before.items.len(), 1);
    assert_eq!(before.unread_count, 1);

    hide_post(&pool, topic, seq, moderator).await;
    let hidden = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert!(hidden.items.is_empty());
    assert_eq!(hidden.unread_count, 0);
    // The immutable reference is untouched by the overlay.
    assert_eq!(mention_inbox_rows(&pool, mentioned).await.len(), 1);

    set_publication_visible(&pool, topic, seq, true).await;
    let restored = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert_eq!(restored.items, before.items);
    assert_eq!(restored.unread_count, 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn inbox_cursor_clears_a_mention_on_an_unwatched_surface_and_must_advance(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(213);
    let topic = Uuid::from_u128(214);
    let author = test_principal(23);
    let mentioned = test_principal(24);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, mentioned).await;
    let author_profile = create_test_profile(&pool, author, "cursor_author", 1).await;
    let mentioned_profile = create_test_profile(&pool, mentioned, "cursor_reader", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    let seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            topic,
            author,
            author_profile,
            target_profile: mentioned_profile,
            body: "@cursor_reader look",
            len: 14,
            occurred_at: 6,
        },
    )
    .await;

    // No watch exists on this surface, so only the principal cursor can clear
    // the row.
    let page = public_inbox(&pool, mentioned, None, 10).await.unwrap();
    assert_eq!(page.unread_count, 1);
    assert!(!page.items[0].subscribed);
    assert_eq!(page.items[0].reason, "mention");

    let cleared = advance_member_inbox_read_cursor(&pool, mentioned, seq, 7)
        .await
        .unwrap();
    assert_eq!(cleared.unread_count, 0);
    assert!(!cleared.items[0].unread);

    assert!(advance_member_inbox_read_cursor(&pool, mentioned, seq, 8)
        .await
        .is_err());
    assert!(advance_member_inbox_read_cursor(&pool, mentioned, 0, 9)
        .await
        .is_err());
    // The rejected advances left the durable cursor exactly where it was.
    let read_through: i64 = sqlx::query_scalar(
        "SELECT read_through_seq FROM member_inbox_cursor WHERE principal_id = $1",
    )
    .bind(mentioned.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(read_through, seq);

    projections::rebuild_member_inbox_cursor_stream(
        &pool,
        attention::inbox_cursor_stream_id(mentioned),
    )
    .await
    .unwrap();
    let rebuilt: i64 = sqlx::query_scalar(
        "SELECT read_through_seq FROM member_inbox_cursor WHERE principal_id = $1",
    )
    .bind(mentioned.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rebuilt, seq);
}
