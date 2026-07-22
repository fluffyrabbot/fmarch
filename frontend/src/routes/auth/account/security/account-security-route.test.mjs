import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("security load exposes the principal's sign-in methods", async () => {
  let observed;
  const result = await load({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "fmss_active-host-session" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed = { url, authorization: init.headers.authorization };
      return jsonResponse({
        principal_user_id: "host_h",
        methods: [
          {
            method_id: "00000000-0000-0000-0000-00000000000a",
            kind: "classic_password",
            status: "active",
            created_at: 100,
            last_authenticated_at: 200,
            login_name: "host@example.test",
          },
          {
            method_id: "00000000-0000-0000-0000-00000000000b",
            kind: "workos",
            status: "active",
            created_at: 50,
            display_label: "host@corp.example",
          },
        ],
      });
    },
    locals: { principalUserId: "host_h" },
    url: new URL(
      "http://localhost/auth/account/security?account=host%40example.test&returnTo=%2Fg%2Fgame-1%2Fhost",
    ),
  });
  assert.equal(observed.url, "/auth/account/methods");
  assert.equal(observed.authorization, "Bearer fmss_active-host-session");
  assert.deepEqual(result, {
    accountSecurity: {
      accountId: "host@example.test",
      principalUserId: "host_h",
      returnTo: "/g/game-1/host",
      methods: [
        {
          methodId: "00000000-0000-0000-0000-00000000000a",
          kind: "classic_password",
          status: "active",
          createdAt: 100,
          lastAuthenticatedAt: 200,
          loginName: "host@example.test",
          displayLabel: null,
        },
        {
          methodId: "00000000-0000-0000-0000-00000000000b",
          kind: "workos",
          status: "active",
          createdAt: 50,
          lastAuthenticatedAt: null,
          loginName: null,
          displayLabel: "host@corp.example",
        },
      ],
      workosAvailable: false,
      workosLinked: false,
      workosError: "",
    },
  });
});

test("security load sends an unauthenticated browser through account login", async () => {
  await assert.rejects(
    load({
      cookies: { get: () => undefined },
      fetch: async () => {
        throw new Error("methods must not be fetched for anonymous browsers");
      },
      locals: {},
      url: new URL(
        "http://localhost/auth/account/security?account=host%40example.test&returnTo=%2Fg%2Fgame-1%2Fhost",
      ),
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/login?returnTo=%2Fauth%2Faccount%2Fsecurity%3Faccount%3Dhost%2540example.test%26returnTo%3D%252Fg%252Fgame-1%252Fhost&account=host%40example.test",
  );
});

test("adding a classic method surfaces the display-once recovery codes", async () => {
  const observed = { request: null, cookie: null };
  const result = await actions.addClassic({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "fmss_workos-session" : undefined;
      },
      set(name, value, options) {
        observed.cookie = { name, value, options };
      },
    },
    fetch: async (url, init) => {
      observed.request = {
        url,
        authorization: init.headers.authorization,
        body: JSON.parse(init.body),
      };
      return jsonResponse({
        status: "added",
        method_id: "00000000-0000-0000-0000-00000000000c",
        login_name: "converted@example.test",
        principal_user_id: "host_h",
        recovery_codes: ["fmrc-one", "fmrc-two", "fmrc-three"],
        recovery_codes_expire_at: 4_102_444_800,
        session_token: "fmss_classic-session",
        session_expires_at: 4_102_444_800,
      });
    },
    request: formRequest({
      loginName: "converted@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/game-1/host",
    }),
    url: new URL("https://fmarch.example/auth/account/security"),
  });

  assert.equal(observed.request.url, "/auth/account/methods/classic");
  assert.equal(observed.request.authorization, "Bearer fmss_workos-session");
  assert.deepEqual(observed.request.body, {
    login_name: "converted@example.test",
    password: "correct horse battery",
  });
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: "fmss_classic-session",
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    },
  });
  assert.equal(result.state, "ack");
  assert.equal(result.id, "account-method-add-classic");
  assert.equal(result.sessionSwitchedToClassic, true);
  assert.deepEqual(result.recoveryCodes, ["fmrc-one", "fmrc-two", "fmrc-three"]);
});

test("adding a classic method surfaces a step-up requirement", async () => {
  const result = await actions.addClassic({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "fmss_stale-session" : undefined;
      },
    },
    fetch: async () =>
      jsonResponse(
        { error: "NotAuthorized", message: "recent_authentication_required" },
        { ok: false, status: 403 },
      ),
    request: formRequest({
      loginName: "converted@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.state, "step-up");
});

test("disabling a method reports the revocation outcome", async () => {
  let observed;
  const result = await actions.disableMethod({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "fmss_classic-session" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed = { url, authorization: init.headers.authorization };
      return jsonResponse({
        status: "disabled",
        method_id: "00000000-0000-0000-0000-00000000000b",
        kind: "workos",
        principal_user_id: "host_h",
        revoked_session_count: 1,
      });
    },
    request: formRequest({
      methodId: "00000000-0000-0000-0000-00000000000b",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(
    observed.url,
    "/auth/account/methods/00000000-0000-0000-0000-00000000000b/disable",
  );
  assert.equal(observed.authorization, "Bearer fmss_classic-session");
  assert.equal(result.state, "ack");
  assert.equal(result.methodKind, "workos");
});

test("disabling the last active method is refused with guidance", async () => {
  const result = await actions.disableMethod({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "fmss_classic-session" : undefined;
      },
    },
    fetch: async () =>
      jsonResponse(
        {
          error: "Internal",
          message:
            "an active principal must retain at least one active authentication method",
        },
        { ok: false, status: 409 },
      ),
    request: formRequest({
      methodId: "00000000-0000-0000-0000-00000000000a",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "Add another sign-in method before removing this one");
});

test("password rotation revokes the browser cookie and preserves the game return URL", async () => {
  const observed = { deleted: null, request: null };
  await assert.rejects(
    actions.rotatePassword({
      cookies: {
        get(name) {
          return name === "fmarch_session" ? "active-host-session" : undefined;
        },
        delete(name, options) {
          observed.deleted = { name, options };
        },
      },
      fetch: async (url, init) => {
        observed.request = {
          url,
          authorization: init.headers.authorization,
          body: JSON.parse(init.body),
        };
        return jsonResponse({
          status: "rotated",
          account_id: "host@example.test",
          principal_user_id: "host_h",
          revoked_session_count: 2,
          password_algorithm: "argon2id",
        });
      },
      request: formRequest({
        accountId: "host@example.test",
        currentPassword: "correct horse battery",
        newPassword: "rotated correct horse battery",
        confirmPassword: "rotated correct horse battery",
        returnTo: "/g/game-1/host",
      }),
      url: new URL("http://localhost/auth/account/security"),
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/login?returnTo=%2Fg%2Fgame-1%2Fhost&account=host%40example.test",
  );

  assert.deepEqual(observed.request, {
    url: "/auth/accounts/password-rotations",
    authorization: "Bearer active-host-session",
    body: {
      account_id: "host@example.test",
      current_password: "correct horse battery",
      new_password: "rotated correct horse battery",
    },
  });
  assert.deepEqual(observed.deleted, {
    name: "fmarch_session",
    options: { path: "/" },
  });
});

test("password rotation rejects mismatched confirmation before calling auth", async () => {
  const result = await actions.rotatePassword({
    cookies: {
      get() {
        return "active-host-session";
      },
    },
    fetch: async () => {
      throw new Error("auth must not be called");
    },
    request: formRequest({
      accountId: "host@example.test",
      currentPassword: "correct horse battery",
      newPassword: "rotated correct horse battery",
      confirmPassword: "different correct horse battery",
      returnTo: "//evil.test/",
    }),
    url: new URL("http://localhost/auth/account/security"),
  });

  assert.equal(result.status, 400);
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "New password confirmation does not match");
  assert.equal(result.data.returnTo, "/");
});

test("security action issues a one-time recovery credential", async () => {
  let observed;
  const result = await actions.issueRecovery({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "active-host-session" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed = {
        url,
        authorization: init.headers.authorization,
        body: JSON.parse(init.body),
      };
      return jsonResponse({
        status: "issued",
        recovery_id: "00000000-0000-0000-0000-000000000001",
        recovery_token: "account-recovery-once-only",
        account_id: "host@example.test",
        principal_user_id: "host_h",
        expires_at: 4_102_444_800,
      });
    },
    request: formRequest({
      accountId: "host@example.test",
      currentPassword: "correct horse battery",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(result.state, "ack");
  assert.equal(result.id, "account-recovery-issue");
  assert.equal(result.recoveryToken, "account-recovery-once-only");
  assert.equal(observed.url, "/auth/accounts/recovery-credentials");
  assert.equal(observed.authorization, "Bearer active-host-session");
  assert.equal(observed.body.account_id, "host@example.test");
  assert.equal(observed.body.current_password, "correct horse battery");
  assert.ok(observed.body.expires_at > Math.floor(Date.now() / 1000));
});

test("security action revokes a recovery credential", async () => {
  let observed;
  const result = await actions.revokeRecovery({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "active-host-session" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed = {
        url,
        authorization: init.headers.authorization,
        body: JSON.parse(init.body),
      };
      return jsonResponse({
        status: "revoked",
        recovery_id: "00000000-0000-0000-0000-000000000001",
        account_id: "host@example.test",
        principal_user_id: "host_h",
      });
    },
    request: formRequest({
      accountId: "host@example.test",
      recoveryId: "00000000-0000-0000-0000-000000000001",
      currentPassword: "correct horse battery",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(result.state, "ack");
  assert.equal(result.id, "account-recovery-revoke");
  assert.deepEqual(observed, {
    url: "/auth/accounts/recovery-credential-revocations",
    authorization: "Bearer active-host-session",
    body: {
      account_id: "host@example.test",
      current_password: "correct horse battery",
      recovery_id: "00000000-0000-0000-0000-000000000001",
    },
  });
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/account/security", {
    method: "POST",
    body: formData,
  });
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    clone() {
      return this;
    },
    async json() {
      return body;
    },
  };
}
