use bytes::Bytes;
use futures_util::stream::BoxStream;
use identity::{
    prepare_subject_authority_for_service, reconcile_subject_revocations_with_store,
    verify_or_bind_database_authority, ConfiguredSubjectKeyAuthority, ObjectSubjectKeyStore,
    SubjectId, SubjectKeyStore, SubjectPrivacyError, SubjectRevocationRecord,
};
use object_store::{
    path::Path as ObjectPath, CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload,
    ObjectMeta, ObjectStore, PutMultipartOptions, PutOptions, PutPayload, PutResult,
    Result as ObjectStoreResult,
};
use sha2::Digest;
use std::fmt;
use std::ops::Range;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Barrier;
use uuid::Uuid;

const REVOCATION_OBJECT_PREFIX: &str = "fmarch-subject-authority/v1/revocations/";

#[derive(Debug, Default)]
struct ObjectRequestCounts {
    lists: AtomicUsize,
    revocation_gets: AtomicUsize,
    revocation_gets_in_flight: AtomicUsize,
    max_revocation_get_concurrency: AtomicUsize,
}

impl ObjectRequestCounts {
    fn reset(&self) {
        self.lists.store(0, Ordering::Relaxed);
        self.revocation_gets.store(0, Ordering::Relaxed);
        self.revocation_gets_in_flight.store(0, Ordering::Relaxed);
        self.max_revocation_get_concurrency
            .store(0, Ordering::Relaxed);
    }
}

#[derive(Debug)]
struct RequestCountingObjectStore {
    inner: Arc<dyn ObjectStore>,
    counts: Arc<ObjectRequestCounts>,
}

impl fmt::Display for RequestCountingObjectStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("request-counting-object-store")
    }
}

#[async_trait::async_trait]
impl ObjectStore for RequestCountingObjectStore {
    async fn put_opts(
        &self,
        location: &ObjectPath,
        payload: PutPayload,
        options: PutOptions,
    ) -> ObjectStoreResult<PutResult> {
        self.inner.put_opts(location, payload, options).await
    }

    async fn put_multipart_opts(
        &self,
        location: &ObjectPath,
        options: PutMultipartOptions,
    ) -> ObjectStoreResult<Box<dyn MultipartUpload>> {
        self.inner.put_multipart_opts(location, options).await
    }

    async fn get_opts(
        &self,
        location: &ObjectPath,
        options: GetOptions,
    ) -> ObjectStoreResult<GetResult> {
        if !options.head && location.as_ref().starts_with(REVOCATION_OBJECT_PREFIX) {
            self.counts.revocation_gets.fetch_add(1, Ordering::Relaxed);
            let in_flight = self
                .counts
                .revocation_gets_in_flight
                .fetch_add(1, Ordering::Relaxed)
                + 1;
            self.counts
                .max_revocation_get_concurrency
                .fetch_max(in_flight, Ordering::Relaxed);
            tokio::task::yield_now().await;
            let result = self.inner.get_opts(location, options).await;
            self.counts
                .revocation_gets_in_flight
                .fetch_sub(1, Ordering::Relaxed);
            return result;
        }
        self.inner.get_opts(location, options).await
    }

    async fn get_ranges(
        &self,
        location: &ObjectPath,
        ranges: &[Range<u64>],
    ) -> ObjectStoreResult<Vec<Bytes>> {
        self.inner.get_ranges(location, ranges).await
    }

    fn delete_stream(
        &self,
        locations: BoxStream<'static, ObjectStoreResult<ObjectPath>>,
    ) -> BoxStream<'static, ObjectStoreResult<ObjectPath>> {
        self.inner.delete_stream(locations)
    }

    fn list(
        &self,
        prefix: Option<&ObjectPath>,
    ) -> BoxStream<'static, ObjectStoreResult<ObjectMeta>> {
        self.counts.lists.fetch_add(1, Ordering::Relaxed);
        self.inner.list(prefix)
    }

    async fn list_with_delimiter(
        &self,
        prefix: Option<&ObjectPath>,
    ) -> ObjectStoreResult<ListResult> {
        self.inner.list_with_delimiter(prefix).await
    }

    async fn copy_opts(
        &self,
        from: &ObjectPath,
        to: &ObjectPath,
        options: CopyOptions,
    ) -> ObjectStoreResult<()> {
        self.inner.copy_opts(from, to, options).await
    }
}

#[derive(Debug, Default)]
struct AuthorityRequestCounts {
    loads: AtomicUsize,
    destroys: AtomicUsize,
    destroys_in_flight: AtomicUsize,
    max_destroy_concurrency: AtomicUsize,
    revocation_lists: AtomicUsize,
}

impl AuthorityRequestCounts {
    fn reset(&self) {
        self.loads.store(0, Ordering::Relaxed);
        self.destroys.store(0, Ordering::Relaxed);
        self.destroys_in_flight.store(0, Ordering::Relaxed);
        self.max_destroy_concurrency.store(0, Ordering::Relaxed);
        self.revocation_lists.store(0, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone)]
struct RequestCountingKeyStore {
    inner: ObjectSubjectKeyStore,
    counts: Arc<AuthorityRequestCounts>,
}

#[async_trait::async_trait]
impl SubjectKeyStore for RequestCountingKeyStore {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError> {
        self.inner.check_readiness().await
    }

    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError> {
        self.inner.create(subject_id).await
    }

    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError> {
        self.counts.loads.fetch_add(1, Ordering::Relaxed);
        self.inner.load(subject_id).await
    }

    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError> {
        self.counts.destroys.fetch_add(1, Ordering::Relaxed);
        let in_flight = self
            .counts
            .destroys_in_flight
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        self.counts
            .max_destroy_concurrency
            .fetch_max(in_flight, Ordering::Relaxed);
        // Force each buffered future to yield once so this test observes the
        // actual concurrency window instead of an in-memory operation that may
        // happen to complete in one poll.
        tokio::task::yield_now().await;
        let result = self.inner.destroy(subject_id).await;
        self.counts
            .destroys_in_flight
            .fetch_sub(1, Ordering::Relaxed);
        result
    }

    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError> {
        self.inner.record_revocation(record).await
    }

    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError> {
        self.counts.revocation_lists.fetch_add(1, Ordering::Relaxed);
        self.inner.revocations().await
    }
}

#[derive(Debug, Clone)]
struct BlockingDestroyKeyStore {
    inner: ObjectSubjectKeyStore,
    destroy_entered: Arc<Barrier>,
    release_destroy: Arc<Barrier>,
}

#[async_trait::async_trait]
impl SubjectKeyStore for BlockingDestroyKeyStore {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError> {
        self.inner.check_readiness().await
    }

    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError> {
        self.inner.create(subject_id).await
    }

    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError> {
        self.inner.load(subject_id).await
    }

    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError> {
        self.destroy_entered.wait().await;
        self.release_destroy.wait().await;
        self.inner.destroy(subject_id).await
    }

    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError> {
        self.inner.record_revocation(record).await
    }

    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError> {
        self.inner.revocations().await
    }
}

async fn wait_for_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiters: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
            )
            .fetch_one(pool)
            .await
            .unwrap();
            if waiters >= expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {expected} database lock waiters"));
}

fn object_authority() -> (ObjectSubjectKeyStore, Arc<ObjectRequestCounts>) {
    let counts = Arc::new(ObjectRequestCounts::default());
    let backing: Arc<dyn ObjectStore> = Arc::new(RequestCountingObjectStore {
        inner: Arc::new(object_store::memory::InMemory::new()),
        counts: Arc::clone(&counts),
    });
    let authority = ObjectSubjectKeyStore::new(
        backing,
        "startup-request-count-v1",
        Uuid::new_v4(),
        "wrap-test-v1",
        [17_u8; 32],
        "journal-test-v1",
        [23_u8; 32],
    );
    (authority, counts)
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_first_startup_binds_exactly_one_complete_authority_manifest(
    pool: sqlx::PgPool,
) {
    let authority_id = Uuid::new_v4();
    let authority_a = ObjectSubjectKeyStore::new(
        Arc::new(object_store::memory::InMemory::new()),
        "revision-a",
        authority_id,
        "wrap-a",
        [31_u8; 32],
        "journal-a",
        [37_u8; 32],
    );
    let authority_b = ObjectSubjectKeyStore::new(
        Arc::new(object_store::memory::InMemory::new()),
        "revision-b",
        authority_id,
        "wrap-b",
        [41_u8; 32],
        "journal-b",
        [43_u8; 32],
    );
    let manifest_a = authority_a.bootstrap().await.unwrap();
    let manifest_b = authority_b.bootstrap().await.unwrap();
    let barrier = Arc::new(Barrier::new(3));

    let pool_a = pool.clone();
    let barrier_a = Arc::clone(&barrier);
    let manifest_a_task = manifest_a.clone();
    let first = tokio::spawn(async move {
        barrier_a.wait().await;
        verify_or_bind_database_authority(&pool_a, &manifest_a_task).await
    });
    let pool_b = pool.clone();
    let barrier_b = Arc::clone(&barrier);
    let manifest_b_task = manifest_b.clone();
    let second = tokio::spawn(async move {
        barrier_b.wait().await;
        verify_or_bind_database_authority(&pool_b, &manifest_b_task).await
    });
    barrier.wait().await;

    let first = first.await.unwrap();
    let second = second.await.unwrap();
    assert_ne!(first.is_ok(), second.is_ok());
    let rejected = if first.is_err() { &first } else { &second };
    assert!(matches!(
        rejected,
        Err(SubjectPrivacyError::Configuration(_))
    ));

    let winning_manifest = if first.is_ok() {
        &manifest_a
    } else {
        &manifest_b
    };
    let (bound_id, bound_revision, bound_digest): (Uuid, String, String) = sqlx::query_as(
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let expected_digest = format!(
        "{:x}",
        sha2::Sha256::digest(serde_json::to_vec(winning_manifest).unwrap())
    );
    assert_eq!(bound_id, authority_id);
    assert_eq!(bound_revision, winning_manifest.revision);
    assert_eq!(bound_digest, expected_digest);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn unbound_database_with_pre_subject_identity_data_refuses_new_authority(pool: sqlx::PgPool) {
    let authority = ObjectSubjectKeyStore::new(
        Arc::new(object_store::memory::InMemory::new()),
        "restore-safety-v1",
        Uuid::new_v4(),
        "wrap-v1",
        [47_u8; 32],
        "journal-v1",
        [53_u8; 32],
    );
    let manifest = authority.bootstrap().await.unwrap();
    sqlx::query(
        "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at) VALUES ('orphaned-pre-subject-principal', 'active', '{}'::text[], 1)",
    )
    .execute(&pool)
    .await
    .unwrap();

    let error = verify_or_bind_database_authority(&pool, &manifest)
        .await
        .expect_err("restored identity data without a binding must require explicit recovery");
    assert!(matches!(error, SubjectPrivacyError::Configuration(_)));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_authority_binding")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn repeat_startup_authenticates_journal_without_redeleting_reconciled_keys(
    pool: sqlx::PgPool,
) {
    let (inner, object_counts) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    let counts = Arc::new(AuthorityRequestCounts::default());
    let authority = ConfiguredSubjectKeyAuthority {
        key_store: Arc::new(RequestCountingKeyStore {
            inner: inner.clone(),
            counts: Arc::clone(&counts),
        }),
        manifest: Some(manifest),
    };

    // Bind the empty database to this authority before introducing subjects.
    assert_eq!(
        prepare_subject_authority_for_service(&pool, &authority)
            .await
            .unwrap(),
        0
    );

    const REVOCATION_COUNT: usize = 17;
    for ordinal in 0..REVOCATION_COUNT {
        let principal = format!("repeat-startup-{}", Uuid::new_v4().simple());
        let subject_id = SubjectId::random();
        sqlx::query(
            "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
        )
        .bind(&principal)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO privacy_subject (subject_id, principal_user_id, created_at) VALUES ($1, $2, 1)",
        )
        .bind(subject_id.as_uuid())
        .bind(&principal)
        .execute(&pool)
        .await
        .unwrap();
        inner.create(subject_id).await.unwrap();
        let record = SubjectRevocationRecord {
            subject_id,
            replacement_alias: format!("Former member {}", Uuid::new_v4().simple()),
            destroyed_at: 9 + ordinal as i64,
            key_fingerprint_sha256: inner.fingerprint(subject_id).await.unwrap(),
            receipt_id: Uuid::new_v4(),
        };
        inner.record_revocation(&record).await.unwrap();
    }

    counts.reset();
    object_counts.reset();
    assert_eq!(
        prepare_subject_authority_for_service(&pool, &authority)
            .await
            .unwrap(),
        REVOCATION_COUNT
    );
    assert_eq!(counts.revocation_lists.load(Ordering::Relaxed), 1);
    assert_eq!(object_counts.lists.load(Ordering::Relaxed), 1);
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        REVOCATION_COUNT
    );
    let max_revocation_get_concurrency = object_counts
        .max_revocation_get_concurrency
        .load(Ordering::Relaxed);
    assert!(
        (2..=16).contains(&max_revocation_get_concurrency),
        "journal reads must be concurrent but capped at 16; observed {max_revocation_get_concurrency}"
    );
    assert_eq!(counts.destroys.load(Ordering::Relaxed), REVOCATION_COUNT);
    let max_destroy_concurrency = counts.max_destroy_concurrency.load(Ordering::Relaxed);
    assert!(
        (2..=16).contains(&max_destroy_concurrency),
        "object deletion must be concurrent but capped at 16; observed {max_destroy_concurrency}"
    );
    assert_eq!(counts.loads.load(Ordering::Relaxed), 0);

    counts.reset();
    object_counts.reset();
    assert_eq!(
        prepare_subject_authority_for_service(&pool, &authority)
            .await
            .unwrap(),
        0
    );
    assert_eq!(
        counts.revocation_lists.load(Ordering::Relaxed),
        1,
        "repeat startup must still authenticate the complete external journal"
    );
    assert_eq!(object_counts.lists.load(Ordering::Relaxed), 1);
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        REVOCATION_COUNT,
        "repeat startup must still fetch and authenticate every journal object"
    );
    let max_revocation_get_concurrency = object_counts
        .max_revocation_get_concurrency
        .load(Ordering::Relaxed);
    assert!(
        (2..=16).contains(&max_revocation_get_concurrency),
        "repeat journal reads must remain capped at 16; observed {max_revocation_get_concurrency}"
    );
    assert_eq!(
        counts.destroys.load(Ordering::Relaxed),
        0,
        "a matching committed receipt must skip redundant object deletion"
    );
    assert_eq!(counts.loads.load(Ordering::Relaxed), 0);
    assert_eq!(counts.max_destroy_concurrency.load(Ordering::Relaxed), 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_key_destruction_receipt")
            .fetch_one(&pool)
            .await
            .unwrap(),
        REVOCATION_COUNT as i64
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn claim_that_owns_identity_locks_first_commits_then_startup_scrubs_it(pool: sqlx::PgPool) {
    let (authority, _) = object_authority();
    authority.bootstrap().await.unwrap();
    let principal = format!("claim-first-{}", Uuid::new_v4().simple());
    let subject_id = SubjectId::random();
    sqlx::query(
        "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_user_id, created_at) VALUES ($1, $2, 1)",
    )
    .bind(subject_id.as_uuid())
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();
    authority.create(subject_id).await.unwrap();

    // Model a claim whose payload was sealed immediately before the external
    // journal became visible. It already owns the canonical principal ->
    // subject pair, so reconciliation must wait and scrub its committed row.
    let mut claim = pool.begin().await.unwrap();
    sqlx::query("SELECT status FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE")
        .bind(&principal)
        .fetch_one(&mut *claim)
        .await
        .unwrap();
    sqlx::query("SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1 FOR UPDATE")
        .bind(subject_id.as_uuid())
        .fetch_one(&mut *claim)
        .await
        .unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: format!("Former member {}", Uuid::new_v4().simple()),
        destroyed_at: 9,
        key_fingerprint_sha256: authority.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    authority.record_revocation(&record).await.unwrap();

    let reconcile_pool = pool.clone();
    let reconcile_authority = authority.clone();
    let reconcile = tokio::spawn(async move {
        reconcile_subject_revocations_with_store(&reconcile_pool, &reconcile_authority).await
    });
    wait_for_lock_waiters(&pool, 1).await;
    sqlx::query(
        "INSERT INTO subject_private_claim (claim_id, subject_id, claim_kind, scope_id, envelope, created_at) VALUES ($1, $2, 'profile', $3, '{}'::jsonb, 8)",
    )
    .bind(Uuid::new_v4())
    .bind(subject_id.as_uuid())
    .bind(Uuid::new_v4())
    .execute(&mut *claim)
    .await
    .unwrap();
    claim.commit().await.unwrap();

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), reconcile)
            .await
            .expect("reconciliation should finish after the prior claim commits")
            .unwrap()
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_private_claim WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn startup_that_owns_identity_locks_first_rejects_overlapping_claim_before_readiness(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let principal = format!("startup-first-{}", Uuid::new_v4().simple());
    let subject_id = SubjectId::random();
    sqlx::query(
        "INSERT INTO platform_principal (principal_user_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_user_id, created_at) VALUES ($1, $2, 1)",
    )
    .bind(subject_id.as_uuid())
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();
    inner.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: format!("Former member {}", Uuid::new_v4().simple()),
        destroyed_at: 9,
        key_fingerprint_sha256: inner.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    inner.record_revocation(&record).await.unwrap();

    let destroy_entered = Arc::new(Barrier::new(2));
    let release_destroy = Arc::new(Barrier::new(2));
    let authority = ConfiguredSubjectKeyAuthority {
        key_store: Arc::new(BlockingDestroyKeyStore {
            inner,
            destroy_entered: Arc::clone(&destroy_entered),
            release_destroy: Arc::clone(&release_destroy),
        }),
        manifest: Some(manifest),
    };
    let startup_pool = pool.clone();
    let startup = tokio::spawn(async move {
        prepare_subject_authority_for_service(&startup_pool, &authority).await
    });
    tokio::time::timeout(Duration::from_secs(5), destroy_entered.wait())
        .await
        .expect("startup should reach key destruction after locking principal and subject");

    let claim_pool = pool.clone();
    let claim_principal = principal.clone();
    let claim = tokio::spawn(async move {
        let mut tx = claim_pool.begin().await.unwrap();
        let status: String = sqlx::query_scalar(
            "SELECT status FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
        )
        .bind(&claim_principal)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        if status != "active" {
            return false;
        }
        let lifecycle: String = sqlx::query_scalar(
            "SELECT lifecycle_state FROM privacy_subject WHERE principal_user_id = $1 FOR UPDATE",
        )
        .bind(&claim_principal)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        lifecycle == "active"
    });
    wait_for_lock_waiters(&pool, 1).await;
    tokio::time::timeout(Duration::from_secs(5), release_destroy.wait())
        .await
        .expect("blocked startup key destruction should resume");

    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), startup)
            .await
            .expect("startup should finish while the overlapping claim waits")
            .unwrap()
            .unwrap(),
        1
    );
    assert!(
        !tokio::time::timeout(Duration::from_secs(5), claim)
            .await
            .expect("overlapping claim should resume after startup")
            .unwrap(),
        "a claim that loses the startup lock race must observe disabled identity state"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "erased"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn startup_rejects_revocation_without_a_canonical_owner_before_key_deletion(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    inner.bootstrap().await.unwrap();
    let subject_id = SubjectId::random();
    inner.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: format!("Former member {}", Uuid::new_v4().simple()),
        destroyed_at: 9,
        key_fingerprint_sha256: inner.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    inner.record_revocation(&record).await.unwrap();
    let counts = Arc::new(AuthorityRequestCounts::default());
    let authority = RequestCountingKeyStore {
        inner,
        counts: Arc::clone(&counts),
    };

    let error = reconcile_subject_revocations_with_store(&pool, &authority)
        .await
        .expect_err("an ownerless journal record must block startup");
    assert!(matches!(
        error,
        SubjectPrivacyError::Storage(message)
            if message.contains("no canonical principal owner")
                && message.contains("explicit recovery")
    ));
    assert_eq!(counts.destroys.load(Ordering::Relaxed), 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_tombstone")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}
