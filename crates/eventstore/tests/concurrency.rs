//! Real-Postgres proofs for the append-only encrypted event store.

use base64::Engine as _;
use eventstore::{
    append, append_in_tx, audit_event_encryption_key_coverage, encrypt_delivery_credential,
    encrypt_private_projection, ensure_event_encryption_key_readiness, export_stream,
    import_stream, load_stream, migrate, rewrap_stream_data_keys, rotate_stream_data_key,
    validate_stream_export, ActorId, EventInput, ExportEvent, ExportStreamKey, StreamExport,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

static ENCRYPTION_ENV_LOCK: Mutex<()> = Mutex::new(());

struct EncryptionEnvGuard {
    prior: Vec<(&'static str, Option<String>)>,
    _lock: MutexGuard<'static, ()>,
}

impl EncryptionEnvGuard {
    fn new() -> Self {
        let lock = ENCRYPTION_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let names = [
            "FMARCH_EVENT_WRAP_KEY",
            "FMARCH_EVENT_WRAP_KID",
            "FMARCH_EVENT_WRAP_KEYS",
            "FMARCH_EVENT_ARCHIVE_KEY",
            "FMARCH_EVENT_ARCHIVE_KID",
            "FMARCH_EVENT_ARCHIVE_KEYS",
        ];
        let prior = names
            .into_iter()
            .map(|name| (name, std::env::var(name).ok()))
            .collect();
        for name in names {
            std::env::remove_var(name);
        }
        Self { prior, _lock: lock }
    }

    fn set_wrap(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_WRAP_KID", kid);
        std::env::set_var("FMARCH_EVENT_WRAP_KEY", key);
    }

    fn set_wrap_ring(&self, keys: Option<&str>) {
        match keys {
            Some(keys) => std::env::set_var("FMARCH_EVENT_WRAP_KEYS", keys),
            None => std::env::remove_var("FMARCH_EVENT_WRAP_KEYS"),
        }
    }

    fn set_archive(&self, kid: &str, key: &str) {
        std::env::set_var("FMARCH_EVENT_ARCHIVE_KID", kid);
        std::env::set_var("FMARCH_EVENT_ARCHIVE_KEY", key);
    }
}

impl Drop for EncryptionEnvGuard {
    fn drop(&mut self) {
        for (name, value) in &self.prior {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
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

fn private_post(body: &str) -> EventInput {
    EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "private:mafia",
            "slot_or_user": { "slot": "slot_1" },
            "body": body,
            "phase_id": "D01",
        }),
        ActorId::Slot("slot_1".into()),
        1,
    )
}

fn refresh_checksum(export: &mut StreamExport) {
    #[derive(Serialize)]
    struct Manifest<'a> {
        version: u16,
        stream_id: Uuid,
        active_epoch: Option<i64>,
        stream_keys: &'a [ExportStreamKey],
        events: &'a [ExportEvent],
    }
    let bytes = serde_json::to_vec(&Manifest {
        version: export.version,
        stream_id: export.stream_id,
        active_epoch: export.active_epoch,
        stream_keys: &export.stream_keys,
        events: &export.events,
    })
    .unwrap();
    export.checksum_sha256 = format!("{:x}", Sha256::digest(bytes));
}

#[sqlx::test(migrations = "./migrations")]
async fn append_assigns_sequential_stream_seq(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let stream = Uuid::new_v4();
    let stored = append(&pool, stream, &[vote("slot_2", "D1"), vote("slot_3", "D1")])
        .await
        .unwrap();
    assert_eq!(
        stored
            .iter()
            .map(|event| event.stream_seq)
            .collect::<Vec<_>>(),
        [1, 2]
    );
    assert_eq!(
        append(&pool, stream, &[vote("slot_4", "D1")])
            .await
            .unwrap()[0]
            .stream_seq,
        3
    );
    assert_eq!(load_stream(&pool, stream).await.unwrap().len(), 3);
}

#[sqlx::test(migrations = "./migrations")]
async fn old_and_new_dek_epochs_coexist_in_one_stream(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "runtime wrapping material v1");
    let stream = Uuid::new_v4();
    append(&pool, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    assert_eq!(rotate_stream_data_key(&pool, stream).await.unwrap(), 2);
    append(&pool, stream, &[private_post("epoch two secret")])
        .await
        .unwrap();

    let epochs = sqlx::query_scalar::<_, i64>(
        "SELECT stream_key_epoch FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(epochs, [1, 2]);
    let loaded = load_stream(&pool, stream).await.unwrap();
    assert_eq!(loaded[0].payload["target"], "slot_2");
    assert_eq!(loaded[1].payload["body"], "epoch two secret");
}

#[sqlx::test(migrations = "./migrations")]
async fn kek_rewrap_changes_only_stream_key_rows(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "runtime wrapping material v1");
    let stream = Uuid::new_v4();
    append(&pool, stream, &[private_post("rewrap invariant")])
        .await
        .unwrap();
    rotate_stream_data_key(&pool, stream).await.unwrap();
    append(&pool, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    let before: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(events)::text FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&pool)
    .await
    .unwrap();

    env.set_wrap("runtime-v2", "runtime wrapping material v2");
    env.set_wrap_ring(Some("runtime-v1=runtime wrapping material v1"));
    assert_eq!(rewrap_stream_data_keys(&pool, stream).await.unwrap(), 2);
    let after: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(events)::text FROM events WHERE stream_id = $1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(after, before, "KEK rewrap must not mutate event history");
    let kids = sqlx::query_scalar::<_, String>(
        "SELECT wrap_kid FROM event_stream_keys WHERE stream_id = $1 ORDER BY key_epoch",
    )
    .bind(stream)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(kids, ["runtime-v2", "runtime-v2"]);
    env.set_wrap_ring(None);
    assert_eq!(load_stream(&pool, stream).await.unwrap().len(), 2);
    audit_event_encryption_key_coverage(&pool)
        .await
        .expect("a stream-only old KEK is retireable after every DEK is rewrapped");
}

#[sqlx::test(migrations = "./migrations")]
async fn startup_audit_rejects_missing_and_wrong_runtime_wrapping_keys(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "correct runtime wrapping material");
    append(&pool, Uuid::new_v4(), &[vote("slot_2", "D1")])
        .await
        .unwrap();

    env.set_wrap("runtime-v2", "another wrapping material");
    let missing = audit_event_encryption_key_coverage(&pool)
        .await
        .expect_err("historical wrapping kid is required");
    assert!(missing.to_string().contains("runtime-v1"));

    env.set_wrap_ring(Some("runtime-v1=wrong runtime wrapping material"));
    let wrong = audit_event_encryption_key_coverage(&pool)
        .await
        .expect_err("matching kid with wrong material must not satisfy readiness");
    assert!(wrong.to_string().contains("unwrap stream data key"));

    env.set_wrap_ring(Some("runtime-v1=correct runtime wrapping material"));
    audit_event_encryption_key_coverage(&pool).await.unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn stream_key_epochs_cannot_be_removed_rolled_back_or_hidden_from_readiness(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "runtime wrapping material v1");
    let stream = Uuid::new_v4();
    append(&pool, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    assert_eq!(rotate_stream_data_key(&pool, stream).await.unwrap(), 2);

    for statement in [
        "DELETE FROM event_stream_key_state",
        "DELETE FROM event_stream_keys",
        "TRUNCATE event_stream_key_state",
        "TRUNCATE event_stream_keys CASCADE",
    ] {
        let error = sqlx::query(statement)
            .execute(&pool)
            .await
            .expect_err("stream key custody must be append-only and monotonic");
        assert!(
            error.to_string().contains("event stream key"),
            "unexpected guard error for `{statement}`: {error}"
        );
    }

    sqlx::query("ALTER TABLE event_stream_key_state DISABLE TRIGGER event_stream_key_state_guard")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE event_stream_key_state SET active_epoch = 1 WHERE stream_id = $1")
        .bind(stream)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("ALTER TABLE event_stream_key_state ENABLE TRIGGER event_stream_key_state_guard")
        .execute(&pool)
        .await
        .unwrap();

    let error = audit_event_encryption_key_coverage(&pool)
        .await
        .expect_err("readiness must reject a rolled-back active epoch");
    assert!(error
        .to_string()
        .contains("missing or stale active key state"));
}

#[sqlx::test(migrations = "./migrations")]
async fn direct_key_sentinels_are_atomic_immutable_and_gate_kek_retirement(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();

    env.set_wrap("rolled-back", "rolled back direct envelope material");
    let mut rolled_back = pool.begin().await.unwrap();
    encrypt_private_projection(
        &mut rolled_back,
        serde_json::json!({ "secret": "never committed" }),
        "projection:rolled-back",
    )
    .await
    .unwrap();
    rolled_back.rollback().await.unwrap();
    let sentinel_count: i64 = sqlx::query_scalar("SELECT count(*) FROM event_direct_key_sentinel")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        sentinel_count, 0,
        "sentinel follows the envelope transaction"
    );

    env.set_wrap("direct-v1", "direct envelope material v1");
    let mut private_tx = pool.begin().await.unwrap();
    encrypt_private_projection(
        &mut private_tx,
        serde_json::json!({ "secret": "projection" }),
        "projection:committed",
    )
    .await
    .unwrap();
    private_tx.commit().await.unwrap();

    env.set_wrap("direct-v2", "direct envelope material v2");
    env.set_wrap_ring(Some("direct-v1=direct envelope material v1"));
    let mut delivery_tx = pool.begin().await.unwrap();
    encrypt_delivery_credential(&mut delivery_tx, "credential", "delivery:committed")
        .await
        .unwrap();
    delivery_tx.commit().await.unwrap();

    let kids: Vec<String> =
        sqlx::query_scalar("SELECT kid FROM event_direct_key_sentinel ORDER BY kid")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(kids, ["direct-v1", "direct-v2"]);
    ensure_event_encryption_key_readiness(&pool).await.unwrap();

    env.set_wrap_ring(None);
    let missing = ensure_event_encryption_key_readiness(&pool)
        .await
        .expect_err("a direct-envelope KID cannot retire while its sentinel exists");
    assert!(missing.to_string().contains("direct-v1"));

    env.set_wrap_ring(Some("direct-v1=wrong direct envelope material"));
    let wrong = ensure_event_encryption_key_readiness(&pool)
        .await
        .expect_err("a matching KID with wrong material cannot authenticate its sentinel");
    assert!(wrong
        .to_string()
        .contains("authenticate direct-key sentinel"));

    env.set_wrap("direct-v2", "wrong direct envelope material v2");
    env.set_wrap_ring(Some("direct-v1=direct envelope material v1"));
    let mut wrong_writer = pool.begin().await.unwrap();
    let write_error = encrypt_delivery_credential(
        &mut wrong_writer,
        "must-not-seal",
        "delivery:wrong-material",
    )
    .await
    .expect_err("same KID with changed material must fail before envelope persistence");
    assert!(write_error
        .to_string()
        .contains("authenticate direct-key sentinel"));
    wrong_writer.rollback().await.unwrap();

    env.set_wrap("direct-v2", "direct envelope material v2");
    env.set_wrap_ring(Some("direct-v1=direct envelope material v1"));
    ensure_event_encryption_key_readiness(&pool).await.unwrap();
    for statement in [
        "DELETE FROM event_direct_key_sentinel",
        "TRUNCATE event_direct_key_sentinel",
    ] {
        let error = sqlx::query(statement)
            .execute(&pool)
            .await
            .expect_err("direct-key sentinel custody is immutable");
        assert!(error.to_string().contains("direct-key sentinel"));
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn raw_rows_hide_logical_bodies_and_runtime_keys(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-secret-kid", "runtime-secret-key-material");
    let stream = Uuid::new_v4();
    append(&pool, stream, &[private_post("body-secret-value")])
        .await
        .unwrap();
    let raw_event: String =
        sqlx::query_scalar("SELECT row_to_json(events)::text FROM events WHERE stream_id = $1")
            .bind(stream)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(raw_event.contains("stream_key_epoch"));
    assert!(!raw_event.contains("body-secret-value"));
    assert!(!raw_event.contains("runtime-secret-kid"));
    let raw_key: String = sqlx::query_scalar(
        "SELECT row_to_json(event_stream_keys)::text FROM event_stream_keys WHERE stream_id = $1",
    )
    .bind(stream)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(raw_key.contains("runtime-secret-kid"));
    assert!(!raw_key.contains("runtime-secret-key-material"));
}

#[sqlx::test(migrations = "./migrations")]
async fn relocation_header_and_ciphertext_tamper_fail_closed(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let source = Uuid::new_v4();
    append(&pool, source, &[private_post("relocation secret")])
        .await
        .unwrap();
    let target = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO event_stream_keys
          (stream_id,key_epoch,wrap_version,wrap_kid,wrap_nonce,wrapped_dek)
        SELECT $2,key_epoch,wrap_version,wrap_kid,wrap_nonce,wrapped_dek
        FROM event_stream_keys WHERE stream_id=$1
        "#,
    )
    .bind(source)
    .bind(target)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO event_stream_key_state VALUES ($1, 1)")
        .bind(target)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO events
          (stream_id,stream_seq,kind,version,occurred_at,sealed_version,stream_key_epoch,sealed_nonce,sealed_body)
        SELECT $2,stream_seq,kind,version,occurred_at,sealed_version,stream_key_epoch,sealed_nonce,sealed_body
        FROM events WHERE stream_id=$1
        "#,
    )
    .bind(source)
    .bind(target)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        load_stream(&pool, target).await.is_err(),
        "stream relocation must break DEK-wrap AAD"
    );

    let envelope: (i16, i64, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version,stream_key_epoch,sealed_nonce,sealed_body FROM events WHERE stream_id=$1",
    )
    .bind(source)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events (stream_id,stream_seq,kind,version,occurred_at,sealed_version,stream_key_epoch,sealed_nonce,sealed_body) VALUES ($1,2,'ChangedHeader',1,1,$2,$3,$4,$5)",
    )
    .bind(source)
    .bind(envelope.0)
    .bind(envelope.1)
    .bind(&envelope.2)
    .bind(&envelope.3)
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        load_stream(&pool, source).await.is_err(),
        "clear header changes must break event AAD"
    );

    let tamper_stream = Uuid::new_v4();
    append(&pool, tamper_stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    let mut ciphertext: Vec<u8> =
        sqlx::query_scalar("SELECT sealed_body FROM events WHERE stream_id=$1")
            .bind(tamper_stream)
            .fetch_one(&pool)
            .await
            .unwrap();
    ciphertext[0] ^= 0x80;
    let (version, epoch, nonce): (i16, i64, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version,stream_key_epoch,sealed_nonce FROM events WHERE stream_id=$1",
    )
    .bind(tamper_stream)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO events (stream_id,stream_seq,kind,version,occurred_at,sealed_version,stream_key_epoch,sealed_nonce,sealed_body) VALUES ($1,2,'VoteSubmitted',1,1,$2,$3,$4,$5)",
    )
    .bind(tamper_stream)
    .bind(version)
    .bind(epoch)
    .bind(nonce)
    .bind(ciphertext)
    .execute(&pool)
    .await
    .unwrap();
    assert!(load_stream(&pool, tamper_stream).await.is_err());
}

#[sqlx::test(migrations = "./migrations")]
async fn archive_bundle_rejects_relocation_tamper_and_wrong_custody_key_atomically(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "runtime wrapping material");
    env.set_archive("archive-v1", "archive custody material");
    let source = Uuid::new_v4();
    append(&pool, source, &[private_post("archive secret")])
        .await
        .unwrap();
    let export = export_stream(&pool, source).await.unwrap();
    validate_stream_export(&export).unwrap();
    let serialized = serde_json::to_string(&export).unwrap();
    assert!(!serialized.contains("runtime-v1"));
    assert!(!serialized.contains("runtime wrapping material"));
    assert!(!serialized.contains("archive secret"));

    let relocated_target = Uuid::new_v4();
    let mut relocated = export.clone();
    relocated.stream_id = relocated_target;
    refresh_checksum(&mut relocated);
    assert!(import_stream(&pool, &relocated).await.is_err());

    let tamper_target = Uuid::new_v4();
    let mut tampered = export.clone();
    tampered.stream_id = tamper_target;
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(&tampered.stream_keys[0].wrapped_dek)
        .unwrap();
    bytes[0] ^= 0x40;
    tampered.stream_keys[0].wrapped_dek = base64::engine::general_purpose::STANDARD.encode(bytes);
    refresh_checksum(&mut tampered);
    assert!(import_stream(&pool, &tampered).await.is_err());

    env.set_archive("archive-v1", "wrong archive custody material");
    assert!(validate_stream_export(&export).is_err());
    for target in [relocated_target, tamper_target] {
        let facts: i64 = sqlx::query_scalar(
            "SELECT (SELECT COUNT(*) FROM events WHERE stream_id=$1) + (SELECT COUNT(*) FROM event_stream_keys WHERE stream_id=$1)",
        )
        .bind(target)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(facts, 0, "invalid archive must insert no partial facts");
    }
}

#[sqlx::test(migrations = "./migrations")]
async fn append_serializes_concurrent_writers_and_events_are_append_only(pool: sqlx::PgPool) {
    let _env = EncryptionEnvGuard::new();
    let stream = Uuid::new_v4();
    let mut tx_a = pool.begin().await.unwrap();
    let mut tx_b = pool.begin().await.unwrap();
    assert_eq!(
        append_in_tx(&mut tx_a, stream, &[vote("slot_2", "D1")])
            .await
            .unwrap()[0]
            .stream_seq,
        1
    );
    let appender_b = async { append_in_tx(&mut tx_b, stream, &[vote("slot_3", "D1")]).await };
    let committer_a = async {
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        tx_a.commit().await
    };
    let (b, committed) = tokio::join!(appender_b, committer_a);
    committed.unwrap();
    assert_eq!(b.unwrap()[0].stream_seq, 2);
    tx_b.commit().await.unwrap();
    assert!(
        sqlx::query("UPDATE events SET kind='Tampered' WHERE stream_id=$1")
            .bind(stream)
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(sqlx::query("DELETE FROM events WHERE stream_id=$1")
        .bind(stream)
        .execute(&pool)
        .await
        .is_err());
    assert_eq!(load_stream(&pool, stream).await.unwrap().len(), 2);
}

#[tokio::test]
async fn archive_import_rewraps_deks_under_an_isolated_runtime_kek() {
    let env = EncryptionEnvGuard::new();
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL for isolated import");
    let (prefix, _) = database_url.rsplit_once('/').expect("database URL path");
    let admin_url = format!("{prefix}/postgres");
    let source_name = format!("fmarch_dek_source_{}", Uuid::new_v4().simple());
    let target_name = format!("fmarch_dek_target_{}", Uuid::new_v4().simple());
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
    let source = PgPoolOptions::new()
        .max_connections(2)
        .connect(&format!("{prefix}/{source_name}"))
        .await
        .unwrap();
    let target = PgPoolOptions::new()
        .max_connections(2)
        .connect(&format!("{prefix}/{target_name}"))
        .await
        .unwrap();
    migrate(&source).await.unwrap();
    migrate(&target).await.unwrap();
    env.set_archive("archive-v1", "shared offline archive custody material");
    env.set_wrap("source-runtime", "source-only runtime material");
    let stream = Uuid::new_v4();
    append(&source, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();
    rotate_stream_data_key(&source, stream).await.unwrap();
    append(&source, stream, &[private_post("isolated import secret")])
        .await
        .unwrap();
    let export = export_stream(&source, stream).await.unwrap();
    let source_events: Vec<(i16, i64, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT sealed_version,stream_key_epoch,sealed_nonce,sealed_body FROM events WHERE stream_id=$1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&source)
    .await
    .unwrap();

    env.set_wrap("target-runtime", "target-only runtime material");
    env.set_wrap_ring(None);
    let imported = import_stream(&target, &export).await.unwrap();
    assert_eq!(imported.len(), 2);
    let target_events: Vec<(i16, i64, Vec<u8>, Vec<u8>)> = sqlx::query_as(
        "SELECT sealed_version,stream_key_epoch,sealed_nonce,sealed_body FROM events WHERE stream_id=$1 ORDER BY stream_seq",
    )
    .bind(stream)
    .fetch_all(&target)
    .await
    .unwrap();
    assert_eq!(
        target_events, source_events,
        "event rows remain exact and append-only"
    );
    let target_kids = sqlx::query_scalar::<_, String>(
        "SELECT wrap_kid FROM event_stream_keys WHERE stream_id=$1 ORDER BY key_epoch",
    )
    .bind(stream)
    .fetch_all(&target)
    .await
    .unwrap();
    assert_eq!(target_kids, ["target-runtime", "target-runtime"]);
    let loaded = load_stream(&target, stream).await.unwrap();
    assert_eq!(loaded[0].payload["target"], "slot_2");
    assert_eq!(loaded[1].payload["body"], "isolated import secret");

    drop(source);
    drop(target);
    for name in [&source_name, &target_name] {
        sqlx::query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1")
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
    let mut offenders = Vec::new();
    for entry in std::fs::read_dir(workspace.join("crates")).unwrap() {
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
        "direct event-body decoding found in: {offenders:?}"
    );
}
