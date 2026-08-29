//! Authentication attempt rate limiting and credential-delivery orchestration.
//!
//! This module owns credential-attempt scope persistence/auditing and
//! delivery-intent creation, cancellation, and audit rows. The provider-neutral
//! delivery worker remains in [`crate::identity_delivery`]. HTTP handlers and
//! DTOs live behind [`crate::auth_http::AuthHttpState`].

use super::auth_http::{
    hash_session_token, rate_limited, unix_now_seconds, AuthDeliveryReceipt, AuthHttpState,
};
use super::identity_delivery::{delivery_aad, IdentityDeliveryKind};
use super::ApiError;
use axum::http::{HeaderMap, StatusCode};
use principal::PrincipalId;
use sqlx::postgres::PgPool;
use std::sync::Arc;
use uuid::Uuid;
use wire::RejectCode;

#[derive(Debug, Clone)]
pub(super) struct AuthAttemptPolicy {
    pub(super) account_max_failures: i32,
    pub(super) source_max_failures: i32,
    pub(super) registration_max_per_source: i32,
    pub(super) window_seconds: i64,
    pub(super) lockout_seconds: i64,
    pub(super) retention_seconds: i64,
    pub(super) trust_source_header: bool,
    pub(super) source_signing_key: Option<Arc<[u8]>>,
}

#[derive(Debug, Clone)]
pub(super) struct AuthAttemptScope {
    source_scope_hash: String,
    account_scope_hash: Option<String>,
    policy: AuthAttemptPolicy,
}

/// Typed rate-limit audit payload for [`record_auth_attempt_rate_limited`].
#[derive(Debug, Clone)]
pub(super) struct AuthAttemptAudit<'a> {
    pub scope: &'a AuthAttemptScope,
    pub scope_hash: &'a str,
    pub scope_kind: &'a str,
    pub max_failures: i32,
    pub account_id: &'a str,
    pub operation: &'a str,
    pub now: i64,
    pub blocked_until: i64,
}

/// Typed inputs for [`deliver_auth_credential`].
#[derive(Debug, Clone)]
pub(super) struct AuthCredentialDeliveryRequest<'a> {
    pub delivery_kind: IdentityDeliveryKind,
    pub account_id: &'a str,
    pub principal_id: &'a PrincipalId,
    pub credential_hash: &'a str,
    pub credential_material: &'a str,
    pub credential_expires_at: i64,
    pub now: i64,
}

/// Typed delivery audit payload for [`record_auth_delivery_audit`].
#[derive(Debug, Clone)]
pub(super) struct AuthDeliveryAudit<'a> {
    pub event_kind: &'a str,
    pub delivery_kind: &'a str,
    pub account_id: &'a str,
    pub actor_principal_id: &'a PrincipalId,
    pub principal_id: &'a PrincipalId,
    pub credential_hash: &'a str,
    pub delivery_id: Uuid,
    pub now: i64,
    pub provider_id: &'a str,
    pub outcome_kind: &'a str,
    pub outcome_code: Option<&'a str>,
}

pub(super) const AUTH_ATTEMPT_SOURCE_HEADER: &str = "x-fmarch-auth-source";
pub(super) const AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER: &str = "x-fmarch-auth-source-signature";
pub(super) const AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER: &str = "x-fmarch-auth-source-timestamp";

pub(super) async fn enforce_auth_attempt_limit(
    state: &AuthHttpState,
    headers: &HeaderMap,
    account_id: &str,
) -> Result<AuthAttemptScope, ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let source_scope_hash =
        hash_session_token(format!("credential-source:\0{normalized_source}").as_str());
    let now = unix_now_seconds();
    if let Some(retry_after) =
        blocked_auth_attempt_retry_after(&state.pool, source_scope_hash.as_str(), now).await?
    {
        return Err(rate_limited(retry_after));
    }

    let account_exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM auth_account WHERE account_id = $1)",
    )
    .bind(account_id)
    .fetch_one(&state.pool)
    .await?;
    let account_scope_hash = account_exists.then(|| {
        hash_session_token(
            format!(
                "credential-account:{}",
                account_id.trim().to_ascii_lowercase()
            )
            .as_str(),
        )
    });
    if let Some(account_scope_hash) = account_scope_hash.as_deref() {
        if let Some(retry_after) =
            blocked_auth_attempt_retry_after(&state.pool, account_scope_hash, now).await?
        {
            return Err(rate_limited(retry_after));
        }
    }
    Ok(AuthAttemptScope {
        source_scope_hash,
        account_scope_hash,
        policy,
    })
}

pub(super) async fn enforce_registration_source_limit(
    state: &AuthHttpState,
    headers: &HeaderMap,
) -> Result<(), ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let source_hash =
        hash_session_token(format!("account-registration-source:\0{normalized_source}").as_str());
    enforce_public_request_limit(
        state,
        source_hash.as_str(),
        policy.registration_max_per_source,
        &policy,
    )
    .await
}

pub(super) async fn enforce_recovery_request_limit(
    state: &AuthHttpState,
    headers: &HeaderMap,
    account_id: &str,
) -> Result<(), ApiError> {
    let policy = state.auth_attempt_policy.clone();
    let normalized_source = normalized_auth_attempt_source(headers, &policy);
    let scope_hash = hash_session_token(
        format!(
            "account-recovery-request:{}\0source:{}",
            account_id.trim().to_ascii_lowercase(),
            normalized_source
        )
        .as_str(),
    );
    enforce_public_request_limit(
        state,
        scope_hash.as_str(),
        policy.account_max_failures,
        &policy,
    )
    .await
}

pub(super) async fn enforce_public_request_limit(
    state: &AuthHttpState,
    scope_hash: &str,
    max_attempts: i32,
    policy: &AuthAttemptPolicy,
) -> Result<(), ApiError> {
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        "DELETE FROM auth_registration_attempt WHERE updated_at < $1 AND (blocked_until IS NULL OR blocked_until <= $2)",
    )
    .bind(now - policy.retention_seconds)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    let blocked_until = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT blocked_until FROM auth_registration_attempt WHERE scope_hash = $1 FOR UPDATE",
    )
    .bind(scope_hash)
    .fetch_optional(&mut *tx)
    .await?
    .flatten();
    if let Some(blocked_until) = blocked_until.filter(|value| *value > now) {
        tx.commit().await?;
        return Err(rate_limited(blocked_until - now));
    }

    let (_, blocked_until) = sqlx::query_as::<_, (i32, Option<i64>)>(
        r#"
        INSERT INTO auth_registration_attempt (
            scope_hash,
            window_started_at,
            attempt_count,
            blocked_until,
            updated_at
        )
        VALUES ($1, $2, 1, NULL, $2)
        ON CONFLICT (scope_hash) DO UPDATE
        SET window_started_at = CASE
                WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN $2
                ELSE auth_registration_attempt.window_started_at
            END,
            attempt_count = CASE
                WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN 1
                ELSE auth_registration_attempt.attempt_count + 1
            END,
            blocked_until = CASE
                WHEN (
                    CASE
                        WHEN auth_registration_attempt.window_started_at + $3 <= $2 THEN 1
                        ELSE auth_registration_attempt.attempt_count + 1
                    END
                ) >= $4 THEN $2 + $5
                ELSE NULL
            END,
            updated_at = $2
        RETURNING attempt_count, blocked_until
        "#,
    )
    .bind(scope_hash)
    .bind(now)
    .bind(policy.window_seconds)
    .bind(max_attempts)
    .bind(policy.lockout_seconds)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    if let Some(blocked_until) = blocked_until.filter(|value| *value > now) {
        return Err(rate_limited(blocked_until - now));
    }
    Ok(())
}

pub(super) fn normalized_auth_attempt_source(
    headers: &HeaderMap,
    policy: &AuthAttemptPolicy,
) -> String {
    let source = headers
        .get(AUTH_ATTEMPT_SOURCE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 256)
        .map(str::to_ascii_lowercase);
    if policy.trust_source_header {
        return source.unwrap_or_else(|| "unattributed".to_string());
    }
    let Some(source) = source else {
        return "unattributed".to_string();
    };
    if signed_auth_source_valid(headers, &source, policy) {
        source
    } else {
        "unattributed".to_string()
    }
}

fn signed_auth_source_valid(headers: &HeaderMap, source: &str, policy: &AuthAttemptPolicy) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let Some(key) = policy.source_signing_key.as_deref() else {
        return false;
    };
    let Some(timestamp) = headers
        .get(AUTH_ATTEMPT_SOURCE_TIMESTAMP_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
    else {
        return false;
    };
    if unix_now_seconds().abs_diff(timestamp) > 60 {
        return false;
    }
    let Some(signature) = headers
        .get(AUTH_ATTEMPT_SOURCE_SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(decode_hex_32)
    else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(key) else {
        return false;
    };
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b"\n");
    mac.update(source.as_bytes());
    mac.verify_slice(&signature).is_ok()
}

fn decode_hex_32(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, byte) in decoded.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
    }
    Some(decoded)
}

pub(super) async fn record_failed_auth_attempt(
    state: &AuthHttpState,
    scope: &AuthAttemptScope,
    account_id: &str,
    operation: &str,
) -> Result<(), ApiError> {
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query(
        r#"
        DELETE FROM auth_credential_attempt
        WHERE updated_at < $1
          AND (blocked_until IS NULL OR blocked_until <= $2)
        "#,
    )
    .bind(now - scope.policy.retention_seconds)
    .bind(now)
    .execute(&mut *tx)
    .await?;

    let source_result = upsert_auth_attempt_scope(
        &mut tx,
        scope.source_scope_hash.as_str(),
        now,
        &scope.policy,
        scope.policy.source_max_failures,
    )
    .await?;
    let account_result = match scope.account_scope_hash.as_deref() {
        Some(account_scope_hash) => Some(
            upsert_auth_attempt_scope(
                &mut tx,
                account_scope_hash,
                now,
                &scope.policy,
                scope.policy.account_max_failures,
            )
            .await?,
        ),
        None => None,
    };
    let limited = account_result
        .filter(|(_, blocked_until)| blocked_until.is_some_and(|value| value > now))
        .map(|result| {
            (
                "account",
                scope.account_scope_hash.as_deref().unwrap_or_default(),
                scope.policy.account_max_failures,
                result,
            )
        })
        .or_else(|| {
            (source_result.1.is_some_and(|value| value > now)).then_some((
                "source",
                scope.source_scope_hash.as_str(),
                scope.policy.source_max_failures,
                source_result,
            ))
        });
    if let Some((scope_kind, scope_hash, max_failures, (failure_count, blocked_until))) = limited {
        let blocked_until = blocked_until.unwrap_or(now + scope.policy.lockout_seconds);
        if failure_count == max_failures && scope.account_scope_hash.is_some() {
            record_auth_attempt_rate_limited(
                &mut tx,
                &AuthAttemptAudit {
                    scope,
                    scope_hash,
                    scope_kind,
                    max_failures,
                    account_id,
                    operation,
                    now,
                    blocked_until,
                },
            )
            .await?;
        }
        tx.commit().await?;
        return Err(rate_limited(blocked_until - now));
    }
    tx.commit().await?;
    Ok(())
}

async fn upsert_auth_attempt_scope(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope_hash: &str,
    now: i64,
    policy: &AuthAttemptPolicy,
    max_failures: i32,
) -> Result<(i32, Option<i64>), ApiError> {
    Ok(sqlx::query_as::<_, (i32, Option<i64>)>(
        r#"
        INSERT INTO auth_credential_attempt (
            scope_hash,
            window_started_at,
            failure_count,
            blocked_until,
            updated_at
        )
        VALUES ($1, $2, 1, NULL, $2)
        ON CONFLICT (scope_hash) DO UPDATE
        SET window_started_at = CASE
                WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN $2
                ELSE auth_credential_attempt.window_started_at
            END,
            failure_count = CASE
                WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN 1
                ELSE auth_credential_attempt.failure_count + 1
            END,
            blocked_until = CASE
                WHEN (
                    CASE
                        WHEN auth_credential_attempt.window_started_at + $3 <= $2 THEN 1
                        ELSE auth_credential_attempt.failure_count + 1
                    END
                ) >= $4 THEN $2 + $5
                ELSE NULL
            END,
            updated_at = $2
        RETURNING failure_count, blocked_until
        "#,
    )
    .bind(scope_hash)
    .bind(now)
    .bind(policy.window_seconds)
    .bind(max_failures)
    .bind(policy.lockout_seconds)
    .fetch_one(&mut **tx)
    .await?)
}

async fn blocked_auth_attempt_retry_after(
    pool: &PgPool,
    scope_hash: &str,
    now: i64,
) -> Result<Option<i64>, ApiError> {
    Ok(sqlx::query_scalar::<_, Option<i64>>(
        "SELECT blocked_until FROM auth_credential_attempt WHERE scope_hash = $1",
    )
    .bind(scope_hash)
    .fetch_optional(pool)
    .await?
    .flatten()
    .filter(|blocked_until| *blocked_until > now)
    .map(|blocked_until| blocked_until - now))
}

pub(super) async fn clear_auth_attempt_failures(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope: &AuthAttemptScope,
) -> Result<(), ApiError> {
    sqlx::query("DELETE FROM auth_credential_attempt WHERE scope_hash = $1 OR scope_hash = $2")
        .bind(scope.source_scope_hash.as_str())
        .bind(scope.account_scope_hash.as_deref())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn record_auth_attempt_rate_limited(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    audit: &AuthAttemptAudit<'_>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_principal_id,
            principal_id,
            token_hash,
            related_token_hash,
            metadata
        )
        SELECT $1,
               'auth_attempt_rate_limited',
               NULL,
               principal_id,
               $2,
               NULL,
               $3::JSONB
        FROM auth_account
        WHERE account_id = $4
        "#,
    )
    .bind(audit.now)
    .bind(audit.scope_hash)
    .bind(
        serde_json::json!({
            "account_id": audit.account_id,
            "operation": audit.operation,
            "scope_kind": audit.scope_kind,
            "max_failures": audit.max_failures,
            "account_max_failures": audit.scope.policy.account_max_failures,
            "source_max_failures": audit.scope.policy.source_max_failures,
            "window_seconds": audit.scope.policy.window_seconds,
            "lockout_seconds": audit.scope.policy.lockout_seconds,
            "retention_seconds": audit.scope.policy.retention_seconds,
            "blocked_until": audit.blocked_until,
            "trusted_source_header": audit.scope.policy.trust_source_header
        })
        .to_string(),
    )
    .bind(audit.account_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub(super) fn auth_attempt_policy_from_env() -> AuthAttemptPolicy {
    let window_seconds = super::env_i64("FMARCH_AUTH_RATE_LIMIT_WINDOW_SECONDS", 900, 1, 86_400);
    let lockout_seconds = super::env_i64("FMARCH_AUTH_RATE_LIMIT_LOCKOUT_SECONDS", 900, 1, 86_400);
    let minimum_retention = window_seconds.max(lockout_seconds);
    AuthAttemptPolicy {
        account_max_failures: super::env_i64("FMARCH_AUTH_RATE_LIMIT_MAX_FAILURES", 5, 2, 100)
            as i32,
        source_max_failures: super::env_i64(
            "FMARCH_AUTH_SOURCE_RATE_LIMIT_MAX_FAILURES",
            50,
            2,
            10_000,
        ) as i32,
        registration_max_per_source: super::env_i64(
            "FMARCH_AUTH_REGISTRATION_SOURCE_LIMIT",
            5,
            2,
            10_000,
        ) as i32,
        window_seconds,
        lockout_seconds,
        retention_seconds: super::env_i64(
            "FMARCH_AUTH_RATE_LIMIT_RETENTION_SECONDS",
            minimum_retention.saturating_mul(4),
            minimum_retention,
            31_536_000,
        ),
        trust_source_header: std::env::var("FMARCH_TRUST_AUTH_SOURCE_HEADER")
            .ok()
            .as_deref()
            == Some("1"),
        source_signing_key: std::env::var("FMARCH_AUTH_SOURCE_SIGNING_KEY")
            .ok()
            .filter(|value| value.len() >= 32)
            .map(|value| Arc::<[u8]>::from(value.into_bytes())),
    }
}

pub(super) async fn deliver_auth_credential(
    state: &AuthHttpState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    request: &AuthCredentialDeliveryRequest<'_>,
) -> Result<AuthDeliveryReceipt, ApiError> {
    let delivery_id = Uuid::new_v4();
    let provider_id = state.identity_delivery_gateway.provider_id().to_string();
    let credential_envelope = eventstore::encrypt_delivery_credential(
        tx,
        request.credential_material,
        &delivery_aad(delivery_id, request.delivery_kind),
    )
    .await
    .map_err(|error| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("identity delivery payload could not be sealed: {error}"),
    })?;
    sqlx::query(
        r#"
        INSERT INTO auth_delivery_intent (
            delivery_id,
            delivery_kind,
            account_id,
            principal_id,
            credential_hash,
            credential_expires_at,
            credential_envelope,
            status,
            provider_id,
            outcome_kind,
            outcome_code,
            attempt_count,
            next_attempt_at,
            delivered_at,
            last_error,
            created_at,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::JSONB, 'queued', $8, 'queued', NULL, 0, $9, NULL, NULL, $9, $9)
        "#,
    )
    .bind(delivery_id)
    .bind(request.delivery_kind.as_str())
    .bind(request.account_id)
    .bind(request.principal_id.as_uuid())
    .bind(request.credential_hash)
    .bind(request.credential_expires_at)
    .bind(credential_envelope.to_string())
    .bind(&provider_id)
    .bind(request.now)
    .execute(&mut **tx)
    .await?;
    record_auth_delivery_audit(
        tx,
        &AuthDeliveryAudit {
            event_kind: "auth_delivery_queued",
            delivery_kind: request.delivery_kind.as_str(),
            account_id: request.account_id,
            actor_principal_id: request.principal_id,
            principal_id: request.principal_id,
            credential_hash: request.credential_hash,
            delivery_id,
            now: request.now,
            provider_id: provider_id.as_str(),
            outcome_kind: "queued",
            outcome_code: None,
        },
    )
    .await?;
    Ok(AuthDeliveryReceipt {
        delivery_id,
        status: "queued".to_string(),
        attempt_count: 0,
        provider_id,
        outcome_kind: "queued".to_string(),
        outcome_code: None,
    })
}

pub(super) async fn cancel_auth_delivery_intent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    credential_hash: &str,
    actor_principal_id: Option<&PrincipalId>,
    outcome_code: &str,
    now: i64,
) -> Result<i64, ApiError> {
    let cancelled = sqlx::query_as::<_, (Uuid, String, String, Uuid, String)>(
        r#"
        UPDATE auth_delivery_intent
        SET status = 'cancelled',
            outcome_kind = 'cancelled',
            outcome_code = $2,
            next_attempt_at = NULL,
            delivered_at = NULL,
            last_error = $2,
            provider_receipt_id = NULL,
            claim_token = NULL,
            claim_expires_at = NULL,
            credential_envelope = NULL,
            updated_at = $3
        WHERE credential_hash = $1
          AND status IN ('queued', 'retryable_failed', 'processing')
        RETURNING delivery_id, delivery_kind, account_id, principal_id, provider_id
        "#,
    )
    .bind(credential_hash)
    .bind(outcome_code)
    .bind(now)
    .fetch_all(&mut **tx)
    .await?;
    for (delivery_id, delivery_kind, account_id, principal_id, provider_id) in &cancelled {
        let principal_id = PrincipalId::from_uuid(*principal_id);
        record_auth_delivery_audit(
            tx,
            &AuthDeliveryAudit {
                event_kind: "auth_delivery_cancelled",
                delivery_kind: delivery_kind.as_str(),
                account_id: account_id.as_str(),
                actor_principal_id: actor_principal_id.unwrap_or(&principal_id),
                principal_id: &principal_id,
                credential_hash,
                delivery_id: *delivery_id,
                now,
                provider_id: provider_id.as_str(),
                outcome_kind: "cancelled",
                outcome_code: Some(outcome_code),
            },
        )
        .await?;
    }
    Ok(cancelled.len() as i64)
}

async fn record_auth_delivery_audit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    audit: &AuthDeliveryAudit<'_>,
) -> Result<(), ApiError> {
    let mut metadata = serde_json::json!({
        "delivery_id": audit.delivery_id,
        "delivery_kind": audit.delivery_kind,
        "adapter": audit.provider_id,
        "provider_id": audit.provider_id,
        "outcome_kind": audit.outcome_kind,
        "outcome_code": audit.outcome_code
    });
    if audit.delivery_kind != IdentityDeliveryKind::CommunityInvitation.as_str() {
        metadata["account_id"] = serde_json::Value::String(audit.account_id.to_string());
    }
    sqlx::query(
        r#"
        INSERT INTO identity_lifecycle_audit (
            event_at,
            event_kind,
            actor_principal_id,
            principal_id,
            token_hash,
            related_token_hash,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, NULL, $6::JSONB)
        "#,
    )
    .bind(audit.now)
    .bind(audit.event_kind)
    .bind(audit.actor_principal_id.as_uuid())
    .bind(audit.principal_id.as_uuid())
    .bind(audit.credential_hash)
    .bind(metadata.to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}
