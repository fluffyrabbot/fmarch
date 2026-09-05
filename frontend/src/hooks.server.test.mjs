import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fmarchIdentityHandle as handle,
  securityHeadersHandle,
} from "./hooks.server.js";
import { FIXTURE_SESSION_PRINCIPAL_IDS } from "./lib/server/session-capabilities.mjs";

test("handle rotates an overdue browser session before resolving the route", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [
    sessionResponse({ rotationRequired: true }),
    sessionResponse({ rotationRequired: false }),
  ]);
  const response = await handle({ event, resolve: async () => new Response("ok") });
  assert.equal(await response.text(), "ok");
  assert.equal(observed.requests[0].url, "/auth/session?game=game-1");
  assert.equal(observed.requests[1].url, "/auth/session-rotations");
  assert.deepEqual(JSON.parse(observed.requests[1].init.body), {});
  assert.equal(observed.requests[2].url, "/auth/session?game=game-1");
  assert.equal(observed.set.value, "fmss_rotated-token");
  assert.equal(event.locals.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.host);
  assert.equal(event.locals.viewerProfile, null);
  assert.equal(event.locals.resolvedCapabilities[0].kind, "HostOf");
});

test("handle clears a concurrently stale browser session instead of serving it", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [sessionResponse({ rotationRequired: true })], {
    rotation: { ok: false, status: 401 },
  });
  await handle({ event, resolve: async () => new Response("ok") });
  assert.deepEqual(observed.deleted, { name: "fmarch_session", options: { path: "/" } });
  assert.equal(event.locals.principalId, null);
  assert.equal(event.locals.viewerProfile, null);
  assert.deepEqual(event.locals.resolvedCapabilities, []);
});


test("handle re-resolves game authority on every request", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [
    sessionResponse({ rotationRequired: false }),
    sessionResponse({ rotationRequired: false }),
  ]);
  event.cookies.get = (name) => (name === "fmarch_session" ? "cached-hook-token" : undefined);
  await handle({ event, resolve: async () => new Response("ok") });
  await handle({ event, resolve: async () => new Response("ok") });
  assert.equal(
    observed.requests.filter((request) => request.url.startsWith("/auth/session?")).length,
    2,
  );
  assert.equal(event.locals.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.host);
});

test("handle re-resolves non-game authority on every request", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(
    observed,
    [
      sessionResponse({
        rotationRequired: false,
        capabilities: [{ kind: "GlobalAdmin" }],
      }),
      sessionResponse({
        rotationRequired: false,
        capabilities: [{ kind: "GlobalAdmin" }],
      }),
    ],
    { url: "http://localhost/admin" },
  );
  event.cookies.get = (name) => (name === "fmarch_session" ? "cached-hook-token" : undefined);
  await handle({ event, resolve: async () => new Response("ok") });
  await handle({ event, resolve: async () => new Response("ok") });
  assert.equal(
    observed.requests.filter((request) => request.url === "/auth/session").length,
    2,
  );
  assert.equal(event.locals.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.host);
});

test("identity outage preserves the browser session and fails authority-bearing SSR", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [{
    ok: false,
    status: 503,
    headers: new Headers({ "retry-after": "2" }),
  }]);
  await assert.rejects(
    handle({ event, resolve: async () => new Response("must not resolve") }),
    (failure) =>
      failure.status === 503 &&
      failure.body.message === "Identity service is temporarily unavailable.",
  );
  assert.equal(observed.deleted, null);
});

test("identity outage leaves public pages available and retains the browser session", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(
    observed,
    [{
      ok: false,
      status: 503,
      headers: new Headers({ "retry-after": "2" }),
    }],
    { url: "http://localhost/" },
  );
  const response = await handle({
    event,
    resolve: async () => new Response("public board"),
  });

  assert.equal(await response.text(), "public board");
  assert.equal(observed.deleted, null);
  assert.equal(event.locals.principalId, null);
  assert.deepEqual(event.locals.resolvedCapabilities, []);
});

test("rotation outage degrades optional-public identity without dropping its recoverable cookie", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(
    observed,
    [sessionResponse({ rotationRequired: true })],
    {
      url: "http://localhost/",
      rotation: {
        ok: false,
        status: 503,
        headers: new Headers({ "retry-after": "2" }),
      },
    },
  );
  const response = await handle({
    event,
    resolve: async () => new Response("public board"),
  });

  assert.equal(await response.text(), "public board");
  assert.equal(observed.deleted, null);
  assert.equal(observed.set, null);
  assert.equal(event.locals.principalId, null);
  assert.deepEqual(event.locals.resolvedCapabilities, []);
  assert.deepEqual(
    observed.requests.map((request) => request.url),
    ["/auth/session", "/auth/session-rotations"],
  );
});

test("invalid identity response preserves the cookie and fails with bad gateway", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [{
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return { principal_id: "not-a-principal", capabilities: [] };
    },
  }]);
  await assert.rejects(
    handle({ event, resolve: async () => new Response("must not resolve") }),
    (failure) =>
      failure.status === 502 &&
      failure.body.message === "Identity service returned an invalid response.",
  );
  assert.equal(observed.deleted, null);
});

test("only an upstream 401 clears a stale browser session", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [{
    ok: false,
    status: 401,
    headers: new Headers(),
  }]);
  const response = await handle({
    event,
    resolve: async () => new Response("anonymous"),
  });
  assert.equal(await response.text(), "anonymous");
  assert.deepEqual(observed.deleted, {
    name: "fmarch_session",
    options: { path: "/" },
  });
  assert.equal(event.locals.principalId, null);
});

test("security header hook closes browser embedding and cross-origin policy defaults", async () => {
  const event = { url: new URL("https://fmarch.example.test/") };
  const response = await securityHeadersHandle({
    event,
    resolve: async () => new Response("ok"),
  });
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-permitted-cross-domain-policies"), "none");
  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains",
  );
});

function eventFor(
  observed,
  sessions,
  {
    rotation = sessionResponse({
      rotationRequired: false,
      capabilities: [{ kind: "GlobalAdmin" }],
    }),
    url = "http://localhost/g/game-1/host",
  } = {},
) {
  let token = "old-session";
  return {
    cookies: {
      get(name) {
        return name === "fmarch_session" ? token : undefined;
      },
      set(name, value, options) {
        observed.set = { name, value, options };
        token = value;
      },
      delete(name, options) {
        observed.deleted = { name, options };
        token = undefined;
      },
    },
    fetch: async (url, init = {}) => {
      observed.requests.push({ url, init });
      if (url === "/auth/session-rotations") {
        return rotation;
      }
      return sessions.shift() ?? sessionResponse({ rotationRequired: false });
    },
    url: new URL(url),
    request: new Request(url),
    locals: {},
  };
}

function sessionResponse({
  rotationRequired,
  capabilities = [{ kind: "HostOf", body: { game: "game-1" } }],
}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return {
        principal_id: FIXTURE_SESSION_PRINCIPAL_IDS.host,
        rotation_required: rotationRequired,
        session_token: "fmss_rotated-token",
        capabilities,
      };
    },
  };
}
