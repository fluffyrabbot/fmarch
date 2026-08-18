//! Closed YouTube embed grammar for game posts.
//!
//! The writer pastes a URL. The stored fact is a provider plus canonical id.
//! Shorts use the same provider.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::CommunityReject;

pub const YOUTUBE_EMBED_ORIGIN: &str = "https://www.youtube-nocookie.com";
const YOUTUBE_ID_LEN: usize = 11;
const MAX_START_SECONDS: u32 = 12 * 60 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmbedProvider {
    Youtube,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostEmbed {
    pub provider: EmbedProvider,
    pub provider_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_seconds: Option<u32>,
}

impl PostEmbed {
    pub fn playback_src(&self) -> String {
        let mut src = format!(
            "{YOUTUBE_EMBED_ORIGIN}/embed/{id}?rel=0",
            id = self.provider_id
        );
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
) -> Result<Option<PostEmbed>, CommunityReject> {
    let Some(raw) = embed_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if channel_id != "main" {
        return Err(CommunityReject::InvalidEmbed);
    }
    Ok(Some(parse_youtube_embed(raw)?))
}

pub fn parse_youtube_embed(input: &str) -> Result<PostEmbed, CommunityReject> {
    let trimmed = input.trim();
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or(CommunityReject::InvalidEmbed)?;
    let (host, path_query) = rest.split_once('/').unwrap_or((rest, ""));
    let host = normalize_host(host).ok_or(CommunityReject::InvalidEmbed)?;
    let (path, query) = path_query.split_once('?').unwrap_or((path_query, ""));
    let path = path.trim_matches('/');
    let query = parse_query(query);
    let provider_id = match host.as_str() {
        "youtu.be" => first_segment(path).ok_or(CommunityReject::InvalidEmbed)?,
        "youtube.com" | "m.youtube.com" | "youtube-nocookie.com" => youtube_path_id(path, &query)?,
        _ => return Err(CommunityReject::InvalidEmbed),
    };
    if !is_youtube_id(&provider_id) {
        return Err(CommunityReject::InvalidEmbed);
    }
    Ok(PostEmbed {
        provider: EmbedProvider::Youtube,
        provider_id,
        start_seconds: parse_start_seconds(query.get("t").or_else(|| query.get("start")).copied()),
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
) -> Result<String, CommunityReject> {
    if path == "watch" {
        return query
            .get("v")
            .map(|value| (*value).to_string())
            .ok_or(CommunityReject::InvalidEmbed);
    }
    if let Some(rest) = path.strip_prefix("shorts/") {
        return first_segment(rest).ok_or(CommunityReject::InvalidEmbed);
    }
    if let Some(rest) = path.strip_prefix("embed/") {
        return first_segment(rest).ok_or(CommunityReject::InvalidEmbed);
    }
    Err(CommunityReject::InvalidEmbed)
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
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if !pairs.contains_key(key) {
            pairs.insert(key, value);
        }
    }
    pairs
}

fn first_segment(path: &str) -> Option<String> {
    let segment = path.split('/').next().unwrap_or("").trim();
    if segment.is_empty() {
        None
    } else {
        Some(segment.to_string())
    }
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
    if seconds == 0 || seconds > MAX_START_SECONDS {
        None
    } else {
        Some(seconds)
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> &'static str {
        "dQw4w9WgXcQ"
    }

    #[test]
    fn accepts_closed_youtube_url_shapes() {
        for input in [
            format!("https://www.youtube.com/watch?v={id}", id = id()),
            format!("https://youtube.com/watch?v={id}&feature=share", id = id()),
            format!("http://m.youtube.com/watch?v={id}", id = id()),
            format!("https://youtu.be/{id}", id = id()),
            format!("https://www.youtu.be/{id}/", id = id()),
            format!("https://www.youtube.com/embed/{id}", id = id()),
            format!("https://www.youtube-nocookie.com/embed/{id}", id = id()),
            format!("https://www.youtube.com/shorts/{id}", id = id()),
            format!("https://youtube.com/shorts/{id}?feature=share", id = id()),
        ] {
            let embed = parse_youtube_embed(&input).expect(&input);
            assert_eq!(embed.provider, EmbedProvider::Youtube);
            assert_eq!(embed.provider_id, id());
            assert_eq!(embed.start_seconds, None);
        }
    }

    #[test]
    fn captures_start_offset() {
        let watch = parse_youtube_embed(&format!(
            "https://www.youtube.com/watch?v={id}&t=1m23s",
            id = id()
        ))
        .unwrap();
        assert_eq!(watch.start_seconds, Some(83));
        let shortlink =
            parse_youtube_embed(&format!("https://youtu.be/{id}?t=83", id = id())).unwrap();
        assert_eq!(shortlink.start_seconds, Some(83));
        let embed = parse_youtube_embed(&format!(
            "https://www.youtube.com/embed/{id}?start=12",
            id = id()
        ))
        .unwrap();
        assert_eq!(embed.start_seconds, Some(12));
    }

    #[test]
    fn rejects_unknown_hosts_and_shapes() {
        for input in [
            "javascript:alert(1)",
            "https://example.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/playlist?list=PLtest",
            "https://www.youtube.com/channel/UCtest",
            "https://www.youtube.com/@handle",
            "https://www.youtube.com/clip/Ugkx",
            "https://www.youtube.com/watch",
            "https://youtu.be/short",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
        ] {
            assert_eq!(
                parse_youtube_embed(input),
                Err(CommunityReject::InvalidEmbed),
                "{input}"
            );
        }
    }

    #[test]
    fn main_thread_only() {
        assert_eq!(
            decide_post_embed("private:mafia", Some("https://youtu.be/dQw4w9WgXcQ")),
            Err(CommunityReject::InvalidEmbed)
        );
        assert_eq!(decide_post_embed("main", None).unwrap(), None);
        assert_eq!(decide_post_embed("main", Some("  ")).unwrap(), None);
        assert_eq!(
            decide_post_embed("main", Some("https://youtu.be/dQw4w9WgXcQ"))
                .unwrap()
                .unwrap()
                .provider_id,
            "dQw4w9WgXcQ"
        );
    }

    #[test]
    fn playback_src_uses_nocookie_origin() {
        let embed = parse_youtube_embed("https://youtu.be/dQw4w9WgXcQ?t=15").unwrap();
        assert_eq!(
            embed.playback_src(),
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=15"
        );
    }
}
