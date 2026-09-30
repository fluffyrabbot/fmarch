use super::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Changed {
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
struct TestActor(String);

impl TryFrom<String> for TestActor {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() {
            Err("empty test actor".into())
        } else {
            Ok(Self(value))
        }
    }
}

impl From<TestActor> for String {
    fn from(actor: TestActor) -> Self {
        actor.0
    }
}

#[derive(Debug, thiserror::Error)]
enum TestCodecError {
    #[error("unknown test encoding")]
    Unknown,
    #[error("test event rejected")]
    Rejected,
    #[error(transparent)]
    Payload(#[from] serde_json::Error),
}

struct TestCodec;

impl EventCodec for TestCodec {
    const CONTEXT: &'static str = "journal-test";
    type Event = Changed;
    type Actor = TestActor;
    type Error = TestCodecError;

    fn encode(event: &Changed) -> Result<EventEncoding, Self::Error> {
        if event.value == "reject" {
            return Err(TestCodecError::Rejected);
        }
        Ok(EventEncoding::new(
            "Changed",
            1,
            serde_json::to_value(event)?,
        ))
    }

    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Changed, Self::Error> {
        if kind != "Changed" || version != 1 {
            return Err(TestCodecError::Unknown);
        }
        Ok(serde_json::from_value(payload.clone())?)
    }

    fn integration_facts(event: &Changed) -> Result<Vec<IntegrationFact>, Self::Error> {
        Ok(vec![IntegrationFact::new(
            "journal-test-public",
            "ChangedNotice",
            1,
            json!({"summary":event.value}),
        )])
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct Notice {
    summary: String,
}

struct NoticeCodec;

impl IntegrationCodec for NoticeCodec {
    const CONTEXT: &'static str = "journal-test-public";
    type Fact = Notice;
    type Error = TestCodecError;

    fn decode(kind: &str, version: i16, payload: &Value) -> Result<Notice, Self::Error> {
        if kind != "ChangedNotice" || version != 1 {
            return Err(TestCodecError::Unknown);
        }
        Ok(serde_json::from_value(payload.clone())?)
    }
}

fn pending(value: &str) -> EventToAppend<TestCodec> {
    EventToAppend::new(
        Changed {
            value: value.into(),
        },
        TestActor("operator".into()),
        42,
    )
}

async fn counts(tx: &mut Transaction<'_, Postgres>, stream: StreamId) -> (i64, i64, i64) {
    sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM events WHERE stream_id=$1), (SELECT COUNT(*) FROM event_stream_keys WHERE stream_id=$1), (SELECT COUNT(*) FROM event_integration_outbox o JOIN events e ON e.seq=o.source_seq WHERE e.stream_id=$1)",
    )
    .bind(stream.as_uuid())
    .fetch_one(&mut **tx)
    .await
    .unwrap()
}

#[test]
fn typed_versions_and_codec_admission_fail_closed() {
    assert!(StreamVersion::new(-1).is_err());
    assert!(ExpectedVersion::new(-1).is_err());
    assert_eq!(
        ExpectedVersion::from(StreamVersion::new(3).unwrap()).get(),
        3
    );
    let mut stored = StoredEvent {
        seq: 1,
        stream_id: Uuid::nil(),
        stream_seq: 1,
        kind: "Changed".into(),
        version: 1,
        payload: json!({"value":"one"}),
        actor: json!("operator"),
        occurred_at: 42,
        causation_id: None,
        meta: json!({"journal_context":TestCodec::CONTEXT}),
    };
    assert_eq!(decode::<TestCodec>(&stored).unwrap().event.value, "one");
    for kind in ["Unknown", ""] {
        stored.kind = kind.into();
        assert!(decode::<TestCodec>(&stored).is_err());
    }
    stored.kind = "Changed".into();
    for version in [0, 2] {
        stored.version = version;
        assert!(decode::<TestCodec>(&stored).is_err());
    }
    stored.version = 1;
    stored.payload = json!({"unexpected":"one"});
    assert!(decode::<TestCodec>(&stored).is_err());
    stored.payload = json!({"value":"one"});
    stored.actor = json!("");
    assert!(decode::<TestCodec>(&stored).is_err());
    stored.actor = json!("operator");
    for meta in [json!({}), json!({"journal_context":"different"})] {
        stored.meta = meta;
        assert!(decode::<TestCodec>(&stored).is_err());
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn typed_append_roundtrips_encrypted_source_and_integration_facts(pool: PgPool) {
    let stream = StreamId::new(Uuid::new_v4());
    let mut tx = pool.begin().await.unwrap();
    lock_stream_in_tx(&mut tx, stream).await.unwrap();
    let appended = append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[pending("secret-summary")],
    )
    .await
    .unwrap();
    assert_eq!(appended.len(), 1);
    assert_eq!(appended[0].stream_seq.get(), 1);
    assert_eq!(appended[0].actor, TestActor("operator".into()));
    let loaded = load_in_tx::<TestCodec>(&mut tx, stream).await.unwrap();
    assert_eq!(loaded[0].event, appended[0].event);
    assert_eq!(loaded[0].seq, appended[0].seq);
    let facts = load_outbox_in_tx::<NoticeCodec>(&mut tx, stream)
        .await
        .unwrap();
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].source_seq, appended[0].seq);
    assert_eq!(facts[0].fact_index, 0);
    assert_eq!(facts[0].fact.summary, "secret-summary");
    assert_eq!(
        audit_outbox_in_tx::<NoticeCodec>(&mut tx, stream)
            .await
            .unwrap(),
        1
    );
    let ciphertext: Vec<u8> =
        sqlx::query_scalar("SELECT sealed_body FROM event_integration_outbox WHERE source_seq=$1")
            .bind(appended[0].seq)
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert!(!ciphertext
        .windows(b"secret-summary".len())
        .any(|bytes| bytes == b"secret-summary"));
    tx.commit().await.unwrap();
    assert_eq!(
        load::<TestCodec>(&pool, stream).await.unwrap()[0]
            .event
            .value,
        "secret-summary"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn complete_batch_and_actor_admission_precede_any_storage_mutation(pool: PgPool) {
    let stream = StreamId::new(Uuid::new_v4());
    let mut tx = pool.begin().await.unwrap();
    assert!(append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[pending("valid"), pending("reject")],
    )
    .await
    .is_err());
    assert_eq!(counts(&mut tx, stream).await, (0, 0, 0));
    let mut invalid_actor = pending("valid");
    invalid_actor.actor = TestActor(String::new());
    assert!(append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[invalid_actor],
    )
    .await
    .is_err());
    assert_eq!(counts(&mut tx, stream).await, (0, 0, 0));
    tx.commit().await.unwrap();
    assert!(crate::load_stream(&pool, stream.as_uuid())
        .await
        .unwrap()
        .is_empty());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn version_conflict_and_outbox_failure_leave_outer_transaction_usable(pool: PgPool) {
    let stream = StreamId::new(Uuid::new_v4());
    let mut tx = pool.begin().await.unwrap();
    append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[pending("first")],
    )
    .await
    .unwrap();
    let conflict = append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[pending("stale")],
    )
    .await;
    assert!(matches!(
        conflict,
        Err(JournalError::Store(StoreError::Conflict { .. }))
    ));
    assert_eq!(counts(&mut tx, stream).await, (1, 1, 1));
    sqlx::query("CREATE FUNCTION fail_test_integration_fact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced integration failure'; END $$")
        .execute(&mut *tx).await.unwrap();
    sqlx::query("CREATE TRIGGER fail_test_integration_fact BEFORE INSERT ON event_integration_outbox FOR EACH ROW EXECUTE FUNCTION fail_test_integration_fact()")
        .execute(&mut *tx).await.unwrap();
    let rejected = append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(1).unwrap(),
        &[pending("second")],
    )
    .await;
    assert!(matches!(rejected, Err(JournalError::Database(_))));
    assert_eq!(counts(&mut tx, stream).await, (1, 1, 1));
    tx.commit().await.unwrap();
    let events = load::<TestCodec>(&pool, stream).await.unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].event.value, "first");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn integration_audit_rejects_unknown_encodings_and_authenticated_header_tampering(
    pool: PgPool,
) {
    let stream = StreamId::new(Uuid::new_v4());
    let mut tx = pool.begin().await.unwrap();
    append_expected_in_tx::<TestCodec>(
        &mut tx,
        stream,
        ExpectedVersion::new(0).unwrap(),
        &[pending("one")],
    )
    .await
    .unwrap();
    // Corruption testing is deliberate operator authority. Disable immutable
    // receipt triggers only inside this rolled-back test transaction.
    sqlx::query("ALTER TABLE event_integration_outbox DISABLE TRIGGER USER")
        .execute(&mut *tx)
        .await
        .unwrap();
    for (statement, value) in [
        ("UPDATE event_integration_outbox SET context=$1 WHERE source_seq IN (SELECT seq FROM events WHERE stream_id=$2)", "other"),
        ("UPDATE event_integration_outbox SET kind=$1 WHERE source_seq IN (SELECT seq FROM events WHERE stream_id=$2)", "Unknown"),
    ] {
        let mut corrupt = sqlx::Acquire::begin(&mut tx).await.unwrap();
        sqlx::query(statement)
            .bind(value)
            .bind(stream.as_uuid())
            .execute(&mut *corrupt)
            .await
            .unwrap();
        assert!(audit_outbox_in_tx::<NoticeCodec>(&mut corrupt, stream)
            .await
            .is_err());
        corrupt.rollback().await.unwrap();
    }
    assert_eq!(
        audit_outbox_in_tx::<NoticeCodec>(&mut tx, stream)
            .await
            .unwrap(),
        1
    );
    assert_eq!(
        audit_source_outbox_in_tx::<TestCodec>(&mut tx, stream)
            .await
            .unwrap(),
        1
    );
    sqlx::query("DELETE FROM event_integration_outbox WHERE source_seq IN (SELECT seq FROM events WHERE stream_id=$1)")
        .bind(stream.as_uuid()).execute(&mut *tx).await.unwrap();
    assert!(audit_source_outbox_in_tx::<TestCodec>(&mut tx, stream)
        .await
        .is_err());
    tx.rollback().await.unwrap();
}
