//! Game slot mentions cross the command boundary as a decided fact.
//!
//! The write model resolves the posting channel's audience, decides the spans,
//! and refuses every failure with one non-disclosing reject. Delivery is
//! slot-addressed, so replacement carries a pending mention with the seat.

use commands::{handle, Command, Reject};
use content_reference::{MentionSpan, SlotMention, SlotMentionCandidate};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::common::*;

fn candidate(slot_id: &str, offset: usize, len: usize) -> SlotMentionCandidate {
    SlotMentionCandidate {
        slot_id: slot_id.to_string(),
        offset,
        len,
    }
}

fn post(game: Uuid, slot: &str, body: &str, mentions: Vec<SlotMentionCandidate>) -> Command {
    Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: slot.into(),
        body: body.into(),
        media: Vec::new(),
        quotations: Vec::new(),
        mentions,
        embed_url: None,
        embed_snapshot: None,
    }
}

async fn delivered_source_seqs(pool: &PgPool, game: Uuid, slot: &str) -> Vec<i64> {
    projections::slot_mention_notifications_for_slot(pool, game, slot)
        .await
        .expect("read slot mention delivery")
        .into_iter()
        .map(|row| row.source_seq)
        .collect()
}

/// The happy path: the decided list reaches the event payload, the post row,
/// and the addressed seat's rail — and nothing else.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn submit_post_decides_a_slot_mention_and_delivers_it_to_the_seat(pool: PgPool) {
    let host = "host_m";
    let slot = "slot_1";
    let addressed = "slot_2";
    let occupant = "player_m";
    let game = setup_game(&pool, host, slot, occupant).await;
    add_vanilla_slot(&pool, game, host, addressed).await;

    handle(
        &pool,
        &user(occupant),
        post(
            game,
            slot,
            "@slot_2 explain the wagon",
            vec![candidate(addressed, 0, 7)],
        ),
    )
    .await
    .expect("post addressing a seat that can read main");

    let payloads = stored_payloads(&pool, game, "PostSubmitted").await;
    let mentioning = payloads
        .iter()
        .find(|payload| payload["body"] == "@slot_2 explain the wagon")
        .expect("the mentioning post is on the stream");
    assert_eq!(
        mentioning["mentions"],
        serde_json::json!([{ "slot_id": "slot_2", "span": { "offset": 0, "len": 7 } }]),
        "the decision is stored as a typed fact, never re-derived from prose",
    );
    assert!(
        mentioning
            .get("author")
            .and_then(|author| author.get("slot_id"))
            .is_some(),
        "authorship is the slot",
    );

    let stored: serde_json::Value =
        sqlx::query_scalar("SELECT mentions FROM thread_view WHERE game_id = $1 AND body = $2")
            .bind(game)
            .bind("@slot_2 explain the wagon")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        serde_json::from_value::<Vec<SlotMention>>(stored).unwrap(),
        vec![SlotMention {
            slot_id: addressed.to_string(),
            span: MentionSpan { offset: 0, len: 7 },
        }],
    );

    assert_eq!(delivered_source_seqs(&pool, game, addressed).await.len(), 1);
    assert!(
        delivered_source_seqs(&pool, game, slot).await.is_empty(),
        "the author is not addressed by their own post",
    );
}

/// RFC 0007 §4: a seat that is not in this game and a seat that merely cannot
/// read this room must be refused identically, or the reject is an oracle.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn every_mention_failure_is_the_same_non_disclosing_reject(pool: PgPool) {
    let host = "host_m2";
    let slot = "slot_1";
    let addressed = "slot_2";
    let occupant = "player_m2";
    let game = setup_game(&pool, host, slot, occupant).await;
    add_vanilla_slot(&pool, game, host, addressed).await;

    let foreign = handle(
        &pool,
        &user(occupant),
        post(game, slot, "@slot_9 hi", vec![candidate("slot_9", 0, 7)]),
    )
    .await
    .expect_err("a seat absent from this game cannot be addressed");
    let bad_span = handle(
        &pool,
        &user(occupant),
        post(game, slot, "no at sign", vec![candidate(addressed, 0, 7)]),
    )
    .await
    .expect_err("a span that does not quote the seat label cannot be addressed");
    let duplicate = handle(
        &pool,
        &user(occupant),
        post(
            game,
            slot,
            "@slot_2 @slot_2",
            vec![candidate(addressed, 0, 7), candidate(addressed, 8, 7)],
        ),
    )
    .await
    .expect_err("one post addresses a seat once");
    let over_cap = handle(
        &pool,
        &user(occupant),
        post(
            game,
            slot,
            "@slot_2",
            (0..=content_reference::MAX_MENTIONS_PER_POST)
                .map(|_| candidate(addressed, 0, 7))
                .collect(),
        ),
    )
    .await
    .expect_err("the per-post cap holds");

    for reject in [&foreign, &bad_span, &duplicate, &over_cap] {
        assert!(
            matches!(reject, Reject::InvalidTarget),
            "every mention refusal is one class, found {reject:?}",
        );
    }
    assert!(
        delivered_source_seqs(&pool, game, addressed)
            .await
            .is_empty(),
        "a rejected post delivers nothing",
    );
}

/// The load-bearing case. Addressing a non-member from inside a private room
/// would leak that room's existence to someone outside it, so the refusal must
/// be byte-identical to naming a seat that does not exist at all.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn a_private_room_refuses_a_non_member_exactly_as_it_refuses_a_stranger(pool: PgPool) {
    let host = "host_m4";
    let slot = "slot_1";
    let outsider = "slot_2";
    let occupant = "player_m4";
    let game = setup_game(&pool, host, slot, occupant).await;
    add_vanilla_slot(&pool, game, host, outsider).await;
    let room = domain::role_pm_channel_id(slot);

    let private_post = |mentions: Vec<SlotMentionCandidate>, body: &str| Command::SubmitPost {
        game,
        channel_id: room.clone(),
        actor_slot: slot.into(),
        body: body.into(),
        media: Vec::new(),
        quotations: Vec::new(),
        mentions,
        embed_url: None,
        embed_snapshot: None,
    };

    // The author reads their own room, so this proves the room is postable.
    handle(
        &pool,
        &user(occupant),
        private_post(Vec::new(), "checking in"),
    )
    .await
    .expect("a member posts into their own room");

    let non_member = handle(
        &pool,
        &user(occupant),
        private_post(vec![candidate(outsider, 0, 7)], "@slot_2 join me"),
    )
    .await
    .expect_err("a seat outside this room cannot be addressed from inside it");
    let stranger = handle(
        &pool,
        &user(occupant),
        private_post(vec![candidate("slot_9", 0, 7)], "@slot_9 join me"),
    )
    .await
    .expect_err("a seat absent from the game cannot be addressed either");

    assert!(matches!(non_member, Reject::InvalidTarget));
    assert_eq!(
        format!("{non_member:?}"),
        format!("{stranger:?}"),
        "the room must not disclose which side of the check failed",
    );
    assert!(
        delivered_source_seqs(&pool, game, outsider)
            .await
            .is_empty(),
        "nothing reaches a seat outside the room",
    );
}

/// Delivery names a seat, so replacement transfers a pending mention to the
/// incoming occupant for free — with no new event on the mention.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn replacement_transfers_a_pending_mention_without_a_new_event(pool: PgPool) {
    let host = "host_m3";
    let author_slot = "slot_1";
    let addressed = "slot_7";
    let author = "player_m3";
    let outgoing = "user_out";
    let incoming = "user_in";

    let game = setup_game(&pool, host, author_slot, author).await;
    add_vanilla_slot(&pool, game, host, addressed).await;
    ensure_test_principals(&pool, [outgoing, incoming]).await;
    handle(
        &pool,
        &user(host),
        Command::SeatPersona {
            game,
            slot: addressed.into(),
            principal_id: fixture_principal_id(outgoing),
            public_name: "Persona out".into(),
        },
    )
    .await
    .expect("seat the outgoing occupant");

    handle(
        &pool,
        &user(author),
        post(
            game,
            author_slot,
            "@slot_7 you are wagoned",
            vec![candidate(addressed, 0, 7)],
        ),
    )
    .await
    .expect("address the seat");

    let before = delivered_source_seqs(&pool, game, addressed).await;
    assert_eq!(before.len(), 1);
    let events_before = stored_payloads(&pool, game, "PostSubmitted").await.len();

    let outgoing_persona_id = current_slot_persona_id(&pool, game, addressed).await;
    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: addressed.into(),
            outgoing_persona_id,
            incoming_principal_id: fixture_principal_id(incoming),
        },
    )
    .await
    .expect("host processes replacement");

    assert_eq!(
        before,
        delivered_source_seqs(&pool, game, addressed).await,
        "the pending mention stays a fact about the seat",
    );
    assert_eq!(
        events_before,
        stored_payloads(&pool, game, "PostSubmitted").await.len(),
        "replacement writes no event on the mention",
    );

    // The incoming occupant now holds the seat, so the rail resolves to them.
    let incoming_caps = caps::resolve(&pool, &user(incoming), game)
        .await
        .expect("resolve incoming capabilities");
    assert!(incoming_caps.grants(&caps::Capability::SlotOccupant(addressed.to_string())));
    let outgoing_caps = caps::resolve(&pool, &user(outgoing), game)
        .await
        .expect("resolve outgoing capabilities");
    assert!(!outgoing_caps.grants(&caps::Capability::SlotOccupant(addressed.to_string())));

    // Nothing about the delivery names a human at all.
    let rows: Vec<String> =
        sqlx::query("SELECT audience_slot FROM slot_mention_notification WHERE game_id = $1")
            .bind(game)
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("audience_slot"))
            .collect();
    assert_eq!(rows, vec![addressed.to_string()]);
}
