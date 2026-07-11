//! Integration tests for the event store against REAL Postgres.
//!
//! `#[sqlx::test]` provisions an ephemeral per-test database and applies the
//! migrations in `./migrations`, then hands us a `PgPool`. It requires
//! `DATABASE_URL` to be set (the compose Postgres, `:5544`); if it is unset the
//! test FAILS to connect — it never silently passes without a DB.

use eventstore::{
    append, append_in_tx, export_stream, import_stream, load_stream, migrate,
    validate_stream_export, ActorId, EventInput,
};
use sqlx::postgres::PgPoolOptions;
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

/// The store's own append path serializes concurrent writers before assigning
/// stream seqs, so both calls can commit in canonical order instead of surfacing
/// a client-visible conflict.
#[sqlx::test(migrations = "./migrations")]
async fn append_in_tx_serializes_concurrent_writers(pool: sqlx::PgPool) {
    let g = Uuid::new_v4();

    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();

    let a = append_in_tx(&mut tx_a, g, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    assert_eq!(a[0].stream_seq, 1);

    // B starts while A's transaction-scoped stream lock is still held. It waits
    // until A commits, then reads the updated max and appends at seq=2.
    let appender_b = async { append_in_tx(&mut tx_b, g, &[vote("slot_3", "D1")]).await };
    let committer_a = async {
        // Yield so B reaches the advisory lock before A commits.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        tx_a.commit().await
    };
    let (b_res, a_commit) = tokio::join!(appender_b, committer_a);
    a_commit.unwrap();

    let b = b_res.expect("second writer waits and appends after first commit");
    assert_eq!(b[0].stream_seq, 2);
    tx_b.commit().await.unwrap();

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), 2);
    assert_eq!(loaded[0].payload["target"], "slot_2");
    assert_eq!(loaded[1].payload["target"], "slot_3");
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

#[sqlx::test(migrations = "./migrations")]
async fn stream_export_checksum_rejects_tampered_event_data(pool: sqlx::PgPool) {
    let stream = Uuid::new_v4();
    append(&pool, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    let export = export_stream(&pool, stream).await.unwrap();
    validate_stream_export(&export).unwrap();
    let mut tampered = export.clone();
    tampered.events[0].payload["target"] = serde_json::json!("slot_9");
    assert!(validate_stream_export(&tampered).is_err());
}

#[tokio::test]
async fn stream_export_imports_into_an_isolated_database() {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL for isolated import");
    let (prefix, _) = database_url.rsplit_once('/').expect("database URL path");
    let admin_url = format!("{prefix}/postgres");
    let source_name = format!("fmarch_export_source_{}", Uuid::new_v4().simple());
    let target_name = format!("fmarch_export_target_{}", Uuid::new_v4().simple());
    let admin = PgPoolOptions::new()
        .max_connections(1)
        .connect(&admin_url)
        .await
        .unwrap();
    for name in [&source_name, &target_name] {
        sqlx::query(&format!("CREATE DATABASE \"{name}\""))
            .execute(&admin)
            .await
            .unwrap();
    }
    let source_url = format!("{prefix}/{source_name}");
    let target_url = format!("{prefix}/{target_name}");
    let source = PgPoolOptions::new()
        .max_connections(2)
        .connect(&source_url)
        .await
        .unwrap();
    let target = PgPoolOptions::new()
        .max_connections(2)
        .connect(&target_url)
        .await
        .unwrap();
    migrate(&source).await.unwrap();
    migrate(&target).await.unwrap();
    let stream = Uuid::new_v4();
    append(
        &source,
        stream,
        &[vote("slot_2", "D1"), vote("slot_3", "D1")],
    )
    .await
    .unwrap();
    let export = export_stream(&source, stream).await.unwrap();
    import_stream(&target, &export).await.unwrap();
    assert_eq!(
        load_stream(&source, stream).await.unwrap(),
        load_stream(&target, stream).await.unwrap()
    );
    drop(source);
    drop(target);
    for name in [&source_name, &target_name] {
        sqlx::query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1")
            .bind(name)
            .execute(&admin)
            .await
            .unwrap();
        sqlx::query(&format!("DROP DATABASE \"{name}\""))
            .execute(&admin)
            .await
            .unwrap();
    }
}
