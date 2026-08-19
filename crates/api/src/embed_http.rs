//! Authenticated YouTube oEmbed lookup. Command decisioning stays in `commands`;
//! this boundary fetches a write-time snapshot before the game lock is taken.

use super::auth_http::{bearer_token, require_method_authorization};
use super::{unauthorized_session, ApiError, ApiState};
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use community::{
    decide_post_embed, snapshot_from_oembed, youtube_oembed_query, EmbedSnapshot, PostEmbed,
    YOUTUBE_OEMBED_ORIGIN, YOUTUBE_OEMBED_PATH,
};
use reqwest::redirect::Policy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use wire::{PostEmbed as WirePostEmbed, RejectCode};

const OEMBED_TIMEOUT: Duration = Duration::from_secs(2);
const OEMBED_MAX_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct YoutubeSnapshotLookup {
    inner: Arc<YoutubeSnapshotLookupInner>,
}

enum YoutubeSnapshotLookupInner {
    Http(HttpYoutubeSnapshotLookup),
    Map(MapYoutubeSnapshotLookup),
}

#[derive(Clone)]
struct HttpYoutubeSnapshotLookup {
    client: Client,
    origin: String,
}

#[derive(Clone, Default)]
struct MapYoutubeSnapshotLookup {
    snapshots: HashMap<String, EmbedSnapshot>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YoutubeSnapshotError {
    Unavailable,
}

impl YoutubeSnapshotLookup {
    pub fn http() -> Result<Self, String> {
        let client = Client::builder()
            .timeout(OEMBED_TIMEOUT)
            .redirect(Policy::none())
            .user_agent("fmarch-embed-lookup/0.1")
            .build()
            .map_err(|error| format!("youtube oembed client: {error}"))?;
        Ok(Self {
            inner: Arc::new(YoutubeSnapshotLookupInner::Http(HttpYoutubeSnapshotLookup {
                client,
                origin: YOUTUBE_OEMBED_ORIGIN.to_string(),
            })),
        })
    }

    pub fn map(snapshots: HashMap<String, EmbedSnapshot>) -> Self {
        Self {
            inner: Arc::new(YoutubeSnapshotLookupInner::Map(MapYoutubeSnapshotLookup {
                snapshots,
            })),
        }
    }

    pub async fn lookup(&self, provider_id: &str) -> Result<EmbedSnapshot, YoutubeSnapshotError> {
        match self.inner.as_ref() {
            YoutubeSnapshotLookupInner::Http(http) => http.lookup(provider_id).await,
            YoutubeSnapshotLookupInner::Map(map) => map
                .snapshots
                .get(provider_id)
                .cloned()
                .ok_or(YoutubeSnapshotError::Unavailable),
        }
    }
}

impl HttpYoutubeSnapshotLookup {
    async fn lookup(&self, provider_id: &str) -> Result<EmbedSnapshot, YoutubeSnapshotError> {
        let query = youtube_oembed_query(provider_id).ok_or(YoutubeSnapshotError::Unavailable)?;
        let url = format!(
            "{}{}?url={}&format={}",
            self.origin.trim_end_matches('/'),
            YOUTUBE_OEMBED_PATH,
            urlencoding_watch(&query.watch_url),
            query.format
        );
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|_| YoutubeSnapshotError::Unavailable)?;
        if !response.status().is_success() {
            return Err(YoutubeSnapshotError::Unavailable);
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| YoutubeSnapshotError::Unavailable)?;
        if bytes.len() > OEMBED_MAX_BYTES {
            return Err(YoutubeSnapshotError::Unavailable);
        }
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| YoutubeSnapshotError::Unavailable)?;
        snapshot_from_oembed(&value).map_err(|_| YoutubeSnapshotError::Unavailable)
    }
}

fn urlencoding_watch(watch_url: &str) -> String {
    let mut encoded = String::new();
    for byte in watch_url.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(byte as char);
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

pub(super) fn routes() -> Router<ApiState> {
    Router::new().route("/embeds/youtube/resolve", post(resolve_youtube_embed))
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct ResolveYoutubeEmbedRequest {
    url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct ResolveYoutubeEmbedResponse {
    embed: WirePostEmbed,
}

async fn resolve_youtube_embed(
    State(state): State<ApiState>,
    headers: HeaderMap,
    Json(body): Json<ResolveYoutubeEmbedRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let token = bearer_token(&headers).ok_or_else(unauthorized_session)?;
    require_method_authorization(&state.auth, token).await?;
    let embed = resolve_youtube_snapshot(&state.embed_lookup, "main", &body.url)
        .await
        .map_err(|_| ApiError::Reject {
            status: StatusCode::BAD_REQUEST,
            error: RejectCode::InvalidTarget,
            message: "invalid target".to_string(),
        })?;
    Ok(Json(ResolveYoutubeEmbedResponse {
        embed: WirePostEmbed::from(embed),
    }))
}

pub(super) async fn resolve_youtube_snapshot(
    lookup: &YoutubeSnapshotLookup,
    channel_id: &str,
    url: &str,
) -> Result<PostEmbed, commands::Reject> {
    let embed = decide_post_embed(channel_id, Some(url)).map_err(|_| commands::Reject::InvalidTarget)?;
    let Some(mut embed) = embed else {
        return Err(commands::Reject::InvalidTarget);
    };
    let snapshot = lookup
        .lookup(&embed.provider_id)
        .await
        .map_err(|_| commands::Reject::InvalidTarget)?;
    embed.snapshot = Some(snapshot);
    Ok(embed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn map_lookup_is_fail_closed_for_unknown_ids_and_off_main_channels() {
        let lookup = YoutubeSnapshotLookup::map(HashMap::from([(
            "dQw4w9WgXcQ".into(),
            EmbedSnapshot {
                title: "Never Gonna Give You Up".into(),
                author: Some("Rick Astley".into()),
                poster: None,
            },
        )]));
        let embed = resolve_youtube_snapshot(&lookup, "main", "https://youtu.be/dQw4w9WgXcQ")
            .await
            .unwrap();
        assert_eq!(
            embed.snapshot.as_ref().map(|snapshot| snapshot.title.as_str()),
            Some("Never Gonna Give You Up")
        );
        assert!(resolve_youtube_snapshot(&lookup, "main", "https://youtu.be/xxxxxxxxxxx")
            .await
            .is_err());
        assert!(resolve_youtube_snapshot(
            &lookup,
            "private:role_pm:slot_1",
            "https://youtu.be/dQw4w9WgXcQ"
        )
        .await
        .is_err());
    }

    #[test]
    fn oembed_query_encodes_the_constructed_watch_url() {
        assert_eq!(
            urlencoding_watch("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
            "https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
        );
    }
}


