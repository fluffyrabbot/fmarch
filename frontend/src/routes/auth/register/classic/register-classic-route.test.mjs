import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

const PRINCIPAL_ID = "00000000-0000-5000-8000-000000000001";

test("classic registration load preserves the local game return path", () => {
  assert.deepEqual(
    load({
      cookies: invitationCookies(),
      url: new URL(
        "http://localhost/auth/register/classic?account=New%40Example.test&returnTo=%2Fg%2Fmidsummer",
      ),
    }),
    {
      registration: {
        accountId: "New@Example.test",
        returnTo: "/g/midsummer",
      },
    },
  );
});

test("classic registration stores the backend-issued session and enters account security", async () => {
  const observed = { request: null, cookie: null, invitationCleared: false };
  await assert.rejects(
    actions.default({
      cookies: {
        get(name) {
          return name === "fmarch_pending_community_invitation" ? "fmci_example" : undefined;
        },
        set(name, value, options) {
          observed.cookie = { name, value, options };
        },
        delete(name) {
          observed.invitationCleared = name === "fmarch_pending_community_invitation";
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
          principal_id: PRINCIPAL_ID,
          session_token: "fmss_registered-session",
          expires_at: 4_102_444_800,
        });
      },
      getClientAddress: () => "203.0.113.45",
      request: formRequest({
        invitationCredential: "fmci_example",
        accountId: " New@Example.Test ",
        password: "correct horse battery",
        confirmPassword: "correct horse battery",
        returnTo: "/g/midsummer",
      }),
      url: new URL("http://localhost/auth/register/classic"),
    }),
    (error) =>
      error.status === 303 &&
      error.location ===
        "/auth/account/security?account=new%40example.test&returnTo=%2Fg%2Fmidsummer",
  );
  assert.equal(observed.request.url, "/auth/accounts/registrations");
  assert.equal(observed.request.method, "POST");
  assert.equal(observed.request.headers["x-fmarch-auth-source"], "203.0.113.45");
  assert.deepEqual(observed.request.body, {
    invitation_credential: "fmci_example",
    account_id: "New@Example.Test",
    password: "correct horse battery",
  });
  assert.deepEqual(observed.cookie, {
    name: "fmarch_session",
    value: "fmss_registered-session",
    options: { path: "/", httpOnly: true, sameSite: "lax", secure: false },
  });
  assert.equal(observed.invitationCleared, true);
});

test("classic registration rejects missing and mismatched credentials before calling auth", async () => {
  for (const fields of [
    { accountId: "", password: "", confirmPassword: "", returnTo: "/g/midsummer" },
    {
      accountId: "new@example.test",
      invitationCredential: "fmci_example",
      password: "correct horse battery",
      confirmPassword: "different horse battery",
      returnTo: "//evil.test/",
    },
  ]) {
    const result = await actions.default({
      cookies: forbiddenCookieJar(),
      fetch: unreachableFetch,
      request: formRequest(fields),
      url: new URL("http://localhost/auth/register/classic"),
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.state, "reject");
  }
});

test("classic registration rejects a session response without a backend token", async () => {
  const result = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () =>
      jsonResponse({
        account_id: "new@example.test",
        principal_id: PRINCIPAL_ID,
        expires_at: 4_102_444_800,
      }),
    request: formRequest({
      invitationCredential: "fmci_example",
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/midsummer",
    }),
    url: new URL("http://localhost/auth/register/classic"),
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.message, "Auth service returned a malformed registration");
});

test("classic registration rejects missing or noncanonical principal IDs from the registration API", async (t) => {
  for (const [name, responseBody] of [
    [
      "missing",
      {
        account_id: "new@example.test",
        session_token: "fmss_registered-session",
        expires_at: 4_102_444_800,
      },
    ],
    [
      "label",
      {
        account_id: "new@example.test",
        principal_id: "registered_user",
        session_token: "fmss_registered-session",
        expires_at: 4_102_444_800,
      },
    ],
  ]) {
    await t.test(name, async () => {
      const result = await actions.default({
        cookies: forbiddenCookieJar(),
        fetch: async () => jsonResponse(responseBody),
        request: formRequest({
          invitationCredential: "fmci_example",
          accountId: "new@example.test",
          password: "correct horse battery",
          confirmPassword: "correct horse battery",
          returnTo: "/admin",
        }),
        url: new URL("http://localhost/auth/register/classic"),
      });

      assert.equal(result.status, 502);
      assert.equal(result.data.message, "Auth service returned a malformed registration");
    });
  }
});

test("classic registration exposes duplicate and rate-limit recovery states", async () => {
  const duplicate = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () => jsonResponse({ message: "account already exists" }, { ok: false, status: 409 }),
    request: formRequest({
      invitationCredential: "fmci_example",
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/midsummer",
    }),
    url: new URL("http://localhost/auth/register/classic"),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.message, "An account with this identifier already exists");

  const limited = await actions.default({
    cookies: forbiddenCookieJar(),
    fetch: async () =>
      jsonResponse({}, { ok: false, status: 429, headers: { "retry-after": "23" } }),
    request: formRequest({
      invitationCredential: "fmci_example",
      accountId: "new@example.test",
      password: "correct horse battery",
      confirmPassword: "correct horse battery",
      returnTo: "/g/midsummer",
    }),
    url: new URL("http://localhost/auth/register/classic"),
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
    get(name) {
      return name === "fmarch_pending_community_invitation" ? "fmci_example" : undefined;
    },
    set() {
      throw new Error("registration failure must not set a cookie");
    },
    delete() {
      throw new Error("registration failure must not clear the invitation");
    },
  };
}

function invitationCookies() {
  return {
    get(name) {
      return name === "fmarch_pending_community_invitation" ? "fmci_example" : undefined;
    },
  };
}

async function unreachableFetch() {
  throw new Error("auth must not be called");
}
