//! Forum post edits and author retractions fold as overlays on the post row.
//!
//! An edit moves the live row to the next revision, appends the superseded
//! content to `discussion_post_revision`, reindexes search, delivers newly
//! addressed mentions, and never notifies watchers or reorders the topic. A
//! retraction withholds the content at read time, drops the search document,
//! and leaves the publication row so cited excerpts keep their target. Both
//! rebuild byte-identically from the stream.

use attention::WatchTarget;
use eventstore::{ActorId, EventInput};
use projections::{
    append_discussion_and_project, discussion_post_write_state, discussion_posts,
    discussion_topic_by_id, public_inbox, public_search, quotation_thread_for_discussion,
    rebuild_discussion_stream, subscribe_to_public_target, visible_public_incoming_citations,
    PublicSearchFilter,
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
        ProfileBio::new("editing proofs").unwrap(),
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
) -> i64 {
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "editing", "title": "Editing", "description": "Editing proofs" }),
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
                serde_json::json!({ "area_id": area, "title": "Revisable claims", "author_profile_id": profile }),
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
    .unwrap()[1]
        .seq
}

async fn submit_post(
    pool: &sqlx::PgPool,
    topic: Uuid,
    author: PrincipalId,
    profile: Uuid,
    payload: serde_json::Value,
    occurred_at: i64,
) -> i64 {
    let mut payload = payload;
    payload["author_profile_id"] = serde_json::json!(profile);
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            payload,
            ActorId::Principal(author),
            occurred_at,
        )],
    )
    .await
    .unwrap()[0]
        .seq
}

async fn edit_post(
    pool: &sqlx::PgPool,
    topic: Uuid,
    author: PrincipalId,
    payload: serde_json::Value,
    occurred_at: i64,
) -> i64 {
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            "DiscussionPostEdited",
            1,
            payload,
            ActorId::Principal(author),
            occurred_at,
        )],
    )
    .await
    .unwrap()[0]
        .seq
}

async fn retract_post(
    pool: &sqlx::PgPool,
    topic: Uuid,
    author: PrincipalId,
    source_seq: i64,
    occurred_at: i64,
) -> i64 {
    append_discussion_and_project(
        pool,
        topic,
        &[EventInput::new(
            "DiscussionPostRetracted",
            1,
            serde_json::json!({ "source_seq": source_seq }),
            ActorId::Principal(author),
            occurred_at,
        )],
    )
    .await
    .unwrap()[0]
        .seq
}

async fn inbox_rows(pool: &sqlx::PgPool, principal: PrincipalId) -> Vec<(i64, String, i64)> {
    sqlx::query(
        "SELECT source_seq, reason, occurred_at FROM member_inbox_item WHERE principal_id = $1 ORDER BY source_seq, reason",
    )
    .bind(principal.as_uuid())
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<i64, _>("source_seq"),
            row.get::<String, _>("reason"),
            row.get::<i64, _>("occurred_at"),
        )
    })
    .collect()
}

async fn revision_rows(pool: &sqlx::PgPool, source_seq: i64) -> Vec<(i64, String, i64, i64)> {
    sqlx::query(
        "SELECT revision, body, superseded_seq, superseded_at FROM discussion_post_revision WHERE source_seq = $1 ORDER BY revision",
    )
    .bind(source_seq)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<i64, _>("revision"),
            row.get::<String, _>("body"),
            row.get::<i64, _>("superseded_seq"),
            row.get::<i64, _>("superseded_at"),
        )
    })
    .collect()
}

async fn search_document_bodies(pool: &sqlx::PgPool, topic: Uuid, source_seq: i64) -> Vec<(String, i64)> {
    sqlx::query(
        "SELECT body, updated_seq FROM public_search_document WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(source_seq)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.get::<String, _>("body"), row.get::<i64, _>("updated_seq")))
    .collect()
}

/// Every projected fact about one topic that an edit or retraction touches,
/// in a shape that can be compared before and after a rebuild.
async fn topic_snapshot(pool: &sqlx::PgPool, topic: Uuid) -> serde_json::Value {
    let posts = sqlx::query(
        "SELECT source_seq, body, mentions, revision, edited_at, retracted_at FROM discussion_post WHERE topic_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        serde_json::json!({
            "source_seq": row.get::<i64, _>("source_seq"),
            "body": row.get::<String, _>("body"),
            "mentions": row.get::<serde_json::Value, _>("mentions"),
            "revision": row.get::<i64, _>("revision"),
            "edited_at": row.get::<Option<i64>, _>("edited_at"),
            "retracted_at": row.get::<Option<i64>, _>("retracted_at"),
        })
    })
    .collect::<Vec<_>>();
    let revisions = sqlx::query(
        "SELECT revision.source_seq, revision.revision, revision.body, revision.mentions, revision.superseded_seq, revision.superseded_at FROM discussion_post_revision AS revision JOIN discussion_post AS post ON post.source_seq = revision.source_seq WHERE post.topic_id = $1 ORDER BY revision.source_seq, revision.revision",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        serde_json::json!({
            "source_seq": row.get::<i64, _>("source_seq"),
            "revision": row.get::<i64, _>("revision"),
            "body": row.get::<String, _>("body"),
            "mentions": row.get::<serde_json::Value, _>("mentions"),
            "superseded_seq": row.get::<i64, _>("superseded_seq"),
            "superseded_at": row.get::<i64, _>("superseded_at"),
        })
    })
    .collect::<Vec<_>>();
    let search = sqlx::query(
        "SELECT source_seq, body, updated_seq, visible FROM public_search_document WHERE surface_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        serde_json::json!({
            "source_seq": row.get::<i64, _>("source_seq"),
            "body": row.get::<String, _>("body"),
            "updated_seq": row.get::<i64, _>("updated_seq"),
            "visible": row.get::<bool, _>("visible"),
        })
    })
    .collect::<Vec<_>>();
    let publications = sqlx::query(
        "SELECT source_seq, body, visible FROM public_publication WHERE surface_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        serde_json::json!({
            "source_seq": row.get::<i64, _>("source_seq"),
            "body": row.get::<String, _>("body"),
            "visible": row.get::<bool, _>("visible"),
        })
    })
    .collect::<Vec<_>>();
    let topic_row = discussion_topic_by_id(pool, topic).await.unwrap().unwrap();
    serde_json::json!({
        "posts": posts,
        "revisions": revisions,
        "search": search,
        "publications": publications,
        "topic": {
            "title": topic_row.title,
            "updated_seq": topic_row.updated_seq,
            "post_count": topic_row.post_count,
            "version": topic_row.version,
            "last_post_seq": topic_row.last_post_seq,
        },
    })
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn invalid_forum_batches_do_not_append_or_project_even_if_caller_commits(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(340);
    let topic = Uuid::from_u128(341);
    let author = test_principal(40);
    ensure_test_principal(&pool, author).await;
    let profile = create_test_profile(&pool, author, "codec_author", 1).await;
    let post = create_topic_with_opening_post(&pool, area, topic, author, profile, 2).await;
    let before = topic_snapshot(&pool, topic).await;
    let stream_before = eventstore::load_stream(&pool, topic).await.unwrap();
    let expected_version = stream_before.last().unwrap().stream_seq;

    for (kind, version, payload) in [
        ("DiscussionUnknownFact", 1, serde_json::json!({})),
        (
            "DiscussionTopicRenamed",
            2,
            serde_json::json!({ "title": "Future shape" }),
        ),
        (
            "DiscussionPostEdited",
            1,
            serde_json::json!({ "source_seq": post, "body": "Truncated revision", "revision": u64::MAX }),
        ),
        (
            "DiscussionTopicPinnedChanged",
            1,
            serde_json::json!({ "pinned": "true" }),
        ),
    ] {
        let events = [
            EventInput::new(
                "DiscussionTopicRenamed",
                1,
                serde_json::json!({ "title": "Must not persist" }),
                ActorId::Principal(author),
                5,
            ),
            EventInput::new(kind, version, payload, ActorId::Principal(author), 6),
        ];
        // Complete preflight matters for externally owned transactions: a
        // caller retaining its other work must not commit a partial batch.
        let mut tx = pool.begin().await.unwrap();
        let result =
            projections::append_discussion_and_project_in_tx(&mut tx, topic, &events).await;
        assert!(matches!(
            result,
            Err(projections::ProjectionError::ForumCodec(_))
        ));
        tx.commit().await.unwrap();

        let result = append_discussion_and_project(&pool, topic, &events).await;
        assert!(matches!(
            result,
            Err(projections::ProjectionError::ForumCodec(_))
        ));
        let result = projections::append_discussion_and_project_expected(
            &pool,
            topic,
            expected_version,
            &events,
        )
        .await;
        assert!(matches!(
            result,
            Err(projections::ProjectionError::ForumCodec(_))
        ));

        assert_eq!(
            eventstore::load_stream(&pool, topic).await.unwrap(),
            stream_before
        );
        assert_eq!(topic_snapshot(&pool, topic).await, before);
    }
}

/// Full rows for every projection an edit can affect, including publication
/// metadata and attention delivery fields added by independently owned areas.
async fn append_transaction_snapshot(pool: &sqlx::PgPool, topics: &[Uuid]) -> serde_json::Value {
    let mut snapshot = serde_json::Map::new();
    for (table, scope) in [
        ("discussion_topic", "topic_id = ANY($1)"),
        ("discussion_post", "topic_id = ANY($1)"),
        (
            "discussion_post_revision",
            "source_seq IN (SELECT source_seq FROM discussion_post WHERE topic_id = ANY($1))",
        ),
        ("publication_surface", "surface_id = ANY($1)"),
        ("public_publication", "surface_id = ANY($1)"),
        ("public_search_document", "surface_id = ANY($1)"),
        ("member_inbox_item", "surface_id = ANY($1)"),
    ] {
        let query = format!("SELECT COALESCE(jsonb_agg(to_jsonb(entry) ORDER BY to_jsonb(entry)::text), '[]'::jsonb) FROM {table} AS entry WHERE {scope}");
        // Identifiers and predicates come only from the fixed list above;
        // topic values remain bound parameters.
        let rows: serde_json::Value = sqlx::query_scalar(sqlx::AssertSqlSafe(query))
            .bind(topics)
            .fetch_one(pool)
            .await
            .unwrap();
        snapshot.insert(table.into(), rows);
    }
    snapshot.into()
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn semantic_batch_failure_rolls_back_its_savepoint_before_outer_commit(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(346);
    let topic = Uuid::from_u128(347);
    let other_topic = Uuid::from_u128(348);
    let author = test_principal(42);
    let target = test_principal(43);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, target).await;
    let profile = create_test_profile(&pool, author, "atomic_author", 1).await;
    let target_profile = create_test_profile(&pool, target, "atomic_target", 1).await;
    let own_post = create_topic_with_opening_post(&pool, area, topic, author, profile, 2).await;
    let other_post = append_discussion_and_project(&pool, other_topic, &[
        EventInput::new(forum::TOPIC_CREATED, 1, serde_json::json!({ "area_id": area, "title": "Other", "author_profile_id": profile }), ActorId::Principal(author), 5),
        EventInput::new(forum::POST_SUBMITTED, 1, serde_json::json!({ "body": "Other opening", "author_profile_id": profile }), ActorId::Principal(author), 6),
    ]).await.unwrap()[1].seq;
    sqlx::query("CREATE TABLE discussion_append_marker (label TEXT PRIMARY KEY)")
        .execute(&pool)
        .await
        .unwrap();
    let before = append_transaction_snapshot(&pool, &[topic, other_topic]).await;
    let topic_events = eventstore::load_stream(&pool, topic).await.unwrap();
    let other_events = eventstore::load_stream(&pool, other_topic).await.unwrap();
    let events = [
        EventInput::new(
            forum::POST_EDITED,
            1,
            serde_json::json!({
                "source_seq": own_post, "revision": 1, "body": "@atomic_target replacement",
                "mentions": [{ "profile_id": target_profile, "span": { "offset": 0, "len": 14 } }]
            }),
            ActorId::Principal(author),
            7,
        ),
        EventInput::new(
            forum::POST_EDITED,
            1,
            serde_json::json!({
                "source_seq": other_post, "revision": 1, "body": "Cross-topic replacement"
            }),
            ActorId::Principal(author),
            8,
        ),
    ];
    for event in &events {
        forum::decode_event(&event.kind, event.version, &event.payload).unwrap();
    }
    let mut outer = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO discussion_append_marker VALUES ('before')")
        .execute(&mut *outer)
        .await
        .unwrap();
    let result = projections::append_discussion_and_project_in_tx(&mut outer, topic, &events).await;
    match result {
        Err(projections::ProjectionError::Db(sqlx::Error::Protocol(message))) => {
            assert_eq!(
                message,
                format!("DiscussionPostEdited names post {other_post} outside topic {topic}")
            );
        }
        other => panic!("expected original semantic fold error, got {other:?}"),
    }
    sqlx::query("INSERT INTO discussion_append_marker VALUES ('after')")
        .execute(&mut *outer)
        .await
        .unwrap();
    outer.commit().await.unwrap();
    let markers: Vec<String> =
        sqlx::query_scalar("SELECT label FROM discussion_append_marker ORDER BY label")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(markers, ["after", "before"]);
    assert_eq!(
        eventstore::load_stream(&pool, topic).await.unwrap(),
        topic_events
    );
    assert_eq!(
        eventstore::load_stream(&pool, other_topic).await.unwrap(),
        other_events
    );
    assert_eq!(
        append_transaction_snapshot(&pool, &[topic, other_topic]).await,
        before
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn successful_nested_append_remains_owned_by_outer_commit_or_rollback(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(349);
    let topic = Uuid::from_u128(350);
    let author = test_principal(44);
    ensure_test_principal(&pool, author).await;
    let profile = create_test_profile(&pool, author, "nested_author", 1).await;
    let post = create_topic_with_opening_post(&pool, area, topic, author, profile, 2).await;
    let before = append_transaction_snapshot(&pool, &[topic]).await;
    let events_before = eventstore::load_stream(&pool, topic).await.unwrap();
    for commit in [false, true] {
        let mut outer = pool.begin().await.unwrap();
        let stored = projections::append_discussion_and_project_in_tx(
            &mut outer,
            topic,
            &[EventInput::new(
                forum::POST_EDITED,
                1,
                serde_json::json!({ "source_seq": post, "revision": 1, "body": "Nested edit" }),
                ActorId::Principal(author),
                5,
            )],
        )
        .await
        .unwrap();
        assert_eq!(stored.len(), 1);
        let body: String =
            sqlx::query_scalar("SELECT body FROM discussion_post WHERE source_seq = $1")
                .bind(post)
                .fetch_one(&mut *outer)
                .await
                .unwrap();
        assert_eq!(body, "Nested edit");
        // Releasing the savepoint must not make the nested write visible to a
        // separate connection or commit its caller's transaction.
        assert_eq!(append_transaction_snapshot(&pool, &[topic]).await, before);
        assert_eq!(
            eventstore::load_stream(&pool, topic).await.unwrap(),
            events_before
        );
        if commit {
            outer.commit().await.unwrap();
            let mut expected_events = events_before.clone();
            expected_events.extend(stored);
            assert_eq!(
                eventstore::load_stream(&pool, topic).await.unwrap(),
                expected_events
            );
            let state = discussion_post_write_state(&pool, topic, post)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(state.body, "Nested edit");
            assert_eq!(state.revision, 1);
        } else {
            outer.rollback().await.unwrap();
            assert_eq!(append_transaction_snapshot(&pool, &[topic]).await, before);
            assert_eq!(
                eventstore::load_stream(&pool, topic).await.unwrap(),
                events_before
            );
        }
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn unsupported_durable_forum_event_stops_rebuild_without_destroying_projection(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(342);
    let topic = Uuid::from_u128(343);
    let author = test_principal(41);
    ensure_test_principal(&pool, author).await;
    let profile = create_test_profile(&pool, author, "codec_replay", 1).await;
    create_topic_with_opening_post(&pool, area, topic, author, profile, 2).await;
    let before = topic_snapshot(&pool, topic).await;
    // The existing untyped journal admits a future schema. Replay must stop at
    // the forum-owned decoder even though its fields resemble version 1.
    eventstore::append(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionTopicRenamed",
            2,
            serde_json::json!({ "title": "Do not interpret v2 as v1" }),
            ActorId::Principal(author),
            5,
        )],
    )
    .await
    .unwrap();
    let stream_before = eventstore::load_stream(&pool, topic).await.unwrap();
    let result = rebuild_discussion_stream(&pool, topic).await;
    assert!(matches!(
        result,
        Err(projections::ProjectionError::ForumCodec(
            forum::ForumDecodeError::UnsupportedVersion { version: 2, .. }
        ))
    ));
    assert_eq!(topic_snapshot(&pool, topic).await, before);
    assert_eq!(
        eventstore::load_stream(&pool, topic).await.unwrap(),
        stream_before
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn historical_v1_forum_rows_rebuild_without_inventing_authors_or_references(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(344);
    let topic = Uuid::from_u128(345);
    append_discussion_and_project(&pool, area, &[EventInput::new(
        "DiscussionAreaCreated", 1, serde_json::json!({ "slug": "historical", "title": "Historical", "description": "History" }), ActorId::System, 1,
    )]).await.unwrap();
    append_discussion_and_project(&pool, topic, &[
        EventInput::new("DiscussionTopicCreated", 1, serde_json::json!({ "area_id": area, "title": "  Original title  " }), ActorId::System, 2),
        EventInput::new("DiscussionPostSubmitted", 1, serde_json::json!({ "body": "  Original body  ", "quotations": null, "mentions": null }), ActorId::System, 3),
    ]).await.unwrap();
    let before = topic_snapshot(&pool, topic).await;
    rebuild_discussion_stream(&pool, area).await.unwrap();
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(topic_snapshot(&pool, topic).await, before);
    let page = discussion_posts(&pool, topic, None, 10, None)
        .await
        .unwrap();
    assert_eq!(page.posts[0].body, "  Original body  ");
    assert!(page.posts[0].author.is_none());
    assert!(page.posts[0].quotations.is_empty());
    assert!(page.posts[0].mentions.is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn edit_appends_history_reindexes_search_and_never_notifies_watchers(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(301);
    let topic = Uuid::from_u128(302);
    let author = test_principal(21);
    let watcher = test_principal(22);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, watcher).await;
    let author_profile = create_test_profile(&pool, author, "edit_author", 1).await;
    create_test_profile(&pool, watcher, "edit_watcher", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    subscribe_to_public_target(&pool, WatchTarget { surface_id: topic }, watcher, 6)
        .await
        .unwrap();

    let reply = submit_post(
        &pool,
        topic,
        author,
        author_profile,
        serde_json::json!({ "body": "Original wording about lanterns" }),
        7,
    )
    .await;
    let before = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(inbox_rows(&pool, watcher).await, vec![(reply, "watch".to_string(), 7)]);

    let edit_seq = edit_post(
        &pool,
        topic,
        author,
        serde_json::json!({ "source_seq": reply, "body": "Corrected wording about ballots", "revision": 1 }),
        8,
    )
    .await;

    let page = discussion_posts(&pool, topic, None, 10, None).await.unwrap();
    let edited = page
        .posts
        .iter()
        .find(|post| post.source_seq == reply)
        .unwrap();
    assert_eq!(edited.body, "Corrected wording about ballots");
    assert_eq!(edited.revision, 1);
    assert_eq!(edited.edited_at, Some(8));
    assert!(!edited.retracted);
    let opening = &page.posts[0];
    assert_eq!(opening.revision, 0);
    assert_eq!(opening.edited_at, None);

    // The superseded text is history, never rewritten.
    assert_eq!(
        revision_rows(&pool, reply).await,
        vec![(0, "Original wording about lanterns".to_string(), edit_seq, 8)]
    );

    // Search reads the current body under the edit's cursor position.
    assert_eq!(
        search_document_bodies(&pool, topic, reply).await,
        vec![("Corrected wording about ballots".to_string(), edit_seq)]
    );
    let lanterns = public_search(&pool, "lanterns", PublicSearchFilter::All, None, 10, None)
        .await
        .unwrap();
    assert!(lanterns.results.is_empty(), "the superseded body must leave search");
    let ballots = public_search(&pool, "ballots", PublicSearchFilter::All, None, 10, None)
        .await
        .unwrap();
    assert_eq!(ballots.results.len(), 1);

    // Edits are not activity: no watch delivery, no topic reorder, no new post.
    assert_eq!(inbox_rows(&pool, watcher).await, vec![(reply, "watch".to_string(), 7)]);
    let after = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(after.updated_seq, before.updated_seq);
    assert_eq!(after.post_count, before.post_count);
    assert_eq!(after.last_post_seq, before.last_post_seq);
    assert_eq!(after.version, before.version + 1, "the stream version still advances");

    // The write state the API hands to decide_topic reflects the new revision.
    let state = discussion_post_write_state(&pool, topic, reply)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.revision, 1);
    assert_eq!(state.body, "Corrected wording about ballots");
    assert_eq!(state.author_profile_id, Some(author_profile));
    assert!(!state.retracted);
    assert!(!state.has_quotations);
    assert!(discussion_post_write_state(&pool, topic, reply + 1000)
        .await
        .unwrap()
        .is_none());

    let snapshot = topic_snapshot(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(topic_snapshot(&pool, topic).await, snapshot);
    assert_eq!(inbox_rows(&pool, watcher).await, vec![(reply, "watch".to_string(), 7)]);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn edit_delivers_added_mentions_and_keeps_removed_ones_delivered(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(303);
    let topic = Uuid::from_u128(304);
    let author = test_principal(23);
    let first = test_principal(24);
    let second = test_principal(25);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, first).await;
    ensure_test_principal(&pool, second).await;
    let author_profile = create_test_profile(&pool, author, "mention_editor", 1).await;
    let first_profile = create_test_profile(&pool, first, "first_target", 2).await;
    let second_profile = create_test_profile(&pool, second, "second_target", 3).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 4).await;

    let reply = submit_post(
        &pool,
        topic,
        author,
        author_profile,
        serde_json::json!({
            "body": "@first_target look",
            "mentions": [{ "profile_id": first_profile, "span": { "offset": 0, "len": 13 } }]
        }),
        7,
    )
    .await;
    assert_eq!(inbox_rows(&pool, first).await, vec![(reply, "mention".to_string(), 7)]);
    assert!(inbox_rows(&pool, second).await.is_empty());

    edit_post(
        &pool,
        topic,
        author,
        serde_json::json!({
            "source_seq": reply,
            "body": "@second_target look",
            "revision": 1,
            "mentions": [{ "profile_id": second_profile, "span": { "offset": 0, "len": 14 } }]
        }),
        8,
    )
    .await;

    // The newly addressed profile is told; the one the edit dropped is not
    // untold. The edge on the post, however, is the current decision only.
    assert_eq!(inbox_rows(&pool, second).await, vec![(reply, "mention".to_string(), 8)]);
    assert_eq!(inbox_rows(&pool, first).await, vec![(reply, "mention".to_string(), 7)]);
    let page = discussion_posts(&pool, topic, None, 10, None).await.unwrap();
    let edited = page.posts.iter().find(|post| post.source_seq == reply).unwrap();
    assert_eq!(edited.mentions.len(), 1);
    assert_eq!(
        edited.mentions[0].profile.as_ref().map(|profile| profile.handle.as_str()),
        Some("second_target")
    );
    let inbox = public_inbox(&pool, second, None, 10).await.unwrap();
    assert_eq!(inbox.unread_count, 1);
    assert_eq!(inbox.items[0].reason, "mention");

    // A second edit that keeps the same mention delivers nothing new.
    edit_post(
        &pool,
        topic,
        author,
        serde_json::json!({
            "source_seq": reply,
            "body": "@second_target look again",
            "revision": 2,
            "mentions": [{ "profile_id": second_profile, "span": { "offset": 0, "len": 14 } }]
        }),
        9,
    )
    .await;
    assert_eq!(inbox_rows(&pool, second).await, vec![(reply, "mention".to_string(), 8)]);
    assert_eq!(revision_rows(&pool, reply).await.len(), 2);

    let snapshot = topic_snapshot(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(topic_snapshot(&pool, topic).await, snapshot);
    assert_eq!(inbox_rows(&pool, first).await, vec![(reply, "mention".to_string(), 7)]);
    assert_eq!(inbox_rows(&pool, second).await, vec![(reply, "mention".to_string(), 8)]);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn retraction_withholds_content_drops_search_and_preserves_cited_excerpts(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(305);
    let topic = Uuid::from_u128(306);
    let author = test_principal(26);
    let quoter = test_principal(27);
    ensure_test_principal(&pool, author).await;
    ensure_test_principal(&pool, quoter).await;
    let author_profile = create_test_profile(&pool, author, "retracting_author", 1).await;
    let quoter_profile = create_test_profile(&pool, quoter, "quoting_member", 2).await;
    create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;

    let claim = submit_post(
        &pool,
        topic,
        author,
        author_profile,
        serde_json::json!({
            "body": "A bold claim about the lantern",
            "mentions": [{ "profile_id": quoter_profile, "span": { "offset": 0, "len": 6 } }]
        }),
        7,
    )
    .await;
    let quoting = submit_post(
        &pool,
        topic,
        quoter,
        quoter_profile,
        serde_json::json!({
            "body": "Quoting the claim",
            "quotations": [{
                "target": { "kind": "discussion_post", "scope_id": topic, "source_seq": claim },
                "excerpt": "bold claim"
            }]
        }),
        8,
    )
    .await;
    let before = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();

    retract_post(&pool, topic, author, claim, 9).await;

    // The seat stays; the content goes.
    let page = discussion_posts(&pool, topic, None, 10, None).await.unwrap();
    assert_eq!(page.posts.len(), 3);
    let retracted = page.posts.iter().find(|post| post.source_seq == claim).unwrap();
    assert!(retracted.retracted);
    assert_eq!(retracted.body, "");
    assert!(retracted.quotations.is_empty());
    assert!(retracted.mentions.is_empty());
    assert_eq!(retracted.revision, 0);
    assert_eq!(retracted.citation_count, 1, "incoming citations keep counting");
    assert_eq!(
        retracted.author.as_ref().map(|author| author.handle.as_str()),
        Some("retracting_author"),
        "the placeholder is still attributed so readers know who withdrew it"
    );

    // The quoting post keeps the snapshot it cited.
    let quoting_post = page.posts.iter().find(|post| post.source_seq == quoting).unwrap();
    assert_eq!(quoting_post.quotations.len(), 1);
    assert_eq!(quoting_post.quotations[0].excerpt, "bold claim");
    let citations = visible_public_incoming_citations(
        &pool,
        content_reference::PublicContentRef::new(topic, claim),
        None,
        10,
    )
    .await
    .unwrap()
    .expect("a retracted post still has a citation target");
    assert_eq!(citations.citation_count, 1);
    assert_eq!(citations.citations[0].quoting.source_seq, quoting);

    // Discovery is withdrawn; the publication row is not.
    assert!(search_document_bodies(&pool, topic, claim).await.is_empty());
    let lantern = public_search(&pool, "lantern", PublicSearchFilter::All, None, 10, None)
        .await
        .unwrap();
    assert!(lantern.results.is_empty());
    let publication_body: Option<String> = sqlx::query_scalar(
        "SELECT body FROM public_publication WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(claim)
    .fetch_optional(&pool)
    .await
    .unwrap();
    assert_eq!(publication_body.as_deref(), Some("A bold claim about the lantern"));

    // A retracted post can no longer be quoted; the write model sees it as
    // not visible while the rest of the thread is unchanged.
    let thread = quotation_thread_for_discussion(&pool, topic, None)
        .await
        .unwrap();
    let claim_state = thread.posts.iter().find(|post| post.source_seq == claim).unwrap();
    assert!(!claim_state.visible);
    assert!(thread
        .posts
        .iter()
        .filter(|post| post.source_seq != claim)
        .all(|post| post.visible));
    let state = discussion_post_write_state(&pool, topic, claim)
        .await
        .unwrap()
        .unwrap();
    assert!(state.retracted);

    // Retraction is not activity either.
    let after = discussion_topic_by_id(&pool, topic).await.unwrap().unwrap();
    assert_eq!(after.updated_seq, before.updated_seq);
    assert_eq!(after.post_count, before.post_count);
    assert_eq!(after.version, before.version + 1);
    assert_eq!(inbox_rows(&pool, quoter).await, vec![(claim, "mention".to_string(), 7)]);

    let snapshot = topic_snapshot(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(topic_snapshot(&pool, topic).await, snapshot);
    let rebuilt = discussion_posts(&pool, topic, None, 10, None).await.unwrap();
    assert_eq!(rebuilt.posts, page.posts);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn edit_or_retraction_naming_a_post_outside_the_topic_is_refused(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(307);
    let topic = Uuid::from_u128(308);
    let other_topic = Uuid::from_u128(309);
    let author = test_principal(28);
    ensure_test_principal(&pool, author).await;
    let author_profile = create_test_profile(&pool, author, "cross_topic", 1).await;
    let opening = create_topic_with_opening_post(&pool, area, topic, author, author_profile, 3).await;
    append_discussion_and_project(
        &pool,
        other_topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Other", "author_profile_id": author_profile }),
                ActorId::Principal(author),
                6,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Other opening", "author_profile_id": author_profile }),
                ActorId::Principal(author),
                7,
            ),
        ],
    )
    .await
    .unwrap();

    // A post is addressed through its own topic stream only; the projection
    // refuses to fold a cross-topic edit rather than silently touching a row
    // another stream owns.
    let cross_edit = append_discussion_and_project(
        &pool,
        other_topic,
        &[EventInput::new(
            "DiscussionPostEdited",
            1,
            serde_json::json!({ "source_seq": opening, "body": "hijacked", "revision": 1 }),
            ActorId::Principal(author),
            8,
        )],
    )
    .await;
    assert!(cross_edit.is_err());
    let cross_retract = append_discussion_and_project(
        &pool,
        other_topic,
        &[EventInput::new(
            "DiscussionPostRetracted",
            1,
            serde_json::json!({ "source_seq": opening }),
            ActorId::Principal(author),
            9,
        )],
    )
    .await;
    assert!(cross_retract.is_err());
    assert!(discussion_post_write_state(&pool, other_topic, opening)
        .await
        .unwrap()
        .is_none());
    let page = discussion_posts(&pool, topic, None, 10, None).await.unwrap();
    assert_eq!(page.posts[0].body, "Opening claim");
    assert_eq!(page.posts[0].revision, 0);
    assert!(!page.posts[0].retracted);
}
