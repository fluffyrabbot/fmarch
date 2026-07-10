import {
  rotateAuthenticatedBrowserSession,
  resolveAuthenticatedSession,
} from "./lib/server/session-capabilities.mjs";

export async function handle({ event, resolve }) {
  let session = await resolveAuthenticatedSession({
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
        principalUserId: null,
        rotationRequired: false,
        resolvedCapabilities: [],
      };
    }
  }

  event.locals.principalUserId = session.principalUserId;
  event.locals.resolvedCapabilities = session.resolvedCapabilities;

  return resolve(event);
}
