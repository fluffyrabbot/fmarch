import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_ROUTE_STATE_CONTRACT } from "../../../lib/app/app-route-state-model.mjs";
import { load } from "./+page.server.js";
import { load as loadChannelRoute } from "./c/[channel]/+page.server.js";
import {
  PLAYER_ROUTE_CONTRACT,
  buildLiveOfficialPost,
  buildPrivateQueue,
  buildPrivateQueueBoundary,
  buildPrivateQueueRouteItems,
  buildGameRouteData,
  buildPlayerComposerView,
  buildPlayerVoteCommands,
  playerChannelForbiddenMessage,
  playerChannelNotFoundMessage,
  mergeThreadPage,
  playerForbiddenMessage,
  threadPageStatusForResult,
} from "./game-route-model.mjs";

test("player route data exposes thread, channel, votecount, and touch command labels", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "main" },
    ],
  });

  assert.equal(data.access.allowed, true);
  assert.deepEqual(data.surfaceHeader, {
    component: "fm-surface-header",
    surface: "player",
    className: "fm-surface__masthead",
    eyebrowClassName: "fm-eyebrow",
    statusStackClassName: "fm-status-stack",
    eyebrow: "Midsummer Invitational",
    title: "Day 2",
    summary: "Seven votes to hammer. Thread is open.",
    capability: {
      visible: true,
      label: "SlotOccupant(midsummer)",
      testId: "player-capability",
      className: "fm-capability-pill",
      minTouchTargetPx: 44,
    },
    liveStatus: {
      visible: true,
      testId: "player-live-status",
      className: "fm-live-status",
    },
  });
  assert.deepEqual(PLAYER_ROUTE_CONTRACT, {
    surfaceTestId: "player-surface",
    capabilityTestId: "player-capability",
    liveStatusTestId: "player-live-status",
    requiredText: "Full votecount",
  });
  assert.equal(data.player.slotId, "slot-7");
  assert.deepEqual(
    data.channels.map((channel) => channel.id),
    ["main"],
  );
  assert.deepEqual(data.channel, {
    channel: "main",
    supported: true,
    allowed: true,
    label: "Main thread",
    capabilityLabel: "SlotOccupant or ChannelMember(main)",
    href: "/g/midsummer",
  });
  assert.equal(data.thread.posts[1].body, "##vote slot-2");
  assert.equal(
    data.thread.posts[0].media[0].variants.tablet.webpUrl,
    "/media/midsummer/thread/receipt-442-tablet.png",
  );
  assert.equal(
    data.thread.posts[0].media[0].variants.thumb.webpUrl,
    "/media/midsummer/thread/receipt-442-small.png",
  );
  assert.equal(data.composer.voteCommandLabel, "Vote slot-2");
  assert.deepEqual(data.composer.voteCommands, [
    {
      action: "submit_vote",
      commandKind: "submit_vote",
      label: "Vote Slot 2",
      voteTarget: { Slot: "slot-2" },
    },
    {
      action: "submit_vote:no_lynch",
      commandKind: "submit_vote",
      label: "Vote no lynch",
      voteTarget: "NoLynch",
    },
  ]);
  assert.equal(data.composer.currentVoteLabel, "No current vote");
  assert.equal(data.composer.hasCurrentVote, false);
  assert.equal(data.composer.canWithdrawVote, false);
  assert.equal(data.composer.withdrawDisabledReason, "No current vote");
  assert.deepEqual(data.composer.actionCommands, []);
  assert.equal(data.coldLoad.threadEndpoint, "/games/midsummer/thread?limit=50");
  assert.equal(
    data.coldLoad.notificationsEndpoint,
    "/games/midsummer/notifications?principal_user_id=player_mira",
  );
  assert.equal(
    data.coldLoad.investigationResultsEndpoint,
    "/games/midsummer/investigation-results?principal_user_id=player_mira",
  );
  assert.equal(
    data.coldLoad.commandStateEndpoint,
    "/games/midsummer/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
  );
  assert.deepEqual(data.threadPager, {
    pageSize: 50,
    hasOlder: true,
    nextBeforeSeq: 441,
    channel: "main",
    olderEndpoint: "/games/midsummer/thread?limit=50&before_seq=441",
  });
  assert.equal(data.coldLoad.votecountEndpoint, "/games/midsummer/votecount");
  assert.equal(
    data.coldLoad.dayVoteOutcomesEndpoint,
    "/games/midsummer/day-vote-outcomes",
  );
  assert.equal(
    data.coldLoad.endgameSummaryEndpoint,
    "/games/midsummer/endgame-summary",
  );
  assert.deepEqual(data.dayVoteOutcomes, [
    {
      game: null,
      phaseId: "D01",
      sourceSeq: 41,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-2",
      tallies: { "slot-2": 4, "slot-7": 2 },
      majority: 4,
      reason: null,
    },
  ]);
  assert.equal(
    data.liveProjection.endpoint,
    "/ws?game=midsummer&principal_user_id=player_mira",
  );
  assert.equal(
    data.projectionBoundary.status,
    "json-ws-command-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(
    data.projectionBoundary.resyncPolicy,
    "single-flight-latest-trailing-refresh",
  );
  assert.match(data.composer.transportBoundary, /command-following/);
  assert.equal(data.privateQueueBoundary.status, "principal-scoped-private-projections");
  assert.equal(data.privateQueueBoundary.count, 2);
  assert.deepEqual(
    data.privateQueue.map((item) => ({
      id: item.id,
      label: item.label,
      value: item.value,
      detail: item.detail,
      reviewHref: item.reviewHref,
    })),
    [
      {
        id: "notification-1",
        label: "Commuted",
        value: "Delivered",
        detail: "Phase N02",
        reviewHref: "/g/midsummer?private=notification-1",
      },
      {
        id: "investigation-1",
        label: "tracker",
        value: "No visit",
        detail: "Target slot-4",
        reviewHref: "/g/midsummer?private=investigation-1",
      },
    ],
  );
  assert.deepEqual(data.privateQueueExpandedItems, {});
  assert.equal(data.liveOfficialPost, null);
  assert.equal(data.layout.root.data.mode, "tablet-two-zone-channel-switcher");
  assert.equal(data.layout.root.data.minTabletViewportPx, 1024);
  assert.equal(data.layout.root.data.collapseBelowPx, 840);
  assert.deepEqual(data.layout.commandRail, {
    className: "player-surface__command-stack",
    data: {
      mode: "sticky-tablet-command-column",
      stickyTopPx: 22,
      unstickBelowPx: 840,
      stabilityMode: "primary-controls-before-live-receipts",
    },
  });
  assert.deepEqual(data.layout.regions, ["channels", "thread", "commands"]);
});

test("player route data exposes action-open state for seeded UUID role URLs", async () => {
  const game = "806825b7-98ee-447b-b643-980991de9480";
  const data = await buildGameRouteData({
    game,
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game, slot: "slot-7" },
      { kind: "ChannelMember", game, channel: "main" },
    ],
  });

  assert.equal(data.phase.label, "Night 2");
  assert.equal(data.commandState.phase.phaseId, "N02");
  assert.equal(data.commandState.phase.locked, false);
  assert.equal(data.commandState.actorSlot, "slot-7");
  assert.deepEqual(data.composer.voteCommands, []);
  assert.deepEqual(
    data.composer.actionCommands.map((command) => ({
      action: command.action,
      templateId: command.templateId,
      targets: command.targets,
    })),
    [
      {
        action: "submit_action:factional_kill",
        templateId: "factional_kill",
        targets: ["slot-3"],
      },
      {
        action: "submit_invalid_action:factional_kill",
        templateId: "factional_kill",
        targets: ["slot-7"],
      },
    ],
  );
});

test("spectator role URLs load only the spectator room without player-private cold loads", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "spectator_s",
    activeChannel: "spectator",
    capabilities: [{ kind: "SpectatorOf", game: "midsummer" }],
  });
  assert.equal(data.access.allowed, true);
  assert.equal(data.player.readOnly, true);
  assert.equal(data.player.slotId, null);
  assert.deepEqual(data.channels.map((channel) => channel.id), ["spectator"]);
  assert.equal(data.channel.allowed, true);
  assert.equal(data.channel.capabilityLabel, "SpectatorOf(game)");
  assert.equal(data.composer.readOnly, true);
  assert.equal(data.commandState.actorSlot, null);
  assert.equal(data.commandState.role, null);
  assert.deepEqual(data.notifications, []);
  assert.deepEqual(data.investigationResults, []);
  assert.deepEqual(data.privateQueue, []);
  assert.equal(data.coldLoad.notificationsEndpoint, null);
  assert.equal(data.coldLoad.investigationResultsEndpoint, null);
  assert.equal(data.coldLoad.commandStateEndpoint, null);
  assert.equal(
    data.coldLoad.threadEndpoint,
    "/games/midsummer/channels/spectator/thread?limit=50&principal_user_id=spectator_s",
  );
});

test("selected action targets override the server default when legal", () => {
  const commandState = {
    actions: [
      {
        action: "submit_action:factional_kill",
        commandKind: "submit_action",
        actionId: "factional_kill",
        templateId: "factional_kill",
        ability: "Kill",
        window: "Night",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-3",
        targets: ["slot-3"],
        targetOptions: ["slot-2", "slot-3"],
        grantId: null,
      },
    ],
  };
  const picked = buildPlayerComposerView(
    {},
    commandState,
    "slot-7",
    { factional_kill: "slot-2" },
  ).actionCommands[0];
  assert.deepEqual(picked.targets, ["slot-2"]);
  assert.equal(picked.detail, "factional_kill -> slot-2");
  assert.deepEqual(picked.targetOptions, ["slot-2", "slot-3"]);
  assert.equal(picked.action, "submit_action:factional_kill");

  const staleSelection = buildPlayerComposerView(
    {},
    commandState,
    "slot-7",
    { factional_kill: "slot-9" },
  ).actionCommands[0];
  assert.deepEqual(staleSelection.targets, ["slot-3"]);
  assert.equal(staleSelection.detail, "factional_kill -> slot-3");

  const noSelection = buildPlayerComposerView({}, commandState, "slot-7")
    .actionCommands[0];
  assert.deepEqual(noSelection.targets, ["slot-3"]);
});

test("current actions surface a withdraw command once the picker template is submitted", () => {
  const commandState = {
    actions: [],
    currentActions: [
      {
        actionId: "role_factional_kill",
        templateId: "factional_kill",
        targets: ["slot-2"],
        grantId: null,
      },
    ],
  };
  const withdrawal = buildPlayerComposerView({}, commandState, "slot-7")
    .actionCommands.find((command) => command.commandKind === "withdraw_action");
  assert.equal(withdrawal.action, "withdraw_action:factional_kill");
  assert.equal(withdrawal.actionId, "role_factional_kill");
  assert.equal(withdrawal.templateId, "factional_kill");
  assert.deepEqual(withdrawal.targets, ["slot-2"]);
  assert.match(withdrawal.detail, /Current pick: slot-2/u);
});

test("player vote commands honor explicitly empty live command-state targets", () => {
  assert.deepEqual(
    buildPlayerVoteCommands(
      {
        voteCommands: [
          {
            action: "submit_vote",
            commandKind: "submit_vote",
            label: "Vote stale target",
            voteTarget: { Slot: "slot-2" },
          },
        ],
      },
      { voteTargets: [] },
    ),
    [],
  );
});

test("player route data marks active private channel access without host data", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "private:role_pm:slot-7",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });

  assert.equal(data.access.allowed, true);
  assert.deepEqual(data.channel, {
    channel: "private:role_pm:slot-7",
    supported: true,
    allowed: true,
    label: "Role PM",
    capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
  });
  assert.deepEqual(data.channels, [
    {
      id: "private:role_pm:slot-7",
      label: "Role PM",
      href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      active: true,
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    },
  ]);
  assert.equal(
    data.coldLoad.threadEndpoint,
    "/games/midsummer/channels/private%3Arole_pm%3Aslot-7/thread?limit=50&principal_user_id=player_mira",
  );
  assert.equal(
    data.threadPager.olderEndpoint,
    "/games/midsummer/channels/private%3Arole_pm%3Aslot-7/thread?limit=50&before_seq=441&principal_user_id=player_mira",
  );
  assert.equal(
    data.liveProjection.endpoint,
    "/ws?game=midsummer&principal_user_id=player_mira&channel=private%3Arole_pm%3Aslot-7",
  );
  assert.equal(Object.hasOwn(data, "hostPrompts"), false);
});

test("player route data can address private queue rows from the URL", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    privateItem: "notification-1",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });

  assert.deepEqual(data.privateQueueExpandedItems, { "notification-1": true });
  assert.deepEqual(
    data.privateQueue.map((item) => [item.id, item.reviewHref]),
    [
      ["notification-1", "/g/midsummer?private=notification-1"],
      ["investigation-1", "/g/midsummer?private=investigation-1"],
    ],
  );

  const unknown = await buildGameRouteData({
    game: "midsummer",
    privateItem: "missing-private-row",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
  });
  assert.deepEqual(unknown.privateQueueExpandedItems, {});

  const rolePm = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "private:role_pm:slot-7",
    privateItem: "investigation-1",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  assert.deepEqual(rolePm.privateQueueExpandedItems, { "investigation-1": true });
  assert.equal(
    rolePm.privateQueue[1].reviewHref,
    "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=investigation-1",
  );
});

test("player route data models unsupported and denied channel access", async () => {
  const unsupported = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "scum-chat",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  assert.equal(unsupported.channel.supported, false);
  assert.equal(playerChannelNotFoundMessage({
    game: "midsummer",
    channel: "scum-chat",
  }), "Game midsummer does not expose player channel scum-chat.");

  const denied = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "private:role_pm:slot-7",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "main" },
    ],
  });
  assert.equal(denied.access.allowed, true);
  assert.equal(denied.channel.supported, true);
  assert.equal(denied.channel.allowed, false);
  assert.equal(playerChannelForbiddenMessage({
    game: "midsummer",
    channel: "private:role_pm:slot-7",
  }), "Game midsummer channel private:role_pm:slot-7 requires scoped channel capability.");
});

test("player route data uses REST projection cold-loads when available", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    fetchImpl: async (url) => {
      if (url.includes("/thread?")) {
        return jsonResponse({
          next_before_seq: null,
          posts: [
            {
              source_seq: 99,
              author_slot: "slot-7",
              author_user: "player-mira",
              body: "server thread post",
              occurred_at: 1781928000,
              media: [
                {
                  content_id: "f".repeat(64),
                  alt: "Server receipt",
                  variants: {
                    tablet: {
                      avif_url: "/media/thread/server/tablet.avif",
                      webp_url: "/media/thread/server/tablet.webp",
                      width: 480,
                      height: 360,
                    },
                  },
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/votecount")) {
        return jsonResponse([
          { VoteCountChanged: { candidate_slot: "slot-2", count: 5 } },
        ]);
      }
      if (url.includes("/day-vote-outcomes")) {
        return jsonResponse([
          {
            DayVoteOutcomeApplied: {
              phase_id: "D01",
              source_seq: 22,
              event_index: 0,
              status: "Lynch",
              winner_slot: "slot-2",
              tallies: { "slot-2": 5 },
              majority: 5,
            },
          },
        ]);
      }
      if (url.includes("/notifications")) {
        return jsonResponse([
          { effect: "Neighborized", status: "Delivered" },
        ]);
      }
      if (url.includes("/investigation-results")) {
        return jsonResponse([
          { mode: "cop", target_slot: "slot-2", result: "Mafia" },
        ]);
      }
      if (url.includes("/player-command-state")) {
        return jsonResponse({
          game: "midsummer",
          actor_slot: "slot-7",
          actor_alive: true,
          actor_status: "alive",
          role_key: "mafia_goon",
          phase: {
            phase_id: "N01",
            phase_kind: "Night",
            phase_number: 1,
            locked: false,
          },
          actions: [
            {
              template_id: "factional_kill",
              ability: "Kill",
              window: "Night",
              label: "Submit factional kill",
              detail: "factional_kill -> slot-2",
              targets: ["slot-2"],
              target_options: ["slot-2", "slot-3"],
            },
          ],
          current_vote: { kind: "no_lynch", slot_id: null, label: "No lynch" },
          boundary: "live player command state",
        });
      }
      return { ok: false };
    },
  });

  assert.equal(data.phase.label, "Night 1");
  assert.equal(data.surfaceHeader.title, "Night 1");
  assert.equal(data.commandState.actorAlive, true);
  assert.equal(data.commandState.actorStatus, "alive");
  assert.deepEqual(data.commandState.currentVote, {
    kind: "no_lynch",
    slotId: null,
    label: "No lynch",
  });
  assert.equal(data.composer.currentVoteLabel, "Current vote: No lynch");
  assert.equal(data.composer.hasCurrentVote, true);
  assert.equal(data.composer.canWithdrawVote, true);
  assert.equal(data.composer.withdrawDisabledReason, "");
  assert.equal(data.player.alive, true);
  assert.equal(data.player.status, "alive");
  assert.deepEqual(
    data.composer.actionCommands.map((command) => ({
      action: command.action,
      commandKind: command.commandKind,
      label: command.label,
      detail: command.detail,
      templateId: command.templateId,
      targets: command.targets,
    })),
    [
      {
        action: "submit_action:factional_kill",
        commandKind: "submit_action",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-2",
        templateId: "factional_kill",
        targets: ["slot-2"],
      },
      {
        action: "submit_invalid_action:factional_kill",
        commandKind: "submit_invalid_action",
        label: "Try invalid self-action",
        detail: "factional_kill -> own slot",
        templateId: "factional_kill",
        targets: ["slot-7"],
      },
    ],
  );
  assert.equal(data.thread.posts[0].body, "server thread post");
  assert.equal(
    data.thread.posts[0].media[0].variants.tablet.webpUrl,
    "/media/thread/server/tablet.webp",
  );
  assert.deepEqual(data.votecount, [{ target: "slot-2", count: 5, needed: 7 }]);
  assert.deepEqual(data.dayVoteOutcomes, [
    {
      game: null,
      phaseId: "D01",
      sourceSeq: 22,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-2",
      tallies: { "slot-2": 5 },
      majority: 5,
      reason: null,
    },
  ]);
  assert.deepEqual(data.privateQueue, [
    {
      id: "notification-1",
      kind: "notification",
      label: "Neighborized",
      value: "Delivered",
      detail: "Sent only to you",
      buttonLabel: "Review",
      reviewHref: "/g/midsummer?private=notification-1",
    },
    {
      id: "investigation-1",
      kind: "investigation-result",
      label: "cop",
      value: "Mafia",
      detail: "Target slot-2",
      buttonLabel: "Review",
      reviewHref: "/g/midsummer?private=investigation-1",
    },
  ]);
  assert.equal(data.privateQueueBoundary.count, 2);
});

test("player route model highlights the latest official host thread post", () => {
  assert.deepEqual(
    buildLiveOfficialPost({
      posts: [
        { seq: 10, authorLabel: "host", body: "Official votecount for D01\n- slot_2: 1", meta: "live" },
        { seq: 11, authorLabel: "Mira", body: "not official", meta: "now" },
        { seq: 12, authorLabel: "host", body: "Official votecount for D02\nNo active ballots.", meta: "later" },
      ],
    }),
    {
      seq: 12,
      label: "Official host post",
      value: "Official votecount for D02",
      detail: "later",
    },
  );
  assert.equal(
    buildLiveOfficialPost({
      posts: [{ seq: 1, authorLabel: "host", body: "regular host note" }],
    }),
    null,
  );
});

test("player private queue helpers derive visible queue from scoped projections", () => {
  const snapshot = {
    notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
    investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
  };

  assert.deepEqual(buildPrivateQueueBoundary(snapshot), {
    status: "principal-scoped-private-projections",
    detail:
      "Night results and notices are delivered to you alone.",
    count: 2,
  });
  assert.deepEqual(buildPrivateQueue(snapshot), [
    {
      id: "notification-1",
      kind: "notification",
      label: "Commuted",
      value: "Delivered",
      detail: "Phase N02",
      buttonLabel: "Review",
    },
    {
      id: "investigation-1",
      kind: "investigation-result",
      label: "tracker",
      value: "Result for slot-4",
      detail: "Target slot-4",
      buttonLabel: "Review",
    },
  ]);
  assert.deepEqual(
    buildPrivateQueueRouteItems(snapshot, { game: "midsummer", channel: "private:role_pm:slot-7" }).map(
      (item) => [item.id, item.reviewHref],
    ),
    [
      ["notification-1", "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1"],
      ["investigation-1", "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=investigation-1"],
    ],
  );
});

test("player route data exposes no older pager when the server returns the oldest page", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    fetchImpl: async (url) => {
      if (url.includes("/thread?")) {
        return jsonResponse({
          next_before_seq: null,
          posts: [],
        });
      }
      return { ok: false };
    },
  });

  assert.equal(data.thread.nextBeforeSeq, null);
  assert.deepEqual(data.threadPager, {
    pageSize: 50,
    hasOlder: false,
    nextBeforeSeq: null,
    channel: "main",
    olderEndpoint: null,
  });
});

test("player thread pagination merges older pages oldest-to-newest without duplicates", () => {
  const merged = mergeThreadPage(
    {
      nextBeforeSeq: 441,
      posts: [
        { seq: 442, body: "current 442" },
        { seq: 443, body: "current 443" },
      ],
    },
    {
      nextBeforeSeq: 300,
      posts: [
        { seq: 440, body: "older 440" },
        { seq: 442, body: "stale duplicate" },
      ],
    },
  );

  assert.deepEqual(merged, {
    nextBeforeSeq: 300,
    posts: [
      { seq: 440, body: "older 440" },
      { seq: 442, body: "current 442" },
      { seq: 443, body: "current 443" },
    ],
  });
  assert.deepEqual(threadPageStatusForResult(1), {
    state: "ack",
    message: "Loaded 1 older post",
  });
  assert.deepEqual(threadPageStatusForResult(2), {
    state: "ack",
    message: "Loaded 2 older posts",
  });
});

test("player route data exposes only channels granted to the session", async () => {
  const rolePmData = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
      { kind: "DeadViewer", game: "midsummer" },
    ],
  });

  assert.equal(rolePmData.access.allowed, true);
  assert.deepEqual(
    rolePmData.channels.map((channel) => channel.id),
    ["private:role_pm:slot-7", "dead"],
  );

  const slotData = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "other", channel: "private:role_pm:slot-7" },
      { kind: "DeadViewer", game: "other" },
    ],
  });

  assert.deepEqual(
    slotData.channels.map((channel) => channel.id),
    ["main"],
  );
});

test("player load rejects sessions without scoped read/play capability", async () => {
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer" },
        locals: {
          principalUserId: "host_other",
          resolvedCapabilities: [{ kind: "HostOf", game: "other" }],
        },
        fetch: async () => ({ ok: false }),
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === playerForbiddenMessage("midsummer"),
  );
});

test("player load renders pending replacement state for authenticated no-slot sessions", async () => {
  const data = await load({
    params: { game: "midsummer" },
    locals: {
      principalUserId: "player-rowan",
      resolvedCapabilities: [],
    },
    fetch: async () => {
      throw new Error("pending replacement route must not fetch scoped projections");
    },
  });

  assert.equal(data.shell.activeSurface, "player");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.access.allowed, true);
  assert.equal(data.access.pending, true);
  assert.equal(data.access.capabilityLabel, "PendingReplacement(midsummer)");
  assert.equal(data.pendingReplacement, true);
  assert.equal(data.player.principalUserId, "player-rowan");
  assert.equal(data.player.slotId, "slot-7");
  assert.equal(data.player.status, "pending_replacement");
  assert.equal(data.commandState.actorStatus, "pending_replacement");
  assert.equal(data.commandState.actions.length, 0);
  assert.deepEqual(data.thread.posts, []);
  assert.deepEqual(data.votecount, []);
  assert.deepEqual(data.channels, []);
  assert.equal(data.coldLoad.commandStateEndpoint, null);
  assert.equal(
    data.emptyState.message,
    "Replacement invite accepted. Slot authority is pending host replacement; refresh this role URL after the host processes the replacement.",
  );
});

test("player load rejects signed-out sessions without private scoped requests", async () => {
  const seen = [];
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer" },
        locals: {
          principalUserId: null,
          resolvedCapabilities: [],
        },
        fetch: async (url) => {
          seen.push(String(url));
          return { ok: false };
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === playerForbiddenMessage("midsummer"),
  );
  assert.deepEqual(seen, [
    "/games/midsummer/thread?limit=50",
    "/games/midsummer/votecount",
    "/games/midsummer/day-vote-outcomes",
    "/games/midsummer/endgame-summary",
  ]);
});

test("player load accepts channel membership scoped to the game", async () => {
  const data = await load({
    params: { game: "midsummer" },
    locals: {
      principalUserId: "reader_a",
      resolvedCapabilities: [
        { kind: "ChannelMember", game: "midsummer", channel: "main" },
      ],
    },
    fetch: async () => ({ ok: false }),
  });

  assert.equal(data.shell.activeSurface, "player");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.access.capabilityLabel, "ChannelMember(midsummer)");
});

test("player channel load exposes active channel route state from fixture query", async () => {
  const previousFixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  try {
    const data = await loadChannelRoute({
      params: { game: "midsummer", channel: "private:role_pm:slot-7" },
      locals: {
        principalUserId: "player_mira",
        resolvedCapabilities: [
          { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
          { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
        ],
      },
      fetch: async () => ({ ok: false }),
      url: new URL(
        `https://fmarch.local/g/midsummer/c/private%3Arole_pm%3Aslot-7?${APP_ROUTE_STATE_CONTRACT.fixtureQueryParam}=loading`,
      ),
    });

    assert.equal(data.shell.activeSurface, "player");
    assert.equal(data.shellOwner, "layout");
    assert.equal(data.channel.channel, "private:role_pm:slot-7");
    assert.equal(data.channel.allowed, true);
    assert.equal(data.threadPager.channel, "private:role_pm:slot-7");
    assert.deepEqual(data.routeState, {
      surface: "player",
      state: "loading",
      message: null,
      actionHref: null,
    });
    assert.equal(
      data.privateQueue[0].reviewHref,
      "/g/midsummer/c/private%3Arole_pm%3Aslot-7?private=notification-1",
    );
  } finally {
    if (previousFixtureMode === undefined) {
      delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
    } else {
      process.env.FMARCH_FRONTEND_FIXTURE_SESSION = previousFixtureMode;
    }
  }
});

test("player main route rejects dead-viewer access without main-channel authority", async () => {
  await assert.rejects(
    load({
      params: { game: "midsummer" },
      locals: {
        principalUserId: "dead_reader",
        resolvedCapabilities: [{ kind: "DeadViewer", game: "midsummer" }],
      },
      fetch: async () => ({ ok: false }),
    }),
    (err) =>
      err.status === 403 &&
      err.body.message ===
        playerChannelForbiddenMessage({ game: "midsummer", channel: "main" }),
  );
});

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
