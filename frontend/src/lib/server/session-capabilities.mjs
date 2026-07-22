import { normalizeCapabilities } from "../app/capabilities.mjs";
import { fetchTimeoutSignal, ssrFetchTimeoutMs } from "../app/cold-load.mjs";

export const SESSION_COOKIE_NAME = "fmarch_session";
export const FIXTURE_SESSION_COOKIE_NAME = "fmarch_fixture_session";
export const DEFAULT_SESSION_CACHE_TTL_MS = 30_000;

const SESSION_CACHE_MAX_ENTRIES = 1000;
const sessionCache = new Map();

// TTL for cached auth-session resolutions. Bounds capability-change lag; the
// win is removing one serial API round trip from almost every SSR request.
// 0 disables caching.
export function sessionCacheTtlMs(env = globalThis.process?.env) {
  const raw = env?.FMARCH_SESSION_CACHE_TTL_MS;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return DEFAULT_SESSION_CACHE_TTL_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_SESSION_CACHE_TTL_MS;
  }
  return parsed;
}

export function clearSessionCache() {
  sessionCache.clear();
}

// Drop any cached resolutions for a token that was just logged out or
// revoked, so a stale entry cannot serve capabilities for up to a full TTL.
export function evictSessionCacheForToken(token) {
  if (typeof token !== "string" || token.trim() === "") return;
  for (const key of sessionCache.keys()) {
    if (key.startsWith(`${token}|`)) {
      sessionCache.delete(key);
    }
  }
}

// The backend-owned app session in the fmarch_session cookie is the only
// per-request identity; provider tokens are exchanged once at sign-in and
// never appear here.
export function accessTokenForRequest({ cookies } = {}) {
  const sessionToken = cookies?.get?.(SESSION_COOKIE_NAME);
  return typeof sessionToken === "string" && sessionToken.trim() !== "" ? sessionToken : null;
}

export function authenticatedApiFetch({ cookies, fetchImpl = fetch } = {}) {
  const token = accessTokenForRequest({ cookies });
  return async (input, init = {}) => {
    const headers = new Headers(init.headers ?? {});
    if (typeof token === "string" && token.trim() !== "") {
      headers.set("authorization", `Bearer ${token}`);
    }
    return await fetchImpl(input, { ...init, headers });
  };
}

export async function resolveAuthenticatedSessionCached({
  cookies,
  request,
  fetchImpl = fetch,
  env = process.env,
  now = Date.now,
} = {}) {
  const ttlMs = sessionCacheTtlMs(env);
  const token = accessTokenForRequest({ cookies });
  const context = sessionContextFromRequest(request);
  const cacheable =
    ttlMs > 0 &&
    env?.FMARCH_FRONTEND_FIXTURE_SESSION !== "1" &&
    typeof token === "string" &&
    token.trim() !== "" &&
    context !== null;
  if (!cacheable) {
    return resolveAuthenticatedSession({ cookies, request, fetchImpl, env });
  }

  const key = `${token}|${context.kind}|${context.kind === "game" ? context.game : ""}`;
  const timestamp = now();
  const cached = sessionCache.get(key);
  if (cached !== undefined && cached.expiresAt > timestamp) {
    return cached.session;
  }

  const session = await resolveAuthenticatedSession({ cookies, request, fetchImpl, env });
  // Rotation-required sessions must re-resolve, and empty sessions may just
  // be an API blip — caching either would pin a worse state for a full TTL.
  if (session.rotationRequired !== true && session.principalUserId !== null) {
    if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) {
      sessionCache.delete(sessionCache.keys().next().value);
    }
    sessionCache.set(key, { session, expiresAt: timestamp + ttlMs });
  } else {
    sessionCache.delete(key);
  }
  return session;
}

export async function resolveAuthenticatedSession({
  cookies,
  request,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const token = accessTokenForRequest({ cookies });
  const context = sessionContextFromRequest(request);
  if (env?.FMARCH_FRONTEND_FIXTURE_SESSION === "1") {
    return fixtureSession({
      token: cookies?.get?.(FIXTURE_SESSION_COOKIE_NAME) ?? token,
      context: context ?? Object.freeze({ kind: "game", game: "midsummer" }),
    });
  }

  if (token === undefined || token === null || token.trim() === "" || context === null) {
    return emptySession();
  }

  let response;
  try {
    const signal = fetchTimeoutSignal(ssrFetchTimeoutMs(env));
    response = await fetchImpl(authSessionUrl({ env, context }), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return emptySession();
  }
  if (!response.ok) {
    return emptySession();
  }

  return normalizeSessionPayload(await response.json(), context);
}

export async function rotateAuthenticatedBrowserSession({
  cookies,
  request,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const token = cookies?.get?.(SESSION_COOKIE_NAME);
  if (typeof token !== "string" || token.trim() === "") {
    return { status: "missing" };
  }

  let response;
  try {
    const signal = fetchTimeoutSignal(ssrFetchTimeoutMs(env));
    response = await fetchImpl(`${authApiBaseUrl(env)}/auth/session-rotations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({}),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (!response.ok) {
    return { status: response.status === 401 ? "stale" : "unavailable" };
  }

  const body = await response.json().catch(() => null);
  if (!validSessionPayload(body) || !validIssuedSessionToken(body.session_token)) {
    return { status: "unavailable" };
  }
  evictSessionCacheForToken(token);
  const url = new URL(typeof request?.url === "string" ? request.url : "http://localhost/");
  cookies?.set?.(SESSION_COOKIE_NAME, body.session_token, browserSessionCookieOptions(url));
  return { status: "rotated" };
}

export function browserSessionCookieOptions(url) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url?.protocol === "https:",
  };
}

export function hostGameFromRequest(request) {
  const href = typeof request?.url === "string" ? request.url : "http://localhost/";
  const pathname = new URL(href).pathname;
  const match = /^\/g\/([^/]+)\/host\/?$/.exec(pathname);
  return match === null ? null : decodeURIComponent(match[1]);
}

export function sessionContextFromRequest(request) {
  const href = typeof request?.url === "string" ? request.url : "http://localhost/";
  const pathname = new URL(href).pathname;
  const gameMatch = /^\/g\/([^/]+)(?:\/.*)?$/.exec(pathname);
  if (gameMatch !== null) {
    return Object.freeze({
      kind: "game",
      game: decodeURIComponent(gameMatch[1]),
    });
  }
  if (/^\/admin(?:\/.*)?$/.test(pathname)) {
    return Object.freeze({ kind: "admin" });
  }
  if (/^\/(?:community|discussions|search|games|moderation|inbox)(?:\/.*)?$/.test(pathname)) {
    return Object.freeze({ kind: "community" });
  }
  if (/^\/u\/[^/]+(?:\/.*)?$/.test(pathname) || /^\/profile\/edit\/?$/.test(pathname)) {
    return Object.freeze({ kind: "profile" });
  }
  if (/^\/auth\/(?:account\/security|logout)\/?$/.test(pathname)) {
    return Object.freeze({ kind: "account" });
  }
  return null;
}

export function resolveFixtureSession({ token, game = "midsummer" } = {}) {
  return fixtureSession({
    token,
    context: Object.freeze({ kind: "game", game }),
  });
}

function authSessionUrl({ env, context }) {
  const baseUrl = authApiBaseUrl(env);
  const path =
    context?.kind === "game"
      ? `/auth/session?game=${encodeURIComponent(context.game)}`
      : "/auth/session";
  return `${baseUrl}${path}`;
}

function authApiBaseUrl(env) {
  const base =
    typeof env?.FMARCH_API_INTERNAL_URL === "string" && env.FMARCH_API_INTERNAL_URL.trim() !== ""
      ? env.FMARCH_API_INTERNAL_URL
      : typeof env?.FMARCH_API_BASE_URL === "string"
        ? env.FMARCH_API_BASE_URL
        : "";
  return base.replace(/\/$/, "");
}

function normalizeSessionPayload(payload, context = null) {
  if (payload === null || typeof payload !== "object") {
    return emptySession();
  }

  const principalUserId = firstString(
    payload.principalUserId,
    payload.principal_user_id,
    payload.userId,
    payload.user_id,
  );
  if (principalUserId === null) {
    return emptySession();
  }

  const rawCapabilities = Array.isArray(payload.resolvedCapabilities)
    ? payload.resolvedCapabilities
    : Array.isArray(payload.capabilities)
      ? payload.capabilities
      : [];

  return Object.freeze({
    principalUserId,
    ...(payload.rotation_required === true ? { rotationRequired: true } : {}),
    resolvedCapabilities: normalizeCapabilities(
      rawCapabilities.map((capability) =>
        capabilityWithContext({
          capability,
          context,
          source: "auth-session",
        }),
      ),
    ),
  });
}

function emptySession() {
  return Object.freeze({
    principalUserId: null,
    resolvedCapabilities: Object.freeze([]),
  });
}

function fixtureSession({ token, context }) {
  if (typeof token !== "string" || token.trim() === "" || context === null) {
    return emptySession();
  }
  const game = context.kind === "game" ? context.game : "midsummer";
  switch (token) {
    case "fixture-admin":
      return Object.freeze({
        principalUserId: "admin_a",
        resolvedCapabilities: normalizeCapabilities([
          { kind: "GlobalAdmin", source: "fixture" },
          { kind: "GlobalMod", source: "fixture" },
          { kind: "HostOf", game, source: "fixture" },
        ]),
      });
    case "fixture-player":
      return Object.freeze({
        principalUserId: "player_mira",
        resolvedCapabilities: normalizeCapabilities([
          {
            kind: "SlotOccupant",
            game,
            slot: "slot-7",
            source: "fixture",
          },
          {
            kind: "ChannelMember",
            game,
            channel: "private:role_pm:slot-7",
            source: "fixture",
          },
          {
            kind: "ChannelMember",
            game,
            channel: "private:mafia_day_chat",
            source: "fixture",
          },
        ]),
      });
    case "fixture-target":
      return Object.freeze({
        principalUserId: "player_ilya",
        resolvedCapabilities: normalizeCapabilities([
          {
            kind: "SlotOccupant",
            game,
            slot: "slot-2",
            source: "fixture",
          },
        ]),
      });
    case "fixture-night-target":
      return Object.freeze({
        principalUserId: "player-seed",
        resolvedCapabilities: normalizeCapabilities([
          {
            kind: "SlotOccupant",
            game,
            slot: "slot-3",
            source: "fixture",
          },
        ]),
      });
    case "fixture-normal":
      return Object.freeze({
        principalUserId: "player_rowan",
        resolvedCapabilities: normalizeCapabilities([
          {
            kind: "SlotOccupant",
            game,
            slot: "slot-4",
            source: "fixture",
          },
        ]),
      });
    case "fixture-survivor":
      return Object.freeze({
        principalUserId: "player_sage",
        resolvedCapabilities: normalizeCapabilities([
          {
            kind: "SlotOccupant",
            game,
            slot: "slot-5",
            source: "fixture",
          },
        ]),
      });
    case "fixture-host":
      return Object.freeze({
        principalUserId: "host_h",
        resolvedCapabilities: normalizeCapabilities([
          { kind: "HostOf", game, source: "fixture" },
          { kind: "ChannelMember", game, channel: "main", source: "fixture" },
        ]),
      });
    default:
      return emptySession();
  }
}

function validSessionPayload(payload) {
  return (
    payload !== null &&
    typeof payload === "object" &&
    typeof payload.principal_user_id === "string" &&
    payload.principal_user_id.trim() !== "" &&
    Array.isArray(payload.capabilities)
  );
}

function validIssuedSessionToken(token) {
  return typeof token === "string" && token.trim() !== "";
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

function capabilityWithContext({ capability, context, source }) {
  const body = capability?.body ?? {};
  const contextualGame =
    context?.kind === "game" ? context.game : firstString(capability?.game, body.game);
  const kind = firstString(capability?.kind);
  if (
    contextualGame !== null &&
    (kind === "SlotOccupant" || kind === "ChannelMember")
  ) {
    return {
      ...capability,
      game: contextualGame,
      source: firstString(capability?.source) ?? source,
    };
  }
  return {
    ...capability,
    source: firstString(capability?.source) ?? source,
  };
}
