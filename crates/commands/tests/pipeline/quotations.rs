use commands::{handle, Command};
use content_reference::{PostKind, PostRef, Quotation};
use sqlx::{PgPool, Row};
use uuid::Uuid;

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
            embed_url: None,
            embed_snapshot: None,
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
            embed_url: None,
            embed_snapshot: None,
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
        FROM public_citation
        WHERE quoting_surface_id = $1
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
            embed_url: None,
            embed_snapshot: None,
        },
    )
    .await;
    assert!(matches!(missing, Err(commands::Reject::InvalidTarget)));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_post_rejects_quoting_a_private_channel_seq_from_main(pool: PgPool) {
    let host = "host_q_priv";
    let mason = "mason_q";
    let game = Uuid::new_v4();
    let h = user(host);

    crate::common::handle(
        &pool,
        &h,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for (slot, occupant, role) in [("slot_1", mason, "mason"), ("slot_2", "mason_q2", "mason")] {
        crate::common::handle(
            &pool,
            &h,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
        crate::common::handle(
            &pool,
            &h,
            Command::SeatPersona {
                game,
                slot: slot.into(),
                principal_id: crate::common::fixture_principal_id(occupant),
                public_name: format!("Persona {slot}"),
            },
        )
        .await
        .unwrap();
        crate::common::handle(
            &pool,
            &h,
            Command::AssignRole {
                game,
                slot: slot.into(),
                role_key: role.into(),
            },
        )
        .await
        .unwrap();
    }
    crate::common::handle(
        &pool,
        &h,
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    )
    .await
    .expect("start declares mason private channel");

    crate::common::handle(
        &pool,
        &user(mason),
        Command::SubmitPost {
            game,
            channel_id: "private:mason".into(),
            actor_slot: "slot_1".into(),
            body: "secret mason claim".into(),
            media: Vec::new(),
            quotations: Vec::new(),
            embed_url: None,
            embed_snapshot: None,
        },
    )
    .await
    .expect("private mason post");

    let private_seq: i64 = sqlx::query_scalar(
        "SELECT source_seq FROM thread_view WHERE game_id = $1 AND channel_id = 'private:mason' ORDER BY source_seq ASC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();

    let rejected = crate::common::handle(
        &pool,
        &user(mason),
        Command::SubmitPost {
            game,
            channel_id: "main".into(),
            actor_slot: "slot_1".into(),
            body: "leaking that claim".into(),
            media: Vec::new(),
            quotations: vec![Quotation {
                target: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: game,
                    source_seq: private_seq,
                },
                excerpt: "secret mason claim".into(),
            }],
            embed_url: None,
            embed_snapshot: None,
        },
    )
    .await;
    assert!(matches!(rejected, Err(commands::Reject::InvalidTarget)));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn submit_post_allows_empty_body_when_same_thread_quotations_are_present(pool: PgPool) {
    let host = "host_q_empty";
    let slot = "slot_1";
    let occupant = "player_q_empty";
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
            embed_url: None,
            embed_snapshot: None,
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
            body: "".into(),
            media: Vec::new(),
            quotations: vec![Quotation {
                target: PostRef {
                    kind: PostKind::GamePost,
                    scope_id: game,
                    source_seq: quoted_seq,
                },
                excerpt: "Alpha signal".into(),
            }],
            embed_url: None,
            embed_snapshot: None,
        },
    )
    .await
    .expect("quote-only post");

    let thread = projections::thread_view(&pool, game, None, 10)
        .await
        .expect("thread view");
    assert_eq!(thread.posts.len(), 2);
    assert_eq!(thread.posts[1].body, "");
    assert_eq!(thread.posts[1].quotations[0].excerpt, "Alpha signal");
}
