import { resolveAuthenticatedSession } from "$lib/server/session-capabilities.mjs";

export async function handle({ event, resolve }) {
  const session = resolveAuthenticatedSession({
    cookies: event.cookies,
    request: event.request,
  });

  event.locals.principalUserId = session.principalUserId;
  event.locals.resolvedCapabilities = session.resolvedCapabilities;

  return resolve(event);
}
