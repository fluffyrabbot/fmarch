//! Command cost follows projected control state, independently of old event bodies.
use crate::common::*;
use commands::{Command, Reject};
use eventstore::{ActorId, EventInput};
use sqlx::PgPool;
use std::time::{Duration, Instant};
use uuid::Uuid;

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn lifecycle_commands_preserve_behavior_with_growing_history(pool: PgPool) {
    for history_len in [0, 128, 2048] {
        let game = setup_game(&pool, "host", "seat", "player").await;
        // Real sealed, replayable ballot events with substantial historical metadata.
        // They leave no ballot and do not change the lifecycle/pack facts under test.
        let padding = "historical ballot context ".repeat(160);
        let history = (0..history_len)
            .map(|_| {
                let mut event = EventInput::new(
                    "VoteWithdrawn",
                    1,
                    serde_json::json!({"phase_id": "D01", "actor": "seat"}),
                    ActorId::Host,
                    0,
                );
                event.meta = serde_json::json!({"context": padding});
                event
            })
            .collect::<Vec<_>>();
        append_and_project(&pool, game, &history).await.unwrap();
        let host = user("host");
        for (label, command) in [
            (
                "assign_role",
                Command::AssignRole {
                    game,
                    slot: "seat".into(),
                    role_key: "godfather".into(),
                },
            ),
            (
                "open_phase",
                Command::OpenDayPhase {
                    game,
                    phase: fixture_phase("D02"),
                },
            ),
            ("complete", Command::CompleteGame { game }),
        ] {
            let started = Instant::now();
            tokio::time::timeout(Duration::from_secs(5), handle(&pool, &host, command))
                .await
                .unwrap_or_else(|_| {
                    panic!("{label} exceeded authority lease at {history_len} events")
                })
                .unwrap();
            eprintln!(
                "lifecycle_read_cost history={history_len} command={label} elapsed_us={}",
                started.elapsed().as_micros()
            );
        }
        assert!(commands::game_completed(&pool, game).await.unwrap());
        assert!(projections::game_started(&pool, game).await.unwrap());
        assert_eq!(
            projections::phase_state(&pool, game)
                .await
                .unwrap()
                .unwrap()
                .phase_id,
            fixture_phase("D02")
        );
        let role_pm = latest_stored_payload(&pool, game, "PrivateChannelDeclared").await;
        assert_eq!(role_pm["members"][0]["role_key"], "godfather");
        assert_eq!(
            handle(&pool, &host, Command::CompleteGame { game })
                .await
                .unwrap_err(),
            Reject::GameAlreadyCompleted
        );
        projections::rebuild(&pool, game).await.unwrap();
        assert!(commands::game_completed(&pool, game).await.unwrap());
        assert!(projections::game_started(&pool, game).await.unwrap());
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn lifecycle_markers_distinguish_setup_start_and_completion(pool: PgPool) {
    let game = Uuid::new_v4();
    let host = user("host");
    assert!(!commands::game_completed(&pool, game).await.unwrap());
    assert!(!projections::game_started(&pool, game).await.unwrap());
    handle(
        &pool,
        &host,
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .unwrap();
    assert!(!commands::game_completed(&pool, game).await.unwrap());
    assert!(!projections::game_started(&pool, game).await.unwrap());
    // Completion is legal in setup; 'completed' must not imply 'ever started'.
    handle(&pool, &host, Command::CompleteGame { game })
        .await
        .unwrap();
    assert!(commands::game_completed(&pool, game).await.unwrap());
    assert!(!projections::game_started(&pool, game).await.unwrap());
    projections::rebuild(&pool, game).await.unwrap();
    assert!(commands::game_completed(&pool, game).await.unwrap());
    assert!(!projections::game_started(&pool, game).await.unwrap());
}
