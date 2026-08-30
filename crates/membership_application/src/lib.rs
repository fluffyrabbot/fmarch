//! Transaction-aware closed-community admission boundary.
//!
//! This crate is the only ordinary path that may join invitation consumption,
//! identity provisioning, membership genesis, ancestry projection, and app
//! session issuance in one PostgreSQL transaction.

use base64::Engine;
use community_membership::{
    decide_invitation, decide_membership, InvitationCommand, InvitationEvent, InvitationId,
    InvitationState, InvitationStatus, MembershipCommand, MembershipEvent, MembershipId,
    MembershipOrigin, MembershipState, MembershipStatus,
};
use eventstore::{ActorId, EventInput};
use hmac::{Hmac, Mac};
use identity::{Assurance, IssuedSession, SessionPolicy, SessionSpec};
use principal::PrincipalId;
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::{Postgres, Row, Transaction};
use thiserror::Error;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone)]
pub struct InvitationTargetIndex([u8; 32]);

impl InvitationTargetIndex {
    pub fn from_key_bytes(key: &[u8]) -> Result<Self, MembershipApplicationError> {
        if key.len() < 32 {
            return Err(MembershipApplicationError::Configuration(
                "invitation target-index key must contain at least 32 bytes".to_string(),
            ));
        }
        let mut derived = [0_u8; 32];
        derived.copy_from_slice(&Sha256::digest(key));
        Ok(Self(derived))
    }

    pub fn from_env() -> Result<Self, MembershipApplicationError> {
        let key = std::env::var("FMARCH_INVITATION_TARGET_INDEX_KEY").map_err(|_| {
            MembershipApplicationError::Configuration(
                "FMARCH_INVITATION_TARGET_INDEX_KEY is required".to_string(),
            )
        })?;
        Self::from_key_bytes(key.as_bytes())
    }

    /// Production requires explicit key custody. Debug/test binaries receive a
    /// deterministic local key so hermetic contract tests do not depend on
    /// ambient process configuration.
    pub fn from_env_or_local() -> Result<Self, MembershipApplicationError> {
        match std::env::var("FMARCH_INVITATION_TARGET_INDEX_KEY") {
            Ok(key) => Self::from_key_bytes(key.as_bytes()),
            Err(_) if cfg!(debug_assertions) => {
                Self::from_key_bytes(b"fmarch-local-invitation-target-index-key-v1")
            }
            Err(_) => Err(MembershipApplicationError::Configuration(
                "FMARCH_INVITATION_TARGET_INDEX_KEY is required".to_string(),
            )),
        }
    }

    pub fn blind(&self, normalized_target: &str) -> String {
        let mut mac = HmacSha256::new_from_slice(&self.0).expect("fixed HMAC key is valid");
        mac.update(b"fmarch-community-invitation-target-v1\0");
        mac.update(normalized_target.as_bytes());
        hex(mac.finalize().into_bytes().as_slice())
    }
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[derive(Debug, Error)]
pub enum MembershipApplicationError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Store(#[from] eventstore::StoreError),
    #[error(transparent)]
    Identity(#[from] identity::IdentityFlowError),
    #[error("membership decision failed: {0}")]
    Membership(#[from] community_membership::MembershipReject),
    #[error("invitation decision failed: {0}")]
    Invitation(#[from] community_membership::InvitationReject),
    #[error("membership admission is unavailable")]
    Unavailable,
    #[error("membership application configuration is invalid: {0}")]
    Configuration(String),
    #[error("community invitation quota exceeded; retry after {retry_after_seconds} seconds")]
    QuotaExceeded { retry_after_seconds: i64 },
    #[error("membership projection is invalid: {0}")]
    InvalidState(String),
}

#[derive(Clone, Serialize)]
pub struct IssuedCommunityInvitation {
    pub invitation_id: InvitationId,
    pub sponsoring_membership_id: MembershipId,
    pub target_account_id: String,
    pub expires_at: i64,
    #[serde(skip_serializing)]
    pub credential: String,
}

#[derive(Debug)]
pub struct ClassicAdmission {
    pub membership_id: MembershipId,
    pub principal_id: PrincipalId,
    pub method_id: Uuid,
    pub session: IssuedSession,
}

#[derive(Debug, Clone, Serialize)]
pub struct MembershipLineageEntry {
    pub membership_id: MembershipId,
    pub depth: i32,
    pub status: String,
    pub retained_alias: Option<String>,
}

pub const MAX_OPEN_INVITATIONS_PER_SPONSOR: i64 = 10;
pub const MAX_INVITATIONS_PER_ROLLING_WEEK: i64 = 20;
const INVITATION_QUOTA_WINDOW_SECONDS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct CommunityStewardshipMetrics {
    pub active_memberships: i64,
    pub suspended_memberships: i64,
    pub withdrawn_memberships: i64,
    pub redacted_memberships: i64,
    pub pending_invitations: i64,
    pub invitations_issued_last_7_days: i64,
    pub invitations_accepted_last_7_days: i64,
    pub invitations_revoked_last_7_days: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StewardshipMembership {
    pub membership_id: MembershipId,
    pub sponsoring_membership_id: Option<MembershipId>,
    pub admission_invitation_id: Option<InvitationId>,
    pub depth: i32,
    pub status: String,
    pub origin_kind: String,
    pub admitted_at: i64,
    pub updated_at: i64,
    pub open_invitation_count: i64,
    pub invitations_issued_last_7_days: i64,
    pub quota_state: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PendingCommunityInvitation {
    pub invitation_id: InvitationId,
    pub sponsoring_membership_id: MembershipId,
    pub target_fingerprint: String,
    pub created_at: i64,
    pub expires_at: i64,
    pub delivery_status: Option<String>,
    pub delivery_provider_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommunityStewardshipSnapshot {
    pub root_membership_id: Option<MembershipId>,
    pub metrics: CommunityStewardshipMetrics,
    pub memberships: Vec<StewardshipMembership>,
    pub pending_invitations: Vec<PendingCommunityInvitation>,
    pub invitation_quota: CommunityInvitationQuota,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommunityInvitationQuota {
    pub max_open_per_sponsor: i64,
    pub max_issued_per_rolling_7_days: i64,
}

/// Create one explicit provenance root for an already-created bootstrap
/// principal. Repeating the operation for the same principal returns the
/// existing membership without inventing another root.
pub async fn ensure_founder_membership(
    pool: &sqlx::PgPool,
    principal_id: PrincipalId,
    now: i64,
) -> Result<MembershipId, MembershipApplicationError> {
    let mut tx = pool.begin().await?;
    let membership_id = ensure_founder_membership_in_tx(&mut tx, principal_id, now).await?;
    tx.commit().await?;
    Ok(membership_id)
}

pub async fn ensure_founder_membership_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: PrincipalId,
    now: i64,
) -> Result<MembershipId, MembershipApplicationError> {
    if let Some(existing) = sqlx::query_scalar::<_, Uuid>(
        "SELECT membership_id FROM community_membership WHERE active_principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    {
        return Ok(MembershipId::from_uuid(existing));
    }
    let membership_id = MembershipId::random();
    let events = decide_membership(membership_id, None, MembershipCommand::Found)?;
    append_membership_events(tx, membership_id, principal_id, &events, now).await?;
    Ok(membership_id)
}

pub async fn issue_invitation(
    pool: &sqlx::PgPool,
    target_index: &InvitationTargetIndex,
    sponsoring_principal_id: PrincipalId,
    target_account_id: &str,
    expires_at: i64,
    now: i64,
) -> Result<IssuedCommunityInvitation, MembershipApplicationError> {
    let mut tx = pool.begin().await?;
    let invitation = issue_invitation_in_tx(
        &mut tx,
        target_index,
        sponsoring_principal_id,
        target_account_id,
        expires_at,
        now,
    )
    .await?;
    tx.commit().await?;
    Ok(invitation)
}

pub async fn issue_invitation_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    target_index: &InvitationTargetIndex,
    sponsoring_principal_id: PrincipalId,
    target_account_id: &str,
    expires_at: i64,
    now: i64,
) -> Result<IssuedCommunityInvitation, MembershipApplicationError> {
    let target_account_id = normalize_target(target_account_id)?;
    let sponsor = load_membership_for_principal(tx, sponsoring_principal_id)
        .await?
        .ok_or(MembershipApplicationError::Unavailable)?;
    enforce_invitation_quota(tx, sponsor.membership_id, now).await?;
    let invitation_id = InvitationId::random();
    let blind_target = target_index.blind(target_account_id.as_str());
    let events = decide_invitation(
        None,
        Some(&sponsor),
        InvitationCommand::Issue {
            sponsoring_membership_id: sponsor.membership_id,
            target_index: blind_target,
            expires_at,
            now,
        },
    )?;
    append_invitation_events(tx, invitation_id, &events, now).await?;

    let credential = random_invitation_credential();
    let token_hash = hash_credential(credential.as_str());
    sqlx::query(
        r#"
        INSERT INTO community_invitation_credential (
            token_hash, invitation_id, created_at, expires_at, consumed_at, revoked_at
        )
        VALUES ($1, $2, $3, $4, NULL, NULL)
        "#,
    )
    .bind(token_hash)
    .bind(invitation_id.as_uuid())
    .bind(now)
    .bind(expires_at)
    .execute(&mut **tx)
    .await?;
    Ok(IssuedCommunityInvitation {
        invitation_id,
        sponsoring_membership_id: sponsor.membership_id,
        target_account_id,
        expires_at,
        credential,
    })
}

pub async fn revoke_invitation(
    pool: &sqlx::PgPool,
    sponsoring_principal_id: PrincipalId,
    invitation_id: InvitationId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let mut tx = pool.begin().await?;
    let sponsor = load_membership_for_principal(&mut tx, sponsoring_principal_id)
        .await?
        .ok_or(MembershipApplicationError::Unavailable)?;
    let owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT sponsoring_membership_id FROM community_invitation WHERE invitation_id = $1",
    )
    .bind(invitation_id.as_uuid())
    .fetch_optional(&mut *tx)
    .await?
    .map(MembershipId::from_uuid)
    .ok_or(MembershipApplicationError::Unavailable)?;
    if owner != sponsor.membership_id {
        return Err(MembershipApplicationError::Unavailable);
    }
    revoke_invitation_in_tx(&mut tx, invitation_id, now).await?;
    tx.commit().await?;
    Ok(())
}

/// Provision Classic identity and membership in one transaction. Password
/// validation and expensive Argon2 hashing happen before this boundary; a
/// failed admission still rolls back every durable identity write.
pub async fn admit_classic(
    pool: &sqlx::PgPool,
    target_index: &InvitationTargetIndex,
    invitation_credential: &str,
    account_id: &str,
    password_hash: &str,
    session_policy: &SessionPolicy,
    now: i64,
) -> Result<ClassicAdmission, MembershipApplicationError> {
    let account_id = normalize_target(account_id)?;
    let mut tx = pool.begin().await?;
    let permit = lock_admission(
        &mut tx,
        target_index,
        invitation_credential,
        account_id.as_str(),
        now,
    )
    .await?;
    if sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM auth_account WHERE account_id = $1)",
    )
    .bind(account_id.as_str())
    .fetch_one(&mut *tx)
    .await?
    {
        return Err(MembershipApplicationError::Unavailable);
    }

    let principal_id = PrincipalId::random();
    identity::methods::ensure_principal(&mut tx, &principal_id, &[], now).await?;
    let method_id = identity::methods::create_method(
        &mut tx,
        &principal_id,
        identity::MethodKind::ClassicPassword,
        now,
    )
    .await?;
    sqlx::query(
        r#"
        INSERT INTO auth_account (
            account_id, principal_id, method_id, password_hash, created_at,
            disabled_at, global_capabilities
        )
        VALUES ($1, $2, $3, $4, $5, NULL, '{}')
        "#,
    )
    .bind(account_id.as_str())
    .bind(principal_id.as_uuid())
    .bind(method_id)
    .bind(password_hash)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    complete_admission(&mut tx, &permit, principal_id, now).await?;
    let expires_at = session_policy.classic_expiry(now);
    let session = identity::session::issue_session(
        &mut tx,
        SessionSpec {
            principal_id: &principal_id,
            session_capabilities: &[],
            authenticated_via_method_id: Some(method_id),
            assurance: Assurance::Password,
            workos_session_id: None,
            authenticated_at: now,
            expires_at,
            idle_expires_at: session_policy.idle_expiry(now, expires_at),
        },
        now,
    )
    .await?;
    insert_admission_audit(
        &mut tx,
        principal_id,
        permit.membership_id,
        permit.invitation_id,
        permit.sponsoring_membership_id,
        session.token_hash.as_str(),
        now,
        "classic_password",
    )
    .await?;
    tx.commit().await?;
    Ok(ClassicAdmission {
        membership_id: permit.membership_id,
        principal_id,
        method_id,
        session,
    })
}

/// Lock and validate an invitation before a method-specific admission path.
/// The returned permit is valid only inside the same transaction.
pub async fn lock_admission(
    tx: &mut Transaction<'_, Postgres>,
    target_index: &InvitationTargetIndex,
    invitation_credential: &str,
    account_id: &str,
    now: i64,
) -> Result<AdmissionPermit, MembershipApplicationError> {
    let account_id = normalize_target(account_id)?;
    let token_hash = hash_credential(invitation_credential.trim());
    // Resolve only immutable ownership first, without taking row locks. Every
    // invitation mutation then follows sponsor -> invitation -> credential,
    // matching issuance and revocation and preventing inverse-lock deadlocks.
    let ownership = sqlx::query_as::<_, (Uuid, Uuid)>(
        r#"
        SELECT invitation.invitation_id, invitation.sponsoring_membership_id
        FROM community_invitation_credential AS credential
        JOIN community_invitation AS invitation
          ON invitation.invitation_id = credential.invitation_id
        WHERE credential.token_hash = $1
        "#,
    )
    .bind(token_hash.as_str())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(MembershipApplicationError::Unavailable)?;
    let invitation_id = InvitationId::from_uuid(ownership.0);
    let sponsoring_membership_id = MembershipId::from_uuid(ownership.1);
    let sponsor = load_membership_by_id(tx, sponsoring_membership_id)
        .await?
        .ok_or(MembershipApplicationError::Unavailable)?;
    let row = sqlx::query(
        r#"
        SELECT credential.invitation_id,
               invitation.sponsoring_membership_id,
               invitation.target_index,
               invitation.expires_at,
               invitation.status,
               invitation.admitted_membership_id,
               invitation.revision
        FROM community_invitation_credential AS credential
        JOIN community_invitation AS invitation
          ON invitation.invitation_id = credential.invitation_id
        WHERE credential.token_hash = $1
          AND invitation.invitation_id = $3
          AND invitation.sponsoring_membership_id = $4
          AND credential.consumed_at IS NULL
          AND credential.revoked_at IS NULL
          AND credential.expires_at > $2
        FOR UPDATE OF invitation, credential
        "#,
    )
    .bind(token_hash.as_str())
    .bind(now)
    .bind(invitation_id.as_uuid())
    .bind(sponsoring_membership_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(MembershipApplicationError::Unavailable)?;

    let invitation = InvitationState {
        invitation_id,
        sponsoring_membership_id,
        target_index: row.try_get("target_index")?,
        expires_at: row.try_get("expires_at")?,
        status: invitation_status(row.try_get::<String, _>("status")?.as_str())?,
        admitted_membership_id: row
            .try_get::<Option<Uuid>, _>("admitted_membership_id")?
            .map(MembershipId::from_uuid),
        revision: row.try_get("revision")?,
    };
    let membership_id = MembershipId::random();
    let blind_target = target_index.blind(account_id.as_str());
    let invitation_events = decide_invitation(
        Some(&invitation),
        Some(&sponsor),
        InvitationCommand::Accept {
            admitted_membership_id: membership_id,
            presented_target_index: blind_target,
            now,
        },
    )?;
    Ok(AdmissionPermit {
        token_hash,
        invitation_id,
        sponsoring_membership_id,
        membership_id,
        invitation_revision: invitation.revision,
        invitation_events,
    })
}

pub async fn complete_admission(
    tx: &mut Transaction<'_, Postgres>,
    permit: &AdmissionPermit,
    principal_id: PrincipalId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    if sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM community_membership WHERE active_principal_id = $1)",
    )
    .bind(principal_id.as_uuid())
    .fetch_one(&mut **tx)
    .await?
    {
        return Err(MembershipApplicationError::Unavailable);
    }
    let membership_events = decide_membership(
        permit.membership_id,
        None,
        MembershipCommand::Admit {
            invitation_id: permit.invitation_id,
            sponsoring_membership_id: permit.sponsoring_membership_id,
        },
    )?;
    append_membership_events(
        tx,
        permit.membership_id,
        principal_id,
        &membership_events,
        now,
    )
    .await?;
    append_invitation_events_expected(
        tx,
        permit.invitation_id,
        permit.invitation_revision,
        &permit.invitation_events,
        now,
    )
    .await?;
    let consumed = sqlx::query(
        r#"
        UPDATE community_invitation_credential
        SET consumed_at = $1
        WHERE token_hash = $2
          AND consumed_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > $1
        "#,
    )
    .bind(now)
    .bind(permit.token_hash.as_str())
    .execute(&mut **tx)
    .await?;
    if consumed.rows_affected() != 1 {
        return Err(MembershipApplicationError::Unavailable);
    }
    Ok(())
}

pub async fn membership_for_principal(
    pool: &sqlx::PgPool,
    principal_id: PrincipalId,
) -> Result<Option<MembershipId>, MembershipApplicationError> {
    Ok(sqlx::query_scalar::<_, Uuid>(
        "SELECT membership_id FROM community_membership WHERE active_principal_id = $1 AND status = 'active'",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(pool)
    .await?
    .map(MembershipId::from_uuid))
}

pub async fn lineage_for_principal(
    pool: &sqlx::PgPool,
    principal_id: PrincipalId,
) -> Result<Vec<MembershipLineageEntry>, MembershipApplicationError> {
    let rows = sqlx::query_as::<_, (Uuid, i32, String, Option<String>)>(
        r#"
        SELECT ancestor.membership_id, ancestry.depth, ancestor.status, ancestor.retained_alias
        FROM community_membership AS owner
        JOIN membership_ancestry AS ancestry
          ON ancestry.descendant_membership_id = owner.membership_id
        JOIN community_membership AS ancestor
          ON ancestor.membership_id = ancestry.ancestor_membership_id
        WHERE owner.active_principal_id = $1
        ORDER BY ancestry.depth DESC, ancestor.membership_id
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(
            |(membership_id, depth, status, retained_alias)| MembershipLineageEntry {
                membership_id: MembershipId::from_uuid(membership_id),
                depth,
                status,
                retained_alias,
            },
        )
        .collect())
}

async fn enforce_invitation_quota(
    tx: &mut Transaction<'_, Postgres>,
    sponsoring_membership_id: MembershipId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let open = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM community_invitation WHERE sponsoring_membership_id = $1 AND status = 'issued' AND expires_at > $2",
    )
    .bind(sponsoring_membership_id.as_uuid())
    .bind(now)
    .fetch_one(&mut **tx)
    .await?;
    if open >= MAX_OPEN_INVITATIONS_PER_SPONSOR {
        let retry_at = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MIN(expires_at) FROM community_invitation WHERE sponsoring_membership_id = $1 AND status = 'issued' AND expires_at > $2",
        )
        .bind(sponsoring_membership_id.as_uuid())
        .bind(now)
        .fetch_one(&mut **tx)
        .await?
        .unwrap_or(now + 1);
        return Err(MembershipApplicationError::QuotaExceeded {
            retry_after_seconds: (retry_at - now).max(1),
        });
    }
    let window_start = now - INVITATION_QUOTA_WINDOW_SECONDS;
    let issued = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM community_invitation WHERE sponsoring_membership_id = $1 AND created_at > $2",
    )
    .bind(sponsoring_membership_id.as_uuid())
    .bind(window_start)
    .fetch_one(&mut **tx)
    .await?;
    if issued >= MAX_INVITATIONS_PER_ROLLING_WEEK {
        let oldest = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT MIN(created_at) FROM community_invitation WHERE sponsoring_membership_id = $1 AND created_at > $2",
        )
        .bind(sponsoring_membership_id.as_uuid())
        .bind(window_start)
        .fetch_one(&mut **tx)
        .await?
        .unwrap_or(now);
        return Err(MembershipApplicationError::QuotaExceeded {
            retry_after_seconds: (oldest + INVITATION_QUOTA_WINDOW_SECONDS - now).max(1),
        });
    }
    Ok(())
}

pub async fn community_stewardship_snapshot(
    pool: &sqlx::PgPool,
    root_membership_id: Option<MembershipId>,
    now: i64,
) -> Result<CommunityStewardshipSnapshot, MembershipApplicationError> {
    if let Some(root) = root_membership_id {
        let exists = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM community_membership WHERE membership_id = $1)",
        )
        .bind(root.as_uuid())
        .fetch_one(pool)
        .await?;
        if !exists {
            return Err(MembershipApplicationError::Unavailable);
        }
    }
    let rows = sqlx::query(
        r#"
        SELECT member.membership_id, member.sponsoring_membership_id,
               member.admission_invitation_id, member.status, member.origin_kind,
               member.admitted_at, member.updated_at,
               CASE WHEN $1::UUID IS NULL
                    THEN COALESCE((SELECT MAX(a.depth) FROM membership_ancestry a WHERE a.descendant_membership_id = member.membership_id), 0)
                    ELSE selected.depth END AS depth,
               COUNT(invitation.invitation_id) FILTER (WHERE invitation.status = 'issued' AND invitation.expires_at > $2) AS open_count,
               COUNT(invitation.invitation_id) FILTER (WHERE invitation.created_at > $3) AS recent_count
        FROM community_membership member
        LEFT JOIN membership_ancestry selected
          ON selected.descendant_membership_id = member.membership_id
         AND selected.ancestor_membership_id = $1
        LEFT JOIN community_invitation invitation
          ON invitation.sponsoring_membership_id = member.membership_id
        WHERE $1::UUID IS NULL OR selected.ancestor_membership_id IS NOT NULL
        GROUP BY member.membership_id, selected.depth
        ORDER BY depth, member.admitted_at, member.membership_id
        LIMIT 500
        "#,
    )
    .bind(root_membership_id.map(MembershipId::as_uuid))
    .bind(now)
    .bind(now - INVITATION_QUOTA_WINDOW_SECONDS)
    .fetch_all(pool)
    .await?;
    let memberships = rows
        .into_iter()
        .map(|row| {
            let open_invitation_count: i64 = row.try_get("open_count")?;
            let invitations_issued_last_7_days: i64 = row.try_get("recent_count")?;
            let quota_state = if open_invitation_count >= MAX_OPEN_INVITATIONS_PER_SPONSOR
                || invitations_issued_last_7_days >= MAX_INVITATIONS_PER_ROLLING_WEEK
            {
                "blocked"
            } else if open_invitation_count >= MAX_OPEN_INVITATIONS_PER_SPONSOR * 8 / 10
                || invitations_issued_last_7_days >= MAX_INVITATIONS_PER_ROLLING_WEEK * 8 / 10
            {
                "near_limit"
            } else {
                "normal"
            };
            Ok(StewardshipMembership {
                membership_id: MembershipId::from_uuid(row.try_get("membership_id")?),
                sponsoring_membership_id: row
                    .try_get::<Option<Uuid>, _>("sponsoring_membership_id")?
                    .map(MembershipId::from_uuid),
                admission_invitation_id: row
                    .try_get::<Option<Uuid>, _>("admission_invitation_id")?
                    .map(InvitationId::from_uuid),
                depth: row.try_get("depth")?,
                status: row.try_get("status")?,
                origin_kind: row.try_get("origin_kind")?,
                admitted_at: row.try_get("admitted_at")?,
                updated_at: row.try_get("updated_at")?,
                open_invitation_count,
                invitations_issued_last_7_days,
                quota_state: quota_state.to_string(),
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let invitation_rows = sqlx::query(
        r#"
        SELECT invitation.invitation_id, invitation.sponsoring_membership_id,
               LEFT(invitation.target_index, 12) AS target_fingerprint,
               invitation.created_at, invitation.expires_at,
               delivery.status AS delivery_status, delivery.provider_id AS delivery_provider_id
        FROM community_invitation invitation
        JOIN community_invitation_credential credential USING (invitation_id)
        LEFT JOIN auth_delivery_intent delivery ON delivery.credential_hash = credential.token_hash
        LEFT JOIN membership_ancestry selected
          ON selected.descendant_membership_id = invitation.sponsoring_membership_id
         AND selected.ancestor_membership_id = $1
        WHERE invitation.status = 'issued' AND invitation.expires_at > $2
          AND ($1::UUID IS NULL OR selected.ancestor_membership_id IS NOT NULL)
        ORDER BY invitation.created_at DESC, invitation.invitation_id
        LIMIT 500
        "#,
    )
    .bind(root_membership_id.map(MembershipId::as_uuid))
    .bind(now)
    .fetch_all(pool)
    .await?;
    let pending_invitations = invitation_rows
        .into_iter()
        .map(|row| {
            Ok(PendingCommunityInvitation {
                invitation_id: InvitationId::from_uuid(row.try_get("invitation_id")?),
                sponsoring_membership_id: MembershipId::from_uuid(
                    row.try_get("sponsoring_membership_id")?,
                ),
                target_fingerprint: row.try_get("target_fingerprint")?,
                created_at: row.try_get("created_at")?,
                expires_at: row.try_get("expires_at")?,
                delivery_status: row.try_get("delivery_status")?,
                delivery_provider_id: row.try_get("delivery_provider_id")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    let counts = sqlx::query(
        r#"
        SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
               COUNT(*) FILTER (WHERE status = 'suspended') AS suspended,
               COUNT(*) FILTER (WHERE status = 'withdrawn') AS withdrawn,
               COUNT(*) FILTER (WHERE status = 'redacted') AS redacted
        FROM community_membership
        "#,
    )
    .fetch_one(pool)
    .await?;
    let invitation_counts = sqlx::query(
        r#"
        SELECT COUNT(*) FILTER (WHERE status = 'issued' AND expires_at > $1) AS pending,
               COUNT(*) FILTER (WHERE created_at > $2) AS issued,
               COUNT(*) FILTER (WHERE status = 'accepted' AND updated_at > $2) AS accepted,
               COUNT(*) FILTER (WHERE status = 'revoked' AND updated_at > $2) AS revoked
        FROM community_invitation
        "#,
    )
    .bind(now)
    .bind(now - INVITATION_QUOTA_WINDOW_SECONDS)
    .fetch_one(pool)
    .await?;
    Ok(CommunityStewardshipSnapshot {
        root_membership_id,
        metrics: CommunityStewardshipMetrics {
            active_memberships: counts.try_get("active")?,
            suspended_memberships: counts.try_get("suspended")?,
            withdrawn_memberships: counts.try_get("withdrawn")?,
            redacted_memberships: counts.try_get("redacted")?,
            pending_invitations: invitation_counts.try_get("pending")?,
            invitations_issued_last_7_days: invitation_counts.try_get("issued")?,
            invitations_accepted_last_7_days: invitation_counts.try_get("accepted")?,
            invitations_revoked_last_7_days: invitation_counts.try_get("revoked")?,
        },
        memberships,
        pending_invitations,
        invitation_quota: CommunityInvitationQuota {
            max_open_per_sponsor: MAX_OPEN_INVITATIONS_PER_SPONSOR,
            max_issued_per_rolling_7_days: MAX_INVITATIONS_PER_ROLLING_WEEK,
        },
    })
}

pub async fn steward_membership(
    pool: &sqlx::PgPool,
    actor_principal_id: PrincipalId,
    membership_id: MembershipId,
    command: MembershipCommand,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let mut tx = pool.begin().await?;
    let membership = load_membership_by_id(&mut tx, membership_id)
        .await?
        .ok_or(MembershipApplicationError::Unavailable)?;
    let events = decide_membership(membership_id, Some(&membership), command)?;
    append_membership_events_expected(
        &mut tx,
        membership_id,
        actor_principal_id,
        membership.revision,
        &events,
        now,
    )
    .await?;
    if matches!(events.as_slice(), [MembershipEvent::Suspended { .. }]) {
        revoke_open_invitations_for_sponsor(&mut tx, membership_id, now).await?;
    }
    insert_stewardship_audit(
        &mut tx,
        actor_principal_id,
        membership_id,
        if matches!(events.as_slice(), [MembershipEvent::Suspended { .. }]) {
            "community_membership_suspended"
        } else {
            "community_membership_restored"
        },
        now,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn steward_revoke_invitation(
    pool: &sqlx::PgPool,
    actor_principal_id: PrincipalId,
    invitation_id: InvitationId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let mut tx = pool.begin().await?;
    let owner = sqlx::query_scalar::<_, Uuid>(
        "SELECT sponsoring_membership_id FROM community_invitation WHERE invitation_id = $1",
    )
    .bind(invitation_id.as_uuid())
    .fetch_optional(&mut *tx)
    .await?
    .map(MembershipId::from_uuid)
    .ok_or(MembershipApplicationError::Unavailable)?;
    load_membership_by_id(&mut tx, owner)
        .await?
        .ok_or(MembershipApplicationError::Unavailable)?;
    revoke_invitation_in_tx(&mut tx, invitation_id, now).await?;
    sqlx::query(
        r#"INSERT INTO identity_lifecycle_audit
           (event_at, event_kind, actor_principal_id, principal_id, token_hash, related_token_hash, metadata)
           VALUES ($1, 'community_invitation_revoked_by_admin', $2, $2, NULL, NULL, $3::JSONB)"#,
    )
    .bind(now)
    .bind(actor_principal_id.as_uuid())
    .bind(serde_json::json!({ "invitation_id": invitation_id }).to_string())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug)]
pub struct AdmissionPermit {
    token_hash: String,
    pub invitation_id: InvitationId,
    pub sponsoring_membership_id: MembershipId,
    pub membership_id: MembershipId,
    invitation_revision: i64,
    invitation_events: Vec<InvitationEvent>,
}

async fn append_membership_events(
    tx: &mut Transaction<'_, Postgres>,
    membership_id: MembershipId,
    principal_id: PrincipalId,
    events: &[MembershipEvent],
    now: i64,
) -> Result<(), MembershipApplicationError> {
    append_membership_events_expected(tx, membership_id, principal_id, 0, events, now).await
}

async fn append_membership_events_expected(
    tx: &mut Transaction<'_, Postgres>,
    membership_id: MembershipId,
    principal_id: PrincipalId,
    expected_revision: i64,
    events: &[MembershipEvent],
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let inputs = events
        .iter()
        .map(|event| EventInput::new(event.kind(), 1, event.payload(), ActorId::System, now))
        .collect::<Vec<_>>();
    let stored =
        eventstore::append_expected_in_tx(tx, membership_id.as_uuid(), expected_revision, &inputs)
            .await?;
    for (event, stored) in events.iter().zip(stored.iter()) {
        match event {
            MembershipEvent::Founded => {
                sqlx::query(
                    r#"
                    INSERT INTO community_membership (
                        membership_id, active_principal_id, status, origin_kind,
                        admission_invitation_id, sponsoring_membership_id,
                        admitted_at, updated_at, revision, retained_alias
                    )
                    VALUES ($1, $2, 'active', 'founder', NULL, NULL, $3, $3, $4, NULL)
                    "#,
                )
                .bind(membership_id.as_uuid())
                .bind(principal_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
                sqlx::query(
                    "INSERT INTO membership_ancestry (ancestor_membership_id, descendant_membership_id, depth) VALUES ($1, $1, 0)",
                )
                .bind(membership_id.as_uuid())
                .execute(&mut **tx)
                .await?;
            }
            MembershipEvent::Admitted {
                invitation_id,
                sponsoring_membership_id,
            } => {
                sqlx::query(
                    r#"
                    INSERT INTO community_membership (
                        membership_id, active_principal_id, status, origin_kind,
                        admission_invitation_id, sponsoring_membership_id,
                        admitted_at, updated_at, revision, retained_alias
                    )
                    VALUES ($1, $2, 'active', 'invitation', $3, $4, $5, $5, $6, NULL)
                    "#,
                )
                .bind(membership_id.as_uuid())
                .bind(principal_id.as_uuid())
                .bind(invitation_id.as_uuid())
                .bind(sponsoring_membership_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
                sqlx::query(
                    r#"
                    INSERT INTO membership_ancestry (
                        ancestor_membership_id, descendant_membership_id, depth
                    )
                    SELECT ancestor_membership_id, $1, depth + 1
                    FROM membership_ancestry
                    WHERE descendant_membership_id = $2
                    UNION ALL
                    SELECT $1, $1, 0
                    "#,
                )
                .bind(membership_id.as_uuid())
                .bind(sponsoring_membership_id.as_uuid())
                .execute(&mut **tx)
                .await?;
            }
            MembershipEvent::Suspended { .. } => {
                let updated = sqlx::query(
                    "UPDATE community_membership SET status = 'suspended', updated_at = $2, revision = $3 WHERE membership_id = $1 AND status = 'active'",
                )
                .bind(membership_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
                if updated.rows_affected() != 1 {
                    return Err(MembershipApplicationError::Unavailable);
                }
            }
            MembershipEvent::Restored => {
                let updated = sqlx::query(
                    "UPDATE community_membership SET status = 'active', updated_at = $2, revision = $3 WHERE membership_id = $1 AND status = 'suspended'",
                )
                .bind(membership_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
                if updated.rows_affected() != 1 {
                    return Err(MembershipApplicationError::Unavailable);
                }
            }
            MembershipEvent::Withdrawn => {
                sqlx::query("UPDATE community_membership SET status = 'withdrawn', updated_at = $2, revision = $3 WHERE membership_id = $1")
                    .bind(membership_id.as_uuid()).bind(now).bind(stored.stream_seq)
                    .execute(&mut **tx).await?;
            }
            MembershipEvent::Redacted { retained_alias } => {
                sqlx::query("UPDATE community_membership SET status = 'redacted', active_principal_id = NULL, retained_alias = $2, updated_at = $3, revision = $4 WHERE membership_id = $1")
                    .bind(membership_id.as_uuid()).bind(retained_alias).bind(now).bind(stored.stream_seq)
                    .execute(&mut **tx).await?;
            }
        }
    }
    Ok(())
}

async fn revoke_open_invitations_for_sponsor(
    tx: &mut Transaction<'_, Postgres>,
    sponsoring_membership_id: MembershipId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let ids = sqlx::query_scalar::<_, Uuid>(
        "SELECT invitation_id FROM community_invitation WHERE sponsoring_membership_id = $1 AND status = 'issued' ORDER BY invitation_id FOR UPDATE",
    )
    .bind(sponsoring_membership_id.as_uuid())
    .fetch_all(&mut **tx)
    .await?;
    for id in ids {
        revoke_invitation_in_tx(tx, InvitationId::from_uuid(id), now).await?;
    }
    Ok(())
}

async fn revoke_invitation_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    invitation_id: InvitationId,
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let row = sqlx::query(
        "SELECT sponsoring_membership_id, target_index, expires_at, status, admitted_membership_id, revision FROM community_invitation WHERE invitation_id = $1 FOR UPDATE",
    )
    .bind(invitation_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(MembershipApplicationError::Unavailable)?;
    let invitation = InvitationState {
        invitation_id,
        sponsoring_membership_id: MembershipId::from_uuid(row.try_get("sponsoring_membership_id")?),
        target_index: row.try_get("target_index")?,
        expires_at: row.try_get("expires_at")?,
        status: invitation_status(row.try_get::<String, _>("status")?.as_str())?,
        admitted_membership_id: row
            .try_get::<Option<Uuid>, _>("admitted_membership_id")?
            .map(MembershipId::from_uuid),
        revision: row.try_get("revision")?,
    };
    if invitation.status != InvitationStatus::Issued {
        return Err(MembershipApplicationError::Unavailable);
    }
    append_invitation_events_expected(
        tx,
        invitation_id,
        invitation.revision,
        &[InvitationEvent::Revoked],
        now,
    )
    .await?;
    let hashes = sqlx::query_scalar::<_, String>(
        "UPDATE community_invitation_credential SET revoked_at = $2 WHERE invitation_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING token_hash",
    )
    .bind(invitation_id.as_uuid())
    .bind(now)
    .fetch_all(&mut **tx)
    .await?;
    for hash in hashes {
        sqlx::query(
            r#"UPDATE auth_delivery_intent
               SET status = 'cancelled', outcome_kind = 'cancelled', outcome_code = 'community_invitation_revoked',
                   next_attempt_at = NULL, delivered_at = NULL, last_error = 'community_invitation_revoked',
                   provider_receipt_id = NULL, claim_token = NULL, claim_expires_at = NULL,
                   credential_envelope = NULL, updated_at = $2
               WHERE credential_hash = $1 AND status IN ('queued', 'retryable_failed', 'processing')"#,
        )
        .bind(hash)
        .bind(now)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn insert_stewardship_audit(
    tx: &mut Transaction<'_, Postgres>,
    actor_principal_id: PrincipalId,
    membership_id: MembershipId,
    event_kind: &str,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"INSERT INTO identity_lifecycle_audit
           (event_at, event_kind, actor_principal_id, principal_id, token_hash, related_token_hash, metadata)
           VALUES ($1, $2, $3, $3, NULL, NULL, $4::JSONB)"#,
    )
    .bind(now)
    .bind(event_kind)
    .bind(actor_principal_id.as_uuid())
    .bind(serde_json::json!({ "membership_id": membership_id }).to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn append_invitation_events(
    tx: &mut Transaction<'_, Postgres>,
    invitation_id: InvitationId,
    events: &[InvitationEvent],
    now: i64,
) -> Result<(), MembershipApplicationError> {
    append_invitation_events_expected(tx, invitation_id, 0, events, now).await
}

async fn append_invitation_events_expected(
    tx: &mut Transaction<'_, Postgres>,
    invitation_id: InvitationId,
    expected_revision: i64,
    events: &[InvitationEvent],
    now: i64,
) -> Result<(), MembershipApplicationError> {
    let inputs = events
        .iter()
        .map(|event| EventInput::new(event.kind(), 1, event.payload(), ActorId::System, now))
        .collect::<Vec<_>>();
    let stored =
        eventstore::append_expected_in_tx(tx, invitation_id.as_uuid(), expected_revision, &inputs)
            .await?;
    for (event, stored) in events.iter().zip(stored.iter()) {
        match event {
            InvitationEvent::Issued {
                sponsoring_membership_id,
                target_index,
                expires_at,
            } => {
                sqlx::query(
                    r#"
                    INSERT INTO community_invitation (
                        invitation_id, sponsoring_membership_id, target_index,
                        expires_at, status, admitted_membership_id, created_at,
                        updated_at, revision
                    )
                    VALUES ($1, $2, $3, $4, 'issued', NULL, $5, $5, $6)
                    "#,
                )
                .bind(invitation_id.as_uuid())
                .bind(sponsoring_membership_id.as_uuid())
                .bind(target_index)
                .bind(expires_at)
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
            }
            InvitationEvent::Accepted {
                admitted_membership_id,
            } => {
                let updated = sqlx::query(
                    r#"
                    UPDATE community_invitation
                    SET status = 'accepted', admitted_membership_id = $2,
                        updated_at = $3, revision = $4
                    WHERE invitation_id = $1 AND status = 'issued'
                    "#,
                )
                .bind(invitation_id.as_uuid())
                .bind(admitted_membership_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
                if updated.rows_affected() != 1 {
                    return Err(MembershipApplicationError::Unavailable);
                }
            }
            InvitationEvent::Revoked => {
                sqlx::query(
                    "UPDATE community_invitation SET status = 'revoked', updated_at = $2, revision = $3 WHERE invitation_id = $1 AND status = 'issued'",
                )
                .bind(invitation_id.as_uuid())
                .bind(now)
                .bind(stored.stream_seq)
                .execute(&mut **tx)
                .await?;
            }
        }
    }
    Ok(())
}

async fn load_membership_for_principal(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: PrincipalId,
) -> Result<Option<MembershipState>, MembershipApplicationError> {
    let row = sqlx::query(
        "SELECT membership_id, status, origin_kind, admission_invitation_id, sponsoring_membership_id, revision FROM community_membership WHERE active_principal_id = $1 FOR UPDATE",
    )
        .bind(principal_id.as_uuid())
        .fetch_optional(&mut **tx)
        .await?;
    row.map(|row| {
        let membership_id = MembershipId::from_uuid(row.try_get("membership_id")?);
        Ok(MembershipState {
            membership_id,
            status: membership_status(row.try_get::<String, _>("status")?.as_str())?,
            origin: membership_origin(
                row.try_get::<String, _>("origin_kind")?.as_str(),
                row.try_get("admission_invitation_id")?,
                row.try_get("sponsoring_membership_id")?,
            )?,
            revision: row.try_get("revision")?,
        })
    })
    .transpose()
}

async fn load_membership_by_id(
    tx: &mut Transaction<'_, Postgres>,
    membership_id: MembershipId,
) -> Result<Option<MembershipState>, MembershipApplicationError> {
    let row = sqlx::query(
        "SELECT membership_id, status, origin_kind, admission_invitation_id, sponsoring_membership_id, revision FROM community_membership WHERE membership_id = $1 FOR UPDATE",
    )
    .bind(membership_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(MembershipState {
            membership_id: MembershipId::from_uuid(row.try_get("membership_id")?),
            status: membership_status(row.try_get::<String, _>("status")?.as_str())?,
            origin: membership_origin(
                row.try_get::<String, _>("origin_kind")?.as_str(),
                row.try_get("admission_invitation_id")?,
                row.try_get("sponsoring_membership_id")?,
            )?,
            revision: row.try_get("revision")?,
        })
    })
    .transpose()
}

fn membership_origin(
    kind: &str,
    invitation_id: Option<Uuid>,
    sponsor_id: Option<Uuid>,
) -> Result<MembershipOrigin, MembershipApplicationError> {
    match (kind, invitation_id, sponsor_id) {
        ("founder", None, None) => Ok(MembershipOrigin::Founder),
        ("invitation", Some(invitation_id), Some(sponsor_id)) => Ok(MembershipOrigin::Invitation {
            invitation_id: InvitationId::from_uuid(invitation_id),
            sponsoring_membership_id: MembershipId::from_uuid(sponsor_id),
        }),
        _ => Err(MembershipApplicationError::InvalidState(
            "membership origin projection is malformed".to_string(),
        )),
    }
}

fn membership_status(value: &str) -> Result<MembershipStatus, MembershipApplicationError> {
    match value {
        "active" => Ok(MembershipStatus::Active),
        "suspended" => Ok(MembershipStatus::Suspended),
        "withdrawn" => Ok(MembershipStatus::Withdrawn),
        "redacted" => Ok(MembershipStatus::Redacted),
        other => Err(MembershipApplicationError::InvalidState(format!(
            "unknown membership status {other}"
        ))),
    }
}

fn invitation_status(value: &str) -> Result<InvitationStatus, MembershipApplicationError> {
    match value {
        "issued" => Ok(InvitationStatus::Issued),
        "accepted" => Ok(InvitationStatus::Accepted),
        "revoked" => Ok(InvitationStatus::Revoked),
        other => Err(MembershipApplicationError::InvalidState(format!(
            "unknown invitation status {other}"
        ))),
    }
}

fn normalize_target(value: &str) -> Result<String, MembershipApplicationError> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty() || value.len() > 320 || value.chars().any(char::is_whitespace) {
        return Err(MembershipApplicationError::Unavailable);
    }
    let Some((local, domain)) = value.rsplit_once('@') else {
        return Err(MembershipApplicationError::Unavailable);
    };
    if local.is_empty() || domain.is_empty() || !domain.contains('.') {
        return Err(MembershipApplicationError::Unavailable);
    }
    Ok(value)
}

fn random_invitation_credential() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    format!(
        "fmci_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

pub fn hash_credential(value: &str) -> String {
    hex(Sha256::digest(value.as_bytes()).as_slice())
}

#[allow(clippy::too_many_arguments)]
async fn insert_admission_audit(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: PrincipalId,
    membership_id: MembershipId,
    invitation_id: InvitationId,
    sponsoring_membership_id: MembershipId,
    session_hash: &str,
    now: i64,
    method_kind: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at, event_kind, actor_principal_id, principal_id,
            token_hash, related_token_hash, metadata
        )
        VALUES ($1, 'community_member_admitted', $2, $2, $3, NULL, $4::JSONB)
        "#,
    )
    .bind(now)
    .bind(principal_id.as_uuid())
    .bind(session_hash)
    .bind(
        serde_json::json!({
            "membership_id": membership_id,
            "invitation_id": invitation_id,
            "sponsoring_membership_id": sponsoring_membership_id,
            "method_kind": method_kind,
        })
        .to_string(),
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}
