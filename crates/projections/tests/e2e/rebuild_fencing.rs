//! Observe actual PostgreSQL lock waits rather than guessing task ordering.
use super::*;
use std::time::Duration;

async fn replay_pool(pool: &PgPool) -> (PgPool, i32) {
    let replay = PgPoolOptions::new()
        .max_connections(1)
        .connect_with((*pool.connect_options()).clone())
        .await
        .unwrap();
    let pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&replay)
        .await
        .unwrap();
    (replay, pid)
}

async fn wait_for_blocker(pool: &PgPool, waiter: i32, blocker: i32) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let blocked: bool = sqlx::query_scalar("SELECT $1 = ANY(pg_blocking_pids($2))")
                .bind(blocker)
                .bind(waiter)
                .fetch_one(pool)
                .await
                .unwrap();
            if blocked {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("replay must wait for the identified transaction");
}

fn role(role_key: &str) -> EventInput {
    EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({"slot_id": "slot_1", "role_key": role_key, "alignment": "town"}),
        ActorId::Host,
        1,
    )
}

async fn game_writer_wins(pool: &PgPool, audit: bool) {
    let game = Uuid::new_v4();
    append_and_project(pool, game, &[role("original")])
        .await
        .unwrap();
    let mut writer = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut writer, game)
        .await
        .unwrap();
    let writer_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(pool).await;
    let task = tokio::spawn(async move {
        if audit {
            assert!(audit_rebuild(&replay, game).await.unwrap().ok);
        } else {
            rebuild(&replay, game).await.unwrap();
        }
        replay.close().await;
    });
    wait_for_blocker(pool, replay_pid, writer_pid).await;
    // This event did not exist when replay started waiting. Both the replay
    // input and an audit's baseline must be read after this transaction commits.
    projections::append_and_project_in_tx(&mut writer, game, &[role("replacement")])
        .await
        .unwrap();
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    let rows = slot_state(pool, game).await.unwrap();
    assert_eq!(rows[0].role_key.as_deref(), Some("replacement"));
    assert_eq!(eventstore::load_stream(pool, game).await.unwrap().len(), 2);
    assert!(audit_rebuild(pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_rebuild_reads_after_concurrent_writer_commit(pool: PgPool) {
    game_writer_wins(&pool, false).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_audit_fences_its_baseline_before_concurrent_writer_commit(pool: PgPool) {
    game_writer_wins(&pool, true).await;
}

fn post(body: &str) -> EventInput {
    EventInput::new(
        forum::POST_SUBMITTED,
        1,
        serde_json::json!({"body": body}),
        ActorId::Principal(auxiliary_principal(9001)),
        3,
    )
}

async fn topic_fixture(pool: &PgPool) -> Uuid {
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    append_discussion_and_project(
        pool,
        area,
        &[EventInput::new(
            forum::AREA_CREATED,
            1,
            serde_json::json!({"slug": "replay", "title": "Replay", "description": "Fencing"}),
            ActorId::Principal(auxiliary_principal(9001)),
            1,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        pool,
        topic,
        &[
            EventInput::new(
                forum::TOPIC_CREATED,
                1,
                serde_json::json!({"area_id": area, "title": "Concurrent replay"}),
                ActorId::Principal(auxiliary_principal(9001)),
                2,
            ),
            post("original"),
        ],
    )
    .await
    .unwrap();
    topic
}

async fn assert_both_posts(pool: &PgPool, topic: Uuid) {
    let bodies: Vec<String> = sqlx::query_scalar(
        "SELECT body FROM discussion_post WHERE topic_id = $1 ORDER BY source_seq",
    )
    .bind(topic)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(bodies, ["original", "concurrent"]);
    assert_eq!(
        discussion_topic_by_id(pool, topic)
            .await
            .unwrap()
            .unwrap()
            .post_count,
        2
    );
    assert_eq!(eventstore::load_stream(pool, topic).await.unwrap().len(), 3);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_rebuild_preserves_post_committed_while_waiting(pool: PgPool) {
    let topic = topic_fixture(&pool).await;
    let mut writer = pool.begin().await.unwrap();
    eventstore::lock_stream_in_tx(&mut writer, topic)
        .await
        .unwrap();
    let writer_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(&pool).await;
    let task = tokio::spawn(async move {
        rebuild_discussion_stream(&replay, topic).await.unwrap();
        replay.close().await;
    });
    wait_for_blocker(&pool, replay_pid, writer_pid).await;
    projections::append_discussion_and_project_in_tx(&mut writer, topic, &[post("concurrent")])
        .await
        .unwrap();
    writer.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert_both_posts(&pool, topic).await;
    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_both_posts(&pool, topic).await;
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn discussion_rebuild_holds_stream_fence_during_projection_replacement(pool: PgPool) {
    let topic = topic_fixture(&pool).await;
    let mut blocker = pool.begin().await.unwrap();
    sqlx::query("SELECT topic_id FROM discussion_topic WHERE topic_id = $1 FOR UPDATE")
        .bind(topic)
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let blocker_pid = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *blocker)
        .await
        .unwrap();
    let (replay, replay_pid) = replay_pool(&pool).await;
    let task = tokio::spawn(async move {
        rebuild_discussion_stream(&replay, topic).await.unwrap();
        replay.close().await;
    });
    wait_for_blocker(&pool, replay_pid, blocker_pid).await;
    let mut writer = pool.begin().await.unwrap();
    assert!(
        !eventstore::try_lock_stream_in_tx(&mut writer, topic)
            .await
            .unwrap(),
        "a writer must not enter while replay is replacing projections"
    );
    writer.rollback().await.unwrap();
    blocker.commit().await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    append_discussion_and_project(&pool, topic, &[post("concurrent")])
        .await
        .unwrap();
    assert_both_posts(&pool, topic).await;
}
