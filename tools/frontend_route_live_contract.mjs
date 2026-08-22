import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachLiveProjectionPageLifecycle,
  connectLiveProjection,
  encodeServerEnvelopeFrame,
  liveProjectionReconnectDelayMs,
} from "../frontend/src/lib/app/live-transport.mjs";
import {
  createProjectionStore,
} from "../frontend/src/lib/app/projection-store.mjs";
import {
  FIXTURE_PRINCIPAL_IDS,
} from "../frontend/src/lib/principal-id.mjs";
import {
  buildGameRouteData,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  buildPlayerProjectionColdLoads,
  buildPlayerProjectionInitialSnapshot,
  persistPlayerInterruptedCommands,
  playerResyncKeys,
  restorePlayerInterruptedCommands,
} from "../frontend/src/routes/g/[game]/player-route-controller.mjs";
import {
  recordPlayerLiveProjectionEvent,
} from "../frontend/src/routes/g/[game]/player-route-browser-bridge.mjs";
import {
  buildHostConsoleRouteData,
} from "../frontend/src/routes/g/[game]/host/host-route-model.mjs";
import {
  buildHostProjectionColdLoads,
  buildHostProjectionInitialSnapshot,
  hostProjectionResyncKeys,
  persistHostInterruptedCommands,
  restoreHostInterruptedCommands,
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  recordHostLiveProjectionEvent,
} from "../frontend/src/routes/g/[game]/host/host-route-browser-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.resolve(
  process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(repoRoot, "target", "frontend-route-live-contract"),
);
const evidencePath = path.join(artifactDir, "route-live-contract.json");

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

const evidence = {
  status: "passed",
  proof: "frontend-route-live-contract",
  boundary:
    "No-browser route-live contract. It source-checks the player and moderator Svelte pages for their onMount live projection connection, page-lifecycle reconnect owner, and interrupted-command storage, then drives the same projection-store, live-transport, and browser-bridge adapters with fake WebSocket frames, visibility/online/pageshow wakes, exponential close backoff, and sessionStorage command-id restore. It does not prove TCP delivery, browser hydration scheduling, focus traversal, CSS geometry, screenshots, or localhost-backed acceptance.",
  generatedFrom: {
    playerRoutePage: "frontend/src/routes/g/[game]/+page.svelte",
    moderatorRoutePage: "frontend/src/routes/g/[game]/host/+page.svelte",
    liveTransport: "frontend/src/lib/app/live-transport.mjs",
    projectionStore: "frontend/src/lib/app/projection-store.mjs",
    commandRecoveryStorage: "frontend/src/lib/app/command-recovery-storage.mjs",
  },
  sources: {
    player: await provePlayerRouteSource(),
    moderator: await proveModeratorRouteSource(),
  },
  runtime: {
    player: await provePlayerLiveRuntime(),
    moderator: await proveModeratorLiveRuntime(),
    playerLifecycle: await provePlayerPageLifecycle(),
    moderatorLifecycle: await proveModeratorPageLifecycle(),
    playerCommandRecovery: await provePlayerCommandRecovery(),
    moderatorCommandRecovery: await proveModeratorCommandRecovery(),
  },
};

await mkdir(artifactDir, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);

async function provePlayerRouteSource() {
  const source = await readRouteSource("frontend/src/routes/g/[game]/+page.svelte");
  assertSourceOwnsLiveConnection(source, {
    role: "player",
    endpointExpression: "data.liveProjection.endpoint",
    eventRecorder: "recordPlayerLiveProjectionEvent",
    resyncTrigger: "triggerPlayerLiveProjectionResync",
    windowTrigger: "__fmarchTriggerPlayerResync",
    metricsGetter: "__fmarchGetPlayerLiveProjectionMetrics",
  });
  assert.match(source, /buildPlayerProjectionInitialSnapshot\(data\)/);
  assert.match(source, /buildPlayerProjectionColdLoads\(data\)/);
  assert.match(source, /playerResyncKeys\(data\)/);
  assert.match(source, /endgameSummary = snapshot\.endgameSummary/);
  assert.match(source, /attachLiveProjectionPageLifecycle/);
  assert.match(source, /restorePlayerInterruptedCommands/);
  assert.match(source, /persistPlayerInterruptedCommands/);
  assert.match(source, /window\.sessionStorage/);
  return {
    route: "frontend/src/routes/g/[game]/+page.svelte",
    onMountConnects: true,
    pageLifecycleOwner: "attachLiveProjectionPageLifecycle",
    commandRecoveryRestore: "restorePlayerInterruptedCommands",
    endpointExpression: "data.liveProjection.endpoint",
    projectionStoreFactory: "createProjectionStore",
    resyncWindowHook: "__fmarchTriggerPlayerResync",
  };
}

async function proveModeratorRouteSource() {
  const source = await readRouteSource("frontend/src/routes/g/[game]/host/+page.svelte");
  assertSourceOwnsLiveConnection(source, {
    role: "moderator",
    endpointExpression: "data.liveProjection.endpoint",
    eventRecorder: "recordHostLiveProjectionEvent",
    resyncTrigger: "triggerHostLiveProjectionResync",
    windowTrigger: "__fmarchTriggerHostResync",
    metricsGetter: "__fmarchGetHostLiveProjectionMetrics",
  });
  assert.match(source, /buildHostProjectionInitialSnapshot\(data\)/);
  assert.match(source, /buildHostProjectionColdLoads\(data\)/);
  assert.match(source, /hostProjectionResyncKeys\(\)/);
  assert.match(source, /exposeHostLiveProjectionEndpoint/);
  assert.match(source, /attachLiveProjectionPageLifecycle/);
  assert.match(source, /restoreHostInterruptedCommands/);
  assert.match(source, /persistHostInterruptedCommands/);
  assert.match(source, /window\.sessionStorage/);
  return {
    route: "frontend/src/routes/g/[game]/host/+page.svelte",
    onMountConnects: true,
    pageLifecycleOwner: "attachLiveProjectionPageLifecycle",
    commandRecoveryRestore: "restoreHostInterruptedCommands",
    endpointExpression: "data.liveProjection.endpoint",
    projectionStoreFactory: "createProjectionStore",
    resyncWindowHook: "__fmarchTriggerHostResync",
    endpointExposedForSmoke: "__fmarchHostLiveProjectionEndpoint",
  };
}

function assertSourceOwnsLiveConnection(
  source,
  { endpointExpression, eventRecorder, resyncTrigger, windowTrigger, metricsGetter },
) {
  assert.match(source, /import \{ onMount \} from "svelte"/);
  assert.match(source, /connectLiveProjection/);
  assert.match(source, /LIVE_PROJECTION_CONNECTING_STATUS/);
  assert.match(source, /createProjectionStore/);
  assert.match(source, new RegExp(escapeRegExp(`url: ${endpointExpression}`)));
  assert.match(source, new RegExp(`${eventRecorder}\\(`));
  assert.match(source, new RegExp(`${resyncTrigger}\\(`));
  assert.match(source, new RegExp(`window\\.${escapeRegExp(windowTrigger)}`));
  assert.match(source, new RegExp(`window\\.${escapeRegExp(metricsGetter)}`));
  assert.match(source, /return \(\) => \{/);
  assert.match(source, /pageLifecycle\?\.detach\(\)/);
  assert.match(source, /connection\?\.close\(\)/);
}

async function provePlayerLiveRuntime() {
  FakeWebSocket.last = null;
  const data = await buildGameRouteData({
    game: "midsummer",
    principalId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
    ],
  });
  const store = createProjectionStore({
    initialSnapshot: buildPlayerProjectionInitialSnapshot(data),
    coldLoads: buildPlayerProjectionColdLoads(data),
    liveTransport: data.projectionBoundary,
  });
  const windowRef = {};
  let liveStatus = { state: "connecting", message: "Connecting live projection" };
  const events = [];
  const connection = connectLiveProjection({
    url: data.liveProjection.endpoint,
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: responseMap({
      [data.liveProjection.endpoint]: {
        url: "ws://fmarch.local/ws?ticket=player-proof&audience=fmarch-live",
      },
      [data.coldLoad.threadEndpoint]: {
        next_before_seq: 449,
        posts: [
          {
            source_seq: 450,
            stream_seq: 50,
            author: { kind: "host_narrator" },
            body: "Recovered official update",
            occurred_at: 1781928000,
          },
        ],
      },
      [data.coldLoad.votecountEndpoint]: [
        {
          VoteCountChanged: {
            candidate_slot: "slot-2",
            count: 5,
            majority: 7,
          },
        },
      ],
      [data.coldLoad.dayVoteOutcomesEndpoint]: [],
      [data.coldLoad.endgameSummaryEndpoint]: {
        completed: true,
        winner: null,
        slots: [
          {
            slot_id: "slot-7",
            alive: true,
            status: "alive",
            role_key: "godfather",
            alignment: "mafia",
            role_revealed: true,
            alignment_revealed: true,
          },
        ],
        vote_history: [
          {
            phase_id: "D01",
            source_seq: 31,
            event_index: 0,
            status: "NoLynch",
            winner_slot: null,
            tallies: { no_lynch: 2 },
            votes: { "slot-2": "no_lynch", "slot-3": "no_lynch" },
            majority: 2,
            reason: null,
          },
        ],
        boundary: "Completed summary recovered through live resync.",
      },
      [data.coldLoad.notificationsEndpoint]: [
        { effect: "Commuted", phase_id: "N02", status: "Delivered" },
      ],
      [data.coldLoad.investigationResultsEndpoint]: [],
      [data.coldLoad.commandStateEndpoint]: {
        game: "midsummer",
        actor_slot: "slot-7",
        actor_alive: true,
        actor_status: "alive",
        phase: {
          phase_id: "D02",
          phase_kind: "Day",
          phase_number: 2,
          locked: false,
        },
        actions: [],
        vote_targets: [],
      },
    }),
    resyncKeys: playerResyncKeys(data),
    onEvent(message, snapshot) {
      events.push(message);
      liveStatus = recordPlayerLiveProjectionEvent({
        windowRef,
        message,
        snapshot,
        currentStatus: liveStatus,
      });
    },
  });

  assert.notEqual(connection, null);
  await waitForFakeSocket();
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", liveEnvelope("Hello", { protocol_v: 2 }));
  await FakeWebSocket.last.emit(
    "message",
    liveEnvelope("Delta", {
      kind: "ThreadPostsChanged",
      body: {
        posts: [
          {
            source_seq: 445,
            stream_seq: 45,
            author: { kind: "host_narrator" },
            body: "Live official votecount",
            occurred_at: 1781928000,
          },
        ],
      },
    }),
  );
  await FakeWebSocket.last.emit(
    "message",
    liveEnvelope("Delta", {
      kind: "ResyncRequired",
      body: { from_seq: 44 },
    }),
  );
  connection.close();

  assert.deepEqual(
    events.map((event) => event?.kind),
    ["open", "hello", "delta", "resync-required"],
  );
  assert.equal(windowRef.__fmarchLiveProjectionStatus.state, "recovered");
  assert.equal(windowRef.__fmarchPlayerProjection.thread.posts[0].seq, 450);
  assert.equal(windowRef.__fmarchPlayerProjection.endgameSummary.completed, true);
  assert.equal(
    windowRef.__fmarchPlayerProjection.endgameSummary.slots[0].roleKey,
    "godfather",
  );
  assert.deepEqual(
    windowRef.__fmarchPlayerProjection.endgameSummary.voteHistory[0].votes,
    { "slot-2": "no_lynch", "slot-3": "no_lynch" },
  );
  assert.deepEqual(playerResyncKeys(data), [
    "thread",
    "votecount",
    "dayVoteOutcomes",
    "endgameSummary",
    "notifications",
    "investigationResults",
    "commandState",
  ]);

  return {
    endpoint: data.liveProjection.endpoint,
    websocketUrl: FakeWebSocket.last.url,
    liveTransportStatus: store.liveTransport.status,
    resyncKeys: playerResyncKeys(data),
    eventKinds: events.map((event) => event?.kind),
    finalStatus: windowRef.__fmarchLiveProjectionStatus,
    recoveredThreadSeq: windowRef.__fmarchPlayerProjection.thread.posts[0].seq,
    recoveredEndgameSummary: windowRef.__fmarchPlayerProjection.endgameSummary,
    exposureKey: "__fmarchPlayerProjection",
  };
}

async function proveModeratorLiveRuntime() {
  FakeWebSocket.last = null;
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalId: FIXTURE_PRINCIPAL_IDS.hostH,
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
  });
  const store = createProjectionStore({
    initialSnapshot: buildHostProjectionInitialSnapshot(data),
    coldLoads: buildHostProjectionColdLoads(data),
    liveTransport: data.projectionBoundary,
  });
  const windowRef = {};
  let liveStatus = { state: "connecting", message: "Connecting live projection" };
  const events = [];
  const connection = connectLiveProjection({
    url: data.liveProjection.endpoint,
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: responseMap({
      [data.liveProjection.endpoint]: {
        url: "ws://fmarch.local/ws?ticket=host-proof&audience=fmarch-live",
      },
      [data.hostConsoleStateEndpoint]: {
        phase: { phase_id: "D02", locked: true },
        slots: [
          {
            slot_id: "slot-7",
            assigned_principal_id: "Mira",
            status: "modkilled",
            alive: false,
          },
        ],
        thread_posts: [{ author: { kind: "slot", slot_id: "slot-7" } }],
      },
      [data.hostVotecountEndpoint]: [
        {
          VoteCountChanged: {
            candidate_slot: "slot-7",
            count: 0,
            majority: 7,
          },
        },
      ],
      [data.dayVoteOutcomesEndpoint]: [],
      [data.hostPromptEndpoint]: [],
    }),
    resyncKeys: hostProjectionResyncKeys(),
    onEvent(message, snapshot) {
      events.push(message);
      liveStatus = recordHostLiveProjectionEvent({
        windowRef,
        message,
        snapshot,
        currentStatus: liveStatus,
      });
    },
  });

  assert.notEqual(connection, null);
  await waitForFakeSocket();
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", liveEnvelope("Hello", { protocol_v: 2 }));
  await FakeWebSocket.last.emit(
    "message",
    liveEnvelope("Delta", {
      kind: "HostPromptsChanged",
      body: { prompts: [] },
    }),
  );
  await FakeWebSocket.last.emit(
    "message",
    liveEnvelope("Delta", {
      kind: "ResyncRequired",
      body: { from_seq: 88 },
    }),
  );
  connection.close();

  assert.deepEqual(
    events.map((event) => event?.kind),
    ["open", "hello", "delta", "resync-required"],
  );
  assert.equal(windowRef.__fmarchHostLiveProjectionStatus.state, "recovered");
  assert.deepEqual(hostProjectionResyncKeys(), [
    "host",
    "votecount",
    "dayVoteOutcomes",
    "hostPrompts",
  ]);
  assert.deepEqual(windowRef.__fmarchHostPromptsProjection, []);

  return {
    endpoint: data.liveProjection.endpoint,
    websocketUrl: FakeWebSocket.last.url,
    liveTransportStatus: store.liveTransport.status,
    resyncKeys: hostProjectionResyncKeys(),
    eventKinds: events.map((event) => event?.kind),
    finalStatus: windowRef.__fmarchHostLiveProjectionStatus,
    recoveredPromptCount: windowRef.__fmarchHostPromptsProjection.length,
    exposureKey: "__fmarchHostLiveProjectionEvents",
  };
}

async function provePlayerPageLifecycle() {
  return await proveRolePageLifecycle({
    role: "player",
    game: "midsummer",
    endpoint: "/live/tickets?game=midsummer",
    resyncKeys: ["thread"],
    ticketUrl: "wss://fmarch.local/ws?ticket=player-wake&audience=fmarch-live",
    refreshBody: {
      next_before_seq: 449,
      posts: [
        {
          source_seq: 451,
          author: { kind: "host_narrator" },
          body: "Woke player thread",
        },
      ],
    },
    recoveredSeq: (snapshot) => snapshot.thread.posts[0].source_seq,
  });
}

async function proveModeratorPageLifecycle() {
  return await proveRolePageLifecycle({
    role: "moderator",
    game: "midsummer",
    endpoint: "/live/tickets?game=midsummer&slot_id=slot-7",
    resyncKeys: ["host"],
    ticketUrl: "wss://fmarch.local/ws?ticket=host-wake&audience=fmarch-live",
    refreshBody: {
      phase: { phase_id: "D02", locked: true },
      slots: [],
      thread_posts: [],
    },
    recoveredSeq: (snapshot) => snapshot.host.phase.phase_id,
  });
}

async function proveRolePageLifecycle({
  role,
  endpoint,
  resyncKeys,
  ticketUrl,
  refreshBody,
  recoveredSeq,
}) {
  FakeWebSocket.last = null;
  FakeWebSocket.instances = [];
  const scheduled = [];
  const events = [];
  const tickets = [];
  const store = createProjectionStore({
    initialSnapshot: {
      thread: { posts: [] },
      host: { phase: { id: "D01" } },
      votecount: [],
      dayVoteOutcomes: [],
      hostPrompts: [],
    },
    coldLoads: {
      thread: {
        url: "/games/midsummer/thread",
        normalize: (payload) => payload,
      },
      host: {
        url: "/games/midsummer/host-console-state",
        normalize: (payload) => payload,
      },
    },
  });
  const documentRef = fakeEventTarget({ visibilityState: "visible" });
  const windowRef = fakeEventTarget({ document: documentRef });
  const connection = connectLiveProjection({
    url: endpoint,
    projectionStore: store,
    WebSocketCtor: FakeWebSocket,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/live/tickets")) {
        tickets.push(url);
        return jsonResponse({ url: `${ticketUrl}&n=${tickets.length}` });
      }
      return jsonResponse(refreshBody);
    },
    resyncKeys,
    reconnectDelayMs: 42,
    scheduleReconnect(callback, delayMs) {
      scheduled.push({ callback, delayMs });
      return scheduled.length;
    },
    onEvent(message) {
      events.push(message);
    },
  });
  await waitForFakeSocket();
  await FakeWebSocket.last.emit("open");

  const lifecycle = attachLiveProjectionPageLifecycle({
    connection,
    target: windowRef,
    documentRef,
  });
  documentRef.visibilityState = "hidden";
  documentRef.emit("visibilitychange");
  assert.equal(tickets.length, 1);
  documentRef.visibilityState = "visible";
  documentRef.emit("visibilitychange");
  await waitFor(() => FakeWebSocket.instances.length === 2);
  await FakeWebSocket.last.emit("open");
  windowRef.emit("online");
  await waitFor(() => FakeWebSocket.instances.length === 3);
  await FakeWebSocket.last.emit("open");
  windowRef.emit("pageshow", { persisted: false });
  assert.equal(FakeWebSocket.instances.length, 3);
  windowRef.emit("pageshow", { persisted: true });
  await waitFor(() => FakeWebSocket.instances.length === 4);
  await FakeWebSocket.last.emit("open");

  FakeWebSocket.last.emit("close");
  assert.equal(scheduled[0].delayMs, 42);
  scheduled[0].callback();
  await waitFor(() => FakeWebSocket.instances.length === 5);
  FakeWebSocket.last.emit("close");
  assert.equal(scheduled[1].delayMs, 84);

  lifecycle.detach();
  connection.close();

  const wakeReasons = events
    .filter((event) => event?.kind === "reconnecting" && event.reason !== "close")
    .map((event) => event.reason);
  assert.deepEqual(wakeReasons, ["visibilitychange", "online", "pageshow"]);
  assert.equal(liveProjectionReconnectDelayMs(0, 42), 42);
  assert.equal(liveProjectionReconnectDelayMs(1, 42), 84);

  return {
    role,
    wakeReasons,
    ticketCount: tickets.length,
    genericCloseBackoffMs: [scheduled[0].delayMs, scheduled[1].delayMs],
    recoveredAfterWake: recoveredSeq(store.getSnapshot()),
    reconnectPolicy: "exponential-backoff-on-close-immediate-on-page-lifecycle",
  };
}

async function provePlayerCommandRecovery() {
  const storage = memoryStorage();
  persistPlayerInterruptedCommands({
    storage,
    game: "midsummer",
    attempts: {
      submit_vote: {
        commandId: "player-live-command-1",
        action: "submit_vote",
        interruption: "connection_lost",
        data: { staleRoute: true },
      },
    },
  });
  const restored = restorePlayerInterruptedCommands({
    storage,
    game: "midsummer",
  });
  assert.equal(restored.attempts.submit_vote.commandId, "player-live-command-1");
  assert.equal(restored.attempts.submit_vote.data, undefined);
  assert.equal(restored.commandStatus.commandId, "player-live-command-1");
  return {
    surface: "player",
    persistedCommandId: "player-live-command-1",
    restoredCommandId: restored.commandStatus.commandId,
    droppedRouteData: restored.attempts.submit_vote.data === undefined,
  };
}

async function proveModeratorCommandRecovery() {
  const storage = memoryStorage();
  persistHostInterruptedCommands({
    storage,
    game: "midsummer",
    attempts: {
      extend_deadline: {
        commandId: "host-live-command-1",
        actionId: "extend_deadline",
        interruption: "timeout",
        event: { actionId: "extend_deadline", hours: 12 },
      },
    },
  });
  const restored = restoreHostInterruptedCommands({
    storage,
    game: "midsummer",
  });
  assert.equal(
    restored.commandStatuses.extend_deadline.commandId,
    "host-live-command-1",
  );
  return {
    surface: "moderator",
    persistedCommandId: "host-live-command-1",
    restoredCommandId: restored.commandStatuses.extend_deadline.commandId,
    restoredActionId: restored.attempts.extend_deadline.event.actionId,
  };
}

async function readRouteSource(relativePath) {
  return await readFile(path.join(repoRoot, relativePath), "utf8");
}

function responseMap(bodiesByUrl) {
  return async (url) => {
    const body = bodiesByUrl[stripProjectionRefreshParam(url)];
    assert.notEqual(body, undefined, `unexpected refresh URL ${url}`);
    return {
      ok: true,
      async json() {
        return body;
      },
    };
  };
}

function stripProjectionRefreshParam(url) {
  const parsed = new URL(String(url), "http://fmarch.local");
  parsed.searchParams.delete("_fmarch_projection_refresh");
  return `${parsed.pathname}${parsed.search}`;
}

async function waitForFakeSocket() {
  for (let attempt = 0; attempt < 10 && FakeWebSocket.last === null; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.notEqual(FakeWebSocket.last, null, "live ticket should open a websocket");
}

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("condition did not settle");
}

function liveEnvelope(kind, body) {
  return {
    data: encodeServerEnvelopeFrame({
      v: 2,
      id: 1,
      body: {
        kind,
        body,
      },
    }),
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
