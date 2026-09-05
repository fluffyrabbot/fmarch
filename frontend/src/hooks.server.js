import { sequence } from "@sveltejs/kit/hooks";
import { error } from "@sveltejs/kit";
import {
  rotateAuthenticatedBrowserSession,
  resolveAuthenticatedSession,
  sessionContextFromRequest,
} from "./lib/server/session-capabilities.mjs";
import { frontendFixtureMode } from "./lib/server/runtime-mode.mjs";

// Fail the adapter at startup instead of ever serving fixture authority from a
// production process.
frontendFixtureMode();

// The backend-owned app session in the fmarch_session cookie is the only
// per-request identity for the application itself.
export async function fmarchIdentityHandle({ event, resolve }) {
  let resolution = await resolveAuthenticatedSession({
    cookies: event.cookies,
    fetchImpl: event.fetch,
    request: event.request,
  });
  let session = sessionFromResolution(resolution, event.cookies);

  if (session.rotationRequired) {
    const rotation = await rotateAuthenticatedBrowserSession({
      cookies: event.cookies,
      fetchImpl: event.fetch,
      request: event.request,
    });
    if (rotation.status === "rotated") {
      resolution = await resolveAuthenticatedSession({
        cookies: event.cookies,
        fetchImpl: event.fetch,
        request: event.request,
      });
      session = sessionFromResolution(resolution, event.cookies);
    } else if (rotation.status === "stale") {
      event.cookies.delete("fmarch_session", { path: "/" });
      session = {
        principalId: null,
        rotationRequired: false,
        resolvedCapabilities: [],
      };
    } else if (sessionContextFromRequest(event.request)?.kind === "optional_public") {
      // A public route must not become unavailable merely because rotating an
      // otherwise valid browser session failed. Retain the cookie so a later
      // request can recover, but strip all identity and authority for this
      // response.
      session = {
        principalId: null,
        rotationRequired: false,
        resolvedCapabilities: [],
      };
    } else {
      throw error(503, "Identity session rotation is temporarily unavailable.");
    }
  }

  event.locals.principalId = session.principalId;
  event.locals.viewerProfile = session.viewerProfile ?? null;
  event.locals.resolvedCapabilities = session.resolvedCapabilities;

  return resolve(event);
}

function sessionFromResolution(resolution, cookies) {
  switch (resolution?.kind) {
    case "authenticated":
    case "anonymous":
      return resolution.session;
    case "stale":
      cookies?.delete?.("fmarch_session", { path: "/" });
      return resolution.session;
    case "invalid_response":
      throw error(502, "Identity service returned an invalid response.");
    case "unavailable":
      throw error(503, "Identity service is temporarily unavailable.");
    default:
      throw error(502, "Identity session could not be resolved safely.");
  }
}

export async function securityHeadersHandle({ event, resolve }) {
  const response = await resolve(event);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("cross-origin-opener-policy", "same-origin");
  response.headers.set("cross-origin-resource-policy", "same-origin");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("x-permitted-cross-domain-policies", "none");
  if (event.url.protocol === "https:") {
    response.headers.set(
      "strict-transport-security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return response;
}

export const handle = sequence(
  securityHeadersHandle,
  fmarchIdentityHandle,
);
