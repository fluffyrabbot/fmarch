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

let configuredWorkosHandlePromise = null;

const workosHandle = workosConfigured
  ? async (input) => await (await configuredWorkosHandle())(input)
  : async ({ event, resolve }) => {
      event.locals.auth = {
        user: null,
        organizationId: null,
        role: null,
        permissions: [],
        impersonator: null,
      };
      return resolve(event);
    };

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

export async function fmarchIdentityHandle({ event, resolve }) {
  const accessToken = event.locals.auth?.accessToken;
  let session = await resolveAuthenticatedSessionCached({
    accessToken,
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
        accessToken,
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

export const handle = sequence(workosHandle, fmarchIdentityHandle);
