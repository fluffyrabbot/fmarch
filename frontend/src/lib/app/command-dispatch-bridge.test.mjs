import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COMMAND_DISPATCH_BRIDGE_CONTRACT,
  buildDispatchBridgePlan,
  buildDispatchBridgePlanFromRequest,
  commandKindForCommand,
  commandTraceAttributes,
  commandTraceFromAttributes,
  confirmationTraceAttributes,
  confirmationTraceFromAttributes,
  normalizeCommandTrace,
  normalizeConfirmationTrace,
} from "./command-dispatch-bridge.mjs";

test("command dispatch bridge normalizes player command trace attributes", () => {
  const trace = commandTraceFromAttributes({
    "data-command-trace-kind": "command-trace",
    "data-command-surface": "player",
    "data-command-action-id": "submit_vote",
    "data-command-status-key": "submit_vote",
    "data-command-dispatch-kind": "submit_vote",
    "data-command-refresh-keys": "votecount",
  });

  assert.deepEqual(trace, {
    kind: "command-trace",
    surface: "player",
    actionId: "submit_vote",
    statusKey: "submit_vote",
    dispatchKind: "submit_vote",
    projectionRefreshKeys: ["votecount"],
  });
  assert.deepEqual(commandTraceAttributes(trace), {
    "data-command-trace-kind": "command-trace",
    "data-command-surface": "player",
    "data-command-action-id": "submit_vote",
    "data-command-status-key": "submit_vote",
    "data-command-dispatch-kind": "submit_vote",
    "data-command-refresh-keys": "votecount",
  });
  assert.deepEqual(normalizeCommandTrace(trace), trace);
});

test("command dispatch bridge normalizes confirmation trace attributes", () => {
  const trace = confirmationTraceFromAttributes({
    "data-confirmation-trace-kind": "confirmation-command-trace",
    "data-confirmation-surface": "moderator-host",
    "data-confirmation-action-id":
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    "data-confirmation-status-key":
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    "data-confirmation-dispatch-kind": "resolve_host_prompt",
  });

  assert.deepEqual(trace, {
    kind: "confirmation-command-trace",
    surface: "moderator-host",
    actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
    statusKey: "resolve_host_prompt-D01-skip_next_day-slot_1",
    dispatchKind: "resolve_host_prompt",
  });
  assert.deepEqual(confirmationTraceAttributes(trace), {
    "data-confirmation-trace-kind": "confirmation-command-trace",
    "data-confirmation-surface": "moderator-host",
    "data-confirmation-action-id":
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    "data-confirmation-status-key":
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    "data-confirmation-dispatch-kind": "resolve_host_prompt",
  });
  assert.deepEqual(normalizeConfirmationTrace(trace), trace);
});

test("command dispatch bridge builds a role dispatch plan", () => {
  const plan = buildDispatchBridgePlan({
    role: "player",
    trace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      projectionRefreshKeys: ["votecount"],
    },
    commandKind: "SubmitVote",
    commandEndpoint: "/commands",
    principalUserId: "player_mira",
    optimisticState: "pending",
    finalState: "ack",
    projectionRefreshKeys: ["votecount"],
  });

  assert.equal(plan.boundary, COMMAND_DISPATCH_BRIDGE_CONTRACT.boundary);
  assert.equal(plan.role, "player");
  assert.equal(plan.commandKind, "SubmitVote");
  assert.deepEqual(plan.projectionRefreshKeys, ["votecount"]);
});

test("command dispatch bridge derives plans from typed command requests", () => {
  const plan = buildDispatchBridgePlanFromRequest({
    role: "player",
    trace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      projectionRefreshKeys: ["votecount"],
    },
    request: {
      endpoint: "/commands",
      principalUserId: "player_mira",
      command: {
        SubmitVote: {
          game: "midsummer",
          actor_slot: "slot-7",
          target: { Slot: "slot-2" },
        },
      },
    },
    optimisticStatus: { state: "pending" },
    finalStatus: { state: "ack" },
  });

  assert.equal(plan.commandKind, "SubmitVote");
  assert.equal(plan.optimisticState, "pending");
  assert.equal(plan.finalState, "ack");
  assert.deepEqual(plan.projectionRefreshKeys, ["votecount"]);
  assert.equal(commandKindForCommand({ AddCohost: { game: "midsummer" } }), "AddCohost");
});

test("command dispatch bridge rejects incomplete or wrong-kind metadata", () => {
  assert.throws(
    () =>
      commandTraceFromAttributes({
        "data-command-trace-kind": "confirmation-command-trace",
        "data-command-surface": "player",
        "data-command-action-id": "submit_vote",
        "data-command-status-key": "submit_vote",
        "data-command-dispatch-kind": "submit_vote",
      }),
    /unsupported command trace kind/,
  );
  assert.throws(
    () =>
      confirmationTraceFromAttributes({
        "data-confirmation-trace-kind": "confirmation-command-trace",
        "data-confirmation-surface": "admin-setup",
      }),
    /data-confirmation-action-id/,
  );
  assert.throws(
    () =>
      buildDispatchBridgePlan({
        role: "spectator",
        trace: {},
        commandKind: "Watch",
        commandEndpoint: "/commands",
        principalUserId: "viewer",
        optimisticState: "pending",
        finalState: "ack",
      }),
    /unsupported command dispatch role/,
  );
  assert.throws(
    () =>
      buildDispatchBridgePlanFromRequest({
        role: "player",
        trace: {
          kind: "command-trace",
          surface: "player",
          actionId: "submit_vote",
          statusKey: "submit_vote",
          dispatchKind: "submit_vote",
          projectionRefreshKeys: ["votecount"],
        },
        request: {
          principalUserId: "player_mira",
          command: {},
        },
        optimisticStatus: { state: "pending" },
        finalStatus: { state: "ack" },
      }),
    /exactly one wire command kind/,
  );
});
