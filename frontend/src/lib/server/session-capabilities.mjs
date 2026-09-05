import {
  normalizeCapabilities,
  normalizeCapability,
} from "../app/capabilities.mjs";
import {
  canonicalPrincipalId,
  FIXTURE_SESSION_PRINCIPAL_IDS,
} from "../principal-id.mjs";
import { serverApiBaseUrl } from "./api-base.mjs";
import { frontendFixtureMode } from "./runtime-mode.mjs";
import { fetchUpstreamJson } from "./upstream-client.mjs";

export const SESSION_COOKIE_NAME = "fmarch_session";
export const FIXTURE_SESSION_COOKIE_NAME = "fmarch_fixture_session";
export { FIXTURE_SESSION_PRINCIPAL_IDS };

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

export async function resolveAuthenticatedSession({
  cookies,
  request,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const token = accessTokenForRequest({ cookies });
  const context = sessionContextFromRequest(request);
  if (frontendFixtureMode(env)) {
    const session = fixtureSession({
      token: cookies?.get?.(FIXTURE_SESSION_COOKIE_NAME) ?? token,
      context: context ?? Object.freeze({ kind: "game", game: "midsummer" }),
    });
    return session.principalId === null
      ? sessionResolution("anonymous", session)
      : sessionResolution("authenticated", session);
  }

  if (token === null || context === null) {
    return sessionResolution("anonymous", emptySession());
  }

  const upstream = await fetchUpstreamJson({
    fetchImpl,
    url: authSessionUrl({ env, context }),
    init: {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    },
    validate: validSessionPayload,
  });
  if (upstream.kind === "ok") {
    return sessionResolution(
      "authenticated",
      normalizeSessionPayload(upstream.value, context),
      upstream,
    );
  }
  if (upstream.kind === "unauthorized") {
    return sessionResolution("stale", emptySession(), upstream);
  }
  if (context.kind === "optional_public") {
    return sessionResolution("anonymous", emptySession(), upstream);
  }
  if (upstream.kind === "invalid_response") {
    return sessionResolution("invalid_response", emptySession(), upstream);
  }
  return sessionResolution("unavailable", emptySession(), upstream);
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

  const upstream = await fetchUpstreamJson({
    fetchImpl,
    url: `${serverApiBaseUrl(env)}/auth/session-rotations`,
    init: {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({}),
    },
    validate: (body) =>
      validSessionPayload(body) && validIssuedSessionToken(body.session_token),
  });
  if (upstream.kind === "unauthorized") {
    return { status: "stale" };
  }
  if (upstream.kind !== "ok") {
    return { status: "unavailable" };
  }
  const url = new URL(typeof request?.url === "string" ? request.url : "http://localhost/");
  cookies?.set?.(
    SESSION_COOKIE_NAME,
    upstream.value.session_token,
    browserSessionCookieOptions(url),
  );
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
  if (
    pathname === "/" ||
    /^\/(?:community|discussions|search|games)(?:\/.*)?$/.test(pathname) ||
    /^\/u\/[^/]+(?:\/.*)?$/.test(pathname)
  ) {
    return Object.freeze({ kind: "optional_public" });
  }
  if (
    /^\/(?:moderation|inbox)(?:\/.*)?$/.test(pathname) ||
    /^\/profile\/edit\/?$/.test(pathname)
  ) {
    return Object.freeze({ kind: "authority" });
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
  const baseUrl = serverApiBaseUrl(env);
  const path =
    context?.kind === "game"
      ? `/auth/session?game=${encodeURIComponent(context.game)}`
      : "/auth/session";
  return `${baseUrl}${path}`;
}

function normalizeSessionPayload(payload, context = null) {
  if (payload === null || typeof payload !== "object") {
    return emptySession();
  }

  const principalId = canonicalPrincipalId(payload.principal_id);
  if (principalId === null) {
    return emptySession();
  }

  const rawCapabilities = payload.capabilities;

  return Object.freeze({
    principalId,
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
    principalId: null,
    resolvedCapabilities: Object.freeze([]),
  });
}

function sessionResolution(kind, session, upstream = null) {
  return Object.freeze({
    kind,
    session,
    status: upstream?.status ?? null,
    requestId: upstream?.requestId ?? null,
    retryAfterSeconds: upstream?.retryAfterSeconds ?? null,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.admin,
        resolvedCapabilities: normalizeCapabilities([
          { kind: "GlobalAdmin", source: "fixture" },
          { kind: "GlobalMod", source: "fixture" },
          { kind: "HostOf", game, source: "fixture" },
        ]),
      });
    case "fixture-player":
      return Object.freeze({
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.player,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.target,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.nightTarget,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.normal,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.survivor,
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
        principalId: FIXTURE_SESSION_PRINCIPAL_IDS.host,
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
  const capabilities = payload?.capabilities;
  return (
    exactObject(payload, [
      "principal_id",
      "capabilities",
      "session_token",
      "created_at",
      "expires_at",
      "idle_expires_at",
      "rotation_required",
    ], ["principal_id", "capabilities"]) &&
    canonicalPrincipalId(payload.principal_id) !== null &&
    Array.isArray(capabilities) &&
    capabilities.every(validCapabilityGrant) &&
    (payload.session_token === undefined || validIssuedSessionToken(payload.session_token)) &&
    optionalSafeEpoch(payload.created_at) &&
    optionalSafeEpoch(payload.expires_at) &&
    optionalSafeEpoch(payload.idle_expires_at) &&
    (payload.rotation_required === undefined ||
      typeof payload.rotation_required === "boolean")
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
  const kind = firstString(capability?.kind);
  const capabilityGame = firstString(capability?.game, body.game);
  if (
    context?.kind === "game" &&
    kind !== "GlobalAdmin" &&
    kind !== "GlobalMod" &&
    capabilityGame !== context.game
  ) {
    return null;
  }
  return {
    ...capability,
    source: firstString(capability?.source) ?? source,
  };
}

function validCapabilityGrant(capability) {
  if (capability === null || typeof capability !== "object" || Array.isArray(capability)) {
    return false;
  }
  switch (capability.kind) {
    case "GlobalAdmin":
    case "GlobalMod":
      return exactObject(capability, ["kind"], ["kind"]);
    case "HostOf":
    case "CohostOf":
    case "DeadViewer":
    case "SpectatorOf":
      return (
        exactObject(capability, ["kind", "body"], ["kind", "body"]) &&
        exactObject(capability.body, ["game"], ["game"]) &&
        firstString(capability.body.game) !== null &&
        normalizeCapability(capability) !== null
      );
    case "SlotOccupant":
      return (
        exactObject(capability, ["kind", "body"], ["kind", "body"]) &&
        exactObject(capability.body, ["game", "slot"], ["game", "slot"]) &&
        firstString(capability.body.game) !== null &&
        firstString(capability.body.slot) !== null &&
        normalizeCapability(capability) !== null
      );
    case "ChannelMember":
      return (
        exactObject(capability, ["kind", "body"], ["kind", "body"]) &&
        exactObject(capability.body, ["game", "channel"], ["game", "channel"]) &&
        firstString(capability.body.game) !== null &&
        firstString(capability.body.channel) !== null &&
        normalizeCapability(capability) !== null
      );
    default:
      return false;
  }
}

function optionalSafeEpoch(value) {
  return value === undefined || (Number.isSafeInteger(value) && value >= 0);
}

function exactObject(value, allowedKeys, requiredKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return (
    requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key)) &&
    actual.every((key) => allowedKeys.includes(key))
  );
}
