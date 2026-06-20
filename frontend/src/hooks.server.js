import { resolveAuthenticatedSession } from "$lib/server/session-capabilities.mjs";

export async function handle({ event, resolve }) {
  const session = await resolveAuthenticatedSession({
    cookies: event.cookies,
    fetchImpl: event.fetch,
    request: event.request,
  });

  event.locals.principalUserId = session.principalUserId;
  event.locals.resolvedCapabilities = session.resolvedCapabilities;

  return resolve(event);
}
