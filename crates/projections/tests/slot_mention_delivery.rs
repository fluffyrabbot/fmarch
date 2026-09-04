//! Game slot mentions fan out to the seats they address.
//!
//! Deliberately a sibling of `mention_delivery.rs` rather than a section of it:
//! a community mention addresses a profile and lands in the principal-keyed
//! inbox, a game mention addresses a slot and lands on the slot-addressed rail,
//! and RFC 0007 makes the two unrepresentable in each other's universe. Keeping
//! the proofs apart keeps the universes apart.

use content_reference::{MentionSpan, SlotMention};
use eventstore::{ActorId, EventInput};
use projections::{
    append_and_project, rebuild, slot_mention_notifications_for_slot, thread_view_for_channel,
};
use social::PrincipalId;
use sqlx::Row;
use uuid::Uuid;

fn test_principal(value: u128) -> PrincipalId {
    PrincipalId::from_uuid(Uuid::from_u128(value))
}

fn test_game_created_payload(host_principal_id: PrincipalId, key: &str) -> serde_json::Value {
    let artifact = content_registry::select_pack_artifact(key)
        .unwrap_or_else(|error| panic!("select canonical test pack artifact `{key}`: {error}"));
    serde_json::json!({
        "host_principal_id": host_principal_id,
        "pack_ref": &artifact.pack_ref,
        "pack_artifact": artifact,
    })
}

async fn ensure_test_principal(pool: &sqlx::PgPool, principal_id: PrincipalId) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .unwrap();
}

/// A started game whose slots exist because the opening post seats them.
async fn start_game(pool: &sqlx::PgPool, host: PrincipalId) -> Uuid {
    let game = Uuid::new_v4();
    ensure_test_principal(pool, host).await;
    append_and_project(
        pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(host, "mafiascum"),
                ActorId::Principal(host),
                1,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                2,
            ),
        ],
    )
    .await
    .unwrap();
    for slot in ["slot_1", "slot_2", "slot_3"] {
        append_and_project(
            pool,
            game,
            &[EventInput::new(
                "SlotStatusChanged",
                1,
                serde_json::json!({ "slot_id": slot, "status": "alive" }),
                ActorId::Host,
                0,
            )],
        )
        .await
        .unwrap();
    }
    game
}

struct MentioningPost<'a> {
    game: Uuid,
    channel_id: &'a str,
    author_slot: &'a str,
    body: &'a str,
    mentions: Vec<SlotMention>,
}

async fn submit_mentioning_post(pool: &sqlx::PgPool, post: MentioningPost<'_>) -> i64 {
    let mut payload = serde_json::json!({
        "channel_id": post.channel_id,
        "author": { "kind": "slot", "slot_id": post.author_slot },
        "body": post.body,
        "phase_id": "D01",
    });
    if let Some(mentions) = content_reference::slot_mentions_payload(&post.mentions) {
        payload["mentions"] = mentions;
    }
    let stored = append_and_project(
        pool,
        post.game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            payload,
            ActorId::Slot(post.author_slot.to_string()),
            0,
        )],
    )
    .await
    .unwrap();
    stored[0].seq
}

fn span(offset: usize, len: usize) -> MentionSpan {
    MentionSpan { offset, len }
}

fn mention(slot_id: &str, offset: usize, len: usize) -> SlotMention {
    SlotMention {
        slot_id: slot_id.to_string(),
        span: span(offset, len),
    }
}

async fn delivery_rows(
    pool: &sqlx::PgPool,
    game: Uuid,
) -> Vec<(String, i64, String, Option<String>)> {
    sqlx::query(
        "SELECT audience_slot, source_seq, channel_id, phase_id \
         FROM slot_mention_notification WHERE game_id = $1 \
         ORDER BY audience_slot, source_seq",
    )
    .bind(game)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<String, _>("audience_slot"),
            row.get::<i64, _>("source_seq"),
            row.get::<String, _>("channel_id"),
            row.get::<Option<String>, _>("phase_id"),
        )
    })
    .collect()
}

async fn stored_thread_mentions(pool: &sqlx::PgPool, game: Uuid) -> Vec<(i64, serde_json::Value)> {
    sqlx::query(
        "SELECT source_seq, mentions FROM thread_view WHERE game_id = $1 ORDER BY source_seq",
    )
    .bind(game)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.get::<i64, _>("source_seq"),
            row.get::<serde_json::Value, _>("mentions"),
        )
    })
    .collect()
}

/// The addressed seat is delivered to, other seats are not, and both the edge
/// and the delivery survive a rebuild byte-identically.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn slot_mention_delivers_to_the_addressed_seat_and_rebuilds_identically(pool: sqlx::PgPool) {
    let host = test_principal(0x51_01);
    let game = start_game(&pool, host).await;
    let source_seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            game,
            channel_id: "main",
            author_slot: "slot_1",
            body: "@slot_2 explain the D1 vote",
            mentions: vec![mention("slot_2", 0, 7)],
        },
    )
    .await;

    let delivered = slot_mention_notifications_for_slot(&pool, game, "slot_2")
        .await
        .unwrap();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].audience_slot, "slot_2");
    assert_eq!(delivered[0].source_seq, source_seq);
    assert_eq!(delivered[0].channel_id, "main");
    assert_eq!(
        delivered[0].phase_id.as_ref().map(|phase| phase.as_str()),
        Some("D01"),
    );
    assert!(
        slot_mention_notifications_for_slot(&pool, game, "slot_3")
            .await
            .unwrap()
            .is_empty(),
        "an unaddressed seat receives nothing",
    );

    let before_delivery = delivery_rows(&pool, game).await;
    let before_edges = stored_thread_mentions(&pool, game).await;
    assert_eq!(
        before_edges,
        vec![(
            source_seq,
            serde_json::json!([{ "slot_id": "slot_2", "span": { "offset": 0, "len": 7 } }]),
        )],
    );

    rebuild(&pool, game).await.unwrap();
    assert_eq!(before_delivery, delivery_rows(&pool, game).await);
    assert_eq!(before_edges, stored_thread_mentions(&pool, game).await);
}

/// Invariant 11: the delivery fact names a seat and stores no principal,
/// persona, or occupancy. Replacement therefore transfers a pending mention
/// with the seat and needs no event of its own.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn slot_mention_delivery_stores_no_principal(pool: sqlx::PgPool) {
    let host = test_principal(0x51_02);
    let game = start_game(&pool, host).await;
    submit_mentioning_post(
        &pool,
        MentioningPost {
            game,
            channel_id: "main",
            author_slot: "slot_1",
            body: "@slot_2 answer",
            mentions: vec![mention("slot_2", 0, 7)],
        },
    )
    .await;

    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = 'slot_mention_notification' \
         ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        columns,
        vec![
            "audience_slot".to_string(),
            "channel_id".to_string(),
            "game_id".to_string(),
            "occurred_at".to_string(),
            "phase_id".to_string(),
            "source_seq".to_string(),
        ],
        "the delivery row addresses a seat; occupancy is resolved at read time",
    );
}

/// Self-mention is accepted by the write model and simply delivers nothing,
/// matching the author suppression watch fan-out already applies.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn self_mention_is_accepted_and_delivers_nothing(pool: sqlx::PgPool) {
    let host = test_principal(0x51_03);
    let game = start_game(&pool, host).await;
    let source_seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            game,
            channel_id: "main",
            author_slot: "slot_1",
            body: "@slot_1 reminding myself",
            mentions: vec![mention("slot_1", 0, 7)],
        },
    )
    .await;

    assert!(
        slot_mention_notifications_for_slot(&pool, game, "slot_1")
            .await
            .unwrap()
            .is_empty(),
        "an author never receives delivery for their own post",
    );
    assert_eq!(
        stored_thread_mentions(&pool, game).await,
        vec![(
            source_seq,
            serde_json::json!([{ "slot_id": "slot_1", "span": { "offset": 0, "len": 7 } }]),
        )],
        "the edge is still stored; only the delivery is suppressed",
    );
}

/// A mention made inside a private room must not name its seats in any column
/// readable from `main`. The decided list travels inside the sealed envelope,
/// exactly as quotations already do.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn a_private_channel_mention_never_reaches_a_surface_readable_from_main(pool: sqlx::PgPool) {
    let host = test_principal(0x51_04);
    let game = start_game(&pool, host).await;
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PrivateChannelDeclared",
            1,
            serde_json::json!({
                "channel_id": "private:faction:mafia",
                "kind": "Faction",
                "reveals_alignment": "mafia",
                "source": "engine.faction",
                "members": [
                    { "slot_id": "slot_1", "role_key": "goon" },
                    { "slot_id": "slot_2", "role_key": "goon" },
                ],
            }),
            ActorId::Host,
            0,
        )],
    )
    .await
    .unwrap();
    let source_seq = submit_mentioning_post(
        &pool,
        MentioningPost {
            game,
            channel_id: "private:faction:mafia",
            author_slot: "slot_1",
            body: "@slot_2 take the wagon",
            mentions: vec![mention("slot_2", 0, 7)],
        },
    )
    .await;

    assert_eq!(
        stored_thread_mentions(&pool, game).await,
        vec![(source_seq, serde_json::json!([]))],
        "the plaintext column stays empty for a private room",
    );
    let envelope: serde_json::Value =
        sqlx::query_scalar("SELECT body_private FROM thread_view WHERE game_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(
        !envelope.to_string().contains("slot_2"),
        "the sealed envelope must not leak its addressed seats in the clear",
    );

    // The room's own members still read the decided list.
    let page = thread_view_for_channel(&pool, game, "private:faction:mafia", None, 10)
        .await
        .unwrap();
    assert_eq!(page.posts.len(), 1);
    assert_eq!(page.posts[0].mentions, vec![mention("slot_2", 0, 7)]);

    // Delivery is still slot-addressed, and it names the room it happened in.
    let delivered = slot_mention_notifications_for_slot(&pool, game, "slot_2")
        .await
        .unwrap();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].channel_id, "private:faction:mafia");

    let before_delivery = delivery_rows(&pool, game).await;
    let before_edges = stored_thread_mentions(&pool, game).await;
    rebuild(&pool, game).await.unwrap();
    assert_eq!(before_delivery, delivery_rows(&pool, game).await);
    assert_eq!(before_edges, stored_thread_mentions(&pool, game).await);
}

/// Every pre-mention `PostSubmitted` upcasts to the empty list, and setup
/// discussion — deliberately outside a phase — still delivers.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn absent_mentions_upcast_and_a_prephase_mention_still_delivers(pool: sqlx::PgPool) {
    let host = test_principal(0x51_05);
    let game = Uuid::new_v4();
    ensure_test_principal(&pool, host).await;
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(host, "mafiascum"),
                ActorId::Principal(host),
                1,
            ),
            EventInput::new(
                "SlotStatusChanged",
                1,
                serde_json::json!({ "slot_id": "slot_1", "status": "alive" }),
                ActorId::Host,
                0,
            ),
            EventInput::new(
                "SlotStatusChanged",
                1,
                serde_json::json!({ "slot_id": "slot_2", "status": "alive" }),
                ActorId::Host,
                0,
            ),
            // A pre-mention post: no `mentions` key at all.
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "who is playing?",
                    "phase_id": null,
                }),
                ActorId::Slot("slot_1".into()),
                0,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "@slot_2 are you in?",
                    "phase_id": null,
                    "mentions": [{ "slot_id": "slot_2", "span": { "offset": 0, "len": 7 } }],
                }),
                ActorId::Slot("slot_1".into()),
                0,
            ),
        ],
    )
    .await
    .unwrap();

    let stored = stored_thread_mentions(&pool, game).await;
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].1, serde_json::json!([]), "absent upcasts to []");

    let delivered = slot_mention_notifications_for_slot(&pool, game, "slot_2")
        .await
        .unwrap();
    assert_eq!(delivered.len(), 1);
    assert_eq!(
        delivered[0].phase_id, None,
        "setup discussion is outside a phase and says so, rather than inventing one",
    );

    let before = delivery_rows(&pool, game).await;
    rebuild(&pool, game).await.unwrap();
    assert_eq!(before, delivery_rows(&pool, game).await);
}
