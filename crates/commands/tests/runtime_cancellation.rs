//! Deterministic cancellation coverage for the transaction-owning command
//! runtime. The database-blocking tests in `pipeline.rs` cover cancellation
//! *inside* lock and projection awaits; this matrix covers every orchestration
//! boundary and the ambiguous post-commit outcome.

use std::time::Duration;

use caps::Principal;
use commands::{
    handle, handle_idempotent, handle_idempotent_with_test_control, Command,
    CommandRuntimeCheckpoint, CommandRuntimeTestControl, Reject,
};
use sqlx::PgPool;
use uuid::Uuid;

fn user(id: &str) -> Principal {
    Principal::user(id)
}

async fn setup_game(pool: &PgPool) -> Uuid {
    let game = Uuid::new_v4();
    let host = user("host_h");
    for command in [
        Command::CreateGame {
            game,
            pack: "mafiascum".into(),
        },
        Command::AddSlot {
            game,
            slot: "slot_1".into(),
        },
        Command::AssignSlot {
            game,
            slot: "slot_1".into(),
            user: "user_a".into(),
        },
        Command::AssignRole {
            game,
            slot: "slot_1".into(),
            role_key: "vanilla_townie".into(),
        },
        Command::StartGame {
            game,
            phase: "D01".into(),
        },
    ] {
        handle(pool, &host, command)
            .await
            .expect("game setup command succeeds");
    }
    game
}

fn post(game: Uuid, body: &str) -> Command {
    Command::SubmitPost {
        game,
        channel_id: "main".into(),
        actor_slot: "slot_1".into(),
        body: body.into(),
        media: Vec::new(),
    }
}

async fn abort_at_checkpoint(
    pool: &PgPool,
    game: Uuid,
    command_id: Uuid,
    body: &str,
    checkpoint: CommandRuntimeCheckpoint,
) {
    let control = CommandRuntimeTestControl::new(checkpoint);
    let waiter = control.clone();
    let task_pool = pool.clone();
    let command = post(game, body);
    let task = tokio::spawn(async move {
        handle_idempotent_with_test_control(
            &task_pool,
            &user("user_a"),
            command_id,
            command,
            control,
        )
        .await
    });

    if tokio::time::timeout(Duration::from_secs(5), waiter.wait_until_reached())
        .await
        .is_err()
    {
        task.abort();
        let outcome = task.await;
        panic!("command did not reach checkpoint {checkpoint:?}: {outcome:?}");
    }
    task.abort();
    assert!(
        task.await
            .expect_err("checkpoint suspends the command")
            .is_cancelled(),
        "task aborted at {checkpoint:?}"
    );
}

async fn artifact_counts(
    pool: &PgPool,
    game: Uuid,
    command_id: Uuid,
    body: &str,
) -> (i64, i64, i64) {
    let receipts = sqlx::query_scalar(
        "SELECT count(*) FROM command_receipt \
         WHERE principal_user_id = 'user_a' AND command_id = $1",
    )
    .bind(command_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let events = sqlx::query_scalar(
        "SELECT count(*) FROM events \
         WHERE stream_id = $1 AND kind = 'PostSubmitted' AND payload->>'body' = $2",
    )
    .bind(game)
    .bind(body)
    .fetch_one(pool)
    .await
    .unwrap();
    let projections =
        sqlx::query_scalar("SELECT count(*) FROM thread_view WHERE game_id = $1 AND body = $2")
            .bind(game)
            .bind(body)
            .fetch_one(pool)
            .await
            .unwrap();
    (receipts, events, projections)
}

async fn wait_for_rollback(
    pool: &PgPool,
    game: Uuid,
    command_id: Uuid,
    body: &str,
    checkpoint: CommandRuntimeCheckpoint,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if artifact_counts(pool, game, command_id, body).await == (0, 0, 0) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("artifacts survived cancellation at {checkpoint:?}"));
    wait_for_no_runtime_resources(pool).await;
}

async fn wait_for_no_runtime_resources(pool: &PgPool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let idle_transactions: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_stat_activity \
                 WHERE datname = current_database() AND state = 'idle in transaction'",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            let advisory_locks: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM pg_locks \
                 WHERE locktype = 'advisory' AND granted \
                   AND database = (SELECT oid FROM pg_database WHERE datname = current_database())",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if idle_transactions == 0 && advisory_locks == 0 {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("command runtime released every transaction and advisory lock");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cancellation_matrix_rolls_back_every_pre_commit_checkpoint(pool: PgPool) {
    let game = setup_game(&pool).await;
    let checkpoints = [
        CommandRuntimeCheckpoint::TransactionBegun,
        CommandRuntimeCheckpoint::ReceiptClaimed,
        CommandRuntimeCheckpoint::StreamLocked,
        CommandRuntimeCheckpoint::CompletionChecked,
        CommandRuntimeCheckpoint::GameValidated,
        CommandRuntimeCheckpoint::CapabilityResolved,
        CommandRuntimeCheckpoint::EventsProjected,
        CommandRuntimeCheckpoint::CommandApplied,
        CommandRuntimeCheckpoint::ReceiptStored,
    ];

    for (index, checkpoint) in checkpoints.into_iter().enumerate() {
        let command_id = Uuid::new_v4();
        let body = format!("cancel checkpoint {index}: {checkpoint:?}");
        abort_at_checkpoint(&pool, game, command_id, &body, checkpoint).await;
        wait_for_rollback(&pool, game, command_id, &body, checkpoint).await;

        let ack = handle_idempotent(&pool, &user("user_a"), command_id, post(game, &body))
            .await
            .unwrap_or_else(|error| panic!("retry after {checkpoint:?} failed: {error:?}"));
        assert_eq!(ack.stream_seqs.len(), 1);
        assert_eq!(
            artifact_counts(&pool, game, command_id, &body).await,
            (1, 1, 1)
        );
        wait_for_no_runtime_resources(&pool).await;
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn cancellation_after_commit_replays_the_committed_outcome(pool: PgPool) {
    let game = setup_game(&pool).await;
    let command_id = Uuid::new_v4();
    let body = "commit outcome was not observed";

    abort_at_checkpoint(
        &pool,
        game,
        command_id,
        body,
        CommandRuntimeCheckpoint::Committed,
    )
    .await;
    assert_eq!(
        artifact_counts(&pool, game, command_id, body).await,
        (1, 1, 1)
    );
    wait_for_no_runtime_resources(&pool).await;

    let committed_seqs: Vec<i64> = sqlx::query_scalar(
        "SELECT stream_seqs FROM command_receipt \
         WHERE principal_user_id = 'user_a' AND command_id = $1",
    )
    .bind(command_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let replay = handle_idempotent(&pool, &user("user_a"), command_id, post(game, body))
        .await
        .expect("same command id and body recovers the committed ack");
    assert_eq!(replay.stream_seqs, committed_seqs);
    assert_eq!(
        artifact_counts(&pool, game, command_id, body).await,
        (1, 1, 1)
    );

    let conflict = handle_idempotent(
        &pool,
        &user("user_a"),
        command_id,
        post(game, "different command after ambiguous commit"),
    )
    .await
    .expect_err("same id with another payload remains a conflict");
    assert_eq!(conflict, Reject::CommandIdConflict);
    wait_for_no_runtime_resources(&pool).await;
}
