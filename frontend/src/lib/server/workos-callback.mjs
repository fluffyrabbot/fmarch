import {
  OAuthStateMismatchError,
  PKCECookieMissingError,
  SessionEncryptionError,
} from "@workos/authkit-session";
import { serverApiBaseUrl } from "./api-base.mjs";
import { authReturnPath, sameOriginAuthPath } from "./auth-return-path.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "./session-capabilities.mjs";
import { canonicalPrincipalId } from "../principal-id.mjs";
import {
  loadAuthKit,
  workosAuthKitConfigured,
  WORKOS_SESSION_COOKIE_NAME,
} from "./workos-authkit.mjs";
import { workosProviderLogoutUrl } from "./workos-provider-logout.mjs";

const SAFE_PROVIDER_ERROR = /^[a-z][a-z0-9_.-]{0,63}$/u;
const WORKOS_LINK_CALLBACK_PATH = "/auth/account/security";
const WORKOS_PROVIDER_SESSION_LOGOUT_REQUIRED =
  "WorkosProviderSessionLogoutRequired";

export function createWorkosCallbackHandler({
  env = process.env,
  loadAuthKitImpl = loadAuthKit,
  logger = console,
} = {}) {
  return async function workosCallback(event) {
    if (!workosAuthKitConfigured(env)) {
      return redirectResponse("/auth/login", 302);
    }

    const authKit = await loadAuthKitImpl(env);
    const state = optionalValue(event.url.searchParams.get("state"));
    const providerError = optionalValue(event.url.searchParams.get("error"));
    discardWorkosSession(event.cookies);

    if (providerError !== null) {
      await clearPendingVerifier({ authKit, cookies: event.cookies, state, logger });
      const code = safeProviderError(providerError);
      logOutcome(logger, "rejected", `provider_${code}`);
      return loginFailure(`provider_${code}`);
    }
    if (state === null) {
      logOutcome(logger, "rejected", "state_missing");
      return loginFailure("state_missing");
    }

    const code = optionalValue(event.url.searchParams.get("code"));
    if (code === null) {
      await clearPendingVerifier({ authKit, cookies: event.cookies, state, logger });
      logOutcome(logger, "rejected", "code_missing");
      return loginFailure("code_missing");
    }

    let callback;
    try {
      callback = await authKit.handleCallback(event.cookies, event.cookies, { code, state });
    } catch (error) {
      await clearPendingVerifier({ authKit, cookies: event.cookies, state, logger });
      const reason = callbackFailureReason(error);
      logOutcome(logger, "rejected", reason);
      return loginFailure(reason);
    }

    discardWorkosSession(event.cookies);
    const accessToken = callback?.authResponse?.accessToken;
    if (typeof accessToken !== "string" || accessToken.trim() === "") {
      logOutcome(logger, "rejected", "provider_response_malformed");
      return loginFailure("provider_response_malformed");
    }

    const link = workosLinkTarget(
      sameOriginAuthPath(callback.returnPathname, {
        allowAuthPath: WORKOS_LINK_CALLBACK_PATH,
      }),
    );
    if (link !== null) {
      return completeWorkosLink({ event, accessToken, link, env, logger });
    }
    return completeWorkosLogin({
      event,
      accessToken,
      callbackTarget: authReturnPath(callback.returnPathname),
      env,
      logger,
    });
  };
}

async function completeWorkosLogin({ event, accessToken, callbackTarget, env, logger }) {
  let response;
  try {
    response = await event.fetch(`${serverApiBaseUrl(env)}/auth/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ method: "workos" }),
    });
  } catch {
    logOutcome(logger, "rejected", "api_unavailable");
    return loginFailure("api_unavailable");
  }
  if (!response.ok) {
    const providerLogoutUrl = await workosProviderSessionRecoveryUrl(response);
    if (providerLogoutUrl !== null) {
      logOutcome(logger, "rejected", "provider_session_logout_required");
      return redirectResponse(providerLogoutUrl);
    }
    logOutcome(logger, "rejected", `api_rejected_${safeStatus(response.status)}`);
    return loginFailure("api_rejected");
  }

  const body = await response.json().catch(() => null);
  if (!validSessionResponse(body)) {
    logOutcome(logger, "rejected", "api_response_malformed");
    return loginFailure("api_response_malformed");
  }

  event.cookies.set(
    SESSION_COOKIE_NAME,
    body.session_token,
    browserSessionCookieOptions(event.url),
  );
  logOutcome(logger, "accepted", "session_created");
  return redirectResponse(authReturnPath(callbackTarget));
}

async function workosProviderSessionRecoveryUrl(response) {
  if (response.status !== 409) return null;

  let body;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;

  let keys;
  try {
    keys = Object.keys(body).sort();
  } catch {
    return null;
  }
  if (
    keys.length !== 2 ||
    keys[0] !== "error" ||
    keys[1] !== "provider_logout_url" ||
    body.error !== WORKOS_PROVIDER_SESSION_LOGOUT_REQUIRED
  ) {
    return null;
  }
  return workosProviderLogoutUrl(body.provider_logout_url);
}

async function completeWorkosLink({ event, accessToken, link, env, logger }) {
  const appSession = event.cookies.get(SESSION_COOKIE_NAME);
  if (typeof appSession !== "string" || appSession.trim() === "") {
    logOutcome(logger, "rejected", "link_session_missing");
    return loginFailure("link_requires_session");
  }

  let endpoint;
  try {
    endpoint = `${serverApiBaseUrl(env)}/auth/account/methods/workos`;
  } catch {
    logOutcome(logger, "rejected", "link_api_unavailable");
    return redirectResponse(withQuery(link.securityPath, "workosError", "unavailable"));
  }

  const request = {
    method: "POST",
    headers: {
      authorization: `Bearer ${appSession}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ provider_assertion: accessToken }),
  };
  let outcome = await attemptWorkosLink(event.fetch, endpoint, request);
  const retryReason = linkRetryReason(outcome);
  if (retryReason !== null) {
    logLinkRetry(logger, retryReason);
    // Backend idempotency is keyed by this exact app bearer and provider
    // assertion. Reuse the byte-identical request once when the first result is
    // ambiguous; a received non-2xx response is definitive and never replayed.
    outcome = await attemptWorkosLink(event.fetch, endpoint, request);
  }

  if (outcome.kind === "transport_failure") {
    logOutcome(logger, "rejected", "link_api_unavailable");
    return redirectResponse(withQuery(link.securityPath, "workosError", "unavailable"));
  }
  if (outcome.kind === "http_rejection") {
    const reason = outcome.status === 403 ? "step_up_required" : "rejected";
    logOutcome(logger, "rejected", `link_api_${reason}`);
    return redirectResponse(withQuery(link.securityPath, "workosError", reason));
  }
  if (outcome.kind === "provider_session_logout_required") {
    logOutcome(logger, "rejected", "link_provider_session_logout_required");
    return redirectResponse(outcome.providerLogoutUrl);
  }
  if (outcome.kind === "malformed_response") {
    logOutcome(logger, "rejected", "link_api_response_malformed");
    return redirectResponse(withQuery(link.securityPath, "workosError", "malformed_response"));
  }

  logOutcome(logger, "accepted", "method_linked");
  // The backend has atomically consumed the provider assertion and closed its
  // sid. Complete that one-time ceremony at WorkOS without adding a
  // caller-controlled return_to parameter.
  return redirectResponse(outcome.providerLogoutUrl);
}

async function attemptWorkosLink(fetchImpl, endpoint, request) {
  let response;
  try {
    response = await fetchImpl(endpoint, request);
  } catch {
    return { kind: "transport_failure" };
  }

  let ok;
  try {
    ok = response?.ok;
  } catch {
    return { kind: "malformed_response" };
  }
  if (typeof ok !== "boolean") {
    return { kind: "malformed_response" };
  }
  if (!ok) {
    const providerLogoutUrl = await workosProviderSessionRecoveryUrl(response);
    if (providerLogoutUrl !== null) {
      return { kind: "provider_session_logout_required", providerLogoutUrl };
    }
    return { kind: "http_rejection", status: response.status };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { kind: "malformed_response" };
  }
  const providerLogoutUrl = workosProviderLogoutUrl(body?.provider_logout_url);
  if (!validLinkResponse(body) || providerLogoutUrl === null) {
    return { kind: "malformed_response" };
  }
  return { kind: "accepted", providerLogoutUrl };
}

function linkRetryReason(outcome) {
  if (outcome.kind === "transport_failure") return "link_api_transport_failure";
  if (outcome.kind === "malformed_response") return "link_api_response_malformed";
  return null;
}

async function clearPendingVerifier({ authKit, cookies, state, logger }) {
  if (state === null) return;
  try {
    await authKit.clearPendingVerifier(cookies, { state });
  } catch {
    logCleanupFailure(logger);
  }
}

function discardWorkosSession(cookies) {
  cookies.delete(WORKOS_SESSION_COOKIE_NAME, { path: "/" });
}

function callbackFailureReason(error) {
  if (error instanceof OAuthStateMismatchError || error?.name === "OAuthStateMismatchError") {
    return "state_mismatch";
  }
  if (error instanceof PKCECookieMissingError || error?.name === "PKCECookieMissingError") {
    return "pkce_cookie_missing";
  }
  if (error instanceof SessionEncryptionError || error?.name === "SessionEncryptionError") {
    return "session_encryption_failed";
  }
  return "provider_exchange_failed";
}

function safeProviderError(value) {
  const normalized = value.trim().toLowerCase();
  return SAFE_PROVIDER_ERROR.test(normalized) ? normalized : "error";
}

function validSessionResponse(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    canonicalPrincipalId(body.principal_id) !== null &&
    typeof body.session_token === "string" &&
    body.session_token.startsWith("fmss_")
  );
}

function validLinkResponse(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    body.status === "attached" &&
    typeof body.method_id === "string" &&
    body.method_id !== "" &&
    canonicalPrincipalId(body.principal_id) !== null
  );
}

function safeStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : "unknown";
}

function workosLinkTarget(value) {
  if (typeof value !== "string") return null;
  const url = new URL(value, "http://fmarch.invalid");
  if (
    url.pathname !== "/auth/account/security" ||
    url.searchParams.get("fmarchWorkosFlow") !== "link"
  ) {
    return null;
  }
  return {
    securityPath: `/auth/account/security?${new URLSearchParams({
      returnTo: authReturnPath(url.searchParams.get("returnTo")),
    })}`,
  };
}

function withQuery(path, name, value) {
  const url = new URL(path, "http://fmarch.invalid");
  url.searchParams.set(name, value);
  return `${url.pathname}${url.search}`;
}

function loginFailure(reason) {
  return redirectResponse(`/auth/login?${new URLSearchParams({ error: `workos_${reason}` })}`);
}

function redirectResponse(location, status = 303) {
  return new Response(null, { status, headers: { location } });
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function logOutcome(logger, outcome, reason) {
  logger?.info?.(JSON.stringify({ event: "workos_callback", outcome, reason }));
}

function logCleanupFailure(logger) {
  logger?.warn?.(
    JSON.stringify({
      event: "workos_callback_cleanup",
      outcome: "deferred",
      reason: "verifier_cookie_ttl_fallback",
    }),
  );
}

function logLinkRetry(logger, reason) {
  logger?.warn?.(
    JSON.stringify({
      event: "workos_callback_retry",
      outcome: "retrying",
      reason,
    }),
  );
}
