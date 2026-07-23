import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { authSourceHeader } from "../../../lib/server/auth-source.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "../../../lib/server/session-capabilities.mjs";

export function load({ locals, url }) {
  return {
    invite: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      inviteToken: optionalField(url.searchParams.get("invite")),
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

export const actions = {
  default: async ({ cookies, fetch, getClientAddress, request, url }) => {
    const formData = await request.formData();
    const token = requiredField(formData, "token");
    const accountId = requiredField(formData, "accountId");
    const password = requiredField(formData, "password");
    const returnTo = safeReturnTo(formData.get("returnTo"));
    if (token === null) {
      return fail(400, {
        state: "reject",
        message: "Invitation or session credential is required",
        accountId: accountId ?? "",
        returnTo,
      });
    }

    const direct = await verifySessionToken({ fetch, token });
    if (direct.status === "ok") {
      cookies.set(SESSION_COOKIE_NAME, token, browserSessionCookieOptions(url));
      throw redirect(303, returnTo);
    }
    if (direct.status !== "unauthorized") {
      return fail(502, {
        state: "reject",
        message: direct.message,
        accountId: accountId ?? "",
        returnTo,
      });
    }
    if (accountId === null || password === null) {
      return fail(400, {
        state: "reject",
        message: "Invitation redemption requires the invited account and password",
        accountId: accountId ?? "",
        returnTo,
      });
    }

    const redeemed = await redeemInviteToken({
      fetch,
      inviteToken: token,
      accountId,
      password,
      authSource: clientAuthSource(getClientAddress),
    });
    if (redeemed.status !== "ok") {
      return fail(redeemed.statusCode, {
        state: "reject",
        message: redeemed.message,
        accountId,
        returnTo,
      });
    }

    cookies.set(SESSION_COOKIE_NAME, redeemed.sessionToken, browserSessionCookieOptions(url));
    throw redirect(303, returnTo);
  },
};

async function verifySessionToken({ fetch, token }) {
  const response = await fetch(`${serverApiBaseUrl()}/auth/session`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    return response.status === 401
      ? { status: "unauthorized" }
      : { status: "error", message: "Auth service could not verify the session credential" };
  }
  const body = await response.json().catch(() => null);
  return validSessionBody(body)
    ? { status: "ok" }
    : { status: "error", message: "Auth service returned a malformed session" };
}

async function redeemInviteToken({ fetch, inviteToken, accountId, password, authSource }) {
  const response = await fetch(`${serverApiBaseUrl()}/auth/invites/redeem`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authSourceHeader(authSource),
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      account_id: accountId,
      password,
    }),
  });
  if (!response.ok) {
    return response.status === 429
      ? authRateLimitRejection(response)
      : {
          status: "reject",
          statusCode: response.status === 401 ? 401 : 502,
          message: "Invitation is missing, expired, revoked, or already used",
        };
  }
  const body = await response.json().catch(() => null);
  return validSessionBody(body) && typeof body.session_token === "string" && body.session_token.trim() !== ""
    ? { status: "ok", sessionToken: body.session_token }
    : {
        status: "reject",
        statusCode: 502,
        message: "Auth service returned a malformed invitation redemption",
      };
}

function authRateLimitRejection(response) {
  const retryAfter = Number.parseInt(response.headers?.get?.("retry-after") ?? "", 10);
  return {
    status: "reject",
    statusCode: 429,
    message:
      Number.isSafeInteger(retryAfter) && retryAfter > 0
        ? `Too many credential attempts. Try again in ${retryAfter} seconds.`
        : "Too many credential attempts. Try again shortly.",
  };
}

function clientAuthSource(getClientAddress) {
  if (typeof getClientAddress !== "function") {
    return null;
  }
  try {
    const value = getClientAddress();
    return typeof value === "string" && value.trim() !== "" && value.length <= 256
      ? value.trim()
      : null;
  } catch {
    return null;
  }
}

function requiredField(formData, field) {
  const value = formData.get(field);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validSessionBody(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.principal_user_id === "string" &&
    body.principal_user_id.trim() !== "" &&
    Array.isArray(body.capabilities)
  );
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed === "/auth/invite" || trimmed.startsWith("/auth/invite?")
    ? "/"
    : trimmed;
}
