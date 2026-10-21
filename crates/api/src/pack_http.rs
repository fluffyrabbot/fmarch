//! Public role reference (RFC 0009).
//!
//! These reads take a pack key and nothing else: they serve pack rules joined
//! with pack-owned copy, so they cannot express who holds a role in any game.
//! The embedded registry is immutable for the life of the process, so its hash
//! is a strong validator for both responses.

use axum::extract::Path;
use axum::http::header::{CACHE_CONTROL, ETAG, IF_NONE_MATCH};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use content_registry::ContentRegistry;
use serde::Serialize;
use wire::{PackCatalogPage, RejectCode};

use super::{ApiError, ApiState};

const PUBLIC_REFERENCE_CACHE: &str = "public, max-age=300";

pub(super) fn routes() -> Router<ApiState> {
    Router::new()
        .route("/packs", get(pack_catalog))
        .route("/packs/{pack}/roles", get(pack_roles))
}

async fn pack_catalog(headers: HeaderMap) -> Result<Response, ApiError> {
    let registry = registry()?;
    let mut packs: Vec<_> = registry
        .packs()
        .iter()
        .map(|artifact| artifact.summary())
        .collect();
    packs.sort_by(|left, right| left.name.cmp(&right.name).then(left.key.cmp(&right.key)));
    Ok(cached(&headers, registry, PackCatalogPage { packs }))
}

async fn pack_roles(Path(pack): Path<String>, headers: HeaderMap) -> Result<Response, ApiError> {
    let registry = registry()?;
    let artifact = registry.pack(&pack).map_err(|_| ApiError::Reject {
        status: StatusCode::NOT_FOUND,
        error: RejectCode::InvalidArgument,
        message: format!("unknown pack `{pack}`"),
    })?;
    Ok(cached(&headers, registry, artifact.role_reference()))
}

fn registry() -> Result<&'static ContentRegistry, ApiError> {
    content_registry::product_registry().map_err(|error| ApiError::Reject {
        status: StatusCode::INTERNAL_SERVER_ERROR,
        error: RejectCode::Internal,
        message: format!("initialize embedded content registry: {error}"),
    })
}

fn cached<T: Serialize>(headers: &HeaderMap, registry: &ContentRegistry, body: T) -> Response {
    let etag = format!("\"{}\"", registry.registry_hash());
    let mut response = if headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.split(',').any(|tag| tag.trim() == etag))
    {
        StatusCode::NOT_MODIFIED.into_response()
    } else {
        Json(body).into_response()
    };
    let response_headers = response.headers_mut();
    response_headers.insert(
        CACHE_CONTROL,
        HeaderValue::from_static(PUBLIC_REFERENCE_CACHE),
    );
    if let Ok(value) = HeaderValue::from_str(&etag) {
        response_headers.insert(ETAG, value);
    }
    response
}
