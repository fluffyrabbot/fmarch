//! First-class quotations fold into post_citation and rebuild identically.

use eventstore::{ActorId, EventInput};
use projections::{
    append_and_project, append_discussion_and_project, append_profile_and_project, rebuild,
    rebuild_discussion_stream,
};
use sqlx::Row;
use uuid::Uuid;

#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_quotations_fold_and_rebuild_identically(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(81);
    let topic = Uuid::from_u128(82);
    let profile = Uuid::from_u128(83);
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
                serde_json::json!({ "host": "host", "pack": "mafiascum" }),
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
