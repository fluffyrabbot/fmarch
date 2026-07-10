import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("security load exposes the authenticated account role URL", () => {
  assert.deepEqual(
    load({
      locals: { principalUserId: "host_h" },
      url: new URL(
        "http://localhost/auth/account/security?account=host%40example.test&returnTo=%2Fg%2Fgame-1%2Fhost",
      ),
    }),
    {
      accountSecurity: {
        accountId: "host@example.test",
        principalUserId: "host_h",
        returnTo: "/g/game-1/host",
      },
    },
  );
});

test("security load sends an unauthenticated browser through account login", () => {
  assert.throws(
    () =>
      load({
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

test("password rotation revokes the browser cookie and preserves the game return URL", async () => {
  const observed = { deleted: null, request: null };
  await assert.rejects(
    actions.default({
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
  const result = await actions.default({
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
    async json() {
      return body;
    },
  };
}
