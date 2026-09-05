import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_PRINCIPAL_IDS } from "../principal-id.mjs";
import {
  EMPTY_HOST_GAMEPLAY_SNAPSHOT,
  EMPTY_PLAYER_GAMEPLAY_SNAPSHOT,
  loadHostGameplaySnapshot,
  loadPlayerGameplaySnapshot,
} from "./gameplay-api.mjs";

const HOST_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.hostH;

test("player gameplay loads one validated, immutable aggregate", async () => {
  const seen = [];
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: "player_mira",
    actorSlot: "slot-4",
    timeoutMs: 0,
    fetchImpl: async (url) => {
      seen.push(String(url));
      return jsonResponse(playerPayloadFor(url));
    },
  });

  assert.deepEqual(seen, [
    "/api/gameplay/games/midsummer?limit=50",
    "/api/gameplay/games/midsummer/votecount",
    "/api/gameplay/games/midsummer/day-vote-outcomes",
    "/api/gameplay/games/midsummer/endgame-summary",
    "/api/gameplay/games/midsummer/notifications",
    "/api/gameplay/games/midsummer/investigation-results",
    "/api/gameplay/games/midsummer/slot-mentions",
    "/api/gameplay/games/midsummer/player-command-state?slot_id=slot-4",
  ]);
  assert.equal(result.kind, "ready");
  assert.equal(result.data.thread.posts[0].body, "live post");
  assert.deepEqual(result.data.votecount, [
    { target: "slot-2", count: 2, needed: 7 },
  ]);
  assert.equal(result.data.commandState.actorSlot, "slot-4");
  assert.equal(result.data.notifications[0].effect, "phase_opened");
  // The seat-addressed rail row crosses the boundary naming a seat and a room
  // and nothing about who occupies it (RFC 0007 §7).
  assert.deepEqual(result.data.slotMentions, [
    {
      game: "midsummer",
      audience_slot: "slot-4",
      channel_id: "main",
      source_seq: 443,
      phase_id: "D01",
      occurred_at: 1781928000,
    },
  ]);
  assert.equal(Object.isFrozen(result.data.slotMentions), true);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.data), true);
  assert.equal(Object.isFrozen(result.data.notifications), true);
  assert.equal(Object.isFrozen(result.data.notifications[0]), true);
});

test("player gameplay intentionally skips private reads without a player slot", async () => {
  const seen = [];
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: "spectator_s",
    actorSlot: null,
    timeoutMs: 0,
    fetchImpl: async (url) => {
      seen.push(String(url));
      return jsonResponse(playerPayloadFor(url));
    },
  });

  assert.equal(result.kind, "ready");
  assert.deepEqual(seen, [
    "/api/gameplay/games/midsummer?limit=50",
    "/api/gameplay/games/midsummer/votecount",
    "/api/gameplay/games/midsummer/day-vote-outcomes",
    "/api/gameplay/games/midsummer/endgame-summary",
  ]);
  assert.equal(result.data.notifications, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT.notifications);
  assert.equal(
    result.data.investigationResults,
    EMPTY_PLAYER_GAMEPLAY_SNAPSHOT.investigationResults,
  );
  assert.equal(
    result.data.slotMentions,
    EMPTY_PLAYER_GAMEPLAY_SNAPSHOT.slotMentions,
  );
  assert.equal(
    result.data.commandState,
    EMPTY_PLAYER_GAMEPLAY_SNAPSHOT.commandState,
  );
});

test("player gameplay rejects command authority for another game or slot", async () => {
  const cases = [
    {
      name: "cross-game command state",
      override: { game: "other-game" },
    },
    {
      name: "another slot's command state",
      override: { actor_slot: "slot-9" },
    },
  ];

  for (const scenario of cases) {
    const result = await loadPlayerGameplaySnapshot({
      game: "midsummer",
      principalId: "player_mira",
      actorSlot: "slot-4",
      timeoutMs: 0,
      fetchImpl: async (url) =>
        String(url).includes("player-command-state")
          ? jsonResponse({ ...playerPayloadFor(url), ...scenario.override })
          : jsonResponse(playerPayloadFor(url)),
    });

    assert.equal(result.kind, "invalid_response", scenario.name);
    assert.equal(result.endpoint, "commandState", scenario.name);
    assert.equal(result.reason, "invalid_schema", scenario.name);
    assert.equal(result.data, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT, scenario.name);
  }
});

test("player gameplay rejects private rows for another game or audience", async () => {
  const cases = [
    {
      name: "cross-game notification",
      endpoint: "notifications",
      path: "/notifications",
      override: { game: "other-game" },
    },
    {
      name: "another slot's notification",
      endpoint: "notifications",
      path: "/notifications",
      override: { audience_slot: "slot-9" },
    },
    {
      name: "malformed notification",
      endpoint: "notifications",
      path: "/notifications",
      override: { event_index: "1" },
    },
    {
      name: "cross-game investigation",
      endpoint: "investigationResults",
      path: "/investigation-results",
      override: { game: "other-game" },
    },
    {
      name: "another slot's investigation",
      endpoint: "investigationResults",
      path: "/investigation-results",
      override: { audience_slot: "slot-9" },
    },
    {
      name: "malformed investigation result",
      endpoint: "investigationResults",
      path: "/investigation-results",
      override: { result: { invented: true } },
    },
  ];

  for (const scenario of cases) {
    const result = await loadPlayerGameplaySnapshot({
      game: "midsummer",
      principalId: "player_mira",
      actorSlot: "slot-4",
      timeoutMs: 0,
      fetchImpl: async (url) => {
        const payload = playerPayloadFor(url);
        return String(url).endsWith(scenario.path)
          ? jsonResponse([{ ...payload[0], ...scenario.override }])
          : jsonResponse(payload);
      },
    });

    assert.equal(result.kind, "invalid_response", scenario.name);
    assert.equal(result.endpoint, scenario.endpoint, scenario.name);
    assert.equal(result.reason, "invalid_schema", scenario.name);
    assert.equal(result.data, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT, scenario.name);
  }
});

test("one player endpoint failure discards every live value instead of mixing state", async () => {
  const fictionalFallback = {
    thread: { posts: [{ body: "fiction" }] },
    commandState: { actions: [{ templateId: "fictional-authority" }] },
  };
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: "player_mira",
    actorSlot: "slot-4",
    timeoutMs: 0,
    fallback: fictionalFallback,
    fetchImpl: async (url) =>
      String(url).endsWith("/votecount")
        ? jsonResponse({ error: "down" }, { status: 503 })
        : jsonResponse(playerPayloadFor(url)),
  });

  assert.equal(result.kind, "unavailable");
  assert.equal(result.endpoint, "votecount");
  assert.equal(result.status, 503);
  assert.equal(result.data, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT);
  assert.deepEqual(result.data.thread.posts, []);
  assert.deepEqual(result.data.commandState.actions, []);
});

test("malformed successful JSON invalidates the complete player aggregate", async () => {
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: null,
    timeoutMs: 0,
    fetchImpl: async (url) =>
      String(url).includes("day-vote-outcomes")
        ? jsonResponse({ rows: [] })
        : jsonResponse(playerPayloadFor(url)),
  });

  assert.equal(result.kind, "invalid_response");
  assert.equal(result.endpoint, "dayVoteOutcomes");
  assert.equal(result.data, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT);
});

test("player aggregate rejects cross-scope and partial public projection rows", async () => {
  const cases = [
    {
      name: "thread post from another game",
      endpoint: "thread",
      replace(payload) {
        return {
          ...payload,
          posts: [{ ...payload.posts[0], game: "other-game" }],
        };
      },
    },
    {
      name: "thread post from another channel",
      endpoint: "thread",
      replace(payload) {
        return {
          ...payload,
          posts: [{ ...payload.posts[0], channel_id: "backroom" }],
        };
      },
    },
    {
      name: "partial thread post",
      endpoint: "thread",
      replace(payload) {
        return { ...payload, posts: [{}] };
      },
    },
    {
      name: "votecount from another game",
      endpoint: "votecount",
      replace(payload) {
        return [{ ...payload[0], body: { ...payload[0].body, game: "other-game" } }];
      },
    },
    {
      name: "day outcome from another game",
      endpoint: "dayVoteOutcomes",
      replace(payload) {
        return [{ ...payload[0], body: { ...payload[0].body, game: "other-game" } }];
      },
    },
    {
      name: "endgame summary from another game",
      endpoint: "endgameSummary",
      replace(payload) {
        return { ...payload, game: "other-game" };
      },
    },
  ];

  for (const scenario of cases) {
    const result = await loadPlayerGameplaySnapshot({
      game: "midsummer",
      timeoutMs: 0,
      fetchImpl: async (url) => {
        const payload = playerPayloadFor(url);
        const path = String(url);
        const matches =
          (scenario.endpoint === "thread" && path.includes("?limit=50")) ||
          (scenario.endpoint === "votecount" && path.endsWith("/votecount")) ||
          (scenario.endpoint === "dayVoteOutcomes" && path.endsWith("/day-vote-outcomes")) ||
          (scenario.endpoint === "endgameSummary" && path.endsWith("/endgame-summary"));
        return jsonResponse(matches ? scenario.replace(payload) : payload);
      },
    });
    assert.equal(result.kind, "invalid_response", scenario.name);
    assert.equal(result.endpoint, scenario.endpoint, scenario.name);
    assert.equal(result.data, EMPTY_PLAYER_GAMEPLAY_SNAPSHOT, scenario.name);
  }
});

test("player gameplay accepts a legitimate null endgame summary", async () => {
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: null,
    timeoutMs: 0,
    fetchImpl: async (url) =>
      String(url).endsWith("/endgame-summary")
        ? jsonResponse(null)
        : jsonResponse(playerPayloadFor(url)),
  });

  assert.equal(result.kind, "ready");
  assert.equal(result.data.endgameSummary, null);
});

test("player aggregate preserves authorization failure classification", async () => {
  const result = await loadPlayerGameplaySnapshot({
    game: "midsummer",
    principalId: null,
    timeoutMs: 0,
    fetchImpl: async (url) =>
      String(url).includes("day-vote-outcomes")
        ? jsonResponse({ error: "sign in" }, { status: 401 })
        : jsonResponse(playerPayloadFor(url)),
  });

  assert.equal(result.kind, "unauthorized");
  assert.equal(result.endpoint, "dayVoteOutcomes");
  assert.equal(result.status, 401);
});

test("host gameplay loads live authority only when every endpoint validates", async () => {
  const result = await loadHostGameplaySnapshot({
    game: "midsummer",
    expectedPrincipalId: HOST_PRINCIPAL_ID,
    expectedCapabilityKind: "HostOf",
    hostConsoleStateEndpoint:
      "/api/gameplay/games/midsummer/host-console-state?slot_id=slot-7",
    timeoutMs: 0,
    fetchImpl: async (url) => jsonResponse(hostPayloadFor(url)),
  });

  assert.equal(result.kind, "ready");
  assert.equal(result.data.hostPrompts[0].phaseId, "D01");
  assert.equal(result.data.hostConsoleState.authority.capability, "HostOf");
  assert.equal(result.data.hostConsoleState.phase, null);
  assert.equal(Object.isFrozen(result.data.hostConsoleState), true);
  assert.equal(Object.isFrozen(result.data.hostConsoleState.authority), true);
});

test("host gameplay fails closed when its authority endpoint is absent", async () => {
  const result = await loadHostGameplaySnapshot({
    game: "midsummer",
    expectedPrincipalId: HOST_PRINCIPAL_ID,
    expectedCapabilityKind: "HostOf",
    hostConsoleStateEndpoint: null,
    timeoutMs: 0,
    fetchImpl: async () => {
      throw new Error("no request should start with an incomplete host contract");
    },
  });

  assert.equal(result.kind, "unavailable");
  assert.equal(result.endpoint, "hostConsoleState");
  assert.equal(result.reason, "missing_endpoint");
  assert.equal(result.data, EMPTY_HOST_GAMEPLAY_SNAPSHOT);
});

test("host outage never manufactures authority or preserves partial controls", async () => {
  const result = await loadHostGameplaySnapshot({
    game: "midsummer",
    expectedPrincipalId: HOST_PRINCIPAL_ID,
    expectedCapabilityKind: "HostOf",
    hostConsoleStateEndpoint:
      "/api/gameplay/games/midsummer/host-console-state?slot_id=slot-7",
    timeoutMs: 0,
    fallback: {
      hostConsoleState: { authority: { capability: "GlobalAdmin" } },
    },
    fetchImpl: async (url) =>
      String(url).includes("host-console-state")
        ? jsonResponse({ error: "down" }, { status: 503 })
        : jsonResponse(hostPayloadFor(url)),
  });

  assert.equal(result.kind, "unavailable");
  assert.equal(result.endpoint, "hostConsoleState");
  assert.equal(result.data, EMPTY_HOST_GAMEPLAY_SNAPSHOT);
  assert.equal(result.data.hostConsoleState, null);
  assert.deepEqual(result.data.hostPrompts, []);
});

test("host gameplay rejects empty and partial successful authority documents", async () => {
  const cases = [
    {},
    {
      ...hostConsolePayload(),
      authority: {
        principal_id: HOST_PRINCIPAL_ID,
        capability: "HostOf",
        allowed_classes: ["phase_resolve"],
      },
    },
    {
      ...hostConsolePayload(),
      slots: [{ slot_id: "slot-7" }],
    },
  ];

  for (const hostConsoleState of cases) {
    const result = await loadHostGameplaySnapshot({
      game: "midsummer",
      expectedPrincipalId: HOST_PRINCIPAL_ID,
      expectedCapabilityKind: "HostOf",
      hostConsoleStateEndpoint:
        "/api/gameplay/games/midsummer/host-console-state",
      timeoutMs: 0,
      fetchImpl: async (url) =>
        String(url).includes("host-console-state")
          ? jsonResponse(hostConsoleState)
          : jsonResponse(hostPayloadFor(url)),
    });

    assert.equal(result.kind, "invalid_response");
    assert.equal(result.endpoint, "hostConsoleState");
    assert.equal(result.reason, "invalid_schema");
    assert.equal(result.data, EMPTY_HOST_GAMEPLAY_SNAPSHOT);
  }
});

test("host aggregate rejects cross-game and partial sibling projections", async () => {
  const cases = [
    {
      name: "cross-game host prompt",
      endpoint: "hostPrompts",
      path: "/host-prompts",
      replace(payload) { return [{ ...payload[0], game: "other-game" }]; },
    },
    {
      name: "partial host prompt",
      endpoint: "hostPrompts",
      path: "/host-prompts",
      replace() { return [{}]; },
    },
    {
      name: "cross-game votecount",
      endpoint: "votecount",
      path: "/votecount",
      replace(payload) { return [{ ...payload[0], body: { ...payload[0].body, game: "other-game" } }]; },
    },
  ];
  for (const scenario of cases) {
    const result = await loadHostGameplaySnapshot({
      game: "midsummer",
      expectedPrincipalId: HOST_PRINCIPAL_ID,
      expectedCapabilityKind: "HostOf",
      hostConsoleStateEndpoint: "/api/gameplay/games/midsummer/host-console-state",
      timeoutMs: 0,
      fetchImpl: async (url) => {
        const payload = hostPayloadFor(url);
        return String(url).endsWith(scenario.path)
          ? jsonResponse(scenario.replace(payload))
          : jsonResponse(payload);
      },
    });
    assert.equal(result.kind, "invalid_response", scenario.name);
    assert.equal(result.endpoint, scenario.endpoint, scenario.name);
    assert.equal(result.data, EMPTY_HOST_GAMEPLAY_SNAPSHOT, scenario.name);
  }
});

test("host gameplay binds a ready snapshot to game and session authority", async () => {
  const cases = [
    {
      name: "cross-game projection",
      payload: hostConsolePayload({ game: "other-game" }),
      expectedCapabilityKind: "HostOf",
    },
    {
      name: "different principal",
      payload: hostConsolePayload({
        authority: {
          ...hostConsolePayload().authority,
          principal_id: FIXTURE_PRINCIPAL_IDS.cohostC,
        },
      }),
      expectedCapabilityKind: "HostOf",
    },
    {
      name: "different host capability",
      payload: hostConsolePayload({
        authority: {
          ...hostConsolePayload().authority,
          capability: "CohostOf",
        },
      }),
      expectedCapabilityKind: "HostOf",
    },
    {
      name: "operator authority is outside the host route contract",
      payload: hostConsolePayload({
        authority: {
          ...hostConsolePayload().authority,
          capability: "GlobalOperator",
        },
      }),
      expectedCapabilityKind: "HostOf",
    },
  ];

  for (const scenario of cases) {
    const result = await loadHostGameplaySnapshot({
      game: "midsummer",
      expectedPrincipalId: HOST_PRINCIPAL_ID,
      expectedCapabilityKind: scenario.expectedCapabilityKind,
      hostConsoleStateEndpoint:
        "/api/gameplay/games/midsummer/host-console-state",
      timeoutMs: 0,
      fetchImpl: async (url) =>
        String(url).includes("host-console-state")
          ? jsonResponse(scenario.payload)
          : jsonResponse(hostPayloadFor(url)),
    });

    assert.equal(result.kind, "invalid_response", scenario.name);
    assert.equal(result.endpoint, "hostConsoleState", scenario.name);
    assert.equal(result.data, EMPTY_HOST_GAMEPLAY_SNAPSHOT, scenario.name);
  }
});

function playerPayloadFor(url) {
  const path = String(url);
  if (path.includes("player-command-state")) {
    return {
      game: "midsummer",
      actor_slot: "slot-4",
      actor_alive: true,
      actor_status: "alive",
      role_key: "town_vanilla",
      role: null,
      game_completed: false,
      phase: null,
      actions: [],
      current_actions: [],
      vote_targets: [],
      current_vote: null,
      day_events: [],
      day_event_rooms: [],
      post_policies: [],
      boundary: "live",
    };
  }
  if (path.endsWith("/notifications")) {
    return [
      {
        game: "midsummer",
        phase_id: "N01",
        event_index: 1,
        audience_slot: "slot-4",
        effect: "phase_opened",
        status: "delivered",
      },
    ];
  }
  if (path.endsWith("/slot-mentions")) {
    return [
      {
        game: "midsummer",
        audience_slot: "slot-4",
        channel_id: "main",
        source_seq: 443,
        phase_id: "D01",
        occurred_at: 1781928000,
      },
    ];
  }
  if (path.endsWith("/investigation-results")) {
    return [
      {
        game: "midsummer",
        phase_id: "N01",
        event_index: 1,
        audience_slot: "slot-4",
        mode: "parity",
        target_slot: "slot-2",
        result: "town",
      },
    ];
  }
  if (path.endsWith("/votecount")) {
    return [
      {
        kind: "VoteCountChanged",
        body: {
          game: "midsummer",
          phase_id: "D01",
          candidate_slot: "slot-2",
          count: 2,
        },
      },
    ];
  }
  if (path.endsWith("/day-vote-outcomes")) {
    return [
      {
        kind: "DayVoteOutcomeApplied",
        body: {
          game: "midsummer",
          phase_id: "D01",
          source_seq: 3,
          event_index: 1,
          status: "eliminated",
          winner_slot: "slot-2",
          contenders: ["slot-2"],
          tallies: { "slot-2": 2 },
          votes: { "slot-1": "slot-2" },
          weights: { "slot-1": 1 },
          majority: 2,
          thresholds: { majority: 2 },
          total_weight: 2,
          tiebreak: null,
          reason: null,
        },
      },
    ];
  }
  if (path.endsWith("/endgame-summary")) {
    return {
      game: "midsummer",
      completed: false,
      winner: null,
      slots: [],
      vote_history: [],
      boundary: "reveal-gated",
    };
  }
  return {
    game: {
      game: "midsummer",
      pack: "midsummer",
      status: "active",
      phase_id: null,
      updated_seq: 1,
      completed_seq: null,
    },
    next_before_seq: null,
    posts: [
      {
        game: "midsummer",
        source_seq: 1,
        stream_seq: 1,
        channel_id: "main",
        author: { kind: "system" },
        phase_id: null,
        body: "live post",
        media: [],
        quotations: [],
        citation_count: 0,
        occurred_at: 1,
      },
    ],
  };
}

function hostPayloadFor(url) {
  const path = String(url);
  if (path.endsWith("/host-prompts")) {
    return [
      {
        game: "midsummer",
        phase_id: "D01",
        event_index: 1,
        prompt_id: "prompt-1",
        kind: "skip_next_day",
        subject_slot: null,
        reason: "host decision",
        metadata: {},
        status: "pending",
        decision: null,
        public_resolution: null,
        resolved_at: null,
      },
    ];
  }
  if (path.endsWith("/votecount")) {
    return [
      {
        kind: "VoteCountChanged",
        body: {
          game: "midsummer",
          phase_id: "D01",
          candidate_slot: "slot-2",
          count: 2,
        },
      },
    ];
  }
  if (path.endsWith("/day-vote-outcomes")) {
    return [];
  }
  if (path.includes("host-console-state")) {
    return hostConsolePayload();
  }
  throw new Error(`unexpected host URL ${path}`);
}

function hostConsolePayload(overrides = {}) {
  return {
    game: "midsummer",
    authority: {
      principal_id: HOST_PRINCIPAL_ID,
      capability: "HostOf",
      allowed_classes: ["phase_resolve"],
      denied_classes: [],
    },
    completed: false,
    phase: null,
    slots: [],
    thread_posts: [],
    day_event_scheduler: null,
    day_events: [],
    tasks: [],
    ...overrides,
  };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "request-test",
    }),
    async json() {
      return body;
    },
  };
}
