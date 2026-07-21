import { randomUUID } from "node:crypto";
import { normalizeCapabilities } from "../app/capabilities.mjs";

export const SESSION_COOKIE_NAME = "fmarch_session";
export const FIXTURE_SESSION_COOKIE_NAME = "fmarch_fixture_session";

export async function resolveAuthenticatedSession({
  cookies,
  request,
  fetchImpl = fetch,
  env = process.env,
} = {}) {
  const token = cookies?.get?.(SESSION_COOKIE_NAME);
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

  const response = await fetchImpl(authSessionUrl({ env, context }), {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });
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

  const sessionToken = `account-session-${randomUUID()}`;
  const response = await fetchImpl(`${authApiBaseUrl(env)}/auth/session-rotations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });
  if (!response.ok) {
    return { status: response.status === 401 ? "stale" : "unavailable" };
  }

  const body = await response.json().catch(() => null);
  if (!validSessionPayload(body)) {
    return { status: "unavailable" };
  }
  const url = new URL(typeof request?.url === "string" ? request.url : "http://localhost/");
  cookies?.set?.(SESSION_COOKIE_NAME, sessionToken, browserSessionCookieOptions(url));
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
  if (/^\/(?:community|discussions|search|games)(?:\/.*)?$/.test(pathname)) {
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
  return typeof env?.FMARCH_API_BASE_URL === "string"
    ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
    : "";
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
