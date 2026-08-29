use eventstore::{ActorId, EventInput};
use game_platform::{GamePersonaName, GamePersonaPresentation};
use identity::{
    prepare_subject_authority_for_service, random_tombstone_alias, reconcile_subject_revocations,
    ConfiguredSubjectKeyAuthority, FilesystemSubjectKeyStore, ObjectSubjectKeyStore, SubjectId,
    SubjectKeyStore, SubjectPrivacyError, SubjectRevocationRecord,
};
use projections::{
    append_and_project, append_and_project_in_tx, public_profile_by_handle,
    rebuild as rebuild_game, rebuild_profile_stream,
};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileHandle, ProfilePresentation,
    ProfileVisibility,
};
use sqlx::Row;
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use uuid::Uuid;

static SUBJECT_KEY_ENV_LOCK: Mutex<()> = Mutex::new(());
const GAME_PERSONA_PRESENTATION_CLAIM_KIND: &str = "game_persona_presentation";

struct SubjectKeyEnvironment {
    prior: Option<String>,
    directory: tempfile::TempDir,
    _lock: MutexGuard<'static, ()>,
}

impl SubjectKeyEnvironment {
    fn isolated() -> Self {
        let lock = SUBJECT_KEY_ENV_LOCK
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let prior = std::env::var("FMARCH_SUBJECT_KEY_DIR").ok();
        let directory = tempfile::tempdir().unwrap();
        std::env::set_var("FMARCH_SUBJECT_KEY_DIR", directory.path());
        Self {
            prior,
            directory,
            _lock: lock,
        }
    }

    fn store(&self) -> FilesystemSubjectKeyStore {
        FilesystemSubjectKeyStore::new(self.directory.path()).unwrap()
    }
}

impl Drop for SubjectKeyEnvironment {
    fn drop(&mut self) {
        match &self.prior {
            Some(prior) => std::env::set_var("FMARCH_SUBJECT_KEY_DIR", prior),
            None => std::env::remove_var("FMARCH_SUBJECT_KEY_DIR"),
        }
    }
}

async fn ensure_principal(pool: &sqlx::PgPool, principal: PrincipalId) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
        .await
        .unwrap();
}

/// Seed a classic account through the same method/detail relationship enforced
/// in production. Tests that need deliberately corrupt identity data construct
/// that corruption explicitly at the call site instead of weakening this
/// ordinary fixture.
async fn insert_classic_account_fixture(
    pool: &sqlx::PgPool,
    account_id: &str,
    principal: PrincipalId,
    password_hash: &str,
) {
    let mut transaction = pool.begin().await.unwrap();
    let method_id = identity::methods::create_method(
        &mut transaction,
        &principal,
        identity::MethodKind::ClassicPassword,
        1,
    )
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO auth_account \
         (account_id, principal_id, method_id, password_hash, created_at, global_capabilities) \
         VALUES ($1, $2, $3, $4, 1, '{}'::text[])",
    )
    .bind(account_id)
    .bind(principal.as_uuid())
    .bind(method_id)
    .bind(password_hash)
    .execute(&mut *transaction)
    .await
    .unwrap();
    transaction.commit().await.unwrap();
}

/// Issue a sealed presentation claim before appending the canonical, reference-only
/// persona event. Tests deliberately use the same boundary shape as production:
/// a game stream never receives a credential principal or public name payload.
async fn append_game_persona(
    pool: &sqlx::PgPool,
    game_id: Uuid,
    persona_id: Uuid,
    principal: PrincipalId,
    public_name: &str,
    occurred_at: i64,
) {
    let mut tx = pool.begin().await.unwrap();
    let subject_id = identity::ensure_active_subject(&mut tx, principal, occurred_at)
        .await
        .unwrap();
    let scope_key = persona_id.to_string();
    let claim_id = identity::insert_subject_claim(
        &mut tx,
        subject_id,
        GAME_PERSONA_PRESENTATION_CLAIM_KIND,
        game_id,
        Some(&scope_key),
        occurred_at,
        &GamePersonaPresentation {
            public_name: GamePersonaName::new(public_name).unwrap(),
        },
    )
    .await
    .unwrap();
    append_and_project_in_tx(
        &mut tx,
        game_id,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": persona_id,
                "subject_id": subject_id.as_uuid(),
                "claim_id": claim_id.as_uuid(),
            }),
            ActorId::Host,
            occurred_at,
        )],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn raw_persona_identity_payload_is_rejected_before_event_persistence(pool: sqlx::PgPool) {
    let game_id = Uuid::new_v4();
    let error = append_and_project(
        &pool,
        game_id,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": Uuid::new_v4(),
                "principal_id": "credential-principal-must-not-enter-game-history",
                "public_name": "Private presentation must be sealed first",
            }),
            ActorId::Host,
            1,
        )],
    )
    .await
    .expect_err("raw persona authority and presentation must be refused");

    assert!(matches!(error, projections::ProjectionError::Privacy(_)));
    assert!(
        eventstore::load_stream(&pool, game_id)
            .await
            .unwrap()
            .is_empty(),
        "the append seam must reject legacy persona fields before writing history"
    );
}

async fn create_test_profile(
    pool: &sqlx::PgPool,
    principal: PrincipalId,
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: ProfileVisibility,
    occurred_at: i64,
) -> Uuid {
    let presentation = ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(display_name).unwrap(),
        ProfileBio::new(bio).unwrap(),
        visibility,
    );
    profile_application::create_profile(pool, principal, presentation, occurred_at)
        .await
        .unwrap()
        .as_uuid()
}

struct MemberProfileMetadata {
    active_principal_id: Option<PrincipalId>,
    handle_hmac: Option<Vec<u8>>,
    redacted_alias: Option<String>,
    current_claim_id: Option<Uuid>,
    lifecycle: String,
    revision: i64,
}

async fn member_profile_metadata(pool: &sqlx::PgPool, profile_id: Uuid) -> MemberProfileMetadata {
    let row = sqlx::query(
        "SELECT active_principal_id, handle_hmac, redacted_alias, current_claim_id, lifecycle, revision FROM member_profile WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(pool)
    .await
    .unwrap();
    MemberProfileMetadata {
        active_principal_id: row
            .get::<Option<Uuid>, _>("active_principal_id")
            .map(PrincipalId::from_uuid),
        handle_hmac: row.get("handle_hmac"),
        redacted_alias: row.get("redacted_alias"),
        current_claim_id: row.get("current_claim_id"),
        lifecycle: row.get("lifecycle"),
        revision: row.get("revision"),
    }
}

async fn assert_no_public_profile(pool: &sqlx::PgPool, profile_id: Uuid) {
    assert!(
        !sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM public_profile WHERE profile_id = $1)",
        )
        .bind(profile_id)
        .fetch_one(pool)
        .await
        .unwrap(),
        "private and redacted profiles must have no public plaintext row",
    );
}

async fn wait_for_lock_waiters(pool: &sqlx::PgPool, expected: i64) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let waiters: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM pg_stat_activity \
                 WHERE datname = current_database() AND wait_event_type = 'Lock'",
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

async fn object_authority(
    authority_id: Uuid,
) -> (ObjectSubjectKeyStore, ConfiguredSubjectKeyAuthority) {
    let store = ObjectSubjectKeyStore::new(
        Arc::new(object_store::memory::InMemory::new()),
        "pg-test-revision",
        authority_id,
        "pg-wrap-v1",
        [31_u8; 32],
        "pg-journal-v1",
        [47_u8; 32],
    );
    let manifest = store.bootstrap().await.unwrap();
    let configured = ConfiguredSubjectKeyAuthority {
        key_store: Arc::new(store.clone()),
        manifest: Some(manifest),
    };
    (store, configured)
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn profile_erasure_cannot_resurrect_through_rebuild(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let handle = format!("private_{}", &Uuid::new_v4().simple().to_string()[..12]);
    let profile_id = create_test_profile(
        &pool,
        principal,
        &handle,
        "Canary Real Name",
        "canary private biography",
        ProfileVisibility::Private,
        1,
    )
    .await;
    assert!(public_profile_by_handle(&pool, &handle)
        .await
        .unwrap()
        .is_none());
    let active = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(active.active_principal_id, Some(principal));
    assert_eq!(active.lifecycle, "active");
    assert_eq!(active.redacted_alias, None);
    assert!(active.current_claim_id.is_some());
    assert_eq!(active.revision, 1);
    assert_eq!(
        active.handle_hmac.as_deref().map(<[u8]>::len),
        Some(32),
        "the active private profile retains only an opaque handle reservation",
    );

    let canonical = eventstore::load_stream(&pool, profile_id).await.unwrap();
    assert_eq!(canonical.len(), 1);
    assert_eq!(
        canonical[0]
            .payload
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        ["claim_id", "subject_id"].into_iter().collect()
    );
    assert!(!canonical[0]
        .payload
        .to_string()
        .contains(&principal.to_string()));
    assert!(!matches!(
        &canonical[0].actor,
        ActorId::Principal(user) if user == &principal
    ));
    assert!(matches!(&canonical[0].actor, ActorId::PrivacySubject(_)));

    let raw_event: (i64, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT stream_key_epoch, sealed_nonce, sealed_body FROM events WHERE stream_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let raw_event = format!(
        "{}:{}:{}",
        raw_event.0,
        String::from_utf8_lossy(&raw_event.1),
        String::from_utf8_lossy(&raw_event.2)
    );
    let raw_claim: String =
        sqlx::query_scalar("SELECT envelope::text FROM subject_private_claim WHERE scope_id = $1")
            .bind(profile_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let principal_text = principal.to_string();
    for canary in [
        principal_text.as_str(),
        handle.as_str(),
        "Canary Real Name",
        "canary private biography",
    ] {
        assert!(!raw_event.contains(canary));
        assert!(!raw_claim.contains(canary));
    }

    let erased = identity::erase_member(&pool, &principal, 10).await.unwrap();
    let alias = erased.pseudonym.unwrap();
    assert!(alias.starts_with("former-member-"));
    assert!(!alias.contains(&principal.to_string()));
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_private_claim WHERE scope_id = $1",
        )
        .bind(profile_id)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_id = $1")
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let rebuilt_lifecycle = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(rebuilt_lifecycle.pseudonym.as_deref(), Some(alias.as_str()));

    rebuild_profile_stream(&pool, profile_id).await.unwrap();
    assert_no_public_profile(&pool, profile_id).await;
    let redacted = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(redacted.active_principal_id, None);
    assert_eq!(redacted.handle_hmac, None);
    assert_eq!(redacted.redacted_alias, Some(alias));
    assert_eq!(redacted.current_claim_id, None);
    assert_eq!(redacted.lifecycle, "redacted");
    assert_eq!(redacted.revision, 1);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn pending_erasure_rebuilds_profile_and_persona_as_terminally_redacted(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    let game_id = Uuid::new_v4();
    ensure_principal(&pool, principal).await;
    let persona_id = Uuid::new_v4();
    let profile_id = create_test_profile(
        &pool,
        principal,
        "pending_private_handle",
        "Pending Private Name",
        "pending private biography",
        ProfileVisibility::Private,
        1,
    )
    .await;
    append_game_persona(
        &pool,
        game_id,
        persona_id,
        principal,
        "Pending Persona Name",
        1,
    )
    .await;

    let pending = identity::request_member_erasure(&pool, &principal, 10)
        .await
        .unwrap();
    let alias = pending.pseudonym.unwrap();
    assert_eq!(
        pending.status,
        identity::MemberLifecycleStatus::ErasureInProgress
    );
    let subject_id = SubjectId::from_uuid(
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap(),
    );
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
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM subject_tombstone WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "terminal tombstones require verified key destruction"
    );
    assert!(environment.store().load(subject_id).await.is_ok());

    rebuild_profile_stream(&pool, profile_id).await.unwrap();
    rebuild_game(&pool, game_id).await.unwrap();
    assert_no_public_profile(&pool, profile_id).await;
    let profile = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(profile.active_principal_id, None);
    assert_eq!(profile.handle_hmac, None);
    assert_eq!(profile.redacted_alias, Some(alias.clone()));
    assert_eq!(profile.current_claim_id, None);
    assert_eq!(profile.lifecycle, "redacted");
    let persona = sqlx::query(
        "SELECT public.current_public_name, binding.subject_id, binding.current_claim_id, binding.lifecycle FROM game_persona_public AS public JOIN game_persona_subject_binding AS binding USING (game_id, persona_id) WHERE game_id = $1 AND persona_id = $2",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persona.get::<String, _>("current_public_name"), alias);
    assert_eq!(persona.get::<Uuid, _>("subject_id"), subject_id.as_uuid());
    assert_eq!(persona.get::<Option<Uuid>, _>("current_claim_id"), None);
    assert_eq!(persona.get::<String, _>("lifecycle"), "redacted");

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_id = $1")
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    let rebuilt = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(
        rebuilt.status,
        identity::MemberLifecycleStatus::ErasureInProgress
    );
    assert_eq!(rebuilt.pseudonym.as_deref(), Some(alias.as_str()));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_persona_erasure_rebuilds_only_random_tombstone_alias(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let game_id = Uuid::new_v4();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let persona_id = Uuid::new_v4();
    append_game_persona(
        &pool,
        game_id,
        persona_id,
        principal,
        "Canary Persona Name",
        1,
    )
    .await;

    let canonical = eventstore::load_stream(&pool, game_id).await.unwrap();
    assert_eq!(canonical.len(), 1);
    assert_eq!(
        canonical[0]
            .payload
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        ["claim_id", "persona_id", "subject_id"]
            .into_iter()
            .collect()
    );
    assert!(!canonical[0]
        .payload
        .to_string()
        .contains(&principal.to_string()));
    assert!(!canonical[0]
        .payload
        .to_string()
        .contains("Canary Persona Name"));
    assert!(!matches!(
        &canonical[0].actor,
        ActorId::Principal(actor) if actor == &principal
    ));

    let alias = identity::erase_member(&pool, &principal, 10)
        .await
        .unwrap()
        .pseudonym
        .unwrap();
    rebuild_game(&pool, game_id).await.unwrap();
    let row = sqlx::query(
        "SELECT public.current_public_name, binding.current_claim_id, binding.lifecycle FROM game_persona_public AS public JOIN game_persona_subject_binding AS binding USING (game_id, persona_id) WHERE public.game_id = $1 AND public.persona_id = $2",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("current_public_name"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
    assert_eq!(row.get::<String, _>("lifecycle"), "redacted");
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn same_subject_persona_replay_and_claim_use_one_lock_order(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;

    let replay_game = Uuid::new_v4();
    let replay_persona_id = Uuid::new_v4();
    append_game_persona(
        &pool,
        replay_game,
        replay_persona_id,
        principal,
        "Replay Persona",
        1,
    )
    .await;
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();

    // Hold only the subject row so replay reaches its private-claim lock while
    // a second game reaches the principal-first claim-issuance path. With the
    // former joined FOR UPDATE, replay queued for subject first, claim issuance
    // held principal while queuing second, and releasing this guard completed
    // the principal<->subject deadlock cycle.
    let mut subject_guard = pool.begin().await.unwrap();
    sqlx::query("SELECT subject_id FROM privacy_subject WHERE subject_id = $1 FOR UPDATE")
        .bind(subject_id)
        .fetch_one(&mut *subject_guard)
        .await
        .unwrap();

    let replay_pool = pool.clone();
    let replay = tokio::spawn(async move { rebuild_game(&replay_pool, replay_game).await });
    wait_for_lock_waiters(&pool, 1).await;

    let claim_pool = pool.clone();
    let claim_principal = principal;
    let claim_game = Uuid::new_v4();
    let claim_persona_id = Uuid::new_v4();
    let claim = tokio::spawn(async move {
        append_game_persona(
            &claim_pool,
            claim_game,
            claim_persona_id,
            claim_principal,
            "Concurrent Persona",
            2,
        )
        .await;
    });
    wait_for_lock_waiters(&pool, 2).await;
    subject_guard.commit().await.unwrap();

    let (replay, claim) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(replay, claim)
    })
    .await
    .expect("same-subject operations should complete without deadlock");
    replay.unwrap().unwrap();
    claim.unwrap();
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn profile_rebuild_and_erasure_cannot_deadlock_or_resurrect_pii(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let profile_id = create_test_profile(
        &pool,
        principal,
        "profile_race_canary",
        "Profile Race Real Name",
        "profile race private biography",
        ProfileVisibility::Private,
        1,
    )
    .await;

    // Hold the private profile root. Replay must already own principal ->
    // subject before it reaches this row; erasure therefore waits at the
    // canonical boundary instead of holding the subject while waiting for
    // replay's projection locks.
    let mut projection_guard = pool.begin().await.unwrap();
    sqlx::query("SELECT profile_id FROM member_profile WHERE profile_id = $1 FOR UPDATE")
        .bind(profile_id)
        .fetch_one(&mut *projection_guard)
        .await
        .unwrap();

    let rebuild_pool = pool.clone();
    let rebuild =
        tokio::spawn(async move { rebuild_profile_stream(&rebuild_pool, profile_id).await });
    wait_for_lock_waiters(&pool, 1).await;

    let erasure_pool = pool.clone();
    let erased_principal = principal;
    let erasure =
        tokio::spawn(
            async move { identity::erase_member(&erasure_pool, &erased_principal, 10).await },
        );
    wait_for_lock_waiters(&pool, 2).await;
    projection_guard.commit().await.unwrap();

    let (rebuild, erasure) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(rebuild, erasure)
    })
    .await
    .expect("profile rebuild and erasure should complete without deadlock");
    rebuild.unwrap().unwrap();
    let alias = erasure.unwrap().unwrap().pseudonym.unwrap();

    // A second replay proves the erased overlay is stable and cannot be
    // replaced with claim plaintext after key destruction.
    rebuild_profile_stream(&pool, profile_id).await.unwrap();
    assert_no_public_profile(&pool, profile_id).await;
    let row = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(row.active_principal_id, None);
    assert_eq!(row.handle_hmac, None);
    assert_eq!(row.redacted_alias, Some(alias));
    assert_eq!(row.current_claim_id, None);
    assert_eq!(row.lifecycle, "redacted");
    let projection = format!(
        "{:?}:{:?}:{:?}",
        row.active_principal_id, row.handle_hmac, row.redacted_alias
    );
    let principal_text = principal.to_string();
    for canary in [
        principal_text.as_str(),
        "profile_race_canary",
        "Profile Race Real Name",
        "profile race private biography",
    ] {
        assert!(!projection.contains(canary));
    }
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn game_rebuild_and_erasure_cannot_deadlock_or_resurrect_pii(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let game_id = Uuid::new_v4();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let persona_id = Uuid::new_v4();
    append_game_persona(
        &pool,
        game_id,
        persona_id,
        principal,
        "Game Race Real Name",
        1,
    )
    .await;

    let mut projection_guard = pool.begin().await.unwrap();
    sqlx::query(
        "SELECT game_id FROM game_persona_public WHERE game_id = $1 AND persona_id = $2 FOR UPDATE",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&mut *projection_guard)
    .await
    .unwrap();

    let rebuild_pool = pool.clone();
    let rebuild = tokio::spawn(async move { rebuild_game(&rebuild_pool, game_id).await });
    wait_for_lock_waiters(&pool, 1).await;

    let erasure_pool = pool.clone();
    let erased_principal = principal;
    let erasure =
        tokio::spawn(
            async move { identity::erase_member(&erasure_pool, &erased_principal, 10).await },
        );
    wait_for_lock_waiters(&pool, 2).await;
    projection_guard.commit().await.unwrap();

    let (rebuild, erasure) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(rebuild, erasure)
    })
    .await
    .expect("game rebuild and erasure should complete without deadlock");
    rebuild.unwrap().unwrap();
    let alias = erasure.unwrap().unwrap().pseudonym.unwrap();

    rebuild_game(&pool, game_id).await.unwrap();
    let row = sqlx::query(
        "SELECT public.current_public_name, binding.current_claim_id, binding.lifecycle FROM game_persona_public AS public JOIN game_persona_subject_binding AS binding USING (game_id, persona_id) WHERE public.game_id = $1 AND public.persona_id = $2",
    )
    .bind(game_id)
    .bind(persona_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("current_public_name"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
    assert_eq!(row.get::<String, _>("lifecycle"), "redacted");
    assert!(!row
        .get::<String, _>("current_public_name")
        .contains("Game Race Real Name"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn active_subject_with_missing_external_key_fails_rebuild_closed(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let profile_id = create_test_profile(
        &pool,
        principal,
        "missing_key_canary",
        "Missing Key",
        "Private profile details",
        ProfileVisibility::Public,
        1,
    )
    .await;
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    environment
        .store()
        .destroy(SubjectId::from_uuid(subject_id))
        .await
        .unwrap();

    assert!(rebuild_profile_stream(&pool, profile_id).await.is_err());
    let active = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(active.active_principal_id, Some(principal));
    assert_eq!(active.lifecycle, "active");
    assert_eq!(active.redacted_alias, None);
    assert!(active.current_claim_id.is_some());
    assert_eq!(active.handle_hmac.as_deref().map(<[u8]>::len), Some(32));
    assert!(public_profile_by_handle(&pool, "missing_key_canary")
        .await
        .unwrap()
        .is_some());
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn external_revocation_reconciles_a_pre_erasure_restore(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let account_id = format!("restored-account-{}", Uuid::new_v4().simple());
    let profile_id = create_test_profile(
        &pool,
        principal,
        "restore_canary",
        "Restored Real Name",
        "restored private bio",
        ProfileVisibility::Public,
        1,
    )
    .await;
    insert_classic_account_fixture(&pool, &account_id, principal, "secret-hash").await;
    let subject_id = SubjectId::from_uuid(
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap(),
    );
    let store = environment.store();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: random_tombstone_alias(),
        destroyed_at: 10,
        key_fingerprint_sha256: store.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    store.record_revocation(&record).await.unwrap();
    store.destroy(subject_id).await.unwrap();

    assert_eq!(reconcile_subject_revocations(&pool).await.unwrap(), 1);
    assert_eq!(
        sqlx::query_scalar::<_, Option<Uuid>>(
            "SELECT principal_id FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(principal.as_uuid())
    );
    assert_no_public_profile(&pool, profile_id).await;
    let profile = member_profile_metadata(&pool, profile_id).await;
    assert_eq!(profile.active_principal_id, None);
    assert_eq!(profile.handle_hmac, None);
    assert_eq!(
        profile.redacted_alias,
        Some(record.replacement_alias.clone())
    );
    assert_eq!(profile.current_claim_id, None);
    assert_eq!(profile.lifecycle, "redacted");
    let account = sqlx::query(
        "SELECT account_id, disabled_at, password_hash FROM auth_account WHERE principal_id = $1",
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(account.get::<String, _>("account_id"), account_id);
    assert_eq!(account.get::<Option<i64>, _>("disabled_at"), Some(10));
    assert_ne!(account.get::<String, _>("password_hash"), "secret-hash");
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
    let lifecycle = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(lifecycle.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(
        lifecycle.pseudonym.as_deref(),
        Some(record.replacement_alias.as_str())
    );
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn authentication_only_member_gets_a_subject_and_erases_account_dependencies(
    pool: sqlx::PgPool,
) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    let account_id = format!("account-canary-{}", Uuid::new_v4().simple());
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
        .await
        .unwrap();
    drop(connection);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM privacy_subject WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    insert_classic_account_fixture(&pool, &account_id, principal, "secret-hash").await;
    sqlx::query("INSERT INTO game_invitation (token_hash, principal_id, created_at, expires_at, global_capabilities, invited_by_principal_id, account_id) VALUES ($1,$2,1,100,'{}'::text[],$3,$4)")
        .bind("11".repeat(32))
        .bind(principal.as_uuid())
        .bind(principal.as_uuid())
        .bind(&account_id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent
            (delivery_id, delivery_kind, account_id, principal_id,
             credential_hash, status, attempt_count, next_attempt_at,
             created_at, updated_at, provider_id, outcome_kind,
             credential_expires_at)
        VALUES ($1, 'invite', $2, $3, $4, 'queued', 0, 2, 1, 1,
                'test-provider', 'queued', 100)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&account_id)
    .bind(principal.as_uuid())
    .bind("22".repeat(32))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_session
            (token_hash, principal_id, created_at, expires_at,
             idle_expires_at, authenticated_at, assurance, global_capabilities)
        VALUES ($1,$2,1,100,50,1,'admin_grant','{}'::text[])
        "#,
    )
    .bind("33".repeat(32))
    .bind(principal.as_uuid())
    .execute(&pool)
    .await
    .unwrap();

    let erased = identity::erase_member(&pool, &principal, 10).await.unwrap();
    assert_eq!(erased.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM member_lifecycle_event WHERE principal_id = $1 AND subject_id IS NOT NULL",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        4
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM game_invitation WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM auth_delivery_intent WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    let account = sqlx::query(
        "SELECT account_id, disabled_at, password_hash FROM auth_account WHERE principal_id = $1",
    )
    .bind(principal.as_uuid())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(account.get::<String, _>("account_id"), account_id);
    assert_eq!(account.get::<Option<i64>, _>("disabled_at"), Some(10));
    assert_ne!(account.get::<String, _>("password_hash"), "secret-hash");
    assert_eq!(
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT revoked_at FROM auth_session WHERE principal_id = $1",
        )
        .bind(principal.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(10)
    );

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_id = $1")
        .bind(principal.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        identity::rebuild_member_lifecycle(&pool, &principal)
            .await
            .unwrap()
            .pseudonym,
        erased.pseudonym
    );
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut connection = pool.acquire().await.unwrap();
    assert!(matches!(
        identity::methods::ensure_principal(&mut connection, &principal, &[], 20).await,
        Err(identity::IdentityFlowError::Unauthorized)
    ));
    drop(connection);
    let subject_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(subject_ids, vec![subject_id]);
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn already_deactivated_member_can_complete_erasure(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    ensure_principal(&pool, principal).await;
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO member_lifecycle_event (principal_id, seq, kind, payload, occurred_at, subject_id) VALUES ($1, 1, 'MemberDeactivated', '{\"reason\":\"prior_request\"}'::jsonb, 2, $2)",
    )
    .bind(principal.as_uuid())
    .bind(subject_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO member_lifecycle_projection (principal_id, status, last_seq, deactivated_at, subject_id) VALUES ($1, 'deactivated', 1, 2, $2)",
    )
    .bind(principal.as_uuid())
    .bind(subject_id)
    .execute(&pool)
    .await
    .unwrap();

    let erased = identity::erase_member(&pool, &principal, 3).await.unwrap();
    assert_eq!(erased.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(erased.last_seq, 4);
    assert!(erased.pseudonym.unwrap().starts_with("former-member-"));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn personal_export_is_subject_sealed_owner_only_and_key_destructible(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = PrincipalId::random();
    let other = PrincipalId::random();
    let account_canary = format!("pii-canary-{}@example.test", Uuid::new_v4().simple());
    ensure_principal(&pool, principal).await;
    ensure_principal(&pool, other).await;
    insert_classic_account_fixture(&pool, &account_canary, principal, "not-exported").await;

    let export = identity::create_personal_export(&pool, &principal, 2)
        .await
        .unwrap();
    assert_eq!(export.artifact["accounts"][0]["account_id"], account_canary);
    let export_id = Uuid::parse_str(&export.export_id).unwrap();
    let raw: String = sqlx::query_scalar(
        "SELECT envelope::text FROM member_personal_export WHERE export_id = $1",
    )
    .bind(export_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!raw.contains(&account_canary));
    assert!(raw.contains("fmarch-subject-claim-v1"));
    assert_eq!(
        identity::load_personal_export(&pool, &principal, export_id, 3)
            .await
            .unwrap()
            .unwrap()
            .artifact["accounts"][0]["account_id"],
        account_canary
    );
    assert!(identity::load_personal_export(&pool, &other, export_id, 3)
        .await
        .unwrap()
        .is_none());

    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    environment
        .store()
        .destroy(SubjectId::from_uuid(subject_id))
        .await
        .unwrap();
    assert!(matches!(
        identity::load_personal_export(&pool, &principal, export_id, 3).await,
        Err(identity::IdentityFlowError::Internal(message)) if message.contains("is missing")
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn shared_authority_binds_database_rejects_wrong_genesis_and_missing_active_key(
    pool: sqlx::PgPool,
) {
    let (_store, authority) = object_authority(Uuid::new_v4()).await;
    assert_eq!(
        prepare_subject_authority_for_service(&pool, &authority)
            .await
            .unwrap(),
        0
    );
    for statement in [
        "UPDATE subject_authority_binding SET authority_revision = 'attacker'",
        "DELETE FROM subject_authority_binding",
        "TRUNCATE subject_authority_binding",
    ] {
        let error = sqlx::query(statement).execute(&pool).await.unwrap_err();
        assert!(error
            .to_string()
            .contains("subject_authority_binding is append-only"));
    }

    let (_wrong_store, wrong_authority) = object_authority(Uuid::new_v4()).await;
    assert!(matches!(
        prepare_subject_authority_for_service(&pool, &wrong_authority).await,
        Err(SubjectPrivacyError::Configuration(_))
    ));

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
    assert!(matches!(
        prepare_subject_authority_for_service(&pool, &authority).await,
        Err(SubjectPrivacyError::Storage(message)) if message.contains("no valid authority key")
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn shared_authority_reapplies_revocation_to_pre_erasure_restore(pool: sqlx::PgPool) {
    let (store, authority) = object_authority(Uuid::new_v4()).await;
    prepare_subject_authority_for_service(&pool, &authority)
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
    store.create(subject_id).await.unwrap();
    let record = SubjectRevocationRecord {
        subject_id,
        replacement_alias: random_tombstone_alias(),
        destroyed_at: 9,
        key_fingerprint_sha256: store.fingerprint(subject_id).await.unwrap(),
        receipt_id: Uuid::new_v4(),
    };
    store.record_revocation(&record).await.unwrap();

    assert_eq!(
        prepare_subject_authority_for_service(&pool, &authority)
            .await
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
    assert!(matches!(
        store.load(subject_id).await,
        Err(SubjectPrivacyError::MissingKey { .. })
    ));
}

#[sqlx::test(migrations = "../database_schema/migrations")]
async fn claim_insert_waiting_on_erasure_cannot_commit_after_tombstone(pool: sqlx::PgPool) {
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

    let mut erasure = pool.begin().await.unwrap();
    sqlx::query("UPDATE privacy_subject SET lifecycle_state = 'erased' WHERE subject_id = $1")
        .bind(subject_id.as_uuid())
        .execute(&mut *erasure)
        .await
        .unwrap();
    let alias = random_tombstone_alias();
    sqlx::query(
        "INSERT INTO subject_tombstone (subject_id, replacement_alias, destroyed_at) VALUES ($1, $2, 2)",
    )
    .bind(subject_id.as_uuid())
    .bind(alias)
    .execute(&mut *erasure)
    .await
    .unwrap();

    let contender_pool = pool.clone();
    let contender = tokio::spawn(async move {
        sqlx::query(
            "INSERT INTO subject_private_claim (claim_id, subject_id, claim_kind, scope_id, envelope, created_at) VALUES ($1, $2, 'profile', $3, '{}'::jsonb, 2)",
        )
        .bind(Uuid::new_v4())
        .bind(subject_id.as_uuid())
        .bind(Uuid::new_v4())
        .execute(&contender_pool)
        .await
    });
    tokio::task::yield_now().await;
    erasure.commit().await.unwrap();
    let error = contender.await.unwrap().unwrap_err();
    assert!(error
        .to_string()
        .contains("cannot add a private claim for a destroyed subject"));
}
