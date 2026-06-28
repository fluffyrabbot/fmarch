import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerCommandDispatchBridgePlan,
  buildPlayerCommandRequest,
  buildPlayerProjectionColdLoads,
  buildPlayerProjectionInitialSnapshot,
  loadOlderPlayerThreadPage,
  normalizePrivateRows,
  playerCommandErrorStatus,
  playerCommandPendingStatus,
  playerCommandTrace,
  playerRefreshKeysForAction,
  playerRefreshKeysForCommandOutcome,
  playerRefreshKeysForLiveDelta,
  playerResyncKeys,
  recordPlayerCommandReceipt,
  playerThreadErrorStatus,
  playerThreadNoOlderStatus,
  playerThreadPendingStatus,
  staleSlotOwnershipCommandState,
  submitPlayerRouteCommand,
  togglePrivateItemExpansion,
} from "./player-route-controller.mjs";

test("player route controller builds projection store boundaries from route data", () => {
  const data = fixtureData();

  assert.deepEqual(buildPlayerProjectionInitialSnapshot(data), {
    thread: data.thread,
    votecount: data.votecount,
    notifications: data.notifications,
    investigationResults: data.investigationResults,
    commandState: data.commandState,
  });
  assert.deepEqual(Object.keys(buildPlayerProjectionColdLoads(data)), [
    "thread",
    "votecount",
    "notifications",
    "investigationResults",
    "commandState",
  ]);
  assert.deepEqual(playerResyncKeys(data), [
    "thread",
    "votecount",
    "notifications",
    "investigationResults",
    "commandState",
  ]);

  const anonymousData = fixtureData({
    coldLoad: {
      ...fixtureData().coldLoad,
      notificationsEndpoint: null,
      investigationResultsEndpoint: null,
      commandStateEndpoint: null,
    },
  });
  assert.deepEqual(Object.keys(buildPlayerProjectionColdLoads(anonymousData)), [
    "thread",
    "votecount",
  ]);
  assert.deepEqual(playerResyncKeys(anonymousData), ["thread", "votecount"]);
  assert.deepEqual(
    playerRefreshKeysForLiveDelta(data, {
      kind: "delta",
      delta: { kind: "ThreadPostsChanged" },
    }),
    ["commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForLiveDelta(anonymousData, {
      kind: "delta",
      delta: { kind: "ThreadPostsChanged" },
    }),
    [],
  );
});

test("player route controller builds typed player command requests", () => {
  assert.deepEqual(
    buildPlayerCommandRequest({
      data: fixtureData(),
      action: "submit_vote",
      composerBody: "ignored for vote",
    }),
    {
      principalUserId: "player_mira",
      endpoint: "/commands",
      command: {
        SubmitVote: {
          game: "midsummer",
          actor_slot: "slot-7",
          target: { Slot: "slot-2" },
        },
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommandRequest({
      data: fixtureData({
        threadPager: { pageSize: 50, channel: "role-pm" },
      }),
      action: "submit_post",
      composerBody: "private role note",
    }),
    {
      principalUserId: "player_mira",
      endpoint: "/commands",
      command: {
        SubmitPost: {
          game: "midsummer",
          channel_id: "role-pm",
          actor_slot: "slot-7",
          body: "private role note",
        },
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommandRequest({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      composerBody: "ignored for action",
    }),
    {
      principalUserId: "player_mira",
      endpoint: "/commands",
      command: {
        SubmitAction: {
          game: "midsummer",
          action_id: "browser_factional_kill_n01",
          actor_slot: "slot-7",
          template_id: "factional_kill",
          targets: ["slot-2"],
          grant_id: null,
        },
      },
    },
  );
});

test("player route controller derives dispatch bridge plans from command requests", () => {
  const plan = buildPlayerCommandDispatchBridgePlan({
    data: fixtureData(),
    action: "submit_vote",
    composerBody: "ignored for vote",
    optimisticStatus: playerCommandPendingStatus("submit_vote"),
    finalStatus: {
      state: "ack",
      message: "Ack: stream seqs 71",
      commandTrace: playerCommandTrace("submit_vote"),
    },
  });

  assert.deepEqual(plan, {
    role: "player",
    boundary:
      "No-browser bridge contract for command trace metadata. It proves trace attributes can be normalized into role dispatch plans and reconciled with typed command requests, local feedback rows, and projection refresh keys. It does not prove pointer events, focus traversal, browser hydration, or network transport.",
    trace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      projectionRefreshKeys: ["votecount"],
    },
    commandKind: "SubmitVote",
    commandEndpoint: "/commands",
    principalUserId: "player_mira",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: ["votecount"],
  });
});

test("player route controller refreshes only projections touched by acked commands", async () => {
  const refreshed = [];
  const commandRequests = [];
  const projectionStore = fakeProjectionStore({
    refresh: async (keys) => {
      refreshed.push(keys);
    },
  });

  const result = await submitPlayerRouteCommand({
    action: "submit_vote",
    composerBody: "##vote slot-2",
    data: fixtureData(),
    fetchImpl: async () => {
      throw new Error("fetch should stay inside sendCommandImpl");
    },
    projectionStore,
    commandIdFactory: () => "11111111-1111-4111-8111-111111111111",
    sendCommandImpl: async (request) => {
      commandRequests.push(request);
      return { state: "ack", message: "ok" };
    },
  });

  assert.deepEqual(refreshed, [["votecount"]]);
  assert.equal(commandRequests[0].commandIdFactory(), "11111111-1111-4111-8111-111111111111");
  assert.equal(result.commandStatus.state, "ack");
  assert.deepEqual(result.snapshot, projectionStore.getSnapshot());

  assert.deepEqual(playerRefreshKeysForAction("submit_post"), ["thread", "votecount"]);
  assert.deepEqual(playerRefreshKeysForAction("submit_action"), [
    "notifications",
    "investigationResults",
    "commandState",
  ]);
  assert.deepEqual(playerRefreshKeysForAction("submit_action:factional_kill"), [
    "notifications",
    "investigationResults",
    "commandState",
  ]);
  assert.deepEqual(playerRefreshKeysForAction("withdraw_vote"), ["votecount"]);
});

test("player route controller refreshes command state after stale phase rejects", async () => {
  const refreshed = [];
  const result = await submitPlayerRouteCommand({
    action: "submit_action:factional_kill",
    composerBody: "",
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore: fakeProjectionStore({
      refresh: async (keys) => {
        refreshed.push(keys);
      },
    }),
    sendCommandImpl: async () => ({
      state: "reject",
      error: "PhaseLocked",
      message: "Reject PhaseLocked",
    }),
  });

  assert.deepEqual(refreshed, [["notifications", "investigationResults", "commandState"]]);
  assert.equal(result.commandStatus.message, "Reject PhaseLocked");
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "PhaseLocked" },
    }),
    ["notifications", "investigationResults", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "PhaseLocked" },
    }),
    ["votecount", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "StreamConflict", retryable: true },
    }),
    ["votecount"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "ActionAlreadySubmitted" },
    }),
    ["notifications", "investigationResults", "commandState"],
  );
});

test("player route controller refreshes action state after invalid target rejects", async () => {
  const refreshed = [];
  const result = await submitPlayerRouteCommand({
    action: "submit_invalid_action:factional_kill",
    composerBody: "",
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore: fakeProjectionStore({
      refresh: async (keys) => {
        refreshed.push(keys);
      },
    }),
    sendCommandImpl: async () => ({
      state: "reject",
      error: "InvalidTarget",
      message: "Reject InvalidTarget",
    }),
  });

  assert.deepEqual(refreshed, [["notifications", "investigationResults", "commandState"]]);
  assert.equal(result.commandStatus.message, "Reject InvalidTarget");
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_invalid_action:factional_kill",
      commandStatus: { state: "reject", error: "InvalidTarget" },
    }),
    ["notifications", "investigationResults", "commandState"],
  );
});

test("player route controller clears local commands after slot ownership rejects", async () => {
  const refreshed = [];
  const patches = [];
  const result = await submitPlayerRouteCommand({
    action: "submit_vote",
    composerBody: "",
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore: fakeProjectionStore({
      refresh: async (keys) => {
        refreshed.push(keys);
      },
      applySnapshot: (patch) => {
        patches.push(patch);
        return patch;
      },
      getSnapshot: () => ({
        commandState: patches.at(-1)?.commandState,
      }),
    }),
    sendCommandImpl: async () => ({
      state: "reject",
      error: "NotYourSlot",
      message:
        "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
    }),
  });

  assert.deepEqual(refreshed, []);
  assert.equal(result.commandStatus.error, "NotYourSlot");
  assert.equal(result.snapshot.commandState.actorSlot, "slot-7");
  assert.equal(result.snapshot.commandState.actorAlive, false);
  assert.equal(result.snapshot.commandState.actorStatus, "replaced");
  assert.deepEqual(result.snapshot.commandState.actions, []);
  assert.match(result.snapshot.commandState.boundary, /no longer owns slot-7/);
  assert.deepEqual(
    staleSlotOwnershipCommandState({
      data: fixtureData(),
      commandStatus: result.commandStatus,
    }),
    result.snapshot.commandState,
  );
});

test("player route controller preserves unrelated non-phase rejects without refresh", async () => {
  const refreshed = [];
  const result = await submitPlayerRouteCommand({
    action: "withdraw_vote",
    composerBody: "",
    data: fixtureData(),
    fetchImpl: async () => null,
    projectionStore: fakeProjectionStore({
      refresh: async (keys) => {
        refreshed.push(keys);
      },
    }),
    sendCommandImpl: async () => ({
      state: "reject",
      error: "InvalidTarget",
      message: "Reject InvalidTarget",
    }),
  });

  assert.deepEqual(refreshed, []);
  assert.equal(result.commandStatus.message, "Reject InvalidTarget");
});

test("player route controller loads and merges older thread pages", async () => {
  const seenUrls = [];
  const projectionStore = fakeProjectionStore();

  const result = await loadOlderPlayerThreadPage({
    data: fixtureData(),
    fetchImpl: async (url) => {
      seenUrls.push(url);
      return jsonResponse({
        next_before_seq: 10,
        posts: [
          { source_seq: 40, author_user: "Ilya", body: "older" },
          { source_seq: 44, author_user: "Mira", body: "stale" },
        ],
      });
    },
    projectionStore,
    thread: {
      nextBeforeSeq: 41,
      posts: [
        { seq: 44, authorLabel: "Mira", body: "current" },
        { seq: 45, authorLabel: "Host", body: "latest" },
      ],
    },
  });

  assert.deepEqual(seenUrls, ["/games/midsummer/thread?limit=50&before_seq=41"]);
  assert.deepEqual(result.threadPageStatus, {
    state: "ack",
    message: "Loaded 2 older posts",
  });
  assert.deepEqual(result.snapshot.thread.posts.map((post) => post.body), [
    "older",
    "current",
    "latest",
  ]);
});

test("player route controller pages older posts from the active private channel", async () => {
  const seenUrls = [];
  await loadOlderPlayerThreadPage({
    data: fixtureData({
      threadPager: { pageSize: 50, channel: "role-pm" },
    }),
    fetchImpl: async (url) => {
      seenUrls.push(url);
      return jsonResponse({
        next_before_seq: null,
        posts: [{ source_seq: 40, author_user: "Mira", body: "older role note" }],
      });
    },
    projectionStore: fakeProjectionStore(),
    thread: {
      nextBeforeSeq: 41,
      posts: [{ seq: 45, authorLabel: "Mira", body: "current role note" }],
    },
  });

  assert.deepEqual(seenUrls, [
    "/games/midsummer/channels/role-pm/thread?limit=50&before_seq=41&principal_user_id=player_mira",
  ]);
});

test("player route controller handles no-older and local view statuses", async () => {
  const projectionStore = fakeProjectionStore();
  const result = await loadOlderPlayerThreadPage({
    data: fixtureData(),
    fetchImpl: async () => {
      throw new Error("no fetch expected");
    },
    projectionStore,
    thread: { nextBeforeSeq: null, posts: [] },
  });

  assert.deepEqual(result.threadPageStatus, playerThreadNoOlderStatus());
  assert.deepEqual(playerCommandPendingStatus(), {
    state: "pending",
    message: "Sending command",
  });
  assert.deepEqual(playerCommandPendingStatus("submit_vote"), {
    state: "pending",
    message: "Sending command",
    commandTrace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      projectionRefreshKeys: ["votecount"],
    },
  });
  assert.deepEqual(playerCommandErrorStatus(new Error("boom")), {
    state: "reject",
    message: "boom",
  });
  assert.deepEqual(playerCommandErrorStatus(new Error("boom"), "submit_post"), {
    state: "reject",
    message: "boom",
    commandTrace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_post",
      statusKey: "submit_post",
      dispatchKind: "submit_post",
      projectionRefreshKeys: ["thread", "votecount"],
    },
  });
  assert.deepEqual(playerCommandTrace("withdraw_vote"), {
    kind: "command-trace",
    surface: "player",
    actionId: "withdraw_vote",
    statusKey: "withdraw_vote",
    dispatchKind: "withdraw_vote",
    projectionRefreshKeys: ["votecount"],
  });
  assert.deepEqual(playerCommandTrace("submit_action"), {
    kind: "command-trace",
    surface: "player",
    actionId: "submit_action",
    statusKey: "submit_action",
    dispatchKind: "submit_action",
    projectionRefreshKeys: ["notifications", "investigationResults", "commandState"],
  });
  assert.deepEqual(playerThreadPendingStatus(), {
    state: "pending",
    message: "Loading older posts",
  });
  assert.deepEqual(playerThreadErrorStatus(new Error("page rejected")), {
    state: "reject",
    message: "page rejected",
  });
});

test("player route controller records one current command receipt per action", () => {
  const first = recordPlayerCommandReceipt(
    [],
    "submit_vote",
    { state: "pending", message: "Sending command" },
  );
  const second = recordPlayerCommandReceipt(
    first,
    "submit_post",
    { state: "ack", message: "Ack: stream seqs 51" },
  );
  const third = recordPlayerCommandReceipt(
    second,
    "submit_vote",
    { state: "reject", message: "Reject PhaseLocked" },
  );

  assert.deepEqual(third, [
    {
      actionId: "submit_post",
      state: "ack",
      message: "Ack: stream seqs 51",
      commandTrace: {
        kind: "command-trace",
        surface: "player",
        actionId: "submit_post",
        statusKey: "submit_post",
        dispatchKind: "submit_post",
        projectionRefreshKeys: ["thread", "votecount"],
      },
      current: false,
    },
    {
      actionId: "submit_vote",
      state: "reject",
      message: "Reject PhaseLocked",
      commandTrace: {
        kind: "command-trace",
        surface: "player",
        actionId: "submit_vote",
        statusKey: "submit_vote",
        dispatchKind: "submit_vote",
        projectionRefreshKeys: ["votecount"],
      },
      current: true,
    },
  ]);
});

test("player route controller toggles private item expansion and validates private rows", () => {
  assert.deepEqual(
    togglePrivateItemExpansion({ "notification-1": true }, { id: "notification-1" }),
    { "notification-1": false },
  );
  assert.deepEqual(
    togglePrivateItemExpansion({}, { id: "investigation-1" }),
    { "investigation-1": true },
  );

  const rows = [{ effect: "Commuted" }];
  assert.deepEqual(normalizePrivateRows(rows, []), rows);
  assert.deepEqual(normalizePrivateRows({ effect: "Commuted" }, rows), rows);
});

function fixtureData(overrides = {}) {
  return {
    game: { id: "midsummer" },
    player: { principalUserId: "player_mira", slotId: "slot-7" },
    composer: {
      commandEndpoint: "/commands",
      voteTargetSlot: "slot-2",
      actionCommands: [
        {
          action: "submit_action:factional_kill",
          commandKind: "submit_action",
          actionId: "browser_factional_kill_n01",
          templateId: "factional_kill",
          targets: ["slot-2"],
        },
        {
          action: "submit_invalid_action:factional_kill",
          commandKind: "submit_invalid_action",
          actionId: "invalid_self_factional_kill",
          templateId: "factional_kill",
          targets: ["slot-7"],
        },
      ],
    },
    threadPager: { pageSize: 50, channel: "main" },
    thread: { nextBeforeSeq: 41, posts: [] },
    votecount: [],
    notifications: [],
    investigationResults: [],
    commandState: {
      phase: { phaseId: "N01", phaseKind: "Night", phaseNumber: 1, locked: false },
      actions: [],
    },
    coldLoad: {
      threadEndpoint: "/games/midsummer/thread?limit=50",
      votecountEndpoint: "/games/midsummer/votecount",
      notificationsEndpoint:
        "/games/midsummer/notifications?principal_user_id=player_mira",
      investigationResultsEndpoint:
        "/games/midsummer/investigation-results?principal_user_id=player_mira",
      commandStateEndpoint:
        "/games/midsummer/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
    },
    ...overrides,
  };
}

function fakeProjectionStore(overrides = {}) {
  let snapshot = {
    thread: { nextBeforeSeq: null, posts: [] },
    votecount: [],
  };
  return {
    getSnapshot() {
      return snapshot;
    },
    async refresh() {},
    applySnapshot(patch) {
      snapshot = { ...snapshot, ...patch };
      return snapshot;
    },
    ...overrides,
  };
}

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}
