//! Integration tests for the event store against REAL Postgres.
//!
//! `#[sqlx::test]` provisions an ephemeral per-test database and applies the
//! migrations in `./migrations`, then hands us a `PgPool`. It requires
//! `DATABASE_URL` to be set (the compose Postgres, `:5544`); if it is unset the
//! test FAILS to connect — it never silently passes without a DB.

use eventstore::{append, append_in_tx, load_stream, ActorId, EventInput, StoreError};
use sqlx::Row;
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

static ENCRYPTION_ENV_LOCK: Mutex<()> = Mutex::new(());

struct EncryptionEnvGuard {
    prior_key: Option<String>,
    prior_kid: Option<String>,
    prior_keys: Option<String>,
    _lock: MutexGuard<'static, ()>,
}

impl EncryptionEnvGuard {
    fn new() -> Self {
        let lock = ENCRYPTION_ENV_LOCK.lock().unwrap();
        let guard = Self {
            prior_key: std::env::var("FMARCH_EVENT_ENCRYPTION_KEY").ok(),
            prior_kid: std::env::var("FMARCH_EVENT_ENCRYPTION_KID").ok(),
            prior_keys: std::env::var("FMARCH_EVENT_ENCRYPTION_KEYS").ok(),
            _lock: lock,
        };
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEY");
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KID");
        std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS");
        guard
    }

    fn set_active(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KID", kid);
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEY", key);
    }

    fn set_keyring(&self, keys: &str) {
        std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEYS", keys);
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        match &self.prior_key {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEY", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEY"),
        }
        match &self.prior_kid {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KID", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KID"),
        }
        match &self.prior_keys {
            Some(value) => std::env::set_var("FMARCH_EVENT_ENCRYPTION_KEYS", value),
            None => std::env::remove_var("FMARCH_EVENT_ENCRYPTION_KEYS"),
        }
    }
}

fn vote(target: &str, phase: &str) -> EventInput {
    EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "target": target, "phase_id": phase, "weight": 1.0 }),
        ActorId::Slot("slot_1".into()),
        1,
    )
}

fn role_assigned(slot: &str, role_key: &str) -> EventInput {
    EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({
            "slot_id": slot,
            "role_key": role_key,
            "alignment": "mafia",
            "role_effects": ["godfather"],
        }),
        ActorId::Host,
        1,
    )
}

fn private_post(channel: &str, body: &str) -> EventInput {
    EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": channel,
            "slot_or_user": { "slot": "slot_1" },
            "body": body,
            "phase_id": "D01",
        }),
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

#[sqlx::test(migrations = "./migrations")]
async fn private_event_payloads_are_encrypted_at_rest_and_decrypted_on_load(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let g = Uuid::new_v4();
    append(
        &pool,
        g,
        &[
            role_assigned("slot_1", "godfather"),
            private_post("private:mafia_day_chat", "shoot slot_2 tonight"),
        ],
    )
    .await
    .expect("append encrypted private events");

    let raw_rows =
        sqlx::query("SELECT kind, payload FROM events WHERE stream_id = $1 ORDER BY stream_seq")
            .bind(g)
            .fetch_all(&pool)
            .await
            .unwrap();
    let raw_role: serde_json::Value = raw_rows[0].get("payload");
    assert_eq!(raw_rows[0].get::<String, _>("kind"), "RoleAssigned");
    assert_eq!(raw_role["slot_id"], "slot_1");
    assert!(raw_role.get("role_key").is_none());
    assert!(raw_role["private"]["ciphertext"].is_string());
    assert_eq!(raw_role["private"]["kid"], "local-dev");

    let raw_post: serde_json::Value = raw_rows[1].get("payload");
    assert_eq!(raw_rows[1].get::<String, _>("kind"), "PostSubmitted");
    assert_eq!(raw_post["channel_id"], "private:mafia_day_chat");
    assert_eq!(raw_post["slot_or_user"]["slot"], "slot_1");
    assert_eq!(raw_post["phase_id"], "D01");
    assert!(raw_post.get("body").is_none());
    assert!(raw_post["body_private"]["ciphertext"].is_string());
    assert_eq!(raw_post["body_private"]["kid"], "local-dev");

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded[0].payload["role_key"], "godfather");
    assert_eq!(loaded[0].payload["alignment"], "mafia");
    assert_eq!(
        loaded[0].payload["role_effects"],
        serde_json::json!(["godfather"])
    );
    assert_eq!(loaded[1].payload["body"], "shoot slot_2 tonight");
}

#[sqlx::test(migrations = "./migrations")]
async fn encrypted_payloads_resolve_by_stored_kid_after_key_rotation(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    let g = Uuid::new_v4();

    env.set_active("old-kid", "old private event encryption key");
    append(&pool, g, &[role_assigned("slot_1", "godfather")])
        .await
        .expect("append old-key private event");

    env.set_active("new-kid", "new private event encryption key");
    append(
        &pool,
        g,
        &[private_post(
            "private:mafia_day_chat",
            "coordinate with the new key",
        )],
    )
    .await
    .expect("append new-key private event");

    let raw_rows =
        sqlx::query("SELECT kind, payload FROM events WHERE stream_id = $1 ORDER BY stream_seq")
            .bind(g)
            .fetch_all(&pool)
            .await
            .unwrap();
    let raw_role: serde_json::Value = raw_rows[0].get("payload");
    let raw_post: serde_json::Value = raw_rows[1].get("payload");
    assert_eq!(raw_role["private"]["kid"], "old-kid");
    assert_eq!(raw_post["body_private"]["kid"], "new-kid");

    let missing_old = load_stream(&pool, g)
        .await
        .expect_err("old envelope must not decrypt with only the new active key");
    assert!(
        missing_old.to_string().contains("old-kid"),
        "missing-key error should name the envelope kid, got {missing_old}"
    );

    env.set_keyring("old-kid=old private event encryption key");
    let loaded = load_stream(&pool, g)
        .await
        .expect("old and new encrypted envelopes should coexist");
    assert_eq!(loaded[0].payload["role_key"], "godfather");
    assert_eq!(loaded[1].payload["body"], "coordinate with the new key");
}

/// Optimistic concurrency: two transactions both try to append at the SAME
/// `stream_seq`. Exactly one commits; the other trips the UNIQUE constraint and
/// gets a typed, retryable `Conflict` — not a panic.
#[sqlx::test(migrations = "./migrations")]
async fn racing_appends_one_conflicts(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();

    // Two concurrent transactions, BOTH observing an empty stream (base = 0) and
    // both targeting stream_seq = 1. This is the real optimistic-concurrency
    // race: two command handlers that loaded the aggregate at the same seq.
    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();

    // B computes its base BEFORE A commits (so it still sees an empty stream),
    // mirroring `append_in_tx`'s internal `current_max + 1`.
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

    // B now inserts at its stale target stream_seq = 1 → UNIQUE violation. The
    // store maps it to a typed, retryable Conflict (never a panic).
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

/// The store's OWN code path returns the typed `StoreError::Conflict`: two
/// concurrent `append_in_tx` calls both compute base=0; one commits, the other's
/// INSERT blocks then surfaces the UNIQUE violation mapped to `Conflict`.
#[sqlx::test(migrations = "./migrations")]
async fn append_in_tx_returns_typed_conflict(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();

    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();

    // A inserts (uncommitted) at seq=1.
    append_in_tx(&mut tx_a, g, &[vote("slot_2", "D1")])
        .await
        .unwrap();

    // B (separate connection/tx) tries to append concurrently. Its base read
    // sees the empty stream (A uncommitted), so it targets seq=1. The INSERT
    // blocks on A's uncommitted row, so drive A's commit from another task.
    let appender_b = async { append_in_tx(&mut tx_b, g, &[vote("slot_3", "D1")]).await };
    let committer_a = async {
        // Yield so B's INSERT is in-flight and blocked before A commits.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        tx_a.commit().await
    };
    let (b_res, a_commit) = tokio::join!(appender_b, committer_a);
    a_commit.unwrap();

    match b_res {
        Err(StoreError::Conflict {
            stream_id,
            stream_seq,
        }) => {
            assert_eq!(stream_id, g);
            assert_eq!(stream_seq, 1);
            assert!(StoreError::Conflict {
                stream_id,
                stream_seq
            }
            .is_retryable());
        }
        other => panic!("expected typed StoreError::Conflict from append_in_tx, got {other:?}"),
    }
    tx_b.rollback().await.unwrap();

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 1);
}

/// The losing appender can reload and retry, landing at the next free slot.
#[sqlx::test(migrations = "./migrations")]
async fn conflict_is_retryable(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();
    append(&pool, g, &[vote("slot_2", "D1")]).await.unwrap();

    // Simulate a stale appender that retries: a fresh append() recomputes the
    // base and succeeds at stream_seq = 2.
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
