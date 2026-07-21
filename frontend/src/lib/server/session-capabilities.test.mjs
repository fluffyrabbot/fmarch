import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIXTURE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  hostGameFromRequest,
  resolveAuthenticatedSession,
  resolveFixtureSession,
  sessionContextFromRequest,
} from "./session-capabilities.mjs";

test("opaque session cookie resolves principal and scoped host capabilities through the API", async () => {
  const seen = [];
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/g/00000000-0000-0000-0000-000000000001/host"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({
        principal_user_id: "host_h",
        capabilities: [
          {
            kind: "HostOf",
            body: { game: "00000000-0000-0000-0000-000000000001" },
          },
          { kind: "SlotOccupant", body: { slot: "slot_1" } },
        ],
      });
    },
  });

  assert.equal(
    seen[0].url,
    "http://127.0.0.1:4017/auth/session?game=00000000-0000-0000-0000-000000000001",
  );
  assert.equal(seen[0].options.headers.authorization, "Bearer opaque-token");
  assert.equal(session.principalUserId, "host_h");
  assert.deepEqual(session.resolvedCapabilities, [
    {
      kind: "HostOf",
      game: "00000000-0000-0000-0000-000000000001",
      source: "auth-session",
    },
    {
      kind: "SlotOccupant",
      game: "00000000-0000-0000-0000-000000000001",
      slot: "slot_1",
      source: "auth-session",
    },
  ]);
});

test("missing cookie, non-host route, or rejected lookup leaves locals unauthenticated", async () => {
  assert.deepEqual(
    await resolveAuthenticatedSession({
      cookies: cookieJar(),
      request: requestFor("/g/00000000-0000-0000-0000-000000000001/host"),
      fetchImpl: unreachableFetch,
      env: {},
    }),
    { principalUserId: null, resolvedCapabilities: [] },
  );

  assert.deepEqual(
    await resolveAuthenticatedSession({
      cookies: cookieJar("opaque-token"),
      request: requestFor("/g/00000000-0000-0000-0000-000000000001/player"),
      fetchImpl: async (url) => {
        assert.equal(
          url,
          "/auth/session?game=00000000-0000-0000-0000-000000000001",
        );
        return jsonResponse({
          principal_user_id: "player_a",
          capabilities: [
            {
              kind: "ChannelMember",
              body: {
                game: "00000000-0000-0000-0000-000000000001",
                channel: "main",
              },
            },
          ],
        });
      },
      env: {},
    }),
    {
      principalUserId: "player_a",
      resolvedCapabilities: [
        {
          kind: "ChannelMember",
          game: "00000000-0000-0000-0000-000000000001",
          channel: "main",
          source: "auth-session",
        },
      ],
    },
  );

  assert.deepEqual(
    await resolveAuthenticatedSession({
      cookies: cookieJar("opaque-token"),
      request: requestFor("/g/00000000-0000-0000-0000-000000000001/host"),
      fetchImpl: async () => ({ ok: false }),
      env: {},
    }),
    { principalUserId: null, resolvedCapabilities: [] },
  );
});

test("host game is derived only from the tablet host route shape", () => {
  assert.equal(
    hostGameFromRequest(requestFor("/g/00000000-0000-0000-0000-000000000002/host")),
    "00000000-0000-0000-0000-000000000002",
  );
  assert.equal(hostGameFromRequest(requestFor("/g/demo/player")), null);
});

test("session context covers game, public search, moderation, community, admin, account-security, and logout surfaces", () => {
  assert.deepEqual(sessionContextFromRequest(requestFor("/g/demo")), {
    kind: "game",
    game: "demo",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/g/demo/host")), {
    kind: "game",
    game: "demo",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/admin")), {
    kind: "admin",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/admin/audit/proof-runs")), {
    kind: "admin",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/community")), {
    kind: "community",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/discussions/general")), {
    kind: "community",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/search?q=mafia")), {
    kind: "community",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/games/demo")), {
    kind: "community",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/moderation?status=open")), {
    kind: "community",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/auth/account/security")), {
    kind: "account",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/auth/logout")), {
    kind: "account",
  });
  assert.equal(sessionContextFromRequest(requestFor("/")), null);
});

test("account-security route resolves the active opaque session", async () => {
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("account-session-token"),
    request: requestFor("/auth/account/security?account=host%40example.test"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:4017/auth/session");
      assert.equal(options.headers.authorization, "Bearer account-session-token");
      return jsonResponse({
        principal_user_id: "host_h",
        capabilities: [],
      });
    },
  });

  assert.equal(session.principalUserId, "host_h");
});

test("fixture sessions exercise admin, player, and host role routes", async () => {
  const board = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-player"),
    request: requestFor("/"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(board.principalUserId, "player_mira");
  assert.deepEqual(
    board.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.game,
      capability.channel ?? capability.slot ?? null,
    ]),
    [
      ["SlotOccupant", "midsummer", "slot-7"],
      ["ChannelMember", "midsummer", "private:role_pm:slot-7"],
      ["ChannelMember", "midsummer", "private:mafia_day_chat"],
    ],
  );

  const admin = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-admin"),
    request: requestFor("/admin"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(admin.principalUserId, "admin_a");
  assert.equal(admin.resolvedCapabilities[0].kind, "GlobalAdmin");

  const player = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-player"),
    request: requestFor("/g/midsummer"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(player.principalUserId, "player_mira");
  assert.deepEqual(
    player.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.channel ?? capability.slot ?? null,
    ]),
    [
      ["SlotOccupant", "slot-7"],
      ["ChannelMember", "private:role_pm:slot-7"],
      ["ChannelMember", "private:mafia_day_chat"],
    ],
  );

  const target = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-target"),
    request: requestFor("/g/midsummer?private=notification-1"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(target.principalUserId, "player_ilya");
  assert.deepEqual(
    target.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.slot,
    ]),
    [["SlotOccupant", "slot-2"]],
  );

  const nightTarget = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-night-target"),
    request: requestFor("/g/midsummer?private=notification-1"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(nightTarget.principalUserId, "player-seed");
  assert.deepEqual(
    nightTarget.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.slot,
    ]),
    [["SlotOccupant", "slot-3"]],
  );

  const normal = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-normal"),
    request: requestFor("/g/midsummer?private=notification-1"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(normal.principalUserId, "player_rowan");
  assert.deepEqual(
    normal.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.slot,
    ]),
    [["SlotOccupant", "slot-4"]],
  );

  const survivor = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-survivor"),
    request: requestFor("/g/midsummer"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(survivor.principalUserId, "player_sage");
  assert.deepEqual(
    survivor.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.slot,
    ]),
    [["SlotOccupant", "slot-5"]],
  );

  const host = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-host"),
    request: requestFor("/g/midsummer/host"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(host.principalUserId, "host_h");
  assert.equal(host.resolvedCapabilities[0].kind, "HostOf");
});

test("fixture session helper exposes the same game-scoped proof capabilities", () => {
  const player = resolveFixtureSession({
    token: "fixture-player",
    game: "midsummer",
  });

  assert.equal(player.principalUserId, "player_mira");
  assert.deepEqual(
    player.resolvedCapabilities.map((capability) => [
      capability.kind,
      capability.game,
      capability.channel ?? capability.slot ?? null,
    ]),
    [
      ["SlotOccupant", "midsummer", "slot-7"],
      ["ChannelMember", "midsummer", "private:role_pm:slot-7"],
      ["ChannelMember", "midsummer", "private:mafia_day_chat"],
    ],
  );
});

test("admin route accepts API-returned global capabilities", async () => {
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("admin-token"),
    request: requestFor("/admin?game=midsummer"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:4017/auth/session");
      assert.equal(options.headers.authorization, "Bearer admin-token");
      return jsonResponse({
        principal_user_id: "admin_a",
        capabilities: [{ kind: "GlobalAdmin" }],
      });
    },
  });

  assert.deepEqual(session, {
    principalUserId: "admin_a",
    resolvedCapabilities: [
      {
        kind: "GlobalAdmin",
        source: "auth-session",
      },
    ],
  });
});

function cookieJar(value = undefined) {
  return {
    get(name) {
      return name === SESSION_COOKIE_NAME ? value : undefined;
    },
  };
}

function fixtureCookieJar(value) {
  return {
    get(name) {
      if (name === FIXTURE_SESSION_COOKIE_NAME) {
        return value;
      }
      return undefined;
    },
  };
}

function requestFor(pathname) {
  return {
    url: `http://localhost${pathname}`,
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}

async function unreachableFetch() {
  throw new Error("session lookup should not fetch");
}
