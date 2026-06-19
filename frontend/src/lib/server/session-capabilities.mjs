export const SESSION_COOKIE_NAME = "fmarch_session";
export const SMOKE_AUTH_ENV = "FMARCH_HOST_CONSOLE_SMOKE_AUTH";
export const SMOKE_HOST_GAME_HEADER = "x-fmarch-smoke-host-game";

export function resolveAuthenticatedSession({
  cookies,
  request,
  env = process.env,
} = {}) {
  const smokeSession = resolveSmokeSession({ request, env });
  if (smokeSession !== null) {
    return smokeSession;
  }

  const cookieValue = cookies?.get?.(SESSION_COOKIE_NAME);
  if (cookieValue === undefined || cookieValue === null || cookieValue === "") {
    return emptySession();
  }

  return normalizeSessionPayload(parseSessionCookie(cookieValue));
}

function resolveSmokeSession({ request, env }) {
  if (env?.[SMOKE_AUTH_ENV] !== "1") {
    return null;
  }

  const game = request?.headers?.get?.(SMOKE_HOST_GAME_HEADER);
  if (typeof game !== "string" || game.trim() === "") {
    return null;
  }

  return Object.freeze({
    principalUserId: "host-smoke",
    resolvedCapabilities: Object.freeze([
      Object.freeze({
        kind: "HostOf",
        game,
        source: "smoke-test-hook",
      }),
    ]),
  });
}

function parseSessionCookie(cookieValue) {
  const decoded = decodeURIComponent(cookieValue);
  try {
    return JSON.parse(decoded);
  } catch {
    return JSON.parse(decodeBase64Url(decoded));
  }
}

function normalizeSessionPayload(payload) {
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
    resolvedCapabilities: Object.freeze(
      rawCapabilities.map(normalizeCapability).filter(Boolean),
    ),
  });
}

function normalizeCapability(capability) {
  if (capability === null || typeof capability !== "object") {
    return null;
  }

  const kind = firstString(capability.kind);
  const body = capability.body ?? {};
  const game = firstString(capability.game, body.game);
  if ((kind === "HostOf" || kind === "CohostOf") && game !== null) {
    return Object.freeze({
      kind,
      game,
      source: firstString(capability.source) ?? "session-cookie",
    });
  }

  return null;
}

function emptySession() {
  return Object.freeze({
    principalUserId: null,
    resolvedCapabilities: Object.freeze([]),
  });
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return Buffer.from(padded, "base64").toString("utf8");
}
