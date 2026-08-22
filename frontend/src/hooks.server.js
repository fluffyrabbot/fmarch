import { sequence } from "@sveltejs/kit/hooks";
import {
  rotateAuthenticatedBrowserSession,
  resolveAuthenticatedSession,
  resolveAuthenticatedSessionCached,
} from "./lib/server/session-capabilities.mjs";

// The backend-owned app session in the fmarch_session cookie is the only
// per-request identity for the application itself.
export async function fmarchIdentityHandle({ event, resolve }) {
  let session = await resolveAuthenticatedSessionCached({
    cookies: event.cookies,
    fetchImpl: event.fetch,
    request: event.request,
  });

  if (session.rotationRequired) {
    const rotation = await rotateAuthenticatedBrowserSession({
      cookies: event.cookies,
      fetchImpl: event.fetch,
      request: event.request,
    });
    if (rotation.status === "rotated") {
      session = await resolveAuthenticatedSession({
        cookies: event.cookies,
        fetchImpl: event.fetch,
        request: event.request,
      });
    } else if (rotation.status === "stale") {
      event.cookies.delete("fmarch_session", { path: "/" });
      session = {
        principalId: null,
        rotationRequired: false,
        resolvedCapabilities: [],
      };
    }
  }

  event.locals.principalId = session.principalId;
  event.locals.viewerProfile = session.viewerProfile ?? null;
  event.locals.resolvedCapabilities = session.resolvedCapabilities;

  return resolve(event);
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
