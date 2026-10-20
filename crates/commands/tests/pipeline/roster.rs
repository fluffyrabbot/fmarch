//! Public game roster reads (RFC 0008): seat names come from occupancy epochs
//! and persona name history, never from a client-side derivation.
use crate::common::*;
use commands::Command;
use sqlx::PgPool;
use uuid::Uuid;

/// RFC 0008: the public roster names every seat through its occupancy history,
/// so a post keeps the name its author held when it was written.
#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_roster_names_live_renamed_replaced_and_dead_seats(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host_h");
    handle(
        &pool,
        &host,
        Command::CreateGame {
            origin: None,
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    for slot in ["slot_10", "slot_2", "slot_1"] {
        handle(
            &pool,
            &host,
            Command::AddSlot {
                game,
                slot: slot.into(),
            },
        )
        .await
        .unwrap();
    }
    for (slot, principal, name) in [
        ("slot_1", "player_mira", "Mira"),
        ("slot_2", "player_lark", "Lark"),
    ] {
        handle(
            &pool,
            &host,
            Command::SeatPersona {
                game,
                slot: slot.into(),
                principal_id: fixture_principal_id(principal),
                public_name: name.into(),
            },
        )
        .await
        .unwrap();
    }
    handle(
        &pool,
        &host,
        Command::RenameGamePersona {
            game,
            persona_id: current_slot_persona_id(&pool, game, "slot_1").await,
            public_name: "Rowan".into(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::ProcessReplacement {
            game,
            slot: "slot_1".into(),
            outgoing_persona_id: current_slot_persona_id(&pool, game, "slot_1").await,
            incoming_principal_id: fixture_principal_id("player_wren"),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &host,
        Command::SetSlotStatus {
            game,
            slot: "slot_2".into(),
            status: domain::SlotLifecycle::Dead,
        },
    )
    .await
    .unwrap();

    let roster = projections::game_roster(&pool, game).await.unwrap();
    assert_eq!(
        roster.iter().map(|seat| seat.slot_id.as_str()).collect::<Vec<_>>(),
        ["slot_1", "slot_2", "slot_10"],
        "seats sort by their numeric suffix"
    );

    let replaced = &roster[0];
    assert!(replaced.alive);
    assert_eq!(replaced.occupancies.len(), 2);
    let (outgoing, incoming) = (&replaced.occupancies[0], &replaced.occupancies[1]);
    assert_eq!(
        outgoing
            .names
            .iter()
            .map(|name| name.public_name.as_str())
            .collect::<Vec<_>>(),
        ["Mira", "Rowan"],
        "the outgoing persona keeps its rename history"
    );
    // A persona's name is registered just before its first epoch begins, so
    // the resolver takes the latest name at or before a sequence.
    assert!(outgoing.names[0].effective_seq <= outgoing.began_seq);
    assert!(outgoing.names[0].effective_seq < outgoing.names[1].effective_seq);
    assert_eq!(outgoing.ended_seq, Some(incoming.began_seq));
    assert_eq!(incoming.ended_seq, None);
    let current_name = projections::slot_occupancy(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.slot_id == "slot_1")
        .unwrap()
        .public_name;
    assert_eq!(
        incoming.names.last().map(|name| name.public_name.as_str()),
        Some(current_name.as_str()),
        "the roster agrees with the open-occupancy selector"
    );

    let dead = &roster[1];
    assert!(!dead.alive);
    assert_eq!(dead.occupancies.len(), 1);
    assert_eq!(dead.occupancies[0].names[0].public_name, "Lark");

    let empty = &roster[2];
    assert!(empty.alive);
    assert!(empty.occupancies.is_empty(), "an unseated seat has no occupant");

    projections::rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::game_roster(&pool, game).await.unwrap(),
        roster,
        "the roster is rebuildable from the log"
    );
}
