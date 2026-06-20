import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAYER_POSTURE_STRIP_CONTRACT,
  buildPlayerPostureStripViewModel,
} from "./player-posture-strip-model.mjs";

test("player posture strip summarizes channel thread votecount and private posture", () => {
  const view = buildPlayerPostureStripViewModel({
    channel: {
      label: "Main thread",
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
      supported: true,
      allowed: true,
    },
    projectionBoundary: {
      status: "json-ws-command-projection-deltas-with-resync",
    },
    threadPager: {
      hasOlder: true,
      olderEndpoint: "/games/midsummer/thread?limit=50&before_seq=441",
      channel: "main",
    },
    votecount: [
      { target: "slot-2 / Ilya", count: 4, needed: 7 },
      { target: "slot-7 / Mira", count: 2, needed: 7 },
    ],
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 2,
    },
  });

  assert.equal(view.root.className, PLAYER_POSTURE_STRIP_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "player-posture-strip");
  assert.deepEqual(
    view.items.map((item) => [
      item.id,
      item.value,
      item.detail,
      item.status.state,
      item.testId,
      item.statusTestId,
    ]),
    [
      [
        "channel",
        "Main thread",
        "SlotOccupant or ChannelMember(main)",
        "ack",
        "player-posture-channel",
        "player-posture-status-channel",
      ],
      [
        "thread",
        "Older posts available",
        "/games/midsummer/thread?limit=50&before_seq=441",
        "pending",
        "player-posture-thread",
        "player-posture-status-thread",
      ],
      [
        "votecount",
        "2 projected targets",
        "json-ws-command-projection-deltas-with-resync",
        "ack",
        "player-posture-votecount",
        "player-posture-status-votecount",
      ],
      [
        "private",
        "2 private items",
        "principal-scoped-private-projections",
        "pending",
        "player-posture-private",
        "player-posture-status-private",
      ],
    ],
  );
});

test("player posture strip avoids host-only copy in private status", () => {
  const view = buildPlayerPostureStripViewModel({
    channel: {
      label: "Role PM",
      capabilityLabel: "ChannelMember(role-pm)",
      supported: true,
      allowed: true,
    },
    projectionBoundary: {
      status: "json-ws-command-projection-deltas-with-resync",
    },
    threadPager: {
      hasOlder: false,
      olderEndpoint: null,
      channel: "role-pm",
    },
    votecount: [],
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 0,
    },
  });

  assert.deepEqual(
    view.items.map((item) => [item.id, item.status.state, item.status.message]),
    [
      ["channel", "ack", "Channel capability resolved"],
      ["thread", "ack", "Loaded thread is at oldest post"],
      ["votecount", "pending", "No active projected ballots"],
      ["private", "ack", "No private items visible"],
    ],
  );
  const allCopy = view.items
    .flatMap((item) => [item.label, item.value, item.detail, item.status.message])
    .join(" ");
  assert.doesNotMatch(allCopy, /host|moderator|prompt/i);
});

test("player posture strip rejects unsupported or denied channels", () => {
  assert.equal(
    buildPlayerPostureStripViewModel({
      channel: { supported: false, allowed: false },
    }).items[0].status.state,
    "reject",
  );
  assert.equal(
    buildPlayerPostureStripViewModel({
      channel: { supported: true, allowed: false },
    }).items[0].status.message,
    "Channel requires scoped capability",
  );
});
