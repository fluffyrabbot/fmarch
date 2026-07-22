import { redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "$lib/server/api-base.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "$lib/server/session-capabilities.mjs";
import {
  workosAuthKitConfigured,
  WORKOS_SESSION_COOKIE_NAME,
} from "$lib/server/workos-authkit.mjs";

// The one-time exchange: the scoped AuthKit middleware has unsealed the cookie
// written by /auth/callback into locals.auth; trade its WorkOS access token
// for a backend-owned app session and delete the AuthKit cookie in the same
// response. From here on the fmarch_session cookie is the only identity the
// app carries.
export async function GET(event) {
  if (!workosAuthKitConfigured()) {
    throw redirect(302, "/auth/login");
  }
  const callbackTarget = safeCallbackTarget(event.url.searchParams.get("returnTo"));
  const link = workosLinkTarget(callbackTarget);
  const discardAuthKitCookie = () =>
    event.cookies.delete(WORKOS_SESSION_COOKIE_NAME, { path: "/" });

  const accessToken = event.locals.auth?.accessToken;
  if (typeof accessToken !== "string" || accessToken.trim() === "") {
    discardAuthKitCookie();
    throw redirect(303, "/auth/login?error=workos_exchange_failed");
  }

  if (link !== null) {
    const appSession = event.cookies.get(SESSION_COOKIE_NAME);
    if (typeof appSession !== "string" || appSession.trim() === "") {
      discardAuthKitCookie();
      throw redirect(303, "/auth/login?error=workos_link_requires_session");
    }
    let linkResponse;
    try {
      linkResponse = await event.fetch(
        `${serverApiBaseUrl(process.env)}/auth/account/methods/workos`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${appSession}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ provider_assertion: accessToken }),
        },
      );
    } catch {
      discardAuthKitCookie();
      throw redirect(303, `${link.securityPath}&workosError=unavailable`);
    }
    discardAuthKitCookie();
    if (!linkResponse.ok) {
      const reason = linkResponse.status === 403 ? "step_up_required" : "rejected";
      throw redirect(303, `${link.securityPath}&workosError=${reason}`);
    }
    throw redirect(303, `${link.securityPath}&workosLinked=1`);
  }

  let response;
  try {
    response = await event.fetch(`${serverApiBaseUrl(process.env)}/auth/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ method: "workos" }),
    });
  } catch {
    discardAuthKitCookie();
    throw redirect(303, "/auth/login?error=workos_exchange_failed");
  }
  if (!response.ok) {
    discardAuthKitCookie();
    throw redirect(303, "/auth/login?error=workos_exchange_failed");
  }
  const body = await response.json().catch(() => null);
  if (
    body === null ||
    typeof body !== "object" ||
    typeof body.session_token !== "string" ||
    body.session_token.trim() === ""
  ) {
    discardAuthKitCookie();
    throw redirect(303, "/auth/login?error=workos_exchange_failed");
  }

  event.cookies.set(
    SESSION_COOKIE_NAME,
    body.session_token,
    browserSessionCookieOptions(event.url),
  );
  discardAuthKitCookie();
  throw redirect(303, safeReturnTo(callbackTarget));
}

function safeCallbackTarget(value) {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : "/";
}

function workosLinkTarget(value) {
  const url = new URL(value, "http://fmarch.invalid");
  if (
    url.pathname !== "/auth/account/security" ||
    url.searchParams.get("fmarchWorkosFlow") !== "link"
  ) {
    return null;
  }
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  return {
    securityPath: `/auth/account/security?returnTo=${encodeURIComponent(returnTo)}`,
  };
}

function safeReturnTo(value) {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/auth/")
    ? trimmed
    : "/";
}
