import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import {
  evictSessionCacheForToken,
  SESSION_COOKIE_NAME,
} from "../../../lib/server/session-capabilities.mjs";
import { WORKOS_SESSION_COOKIE_NAME } from "../../../lib/server/workos-authkit.mjs";

export function load({ locals, url }) {
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (typeof locals.principalUserId !== "string" || locals.principalUserId.trim() === "") {
    throw redirect(303, loginPath(returnTo));
  }
  return { logout: { principalUserId: locals.principalUserId, returnTo } };
}

export const actions = {
  default: async ({ cookies, fetch, request }) => {
    const returnTo = safeReturnTo((await request.formData()).get("returnTo"));
    const token = cookies.get(SESSION_COOKIE_NAME);
    if (typeof token !== "string" || token.trim() === "") {
      throw redirect(303, loginPath(returnTo));
    }

    const response = await fetch(logoutUrl(process.env), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok) {
      if (response.status === 401) {
        discardBrowserSession({ cookies, token });
        throw redirect(303, loginPath(returnTo));
      }
      return fail(502, {
        state: "reject",
        message: "Auth service could not complete sign out; this browser session remains active",
        returnTo,
      });
    }
    const body = await response.json().catch(() => null);
    if (body?.status !== "logged_out" || typeof body?.principal_user_id !== "string") {
      return fail(502, {
        state: "reject",
        message: "Auth service returned a malformed sign out result; this browser session remains active",
        returnTo,
      });
    }

    discardBrowserSession({ cookies, token });
    throw redirect(303, loginPath(returnTo));
  },
};

function discardBrowserSession({ cookies, token }) {
  evictSessionCacheForToken(token);
  cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
  // Defensive: an interrupted WorkOS exchange may have stranded the AuthKit
  // cookie; a signed-out browser must not keep any identity state.
  cookies.delete(WORKOS_SESSION_COOKIE_NAME, { path: "/" });
}

function logoutUrl(env) {
  return `${serverApiBaseUrl(env)}/auth/session-logout`;
}

function loginPath(returnTo) {
  return `/auth/login?${new URLSearchParams({ returnTo })}`;
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/auth/")) {
    return "/";
  }
  return trimmed;
}
