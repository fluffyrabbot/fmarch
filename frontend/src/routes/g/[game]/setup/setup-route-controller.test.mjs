import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSetupCommandDispatchBridgePlan,
  refreshSetupState,
  sendHostSetupCommand,
  setupConfirmStatus,
  setupCommandConfigForAction,
} from "./setup-route-controller.mjs";

const data = Object.freeze({
  game: Object.freeze({ id: "00000000-0000-0000-0000-000000000123" }),
  session: Object.freeze({ principalUserId: "host_h" }),
  commandEndpoint: "/commands",
  start: Object.freeze({ defaultPhase: "D01" }),
});
const raffleProgramRef = Object.freeze({
  id: "raffle",
  version: 1,
  contentHash: "a".repeat(64),
});
const setupState = Object.freeze({
  pack: Object.freeze({ key: "mafiascum" }),
  programCatalog: Object.freeze([
    Object.freeze({
      id: "raffle",
      version: 1,
      programRef: raffleProgramRef,
      compatibility: Object.freeze({ attachable: true, issues: Object.freeze([]) }),
    }),
  ]),
});

test("setup form actions map to typed bootstrap command configs", () => {
  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "attach-day-program",
      data,
      setupState,
      formData: formData({ programId: "raffle@1" }),
    }),
    {
      action: "attach_day_program",
      game: data.game.id,
      programRef: raffleProgramRef,
    },
  );

  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "add-slot",
      data,
      formData: formData({ slotId: "slot_1" }),
    }),
    {
      action: "add_slot",
      game: data.game.id,
      slot: "slot_1",
    },
  );

  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "assign-slot",
      data,
      formData: formData({
        slotId: "slot_1",
        principalUserId: "player_mira",
        publicName: "Mira",
      }),
    }),
    {
      action: "assign_slot",
      game: data.game.id,
      slot: "slot_1",
      user: "player_mira",
      publicName: "Mira",
    },
  );

  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "assign-role",
      data,
      formData: formData({ slotId: "slot_1", roleKey: "vanilla_townie" }),
    }),
    {
      action: "assign_role",
      game: data.game.id,
      slot: "slot_1",
      roleKey: "vanilla_townie",
    },
  );

  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "set-post-policy",
      data,
      formData: formData({ channelId: "main", allowMediaOnly: "true" }),
    }),
    {
      action: "set_post_policy",
      game: data.game.id,
      channelId: "main",
      allowMediaOnly: true,
    },
  );

  assert.deepEqual(
    setupCommandConfigForAction({
      actionId: "start-game",
      data,
      formData: formData({ phase: "N01" }),
    }),
    {
      action: "start_game",
      game: data.game.id,
      phase: "N01",
    },
  );
});

test("setup command sender dispatches Rust wire command envelopes", async () => {
  let captured = null;
  const outcome = await sendHostSetupCommand({
    actionId: "assign-role",
    data,
    formData: formData({ slotId: "slot_1", roleKey: "mafia_goon" }),
    sendCommandImpl: async (request) => {
      captured = request;
      return { state: "ack", message: "Ack: stream seqs 4" };
    },
  });

  assert.equal(outcome.state, "ack");
  assert.equal("principalUserId" in captured, false);
  assert.equal(captured.endpoint, "/commands");
  assert.deepEqual(captured.command, {
    AssignRole: {
      game: data.game.id,
      slot: "slot_1",
      role_key: "mafia_goon",
    },
  });
});

test("setup program sender dispatches only the immutable catalog reference", async () => {
  let captured = null;
  await sendHostSetupCommand({
    actionId: "attach-day-program",
    data,
    setupState,
    formData: formData({ programId: "raffle@1" }),
    sendCommandImpl: async (request) => {
      captured = request;
      return { state: "ack", message: "Ack: stream seqs 4, 5" };
    },
  });

  assert.deepEqual(captured.command, {
    AttachDayProgram: {
      game: data.game.id,
      program_ref: {
        id: "raffle",
        version: 1,
        content_hash: "a".repeat(64),
      },
    },
  });
});

test("setup refuses a program the authoritative compiler marked incompatible", () => {
  assert.throws(
    () =>
      setupCommandConfigForAction({
        actionId: "attach-day-program",
        data,
        setupState: {
          pack: { key: "default_open" },
          programCatalog: [
            {
              id: "raffle",
              version: 1,
              programRef: raffleProgramRef,
              compatibility: {
                attachable: false,
                issues: [{ code: "undeclared_persistent_effect" }],
              },
            },
          ],
        },
        formData: formData({ programId: "raffle@1" }),
      }),
    /day program is incompatible with default_open/,
  );
});

test("setup state refresh bypasses cached browser state after command ack", async () => {
  let captured = null;
  const refreshed = await refreshSetupState({
    data: {
      ...data,
      setupStateEndpoint: `/api/gameplay/games/${data.game.id}/setup-state`,
    },
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return jsonResponse({
        game: data.game.id,
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
            role_key: "vanilla_townie",
          },
        ],
        post_policies: [{ channel_id: "main", allow_media_only: true }],
      });
    },
  });

  assert.equal(
    captured.url,
    `/api/gameplay/games/${data.game.id}/setup-state`,
  );
  assert.equal(captured.init.cache, "no-store");
  assert.deepEqual(captured.init.headers, { accept: "application/json" });
  assert.equal(refreshed.readiness.mainPolicy.allowMediaOnly, true);
});

test("setup dispatch bridge plan records StartGame and setup refresh", () => {
  const plan = buildSetupCommandDispatchBridgePlan({
    actionId: "start-game",
    data,
    formData: formData({ phase: "D01" }),
    confirmationStatus: setupConfirmStatus("start-game", "Start game"),
    optimisticStatus: { state: "pending", message: "Sending command" },
    finalStatus: { state: "ack", message: "Ack: stream seqs 8" },
  });

  assert.equal(plan.role, "host-setup");
  assert.equal(plan.commandKind, "StartGame");
  assert.equal(plan.commandEndpoint, "/commands");
  assert.equal("principalUserId" in plan, false);
  assert.deepEqual(plan.projectionRefreshKeys, ["setupState"]);
});

function formData(values) {
  return {
    get(field) {
      return values[field] ?? null;
    },
  };
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
