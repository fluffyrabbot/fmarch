import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("logout load exposes the authenticated principal and preserves a local return URL", () => {
  assert.deepEqual(
    load({
      locals: { principalUserId: "host_h" },
      url: new URL("http://localhost/auth/logout?returnTo=/g/game-1/host"),
    }),
    { logout: { principalUserId: "host_h", returnTo: "/g/game-1/host" } },
  );
});

test("logout load redirects an unauthenticated browser through login", () => {
  assert.throws(
    () => load({ locals: {}, url: new URL("http://localhost/auth/logout?returnTo=/admin") }),
    (error) => error.status === 303 && error.location === "/auth/login?returnTo=%2Fadmin",
  );
});

test("logout revokes the presented opaque token before clearing its cookie", async () => {
  const observed = { deleted: null, request: null };
  await assert.rejects(
    actions.default({
      cookies: cookieJar("active-host-session", observed),
      fetch: async (url, init) => {
        observed.request = { url, method: init.method, authorization: init.headers.authorization };
        return jsonResponse({ status: "logged_out", principal_user_id: "host_h" });
      },
      request: formRequest({ returnTo: "/g/game-1/host" }),
    }),
    (error) =>
      error.status === 303 &&
      error.location === "/auth/login?returnTo=%2Fg%2Fgame-1%2Fhost",
  );
  assert.deepEqual(observed.request, {
    url: "/auth/session-logout",
    method: "POST",
    authorization: "Bearer active-host-session",
  });
  assert.deepEqual(observed.deleted, { name: "fmarch_session", options: { path: "/" } });
});

test("logout preserves the cookie when the auth service is unavailable", async () => {
  const observed = { deleted: null };
  const result = await actions.default({
    cookies: cookieJar("active-host-session", observed),
    fetch: async () => ({ ok: false, status: 503 }),
    request: formRequest({ returnTo: "/g/game-1/host" }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.state, "reject");
  assert.equal(observed.deleted, null);
});

function cookieJar(token, observed) {
  return {
    get(name) {
      return name === "fmarch_session" ? token : undefined;
    },
    delete(name, options) {
      observed.deleted = { name, options };
    },
  };
}

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/auth/logout", { method: "POST", body: formData });
}

function jsonResponse(body) {
  return { ok: true, status: 200, async json() { return body; } };
}
