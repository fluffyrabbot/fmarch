import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSetupCommandDispatchBridgePlan,
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

test("setup form actions map to typed bootstrap command configs", () => {
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
      formData: formData({ slotId: "slot_1", principalUserId: "player_mira" }),
    }),
    {
      action: "assign_slot",
      game: data.game.id,
      slot: "slot_1",
      user: "player_mira",
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
  assert.equal(captured.principalUserId, "host_h");
  assert.equal(captured.endpoint, "/commands");
  assert.deepEqual(captured.command, {
    AssignRole: {
      game: data.game.id,
      slot: "slot_1",
      role_key: "mafia_goon",
    },
  });
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
  assert.equal(plan.principalUserId, "host_h");
  assert.deepEqual(plan.projectionRefreshKeys, ["setupState"]);
});

function formData(values) {
  return {
    get(field) {
      return values[field] ?? null;
    },
  };
}
