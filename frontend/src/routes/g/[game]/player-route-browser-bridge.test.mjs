import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exposePlayerCommandReceipts,
  exposePlayerCommandDispatchBridgePlan,
  exposePlayerCommandStatus,
  exposePlayerProjection,
  exposePlayerThreadPageStatus,
  recordPlayerLiveProjectionEvent,
  triggerPlayerLiveProjectionResync,
} from "./player-route-browser-bridge.mjs";

test("player browser bridge records live projection events and latest snapshot", () => {
  const windowRef = {
    __fmarchLiveProjectionEvents: [{ kind: "open" }],
  };
  const snapshot = {
    thread: { posts: [{ seq: 4, body: "hello" }] },
    votecount: [{ target: "slot-2" }],
  };

  const liveStatus = recordPlayerLiveProjectionEvent({
    windowRef,
    message: { kind: "delta", delta: { kind: "ThreadPostsChanged" } },
    snapshot,
    currentStatus: { state: "connected", message: "open" },
    statusForEvent: (message) => ({
      state: "updated",
      message: `saw ${message.delta.kind}`,
    }),
  });

  assert.deepEqual(liveStatus, {
    state: "updated",
    message: "saw ThreadPostsChanged",
  });
  assert.deepEqual(windowRef.__fmarchLiveProjectionEvents, [
    { kind: "open" },
    { kind: "delta", delta: { kind: "ThreadPostsChanged" } },
  ]);
  assert.equal(windowRef.__fmarchLiveProjectionStatus, liveStatus);
  assert.equal(windowRef.__fmarchPlayerProjection, snapshot);
});

test("player browser bridge preserves player projection for null live snapshots", () => {
  const projection = { thread: { posts: [] } };
  const windowRef = {
    __fmarchPlayerProjection: projection,
  };

  recordPlayerLiveProjectionEvent({
    windowRef,
    message: { kind: "close" },
    snapshot: null,
    currentStatus: { state: "updated", message: "updated" },
    statusForEvent: () => ({ state: "closed", message: "closed" }),
  });

  assert.equal(windowRef.__fmarchPlayerProjection, projection);
  assert.deepEqual(windowRef.__fmarchLiveProjectionEvents, [{ kind: "close" }]);
});

test("player browser bridge triggers manual live resync through the store adapter", async () => {
  const calls = [];
  const windowRef = {};
  const projectionStore = { id: "store" };
  const fetchImpl = async () => null;
  const snapshot = {
    thread: { posts: [{ seq: 10, body: "resynced" }] },
    votecount: [],
  };

  const result = await triggerPlayerLiveProjectionResync({
    windowRef,
    projectionStore,
    resyncKeys: ["thread", "votecount"],
    fetchImpl,
    fromSeq: 99,
    currentStatus: { state: "updated", message: "before" },
    recoverLiveProjectionImpl: async (request) => {
      calls.push(request);
      return {
        message: { kind: "resync-required", fromSeq: 99, state: "recovered" },
        snapshot,
      };
    },
    statusForEvent: (message, previous) => ({
      state: message.state,
      message: `${previous.state}:${message.fromSeq}`,
    }),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectionStore, projectionStore);
  assert.deepEqual(calls[0].resyncKeys, ["thread", "votecount"]);
  assert.equal(calls[0].fetchImpl, fetchImpl);
  assert.deepEqual(calls[0].message, {
    kind: "resync-required",
    fromSeq: 99,
  });
  assert.deepEqual(result.liveStatus, {
    state: "recovered",
    message: "updated:99",
  });
  assert.equal(result.snapshot, snapshot);
  assert.equal(windowRef.__fmarchPlayerProjection, snapshot);
  assert.deepEqual(windowRef.__fmarchLiveProjectionEvents, [
    { kind: "resync-required", fromSeq: 99, state: "recovered" },
  ]);
});

test("player browser bridge exposes command and thread paging status", () => {
  const windowRef = {};
  const commandStatus = { state: "ack", message: "posted" };
  const commandReceipts = [
    { actionId: "submit_post", state: "ack", message: "posted", current: true },
  ];
  const threadPageStatus = { state: "ack", message: "Loaded older posts" };
  const snapshot = { thread: { posts: [] }, votecount: [] };

  assert.equal(
    exposePlayerCommandStatus({ windowRef, commandStatus }),
    true,
  );
  assert.equal(
    exposePlayerCommandReceipts({ windowRef, commandReceipts }),
    true,
  );
  assert.equal(
    exposePlayerThreadPageStatus({ windowRef, threadPageStatus }),
    true,
  );
  assert.equal(
    exposePlayerCommandDispatchBridgePlan({
      windowRef,
      plan: { role: "player", commandKind: "SubmitVote" },
    }),
    true,
  );
  assert.equal(exposePlayerProjection({ windowRef, snapshot }), true);
  assert.equal(windowRef.__fmarchPlayerCommandStatus, commandStatus);
  assert.equal(windowRef.__fmarchPlayerCommandReceipts, commandReceipts);
  assert.equal(windowRef.__fmarchPlayerThreadPageStatus, threadPageStatus);
  assert.deepEqual(windowRef.__fmarchPlayerCommandDispatchBridgePlan, {
    role: "player",
    commandKind: "SubmitVote",
  });
  assert.equal(windowRef.__fmarchPlayerProjection, snapshot);
});

test("player browser bridge tolerates missing window refs", () => {
  assert.equal(
    exposePlayerCommandStatus({
      windowRef: null,
      commandStatus: { state: "ack" },
    }),
    false,
  );
  assert.equal(
    exposePlayerCommandReceipts({
      windowRef: null,
      commandReceipts: [],
    }),
    false,
  );
  assert.equal(
    exposePlayerThreadPageStatus({
      windowRef: undefined,
      threadPageStatus: { state: "ack" },
    }),
    false,
  );
  assert.equal(
    exposePlayerCommandDispatchBridgePlan({
      windowRef: undefined,
      plan: { role: "player" },
    }),
    false,
  );
  assert.equal(
    exposePlayerProjection({
      windowRef: undefined,
      snapshot: { thread: { posts: [] } },
    }),
    false,
  );
  assert.deepEqual(
    recordPlayerLiveProjectionEvent({
      windowRef: null,
      message: { kind: "open" },
      snapshot: null,
      currentStatus: { state: "connecting" },
      statusForEvent: () => ({ state: "connected" }),
    }),
    { state: "connected" },
  );
});
