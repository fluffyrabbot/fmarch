import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";
import { SESSION_COOKIE_NAME } from "../../../../lib/server/session-capabilities.mjs";

export function load({ locals, url }) {
  const accountId = optionalField(url.searchParams.get("account"));
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (typeof locals.principalUserId !== "string" || locals.principalUserId.trim() === "") {
    throw redirect(
      303,
      loginPath({
        accountId,
        returnTo: `${url.pathname}${url.search}`,
      }),
    );
  }

  return {
    accountSecurity: {
      accountId,
      principalUserId: locals.principalUserId,
      returnTo,
    },
  };
}

export const actions = {
  rotatePassword: async ({ cookies, fetch, request, url }) => {
    const formData = await request.formData();
    const accountId = optionalField(formData.get("accountId"));
    const currentPassword = passwordField(formData.get("currentPassword"));
    const newPassword = passwordField(formData.get("newPassword"));
    const confirmPassword = passwordField(formData.get("confirmPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);

    if (
      accountId === "" ||
      currentPassword === null ||
      newPassword === null ||
      confirmPassword === null ||
      typeof sessionToken !== "string" ||
      sessionToken.trim() === ""
    ) {
      return fail(400, {
        id: "account-password-rotation",
        state: "reject",
        message: "Account, current password, and new password are required",
        accountId,
        returnTo,
      });
    }
    if (newPassword !== confirmPassword) {
      return fail(400, {
        id: "account-password-rotation",
        state: "reject",
        message: "New password confirmation does not match",
        accountId,
        returnTo,
      });
    }

    const response = await fetch(accountPasswordRotationUrl(process.env), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    if (!response.ok) {
      return fail(response.status === 400 || response.status === 401 ? response.status : 502, {
        id: "account-password-rotation",
        state: "reject",
        message:
          response.status === 401
            ? "Account credentials are missing, disabled, or invalid"
            : response.status === 400
              ? await rejectionMessage(response)
              : "Auth service could not rotate the account password",
        accountId,
        returnTo,
      });
    }
    const body = await response.json();
    if (
      body?.status !== "rotated" ||
      body?.account_id !== accountId ||
      body?.password_algorithm !== "argon2id"
    ) {
      return fail(502, {
        id: "account-password-rotation",
        state: "reject",
        message: "Auth service returned a malformed password rotation",
        accountId,
        returnTo,
      });
    }

    cookies.delete(SESSION_COOKIE_NAME, { path: "/" });
    throw redirect(303, loginPath({ accountId, returnTo }));
  },
  issueRecovery: async ({ cookies, fetch, request }) => {
    const formData = await request.formData();
    const accountId = optionalField(formData.get("accountId"));
    const currentPassword = passwordField(formData.get("currentPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (
      accountId === "" ||
      currentPassword === null ||
      typeof sessionToken !== "string" ||
      sessionToken.trim() === ""
    ) {
      return fail(400, {
        id: "account-recovery-issue",
        state: "reject",
        message: "Account and current password are required",
        accountId,
        returnTo,
      });
    }
    const response = await fetch(accountRecoveryCredentialUrl(process.env), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        current_password: currentPassword,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      }),
    });
    if (!response.ok) {
      return fail(response.status === 400 || response.status === 401 ? response.status : 502, {
        id: "account-recovery-issue",
        state: "reject",
        message:
          response.status === 401
            ? "Account credentials are missing, disabled, or invalid"
            : "Auth service could not issue a recovery credential",
        accountId,
        returnTo,
      });
    }
    const body = await response.json();
    if (
      body?.status !== "issued" ||
      body?.account_id !== accountId ||
      typeof body?.recovery_id !== "string" ||
      typeof body?.recovery_token !== "string" ||
      !body.recovery_token.startsWith("account-recovery-")
    ) {
      return fail(502, {
        id: "account-recovery-issue",
        state: "reject",
        message: "Auth service returned a malformed recovery credential",
        accountId,
        returnTo,
      });
    }
    return {
      id: "account-recovery-issue",
      state: "ack",
      message: "Recovery credential issued",
      accountId,
      returnTo,
      recoveryId: body.recovery_id,
      recoveryToken: body.recovery_token,
      expiresAt: body.expires_at,
    };
  },
  revokeRecovery: async ({ cookies, fetch, request }) => {
    const formData = await request.formData();
    const accountId = optionalField(formData.get("accountId"));
    const recoveryId = optionalField(formData.get("recoveryId"));
    const currentPassword = passwordField(formData.get("currentPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (
      accountId === "" ||
      recoveryId === "" ||
      currentPassword === null ||
      typeof sessionToken !== "string" ||
      sessionToken.trim() === ""
    ) {
      return fail(400, {
        id: "account-recovery-revoke",
        state: "reject",
        message: "Account, recovery ID, and current password are required",
        accountId,
        returnTo,
      });
    }
    const response = await fetch(accountRecoveryCredentialRevocationUrl(process.env), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        account_id: accountId,
        current_password: currentPassword,
        recovery_id: recoveryId,
      }),
    });
    if (!response.ok) {
      return fail(response.status === 400 || response.status === 401 ? response.status : 502, {
        id: "account-recovery-revoke",
        state: "reject",
        message:
          response.status === 401
            ? "Recovery credential is missing, used, or already revoked"
            : "Auth service could not revoke the recovery credential",
        accountId,
        returnTo,
      });
    }
    const body = await response.json();
    if (body?.status !== "revoked" || body?.recovery_id !== recoveryId) {
      return fail(502, {
        id: "account-recovery-revoke",
        state: "reject",
        message: "Auth service returned a malformed recovery revocation",
        accountId,
        returnTo,
      });
    }
    return {
      id: "account-recovery-revoke",
      state: "ack",
      message: "Recovery credential revoked",
      accountId,
      returnTo,
      recoveryId,
    };
  },
};

function accountPasswordRotationUrl(env) {
  return `${authBaseUrl(env)}/auth/accounts/password-rotations`;
}

function accountRecoveryCredentialUrl(env) {
  return `${authBaseUrl(env)}/auth/accounts/recovery-credentials`;
}

function accountRecoveryCredentialRevocationUrl(env) {
  return `${authBaseUrl(env)}/auth/accounts/recovery-credential-revocations`;
}

function authBaseUrl(env) {
  return serverApiBaseUrl(env);
}

function loginPath({ accountId, returnTo }) {
  const query = new URLSearchParams({ returnTo });
  if (accountId !== "") {
    query.set("account", accountId);
  }
  return `/auth/login?${query}`;
}

async function rejectionMessage(response) {
  const body = await response.json().catch(() => null);
  return typeof body?.message === "string" && body.message.trim() !== ""
    ? body.message
    : "Password rotation was rejected";
}

function passwordField(value) {
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
