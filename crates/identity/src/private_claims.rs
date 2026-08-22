//! Application-facing helpers for subject-scoped private claims.
//!
//! These routines own the database transaction protocol around a private
//! claim: an active principal owns one active subject, claim issuance locks
//! that subject, and sealed payloads never enter an event stream.  They live
//! in `identity` rather than a projection so application services can prepare
//! canonical events without making a read-model crate an authority boundary.

use crate::{
    active_subject_key_store, open_subject_claim, seal_subject_claim, ClaimId, PrincipalId,
    SubjectClaimEnvelope, SubjectId, SubjectPrivacyError,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PrivateClaimError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Privacy(#[from] SubjectPrivacyError),
    #[error("private claim payload is invalid: {0}")]
    Payload(#[from] serde_json::Error),
    #[error("private claims require an existing active principal")]
    PrincipalUnavailable,
    #[error("an inactive subject cannot acquire or open private claims")]
    SubjectUnavailable,
    #[error("canonical event references an invalid private claim")]
    ClaimUnavailable,
}

/// The stable authenticated principal that owns this live subject.  This takes
/// the same principal-then-subject lock order as erasure, preventing a claim
/// write from racing an identity teardown.
async fn lock_active_subject(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subject_id: SubjectId,
) -> Result<(), PrivateClaimError> {
    let principal_id: Uuid = sqlx::query_scalar::<_, Option<Uuid>>(
        "SELECT principal_id FROM privacy_subject WHERE subject_id = $1",
    )
    .bind(subject_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .flatten()
    .ok_or(PrivateClaimError::SubjectUnavailable)?;
    let principal_status: String = sqlx::query_scalar(
        "SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(PrivateClaimError::PrincipalUnavailable)?;
    let row = sqlx::query(
        r#"
        SELECT subject.principal_id, subject.lifecycle_state,
               EXISTS (
                   SELECT 1 FROM subject_tombstone AS tombstone
                   WHERE tombstone.subject_id = subject.subject_id
               ) AS tombstoned
        FROM privacy_subject AS subject
        WHERE subject.subject_id = $1
        FOR UPDATE OF subject
        "#,
    )
    .bind(subject_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(PrivateClaimError::SubjectUnavailable)?;
    let locked_principal_id: Option<Uuid> = row.try_get("principal_id")?;
    let lifecycle_state: String = row.try_get("lifecycle_state")?;
    let tombstoned: bool = row.try_get("tombstoned")?;
    if locked_principal_id != Some(principal_id)
        || lifecycle_state != "active"
        || principal_status != "active"
        || tombstoned
    {
        return Err(PrivateClaimError::SubjectUnavailable);
    }
    Ok(())
}

/// Return the active privacy subject for a principal, creating it and its key
/// atomically with the new binding when needed.
pub async fn ensure_active_subject(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_id: PrincipalId,
    created_at: i64,
) -> Result<SubjectId, PrivateClaimError> {
    let principal_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    if principal_status.as_deref() != Some("active") {
        return Err(PrivateClaimError::PrincipalUnavailable);
    }
    if let Some(subject_id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT subject_id FROM privacy_subject WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?
    {
        let subject_id = SubjectId::from_uuid(subject_id);
        lock_active_subject(tx, subject_id).await?;
        return Ok(subject_id);
    }

    let candidate = SubjectId::random();
    let key_store = active_subject_key_store().await?;
    key_store.create(candidate).await?;
    let inserted = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO privacy_subject (subject_id, principal_id, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (principal_id) DO NOTHING
        RETURNING subject_id
        "#,
    )
    .bind(candidate.as_uuid())
    .bind(principal_id.as_uuid())
    .bind(created_at)
    .fetch_optional(&mut **tx)
    .await?;
    if inserted.is_some() {
        return Ok(candidate);
    }

    // A concurrent writer won the subject binding. Its key is authoritative;
    // remove the unattached key we created before joining that subject.
    key_store.destroy(candidate).await?;
    let subject_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT subject_id FROM privacy_subject WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .fetch_one(&mut **tx)
    .await?;
    let subject_id = SubjectId::from_uuid(subject_id);
    lock_active_subject(tx, subject_id).await?;
    Ok(subject_id)
}

/// Seal and persist one append-only private claim under an active subject.
pub async fn insert_subject_claim<T: Serialize>(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subject_id: SubjectId,
    claim_kind: &str,
    scope_id: Uuid,
    scope_key: Option<&str>,
    created_at: i64,
    claim: &T,
) -> Result<ClaimId, PrivateClaimError> {
    lock_active_subject(tx, subject_id).await?;
    let claim_id = ClaimId::random();
    let scope = subject_claim_aad_scope(scope_id, scope_key);
    let key_store = active_subject_key_store().await?;
    let envelope = seal_subject_claim(
        key_store.as_ref(),
        subject_id,
        claim_id,
        claim_kind,
        scope.as_str(),
        claim,
    )
    .await?;
    let envelope = serde_json::to_value(envelope)?;
    sqlx::query(
        r#"
        INSERT INTO subject_private_claim
            (claim_id, subject_id, claim_kind, scope_id, scope_key, envelope, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(claim_id.as_uuid())
    .bind(subject_id.as_uuid())
    .bind(claim_kind)
    .bind(scope_id)
    .bind(scope_key)
    .bind(envelope)
    .bind(created_at)
    .execute(&mut **tx)
    .await?;
    Ok(claim_id)
}

/// Open the current private claim after rechecking the subject lifecycle.
pub async fn open_active_subject_claim<T: for<'de> Deserialize<'de>>(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subject_id: SubjectId,
    claim_id: ClaimId,
    claim_kind: &str,
    scope_id: Uuid,
    scope_key: Option<&str>,
) -> Result<T, PrivateClaimError> {
    lock_active_subject(tx, subject_id).await?;
    let envelope = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT envelope
        FROM subject_private_claim
        WHERE claim_id = $1 AND subject_id = $2 AND claim_kind = $3 AND scope_id = $4
          AND scope_key IS NOT DISTINCT FROM $5
        "#,
    )
    .bind(claim_id.as_uuid())
    .bind(subject_id.as_uuid())
    .bind(claim_kind)
    .bind(scope_id)
    .bind(scope_key)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(PrivateClaimError::ClaimUnavailable)?;
    let envelope: SubjectClaimEnvelope = serde_json::from_value(envelope)?;
    let scope = subject_claim_aad_scope(scope_id, scope_key);
    let key_store = active_subject_key_store().await?;
    Ok(open_subject_claim(
        key_store.as_ref(),
        subject_id,
        claim_id,
        claim_kind,
        scope.as_str(),
        &envelope,
    )
    .await?)
}

/// The authenticated-data scope shared by claim issue/open operations.
pub fn subject_claim_aad_scope(scope_id: Uuid, scope_key: Option<&str>) -> String {
    match scope_key {
        Some(scope_key) => format!("{scope_id}/{scope_key}"),
        None => scope_id.to_string(),
    }
}
