import { fail, redirect } from "@sveltejs/kit";
import { SESSION_COOKIE_NAME } from "../../../../lib/server/session-capabilities.mjs";

export function load({ url }) {
  return {
    accountRecovery: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
    },
  };
}

export const actions = {
  default: async ({ cookies, fetch, request }) => {
    const formData = await request.formData();
    const accountId = optionalField(formData.get("accountId"));
    const recoveryToken = credentialField(formData.get("recoveryToken"));
    const newPassword = credentialField(formData.get("newPassword"));
    const confirmPassword = credentialField(formData.get("confirmPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    if (
      accountId === "" ||
      recoveryToken === null ||
      newPassword === null ||
      confirmPassword === null
    ) {
      return fail(400, {
        state: "reject",
        message: "Account, recovery credential, and new password are required",
        accountId,
        returnTo,
      });
    }
    if (newPassword !== confirmPassword) {
      return fail(400, {
        state: "reject",
        message: "New password confirmation does not match",
        accountId,
        returnTo,
      });
    }

    const response = await fetch(accountRecoveryUrl(process.env), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        recovery_token: recoveryToken,
        new_password: newPassword,
      }),
    });
    if (!response.ok) {
      const status = [400, 401, 429].includes(response.status) ? response.status : 502;
      return fail(status, {
        state: "reject",
        message:
          response.status === 429
            ? authRateLimitMessage(response)
            : response.status === 401
            ? "Recovery credential is missing, expired, revoked, used, or invalid"
            : response.status === 400
              ? await rejectionMessage(response)
              : "Auth service could not recover the account",
        accountId,
        returnTo,
      });
    }
    const body = await response.json();
    if (
      body?.status !== "recovered" ||
      body?.account_id !== accountId ||
      body?.password_algorithm !== "argon2id"
    ) {
      return fail(502, {
        state: "reject",
        message: "Auth service returned a malformed account recovery",
        accountId,
        returnTo,
      });
    }

    cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, loginPath({ accountId, returnTo }));
  },
};

function accountRecoveryUrl(env) {
  const baseUrl =
    typeof env.FMARCH_API_BASE_URL === "string"
      ? env.FMARCH_API_BASE_URL.replace(/\/$/, "")
      : "";
  return `${baseUrl}/auth/accounts/recoveries`;
}

function loginPath({ accountId, returnTo }) {
  const query = new URLSearchParams({ returnTo, account: accountId });
  return `/auth/login?${query}`;
}

async function rejectionMessage(response) {
  const body = await response.json().catch(() => null);
  return typeof body?.message === "string" && body.message.trim() !== ""
    ? body.message
    : "Account recovery was rejected";
}

function authRateLimitMessage(response) {
  const retryAfter = Number.parseInt(response.headers?.get?.("retry-after") ?? "", 10);
  return Number.isSafeInteger(retryAfter) && retryAfter > 0
    ? `Too many credential attempts. Try again in ${retryAfter} seconds.`
    : "Too many credential attempts. Try again shortly.";
}

function credentialField(value) {
  return typeof value === "string" && value !== "" ? value : null;
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed.startsWith("/auth/") ? "/" : trimmed;
}
