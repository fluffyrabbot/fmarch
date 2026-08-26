//! Real-Postgres proofs for the append-only encrypted event store.

use base64::Engine as _;
use eventstore::{
    append, append_in_tx, attest_active_runtime_kek, audit_event_encryption_key_coverage,
    begin_runtime_kek_retirement, decrypt_delivery_credential, decrypt_private_projection,
    encrypt_delivery_credential, encrypt_private_projection, ensure_event_encryption_key_readiness,
    export_stream, finalize_runtime_kek_retirement, import_stream, load_stream,
    rehearse_runtime_kek_retirement, reseal_delivery_credential_in_tx,
    reseal_private_projection_in_tx, rewrap_stream_data_keys, rewrap_stream_data_keys_by_kid_batch,
    rotate_stream_data_key, runtime_kek_reference_report, runtime_kek_status,
    validate_stream_export, ActorId, DirectEnvelopeResealContext, EventInput, ExportEvent,
    ExportStreamKey, RuntimeKekLifecycle, RuntimeKekRetirementEvidence, StreamExport,
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
            "author": { "kind": "slot", "slot_id": "slot_1" },
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
    attest_active_runtime_kek(&pool).await.unwrap();
    let retiring = begin_runtime_kek_retirement(&pool, "runtime-v1", "runtime-v2")
        .await
        .unwrap();
    assert_eq!(retiring.lifecycle, RuntimeKekLifecycle::Retiring);
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
    let evidence = rehearse_runtime_kek_retirement(&pool, "runtime-v1", "runtime-v2")
        .await
        .unwrap();
    let retired = finalize_runtime_kek_retirement(&pool, &evidence)
        .await
        .unwrap();
    assert_eq!(retired.lifecycle, RuntimeKekLifecycle::Retired);
    assert_eq!(load_stream(&pool, stream).await.unwrap().len(), 2);
    audit_event_encryption_key_coverage(&pool)
        .await
        .expect("a stream-only old KEK is retireable after every DEK is rewrapped");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_audit_rejects_missing_and_wrong_runtime_wrapping_keys(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("runtime-v1", "correct runtime wrapping material");
    append(&pool, Uuid::new_v4(), &[vote("slot_2", "D1")])
        .await
        .unwrap();

    env.set_wrap("runtime-v2", "another wrapping material");
    attest_active_runtime_kek(&pool).await.unwrap();
    let missing = audit_event_encryption_key_coverage(&pool)
        .await
        .expect_err("historical wrapping kid is required");
    assert!(missing.to_string().contains("runtime-v1"));

    env.set_wrap_ring(Some("runtime-v1=wrong runtime wrapping material"));
    let wrong = audit_event_encryption_key_coverage(&pool)
        .await
        .expect_err("matching kid with wrong material must not satisfy readiness");
    assert!(wrong
        .to_string()
        .contains("authenticate direct-key sentinel"));

    env.set_wrap_ring(Some("runtime-v1=correct runtime wrapping material"));
    audit_event_encryption_key_coverage(&pool).await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_attestation_precedes_readiness_and_admin_rotation(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("attest-source", "attested source material");
    append(&pool, Uuid::new_v4(), &[vote("slot_2", "D1")])
        .await
        .unwrap();

    env.set_wrap("attest-target", "attested target material a");
    env.set_wrap_ring(Some("attest-source=attested source material"));
    let error = ensure_event_encryption_key_readiness(&pool)
        .await
        .expect_err("readiness requires an explicit active-KID attestation");
    assert!(error.to_string().contains("has not been attested"));
    let error = begin_runtime_kek_retirement(&pool, "attest-source", "attest-target")
        .await
        .expect_err("admin rotation cannot be the target KID's first writer");
    assert!(error.to_string().contains("has not been attested"));
    assert!(runtime_kek_status(&pool, "attest-target")
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        runtime_kek_status(&pool, "attest-source")
            .await
            .unwrap()
            .unwrap()
            .lifecycle,
        RuntimeKekLifecycle::Writable
    );

    attest_active_runtime_kek(&pool).await.unwrap();
    ensure_event_encryption_key_readiness(&pool).await.unwrap();
    env.set_wrap("attest-target", "attested target material b");
    let error = begin_runtime_kek_retirement(&pool, "attest-source", "attest-target")
        .await
        .expect_err("same target KID with different material must fail closed");
    assert!(error
        .to_string()
        .contains("authenticate direct-key sentinel"));
    assert_eq!(
        runtime_kek_status(&pool, "attest-source")
            .await
            .unwrap()
            .unwrap()
            .lifecycle,
        RuntimeKekLifecycle::Writable
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn runtime_kid_grammar_rejects_delimiter_and_non_ascii_aliases(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    for invalid in [
        "comma,kid",
        "equals=kid",
        "unicode-é",
        ".leading",
        "_leading",
        ":leading",
        "-leading",
    ] {
        env.set_wrap(invalid, "runtime material");
        let error = attest_active_runtime_kek(&pool)
            .await
            .expect_err("runtime KIDs use the shared ASCII grammar");
        assert!(error.to_string().contains("[A-Za-z0-9][A-Za-z0-9._:-]*"));
    }

    env.set_wrap("Valid.kid_1:part-2", "runtime material");
    attest_active_runtime_kek(&pool).await.unwrap();
    for invalid in [
        "raw,comma",
        "raw=equals",
        ".raw-leading",
        "_raw-leading",
        ":raw-leading",
        "-raw-leading",
    ] {
        let error = sqlx::query(
            r#"
            INSERT INTO event_direct_key_sentinel
                (kid, sentinel_version, sentinel_nonce, sentinel_ciphertext)
            VALUES ($1, 1, $2, $3)
            "#,
        )
        .bind(invalid)
        .bind(vec![0_u8; 24])
        .bind(vec![0_u8; 56])
        .execute(&pool)
        .await
        .expect_err("database KID constraint must mirror the parser");
        assert!(error
            .to_string()
            .contains("event_direct_key_sentinel_kid_check"));
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
    attest_active_runtime_kek(&pool).await.unwrap();
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
        assert!(
            error.to_string().contains("direct-key sentinel")
                || error.to_string().contains("foreign key constraint"),
            "unexpected direct-key registry guard error: {error}"
        );
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn direct_envelope_reseal_requires_retiring_state_and_leaves_an_unusable_tombstone(
    pool: sqlx::PgPool,
) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("direct-v1", "direct envelope material v1");
    let mut seed = pool.begin().await.unwrap();
    let private = encrypt_private_projection(
        &mut seed,
        serde_json::json!({ "secret": "projection" }),
        "projection:stable-row",
    )
    .await
    .unwrap();
    let delivery = encrypt_delivery_credential(&mut seed, "credential", "delivery:stable-row")
        .await
        .unwrap();
    let wrong_delivery_type = encrypt_private_projection(
        &mut seed,
        serde_json::json!({ "not_credential": true }),
        "delivery:typed-row",
    )
    .await
    .unwrap();
    seed.commit().await.unwrap();

    env.set_wrap("direct-v2", "direct envelope material v2");
    env.set_wrap_ring(Some("direct-v1=direct envelope material v1"));
    attest_active_runtime_kek(&pool).await.unwrap();
    let status = begin_runtime_kek_retirement(&pool, "direct-v1", "direct-v2")
        .await
        .unwrap();
    assert_eq!(status.lifecycle, RuntimeKekLifecycle::Retiring);

    let mut wrong_aad = pool.begin().await.unwrap();
    let error = reseal_private_projection_in_tx(
        &mut wrong_aad,
        "direct-v1",
        &private,
        "projection:wrong-row",
    )
    .await
    .expect_err("AAD relocation must fail before reseal");
    assert!(error.to_string().contains("decrypt private payload"));
    wrong_aad.rollback().await.unwrap();

    let mut wrong_kid = pool.begin().await.unwrap();
    let error = reseal_private_projection_in_tx(
        &mut wrong_kid,
        "direct-v2",
        &private,
        "projection:stable-row",
    )
    .await
    .expect_err("caller-selected source KID must match the envelope");
    assert!(error.to_string().contains("does not match retiring KID"));
    wrong_kid.rollback().await.unwrap();

    let mut wrong_type = pool.begin().await.unwrap();
    let error = reseal_delivery_credential_in_tx(
        &mut wrong_type,
        "direct-v1",
        &wrong_delivery_type,
        "delivery:typed-row",
    )
    .await
    .expect_err("delivery reseal must preserve the credential type boundary");
    assert!(error.to_string().contains("missing credential"));
    wrong_type.rollback().await.unwrap();

    let mut reseal = pool.begin().await.unwrap();
    let resealer = DirectEnvelopeResealContext::begin(&mut reseal, "direct-v1")
        .await
        .unwrap();
    let private_v2 = resealer
        .reseal_private_projection(&private, "projection:stable-row")
        .unwrap();
    let delivery_v2 = resealer
        .reseal_delivery_credential(&delivery, "delivery:stable-row")
        .unwrap();
    drop(resealer);
    reseal.commit().await.unwrap();
    assert_eq!(private_v2["kid"], "direct-v2");
    assert_eq!(delivery_v2["kid"], "direct-v2");
    assert_eq!(
        decrypt_private_projection(&private_v2, "projection:stable-row").unwrap()["secret"],
        "projection"
    );
    assert_eq!(
        decrypt_delivery_credential(&delivery_v2, "delivery:stable-row").unwrap(),
        "credential"
    );

    let error = rehearse_runtime_kek_retirement(&pool, "direct-v1", "direct-v2")
        .await
        .expect_err("source material must leave the configured keyring before rehearsal");
    assert!(error
        .to_string()
        .contains("absent from the configured keyring"));

    sqlx::query("CREATE TABLE test_direct_reference (surface TEXT NOT NULL, kid TEXT NOT NULL)")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE OR REPLACE VIEW event_direct_key_reference AS SELECT surface, kid FROM test_direct_reference",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO test_direct_reference VALUES ('test.envelope', 'direct-v1')")
        .execute(&pool)
        .await
        .unwrap();
    let report = runtime_kek_reference_report(&pool, "direct-v1")
        .await
        .unwrap();
    assert_eq!(report.direct_reference_count, 1);
    env.set_wrap_ring(None);
    let error = rehearse_runtime_kek_retirement(&pool, "direct-v1", "direct-v2")
        .await
        .expect_err("authoritative direct references block rehearsal");
    assert!(error.to_string().contains("direct-envelope references"));
    sqlx::query("DELETE FROM test_direct_reference")
        .execute(&pool)
        .await
        .unwrap();
    let evidence = rehearse_runtime_kek_retirement(&pool, "direct-v1", "direct-v2")
        .await
        .unwrap();
    let repeated = rehearse_runtime_kek_retirement(&pool, "direct-v1", "direct-v2")
        .await
        .unwrap();
    assert_eq!(
        repeated, evidence,
        "successful rehearsal evidence is idempotent and write-once"
    );
    let error = sqlx::query(
        "UPDATE event_direct_key_sentinel SET rehearsal_token = $1 WHERE kid = 'direct-v1'",
    )
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .expect_err("SQL cannot replace durable rehearsal evidence");
    assert!(error.to_string().contains("write-once"));
    let error = sqlx::query(
        "UPDATE event_direct_key_sentinel SET rehearsal_token = NULL, rehearsed_at = NULL WHERE kid = 'direct-v1'",
    )
    .execute(&pool)
    .await
    .expect_err("SQL cannot roll back durable rehearsal evidence");
    assert!(
        error.to_string().contains("write-once") || error.to_string().contains("lifecycle_check")
    );

    let forged = RuntimeKekRetirementEvidence {
        retiring_kid: evidence.retiring_kid.clone(),
        target_kid: evidence.target_kid.clone(),
        token: Uuid::new_v4(),
    };
    let error = finalize_runtime_kek_retirement(&pool, &forged)
        .await
        .expect_err("finalization requires the durable rehearsal token");
    assert!(error.to_string().contains("evidence token"));
    sqlx::query("INSERT INTO test_direct_reference VALUES ('test.envelope', 'direct-v1')")
        .execute(&pool)
        .await
        .unwrap();
    let error = finalize_runtime_kek_retirement(&pool, &evidence)
        .await
        .expect_err("direct-reference count is rechecked at finalization");
    assert!(error.to_string().contains("direct-envelope references"));
    sqlx::query("DELETE FROM test_direct_reference")
        .execute(&pool)
        .await
        .unwrap();

    let retired = finalize_runtime_kek_retirement(&pool, &evidence)
        .await
        .unwrap();
    assert_eq!(retired.lifecycle, RuntimeKekLifecycle::Retired);
    let material: (Option<i16>, Option<Vec<u8>>, Option<Vec<u8>>) = sqlx::query_as(
        "SELECT sentinel_version, sentinel_nonce, sentinel_ciphertext FROM event_direct_key_sentinel WHERE kid = 'direct-v1'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(material, (None, None, None));
    assert_eq!(
        runtime_kek_status(&pool, "direct-v1")
            .await
            .unwrap()
            .unwrap()
            .lifecycle,
        RuntimeKekLifecycle::Retired
    );

    env.set_wrap_ring(Some("direct-v1=direct envelope material v1"));
    let error = ensure_event_encryption_key_readiness(&pool)
        .await
        .expect_err("a retired historical KID cannot remain configured");
    assert!(error
        .to_string()
        .contains("configured runtime KEK `direct-v1` is retired"));
    env.set_wrap_ring(None);
    env.set_wrap("direct-v1", "direct envelope material v1");
    let error = ensure_event_encryption_key_readiness(&pool)
        .await
        .expect_err("a retired tombstone cannot become the configured active KID");
    assert!(error
        .to_string()
        .contains("active runtime KEK `direct-v1` is retired"));
    let mut reused = pool.begin().await.unwrap();
    let error = encrypt_private_projection(
        &mut reused,
        serde_json::json!({ "secret": "must not resurrect" }),
        "projection:reuse",
    )
    .await
    .expect_err("retired KID tombstone must prevent reuse");
    assert!(error.to_string().contains("retired"));
    reused.rollback().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn global_stream_rewrap_batches_are_resumable_and_preserve_event_rows(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("batch-v1", "batch wrapping material v1");
    let streams = [Uuid::new_v4(), Uuid::new_v4()];
    for stream in streams {
        append(&pool, stream, &[private_post("batch invariant")])
            .await
            .unwrap();
    }
    rotate_stream_data_key(&pool, streams[0]).await.unwrap();
    let before: Vec<String> =
        sqlx::query_scalar("SELECT row_to_json(events)::text FROM events ORDER BY seq")
            .fetch_all(&pool)
            .await
            .unwrap();

    env.set_wrap("batch-v2", "batch wrapping material v2");
    env.set_wrap_ring(Some("batch-v1=batch wrapping material v1"));
    attest_active_runtime_kek(&pool).await.unwrap();
    begin_runtime_kek_retirement(&pool, "batch-v1", "batch-v2")
        .await
        .unwrap();

    env.set_wrap_ring(None);
    let error = rehearse_runtime_kek_retirement(&pool, "batch-v1", "batch-v2")
        .await
        .expect_err("stream references block rehearsal");
    assert!(error.to_string().contains("stream-key references"));
    env.set_wrap_ring(Some("batch-v1=batch wrapping material v1"));

    let first = rewrap_stream_data_keys_by_kid_batch(&pool, "batch-v1", 2)
        .await
        .unwrap();
    assert_eq!(first.rewrapped, 2);
    assert!(first.batch_full);
    let second = rewrap_stream_data_keys_by_kid_batch(&pool, "batch-v1", 2)
        .await
        .unwrap();
    assert_eq!(second.rewrapped, 1);
    assert!(!second.batch_full);
    let idempotent = rewrap_stream_data_keys_by_kid_batch(&pool, "batch-v1", 2)
        .await
        .unwrap();
    assert_eq!(idempotent.rewrapped, 0);
    assert!(!idempotent.batch_full);

    let after: Vec<String> =
        sqlx::query_scalar("SELECT row_to_json(events)::text FROM events ORDER BY seq")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(after, before, "stream rewrap must not rewrite event rows");
    let report = runtime_kek_reference_report(&pool, "batch-v1")
        .await
        .unwrap();
    assert_eq!(report.stream_key_references, 0);
    assert_eq!(report.direct_reference_count, 0);
    assert_eq!(
        report.status.unwrap().lifecycle,
        RuntimeKekLifecycle::Retiring
    );

    env.set_wrap_ring(None);
    let evidence = rehearse_runtime_kek_retirement(&pool, "batch-v1", "batch-v2")
        .await
        .unwrap();
    finalize_runtime_kek_retirement(&pool, &evidence)
        .await
        .unwrap();
    audit_event_encryption_key_coverage(&pool).await.unwrap();
    assert_eq!(load_stream(&pool, streams[0]).await.unwrap().len(), 1);
    assert_eq!(load_stream(&pool, streams[1]).await.unwrap().len(), 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn writer_row_lock_fences_the_writable_to_retiring_transition(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("fenced-v1", "fenced wrapping material v1");
    let mut writer = pool.begin().await.unwrap();
    encrypt_private_projection(
        &mut writer,
        serde_json::json!({ "secret": "in flight" }),
        "projection:in-flight",
    )
    .await
    .unwrap();

    env.set_wrap("fenced-v2", "fenced wrapping material v2");
    env.set_wrap_ring(Some("fenced-v1=fenced wrapping material v1"));
    attest_active_runtime_kek(&pool).await.unwrap();
    let retirement_pool = pool.clone();
    let transition = tokio::spawn(async move {
        begin_runtime_kek_retirement(&retirement_pool, "fenced-v1", "fenced-v2").await
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        !transition.is_finished(),
        "retirement must wait for the active writer's shared registry lock"
    );
    writer.commit().await.unwrap();
    let status = transition.await.unwrap().unwrap();
    assert_eq!(status.lifecycle, RuntimeKekLifecycle::Retiring);

    env.set_wrap("fenced-v1", "fenced wrapping material v1");
    env.set_wrap_ring(None);
    let mut late_writer = pool.begin().await.unwrap();
    let error = encrypt_private_projection(
        &mut late_writer,
        serde_json::json!({ "secret": "too late" }),
        "projection:late",
    )
    .await
    .expect_err("retiring source cannot accept a new write");
    assert!(error.to_string().contains("retiring"));
    late_writer.rollback().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn raw_stream_wrap_writes_share_the_runtime_kek_fence(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("raw-wrap-v1", "raw wrap material v1");
    let stream = Uuid::new_v4();
    append(&pool, stream, &[vote("slot_2", "D1")])
        .await
        .unwrap();

    env.set_wrap("raw-wrap-v2", "raw wrap material v2");
    env.set_wrap_ring(Some("raw-wrap-v1=raw wrap material v1"));
    attest_active_runtime_kek(&pool).await.unwrap();
    let mut raw_writer = pool.begin().await.unwrap();
    sqlx::query(
        "UPDATE event_stream_keys SET wrap_nonce = $2 WHERE stream_id = $1 AND key_epoch = 1",
    )
    .bind(stream)
    .bind(vec![7_u8; 24])
    .execute(&mut *raw_writer)
    .await
    .unwrap();

    let transition_pool = pool.clone();
    let transition = tokio::spawn(async move {
        begin_runtime_kek_retirement(&transition_pool, "raw-wrap-v1", "raw-wrap-v2").await
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(
        !transition.is_finished(),
        "raw stream-wrap update must hold the source registry shared lock"
    );
    raw_writer.rollback().await.unwrap();
    transition.await.unwrap().unwrap();

    let error = sqlx::query(
        "UPDATE event_stream_keys SET wrap_nonce = $2 WHERE stream_id = $1 AND key_epoch = 1",
    )
    .bind(stream)
    .bind(vec![8_u8; 24])
    .execute(&pool)
    .await
    .expect_err("raw wrap update cannot commit after the retirement fence");
    assert!(error.to_string().contains("not writable"));

    let error = sqlx::query(
        r#"
        INSERT INTO event_stream_keys
            (stream_id, key_epoch, wrap_version, wrap_kid, wrap_nonce, wrapped_dek)
        VALUES ($1, 1, 1, 'raw-wrap-v1', $2, $3)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(vec![0_u8; 24])
    .bind(vec![0_u8; 48])
    .execute(&pool)
    .await
    .expect_err("raw wrap insert cannot commit after the retirement fence");
    assert!(error.to_string().contains("not writable"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn runtime_kek_retirements_are_strictly_sequential(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("parallel-a", "parallel wrapping material a");
    let mut a = pool.begin().await.unwrap();
    encrypt_private_projection(&mut a, serde_json::json!({ "a": true }), "parallel:a")
        .await
        .unwrap();
    a.commit().await.unwrap();

    env.set_wrap("parallel-b", "parallel wrapping material b");
    env.set_wrap_ring(Some("parallel-a=parallel wrapping material a"));
    let mut b = pool.begin().await.unwrap();
    encrypt_private_projection(&mut b, serde_json::json!({ "b": true }), "parallel:b")
        .await
        .unwrap();
    b.commit().await.unwrap();

    env.set_wrap("parallel-target", "parallel wrapping material target");
    env.set_wrap_ring(Some(
        "parallel-a=parallel wrapping material a,parallel-b=parallel wrapping material b",
    ));
    attest_active_runtime_kek(&pool).await.unwrap();
    begin_runtime_kek_retirement(&pool, "parallel-a", "parallel-target")
        .await
        .unwrap();
    let error = begin_runtime_kek_retirement(&pool, "parallel-b", "parallel-target")
        .await
        .expect_err("a second in-flight rotation must be rejected");
    assert!(error.to_string().contains("already in flight"));

    env.set_wrap_ring(Some("parallel-b=parallel wrapping material b"));
    let evidence = rehearse_runtime_kek_retirement(&pool, "parallel-a", "parallel-target")
        .await
        .unwrap();
    finalize_runtime_kek_retirement(&pool, &evidence)
        .await
        .unwrap();
    let next = begin_runtime_kek_retirement(&pool, "parallel-b", "parallel-target")
        .await
        .unwrap();
    assert_eq!(next.lifecycle, RuntimeKekLifecycle::Retiring);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn concurrent_runtime_kek_begins_serialize_to_one_winner(pool: sqlx::PgPool) {
    let env = EncryptionEnvGuard::new();
    env.set_wrap("race-a", "race wrapping material a");
    attest_active_runtime_kek(&pool).await.unwrap();
    env.set_wrap("race-b", "race wrapping material b");
    attest_active_runtime_kek(&pool).await.unwrap();
    env.set_wrap("race-target", "race wrapping material target");
    env.set_wrap_ring(Some(
        "race-a=race wrapping material a,race-b=race wrapping material b",
    ));
    attest_active_runtime_kek(&pool).await.unwrap();

    let pool_a = pool.clone();
    let pool_b = pool.clone();
    let (a, b) = tokio::join!(
        begin_runtime_kek_retirement(&pool_a, "race-a", "race-target"),
        begin_runtime_kek_retirement(&pool_b, "race-b", "race-target")
    );
    let results = [a, b];
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    let error = results
        .iter()
        .find_map(|result| result.as_ref().err())
        .expect("one concurrent begin must lose");
    assert!(error.to_string().contains("already in flight"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
    database_schema::MIGRATOR.run(&source).await.unwrap();
    database_schema::MIGRATOR.run(&target).await.unwrap();
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
