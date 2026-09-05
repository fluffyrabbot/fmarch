import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FIXTURE_SESSION_COOKIE_NAME,
  FIXTURE_SESSION_PRINCIPAL_IDS,
  SESSION_COOKIE_NAME,
  accessTokenForRequest,
  authenticatedApiFetch,
  hostGameFromRequest,
  resolveAuthenticatedSession as resolveAuthenticatedSessionResult,
  resolveFixtureSession,
  sessionContextFromRequest,
} from "./session-capabilities.mjs";

const HOST_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000001";
const MEMBER_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000002";
const PLAYER_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000003";
const ADMIN_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000004";

async function resolveAuthenticatedSession(options) {
  return (await resolveAuthenticatedSessionResult(options)).session;
}

test("the fmarch_session cookie is the only per-request bearer", async () => {
  const cookies = cookieJar("fmss_app-session-token");
  assert.equal(accessTokenForRequest({ cookies }), "fmss_app-session-token");

  const seen = [];
  const request = authenticatedApiFetch({
    cookies,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(null, { status: 204 });
    },
  });
  await request("/commands", { headers: { accept: "application/json" } });
  assert.equal(
    new Headers(seen[0].init.headers).get("authorization"),
    "Bearer fmss_app-session-token",
  );
});

test("opaque session cookie resolves principal and scoped host capabilities through the API", async () => {
  const seen = [];
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/g/00000000-0000-0000-0000-000000000001/host"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({
        principal_id: HOST_PRINCIPAL_ID,
        capabilities: [
          {
            kind: "HostOf",
            body: { game: "00000000-0000-0000-0000-000000000001" },
          },
          {
            kind: "SlotOccupant",
            body: {
              game: "00000000-0000-0000-0000-000000000001",
              slot: "slot_1",
            },
          },
        ],
      });
    },
  });

  assert.equal(
    seen[0].url,
    "http://127.0.0.1:4017/auth/session?game=00000000-0000-0000-0000-000000000001",
  );
  assert.equal(seen[0].options.headers.authorization, "Bearer opaque-token");
  assert.equal(session.principalId, HOST_PRINCIPAL_ID);
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

test("session rejects response fields that are absent from the canonical Rust contract", async () => {
  const resolution = await resolveAuthenticatedSessionResult({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/admin"),
    env: {},
    fetchImpl: async () => jsonResponse({
      principal_id: MEMBER_PRINCIPAL_ID,
      viewer_profile: { handle: "mira-r", display_name: "Mira Rowan" },
      capabilities: [],
    }),
  });

  assert.equal(resolution.kind, "invalid_response");
  assert.deepEqual(resolution.session, {
    principalId: null,
    resolvedCapabilities: [],
  });
});

test("unvalidated capability aliases cannot smuggle global authority", async () => {
  const resolution = await resolveAuthenticatedSessionResult({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/admin"),
    env: {},
    fetchImpl: async () => jsonResponse({
      principal_id: MEMBER_PRINCIPAL_ID,
      capabilities: [],
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    }),
  });

  assert.equal(resolution.kind, "invalid_response");
  assert.deepEqual(resolution.session.resolvedCapabilities, []);
});

test("legacy user-shaped session payloads cannot establish browser authority", async () => {
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/community"),
    env: {},
    fetchImpl: async () => jsonResponse({
      user_id: "legacy-member",
      capabilities: [{ kind: "GlobalAdmin" }],
    }),
  });

  assert.deepEqual(session, { principalId: null, resolvedCapabilities: [] });
});

test("missing cookie, non-host route, or rejected lookup leaves locals unauthenticated", async () => {
  assert.deepEqual(
    await resolveAuthenticatedSession({
      cookies: cookieJar(),
      request: requestFor("/g/00000000-0000-0000-0000-000000000001/host"),
      fetchImpl: unreachableFetch,
      env: {},
    }),
    { principalId: null, resolvedCapabilities: [] },
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
          principal_id: PLAYER_PRINCIPAL_ID,
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
      principalId: PLAYER_PRINCIPAL_ID,
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
    { principalId: null, resolvedCapabilities: [] },
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
    kind: "optional_public",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/discussions/general")), {
    kind: "optional_public",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/search?q=mafia")), {
    kind: "optional_public",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/games/demo")), {
    kind: "optional_public",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/moderation?status=open")), {
    kind: "authority",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/inbox")), {
    kind: "authority",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/auth/account/security")), {
    kind: "account",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/auth/logout")), {
    kind: "account",
  });
  assert.deepEqual(sessionContextFromRequest(requestFor("/")), {
    kind: "optional_public",
  });
});

test("optional public identity degrades anonymously without deleting its session", async () => {
  const resolution = await resolveAuthenticatedSessionResult({
    cookies: cookieJar("still-valid-after-outage"),
    request: requestFor("/"),
    env: {},
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      headers: new Headers({ "retry-after": "3" }),
    }),
  });

  assert.equal(resolution.kind, "anonymous");
  assert.equal(resolution.status, 503);
  assert.equal(resolution.retryAfterSeconds, 3);
  assert.deepEqual(resolution.session, {
    principalId: null,
    resolvedCapabilities: [],
  });
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
        principal_id: HOST_PRINCIPAL_ID,
        capabilities: [],
      });
    },
  });

  assert.equal(session.principalId, HOST_PRINCIPAL_ID);
});

test("fixture sessions exercise admin, player, and host role routes", async () => {
  const board = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-player"),
    request: requestFor("/"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(board.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.player);
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
  assert.equal(admin.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.admin);
  assert.equal(admin.resolvedCapabilities[0].kind, "GlobalAdmin");

  const player = await resolveAuthenticatedSession({
    cookies: fixtureCookieJar("fixture-player"),
    request: requestFor("/g/midsummer"),
    env: { FMARCH_FRONTEND_FIXTURE_SESSION: "1" },
  });
  assert.equal(player.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.player);
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
  assert.equal(target.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.target);
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
  assert.equal(nightTarget.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.nightTarget);
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
  assert.equal(normal.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.normal);
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
  assert.equal(survivor.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.survivor);
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
  assert.equal(host.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.host);
  assert.equal(host.resolvedCapabilities[0].kind, "HostOf");
});

test("fixture session helper exposes the same game-scoped proof capabilities", () => {
  const player = resolveFixtureSession({
    token: "fixture-player",
    game: "midsummer",
  });

  assert.equal(player.principalId, FIXTURE_SESSION_PRINCIPAL_IDS.player);
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
        principal_id: ADMIN_PRINCIPAL_ID,
        capabilities: [{ kind: "GlobalAdmin" }],
      });
    },
  });

  assert.deepEqual(session, {
    principalId: ADMIN_PRINCIPAL_ID,
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
    status: 200,
    headers: new Headers({ "content-type": "application/json" }),
    async json() {
      return body;
    },
  };
}

async function unreachableFetch() {
  throw new Error("session lookup should not fetch");
}

test("session resolution prefers the private-network API base when configured", async () => {
  const { resolveAuthenticatedSession: resolve } = await import("./session-capabilities.mjs");
  const seen = [];
  await resolve({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/g/game-1/host"),
    env: {
      FMARCH_API_BASE_URL: "https://api.example.test",
      FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:8080",
    },
    fetchImpl: async (url) => {
      seen.push(url);
      return jsonResponse({ principal_id: HOST_PRINCIPAL_ID, capabilities: [] });
    },
  });
  assert.equal(seen[0], "http://fmarch.railway.internal:8080/auth/session?game=game-1");
});

test("session resolution degrades to an empty session when the API fetch fails", async () => {
  const session = await resolveAuthenticatedSession({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/g/game-1/host"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:1/" },
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  assert.equal(session.principalId, null);
  assert.deepEqual(session.resolvedCapabilities, []);
});

test("session resolution passes an abort signal from the SSR fetch budget", async () => {
  const observed = [];
  await resolveAuthenticatedSession({
    cookies: cookieJar("opaque-token"),
    request: requestFor("/g/game-1/host"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async (url, options) => {
      observed.push(options);
      return jsonResponse({ principal_id: HOST_PRINCIPAL_ID, capabilities: [] });
    },
  });
  assert.ok(observed[0].signal instanceof AbortSignal);
});

test("session resolution never caches mutable authority or outages", async () => {
  let fetches = 0;
  const args = {
    cookies: cookieJar("fresh-authority-token"),
    request: requestFor("/admin"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
    fetchImpl: async () => {
      fetches += 1;
      return jsonResponse({
        principal_id: HOST_PRINCIPAL_ID,
        capabilities: fetches === 1 ? [{ kind: "GlobalAdmin" }] : [],
      });
    },
  };

  const first = await resolveAuthenticatedSessionResult(args);
  const second = await resolveAuthenticatedSessionResult(args);
  assert.equal(fetches, 2);
  assert.equal(first.kind, "authenticated");
  assert.deepEqual(first.session.resolvedCapabilities.map(({ kind }) => kind), [
    "GlobalAdmin",
  ]);
  assert.equal(second.kind, "authenticated");
  assert.deepEqual(second.session.resolvedCapabilities, []);
});

test("session resolution preserves actionable trust-boundary failures", async () => {
  const base = {
    cookies: cookieJar("authority-token"),
    request: requestFor("/admin"),
    env: { FMARCH_API_BASE_URL: "http://127.0.0.1:4017/" },
  };
  const stale = await resolveAuthenticatedSessionResult({
    ...base,
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      headers: new Headers(),
    }),
  });
  const unavailable = await resolveAuthenticatedSessionResult({
    ...base,
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  const invalid = await resolveAuthenticatedSessionResult({
    ...base,
    fetchImpl: async () => jsonResponse({ principal_id: "not-a-principal" }),
  });
  assert.equal(stale.kind, "stale");
  assert.equal(unavailable.kind, "unavailable");
  assert.equal(invalid.kind, "invalid_response");
  assert.equal(stale.session.principalId, null);
  assert.equal(unavailable.session.principalId, null);
  assert.equal(invalid.session.principalId, null);
});
