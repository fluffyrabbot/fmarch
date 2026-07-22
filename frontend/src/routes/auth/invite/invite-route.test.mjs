import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("invitation load preserves local destinations and prefilled credentials", () => {
  assert.deepEqual(
    load({
      locals: {},
      url: new URL(
        "http://localhost/auth/invite?invite=host-token&account=host%40example.test&returnTo=/g/midsummer/host",
      ),
    }),
    {
      invite: {
        principalUserId: null,
        inviteToken: "host-token",
        accountId: "host@example.test",
        returnTo: "/g/midsummer/host",
      },
    },
  );
});

test("invitation route accepts an existing opaque session credential", async () => {
  const observed = {};
  await assert.rejects(
    () =>
      actions.default({
        cookies: cookieJar(observed),
        fetch: async (url, init) => {
          observed.request = { url, ...init };
          return jsonResponse({
            principal_user_id: "mod_a",
            capabilities: [{ kind: "GlobalMod" }],
          });
        },
        request: formRequest({ token: "session-token", returnTo: "/admin" }),
        url: new URL("https://fmarch.local/auth/invite"),
      }),
    (error) => error.status === 303 && error.location === "/admin",
  );

  assert.equal(observed.request.url, "/auth/session");
  assert.equal(observed.request.headers.authorization, "Bearer session-token");
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: "session-token",
    options: { path: "/", httpOnly: true, sameSite: "lax", secure: true },
  });
});

test("invitation route redeems an account-bound invitation", async () => {
  const observed = { requests: [] };
  await assert.rejects(
    () =>
      actions.default({
        cookies: cookieJar(observed),
        fetch: async (url, init) => {
          observed.requests.push({
            url,
            method: init.method,
            authorization: init.headers.authorization,
            authSource: init.headers["x-fmarch-auth-source"] ?? null,
            body: init.body === undefined ? null : JSON.parse(init.body),
          });
          return url === "/auth/session"
            ? jsonResponse({}, { ok: false, status: 401 })
            : jsonResponse({
                principal_user_id: "host_h",
                session_token: "fmss_invite-issued-session",
                capabilities: [{ kind: "HostOf" }],
              });
        },
        getClientAddress: () => "203.0.113.17",
        request: formRequest({
          token: "host-invite-token",
          accountId: "host@example.test",
          password: "invited account password",
          returnTo: "/g/midsummer/host",
        }),
        url: new URL("http://localhost/auth/invite"),
      }),
    (error) => error.status === 303 && error.location === "/g/midsummer/host",
  );

  assert.equal(observed.requests[0].url, "/auth/session");
  assert.equal(observed.requests[1].url, "/auth/invites/redeem");
  assert.equal(observed.requests[1].authSource, "203.0.113.17");
  assert.deepEqual(observed.requests[1].body, {
    invite_token: "host-invite-token",
    account_id: "host@example.test",
    password: "invited account password",
  });
  assert.equal(observed.cookie.value, "fmss_invite-issued-session");
});

test("invitation route keeps failures and retry timing explicit", async () => {
  const missing = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: unreachableFetch,
    request: formRequest({ token: "", returnTo: "//evil.test" }),
    url: new URL("http://localhost/auth/invite"),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.data.returnTo, "/");

  const limited = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async (url) =>
      url === "/auth/session"
        ? jsonResponse({}, { ok: false, status: 401 })
        : jsonResponse({}, { ok: false, status: 429, headers: { "retry-after": "17" } }),
    request: formRequest({
      token: "invite-token",
      accountId: "host@example.test",
      password: "wrong password",
    }),
    url: new URL("http://localhost/auth/invite"),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.data.message, "Too many credential attempts. Try again in 17 seconds.");
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/invite", { method: "POST", body: formData });
}

function cookieJar(observed) {
  return {
    set(name, value, options) {
      observed.cookie = { name, value, options };
    },
  };
}

function forbiddenCookieJar() {
  return { set: () => assert.fail("cookie must not be set") };
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

async function unreachableFetch() {
  assert.fail("auth service must not be called");
}
