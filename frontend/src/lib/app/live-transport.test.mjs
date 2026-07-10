import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLiveProjectionUrl,
  connectLiveProjection,
  liveProjectionStatusForEvent,
  normalizeServerEnvelopeMessage,
  projectionPatchForLiveEnvelope,
  recoverLiveProjection,
  resolveWebSocketUrl,
} from "./live-transport.mjs";

test("builds websocket URLs from API bases and relative app origins", () => {
  assert.equal(
    buildLiveProjectionUrl({
      apiBaseUrl: "http://127.0.0.1:4100",
      game: "00000000-0000-0000-0000-000000000001",
      principalUserId: "player-mira",
    }),
    "ws://127.0.0.1:4100/ws?game=00000000-0000-0000-0000-000000000001&principal_user_id=player-mira",
  );
  assert.equal(
    buildLiveProjectionUrl({
      game: "midsummer",
      principalUserId: "player-mira",
    }),
    "/ws?game=midsummer&principal_user_id=player-mira",
  );
  assert.equal(
    buildLiveProjectionUrl({
      game: "midsummer",
      principalUserId: "host_h",
      slotId: "slot-7",
    }),
    "/ws?game=midsummer&principal_user_id=host_h&slot_id=slot-7",
  );
  assert.equal(
    resolveWebSocketUrl("/ws?game=midsummer", "https://app.example/g/midsummer"),
    "wss://app.example/ws?game=midsummer",
  );
});

test("normalizes tagged server envelopes", () => {
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 0,
      body: { kind: "Hello", body: { protocol_v: 1, caps: [] } },
    }),
    { kind: "hello", body: { protocol_v: 1, caps: [] } },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 1,
      body: {
        kind: "Delta",
        body: {
          kind: "VoteCountChanged",
          body: {
            candidate_slot: "slot-2",
            count: 1,
          },
        },
      },
    }),
    {
      kind: "delta",
      delta: {
        kind: "VoteCountChanged",
        body: { candidate_slot: "slot-2", count: 1 },
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 2,
      body: {
        kind: "Delta",
        body: {
          kind: "ResyncRequired",
          body: { from_seq: 44 },
        },
      },
    }),
    { kind: "resync-required", fromSeq: 44 },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 3,
      body: {
        kind: "Delta",
        body: {
          kind: "HostConsoleStateChanged",
          body: {
            phase: { phase_id: "D01", locked: true },
            slots: [],
            thread_posts: [],
          },
        },
      },
    }),
    {
      kind: "delta",
      delta: {
        kind: "HostConsoleStateChanged",
        body: {
          phase: { phase_id: "D01", locked: true },
          slots: [],
          thread_posts: [],
        },
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 4,
      body: {
        kind: "Delta",
        body: {
          kind: "HostPromptsChanged",
          body: {
            game: "midsummer",
            prompts: [{ prompt_id: "D01:skip_next_day:slot_1" }],
          },
        },
      },
    }),
    {
      kind: "delta",
      delta: {
        kind: "HostPromptsChanged",
        body: {
          game: "midsummer",
          prompts: [{ prompt_id: "D01:skip_next_day:slot_1" }],
        },
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 5,
      body: {
        kind: "Delta",
        body: {
          kind: "ThreadPostsChanged",
          body: {
            game: "midsummer",
            posts: [{ source_seq: 44, body: "Official votecount" }],
          },
        },
      },
    }),
    {
      kind: "delta",
      delta: {
        kind: "ThreadPostsChanged",
        body: {
          game: "midsummer",
          posts: [{ source_seq: 44, body: "Official votecount" }],
        },
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 1,
      id: 6,
      body: {
        kind: "Delta",
        body: {
          kind: "DayVoteOutcomeApplied",
          body: {
            phase_id: "D01",
            status: "Lynch",
            winner_slot: "slot-2",
          },
        },
      },
    }),
    {
      kind: "delta",
      delta: {
        kind: "DayVoteOutcomeApplied",
        body: {
          phase_id: "D01",
          status: "Lynch",
          winner_slot: "slot-2",
        },
      },
    },
  );
});

test("creates votecount patches from live delta envelopes", () => {
  const patch = projectionPatchForLiveEnvelope(
    {
      v: 1,
      id: 1,
      body: {
        kind: "Delta",
        body: {
          kind: "VoteCountChanged",
          body: {
            candidate_slot: "slot-2",
            count: 2,
          },
        },
      },
    },
    {
      votecount: [{ target: "slot-2", count: 1, needed: 7 }],
    },
  );

  assert.deepEqual(patch, {
    votecount: [{ target: "slot-2", count: 2, needed: 7 }],
  });
});

test("creates votecount removal patches from live clear envelopes", () => {
  const patch = projectionPatchForLiveEnvelope(
    {
      v: 1,
      id: 2,
      body: {
        kind: "Delta",
        body: {
          kind: "VoteCountCleared",
          body: {
            candidate_slot: "slot-2",
          },
        },
      },
    },
    {
      votecount: [
        { target: "slot-2", count: 1, needed: 7 },
        { target: "slot-3", count: 1, needed: 7 },
      ],
    },
  );

  assert.deepEqual(patch, {
    votecount: [{ target: "slot-3", count: 1, needed: 7 }],
  });
});

test("creates thread patches from live thread post delta envelopes", () => {
  const patch = projectionPatchForLiveEnvelope(
    {
      v: 1,
      id: 3,
      body: {
        kind: "Delta",
        body: {
          kind: "ThreadPostsChanged",
          body: {
            posts: [
              {
                source_seq: 43,
                stream_seq: 9,
              author_user: "host",
              body: "Official votecount for D01",
              occurred_at: 1781928000,
              media: [
                {
                  id: "official-count-card",
                  kind: "image",
                  variants: {
                    tablet: {
                      url: "/media/tablet/official-count-card.jpg",
                      width: 960,
                    },
                    original: {
                      url: "/media/original/official-count-card.jpg",
                      width: 4000,
                    },
                  },
                },
              ],
            },
          ],
        },
        },
      },
    },
    {
      thread: {
        nextBeforeSeq: 40,
        posts: [{ seq: 42, body: "before", authorLabel: "Mira" }],
      },
    },
  );

  assert.equal(patch.thread.nextBeforeSeq, 40);
  assert.deepEqual(
    patch.thread.posts.map((post) => [post.seq, post.authorLabel, post.body]),
    [
      [42, "Mira", "before"],
      [43, "host", "Official votecount for D01"],
    ],
  );
  assert.equal(
    patch.thread.posts[1].media[0].variants.tablet.url,
    "/media/tablet/official-count-card.jpg",
  );
  assert.equal(
    patch.thread.posts[1].media[0].variants.original.url,
    "/media/original/official-count-card.jpg",
  );
});

test("recovers live projections by refreshing registered cold-load keys", async () => {
  const store = fakeProjectionStore({
    votecount: [{ target: "slot-2", count: 1, needed: 7 }],
  });

  const recovery = await recoverLiveProjection({
    projectionStore: store,
    resyncKeys: ["votecount"],
    fetchImpl: async () => jsonResponse([{ target: "slot-2", count: 3, needed: 7 }]),
    message: { kind: "resync-required", fromSeq: 9 },
  });

  assert.deepEqual(store.refreshCalls, [
    { keys: ["votecount"], hasFetchImpl: true },
  ]);
  assert.deepEqual(recovery.message, {
    kind: "resync-required",
    fromSeq: 9,
    state: "recovered",
  });
  assert.deepEqual(recovery.snapshot.votecount, [
    { target: "slot-2", count: 3, needed: 7 },
  ]);
});

test("websocket resync frames refresh the projection store", async () => {
  const events = [];
  const store = fakeProjectionStore({
    votecount: [{ target: "slot-2", count: 1, needed: 7 }],
  });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async () => jsonResponse([{ target: "slot-2", count: 4, needed: 7 }]),
    resyncKeys: ["votecount"],
    onEvent(message, snapshot) {
      events.push({ message, snapshot });
    },
  });

  await FakeWebSocket.last.emit("message", {
    data: JSON.stringify({
      v: 1,
      id: 9,
      body: {
        kind: "Delta",
        body: {
          kind: "ResyncRequired",
          body: { from_seq: 8 },
        },
      },
    }),
  });

  assert.deepEqual(events.at(-1).message, {
    kind: "resync-required",
    fromSeq: 8,
    state: "recovered",
  });
  assert.deepEqual(events.at(-1).snapshot.votecount, [
    { target: "slot-2", count: 4, needed: 7 },
  ]);
  connection.close();
});

test("back-to-back websocket resync frames collapse to one trailing refresh", async () => {
  const events = [];
  const refreshes = [];
  const store = {
    snapshot: { generation: 0 },
    getSnapshot() {
      return this.snapshot;
    },
    applyLiveEnvelope() {
      return this.snapshot;
    },
    async refresh(keys) {
      const pending = deferred();
      refreshes.push({ keys, pending });
      this.snapshot = await pending.promise;
      return this.snapshot;
    },
  };
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async () => jsonResponse({}),
    resyncKeys: ["thread", "commandState"],
    onEvent(message, snapshot) {
      events.push({ message, snapshot });
    },
  });

  const first = FakeWebSocket.last.emit("message", {
    data: JSON.stringify(resyncEnvelope(8, 9)),
  });
  await Promise.resolve();
  assert.equal(refreshes.length, 1);

  const second = FakeWebSocket.last.emit("message", {
    data: JSON.stringify(resyncEnvelope(9, 10)),
  });
  const third = FakeWebSocket.last.emit("message", {
    data: JSON.stringify(resyncEnvelope(10, 11)),
  });
  assert.equal(refreshes.length, 1);

  refreshes[0].pending.resolve({ generation: 1 });
  await waitFor(() => refreshes.length === 2);
  refreshes[1].pending.resolve({ generation: 3 });
  await Promise.all([first, second, third]);

  assert.equal(refreshes.length, 2);
  assert.deepEqual(
    refreshes.map((refresh) => refresh.keys),
    [
      ["thread", "commandState"],
      ["thread", "commandState"],
    ],
  );
  assert.deepEqual(
    events.map(({ message, snapshot }) => ({ message, snapshot })),
    [
      {
        message: { kind: "resync-required", fromSeq: 8, state: "recovered" },
        snapshot: { generation: 1 },
      },
      {
        message: { kind: "resync-required", fromSeq: 10, state: "recovered" },
        snapshot: { generation: 3 },
      },
    ],
  );
  assert.deepEqual(store.getSnapshot(), { generation: 3 });
  connection.close();
});

test("resync completion from a dropped websocket cannot publish stale state", async () => {
  const events = [];
  const pending = deferred();
  const store = {
    getSnapshot: () => ({ generation: 0 }),
    applyLiveEnvelope: () => ({ generation: 0 }),
    refresh: async () => await pending.promise,
  };
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async () => jsonResponse({}),
    resyncKeys: ["thread"],
    reconnect: false,
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });
  const recovery = FakeWebSocket.last.emit("message", {
    data: JSON.stringify(resyncEnvelope(12, 13)),
  });
  await Promise.resolve();
  connection.drop();
  pending.resolve({ generation: 12 });
  await recovery;

  assert.deepEqual(events, [{ message: { kind: "close" }, snapshot: null }]);
});

test("websocket delta frames can refresh dependent cold-load keys", async () => {
  const store = fakeProjectionStore({
    thread: { posts: [] },
    commandState: { actions: ["old-action"] },
  });
  const events = [];
  connectLiveProjection({
    url: "ws://example.test/ws",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (url) =>
      jsonResponse(
        url === "/player-command-state"
          ? { actions: ["fresh-action"] }
          : { posts: [] },
      ),
    refreshKeysForEvent: (message) =>
      message?.kind === "delta" ? ["commandState"] : [],
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await FakeWebSocket.last.emit("message", {
    data: JSON.stringify({
      v: 1,
      id: 7,
      body: {
        kind: "Delta",
        body: {
          kind: "ThreadPostsChanged",
          body: {
            posts: [{ source_seq: 77, author_user: "host", body: "Dawn" }],
          },
        },
      },
    }),
  });

  assert.deepEqual(store.refreshed, [["commandState"]]);
  assert.deepEqual(store.getSnapshot().commandState, { actions: ["fresh-action"] });
  assert.equal(events.at(-1).message.delta.kind, "ThreadPostsChanged");
  assert.equal(events.at(-1).snapshot.commandState.actions[0], "fresh-action");
});

test("websocket close schedules reconnect and refreshes projections on reopen", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({
    thread: { posts: [] },
  });

  connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async () =>
      jsonResponse({ posts: [{ seq: 30, body: "missed while disconnected" }] }),
    resyncKeys: ["thread"],
    reconnectDelayMs: 42,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await FakeWebSocket.instances[0].emit("close");

  assert.deepEqual(events.map((event) => event.message), [
    { kind: "close" },
    { kind: "reconnecting", attempt: 1 },
  ]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 42);

  scheduled[0].callback();
  assert.equal(FakeWebSocket.instances.length, 2);
  await FakeWebSocket.instances[1].emit("open");

  assert.deepEqual(events.at(-1).message, {
    kind: "reconnect",
    attempt: 1,
    state: "recovered",
  });
  assert.deepEqual(events.at(-1).snapshot.thread, {
    posts: [{ seq: 30, body: "missed while disconnected" }],
  });
  assert.deepEqual(store.refreshed, [["thread"]]);
});

test("intentional websocket close does not schedule reconnect", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: fakeProjectionStore({
      thread: { posts: [] },
    }),
    WebSocketCtor: FakeWebSocket,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  connection.close();
  await FakeWebSocket.instances[0].emit("close");

  assert.equal(scheduled.length, 0);
  assert.deepEqual(events.map((event) => event.message), [{ kind: "close" }]);
});

test("transport drop enters reconnect immediately and ignores duplicate close events", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: fakeProjectionStore({
      thread: { posts: [] },
    }),
    WebSocketCtor: FakeWebSocket,
    reconnectDelayMs: 5,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  connection.drop();
  await FakeWebSocket.instances[0].emit("close");

  assert.deepEqual(events.map((event) => event.message), [
    { kind: "close" },
    { kind: "reconnecting", attempt: 1 },
  ]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 5);
});

test("transport drop ignores late messages from the invalidated socket", async () => {
  FakeWebSocket.instances = [];
  const events = [];
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: fakeProjectionStore({
      thread: { posts: [] },
    }),
    WebSocketCtor: FakeWebSocket,
    scheduleReconnect: () => 1,
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  const droppedSocket = FakeWebSocket.instances[0];
  connection.drop();
  await droppedSocket.emit("message", {
    data: JSON.stringify({
      v: 1,
      id: 30,
      body: {
        kind: "Delta",
        body: {
          kind: "ThreadPostsChanged",
          body: {
            posts: [{ source_seq: 30, body: "late stale delta" }],
          },
        },
      },
    }),
  });

  assert.deepEqual(events.map((event) => event.message), [
    { kind: "close" },
    { kind: "reconnecting", attempt: 1 },
  ]);
});

test("live projection events map to visible status copy", () => {
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "open" }), {
    state: "connected",
    message: "Live projection socket open",
  });
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "delta",
      delta: { kind: "VoteCountChanged", body: {} },
    }),
    {
      state: "updated",
      message: "Live projection updated: VoteCountChanged",
    },
  );
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "resync-required",
      fromSeq: 44,
      state: "recovered",
    }),
    {
      state: "recovered",
      message: "Live projection resynced from 44",
    },
  );
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "reconnecting",
      attempt: 1,
    }),
    {
      state: "reconnecting",
      message: "Live projection reconnecting",
    },
  );
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "reconnect",
      attempt: 1,
      state: "recovered",
    }),
    {
      state: "recovered",
      message: "Live projection reconnected",
    },
  );
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "error", message: "boom" }), {
    state: "error",
    message: "Live projection error: boom",
  });
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "close" }), {
    state: "closed",
    message: "Live projection closed",
  });
});

class FakeWebSocket {
  static last = null;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeWebSocket.last = this;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(kind, listener) {
    this.listeners.set(kind, listener);
  }

  async emit(kind, event = {}) {
    await this.listeners.get(kind)?.(event);
  }

  close() {
    this.closed = true;
  }
}

function fakeProjectionStore(initialSnapshot) {
  return {
    snapshot: initialSnapshot,
    refreshCalls: [],
    refreshed: [],
    getSnapshot() {
      return this.snapshot;
    },
    applyLiveEnvelope(envelope) {
      const body = envelope?.body?.body;
      if (body?.kind === "ThreadPostsChanged") {
        this.snapshot = {
          ...this.snapshot,
          thread: { posts: body.body?.posts ?? [] },
        };
      }
      return this.snapshot;
    },
    async refresh(keys, { fetchImpl } = {}) {
      this.refreshCalls.push({ keys, hasFetchImpl: typeof fetchImpl === "function" });
      this.refreshed.push(keys);
      const patches = {};
      for (const key of keys) {
        const url = key === "commandState" ? "/player-command-state" : `/${key}`;
        const response = await fetchImpl(url);
        patches[key] = await response.json();
      }
      this.snapshot = { ...this.snapshot, ...patches };
      return this.snapshot;
    },
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("condition did not settle");
}

function resyncEnvelope(fromSeq, id) {
  return {
    v: 1,
    id,
    body: {
      kind: "Delta",
      body: {
        kind: "ResyncRequired",
        body: { from_seq: fromSeq },
      },
    },
  };
}
