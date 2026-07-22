import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("recovery load preserves account and local role return URL", () => {
  assert.deepEqual(
    load({
      url: new URL(
        "http://localhost/auth/account/recovery?account=host%40example.test&returnTo=%2Fg%2Fgame-1%2Fhost",
      ),
    }),
    {
      accountRecovery: {
        accountId: "host@example.test",
        returnTo: "/g/game-1/host",
      },
    },
  );
});

test("recovery request is non-enumerating and uses the private API base", async () => {
  const previousInternalBase = process.env.FMARCH_API_INTERNAL_URL;
  process.env.FMARCH_API_INTERNAL_URL = "http://api.internal:4000/";
  let observed = null;
  try {
    const result = await actions.request({
      fetch: async (url, init) => {
        observed = {
          url,
          source: init.headers["x-fmarch-auth-source"],
          body: JSON.parse(init.body),
        };
        return jsonResponse({ status: "accepted" });
      },
      getClientAddress: () => "2001:db8::44",
      request: formRequest({
        accountId: "host@example.test",
        returnTo: "/g/game-1/host",
      }),
    });

    assert.deepEqual(result, {
      id: "request",
      state: "ack",
      message: "If that account can be recovered, a recovery credential has been sent.",
      accountId: "host@example.test",
      returnTo: "/g/game-1/host",
    });
    assert.deepEqual(observed, {
      url: "http://api.internal:4000/auth/accounts/recovery-requests",
      source: "2001:db8::44",
      body: { account_id: "host@example.test" },
    });
  } finally {
    if (previousInternalBase === undefined) {
      delete process.env.FMARCH_API_INTERNAL_URL;
    } else {
      process.env.FMARCH_API_INTERNAL_URL = previousInternalBase;
    }
  }
});

test("successful recovery clears a stale cookie and redirects through account login", async () => {
  const observed = { deleted: null, request: null };
  await assert.rejects(
    actions.default({
      cookies: {
        delete(name, options) {
          observed.deleted = { name, options };
        },
      },
      fetch: async (url, init) => {
        observed.request = {
          url,
          authSource: init.headers["x-fmarch-auth-source"] ?? null,
          body: JSON.parse(init.body),
        };
        return jsonResponse({
          status: "recovered",
          recovery_id: "00000000-0000-0000-0000-000000000001",
          account_id: "host@example.test",
          principal_user_id: "host_h",
          revoked_session_count: 2,
          password_algorithm: "argon2id",
        });
      },
      request: formRequest({
        accountId: "host@example.test",
        recoveryToken: "account-recovery-secret",
        newPassword: "recovered correct horse battery",
        confirmPassword: "recovered correct horse battery",
        returnTo: "/g/game-1/host",
      }),
      getClientAddress: () => "2001:db8::17",
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/login?returnTo=%2Fg%2Fgame-1%2Fhost&account=host%40example.test",
  );

  assert.deepEqual(observed.request, {
    url: "/auth/accounts/recoveries",
    authSource: "2001:db8::17",
    body: {
      account_id: "host@example.test",
      recovery_token: "account-recovery-secret",
      new_password: "recovered correct horse battery",
    },
  });
  assert.deepEqual(observed.deleted, {
    name: "fmarch_session",
    options: { path: "/" },
  });
});

test("used or invalid recovery credentials stay on the recovery role URL", async () => {
  const result = await actions.default({
    cookies: { delete() {} },
    fetch: async () => jsonResponse({}, { ok: false, status: 401 }),
    request: formRequest({
      accountId: "host@example.test",
      recoveryToken: "used-recovery-token",
      newPassword: "recovered correct horse battery",
      confirmPassword: "recovered correct horse battery",
      returnTo: "//evil.test/",
    }),
  });

  assert.equal(result.status, 401);
  assert.equal(result.data.state, "reject");
  assert.equal(
    result.data.message,
    "Recovery credential is missing, expired, revoked, used, or invalid",
  );
  assert.equal(result.data.returnTo, "/");
});

test("recovery surfaces credential lockout retry timing", async () => {
  const result = await actions.default({
    cookies: { delete() {} },
    fetch: async () =>
      jsonResponse(
        { retryable: true },
        { ok: false, status: 429, headers: { "retry-after": "11" } },
      ),
    request: formRequest({
      accountId: "host@example.test",
      recoveryToken: "invalid-recovery-token",
      newPassword: "recovered correct horse battery",
      confirmPassword: "recovered correct horse battery",
      returnTo: "/g/game-1/host",
    }),
  });

  assert.equal(result.status, 429);
  assert.equal(result.data.state, "reject");
  assert.equal(
    result.data.message,
    "Too many credential attempts. Try again in 11 seconds.",
  );
  assert.equal(result.data.returnTo, "/g/game-1/host");
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/account/recovery", {
    method: "POST",
    body: formData,
  });
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: new Headers(headers),
    async json() {
      return body;
    },
  };
}
