use commands::{handle, Command};
use community::{PostKind, PostRef, Quotation};
use sqlx::{PgPool, Row};

use crate::common::*;

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_post_records_same_thread_quotations_without_writing_the_quoted_stream(
    pool: PgPool,
) {
    let host = "host_q";
    let slot = "slot_1";
    let occupant = "player_q";
    let game = setup_game(&pool, host, slot, occupant).await;

    handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "Alpha signal analysis".into(),
            media: Vec::new(),
            quotations: Vec::new(),
        },
    )
    .await
    .expect("root post");

    let quoted_seq: i64 = sqlx::query_scalar(
        "SELECT source_seq FROM thread_view WHERE game_id = $1 AND channel_id = 'main' ORDER BY source_seq ASC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();

    handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "Answering that claim".into(),
            media: Vec::new(),
            quotations: vec![Quotation {
                target: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: game,
                    source_seq: quoted_seq,
                },
                excerpt: "Alpha signal".into(),
            }],
        },
    )
    .await
    .expect("quoting post");

    let events = eventstore::load_stream(&pool, game).await.unwrap();
    let posts: Vec<_> = events
        .iter()
        .filter(|event| event.kind == "PostSubmitted")
        .collect();
    assert_eq!(posts.len(), 2);
    assert!(posts[0].payload.get("quotations").is_none());
    assert_eq!(
        posts[1].payload["quotations"][0]["target"]["source_seq"],
        quoted_seq
    );
    assert_eq!(posts[1].payload["quotations"][0]["excerpt"], "Alpha signal");

    let citation = sqlx::query(
        r#"
        SELECT quoted_source_seq, quoting_source_seq
        FROM post_citation
        WHERE quoting_kind = 'game_post' AND quoting_scope_id = $1
        "#,
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(citation.get::<i64, _>("quoted_source_seq"), quoted_seq);
    assert_eq!(citation.get::<i64, _>("quoting_source_seq"), posts[1].seq);

    let missing = handle(
        &pool,
        &user(occupant),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: slot.into(),
            body: "ghost quote".into(),
            media: Vec::new(),
            quotations: vec![Quotation {
                target: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: game,
                    source_seq: 99_999,
                },
                excerpt: "nope".into(),
            }],
        },
    )
    .await;
    assert!(matches!(missing, Err(commands::Reject::InvalidTarget)));
}
