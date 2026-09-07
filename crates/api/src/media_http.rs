//! Authenticated media upload and private variant-serving HTTP boundary.
//!
//! This module owns transport admission, quota reservation, upload format
//! validation, projection-reference authorization, and immutable response
//! metadata. Command-side media normalization remains with command preparation.

use super::auth_http::MethodAuthenticated;
use super::game_http::require_channel_thread_access;
use super::{acquire_workload_slot, ApiError, ApiState};
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::header::{CACHE_CONTROL, CONTENT_LENGTH, CONTENT_TYPE, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use media::{
    ContentId, IngestStatus, MediaError, VariantFormat, VariantGenerationStatus, VariantKind,
    VARIANT_RECIPE_REVISION,
};
use principal::PrincipalId;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

pub(super) fn routes(state: &ApiState) -> Router<ApiState> {
    let upload_limit = state.media_store.limits().max_encoded_bytes();
    Router::new()
        .route(
            "/media/uploads",
            post(media_upload).layer(DefaultBodyLimit::max(upload_limit)),
        )
        .route(
            "/media/thread/{game}/{channel}/{source_seq}/{content_id}/{asset}",
            get(media_thread_variant),
        )
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaUploadResponse {
    pub content_id: String,
    pub intrinsic_width: u32,
    pub intrinsic_height: u32,
    pub variant_recipe_revision: String,
    pub variants: Vec<MediaUploadVariant>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaUploadVariant {
    pub format: String,
    pub kind: String,
    pub mime_type: String,
    pub width: u32,
    pub height: u32,
    pub encoded_len: u64,
    pub blake3: String,
    pub has_alpha: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeclaredUploadFormat {
    Png,
    Jpeg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MediaQuotaClaim {
    InstallLease,
    AlreadyReady,
}

async fn media_upload(
    State(state): State<ApiState>,
    MethodAuthenticated(authorization): MethodAuthenticated,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let principal_id = authorization.context.principal_id;
    let media_permit = acquire_workload_slot(
        &state.media_slots,
        "media processing capacity is exhausted; retry shortly",
    )?;
    let declared_format = declared_upload_format(&headers)?;
    if sniff_upload_format(&body) != Some(declared_format) {
        return Err(media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "declared media type does not match PNG/JPEG bytes",
        ));
    }

    let store = state.media_store.clone();
    let variant_limits = state.variant_limits;
    let encoded = body.to_vec();
    let prepared = match store
        .prepare_upload_with_guard(encoded, variant_limits, media_permit)
        .await
    {
        Ok(prepared) => prepared,
        Err(error) => return Err(media_api_error(error)),
    };
    let content_id = prepared.handle().id();
    let stored_bytes = i64::try_from(prepared.stored_footprint_bytes()).map_err(|_| {
        media_internal_error("prepared media footprint exceeds quota arithmetic".to_string())
    })?;
    let (upload_id, quota_claim) = reserve_media_quota(
        &state.pool,
        state.media_account_quota_bytes,
        state.media_upload_lease_seconds,
        principal_id,
        stored_bytes,
        content_id,
    )
    .await?;
    let committed = match store.commit_guarded_prepared_upload(prepared).await {
        Ok(committed) => committed,
        // Object-store failures are commit-ambiguous. The fenced journal lease is retained so an
        // identical retry can verify/reuse immutable objects and converge instead of erasing the
        // only recovery evidence.
        Err(error) => return Err(media_api_error(error)),
    };
    let ingest = committed.ingest();
    let variants = committed.variants();
    if quota_claim == MediaQuotaClaim::InstallLease {
        complete_media_quota_content(&state.pool, upload_id, principal_id, content_id).await?;
    }

    let response = MediaUploadResponse {
        content_id: ingest.handle().id().to_string(),
        intrinsic_width: ingest.handle().width(),
        intrinsic_height: ingest.handle().height(),
        variant_recipe_revision: VARIANT_RECIPE_REVISION.to_string(),
        variants: variants
            .set()
            .variants()
            .iter()
            .map(|record| MediaUploadVariant {
                format: record.key().format().to_string(),
                kind: record.key().kind().to_string(),
                mime_type: record.mime_type().to_string(),
                width: record.width(),
                height: record.height(),
                encoded_len: record.encoded_len(),
                blake3: record.blake3().to_string(),
                has_alpha: record.has_alpha(),
            })
            .collect(),
    };
    let status = if ingest.status() == IngestStatus::Stored
        || variants.status() == VariantGenerationStatus::Stored
    {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(response)))
}

async fn reserve_media_quota(
    pool: &PgPool,
    account_quota_bytes: i64,
    lease_seconds: i64,
    principal_id: PrincipalId,
    stored_bytes: i64,
    content_id: ContentId,
) -> Result<(Uuid, MediaQuotaClaim), ApiError> {
    let upload_id = Uuid::new_v4();
    let mut tx = pool.begin().await?;
    let content_id = content_id.to_string();
    lock_media_install(&mut tx, &content_id).await?;
    lock_media_quota(&mut tx, principal_id).await?;
    let now = database_now(&mut tx).await?;
    let lease_expires_at = now.checked_add(lease_seconds).ok_or_else(|| {
        media_internal_error("media upload lease deadline overflowed".to_string())
    })?;
    let existing = sqlx::query_as::<_, (Uuid, i64, String, Option<Uuid>, Option<i64>)>(
        "SELECT upload_id, stored_bytes, state, lease_token, lease_expires_at FROM media_upload_ledger WHERE principal_id = $1 AND content_id = $2",
    )
    .bind(principal_id.as_uuid())
    .bind(&content_id)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some((_, charged_bytes, state, _, expires_at)) = &existing {
        if *charged_bytes != stored_bytes {
            return Err(media_internal_error(
                "media upload journal footprint is inconsistent".to_string(),
            ));
        }
        if state == "ready" {
            tx.commit().await?;
            return Ok((upload_id, MediaQuotaClaim::AlreadyReady));
        }
        if matches!(state.as_str(), "installing" | "reclaiming")
            && expires_at.is_some_and(|deadline| deadline > now)
        {
            return Err(ApiError::Unavailable {
                retry_after_seconds: 1,
                message: "identical media is already being installed; retry shortly".to_string(),
            });
        }
    }

    let used = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(stored_bytes), 0)::BIGINT FROM media_upload_ledger WHERE principal_id = $1 AND state <> 'failed' AND content_id <> $2",
    )
    .bind(principal_id.as_uuid())
    .bind(&content_id)
    .fetch_one(&mut *tx)
    .await?;
    if used.saturating_add(stored_bytes) > account_quota_bytes {
        return Err(ApiError::Reject {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            error: wire::RejectCode::NotAuthorized,
            message: "account media storage quota is exhausted".to_string(),
        });
    }
    if existing.is_some() {
        sqlx::query(
            "UPDATE media_upload_ledger SET upload_id = $3, stored_bytes = $4, state = 'installing', lease_token = $3, lease_expires_at = $5, updated_at = $6 WHERE principal_id = $1 AND content_id = $2",
        )
        .bind(principal_id.as_uuid())
        .bind(&content_id)
        .bind(upload_id)
        .bind(stored_bytes)
        .bind(lease_expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO media_upload_ledger (upload_id, principal_id, stored_bytes, content_id, state, lease_token, lease_expires_at, created_at, updated_at) VALUES ($1, $2, $3, $4, 'installing', $1, $5, $6, $6)",
        )
        .bind(upload_id)
        .bind(principal_id.as_uuid())
        .bind(stored_bytes)
        .bind(&content_id)
        .bind(lease_expires_at)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok((upload_id, MediaQuotaClaim::InstallLease))
}

async fn complete_media_quota_content(
    pool: &PgPool,
    upload_id: Uuid,
    principal_id: PrincipalId,
    content_id: ContentId,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    let content_id = content_id.to_string();
    lock_media_install(&mut tx, &content_id).await?;
    lock_media_quota(&mut tx, principal_id).await?;
    let now = database_now(&mut tx).await?;
    let updated = sqlx::query(
        "UPDATE media_upload_ledger SET state = 'ready', lease_token = NULL, lease_expires_at = NULL, updated_at = $4 WHERE principal_id = $1 AND content_id = $2 AND upload_id = $3 AND lease_token = $3 AND state = 'installing'",
    )
    .bind(principal_id.as_uuid())
    .bind(&content_id)
    .bind(upload_id)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        let state = sqlx::query_scalar::<_, String>(
            "SELECT state FROM media_upload_ledger WHERE principal_id = $1 AND content_id = $2",
        )
        .bind(principal_id.as_uuid())
        .bind(&content_id)
        .fetch_optional(&mut *tx)
        .await?;
        if state.as_deref() == Some("ready") {
            tx.commit().await?;
            return Ok(());
        }
        return Err(sqlx::Error::Protocol(
            "media upload has no matching install lease to complete".to_string(),
        ));
    }
    tx.commit().await?;
    Ok(())
}

async fn lock_media_quota(
    tx: &mut Transaction<'_, Postgres>,
    principal_id: PrincipalId,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("media-quota:{principal_id}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn lock_media_install(
    tx: &mut Transaction<'_, Postgres>,
    content_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("media-install:{content_id}"))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn database_now(tx: &mut Transaction<'_, Postgres>) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>("SELECT floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT")
        .fetch_one(&mut **tx)
        .await
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MediaReconciliationReport {
    pub examined: u64,
    pub quarantined: u64,
    pub restored_ready: u64,
    pub deferred: u64,
    pub failures: u64,
}

impl MediaReconciliationReport {
    pub fn completed(self) -> u64 {
        self.restored_ready
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MediaReconciliationClaim {
    Quarantined,
    Recover { lease_token: Uuid },
}

/// Advance expired upload operations through a two-lease recovery fence.
///
/// The first expired lease is only quarantined. A later pass probes the installed-last manifest;
/// complete installs become ready, while operations without a manifest remain quota-bearing and
/// are probed again after the recovery lease. A database lease cannot fence a delayed object-store
/// writer, so neither deleting fragments nor releasing their charge is safe after one negative
/// probe. The journal row is never deleted, keeping the ambiguous outcome auditable and allowing
/// an identical retry to converge under a fresh fenced lease.
pub async fn reconcile_media_uploads_once(
    state: &ApiState,
    batch_size: i64,
) -> Result<MediaReconciliationReport, sqlx::Error> {
    reconcile_media_uploads_with(
        &state.pool,
        &state.media_store,
        state.variant_limits,
        state.media_upload_lease_seconds,
        batch_size,
    )
    .await
}

async fn reconcile_media_uploads_with(
    pool: &PgPool,
    store: &media::MediaRepository,
    limits: media::VariantLimits,
    lease_seconds: i64,
    batch_size: i64,
) -> Result<MediaReconciliationReport, sqlx::Error> {
    let candidates = sqlx::query_scalar::<_, String>(
        r#"
        SELECT content_id
        FROM media_upload_ledger
        WHERE state IN ('installing', 'reclaiming')
          AND lease_expires_at <= floor(EXTRACT(EPOCH FROM clock_timestamp()))::BIGINT
        GROUP BY content_id
        ORDER BY MIN(lease_expires_at), content_id
        LIMIT $1
        "#,
    )
    .bind(batch_size)
    .fetch_all(pool)
    .await?;
    let mut report = MediaReconciliationReport::default();
    for content_id in candidates {
        report.examined = report.examined.saturating_add(1);
        let Some(claim) = claim_media_reconciliation(pool, &content_id, lease_seconds).await?
        else {
            continue;
        };
        match claim {
            MediaReconciliationClaim::Quarantined => {
                report.quarantined = report.quarantined.saturating_add(1);
            }
            MediaReconciliationClaim::Recover { lease_token } => {
                let id = match content_id.parse::<ContentId>() {
                    Ok(id) => id,
                    Err(_) => {
                        report.failures = report.failures.saturating_add(1);
                        tracing::error!(
                            event = "media_reconciliation_invalid_content_id",
                            "media reconciliation journal contains an invalid content identity"
                        );
                        continue;
                    }
                };
                match store.probe_installed_manifest(id, limits).await {
                    Ok(Some(_)) => {
                        if finish_media_reconciliation(pool, &content_id, lease_token, "ready")
                            .await?
                        {
                            report.restored_ready = report.restored_ready.saturating_add(1);
                        }
                    }
                    Ok(None) => {
                        // Keep the second lease and its quota charge. The original object-store
                        // writer may still publish the installed-last manifest after this probe;
                        // its token cannot be fenced by PostgreSQL once the remote request exists.
                        report.deferred = report.deferred.saturating_add(1);
                    }
                    Err(_) => {
                        report.failures = report.failures.saturating_add(1);
                        tracing::error!(
                            event = "media_reconciliation_probe_failed",
                            %content_id,
                            "media reconciliation could not classify an expired install"
                        );
                    }
                }
            }
        }
    }
    Ok(report)
}

async fn claim_media_reconciliation(
    pool: &PgPool,
    content_id: &str,
    lease_seconds: i64,
) -> Result<Option<MediaReconciliationClaim>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    lock_media_install(&mut tx, content_id).await?;
    let now = database_now(&mut tx).await?;
    let states = sqlx::query_as::<_, (String, Option<i64>)>(
        "SELECT state, lease_expires_at FROM media_upload_ledger WHERE content_id = $1 FOR UPDATE",
    )
    .bind(content_id)
    .fetch_all(&mut *tx)
    .await?;
    if states.iter().any(|(state, expires_at)| {
        matches!(state.as_str(), "installing" | "reclaiming")
            && expires_at.is_some_and(|deadline| deadline > now)
    }) {
        tx.commit().await?;
        return Ok(None);
    }
    let has_installing = states.iter().any(|(state, _)| state == "installing");
    let has_reclaiming = states.iter().any(|(state, _)| state == "reclaiming");
    if !has_installing && !has_reclaiming {
        tx.commit().await?;
        return Ok(None);
    }
    let lease_token = Uuid::new_v4();
    let lease_expires_at = now.checked_add(lease_seconds).ok_or_else(|| {
        sqlx::Error::Protocol("media reconciliation lease deadline overflowed".to_string())
    })?;
    sqlx::query(
        "UPDATE media_upload_ledger SET state = 'reclaiming', lease_token = $2, lease_expires_at = $3, updated_at = $4 WHERE content_id = $1 AND state IN ('installing', 'reclaiming')",
    )
    .bind(content_id)
    .bind(lease_token)
    .bind(lease_expires_at)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Some(if has_installing {
        MediaReconciliationClaim::Quarantined
    } else {
        MediaReconciliationClaim::Recover { lease_token }
    }))
}

async fn finish_media_reconciliation(
    pool: &PgPool,
    content_id: &str,
    lease_token: Uuid,
    terminal_state: &'static str,
) -> Result<bool, sqlx::Error> {
    debug_assert!(matches!(terminal_state, "ready" | "failed"));
    let mut tx = pool.begin().await?;
    lock_media_install(&mut tx, content_id).await?;
    if terminal_state == "failed" {
        let principals = sqlx::query_scalar::<_, Uuid>(
            "SELECT principal_id FROM media_upload_ledger WHERE content_id = $1 AND state = 'reclaiming' AND lease_token = $2 ORDER BY principal_id FOR UPDATE",
        )
        .bind(content_id)
        .bind(lease_token)
        .fetch_all(&mut *tx)
        .await?;
        for principal_id in principals {
            sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
                .bind(format!("media-quota:{principal_id}"))
                .execute(&mut *tx)
                .await?;
        }
    }
    let now = database_now(&mut tx).await?;
    let updated = sqlx::query(
        "UPDATE media_upload_ledger SET state = $3, lease_token = NULL, lease_expires_at = NULL, updated_at = $4 WHERE content_id = $1 AND state = 'reclaiming' AND lease_token = $2",
    )
    .bind(content_id)
    .bind(lease_token)
    .bind(terminal_state)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(updated.rows_affected() > 0)
}

fn declared_upload_format(headers: &HeaderMap) -> Result<DeclaredUploadFormat, ApiError> {
    let media_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim);
    match media_type {
        Some(value) if value.eq_ignore_ascii_case("image/png") => Ok(DeclaredUploadFormat::Png),
        Some(value) if value.eq_ignore_ascii_case("image/jpeg") => Ok(DeclaredUploadFormat::Jpeg),
        _ => Err(media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "content-type must be image/png or image/jpeg",
        )),
    }
}

fn sniff_upload_format(bytes: &[u8]) -> Option<DeclaredUploadFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(DeclaredUploadFormat::Png)
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(DeclaredUploadFormat::Jpeg)
    } else {
        None
    }
}

fn media_api_error(error: MediaError) -> ApiError {
    match error {
        MediaError::EncodedInputTooLarge { .. } => media_request_reject(
            StatusCode::PAYLOAD_TOO_LARGE,
            "encoded media exceeds the upload limit",
        ),
        MediaError::UnsupportedFormat => media_request_reject(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "only PNG and JPEG uploads are supported",
        ),
        MediaError::MalformedImage(_)
        | MediaError::DimensionsExceeded { .. }
        | MediaError::PixelCountExceeded { .. }
        | MediaError::DecodedBytesExceeded { .. }
        | MediaError::DecoderResourceLimit(_)
        | MediaError::VariantDimensionsExceeded { .. }
        | MediaError::VariantPixelCountExceeded { .. }
        | MediaError::VariantEncodedBytesExceeded { .. }
        | MediaError::VariantAggregateBytesExceeded { .. } => media_request_reject(
            StatusCode::UNPROCESSABLE_ENTITY,
            "media cannot be processed within configured limits",
        ),
        MediaError::ObjectStore { .. } | MediaError::ReadCapacityExhausted { .. } => {
            ApiError::Unavailable {
                retry_after_seconds: 1,
                message: "media storage is temporarily unavailable; retry shortly".to_string(),
            }
        }
        _ => {
            tracing::error!("media upload preparation failed");
            media_internal_error("media upload preparation failed".to_string())
        }
    }
}

fn media_request_reject(status: StatusCode, message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status,
        error: wire::RejectCode::Internal,
        message: message.into(),
    }
}

fn media_internal_error(message: String) -> ApiError {
    ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: wire::RejectCode::Internal,
        message,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ThreadMediaAsset {
    kind: VariantKind,
    format: VariantFormat,
}

async fn media_thread_variant(
    State(state): State<ApiState>,
    Path((game, channel, source_seq, content_id, asset)): Path<(Uuid, String, i64, String, String)>,
    MethodAuthenticated(authorization): MethodAuthenticated,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let principal_id = authorization.context.principal_id;
    if channel != "main" {
        require_channel_thread_access(&state.pool, game, channel.as_str(), Some(principal_id))
            .await?;
    }

    let id = content_id
        .parse::<ContentId>()
        .map_err(|_| media_not_found("media reference unavailable"))?;
    let asset = parse_thread_media_asset(asset.as_str())
        .ok_or_else(|| media_not_found("media variant unavailable"))?;
    let projected_media = sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT post.media
        FROM thread_view AS post
        WHERE post.game_id = $1
          AND post.channel_id = $2
          AND post.source_seq = $3
          AND (
            post.channel_id <> 'main'
            OR NOT EXISTS (
              SELECT 1
              FROM moderation_target_state AS moderation
              WHERE moderation.surface_id = post.game_id
                AND moderation.source_seq = post.source_seq
                AND moderation.visibility = 'hidden'
            )
          )
        "#,
    )
    .bind(game)
    .bind(channel.as_str())
    .bind(source_seq)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| media_not_found("media reference unavailable"))?;
    if !projected_media_references_variant(&projected_media, id, asset.kind) {
        return Err(media_not_found(
            "media variant is not referenced by this post",
        ));
    }

    let stored = state
        .media_store
        .lookup_variant(id, asset.format, asset.kind, state.variant_limits)
        .await
        .map_err(media_lookup_error)?
        .ok_or_else(|| media_not_found("media variant unavailable"))?;

    let (record, encoded_bytes) = stored.into_parts();
    let etag = format!("\"{}\"", record.blake3());
    let reference = format!("{game}/{channel}/{source_seq}/{id}");
    let not_modified = if_none_match_matches(&headers, etag.as_str());
    let mut response = if not_modified {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (StatusCode::OK, encoded_bytes).into_response()
    };
    let response_headers = response.headers_mut();
    response_headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static(asset.format.mime_type()),
    );
    response_headers.insert(CACHE_CONTROL, HeaderValue::from_static("private, no-cache"));
    if !not_modified {
        response_headers.insert(
            CONTENT_LENGTH,
            header_value(record.encoded_len().to_string(), "media content length")?,
        );
    }
    response_headers.insert(ETAG, header_value(etag, "media etag")?);
    response_headers.insert(
        "x-fmarch-media-content-address",
        header_value(id.to_string(), "media content address")?,
    );
    response_headers.insert(
        "x-fmarch-media-channel",
        header_value(channel, "media channel")?,
    );
    response_headers.insert(
        "x-fmarch-media-post-seq",
        header_value(source_seq.to_string(), "media post sequence")?,
    );
    response_headers.insert(
        "x-fmarch-media-reference",
        header_value(reference, "media reference")?,
    );
    response_headers.insert(
        "x-fmarch-media-variant",
        HeaderValue::from_static(match asset.kind {
            VariantKind::Thumb => "thumb",
            VariantKind::Tablet => "tablet",
            VariantKind::FullBounded => "full-bounded",
        }),
    );
    response_headers.insert(
        "x-fmarch-media-format",
        HeaderValue::from_static(match asset.format {
            VariantFormat::Avif => "avif",
            VariantFormat::Webp => "webp",
        }),
    );
    Ok(response)
}

fn media_lookup_error(error: MediaError) -> ApiError {
    if matches!(
        error,
        MediaError::ReadCapacityExhausted { .. } | MediaError::ObjectStore { .. }
    ) {
        return ApiError::Unavailable {
            retry_after_seconds: 1,
            message: "media storage is temporarily unavailable; retry shortly".to_string(),
        };
    }
    let _ = error;
    tracing::error!(
        event = "thread_media_lookup_failed",
        "thread media lookup failed"
    );
    media_internal_error("thread media lookup failed".to_string())
}

fn if_none_match_matches(headers: &HeaderMap, etag: &str) -> bool {
    let Some(value) = headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    value.split(',').any(|candidate| {
        let candidate = candidate.trim();
        candidate == "*" || candidate.strip_prefix("W/").unwrap_or(candidate) == etag
    })
}

fn parse_thread_media_asset(value: &str) -> Option<ThreadMediaAsset> {
    let (kind, format) = value.rsplit_once('.')?;
    let kind = match kind {
        "thumb" => VariantKind::Thumb,
        "tablet" => VariantKind::Tablet,
        "full-bounded" => VariantKind::FullBounded,
        _ => return None,
    };
    let format = match format {
        "avif" => VariantFormat::Avif,
        "webp" => VariantFormat::Webp,
        _ => return None,
    };
    Some(ThreadMediaAsset { kind, format })
}

fn projected_media_references_variant(
    value: &serde_json::Value,
    id: ContentId,
    kind: VariantKind,
) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    let kind = match kind {
        VariantKind::Thumb => "thumb",
        VariantKind::Tablet => "tablet",
        VariantKind::FullBounded => "full-bounded",
    };
    let id = id.to_string();
    items.iter().any(|item| {
        item.get("content_id").and_then(serde_json::Value::as_str) == Some(id.as_str())
            && item
                .get("variants")
                .and_then(|variants| variants.get(kind))
                .is_some_and(serde_json::Value::is_object)
    })
}

fn header_value(value: impl AsRef<str>, label: &'static str) -> Result<HeaderValue, ApiError> {
    HeaderValue::from_str(value.as_ref()).map_err(|_| {
        tracing::error!(label, "invalid media response header");
        media_internal_error("thread media response metadata is invalid".to_string())
    })
}

fn media_not_found(message: impl Into<String>) -> ApiError {
    ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: wire::RejectCode::Internal,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn insert_principal(pool: &PgPool, principal_id: PrincipalId) {
        sqlx::query(
            "INSERT INTO platform_principal (principal_id, status, global_capabilities, created_at) VALUES ($1, 'active', '{}'::TEXT[], 1)",
        )
        .bind(principal_id.as_uuid())
        .execute(pool)
        .await
        .unwrap();
    }

    #[sqlx::test(migrations = "../database_schema/migrations")]
    async fn expired_install_evidence_remains_quota_bearing_until_recovered(pool: PgPool) {
        let principal_id = PrincipalId::fixture("media-quota-recovery");
        insert_principal(&pool, principal_id).await;
        let first_content = ContentId::from_bytes([7; 32]);
        let second_content = ContentId::from_bytes([8; 32]);
        let (first_upload, first_claim) =
            reserve_media_quota(&pool, 100, 60, principal_id, 70, first_content)
                .await
                .unwrap();
        assert_eq!(first_claim, MediaQuotaClaim::InstallLease);
        sqlx::query("UPDATE media_upload_ledger SET lease_expires_at = 0 WHERE upload_id = $1")
            .bind(first_upload)
            .execute(&pool)
            .await
            .unwrap();

        assert!(matches!(
            reserve_media_quota(&pool, 100, 60, principal_id, 40, second_content).await,
            Err(ApiError::Reject {
                status: StatusCode::PAYLOAD_TOO_LARGE,
                ..
            })
        ));
        let (replacement, replacement_claim) =
            reserve_media_quota(&pool, 100, 60, principal_id, 70, first_content)
                .await
                .unwrap();
        assert_ne!(replacement, first_upload);
        assert_eq!(replacement_claim, MediaQuotaClaim::InstallLease);
        complete_media_quota_content(&pool, replacement, principal_id, first_content)
            .await
            .unwrap();

        let row = sqlx::query_as::<_, (i64, String, Option<Uuid>, Option<i64>)>(
            "SELECT stored_bytes, state, lease_token, lease_expires_at FROM media_upload_ledger WHERE principal_id = $1 AND content_id = $2",
        )
        .bind(principal_id.as_uuid())
        .bind(first_content.to_string())
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row, (70, "ready".to_string(), None, None));
    }

    #[sqlx::test(migrations = "../database_schema/migrations")]
    async fn same_principal_content_has_one_fenced_charge_across_retries(pool: PgPool) {
        let principal_id = PrincipalId::fixture("media-quota-retry");
        insert_principal(&pool, principal_id).await;
        let content_id = ContentId::from_bytes([9; 32]);

        let (abandoned, first_claim) =
            reserve_media_quota(&pool, 100, 60, principal_id, 100, content_id)
                .await
                .unwrap();
        assert_eq!(first_claim, MediaQuotaClaim::InstallLease);
        assert!(matches!(
            reserve_media_quota(&pool, 100, 60, principal_id, 100, content_id).await,
            Err(ApiError::Unavailable { .. })
        ));
        sqlx::query("UPDATE media_upload_ledger SET lease_expires_at = 0 WHERE upload_id = $1")
            .bind(abandoned)
            .execute(&pool)
            .await
            .unwrap();

        let (retry, retry_claim) =
            reserve_media_quota(&pool, 100, 60, principal_id, 100, content_id)
                .await
                .unwrap();
        assert_eq!(retry_claim, MediaQuotaClaim::InstallLease);
        assert!(
            complete_media_quota_content(&pool, abandoned, principal_id, content_id)
                .await
                .is_err()
        );
        complete_media_quota_content(&pool, retry, principal_id, content_id)
            .await
            .unwrap();

        let (_repeated, repeated_claim) =
            reserve_media_quota(&pool, 100, 60, principal_id, 100, content_id)
                .await
                .unwrap();
        assert_eq!(repeated_claim, MediaQuotaClaim::AlreadyReady);

        let rows = sqlx::query_as::<_, (Uuid, i64, String)>(
            "SELECT upload_id, stored_bytes, content_id FROM media_upload_ledger WHERE principal_id = $1",
        )
        .bind(principal_id.as_uuid())
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows, vec![(retry, 100, content_id.to_string())]);
    }

    #[sqlx::test(migrations = "../database_schema/migrations")]
    async fn reconciliation_keeps_an_incomplete_install_quota_bearing(pool: PgPool) {
        let principal_id = PrincipalId::fixture("media-reconciliation");
        insert_principal(&pool, principal_id).await;
        let content_id = ContentId::from_bytes([11; 32]);
        let upload_id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO media_upload_ledger (upload_id, principal_id, stored_bytes, content_id, state, lease_token, lease_expires_at, created_at, updated_at) VALUES ($1, $2, 10, $3, 'installing', $1, 0, 0, 0)",
        )
        .bind(upload_id)
        .bind(principal_id.as_uuid())
        .bind(content_id.to_string())
        .execute(&pool)
        .await
        .unwrap();
        let store = media::MediaRepository::in_memory(
            media::MediaLimits::default(),
            media::MediaReadLimits::default(),
        )
        .unwrap();

        let quarantined =
            reconcile_media_uploads_with(&pool, &store, media::VariantLimits::default(), 60, 10)
                .await
                .unwrap();
        assert_eq!(quarantined.quarantined, 1);
        assert_eq!(quarantined.deferred, 0);
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT state FROM media_upload_ledger WHERE upload_id = $1",
            )
            .bind(upload_id)
            .fetch_one(&pool)
            .await
            .unwrap(),
            "reclaiming"
        );

        sqlx::query("UPDATE media_upload_ledger SET lease_expires_at = 0 WHERE upload_id = $1")
            .bind(upload_id)
            .execute(&pool)
            .await
            .unwrap();
        let deferred =
            reconcile_media_uploads_with(&pool, &store, media::VariantLimits::default(), 60, 10)
                .await
                .unwrap();
        assert_eq!(deferred.deferred, 1);
        assert_eq!(deferred.failures, 0);
        let (state, lease_token, lease_expires_at) =
            sqlx::query_as::<_, (String, Option<Uuid>, Option<i64>)>(
                "SELECT state, lease_token, lease_expires_at FROM media_upload_ledger WHERE upload_id = $1",
            )
            .bind(upload_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(state, "reclaiming");
        assert!(lease_token.is_some());
        assert!(lease_expires_at.is_some_and(|deadline| deadline > 0));
        assert!(matches!(
            reserve_media_quota(
                &pool,
                10,
                60,
                principal_id,
                1,
                ContentId::from_bytes([12; 32]),
            )
            .await,
            Err(ApiError::Reject {
                status: StatusCode::PAYLOAD_TOO_LARGE,
                ..
            })
        ));
    }
}
