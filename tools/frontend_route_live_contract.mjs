import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  connectLiveProjection,
} from "../frontend/src/lib/app/live-transport.mjs";
import {
  createProjectionStore,
} from "../frontend/src/lib/app/projection-store.mjs";
import {
  buildGameRouteData,
} from "../frontend/src/routes/g/[game]/game-route-model.mjs";
import {
  buildPlayerProjectionColdLoads,
  buildPlayerProjectionInitialSnapshot,
  playerResyncKeys,
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
} from "../frontend/src/routes/g/[game]/host/host-route-controller.mjs";
import {
  recordHostLiveProjectionEvent,
} from "../frontend/src/routes/g/[game]/host/host-route-browser-bridge.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "frontend-route-live-contract");
const evidencePath = path.join(artifactDir, "route-live-contract.json");

class FakeWebSocket {
  static last = null;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeWebSocket.last = this;
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
    "No-browser route-live contract. It source-checks the player and moderator Svelte pages for their onMount live projection connection, then drives the same projection-store, live-transport, and browser-bridge adapters with fake WebSocket frames. It does not prove TCP delivery, browser hydration scheduling, focus traversal, CSS geometry, screenshots, or localhost-backed acceptance.",
  generatedFrom: {
    playerRoutePage: "frontend/src/routes/g/[game]/+page.svelte",
    moderatorRoutePage: "frontend/src/routes/g/[game]/host/+page.svelte",
    liveTransport: "frontend/src/lib/app/live-transport.mjs",
    projectionStore: "frontend/src/lib/app/projection-store.mjs",
  },
  sources: {
    player: await provePlayerRouteSource(),
    moderator: await proveModeratorRouteSource(),
  },
  runtime: {
    player: await provePlayerLiveRuntime(),
    moderator: await proveModeratorLiveRuntime(),
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
  });
  assert.match(source, /buildPlayerProjectionInitialSnapshot\(data\)/);
  assert.match(source, /buildPlayerProjectionColdLoads\(data\)/);
  assert.match(source, /playerResyncKeys\(data\)/);
  assert.match(source, /endgameSummary = snapshot\.endgameSummary/);
  return {
    route: "frontend/src/routes/g/[game]/+page.svelte",
    onMountConnects: true,
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
  });
  assert.match(source, /buildHostProjectionInitialSnapshot\(data\)/);
  assert.match(source, /buildHostProjectionColdLoads\(data\)/);
  assert.match(source, /hostProjectionResyncKeys\(\)/);
  assert.match(source, /exposeHostLiveProjectionEndpoint/);
  return {
    route: "frontend/src/routes/g/[game]/host/+page.svelte",
    onMountConnects: true,
    endpointExpression: "data.liveProjection.endpoint",
    projectionStoreFactory: "createProjectionStore",
    resyncWindowHook: "__fmarchTriggerHostResync",
    endpointExposedForSmoke: "__fmarchHostLiveProjectionEndpoint",
  };
}

function assertSourceOwnsLiveConnection(
  source,
  { endpointExpression, eventRecorder, resyncTrigger, windowTrigger },
) {
  assert.match(source, /import \{ onMount \} from "svelte"/);
  assert.match(source, /connectLiveProjection/);
  assert.match(source, /LIVE_PROJECTION_CONNECTING_STATUS/);
  assert.match(source, /createProjectionStore/);
  assert.match(source, new RegExp(escapeRegExp(`url: ${endpointExpression}`)));
  assert.match(source, new RegExp(`${eventRecorder}\\(`));
  assert.match(source, new RegExp(`${resyncTrigger}\\(`));
  assert.match(source, new RegExp(`window\\.${escapeRegExp(windowTrigger)}`));
  assert.match(source, /return \(\) => \{/);
  assert.match(source, /connection\?\.close\(\)/);
}

async function provePlayerLiveRuntime() {
  const data = await buildGameRouteData({
    game: "midsummer",
    principalUserId: "player_mira",
    capabilities: [
      { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
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
      [data.coldLoad.threadEndpoint]: {
        next_before_seq: 449,
        posts: [
          {
            source_seq: 450,
            stream_seq: 50,
            author_user: "host",
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
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", liveEnvelope("Hello", { protocol_v: 1 }));
  await FakeWebSocket.last.emit(
    "message",
    liveEnvelope("Delta", {
      kind: "ThreadPostsChanged",
      body: {
        posts: [
          {
            source_seq: 445,
            stream_seq: 45,
            author_user: "host",
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
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalUserId: "host_h",
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
      [data.hostConsoleStateEndpoint]: {
        phase: { phase_id: "D02", locked: true },
        slots: [
          {
            slot_id: "slot-7",
            occupant_user_id: "Mira",
            status: "modkilled",
            alive: false,
          },
        ],
        thread_posts: [{ author_slot: "slot-7" }],
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
  await FakeWebSocket.last.emit("open");
  await FakeWebSocket.last.emit("message", liveEnvelope("Hello", { protocol_v: 1 }));
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

function liveEnvelope(kind, body) {
  return {
    data: JSON.stringify({
      v: 1,
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
