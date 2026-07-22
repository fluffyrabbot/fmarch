import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("login load preserves only local return paths", () => {
  assert.deepEqual(
    load({
      locals: {},
      url: new URL("http://localhost/auth/login?returnTo=/admin"),
    }),
    {
      login: {
        principalUserId: null,
        accountId: "",
        returnTo: "/admin",
      },
    },
  );

  assert.deepEqual(
    load({
      locals: { principalUserId: "admin_a" },
      url: new URL(
        "http://localhost/auth/login?returnTo=/auth/login%3FreturnTo%3D/admin",
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

  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/login?returnTo=/g/midsummer",
      ),
    }),
    {
      login: {
        principalUserId: null,
        accountId: "",
        returnTo: "/g/midsummer",
      },
    },
  );

  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/login?returnTo=/g/midsummer/host&account=host%40example.test",
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
});

test("login action exchanges account credentials for an opaque browser session", async () => {
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
            authorization: init.headers.authorization,
            accept: init.headers.accept,
            authSource: init.headers["x-fmarch-auth-source"] ?? null,
            body: init.body === undefined ? null : JSON.parse(init.body),
          });
          assert.equal(url, "/auth/accounts/login");
          return jsonResponse({
            principal_user_id: "host_h",
            capabilities: [{ kind: "HostOf" }],
          });
        },
        request: formRequest({
          accountId: " host@example.test ",
          password: " correct horse battery ",
          returnTo: "/g/midsummer/host",
        }),
        getClientAddress: () => "203.0.113.17",
        url: new URL("http://localhost/auth/login"),
      }),
    (err) => err.status === 303 && err.location === "/g/midsummer/host",
  );

  assert.equal(observed.requests.length, 1);
  assert.equal(observed.requests[0].url, "/auth/accounts/login");
  assert.equal(observed.requests[0].method, "POST");
  assert.equal(observed.requests[0].accept, "application/json");
  assert.equal(observed.requests[0].authSource, "203.0.113.17");
  assert.equal(observed.requests[0].body.account_id, "host@example.test");
  assert.equal(observed.requests[0].body.password, "correct horse battery");
  assert.match(observed.requests[0].body.session_token, /^account-session-/);
  assert.equal(Number.isSafeInteger(observed.requests[0].body.expires_at), true);
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: observed.requests[0].body.session_token,
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  });
});

test("login action rejects incomplete account credentials without setting a cookie", async () => {
  const missing = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: unreachableFetch,
    request: formRequest({ accountId: "", password: "", returnTo: "/admin" }),
    url: new URL("http://localhost/auth/login"),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.state, "reject");
  assert.equal(
    missing.data.message,
    "Account and password are required",
  );
});

test("login surfaces credential lockout retry timing", async () => {
  const result = await actions.default({
      cookies: forbiddenCookieJar(),
      fetch: async () => jsonResponse(
          { retryable: true },
          { ok: false, status: 429, headers: { "retry-after": "17" } },
        ),
      request: formRequest({
        accountId: "host@example.test",
        password: "wrong password",
        returnTo: "/g/midsummer/host",
      }),
      url: new URL("http://localhost/auth/login"),
    });

  assert.equal(result.status, 429);
  assert.equal(result.data.state, "reject");
  assert.equal(
    result.data.message,
    "Too many credential attempts. Try again in 17 seconds.",
  );
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/login", {
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
