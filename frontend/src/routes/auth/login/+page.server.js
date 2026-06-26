import { fail, redirect } from "@sveltejs/kit";
import { SESSION_COOKIE_NAME } from "../../../lib/server/session-capabilities.mjs";

export function load({ locals, url }) {
  return {
    login: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

export const actions = {
  default: async ({ cookies, fetch, request, url }) => {
    const formData = await request.formData();
    const token = requiredToken(formData);
    const returnTo = safeReturnTo(formData.get("returnTo"));
    if (token === null) {
      return fail(400, {
        state: "reject",
        message: "Session token is required",
        returnTo,
      });
    }

    const response = await fetch(authSessionUrl(process.env), {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });
    if (!response.ok) {
      return fail(response.status === 401 ? 401 : 502, {
        state: "reject",
        message: "Session token is missing, expired, or revoked",
        returnTo,
      });
    }

    const body = await response.json();
    if (!validSessionBody(body)) {
      return fail(502, {
        state: "reject",
        message: "Auth service returned a malformed session",
        returnTo,
      });
    }

    cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(url));
    throw redirect(303, returnTo);
  },
};

function requiredToken(formData) {
  const value = formData.get("token");
  if (typeof value !== "string") {
    return null;
  }
  const token = value.trim();
  return token === "" ? null : token;
}

function authSessionUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/session`;
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
