import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "./hooks.server.js";

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
  assert.match(JSON.parse(observed.requests[1].init.body).session_token, /^account-session-/);
  assert.equal(observed.requests[2].url, "/auth/session?game=game-1");
  assert.match(observed.set.value, /^account-session-/);
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
        capabilities: [{ kind: "HostOf", body: { game: "game-1" } }],
      };
    },
  };
}
