import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_COOKIE_NAME,
  SMOKE_AUTH_ENV,
  SMOKE_HOST_GAME_HEADER,
  resolveAuthenticatedSession,
} from "./session-capabilities.mjs";

test("authenticated session cookie populates principal and scoped host capabilities", () => {
  const cookie = encodeURIComponent(
    JSON.stringify({
      principal_user_id: "host_h",
      capabilities: [
        { kind: "HostOf", body: { game: "00000000-0000-0000-0000-000000000001" } },
        { kind: "SlotOccupant", body: { slot: "slot_1" } },
      ],
    }),
  );
  const session = resolveAuthenticatedSession({
    cookies: cookieJar(cookie),
    request: requestWithHeaders({}),
    env: {},
  });

  assert.equal(session.principalUserId, "host_h");
  assert.deepEqual(session.resolvedCapabilities, [
    {
      kind: "HostOf",
      game: "00000000-0000-0000-0000-000000000001",
      source: "session-cookie",
    },
  ]);
});

test("smoke auth is unavailable unless the explicit test env is enabled", () => {
  const session = resolveAuthenticatedSession({
    cookies: cookieJar(),
    request: requestWithHeaders({
      [SMOKE_HOST_GAME_HEADER]: "00000000-0000-0000-0000-000000000002",
    }),
    env: {},
  });

  assert.equal(session.principalUserId, null);
  assert.deepEqual(session.resolvedCapabilities, []);
});

test("smoke auth grants HostOf only through the explicit test hook", () => {
  const session = resolveAuthenticatedSession({
    cookies: cookieJar(),
    request: requestWithHeaders({
      [SMOKE_HOST_GAME_HEADER]: "00000000-0000-0000-0000-000000000002",
    }),
    env: { [SMOKE_AUTH_ENV]: "1" },
  });

  assert.equal(session.principalUserId, "host-smoke");
  assert.deepEqual(session.resolvedCapabilities, [
    {
      kind: "HostOf",
      game: "00000000-0000-0000-0000-000000000002",
      source: "smoke-test-hook",
    },
  ]);
});

function cookieJar(value = undefined) {
  return {
    get(name) {
      return name === SESSION_COOKIE_NAME ? value : undefined;
    },
  };
}

function requestWithHeaders(headers) {
  return {
    headers: new Headers(headers),
  };
}
