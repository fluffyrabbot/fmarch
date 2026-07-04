import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHostSetupReadiness,
  buildHostSetupRouteData,
  hostSetupStateUrl,
  normalizeHostSetupState,
  occupiedSetupInviteTargets,
} from "./setup-route-model.mjs";

const game = "00000000-0000-0000-0000-000000000123";

test("host setup route data derives identity, roster, policy, invites, and readiness", async () => {
  const data = await buildHostSetupRouteData({
    game,
    principalUserId: "host_h",
    capabilities: [{ kind: "HostOf", game }],
    fetchImpl: async (url) => {
      assert.equal(
        url,
        `/games/${game}/setup-state?principal_user_id=host_h`,
      );
      return jsonResponse({
        game,
        created: true,
        pack: {
          key: "mafiascum",
          name: "Mafiascum",
          valid: true,
          role_keys: ["vanilla_townie", "mafia_goon"],
          start_phase_options: ["D01", "N01"],
        },
        phase: null,
        slots: [
          {
            slot_id: "slot_1",
            occupant_user_id: "player_mira",
            alive: true,
            status: "alive",
            status_tags: [],
            role_key: "vanilla_townie",
          },
          {
            slot_id: "slot_2",
            occupant_user_id: "player_goon",
            alive: true,
            status: "alive",
            status_tags: [],
            role_key: "mafia_goon",
          },
        ],
        post_policies: [{ channel_id: "main", allow_media_only: true }],
      });
    },
  });

  assert.equal(data.access.allowed, true);
  assert.equal(data.shell.activeSurface, "moderator");
  assert.equal(data.surfaceHeader.title, "Host setup");
  assert.equal(data.setupState.pack.key, "mafiascum");
  assert.deepEqual(data.setupState.pack.roleKeys, [
    "mafia_goon",
    "vanilla_townie",
  ]);
  assert.equal(data.readiness.startAvailable, true);
  assert.equal(data.readiness.summary, "Ready to start");
  assert.equal(data.readiness.mainPolicy.allowMediaOnly, true);
  assert.deepEqual(
    occupiedSetupInviteTargets(data.setupState).map((target) => target.targetLabel),
    ["Slot 1 / player_mira", "Slot 2 / player_goon"],
  );
});

test("host setup readiness blocks StartGame until slots have occupants and roles", () => {
  const setupState = normalizeHostSetupState(
    {
      game,
      created: true,
      pack: {
        key: "mafiascum",
        name: "Mafiascum",
        valid: true,
        role_keys: ["vanilla_townie"],
        start_phase_options: ["D01"],
      },
      phase: null,
      slots: [
        {
          slot_id: "slot_1",
          occupant_user_id: "player_mira",
          alive: true,
          status: "alive",
          status_tags: [],
          role_key: null,
        },
        {
          slot_id: "slot_2",
          occupant_user_id: null,
          alive: true,
          status: "alive",
          status_tags: [],
          role_key: "vanilla_townie",
        },
      ],
      post_policies: [{ channel_id: "main", allow_media_only: false }],
    },
    { game },
  );

  const readiness = buildHostSetupReadiness(setupState);
  assert.equal(readiness.startAvailable, false);
  assert.equal(readiness.summary, "Setup still needs attention");
  assert.deepEqual(
    readiness.checks.map((check) => [check.id, check.state]),
    [
      ["game-created", "ready"],
      ["pack-valid", "ready"],
      ["slots-exist", "ready"],
      ["slots-occupied", "blocked"],
      ["roles-assigned", "blocked"],
      ["policy-acknowledged", "ready"],
      ["start-phase", "ready"],
    ],
  );
});

test("host setup state URL is principal scoped", () => {
  assert.equal(
    hostSetupStateUrl({
      apiBaseUrl: "http://127.0.0.1:8787",
      game,
      principalUserId: "host_h",
    }),
    `http://127.0.0.1:8787/games/${game}/setup-state?principal_user_id=host_h`,
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
