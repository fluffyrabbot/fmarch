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
    let row = sqlx::query(
        "SELECT sponsoring_membership_id, target_index, expires_at, status, admitted_membership_id, revision FROM community_invitation WHERE invitation_id = $1 FOR UPDATE",
    )
    .bind(invitation_id.as_uuid())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(MembershipApplicationError::Unavailable)?;
    let owner = MembershipId::from_uuid(row.try_get("sponsoring_membership_id")?);
    if owner != sponsor.membership_id {
        return Err(MembershipApplicationError::Unavailable);
    }
    let invitation = InvitationState {
        invitation_id,
        sponsoring_membership_id: owner,
        target_index: row.try_get("target_index")?,
        expires_at: row.try_get("expires_at")?,
        status: invitation_status(row.try_get::<String, _>("status")?.as_str())?,
        admitted_membership_id: row
            .try_get::<Option<Uuid>, _>("admitted_membership_id")?
            .map(MembershipId::from_uuid),
        revision: row.try_get("revision")?,
    };
    let events = decide_invitation(Some(&invitation), Some(&sponsor), InvitationCommand::Revoke)?;
    append_invitation_events_expected(&mut tx, invitation_id, invitation.revision, &events, now)
        .await?;
    sqlx::query(
        "UPDATE community_invitation_credential SET revoked_at = $2 WHERE invitation_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL",
    )
    .bind(invitation_id.as_uuid())
    .bind(now)
    .execute(&mut *tx)
    .await?;
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
    let inputs = events
        .iter()
        .map(|event| EventInput::new(event.kind(), 1, event.payload(), ActorId::System, now))
        .collect::<Vec<_>>();
    let stored = eventstore::append_expected_in_tx(tx, membership_id.as_uuid(), 0, &inputs).await?;
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
            _ => {
                return Err(MembershipApplicationError::InvalidState(
                    "lifecycle projection is not implemented for this command boundary".to_string(),
                ));
            }
        }
    }
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
