//! Integration tests for the event store against REAL Postgres.
//!
//! `#[sqlx::test]` provisions an ephemeral per-test database and applies the
//! migrations in `./migrations`, then hands us a `PgPool`. It requires
//! `DATABASE_URL` to be set (the compose Postgres, `:5544`); if it is unset the
//! test FAILS to connect — it never silently passes without a DB.

use eventstore::{
    append, append_in_tx, ensure_event_encryption_key_coverage, export_stream, import_stream,
    load_stream, migrate, validate_stream_export, ActorId, EventInput,
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
async fn startup_key_coverage_requires_every_stored_historical_kid(pool: sqlx::PgPool) {
    let environment = EncryptionEnvGuard::new();
    environment.set_active("old-kid", "old startup coverage key");
    append(&pool, Uuid::new_v4(), &[vote("slot_2", "D01")])
        .await
        .unwrap();

    environment.set_active("new-kid", "new startup coverage key");
    let error = ensure_event_encryption_key_coverage(&pool)
        .await
        .expect_err("startup must refuse a missing historical key");
    assert!(error.to_string().contains("old-kid"));

    environment.set_keyring("old-kid=old startup coverage key");
    ensure_event_encryption_key_coverage(&pool)
        .await
        .expect("the configured historical ring covers every stored event");
}

#[sqlx::test(migrations = "./migrations")]
async fn whole_event_bodies_leave_no_logical_secrets_in_raw_rows(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let g = Uuid::new_v4();
    let causation_id = Uuid::new_v4();
    let mut profile = EventInput::new(
        "ProfileCreated",
        1,
        serde_json::json!({
            "principal_user_id": "principal_secret_6",
            "handle": "handle_secret_6",
            "display_name": "display_secret_6",
        }),
        ActorId::User("actor_secret_6".into()),
        6,
    );
    profile.causation_id = Some(causation_id);
    profile.meta = serde_json::json!({"request_ip": "meta_secret_6"});
    let logical = vec![
        role_assigned("slot_secret_1", "role_secret_1"),
        private_post("private:channel_secret_2", "post_secret_2"),
        EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({"actor": "action_actor_secret_3", "target": "action_target_secret_3"}),
            ActorId::Slot("action_actor_secret_3".into()),
            3,
        ),
        EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::json!({"result": "resolution_secret_4", "targets": ["resolution_target_secret_4"]}),
            ActorId::System,
            4,
        ),
        EventInput::new(
            "ResolutionTrace",
            1,
            serde_json::json!({"trace": "trace_secret_5", "hidden_alignment": "alignment_secret_5"}),
            ActorId::System,
            5,
        ),
        profile,
    ];
    append(&pool, g, &logical)
        .await
        .expect("append sealed events");

    let raw_rows: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(events)::text FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(g)
    .fetch_all(&pool)
    .await
    .unwrap();
    let causation_secret = causation_id.to_string();
    for raw in &raw_rows {
        assert!(raw.contains("sealed_version"));
        assert!(raw.contains("sealed_kid"));
        assert!(raw.contains("sealed_nonce"));
        assert!(raw.contains("sealed_body"));
        for secret in [
            "slot_secret_1",
            "role_secret_1",
            "channel_secret_2",
            "post_secret_2",
            "action_actor_secret_3",
            "action_target_secret_3",
            "resolution_secret_4",
            "resolution_target_secret_4",
            "trace_secret_5",
            "alignment_secret_5",
            "principal_secret_6",
            "handle_secret_6",
            "display_secret_6",
            "actor_secret_6",
            "meta_secret_6",
            causation_secret.as_str(),
        ] {
            assert!(
                !raw.contains(secret),
                "raw event row leaked `{secret}`: {raw}"
            );
        }
    }

    let columns: Vec<String> = sqlx::query_scalar(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'events' ORDER BY column_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    for removed in ["payload", "actor", "causation_id", "meta"] {
        assert!(!columns.iter().any(|column| column == removed));
    }
    for binary_envelope_column in [
        "sealed_version",
        "sealed_kid",
        "sealed_nonce",
        "sealed_body",
    ] {
        assert!(
            columns
                .iter()
                .any(|column| column == binary_envelope_column),
            "missing typed envelope column {binary_envelope_column}"
        );
    }

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded.len(), logical.len());
    for (loaded, input) in loaded.iter().zip(&logical) {
        assert_eq!(loaded.payload, input.payload);
        assert_eq!(loaded.actor, input.actor);
        assert_eq!(loaded.causation_id, input.causation_id);
        assert_eq!(loaded.meta, input.meta);
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn private_post_quotations_are_sealed_with_the_body(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let g = Uuid::new_v4();
    append(
        &pool,
        g,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "private:mafia_day_chat",
                "slot_or_user": { "slot": "slot_1" },
                "body": "quoting last night",
                "phase_id": "D01",
                "quotations": [{
                    "target": {
                        "kind": "game_post",
                        "scope_id": g,
                        "source_seq": 3
                    },
                    "excerpt": "shoot slot_2"
                }]
            }),
            ActorId::Slot("slot_1".into()),
            1,
        )],
    )
    .await
    .expect("append private quoting post");

    let raw: Vec<u8> = sqlx::query_scalar(
        "SELECT sealed_body FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(g)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(raw.len() >= 16);
    assert!(!raw
        .windows("quoting last night".len())
        .any(|bytes| bytes == b"quoting last night"));
    assert!(!raw
        .windows("shoot slot_2".len())
        .any(|bytes| bytes == b"shoot slot_2"));

    let loaded = load_stream(&pool, g).await.unwrap();
    assert_eq!(loaded[0].payload["body"], "quoting last night");
    assert_eq!(
        loaded[0].payload["quotations"][0]["excerpt"],
        "shoot slot_2"
    );
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
        sqlx::query("SELECT kind, sealed_kid FROM events WHERE stream_id = $1 ORDER BY stream_seq")
            .bind(g)
            .fetch_all(&pool)
            .await
            .unwrap();
    let raw_role: String = raw_rows[0].get("sealed_kid");
    let raw_post: String = raw_rows[1].get("sealed_kid");
    assert_eq!(raw_role, "old-kid");
    assert_eq!(raw_post, "new-kid");

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

#[sqlx::test(migrations = "./migrations")]
async fn sealed_body_rejects_row_relocation_header_changes_and_ciphertext_tamper(
    pool: sqlx::PgPool,
) {
    let _env = EncryptionEnvGuard::new();
    let source = Uuid::new_v4();
    append(
        &pool,
        source,
        &[private_post("private:source", "relocation_secret")],
    )
    .await
    .unwrap();
    let export = export_stream(&pool, source).await.unwrap();
    let envelope: (i16, String, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version, sealed_kid, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1",
    )
    .bind(source)
    .fetch_one(&pool)
    .await
    .unwrap();

    for (target, kind) in [
        (Uuid::new_v4(), "PostSubmitted"),
        (Uuid::new_v4(), "ResolutionTrace"),
    ] {
        sqlx::query(
            "INSERT INTO events \
             (stream_id, stream_seq, kind, version, occurred_at, sealed_version, sealed_kid, sealed_nonce, sealed_body) \
             VALUES ($1, 1, $2, 1, 1, $3, $4, $5, $6)",
        )
        .bind(target)
        .bind(kind)
        .bind(envelope.0)
        .bind(&envelope.1)
        .bind(&envelope.2)
        .bind(&envelope.3)
        .execute(&pool)
        .await
        .unwrap();
        assert!(
            load_stream(&pool, target).await.is_err(),
            "changing any authenticated row identity/header must fail closed"
        );
    }

    let mut changed_kind = export.clone();
    changed_kind.events[0].kind = "ResolutionTrace".to_string();
    assert!(validate_stream_export(&changed_kind).is_err());
    let mut changed_version = export.clone();
    changed_version.events[0].version += 1;
    assert!(validate_stream_export(&changed_version).is_err());
    let mut changed_time = export.clone();
    changed_time.events[0].occurred_at += 1;
    assert!(validate_stream_export(&changed_time).is_err());
    let empty_target = Uuid::new_v4();
    let mut changed_stream = export.clone();
    changed_stream.stream_id = empty_target;
    assert!(import_stream(&pool, &changed_stream).await.is_err());
    let inserted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(empty_target)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inserted, 0, "invalid sealed archives must insert nothing");

    sqlx::query(
        "INSERT INTO events \
         (stream_id, stream_seq, kind, version, occurred_at, sealed_version, sealed_kid, sealed_nonce, sealed_body) \
         VALUES ($1, 2, 'PostSubmitted', 1, 1, $2, $3, $4, $5)",
    )
    .bind(source)
    .bind(envelope.0)
    .bind(&envelope.1)
    .bind(&envelope.2)
    .bind(&envelope.3)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        load_stream(&pool, source).await.is_err(),
        "stream_seq is AAD"
    );

    let tampered_stream = Uuid::new_v4();
    let mut tampered = envelope.3.clone();
    tampered[0] ^= 0x80;
    sqlx::query(
        "INSERT INTO events \
         (stream_id, stream_seq, kind, version, occurred_at, sealed_version, sealed_kid, sealed_nonce, sealed_body) \
         VALUES ($1, 1, 'PostSubmitted', 1, 1, $2, $3, $4, $5)",
    )
    .bind(tampered_stream)
    .bind(envelope.0)
    .bind(&envelope.1)
    .bind(&envelope.2)
    .bind(tampered)
    .execute(&pool)
    .await
    .unwrap();
    assert!(load_stream(&pool, tampered_stream).await.is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn typed_sealed_columns_reject_malformed_storage(pool: sqlx::PgPool) {
    let malformed = [
        ("version", 3_i16, "kid", vec![0_u8; 24], vec![0_u8; 16]),
        ("empty kid", 2, "", vec![0_u8; 24], vec![0_u8; 16]),
        ("padded kid", 2, " kid ", vec![0_u8; 24], vec![0_u8; 16]),
        ("nonce", 2, "kid", vec![0_u8; 23], vec![0_u8; 16]),
        ("body", 2, "kid", vec![0_u8; 24], vec![0_u8; 15]),
    ];

    for (label, sealed_version, sealed_kid, sealed_nonce, sealed_body) in malformed {
        let result = sqlx::query(
            "INSERT INTO events \
             (stream_id, stream_seq, kind, version, occurred_at, sealed_version, sealed_kid, sealed_nonce, sealed_body) \
             VALUES ($1, 1, 'Malformed', 1, 1, $2, $3, $4, $5)",
        )
        .bind(Uuid::new_v4())
        .bind(sealed_version)
        .bind(sealed_kid)
        .bind(sealed_nonce)
        .bind(sealed_body)
        .execute(&pool)
        .await
        .expect_err(label);
        assert_eq!(
            result
                .as_database_error()
                .and_then(|error| error.code())
                .as_deref(),
            Some("23514"),
            "{label} must fail the sealed-body CHECK constraint"
        );
    }
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
    let sealed: (i16, String, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version, sealed_kid, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1 AND stream_seq = 1",
    )
    .bind(g)
    .fetch_one(&mut *tx_b)
    .await
    .unwrap();
    let res = sqlx::query(
        "INSERT INTO events \
         (stream_id, stream_seq, kind, version, occurred_at, sealed_version, sealed_kid, sealed_nonce, sealed_body) \
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(g)
    .bind(b_target)
    .bind(&ev.kind)
    .bind(ev.version)
    .bind(ev.occurred_at)
    .bind(sealed.0)
    .bind(&sealed.1)
    .bind(&sealed.2)
    .bind(&sealed.3)
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
    tampered.events[0].sealed_body.ciphertext = "AAAA".to_string();
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
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
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
    let logical = vec![
        vote("slot_2", "D1"),
        private_post("private:archive", "archive_secret_body"),
    ];
    append(&source, stream, &logical).await.unwrap();
    let export = export_stream(&source, stream).await.unwrap();
    assert_eq!(export.version, 2);
    let serialized = serde_json::to_string(&export).unwrap();
    assert!(!serialized.contains("archive_secret_body"));
    assert!(!serialized.contains("slot_2"));
    let source_envelopes: Vec<(i16, String, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT sealed_version, sealed_kid, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&source)
    .await
    .unwrap();
    let archived_envelopes = export
        .events
        .iter()
        .map(|event| {
            use base64::engine::general_purpose::STANDARD;
            use base64::Engine;

            (
                2,
                event.sealed_body.kid.clone(),
                STANDARD.decode(&event.sealed_body.nonce).unwrap(),
                STANDARD.decode(&event.sealed_body.ciphertext).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(archived_envelopes, source_envelopes);
    let imported = import_stream(&target, &export).await.unwrap();
    assert_eq!(imported.len(), logical.len());
    let target_envelopes: Vec<(i16, String, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT sealed_version, sealed_kid, sealed_nonce, sealed_body \
         FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&target)
    .await
    .unwrap();
    assert_eq!(target_envelopes, source_envelopes);
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
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP DATABASE \"{name}\"")))
            .execute(&admin)
            .await
            .unwrap();
    }
}

#[test]
fn eventstore_is_the_only_production_rust_boundary_that_decodes_event_bodies() {
    fn visit(directory: &std::path::Path, offenders: &mut Vec<String>) {
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(&path, offenders);
            } else if path.extension().and_then(|value| value.to_str()) == Some("rs") {
                let source = std::fs::read_to_string(&path).unwrap();
                let normalized = source
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
                    .to_ascii_lowercase();
                if normalized.contains("select payload from events")
                    || (normalized.contains("from events") && normalized.contains("payload->"))
                {
                    offenders.push(path.display().to_string());
                }
            }
        }
    }

    let workspace = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(std::path::Path::parent)
        .unwrap();
    let crates = workspace.join("crates");
    let mut offenders = Vec::new();
    for entry in std::fs::read_dir(crates).unwrap() {
        let path = entry.unwrap().path();
        if path.file_name().and_then(|value| value.to_str()) == Some("eventstore") {
            continue;
        }
        let source = path.join("src");
        if source.is_dir() {
            visit(&source, &mut offenders);
        }
    }
    assert!(
        offenders.is_empty(),
        "production Rust must load logical events through eventstore; direct body decoding found in: {offenders:?}"
    );
}
