import assert from "node:assert/strict";
import { test } from "node:test";
import { fmarchIdentityHandle as handle } from "./hooks.server.js";
import { clearSessionCache } from "./lib/server/session-capabilities.mjs";

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
  assert.equal(event.locals.principalUserId, "host_h");
  assert.equal(event.locals.resolvedCapabilities[0].kind, "HostOf");
});

test("handle clears a concurrently stale browser session instead of serving it", async () => {
  const observed = { requests: [], set: null, deleted: null };
  const event = eventFor(observed, [sessionResponse({ rotationRequired: true })], {
    rotation: { ok: false, status: 401 },
  });
  await handle({ event, resolve: async () => new Response("ok") });
  assert.deepEqual(observed.deleted, { name: "fmarch_session", options: { path: "/" } });
  assert.equal(event.locals.principalUserId, null);
  assert.deepEqual(event.locals.resolvedCapabilities, []);
});


test("handle serves repeat requests from the session cache within the TTL", async () => {
  clearSessionCache();
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
    1,
  );
  assert.equal(event.locals.principalUserId, "host_h");
  clearSessionCache();
});

function eventFor(observed, sessions, { rotation = sessionResponse({ rotationRequired: false }) } = {}) {
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
    url: new URL("http://localhost/g/game-1/host"),
    request: new Request("http://localhost/g/game-1/host"),
    locals: {},
  };
}

function sessionResponse({ rotationRequired }) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        principal_user_id: "host_h",
        rotation_required: rotationRequired,
        session_token: "fmss_rotated-token",
        capabilities: [{ kind: "HostOf", body: { game: "game-1" } }],
      };
    },
  };
}
