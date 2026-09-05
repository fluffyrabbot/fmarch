import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLD_LOAD_TRANSPORT_BOUNDARY,
  createProjectionStore as createRawProjectionStore,
  LIVE_TRANSPORT_BOUNDARY,
  ProjectionRefreshError,
} from "./projection-store.mjs";

function createProjectionStore(options) {
  const store = createRawProjectionStore(options);
  return Object.freeze({
    ...store,
    applyLiveEnvelope(envelope, applyOptions) {
      return store.applyLiveEnvelope(canonicalV3LiveFixture(envelope), applyOptions);
    },
  });
}

function canonicalV3LiveFixture(envelope) {
  const projection = envelope?.body?.kind === "Delta" ? envelope.body.body : null;
  if (projection === null || Object.hasOwn(projection, "audience")) {
    return envelope;
  }
  const kind = projection.kind;
  const body =
    (kind === "ThreadPostRemoved" || kind === "PostCitationsChanged") &&
      projection.body.channel === undefined
      ? { ...projection.body, channel: "main" }
      : projection.body;
  let audience;
  if (["VoteCountChanged", "VoteCountCleared", "DayVoteOutcomeApplied"].includes(kind)) {
    audience = { Game: { game: body.game } };
  } else if (["ThreadPostsChanged", "ThreadPostRemoved", "PostCitationsChanged"].includes(kind)) {
    audience = {
      Thread: {
        game: kind === "PostCitationsChanged" ? body.quoted.scope_id : body.game,
        channel: body.posts?.[0]?.channel_id ?? "main",
      },
    };
  } else if (["PlayerNotificationsChanged", "PlayerInvestigationResultsChanged"].includes(kind)) {
    const rows = body.notifications ?? body.results ?? [];
    audience = {
      PlayerSlot: {
        game: body.game,
        slot_id: rows[0]?.audience_slot ?? "slot-7",
      },
    };
  } else {
    audience = { Host: { game: body.game } };
  }
  return {
    ...envelope,
    v: 3,
    body: {
      kind: "Delta",
      body: { audience, delta: { ...projection, body } },
    },
  };
}

test("projection refresh failure revokes readiness until a validated full refresh succeeds", async () => {
  const snapshots = [];
  const fetchRequests = [];
  const abortController = new AbortController();
  const store = createProjectionStore({
    initialSnapshot: {
      thread: { posts: [] },
      votecount: [{ target: "slot-1", count: 1 }],
    },
    coldLoads: {
      thread: {
        url: "/thread",
        normalize: (payload) => ({ posts: payload.posts }),
      },
      votecount: {
        url: "/votecount",
        normalize: (payload, previous) =>
          Array.isArray(payload) ? payload : previous,
      },
    },
  });

  const unsubscribe = store.subscribe((snapshot) => snapshots.push(snapshot));
  await assert.rejects(
    store.refresh(["thread", "votecount"], {
      signal: abortController.signal,
      fetchImpl: async (url, options) => {
        fetchRequests.push({ url, options });
        if (url.startsWith("/thread?")) {
          return jsonResponse({ posts: [{ seq: 7, body: "cold load" }] });
        }
        return { ok: false, status: 503 };
      },
    }),
    (error) =>
      error instanceof ProjectionRefreshError &&
      error.failures[0].key === "votecount" &&
      error.failures[0].status === 503,
  );
  unsubscribe();

  assert.deepEqual(store.getSnapshot().thread, { posts: [] });
  assert.deepEqual(store.getSnapshot().votecount, [
    { target: "slot-1", count: 1 },
  ]);
  assert.equal(store.getHealth().ready, false);
  assert.equal(store.getHealth().state, "unavailable");
  assert.equal(store.getHealth().keys.thread.state, "unavailable");
  assert.equal(store.getHealth().keys.votecount.state, "unavailable");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].thread.posts.length, 0);
  assert.deepEqual(fetchRequests, [
    {
      url: "/thread?_fmarch_projection_refresh=1",
      options: {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: abortController.signal,
      },
    },
    {
      url: "/votecount?_fmarch_projection_refresh=2",
      options: {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: abortController.signal,
      },
    },
  ]);

  await store.refresh("votecount", {
    fetchImpl: async () => jsonResponse([{ target: "slot-2", count: 2 }]),
  });
  assert.equal(
    store.getHealth().ready,
    false,
    "refreshing only the failed key cannot bless the uncommitted half of the failed batch",
  );
  assert.equal(store.getHealth().keys.thread.state, "unavailable");
  assert.equal(store.getHealth().keys.votecount.state, "ready");

  await store.refresh(undefined, {
    fetchImpl: async (url) =>
      url.startsWith("/thread?")
        ? jsonResponse({ posts: [{ seq: 8, body: "fully recovered" }] })
        : jsonResponse([{ target: "slot-2", count: 2 }]),
  });
  assert.equal(store.getHealth().ready, true);
  assert.equal(store.getHealth().state, "ready");
  assert.equal(store.getSnapshot().thread.posts[0].body, "fully recovered");
});

test("projection store can normalize an authorization loss into an explicit snapshot", async () => {
  const store = createProjectionStore({
    initialSnapshot: {
      commandState: { actorStatus: "alive", dayEventRooms: [{ eventId: "event-1" }] },
    },
    coldLoads: {
      commandState: {
        url: "/player-command-state",
        normalizeError: ({ status, previous }) =>
          status === 403
            ? {
                ...previous,
                actorStatus: "replaced",
                dayEventRooms: [],
              }
            : undefined,
      },
    },
  });

  const snapshot = await store.refresh("commandState", {
    fetchImpl: async () => ({ ok: false, status: 403 }),
  });
  assert.deepEqual(snapshot.commandState, {
    actorStatus: "replaced",
    dayEventRooms: [],
  });
  assert.equal(store.getHealth().ready, true);
});

test("an authorization refresh can update revoked state without restoring live readiness", async () => {
  const store = createProjectionStore({
    initialSnapshot: {
      commandState: { actorStatus: "alive", dayEventRooms: [{ eventId: "event-1" }] },
    },
    coldLoads: {
      commandState: {
        url: "/player-command-state",
        normalizeError: ({ status, previous }) =>
          status === 403
            ? { ...previous, actorStatus: "replaced", dayEventRooms: [] }
            : undefined,
      },
    },
  });
  store.invalidate(undefined, { reason: "live_connection_establishing" });

  const snapshot = await store.refresh("commandState", {
    fetchImpl: async () => ({ ok: false, status: 403 }),
    restoreReadiness: false,
  });

  assert.equal(snapshot.commandState.actorStatus, "replaced");
  assert.equal(store.isReady(), false);
  assert.equal(
    store.getHealth().reason,
    "authoritative_refresh_applied_while_unavailable",
  );
});

test("projection store rejects malformed successful payloads before restoring readiness", async () => {
  const initial = { thread: { posts: [{ seq: 1, body: "trusted" }] } };
  const store = createProjectionStore({
    initialSnapshot: initial,
    coldLoads: {
      thread: {
        url: "/thread",
        validate: (payload) =>
          payload !== null &&
          typeof payload === "object" &&
          Array.isArray(payload.posts),
        normalize: (payload) => ({ posts: payload.posts }),
      },
    },
  });

  await assert.rejects(
    store.refresh(undefined, {
      fetchImpl: async () => jsonResponse({ posts: "not-an-array" }),
    }),
    ProjectionRefreshError,
  );
  assert.deepEqual(store.getSnapshot(), initial);
  assert.equal(store.getHealth().ready, false);

  await store.refresh(undefined, {
    fetchImpl: async () =>
      jsonResponse({ posts: [{ seq: 2, body: "validated" }] }),
  });
  assert.equal(store.getHealth().ready, true);
  assert.equal(store.getSnapshot().thread.posts[0].body, "validated");
});

test("projection store requires a JSON media type before parsing a successful response", async () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] } },
    coldLoads: {
      thread: {
        url: "/thread",
        validate: (payload) => Array.isArray(payload?.posts),
      },
    },
  });

  await assert.rejects(
    store.refresh(undefined, {
      fetchImpl: async () => jsonResponse({ posts: [] }, "text/html"),
    }),
    (error) =>
      error instanceof ProjectionRefreshError &&
      error.failures[0].reason === "invalid_content_type",
  );
  assert.equal(store.isReady(), false);

  await store.refresh(undefined, {
    fetchImpl: async () =>
      jsonResponse({ posts: [{ seq: 2 }] }, "application/problem+json"),
  });
  assert.equal(store.isReady(), true);
});

test("superseded refreshes cannot overwrite newer projection health or state", async () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] } },
    coldLoads: { thread: { url: "/thread" } },
  });
  const olderSuccess = deferred();
  const firstRefresh = store.refresh(undefined, {
    fetchImpl: async () => await olderSuccess.promise,
  });
  await store.refresh(undefined, {
    fetchImpl: async () => jsonResponse({ posts: [{ seq: 2, body: "newer" }] }),
  });
  olderSuccess.resolve(
    jsonResponse({ posts: [{ seq: 1, body: "older" }] }),
  );
  await assert.rejects(firstRefresh, (error) =>
    error instanceof ProjectionRefreshError &&
    error.failures[0].reason === "superseded_refresh",
  );
  assert.equal(store.getSnapshot().thread.posts[0].body, "newer");
  assert.equal(store.isReady(), true);

  const supersededSuccess = deferred();
  const thirdRefresh = store.refresh(undefined, {
    fetchImpl: async () => await supersededSuccess.promise,
  });
  await assert.rejects(
    store.refresh(undefined, {
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    ProjectionRefreshError,
  );
  supersededSuccess.resolve(
    jsonResponse({ posts: [{ seq: 3, body: "superseded" }] }),
  );
  await assert.rejects(thirdRefresh, ProjectionRefreshError);
  assert.equal(store.getSnapshot().thread.posts[0].body, "newer");
  assert.equal(store.isReady(), false);
});

test("a live payload supersedes an in-flight partial refresh without a stale overwrite", async () => {
  const pendingResponse = deferred();
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] }, votecount: [] },
    coldLoads: {
      thread: {
        url: "/thread",
        validate: (payload) => Array.isArray(payload?.posts),
      },
      votecount: { url: "/votecount" },
    },
  });

  const pendingRefresh = store.refresh("thread", {
    fetchImpl: async () => await pendingResponse.promise,
  });
  assert.equal(store.isReady(), false);
  assert.equal(store.getHealth().keys.thread.state, "refreshing");

  store.applyPayload("thread", {
    posts: [{ seq: 2, body: "newer live authority" }],
  });
  assert.equal(store.isReady(), true);
  pendingResponse.resolve(
    jsonResponse({ posts: [{ seq: 1, body: "stale refresh" }] }),
  );
  await assert.rejects(pendingRefresh, ProjectionRefreshError);
  assert.equal(store.getSnapshot().thread.posts[0].body, "newer live authority");
  assert.equal(store.isReady(), true);
});

test("a live payload superseding one key aborts the remaining refresh batch atomically", async () => {
  const threadResponse = deferred();
  const voteResponse = deferred();
  const initial = Object.freeze({
    thread: Object.freeze({ posts: Object.freeze([]) }),
    votecount: Object.freeze([]),
  });
  const store = createProjectionStore({
    initialSnapshot: initial,
    coldLoads: {
      thread: { url: "/thread" },
      votecount: { url: "/votecount" },
    },
  });

  const pendingRefresh = store.refresh(undefined, {
    fetchImpl: async (url) =>
      url.startsWith("/thread?")
        ? await threadResponse.promise
        : await voteResponse.promise,
  });
  store.applyPayload("votecount", [{ target: "slot-live", count: 4 }]);
  threadResponse.resolve(
    jsonResponse({ posts: [{ seq: 1, body: "stale batch" }] }),
  );
  voteResponse.resolve(
    jsonResponse([{ target: "slot-stale", count: 1 }]),
  );

  await assert.rejects(
    pendingRefresh,
    (error) =>
      error instanceof ProjectionRefreshError &&
      error.failures[0].reason === "superseded_refresh",
  );
  assert.equal(store.getSnapshot().thread, initial.thread);
  assert.deepEqual(store.getSnapshot().votecount, [
    { target: "slot-live", count: 4 },
  ]);
  assert.equal(store.getHealth().keys.thread.state, "unavailable");
  assert.equal(store.getHealth().keys.votecount.state, "ready");
  assert.equal(store.isReady(), false);
});

test("projection store invalidation is explicit and only a full refresh recovers", async () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] }, votecount: [] },
    coldLoads: {
      thread: { url: "/thread" },
      votecount: { url: "/votecount" },
    },
  });
  const observed = [];
  store.subscribeHealth((health) => observed.push(health.state));

  store.invalidate(undefined, { reason: "live_connection_lost" });
  assert.equal(store.isReady(), false);
  assert.equal(store.getHealth().reason, "live_connection_lost");

  await store.refresh("thread", {
    fetchImpl: async () => jsonResponse({ posts: [] }),
  });
  assert.equal(store.isReady(), false);

  await store.refresh(undefined, {
    fetchImpl: async (url) =>
      url.startsWith("/thread?")
        ? jsonResponse({ posts: [] })
        : jsonResponse([]),
  });
  assert.equal(store.isReady(), true);
  assert.deepEqual(observed, [
    "ready",
    "unavailable",
    "refreshing",
    "unavailable",
    "refreshing",
    "ready",
  ]);
});

test("authority revocation atomically applies only explicit cold-load purge values", () => {
  const publicProjection = Object.freeze({ posts: [{ seq: 1, body: "public" }] });
  const initialPrivateThread = Object.freeze({
    posts: Object.freeze([{ seq: 2, body: "private" }]),
  });
  let callbackContext = null;
  const store = createProjectionStore({
    initialSnapshot: {
      publicProjection,
      privateThread: initialPrivateThread,
      notifications: [{ effect: "Secret" }],
      host: { authority: { principalId: "host" }, tasks: [{ id: "prompt" }] },
    },
    coldLoads: {
      publicProjection: { url: "/public" },
      privateThread: {
        url: "/private-thread",
        revoke(previous, snapshot, context) {
          callbackContext = { previous, snapshot, context };
          return Object.freeze({ posts: Object.freeze([]) });
        },
      },
      notifications: { url: "/notifications", revoke: Object.freeze([]) },
      host: {
        url: "/host",
        revoke: Object.freeze({ authority: null, tasks: Object.freeze([]) }),
      },
    },
  });

  const snapshot = store.revokeAuthority({
    reason: "live_ticket_authorization_lost",
    status: 403,
  });

  assert.equal(snapshot.publicProjection, publicProjection);
  assert.deepEqual(snapshot.privateThread, { posts: [] });
  assert.deepEqual(snapshot.notifications, []);
  assert.deepEqual(snapshot.host, { authority: null, tasks: [] });
  assert.equal(callbackContext.previous, initialPrivateThread);
  assert.equal(callbackContext.snapshot.publicProjection, publicProjection);
  assert.deepEqual(callbackContext.context, {
    reason: "live_ticket_authorization_lost",
    status: 403,
  });
  assert.equal(store.isReady(), false);
  assert.equal(store.getHealth().reason, "live_ticket_authorization_lost");
  assert.equal(
    Object.values(store.getHealth().keys).every(({ state }) => state === "unavailable"),
    true,
  );
});

test("a failed atomic batch cannot promote an uncommitted successful key", async () => {
  const initial = { thread: { posts: [] }, votecount: [] };
  const store = createProjectionStore({
    initialSnapshot: initial,
    coldLoads: {
      thread: { url: "/thread" },
      votecount: { url: "/votecount" },
    },
  });
  store.invalidate(undefined, { reason: "socket_closed" });

  await assert.rejects(
    store.refresh(undefined, {
      fetchImpl: async (url) =>
        url.startsWith("/thread?")
          ? jsonResponse({ posts: [{ seq: 9 }] })
          : { ok: false, status: 503 },
    }),
    ProjectionRefreshError,
  );
  assert.equal(store.getHealth().keys.thread.state, "unavailable");
  assert.deepEqual(store.getSnapshot(), initial);

  await store.refresh("votecount", {
    fetchImpl: async () => jsonResponse([]),
  });
  assert.equal(store.getHealth().keys.votecount.state, "ready");
  assert.equal(store.getHealth().keys.thread.state, "unavailable");
  assert.equal(store.isReady(), false);
});

test("projection store applies server payloads through the registered normalizer", () => {
  const store = createProjectionStore({
    initialSnapshot: {
      host: {
        phase: { id: "D01" },
      },
    },
    coldLoads: {
      host: {
        url: "/host-console-state",
        normalize: (payload, previous) => ({
          ...previous,
          phase: { id: payload.phase.phase_id },
        }),
      },
    },
  });

  const snapshot = store.applyPayload("host", {
    phase: { phase_id: "D02" },
  });

  assert.deepEqual(snapshot.host, {
    phase: { id: "D02" },
  });
  assert.deepEqual(store.getSnapshot(), snapshot);
});

test("projection store defaults to the cold-load transport boundary honestly", () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] } },
  });

  assert.equal(store.liveTransport, COLD_LOAD_TRANSPORT_BOUNDARY);
  assert.equal(store.liveTransport.status, "cold-load-refresh-only");
  assert.match(store.liveTransport.proof, /not connected/);
});

test("projection subscribers cannot suppress peer delivery or store commits", () => {
  const store = createProjectionStore({ initialSnapshot: { thread: { posts: [] } } });
  const observed = [];
  store.subscribe(() => {
    throw new Error("view failed");
  });
  store.subscribe((snapshot) => observed.push(snapshot.thread.posts.length));
  store.applySnapshot({ thread: { posts: [{ seq: 1 }] } });
  assert.deepEqual(observed, [0, 1]);
  assert.equal(store.getSnapshot().thread.posts.length, 1);
});

test("projection store can be explicitly marked with the live transport boundary", () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] } },
    liveTransport: LIVE_TRANSPORT_BOUNDARY,
  });

  assert.equal(
    store.liveTransport.status,
    "cbor-ws-projection-deltas-with-resync-and-reconnect",
  );
  assert.match(store.liveTransport.proof, /exact protocol-v3 Hello/);
});

test("projection store applies live votecount clear envelopes", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      votecount: [{ target: "slot-2", count: 1, needed: 7 }],
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 2,
    body: {
      kind: "Delta",
      body: {
        kind: "VoteCountCleared",
        body: {
          game: "midsummer",
          phase_id: "D01",
          candidate_slot: "slot-2",
        },
      },
    },
  });

  assert.deepEqual(snapshot.votecount, []);
});

test("projection store applies live projection delta envelopes", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      votecount: [{ target: "slot-2", count: 1, needed: 7 }],
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 1,
    body: {
      kind: "Delta",
      body: {
        kind: "VoteCountChanged",
        body: {
          game: "midsummer",
          phase_id: "D01",
          candidate_slot: "slot-2",
          count: 2,
        },
      },
    },
  });

  assert.deepEqual(snapshot.votecount, [{ target: "slot-2", count: 2, needed: 7 }]);
});

test("projection mutation requires a registered validator or immutable scope", () => {
  const initialVotecount = Object.freeze([
    Object.freeze({ target: "slot-2", count: 1, needed: 7 }),
  ]);
  const store = createProjectionStore({
    initialSnapshot: { votecount: initialVotecount },
    coldLoads: { votecount: { url: "/votecount" } },
  });

  assert.throws(
    () =>
      store.applyLiveEnvelope({
    v: 3,
        id: 1,
        body: {
          kind: "Delta",
          body: {
            kind: "VoteCountChanged",
            body: {
              game: "midsummer",
              phase_id: "D01",
              candidate_slot: "slot-2",
              count: 9,
            },
          },
        },
      }),
    /requires a registered validator or immutable expected scope/,
  );
  assert.equal(store.getSnapshot().votecount, initialVotecount);
  assert.equal(store.isReady(), false);
});

test("immutable store scope rejects wrong-game and wrong-channel rows before mutation", () => {
  for (const body of [
    {
      game: "another-game",
      posts: [
        canonicalThreadPost({
          game: "another-game",
          channel_id: "main",
          source_seq: 7,
          stream_seq: 7,
          body: "wrong game",
        }),
      ],
    },
    {
      game: "midsummer",
      posts: [
        canonicalThreadPost({
          channel_id: "private:mafia_day_chat",
          source_seq: 8,
          stream_seq: 8,
          body: "wrong channel",
        }),
      ],
    },
  ]) {
    const initialThread = Object.freeze({ posts: Object.freeze([]) });
    const store = createProjectionStore({
      expectedScope: { game: "midsummer", channel: "main" },
      initialSnapshot: { thread: initialThread },
      coldLoads: { thread: { url: "/thread" } },
    });

    assert.throws(
      () =>
        store.applyLiveEnvelope({
    v: 3,
          id: 2,
          body: {
            kind: "Delta",
            body: { kind: "ThreadPostsChanged", body },
          },
        }),
      /does not match connection (scope|channel)|game mismatch/,
    );
    assert.equal(store.getSnapshot().thread, initialThread);
    assert.equal(store.isReady(), true);
  }
});

test("projection store applies live thread post envelopes into the player thread", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      thread: {
        nextBeforeSeq: 40,
        posts: [{ seq: 42, author: { kind: "slot", slotId: "slot-7" }, body: "before" }],
      },
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 7,
    body: {
      kind: "Delta",
      body: {
        kind: "ThreadPostsChanged",
        body: {
          game: "midsummer",
          posts: [
            canonicalThreadPost({
              game: "midsummer",
              channel_id: "main",
              source_seq: 43,
              stream_seq: 9,
              body: "Official votecount for D01",
              media: [
                {
                  content_id: "d".repeat(64),
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
        },
      },
    },
  });

  assert.equal(snapshot.thread.nextBeforeSeq, 40);
  assert.deepEqual(
    snapshot.thread.posts.map((post) => [post.seq, post.author, post.body]),
    [
      [42, { kind: "slot", slotId: "slot-7" }, "before"],
      [43, { kind: "host_narrator" }, "Official votecount for D01"],
    ],
  );
  assert.equal(
    snapshot.thread.posts[1].media[0].variants.tablet.webpUrl,
    "/media/thread/43/tablet.webp",
  );
});

test("projection store applies live host-console state envelopes through the host normalizer", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      host: {
        phase: { id: "D01", lockedLabel: "Thread open" },
      },
    },
    coldLoads: {
      host: {
        url: "/host-console-state",
        normalize: (payload, previous) => ({
          ...previous,
          phase: {
            ...previous.phase,
            id: payload.phase.phase_id,
            lockedLabel: payload.phase.locked ? "Thread locked" : "Thread open",
          },
        }),
      },
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 3,
    body: {
      kind: "Delta",
      body: {
        kind: "HostConsoleStateChanged",
        body: canonicalHostStateBody({
          phase: { phase_id: "D02", locked: true, deadline: null },
        }),
      },
    },
  });

  assert.deepEqual(snapshot.host.phase, {
    id: "D02",
    lockedLabel: "Thread locked",
  });
});

test("projection store rejects live host authority changes before committing them", () => {
  const initialHost = Object.freeze({
    authority: Object.freeze({
      principalId: "host_morgan",
      capabilityKind: "HostOf",
      allowedClasses: Object.freeze([]),
      deniedClasses: Object.freeze([]),
    }),
    completed: false,
    phase: Object.freeze({ id: "D01", locked: false }),
    slots: Object.freeze([]),
    threadPosts: Object.freeze([]),
  });
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: { host: initialHost },
    coldLoads: {
      host: {
        url: "/host-console-state",
        validateNormalized: (projection) =>
          projection?.authority?.principalId === "host_morgan" &&
          projection?.authority?.capabilityKind === "HostOf",
      },
    },
  });

  assert.throws(
    () =>
      store.applyLiveEnvelope({
    v: 3,
        id: 9,
        body: {
          kind: "Delta",
          body: {
            kind: "HostConsoleHeaderChanged",
            body: {
              game: "midsummer",
              authority: {
                principal_id: "host_intruder",
                capability: "HostOf",
                allowed_classes: [],
                denied_classes: [],
              },
              completed: false,
              phase: { phase_id: "D02", locked: false, deadline: null },
            },
          },
        },
      }),
      /normalized projection for host failed validation|Cannot read properties of undefined/,
  );
  assert.equal(store.getSnapshot().host, initialHost);
  assert.equal(store.isReady(), false);
  assert.equal(store.getHealth().reason, "invalid_live_projection_payload");
  assert.equal(store.getHealth().keys.host.state, "unavailable");
});

test("projection store applies live host-prompt envelopes through the prompt normalizer", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      hostPrompts: [{ id: "D01:skip_next_day:slot_1", status: "pending" }],
    },
    coldLoads: {
      hostPrompts: {
        url: "/host-prompts",
        normalize: (payload) =>
          payload.map((prompt) => ({
            id: prompt.prompt_id,
            status: prompt.status,
          })),
      },
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 4,
    body: {
      kind: "Delta",
      body: {
        kind: "HostPromptsChanged",
        body: {
          game: "midsummer",
          prompts: [
            {
              prompt_id: "D01:skip_next_day:slot_1",
              status: "resolved",
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(snapshot.hostPrompts, [
    { id: "D01:skip_next_day:slot_1", status: "resolved" },
  ]);
});

test("projection store applies live day-vote outcome envelopes through the outcome normalizer", () => {
  const store = createProjectionStore({
    expectedScope: { game: "midsummer", channel: "main" },
    initialSnapshot: {
      dayVoteOutcomes: [],
    },
    coldLoads: {
      dayVoteOutcomes: {
        url: "/day-vote-outcomes",
        normalize: (payload, previous) => [
          ...previous,
          {
            phaseId: payload.phase_id,
            winnerSlot: payload.winner_slot,
          },
        ],
      },
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 5,
    body: {
      kind: "Delta",
      body: {
        kind: "DayVoteOutcomeApplied",
        body: canonicalDayVoteOutcome(),
      },
    },
  });

  assert.deepEqual(snapshot.dayVoteOutcomes, [
    { phaseId: "D01", winnerSlot: "slot-2" },
  ]);
});

test("projection store applies live player-private envelopes through scoped normalizers", () => {
  const validatedDeltaKinds = [];
  const store = createProjectionStore({
    initialSnapshot: {
      notifications: [],
      investigationResults: [],
    },
    coldLoads: {
      notifications: {
        url: "/notifications",
        validateLiveDelta: (delta) => {
          validatedDeltaKinds.push(delta.kind);
          return delta.body?.game === "midsummer";
        },
        normalize: (payload) => payload.map((row) => ({ effect: row.effect })),
      },
      investigationResults: {
        url: "/investigation-results",
        validateLiveDelta: (delta) => {
          validatedDeltaKinds.push(delta.kind);
          return delta.body?.game === "midsummer";
        },
        normalize: (payload) => payload.map((row) => ({ mode: row.mode })),
      },
    },
  });

  store.applyLiveEnvelope({
    v: 3,
    id: 5,
    body: {
      kind: "Delta",
      body: {
        kind: "PlayerNotificationsChanged",
        body: {
          game: "midsummer",
          notifications: [canonicalNotification({ effect: "Neighborized" })],
        },
      },
    },
  });
  const snapshot = store.applyLiveEnvelope({
    v: 3,
    id: 6,
    body: {
      kind: "Delta",
      body: {
        kind: "PlayerInvestigationResultsChanged",
        body: {
          game: "midsummer",
          results: [canonicalInvestigationResult({ mode: "cop" })],
        },
      },
    },
  });

  assert.deepEqual(snapshot.notifications, [{ effect: "Neighborized" }]);
  assert.deepEqual(snapshot.investigationResults, [{ mode: "cop" }]);
  assert.deepEqual(validatedDeltaKinds, [
    "PlayerNotificationsChanged",
    "PlayerInvestigationResultsChanged",
  ]);
});

test("projection store rejects player-private live rows before extraction", () => {
  const initialNotifications = Object.freeze([{ effect: "trusted" }]);
  const store = createProjectionStore({
    initialSnapshot: { notifications: initialNotifications },
    coldLoads: {
      notifications: {
        url: "/notifications",
        validateLiveDelta: (delta) => delta.body?.game === "midsummer",
        normalize: (payload) => payload.map((row) => ({ effect: row.effect })),
      },
    },
  });

  assert.throws(
    () =>
      store.applyLiveEnvelope({
    v: 3,
        id: 7,
        body: {
          kind: "Delta",
          body: {
            kind: "PlayerNotificationsChanged",
            body: {
              game: "another-game",
              notifications: [
                canonicalNotification({
                  game: "another-game",
                  effect: "forged",
                }),
              ],
            },
          },
        },
      }),
    /live projection delta for notifications failed validation/,
  );
  assert.equal(store.getSnapshot().notifications, initialNotifications);
  assert.equal(store.isReady(), false);
});

function jsonResponse(body, contentType = "application/json") {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      },
    },
    async json() {
      return body;
    },
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
      principal_id: "host_morgan",
      capability: "HostOf",
      allowed_classes: [],
      denied_classes: [],
    },
    completed: false,
    phase: { phase_id: "D01", locked: false, deadline: null },
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

function canonicalNotification(overrides = {}) {
  return {
    game: "midsummer",
    phase_id: "N01",
    event_index: 0,
    audience_slot: "slot-7",
    effect: "Neighborized",
    status: "Delivered",
    ...overrides,
  };
}

function canonicalInvestigationResult(overrides = {}) {
  return {
    game: "midsummer",
    phase_id: "N01",
    event_index: 0,
    audience_slot: "slot-7",
    mode: "cop",
    target_slot: "slot-2",
    result: "Town",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
