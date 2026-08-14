//! Durable member lifecycle stream, handler, and deterministic projection fold.

use crate::session::revoke_sessions_for_principal;
use crate::{
    decide_member_lifecycle, ClaimId, IdentityFlowError, MemberLifecycleCommand,
    MemberLifecycleEvent, MemberLifecycleState, MemberLifecycleStatus, SubjectClaimEnvelope,
    SubjectId,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

const PERSONAL_EXPORT_TTL_SECONDS: i64 = 60 * 60 * 24 * 14;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberLifecycleSnapshot {
    pub principal_user_id: String,
    pub status: MemberLifecycleStatus,
    pub last_seq: i64,
    pub pseudonym: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersonalExport {
    pub export_id: String,
    pub principal_user_id: String,
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
    principal_user_id: &str,
    command: MemberLifecycleCommand,
    now: i64,
) -> Result<MemberLifecycleStatus, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::ensure_principal(&mut tx, principal_user_id, &[], now).await?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_user_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?
    .require_active()?;
    let snapshot = locked_snapshot(&mut tx, principal_user_id).await?;
    let events = decide_member_lifecycle(
        &MemberLifecycleState {
            status: snapshot.status,
        },
        command,
    )
    .map_err(|error| IdentityFlowError::Invalid(error.to_string()))?;
    let next = append_and_project(
        &mut tx,
        principal_user_id,
        snapshot,
        &events,
        now,
        None,
        None,
    )
    .await?;
    if next != MemberLifecycleStatus::Active {
        revoke_sessions_for_principal(&mut tx, principal_user_id, now).await?;
    }
    tx.commit().await?;
    Ok(next)
}

/// Atomically append the prerequisite deactivation, erasure, credentials wipe,
/// and authorship-redaction facts. The final fact marks the aggregate erased;
/// the individual facts retain the auditable lifecycle causality.
pub async fn erase_member(
    pool: &PgPool,
    principal_user_id: &str,
    now: i64,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::ensure_principal(&mut tx, principal_user_id, &[], now).await?;
    let owner = crate::methods::lock_identity_mutation(
        &mut tx,
        principal_user_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?;
    owner.require_active()?;
    let snapshot = locked_snapshot(&mut tx, principal_user_id).await?;
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
    events.push(MemberLifecycleEvent::AuthorshipPseudonymized);

    let key_store = crate::active_subject_key_store()
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let subject_id = SubjectId::from_uuid(owner.subject_id);
    let pseudonym = crate::random_tombstone_alias();
    let key_fingerprint = key_store
        .fingerprint(subject_id)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let receipt_id = Uuid::new_v4();
    let revocation = crate::SubjectRevocationRecord {
        subject_id,
        replacement_alias: pseudonym.clone(),
        destroyed_at: now,
        key_fingerprint_sha256: key_fingerprint.clone(),
        receipt_id,
    };
    let next = append_and_project(
        &mut tx,
        principal_user_id,
        snapshot.clone(),
        &events,
        now,
        Some(pseudonym.as_str()),
        Some(subject_id),
    )
    .await?;
    record_subject_tombstone(&mut tx, &revocation, principal_user_id).await?;
    revoke_sessions_for_principal(&mut tx, principal_user_id, now).await?;
    erase_credentials_and_identifiers(&mut tx, principal_user_id, pseudonym.as_str(), now).await?;

    // Prepare the complete database-side scrub before making the external
    // revocation irreversible. The transaction remains open: if the journal
    // write succeeds but the database commit later fails, startup
    // reconciliation replays the authenticated journal toward erasure.
    key_store
        .record_revocation(&revocation)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    let key_was_present = key_store
        .destroy(subject_id)
        .await
        .map_err(|error| IdentityFlowError::Internal(error.to_string()))?;
    record_subject_destruction_receipt(&mut tx, &revocation, key_was_present).await?;
    tx.commit().await?;
    Ok(MemberLifecycleSnapshot {
        principal_user_id: principal_user_id.to_string(),
        status: next,
        last_seq: snapshot.last_seq + events.len() as i64,
        pseudonym: Some(pseudonym),
    })
}

/// Assemble the subject-scoped export before erasure. It intentionally omits
/// passwords, recovery tokens, session tokens, and raw provider credentials.
pub async fn create_personal_export(
    pool: &PgPool,
    principal_user_id: &str,
    now: i64,
) -> Result<PersonalExport, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::ensure_principal(&mut tx, principal_user_id, &[], now).await?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_user_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?
    .require_active()?;
    let snapshot = locked_snapshot(&mut tx, principal_user_id).await?;
    if snapshot.status == MemberLifecycleStatus::Erased {
        return Err(IdentityFlowError::Invalid(
            "an erased member cannot create a personal export".to_string(),
        ));
    }
    let export_id = Uuid::new_v4();
    let expires_at = now.saturating_add(PERSONAL_EXPORT_TTL_SECONDS);
    let artifact = assemble_personal_export(&mut tx, principal_user_id).await?;
    let subject_id: Uuid = sqlx::query_scalar(
        "SELECT subject_id FROM privacy_subject WHERE principal_user_id = $1 AND lifecycle_state = 'active' FOR UPDATE",
    )
    .bind(principal_user_id)
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
        principal_user_id,
        snapshot.clone(),
        &events,
        now,
        None,
        None,
    )
    .await?;
    sqlx::query(
        "INSERT INTO member_personal_export (export_id, principal_user_id, requested_at, expires_at, envelope, recorded_seq, subject_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    )
    .bind(export_id)
    .bind(principal_user_id)
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
        principal_user_id: principal_user_id.to_string(),
        requested_at: now,
        expires_at,
        artifact,
    })
}

pub async fn load_personal_export(
    pool: &PgPool,
    principal_user_id: &str,
    export_id: Uuid,
    now: i64,
) -> Result<Option<PersonalExport>, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    let principal_status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM platform_principal WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(principal_user_id)
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
         AND subject.principal_user_id = $2
         AND subject.lifecycle_state = 'active'
        WHERE export.export_id = $1
          AND export.principal_user_id = $2
          AND export.expires_at > $3
        FOR UPDATE OF subject
        "#,
    )
    .bind(export_id)
    .bind(principal_user_id)
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
        principal_user_id: principal_user_id.to_string(),
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
    principal_user_id: &str,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let mut tx = pool.begin().await?;
    crate::methods::lock_identity_mutation(
        &mut tx,
        principal_user_id,
        crate::methods::IdentityMutationExtent::Complete,
    )
    .await?;
    let rows = sqlx::query(
        "SELECT seq, kind, payload, occurred_at, subject_id FROM member_lifecycle_event WHERE principal_user_id = $1 ORDER BY seq",
    )
    .bind(principal_user_id)
    .fetch_all(&mut *tx)
    .await?;
    let mut snapshot = MemberLifecycleSnapshot {
        principal_user_id: principal_user_id.to_string(),
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
    if snapshot.status == MemberLifecycleStatus::Erased {
        let erased_subject = subject_id.ok_or_else(|| {
            IdentityFlowError::Invalid(
                "erased member lifecycle stream is missing its privacy subject".to_string(),
            )
        })?;
        snapshot.pseudonym = sqlx::query_scalar(
            "SELECT replacement_alias FROM subject_tombstone WHERE subject_id = $1",
        )
        .bind(erased_subject.as_uuid())
        .fetch_optional(&mut *tx)
        .await?;
        if snapshot.pseudonym.is_none() {
            return Err(IdentityFlowError::Invalid(
                "erased member lifecycle stream is missing its tombstone".to_string(),
            ));
        }
    }
    upsert_snapshot(&mut tx, &snapshot, timestamps, subject_id).await?;
    if let Some(pseudonym) = snapshot.pseudonym.as_deref() {
        apply_retained_authorship_redaction(&mut tx, principal_user_id, pseudonym, 0).await?;
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
    principal_user_id: &str,
) -> Result<MemberLifecycleSnapshot, IdentityFlowError> {
    let row = sqlx::query(
        "SELECT status, last_seq, pseudonym FROM member_lifecycle_projection WHERE principal_user_id = $1 FOR UPDATE",
    )
    .bind(principal_user_id)
    .fetch_optional(&mut **tx)
    .await?;
    match row {
        Some(row) => Ok(MemberLifecycleSnapshot {
            principal_user_id: principal_user_id.to_string(),
            status: MemberLifecycleStatus::parse(row.try_get::<String, _>("status")?.as_str())
                .ok_or_else(|| IdentityFlowError::Invalid("unknown lifecycle status".into()))?,
            last_seq: row.try_get("last_seq")?,
            pseudonym: row.try_get("pseudonym")?,
        }),
        None => Ok(MemberLifecycleSnapshot {
            principal_user_id: principal_user_id.to_string(),
            status: MemberLifecycleStatus::Active,
            last_seq: 0,
            pseudonym: None,
        }),
    }
}

async fn append_and_project(
    tx: &mut Transaction<'_, Postgres>,
    principal_user_id: &str,
    mut snapshot: MemberLifecycleSnapshot,
    events: &[MemberLifecycleEvent],
    now: i64,
    pseudonym: Option<&str>,
    subject_id: Option<SubjectId>,
) -> Result<MemberLifecycleStatus, IdentityFlowError> {
    let mut timestamps = LifecycleTimestamps::default();
    for event in events {
        snapshot.last_seq += 1;
        sqlx::query("INSERT INTO member_lifecycle_event (principal_user_id, seq, kind, payload, occurred_at, subject_id) VALUES ($1,$2,$3,$4::jsonb,$5,$6)")
            .bind(principal_user_id)
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
            (principal_user_id, status, last_seq, deactivated_at, erasure_requested_at,
             credentials_erased_at, authorship_pseudonymized_at,
             personal_export_recorded_at, pseudonym, subject_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (principal_user_id) DO UPDATE SET
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
    .bind(snapshot.principal_user_id.as_str())
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
    principal_user_id: &str,
) -> Result<serde_json::Value, IdentityFlowError> {
    let account = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('account_id', account_id, 'created_at', created_at, 'disabled_at', disabled_at) ORDER BY account_id)::text FROM auth_account WHERE principal_user_id = $1",
        principal_user_id,
    )
    .await?;
    let methods = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'created_at', created_at, 'disabled_at', disabled_at) ORDER BY created_at, method_id)::text FROM authentication_method WHERE principal_user_id = $1",
        principal_user_id,
    )
    .await?;
    let profiles = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('profile_id', public.profile_id, 'handle', public.handle, 'display_name', public.display_name, 'bio', public.bio, 'visibility', public.visibility) ORDER BY public.profile_id)::text FROM profile_public AS public JOIN profile_editor AS editor ON editor.profile_id = public.profile_id WHERE editor.principal_user_id = $1",
        principal_user_id,
    )
    .await?;
    let personas = json_scalar(
        tx,
        "SELECT jsonb_agg(jsonb_build_object('game_id', game_id, 'persona_id', persona_id, 'registered_seq', registered_seq) ORDER BY game_id, persona_id)::text FROM game_persona_private WHERE principal_user_id = $1",
        principal_user_id,
    )
    .await?;
    Ok(serde_json::json!({
        "schema_version": 1,
        "principal_user_id": principal_user_id,
        "accounts": account.unwrap_or_else(|| serde_json::json!([])),
        "authentication_methods": methods.unwrap_or_else(|| serde_json::json!([])),
        "profiles": profiles.unwrap_or_else(|| serde_json::json!([])),
        "game_personas": personas.unwrap_or_else(|| serde_json::json!([])),
    }))
}

async fn json_scalar(
    tx: &mut Transaction<'_, Postgres>,
    query: &'static str,
    principal_user_id: &str,
) -> Result<Option<serde_json::Value>, IdentityFlowError> {
    let raw = sqlx::query_scalar::<_, Option<String>>(query)
        .bind(principal_user_id)
        .fetch_one(&mut **tx)
        .await?;
    raw.map(|value| {
        serde_json::from_str(&value).map_err(|error| IdentityFlowError::Internal(error.to_string()))
    })
    .transpose()
}

async fn erase_credentials_and_identifiers(
    tx: &mut Transaction<'_, Postgres>,
    principal_user_id: &str,
    pseudonym: &str,
    now: i64,
) -> Result<(), IdentityFlowError> {
    // Auth material and delivery data are no longer usable; append-only audit
    // records intentionally remain restricted operator evidence.
    sqlx::query("UPDATE authentication_method SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2) WHERE principal_user_id = $1")
        .bind(principal_user_id).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_account SET disabled_at = COALESCE(disabled_at, $2), password_hash = $3, global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(principal_user_id).bind(now).bind(format!("erased:{}", pseudonym)).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_account_recovery_credential SET revoked_at = COALESCE(revoked_at, $2) WHERE account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1) AND used_at IS NULL")
        .bind(principal_user_id).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_invite SET revoked_at = COALESCE(revoked_at, $2) WHERE principal_user_id = $1 AND redeemed_at IS NULL")
        .bind(principal_user_id).bind(now).execute(&mut **tx).await?;
    sqlx::query("UPDATE auth_delivery_intent SET status = 'cancelled', outcome_kind = 'cancelled', outcome_code = 'member_erased', next_attempt_at = NULL, delivered_at = NULL, provider_receipt_id = NULL, claim_token = NULL, claim_expires_at = NULL, credential_envelope = NULL, updated_at = $2 WHERE principal_user_id = $1 AND status IN ('queued', 'processing', 'retryable_failed')")
        .bind(principal_user_id).bind(now).execute(&mut **tx).await?;

    // Account labels and provider subject strings are PII-bearing credentials,
    // not durable audit facts. Remove dependent one-time material before
    // replacing the account key with a random receipt-scoped identifier.
    sqlx::query("DELETE FROM auth_account_recovery_credential WHERE account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal_user_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM auth_invite WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal_user_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM auth_delivery_intent WHERE principal_user_id = $1 OR account_id IN (SELECT account_id FROM auth_account WHERE principal_user_id = $1)")
        .bind(principal_user_id).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM auth_websocket_ticket WHERE principal_user_id = $1")
        .bind(principal_user_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE auth_account SET account_id = $2 WHERE principal_user_id = $1")
        .bind(principal_user_id)
        .bind(format!("erased_{}", Uuid::new_v4().simple()))
        .execute(&mut **tx)
        .await?;

    // Provider-owned identity details come after every local authentication
    // row in the canonical protocol.
    sqlx::query("DELETE FROM workos_session_exchange WHERE subject IN (SELECT subject FROM external_identity WHERE principal_user_id = $1)")
        .bind(principal_user_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM external_identity WHERE principal_user_id = $1")
        .bind(principal_user_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query("UPDATE identity_lifecycle_audit SET actor_user_id = CASE WHEN actor_user_id = $1 THEN $2 ELSE actor_user_id END, principal_user_id = $2, metadata = '{}'::jsonb WHERE principal_user_id = $1 OR actor_user_id = $1")
        .bind(principal_user_id).bind(pseudonym).execute(&mut **tx).await?;
    sqlx::query("UPDATE platform_principal SET status = 'disabled', disabled_at = COALESCE(disabled_at, $2), global_capabilities = '{}'::text[] WHERE principal_user_id = $1")
        .bind(principal_user_id).bind(now).execute(&mut **tx).await?;

    apply_retained_authorship_redaction(tx, principal_user_id, pseudonym, now).await?;
    sqlx::query("DELETE FROM member_personal_export WHERE principal_user_id = $1")
        .bind(principal_user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Apply the retained-public-data overlay. Calling it after a projection rebuild
/// is safe and deterministic: it never touches immutable streams and every
/// update converges on the same externally journaled random pseudonym.
async fn apply_retained_authorship_redaction(
    tx: &mut Transaction<'_, Postgres>,
    principal_user_id: &str,
    pseudonym: &str,
    redacted_at: i64,
) -> Result<(), IdentityFlowError> {
    // Public authorship remains coherent without retaining account/profile labels.
    sqlx::query("UPDATE profile_public SET handle = CONCAT('former-member-', REPLACE(profile_id::text, '-', '')), display_name = $2, bio = '', visibility = 'public' WHERE profile_id IN (SELECT profile_id FROM profile_editor WHERE principal_user_id = $1)")
        .bind(principal_user_id).bind(pseudonym).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM public_search_document WHERE scope_kind = 'profile' AND scope_id IN (SELECT profile_id FROM profile_editor WHERE principal_user_id = $1)")
        .bind(principal_user_id).execute(&mut **tx).await?;
    sqlx::query("UPDATE profile_editor SET principal_user_id = $2, current_claim_id = NULL WHERE principal_user_id = $1")
        .bind(principal_user_id)
        .bind(pseudonym)
        .execute(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO game_persona_redaction (game_id, persona_id, replacement_public_name, redacted_at) SELECT game_id, persona_id, $2, $3 FROM game_persona_private WHERE principal_user_id = $1 ON CONFLICT (game_id, persona_id) DO UPDATE SET replacement_public_name = EXCLUDED.replacement_public_name")
        .bind(principal_user_id).bind(pseudonym).bind(redacted_at).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM game_persona_name_claim WHERE (game_id, persona_id) IN (SELECT game_id, persona_id FROM game_persona_private WHERE principal_user_id = $1)")
        .bind(principal_user_id).execute(&mut **tx).await?;
    sqlx::query("UPDATE game_persona_name_history AS history SET public_name = $2 FROM game_persona_private AS private WHERE private.principal_user_id = $1 AND history.game_id = private.game_id AND history.persona_id = private.persona_id")
        .bind(principal_user_id).bind(pseudonym).execute(&mut **tx).await?;
    sqlx::query("UPDATE game_persona_public AS public SET current_public_name = redaction.replacement_public_name, renamed_seq = COALESCE(public.renamed_seq, public.registered_seq) FROM game_persona_redaction AS redaction WHERE public.game_id = redaction.game_id AND public.persona_id = redaction.persona_id AND redaction.replacement_public_name = $1")
        .bind(pseudonym).execute(&mut **tx).await?;
    sqlx::query(
        "UPDATE game_persona_private SET principal_user_id = $2, current_claim_id = NULL WHERE principal_user_id = $1",
    )
    .bind(principal_user_id)
    .bind(pseudonym)
    .execute(&mut **tx)
    .await?;
    sqlx::query("UPDATE thread_view SET author_user = $2 WHERE author_user = $1")
        .bind(principal_user_id)
        .bind(pseudonym)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn record_subject_tombstone(
    tx: &mut Transaction<'_, Postgres>,
    record: &crate::SubjectRevocationRecord,
    principal_user_id: &str,
) -> Result<(), IdentityFlowError> {
    sqlx::query("UPDATE privacy_subject SET lifecycle_state = 'erased' WHERE subject_id = $1")
        .bind(record.subject_id.as_uuid())
        .execute(&mut **tx)
        .await?;
    sqlx::query("INSERT INTO subject_tombstone (subject_id, replacement_alias, destroyed_at) VALUES ($1,$2,$3) ON CONFLICT (subject_id) DO NOTHING")
        .bind(record.subject_id.as_uuid()).bind(&record.replacement_alias).bind(record.destroyed_at)
        .execute(&mut **tx).await?;
    sqlx::query(
        "UPDATE member_lifecycle_projection SET subject_id = $2 WHERE principal_user_id = $1",
    )
    .bind(principal_user_id)
    .bind(record.subject_id.as_uuid())
    .execute(&mut **tx)
    .await?;
    sqlx::query("DELETE FROM subject_private_claim WHERE subject_id = $1")
        .bind(record.subject_id.as_uuid())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn record_subject_destruction_receipt(
    tx: &mut Transaction<'_, Postgres>,
    record: &crate::SubjectRevocationRecord,
    key_was_present: bool,
) -> Result<(), IdentityFlowError> {
    sqlx::query("INSERT INTO subject_key_destruction_receipt (receipt_id, subject_id, key_fingerprint_sha256, key_was_present, destroyed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (subject_id) DO NOTHING")
        .bind(record.receipt_id)
        .bind(record.subject_id.as_uuid())
        .bind(&record.key_fingerprint_sha256)
        .bind(key_was_present)
        .bind(record.destroyed_at)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
