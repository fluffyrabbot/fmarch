import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

const pageSource = readFileSync(new URL("./+page.svelte", import.meta.url), "utf8");

test("logout load exposes the authenticated principal and preserves a local return URL", () => {
  const observed = { headers: null };
  assert.deepEqual(
    load({
      locals: { principalId: "host_h" },
      setHeaders: (headers) => {
        observed.headers = headers;
      },
      url: new URL("http://localhost/auth/logout?returnTo=/g/game-1/host"),
    }),
    { logout: { principalId: "host_h", returnTo: "/g/game-1/host" } },
  );
  assert.deepEqual(observed.headers, { "cache-control": "no-store" });
});

test("logout load redirects an unauthenticated browser through login", () => {
  assert.throws(
    () =>
      load({
        locals: {},
        setHeaders() {},
        url: new URL("http://localhost/auth/logout?returnTo=/admin"),
      }),
    (error) => error.status === 303 && error.location === "/auth/login?returnTo=%2Fadmin",
  );
});

test("provider logout continuation uses top-level navigation with an SSR fallback link", () => {
  assert.match(pageSource, /form\?\.state === "provider_logout"/u);
  assert.match(pageSource, /onMount\(\(\) => \{/u);
  assert.match(pageSource, /window\.location\.replace\(providerLogoutUrl\)/u);
  assert.match(pageSource, /data-testid="auth-provider-logout-continue"/u);
  assert.match(pageSource, /href=\{providerLogoutUrl\}/u);
  assert.doesNotMatch(pageSource, /<form[^>]+action=\{providerLogoutUrl\}/u);
});

test("logout revokes the presented opaque token before clearing every identity cookie", async () => {
  const observed = { deleted: [], request: null };
  await assert.rejects(
    actions.default({
      cookies: cookieJar("active-host-session", observed),
      fetch: async (url, init) => {
        observed.request = { url, method: init.method, authorization: init.headers.authorization };
        return jsonResponse({ status: "logged_out", principal_id: "host_h" });
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
  assert.deepEqual(observed.deleted, [
    { name: "fmarch_session", options: { path: "/" } },
    { name: "wos-session", options: { path: "/" } },
  ]);
});

test("logout preserves the cookie when the auth service is unavailable", async () => {
  const observed = { deleted: [] };
  const result = await actions.default({
    cookies: cookieJar("active-host-session", observed),
    fetch: async () => ({ ok: false, status: 503 }),
    request: formRequest({ returnTo: "/g/game-1/host" }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.state, "reject");
  assert.deepEqual(observed.deleted, []);
});

test("WorkOS logout clears local identity before returning an exact continuation", async () => {
  const observed = { deleted: [] };
  const result = await actions.default({
    cookies: cookieJar("active-workos-session", observed),
    fetch: async () =>
      jsonResponse({
        status: "logged_out",
        principal_id: "admin_a",
        provider_logout_url:
          "https://api.workos.com/user_management/sessions/logout?session_id=session_a",
      }),
    request: formRequest({ returnTo: "/admin" }),
  });
  assert.deepEqual(result, {
    state: "provider_logout",
    providerLogoutUrl:
      "https://api.workos.com/user_management/sessions/logout?session_id=session_a",
  });
  assert.deepEqual(observed.deleted, [
    { name: "fmarch_session", options: { path: "/" } },
    { name: "wos-session", options: { path: "/" } },
  ]);
});

test("logout refuses an untrusted provider redirect", async () => {
  const observed = { deleted: [] };
  const result = await actions.default({
    cookies: cookieJar("active-workos-session", observed),
    fetch: async () =>
      jsonResponse({
        status: "logged_out",
        principal_id: "admin_a",
        provider_logout_url: "https://attacker.example/logout",
      }),
    request: formRequest({ returnTo: "/admin" }),
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.state, "reject");
  assert.deepEqual(observed.deleted, []);
});

function cookieJar(token, observed) {
  return {
    get(name) {
      return name === "fmarch_session" ? token : undefined;
    },
    delete(name, options) {
      observed.deleted.push({ name, options });
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
