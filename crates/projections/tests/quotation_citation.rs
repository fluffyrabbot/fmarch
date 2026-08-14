//! First-class quotations fold into post_citation and rebuild identically.

use community::{PostKind, PostRef};
use eventstore::{ActorId, EventInput};
use projections::{
    append_and_project, append_discussion_and_project, append_profile_and_project,
    discussion_posts, public_thread_view, rebuild, rebuild_discussion_stream,
    visible_incoming_citations,
};
use sqlx::Row;
use uuid::Uuid;

fn test_game_created_payload(host: &str, key: &str) -> serde_json::Value {
    let artifact = content_registry::select_pack_artifact(key)
        .unwrap_or_else(|error| panic!("select canonical test pack artifact `{key}`: {error}"));
    serde_json::json!({
        "host": host,
        "pack_ref": &artifact.pack_ref,
        "pack_artifact": artifact,
    })
}

async fn ensure_test_principal(pool: &sqlx::PgPool, principal_user_id: &str) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, principal_user_id, &[], 1)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_quotations_fold_and_rebuild_identically(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(81);
    let topic = Uuid::from_u128(82);
    let profile = Uuid::from_u128(83);
    ensure_test_principal(&pool, "quote_member").await;
    append_profile_and_project(
        &pool,
        profile,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": "quote_member",
                "handle": "quote_member",
                "display_name": "Quote Member",
                "bio": "Cites sources",
                "visibility": "public"
            }),
            ActorId::User("quote_member".into()),
            1,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "quotes", "title": "Quotes", "description": "Citation proofs" }),
            ActorId::User("moderator".into()),
            2,
        )],
    )
    .await
    .unwrap();
    let stored = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Signal theory", "author_profile_id": profile }),
                ActorId::User("quote_member".into()),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Alpha signal analysis", "author_profile_id": profile }),
                ActorId::User("quote_member".into()),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq = stored[1].seq;
    let quoting = append_discussion_and_project(
        &pool,
        topic,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "Answering that claim",
                "author_profile_id": profile,
                "quotations": [{
                    "target": {
                        "kind": "discussion_post",
                        "scope_id": topic,
                        "source_seq": quoted_seq
                    },
                    "excerpt": "Alpha signal"
                }]
            }),
            ActorId::User("quote_member".into()),
            5,
        )],
    )
    .await
    .unwrap();

    let before_citations = citation_rows(&pool, "discussion_post", topic).await;
    let before_json: serde_json::Value = sqlx::query_scalar(
        "SELECT quotations FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(quoting[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before_citations.len(), 1);
    assert_eq!(before_citations[0].0, quoted_seq);
    assert_eq!(before_citations[0].1, quoting[0].seq);
    assert_eq!(before_json[0]["excerpt"], "Alpha signal");

    let quoted_events = eventstore::load_stream(&pool, topic).await.unwrap();
    let first_post = quoted_events
        .iter()
        .find(|event| event.kind == "DiscussionPostSubmitted")
        .unwrap();
    assert!(first_post.payload.get("quotations").is_none());

    rebuild_discussion_stream(&pool, topic).await.unwrap();
    let after_citations = citation_rows(&pool, "discussion_post", topic).await;
    let after_json: serde_json::Value = sqlx::query_scalar(
        "SELECT quotations FROM discussion_post WHERE topic_id = $1 AND source_seq = $2",
    )
    .bind(topic)
    .bind(quoting[0].seq)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before_citations, after_citations);
    assert_eq!(before_json, after_json);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn game_quotations_fold_and_rebuild_identically(pool: sqlx::PgPool) {
    let game = Uuid::from_u128(91);
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload("host", "mafiascum"),
                ActorId::User("host".into()),
                1,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                2,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "slot_or_user": { "slot": "slot_1" },
                    "body": "Alpha signal analysis",
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                3,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq: i64 = sqlx::query_scalar(
        "SELECT source_seq FROM thread_view WHERE game_id = $1 AND channel_id = 'main'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "slot_or_user": { "slot": "slot_1" },
                "body": "Answering that claim",
                "phase_id": "D01",
                "quotations": [{
                    "target": {
                        "kind": "game_post",
                        "scope_id": game,
                        "source_seq": quoted_seq
                    },
                    "excerpt": "Alpha signal"
                }]
            }),
            ActorId::Slot("slot_1".into()),
            4,
        )],
    )
    .await
    .unwrap();

    let before = citation_rows(&pool, "game_post", game).await;
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].0, quoted_seq);

    rebuild(&pool, game).await.unwrap();
    assert_eq!(before, citation_rows(&pool, "game_post", game).await);

    let page = public_thread_view(&pool, game, None, 10, None)
        .await
        .unwrap();
    assert_eq!(page.posts.len(), 2);
    assert_eq!(page.posts[0].citation_count, 1);
    assert!(page.posts[0].quotations.is_empty());
    assert_eq!(page.posts[1].quotations[0].excerpt, "Alpha signal");
    assert_eq!(page.posts[1].citation_count, 0);
    let citations = visible_incoming_citations(
        &pool,
        PostRef {
            kind: PostKind::GamePost,
            scope_id: game,
            source_seq: quoted_seq,
        },
        Some("main"),
        None,
        5,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(citations.citation_count, 1);
    assert_eq!(
        citations.citations[0].quoting.source_seq,
        page.posts[1].source_seq
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_read_contract_counts_visible_citations_and_omits_hidden_quoters(
    pool: sqlx::PgPool,
) {
    let area = Uuid::from_u128(101);
    let topic = Uuid::from_u128(102);
    let profile = Uuid::from_u128(103);
    ensure_test_principal(&pool, "reader").await;
    append_profile_and_project(
        &pool,
        profile,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": "reader",
                "handle": "reader",
                "display_name": "Reader",
                "bio": "",
                "visibility": "public"
            }),
            ActorId::User("reader".into()),
            1,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "read", "title": "Read", "description": "" }),
            ActorId::User("moderator".into()),
            2,
        )],
    )
    .await
    .unwrap();
    let stored = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Claims", "author_profile_id": profile }),
                ActorId::User("reader".into()),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Root claim", "author_profile_id": profile }),
                ActorId::User("reader".into()),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let quoted_seq = stored[1].seq;
    let quoting = append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": "Visible quote",
                    "author_profile_id": profile,
                    "quotations": [{
                        "target": {
                            "kind": "discussion_post",
                            "scope_id": topic,
                            "source_seq": quoted_seq
                        },
                        "excerpt": "Root"
                    }]
                }),
                ActorId::User("reader".into()),
                5,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": "Hidden quote",
                    "author_profile_id": profile,
                    "quotations": [{
                        "target": {
                            "kind": "discussion_post",
                            "scope_id": topic,
                            "source_seq": quoted_seq
                        },
                        "excerpt": "Root"
                    }]
                }),
                ActorId::User("reader".into()),
                6,
            ),
        ],
    )
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO moderation_target_state (
            target_kind, scope_id, source_seq, visibility, reason,
            moderator_principal_id, updated_seq
        ) VALUES ('discussion_post', $1, $2, 'hidden', 'spam', 'moderator', $2)
        "#,
    )
    .bind(topic)
    .bind(quoting[1].seq)
    .execute(&pool)
    .await
    .unwrap();

    let page = discussion_posts(&pool, topic, None, 10, None)
        .await
        .unwrap();
    assert_eq!(page.posts.len(), 2);
    assert_eq!(page.posts[0].source_seq, quoted_seq);
    assert_eq!(page.posts[0].citation_count, 1);
    assert_eq!(page.posts[1].quotations[0].excerpt, "Root");
    assert_eq!(page.posts[1].citation_count, 0);

    let citations = visible_incoming_citations(
        &pool,
        PostRef {
            kind: PostKind::DiscussionPost,
            scope_id: topic,
            source_seq: quoted_seq,
        },
        None,
        None,
        5,
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(citations.citation_count, 1);
    assert_eq!(citations.citations.len(), 1);
    assert_eq!(citations.citations[0].quoting.source_seq, quoting[0].seq);
    assert!(visible_incoming_citations(
        &pool,
        PostRef {
            kind: PostKind::DiscussionPost,
            scope_id: topic,
            source_seq: quoting[1].seq,
        },
        None,
        None,
        5,
    )
    .await
    .unwrap()
    .is_none());
}

async fn citation_rows(pool: &sqlx::PgPool, kind: &str, scope_id: Uuid) -> Vec<(i64, i64)> {
    sqlx::query(
        r#"
        SELECT quoted_source_seq, quoting_source_seq
        FROM post_citation
        WHERE quoting_kind = $1 AND quoting_scope_id = $2
        ORDER BY quoting_source_seq, quoted_source_seq
        "#,
    )
    .bind(kind)
    .bind(scope_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<i64, _>("quoted_source_seq"),
            row.get::<i64, _>("quoting_source_seq"),
        )
    })
    .collect()
}
