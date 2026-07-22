import { sequence } from "@sveltejs/kit/hooks";
import {
  rotateAuthenticatedBrowserSession,
  resolveAuthenticatedSession,
  resolveAuthenticatedSessionCached,
} from "./lib/server/session-capabilities.mjs";
import {
  loadWorkosAuthKitModule,
  workosAuthKitConfigured,
} from "./lib/server/workos-authkit.mjs";

const workosConfigured = workosAuthKitConfigured(process.env);

// AuthKit middleware is confined to the WorkOS sign-in ceremony: the start
// routes (which mint provider URLs and PKCE cookies), the OAuth callback, and
// the one-time exchange that trades the provider token for the backend-owned
// fmarch_session. Every other request never touches WorkOS.
const WORKOS_CEREMONY_ROUTES = [
  "/auth/login/workos",
  "/auth/register/workos",
  "/auth/callback",
  "/auth/workos/complete",
];

let configuredWorkosHandlePromise = null;

function workosCeremonyRoute(pathname) {
  return WORKOS_CEREMONY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

async function workosCeremonyHandle({ event, resolve }) {
  if (!workosConfigured || !workosCeremonyRoute(event.url.pathname)) {
    return resolve(event);
  }
  return (await configuredWorkosHandle())({ event, resolve });
}

function configuredWorkosHandle() {
  configuredWorkosHandlePromise ??= loadWorkosAuthKitModule().then(
    ({ authKitHandle, configureAuthKit }) => {
      configureAuthKit({
        clientId: process.env.WORKOS_CLIENT_ID,
        apiKey: process.env.WORKOS_API_KEY,
        redirectUri: process.env.WORKOS_REDIRECT_URI,
        cookiePassword: process.env.WORKOS_COOKIE_PASSWORD,
      });
      return authKitHandle();
    },
  );
  return configuredWorkosHandlePromise;
}

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

export const handle = sequence(workosCeremonyHandle, fmarchIdentityHandle);
