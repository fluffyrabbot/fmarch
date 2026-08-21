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

test("host setup route data derives slot-bound principals, policy, invites, and readiness", async () => {
  const data = await buildHostSetupRouteData({
    game,
    principalUserId: "host_h",
    sessionToken: "host-session",
    capabilities: [{ kind: "HostOf", game }],
    fetchImpl: async (url, init) => {
      assert.equal(
        url,
        `/api/gameplay/games/${game}/setup-state`,
      );
      assert.equal(init.headers.authorization, "Bearer host-session");
      return jsonResponse({
        game,
        created: true,
        pack: {
          key: "mafiascum",
          name: "Mafiascum",
          valid: true,
          role_keys: ["vanilla_townie", "mafia_goon"],
          roles: [
            { key: "vanilla_townie", label: "Vanilla Townie", description: "No night action." },
            { key: "mafia_goon", label: "Mafia Goon", description: "Shares the factional kill." },
          ],
          start_phase_options: ["D01", "N01"],
        },
        accounts: [
          {
            account_id: "directory-secret@example.test",
            principal_user_id: "directory-secret-principal",
            label: "GLOBAL ACCOUNT DIRECTORY SENTINEL",
          },
        ],
        phase: null,
        slots: [
          {
            slot_id: "slot_1",
            persona_id: "00000000-0000-0000-0000-000000000701",
            public_name: "Mira",
            assigned_principal_id: "player_mira",
            alive: true,
            status: "alive",
            status_tags: [],
            role_key: "vanilla_townie",
          },
          {
            slot_id: "slot_2",
            persona_id: "00000000-0000-0000-0000-000000000702",
            public_name: "Goon",
            assigned_principal_id: "player_goon",
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
  assert.deepEqual(
    data.setupState.pack.roles.map((role) => [role.key, role.label]),
    [["vanilla_townie", "Vanilla Townie"], ["mafia_goon", "Mafia Goon"]],
  );
  assert.equal(data.readiness.startAvailable, true);
  assert.equal(data.readiness.summary, "Ready to start");
  assert.equal(data.readiness.mainPolicy.allowMediaOnly, true);
  assert.equal("accounts" in data.setupState, false);
  const renderedRoutePayload = JSON.stringify(data);
  assert.equal(renderedRoutePayload.includes('"accounts"'), false);
  assert.equal(renderedRoutePayload.includes("directory-secret@example.test"), false);
  assert.equal(renderedRoutePayload.includes("directory-secret-principal"), false);
  assert.equal(renderedRoutePayload.includes("GLOBAL ACCOUNT DIRECTORY SENTINEL"), false);
  assert.equal(data.workflow.selectedStageId, "review");
  assert.deepEqual(data.workflow.stages.map((stage) => stage.id), [
    "pack",
    "roster",
    "roles",
    "rules",
    "program",
    "review",
  ]);
  assert.deepEqual(
    occupiedSetupInviteTargets(data.setupState).map((target) => target.targetLabel),
    ["Slot 1 / Mira", "Slot 2 / Goon"],
  );
  assert.deepEqual(
    occupiedSetupInviteTargets(data.setupState).map((target) => target.principalUserId),
    ["player_mira", "player_goon"],
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
          persona_id: "00000000-0000-0000-0000-000000000701",
          public_name: "Mira",
          assigned_principal_id: "player_mira",
          alive: true,
          status: "alive",
          status_tags: [],
          role_key: null,
        },
        {
          slot_id: "slot_2",
          persona_id: null,
          public_name: null,
          assigned_principal_id: null,
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

test("host setup preserves pack-derived program compatibility diagnostics", () => {
  const setupState = normalizeHostSetupState(
    {
      game,
      created: true,
      pack: {
        key: "default_open",
        name: "Default Open",
        valid: true,
        role_keys: [],
        start_phase_options: ["D01"],
      },
      program_catalog: [
        {
          program_ref: {
            id: "raffle",
            version: 1,
            content_hash: "a".repeat(64),
          },
          display_name: "Raffle",
          theme_ref: "theme.raffle",
          event_count: 1,
          compatibility: {
            attachable: false,
            issues: [
              {
                code: "undeclared_persistent_effect",
                event_id: "raffle-d1",
                message: "effect `bomb` is not declared by pack `default_open`",
              },
            ],
          },
          schedule_previews: [
            {
              event_id: "raffle-d1",
              template_key: "theme.raffle.event",
              participant_filter: "alive_slots",
              participation_mode: "opt_in",
              resolution_mode: "auto_seeded_random",
              reward_keys: ["raffle_bonus"],
              channel_policy: {
                visibility: "public_main",
              },
              mode: "relative_to_phase",
              phase_id: "D01",
              open_at: null,
              open_offset: 900,
              lock_at: null,
              lock_offset: 3600,
              trigger: null,
            },
          ],
        },
      ],
      attached_programs: [],
      slots: [],
      post_policies: [{ channel_id: "main", allow_media_only: false }],
    },
    { game },
  );

  assert.deepEqual(setupState.programCatalog[0].programRef, {
    id: "raffle",
    version: 1,
    contentHash: "a".repeat(64),
  });
  assert.equal("document" in setupState.programCatalog[0], false);
  assert.equal(setupState.programCatalog[0].compatibility.attachable, false);
  assert.deepEqual(setupState.programCatalog[0].compatibility.issues, [
    {
      code: "undeclared_persistent_effect",
      eventId: "raffle-d1",
      message: "effect `bomb` is not declared by pack `default_open`",
    },
  ]);
  assert.deepEqual(setupState.programCatalog[0].schedulePreviews, [
    {
      eventId: "raffle-d1",
      templateKey: "theme.raffle.event",
      participantFilter: "alive_slots",
      participationMode: "opt_in",
      resolutionMode: "auto_seeded_random",
      rewardKeys: ["raffle_bonus"],
      channelVisibility: "public_main",
      channelMembership: null,
      mode: "relative_to_phase",
      phaseId: "D01",
      openAt: null,
      openOffset: 900,
      lockAt: null,
      lockOffset: 3600,
      trigger: null,
    },
  ]);
});

test("host setup state URL uses the authenticated gameplay boundary", () => {
  assert.equal(
    hostSetupStateUrl({
      apiBaseUrl: "http://127.0.0.1:8787",
      game,
    }),
    `http://127.0.0.1:8787/games/${game}/setup-state`,
  );
});

test("host setup route data exposes same-origin browser refresh URL", async () => {
  const fetched = [];
  const data = await buildHostSetupRouteData({
    game,
    principalUserId: "host_h",
    capabilities: [{ kind: "HostOf", game }],
    apiBaseUrl: "http://127.0.0.1:8787",
    fetchImpl: async (url) => {
      fetched.push(url);
      return jsonResponse({
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
        slots: [],
        post_policies: [{ channel_id: "main", allow_media_only: false }],
      });
    },
  });

  assert.deepEqual(fetched, [
    `http://127.0.0.1:8787/games/${game}/setup-state`,
  ]);
  assert.equal(
    data.setupStateEndpoint,
    `/api/gameplay/games/${game}/setup-state`,
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
