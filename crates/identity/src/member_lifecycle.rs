//! Durable member lifecycle stream, handler, and deterministic projection fold.

use crate::session::revoke_sessions_for_principal;
use crate::subject_privacy::SubjectErasureWork;
use crate::{
    decide_member_lifecycle, ClaimId, IdentityFlowError, MemberLifecycleCommand,
    MemberLifecycleEvent, MemberLifecycleState, MemberLifecycleStatus, PrincipalId,
    SubjectClaimEnvelope, SubjectId, SubjectKeyStore,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const PERSONAL_EXPORT_TTL_SECONDS: i64 = 60 * 60 * 24 * 14;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberLifecycleSnapshot {
    pub principal_id: PrincipalId,
    pub status: MemberLifecycleStatus,
    pub last_seq: i64,
    pub pseudonym: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersonalExport {
    pub export_id: String,
    pub principal_id: PrincipalId,
    pub requested_at: i64,
    pub expires_at: i64,
    pub artifact: serde_json::Value,
}

/// Apply one user-visible transition. This is the narrow command handler used
/// by deactivation; the direct erasure flow is intentionally orchestrated by
/// [`erase_member`] because revoking the current session makes two HTTP calls
/// impossible to complete safely.
pub async fn apply_member_lifecycle(
    pool: &PgPool,
    principal_id: &PrincipalId,
    command: MemberLifecycleCommand,
    now: i64,
) -> Result<MemberLifecycleStatus, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::ensure_principal(&mut tx, principal_id, &[], now).await?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?
    .require_active()?;
    let snapshot = locked_snapshot(&mut tx, principal_id).await?;
    let events = decide_member_lifecycle(
        &MemberLifecycleState {
            status: snapshot.status,
        },
        command,
    )
    .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?;
    let next =
        append_and_project(&mut tx, principal_id, snapshot, &events, now, None, None).await?;
    if next != MemberLifecycleStatus::Active {
        revoke_sessions_for_principal(&mut tx, principal_id, now).await?;
    }
    tx.commit().await?;
    Ok(next)
}

/// Commit the authentication cutoff and immutable erasure outbox, then run one
/// inline worker attempt for the current HTTP contract. A failed authority call
/// leaves a durable `erasure_in_progress` aggregate for startup/background
/// resumption; it never rolls the security cutoff back.
pub async fn erase_member(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let key_store = crate::active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let (pending, work) =
        request_member_erasure_with_store(pool, key_store.as_ref(), principal_id, now).await?;
    let worker_id = format!("inline-{}", Uuid::new_v4().simple());
    let processed = crate::subject_privacy::process_subject_erasure_with_store(
        pool,
        key_store.as_ref(),
        work.erasure_id,
        &worker_id,
        now,
    )
    .await
    .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    if !processed {
        return Ok(pending);
    }
    member_lifecycle_snapshot(pool, principal_id).await
}

/// Step one of durable erasure: no object-authority call occurs after the
/// owner transaction begins. The random alias, fingerprint, and authority
/// identity are committed in a create-only outbox beside the immediate auth
/// cutoff and pending-presentation redaction.
pub async fn request_member_erasure(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let key_store = crate::active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    request_member_erasure_with_store(pool, key_store.as_ref(), principal_id, now)
        .await
        .map(|(snapshot, _)| snapshot)
}

pub async fn request_member_erasure_with_store(
    pool: &PgPool,
    key_store: &dyn SubjectKeyStore,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<(MemberLifecycleSnapshot, SubjectErasureWork), IdentityFlowError> {
    if let Some(existing) =
        crate::subject_privacy::load_subject_erasure_work_by_principal(pool, principal_id)
            .await
            .map_err(|error| IdentityFlowError::Internal(error.to_string()))?
    {
        return Ok((
            member_lifecycle_snapshot(pool, principal_id).await?,
            existing,
        ));
    }

    // Discover and fingerprint before the owner transaction. Subject keys are
    // immutable; the transaction revalidates the exact subject and immutable
    // database authority tuple before persisting this fingerprint.
    let discovered_subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(principal_id.as_uuid())
            .fetch_optional(pool)
            .await?
            .ok_or(IdentityFlowError::Unauthorized)?;
    let subject_id = SubjectId::from_uuid(discovered_subject_id);
    let key_fingerprint_sha256 = key_store
        .fingerprint(subject_id)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let authority_before = authority_binding(pool).await?;
    let work = SubjectErasureWork {
        erasure_id: Uuid::new_v4(),
        principal_id: *principal_id,
        record: crate::SubjectRevocationRecord {
            subject_id,
            replacement_alias: crate::random_tombstone_alias(),
            destroyed_at: now,
            key_fingerprint_sha256,
            receipt_id: Uuid::new_v4(),
        },
        authority_id: authority_before.as_ref().map(|binding| binding.0),
        authority_revision: authority_before.as_ref().map(|binding| binding.1.clone()),
        authority_manifest_sha256: authority_before.as_ref().map(|binding| binding.2.clone()),
        requested_at: now,
    };

    let mut tx = pool.begin().await?;
    profile_handle_index::acquire_profile_handle_index_writer_lease(&mut tx)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        principal_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?;
    if let Some(existing) = load_subject_erasure_work_in_tx(&mut tx, principal_id).await? {
        let snapshot = locked_snapshot(&mut tx, principal_id).await?;
        tx.commit().await?;
        return Ok((snapshot, existing));
    }
    owner.require_active()?;
    if owner.subject_id != discovered_subject_id
        || authority_binding_in_tx(&mut tx).await? != authority_before
    {
        return Err(IdentityFlowError::Invalid(
            "subject or authority changed while erasure was requested".to_string(),
        ));
    }
    let snapshot = locked_snapshot(&mut tx, principal_id).await?;
    let mut events = Vec::new();
    let mut state = snapshot.status;
    if state == MemberLifecycleStatus::Active {
        let deactivated = decide_member_lifecycle(
            &MemberLifecycleState { status: state },
            MemberLifecycleCommand::Deactivate {
                reason: "member_requested_erasure".to_string(),
            },
        )
        .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?;
        state = MemberLifecycleStatus::Deactivated;
        events.extend(deactivated);
    }
    let requested = decide_member_lifecycle(
        &MemberLifecycleState { status: state },
        MemberLifecycleCommand::RequestErasure,
    )
    .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?;
    events.extend(requested);
    let next = append_and_project(
        &mut tx,
        principal_id,
        snapshot.clone(),
        &events,
        now,
        Some(work.record.replacement_alias.as_str()),
        Some(subject_id),
    )
    .await?;
    sqlx::query(
        "UPDATE privacy_subject SET lifecycle_state = 'erasure_pending' WHERE subject_id = $1 AND lifecycle_state = 'active'",
    )
    .bind(subject_id.as_uuid())
    .execute(&mut *tx)
    .await?;
    insert_subject_erasure_work(&mut tx, &work).await?;
    revoke_sessions_for_principal(&mut tx, principal_id, now).await?;
    disable_auth_for_erasure(&mut tx, principal_id, work.erasure_id, now).await?;
    apply_retained_authorship_redaction(&mut tx, principal_id, &work.record.replacement_alias, now)
        .await?;
    tx.commit().await?;
    Ok((
        MemberLifecycleSnapshot {
            principal_id: *principal_id,
            status: next,
            last_seq: snapshot.last_seq + events.len() as i64,
            pseudonym: Some(work.record.replacement_alias.clone()),
        },
        work,
    ))
}

type AuthorityBinding = (Uuid, String, String);

async fn authority_binding(pool: &PgPool) -> Result<Option<AuthorityBinding>, IdentityFlowError> {
    Ok(sqlx::query_as(
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
    )
    .fetch_optional(pool)
    .await?)
}

async fn authority_binding_in_tx(
    tx: &mut Transaction<'_, Postgres>,
) -> Result<Option<AuthorityBinding>, IdentityFlowError> {
    Ok(sqlx::query_as(
        "SELECT authority_id, authority_revision, manifest_sha256 FROM subject_authority_binding WHERE singleton = TRUE",
    )
    .fetch_optional(&mut **tx)
    .await?)
}

async fn load_subject_erasure_work_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
) -> Result<Option<SubjectErasureWork>, IdentityFlowError> {
    let row = sqlx::query(
        r#"
        SELECT erasure_id, subject_id, principal_id, receipt_id,
               replacement_alias, key_fingerprint_sha256, requested_at,
               authority_id, authority_revision, authority_manifest_sha256
        FROM subject_erasure_outbox
        WHERE principal_id = $1
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(SubjectErasureWork {
            erasure_id: row.try_get("erasure_id")?,
            principal_id: PrincipalId::from_uuid(row.try_get("principal_id")?),
            record: crate::SubjectRevocationRecord {
                subject_id: SubjectId::from_uuid(row.try_get("subject_id")?),
                replacement_alias: row.try_get("replacement_alias")?,
                destroyed_at: row.try_get("requested_at")?,
                key_fingerprint_sha256: row.try_get("key_fingerprint_sha256")?,
                receipt_id: row.try_get("receipt_id")?,
            },
            authority_id: row.try_get("authority_id")?,
            authority_revision: row.try_get("authority_revision")?,
            authority_manifest_sha256: row.try_get("authority_manifest_sha256")?,
            requested_at: row.try_get("requested_at")?,
        })
    })
    .transpose()
}

async fn insert_subject_erasure_work(
    tx: &mut Transaction<'_, Postgres>,
    work: &SubjectErasureWork,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        INSERT INTO subject_erasure_outbox
            (erasure_id, subject_id, principal_id, receipt_id,
             replacement_alias, key_fingerprint_sha256, requested_at,
             authority_id, authority_revision, authority_manifest_sha256)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        "#,
    )
    .bind(work.erasure_id)
    .bind(work.record.subject_id.as_uuid())
    .bind(work.principal_id.as_uuid())
    .bind(work.record.receipt_id)
    .bind(&work.record.replacement_alias)
    .bind(&work.record.key_fingerprint_sha256)
    .bind(work.requested_at)
    .bind(work.authority_id)
    .bind(work.authority_revision.as_deref())
    .bind(work.authority_manifest_sha256.as_deref())
    .execute(&mut **tx)
    .await?;
    sqlx::query("INSERT INTO subject_erasure (erasure_id) VALUES ($1)")
        .bind(work.erasure_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn disable_auth_for_erasure(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
    erasure_id: Uuid,
    now: i64,
) -> Result<(), IdentityFlowError> {
    sqlx::query("UPDATE authentication_method SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2) WHERE principal_id = $1")
        .bind(principal_id.as_uuid()).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_account SET disabled_at = COALESCE(disabled_at, $2), password_hash = $3, global_capabilities = '{}'::text[] WHERE principal_id = $1")
        .bind(principal_id.as_uuid()).bind(now).bind(format!("erasure-pending:{erasure_id}")).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_account_recovery_credential SET revoked_at = COALESCE(revoked_at, $2) WHERE account_id IN (SELECT account_id FROM auth_account WHERE principal_id = $1) AND used_at IS NULL")
        .bind(principal_id.as_uuid()).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE game_invitation SET revoked_at = COALESCE(revoked_at, $2) WHERE principal_id = $1 AND redeemed_at IS NULL")
        .bind(principal_id.as_uuid()).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_delivery_intent SET status = 'cancelled', outcome_kind = 'cancelled', outcome_code = 'member_erasure_pending', next_attempt_at = NULL, delivered_at = NULL, provider_receipt_id = NULL, claim_token = NULL, claim_expires_at = NULL, credential_envelope = NULL, updated_at = $2 WHERE principal_id = $1 AND status IN ('queued', 'processing', 'retryable_failed')")
        .bind(principal_id.as_uuid()).bind(now).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM auth_websocket_ticket WHERE principal_id = $1")
        .bind(principal_id.as_uuid())
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2), global_capabilities = '{}'::text[] WHERE principal_id = $1")
        .bind(principal_id.as_uuid()).bind(now).execute(&mut **tx).await?;
    Ok(())
}

async fn member_lifecycle_snapshot(
    pool: &PgPool,
    principal_id: &PrincipalId,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let row = sqlx::query(
        "SELECT status, last_seq, pseudonym FROM member_lifecycle_projection WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| IdentityFlowError::Invalid("member lifecycle projection is missing".into()))?;
    Ok(MemberLifecycleSnapshot {
        principal_id: *principal_id,
        status: MemberLifecycleStatus::parse(row.try_get::<String, _>("status")?.as_str())
            .ok_or_else(|| IdentityFlowError::Invalid("unknown lifecycle status".into()))?,
        last_seq: row.try_get("last_seq")?,
        pseudonym: row.try_get("pseudonym")?,
    })
}

pub(crate) async fn recover_member_erasure_from_revocation(
    pool: &PgPool,
    record: &crate::SubjectRevocationRecord,
) -> Result<SubjectErasureWork, IdentityFlowError> {
    if let Some(existing) = crate::subject_privacy::load_subject_erasure_work_by_principal(
        pool,
        &crate::subject_privacy::discover_revoked_subject_owner(pool, record.subject_id)
            .await
            .map_err(|error| IdentityFlowError::Internal(error.to_string()))?,
    )
    .await
    .map_err(|error| IdentityFlowError::Internal(error.to_string()))?
    {
        return Ok(existing);
    }
    let principal_id =
        crate::subject_privacy::discover_revoked_subject_owner(pool, record.subject_id)
            .await
            .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let authority = authority_binding(pool).await?;
    let work = SubjectErasureWork {
        erasure_id: Uuid::new_v4(),
        principal_id,
        record: record.clone(),
        authority_id: authority.as_ref().map(|binding| binding.0),
        authority_revision: authority.as_ref().map(|binding| binding.1.clone()),
        authority_manifest_sha256: authority.as_ref().map(|binding| binding.2.clone()),
        requested_at: record.destroyed_at,
    };
    let mut tx = pool.begin().await?;
    profile_handle_index::acquire_profile_handle_index_writer_lease(&mut tx)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        &principal_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?;
    if owner.subject_id != record.subject_id.as_uuid() {
        return Err(IdentityFlowError::Invalid(
            "external revocation owner changed during restore recovery".to_string(),
        ));
    }
    if let Some(existing) = load_subject_erasure_work_in_tx(&mut tx, &principal_id).await? {
        tx.commit().await?;
        return Ok(existing);
    }
    let snapshot = locked_snapshot(&mut tx, &principal_id).await?;
    let mut events = Vec::new();
    let mut state = snapshot.status;
    if state == MemberLifecycleStatus::Active {
        events.extend(
            decide_member_lifecycle(
                &MemberLifecycleState { status: state },
                MemberLifecycleCommand::Deactivate {
                    reason: "external_revocation_recovery".to_string(),
                },
            )
            .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?,
        );
        state = MemberLifecycleStatus::Deactivated;
    }
    if state == MemberLifecycleStatus::Deactivated {
        events.extend(
            decide_member_lifecycle(
                &MemberLifecycleState { status: state },
                MemberLifecycleCommand::RequestErasure,
            )
            .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?,
        );
    }
    if !events.is_empty() {
        append_and_project(
            &mut tx,
            &principal_id,
            snapshot,
            &events,
            record.destroyed_at,
            Some(&record.replacement_alias),
            Some(record.subject_id),
        )
        .await?;
    } else {
        sqlx::query("UPDATE member_lifecycle_projection SET pseudonym = COALESCE(pseudonym, $2), subject_id = COALESCE(subject_id, $3) WHERE principal_id = $1")
            .bind(principal_id.as_uuid()).bind(&record.replacement_alias).bind(record.subject_id.as_uuid()).execute(&mut *tx).await?;
    }
    if owner.subject_lifecycle_state == "active" {
        sqlx::query(
            "UPDATE privacy_subject SET lifecycle_state = 'erasure_pending' WHERE subject_id = $1",
        )
        .bind(record.subject_id.as_uuid())
        .execute(&mut *tx)
        .await?;
    }
    insert_subject_erasure_work(&mut tx, &work).await?;
    revoke_sessions_for_principal(&mut tx, &principal_id, record.destroyed_at).await?;
    disable_auth_for_erasure(&mut tx, &principal_id, work.erasure_id, record.destroyed_at).await?;
    apply_retained_authorship_redaction(
        &mut tx,
        &principal_id,
        &record.replacement_alias,
        record.destroyed_at,
    )
    .await?;
    tx.commit().await?;
    Ok(work)
}

/// Assemble the subject-scoped export before erasure. It intentionally omits
/// passwords, recovery tokens, session tokens, and raw provider credentials.
pub async fn create_personal_export(
    pool: &PgPool,
    principal_id: &PrincipalId,
    now: i64,
) -> Result<PersonalExport, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::ensure_principal(&mut tx, principal_id, &[], now).await?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?
    .require_active()?;
    let snapshot = locked_snapshot(&mut tx, principal_id).await?;
    if snapshot.status == MemberLifecycleStatus::Erased {
        return Err(IdentityFlowError::Invalid(
            "an erased member cannot create a personal export".to_string(),
        ));
    }
    let export_id = Uuid::new_v4();
    let expires_at = now.saturating_add(PERSONAL_EXPORT_TTL_SECONDS);
    let artifact = assemble_personal_export(&mut tx, principal_id).await?;
    let subject_id: Uuid = sqlx::query_scalar(
        "SELECT subject_id FROM privacy_subject WHERE principal_id = $1 AND lifecycle_state = 'active' FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_one(&mut *tx)
    .await?;
    let subject_id = SubjectId::from_uuid(subject_id);
    let key_store = crate::active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let envelope = crate::seal_subject_claim(
        key_store.as_ref(),
        subject_id,
        ClaimId::from_uuid(export_id),
        "personal_export",
        &export_id.to_string(),
        &artifact,
    )
    .await
    .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let envelope = serde_json::to_value(envelope)
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let events = [MemberLifecycleEvent::PersonalExportRecorded];
    let next = append_and_project(
        &mut tx,
        principal_id,
        snapshot.clone(),
        &events,
        now,
        None,
        None,
    )
    .await?;
    sqlx::query(
        "INSERT INTO member_personal_export (export_id, principal_id, requested_at, expires_at, envelope, recorded_seq, subject_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(export_id)
    .bind(principal_id.as_uuid())
    .bind(now)
    .bind(expires_at)
    .bind(envelope)
    .bind(snapshot.last_seq + 1)
    .bind(subject_id.as_uuid())
    .execute(&mut *tx)
    .await?;
    debug_assert_eq!(next, snapshot.status);
    tx.commit().await?;
    Ok(PersonalExport {
        export_id: export_id.to_string(),
        principal_id: *principal_id,
        requested_at: now,
        expires_at,
        artifact,
    })
}

pub async fn load_personal_export(
    pool: &PgPool,
    principal_id: &PrincipalId,
    export_id: Uuid,
    now: i64,
) -> Result<Option<PersonalExport>, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    let principal_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM platform_principal WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut *tx)
    .await?;
    if principal_status.as_deref() != Some("active") {
        return Err(IdentityFlowError::Unauthorized);
    }
    let row = sqlx::query(
        r#"
        SELECT export.requested_at, export.expires_at, export.envelope, export.subject_id
        FROM member_personal_export AS export
        JOIN privacy_subject AS subject
          ON subject.subject_id = export.subject_id
         AND subject.principal_id = $2
         AND subject.lifecycle_state = 'active'
        WHERE export.export_id = $1
          AND export.principal_id = $2
          AND export.expires_at > $3
        FOR UPDATE OF subject
        "#,
    )
    .bind(export_id)
    .bind(principal_id.as_uuid())
    .bind(now)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        tx.commit().await?;
        return Ok(None);
    };
    let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
    let envelope: SubjectClaimEnvelope = serde_json::from_value(row.try_get("envelope")?)
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let key_store = crate::active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let artifact = crate::open_subject_claim(
        key_store.as_ref(),
        subject_id,
        ClaimId::from_uuid(export_id),
        "personal_export",
        &export_id.to_string(),
        &envelope,
    )
    .await
    .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let export = PersonalExport {
        export_id: export_id.to_string(),
        principal_id: *principal_id,
        requested_at: row.try_get("requested_at")?,
        expires_at: row.try_get("expires_at")?,
        artifact,
    };
    tx.commit().await?;
    Ok(Some(export))
}

/// Re-fold the lifecycle event stream into its projection. This deliberately
/// owns no destructive side effects: rebuild restores a read model, while the
/// append handler is the only authority that erases credentials/identifiers.
pub async fn rebuild_member_lifecycle(
    pool: &PgPool,
    principal_id: &PrincipalId,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    profile_handle_index::acquire_profile_handle_index_writer_lease(&mut tx)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?;
    let rows = sqlx::query(
        "SELECT seq, kind, payload, occurred_at, subject_id FROM member_lifecycle_event WHERE principal_id = $1 ORDER BY seq",
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&mut *tx)
    .await?;
    let mut snapshot = MemberLifecycleSnapshot {
        principal_id: *principal_id,
        status: MemberLifecycleStatus::Active,
        last_seq: 0,
        pseudonym: None,
    };
    let mut subject_id: Option<SubjectId> = None;
    let mut timestamps = LifecycleTimestamps::default();
    for row in rows {
        let seq: i64 = row.try_get("seq")?;
        if seq != snapshot.last_seq + 1 {
            return Err(IdentityFlowError::Invalid(
                "member lifecycle stream has a non-contiguous sequence".to_string(),
            ));
        }
        let kind: String = row.try_get("kind")?;
        let occurred_at: i64 = row.try_get("occurred_at")?;
        if let Some(row_subject_id) = row.try_get::<Option<Uuid>, _>("subject_id")? {
            let row_subject_id = SubjectId::from_uuid(row_subject_id);
            if subject_id.is_some_and(|existing| existing != row_subject_id) {
                return Err(IdentityFlowError::Invalid(
                    "member lifecycle stream crosses privacy subjects".to_string(),
                ));
            }
            subject_id = Some(row_subject_id);
        }
        fold_kind(&mut snapshot, &mut timestamps, kind.as_str(), occurred_at)?;
        snapshot.last_seq = seq;
    }
    if matches!(
        snapshot.status,
        MemberLifecycleStatus::ErasureInProgress | MemberLifecycleStatus::Erased
    ) {
        let redacted_subject = subject_id.ok_or_else(|| {
            IdentityFlowError::Invalid(
                "erasing member lifecycle stream is missing its privacy subject".to_string(),
            )
        })?;
        snapshot.pseudonym = sqlx::query_scalar(
            r#"
            SELECT replacement_alias
            FROM (
                SELECT replacement_alias, 0 AS priority
                FROM subject_tombstone
                WHERE subject_id = $1
                UNION ALL
                SELECT replacement_alias, 1 AS priority
                FROM subject_erasure_outbox
                WHERE subject_id = $1
            ) AS presentation_tombstone
            ORDER BY priority
            LIMIT 1
            "#,
        )
        .bind(redacted_subject.as_uuid())
        .fetch_optional(&mut *tx)
        .await?;
        if snapshot.pseudonym.is_none() {
            return Err(IdentityFlowError::Invalid(
                "erasing member lifecycle stream is missing its durable redaction alias"
                    .to_string(),
            ));
        }
    }
    upsert_snapshot(&mut tx, &snapshot, timestamps, subject_id).await?;
    if let Some(pseudonym) = snapshot.pseudonym.as_deref() {
        apply_retained_authorship_redaction(&mut tx, principal_id, pseudonym, 0).await?;
    }
    tx.commit().await?;
    Ok(snapshot)
}

#[derive(Default)]
struct LifecycleTimestamps {
    deactivated_at: Option<i64>,
    erasure_requested_at: Option<i64>,
    credentials_erased_at: Option<i64>,
    authorship_pseudonymized_at: Option<i64>,
    personal_export_recorded_at: Option<i64>,
}

async fn locked_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let row = sqlx::query(
        "SELECT status, last_seq, pseudonym FROM member_lifecycle_projection WHERE principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    match row {
        Some(row) => Ok(MemberLifecycleSnapshot {
            principal_id: *principal_id,
            status: MemberLifecycleStatus::parse(row.try_get::<String, _>("status")?.as_str())
                .ok_or_else(|| IdentityFlowError::Invalid("unknown lifecycle status".into()))?,
            last_seq: row.try_get("last_seq")?,
            pseudonym: row.try_get("pseudonym")?,
        }),
        None => Ok(MemberLifecycleSnapshot {
            principal_id: *principal_id,
            status: MemberLifecycleStatus::Active,
            last_seq: 0,
            pseudonym: None,
        }),
    }
}

async fn append_and_project(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
    mut snapshot: MemberLifecycleSnapshot,
    events: &[MemberLifecycleEvent],
    now: i64,
    pseudonym: Option<&str>,
    subject_id: Option<SubjectId>,
) -> Result<MemberLifecycleStatus, IdentityFlowError> {
    let mut timestamps = LifecycleTimestamps::default();
    for event in events {
        snapshot.last_seq += 1;
        sqlx::query("INSERT INTO member_lifecycle_event (principal_id, seq, kind, payload, occurred_at, subject_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6)")
            .bind(principal_id.as_uuid())
            .bind(snapshot.last_seq)
            .bind(event.kind())
            .bind(event.payload().to_string())
            .bind(now)
            .bind(subject_id.map(SubjectId::as_uuid))
            .execute(&mut **tx)
            .await?;
        fold_kind(&mut snapshot, &mut timestamps, event.kind(), now)?;
    }
    if let Some(pseudonym) = pseudonym {
        snapshot.pseudonym = Some(pseudonym.to_string());
    }
    upsert_snapshot(tx, &snapshot, timestamps, subject_id).await?;
    Ok(snapshot.status)
}

fn fold_kind(
    snapshot: &mut MemberLifecycleSnapshot,
    timestamps: &mut LifecycleTimestamps,
    kind: &str,
    occurred_at: i64,
) -> Result<(), IdentityFlowError> {
    match kind {
        crate::MEMBER_DEACTIVATED => {
            snapshot.status = MemberLifecycleStatus::Deactivated;
            timestamps.deactivated_at.get_or_insert(occurred_at);
        }
        crate::MEMBER_ERASURE_REQUESTED => {
            snapshot.status = MemberLifecycleStatus::ErasureInProgress;
            timestamps.erasure_requested_at.get_or_insert(occurred_at);
        }
        crate::MEMBER_CREDENTIALS_ERASED => {
            timestamps.credentials_erased_at.get_or_insert(occurred_at);
        }
        crate::MEMBER_AUTHORSHIP_PSEUDONYMIZED => {
            snapshot.status = MemberLifecycleStatus::Erased;
            timestamps
                .authorship_pseudonymized_at
                .get_or_insert(occurred_at);
        }
        crate::MEMBER_PERSONAL_EXPORT_RECORDED => {
            timestamps
                .personal_export_recorded_at
                .get_or_insert(occurred_at);
        }
        _ => {
            return Err(IdentityFlowError::Invalid(
                "unknown member lifecycle event kind".to_string(),
            ))
        }
    }
    Ok(())
}

async fn upsert_snapshot(
    tx: &mut Transaction<'_, Postgres>,
    snapshot: &MemberLifecycleSnapshot,
    timestamps: LifecycleTimestamps,
    subject_id: Option<SubjectId>,
) -> Result<(), IdentityFlowError> {
    sqlx::query(
        r#"
        INSERT INTO member_lifecycle_projection
            (principal_id, status, last_seq, deactivated_at, erasure_requested_at,
             credentials_erased_at, authorship_pseudonymized_at,
             personal_export_recorded_at, pseudonym, subject_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (principal_id) DO UPDATE SET
            status = EXCLUDED.status,
            last_seq = EXCLUDED.last_seq,
            deactivated_at = COALESCE(member_lifecycle_projection.deactivated_at, EXCLUDED.deactivated_at),
            erasure_requested_at = COALESCE(member_lifecycle_projection.erasure_requested_at, EXCLUDED.erasure_requested_at),
            credentials_erased_at = COALESCE(member_lifecycle_projection.credentials_erased_at, EXCLUDED.credentials_erased_at),
            authorship_pseudonymized_at = COALESCE(member_lifecycle_projection.authorship_pseudonymized_at, EXCLUDED.authorship_pseudonymized_at),
            personal_export_recorded_at = COALESCE(member_lifecycle_projection.personal_export_recorded_at, EXCLUDED.personal_export_recorded_at),
            pseudonym = COALESCE(member_lifecycle_projection.pseudonym, EXCLUDED.pseudonym),
            subject_id = COALESCE(member_lifecycle_projection.subject_id, EXCLUDED.subject_id)
        "#,
    )
    .bind(snapshot.principal_id.as_uuid())
    .bind(snapshot.status.as_str())
    .bind(snapshot.last_seq)
    .bind(timestamps.deactivated_at)
    .bind(timestamps.erasure_requested_at)
    .bind(timestamps.credentials_erased_at)
    .bind(timestamps.authorship_pseudonymized_at)
    .bind(timestamps.personal_export_recorded_at)
    .bind(snapshot.pseudonym.as_deref())
    .bind(subject_id.map(SubjectId::as_uuid))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn assemble_personal_export(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
) -> Result<serde_json::Value, IdentityFlowError> {
    let account = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('account_id', account_id, 'created_at', created_at, 'disabled_at', disabled_at) ORDER BY account_id)::text FROM auth_account WHERE principal_id = $1",
        principal_id,
    )
    .await?;
    let methods = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'created_at', created_at, 'disabled_at', disabled_at) ORDER BY created_at, method_id)::text FROM authentication_method WHERE principal_id = $1",
        principal_id,
    )
    .await?;
    // A private profile is deliberately absent from the public projection.
    // Personal export is the owner-authorized path, so open its current sealed
    // claim instead of treating a read model as an authority for private data.
    let profiles = personal_profile_export(tx, principal_id).await?;
    let personas = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('game_id', persona.game_id, 'persona_id', persona.persona_id, 'registered_seq', persona.registered_seq) ORDER BY persona.game_id, persona.persona_id)::text FROM game_persona AS persona JOIN game_persona_subject_binding AS binding USING (game_id, persona_id) JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id WHERE subject.principal_id = $1 AND binding.lifecycle = 'active'",
        principal_id,
    )
    .await?;
    Ok(serde_json::json!({
        "schema_version": 1,
        "principal_id": principal_id,
        "accounts": account.unwrap_or_else(|| serde_json::json!([])),
        "authentication_methods": methods.unwrap_or_else(|| serde_json::json!([])),
        "profiles": profiles,
        "game_personas": personas.unwrap_or_else(|| serde_json::json!([])),
    }))
}

async fn personal_profile_export(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
) -> Result<serde_json::Value, IdentityFlowError> {
    let rows = sqlx::query(
        r#"
        SELECT profile_id, subject_id, current_claim_id
        FROM member_profile
        WHERE active_principal_id = $1 AND lifecycle = 'active'
        ORDER BY profile_id
        "#,
    )
    .bind(principal_id.as_uuid())
    .fetch_all(&mut **tx)
    .await?;
    let mut profiles = Vec::with_capacity(rows.len());
    for row in rows {
        let profile_id: Uuid = row.try_get("profile_id")?;
        let subject_id = SubjectId::from_uuid(row.try_get("subject_id")?);
        let claim_id = ClaimId::from_uuid(
            row.try_get::<Option<Uuid>, _>("current_claim_id")?
                .ok_or_else(|| {
                    IdentityFlowError::Internal(
                        "active profile is missing its current private claim".to_string(),
                    )
                })?,
        );
        let presentation: serde_json::Value =
            crate::open_active_subject_claim(tx, subject_id, claim_id, "profile", profile_id, None)
                .await
                .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
        let object = presentation.as_object().ok_or_else(|| {
            IdentityFlowError::Internal("profile private claim is not an object".to_string())
        })?;
        for field in ["handle", "display_name", "bio", "visibility"] {
            if !object.get(field).is_some_and(serde_json::Value::is_string) {
                return Err(IdentityFlowError::Internal(format!(
                    "profile private claim is missing string field {field}"
                )));
            }
        }
        profiles.push(serde_json::json!({
            "profile_id": profile_id,
            "handle": object["handle"],
            "display_name": object["display_name"],
            "bio": object["bio"],
            "visibility": object["visibility"],
        }));
    }
    Ok(serde_json::Value::Array(profiles))
}

async fn json_scalar(
    tx: &mut Transaction<'_, Postgres>,
    query: &'static str,
    principal_id: &PrincipalId,
) -> Result<Option<serde_json::Value>, IdentityFlowError> {
    let raw = sqlx::query_scalar::<_, Option<String>>(query)
        .bind(principal_id.as_uuid())
        .fetch_one(&mut **tx)
        .await?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|error| IdentityFlowError::Internal(error.to_string()))
    })
    .transpose()
}

/// Apply the retained-public-data overlay. Calling it after a projection rebuild
/// is safe and deterministic: it never touches immutable streams and every
/// update converges on the same externally journaled random pseudonym.
async fn apply_retained_authorship_redaction(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
    pseudonym: &str,
    redacted_at: i64,
) -> Result<(), IdentityFlowError> {
    redact_community_membership_in_tx(tx, principal_id, pseudonym, redacted_at).await?;
    // Public materialization is removed, not pseudonymized in place. Retained
    // attribution lives only on the redacted identity root; it cannot leak a
    // former private profile through a live public profile join.
    // Incoming relationship streams remain immutable, but their current
    // overlays terminate when the target identity is irreversibly erased.
    // Do this explicitly before redaction; no FK cascade owns domain meaning.
    sqlx::query("DELETE FROM profile_mute WHERE target_profile_id IN (SELECT profile_id FROM member_profile WHERE active_principal_id = $1 AND lifecycle = 'active')")
        .bind(principal_id.as_uuid()).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM public_profile WHERE profile_id IN (SELECT profile_id FROM member_profile WHERE active_principal_id = $1 AND lifecycle = 'active')")
        .bind(principal_id.as_uuid()).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM publication_surface WHERE surface_id IN (SELECT profile_id FROM member_profile WHERE active_principal_id = $1 AND lifecycle = 'active')")
        .bind(principal_id.as_uuid()).execute(&mut **tx).await?;
    sqlx::query("UPDATE member_profile SET active_principal_id = NULL, lifecycle = 'redacted', redacted_alias = $2, current_claim_id = NULL, handle_hmac = NULL WHERE active_principal_id = $1 AND lifecycle = 'active'")
        .bind(principal_id.as_uuid())
        .bind(pseudonym)
        .execute(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO game_persona_redaction (game_id, persona_id, replacement_public_name, redacted_at) SELECT binding.game_id, binding.persona_id, $2, $3 FROM game_persona_subject_binding AS binding JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id WHERE subject.principal_id = $1 ON CONFLICT (game_id, persona_id) DO UPDATE SET replacement_public_name = EXCLUDED.replacement_public_name")
        .bind(principal_id.as_uuid()).bind(pseudonym).bind(redacted_at).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM game_persona_name_claim WHERE (game_id, persona_id) IN (SELECT binding.game_id, binding.persona_id FROM game_persona_subject_binding AS binding JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id WHERE subject.principal_id = $1)")
        .bind(principal_id.as_uuid()).execute(&mut **tx).await?;
    // The randomized alias is public presentation, never an authority token,
    // but it still owns its normalized game-local name. Retain that invariant
    // after releasing the erased private names so a later command cannot make
    // two public personae present as the same identity.
    sqlx::query(
        "INSERT INTO game_persona_name_claim (game_id, normalized_name, persona_id, first_claimed_seq) \
         SELECT binding.game_id, lower(btrim($2)), binding.persona_id, persona.registered_seq \
         FROM game_persona_subject_binding AS binding \
         JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id \
         JOIN game_persona AS persona USING (game_id, persona_id) \
         WHERE subject.principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .bind(pseudonym)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE game_persona_name_history AS history SET public_name = $2 FROM game_persona_subject_binding AS binding JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id WHERE subject.principal_id = $1 AND history.game_id = binding.game_id AND history.persona_id = binding.persona_id")
        .bind(principal_id.as_uuid()).bind(pseudonym).execute(&mut **tx).await?;
    sqlx::query("UPDATE game_persona_public AS public SET current_public_name = $2, renamed_seq = COALESCE(public.renamed_seq, public.registered_seq) FROM game_persona_subject_binding AS binding JOIN privacy_subject AS subject ON subject.subject_id = binding.subject_id WHERE subject.principal_id = $1 AND public.game_id = binding.game_id AND public.persona_id = binding.persona_id")
    .bind(principal_id.as_uuid())
    .bind(pseudonym)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE game_persona_subject_binding AS binding SET lifecycle = 'redacted', current_claim_id = NULL FROM privacy_subject AS subject WHERE subject.principal_id = $1 AND subject.subject_id = binding.subject_id AND binding.lifecycle = 'active'")
        .bind(principal_id.as_uuid())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub(crate) async fn redact_community_membership_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: &PrincipalId,
    retained_alias: &str,
    redacted_at: i64,
) -> Result<(), IdentityFlowError> {
    use community_membership::{
        decide_membership, InvitationId, MembershipCommand, MembershipEvent, MembershipId,
        MembershipOrigin, MembershipState, MembershipStatus,
    };
    use eventstore::{ActorId, EventInput};

    let row = sqlx::query_as::<_, (Uuid, String, String, Option<Uuid>, Option<Uuid>, i64)>(
        "SELECT membership_id, status, origin_kind, admission_invitation_id, sponsoring_membership_id, revision FROM community_membership WHERE active_principal_id = $1 FOR UPDATE",
    )
    .bind(principal_id.as_uuid())
    .fetch_optional(&mut **tx)
    .await?;
    let Some((membership_id, status, origin_kind, invitation_id, sponsor_id, revision)) = row
    else {
        return Ok(());
    };
    let membership_id = MembershipId::from_uuid(membership_id);
    let status = match status.as_str() {
        "active" => MembershipStatus::Active,
        "suspended" => MembershipStatus::Suspended,
        "withdrawn" => MembershipStatus::Withdrawn,
        "redacted" => MembershipStatus::Redacted,
        value => {
            return Err(IdentityFlowError::Internal(format!(
                "community membership has unknown status {value}"
            )))
        }
    };
    let origin = match (origin_kind.as_str(), invitation_id, sponsor_id) {
        ("founder", None, None) => MembershipOrigin::Founder,
        ("invitation", Some(invitation_id), Some(sponsor_id)) => MembershipOrigin::Invitation {
            invitation_id: InvitationId::from_uuid(invitation_id),
            sponsoring_membership_id: MembershipId::from_uuid(sponsor_id),
        },
        _ => {
            return Err(IdentityFlowError::Internal(
                "community membership has malformed provenance".to_string(),
            ))
        }
    };
    let state = MembershipState {
        membership_id,
        status,
        origin,
        revision,
    };
    let events = decide_membership(
        membership_id,
        Some(&state),
        MembershipCommand::Redact {
            retained_alias: retained_alias.to_string(),
        },
    )
    .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let inputs = events
        .iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                ActorId::System,
                redacted_at,
            )
        })
        .collect::<Vec<_>>();
    let stored = eventstore::append_expected_in_tx(tx, membership_id.as_uuid(), revision, &inputs)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let next_revision = stored.last().map(|event| event.stream_seq).ok_or_else(|| {
        IdentityFlowError::Internal("membership redaction emitted no event".to_string())
    })?;
    debug_assert!(matches!(
        events.as_slice(),
        [MembershipEvent::Redacted { .. }]
    ));
    let updated = sqlx::query(
        "UPDATE community_membership SET active_principal_id = NULL, status = 'redacted', retained_alias = $2, updated_at = $3, revision = $4 WHERE membership_id = $1 AND revision = $5",
    )
    .bind(membership_id.as_uuid())
    .bind(retained_alias)
    .bind(redacted_at)
    .bind(next_revision)
    .bind(revision)
    .execute(&mut **tx)
    .await?;
    if updated.rows_affected() != 1 {
        return Err(IdentityFlowError::Internal(
            "community membership changed during redaction".to_string(),
        ));
    }
    Ok(())
}
