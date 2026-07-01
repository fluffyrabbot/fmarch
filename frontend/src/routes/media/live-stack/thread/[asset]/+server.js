import { error } from "@sveltejs/kit";
import { normalizeCapabilities } from "../../../../../lib/app/capabilities.mjs";
import { resolveAuthenticatedSession } from "../../../../../lib/server/session-capabilities.mjs";
import { generatedThreadMediaPng } from "../../../../../lib/server/thread-media-png.mjs";

const THREAD_MEDIA_VARIANTS = Object.freeze(["tablet", "small"]);

const LIVE_STACK_THREAD_HANDLES = Object.freeze({
  "live-faction-day-chat-receipt": Object.freeze({
    kind: "image",
    contentAddress: "live-stack-thread-faction-day-chat-receipt-canonical-raster",
    variants: Object.freeze({
      tablet: Object.freeze({
        width: 960,
        height: 720,
        palette: Object.freeze({
          background: Object.freeze([249, 250, 247]),
          accent: Object.freeze([91, 65, 124]),
          secondary: Object.freeze([230, 226, 236]),
          stripe: Object.freeze([129, 96, 154]),
        }),
      }),
      small: Object.freeze({
        width: 480,
        height: 360,
        palette: Object.freeze({
          background: Object.freeze([251, 252, 248]),
          accent: Object.freeze([73, 103, 74]),
          secondary: Object.freeze([224, 236, 224]),
          stripe: Object.freeze([106, 139, 99]),
        }),
      }),
    }),
  }),
  "live-role-pm-receipt": Object.freeze({
    kind: "image",
    contentAddress: "live-stack-thread-role-pm-receipt-canonical-raster",
    variants: Object.freeze({
      tablet: Object.freeze({
        width: 960,
        height: 720,
        palette: Object.freeze({
          background: Object.freeze([248, 250, 252]),
          accent: Object.freeze([42, 91, 68]),
          secondary: Object.freeze([213, 232, 219]),
          stripe: Object.freeze([97, 133, 113]),
        }),
      }),
      small: Object.freeze({
        width: 480,
        height: 360,
        palette: Object.freeze({
          background: Object.freeze([250, 252, 250]),
          accent: Object.freeze([57, 94, 150]),
          secondary: Object.freeze([220, 231, 247]),
          stripe: Object.freeze([105, 132, 179]),
        }),
      }),
    }),
  }),
});

export async function GET({
  params,
  request,
  url,
  fetch: fetchImpl = fetch,
  cookies,
  locals = {},
  env = process.env,
}) {
  const asset = _liveStackThreadAsset(params.asset);
  if (asset === null) {
    throw error(404, "media variant unavailable");
  }
  const reference = await _liveStackThreadMediaReference({
    asset,
    request,
    url,
    fetchImpl,
    cookies,
    locals,
    env,
  });
  if (reference.status === "denied") {
    throw error(403, reference.message);
  }
  if (reference.status !== "ready") {
    throw error(404, reference.message);
  }
  const served = _liveStackThreadVariant(asset);
  return new Response(served.bytes, {
    headers: {
      "cache-control": "private, max-age=31536000, immutable",
      "content-type": "image/png",
      etag: served.etag,
      "x-fmarch-media-content-address": asset.contentAddress,
      "x-fmarch-media-channel": reference.channel,
      "x-fmarch-media-post-seq": String(reference.sourceSeq),
      "x-fmarch-media-reference": `${reference.game}/${reference.channel}/${reference.sourceSeq}/${asset.id}`,
      "x-fmarch-media-variant": asset.variantName,
    },
  });
}

export function _liveStackThreadAsset(assetName) {
  const match = /^(?<id>[a-z0-9-]+)-(?<variant>[a-z0-9-]+)\.png$/.exec(
    String(assetName ?? ""),
  );
  if (match === null) {
    return null;
  }
  const asset = LIVE_STACK_THREAD_HANDLES[match.groups.id];
  const variant = asset?.variants?.[match.groups.variant];
  if (asset === undefined || variant === undefined) {
    return null;
  }
  if (!THREAD_MEDIA_VARIANTS.includes(match.groups.variant)) {
    return null;
  }
  return Object.freeze({
    id: match.groups.id,
    kind: asset.kind,
    contentAddress: asset.contentAddress,
    variantName: match.groups.variant,
    ...variant,
  });
}

export async function _liveStackThreadMediaReference({
  asset,
  request = null,
  url = null,
  fetchImpl = null,
  cookies = null,
  locals = {},
  env = process.env,
} = {}) {
  const context = _liveStackThreadReferenceContext({ request, url });
  if (context === null) {
    return unavailableReference("media reference context required");
  }

  const session = await _liveStackThreadSession({
    context,
    request,
    fetchImpl,
    cookies,
    locals,
    env,
  });
  if (
    !canReadThreadMediaContext({
      context,
      principalUserId: session.principalUserId,
      capabilities: session.resolvedCapabilities,
    })
  ) {
    return deniedReference("media access denied for this thread reference");
  }

  const page = await _fetchLiveStackThreadPage({
    context,
    principalUserId: session.principalUserId,
    fetchImpl,
    env,
  });
  if (page.status === "denied") {
    return deniedReference("media access denied for this thread reference");
  }
  if (page.status !== "ready") {
    return unavailableReference("media reference unavailable");
  }

  const reference = findProjectedMediaReference({
    asset,
    page: page.page,
    requestPathname: context.pathname,
  });
  if (reference === null) {
    return unavailableReference("media variant is not referenced by this thread");
  }

  return Object.freeze({
    status: "ready",
    game: context.game,
    channel: context.channel,
    sourceSeq: reference.sourceSeq,
    streamSeq: reference.streamSeq,
  });
}

export function _liveStackThreadReferenceContext({ request = null, url = null } = {}) {
  const requestUrl = requestUrlFor({ request, url });
  const search = requestUrl?.searchParams ?? new URLSearchParams();
  const directGame = firstNonEmpty(search.get("game"));
  const directChannel = firstNonEmpty(search.get("channel"));
  if (directGame !== null) {
    return Object.freeze({
      game: directGame,
      channel: directChannel ?? "main",
      pathname: requestUrl?.pathname ?? "",
    });
  }

  const referer = headerValue(request, "referer");
  if (referer === null) {
    return null;
  }
  let refererUrl;
  try {
    refererUrl = new URL(referer);
  } catch {
    return null;
  }
  const match = /^\/g\/([^/]+)(?:\/c\/([^/]+))?\/?$/.exec(refererUrl.pathname);
  if (match === null) {
    return null;
  }
  return Object.freeze({
    game: decodeURIComponent(match[1]),
    channel: match[2] === undefined ? "main" : decodeURIComponent(match[2]),
    pathname: requestUrl?.pathname ?? "",
  });
}

export function _liveStackThreadUrl({ apiBaseUrl = "", game, channel, principalUserId }) {
  const base = typeof apiBaseUrl === "string" ? apiBaseUrl.replace(/\/$/, "") : "";
  if (channel === "main") {
    return `${base}/games/${encodeURIComponent(game)}/thread?limit=100`;
  }
  const params = new URLSearchParams({ limit: "100" });
  if (typeof principalUserId === "string" && principalUserId.trim() !== "") {
    params.set("principal_user_id", principalUserId);
  }
  return `${base}/games/${encodeURIComponent(game)}/channels/${encodeURIComponent(channel)}/thread?${params}`;
}

export function _liveStackThreadVariant(asset) {
  return generatedThreadMediaPng(asset);
}

async function _liveStackThreadSession({
  context,
  request,
  fetchImpl,
  cookies,
  locals,
  env,
}) {
  if (
    typeof locals?.principalUserId === "string" &&
    locals.principalUserId.trim() !== "" &&
    Array.isArray(locals.resolvedCapabilities)
  ) {
    return Object.freeze({
      principalUserId: locals.principalUserId,
      resolvedCapabilities: normalizeCapabilities(locals.resolvedCapabilities),
    });
  }
  if (cookies === null || typeof fetchImpl !== "function") {
    return emptyMediaSession();
  }
  return resolveAuthenticatedSession({
    cookies,
    fetchImpl,
    request: {
      url: requestUrlForSessionContext({ request, game: context.game }),
    },
    env,
  });
}

async function _fetchLiveStackThreadPage({ context, principalUserId, fetchImpl, env }) {
  if (typeof fetchImpl !== "function") {
    return unavailableReference("media thread projection fetch unavailable");
  }
  const url = _liveStackThreadUrl({
    apiBaseUrl: env?.FMARCH_API_BASE_URL ?? "",
    game: context.game,
    channel: context.channel,
    principalUserId,
  });
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" },
  });
  if (response?.status === 401 || response?.status === 403) {
    return deniedReference("media access denied for this thread reference");
  }
  if (!response?.ok) {
    return unavailableReference("media thread projection unavailable");
  }
  const page = await response.json();
  if (page === null || typeof page !== "object" || !Array.isArray(page.posts)) {
    return unavailableReference("media thread projection malformed");
  }
  return Object.freeze({ status: "ready", page });
}

function findProjectedMediaReference({ asset, page, requestPathname }) {
  for (const post of page.posts) {
    const mediaItems = Array.isArray(post?.media) ? post.media : [];
    for (const item of mediaItems) {
      if (item?.id !== asset.id || String(item?.kind ?? "image") !== asset.kind) {
        continue;
      }
      const variant = item.variants?.[asset.variantName];
      if (!projectedVariantMatchesRequest({ variant, asset, requestPathname })) {
        continue;
      }
      return Object.freeze({
        sourceSeq: post.source_seq ?? post.sourceSeq ?? post.seq,
        streamSeq: post.stream_seq ?? post.streamSeq ?? null,
      });
    }
  }
  return null;
}

function projectedVariantMatchesRequest({ variant, asset, requestPathname }) {
  if (variant === null || typeof variant !== "object") {
    return false;
  }
  if (Number(variant.width) !== asset.width || Number(variant.height) !== asset.height) {
    return false;
  }
  try {
    return new URL(variant.url, "http://localhost").pathname === requestPathname;
  } catch {
    return false;
  }
}

function canReadThreadMediaContext({ context, principalUserId, capabilities }) {
  if (context.channel === "main") {
    return true;
  }
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    return false;
  }
  return normalizeCapabilities(capabilities).some((capability) => {
    if (capability.kind === "GlobalAdmin" || capability.kind === "GlobalMod") {
      return true;
    }
    if (
      (capability.kind === "HostOf" || capability.kind === "CohostOf") &&
      capability.game === context.game
    ) {
      return true;
    }
    if (
      capability.kind === "ChannelMember" &&
      capability.game === context.game &&
      capability.channel === context.channel
    ) {
      return true;
    }
    return (
      context.channel === "dead" &&
      capability.kind === "DeadViewer" &&
      capability.game === context.game
    );
  });
}

function requestUrlFor({ request, url }) {
  if (url instanceof URL) {
    return url;
  }
  if (typeof request?.url === "string") {
    return new URL(request.url);
  }
  return null;
}

function requestUrlForSessionContext({ request, game }) {
  const origin =
    typeof request?.url === "string"
      ? new URL(request.url).origin
      : "http://localhost";
  return `${origin}/g/${encodeURIComponent(game)}`;
}

function headerValue(request, name) {
  const value = request?.headers?.get?.(name);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function firstNonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function emptyMediaSession() {
  return Object.freeze({
    principalUserId: null,
    resolvedCapabilities: Object.freeze([]),
  });
}

function deniedReference(message) {
  return Object.freeze({ status: "denied", message });
}

function unavailableReference(message) {
  return Object.freeze({ status: "unavailable", message });
}
