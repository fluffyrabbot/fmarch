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
        inviteToken: "",
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
        inviteToken: "",
        accountId: "",
        returnTo: "/",
      },
    },
  );

  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/login?returnTo=/g/midsummer&invite=host-invite-token",
      ),
    }),
    {
      login: {
        principalUserId: null,
        inviteToken: "host-invite-token",
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
        inviteToken: "",
        accountId: "host@example.test",
        returnTo: "/g/midsummer/host",
      },
    },
  );
});

test("login action verifies the opaque token before setting the browser session cookie", async () => {
  const observed = {};
  await assert.rejects(
    async () =>
      await actions.default({
        cookies: {
          set(name, value, options) {
            observed.cookie = { name, value, options };
          },
        },
        fetch: async (url, init) => {
          observed.request = {
            url,
            method: init.method,
            authorization: init.headers.authorization,
            accept: init.headers.accept,
          };
          return jsonResponse({
            principal_user_id: "mod_a",
            capabilities: [{ kind: "GlobalMod" }],
          });
        },
        request: formRequest({
          token: "  granted-global-mod-token  ",
          returnTo: "/admin",
        }),
        url: new URL("https://fmarch.local/auth/login"),
      }),
    (err) => err.status === 303 && err.location === "/admin",
  );

  assert.deepEqual(observed.request, {
    url: "/auth/session",
    method: "GET",
    authorization: "Bearer granted-global-mod-token",
    accept: "application/json",
  });
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: "granted-global-mod-token",
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    },
  });
});

test("login action redeems invite tokens into opaque browser sessions", async () => {
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
          if (url === "/auth/session") {
            return jsonResponse(
              { message: "not a session" },
              { ok: false, status: 401 },
            );
          }
          assert.equal(url, "/auth/invites/redeem");
          return jsonResponse({
            principal_user_id: "host_h",
            capabilities: [{ kind: "HostOf" }],
          });
        },
        request: formRequest({
          token: "  host-invite-token  ",
          accountId: " host@example.test ",
          password: " invited account password ",
          returnTo: "/g/midsummer/host",
        }),
        getClientAddress: () => "203.0.113.17",
        url: new URL("http://localhost/auth/login"),
      }),
    (err) => err.status === 303 && err.location === "/g/midsummer/host",
  );

  assert.equal(observed.requests.length, 2);
  assert.deepEqual(observed.requests[0], {
    url: "/auth/session",
    method: "GET",
    authorization: "Bearer host-invite-token",
    accept: "application/json",
    authSource: null,
    body: null,
  });
  assert.equal(observed.requests[1].url, "/auth/invites/redeem");
  assert.equal(observed.requests[1].method, "POST");
  assert.equal(observed.requests[1].accept, "application/json");
  assert.equal(observed.requests[1].authSource, "203.0.113.17");
  assert.equal(observed.requests[1].body.invite_token, "host-invite-token");
  assert.equal(observed.requests[1].body.account_id, "host@example.test");
  assert.equal(observed.requests[1].body.password, "invited account password");
  assert.match(observed.requests[1].body.session_token, /^invite-session-/);
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: observed.requests[1].body.session_token,
    options: {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    },
  });
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
          token: "",
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

test("login action rejects missing or revoked tokens without setting a cookie", async () => {
  const missing = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: unreachableFetch,
    request: formRequest({ token: "", returnTo: "/admin" }),
    url: new URL("http://localhost/auth/login"),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.state, "reject");
  assert.equal(
    missing.data.message,
    "Session, invite, or account credentials are required",
  );

  const missingInviteAccount = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () => jsonResponse({ message: "nope" }, { ok: false, status: 401 }),
    request: formRequest({ token: "revoked-token", returnTo: "//evil.test/" }),
    url: new URL("http://localhost/auth/login"),
  });
  assert.equal(missingInviteAccount.status, 400);
  assert.equal(missingInviteAccount.data.returnTo, "/");
  assert.equal(
    missingInviteAccount.data.message,
    "Invite redemption requires the invited account and password",
  );
});

test("login and invite redemption surface credential lockout retry timing", async () => {
  for (const fields of [
    {
      token: "",
      accountId: "host@example.test",
      password: "wrong password",
      returnTo: "/g/midsummer/host",
    },
    {
      token: "invite-token",
      accountId: "host@example.test",
      password: "wrong password",
      returnTo: "/g/midsummer/host",
    },
  ]) {
    const result = await actions.default({
      cookies: forbiddenCookieJar(),
      fetch: async (url) => {
        if (url === "/auth/session") {
          return jsonResponse({}, { ok: false, status: 401 });
        }
        return jsonResponse(
          { retryable: true },
          { ok: false, status: 429, headers: { "retry-after": "17" } },
        );
      },
      request: formRequest(fields),
      url: new URL("http://localhost/auth/login"),
    });

    assert.equal(result.status, 429);
    assert.equal(result.data.state, "reject");
    assert.equal(
      result.data.message,
      "Too many credential attempts. Try again in 17 seconds.",
    );
  }
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
