import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";
import { authSourceHeader } from "../../../../lib/server/auth-source.mjs";
import {
  browserSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from "../../../../lib/server/session-capabilities.mjs";

export function load({ locals, url }) {
  return {
    login: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      accountId: optionalToken(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

export const actions = {
  default: async ({ cookies, fetch, getClientAddress, request, url }) => {
    const formData = await request.formData();
    const accountId = requiredToken(formData, "accountId");
    const password = requiredToken(formData, "password");
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const authSource = clientAuthSource(getClientAddress);
    if (accountId === null || password === null) {
      return fail(400, {
        state: "reject",
        message: "Account and password are required",
        returnTo,
      });
    }

    const account = await createClassicSession({ fetch, accountId, password, authSource });
    if (account.status !== "ok") {
      return fail(account.statusCode, {
        state: "reject",
        message: account.message,
        returnTo,
      });
    }

    cookies.set(SESSION_COOKIE_NAME, account.sessionToken, browserSessionCookieOptions(url));
    throw redirect(303, returnTo);
  },
};

async function createClassicSession({ fetch, accountId, password, authSource }) {
  const response = await fetch(authSessionsUrl(process.env), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      ...authSourceHeader(authSource),
    },
    body: JSON.stringify({
      method: "classic",
      login_name: accountId,
      password,
    }),
  });
  if (!response.ok) {
    if (response.status === 429) {
      return authRateLimitRejection(response);
    }
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
  return { status: "ok", sessionToken: body.session_token, session: body };
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

function authSessionsUrl(env) {
  return `${serverApiBaseUrl(env)}/auth/sessions`;
}

function validSessionBody(body) {
  return (
    body !== null &&
    typeof body === "object" &&
    typeof body.principal_user_id === "string" &&
    body.principal_user_id.trim() !== "" &&
    typeof body.session_token === "string" &&
    body.session_token.trim() !== "" &&
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
  return trimmed === "/auth/login" ||
    trimmed.startsWith("/auth/login?") ||
    trimmed.startsWith("/auth/login/")
    ? "/"
    : trimmed;
}
