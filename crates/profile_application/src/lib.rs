//! Profile command application boundary.
//!
//! This crate turns already-validated profile commands into sealed private
//! claims and canonical subject-attributed events.  It intentionally sits
//! between HTTP and projections: projections fold canonical facts; identity
//! owns subject keys; and `social` owns the pure profile state machine.

use eventstore::{ActorId, EventInput, StoreError};
use hmac::{Hmac, Mac};
use identity::{
    ensure_active_subject, insert_subject_claim, open_active_subject_claim, ClaimId, SubjectId,
};
use sha2::{Digest, Sha256};
use social::{
    decide_profile, fold_profile_event, PrincipalId, PrivacySubjectId, ProfileCommand,
    ProfileDecisionError, ProfileEdit, ProfileFoldError, ProfileId, ProfileOwner,
    ProfilePresentation, ProfileRevision, ProfileState,
};
use sqlx::Row;

const PROFILE_HANDLE_INDEX_KEY_ENV: &str = "FMARCH_PROFILE_HANDLE_INDEX_KEY";
const PROFILE_HANDLE_INDEX_KID_ENV: &str = "FMARCH_PROFILE_HANDLE_INDEX_KID";
const DEBUG_PROFILE_HANDLE_INDEX_KEY: &[u8] = b"fmarch-local-dev-profile-handle-index-key-v1";

type HmacSha256 = Hmac<Sha256>;

/// A stable, opaque HMAC token used for active-handle uniqueness and public
/// lookup. It is deliberately distinct from a profile handle: the plaintext
/// handle remains inside the sealed profile claim or the public projection.
#[derive(Debug, Clone, PartialEq, Eq)]
struct HandleIndexToken([u8; 32]);

impl HandleIndexToken {
    fn for_handle(handle: &social::ProfileHandle) -> Result<Self, ProfileApplicationError> {
        let key = load_handle_index_key()?;
        Self::for_handle_with_key(handle, &key)
    }

    fn for_handle_with_key(
        handle: &social::ProfileHandle,
        key: &[u8],
    ) -> Result<Self, ProfileApplicationError> {
        let mut mac = HmacSha256::new_from_slice(key).map_err(|_| {
            ProfileApplicationError::HandleIndexConfiguration(
                "configured key cannot initialize HMAC-SHA256".to_string(),
            )
        })?;
        mac.update(handle.as_str().as_bytes());
        let bytes: [u8; 32] = mac.finalize().into_bytes().into();
        Ok(Self(bytes))
    }

    fn from_database(bytes: Vec<u8>) -> Result<Self, ProfileApplicationError> {
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| {
            ProfileApplicationError::InvalidState(
                "active profile has a malformed handle index token".to_string(),
            )
        })?;
        Ok(Self(bytes))
    }

    fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    fn as_lower_hex(&self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut encoded = String::with_capacity(64);
        for byte in self.0 {
            encoded.push(HEX[(byte >> 4) as usize] as char);
            encoded.push(HEX[(byte & 0x0f) as usize] as char);
        }
        encoded
    }
}

fn load_handle_index_key() -> Result<Vec<u8>, ProfileApplicationError> {
    match std::env::var(PROFILE_HANDLE_INDEX_KEY_ENV) {
        Ok(value) if value.len() >= 32 && value == value.trim() => {
            if !cfg!(debug_assertions) && is_obvious_placeholder(&value) {
                return Err(ProfileApplicationError::HandleIndexConfiguration(
                    "FMARCH_PROFILE_HANDLE_INDEX_KEY must not use a placeholder value in release builds"
                        .to_string(),
                ));
            }
            Ok(value.into_bytes())
        }
        Ok(_) => Err(ProfileApplicationError::HandleIndexConfiguration(
            "FMARCH_PROFILE_HANDLE_INDEX_KEY must contain at least 32 bytes with no leading or trailing whitespace"
                .to_string(),
        )),
        Err(std::env::VarError::NotPresent) if cfg!(debug_assertions) => {
            Ok(Sha256::digest(DEBUG_PROFILE_HANDLE_INDEX_KEY).to_vec())
        }
        Err(std::env::VarError::NotPresent) => {
            Err(ProfileApplicationError::HandleIndexConfiguration(
                "FMARCH_PROFILE_HANDLE_INDEX_KEY is required in release builds".to_string(),
            ))
        }
        Err(std::env::VarError::NotUnicode(_)) => {
            Err(ProfileApplicationError::HandleIndexConfiguration(
                "FMARCH_PROFILE_HANDLE_INDEX_KEY must be valid UTF-8".to_string(),
            ))
        }
    }
}

fn is_obvious_placeholder(value: &str) -> bool {
    let normalized = value.to_ascii_lowercase();
    ["replace", "change", "placeholder", "example", "at-least"]
        .iter()
        .any(|marker| normalized.contains(marker))
}

fn load_handle_index_kid() -> Result<String, ProfileApplicationError> {
    let value = std::env::var(PROFILE_HANDLE_INDEX_KID_ENV).map_err(|error| match error {
        std::env::VarError::NotPresent => ProfileApplicationError::HandleIndexConfiguration(
            "FMARCH_PROFILE_HANDLE_INDEX_KID is required in release builds".to_string(),
        ),
        std::env::VarError::NotUnicode(_) => ProfileApplicationError::HandleIndexConfiguration(
            "FMARCH_PROFILE_HANDLE_INDEX_KID must be valid UTF-8".to_string(),
        ),
    })?;
    validate_handle_index_kid(value)
}

fn validate_handle_index_kid(value: String) -> Result<String, ProfileApplicationError> {
    let is_valid = !value.is_empty()
        && value.len() <= 128
        && value == value.trim()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if !is_valid {
        return Err(ProfileApplicationError::HandleIndexConfiguration(
            "FMARCH_PROFILE_HANDLE_INDEX_KID must be a non-empty, trimmed identifier using only letters, digits, '.', '_', or '-'"
                .to_string(),
        ));
    }
    Ok(value)
}

/// Fail fast before the server accepts traffic. Release builds require both the
/// opaque HMAC key and its non-secret custody marker; debug builds deliberately
/// retain the deterministic local fallback for hermetic tests and development.
pub fn require_profile_handle_index_configuration() -> Result<(), ProfileApplicationError> {
    let _ = load_handle_index_key()?;
    if !cfg!(debug_assertions) {
        let _ = load_handle_index_kid()?;
    }
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

/// Establish one new active profile.  Values are typed before this boundary;
/// raw request parsing belongs to the caller.
pub async fn create_profile(
    pool: &sqlx::postgres::PgPool,
    owner: PrincipalId,
    presentation: ProfilePresentation,
    occurred_at: i64,
) -> Result<ProfileId, ProfileApplicationError> {
    let handle_index_token = HandleIndexToken::for_handle(&presentation.handle)?;
    let mut tx = pool.begin().await?;
    lock_profile_creation(&mut tx, &owner, &handle_index_token).await?;
    if sqlx::query_scalar::<_, uuid::Uuid>(
        "SELECT profile_id FROM member_profile WHERE active_principal_id = $1",
    )
    .bind(owner.as_str())
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

    let subject_id = ensure_active_subject(&mut tx, owner.as_str(), occurred_at).await?;
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
        &handle_index_token,
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
        &loaded.handle_index_token,
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
    .bind(owner.as_str())
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
        format!("profile-owner:{}", owner.as_str()),
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
    handle_index_token: HandleIndexToken,
}

async fn load_profile_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    profile_id: ProfileId,
) -> Result<LoadedProfile, ProfileApplicationError> {
    let row = sqlx::query(
        r#"
        SELECT active_principal_id, subject_id, current_claim_id, lifecycle, revision, handle_hmac
        FROM member_profile
        WHERE profile_id = $1
        FOR UPDATE
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
    let principal_id: String = row
        .try_get::<Option<String>, _>("active_principal_id")?
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
    let expected_handle_index_token = HandleIndexToken::for_handle(&presentation.handle)?;
    if handle_index_token != expected_handle_index_token {
        return Err(ProfileApplicationError::InvalidState(
            "profile handle index token does not match its sealed claim".to_string(),
        ));
    }
    Ok(LoadedProfile {
        state: ProfileState::Active(social::ActiveProfile {
            profile_id,
            owner: ProfileOwner::new(
                PrincipalId::new(principal_id)
                    .map_err(|error| ProfileApplicationError::InvalidState(error.to_string()))?,
                PrivacySubjectId::from_uuid(subject_id.as_uuid()),
            ),
            presentation,
            revision,
        }),
        handle_index_token,
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
    handle_index_token: &HandleIndexToken,
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
                        "visibility": active.presentation.visibility.to_string(),
                        "handle_hmac": handle_index_token.as_lower_hex(),
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

#[cfg(test)]
mod tests {
    use super::{validate_handle_index_kid, HandleIndexToken};
    use social::ProfileHandle;

    #[test]
    fn handle_index_token_is_lowercase_hmac_sha256_of_normalized_handle() {
        let handle = ProfileHandle::new("  alpha_99 ").unwrap();
        let token = HandleIndexToken::for_handle_with_key(&handle, b"key").unwrap();

        assert_eq!(
            token.as_lower_hex(),
            "c1d19d2af723a87b25b0c14efb3c89cd6e3a3237fcb111c90a5f3eac43059410"
        );
    }

    #[test]
    fn database_token_requires_exact_sha256_width() {
        assert!(HandleIndexToken::from_database(vec![7; 31]).is_err());
        assert!(HandleIndexToken::from_database(vec![7; 32]).is_ok());
    }

    #[test]
    fn handle_index_kid_is_a_trimmed_public_identifier() {
        assert!(validate_handle_index_kid("profile-index-v1".to_string()).is_ok());
        assert!(validate_handle_index_kid(" profile-index-v1".to_string()).is_err());
        assert!(validate_handle_index_kid("profile index v1".to_string()).is_err());
    }
}
