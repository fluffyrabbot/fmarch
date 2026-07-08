import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertHostPhaseTransitionSurfaceProof,
  assertLiveStaleD02VoteTransitionRecovery,
  assertLiveStaleN01ActionTransitionRecovery,
  liveStaleD02VoteTransitionRecoveryProof,
  liveStaleN01ActionTransitionRecoveryProof,
} from "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs";
import {
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

test("core-loop proof and readiness share transition recovery assertions", async () => {
  const callerPaths = [
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
  ];

  for (const callerPath of callerPaths) {
    const source = await readFile(callerPath, "utf8");
    assert(
      source.includes(
        "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs",
      ),
      `${callerPath} should import transition recovery assertions through the shared module`,
    );
    for (const localFunctionName of [
      "function assertDayFiveNoLynchVoteProof",
      "function assertDayFiveNoLynchHostTransitionProof",
      "function assertStaleDayFiveVoteRecoveryProof",
      "function assertCoreLoopDayFiveNoLynchVoteProof",
      "function assertCoreLoopDayFiveNoLynchHostTransitionProof",
      "function assertCoreLoopStaleDayFiveVoteRecoveryProof",
    ]) {
      assert(
        !source.includes(localFunctionName),
        `${callerPath} should not carry a local ${localFunctionName} copy`,
      );
    }
  }
});

test("shared host phase transition surface assertion composes stale recovery cases", () => {
  const actionCalls = [];
  const surface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
    sourcePlayerRoleUrl: "http://127.0.0.1/g/game-a",
    visitedHostRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    transition:
      "host:D02:resolve_phase:ack:801 -> host:advance_phase:ack:802 -> player:N02",
    resolveProof: { proofId: "resolve" },
    advanceProof: { proofId: "advance" },
    staleHostAdvanceRecoveryProof: hostStaleAdvanceProofFixture(),
    playerObservationProof: playerObservationProofFixture(),
  };

  assert.doesNotThrow(() =>
    assertHostPhaseTransitionSurfaceProof({
      hostPhaseTransitionSurface: surface,
      assertHostPhaseTransitionActionProof: (args) => actionCalls.push(args),
    }),
  );
  assert.deepEqual(
    actionCalls.map((call) => [
      call.proof.proofId,
      call.actionId,
      call.commandKind,
      call.streamSeq,
      call.expectedPhaseId,
      call.sourceRoleUrl,
    ]),
    [
      [
        "resolve",
        "resolve_phase",
        "ResolvePhase",
        801,
        "D02",
        surface.sourceHostRoleUrl,
      ],
      [
        "advance",
        "advance_phase",
        "AdvancePhase",
        802,
        "N02",
        surface.sourceHostRoleUrl,
      ],
    ],
  );

  assert.throws(
    () =>
      assertHostPhaseTransitionSurfaceProof({
        hostPhaseTransitionSurface: {
          ...surface,
          playerObservationProof: {
            ...surface.playerObservationProof,
            checkpointTargetSlots: "",
          },
        },
        assertHostPhaseTransitionActionProof: () => {},
      }),
    /player phase transition observation/,
  );
});

test("shared live stale D02 vote transition assertion adapts raw browser evidence", () => {
  const scenario = {
    ...staleDayTwoVoteAfterTransitionRecoveryScenario(),
    actorSlot: "slot_4",
  };
  const setup = liveStaleVoteSetupFixture();
  const recovery = liveStaleVoteRecoveryFixture();
  const proof = liveStaleD02VoteTransitionRecoveryProof({
    setup,
    recovery,
    expectedGame: "game-a",
    scenario,
  });

  assert.deepEqual(
    {
      actorSlot: proof.command.actor_slot,
      targetSlot: proof.command.target.Slot,
      phase: proof.projectionCommandState.phase.phaseId,
      actionState: proof.checkpointActionStateAfterReject,
      targetSlots: proof.checkpointTargetSlotsAfterReject,
    },
    {
      actorSlot: "slot_4",
      targetSlot: "slot-2",
      phase: "N02",
      actionState: "enabled:submit_action:factional_kill",
      targetSlots: "slot-3",
    },
  );
  assert.doesNotThrow(() =>
    assertLiveStaleD02VoteTransitionRecovery({
      setup,
      recovery,
      expectedGame: "game-a",
      scenario,
    }),
  );
  assert.throws(
    () =>
      assertLiveStaleD02VoteTransitionRecovery({
        setup: {
          ...setup,
          closedStatus: { state: "open" },
        },
        recovery,
        expectedGame: "game-a",
        scenario,
      }),
    /stale D02 vote transition setup/,
  );
});

test("shared live stale N01 action transition assertion adapts raw browser evidence", () => {
  const scenario = {
    ...staleNightOneActionAfterTransitionRecoveryScenario(),
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    refreshedPhaseId: "D02",
    expectedRefreshKeys: [
      "notifications",
      "investigationResults",
      "commandState",
      "dayVoteOutcomes",
    ],
    checkpointActionState: "disabled:no legal action available",
    checkpointTargetSlots: "",
    receiptCount: 1,
  };
  const setup = liveStaleActionSetupFixture();
  const recovery = liveStaleActionRecoveryFixture();
  const proof = liveStaleN01ActionTransitionRecoveryProof({
    setup,
    recovery,
    expectedGame: "game-a",
    scenario,
  });

  assert.deepEqual(
    {
      actorSlot: proof.command.actor_slot,
      targetSlot: proof.command.targets[0],
      phase: proof.projectionCommandState.phase.phaseId,
      actionState: proof.checkpointActionStateAfterReject,
      targetSlots: proof.checkpointTargetSlotsAfterReject,
    },
    {
      actorSlot: "slot_4",
      targetSlot: "slot-2",
      phase: "D02",
      actionState: "disabled:no legal action available",
      targetSlots: "",
    },
  );
  assert.doesNotThrow(() =>
    assertLiveStaleN01ActionTransitionRecovery({
      setup,
      recovery,
      expectedGame: "game-a",
      scenario,
    }),
  );
  assert.throws(
    () =>
      assertLiveStaleN01ActionTransitionRecovery({
        setup: {
          ...setup,
          closedStatus: { state: "open" },
        },
        recovery,
        expectedGame: "game-a",
        scenario,
      }),
    /stale N01 action transition setup/,
  );
});

function hostStaleAdvanceProofFixture() {
  return {
    status: "passed",
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 801,
    setupSnapshotHost: {
      phase: { id: "D02", state: "locked" },
    },
    clickedAction: "advance_phase",
    commandKind: "AdvancePhase",
    command: { game: "game-a" },
    commandStatus: {
      state: "reject",
      error: "InvalidTarget",
      message: "stale phase state, refresh and use current controls",
    },
    commandOutcome: {
      state: "reject",
      error: "InvalidTarget",
      message: "stale phase state, refresh and use current controls",
    },
    bridgePlan: {
      role: "moderator",
      commandKind: "AdvancePhase",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["host"],
    },
    projection: {
      phase: { id: "N02", state: "open", locked: false },
    },
    checkpointPhaseIdAfterReject: "N02",
    checkpointPhaseStateAfterReject: "open",
    checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
    activityStatusText: "Reject InvalidTarget: invalid target",
  };
}

function liveStaleVoteSetupFixture() {
  return {
    commandState: {
      actorSlot: "slot_4",
      phase: { phaseId: "D02", locked: false },
      voteTargets: [{ kind: "slot", slotId: "slot-2", label: "Slot 2" }],
    },
    voteButton: { action: "submit_vote", disabled: false, text: "Vote Slot 2" },
    closedStatus: { state: "closed" },
  };
}

function liveStaleVoteRecoveryFixture() {
  return {
    status: "passed",
    reject: {
      state: "reject",
      error: "PhaseLocked",
      message:
        "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
      requestEnvelope: {
        body: {
          body: {
            command: {
              SubmitVote: {
                actor_slot: "slot_4",
                target: { Slot: "slot-2" },
              },
            },
          },
        },
      },
    },
    dispatchPlan: {
      projectionRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    },
    commandStateAfterReject: {
      phase: { phaseId: "N02", locked: false },
      actions: [{ templateId: "factional_kill", targets: ["slot-3"] }],
      boundary: "Role-action availability is derived from committed state.",
    },
    currentReceipt: { state: "reject" },
    receiptStatusText:
      "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
    buttonsAfterReject: [
      { action: "submit_action:factional_kill", disabled: false },
    ],
  };
}

function liveStaleActionSetupFixture() {
  return {
    staleN01Phase: { phaseId: "N01", locked: false },
    actionConfig: {
      actionId: "role_factional_kill",
      templateId: "factional_kill",
      targets: ["slot-2"],
    },
    closedStatus: { state: "closed" },
  };
}

function liveStaleActionRecoveryFixture() {
  return {
    status: "passed",
    reject: {
      state: "reject",
      error: "PhaseLocked",
      message:
        "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      requestEnvelope: {
        body: {
          body: {
            command: {
              SubmitAction: {
                action_id: "role_factional_kill",
                actor_slot: "slot_4",
                template_id: "factional_kill",
                targets: ["slot-2"],
                grant_id: null,
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
    commandStateAfterReject: {
      actorSlot: "slot_4",
      phase: { phaseId: "D02", locked: false },
      actions: [],
      boundary: "Role-action availability is derived from committed state.",
    },
    currentReceipt: { state: "reject" },
    receiptStatusText:
      "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
    actionVisibleAfterRefresh: false,
  };
}

function playerObservationProofFixture() {
  const sourceRoleUrl = "http://127.0.0.1/g/game-a";
  const visitedRolePath = "/g/game-a";
  return {
    status: "passed",
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    resyncFromSeq: 802,
    resyncKeys: ["commandState"],
    resyncSnapshotCommandState: {
      phase: { phaseId: "N02" },
    },
    projectionCommandState: {
      phase: { phaseId: "N02" },
      boundary: "AdvancePhase opened Night 2 controls",
    },
    checkpointPhaseId: "N02",
    checkpointPhaseState: "open",
    checkpointActionState: "enabled:submit_action:factional_kill",
    checkpointTargetSlots: "slot-3",
    checkpointReceiptState: "reject:PhaseLocked",
    staleVoteRecoveryProof: staleVoteProofFixture({
      sourceRoleUrl,
      visitedRolePath,
    }),
    staleActionRecoveryProof: staleActionProofFixture({
      sourceRoleUrl,
      visitedRolePath,
    }),
    staleTransitionRecoveryRoleUrlConsistency: {
      staleVoteSourceRoleUrl: sourceRoleUrl,
      staleActionSourceRoleUrl: sourceRoleUrl,
      staleVoteVisitedRolePath: visitedRolePath,
      staleActionVisitedRolePath: visitedRolePath,
      sameSourceRoleUrl: true,
      sameVisitedRolePath: true,
      rawInviteTokensVisible: false,
    },
    rawInviteTokensVisible: false,
  };
}

function staleVoteProofFixture({ sourceRoleUrl, visitedRolePath }) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    clickedAction: "submit_vote",
    commandKind: "SubmitVote",
    setupResyncFromSeq: 801,
    setupSnapshotCommandState: {
      phase: { phaseId: "D02" },
      voteTargets: [{ slotId: "slot-2" }],
    },
    command: {
      game: "game-a",
      actor_slot: "slot-7",
      target: { Slot: "slot-2" },
    },
    commandStatus: {
      state: "reject",
      error: "PhaseLocked",
      message: "stale vote state, refresh and use current vote controls",
    },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitVote",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      phase: { phaseId: "N02" },
      boundary: "PhaseLocked recovery refreshed player controls",
    },
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointPhaseIdAfterReject: "N02",
    checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
    checkpointTargetSlotsAfterReject: "slot-3",
    recoveryText: "Reject PhaseLocked",
    receiptCount: 1,
    receiptStatusText: "stale vote state",
  };
}

function staleActionProofFixture({ sourceRoleUrl, visitedRolePath }) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    clickedAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    command: {
      game: "game-a",
      action_id: "factional_kill",
      actor_slot: "slot-7",
      template_id: "factional_kill",
      targets: ["slot-3"],
    },
    commandStatus: {
      state: "reject",
      error: "PhaseLocked",
      message: "stale action state, refresh and use current action controls",
    },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitAction",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["commandState"],
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      phase: { phaseId: "N02" },
      boundary: "PhaseLocked recovery refreshed action controls",
    },
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointPhaseIdAfterReject: "N02",
    checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
    checkpointTargetSlotsAfterReject: "slot-3",
    recoveryText: "Reject PhaseLocked",
    receiptCount: 2,
    receiptStatusText: "Reject PhaseLocked: phase locked",
  };
}
