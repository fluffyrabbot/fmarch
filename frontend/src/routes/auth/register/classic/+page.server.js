import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";
import { authSourceHeader } from "../../../../lib/server/auth-source.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "../../../../lib/server/session-capabilities.mjs";

export function load({ url }) {
  return {
    registration: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
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

    cookies.set(SESSION_COOKIE_NAME, body.session_token, browserSessionCookieOptions(url));
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
    body.principal_user_id.trim() !== "" &&
    typeof body.session_token === "string" &&
    body.session_token.trim() !== "" &&
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
  return trimmed === "/auth/register" ||
    trimmed.startsWith("/auth/register?") ||
    trimmed.startsWith("/auth/register/")
    ? "/"
    : trimmed;
}
