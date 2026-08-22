//! Authenticated media upload and private variant-serving HTTP boundary.
//!
//! This module owns transport admission, quota reservation, upload format
//! validation, projection-reference authorization, and immutable response
//! metadata. Command-side media normalization remains with command preparation.

use super::auth_http::{bearer_token, require_method_authorization};
use super::game_http::require_channel_thread_access;
use super::{acquire_workload_slot, unauthorized_session, unix_now_seconds, ApiError, ApiState};
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
use sqlx::PgPool;
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

async fn media_upload(
    State(state): State<ApiState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<impl IntoResponse, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let authorization = require_method_authorization(&state.auth, token).await?;
    let principal_id = authorization.principal_id;
    let _media_permit = acquire_workload_slot(
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
    let upload_id = reserve_media_quota(&state, principal_id, encoded.len() as i64).await?;
    let committed = match store
        .prepare_and_commit_upload(encoded, variant_limits)
        .await
    {
        Ok(committed) => committed,
        Err(error) => {
            release_media_quota(&state.pool, upload_id).await;
            return Err(media_api_error(error));
        }
    };
    let ingest = committed.ingest();
    let variants = committed.variants();
    sqlx::query("UPDATE media_upload_ledger SET content_id = $2 WHERE upload_id = $1")
        .bind(upload_id)
        .bind(ingest.handle().id().to_string())
        .execute(&state.pool)
        .await?;

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
    state: &ApiState,
    principal_id: PrincipalId,
    encoded_bytes: i64,
) -> Result<Uuid, ApiError> {
    let upload_id = Uuid::new_v4();
    let now = unix_now_seconds();
    let mut tx = state.pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("media-quota:{principal_id}"))
        .execute(&mut *tx)
        .await?;
    let used = sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(encoded_bytes), 0)::BIGINT FROM media_upload_ledger WHERE principal_id = $1",
    )
    .bind(principal_id.as_uuid())
    .fetch_one(&mut *tx)
    .await?;
    if used.saturating_add(encoded_bytes) > state.media_account_quota_bytes {
        return Err(ApiError::Reject {
            status: StatusCode::PAYLOAD_TOO_LARGE,
            error: wire::RejectCode::NotAuthorized,
            message: "account media storage quota is exhausted".to_string(),
        });
    }
    sqlx::query(
        "INSERT INTO media_upload_ledger (upload_id, principal_id, encoded_bytes, content_id, created_at) VALUES ($1, $2, $3, NULL, $4)",
    )
    .bind(upload_id)
    .bind(principal_id.as_uuid())
    .bind(encoded_bytes)
    .bind(now)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(upload_id)
}

async fn release_media_quota(pool: &PgPool, upload_id: Uuid) {
    if sqlx::query("DELETE FROM media_upload_ledger WHERE upload_id = $1")
        .bind(upload_id)
        .execute(pool)
        .await
        .is_err()
    {
        tracing::error!(%upload_id, "failed to release media quota reservation");
    }
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
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    let authorization = require_method_authorization(&state.auth, token).await?;
    let principal_id = authorization.principal_id;
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
        .map_err(|_| {
            tracing::error!("thread media lookup failed");
            media_internal_error("thread media lookup failed".to_string())
        })?
        .ok_or_else(|| media_not_found("media variant unavailable"))?;

    let record = stored.record();
    let etag = format!("\"{}\"", record.blake3());
    let reference = format!("{game}/{channel}/{source_seq}/{id}");
    let not_modified = if_none_match_matches(&headers, etag.as_str());
    let mut response = if not_modified {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        (
            StatusCode::OK,
            Bytes::copy_from_slice(stored.encoded_bytes()),
        )
            .into_response()
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
