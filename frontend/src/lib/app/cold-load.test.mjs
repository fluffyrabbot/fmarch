import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dayVoteOutcomesUrl,
  hostVotecountUrl,
  hostPromptsUrl,
  loadAdminColdData,
  loadHostColdData,
  loadPlayerColdData,
  normalizeDayVoteOutcomes,
  normalizeHostPrompts,
  normalizePlayerCommandState,
  normalizeThreadPage,
  normalizeThreadPost,
  normalizeVotecount,
  operatorProofRunUrl,
  playerCommandStateUrl,
  playerThreadUrl,
  principalScopedGameUrl,
} from "./cold-load.mjs";

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
  commandState: Object.freeze({
    game: null,
    actorSlot: null,
    roleKey: null,
    phase: null,
    actions: Object.freeze([]),
    boundary: "fallback command state",
  }),
});

test("cold-load URLs match existing API route contracts", () => {
  assert.equal(
    playerThreadUrl({ game: "game a", limit: 25 }),
    "/games/game%20a/thread?limit=25",
  );
  assert.equal(
    playerThreadUrl({ game: "game a", limit: 25, beforeSeq: 441 }),
    "/games/game%20a/thread?limit=25&before_seq=441",
  );
  assert.equal(
    playerThreadUrl({
      game: "game a",
      channel: "role-pm",
      principalUserId: "player_a",
      limit: 25,
      beforeSeq: 441,
    }),
    "/games/game%20a/channels/role-pm/thread?limit=25&before_seq=441&principal_user_id=player_a",
  );
  assert.equal(
    principalScopedGameUrl({
      game: "game-a",
      path: "notifications",
      principalUserId: "player_a",
    }),
    "/games/game-a/notifications?principal_user_id=player_a",
  );
  assert.throws(
    () =>
      principalScopedGameUrl({
        game: "game-a",
        path: "notifications",
        principalUserId: "",
      }),
    /principalUserId is required/,
  );
  assert.equal(
    hostPromptsUrl({
      game: "game-a",
      principalUserId: "host_h",
    }),
    "/games/game-a/host-prompts?principal_user_id=host_h",
  );
  assert.equal(hostVotecountUrl({ game: "game-a" }), "/games/game-a/votecount");
  assert.equal(
    dayVoteOutcomesUrl({ game: "game-a" }),
    "/games/game-a/day-vote-outcomes",
  );
  assert.equal(
    playerCommandStateUrl({
      game: "game-a",
      principalUserId: "player_a",
      slotId: "slot_4",
    }),
    "/games/game-a/player-command-state?principal_user_id=player_a&slot_id=slot_4",
  );
  assert.equal(
    operatorProofRunUrl({
      apiBaseUrl: "http://api.test",
      game: "game-a",
      principalUserId: "admin_a",
      path: "operator/proof-runs/go-no-go/view",
    }),
    "http://api.test/games/game-a/operator/proof-runs/go-no-go/view?principal_user_id=admin_a",
  );
});

test("player cold-load uses channel-scoped thread endpoint for private channel routes", async () => {
  const seen = [];
  await loadPlayerColdData({
    game: "midsummer",
    activeChannel: "role-pm",
    principalUserId: "player_mira",
    actorSlot: "slot-7",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: false };
    },
  });

  assert.deepEqual(seen, [
    "/games/midsummer/channels/role-pm/thread?limit=50&principal_user_id=player_mira",
    "/games/midsummer/votecount",
    "/games/midsummer/day-vote-outcomes",
    "/games/midsummer/notifications?principal_user_id=player_mira",
    "/games/midsummer/investigation-results?principal_user_id=player_mira",
    "/games/midsummer/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
  ]);
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
            author_slot: "slot-7",
            author_user: "player-mira",
            body: "##vote slot-2",
            occurred_at: 1781928000,
            media: [
              {
                media_id: "receipt-13",
                type: "image",
                alt_text: "Vote receipt",
                variants: {
                  original: { url: "/media/original/receipt-13.jpg", width: 4000 },
                  tablet: { url: "/media/tablet/receipt-13.jpg", width: 960 },
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
          authorSlot: "slot-7",
          authorLabel: "player-mira",
          body: "##vote slot-2",
          meta: "Jun 19, 2026, 9:00 PM",
          media: [
            {
              id: "receipt-13",
              kind: "image",
              alt: "Vote receipt",
              variants: {
                original: {
                  url: "/media/original/receipt-13.jpg",
                  width: 4000,
                  height: null,
                },
                tablet: {
                  url: "/media/tablet/receipt-13.jpg",
                  width: 960,
                  height: null,
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
});

test("normalizes live and cold thread posts through the same media contract", () => {
  assert.deepEqual(
    normalizeThreadPost(
      {
        sourceSeq: 77,
        authorUser: "host",
        body: "visual receipt",
        images: [
          {
            id: "receipt-77",
            kind: "image",
            alt: "Official receipt",
            variants: [
              { name: "thumb", url: "/media/thumb/receipt-77.jpg", width: 320 },
              { name: "original", url: "/media/original/receipt-77.jpg", width: 4000 },
            ],
          },
        ],
      },
      { fallbackMeta: "live update" },
    ),
    {
      seq: 77,
      streamSeq: null,
      authorSlot: null,
      authorLabel: "host",
      body: "visual receipt",
      meta: "live update",
      media: [
        {
          id: "receipt-77",
          kind: "image",
          alt: "Official receipt",
          variants: {
            thumb: { url: "/media/thumb/receipt-77.jpg", width: 320, height: null },
            original: {
              url: "/media/original/receipt-77.jpg",
              width: 4000,
              height: null,
            },
          },
        },
      ],
    },
  );
});

test("player cold-load fetches real endpoints and falls back per endpoint", async () => {
  const seen = [];
  const data = await loadPlayerColdData({
    game: "midsummer",
    principalUserId: "player_mira",
    actorSlot: "slot_4",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      seen.push(url);
      if (url.includes("/thread?")) {
        return jsonResponse({
          next_before_seq: null,
          posts: [{ source_seq: 1, body: "hello", occurred_at: 1781928000 }],
        });
      }
      if (url.includes("/player-command-state")) {
        return jsonResponse({
          game: "midsummer",
          actor_slot: "slot_4",
          actor_alive: true,
          actor_status: "alive",
          role_key: "mafia_goon",
          phase: {
            phase_id: "N01",
            phase_kind: "Night",
            phase_number: 1,
            locked: false,
          },
          actions: [
            {
              template_id: "factional_kill",
              ability: "Kill",
              window: "Night",
              targets: ["slot-2"],
              target_options: ["slot-2", "slot-3"],
              label: "Submit factional kill",
            },
          ],
          vote_targets: [
            { kind: "slot", slot_id: "slot-2", label: "Slot 2" },
            { kind: "no_lynch", slot_id: null, label: "No lynch" },
          ],
          current_vote: { kind: "slot", slot_id: "slot-2", label: "Slot 2" },
          boundary: "live role actions",
        });
      }
      return { ok: false };
    },
  });

  assert.deepEqual(seen, [
    "/games/midsummer/thread?limit=50",
    "/games/midsummer/votecount",
    "/games/midsummer/day-vote-outcomes",
    "/games/midsummer/notifications?principal_user_id=player_mira",
    "/games/midsummer/investigation-results?principal_user_id=player_mira",
    "/games/midsummer/player-command-state?principal_user_id=player_mira&slot_id=slot_4",
  ]);
  assert.equal(data.thread.posts[0].body, "hello");
  assert.deepEqual(data.votecount, FALLBACK.votecount);
  assert.deepEqual(data.dayVoteOutcomes, FALLBACK.dayVoteOutcomes);
  assert.equal(data.commandState.phase.phaseId, "N01");
  assert.equal(data.commandState.actorAlive, true);
  assert.equal(data.commandState.actorStatus, "alive");
  assert.equal(data.commandState.actions[0].templateId, "factional_kill");
  assert.deepEqual(data.commandState.actions[0].targets, ["slot-2"]);
  assert.deepEqual(data.commandState.voteTargets, [
    { kind: "slot", slotId: "slot-2", label: "Slot 2" },
    { kind: "no_lynch", slotId: null, label: "No lynch" },
  ]);
  assert.deepEqual(data.commandState.currentVote, {
    kind: "slot",
    slotId: "slot-2",
    label: "Slot 2",
  });
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
        game_completed: true,
        phase: {
          phase_id: "N01",
          phase_kind: "Night",
          phase_number: 1,
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
      gameCompleted: true,
      phase: {
        phaseId: "N01",
        phaseKind: "Night",
        phaseNumber: 1,
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
      voteTargets: [
        { kind: "slot", slotId: "slot-2", label: "Slot 2" },
        { kind: "slot", slotId: "slot-3", label: "Slot 3" },
        { kind: "no_lynch", slotId: null, label: "No lynch" },
      ],
      currentVote: { kind: "no_lynch", slotId: null, label: "No lynch" },
      boundary: "live command state",
    },
  );
});

test("player cold-load skips private scoped endpoints without a principal", async () => {
  const seen = [];
  const data = await loadPlayerColdData({
    game: "midsummer",
    principalUserId: null,
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: false };
    },
  });

  assert.deepEqual(seen, [
    "/games/midsummer/thread?limit=50",
    "/games/midsummer/votecount",
    "/games/midsummer/day-vote-outcomes",
  ]);
  assert.deepEqual(data.notifications, []);
  assert.deepEqual(data.investigationResults, []);
  assert.deepEqual(data.dayVoteOutcomes, []);
});

test("admin cold-load maps operator proof status when available", async () => {
  const data = await loadAdminColdData({
    game: "midsummer",
    principalUserId: "admin_a",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      assert.equal(
        url,
        "/games/midsummer/operator/proof-runs/status?principal_user_id=admin_a",
      );
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
      href: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    },
  ]);
});

test("admin cold-load maps real operator proof status families", async () => {
  const data = await loadAdminColdData({
    game: "midsummer",
    principalUserId: "admin_a",
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
      href: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
    },
  ]);
});

test("host cold-load maps durable prompt rows and votecount for moderator controls", async () => {
  const seen = [];
  const data = await loadHostColdData({
    game: "midsummer",
    principalUserId: "host_h",
    fallback: FALLBACK,
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === "/games/midsummer/votecount") {
        return jsonResponse([
          {
            VoteCountChanged: {
              candidate_slot: "slot-target",
              count: 2,
              majority: 5,
            },
          },
        ]);
      }
      if (url === "/games/midsummer/day-vote-outcomes") {
        return jsonResponse([
          {
            DayVoteOutcomeApplied: {
              phase_id: "D01",
              source_seq: 11,
              event_index: 0,
              status: "Lynch",
              winner_slot: "slot-target",
              tallies: { "slot-target": 2 },
            },
          },
        ]);
      }
      return jsonResponse([
        {
          prompt_id: "D01:skip_next_day:slot_1",
          kind: "skip_next_day",
          reason: "beloved_princess_death",
          status: "pending",
          phase_id: "D01",
          subject_slot: "slot_1",
        },
      ]);
    },
  });

  assert.deepEqual(seen, [
    "/games/midsummer/host-prompts?principal_user_id=host_h",
    "/games/midsummer/votecount",
    "/games/midsummer/day-vote-outcomes",
  ]);
  assert.deepEqual(data.hostPrompts, [
    {
      id: "D01:skip_next_day:slot_1",
      label: "skip_next_day",
      value: "beloved_princess_death",
      status: "pending",
      phaseId: "D01",
      subjectSlot: "slot_1",
      decisionKind: "acknowledge",
    },
  ]);
  assert.deepEqual(data.votecount, [
    { target: "slot-target", count: 2, needed: 5 },
  ]);
  assert.deepEqual(data.dayVoteOutcomes, [
    {
      game: null,
      phaseId: "D01",
      sourceSeq: 11,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-target",
      tallies: { "slot-target": 2 },
      majority: null,
      reason: null,
    },
  ]);
});

test("host prompt normalization falls back when payload is not an array", () => {
  assert.equal(normalizeHostPrompts(null, FALLBACK.hostPrompts), FALLBACK.hostPrompts);
});

function jsonResponse(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
