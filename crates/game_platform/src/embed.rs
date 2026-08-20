//! Closed YouTube embed grammar for public game-main posts.
//!
//! This is game composition policy: forum discussion does not own or depend on
//! a game channel's embedding rules.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ModelError;

pub const YOUTUBE_EMBED_ORIGIN: &str = "https://www.youtube-nocookie.com";
pub const YOUTUBE_OEMBED_ORIGIN: &str = "https://www.youtube.com";
pub const YOUTUBE_OEMBED_PATH: &str = "/oembed";
pub const MAX_EMBED_TITLE_CHARS: usize = 200;
pub const MAX_EMBED_AUTHOR_CHARS: usize = 100;
const YOUTUBE_ID_LEN: usize = 11;
const MAX_START_SECONDS: u32 = 12 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedProvider {
    Youtube,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmbedPoster {
    pub content_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EmbedSnapshot {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<EmbedPoster>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostEmbed {
    pub provider: EmbedProvider,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_seconds: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<EmbedSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YoutubeOembedQuery {
    pub watch_url: String,
    pub format: &'static str,
}

impl PostEmbed {
    pub fn playback_src(&self) -> String {
        let mut src = format!("{YOUTUBE_EMBED_ORIGIN}/embed/{}?rel=0", self.provider_id);
        if let Some(start) = self.start_seconds {
            src.push_str("&start=");
            src.push_str(&start.to_string());
        }
        src
    }
}

pub fn decide_post_embed(
    channel_id: &str,
    embed_url: Option<&str>,
) -> Result<Option<PostEmbed>, ModelError> {
    let Some(raw) = embed_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if channel_id != "main" {
        return Err(ModelError::InvalidEmbed);
    }
    Ok(Some(parse_youtube_embed(raw)?))
}

pub fn attach_embed_snapshot(
    embed: Option<PostEmbed>,
    snapshot: Option<EmbedSnapshot>,
) -> Result<Option<PostEmbed>, ModelError> {
    match (embed, snapshot) {
        (None, None) => Ok(None),
        (None, Some(_)) | (Some(_), None) => Err(ModelError::InvalidEmbed),
        (Some(mut embed), Some(snapshot)) => {
            embed.snapshot = Some(validate_embed_snapshot(snapshot)?);
            Ok(Some(embed))
        }
    }
}

pub fn youtube_oembed_query(provider_id: &str) -> Option<YoutubeOembedQuery> {
    is_youtube_id(provider_id).then(|| YoutubeOembedQuery {
        watch_url: format!("https://www.youtube.com/watch?v={provider_id}"),
        format: "json",
    })
}

pub fn snapshot_from_oembed(value: &Value) -> Result<EmbedSnapshot, ModelError> {
    let title = clamp_embed_text(
        value.get("title").and_then(Value::as_str).unwrap_or(""),
        MAX_EMBED_TITLE_CHARS,
    )
    .ok_or(ModelError::InvalidEmbed)?;
    let author = value
        .get("author_name")
        .and_then(Value::as_str)
        .and_then(|name| clamp_embed_text(name, MAX_EMBED_AUTHOR_CHARS));
    Ok(EmbedSnapshot {
        title,
        author,
        poster: None,
    })
}

pub fn validate_embed_snapshot(snapshot: EmbedSnapshot) -> Result<EmbedSnapshot, ModelError> {
    let title =
        clamp_embed_text(&snapshot.title, MAX_EMBED_TITLE_CHARS).ok_or(ModelError::InvalidEmbed)?;
    let author = snapshot
        .author
        .as_deref()
        .and_then(|name| clamp_embed_text(name, MAX_EMBED_AUTHOR_CHARS));
    if let Some(poster) = snapshot.poster.as_ref() {
        if !is_content_id(&poster.content_id) {
            return Err(ModelError::InvalidEmbed);
        }
    }
    Ok(EmbedSnapshot {
        title,
        author,
        poster: snapshot.poster,
    })
}

pub fn parse_youtube_embed(input: &str) -> Result<PostEmbed, ModelError> {
    let trimmed = input.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or(ModelError::InvalidEmbed)?;
    let (host, path_query) = rest.split_once('/').unwrap_or((rest, ""));
    let host = normalize_host(host).ok_or(ModelError::InvalidEmbed)?;
    let (path, query) = path_query.split_once('?').unwrap_or((path_query, ""));
    let path = path.trim_matches('/');
    let query = parse_query(query);
    let provider_id = match host.as_str() {
        "youtu.be" => first_segment(path).ok_or(ModelError::InvalidEmbed)?,
        "youtube.com" | "m.youtube.com" | "youtube-nocookie.com" => youtube_path_id(path, &query)?,
        _ => return Err(ModelError::InvalidEmbed),
    };
    if !is_youtube_id(&provider_id) {
        return Err(ModelError::InvalidEmbed);
    }
    Ok(PostEmbed {
        provider: EmbedProvider::Youtube,
        provider_id,
        start_seconds: parse_start_seconds(query.get("t").or_else(|| query.get("start")).copied()),
        snapshot: None,
    })
}

pub fn embed_from_payload(payload: &Value) -> Result<Option<PostEmbed>, serde_json::Error> {
    match payload.get("embed") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone()),
    }
}

pub fn embed_payload(embed: &Option<PostEmbed>) -> Option<Value> {
    embed
        .as_ref()
        .map(|value| serde_json::to_value(value).expect("post embed serializes"))
}

fn youtube_path_id(
    path: &str,
    query: &std::collections::BTreeMap<&str, &str>,
) -> Result<String, ModelError> {
    if path == "watch" {
        return query
            .get("v")
            .map(|value| (*value).to_string())
            .ok_or(ModelError::InvalidEmbed);
    }
    if let Some(rest) = path.strip_prefix("shorts/") {
        return first_segment(rest).ok_or(ModelError::InvalidEmbed);
    }
    if let Some(rest) = path.strip_prefix("embed/") {
        return first_segment(rest).ok_or(ModelError::InvalidEmbed);
    }
    Err(ModelError::InvalidEmbed)
}

fn normalize_host(host: &str) -> Option<String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.contains(':') {
        return None;
    }
    Some(
        host.strip_prefix("www.")
            .unwrap_or(host.as_str())
            .to_string(),
    )
}

fn parse_query(query: &str) -> std::collections::BTreeMap<&str, &str> {
    let mut pairs = std::collections::BTreeMap::new();
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        pairs.entry(key).or_insert(value);
    }
    pairs
}

fn first_segment(path: &str) -> Option<String> {
    let segment = path.split('/').next().unwrap_or("").trim();
    (!segment.is_empty()).then(|| segment.to_string())
}

fn clamp_embed_text(value: &str, max_chars: usize) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(max_chars).collect())
}

fn is_content_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_youtube_id(value: &str) -> bool {
    value.len() == YOUTUBE_ID_LEN
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn parse_start_seconds(value: Option<&str>) -> Option<u32> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let seconds = if raw.bytes().all(|byte| byte.is_ascii_digit()) {
        raw.parse().ok()?
    } else {
        parse_clock_seconds(raw)?
    };
    (seconds != 0 && seconds <= MAX_START_SECONDS).then_some(seconds)
}

fn parse_clock_seconds(raw: &str) -> Option<u32> {
    let mut rest = raw;
    let mut total = 0_u32;
    if let Some((hours, tail)) = rest.split_once('h') {
        total = total.saturating_add(hours.parse::<u32>().ok()?.checked_mul(3600)?);
        rest = tail;
    }
    if let Some((minutes, tail)) = rest.split_once('m') {
        total = total.saturating_add(minutes.parse::<u32>().ok()?.checked_mul(60)?);
        rest = tail;
    }
    if let Some(seconds) = rest.strip_suffix('s') {
        if !seconds.is_empty() {
            total = total.saturating_add(seconds.parse().ok()?);
        }
    } else if !rest.is_empty() {
        return None;
    }
    Some(total)
}
