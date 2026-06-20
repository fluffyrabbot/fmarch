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
    requiredText: "Votecount",
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
    data.thread.posts[0].media[0].variants.tablet.url,
    "/media/midsummer/thread/receipt-442-tablet.jpg",
  );
  assert.equal(
    data.thread.posts[0].media[0].variants.original.url,
    "/media/midsummer/thread/receipt-442-original.jpg",
  );
  assert.equal(data.composer.voteCommandLabel, "Vote slot-2");
  assert.equal(data.coldLoad.threadEndpoint, "/games/midsummer/thread?limit=50");
  assert.equal(
    data.coldLoad.notificationsEndpoint,
    "/games/midsummer/notifications?principal_user_id=player_mira",
  );
  assert.equal(
    data.coldLoad.investigationResultsEndpoint,
    "/games/midsummer/investigation-results?principal_user_id=player_mira",
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
    data.liveProjection.endpoint,
    "/ws?game=midsummer&principal_user_id=player_mira",
  );
  assert.equal(data.projectionBoundary.status, "json-ws-command-projection-deltas-with-resync");
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
  assert.equal(data.layout.root.data.mode, "tablet-three-zone-cockpit");
  assert.equal(data.layout.root.data.minTabletViewportPx, 1024);
  assert.equal(data.layout.root.data.collapseBelowPx, 960);
  assert.deepEqual(data.layout.commandRail, {
    className: "player-surface__command-stack",
    data: {
      mode: "sticky-tablet-command-rail",
      stickyTopPx: 22,
      unstickBelowPx: 960,
      stabilityMode: "primary-controls-before-live-receipts",
    },
  });
  assert.deepEqual(data.layout.regions, ["channels", "thread", "commands"]);
});

test("player route data marks active private channel access without host data", async () => {
  const data = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "role-pm",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
    ],
  });

  assert.equal(data.access.allowed, true);
  assert.deepEqual(data.channel, {
    channel: "role-pm",
    supported: true,
    allowed: true,
    label: "Role PM",
    capabilityLabel: "ChannelMember(role-pm)",
    href: "/g/midsummer/c/role-pm",
  });
  assert.deepEqual(data.channels, [
    {
      id: "role-pm",
      label: "Role PM",
      href: "/g/midsummer/c/role-pm",
      active: true,
      capabilityLabel: "ChannelMember(role-pm)",
    },
  ]);
  assert.equal(
    data.coldLoad.threadEndpoint,
    "/games/midsummer/channels/role-pm/thread?limit=50&principal_user_id=player_mira",
  );
  assert.equal(
    data.threadPager.olderEndpoint,
    "/games/midsummer/channels/role-pm/thread?limit=50&before_seq=441&principal_user_id=player_mira",
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
    activeChannel: "role-pm",
    privateItem: "investigation-1",
    principalUserId: "player_mira",
    capabilities: [{ kind: "ChannelMember", game: "midsummer", channel: "role-pm" }],
  });
  assert.deepEqual(rolePm.privateQueueExpandedItems, { "investigation-1": true });
  assert.equal(
    rolePm.privateQueue[1].reviewHref,
    "/g/midsummer/c/role-pm?private=investigation-1",
  );
});

test("player route data models unsupported and denied channel access", async () => {
  const unsupported = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "scum-chat",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
    ],
  });
  assert.equal(unsupported.channel.supported, false);
  assert.equal(playerChannelNotFoundMessage({
    game: "midsummer",
    channel: "scum-chat",
  }), "Game midsummer does not expose player channel scum-chat.");

  const denied = await buildGameRouteData({
    game: "midsummer",
    activeChannel: "role-pm",
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
    channel: "role-pm",
  }), "Game midsummer channel role-pm requires scoped channel capability.");
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
              attachments: [
                {
                  id: "server-receipt",
                  kind: "image",
                  alt: "Server receipt",
                  variants: {
                    small: { url: "/media/small/server-receipt.jpg", width: 480 },
                    original: {
                      url: "/media/original/server-receipt.jpg",
                      width: 4000,
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
      return { ok: false };
    },
  });

  assert.equal(data.thread.posts[0].body, "server thread post");
  assert.equal(
    data.thread.posts[0].media[0].variants.small.url,
    "/media/small/server-receipt.jpg",
  );
  assert.equal(
    data.thread.posts[0].media[0].variants.original.url,
    "/media/original/server-receipt.jpg",
  );
  assert.deepEqual(data.votecount, [{ target: "slot-2", count: 5, needed: 7 }]);
  assert.deepEqual(data.privateQueue, [
    {
      id: "notification-1",
      kind: "notification",
      label: "Neighborized",
      value: "Delivered",
      detail: "Principal-scoped notification",
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
      "Notifications and investigation results are loaded from principal-scoped endpoints only.",
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
    buildPrivateQueueRouteItems(snapshot, { game: "midsummer", channel: "role-pm" }).map(
      (item) => [item.id, item.reviewHref],
    ),
    [
      ["notification-1", "/g/midsummer/c/role-pm?private=notification-1"],
      ["investigation-1", "/g/midsummer/c/role-pm?private=investigation-1"],
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
      { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
      { kind: "DeadViewer", game: "midsummer" },
    ],
  });

  assert.equal(rolePmData.access.allowed, true);
  assert.deepEqual(
    rolePmData.channels.map((channel) => channel.id),
    ["role-pm", "dead"],
  );

  const slotData = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "other", channel: "role-pm" },
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
      params: { game: "midsummer", channel: "role-pm" },
      locals: {
        principalUserId: "player_mira",
        resolvedCapabilities: [
          { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
        ],
      },
      fetch: async () => ({ ok: false }),
      url: new URL(
        `https://fmarch.local/g/midsummer/c/role-pm?${APP_ROUTE_STATE_CONTRACT.fixtureQueryParam}=loading`,
      ),
    });

    assert.equal(data.shell.activeSurface, "player");
    assert.equal(data.shellOwner, "layout");
    assert.equal(data.channel.channel, "role-pm");
    assert.equal(data.channel.allowed, true);
    assert.equal(data.threadPager.channel, "role-pm");
    assert.deepEqual(data.routeState, {
      surface: "player",
      state: "loading",
      message: null,
      actionHref: null,
    });
    assert.equal(
      data.privateQueue[0].reviewHref,
      "/g/midsummer/c/role-pm?private=notification-1",
    );
  } finally {
    if (previousFixtureMode === undefined) {
      delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
    } else {
      process.env.FMARCH_FRONTEND_FIXTURE_SESSION = previousFixtureMode;
    }
  }
});

test("player load accepts dead-viewer access scoped to the game", async () => {
  const data = await load({
    params: { game: "midsummer" },
    locals: {
      principalUserId: "dead_reader",
      resolvedCapabilities: [
        { kind: "DeadViewer", game: "midsummer" },
      ],
    },
    fetch: async () => ({ ok: false }),
  });

  assert.equal(data.shell.activeSurface, "player");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.access.capabilityLabel, "DeadViewer(midsummer)");
  assert.deepEqual(data.channels.map((channel) => channel.id), ["dead"]);
});

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
