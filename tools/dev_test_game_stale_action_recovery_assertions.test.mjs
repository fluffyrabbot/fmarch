import test from "node:test";
import assert from "node:assert/strict";
import {
  staleActionRejectRecoveryMatches,
} from "./dev_test_game_stale_action_recovery_assertions.mjs";

const staleActionProofFixture = () => ({
  reject: {
    state: "reject",
    error: "PhaseLocked",
    message:
      "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
    serverEnvelope: { body: { kind: "Reject" } },
    requestEnvelope: {
      body: {
        body: {
          command: {
            SubmitAction: {
              actor_slot: "slot_4",
              action_id: "role_factional_kill",
              template_id: "factional_kill",
              targets: ["slot-2"],
            },
          },
        },
      },
    },
  },
  dispatchPlan: {
    projectionRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
      "dayVoteOutcomes",
    ],
  },
  currentReceipt: {
    actionId: "submit_action:factional_kill",
    state: "reject",
    commandTrace: {
      projectionRefreshKeys: ["notifications", "commandState"],
    },
  },
  receiptStatusText: "Reject PhaseLocked: stale action state",
  staleN01Phase: { phaseId: "N01" },
  commandStateAfterReject: {
    actorSlot: "slot_4",
    actorAlive: true,
    actorStatus: "alive",
    phase: { phaseId: "D02", locked: false },
    actions: [],
  },
  apiCommandStateAfterReject: {
    actor_slot: "slot_4",
    actor_alive: true,
    actor_status: "alive",
    phase: { phase_id: "D02", locked: false },
    actions: [],
  },
  actionVisibleAfterRefresh: false,
});

const staleActionExpectation = {
  error: "PhaseLocked",
  actorSlot: "slot_4",
  actionId: "role_factional_kill",
  templateId: "factional_kill",
  targetSlot: "slot-2",
  commandAction: "submit_action:factional_kill",
  messageFragments: ["stale action state", "current action controls"],
  dispatchRefreshKeys: [
    "notifications",
    "investigationResults",
    "commandState",
    "dayVoteOutcomes",
  ],
  receiptRefreshKeys: ["commandState"],
  receiptStatusFragments: ["Reject PhaseLocked", "stale action state"],
  stalePhaseId: "N01",
  browserCommandState: {
    actorSlot: "slot_4",
    actorAlive: true,
    actorStatus: "alive",
    phaseId: "D02",
    locked: false,
    actionCount: 0,
  },
  apiCommandState: {
    actorSlot: "slot_4",
    actorAlive: true,
    actorStatus: "alive",
    phaseId: "D02",
    locked: false,
    actionCount: 0,
  },
};

test("stale action reject recovery assertion covers envelope and refreshed states", () => {
  assert.equal(
    staleActionRejectRecoveryMatches(
      staleActionProofFixture(),
      staleActionExpectation,
    ),
    true,
  );
});

test("stale action reject recovery assertion rejects missing refresh key", () => {
  const proof = staleActionProofFixture();
  proof.dispatchPlan.projectionRefreshKeys = ["notifications", "commandState"];

  assert.equal(
    staleActionRejectRecoveryMatches(proof, staleActionExpectation),
    false,
  );
});

test("stale action reject recovery assertion rejects stale visible action", () => {
  const proof = staleActionProofFixture();
  proof.actionVisibleAfterRefresh = true;
  proof.buttonsAfterReject = [
    { action: "submit_action:factional_kill", disabled: false },
  ];

  assert.equal(
    staleActionRejectRecoveryMatches(proof, staleActionExpectation),
    false,
  );
});
