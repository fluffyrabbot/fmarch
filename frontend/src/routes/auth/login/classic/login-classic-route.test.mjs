import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("classic login load preserves only local return paths", () => {
  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/login/classic?returnTo=/g/midsummer/host&account=host%40example.test",
      ),
    }),
    {
      login: {
        principalUserId: null,
        accountId: "host@example.test",
        returnTo: "/g/midsummer/host",
      },
    },
  );

  assert.deepEqual(
    load({
      locals: { principalUserId: "admin_a" },
      url: new URL(
        "http://localhost/auth/login/classic?returnTo=/auth/login/classic%3FreturnTo%3D/admin",
      ),
    }),
    {
      login: {
        principalUserId: "admin_a",
        accountId: "",
        returnTo: "/",
      },
    },
  );
});

test("classic login exchanges credentials for a backend-issued session token", async () => {
  const observed = { requests: [] };
  await assert.rejects(
    async () =>
      await actions.default({
        cookies: {
          set(name, value, options) {
            observed.cookie = { name, value, options };
          },
        },
        fetch: async (url, init) => {
          observed.requests.push({
            url,
            method: init.method,
            accept: init.headers.accept,
            authSource: init.headers["x-fmarch-auth-source"] ?? null,
            body: init.body === undefined ? null : JSON.parse(init.body),
          });
          assert.equal(url, "/auth/sessions");
          return jsonResponse({
            principal_user_id: "host_h",
            session_token: "fmss_issued-by-backend",
            expires_at: 4_102_444_800,
            capabilities: [{ kind: "HostOf" }],
          });
        },
        request: formRequest({
          accountId: " host@example.test ",
          password: " correct horse battery ",
          returnTo: "/g/midsummer/host",
        }),
        getClientAddress: () => "203.0.113.17",
        url: new URL("http://localhost/auth/login/classic"),
      }),
    (err) => err.status === 303 && err.location === "/g/midsummer/host",
  );

  assert.equal(observed.requests.length, 1);
  assert.equal(observed.requests[0].method, "POST");
  assert.equal(observed.requests[0].accept, "application/json");
  assert.equal(observed.requests[0].authSource, "203.0.113.17");
  assert.deepEqual(observed.requests[0].body, {
    method: "classic",
    login_name: "host@example.test",
    password: "correct horse battery",
  });
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: "fmss_issued-by-backend",
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  });
});

test("classic login rejects a session response without a backend token", async () => {
  const result = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () =>
      jsonResponse({
        principal_user_id: "host_h",
        capabilities: [{ kind: "HostOf" }],
      }),
    request: formRequest({
      accountId: "host@example.test",
      password: "correct horse battery",
      returnTo: "/g/midsummer/host",
    }),
    url: new URL("http://localhost/auth/login/classic"),
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.message, "Auth service returned a malformed account session");
});

test("classic login rejects incomplete credentials without setting a cookie", async () => {
  const missing = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: unreachableFetch,
    request: formRequest({ accountId: "", password: "", returnTo: "/admin" }),
    url: new URL("http://localhost/auth/login/classic"),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.state, "reject");
  assert.equal(missing.data.message, "Account and password are required");
});

test("classic login surfaces credential lockout retry timing", async () => {
  const result = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () =>
      jsonResponse(
        { retryable: true },
        { ok: false, status: 429, headers: { "retry-after": "17" } },
      ),
    request: formRequest({
      accountId: "host@example.test",
      password: "wrong password",
      returnTo: "/g/midsummer/host",
    }),
    url: new URL("http://localhost/auth/login/classic"),
  });

  assert.equal(result.status, 429);
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "Too many credential attempts. Try again in 17 seconds.");
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/login/classic", {
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

function forbiddenCookieJar() {
  return {
    set() {
      throw new Error("cookie must not be set");
    },
  };
}

async function unreachableFetch() {
  throw new Error("login action should not call auth service");
}
