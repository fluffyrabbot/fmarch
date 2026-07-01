import { fail, redirect } from "@sveltejs/kit";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";

export function load({ locals, url }) {
  return {
    login: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      inviteToken: optionalToken(url.searchParams.get("invite")),
      accountId: optionalToken(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

export const actions = {
  default: async ({ cookies, fetch, request, url }) => {
    const formData = await request.formData();
    const token = requiredToken(formData, "token");
    const accountId = requiredToken(formData, "accountId");
    const password = requiredToken(formData, "password");
    const returnTo = safeReturnTo(formData.get("returnTo"));
    if (token === null && (accountId === null || password === null)) {
      return fail(400, {
        state: "reject",
        message: "Session, invite, or account credentials are required",
        returnTo,
      });
    }

    if (token !== null) {
      const direct = await verifySessionToken({ fetch, token });
      if (direct.status === "ok") {
        cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(url));
        throw redirect(303, returnTo);
      }
      if (direct.status !== "unauthorized") {
        return fail(502, {
          state: "reject",
          message: direct.message,
          returnTo,
        });
      }

      const redeemed = await redeemInviteToken({ fetch, inviteToken: token });
      if (redeemed.status !== "ok") {
        return fail(redeemed.statusCode, {
          state: "reject",
          message: redeemed.message,
          returnTo,
        });
      }

      cookies.set(SESSION_COOKIE_NAME, redeemed.sessionToken, sessionCookieOptions(url));
      throw redirect(303, returnTo);
    }

    const account = await loginAccount({ fetch, accountId, password });
    if (account.status !== "ok") {
      return fail(account.statusCode, {
        state: "reject",
        message: account.message,
        returnTo,
      });
    }

    cookies.set(SESSION_COOKIE_NAME, account.sessionToken, sessionCookieOptions(url));
    throw redirect(303, returnTo);
  },
};

async function verifySessionToken({ fetch, token }) {
  const response = await fetch(authSessionUrl(process.env), {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
  });
  if (!response.ok) {
    return response.status === 401
      ? { status: "unauthorized" }
      : {
          status: "error",
          message: "Auth service could not verify the session token",
        };
  }

  const body = await response.json();
  if (!validSessionBody(body)) {
    return {
      status: "error",
      message: "Auth service returned a malformed session",
    };
  }

  return { status: "ok", session: body };
}

async function redeemInviteToken({ fetch, inviteToken }) {
  const sessionToken = `invite-session-${randomUUID()}`;
  const response = await fetch(authInviteRedeemUrl(process.env), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      session_token: sessionToken,
    }),
  });
  if (!response.ok) {
    return {
      status: "reject",
      statusCode: response.status === 401 ? 401 : 502,
      message: "Session or invite token is missing, expired, or revoked",
    };
  }
  const body = await response.json();
  if (!validSessionBody(body)) {
    return {
      status: "reject",
      statusCode: 502,
      message: "Auth service returned a malformed invite redemption",
    };
  }
  return { status: "ok", sessionToken, session: body };
}

async function loginAccount({ fetch, accountId, password }) {
  const sessionToken = `account-session-${randomUUID()}`;
  const response = await fetch(authAccountLoginUrl(process.env), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      account_id: accountId,
      password,
      session_token: sessionToken,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    }),
  });
  if (!response.ok) {
    return {
      status: "reject",
      statusCode: response.status === 401 ? 401 : 502,
      message: "Account credentials are missing, disabled, or invalid",
    };
  }
  const body = await response.json();
  if (!validSessionBody(body)) {
    return {
      status: "reject",
      statusCode: 502,
      message: "Auth service returned a malformed account session",
    };
  }
  return { status: "ok", sessionToken, session: body };
}

function requiredToken(formData, field) {
  const value = formData.get(field);
  if (typeof value !== "string") {
    return null;
  }
  const token = value.trim();
  return token === "" ? null : token;
}

function optionalToken(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function authSessionUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/session`;
}

function authInviteRedeemUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/invites/redeem`;
}

function authAccountLoginUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/accounts/login`;
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

function sessionCookieOptions(url) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: url.protocol === "https:",
  };
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed === "/auth/login" || trimmed.startsWith("/auth/login?")
    ? "/"
    : trimmed;
}
