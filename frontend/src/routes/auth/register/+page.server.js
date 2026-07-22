import { fail, redirect } from "@sveltejs/kit";
import { randomUUID } from "node:crypto";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "../../../lib/server/session-capabilities.mjs";

export function load({ url }) {
  if (workosConfigured()) {
    const query = new URLSearchParams({ returnTo: safeReturnTo(url.searchParams.get("returnTo")) });
    const account = optionalField(url.searchParams.get("account"));
    if (account !== "") query.set("loginHint", account);
    throw redirect(302, `/auth/sign-up?${query}`);
  }
  return {
    registration: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

function workosConfigured(env = process.env) {
  return typeof env.WORKOS_CLIENT_ID === "string" && env.WORKOS_CLIENT_ID.trim() !== "";
}

export const actions = {
  default: async ({ cookies, fetch, getClientAddress, request, url }) => {
    const formData = await request.formData();
    const accountId = optionalField(formData.get("accountId"));
    const password = passwordField(formData.get("password"));
    const confirmPassword = passwordField(formData.get("confirmPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    if (accountId === "" || password === null || confirmPassword === null) {
      return fail(400, rejection({
        message: "Account, password, and confirmation are required",
        accountId,
        returnTo,
      }));
    }
    if (password !== confirmPassword) {
      return fail(400, rejection({
        message: "Password confirmation does not match",
        accountId,
        returnTo,
      }));
    }

    const sessionToken = `registration-session-${randomUUID()}`;
    const response = await fetch(authRegistrationUrl(process.env), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...authSourceHeader(clientAuthSource(getClientAddress)),
      },
      body: JSON.stringify({
        account_id: accountId,
        password,
        session_token: sessionToken,
      }),
    });
    if (!response.ok) {
      return fail(response.status === 400 || response.status === 409 || response.status === 429 ? response.status : 502, rejection({
        message: await registrationRejection(response),
        accountId,
        returnTo,
      }));
    }
    const body = await response.json().catch(() => null);
    if (!validRegistrationBody(body, accountId)) {
      return fail(502, rejection({
        message: "Auth service returned a malformed registration",
        accountId,
        returnTo,
      }));
    }

    cookies.set(SESSION_COOKIE_NAME, sessionToken, browserSessionCookieOptions(url));
    throw redirect(303, accountSecurityPath({ accountId: body.account_id, returnTo }));
  },
};

function rejection({ message, accountId, returnTo }) {
  return { state: "reject", message, accountId, returnTo };
}

async function registrationRejection(response) {
  if (response.status === 409) {
    return "An account with this identifier already exists"
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
    return Number.isSafeInteger(retryAfter) && retryAfter > 0
      ? `Too many registration attempts. Try again in ${retryAfter} seconds.`
      : "Too many registration attempts. Try again shortly.";
  }
  const body = await response.json().catch(() => null);
  return typeof body?.message === "string" && body.message.trim() !== ""
    ? body.message
    : "Account registration was rejected";
}

function validRegistrationBody(body, accountId) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.account_id === "string" &&
    body.account_id === accountId.trim().toLowerCase() &&
    typeof body.principal_user_id === "string" &&
    body.principal_user_id.startsWith("registered-") &&
    Number.isSafeInteger(body.expires_at)
  );
}

function accountSecurityPath({ accountId, returnTo }) {
  const query = new URLSearchParams({ account: accountId, returnTo });
  return `/auth/account/security?${query.toString()}`;
}

function authRegistrationUrl(env) {
  return `${serverApiBaseUrl(env)}/auth/accounts/registrations`;
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

function authSourceHeader(authSource) {
  return authSource === null ? {} : { "x-fmarch-auth-source": authSource };
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function passwordField(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed === "/auth/register" || trimmed.startsWith("/auth/register?")
    ? "/"
    : trimmed;
}
