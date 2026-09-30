//! Profile command application boundary.
//!
//! This crate turns already-validated profile commands into sealed private
//! claims and canonical subject-attributed events.  It intentionally sits
//! between HTTP and projections: projections fold canonical facts; identity
//! owns subject keys; and `social` owns the pure profile state machine.

use event_actor::ActorId;
use eventstore::{EventInput, StoreError};
use identity::{
    ensure_active_subject, insert_subject_claim, open_active_subject_claim, ClaimId, SubjectId,
};
use profile_handle_index::{
    acquire_profile_handle_index_writer_lease,
    require_profile_handle_index_configuration as require_index_configuration, HandleIndexToken,
    ProfileHandleIndexConfiguration, ProfileHandleIndexError,
};
use social::{
    decide_profile, fold_profile_event, PrincipalId, PrivacySubjectId, ProfileCommand,
    ProfileDecisionError, ProfileEdit, ProfileFoldError, ProfileId, ProfileOwner,
    ProfilePresentation, ProfileRevision, ProfileState,
};
use sqlx::{Acquire, Row};

/// Fail fast before the server accepts traffic. Unlike hermetic direct-library
/// tests, a process that will serve requests must provide both the opaque key
/// and a valid public custody marker explicitly.
pub fn require_profile_handle_index_configuration() -> Result<(), ProfileApplicationError> {
    let _ = require_index_configuration()?;
    Ok(())
}

/// The owner-only profile view. Its presentation comes directly from the
/// sealed claim, never from a profile projection table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerProfile {
    pub profile_id: ProfileId,
    pub presentation: ProfilePresentation,
    pub revision: ProfileRevision,
}

/// Source-owned public attribution admission. A forged public-profile query
/// row cannot make a private or erased profile eligible to author a post.
pub async fn public_posting_profile_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_id: PrincipalId,
) -> Result<Option<ProfileId>, ProfileApplicationError> {
    // Discovery never waits on a profile row held by an owner edit. Enter the
    // subject's shared authority boundary before reading its current pointer.
    let subject_id = sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT subject_id FROM member_profile WHERE active_principal_id = $1 AND lifecycle = 'active'",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    let Some(subject_id) = subject_id else {
        return Ok(None);
    };
    let subject_id = SubjectId::from_uuid(subject_id);
    identity::lock_active_subject_for_read(tx, principal_id, subject_id).await?;
    let row = sqlx::query(
        "SELECT profile_id, subject_id, current_claim_id FROM member_profile WHERE active_principal_id = $1 AND lifecycle = 'active'",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let profile_id: uuid::Uuid = row.try_get("profile_id")?;
    if row.try_get::<uuid::Uuid, _>("subject_id")? != subject_id.as_uuid() {
        return Err(ProfileApplicationError::InvalidState(
            "profile subject changed during admission".into(),
        ));
    }
    let claim = row
        .try_get::<Option<uuid::Uuid>, _>("current_claim_id")?
        .ok_or_else(|| {
            ProfileApplicationError::InvalidState("active profile has no claim".into())
        })?;
    let presentation: ProfilePresentation = identity::open_active_subject_claim_for_read(
        tx,
        principal_id,
        subject_id,
        ClaimId::from_uuid(claim),
        "profile",
        profile_id,
        None,
    )
    .await?;
    Ok(
        matches!(presentation.visibility, social::ProfileVisibility::Public)
            .then_some(ProfileId::from_uuid(profile_id)),
    )
}

/// A current public mention target admitted from its sealed presentation.
/// Neither private presentation nor a query-projection handle is returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicMentionProfile {
    pub profile_id: ProfileId,
    pub handle: social::ProfileHandle,
}

/// Keep RFC 0007's public-only discovery corpus, then verify the discovered
/// candidate against the current sealed source. A corrupt public row cannot
/// disclose a private handle or retarget a mention. Target authority locks are
/// nonblocking because a forum command already holds its author's authority.
pub async fn public_mention_profile_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    handle: &str,
) -> Result<Option<PublicMentionProfile>, ProfileApplicationError> {
    let candidate = sqlx::query(
        r#"
        SELECT profile.profile_id, profile.active_principal_id, profile.subject_id
        FROM public_profile AS public
        JOIN member_profile AS profile USING (profile_id)
        WHERE public.handle = $1 AND profile.lifecycle = 'active'
          AND profile.active_principal_id IS NOT NULL
        "#,
    )
    .bind(handle)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(candidate) = candidate else {
        return Ok(None);
    };
    let profile_id: uuid::Uuid = candidate.try_get("profile_id")?;
    let principal_id = PrincipalId::from_uuid(candidate.try_get("active_principal_id")?);
    let subject_id = SubjectId::from_uuid(candidate.try_get("subject_id")?);
    match identity::try_lock_active_subject_for_read(tx, principal_id, subject_id).await {
        Ok(()) => {}
        Err(
            identity::PrivateClaimError::PrincipalUnavailable
            | identity::PrivateClaimError::SubjectUnavailable
            | identity::PrivateClaimError::Identity(identity::IdentityFlowError::Unauthorized),
        ) => {
            return Ok(None);
        }
        Err(error) => return Err(error.into()),
    }
    // As with posting admission, do not lock the dependent profile row while
    // an owner edit may hold it and wait for the target's shared authority.
    let claim = sqlx::query_scalar::<_, Option<uuid::Uuid>>(
        r#"
        SELECT profile.current_claim_id
        FROM member_profile AS profile
        JOIN public_profile AS public USING (profile_id)
        WHERE profile.profile_id = $1 AND profile.active_principal_id = $2
          AND profile.subject_id = $3 AND profile.lifecycle = 'active'
          AND public.handle = $4
        "#,
    )
    .bind(profile_id)
    .bind(principal_id.as_uuid())
    .bind(subject_id.as_uuid())
    .bind(handle)
    .fetch_optional(&mut **tx)
    .await?;
    let Some(claim) = claim else {
        return Ok(None);
    };
    let claim = claim.ok_or_else(|| {
        ProfileApplicationError::InvalidState("active profile has no claim".into())
    })?;
    let presentation: ProfilePresentation = identity::try_open_active_subject_claim_for_read(
        tx,
        principal_id,
        subject_id,
        ClaimId::from_uuid(claim),
        "profile",
        profile_id,
        None,
    )
    .await?;
    Ok(
        (presentation.visibility == social::ProfileVisibility::Public
            && presentation.handle.as_str() == handle)
            .then_some(PublicMentionProfile {
                profile_id: ProfileId::from_uuid(profile_id),
                handle: presentation.handle,
            }),
    )
}

#[derive(Debug, thiserror::Error)]
pub enum ProfileApplicationError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    PrivateClaim(#[from] identity::PrivateClaimError),
    #[error(transparent)]
    Projection(#[from] projections::ProjectionError),
    #[error(transparent)]
    Decision(#[from] ProfileDecisionError),
    #[error(transparent)]
    Fold(#[from] ProfileFoldError),
    #[error("profile handle-index configuration is invalid: {0}")]
    HandleIndexConfiguration(String),
    #[error("this principal already has an active profile")]
    ProfileAlreadyExists,
    #[error("profile handle is already in use")]
    HandleAlreadyExists,
    #[error("profile was not found")]
    ProfileNotFound,
    #[error("profile state is invalid: {0}")]
    InvalidState(String),
}

impl From<ProfileHandleIndexError> for ProfileApplicationError {
    fn from(error: ProfileHandleIndexError) -> Self {
        match error {
            ProfileHandleIndexError::Configuration(message) => {
                Self::HandleIndexConfiguration(message)
            }
            ProfileHandleIndexError::MalformedStoredToken(message) => Self::InvalidState(message),
            ProfileHandleIndexError::Database(error) => Self::Database(error),
        }
    }
}

impl ProfileApplicationError {
    /// Whether a caller may safely present this as a stale-write conflict.
    pub fn is_revision_conflict(&self) -> bool {
        matches!(
            self,
            Self::Decision(ProfileDecisionError::RevisionConflict { .. })
                | Self::Projection(projections::ProjectionError::Store(
                    StoreError::Conflict { .. }
                ))
        )
    }
}

/// A non-secret readiness result. The count intentionally excludes handles,
/// HMAC values, subjects, and principals so it is safe for startup telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProfileHandleIndexAudit {
    pub active_profile_count: u64,
}

/// Prove that every active reservation is derived from its sealed claim under
/// the explicitly configured key. Server startup runs this after subject-key
/// authority preparation and before opening a listener, so a missing, malformed
/// or mismatched index configuration never reaches readiness.
pub async fn verify_profile_handle_index_consistency(
    pool: &sqlx::postgres::PgPool,
) -> Result<ProfileHandleIndexAudit, ProfileApplicationError> {
    let configuration = require_index_configuration()?;
    verify_profile_handle_index_consistency_with_configuration(pool, &configuration).await
}

/// Same proof under an already-validated explicit configuration. The protected
/// maintenance command uses this internally while its replacement key is still
/// absent from normal service configuration.
pub async fn verify_profile_handle_index_consistency_with_configuration(
    pool: &sqlx::postgres::PgPool,
    configuration: &ProfileHandleIndexConfiguration,
) -> Result<ProfileHandleIndexAudit, ProfileApplicationError> {
    let rows = sqlx::query(
        r#"
        SELECT profile_id, subject_id, current_claim_id, handle_hmac
        FROM member_profile
        WHERE lifecycle = 'active'
        ORDER BY profile_id
        "#,
    )
    .fetch_all(pool)
    .await?;

    for row in &rows {
        let profile_id = ProfileId::from_uuid(row.try_get("profile_id")?);
        let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
        let claim_id = ClaimId::from_uuid(
            row.try_get::<Option<uuid::Uuid>, _>("current_claim_id")?
                .ok_or_else(|| {
                    ProfileApplicationError::InvalidState(
                        "active profile has no current private claim".to_string(),
                    )
                })?,
        );
        let stored = HandleIndexToken::from_database(
            row.try_get::<Option<Vec<u8>>, _>("handle_hmac")?
                .ok_or_else(|| {
                    ProfileApplicationError::InvalidState(
                        "active profile has no handle index token".to_string(),
                    )
                })?,
        )?;
        let mut tx = pool.begin().await?;
        let presentation: ProfilePresentation = open_active_subject_claim(
            &mut tx,
            subject_id,
            claim_id,
            "profile",
            profile_id.as_uuid(),
            None,
        )
        .await?;
        let expected = HandleIndexToken::for_handle_with_configuration(
            presentation.handle.as_str(),
            configuration,
        )?;
        tx.commit().await?;
        if stored != expected {
            return Err(ProfileApplicationError::InvalidState(
                "profile handle index token does not match its sealed claim under the configured key"
                    .to_string(),
            ));
        }
    }

    Ok(ProfileHandleIndexAudit {
        active_profile_count: u64::try_from(rows.len()).map_err(|_| {
            ProfileApplicationError::InvalidState(
                "active profile count exceeds supported range".to_string(),
            )
        })?,
    })
}

/// The public, non-secret result of an atomic blind-index rekey.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileHandleIndexReindexReport {
    pub current_kid: String,
    pub replacement_kid: String,
    pub active_profile_count: u64,
}

/// Recompute every active profile reservation under `replacement` in one
/// database transaction. The caller must have explicitly loaded both key
/// configurations from the protected maintenance environment; this function
/// never accepts key material from a command-line argument or logs it.
///
/// A session-level exclusive lease drains compatible writers first. It is
/// released on every normal success or error return. Operators must still stop
/// old, pre-lease API replicas before acknowledging the maintenance window;
/// the server-side startup audit fences a wrong-key restart afterward.
pub async fn reindex_profile_handle_index(
    connection: &mut sqlx::PgConnection,
    current: &ProfileHandleIndexConfiguration,
    replacement: &ProfileHandleIndexConfiguration,
) -> Result<ProfileHandleIndexReindexReport, ProfileApplicationError> {
    if !current.differs_from(replacement) {
        return Err(ProfileApplicationError::HandleIndexConfiguration(
            "replacement profile handle-index key and KID must both differ from the active configuration"
                .to_string(),
        ));
    }
    profile_handle_index::acquire_profile_handle_index_maintenance_lease(connection).await?;
    let result = reindex_profile_handle_index_while_leased(connection, current, replacement).await;
    let release =
        profile_handle_index::release_profile_handle_index_maintenance_lease(connection).await;
    match (result, release) {
        (Ok(report), Ok(())) => Ok(report),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) | (Err(_), Err(error)) => Err(error.into()),
    }
}

async fn reindex_profile_handle_index_while_leased(
    connection: &mut sqlx::PgConnection,
    current: &ProfileHandleIndexConfiguration,
    replacement: &ProfileHandleIndexConfiguration,
) -> Result<ProfileHandleIndexReindexReport, ProfileApplicationError> {
    let mut tx = connection.begin().await?;
    let rows = sqlx::query(
        r#"
        SELECT profile_id, subject_id, current_claim_id, handle_hmac
        FROM member_profile
        WHERE lifecycle = 'active'
        ORDER BY profile_id
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut updates = Vec::with_capacity(rows.len());
    for row in &rows {
        let profile_id = ProfileId::from_uuid(row.try_get("profile_id")?);
        let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
        let claim_id = ClaimId::from_uuid(
            row.try_get::<Option<uuid::Uuid>, _>("current_claim_id")?
                .ok_or_else(|| {
                    ProfileApplicationError::InvalidState(
                        "active profile has no current private claim".to_string(),
                    )
                })?,
        );
        let stored = HandleIndexToken::from_database(
            row.try_get::<Option<Vec<u8>>, _>("handle_hmac")?
                .ok_or_else(|| {
                    ProfileApplicationError::InvalidState(
                        "active profile has no handle index token".to_string(),
                    )
                })?,
        )?;
        let presentation: ProfilePresentation = open_active_subject_claim(
            &mut tx,
            subject_id,
            claim_id,
            "profile",
            profile_id.as_uuid(),
            None,
        )
        .await?;
        let expected_current =
            HandleIndexToken::for_handle_with_configuration(presentation.handle.as_str(), current)?;
        if stored != expected_current {
            return Err(ProfileApplicationError::InvalidState(
                "profile handle index token does not match its sealed claim under the expected current key"
                    .to_string(),
            ));
        }
        let replacement_token = HandleIndexToken::for_handle_with_configuration(
            presentation.handle.as_str(),
            replacement,
        )?;
        updates.push((profile_id, claim_id, stored, replacement_token));
    }

    // Subject rows were locked while claims were authenticated above. Lock the
    // projection roots only afterward to preserve the identity lock order and
    // avoid a cycle with erasure finalization.
    let locked_rows = sqlx::query(
        r#"
        SELECT profile_id, current_claim_id, handle_hmac
        FROM member_profile
        WHERE lifecycle = 'active'
        ORDER BY profile_id
        FOR UPDATE
        "#,
    )
    .fetch_all(&mut *tx)
    .await?;
    if locked_rows.len() != updates.len() {
        return Err(ProfileApplicationError::InvalidState(
            "active profiles changed while the maintenance lease was held".to_string(),
        ));
    }
    for (row, (profile_id, claim_id, stored, _)) in locked_rows.iter().zip(&updates) {
        let locked_profile_id = ProfileId::from_uuid(row.try_get("profile_id")?);
        let locked_claim_id = row.try_get::<Option<uuid::Uuid>, _>("current_claim_id")?;
        let locked_token = row.try_get::<Option<Vec<u8>>, _>("handle_hmac")?;
        if locked_profile_id != *profile_id
            || locked_claim_id != Some(claim_id.as_uuid())
            || locked_token.as_deref() != Some(stored.as_bytes().as_slice())
        {
            return Err(ProfileApplicationError::InvalidState(
                "active profile changed while the maintenance lease was held".to_string(),
            ));
        }
    }
    for (profile_id, claim_id, stored, replacement_token) in &updates {
        let updated = sqlx::query(
            r#"
            UPDATE member_profile
            SET handle_hmac = $1
            WHERE profile_id = $2
              AND lifecycle = 'active'
              AND current_claim_id = $3
              AND handle_hmac = $4
            "#,
        )
        .bind(replacement_token.as_bytes().as_slice())
        .bind(profile_id.as_uuid())
        .bind(claim_id.as_uuid())
        .bind(stored.as_bytes().as_slice())
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() != 1 {
            return Err(ProfileApplicationError::InvalidState(
                "profile handle-index reindex lost a fenced active profile".to_string(),
            ));
        }
    }
    tx.commit().await?;
    Ok(ProfileHandleIndexReindexReport {
        current_kid: current.kid().to_string(),
        replacement_kid: replacement.kid().to_string(),
        active_profile_count: u64::try_from(updates.len()).map_err(|_| {
            ProfileApplicationError::InvalidState(
                "active profile count exceeds supported range".to_string(),
            )
        })?,
    })
}

/// Establish one new active profile.  Values are typed before this boundary;
/// raw request parsing belongs to the caller.
pub async fn create_profile(
    pool: &sqlx::postgres::PgPool,
    owner: PrincipalId,
    presentation: ProfilePresentation,
    occurred_at: i64,
) -> Result<ProfileId, ProfileApplicationError> {
    let mut tx = pool.begin().await?;
    acquire_profile_handle_index_writer_lease(&mut tx).await?;
    let handle_index_token = HandleIndexToken::for_handle(presentation.handle.as_str())?;
    lock_profile_creation(&mut tx, &owner, &handle_index_token).await?;
    if sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT profile_id FROM member_profile WHERE active_principal_id = $1",
    )
    .bind(owner.as_uuid())
    .fetch_optional(&mut *tx)
    .await?
    .is_some()
    {
        return Err(ProfileApplicationError::ProfileAlreadyExists);
    }
    if sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT profile_id FROM member_profile WHERE handle_hmac = $1 AND lifecycle = 'active'",
    )
    .bind(handle_index_token.as_bytes().as_slice())
    .fetch_optional(&mut *tx)
    .await?
    .is_some()
    {
        return Err(ProfileApplicationError::HandleAlreadyExists);
    }

    let subject_id = ensure_active_subject(&mut tx, owner, occurred_at).await?;
    let profile_id = ProfileId::from_uuid(uuid::Uuid::new_v4());
    let initial = decide_profile(
        None,
        ProfileCommand::Create {
            owner: ProfileOwner::new(owner, PrivacySubjectId::from_uuid(subject_id.as_uuid())),
            presentation,
        },
    )?;
    append_decision(
        &mut tx,
        profile_id,
        None,
        ProfileRevision::INITIAL,
        initial,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    Ok(profile_id)
}

/// Apply one owner-authenticated edit against the revision that the client
/// actually read.  The domain decision checks owner, revision, and no-op
/// semantics before any event or projection mutation is attempted.
pub async fn update_profile(
    pool: &sqlx::postgres::PgPool,
    profile_id: ProfileId,
    editor: PrincipalId,
    expected_revision: ProfileRevision,
    edit: ProfileEdit,
    occurred_at: i64,
) -> Result<ProfileId, ProfileApplicationError> {
    let mut tx = pool.begin().await?;
    acquire_profile_handle_index_writer_lease(&mut tx).await?;
    let loaded = load_profile_state(&mut tx, profile_id).await?;
    let current = loaded.state;
    let decision = decide_profile(
        Some(&current),
        ProfileCommand::Update {
            editor,
            expected_revision,
            edit,
        },
    )?;
    append_decision(
        &mut tx,
        profile_id,
        Some(current),
        expected_revision,
        decision,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    Ok(profile_id)
}

/// Load the authenticated principal's active editor view. This is the sole
/// application read path for owner-visible profile fields: it reads metadata
/// from `member_profile` and opens the sealed claim under its subject key.
pub async fn owner_profile(
    pool: &sqlx::postgres::PgPool,
    owner: &PrincipalId,
) -> Result<Option<OwnerProfile>, ProfileApplicationError> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query(
        r#"
        SELECT profile_id, subject_id, current_claim_id, revision
        FROM member_profile
        WHERE active_principal_id = $1 AND lifecycle = 'active'
        FOR SHARE
        "#,
    )
    .bind(owner.as_uuid())
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };

    let profile_id = ProfileId::from_uuid(row.try_get("profile_id")?);
    let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
    let claim_id = ClaimId::from_uuid(
        row.try_get::<Option<uuid::Uuid>, _>("current_claim_id")?
            .ok_or_else(|| {
                ProfileApplicationError::InvalidState(
                    "active profile has no current private claim".to_string(),
                )
            })?,
    );
    let revision = profile_revision_from_database(row.try_get("revision")?)?;
    let presentation = open_active_subject_claim(
        &mut tx,
        subject_id,
        claim_id,
        "profile",
        profile_id.as_uuid(),
        None,
    )
    .await?;
    tx.commit().await?;
    Ok(Some(OwnerProfile {
        profile_id,
        presentation,
        revision,
    }))
}

async fn lock_profile_creation(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    owner: &PrincipalId,
    handle_index_token: &HandleIndexToken,
) -> Result<(), sqlx::Error> {
    // The unique constraints are the final authority.  These two scoped locks
    // make the common simultaneous-create race deterministic before a new
    // privacy subject key is provisioned.
    for key in [
        format!("profile-owner:{}", owner.as_uuid()),
        format!("profile-handle:{}", handle_index_token.as_lower_hex()),
    ] {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
            .bind(key)
            .execute(&mut **tx)
            .await?;
    }
    Ok(())
}

struct LoadedProfile {
    state: ProfileState,
}

async fn load_profile_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile_id: ProfileId,
) -> Result<LoadedProfile, ProfileApplicationError> {
    // Owner edits never change profile_id. Exclude other profile writers
    // while allowing deferred forum author foreign keys to take KEY SHARE
    // at commit; those readers may hold the principal gate this edit needs.
    let row = sqlx::query(
        r#"
        SELECT active_principal_id, subject_id, current_claim_id, lifecycle, revision, handle_hmac
        FROM member_profile
        WHERE profile_id = $1
        FOR NO KEY UPDATE
        "#,
    )
    .bind(profile_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(ProfileApplicationError::ProfileNotFound)?;
    let lifecycle: String = row.try_get("lifecycle")?;
    if lifecycle != "active" {
        return Err(ProfileApplicationError::InvalidState(
            "redacted profiles are not editable".to_string(),
        ));
    }
    let principal_id: uuid::Uuid = row
        .try_get::<Option<uuid::Uuid>, _>("active_principal_id")?
        .ok_or_else(|| {
            ProfileApplicationError::InvalidState("active profile has no principal".to_string())
        })?;
    let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
    let claim_id = ClaimId::from_uuid(
        row.try_get::<Option<uuid::Uuid>, _>("current_claim_id")?
            .ok_or_else(|| {
                ProfileApplicationError::InvalidState("active profile has no claim".to_string())
            })?,
    );
    let revision = profile_revision_from_database(row.try_get("revision")?)?;
    let handle_index_token = HandleIndexToken::from_database(
        row.try_get::<Option<Vec<u8>>, _>("handle_hmac")?
            .ok_or_else(|| {
                ProfileApplicationError::InvalidState(
                    "active profile has no handle index token".to_string(),
                )
            })?,
    )?;
    let presentation: ProfilePresentation = open_active_subject_claim(
        tx,
        subject_id,
        claim_id,
        "profile",
        profile_id.as_uuid(),
        None,
    )
    .await?;
    let expected_handle_index_token = HandleIndexToken::for_handle(presentation.handle.as_str())?;
    if handle_index_token != expected_handle_index_token {
        return Err(ProfileApplicationError::InvalidState(
            "profile handle index token does not match its sealed claim".to_string(),
        ));
    }
    Ok(LoadedProfile {
        state: ProfileState::Active(social::ActiveProfile {
            profile_id,
            owner: ProfileOwner::new(
                PrincipalId::from_uuid(principal_id),
                PrivacySubjectId::from_uuid(subject_id.as_uuid()),
            ),
            presentation,
            revision,
        }),
    })
}

fn profile_revision_from_database(value: i64) -> Result<ProfileRevision, ProfileApplicationError> {
    u64::try_from(value).map(ProfileRevision::new).map_err(|_| {
        ProfileApplicationError::InvalidState("profile revision is negative".to_string())
    })
}

async fn append_decision(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile_id: ProfileId,
    state_before: Option<ProfileState>,
    expected_revision: ProfileRevision,
    decision: Vec<social::ProfileEvent>,
    occurred_at: i64,
) -> Result<(), ProfileApplicationError> {
    let mut state = state_before;
    let mut canonical = Vec::with_capacity(decision.len());
    for domain_event in decision {
        let next = fold_profile_event(profile_id, state.as_ref(), &domain_event)?;
        let input = match (&domain_event, &next) {
            (
                social::ProfileEvent::Created { .. } | social::ProfileEvent::Updated { .. },
                ProfileState::Active(active),
            ) => {
                let subject_id = SubjectId::from_uuid(active.owner.privacy_subject_id.as_uuid());
                let claim_id = insert_subject_claim(
                    tx,
                    subject_id,
                    "profile",
                    profile_id.as_uuid(),
                    None,
                    occurred_at,
                    &active.presentation,
                )
                .await?;
                EventInput::new(
                    domain_event.kind(),
                    1,
                    serde_json::json!({
                        "subject_id": subject_id,
                        "claim_id": claim_id,
                    }),
                    ActorId::PrivacySubject(subject_id.as_uuid()),
                    occurred_at,
                )
            }
            (
                social::ProfileEvent::Redacted { retained_alias },
                ProfileState::Redacted(redacted),
            ) => {
                let subject_id = SubjectId::from_uuid(redacted.privacy_subject_id.as_uuid());
                EventInput::new(
                    domain_event.kind(),
                    1,
                    serde_json::json!({
                        "subject_id": subject_id,
                        "retained_alias": retained_alias.as_str(),
                    }),
                    ActorId::PrivacySubject(subject_id.as_uuid()),
                    occurred_at,
                )
            }
            _ => {
                return Err(ProfileApplicationError::InvalidState(
                    "profile decision did not fold into its expected lifecycle".to_string(),
                ));
            }
        };
        canonical.push(input);
        state = Some(next);
    }
    let expected_stream_seq = i64::try_from(expected_revision.as_u64()).map_err(|_| {
        ProfileApplicationError::InvalidState("profile revision exceeds stream range".to_string())
    })?;
    projections::append_canonical_profile_and_project_expected_in_tx(
        tx,
        profile_id.as_uuid(),
        expected_stream_seq,
        &canonical,
    )
    .await?;
    Ok(())
}
