use eventstore::{ActorId, EventInput};
use identity::{
    prepare_subject_authority_for_service, random_tombstone_alias, reconcile_subject_revocations,
    ConfiguredSubjectKeyAuthority, FilesystemSubjectKeyStore, ObjectSubjectKeyStore, SubjectId,
    SubjectKeyStore, SubjectPrivacyError, SubjectRevocationRecord,
};
use projections::{
    append_and_project, append_profile_and_project, profile_editor_by_principal,
    rebuild as rebuild_game, rebuild_profile_stream,
};
use sqlx::Row;
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use uuid::Uuid;

static SUBJECT_KEY_ENV_LOCK: Mutex<()> = Mutex::new(());

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

async fn ensure_principal(pool: &sqlx::PgPool, principal: &str) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, principal, &[], 1)
        .await
        .unwrap();
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn profile_erasure_cannot_resurrect_through_rebuild(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let profile_id = Uuid::new_v4();
    let principal = format!("member-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    let handle = format!("private-{}", &Uuid::new_v4().simple().to_string()[..12]);
    append_profile_and_project(
        &pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal,
                "handle": handle,
                "display_name": "Canary Real Name",
                "bio": "canary private biography",
                "visibility": "members",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();

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
        ["claim_id", "subject_id", "visibility"]
            .into_iter()
            .collect()
    );
    assert!(!canonical[0].payload.to_string().contains(&principal));
    assert!(!matches!(
        &canonical[0].actor,
        ActorId::User(user) if user == &principal
    ));

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
    for canary in [
        &principal,
        &handle,
        "Canary Real Name",
        "canary private biography",
    ] {
        assert!(!raw_event.contains(canary));
        assert!(!raw_claim.contains(canary));
    }

    let erased = identity::erase_member(&pool, &principal, 10).await.unwrap();
    let alias = erased.pseudonym.unwrap();
    assert!(alias.starts_with("Former member "));
    assert!(!alias.contains(&principal));
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

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_user_id = $1")
        .bind(&principal)
        .execute(&pool)
        .await
        .unwrap();
    let rebuilt_lifecycle = identity::rebuild_member_lifecycle(&pool, &principal)
        .await
        .unwrap();
    assert_eq!(rebuilt_lifecycle.pseudonym.as_deref(), Some(alias.as_str()));

    rebuild_profile_stream(&pool, profile_id).await.unwrap();
    let row = sqlx::query(
        "SELECT public.handle, public.display_name, public.bio, editor.principal_user_id, editor.current_claim_id FROM profile_public AS public JOIN profile_editor AS editor USING (profile_id) WHERE public.profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("display_name"), alias);
    assert_eq!(row.get::<String, _>("bio"), "");
    assert_eq!(row.get::<String, _>("principal_user_id"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
    assert_eq!(
        row.get::<String, _>("handle"),
        format!("former-member-{}", profile_id.simple())
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn pending_erasure_rebuilds_profile_and_persona_as_terminally_redacted(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = format!("pending-redaction-{}", Uuid::new_v4().simple());
    let profile_id = Uuid::new_v4();
    let game_id = Uuid::new_v4();
    ensure_principal(&pool, &principal).await;
    append_profile_and_project(
        &pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal,
                "handle": "pending-private-handle",
                "display_name": "Pending Private Name",
                "bio": "pending private biography",
                "visibility": "members",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();
    append_and_project(
        &pool,
        game_id,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": "pending-persona",
                "principal_user_id": principal,
                "public_name": "Pending Persona Name",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();

    let pending = identity::request_member_erasure(&pool, &principal, 10)
        .await
        .unwrap();
    let alias = pending.pseudonym.unwrap();
    assert_eq!(
        pending.status,
        identity::MemberLifecycleStatus::ErasureInProgress
    );
    let subject_id = SubjectId::from_uuid(
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
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
    let profile = sqlx::query(
        "SELECT public.display_name, public.bio, editor.principal_user_id, editor.current_claim_id FROM profile_public AS public JOIN profile_editor AS editor USING (profile_id) WHERE profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(profile.get::<String, _>("display_name"), alias);
    assert_eq!(profile.get::<String, _>("bio"), "");
    assert_eq!(profile.get::<String, _>("principal_user_id"), alias);
    assert_eq!(profile.get::<Option<Uuid>, _>("current_claim_id"), None);
    let persona = sqlx::query(
        "SELECT public.current_public_name, private.principal_user_id, private.current_claim_id FROM game_persona_public AS public JOIN game_persona_private AS private USING (game_id, persona_id) WHERE game_id = $1 AND persona_id = 'pending-persona'",
    )
    .bind(game_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(persona.get::<String, _>("current_public_name"), alias);
    assert_eq!(persona.get::<String, _>("principal_user_id"), alias);
    assert_eq!(persona.get::<Option<Uuid>, _>("current_claim_id"), None);

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_user_id = $1")
        .bind(&principal)
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn game_persona_erasure_rebuilds_only_random_tombstone_alias(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let game_id = Uuid::new_v4();
    let principal = format!("persona-owner-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    append_and_project(
        &pool,
        game_id,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": "gp-canary",
                "principal_user_id": principal,
                "public_name": "Canary Persona Name",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();

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
    assert!(!canonical[0].payload.to_string().contains(&principal));
    assert!(!canonical[0]
        .payload
        .to_string()
        .contains("Canary Persona Name"));
    assert!(!matches!(
        &canonical[0].actor,
        ActorId::User(actor) if actor == &principal
    ));

    let alias = identity::erase_member(&pool, &principal, 10)
        .await
        .unwrap()
        .pseudonym
        .unwrap();
    rebuild_game(&pool, game_id).await.unwrap();
    let row = sqlx::query(
        "SELECT public.current_public_name, private.principal_user_id, private.current_claim_id FROM game_persona_public AS public JOIN game_persona_private AS private USING (game_id, persona_id) WHERE public.game_id = $1 AND public.persona_id = 'gp-canary'",
    )
    .bind(game_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("current_public_name"), alias);
    assert_eq!(row.get::<String, _>("principal_user_id"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn same_subject_persona_replay_and_claim_use_one_lock_order(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = format!("persona-lock-order-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;

    let replay_game = Uuid::new_v4();
    append_and_project(
        &pool,
        replay_game,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": "gp-replay",
                "principal_user_id": principal,
                "public_name": "Replay Persona",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
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
    let claim_principal = principal.clone();
    let claim_game = Uuid::new_v4();
    let claim = tokio::spawn(async move {
        append_and_project(
            &claim_pool,
            claim_game,
            &[EventInput::new(
                "GamePersonaRegistered",
                1,
                serde_json::json!({
                    "persona_id": "gp-new-claim",
                    "principal_user_id": claim_principal,
                    "public_name": "Concurrent Persona",
                }),
                ActorId::User(claim_principal.clone()),
                2,
            )],
        )
        .await
    });
    wait_for_lock_waiters(&pool, 2).await;
    subject_guard.commit().await.unwrap();

    let (replay, claim) = tokio::time::timeout(Duration::from_secs(5), async {
        tokio::join!(replay, claim)
    })
    .await
    .expect("same-subject operations should complete without deadlock");
    replay.unwrap().unwrap();
    claim.unwrap().unwrap();
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn profile_rebuild_and_erasure_cannot_deadlock_or_resurrect_pii(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let profile_id = Uuid::new_v4();
    let principal = format!("profile-rebuild-erasure-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    append_profile_and_project(
        &pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal,
                "handle": "profile-race-canary",
                "display_name": "Profile Race Real Name",
                "bio": "profile race private biography",
                "visibility": "members",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();

    // Hold a projection row after rebuild's preceding profile_editor delete.
    // Replay must already own principal -> subject before it reaches this row;
    // erasure therefore waits at the canonical boundary instead of holding the
    // subject while waiting for replay's projection locks.
    let mut projection_guard = pool.begin().await.unwrap();
    sqlx::query("SELECT profile_id FROM profile_public WHERE profile_id = $1 FOR UPDATE")
        .bind(profile_id)
        .fetch_one(&mut *projection_guard)
        .await
        .unwrap();

    let rebuild_pool = pool.clone();
    let rebuild =
        tokio::spawn(async move { rebuild_profile_stream(&rebuild_pool, profile_id).await });
    wait_for_lock_waiters(&pool, 1).await;

    let erasure_pool = pool.clone();
    let erased_principal = principal.clone();
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
    let row = sqlx::query(
        "SELECT public.handle, public.display_name, public.bio, editor.principal_user_id, editor.current_claim_id FROM profile_public AS public JOIN profile_editor AS editor USING (profile_id) WHERE public.profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("display_name"), alias);
    assert_eq!(row.get::<String, _>("bio"), "");
    assert_eq!(row.get::<String, _>("principal_user_id"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
    let projection = format!(
        "{}:{}:{}",
        row.get::<String, _>("handle"),
        row.get::<String, _>("display_name"),
        row.get::<String, _>("bio")
    );
    for canary in [
        principal.as_str(),
        "profile-race-canary",
        "Profile Race Real Name",
        "profile race private biography",
    ] {
        assert!(!projection.contains(canary));
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn game_rebuild_and_erasure_cannot_deadlock_or_resurrect_pii(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let game_id = Uuid::new_v4();
    let principal = format!("game-rebuild-erasure-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    append_and_project(
        &pool,
        game_id,
        &[EventInput::new(
            "GamePersonaRegistered",
            1,
            serde_json::json!({
                "persona_id": "gp-rebuild-erasure",
                "principal_user_id": principal,
                "public_name": "Game Race Real Name",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();

    let mut projection_guard = pool.begin().await.unwrap();
    sqlx::query(
        "SELECT game_id FROM game_persona_public WHERE game_id = $1 AND persona_id = 'gp-rebuild-erasure' FOR UPDATE",
    )
    .bind(game_id)
    .fetch_one(&mut *projection_guard)
    .await
    .unwrap();

    let rebuild_pool = pool.clone();
    let rebuild = tokio::spawn(async move { rebuild_game(&rebuild_pool, game_id).await });
    wait_for_lock_waiters(&pool, 1).await;

    let erasure_pool = pool.clone();
    let erased_principal = principal.clone();
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
        "SELECT public.current_public_name, private.principal_user_id, private.current_claim_id FROM game_persona_public AS public JOIN game_persona_private AS private USING (game_id, persona_id) WHERE public.game_id = $1 AND public.persona_id = 'gp-rebuild-erasure'",
    )
    .bind(game_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<String, _>("current_public_name"), alias);
    assert_eq!(row.get::<String, _>("principal_user_id"), alias);
    assert_eq!(row.get::<Option<Uuid>, _>("current_claim_id"), None);
    assert!(!row
        .get::<String, _>("current_public_name")
        .contains("Game Race Real Name"));
    assert!(!row
        .get::<String, _>("principal_user_id")
        .contains(&principal));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn active_subject_with_missing_external_key_fails_rebuild_closed(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let profile_id = Uuid::new_v4();
    let principal = format!("missing-key-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    append_profile_and_project(
        &pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal,
                "handle": "missing-key-canary",
                "display_name": "Missing Key",
                "bio": "private",
                "visibility": "public",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
            .fetch_one(&pool)
            .await
            .unwrap();
    environment
        .store()
        .destroy(SubjectId::from_uuid(subject_id))
        .await
        .unwrap();

    assert!(rebuild_profile_stream(&pool, profile_id).await.is_err());
    assert!(profile_editor_by_principal(&pool, &principal)
        .await
        .unwrap()
        .is_some());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn external_revocation_reconciles_a_pre_erasure_restore(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let profile_id = Uuid::new_v4();
    let principal = format!("restored-owner-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    let account_id = format!("restored-account-{}", Uuid::new_v4().simple());
    append_profile_and_project(
        &pool,
        profile_id,
        &[EventInput::new(
            "ProfileCreated",
            1,
            serde_json::json!({
                "principal_user_id": principal,
                "handle": "restore-canary",
                "display_name": "Restored Real Name",
                "bio": "restored private bio",
                "visibility": "public",
            }),
            ActorId::User(principal.clone()),
            1,
        )],
    )
    .await
    .unwrap();
    sqlx::query("INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, global_capabilities) VALUES ($1,$2,'secret-hash',1,'{}'::text[])")
        .bind(&account_id).bind(&principal).execute(&pool).await.unwrap();
    let subject_id = SubjectId::from_uuid(
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
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
        sqlx::query_scalar::<_, Option<String>>(
            "SELECT principal_user_id FROM privacy_subject WHERE subject_id = $1",
        )
        .bind(subject_id.as_uuid())
        .fetch_one(&pool)
        .await
        .unwrap()
        .as_deref(),
        Some(principal.as_str())
    );
    let profile = sqlx::query(
        "SELECT public.display_name, public.bio, editor.principal_user_id, editor.current_claim_id FROM profile_public AS public JOIN profile_editor AS editor USING (profile_id) WHERE public.profile_id = $1",
    )
    .bind(profile_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        profile.get::<String, _>("display_name"),
        record.replacement_alias
    );
    assert_eq!(profile.get::<String, _>("bio"), "");
    assert_eq!(profile.get::<Option<Uuid>, _>("current_claim_id"), None);
    let account = sqlx::query(
        "SELECT account_id, disabled_at, password_hash FROM auth_account WHERE principal_user_id = $1",
    )
    .bind(&principal)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(account.get::<String, _>("account_id"), account_id);
    assert_eq!(account.get::<Option<i64>, _>("disabled_at"), Some(10));
    assert_ne!(account.get::<String, _>("password_hash"), "secret-hash");
    assert_eq!(
        sqlx::query_scalar::<_, String>(
            "SELECT status FROM platform_principal WHERE principal_user_id = $1",
        )
        .bind(&principal)
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn authentication_only_member_gets_a_subject_and_erases_account_dependencies(
    pool: sqlx::PgPool,
) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = format!("auth-only-{}", Uuid::new_v4().simple());
    let account_id = format!("account-canary-{}", Uuid::new_v4().simple());
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal, &[], 1)
        .await
        .unwrap();
    drop(connection);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM privacy_subject WHERE principal_user_id = $1",
        )
        .bind(&principal)
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    sqlx::query("INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, global_capabilities) VALUES ($1,$2,'secret-hash',1,'{}'::text[])")
        .bind(&account_id).bind(&principal).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO auth_invite (token_hash, principal_user_id, created_at, expires_at, global_capabilities, invited_by_user_id, account_id) VALUES ($1,$2,1,100,'{}'::text[],'inviter',$3)")
        .bind("11".repeat(32)).bind(&principal).bind(&account_id).execute(&pool).await.unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent
            (delivery_id, delivery_kind, account_id, principal_user_id,
             credential_hash, status, attempt_count, next_attempt_at,
             created_at, updated_at, provider_id, outcome_kind,
             credential_expires_at)
        VALUES ($1, 'invite', $2, $3, $4, 'queued', 0, 2, 1, 1,
                'test-provider', 'queued', 100)
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&account_id)
    .bind(&principal)
    .bind("22".repeat(32))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        r#"
        INSERT INTO auth_session
            (token_hash, principal_user_id, created_at, expires_at,
             idle_expires_at, authenticated_at, assurance, global_capabilities)
        VALUES ($1,$2,1,100,50,1,'admin_grant','{}'::text[])
        "#,
    )
    .bind("33".repeat(32))
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();

    let erased = identity::erase_member(&pool, &principal, 10).await.unwrap();
    assert_eq!(erased.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM member_lifecycle_event WHERE principal_user_id = $1 AND subject_id IS NOT NULL",
        )
        .bind(&principal)
        .fetch_one(&pool)
        .await
        .unwrap(),
        4
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM auth_invite WHERE principal_user_id = $1",
        )
        .bind(&principal)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM auth_delivery_intent WHERE principal_user_id = $1",
        )
        .bind(&principal)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0
    );
    let account = sqlx::query(
        "SELECT account_id, disabled_at, password_hash FROM auth_account WHERE principal_user_id = $1",
    )
    .bind(&principal)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(account.get::<String, _>("account_id"), account_id);
    assert_eq!(account.get::<Option<i64>, _>("disabled_at"), Some(10));
    assert_ne!(account.get::<String, _>("password_hash"), "secret-hash");
    assert_eq!(
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT revoked_at FROM auth_session WHERE principal_user_id = $1",
        )
        .bind(&principal)
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(10)
    );

    sqlx::query("DELETE FROM member_lifecycle_projection WHERE principal_user_id = $1")
        .bind(&principal)
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
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
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
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(subject_ids, vec![subject_id]);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn already_deactivated_member_can_complete_erasure(pool: sqlx::PgPool) {
    let _environment = SubjectKeyEnvironment::isolated();
    let principal = format!("deactivated-{}", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO member_lifecycle_event (principal_user_id, seq, kind, payload, occurred_at, subject_id) VALUES ($1, 1, 'MemberDeactivated', '{\"reason\":\"prior_request\"}'::jsonb, 2, $2)",
    )
    .bind(&principal)
    .bind(subject_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO member_lifecycle_projection (principal_user_id, status, last_seq, deactivated_at, subject_id) VALUES ($1, 'deactivated', 1, 2, $2)",
    )
    .bind(&principal)
    .bind(subject_id)
    .execute(&pool)
    .await
    .unwrap();

    let erased = identity::erase_member(&pool, &principal, 3).await.unwrap();
    assert_eq!(erased.status, identity::MemberLifecycleStatus::Erased);
    assert_eq!(erased.last_seq, 4);
    assert!(erased.pseudonym.unwrap().starts_with("Former member "));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn personal_export_is_subject_sealed_owner_only_and_key_destructible(pool: sqlx::PgPool) {
    let environment = SubjectKeyEnvironment::isolated();
    let principal = format!("export-owner-{}", Uuid::new_v4().simple());
    let other = format!("export-other-{}", Uuid::new_v4().simple());
    let account_canary = format!("pii-canary-{}@example.test", Uuid::new_v4().simple());
    ensure_principal(&pool, &principal).await;
    ensure_principal(&pool, &other).await;
    sqlx::query(
        "INSERT INTO auth_account (account_id, principal_user_id, password_hash, created_at, global_capabilities) VALUES ($1, $2, 'not-exported', 1, '{}'::text[])",
    )
    .bind(&account_canary)
    .bind(&principal)
    .execute(&pool)
    .await
    .unwrap();

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
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1")
            .bind(&principal)
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

#[sqlx::test(migrations = "../projections/migrations")]
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

    let principal = format!("missing-key-{}", Uuid::new_v4().simple());
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
    assert!(matches!(
        prepare_subject_authority_for_service(&pool, &authority).await,
        Err(SubjectPrivacyError::Storage(message)) if message.contains("no valid authority key")
    ));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn shared_authority_reapplies_revocation_to_pre_erasure_restore(pool: sqlx::PgPool) {
    let (store, authority) = object_authority(Uuid::new_v4()).await;
    prepare_subject_authority_for_service(&pool, &authority)
        .await
        .unwrap();
    let principal = format!("restore-member-{}", Uuid::new_v4().simple());
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
            "SELECT status FROM platform_principal WHERE principal_user_id = $1",
        )
        .bind(&principal)
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

#[sqlx::test(migrations = "../projections/migrations")]
async fn claim_insert_waiting_on_erasure_cannot_commit_after_tombstone(pool: sqlx::PgPool) {
    let principal = format!("claim-race-{}", Uuid::new_v4().simple());
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
