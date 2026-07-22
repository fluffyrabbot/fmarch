import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COLD_LOAD_TRANSPORT_BOUNDARY,
  createProjectionStore,
  LIVE_TRANSPORT_BOUNDARY,
} from "./projection-store.mjs";

test("projection store refreshes cold-load keys and preserves failed projections", async () => {
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
  const refreshed = await store.refresh(["thread", "votecount"], {
    signal: abortController.signal,
    fetchImpl: async (url, options) => {
      fetchRequests.push({ url, options });
      if (url.startsWith("/thread?")) {
        return jsonResponse({ posts: [{ seq: 7, body: "cold load" }] });
      }
      return { ok: false, status: 503 };
    },
  });
  unsubscribe();

  assert.deepEqual(refreshed.thread, {
    posts: [{ seq: 7, body: "cold load" }],
  });
  assert.deepEqual(refreshed.votecount, [{ target: "slot-1", count: 1 }]);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].thread.posts.length, 0);
  assert.equal(snapshots[1].thread.posts[0].body, "cold load");
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

test("projection store can be explicitly marked with the live transport boundary", () => {
  const store = createProjectionStore({
    initialSnapshot: { thread: { posts: [] } },
    liveTransport: LIVE_TRANSPORT_BOUNDARY,
  });

  assert.equal(
    store.liveTransport.status,
    "json-ws-command-projection-deltas-with-resync-and-reconnect",
  );
  assert.match(store.liveTransport.proof, /reconnect refresh recovery/);
});

test("projection store applies live votecount clear envelopes", () => {
  const store = createProjectionStore({
    initialSnapshot: {
      votecount: [{ target: "slot-2", count: 1, needed: 7 }],
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 1,
    id: 2,
    body: {
      kind: "Delta",
      body: {
        kind: "VoteCountCleared",
        body: { candidate_slot: "slot-2" },
      },
    },
  });

  assert.deepEqual(snapshot.votecount, []);
});

test("projection store applies live projection delta envelopes", () => {
  const store = createProjectionStore({
    initialSnapshot: {
      votecount: [{ target: "slot-2", count: 1, needed: 7 }],
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 1,
    id: 1,
    body: {
      kind: "Delta",
      body: {
        kind: "VoteCountChanged",
        body: { candidate_slot: "slot-2", count: 2 },
      },
    },
  });

  assert.deepEqual(snapshot.votecount, [{ target: "slot-2", count: 2, needed: 7 }]);
});

test("projection store applies live thread post envelopes into the player thread", () => {
  const store = createProjectionStore({
    initialSnapshot: {
      thread: {
        nextBeforeSeq: 40,
        posts: [{ seq: 42, authorLabel: "Mira", body: "before" }],
      },
    },
  });

  const snapshot = store.applyLiveEnvelope({
    v: 1,
    id: 7,
    body: {
      kind: "Delta",
      body: {
        kind: "ThreadPostsChanged",
        body: {
          game: "midsummer",
          posts: [
            {
              source_seq: 43,
              stream_seq: 9,
              author_user: "host",
              body: "Official votecount for D01",
              occurred_at: 1781928000,
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
            },
          ],
        },
      },
    },
  });

  assert.equal(snapshot.thread.nextBeforeSeq, 40);
  assert.deepEqual(
    snapshot.thread.posts.map((post) => [post.seq, post.authorLabel, post.body]),
    [
      [42, "Mira", "before"],
      [43, "host", "Official votecount for D01"],
    ],
  );
  assert.equal(
    snapshot.thread.posts[1].media[0].variants.tablet.webpUrl,
    "/media/thread/43/tablet.webp",
  );
});

test("projection store applies live host-console state envelopes through the host normalizer", () => {
  const store = createProjectionStore({
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
    v: 1,
    id: 3,
    body: {
      kind: "Delta",
      body: {
        kind: "HostConsoleStateChanged",
        body: {
          phase: { phase_id: "D02", locked: true },
          slots: [],
          thread_posts: [],
        },
      },
    },
  });

  assert.deepEqual(snapshot.host.phase, {
    id: "D02",
    lockedLabel: "Thread locked",
  });
});

test("projection store applies live host-prompt envelopes through the prompt normalizer", () => {
  const store = createProjectionStore({
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
    v: 1,
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
    v: 1,
    id: 5,
    body: {
      kind: "Delta",
      body: {
        kind: "DayVoteOutcomeApplied",
        body: {
          phase_id: "D01",
          winner_slot: "slot-2",
        },
      },
    },
  });

  assert.deepEqual(snapshot.dayVoteOutcomes, [
    { phaseId: "D01", winnerSlot: "slot-2" },
  ]);
});

test("projection store applies live player-private envelopes through scoped normalizers", () => {
  const store = createProjectionStore({
    initialSnapshot: {
      notifications: [],
      investigationResults: [],
    },
    coldLoads: {
      notifications: {
        url: "/notifications",
        normalize: (payload) => payload.map((row) => ({ effect: row.effect })),
      },
      investigationResults: {
        url: "/investigation-results",
        normalize: (payload) => payload.map((row) => ({ mode: row.mode })),
      },
    },
  });

  store.applyLiveEnvelope({
    v: 1,
    id: 5,
    body: {
      kind: "Delta",
      body: {
        kind: "PlayerNotificationsChanged",
        body: {
          game: "midsummer",
          notifications: [{ effect: "Neighborized" }],
        },
      },
    },
  });
  const snapshot = store.applyLiveEnvelope({
    v: 1,
    id: 6,
    body: {
      kind: "Delta",
      body: {
        kind: "PlayerInvestigationResultsChanged",
        body: {
          game: "midsummer",
          results: [{ mode: "cop" }],
        },
      },
    },
  });

  assert.deepEqual(snapshot.notifications, [{ effect: "Neighborized" }]);
  assert.deepEqual(snapshot.investigationResults, [{ mode: "cop" }]);
});

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
