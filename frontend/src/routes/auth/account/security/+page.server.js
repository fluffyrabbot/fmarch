import { fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";
import {
  browserSessionCookieOptions,
  evictSessionCacheForToken,
  SESSION_COOKIE_NAME,
} from "../../../../lib/server/session-capabilities.mjs";
import { workosAuthKitConfigured } from "../../../../lib/server/workos-authkit.mjs";

export async function load({ cookies, fetch, locals, url }) {
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
      methods: await accountMethods({ cookies, fetch }),
      workosAvailable: workosAuthKitConfigured(),
      workosLinked: url.searchParams.get("workosLinked") === "1",
      workosError: optionalField(url.searchParams.get("workosError")),
    },
  };
}

async function accountMethods({ cookies, fetch }) {
  const sessionToken = cookies.get(SESSION_COOKIE_NAME);
  if (typeof sessionToken !== "string" || sessionToken.trim() === "") {
    return [];
  }
  let response;
  try {
    response = await fetch(accountMethodsUrl(process.env), {
      method: "GET",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: "application/json",
      },
    });
  } catch {
    return [];
  }
  if (!response.ok) {
    return [];
  }
  const body = await response.json().catch(() => null);
  if (body === null || typeof body !== "object" || !Array.isArray(body.methods)) {
    return [];
  }
  return body.methods
    .filter(
      (method) =>
        method !== null &&
        typeof method === "object" &&
        typeof method.method_id === "string" &&
        (method.kind === "classic_password" || method.kind === "workos"),
    )
    .map((method) => ({
      methodId: method.method_id,
      kind: method.kind,
      status: typeof method.status === "string" ? method.status : "active",
      createdAt: Number.isSafeInteger(method.created_at) ? method.created_at : null,
      lastAuthenticatedAt: Number.isSafeInteger(method.last_authenticated_at)
        ? method.last_authenticated_at
        : null,
      loginName: typeof method.login_name === "string" ? method.login_name : null,
      displayLabel: typeof method.display_label === "string" ? method.display_label : null,
    }));
}

export const actions = {
  addClassic: async ({ cookies, fetch, request, url }) => {
    const formData = await request.formData();
    const loginName = optionalField(formData.get("loginName"));
    const password = passwordField(formData.get("password"));
    const confirmPassword = passwordField(formData.get("confirmPassword"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (
      loginName === "" ||
      password === null ||
      confirmPassword === null ||
      typeof sessionToken !== "string" ||
      sessionToken.trim() === ""
    ) {
      return fail(400, {
        id: "account-method-add-classic",
        state: "reject",
        message: "Login name, password, and confirmation are required",
        accountId: loginName,
        returnTo,
      });
    }
    if (password !== confirmPassword) {
      return fail(400, {
        id: "account-method-add-classic",
        state: "reject",
        message: "Password confirmation does not match",
        accountId: loginName,
        returnTo,
      });
    }

    const response = await fetch(addClassicMethodUrl(process.env), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ login_name: loginName, password }),
    });
    if (!response.ok) {
      if (response.status === 403 && (await isStepUpRejection(response))) {
        return fail(403, {
          id: "account-method-add-classic",
          state: "step-up",
          message:
            "Confirm your identity again to add a sign-in method: sign in once more, then retry.",
          accountId: loginName,
          returnTo,
        });
      }
      return fail(
        response.status === 400 || response.status === 409 ? response.status : 502,
        {
          id: "account-method-add-classic",
          state: "reject",
          message:
            response.status === 409
              ? "This principal already has a classic sign-in, or the login name is taken"
              : response.status === 400
                ? await rejectionMessage(response, "Adding a classic sign-in was rejected")
                : "Auth service could not add the classic sign-in method",
          accountId: loginName,
          returnTo,
        },
      );
    }
    const body = await response.json().catch(() => null);
    if (
      body?.status !== "added" ||
      typeof body?.method_id !== "string" ||
      typeof body?.login_name !== "string" ||
      !Array.isArray(body?.recovery_codes) ||
      body.recovery_codes.some((code) => typeof code !== "string" || code.trim() === "") ||
      typeof body?.session_token !== "string" ||
      !body.session_token.startsWith("fmss_")
    ) {
      return fail(502, {
        id: "account-method-add-classic",
        state: "reject",
        message: "Auth service returned a malformed method addition",
        accountId: loginName,
        returnTo,
      });
    }

    evictSessionCacheForToken(sessionToken);
    cookies.set(
      SESSION_COOKIE_NAME,
      body.session_token,
      browserSessionCookieOptions(url),
    );

    return {
      id: "account-method-add-classic",
      state: "ack",
      message: "Classic sign-in added. Save these recovery codes now — they are shown only once.",
      accountId: body.login_name,
      returnTo,
      methodId: body.method_id,
      recoveryCodes: body.recovery_codes,
      recoveryCodesExpireAt: body.recovery_codes_expire_at ?? null,
      sessionSwitchedToClassic: true,
    };
  },
  disableMethod: async ({ cookies, fetch, request }) => {
    const formData = await request.formData();
    const methodId = optionalField(formData.get("methodId"));
    const returnTo = safeReturnTo(formData.get("returnTo"));
    const sessionToken = cookies.get(SESSION_COOKIE_NAME);
    if (methodId === "" || typeof sessionToken !== "string" || sessionToken.trim() === "") {
      return fail(400, {
        id: "account-method-disable",
        state: "reject",
        message: "A sign-in method is required",
        returnTo,
      });
    }

    const response = await fetch(disableMethodUrl(process.env, methodId), {
      method: "POST",
      headers: {
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      if (response.status === 403 && (await isStepUpRejection(response))) {
        return fail(403, {
          id: "account-method-disable",
          state: "step-up",
          message:
            "Confirm your identity again to remove a sign-in method: sign in once more, then retry.",
          returnTo,
        });
      }
      return fail(
        response.status === 400 || response.status === 401 || response.status === 409
          ? response.status
          : 502,
        {
          id: "account-method-disable",
          state: "reject",
          message:
            response.status === 409
              ? "Add another sign-in method before removing this one"
              : "Auth service could not remove the sign-in method",
          returnTo,
        },
      );
    }
    const body = await response.json().catch(() => null);
    if (body?.status !== "disabled" || body?.method_id !== methodId) {
      return fail(502, {
        id: "account-method-disable",
        state: "reject",
        message: "Auth service returned a malformed method removal",
        returnTo,
      });
    }

    return {
      id: "account-method-disable",
      state: "ack",
      message:
        "Sign-in method removed. Sessions signed in through it were signed out everywhere.",
      returnTo,
      methodId,
      methodKind: typeof body.kind === "string" ? body.kind : null,
    };
  },
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
              ? await rejectionMessage(response, "Password rotation was rejected")
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

async function isStepUpRejection(response) {
  const body = await response
    .clone()
    .json()
    .catch(() => null);
  return typeof body?.message === "string" && body.message.includes("recent_authentication_required");
}

function accountMethodsUrl(env) {
  return `${authBaseUrl(env)}/auth/account/methods`;
}

function addClassicMethodUrl(env) {
  return `${authBaseUrl(env)}/auth/account/methods/classic`;
}

function disableMethodUrl(env, methodId) {
  return `${authBaseUrl(env)}/auth/account/methods/${encodeURIComponent(methodId)}/disable`;
}

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

async function rejectionMessage(response, fallback) {
  const body = await response.json().catch(() => null);
  return typeof body?.message === "string" && body.message.trim() !== "" ? body.message : fallback;
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
