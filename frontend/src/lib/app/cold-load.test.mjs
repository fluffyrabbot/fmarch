import assert from "node:assert/strict";
import { test } from "node:test";
import {
  authenticatedGameReadUrl,
  adminIdentityLifecycleAuditHref,
  dayVoteOutcomesUrl,
  hostVotecountUrl,
  hostPromptsUrl,
  identityLifecycleAuditUrl,
  loadAdminColdData,
  normalizeDayVoteOutcomes,
  normalizeEndgameSummary,
  normalizeHostPrompts,
  normalizePlayerCommandState,
  normalizeThreadPage,
  normalizeThreadPost,
  normalizeVotecount,
  operatorProofRunUrl,
  playerCommandStateUrl,
  playerThreadUrl,
} from "./cold-load.mjs";

test("endgame summary normalizes reveal-gated per-day vote history", () => {
  const summary = normalizeEndgameSummary({
    completed: true,
    slots: [],
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
  });

  assert.deepEqual(summary.voteHistory, [
    {
      phaseId: "D01",
      sourceSeq: 31,
      eventIndex: 0,
      status: "NoLynch",
      winnerSlot: null,
      tallies: { no_lynch: 2 },
      votes: { "slot-2": "no_lynch", "slot-3": "no_lynch" },
      majority: 2,
      reason: null,
    },
  ]);
});

const FALLBACK = Object.freeze({
  thread: Object.freeze({ nextBeforeSeq: null, posts: Object.freeze([]) }),
  votecount: Object.freeze([]),
  dayVoteOutcomes: Object.freeze([]),
  audit: Object.freeze([
    Object.freeze({
      id: "proof-runs",
      label: "Proof runs",
      status: "fixture",
      href: "/operator/proof-runs",
    }),
  ]),
  hostPrompts: Object.freeze([]),
  hostConsoleState: null,
  commandState: Object.freeze({
    game: null,
    actorSlot: null,
    roleKey: null,
    phase: null,
    actions: Object.freeze([]),
    boundary: "fallback command state",
  }),
});

const ADMIN_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000004";

test("cold-load URLs keep the public main thread and private channel boundaries distinct", () => {
  assert.equal(
    playerThreadUrl({ game: "game a", limit: 25 }),
    "/api/gameplay/games/game%20a?limit=25",
  );
  assert.equal(
    playerThreadUrl({ game: "game a", limit: 25, beforeSeq: 441 }),
    "/api/gameplay/games/game%20a?limit=25&before_seq=441",
  );
  assert.equal(
    playerThreadUrl({
      apiBaseUrl: "http://api.test",
      game: "game a",
      limit: 25,
      beforeSeq: 441,
    }),
    "http://api.test/games/game%20a?limit=25&before_seq=441",
  );
  assert.equal(
    playerThreadUrl({
      game: "game a",
      channel: "private:role_pm:slot-7",
      limit: 25,
      beforeSeq: 441,
    }),
    "/api/gameplay/games/game%20a/channels/private%3Arole_pm%3Aslot-7/thread?limit=25&before_seq=441",
  );
  assert.equal(
    authenticatedGameReadUrl({
      game: "game-a",
      path: "notifications",
    }),
    "/api/gameplay/games/game-a/notifications",
  );
  assert.equal(
    hostPromptsUrl({
      game: "game-a",
    }),
    "/api/gameplay/games/game-a/host-prompts",
  );
  assert.equal(
    hostVotecountUrl({ game: "game-a" }),
    "/api/gameplay/games/game-a/votecount",
  );
  assert.equal(
    dayVoteOutcomesUrl({ game: "game-a" }),
    "/api/gameplay/games/game-a/day-vote-outcomes",
  );
  assert.equal(
    playerCommandStateUrl({
      game: "game-a",
      slotId: "slot_4",
    }),
    "/api/gameplay/games/game-a/player-command-state?slot_id=slot_4",
  );
  assert.equal(
    operatorProofRunUrl({
      apiBaseUrl: "http://api.test",
      game: "game-a",
      path: "operator/proof-runs/go-no-go/view",
    }),
    "http://api.test/games/game-a/operator/proof-runs/go-no-go/view",
  );

  const authenticatedReads = [
    playerThreadUrl({
      game: "game-a",
      channel: "private:role_pm:slot-7",
      limit: 25,
    }),
    authenticatedGameReadUrl({ game: "game-a", path: "notifications" }),
    authenticatedGameReadUrl({ game: "game-a", path: "investigation-results" }),
    hostPromptsUrl({ game: "game-a" }),
    playerCommandStateUrl({ game: "game-a", slotId: "slot_4" }),
  ];
  for (const url of authenticatedReads) {
    assert.equal(
      new URL(url, "https://app.example").searchParams.has("principal_id"),
      false,
      `${url} must derive its principal exclusively from the authenticated session`,
    );
  }
});

test("normalizes thread and votecount projection payloads for the player view", () => {
  assert.deepEqual(
    normalizeThreadPage(
      {
        next_before_seq: 12,
        posts: [
          {
            source_seq: 13,
            stream_seq: 91,
            author: { kind: "slot", slot_id: "slot-7" },
            body: "##vote slot-2",
            occurred_at: 1781928000,
            media: [
              {
                content_id: "a".repeat(64),
                alt: "Vote receipt",
                variants: {
                  tablet: {
                    avif_url: "/media/thread/13/tablet.avif",
                    webp_url: "/media/thread/13/tablet.webp",
                    width: 960,
                    height: 720,
                  },
                },
              },
            ],
          },
        ],
      },
      FALLBACK.thread,
    ),
    {
      nextBeforeSeq: 12,
      posts: [
        {
          seq: 13,
          streamSeq: 91,
          author: { kind: "slot", slotId: "slot-7" },
          body: "##vote slot-2",
          quotations: [],
          mentions: [],
          citationCount: 0,
          meta: "Jun 19, 2026, 9:00 PM",
          media: [
            {
              id: "a".repeat(64),
              contentId: "a".repeat(64),
              kind: "image",
              alt: "Vote receipt",
              variants: {
                tablet: {
                  avifUrl: "/media/thread/13/tablet.avif",
                  webpUrl: "/media/thread/13/tablet.webp",
                  width: 960,
                  height: 720,
                },
              },
            },
          ],
        },
      ],
    },
  );

  assert.deepEqual(
    normalizeVotecount(
      [
        {
          VoteCountChanged: {
            candidate_slot: "slot-2",
            count: 4,
          },
        },
      ],
      FALLBACK.votecount,
    ),
    [{ target: "slot-2", count: 4, needed: 7 }],
  );

  assert.deepEqual(
    normalizeVotecount(
      [
        {
          kind: "VoteCountChanged",
          body: {
            candidate_slot: "slot-2",
            count: 1,
          },
        },
      ],
      FALLBACK.votecount,
    ),
    [{ target: "slot-2", count: 1, needed: 7 }],
  );

  assert.deepEqual(
    normalizeVotecount([], [{ target: "slot-3", count: 1, needed: 7 }]),
    [],
  );

  assert.deepEqual(
    normalizeVotecount(
      [{ target: "slot-2 / Ilya", count: 4, needed: 7 }],
      FALLBACK.votecount,
    ),
    [{ target: "slot-2 / Ilya", count: 4, needed: 7 }],
  );

  assert.deepEqual(
    normalizeDayVoteOutcomes(
      [
        {
          kind: "DayVoteOutcomeApplied",
          body: {
            phase_id: "D01",
            source_seq: 8,
            event_index: 1,
            status: "Lynch",
            winner_slot: "slot-2",
            tallies: { "slot-2": 4, "slot-7": 2 },
            majority: 4,
          },
        },
      ],
      FALLBACK.dayVoteOutcomes,
    ),
    [
      {
        game: null,
        phaseId: "D01",
        sourceSeq: 8,
        eventIndex: 1,
        status: "Lynch",
        winnerSlot: "slot-2",
        tallies: { "slot-2": 4, "slot-7": 2 },
        majority: 4,
        reason: null,
      },
    ],
  );

  assert.deepEqual(
    normalizeDayVoteOutcomes(
      [],
      [
        {
          game: null,
          phaseId: "D01",
          sourceSeq: 8,
          eventIndex: 1,
          status: "Lynch",
          winnerSlot: "slot-2",
          tallies: { "slot-2": 4 },
          majority: 4,
          reason: null,
        },
      ],
    ),
    [],
  );
  assert.equal(
    normalizeDayVoteOutcomes([
      { phase_id: "D01", status: "Tie", majority: null },
    ])[0].majority,
    null,
  );
});

test("normalizes live and cold thread posts through the same media contract", () => {
  assert.deepEqual(
    normalizeThreadPost(
      {
        sourceSeq: 77,
        author: { kind: "host_narrator" },
        body: "visual receipt",
        media: [
          {
            content_id: "b".repeat(64),
            alt: "Official receipt",
            variants: {
              thumb: {
                avif_url: "/media/thread/77/thumb.avif",
                webp_url: "/media/thread/77/thumb.webp",
                width: 256,
                height: 192,
              },
            },
          },
        ],
      },
      { fallbackMeta: "live update" },
    ),
    {
      seq: 77,
      streamSeq: null,
      author: { kind: "host_narrator" },
      body: "visual receipt",
      quotations: [],
      mentions: [],
      citationCount: 0,
      meta: "live update",
      media: [
        {
          id: "b".repeat(64),
          contentId: "b".repeat(64),
          kind: "image",
          alt: "Official receipt",
          variants: {
            thumb: {
              avifUrl: "/media/thread/77/thumb.avif",
              webpUrl: "/media/thread/77/thumb.webp",
              width: 256,
              height: 192,
            },
          },
        },
      ],
    },
  );
});

test("normalizes player command state into route action configs", () => {
  assert.deepEqual(
    normalizePlayerCommandState(
      {
        game: "midsummer",
        actor_slot: "slot_4",
        actor_alive: false,
        actor_status: "dead",
        role_key: "mafia_goon",
        role: {
          key: "mafia_goon",
          alignment: "mafia",
          description: "Mafia Goon. Carries out the nightly factional kill.",
        },
        game_completed: true,
        phase: {
          phase_id: "N01",
          locked: false,
          deadline: 1781928000,
        },
        actions: [
          {
            template_id: "factional_kill",
            ability: "Kill",
            window: "Night",
            targets: ["slot-2"],
            target_options: ["slot-2", "slot-3"],
          },
        ],
        vote_targets: [
          { kind: "slot", slot_id: "slot-2", label: "Slot 2" },
          { kind: "slot", slot_id: "slot-3", label: "Slot 3" },
          { kind: "no_lynch", slot_id: null, label: "No lynch" },
        ],
        current_vote: { kind: "no_lynch", slot_id: null, label: "No lynch" },
        day_events: [{
          event_id: "event-cookie",
          template_key: "theme.raffle",
          phase_id: "D01",
          participation_status: "available",
          participant_count: 2,
          minimum_participants: 1,
          maximum_participants: 5,
          reward_keys: ["cookie"],
          can_submit: true,
          can_withdraw: false,
        }],
        day_event_rooms: [{
          event_id: "event-cookie",
          channel_id: "private:event:event-cookie",
          template_key: "theme.raffle",
          state: "locked",
          membership: "participants",
          member_count: 3,
          posting_allowed: false,
        }],
        post_policies: [{ channel_id: "main", allow_media_only: true }],
        mention_targets: [
          { channel_id: "main", slots: ["slot-2", "slot-3", "slot_4"] },
          { channel_id: "private:faction:mafia", slots: ["slot_4"] },
        ],
        boundary: "live command state",
      },
      FALLBACK.commandState,
    ),
    {
      game: "midsummer",
      actorSlot: "slot_4",
      actorAlive: false,
      actorStatus: "dead",
      roleKey: "mafia_goon",
      role: {
        key: "mafia_goon",
        alignment: "mafia",
        description: "Mafia Goon. Carries out the nightly factional kill.",
      },
      gameCompleted: true,
      phase: {
        phaseId: "N01",
        locked: false,
        deadline: 1781928000,
      },
      actions: [
        {
          source: "role",
          action: "submit_action:factional_kill",
          commandKind: "submit_action",
          label: "Submit factional kill",
          detail: "factional_kill -> slot-2",
          actionId: "role_factional_kill",
          templateId: "factional_kill",
          targets: ["slot-2"],
          targetOptions: ["slot-2", "slot-3"],
          grantId: null,
          ability: "Kill",
          window: "Night",
        },
      ],
      currentActions: [],
      voteTargets: [
        { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        { kind: "no_lynch", slotId: null, label: "No lynch" },
      ],
      currentVote: { kind: "no_lynch", slotId: null, label: "No lynch" },
      dayEvents: [{
        eventId: "event-cookie",
        templateKey: "theme.raffle",
        phaseId: "D01",
        participationStatus: "available",
        participantCount: 2,
        minimumParticipants: 1,
        maximumParticipants: 5,
        rewardKeys: ["cookie"],
        canSubmit: true,
        canWithdraw: false,
      }],
      dayEventRooms: [{
        eventId: "event-cookie",
        channelId: "private:event:event-cookie",
        templateKey: "theme.raffle",
        state: "locked",
        membership: "participants",
        memberCount: 3,
        postingAllowed: false,
      }],
      postPolicies: [{ channelId: "main", allowMediaOnly: true }],
      mentionTargets: [
        { channelId: "main", slots: ["slot-2", "slot-3", "slot_4"] },
        { channelId: "private:faction:mafia", slots: ["slot_4"] },
      ],
      boundary: "live command state",
    },
  );
});

test("admin cold-load maps operator proof status when available", async () => {
  const data = await loadAdminColdData({
    game: "midsummer",
    principalId: "admin_a",
    sessionToken: "session-token",
    fallback: FALLBACK,
    fetchImpl: async (url, init) => {
      assert.equal(
        url,
        "/games/midsummer/operator/proof-runs/status",
      );
      assert.equal(init.headers.authorization, "Bearer session-token");
      return jsonResponse({
        rows: [
          {
            id: "domain-ci",
            label: "Domain CI",
            status: "green",
            authority: "GlobalAdmin",
            boundary: "Machine proof",
            boundary_detail: "/operator/proof-runs/domain-ci",
          },
        ],
      });
    },
  });

  assert.deepEqual(data.audit, [
    {
      id: "domain-ci",
      label: "Domain CI",
      status: "green",
      authority: "GlobalAdmin",
      boundary: "Machine proof",
      boundaryDetail: "/operator/proof-runs/domain-ci",
      href: "/games/midsummer/operator/proof-runs",
    },
  ]);
});

test("admin cold-load maps real operator proof status families", async () => {
  const data = await loadAdminColdData({
    game: "midsummer",
    principalId: "admin_a",
    fallback: FALLBACK,
    fetchImpl: async () =>
      jsonResponse({
        families: [
          {
            heading: "Local proofs",
            runs: [
              {
                id: "domain-ci-no-postgres",
                scope: "production",
                artifact: { state: "trusted" },
              },
            ],
          },
        ],
      }),
  });

  assert.deepEqual(data.audit, [
    {
      id: "domain-ci-no-postgres",
      label: "domain-ci-no-postgres",
      status: "trusted",
      authority: "GlobalAdmin or GlobalMod",
      boundary: "Read-only operator proof",
      boundaryDetail: "/operator/proof-runs machine-readable report",
      href: "/games/midsummer/operator/proof-runs",
    },
  ]);
});

test("admin identity lifecycle reads are restricted to canonical principal UUIDs", async () => {
  const textLabelCalls = [];
  await loadAdminColdData({
    game: "midsummer",
    principalId: "admin_a",
    identityPrincipalId: "host_h",
    sessionToken: "admin-session",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      textLabelCalls.push(String(url));
      return jsonResponse({ rows: [] });
    },
  });
  assert.deepEqual(textLabelCalls, ["/games/midsummer/operator/proof-runs/status"]);

  const principalCalls = [];
  await loadAdminColdData({
    game: "midsummer",
    principalId: ADMIN_PRINCIPAL_ID,
    sessionToken: "admin-session",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      principalCalls.push(String(url));
      return jsonResponse(
        String(url).startsWith("/auth/identity-lifecycle-audit")
          ? { entries: [] }
          : { rows: [] },
      );
    },
  });
  assert.equal(
    principalCalls.includes(
      `/auth/identity-lifecycle-audit?principal_id=${ADMIN_PRINCIPAL_ID}&limit=50`,
    ),
    true,
  );
  assert.throws(
    () => identityLifecycleAuditUrl({ principalId: "host_h" }),
    /canonical UUID/,
  );
  assert.throws(
    () => adminIdentityLifecycleAuditHref({ game: "midsummer", principalId: "host_h" }),
    /canonical UUID/,
  );
});

test("host prompt cold-load infers slot selection from HostDecides contenders", () => {
  assert.deepEqual(
    normalizeHostPrompts(
      [
        {
          prompt_id: "D01:pk:Tie",
          kind: "pk",
          reason: "host_decides_tie",
          status: "pending",
          phase_id: "D01",
          subject_slot: null,
          metadata: {
            policy: "pk_host_decides_tie",
            contenders: ["slot-2", "slot-4"],
          },
        },
      ],
      FALLBACK.hostPrompts,
    ),
    [
      {
        id: "D01:pk:Tie",
        label: "pk",
        value: "host_decides_tie",
        status: "pending",
        phaseId: "D01",
        subjectSlot: null,
        decisionKind: "select_slot",
        metadata: {
          policy: "pk_host_decides_tie",
          contenders: ["slot-2", "slot-4"],
        },
      },
    ],
  );
});

test("host prompt normalization falls back when payload is not an array", () => {
  assert.deepEqual(normalizeHostPrompts(null, FALLBACK.hostPrompts), FALLBACK.hostPrompts);
});

test("host prompt normalization preserves typed public resolution", () => {
  assert.deepEqual(
    normalizeHostPrompts([
      {
        prompt_id: "D01:pk:Tie",
        kind: "pk",
        reason: "host_decides_tie",
        status: "resolved",
        phase_id: "D01",
        metadata: { contenders: ["slot-1", "slot-2"] },
        public_resolution: {
          kind: "day_vote_elimination",
          phase_id: "D01",
          selected_slot: "slot-2",
          reason: "host_decides_tie",
        },
      },
    ]),
    [
      {
        id: "D01:pk:Tie",
        label: "pk",
        value: "host_decides_tie",
        status: "resolved",
        phaseId: "D01",
        subjectSlot: null,
        decisionKind: "select_slot",
        metadata: { contenders: ["slot-1", "slot-2"] },
        publicResolution: {
          kind: "day_vote_elimination",
          phase_id: "D01",
          selected_slot: "slot-2",
          reason: "host_decides_tie",
        },
      },
    ],
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

test("ssrFetchTimeoutMs defaults, honors overrides, and lets 0 disable the budget", async () => {
  const { ssrFetchTimeoutMs, DEFAULT_SSR_FETCH_TIMEOUT_MS } = await import("./cold-load.mjs");
  assert.equal(ssrFetchTimeoutMs({}), DEFAULT_SSR_FETCH_TIMEOUT_MS);
  assert.equal(ssrFetchTimeoutMs(undefined), DEFAULT_SSR_FETCH_TIMEOUT_MS);
  assert.equal(ssrFetchTimeoutMs({ FMARCH_SSR_FETCH_TIMEOUT_MS: "750" }), 750);
  assert.equal(ssrFetchTimeoutMs({ FMARCH_SSR_FETCH_TIMEOUT_MS: "0" }), 0);
  assert.equal(
    ssrFetchTimeoutMs({ FMARCH_SSR_FETCH_TIMEOUT_MS: "not-a-number" }),
    DEFAULT_SSR_FETCH_TIMEOUT_MS,
  );
  assert.equal(
    ssrFetchTimeoutMs({ FMARCH_SSR_FETCH_TIMEOUT_MS: "-5" }),
    DEFAULT_SSR_FETCH_TIMEOUT_MS,
  );
});

test("fetchJson forwards an abort signal when a timeout budget is set", async () => {
  const { fetchJson } = await import("./cold-load.mjs");
  const observed = { inits: [] };
  const fetchImpl = async (url, init) => {
    observed.inits.push(init);
    return { ok: true, async json() { return { fine: true }; } };
  };
  const withBudget = await fetchJson({ fetchImpl, url: "/x", fallback: null, timeoutMs: 500 });
  assert.deepEqual(withBudget, { fine: true });
  assert.ok(observed.inits[0].signal instanceof AbortSignal);

  const withoutBudget = await fetchJson({ fetchImpl, url: "/x", fallback: null });
  assert.deepEqual(withoutBudget, { fine: true });
  assert.equal(observed.inits[1].signal, undefined);
});

test("fetchJson returns the fallback when the timeout budget aborts the fetch", async () => {
  const { fetchJson } = await import("./cold-load.mjs");
  const fetchImpl = (url, init) =>
    new Promise((resolvePromise, rejectPromise) => {
      init.signal.addEventListener("abort", () => rejectPromise(init.signal.reason));
    });
  const result = await fetchJson({
    fetchImpl,
    url: "/hung-endpoint",
    fallback: { fallback: true },
    timeoutMs: 20,
  });
  assert.deepEqual(result, { fallback: true });
});
