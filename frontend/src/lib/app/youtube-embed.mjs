export const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
export const COMPOSER_EMBED_HINT =
  "Watch, Shorts, or youtu.be links. The player loads only after someone presses Play.";
export const COMPOSER_EMBED_PREVIEW = "YouTube video will play after send";
export const COMPOSER_EMBED_REJECTION = "Reject InvalidTarget: invalid target";
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const MAX_START_SECONDS = 12 * 60 * 60;

export function buildComposerEmbedView({ embedUrl = "", channelId = "main" } = {}) {
  const trimmed = String(embedUrl ?? "").trim();
  if (trimmed === "") {
    return Object.freeze({
      state: "empty",
      hint: COMPOSER_EMBED_HINT,
      disablePost: false,
      reason: "",
    });
  }
  const parsed = String(channelId ?? "") === "main" ? parseYoutubeEmbed(trimmed) : null;
  if (parsed !== null) {
    return Object.freeze({
      state: "ready",
      hint: COMPOSER_EMBED_PREVIEW,
      disablePost: false,
      reason: "",
    });
  }
  return Object.freeze({
    state: "invalid",
    hint: COMPOSER_EMBED_REJECTION,
    disablePost: true,
    reason: COMPOSER_EMBED_REJECTION,
  });
}

export function applyComposerEmbedToButtons(buttons, embedView) {
  if (!Array.isArray(buttons) || embedView?.disablePost !== true) {
    return buttons;
  }
  return Object.freeze(
    buttons.map((button) => {
      if (button?.action !== "submit_post") {
        return button;
      }
      return Object.freeze({
        ...button,
        disabled: true,
        reason:
          button.disabled === true && String(button.reason ?? "") !== ""
            ? button.reason
            : embedView.reason,
      });
    }),
  );
}

export function parseYoutubeEmbed(input) {
  const trimmed = String(input ?? "").trim();
  const rest = trimmed.startsWith("https://")
    ? trimmed.slice("https://".length)
    : trimmed.startsWith("http://")
      ? trimmed.slice("http://".length)
      : null;
  if (rest === null) {
    return null;
  }
  const slash = rest.indexOf("/");
  const host = normalizeHost(slash === -1 ? rest : rest.slice(0, slash));
  const pathQuery = slash === -1 ? "" : rest.slice(slash + 1);
  const qmark = pathQuery.indexOf("?");
  const path = (qmark === -1 ? pathQuery : pathQuery.slice(0, qmark)).replace(/^\/+|\/+$/gu, "");
  const query = parseQuery(qmark === -1 ? "" : pathQuery.slice(qmark + 1));
  let providerId = null;
  if (host === "youtu.be") {
    providerId = firstSegment(path);
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    providerId = youtubePathId(path, query);
  }
  if (!YOUTUBE_ID.test(providerId ?? "")) {
    return null;
  }
  return Object.freeze({
    provider: "youtube",
    providerId,
    startSeconds: parseStartSeconds(query.t ?? query.start),
  });
}

export function buildYoutubePlaybackSrc(embed) {
  if (embed == null || embed.provider !== "youtube" || !YOUTUBE_ID.test(String(embed.providerId ?? ""))) {
    return null;
  }
  const params = new URLSearchParams({ rel: "0" });
  const start = Number(embed.startSeconds);
  if (Number.isInteger(start) && start > 0) {
    params.set("start", String(start));
  }
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${embed.providerId}?${params.toString()}`;
}

export function buildPlayerThreadEmbedView(embed, seq) {
  const providerId = String(embed?.providerId ?? embed?.provider_id ?? "");
  const provider = String(embed?.provider ?? "");
  const start = Number(embed?.startSeconds ?? embed?.start_seconds);
  const normalized = parseYoutubeEmbed(
    provider === "youtube" && YOUTUBE_ID.test(providerId)
      ? `https://youtu.be/${providerId}${Number.isInteger(start) && start > 0 ? `?t=${start}` : ""}`
      : "",
  );
  const source = normalized ?? (
    provider === "youtube" && YOUTUBE_ID.test(providerId)
      ? Object.freeze({
          provider: "youtube",
          providerId,
          startSeconds: Number.isInteger(start) && start > 0 ? start : null,
        })
      : null
  );
  const playbackSrc = buildYoutubePlaybackSrc(source);
  if (source === null || playbackSrc === null) {
    return null;
  }
  const postSeq = Number(seq);
  return Object.freeze({
    provider: "youtube",
    providerId: source.providerId,
    startSeconds: source.startSeconds,
    playbackSrc,
    playLabel: "Play YouTube video",
    testId:
      Number.isInteger(postSeq) && postSeq >= 1
        ? `thread-post-embed-play-${postSeq}`
        : "thread-post-embed-play",
  });
}

function youtubePathId(path, query) {
  if (path === "watch") {
    return query.v ?? null;
  }
  if (path.startsWith("shorts/")) {
    return firstSegment(path.slice("shorts/".length));
  }
  if (path.startsWith("embed/")) {
    return firstSegment(path.slice("embed/".length));
  }
  return null;
}

function normalizeHost(host) {
  const normalized = String(host ?? "")
    .trim()
    .replace(/\.+$/u, "")
    .toLowerCase();
  if (normalized === "" || normalized.includes(":")) {
    return "";
  }
  return normalized.startsWith("www.") ? normalized.slice(4) : normalized;
}

function parseQuery(query) {
  const pairs = {};
  for (const pair of String(query).split("&")) {
    if (pair === "") {
      continue;
    }
    const [key, value = ""] = pair.split("=");
    if (!(key in pairs)) {
      pairs[key] = value;
    }
  }
  return pairs;
}

function firstSegment(path) {
  const segment = String(path ?? "").split("/")[0].trim();
  return segment === "" ? null : segment;
}

function parseStartSeconds(value) {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    return null;
  }
  const seconds = /^\d+$/u.test(raw) ? Number(raw) : parseClockSeconds(raw);
  if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_START_SECONDS) {
    return null;
  }
  return seconds;
}

function parseClockSeconds(raw) {
  let rest = raw;
  let total = 0;
  const hours = rest.split("h");
  if (hours.length === 2) {
    if (!/^\d+$/u.test(hours[0])) {
      return null;
    }
    total += Number(hours[0]) * 3600;
    rest = hours[1];
  }
  const minutes = rest.split("m");
  if (minutes.length === 2) {
    if (!/^\d+$/u.test(minutes[0])) {
      return null;
    }
    total += Number(minutes[0]) * 60;
    rest = minutes[1];
  }
  if (rest.endsWith("s")) {
    const seconds = rest.slice(0, -1);
    if (seconds !== "") {
      if (!/^\d+$/u.test(seconds)) {
        return null;
      }
      total += Number(seconds);
    }
    return total;
  }
  return rest === "" ? total : null;
}
