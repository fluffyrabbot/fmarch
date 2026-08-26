use bytes::Bytes;
use futures_util::stream::BoxStream;
use identity::{
    prepare_subject_authority_for_service, process_pending_subject_erasures_with_store,
    random_tombstone_alias, reconcile_subject_revocations_with_store,
    request_member_erasure_with_store,
    subject_privacy::reconcile_subject_revocations_with_store_and_preflight_query_count,
    verify_active_subject_keys, verify_or_bind_database_authority, ConfiguredSubjectKeyAuthority,
    MemberLifecycleStatus, ObjectSubjectKeyStore, PrincipalId, SubjectId, SubjectKeyStore,
    SubjectPrivacyError, SubjectRevocationRecord,
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

#[derive(Debug, Clone)]
struct BlockingLoadKeyStore {
    inner: ObjectSubjectKeyStore,
    load_entered: Arc<Barrier>,
    release_load: Arc<Barrier>,
}

#[derive(Debug, Clone)]
struct SnapshotBlockingRevocationsKeyStore {
    inner: ObjectSubjectKeyStore,
    revocation_calls: Arc<AtomicUsize>,
    first_snapshot_taken: Arc<Barrier>,
    release_first_snapshot: Arc<Barrier>,
}

#[async_trait::async_trait]
impl SubjectKeyStore for SnapshotBlockingRevocationsKeyStore {
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
        self.inner.destroy(subject_id).await
    }

    async fn record_revocation(
        &self,
        record: &SubjectRevocationRecord,
    ) -> Result<(), SubjectPrivacyError> {
        self.inner.record_revocation(record).await
    }

    async fn revocations(&self) -> Result<Vec<SubjectRevocationRecord>, SubjectPrivacyError> {
        let snapshot = self.inner.revocations().await?;
        if self.revocation_calls.fetch_add(1, Ordering::SeqCst) == 0 {
            self.first_snapshot_taken.wait().await;
            self.release_first_snapshot.wait().await;
        }
        Ok(snapshot)
    }
}

#[async_trait::async_trait]
impl SubjectKeyStore for BlockingLoadKeyStore {
    async fn check_readiness(&self) -> Result<(), SubjectPrivacyError> {
        self.inner.check_readiness().await
    }

    async fn create(&self, subject_id: SubjectId) -> Result<(), SubjectPrivacyError> {
        self.inner.create(subject_id).await
    }

    async fn load(&self, subject_id: SubjectId) -> Result<[u8; 32], SubjectPrivacyError> {
        self.load_entered.wait().await;
        self.release_load.wait().await;
        self.inner.load(subject_id).await
    }

    async fn destroy(&self, subject_id: SubjectId) -> Result<bool, SubjectPrivacyError> {
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

async fn provision_subject(
    pool: &sqlx::PgPool,
    key_store: &dyn SubjectKeyStore,
    _label: &str,
) -> (PrincipalId, SubjectId) {
    let principal = PrincipalId::random();
    let subject_id = SubjectId::random();
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(principal.as_uuid())
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, $2, 1)",
    )
    .bind(subject_id.as_uuid())
    .bind(principal.as_uuid())
    .execute(pool)
    .await
    .unwrap();
    key_store.create(subject_id).await.unwrap();
    (principal, subject_id)
}

#[sqlx::test(migrations = "../database_schema/migrations")]
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
    let orphan_principal = PrincipalId::fixture("orphaned-pre-subject-principal");
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(orphan_principal.as_uuid())
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

#[sqlx::test(migrations = "../database_schema/migrations")]
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
        let principal = PrincipalId::random();
        let subject_id = SubjectId::random();
        sqlx::query(
            "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
        )
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, $2, 1)",
        )
        .bind(subject_id.as_uuid())
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
        inner.create(subject_id).await.unwrap();
        let record = SubjectRevocationRecord {
            subject_id,
            replacement_alias: random_tombstone_alias(),
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
    assert_eq!(counts.revocation_lists.load(Ordering::Relaxed), 2);
    assert_eq!(object_counts.lists.load(Ordering::Relaxed), 2);
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        REVOCATION_COUNT * 2
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
        (2..=4).contains(&max_destroy_concurrency),
        "whole erasure jobs must be concurrent but capped at 4; observed {max_destroy_concurrency}"
    );
    assert_eq!(
        counts.loads.load(Ordering::Relaxed),
        REVOCATION_COUNT,
        "each destruction must be verified by a missing-key read"
    );

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
        2,
        "repeat startup must authenticate both its initial and post-tombstone journal snapshots"
    );
    assert_eq!(object_counts.lists.load(Ordering::Relaxed), 2);
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        REVOCATION_COUNT * 2,
        "repeat startup must fetch and authenticate every object in both journal snapshots"
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn claim_that_owns_identity_locks_first_commits_then_startup_scrubs_it(pool: sqlx::PgPool) {
    let (authority, _) = object_authority();
    authority.bootstrap().await.unwrap();
    let principal = PrincipalId::random();
    let subject_id = SubjectId::random();
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, $2, 1)",
    )
    .bind(subject_id.as_uuid())
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    authority.create(subject_id).await.unwrap();

    // Model a claim whose payload was sealed immediately before the external
    // journal became visible. It already owns the canonical principal ->
    // subject pair, so reconciliation must wait and scrub its committed row.
    let mut claim = pool.begin().await.unwrap();
    sqlx::query("SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE")
        .bind(principal.as_uuid())
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
        replacement_alias: random_tombstone_alias(),
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_commits_identity_cutoff_before_authority_io_and_rejects_overlapping_claim(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let principal = PrincipalId::random();
    let subject_id = SubjectId::random();
    sqlx::query(
        "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::text[], 1)",
    )
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, $2, 1)",
    )
    .bind(subject_id.as_uuid())
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    inner.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: random_tombstone_alias(),
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
        .expect("startup should reach key destruction after committing the identity cutoff");

    let claim_pool = pool.clone();
    let claim_principal = principal;
    let claim = tokio::spawn(async move {
        let mut tx = claim_pool.begin().await.unwrap();
        let status: String = sqlx::query_scalar(
            "SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
        )
        .bind(claim_principal.as_uuid())
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        if status != "active" {
            return false;
        }
        let lifecycle: String = sqlx::query_scalar(
            "SELECT lifecycle_state FROM privacy_subject WHERE principal_id = $1 FOR UPDATE",
        )
        .bind(claim_principal.as_uuid())
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        lifecycle == "active"
    });
    assert!(
        !tokio::time::timeout(Duration::from_secs(5), claim)
            .await
            .expect("overlapping claim must not wait on authority I/O")
            .unwrap(),
        "the committed erasure cutoff must reject a claim while key destruction is blocked"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "authority I/O must not retain a database row lock"
    );
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

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_accepts_external_history_created_after_the_restored_database_snapshot(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    inner.bootstrap().await.unwrap();
    let subject_id = SubjectId::random();
    inner.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: random_tombstone_alias(),
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

    assert_eq!(
        reconcile_subject_revocations_with_store(&pool, &authority)
            .await
            .unwrap(),
        0,
        "a backup from before this subject existed must accept its authenticated external history"
    );
    assert_eq!(counts.destroys.load(Ordering::Relaxed), 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_tombstone")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_rejects_partial_subject_history_without_a_canonical_owner(pool: sqlx::PgPool) {
    let (inner, _) = object_authority();
    inner.bootstrap().await.unwrap();
    let subject_id = SubjectId::random();
    inner.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: random_tombstone_alias(),
        destroyed_at: 9,
        key_fingerprint_sha256: inner.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    inner.record_revocation(&record).await.unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject (subject_id, principal_id, created_at) VALUES ($1, NULL, 1)",
    )
    .bind(subject_id.as_uuid())
    .execute(&pool)
    .await
    .unwrap();
    let counts = Arc::new(AuthorityRequestCounts::default());
    let authority = RequestCountingKeyStore {
        inner,
        counts: Arc::clone(&counts),
    };

    let error = reconcile_subject_revocations_with_store(&pool, &authority)
        .await
        .expect_err("partial local subject history must fail closed");
    assert!(matches!(
        error,
        SubjectPrivacyError::Storage(message)
            if message.contains("no canonical principal owner")
                && message.contains("explicit recovery")
    ));
    assert_eq!(counts.destroys.load(Ordering::Relaxed), 0);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn request_fingerprints_before_owner_locks_and_commits_the_cutoff_afterward(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let (principal, subject_id) = provision_subject(&pool, &inner, "request-no-lock").await;
    let load_entered = Arc::new(Barrier::new(2));
    let release_load = Arc::new(Barrier::new(2));
    let store = BlockingLoadKeyStore {
        inner,
        load_entered: Arc::clone(&load_entered),
        release_load: Arc::clone(&release_load),
    };

    let request_pool = pool.clone();
    let request_principal = principal;
    let request_store = store.clone();
    let request = tokio::spawn(async move {
        request_member_erasure_with_store(&request_pool, &request_store, &request_principal, 10)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), load_entered.wait())
        .await
        .expect("request should fingerprint before its owner transaction");

    let mut observer = pool.begin().await.unwrap();
    sqlx::query("SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE NOWAIT")
        .bind(principal.as_uuid())
        .fetch_one(&mut *observer)
        .await
        .expect("authority fingerprinting must not hold the principal lock");
    sqlx::query(
        "SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1 FOR UPDATE NOWAIT",
    )
    .bind(subject_id.as_uuid())
    .fetch_one(&mut *observer)
    .await
    .expect("authority fingerprinting must not hold the subject lock");
    observer.commit().await.unwrap();
    release_load.wait().await;

    let (snapshot, _) = tokio::time::timeout(Duration::from_secs(5), request)
        .await
        .expect("request should finish after fingerprinting resumes")
        .unwrap()
        .unwrap();
    assert_eq!(snapshot.status, MemberLifecycleStatus::ErasureInProgress);
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "erasure_pending"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM platform_principal WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "disabled"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn durable_erasure_resumes_after_each_external_boundary_and_final_tx_rollback(
    pool: sqlx::PgPool,
) {
    let (store, _) = object_authority();
    let manifest = store.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();

    // Crash after the request transaction: the auth cutoff and random alias
    // are durable while the key and external journal remain untouched.
    let (request_principal, request_subject) =
        provision_subject(&pool, &store, "crash-after-request").await;
    let (pending, request_work) =
        request_member_erasure_with_store(&pool, &store, &request_principal, 10)
            .await
            .unwrap();
    assert_eq!(pending.status, MemberLifecycleStatus::ErasureInProgress);
    assert!(store.load(request_subject).await.is_ok());
    assert!(store.revocations().await.unwrap().is_empty());
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT state FROM subject_erasure WHERE erasure_id = $1",)
            .bind(request_work.erasure_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
        "pending"
    );
    assert_eq!(
        reconcile_subject_revocations_with_store(&pool, &store)
            .await
            .unwrap(),
        1
    );

    // Crash after the external journal is durable but before key destruction.
    let (journal_principal, journal_subject) =
        provision_subject(&pool, &store, "crash-after-journal").await;
    let (_, journal_work) =
        request_member_erasure_with_store(&pool, &store, &journal_principal, 20)
            .await
            .unwrap();
    store.record_revocation(&journal_work.record).await.unwrap();
    assert_eq!(
        reconcile_subject_revocations_with_store(&pool, &store)
            .await
            .unwrap(),
        1
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT key_was_present FROM subject_key_destruction_receipt WHERE erasure_id = $1",
        )
        .bind(journal_work.erasure_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "the post-journal worker must still physically destroy the key"
    );

    // Crash after the key is gone but before the final database transaction.
    let (destroy_principal, destroy_subject) =
        provision_subject(&pool, &store, "crash-after-destroy").await;
    let (_, destroy_work) =
        request_member_erasure_with_store(&pool, &store, &destroy_principal, 30)
            .await
            .unwrap();
    store.record_revocation(&destroy_work.record).await.unwrap();
    assert!(store.destroy(destroy_subject).await.unwrap());
    assert_eq!(
        reconcile_subject_revocations_with_store(&pool, &store)
            .await
            .unwrap(),
        1
    );

    // Force the final database transaction to roll back after its tombstone
    // and receipt writes. The committed intent remains presentation-redacted,
    // and startup retries the already-durable external receipt to completion.
    let (rollback_principal, rollback_subject) =
        provision_subject(&pool, &store, "crash-final-rollback").await;
    let (_, rollback_work) =
        request_member_erasure_with_store(&pool, &store, &rollback_principal, 40)
            .await
            .unwrap();
    sqlx::raw_sql(
        r#"
        CREATE FUNCTION fail_subject_erasure_completion() RETURNS trigger
            LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.state = 'complete' THEN
                RAISE EXCEPTION 'injected final erasure rollback';
            END IF;
            RETURN NEW;
        END;
        $$;
        CREATE TRIGGER fail_subject_erasure_completion
            BEFORE UPDATE ON subject_erasure
            FOR EACH ROW EXECUTE FUNCTION fail_subject_erasure_completion();
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let failure = process_pending_subject_erasures_with_store(&pool, &store, "worker-a", 40)
        .await
        .expect_err("the injected final transaction must roll back");
    assert!(failure
        .to_string()
        .contains("injected final erasure rollback"));
    assert!(matches!(
        store.load(rollback_subject).await,
        Err(SubjectPrivacyError::MissingKey { .. })
    ));
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(rollback_subject.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "erasure_pending"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_tombstone WHERE subject_id = $1",
        )
        .bind(rollback_subject.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_key_destruction_receipt WHERE erasure_id = $1",
        )
        .bind(rollback_work.erasure_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    sqlx::raw_sql(
        "DROP TRIGGER fail_subject_erasure_completion ON subject_erasure; DROP FUNCTION fail_subject_erasure_completion();",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        reconcile_subject_revocations_with_store(&pool, &store)
            .await
            .unwrap(),
        1
    );

    for (subject_id, erasure_id) in [
        (request_subject, request_work.erasure_id),
        (journal_subject, journal_work.erasure_id),
        (destroy_subject, destroy_work.erasure_id),
        (rollback_subject, rollback_work.erasure_id),
    ] {
        assert_eq!(
            sqlx::query_as::<_, (String, String)>(
                "SELECT subject.lifecycle_state, erasure.state FROM privacy_subject AS subject JOIN subject_erasure_outbox AS outbox USING (subject_id) JOIN subject_erasure AS erasure USING (erasure_id) WHERE subject.subject_id = $1 AND erasure.erasure_id = $2",
            )
            .bind(subject_id.as_uuid())
            .bind(erasure_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            ("erased".to_string(), "complete".to_string())
        );
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn two_workers_claim_one_erasure_without_holding_owner_locks_during_destroy(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let (principal, _) = provision_subject(&pool, &inner, "two-erasure-workers").await;
    let (_, work) = request_member_erasure_with_store(&pool, &inner, &principal, 10)
        .await
        .unwrap();
    let destroy_entered = Arc::new(Barrier::new(2));
    let release_destroy = Arc::new(Barrier::new(2));
    let store = BlockingDestroyKeyStore {
        inner,
        destroy_entered: Arc::clone(&destroy_entered),
        release_destroy: Arc::clone(&release_destroy),
    };

    let first_pool = pool.clone();
    let first_store = store.clone();
    let first = tokio::spawn(async move {
        process_pending_subject_erasures_with_store(&first_pool, &first_store, "replica-a", 10)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), destroy_entered.wait())
        .await
        .expect("the first worker should claim and reach external destruction");

    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(5),
            process_pending_subject_erasures_with_store(&pool, &store, "replica-b", 10),
        )
        .await
        .expect("the second replica must not wait on the first replica's external I/O")
        .unwrap(),
        0
    );
    release_destroy.wait().await;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), first)
            .await
            .expect("the claimed worker should finish")
            .unwrap()
            .unwrap(),
        1
    );
    assert_eq!(
        sqlx::query_as::<_, (String, i32)>(
            "SELECT state, attempt_count FROM subject_erasure WHERE erasure_id = $1",
        )
        .bind(work.erasure_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        ("complete".to_string(), 1)
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn expired_claim_reclaim_fences_the_stale_worker_and_canonicalizes_the_receipt(
    pool: sqlx::PgPool,
) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let (principal, _) = provision_subject(&pool, &inner, "stale-erasure-worker").await;
    let (_, work) = request_member_erasure_with_store(&pool, &inner, &principal, 10)
        .await
        .unwrap();
    let reclaim_store = inner.clone();
    let destroy_entered = Arc::new(Barrier::new(2));
    let release_destroy = Arc::new(Barrier::new(2));
    let stale_store = BlockingDestroyKeyStore {
        inner,
        destroy_entered: Arc::clone(&destroy_entered),
        release_destroy: Arc::clone(&release_destroy),
    };

    let stale_pool = pool.clone();
    let stale = tokio::spawn(async move {
        process_pending_subject_erasures_with_store(&stale_pool, &stale_store, "replica-a", 10)
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), destroy_entered.wait())
        .await
        .expect("the first claim should pause after its lease transaction committed");

    // The 60-second lease has expired. Replica B owns a new token, performs
    // the physical deletion, and commits the only canonical receipt.
    assert_eq!(
        process_pending_subject_erasures_with_store(&pool, &reclaim_store, "replica-b", 71)
            .await
            .unwrap(),
        1
    );
    release_destroy.wait().await;
    let stale_error = tokio::time::timeout(Duration::from_secs(5), stale)
        .await
        .expect("the stale worker should reach its fenced finalization")
        .unwrap()
        .expect_err("the expired claim must not finalize after takeover");
    assert!(stale_error.to_string().contains("lost fenced claim"));

    let (state, attempts, completed_at): (String, i32, Option<i64>) = sqlx::query_as(
        "SELECT state, attempt_count, completed_at FROM subject_erasure WHERE erasure_id = $1",
    )
    .bind(work.erasure_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (state.as_str(), attempts, completed_at),
        ("complete", 2, Some(71))
    );
    assert!(
        sqlx::query_scalar::<_, bool>(
            "SELECT key_was_present FROM subject_key_destruction_receipt WHERE erasure_id = $1",
        )
        .bind(work.erasure_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        "only the fenced winner may define the canonical destruction result"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn final_journal_snapshot_covers_a_concurrent_replica_tombstone(pool: sqlx::PgPool) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let (principal, _) = provision_subject(&pool, &inner, "journal-tombstone-race").await;
    request_member_erasure_with_store(&pool, &inner, &principal, 10)
        .await
        .unwrap();
    let first_snapshot_taken = Arc::new(Barrier::new(2));
    let release_first_snapshot = Arc::new(Barrier::new(2));
    let revocation_calls = Arc::new(AtomicUsize::new(0));
    let startup_store = SnapshotBlockingRevocationsKeyStore {
        inner: inner.clone(),
        revocation_calls: Arc::clone(&revocation_calls),
        first_snapshot_taken: Arc::clone(&first_snapshot_taken),
        release_first_snapshot: Arc::clone(&release_first_snapshot),
    };

    let startup_pool = pool.clone();
    let startup = tokio::spawn(async move {
        reconcile_subject_revocations_with_store(&startup_pool, &startup_store).await
    });
    tokio::time::timeout(Duration::from_secs(5), first_snapshot_taken.wait())
        .await
        .expect("startup should capture its initially empty journal snapshot");
    assert_eq!(
        process_pending_subject_erasures_with_store(&pool, &inner, "replica-b", 10)
            .await
            .unwrap(),
        1
    );
    release_first_snapshot.wait().await;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), startup)
            .await
            .expect("startup should authenticate a fresh journal after capturing tombstones")
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(revocation_calls.load(Ordering::SeqCst), 2);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn active_key_verification_accepts_only_a_monotonic_pending_transition(pool: sqlx::PgPool) {
    let (inner, _) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let (principal, subject_id) = provision_subject(&pool, &inner, "active-key-race").await;
    let load_entered = Arc::new(Barrier::new(2));
    let release_load = Arc::new(Barrier::new(2));
    let verifying_store = BlockingLoadKeyStore {
        inner: inner.clone(),
        load_entered: Arc::clone(&load_entered),
        release_load: Arc::clone(&release_load),
    };

    let verify_pool = pool.clone();
    let verify =
        tokio::spawn(
            async move { verify_active_subject_keys(&verify_pool, &verifying_store).await },
        );
    tokio::time::timeout(Duration::from_secs(5), load_entered.wait())
        .await
        .expect("verification should snapshot the subject as active before loading its key");
    let (_, work) = request_member_erasure_with_store(&pool, &inner, &principal, 10)
        .await
        .unwrap();
    inner.record_revocation(&work.record).await.unwrap();
    release_load.wait().await;
    tokio::time::timeout(Duration::from_secs(5), verify)
        .await
        .expect("verification should re-read canonical state after a missing key")
        .unwrap()
        .unwrap();
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT lifecycle_state FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        "erasure_pending"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn pending_batch_writes_each_receipt_without_relisting_the_complete_journal(
    pool: sqlx::PgPool,
) {
    let (inner, object_counts) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let counts = Arc::new(AuthorityRequestCounts::default());
    let store = RequestCountingKeyStore {
        inner,
        counts: Arc::clone(&counts),
    };
    const ERASURE_COUNT: usize = 17;
    for _ in 0..ERASURE_COUNT {
        let (principal, _) = provision_subject(&pool, &store, "pending-batch").await;
        request_member_erasure_with_store(&pool, &store, &principal, 10)
            .await
            .unwrap();
    }

    counts.reset();
    object_counts.reset();
    assert_eq!(
        process_pending_subject_erasures_with_store(&pool, &store, "batch-worker", 10)
            .await
            .unwrap(),
        ERASURE_COUNT
    );
    assert_eq!(
        counts.revocation_lists.load(Ordering::Relaxed),
        0,
        "new outbox work must not perform one complete journal scan per subject"
    );
    assert_eq!(
        object_counts.lists.load(Ordering::Relaxed),
        0,
        "a pending batch must use create-only point writes, not journal LIST"
    );
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        ERASURE_COUNT,
        "each create-only receipt should perform exactly one point verification"
    );
    assert_eq!(counts.destroys.load(Ordering::Relaxed), ERASURE_COUNT);
    assert!(
        (2..=4).contains(&counts.max_destroy_concurrency.load(Ordering::Relaxed)),
        "whole erasure jobs must be capped at four to preserve pool headroom"
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn startup_batch_loads_existing_outboxes_in_one_preflight_query(pool: sqlx::PgPool) {
    let (inner, object_counts) = object_authority();
    let manifest = inner.bootstrap().await.unwrap();
    verify_or_bind_database_authority(&pool, &manifest)
        .await
        .unwrap();
    let counts = Arc::new(AuthorityRequestCounts::default());
    let store = RequestCountingKeyStore {
        inner,
        counts: Arc::clone(&counts),
    };
    const ERASURE_COUNT: usize = 17;
    let mut records = Vec::with_capacity(ERASURE_COUNT);
    for _ in 0..ERASURE_COUNT {
        let (principal, _) = provision_subject(&pool, &store, "startup-batch-load").await;
        let (_, work) = request_member_erasure_with_store(&pool, &store, &principal, 10)
            .await
            .unwrap();
        store.record_revocation(&work.record).await.unwrap();
        records.push(work.record);
    }

    counts.reset();
    object_counts.reset();
    let (completed, preflight_queries) =
        reconcile_subject_revocations_with_store_and_preflight_query_count(&pool, &store)
            .await
            .unwrap();
    assert_eq!(completed, ERASURE_COUNT);
    assert_eq!(
        preflight_queries, 1,
        "all authenticated journal subjects with durable outboxes must batch-load in one SQL query"
    );
    assert_eq!(counts.revocation_lists.load(Ordering::Relaxed), 2);
    assert_eq!(object_counts.lists.load(Ordering::Relaxed), 2);
    assert_eq!(
        object_counts.revocation_gets.load(Ordering::Relaxed),
        ERASURE_COUNT * 2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_erasure WHERE state = 'complete'"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        ERASURE_COUNT as i64
    );
    assert_eq!(records.len(), ERASURE_COUNT);
}
