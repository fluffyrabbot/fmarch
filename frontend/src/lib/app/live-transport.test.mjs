import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attachLiveProjectionPageLifecycle,
  buildLiveProjectionUrl,
  connectLiveProjection,
  decodeServerEnvelopeFrame,
  encodeServerEnvelopeFrame,
  liveProjectionReconnectDelayMs,
  liveProjectionStatusForEvent,
  LIVE_PROJECTION_MAX_QUEUED_FRAMES,
  normalizeServerEnvelopeMessage,
  projectionPatchForLiveEnvelope,
  recoverAuthoritativeProjection,
  resolveWebSocketUrl,
  shouldWakeLiveProjection,
  validateLiveProjectionMessageScope,
} from "./live-transport.mjs";
import { createProjectionStore } from "./projection-store.mjs";

test("builds websocket URLs from API bases and relative app origins", () => {
  assert.equal(
    buildLiveProjectionUrl({
      game: "00000000-0000-0000-0000-000000000001",
    }),
    "/live/tickets?game=00000000-0000-0000-0000-000000000001",
  );
  assert.equal(
    buildLiveProjectionUrl({
      game: "midsummer",
    }),
    "/live/tickets?game=midsummer",
  );
  assert.equal(
    buildLiveProjectionUrl({
      game: "midsummer",
      slotId: "slot-7",
    }),
    "/live/tickets?game=midsummer&slot_id=slot-7",
  );
  assert.equal(
    buildLiveProjectionUrl({
      game: "midsummer",
      channel: "private:role_pm:slot-7",
    }),
    "/live/tickets?game=midsummer&channel=private%3Arole_pm%3Aslot-7",
  );
  assert.equal(
    resolveWebSocketUrl("/ws?game=midsummer", "https://app.example/g/midsummer"),
    "wss://app.example/ws?game=midsummer",
  );
});

test("protocol v3 binds exact Hello, delta, and resync frames to scope and audience", () => {
  const scope = { game: "midsummer", channel: "main", slotId: null };
  const hello = normalizeServerEnvelopeMessage(protocolHelloEnvelope({ caps: [] }));
  assert.deepEqual(hello, {
    kind: "hello",
    body: {
      protocol_v: 3,
      server: "fmarch-test",
      caps: [],
      scope,
    },
  });
  assert.equal(validateLiveProjectionMessageScope(hello, scope), true);

  const delta = normalizeServerEnvelopeMessage(
    deltaEnvelope("VoteCountChanged", canonicalVoteCountBody()),
  );
  assert.deepEqual(delta?.audience, { kind: "Game", game: "midsummer" });
  assert.equal(validateLiveProjectionMessageScope(delta, scope), true);

  const resync = normalizeServerEnvelopeMessage(resyncEnvelope(44, 2));
  assert.deepEqual(resync, {
    kind: "resync-required",
    scope,
    audiences: [{ kind: "Game", game: "midsummer" }],
    fromEventSeq: 44,
  });
  assert.equal(validateLiveProjectionMessageScope(resync, scope), true);

  assert.equal(normalizeServerEnvelopeMessage({
    ...protocolHelloEnvelope(),
    body: {
      ...protocolHelloEnvelope().body,
      body: {
        ...protocolHelloEnvelope().body.body,
        scope: { game: "midsummer", channel: "main", slotId: null },
      },
    },
  }), null, "wire scope rejects camelCase slotId");
  assert.equal(normalizeServerEnvelopeMessage({
    ...deltaEnvelope("VoteCountChanged", canonicalVoteCountBody()),
    body: {
      kind: "Delta",
      body: {
        audience: { Thread: { game: "midsummer", channel: "main" } },
        delta: { kind: "VoteCountChanged", body: canonicalVoteCountBody() },
      },
    },
  }), null, "audience-kind mismatch fails during decoding");
  assert.equal(normalizeServerEnvelopeMessage({
    ...resyncEnvelope(44, 2),
    body: {
      kind: "ResyncRequired",
      body: {
        scope: { game: "midsummer", channel: "main", slot_id: null },
        audiences: [
          { Game: { game: "midsummer" } },
          { Game: { game: "midsummer" } },
        ],
        from_event_seq: 44,
      },
    },
  }), null, "duplicate resync audiences fail during decoding");
});

test("normalizes tagged server envelopes", () => {
  const caps = [{ kind: "HostOf", body: { game: "midsummer" } }];
  assert.deepEqual(
    normalizeServerEnvelopeMessage({
      v: 3,
      id: 0,
      body: {
        kind: "Hello",
        body: {
          protocol_v: 3,
          server: "fmarch-test",
          caps,
          scope: { game: "midsummer", channel: "main", slot_id: null },
        },
      },
    }),
    {
      kind: "hello",
      body: {
        protocol_v: 3,
        server: "fmarch-test",
        caps,
        scope: { game: "midsummer", channel: "main", slotId: null },
      },
    },
  );
  assert.equal(
    // Deliberate legacy-v2 rejection coverage.
    normalizeServerEnvelopeMessage({
      v: 3,
      id: 0,
      body: { kind: "Hello", body: { protocol_v: 2, caps: [] } },
    }),
    null,
  );
  assert.equal(
    // A legacy-v2 Hello is rejected even when its envelope claims v3.
    normalizeServerEnvelopeMessage({
      v: 3,
      id: 1,
      body: {
        kind: "Hello",
        body: { protocol_v: 2, server: "fmarch-test", caps: [] },
      },
    }),
    null,
  );
  assert.equal(
    normalizeServerEnvelopeMessage({
      ...protocolHelloEnvelope(),
      extension: true,
    }),
    null,
  );
  assert.equal(
    normalizeServerEnvelopeMessage(
      protocolHelloEnvelope({
        caps: [{ kind: "HostOf", body: {} }],
      }),
    ),
    null,
  );
  for (const capability of [
    { kind: "SlotOccupant", body: { slot: "slot-7" } },
    { kind: "ChannelMember", body: { channel: "main" } },
  ]) {
    assert.equal(
      normalizeServerEnvelopeMessage(protocolHelloEnvelope({ caps: [capability] })),
      null,
      `${capability.kind} must carry its exact game scope`,
    );
  }
  assert.deepEqual(
    normalizeServerEnvelopeMessage(deltaEnvelope("VoteCountChanged", canonicalVoteCountBody())),
    {
      kind: "delta",
      audience: { kind: "Game", game: "midsummer" },
      delta: {
        kind: "VoteCountChanged",
        body: canonicalVoteCountBody(),
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage(resyncEnvelope(44, 2)),
    {
      kind: "resync-required",
      scope: { game: "midsummer", channel: "main", slotId: null },
      audiences: [{ kind: "Game", game: "midsummer" }],
      fromEventSeq: 44,
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage(deltaEnvelope("HostConsoleStateChanged", canonicalHostStateBody(), 3)),
    {
      kind: "delta",
      audience: { kind: "Host", game: "midsummer" },
      delta: {
        kind: "HostConsoleStateChanged",
        body: canonicalHostStateBody(),
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage(deltaEnvelope("HostPromptsChanged", {
      game: "midsummer",
      prompts: [{ prompt_id: "D01:skip_next_day:slot_1" }],
    }, 4)),
    {
      kind: "delta",
      audience: { kind: "Host", game: "midsummer" },
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
    normalizeServerEnvelopeMessage(deltaEnvelope("ThreadPostsChanged", {
      game: "midsummer",
      posts: [canonicalThreadPost({ source_seq: 44 })],
    }, 5)),
    {
      kind: "delta",
      audience: { kind: "Thread", game: "midsummer", channel: "main" },
      delta: {
        kind: "ThreadPostsChanged",
        body: {
          game: "midsummer",
          posts: [canonicalThreadPost({ source_seq: 44 })],
        },
      },
    },
  );
  assert.deepEqual(
    normalizeServerEnvelopeMessage(deltaEnvelope("DayVoteOutcomeApplied", canonicalDayVoteOutcome(), 6)),
    {
      kind: "delta",
      audience: { kind: "Game", game: "midsummer" },
      delta: {
        kind: "DayVoteOutcomeApplied",
        body: canonicalDayVoteOutcome(),
      },
    },
  );
});

test("rejects non-canonical delta bodies before they can become projection patches", () => {
  const malformed = [
    deltaEnvelope(
      "VoteCountChanged",
      canonicalVoteCountBody({ count: -1 }),
    ),
    deltaEnvelope("PostCitationsChanged", {
      quoted: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
      citation_count: -1,
    }),
    deltaEnvelope("VoteCountChanged", {
      ...canonicalVoteCountBody(),
      extension: true,
    }),
    {
      ...deltaEnvelope("VoteCountChanged", canonicalVoteCountBody()),
      body: {
        kind: "Delta",
        body: {
          kind: "VoteCountChanged",
          body: canonicalVoteCountBody(),
          VoteCountChanged: canonicalVoteCountBody(),
        },
      },
    },
    deltaEnvelope(
      "VoteCountChanged",
      canonicalVoteCountBody({ candidate_slot: " slot-2" }),
    ),
    deltaEnvelope(
      "VoteCountChanged",
      canonicalVoteCountBody({ count: Number.MAX_SAFE_INTEGER + 1 }),
    ),
  ];

  for (const envelope of malformed) {
    assert.equal(normalizeServerEnvelopeMessage(envelope), null);
    assert.equal(projectionPatchForLiveEnvelope(envelope, {}), null);
  }
});

test("Hello authority grants must be applicable to the immutable ticket scope", () => {
  const slotHello = normalizeServerEnvelopeMessage(protocolHelloEnvelope({
    caps: [{ kind: "SlotOccupant", body: { game: "midsummer", slot: "slot-7" } }],
    scope: { game: "midsummer", channel: "main", slot_id: "slot-7" },
  }));
  assert.equal(
    validateLiveProjectionMessageScope(slotHello, {
      game: "midsummer",
      channel: "main",
      slotId: "slot-7",
    }),
    true,
  );
  assert.throws(
    () => validateLiveProjectionMessageScope(slotHello, {
      game: "midsummer",
      channel: "main",
      slotId: "slot-other",
    }),
    /scope does not match/,
  );

  const channelHello = normalizeServerEnvelopeMessage(protocolHelloEnvelope({
    caps: [{
      kind: "ChannelMember",
      body: { game: "midsummer", channel: "private:mafia" },
    }],
    scope: { game: "midsummer", channel: "private:mafia", slot_id: null },
  }));
  assert.equal(
    validateLiveProjectionMessageScope(channelHello, {
      game: "midsummer",
      channel: "private:mafia",
    }),
    true,
  );
});

test("encodes and decodes the versioned binary CBOR live envelope", async () => {
  const envelope = resyncEnvelope(8, 9);
  const frame = encodeServerEnvelopeFrame(envelope);

  assert(frame instanceof Uint8Array);
  assert.deepEqual(await decodeServerEnvelopeFrame(frame), envelope);
  await assert.rejects(
    decodeServerEnvelopeFrame(JSON.stringify(envelope)),
    /binary CBOR/,
  );
  await assert.rejects(
    decodeServerEnvelopeFrame(new Uint8Array(1_048_577)),
    /maximum byte length/,
  );
  let materialized = false;
  class OversizedBlob extends Blob {
    async arrayBuffer() {
      materialized = true;
      return await super.arrayBuffer();
    }
  }
  await assert.rejects(
    decodeServerEnvelopeFrame(new OversizedBlob([new Uint8Array(1_048_577)])),
    /maximum byte length/,
  );
  assert.equal(materialized, false, "oversized blobs must be rejected before allocation");
});

test("creates votecount patches from live delta envelopes", () => {
  const patch = projectionPatchForLiveEnvelope(
    deltaEnvelope("VoteCountChanged", canonicalVoteCountBody({ count: 2 }), 1),
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
    deltaEnvelope("VoteCountCleared", {
      game: "midsummer",
      phase_id: "D01",
      candidate_slot: "slot-2",
    }, 2),
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
    deltaEnvelope("ThreadPostsChanged", {
      game: "midsummer",
      posts: [
              canonicalThreadPost({
                body: "Official votecount for D01",
                media: [
                  {
                    content_id: "c".repeat(64),
                    alt: "Official count card",
                    variants: {
                      tablet: {
                        avif_url: "/media/thread/43/tablet.avif",
                        webp_url: "/media/thread/43/tablet.webp",
                        width: 960,
                        height: 720,
                      },
                    },
                  },
                ],
              }),
      ],
    }, 3),
    {
      thread: {
        nextBeforeSeq: 40,
        posts: [
          {
            seq: 42,
            body: "before",
            author: { kind: "slot", slotId: "slot-7" },
            media: [
              {
                id: "b".repeat(64),
                contentId: "b".repeat(64),
                kind: "image",
                alt: "Existing private image",
                variants: {
                  tablet: {
                    avifUrl: "/media/thread/42/tablet.avif",
                    webpUrl: "/media/thread/42/tablet.webp",
                    width: 960,
                    height: 720,
                  },
                },
              },
            ],
          },
        ],
      },
    },
  );

  assert.equal(patch.thread.nextBeforeSeq, 40);
  assert.deepEqual(
    patch.thread.posts.map((post) => [post.seq, post.author, post.body]),
    [
      [42, { kind: "slot", slotId: "slot-7" }, "before"],
      [43, { kind: "host_narrator" }, "Official votecount for D01"],
    ],
  );
  assert.equal(
    patch.thread.posts[1].media[0].variants.tablet.avifUrl,
    "/media/thread/43/tablet.avif",
  );
  assert.equal(
    patch.thread.posts[0].media[0].variants.tablet.avifUrl,
    "/media/thread/42/tablet.avif",
  );
});

test("updates an off-page citation badge without replacing the thread page", () => {
  const patch = projectionPatchForLiveEnvelope(
    deltaEnvelope("PostCitationsChanged", {
            quoted: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
            citation_count: 2,
    }, 5),
    {
      thread: {
        nextBeforeSeq: 10,
        posts: [
          { seq: 12, body: "Alpha signal", citationCount: 0 },
          { seq: 80, body: "later page", citationCount: 0 },
        ],
      },
    },
  );

  assert.equal(patch.thread.nextBeforeSeq, 10);
  assert.equal(patch.thread.posts[0].citationCount, 2);
  assert.equal(patch.thread.posts[0].body, "Alpha signal");
  assert.equal(patch.thread.posts[1].citationCount, 0);
});

test("ignores citation deltas for posts the client has not loaded", () => {
  const thread = {
    nextBeforeSeq: 10,
    posts: [{ seq: 80, body: "later page", citationCount: 0 }],
  };
  const patch = projectionPatchForLiveEnvelope(
    deltaEnvelope("PostCitationsChanged", {
            quoted: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
            citation_count: 1,
    }, 6),
    { thread },
  );
  assert.equal(patch.thread, thread);
});

test("purges a moderated post from an already hydrated live thread", () => {
  const patch = projectionPatchForLiveEnvelope(
    deltaEnvelope("ThreadPostRemoved", { game: "midsummer", source_seq: 43 }, 4),
    {
      thread: {
        nextBeforeSeq: 40,
        posts: [
          { seq: 42, body: "visible" },
          { seq: 43, body: "now hidden" },
        ],
      },
    },
  );

  assert.equal(patch.thread.nextBeforeSeq, 40);
  assert.deepEqual(patch.thread.posts, [{ seq: 42, body: "visible" }]);
});

test("recovers a new live generation by refreshing registered cold-load keys", async () => {
  const store = fakeProjectionStore({
    votecount: [{ target: "slot-2", count: 1, needed: 7 }],
  });

  const recovery = await recoverAuthoritativeProjection({
    projectionStore: store,
    resyncKeys: ["votecount"],
    fetchImpl: async () => jsonResponse([{ target: "slot-2", count: 3, needed: 7 }]),
    message: { kind: "reconnect", attempt: 1 },
  });

  assert.deepEqual(store.refreshCalls, [
    { keys: ["votecount"], hasFetchImpl: true },
  ]);
  assert.deepEqual(recovery.message, {
    kind: "reconnect",
    attempt: 1,
    state: "recovered",
  });
  assert.deepEqual(recovery.snapshot.votecount, [
    { target: "slot-2", count: 3, needed: 7 },
  ]);
});

test("live connection revokes readiness until open completes a validated full refresh", async () => {
  FakeWebSocket.instances = [];
  const pendingRefresh = deferred();
  const refreshStarted = deferred();
  const events = [];
  const store = createProjectionStore({
    initialSnapshot: {
      thread: { posts: [{ seq: 1, body: "server-rendered" }] },
      commandState: { actorSlot: "slot-7", actorStatus: "alive" },
    },
    coldLoads: {
      thread: {
        url: "/thread",
        validate: (payload) => Array.isArray(payload?.posts),
      },
      commandState: {
        url: "/player-command-state",
        validate: (payload) => payload?.actorSlot === "slot-7",
      },
    },
  });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread", "commandState"],
    fetchImpl: async (url) => {
      refreshStarted.resolve();
      await pendingRefresh.promise;
      return url.startsWith("/thread?")
        ? jsonResponse({ posts: [{ seq: 2, body: "open authority" }] })
        : jsonResponse({ actorSlot: "slot-7", actorStatus: "alive" });
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  assert.equal(store.isReady(), false, "construction invalidates command authority");
  await FakeWebSocket.last.emit("open");
  assert.equal(store.isReady(), false, "raw websocket open is not authority");
  assert.deepEqual(events, []);

  const opening = FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
  await refreshStarted.promise;
  assert.equal(store.isReady(), false, "Hello alone is not refreshed authority");
  assert.deepEqual(events, []);

  pendingRefresh.resolve();
  await opening;
  assert.equal(store.isReady(), true);
  assert.deepEqual(events.at(-1).message, {
    kind: "hello",
    body: {
      protocol_v: 3,
      server: "fmarch-test",
      caps: [{ kind: "HostOf", body: { game: "midsummer" } }],
      scope: { game: "midsummer", channel: "main", slotId: null },
    },
    state: "recovered",
  });
  assert.equal(store.getSnapshot().thread.posts[0].body, "open authority");
  connection.close();
});

test("raw websocket open retains the Hello deadline and cannot restore readiness", async () => {
  FakeWebSocket.instances = [];
  const handshakeTimers = manualTimerScheduler();
  const reconnects = [];
  const events = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer&slot_id=slot-7",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["commandState"],
    recoveryTimeoutMs: 17,
    scheduleHandshakeTimeout: handshakeTimers.schedule,
    clearHandshakeTimeout: handshakeTimers.clear,
    scheduleReconnect(callback, delayMs) {
      reconnects.push({ callback, delayMs });
      return reconnects.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  const deadline = handshakeTimers.scheduled[0];
  assert.equal(deadline.delayMs, 17);
  assert.equal(deadline.handle.unrefCalled, true);
  await FakeWebSocket.last.emit("open");
  assert.equal(handshakeTimers.isActive(deadline.handle), true);
  assert.equal(store.ready, false);
  assert.deepEqual(events, []);

  assert.equal(handshakeTimers.fire(deadline.handle), true);
  assert.equal(store.ready, false);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(events.map(({ message }) => message), [
    { kind: "error", message: "live websocket protocol-v3 Hello timed out" },
    { kind: "close" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  assert.equal(reconnects.length, 1);
  connection.close();
});

test("a malformed Hello retires the socket before any authoritative refresh", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer&slot_id=slot-7",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["commandState"],
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame({
      ...protocolHelloEnvelope(),
      body: {
        kind: "Hello",
        body: { protocol_v: 1, server: "fmarch-test", caps: [] },
      },
    }),
  });

  assert.equal(store.ready, false);
  assert.deepEqual(store.refreshed, []);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.map(({ options }) => options.reason), [
    "live_connection_establishing",
    "live_protocol_handshake_failed",
    "live_connection_closed",
  ]);
  assert.equal(events[0].message.kind, "error");
  assert.equal(scheduled.length, 1);
  connection.close();
});

test("a cross-game Hello capability is rejected before authoritative refresh", async () => {
  FakeWebSocket.instances = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer&slot_id=slot-7",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["commandState"],
    reconnect: false,
  });
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(
      protocolHelloEnvelope({
        caps: [{ kind: "HostOf", body: { game: "another-game" } }],
      }),
    ),
  });

  assert.equal(store.ready, false);
  assert.deepEqual(store.refreshed, []);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.map(({ options }) => options.reason), [
    "live_connection_establishing",
    "live_protocol_handshake_failed",
    "live_connection_closed",
  ]);
  connection.close();
});

test("an empty or inapplicable Hello authority set is rejected fail closed", async () => {
  for (const caps of [
    [],
    [{ kind: "SlotOccupant", body: { game: "midsummer", slot: "slot-other" } }],
    [{
      kind: "ChannelMember",
      body: { game: "midsummer", channel: "private:other" },
    }],
  ]) {
    FakeWebSocket.instances = [];
    const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
    const connection = connectLiveProjection({
      url: "/ws?game=midsummer&slot_id=slot-7&channel=main",
      projectionStore: store,
      WebSocketCtor: FakeWebSocket,
      reconnect: false,
    });
    await FakeWebSocket.last.emit("open");
    await FakeWebSocket.last.emit("message", {
      data: encodeServerEnvelopeFrame(protocolHelloEnvelope({ caps })),
    });

    assert.equal(store.ready, false);
    assert.deepEqual(store.refreshed, []);
    assert.equal(FakeWebSocket.instances[0].closed, true);
    connection.close();
  }
});

test("freshness lease expiry revokes, reconnects, and requires a new Hello refresh", async () => {
  FakeWebSocket.instances = [];
  const handshakeTimers = manualTimerScheduler();
  const freshnessTimers = manualTimerScheduler();
  const reconnects = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    fetchImpl: async () => jsonResponse({ posts: [] }),
    freshnessLeaseMs: 23,
    scheduleHandshakeTimeout: handshakeTimers.schedule,
    clearHandshakeTimeout: () => {},
    scheduleFreshnessLease: freshnessTimers.schedule,
    clearFreshnessLease: () => {},
    scheduleReconnect(callback, delayMs) {
      reconnects.push({ callback, delayMs });
      return reconnects.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await completeLiveHandshake(FakeWebSocket.instances[0]);
  assert.equal(store.ready, true);
  assert.equal(store.refreshed.length, 1);
  const completedHandshakeDeadline = handshakeTimers.scheduled[0];
  assert.equal(handshakeTimers.isActive(completedHandshakeDeadline.handle), true);
  assert.equal(handshakeTimers.fire(completedHandshakeDeadline.handle), true);
  assert.equal(store.ready, true, "a queued superseded Hello timer is inert");
  const firstLease = freshnessTimers.scheduled[0];
  assert.equal(firstLease.delayMs, 23);
  assert.equal(firstLease.handle.unrefCalled, true);

  await FakeWebSocket.instances[0].emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
  const renewedLease = freshnessTimers.scheduled[1];
  assert.equal(freshnessTimers.isActive(firstLease.handle), true);
  assert.equal(freshnessTimers.isActive(renewedLease.handle), true);
  assert.equal(freshnessTimers.fire(firstLease.handle), true);
  assert.equal(store.ready, true);

  assert.equal(freshnessTimers.fire(renewedLease.handle), true);
  assert.equal(store.ready, false);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.slice(-2).map(({ options }) => options.reason), [
    "live_projection_freshness_expired",
    "live_connection_closed",
  ]);
  assert.equal(reconnects.length, 1);

  reconnects[0].callback();
  assert.equal(FakeWebSocket.instances.length, 2);
  await FakeWebSocket.instances[1].emit("open");
  assert.equal(store.ready, false, "raw reopen remains unavailable");
  await FakeWebSocket.instances[0].emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
  assert.equal(store.ready, false, "retired generations cannot renew authority");

  await FakeWebSocket.instances[1].emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
  assert.equal(store.ready, true);
  assert.equal(store.refreshed.length, 2);
  assert.equal(events.at(-1).message.kind, "reconnect");
  connection.close();
});

test("a changed repeated Hello retires instead of renewing live authority", async () => {
  FakeWebSocket.instances = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    reconnect: false,
  });

  await completeLiveHandshake(FakeWebSocket.instances[0]);
  assert.equal(store.ready, true);
  await FakeWebSocket.instances[0].emit("message", {
    data: encodeServerEnvelopeFrame(
      protocolHelloEnvelope({ server: "unexpected-live-server" }),
    ),
  });

  assert.equal(store.ready, false);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.slice(-2).map(({ options }) => options.reason), [
    "live_projection_recovery_failed",
    "live_connection_closed",
  ]);
  connection.close();
});

test("heartbeat Hello canonicalizes the exact game-scoped capability set", async () => {
  FakeWebSocket.instances = [];
  const caps = [
    { kind: "HostOf", body: { game: "midsummer" } },
    { kind: "ChannelMember", body: { game: "midsummer", channel: "main" } },
  ];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    reconnect: false,
  });
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope({ caps })),
  });
  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope({ caps: [...caps].reverse() })),
  });
  assert.notEqual(FakeWebSocket.last.closed, true);
  assert.equal(store.ready, true);
  connection.close();
});

test("missing websocket support stays unavailable and enters bounded reconnect behavior", async () => {
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: null,
    resyncKeys: ["commandState"],
    reconnectDelayMs: 7,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await waitFor(() => scheduled.length === 1);
  assert.equal(store.ready, false);
  assert.deepEqual(store.invalidations.map(({ options }) => options.reason), [
    "live_connection_establishing",
    "live_websocket_unavailable",
  ]);
  assert.deepEqual(events.map(({ message }) => message), [
    { kind: "error", message: "live websocket constructor is unavailable" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  assert.equal(scheduled[0].delayMs, 7);
  connection.close();
});

test("websocket constructor exceptions stay unavailable without an unhandled rejection", async () => {
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  class ThrowingWebSocket {
    constructor() {
      throw new Error("websocket policy denied construction");
    }
  }
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: ThrowingWebSocket,
    resyncKeys: ["commandState"],
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await waitFor(() => scheduled.length === 1);
  assert.equal(store.ready, false);
  assert.equal(events[0].message.kind, "error");
  assert.equal(events[0].message.message, "websocket policy denied construction");
  assert.equal(events[1].message.kind, "reconnecting");
  connection.close();
});

test("a websocket that never opens times out unavailable and reconnects", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ commandState: { actorStatus: "alive" } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["commandState"],
    recoveryTimeoutMs: 1,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    clearReconnect: () => {},
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(scheduled.length, 1);
  assert.equal(store.ready, false);
  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.map(({ options }) => options.reason), [
    "live_connection_establishing",
    "live_websocket_handshake_timeout",
    "live_connection_closed",
  ]);
  assert.deepEqual(events.map(({ message }) => message), [
    { kind: "error", message: "live websocket protocol-v3 Hello timed out" },
    { kind: "close" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  connection.close();
});

test("ticket endpoints mint a fresh audience-bound socket URL before opening", async () => {
  FakeWebSocket.instances = [];
  const requests = [];
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    resyncKeys: [],
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        url: "wss://api.example/ws?ticket=opaque&audience=fmarch-live",
      });
    },
  });

  await waitFor(() => FakeWebSocket.instances.length === 1);
  assert.equal(requests[0].url, "/live/tickets?game=midsummer");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(
    FakeWebSocket.instances[0].url,
    "wss://api.example/ws?ticket=opaque&audience=fmarch-live",
  );
  connection.close();
});

test("hung ticket mint is aborted before retrying connection establishment", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  let ticketAttempt = 0;
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    resyncKeys: [],
    WebSocketCtor: FakeWebSocket,
    recoveryTimeoutMs: 1,
    fetchImpl: async (_url, { signal }) => {
      ticketAttempt += 1;
      if (ticketAttempt === 1) {
        return await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return jsonResponse({ url: "wss://api.example/ws?ticket=recovered" });
    },
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(scheduled.length, 1);
  assert.deepEqual(events.map((event) => event.message), [
    { kind: "error", message: "live ticket request timed out" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);

  scheduled[0].callback();
  await waitFor(() => FakeWebSocket.instances.length === 1);
  await completeLiveHandshake(FakeWebSocket.instances[0]);

  assert.deepEqual(events.at(-1).message, {
    kind: "reconnect",
    attempt: 1,
    state: "recovered",
  });
  connection.close();
});

test("hung ticket response bodies share the generation deadline and reconnect once", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const bodyStarted = deferred();
  let ticketSignal;
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    WebSocketCtor: FakeWebSocket,
    recoveryTimeoutMs: 1,
    fetchImpl: async (_url, { signal }) => {
      ticketSignal = signal;
      return {
        ok: true,
        status: 200,
        async json() {
          bodyStarted.resolve();
          return await new Promise(() => {});
        },
      };
    },
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await bodyStarted.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ticketSignal.aborted, true);
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(events.map(({ message }) => message), [
    { kind: "error", message: "live ticket request timed out" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  connection.close();
});

test("closing during ticket body decoding aborts the generation without reconnecting", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const bodyStarted = deferred();
  const body = deferred();
  let ticketSignal;
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    WebSocketCtor: FakeWebSocket,
    recoveryTimeoutMs: 1_000,
    fetchImpl: async (_url, { signal }) => {
      ticketSignal = signal;
      return {
        ok: true,
        status: 200,
        async json() {
          bodyStarted.resolve();
          return await body.promise;
        },
      };
    },
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await bodyStarted.promise;
  connection.close();
  assert.equal(ticketSignal.aborted, true);
  body.resolve({ url: "wss://api.example/ws?ticket=too-late" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(FakeWebSocket.instances.length, 0);
  assert.equal(scheduled.length, 0);
  assert.deepEqual(events, []);
});

test("reconnecting during ticket body decoding aborts and replaces the generation", async () => {
  FakeWebSocket.instances = [];
  const events = [];
  const firstBodyStarted = deferred();
  const firstBody = deferred();
  let firstSignal;
  let ticketAttempt = 0;
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (_url, { signal }) => {
      ticketAttempt += 1;
      if (ticketAttempt === 1) {
        firstSignal = signal;
        return {
          ok: true,
          status: 200,
          async json() {
            firstBodyStarted.resolve();
            return await firstBody.promise;
          },
        };
      }
      return jsonResponse({
        url: "wss://api.example/ws?ticket=replacement-generation",
      });
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await firstBodyStarted.promise;
  assert.equal(connection.reconnectNow({ reason: "online" }), true);
  assert.equal(firstSignal.aborted, true);
  firstBody.resolve({ url: "wss://api.example/ws?ticket=retired-generation" });
  await waitFor(() => FakeWebSocket.instances.length === 1);
  assert.match(FakeWebSocket.instances[0].url, /replacement-generation/);
  await completeLiveHandshake(FakeWebSocket.instances[0]);
  assert.equal(
    events.some(({ message }) => message.kind === "error"),
    false,
  );
  assert.equal(events.at(-1).message.kind, "reconnect");
  connection.close();
});

test("rate-limited ticket mint honors Retry-After before reconnecting", async () => {
  const scheduled = [];
  const events = [];
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: fakeProjectionStore({}),
    WebSocketCtor: FakeWebSocket,
    reconnectDelayMs: 1_000,
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      headers: new Headers({ "retry-after": "17" }),
    }),
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await waitFor(() => scheduled.length === 1);
  assert.equal(scheduled[0].delayMs, 17_000);
  assert.deepEqual(events.map((event) => event.message), [
    { kind: "error", message: "live ticket request failed with HTTP 429" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  connection.close();
});

test("ticket authorization loss synchronously revokes player authority before reconnecting", async () => {
  const events = [];
  const ticketSeen = deferred();
  const store = createProjectionStore({
    initialSnapshot: {
      commandState: {
        actorStatus: "alive",
        role: { key: "seer" },
        actions: [{ id: "investigate" }],
        dayEventRooms: [{ eventId: "event-1" }],
      },
    },
    coldLoads: {
      commandState: {
        url: "/player-command-state",
        revoke: Object.freeze({
          actorStatus: "replaced",
          role: null,
          actions: Object.freeze([]),
          dayEventRooms: Object.freeze([]),
        }),
      },
    },
  });
  connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (url) => {
      if (url.startsWith("/live/tickets")) {
        ticketSeen.resolve();
        return { ok: false, status: 403 };
      }
      throw new Error("authorization revocation must not issue a refresh");
    },
    reconnect: false,
    onEvent(message, snapshot) {
      events.push({ message, snapshot });
    },
  });

  await ticketSeen.promise;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.isReady(), false);
  assert.deepEqual(store.getSnapshot().commandState, {
    actorStatus: "replaced",
    role: null,
    actions: [],
    dayEventRooms: [],
  });
  assert.deepEqual(events[0], {
    message: { kind: "authorization-lost", status: 403 },
    snapshot: {
      commandState: {
        actorStatus: "replaced",
        role: null,
        actions: [],
        dayEventRooms: [],
      },
    },
  });
});

test("websocket resync frames end the current generation before any refresh", async () => {
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
    reconnect: false,
    onEvent(message, snapshot) {
      events.push({ message, snapshot });
    },
  });

  await completeLiveHandshake();
  events.length = 0;

  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(resyncEnvelope(8, 1)),
  });

  const resync = events.find((event) => event.message?.kind === "resync-required");
  assert.deepEqual(resync.message, {
    kind: "resync-required",
    scope: { game: "midsummer", channel: "main", slotId: null },
    audiences: [{ kind: "Game", game: "midsummer" }],
    fromEventSeq: 8,
    state: "reconnecting",
  });
  assert.equal(resync.snapshot, null);
  assert.equal(FakeWebSocket.last.closed, true);
  assert.deepEqual(connection.metrics(), {
    resyncFramesReceived: 1,
  });
  connection.close();
});

test("frames queued behind resync cannot refresh the retired generation", async () => {
  const events = [];
  const refreshes = [];
  let initialRefresh = true;
  const store = {
    snapshot: { generation: 0 },
    getSnapshot() {
      return this.snapshot;
    },
    applyLiveEnvelope() {
      return this.snapshot;
    },
    async refresh(keys) {
      if (initialRefresh) {
        initialRefresh = false;
        return this.snapshot;
      }
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

  await completeLiveHandshake();
  events.length = 0;

  const first = FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(resyncEnvelope(8, 1)),
  });
  await first;
  assert.equal(refreshes.length, 0);
  assert.equal(FakeWebSocket.last.closed, true);
  assert.deepEqual(connection.metrics(), {
    resyncFramesReceived: 1,
  });
  connection.close();
});

test("natural socket close retires its generation before deferred decode can apply", async () => {
  const events = [];
  const pending = deferred();
  let initialRefresh = true;
  const store = {
    getSnapshot: () => ({ generation: 0 }),
    applyLiveEnvelope: () => ({ generation: 0 }),
    refresh: async () => {
      if (initialRefresh) {
        initialRefresh = false;
        return { generation: 0 };
      }
      return await pending.promise;
    },
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
  await completeLiveHandshake();
  events.length = 0;
  const recovery = FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(resyncEnvelope(12, 1)),
  });
  await Promise.resolve();
  await FakeWebSocket.last.emit("close");
  pending.resolve({ generation: 12 });
  await recovery;

  assert.deepEqual(events, [{ message: { kind: "close" }, snapshot: null }]);
  assert.deepEqual(connection.metrics(), {
    resyncFramesReceived: 0,
  });
});

test("websocket delta frames can refresh dependent cold-load keys", async () => {
  const store = fakeProjectionStore({
    thread: { posts: [] },
    commandState: { actions: ["old-action"] },
  });
  const events = [];
  const connection = connectLiveProjection({
    url: "ws://example.test/ws?game=midsummer",
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

  await completeLiveHandshake();
  store.refreshCalls.length = 0;
  store.refreshed.length = 0;
  events.length = 0;

  await FakeWebSocket.last.emit("message", {
    data: encodeServerEnvelopeFrame(deltaEnvelope("ThreadPostsChanged", {
      game: "midsummer",
      posts: [canonicalThreadPost({ source_seq: 77, body: "Dawn" })],
    })),
  });

  assert.deepEqual(store.refreshed, [["commandState"]]);
  assert.deepEqual(store.getSnapshot().commandState, { actions: ["fresh-action"] });
  assert.equal(events.at(-1).message.delta.kind, "ThreadPostsChanged");
  assert.equal(events.at(-1).snapshot.commandState.actions[0], "fresh-action");
  connection.close();
});

test("a slow consumer cannot grow the generation frame queue without bound", async () => {
  FakeWebSocket.instances = [];
  const pendingRefresh = deferred();
  const events = [];
  let refreshCount = 0;
  const store = {
    snapshot: { thread: { posts: [] } },
    getSnapshot() {
      return this.snapshot;
    },
    invalidate() {},
    revokeAuthority() {},
    applyLiveEnvelope() {
      return this.snapshot;
    },
    async refresh() {
      refreshCount += 1;
      if (refreshCount === 1) return this.snapshot;
      return await pendingRefresh.promise;
    },
  };
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    reconnect: false,
    refreshKeysForEvent: () => ["thread"],
    onEvent: (message) => events.push(message),
  });
  await completeLiveHandshake();

  const queued = [];
  for (let id = 1; id <= LIVE_PROJECTION_MAX_QUEUED_FRAMES + 1; id += 1) {
    queued.push(FakeWebSocket.last.emit("message", {
      data: encodeServerEnvelopeFrame(deltaEnvelope("ThreadPostsChanged", {
        game: "midsummer",
        posts: [canonicalThreadPost({ source_seq: id, stream_seq: id })],
      }, id)),
    }));
  }
  await waitFor(() => FakeWebSocket.last.closed === true);
  assert.equal(
    events.some((message) =>
      message?.kind === "error" && /queue exceeded/.test(message.message)
    ),
    true,
  );

  pendingRefresh.resolve(store.snapshot);
  await Promise.allSettled(queued);
  connection.close();
});

test("malformed generic frames retire synchronously without projection mutation", async () => {
  for (const envelope of [
    deltaEnvelope(
      "VoteCountChanged",
      canonicalVoteCountBody({ count: -1 }),
    ),
    deltaEnvelope("PostCitationsChanged", {
      quoted: { kind: "game_post", scope_id: "midsummer", source_seq: 12 },
      citation_count: -1,
    }),
    deltaEnvelope("ThreadPostsChanged", {
      game: "midsummer",
      posts: [],
      extension: true,
    }),
  ]) {
    FakeWebSocket.instances = [];
    const initialThread = { posts: [{ seq: 1, body: "trusted" }] };
    const store = fakeProjectionStore({ thread: initialThread });
    const connection = connectLiveProjection({
      url: "/ws?game=midsummer",
      projectionStore: store,
      WebSocketCtor: FakeWebSocket,
      resyncKeys: ["thread"],
      reconnect: false,
    });
    await completeLiveHandshake();
    store.invalidations.length = 0;
    await FakeWebSocket.last.emit("message", {
      data: encodeServerEnvelopeFrame(envelope),
    });

    assert.equal(store.getSnapshot().thread, initialThread);
    assert.equal(store.ready, false);
    assert.equal(FakeWebSocket.instances[0].closed, true);
    assert.deepEqual(store.invalidations.map(({ options }) => options.reason), [
      "live_projection_recovery_failed",
      "live_connection_closed",
    ]);
    connection.close();
  }
});

test("duplicate and noncontiguous positive envelope ids retire before mutation", async () => {
  for (const scenario of [
    { name: "gap", firstId: null, rejectedId: 2 },
    { name: "duplicate", firstId: 1, rejectedId: 1 },
  ]) {
    FakeWebSocket.instances = [];
    const store = fakeProjectionStore({ thread: { posts: [] } });
    const connection = connectLiveProjection({
      url: "/ws?game=midsummer",
      projectionStore: store,
      WebSocketCtor: FakeWebSocket,
      resyncKeys: ["thread"],
      reconnect: false,
    });
    await completeLiveHandshake();
    if (scenario.firstId !== null) {
      await FakeWebSocket.last.emit("message", {
        data: encodeServerEnvelopeFrame(
          deltaEnvelope(
            "ThreadPostsChanged",
            {
              game: "midsummer",
              posts: [canonicalThreadPost({ source_seq: 77 })],
            },
            scenario.firstId,
          ),
        ),
      });
    }
    const snapshotBeforeRejectedFrame = store.getSnapshot();
    await FakeWebSocket.last.emit("message", {
      data: encodeServerEnvelopeFrame(
        deltaEnvelope(
          "ThreadPostsChanged",
          {
            game: "midsummer",
            posts: [canonicalThreadPost({ source_seq: 78 })],
          },
          scenario.rejectedId,
        ),
      ),
    });

    assert.equal(
      store.getSnapshot(),
      snapshotBeforeRejectedFrame,
      `${scenario.name} must not mutate`,
    );
    assert.equal(store.ready, false, scenario.name);
    assert.equal(FakeWebSocket.instances[0].closed, true, scenario.name);
    connection.close();
  }
});

test("wrong-game and wrong-channel deltas retire before projection mutation", async () => {
  for (const scenario of [
    {
      name: "wrong game",
      body: {
        game: "another-game",
        posts: [
          canonicalThreadPost({
            game: "another-game",
            channel_id: "main",
            source_seq: 77,
            stream_seq: 77,
            body: "foreign game",
          }),
        ],
      },
    },
    {
      name: "wrong channel",
      body: {
        game: "midsummer",
        posts: [
          canonicalThreadPost({
            channel_id: "private:mafia_day_chat",
            source_seq: 78,
            stream_seq: 78,
            body: "foreign channel",
          }),
        ],
      },
    },
  ]) {
    FakeWebSocket.instances = [];
    const events = [];
    const store = fakeProjectionStore({ thread: { posts: [] } });
    const connection = connectLiveProjection({
      url: "/ws?game=midsummer&channel=main",
      projectionStore: store,
      WebSocketCtor: FakeWebSocket,
      resyncKeys: ["thread"],
      fetchImpl: async () => jsonResponse({ posts: [] }),
      reconnect: false,
      onEvent: (message, snapshot) => events.push({ message, snapshot }),
    });
    await completeLiveHandshake();
    events.length = 0;

    await FakeWebSocket.last.emit("message", {
      data: encodeServerEnvelopeFrame({
      v: 3,
        id: 1,
        body: {
          kind: "Delta",
          body: { kind: "ThreadPostsChanged", body: scenario.body },
        },
      }),
    });

    assert.deepEqual(store.getSnapshot().thread, { posts: [] }, scenario.name);
    assert.equal(store.ready, false, scenario.name);
    assert.equal(FakeWebSocket.instances[0].closed, true, scenario.name);
    assert.equal(events[0].message.kind, "error", scenario.name);
    connection.close();
  }
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

  assert.deepEqual(store.invalidations, [
    {
      keys: ["thread"],
      options: { reason: "live_connection_establishing" },
    },
    {
      keys: ["thread"],
      options: { reason: "live_connection_closed" },
    },
  ]);
  assert.deepEqual(events.map((event) => event.message), [
    { kind: "close" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delayMs, 42);

  scheduled[0].callback();
  assert.equal(FakeWebSocket.instances.length, 2);
  await completeLiveHandshake(FakeWebSocket.instances[1]);

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

test("invalid live projection application replaces the socket and requires resync", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  store.applyLiveEnvelope = () => {
    throw new TypeError("live projection authority mismatch");
  };
  connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    reconnectDelayMs: 10,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await completeLiveHandshake(FakeWebSocket.instances[0]);
  events.length = 0;
  store.invalidations.length = 0;

  await FakeWebSocket.instances[0].emit("message", {
    data: encodeServerEnvelopeFrame(deltaEnvelope("ThreadPostsChanged", {
      game: "midsummer",
      posts: [],
    })),
  });

  assert.equal(FakeWebSocket.instances[0].closed, true);
  assert.deepEqual(store.invalidations.map((entry) => entry.options.reason), [
    "live_projection_recovery_failed",
    "live_connection_closed",
  ]);
  assert.deepEqual(events.map((event) => event.message), [
    { kind: "error", message: "live projection authority mismatch" },
    { kind: "close" },
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
  assert.equal(scheduled.length, 1);
});

test("failed reconnect refresh closes the unusable socket and retries recovery", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  let refreshAttempt = 0;
  store.refresh = async function refresh(keys) {
    this.refreshed.push(keys);
    refreshAttempt += 1;
    if (refreshAttempt === 1) {
      throw new Error("snapshot refresh unavailable");
    }
    this.snapshot = {
      ...this.snapshot,
      thread: { posts: [{ seq: 31, body: "recovered on retry" }] },
    };
    return this.snapshot;
  };

  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    reconnectDelayMs: 42,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  connection.drop();
  scheduled[0].callback();
  await completeLiveHandshake(FakeWebSocket.instances[1]);

  assert.equal(FakeWebSocket.instances[1].closed, true);
  assert.deepEqual(events.slice(-3).map((event) => event.message), [
    { kind: "error", message: "snapshot refresh unavailable" },
    { kind: "close" },
    { kind: "reconnecting", attempt: 2, reason: "close" },
  ]);
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[1].delayMs, 84);

  scheduled[1].callback();
  await completeLiveHandshake(FakeWebSocket.instances[2]);

  assert.deepEqual(events.at(-1), {
    message: { kind: "reconnect", attempt: 2, state: "recovered" },
    snapshot: {
      thread: { posts: [{ seq: 31, body: "recovered on retry" }] },
    },
  });
  assert.deepEqual(store.refreshed, [["thread"], ["thread"]]);
});

test("hung reconnect refresh is aborted before retrying recovery", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  store.refresh = async (_keys, { signal }) =>
    await new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    recoveryTimeoutMs: 1,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  connection.drop();
  scheduled[0].callback();
  await completeLiveHandshake(FakeWebSocket.instances[1]);

  assert.equal(FakeWebSocket.instances[1].closed, true);
  assert.deepEqual(events.slice(-3).map((event) => event.message), [
    { kind: "error", message: "live projection recovery timed out" },
    { kind: "close" },
    { kind: "reconnecting", attempt: 2, reason: "close" },
  ]);
  assert.equal(scheduled.length, 2);
  connection.close();
});

test("intentional websocket close does not schedule reconnect", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({
    thread: { posts: [] },
  });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
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
  assert.deepEqual(store.invalidations, [
    {
      keys: undefined,
      options: { reason: "live_connection_establishing" },
    },
    {
      keys: undefined,
      options: { reason: "live_connection_disposed" },
    },
  ]);
});

test("a reconnect recovery from a replaced socket cannot publish healthy state", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const recovery = deferred();
  const store = fakeProjectionStore({ thread: { posts: [] } });
  store.refresh = async () => await recovery.promise;
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    resyncKeys: ["thread"],
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  connection.drop();
  scheduled[0].callback();
  await FakeWebSocket.instances[1].emit("open");
  const staleOpen = FakeWebSocket.instances[1].emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
  await Promise.resolve();
  assert.equal(connection.reconnectNow({ reason: "online" }), true);
  recovery.resolve({ thread: { posts: [{ seq: 9, body: "stale recovery" }] } });
  await staleOpen;

  assert.equal(FakeWebSocket.instances.length, 3);
  assert.equal(
    events.some((event) => event.message?.state === "recovered"),
    false,
  );
  connection.close();
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
    { kind: "reconnecting", attempt: 1, reason: "close" },
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
    data: encodeServerEnvelopeFrame({
      v: 3,
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
    { kind: "reconnecting", attempt: 1, reason: "close" },
  ]);
});

test("live projection events map to visible status copy", () => {
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "open" }), {
    state: "connected",
    message: "Live updates connected",
  });
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "delta",
      delta: { kind: "VoteCountChanged", body: {} },
    }),
    {
      state: "updated",
      message: "Game updated",
    },
  );
  assert.deepEqual(
    liveProjectionStatusForEvent({
      kind: "reconnecting",
      attempt: 1,
    }),
    {
      state: "reconnecting",
      message: "Reconnecting live updates. Actions remain safe.",
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
      message: "Live updates restored",
    },
  );
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "error", message: "boom" }), {
    state: "error",
    message: "Live updates paused. Refresh if this continues.",
  });
  assert.deepEqual(liveProjectionStatusForEvent({ kind: "close" }), {
    state: "closed",
    message: "Live updates paused. Reconnecting automatically.",
  });
});

test("generic close uses exponential backoff and resets after a healthy reopen", async () => {
  assert.equal(liveProjectionReconnectDelayMs(0, 42), 42);
  assert.equal(liveProjectionReconnectDelayMs(1, 42), 84);
  assert.equal(liveProjectionReconnectDelayMs(5, 42), 1344);
  assert.equal(liveProjectionReconnectDelayMs(9, 42), 1344);

  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  const connection = connectLiveProjection({
    url: "/ws?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async () => jsonResponse({ posts: [{ seq: 2, body: "recovered" }] }),
    resyncKeys: ["thread"],
    reconnectDelayMs: 42,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await FakeWebSocket.instances[0].emit("close");
  assert.equal(scheduled[0].delayMs, 42);
  scheduled[0].callback();
  await FakeWebSocket.instances[1].emit("close");
  assert.equal(scheduled[1].delayMs, 84);

  scheduled[1].callback();
  await completeLiveHandshake(FakeWebSocket.instances[2]);
  assert.equal(events.at(-1).message.kind, "reconnect");

  await FakeWebSocket.instances[2].emit("close");
  assert.equal(scheduled[2].delayMs, 42);
  connection.close();
});

test("page lifecycle wake remints a ticket and refreshes immediately", async () => {
  FakeWebSocket.instances = [];
  const scheduled = [];
  const tickets = [];
  const events = [];
  const store = fakeProjectionStore({ thread: { posts: [] } });
  const connection = connectLiveProjection({
    url: "/live/tickets?game=midsummer",
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/live/tickets")) {
        tickets.push(url);
        return jsonResponse({
          url: `wss://api.example/ws?ticket=wake-${tickets.length}`,
        });
      }
      return jsonResponse({ posts: [{ seq: 11, body: "woke" }] });
    },
    resyncKeys: ["thread"],
    reconnectDelayMs: 5_000,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent: (message, snapshot) => events.push({ message, snapshot }),
  });

  await waitFor(() => FakeWebSocket.instances.length === 1);
  await completeLiveHandshake(FakeWebSocket.instances[0]);
  assert.equal(connection.reconnectNow({ reason: "visibilitychange" }), true);
  assert.deepEqual(store.revocations, [
    { reason: "live_reconnect_visibilitychange" },
  ]);
  assert.equal(scheduled.length, 0);
  await waitFor(() => FakeWebSocket.instances.length === 2);
  await completeLiveHandshake(FakeWebSocket.instances[1]);

  assert.equal(tickets.length, 2);
  assert.deepEqual(events.at(-2).message, {
    kind: "reconnecting",
    attempt: 1,
    reason: "visibilitychange",
  });
  assert.deepEqual(events.at(-1).message, {
    kind: "reconnect",
    attempt: 0,
    state: "recovered",
  });
  assert.deepEqual(store.refreshed, [["thread"], ["thread"]]);
  connection.close();
});

test("page lifecycle owner wakes on visible/online/bfcache and ignores hidden/normal pageshow", async () => {
  assert.equal(shouldWakeLiveProjection("online"), true);
  assert.equal(shouldWakeLiveProjection("pageshow", { persisted: true }), true);
  assert.equal(shouldWakeLiveProjection("pageshow", { persisted: false }), false);
  assert.equal(
    shouldWakeLiveProjection("visibilitychange", { visibilityState: "visible" }),
    true,
  );
  assert.equal(
    shouldWakeLiveProjection("visibilitychange", { visibilityState: "hidden" }),
    false,
  );

  const reasons = [];
  const documentRef = fakeEventTarget({ visibilityState: "hidden" });
  const windowRef = fakeEventTarget({ document: documentRef });
  const lifecycle = attachLiveProjectionPageLifecycle({
    connection: {
      reconnectNow({ reason }) {
        reasons.push(reason);
        return true;
      },
    },
    target: windowRef,
    documentRef,
  });

  documentRef.visibilityState = "hidden";
  documentRef.emit("visibilitychange");
  documentRef.visibilityState = "visible";
  documentRef.emit("visibilitychange");
  windowRef.emit("online");
  windowRef.emit("pageshow", { persisted: false });
  windowRef.emit("pageshow", { persisted: true });
  lifecycle.detach();
  windowRef.emit("online");

  assert.deepEqual(reasons, ["visibilitychange", "online", "pageshow"]);
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

async function completeLiveHandshake(socket = FakeWebSocket.last) {
  await socket.emit("open");
  await socket.emit("message", {
    data: encodeServerEnvelopeFrame(protocolHelloEnvelope()),
  });
}

function protocolHelloEnvelope({
  server = "fmarch-test",
  caps = [{ kind: "HostOf", body: { game: "midsummer" } }],
  scope = { game: "midsummer", channel: "main", slot_id: null },
} = {}) {
  return {
    v: 3,
    id: 0,
    body: {
      kind: "Hello",
      body: { protocol_v: 3, server, caps, scope },
    },
  };
}

function deltaEnvelope(kind, body, id = 1) {
  const canonicalBody =
    (kind === "ThreadPostRemoved" || kind === "PostCitationsChanged") &&
      body.channel === undefined
      ? { ...body, channel: "main" }
      : body;
  return {
    v: 3,
    id,
    body: {
      kind: "Delta",
      body: {
        audience: audienceForDelta(kind, canonicalBody),
        delta: { kind, body: canonicalBody },
      },
    },
  };
}

function canonicalVoteCountBody(overrides = {}) {
  return {
    game: "midsummer",
    phase_id: "D01",
    candidate_slot: "slot-2",
    count: 1,
    ...overrides,
  };
}

function canonicalThreadPost(overrides = {}) {
  return {
    game: "midsummer",
    source_seq: 43,
    stream_seq: 9,
    channel_id: "main",
    author: { kind: "host_narrator" },
    phase_id: "D01",
    body: "Official votecount",
    media: [],
    quotations: [],
    citation_count: 0,
    occurred_at: 1781928000,
    ...overrides,
  };
}

function canonicalHostStateBody(overrides = {}) {
  return {
    game: "midsummer",
    authority: {
      principal_id: "principal-host",
      capability: "HostOf",
      allowed_classes: [],
      denied_classes: [],
    },
    completed: false,
    phase: { phase_id: "D01", locked: true, deadline: null },
    slots: [],
    thread_posts: [],
    day_event_scheduler: null,
    day_events: [],
    tasks: [],
    ...overrides,
  };
}

function canonicalDayVoteOutcome(overrides = {}) {
  return {
    game: "midsummer",
    phase_id: "D01",
    source_seq: 11,
    event_index: 0,
    status: "Lynch",
    winner_slot: "slot-2",
    contenders: ["slot-2"],
    tallies: { "slot-2": 2 },
    votes: { "slot-7": "slot-2" },
    weights: { "slot-7": 1 },
    majority: 2,
    thresholds: { "slot-2": 2 },
    total_weight: 2,
    tiebreak: null,
    reason: null,
    ...overrides,
  };
}

function fakeEventTarget(extra = {}) {
  const listeners = new Map();
  return {
    ...extra,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    emit(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
}

function fakeProjectionStore(initialSnapshot) {
  return {
    snapshot: initialSnapshot,
    ready: true,
    refreshCalls: [],
    refreshed: [],
    invalidations: [],
    revocations: [],
    revokeAuthority(options) {
      this.revocations.push(options);
      return this.snapshot;
    },
    invalidate(keys, options) {
      this.invalidations.push({ keys, options });
      this.ready = false;
    },
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
    async refresh(keys, { fetchImpl, restoreReadiness = true } = {}) {
      const refreshKeys = keys ?? Object.keys(this.snapshot);
      this.refreshCalls.push({ keys: refreshKeys, hasFetchImpl: typeof fetchImpl === "function" });
      this.refreshed.push(refreshKeys);
      const patches = {};
      for (const key of refreshKeys) {
        if (fetchImpl === globalThis.fetch) {
          patches[key] = this.snapshot[key];
          continue;
        }
        const url = key === "commandState" ? "/player-command-state" : `/${key}`;
        const response = await fetchImpl(url);
        patches[key] = await response.json();
      }
      this.snapshot = { ...this.snapshot, ...patches };
      this.ready = restoreReadiness === true;
      return this.snapshot;
    },
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function manualTimerScheduler() {
  let nextId = 1;
  const active = new Map();
  const scheduled = [];
  return {
    scheduled,
    schedule(callback, delayMs) {
      const handle = {
        id: nextId,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      nextId += 1;
      active.set(handle.id, { callback, delayMs, handle });
      scheduled.push({ callback, delayMs, handle });
      return handle;
    },
    clear(handle) {
      active.delete(handle?.id);
    },
    isActive(handle) {
      return active.has(handle?.id);
    },
    fire(handle) {
      const timer = active.get(handle?.id);
      if (timer === undefined) {
        return false;
      }
      active.delete(handle.id);
      timer.callback();
      return true;
    },
  };
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
    v: 3,
    id,
    body: {
      kind: "ResyncRequired",
      body: {
        scope: { game: "midsummer", channel: "main", slot_id: null },
        audiences: [{ Game: { game: "midsummer" } }],
        from_event_seq: fromSeq,
      },
    },
  };
}

function audienceForDelta(kind, body) {
  if (["VoteCountChanged", "VoteCountCleared", "DayVoteOutcomeApplied"].includes(kind)) {
    return { Game: { game: body.game } };
  }
  if (["ThreadPostsChanged", "ThreadPostRemoved", "PostCitationsChanged"].includes(kind)) {
    const game = kind === "PostCitationsChanged" ? body.quoted.scope_id : body.game;
    const channel = body.posts?.[0]?.channel_id ?? "main";
    return { Thread: { game, channel } };
  }
  if (["PlayerNotificationsChanged", "PlayerInvestigationResultsChanged"].includes(kind)) {
    const rows = body.notifications ?? body.results ?? [];
    return { PlayerSlot: { game: body.game, slot_id: rows[0]?.audience_slot ?? "slot-7" } };
  }
  return { Host: { game: body.game } };
}


test("Rust-style CBOR int64 values retain safe numeric envelope ids", async () => {
  for (const id of [4_294_967_296n, 9_007_199_254_740_991n]) {
    const decoded = await decodeServerEnvelopeFrame(encodeServerEnvelopeFrame({ v: 3, id, body: {} }));
    assert.equal(decoded.id, Number(id));
    assert.equal(Number.isSafeInteger(decoded.id), true);
  }
  const unsafe = await decodeServerEnvelopeFrame(encodeServerEnvelopeFrame({
    v: 3, id: 9_007_199_254_740_992n, body: {},
  }));
  assert.equal(normalizeServerEnvelopeMessage(unsafe), null);
});

test("live thread DTO accepts Rust's null embed and decided mention spans", () => {
  const frame = deltaEnvelope("ThreadPostsChanged", { game: "midsummer", posts: [canonicalThreadPost({ embed: null, mentions: [{ slot_id: "slot-2", offset: 0, len: 7 }] })] });
  assert.equal(normalizeServerEnvelopeMessage(frame)?.kind, "delta");
  const post = frame.body.body.delta.body.posts[0];
  for (const mentions of [null, [{}], [{ slot_id: "slot-2", offset: -1, len: 7 }], [{ slot_id: "slot-2", offset: 0, len: 0 }]]) {
    post.mentions = mentions;
    assert.equal(normalizeServerEnvelopeMessage(frame), null);
  }
  post.mentions = [];
  post.embed = {};
  assert.equal(normalizeServerEnvelopeMessage(frame), null);
});
