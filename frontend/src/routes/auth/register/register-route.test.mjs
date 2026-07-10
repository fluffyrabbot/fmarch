import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("registration load preserves the local game return path", () => {
  assert.deepEqual(
    load({
      url: new URL(
        "http://localhost/auth/register?account=New%40Example.test&returnTo=%2Fg%2Fmidsummer",
      ),
    }),
    {
      registration: {
        accountId: "New@Example.test",
        returnTo: "/g/midsummer",
      },
    },
  );
  assert.deepEqual(
    load({
      url: new URL("http://localhost/auth/register?returnTo=//evil.test/"),
    }),
    { registration: { accountId: "", returnTo: "/" } },
  );
});

test("registration creates the opaque browser session and enters account security", async () => {
  const observed = { request: null, cookie: null };
  await assert.rejects(
    actions.default({
      cookies: {
        set(name, value, options) {
          observed.cookie = { name, value, options };
        },
      },
      fetch: async (url, init) => {
        observed.request = {
          url,
          method: init.method,
          headers: init.headers,
          body: JSON.parse(init.body),
        };
        return jsonResponse({
          account_id: "new@example.test",
          principal_user_id: "registered-00000000-0000-0000-0000-000000000001",
          expires_at: 4_102_444_800,
        });
      },
      getClientAddress: () => "203.0.113.45",
      request: formRequest({
        accountId: " New@Example.Test ",
        password: "correct horse battery",
        confirmPassword: "correct horse battery",
        returnTo: "/g/midsummer",
      }),
      url: new URL("http://localhost/auth/register"),
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/account/security?account=new%40example.test&returnTo=%2Fg%2Fmidsummer",
  );
  assert.equal(observed.request.url, "/auth/accounts/registrations");
  assert.equal(observed.request.method, "POST");
  assert.equal(observed.request.headers["x-fmarch-auth-source"], "203.0.113.45");
  assert.equal(observed.request.body.account_id, "New@Example.Test");
  assert.equal(observed.request.body.password, "correct horse battery");
  assert.match(observed.request.body.session_token, /^registration-session-/);
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: observed.request.body.session_token,
    options: { path: "/", httpOnly: true, sameSite: "lax", secure: false },
  });
});

test("registration rejects missing and mismatched credentials before calling auth", async () => {
  for (const fields of [
    { accountId: "", password: "", confirmPassword: "", returnTo: "/g/midsummer" },
    {
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "different horse battery",
      returnTo: "//evil.test/",
    },
  ]) {
    const result = await actions.default({
      cookies: forbiddenCookieJar(),
      fetch: unreachableFetch,
      request: formRequest(fields),
      url: new URL("http://localhost/auth/register"),
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.state, "reject");
  }
});

test("registration exposes duplicate and rate-limit recovery states", async () => {
  const duplicate = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () => jsonResponse({ message: "account already exists" }, { ok: false, status: 409 }),
    request: formRequest({
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/midsummer",
    }),
    url: new URL("http://localhost/auth/register"),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.message, "An account with this identifier already exists");

  const limited = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () =>
      jsonResponse({}, { ok: false, status: 429, headers: { "retry-after": "23" } }),
    request: formRequest({
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/midsummer",
    }),
    url: new URL("http://localhost/auth/register"),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.message, "Too many registration attempts. Try again in 23 seconds.");
});

function formRequest(fields) {
  return {
    async formData() {
      return new Map(Object.entries(fields));
    },
  };
}

function jsonResponse(body, { ok = true, status = 200, headers = {} } = {}) {
  return {
    ok,
    status,
    headers: { get(name) { return headers[name.toLowerCase()] ?? null; } },
    async json() {
      return body;
    },
  };
}

function forbiddenCookieJar() {
  return {
    set() {
      throw new Error("registration failure must not set a cookie");
    },
  };
}

async function unreachableFetch() {
  throw new Error("auth must not be called");
}
