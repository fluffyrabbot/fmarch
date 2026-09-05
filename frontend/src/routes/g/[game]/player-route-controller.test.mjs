import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerCommandDispatchBridgePlan,
  buildPlayerCommandRequest,
  buildPlayerProjectionColdLoads,
  buildPlayerProjectionInitialSnapshot,
  loadOlderPlayerThreadPage,
  normalizePlayerCommandStateRefreshError,
  normalizePrivateRows,
  playerCommandErrorStatus,
  persistPlayerInterruptedCommands,
  applyPlayerComposerChannelDraft,
  clearedPlayerComposerDraft,
  playerAllowMediaOnlyPost,
  playerActionConfig,
  playerCommandInterruptedStatus,
  playerCommandPendingStatus,
  playerCommandTrace,
  playerRefreshKeysForAction,
  playerRefreshKeysForCommandOutcome,
  playerRefreshKeysForLiveDelta,
  playerReconnectRefreshKeys,
  recordPlayerCommandReceipt,
  restorePlayerInterruptedCommands,
  revokedPlayerCommandState,
  clearPlayerCommandReceipt,
  playerThreadErrorStatus,
  playerThreadNoOlderStatus,
  playerThreadPendingStatus,
  recoverPlayerRouteCommand,
  staleSlotOwnershipCommandState,
  submitPlayerRouteCommand,
  togglePrivateItemExpansion,
  uploadPlayerPostMedia,
} from "./player-route-controller.mjs";
import {
  CommandInterruptedError,
  CommandProjectionRecoveryTimeoutError,
} from "../../../lib/app/command-interruption.mjs";
import {
  createProjectionStore,
  ProjectionRefreshError,
} from "../../../lib/app/projection-store.mjs";

test("player composer draft clears body, media, quotations, and mentions after ack", () => {
  assert.deepEqual(clearedPlayerComposerDraft(), {
    body: "",
    mediaAlt: "",
    mediaFiles: undefined,
    quotations: [],
    mentions: [],
    embedUrl: "",
  });
});

test("player composer draft stashes body, quotations, and mentions per channel", () => {
  const first = applyPlayerComposerChannelDraft({
    previousChannel: "main",
    nextChannel: "private:mafia",
    current: {
      body: "town read",
      mediaAlt: "receipt",
      mediaFiles: { length: 1 },
      quotations: [{ sourceSeq: 12 }],
      mentions: ["slot_2"],
      embedUrl: "https://youtu.be/dQw4w9WgXcQ",
    },
  });
  assert.deepEqual(first.drafts.main, {
    body: "town read",
    mediaAlt: "",
    mediaFiles: undefined,
    quotations: [{ sourceSeq: 12 }],
    mentions: ["slot_2"],
    embedUrl: "https://youtu.be/dQw4w9WgXcQ",
  });
  assert.deepEqual(first.draft, clearedPlayerComposerDraft());
  assert.deepEqual(
    first.draft.mentions,
    [],
    "a room's roster does not follow the author into another room",
  );

  const back = applyPlayerComposerChannelDraft({
    drafts: first.drafts,
    previousChannel: "private:mafia",
    nextChannel: "main",
    current: { body: "scum note", quotations: [] },
  });
  assert.equal(back.draft.body, "town read");
  assert.deepEqual(back.draft.quotations, [{ sourceSeq: 12 }]);
  assert.deepEqual(back.draft.mentions, ["slot_2"]);
  assert.equal(back.drafts["private:mafia"].body, "scum note");
});

test("player submit_post config follows the current channel media-only policy", () => {
  const data = {
    threadPager: { channel: "main" },
    commandState: {
      postPolicies: [{ channelId: "main", allowMediaOnly: true }],
    },
    composer: {},
  };
  assert.equal(playerAllowMediaOnlyPost(data), true);
  assert.deepEqual(playerActionConfig(data, "submit_post"), {
    allowMediaOnlyPost: true,
  });
  assert.equal(
    playerAllowMediaOnlyPost(
      {
        ...data,
        threadPager: { channel: "private:mafia" },
      },
    ),
    false,
  );
});

test("player interrupted command keeps one retry identity and can be dismissed", () => {
  const status = playerCommandInterruptedStatus(
    new CommandInterruptedError("connection_lost"),
    { action: "submit_post", commandId: "player-command-1" },
  );
  const receipts = recordPlayerCommandReceipt([], "submit_post", status);

  assert.equal(status.state, "interrupted");
  assert.equal(status.commandId, "player-command-1");
  assert.equal(status.commandTrace.actionId, "submit_post");
  assert.deepEqual(clearPlayerCommandReceipt(receipts, "submit_post"), []);
});

test("player interrupted commands survive sessionStorage reload with the same command id", () => {
  const storage = memoryStorage();
  persistPlayerInterruptedCommands({
    storage,
    game: "midsummer",
    principalId: "principal-a",
    actorSlot: "slot-7",
    attempts: {
      submit_vote: {
        commandId: "player-command-1",
        action: "submit_vote",
        interruption: "connection_lost",
        command: {
          SubmitVote: {
            game: "midsummer",
            actor_slot: "slot-7",
            target: { Slot: "slot-2" },
          },
        },
        data: { stale: true },
      },
    },
  });

  const restored = restorePlayerInterruptedCommands({
    storage,
    game: "midsummer",
    principalId: "principal-a",
    actorSlot: "slot-7",
  });

  assert.equal(restored.attempts.submit_vote.commandId, "player-command-1");
  assert.equal(restored.attempts.submit_vote.data, undefined);
  assert.deepEqual(restored.attempts.submit_vote.command, {
    SubmitVote: {
      game: "midsummer",
      actor_slot: "slot-7",
      target: { Slot: "slot-2" },
    },
  });
  assert.equal(restored.commandStatus.commandId, "player-command-1");
  assert.equal(restored.commandStatus.state, "interrupted");
  assert.equal(restored.commandReceipts[0].actionId, "submit_vote");
});

test("player route controller builds projection store boundaries from route data", () => {
  const data = fixtureData();

  assert.deepEqual(buildPlayerProjectionInitialSnapshot(data), {
    thread: data.thread,
    votecount: data.votecount,
    dayVoteOutcomes: data.dayVoteOutcomes,
    endgameSummary: data.endgameSummary,
    notifications: data.notifications,
    investigationResults: data.investigationResults,
    slotMentions: data.slotMentions,
    commandState: data.commandState,
  });
  const coldLoads = buildPlayerProjectionColdLoads(data);
  assert.deepEqual(Object.keys(coldLoads), [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
    "notifications",
    "investigationResults",
    "slotMentions",
    "commandState",
  ]);
  const notification = {
    game: data.game.id,
    phase_id: "N01",
    event_index: 1,
    audience_slot: data.player.slotId,
    effect: "Commuted",
    status: "Delivered",
  };
  assert.equal(coldLoads.notifications.validate([notification]), true);
  assert.equal(
    coldLoads.notifications.validate([
      { ...notification, audience_slot: "slot-other" },
    ]),
    false,
  );
  assert.equal(
    coldLoads.notifications.validateLiveDelta({
      kind: "PlayerNotificationsChanged",
      body: {
        game: "other-game",
        notifications: [notification],
      },
    }),
    false,
  );
  // A slot mention is delivered to the seat, so a delta naming another seat
  // is refused by the same audience check the sibling private families use.
  assert.equal(
    coldLoads.slotMentions.validateLiveDelta({
      kind: "SlotMentionsChanged",
      body: {
        game: "midsummer",
        mentions: [
          {
            game: "midsummer",
            audience_slot: "slot-7",
            channel_id: "main",
            source_seq: 443,
            phase_id: "D02",
            occurred_at: 1781928000,
          },
        ],
      },
    }),
    true,
  );
  assert.equal(
    coldLoads.slotMentions.validateLiveDelta({
      kind: "SlotMentionsChanged",
      body: {
        game: "midsummer",
        mentions: [
          {
            game: "midsummer",
            audience_slot: "slot-2",
            channel_id: "main",
            source_seq: 443,
            phase_id: "D02",
            occurred_at: 1781928000,
          },
        ],
      },
    }),
    false,
  );
  assert.deepEqual(playerReconnectRefreshKeys(data), [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
    "notifications",
    "investigationResults",
    "slotMentions",
    "commandState",
  ]);
  assert.equal(Object.hasOwn(coldLoads.thread, "revoke"), false);
  assert.deepEqual(coldLoads.notifications.revoke, []);
  assert.deepEqual(coldLoads.investigationResults.revoke, []);
  assert.deepEqual(coldLoads.slotMentions.revoke, []);
  assert.deepEqual(
    coldLoads.commandState.revoke(),
    revokedPlayerCommandState({
      game: data.game.id,
      actorSlot: data.player.slotId,
    }),
  );

  const privateColdLoads = buildPlayerProjectionColdLoads({
    ...data,
    threadPager: { ...data.threadPager, channel: "private:mafia" },
  });
  assert.deepEqual(privateColdLoads.thread.revoke(), {
    posts: [],
    nextBeforeSeq: null,
  });

  const anonymousData = fixtureData({
    coldLoad: {
      ...fixtureData().coldLoad,
      notificationsEndpoint: null,
      investigationResultsEndpoint: null,
      slotMentionsEndpoint: null,
      commandStateEndpoint: null,
    },
  });
  assert.deepEqual(Object.keys(buildPlayerProjectionColdLoads(anonymousData)), [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
  ]);
  assert.deepEqual(playerReconnectRefreshKeys(anonymousData), [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
  ]);
  assert.deepEqual(
    playerRefreshKeysForLiveDelta(data, {
      kind: "delta",
      delta: { kind: "ThreadPostsChanged" },
    }),
    ["commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForLiveDelta(data, {
      kind: "delta",
      delta: { kind: "DayVoteOutcomeApplied" },
    }),
    ["dayVoteOutcomes", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForLiveDelta(anonymousData, {
      kind: "delta",
      delta: { kind: "DayVoteOutcomeApplied" },
    }),
    ["dayVoteOutcomes"],
  );
});

test("player command-state authorization loss clears all private authority", () => {
  const previous = {
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "doctor",
    role: { key: "doctor" },
    actions: [{ templateId: "protect" }],
    currentActions: [],
    voteTargets: [{ kind: "slot" }],
    currentVote: { kind: "slot" },
    dayEvents: [{ eventId: "event-1" }],
    dayEventRooms: [{ eventId: "event-1" }],
  };
  const revoked = normalizePlayerCommandStateRefreshError({
    status: 403,
    previous,
  });

  assert.equal(revoked.actorStatus, "replaced");
  assert.equal(revoked.actorAlive, false);
  assert.equal(revoked.role, null);
  assert.deepEqual(revoked.actions, []);
  assert.deepEqual(revoked.dayEvents, []);
  assert.deepEqual(revoked.dayEventRooms, []);
  assert.equal(
    normalizePlayerCommandStateRefreshError({ status: 503, previous }),
    undefined,
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
      data: fixtureData(),
      action: "submit_vote:no_lynch",
      composerBody: "ignored for no lynch vote",
    }),
    {
      endpoint: "/commands",
      command: {
        SubmitVote: {
          game: "midsummer",
          actor_slot: "slot-7",
          target: "NoLynch",
        },
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommandRequest({
      data: fixtureData({
        threadPager: { pageSize: 50, channel: "private:role_pm:slot-7" },
      }),
      action: "submit_post",
      composerBody: "private role note",
      media: [
        {
          content_id: "a".repeat(64),
          alt: "Night action diagram",
        },
      ],
    }),
    {
      endpoint: "/commands",
      command: {
        SubmitPost: {
          game: "midsummer",
          channel_id: "private:role_pm:slot-7",
          actor_slot: "slot-7",
          body: "private role note",
          media: [
            {
              content_id: "a".repeat(64),
              alt: "Night action diagram",
            },
          ],
        },
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommandRequest({
      data: fixtureData(),
      action: "submit_post",
      composerBody: "Answering that claim",
      quotations: [
        {
          target: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
          excerpt: "Alpha signal",
        },
      ],
    }),
    {
      endpoint: "/commands",
      command: {
        SubmitPost: {
          game: "midsummer",
          channel_id: "main",
          actor_slot: "slot-7",
          body: "Answering that claim",
          quotations: [
            {
              target: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
              excerpt: "Alpha signal",
            },
          ],
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

test("player route controller uploads image bytes and returns only a canonical post handle", async () => {
  const requests = [];
  const file = { type: "image/png", size: 128, name: "receipt.png" };
  const media = await uploadPlayerPostMedia({
    data: fixtureData(),
    file,
    alt: "  Private vote receipt  ",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({ content_id: "b".repeat(64) });
    },
  });

  assert.deepEqual(requests, [
    {
      url: "/media/uploads",
      init: {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "image/png",
        },
        body: file,
      },
    },
  ]);
  assert.deepEqual(media, [
    {
      content_id: "b".repeat(64),
      alt: "Private vote receipt",
    },
  ]);
});

test("player route controller rejects invalid media before dispatch", async () => {
  const data = fixtureData();
  const fetchImpl = async () => {
    throw new Error("invalid media must not reach fetch");
  };

  await assert.rejects(
    uploadPlayerPostMedia({
      data,
      file: { type: "image/gif", size: 128 },
      alt: "Animated receipt",
      fetchImpl,
    }),
    /Choose a PNG or JPEG image/,
  );
  await assert.rejects(
    uploadPlayerPostMedia({
      data,
      file: { type: "image/png", size: 128 },
      alt: "   ",
      fetchImpl,
    }),
    /alt text must contain 1 to 1000 characters/,
  );
  await assert.rejects(
    uploadPlayerPostMedia({
      data,
      file: { type: "image/png", size: 12 * 1024 * 1024 + 1 },
      alt: "Oversized receipt",
      fetchImpl,
    }),
    /no larger than 12 MiB/,
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
      projectionRefreshKeys: ["votecount", "commandState"],
    },
    commandKind: "SubmitVote",
    commandEndpoint: "/commands",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: ["votecount", "commandState"],
  });
});

test("player route controller refuses commands before dispatch when route authority is disabled", async () => {
  let fetchCalls = 0;
  let sendCalls = 0;

  await assert.rejects(
    submitPlayerRouteCommand({
      action: "submit_vote",
      composerBody: "##vote slot-2",
      data: {
        ...fixtureData(),
        commandsEnabled: false,
      },
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("disabled player commands must not reach fetch");
      },
      projectionStore: fakeProjectionStore(),
      sendCommandImpl: async () => {
        sendCalls += 1;
        throw new Error("disabled player commands must not reach dispatch");
      },
    }),
    /player commands are disabled without an authoritative route snapshot/,
  );

  assert.equal(fetchCalls, 0);
  assert.equal(sendCalls, 0);
});

test("player route controller treats missing route authority as disabled", async () => {
  await assert.rejects(
    submitPlayerRouteCommand({
      action: "submit_vote",
      data: { ...fixtureData(), commandsEnabled: undefined },
      projectionStore: fakeProjectionStore(),
      sendCommandImpl: async () => {
        throw new Error("missing authority must fail before dispatch");
      },
    }),
    /disabled without an authoritative route snapshot/,
  );
});

test("player interrupted retry refuses a changed command body under the old command id", async () => {
  const data = fixtureData();
  let sendCalls = 0;

  await assert.rejects(
    submitPlayerRouteCommand({
      action: "submit_vote",
      data,
      projectionStore: fakeProjectionStore(),
      preparedCommand: {
        SubmitVote: {
          game: data.game.id,
          actor_slot: data.player.slotId,
          target: { Slot: "slot-99" },
        },
      },
      sendCommandImpl: async () => {
        sendCalls += 1;
        return { state: "ack", message: "must not dispatch" };
      },
    }),
    /no longer matches the interrupted command body/,
  );

  assert.equal(sendCalls, 0);
});

test("player refresh failure revokes dispatch and a validated refresh restores it", async () => {
  const data = fixtureData();
  const store = createProjectionStore({
    initialSnapshot: { commandState: data.commandState },
    coldLoads: {
      commandState: { url: "/player-command-state" },
    },
  });
  await assert.rejects(
    store.refresh(undefined, {
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    ProjectionRefreshError,
  );
  let sendCalls = 0;
  await assert.rejects(
    submitPlayerRouteCommand({
      action: "withdraw_vote",
      data,
      projectionStore: store,
      sendCommandImpl: async () => {
        sendCalls += 1;
        return { state: "reject", error: "InvalidTarget", message: "reject" };
      },
    }),
    /projection freshness is restored/,
  );
  assert.equal(sendCalls, 0);

  await store.refresh(undefined, {
    fetchImpl: async () => jsonResponse(data.commandState),
  });
  await submitPlayerRouteCommand({
    action: "withdraw_vote",
    data,
    projectionStore: store,
    sendCommandImpl: async () => {
      sendCalls += 1;
      return { state: "reject", error: "InvalidTarget", message: "reject" };
    },
  });
  assert.equal(sendCalls, 1);
});

test("player ACK remains committed when its authoritative refresh fails", async () => {
  const data = fixtureData();
  const store = createProjectionStore({
    initialSnapshot: {
      votecount: data.votecount,
      commandState: data.commandState,
    },
    coldLoads: {
      votecount: { url: "/votecount" },
      commandState: { url: "/player-command-state" },
    },
  });
  const result = await submitPlayerRouteCommand({
    action: "submit_vote",
    data,
    projectionStore: store,
    fetchImpl: async () => ({ ok: false, status: 503 }),
    sendCommandImpl: async () => ({ state: "ack", message: "Ack: stream seq 7" }),
  });

  assert.equal(result.commandStatus.state, "ack");
  assert.equal(result.commandStatus.projectionUnavailable, true);
  assert.equal(result.commandStatus.retryable, false);
  assert.match(result.commandStatus.message, /Do not retry/);
  assert.equal(store.isReady(), false);
});

test("player ACK remains committed when projection recovery exceeds its independent 12s lease", async () => {
  const data = fixtureData();
  let refreshStarted = false;
  let invalidationReason = null;
  const projectionStore = fakeProjectionStore({
    refresh() {
      refreshStarted = true;
      return new Promise(() => {});
    },
    invalidate(_keys, options) {
      invalidationReason = options.reason;
    },
  });

  const result = await recoverPlayerRouteCommand({
    action: "submit_vote",
    data,
    projectionStore,
    commandStatus: {
      state: "ack",
      commandId: "confirmed-player-command",
      message: "Ack: stream seq 7",
    },
    projectionRecoveryTimeoutMs: 12_000,
    executeProjectionRecoveryImpl: async ({ timeoutMs, operation }) => {
      assert.equal(timeoutMs, 12_000);
      operation({ signal: new AbortController().signal });
      throw new CommandProjectionRecoveryTimeoutError();
    },
  });

  assert.equal(refreshStarted, true);
  assert.equal(result.commandStatus.state, "ack");
  assert.equal(result.commandStatus.commandId, "confirmed-player-command");
  assert.equal(result.commandStatus.projectionUnavailable, true);
  assert.equal(result.commandStatus.retryable, false);
  assert.match(result.commandStatus.message, /Do not retry/);
  assert.equal(
    invalidationReason,
    "confirmed_player_command_projection_recovery_failed",
  );
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

  assert.deepEqual(refreshed, [["votecount", "commandState"]]);
  assert.equal(commandRequests[0].commandIdFactory(), "11111111-1111-4111-8111-111111111111");
  assert.equal(result.commandStatus.state, "ack");
  assert.deepEqual(result.snapshot, projectionStore.getSnapshot());

  assert.deepEqual(playerRefreshKeysForAction("submit_post"), [
    "thread",
    "votecount",
    "commandState",
    "dayVoteOutcomes",
    "slotMentions",
  ]);
  assert.deepEqual(playerRefreshKeysForAction("submit_vote:no_lynch"), [
    "votecount",
    "commandState",
  ]);
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
  assert.deepEqual(playerRefreshKeysForAction("withdraw_vote"), [
    "votecount",
    "commandState",
  ]);
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

  assert.deepEqual(refreshed, [
    ["notifications", "investigationResults", "commandState", "dayVoteOutcomes"],
  ]);
  assert.equal(result.commandStatus.message, "Reject PhaseLocked");
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "PhaseLocked" },
    }),
    ["notifications", "investigationResults", "commandState", "dayVoteOutcomes"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "PhaseLocked" },
    }),
    ["votecount", "commandState", "dayVoteOutcomes"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "withdraw_vote",
      commandStatus: { state: "reject", error: "PhaseLocked" },
    }),
    ["votecount", "commandState", "dayVoteOutcomes"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "StreamConflict", retryable: true },
    }),
    ["votecount", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "ActionAlreadySubmitted" },
    }),
    ["notifications", "investigationResults", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "SlotNotAlive" },
    }),
    ["notifications", "investigationResults", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "SlotNotAlive" },
    }),
    ["votecount", "commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote",
      commandStatus: { state: "reject", error: "GameAlreadyCompleted" },
    }),
    ["votecount", "commandState", "endgameSummary"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_action:factional_kill",
      commandStatus: { state: "reject", error: "GameAlreadyCompleted" },
    }),
    [
      "notifications",
      "investigationResults",
      "commandState",
      "endgameSummary",
    ],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_day_event:event-cookie",
      commandStatus: { state: "ack" },
    }),
    ["commandState"],
  );
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "withdraw_day_event:event-cookie",
      commandStatus: { state: "reject", error: "DayEventStateConflict" },
    }),
    ["commandState"],
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
  assert.deepEqual(
    playerRefreshKeysForCommandOutcome({
      data: fixtureData(),
      action: "submit_vote:slot-2",
      commandStatus: { state: "reject", error: "InvalidTarget" },
    }),
    ["votecount", "commandState"],
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
        commandState: patches.at(-1)?.commandState ?? fixtureData().commandState,
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
          { source_seq: 40, author: { kind: "slot", slot_id: "slot-2" }, body: "older" },
          { source_seq: 44, author: { kind: "slot", slot_id: "slot-7" }, body: "stale" },
        ],
      });
    },
    projectionStore,
    thread: {
      nextBeforeSeq: 41,
      posts: [
        { seq: 44, author: { kind: "slot", slotId: "slot-7" }, body: "current" },
        { seq: 45, author: { kind: "host_narrator" }, body: "latest" },
      ],
    },
  });

  assert.deepEqual(seenUrls, ["/api/gameplay/games/midsummer?limit=50&before_seq=41"]);
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
      threadPager: { pageSize: 50, channel: "private:role_pm:slot-7" },
    }),
    fetchImpl: async (url) => {
      seenUrls.push(url);
      return jsonResponse({
        next_before_seq: null,
        posts: [{ source_seq: 40, author: { kind: "slot", slot_id: "slot-7" }, body: "older role note" }],
      });
    },
    projectionStore: fakeProjectionStore(),
    thread: {
      nextBeforeSeq: 41,
      posts: [
        { seq: 45, author: { kind: "slot", slotId: "slot-7" }, body: "current role note" },
      ],
    },
  });

  assert.deepEqual(seenUrls, [
    "/api/gameplay/games/midsummer/channels/private%3Arole_pm%3Aslot-7/thread?limit=50&before_seq=41",
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
      projectionRefreshKeys: ["votecount", "commandState"],
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
      projectionRefreshKeys: [
        "thread",
        "votecount",
        "commandState",
        "dayVoteOutcomes",
        "slotMentions",
      ],
    },
  });
  assert.deepEqual(playerCommandTrace("withdraw_vote"), {
    kind: "command-trace",
    surface: "player",
    actionId: "withdraw_vote",
    statusKey: "withdraw_vote",
    dispatchKind: "withdraw_vote",
    projectionRefreshKeys: ["votecount", "commandState"],
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
        projectionRefreshKeys: [
          "thread",
          "votecount",
          "commandState",
          "dayVoteOutcomes",
          "slotMentions",
        ],
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
        projectionRefreshKeys: ["votecount", "commandState"],
      },
      current: true,
    },
  ]);

  const completed = recordPlayerCommandReceipt(
    third,
    "submit_post",
    { state: "reject", message: "Reject GameAlreadyCompleted" },
    ["thread", "votecount", "commandState", "dayVoteOutcomes", "endgameSummary"],
  );
  assert.deepEqual(completed.at(-1).commandTrace.projectionRefreshKeys, [
    "thread",
    "votecount",
    "commandState",
    "dayVoteOutcomes",
    "endgameSummary",
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
    commandsEnabled: true,
    game: { id: "midsummer" },
    player: { principalId: "player_mira", slotId: "slot-7" },
    composer: {
      commandEndpoint: "/commands",
      mediaUploadEndpoint: "/media/uploads",
      mediaUploadTypes: ["image/png", "image/jpeg"],
      mediaMaxEncodedBytes: 12 * 1024 * 1024,
      voteTargetSlot: "slot-2",
      voteCommands: [
        {
          action: "submit_vote",
          commandKind: "submit_vote",
          label: "Vote slot-2",
          voteTarget: { Slot: "slot-2" },
        },
        {
          action: "submit_vote:no_lynch",
          commandKind: "submit_vote",
          label: "Vote no lynch",
          voteTarget: "NoLynch",
        },
      ],
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
    channel: { channel: "main", allowed: true },
    thread: { nextBeforeSeq: 41, posts: [] },
    votecount: [],
    dayVoteOutcomes: [],
    endgameSummary: null,
    notifications: [],
    investigationResults: [],
    slotMentions: [],
    commandState: {
      game: "midsummer",
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      gameCompleted: false,
      phase: { phaseId: "N01", phaseKind: "Night", phaseNumber: 1, locked: false },
      actions: [
        {
          action: "submit_action:factional_kill",
          actionId: "browser_factional_kill_n01",
          templateId: "factional_kill",
          targets: ["slot-2"],
          targetOptions: ["slot-2"],
        },
        {
          action: "submit_invalid_action:factional_kill",
          actionId: "invalid_self_factional_kill",
          templateId: "factional_kill",
          targets: ["slot-7"],
          targetOptions: ["slot-7"],
        },
      ],
      currentActions: [],
      voteTargets: [
        { kind: "slot", slotId: "slot-2", label: "slot-2" },
        { kind: "no_lynch", slotId: null, label: "No lynch" },
      ],
      currentVote: { kind: "slot", slotId: "slot-2", label: "slot-2" },
      dayEvents: [],
      postPolicies: [{ channelId: "main", allowMediaOnly: true }],
    },
    coldLoad: {
      threadEndpoint: "/api/gameplay/games/midsummer?limit=50",
      votecountEndpoint: "/api/gameplay/games/midsummer/votecount",
      dayVoteOutcomesEndpoint:
        "/api/gameplay/games/midsummer/day-vote-outcomes",
      endgameSummaryEndpoint: "/api/gameplay/games/midsummer/endgame-summary",
      notificationsEndpoint: "/api/gameplay/games/midsummer/notifications",
      investigationResultsEndpoint: "/api/gameplay/games/midsummer/investigation-results",
      slotMentionsEndpoint: "/api/gameplay/games/midsummer/slot-mentions",
      commandStateEndpoint: "/api/gameplay/games/midsummer/player-command-state?slot_id=slot-7",
    },
    ...overrides,
  };
}

function fakeProjectionStore(overrides = {}) {
  let snapshot = {
    thread: { nextBeforeSeq: null, posts: [] },
    votecount: [],
    commandState: fixtureData().commandState,
  };
  return {
    isReady() {
      return true;
    },
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
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type"
          ? "application/json"
          : null;
      },
    },
    async json() {
      return body;
    },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}
