//! Integration tests for the event store against REAL Postgres.
//!
//! `#[sqlx::test]` provisions an ephemeral per-test database and applies the
//! migrations in `./migrations`, then hands us a `PgPool`. It requires
//! `DATABASE_URL` to be set (the compose Postgres, `:5544`); if it is unset the
//! test FAILS to connect — it never silently passes without a DB.

use eventstore::{append, append_in_tx, load_stream, ActorId, EventInput};
use sqlx::Row;
use uuid::Uuid;

fn vote(target: &str, phase: &str) -> EventInput {
    EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "target": target, "phase_id": phase, "weight": 1.0 }),
        ActorId::Slot("slot_1".into()),
        1,
    )
}

#[sqlx::test(migrations = "./migrations")]
async fn append_assigns_sequential_stream_seq(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();
    let stored = append(&pool, g, &[vote("slot_2", "D1"), vote("slot_3", "D1")])
        .await
        .expect("append ok");
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].stream_seq, 1);
    assert_eq!(stored[1].stream_seq, 2);

    let more = append(&pool, g, &[vote("slot_4", "D1")]).await.unwrap();
    assert_eq!(more[0].stream_seq, 3, "next append continues the stream");

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 3);
    let seqs: Vec<i64> = loaded.iter().map(|e| e.stream_seq).collect();
    assert_eq!(seqs, vec![1, 2, 3], "load_stream is ordered");
}

/// Defensive uniqueness: a writer that bypasses the store path and manually
/// targets a stale `stream_seq` still trips the database constraint.
#[sqlx::test(migrations = "./migrations")]
async fn stale_manual_insert_conflicts(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();

    // Simulate a stale writer that observed an empty stream, then bypassed
    // append_in_tx's stream lock and assigned stream_seq itself.
    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();

    // B computes its base BEFORE A commits (so it still sees an empty stream),
    // then bypasses append_in_tx and uses that stale value directly.
    let base_b: i64 =
        sqlx::query("SELECT COALESCE(MAX(stream_seq),0) AS m FROM events WHERE stream_id = $1")
            .bind(g)
            .fetch_one(&mut *tx_b)
            .await
            .unwrap()
            .get("m");
    assert_eq!(base_b, 0, "B observes an empty stream");
    let b_target = base_b + 1; // 1

    // A appends at stream_seq = 1 and commits — the winner.
    let a = append_in_tx(&mut tx_a, g, &[vote("slot_2", "D1")]).await;
    assert!(a.is_ok(), "first appender succeeds: {a:?}");
    tx_a.commit().await.unwrap();

    // B now inserts at its stale target stream_seq = 1 → UNIQUE violation.
    let ev = vote("slot_3", "D1");
    let actor_json = serde_json::to_value(&ev.actor).unwrap();
    let res = sqlx::query(
        "INSERT INTO events (stream_id, stream_seq, kind, version, payload, actor, occurred_at, meta) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb)",
    )
    .bind(g)
    .bind(b_target)
    .bind(&ev.kind)
    .bind(ev.version)
    .bind(&ev.payload)
    .bind(&actor_json)
    .bind(ev.occurred_at)
    .execute(&mut *tx_b)
    .await;

    let conflicted = matches!(
        &res,
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505")
    );
    assert!(
        conflicted,
        "B's stale append must hit the UNIQUE constraint, got {res:?}"
    );
    tx_b.rollback().await.unwrap();

    // Exactly one event survived the race.
    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 1, "exactly one append survived the race");
    assert_eq!(loaded[0].stream_seq, 1);
    assert_eq!(loaded[0].payload["target"], "slot_2", "A won");
}

/// The store's own code path serializes concurrent appends to the same stream:
/// the second appender waits for the first transaction, observes the committed
/// head, and lands at the next stream sequence.
#[sqlx::test(migrations = "./migrations")]
async fn append_in_tx_serializes_concurrent_appends(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();

    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();

    // A inserts (uncommitted) at seq=1 and holds the transaction-scoped stream
    // append lock until commit.
    append_in_tx(&mut tx_a, g, &[vote("slot_2", "D1")])
        .await
        .unwrap();

    // B (separate connection/tx) tries to append concurrently. It waits on A's
    // stream append lock, then reads the committed head and uses seq=2.
    let appender_b = async { append_in_tx(&mut tx_b, g, &[vote("slot_3", "D1")]).await };
    let committer_a = async {
        // Yield so B reaches the stream lock before A commits.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        tx_a.commit().await
    };
    let (b_res, a_commit) = tokio::join!(appender_b, committer_a);
    a_commit.unwrap();

    let b_stored = b_res.expect("second appender should wait and then succeed");
    assert_eq!(b_stored[0].stream_seq, 2);
    tx_b.commit().await.unwrap();

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].payload["target"], "slot_2");
    assert_eq!(loaded[1].payload["target"], "slot_3");
}

/// A later appender lands at the next free slot.
#[sqlx::test(migrations = "./migrations")]
async fn later_append_continues_stream(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();
    append(&pool, g, &[vote("slot_2", "D1")]).await.unwrap();

    // A fresh append reads the committed head and succeeds at stream_seq = 2.
    let retried = append(&pool, g, &[vote("slot_3", "D1")]).await.unwrap();
    assert_eq!(retried[0].stream_seq, 2);
}

/// Append-only invariant: the database itself rejects UPDATE and DELETE on
/// `events`. There is no mutation code path in the crate; this proves the
/// belt-and-suspenders trigger too.
#[sqlx::test(migrations = "./migrations")]
async fn events_table_is_append_only(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();
    append(&pool, g, &[vote("slot_2", "D1")]).await.unwrap();

    let upd = sqlx::query("UPDATE events SET kind = 'Tampered' WHERE stream_id = $1")
        .bind(g)
        .execute(&pool)
        .await;
    assert!(upd.is_err(), "UPDATE on events must be rejected");

    let del = sqlx::query("DELETE FROM events WHERE stream_id = $1")
        .bind(g)
        .execute(&pool)
        .await;
    assert!(del.is_err(), "DELETE on events must be rejected");

    // The row is still there, untampered.
    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].kind, "VoteSubmitted");
}
