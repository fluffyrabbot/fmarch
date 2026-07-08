import {
  playerActionSubmissionScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

export function hostRoleSurfaceCheckpointFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    checkpointTestId: "host-lifecycle-control-checkpoint",
    hostLifecycleControlCheckpoint: {
      proofCheckId: "host-lifecycle-control",
    },
    hostLifecycleControlClickProof: {
      status: "passed",
      commandKind: "LockThread",
      checkpointPhaseStateAfterAck: "locked",
      checkpointDeadlineAffordanceAfterAck: "unlock_thread,advance_phase",
    },
    hostLifecycleUnlockProof: {
      status: "passed",
      commandKind: "UnlockThread",
      checkpointPhaseStateAfterAck: "open",
      checkpointDeadlineAffordanceAfterAck: "resolve_phase,lock_thread",
    },
    hostLifecycleStaleRejectProof: {
      status: "passed",
      commandKind: "LockThread",
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
      },
      bridgePlan: {
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      recoveryText: "Reject PhaseLocked",
    },
  };
}

export function hostPhaseTransitionSurfaceFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    transition: "advance_phase:ack:802",
    advanceProof: {
      status: "passed",
      commandKind: "AdvancePhase",
      commandStatus: { state: "ack" },
      commandOutcome: { state: "ack" },
      bridgePlan: { finalState: "ack" },
      checkpointPhaseId: "N02",
      checkpointPhaseState: "open",
      checkpointDeadlineAffordance: "resolve_phase,lock_thread",
    },
  };
}

export function playerActionSubmissionClickProofFixture() {
  const scenario = playerActionSubmissionScenario();
  return {
    status: "passed",
    commandKind: scenario.commandKind,
    commandStatus: {
      state: scenario.finalState,
    },
    bridgePlan: {
      finalState: scenario.finalState,
    },
    checkpointReceiptState: `ack:${scenario.streamSeq}`,
    checkpointActionStateAfterAck: scenario.checkpointActionState,
    receiptCount: 1,
    receiptStatusText: `Ack: stream seqs ${scenario.streamSeq}`,
  };
}

export function playerActionSubmissionRoleSurfaceFixture() {
  return {
    playerActionSubmissionClickProof:
      playerActionSubmissionClickProofFixture(),
  };
}

export function nightActionResolutionReceiptSurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("n02-target-receipt"),
  });
}

export function normalNightActionResolutionPrivacySurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("n02-normal-privacy"),
  });
}

export function privateReceiptProofFixture({ game, scenario }) {
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
    visitedRolePath: `/g/${game}?private=notification-1`,
    surfaceTestId: "player-surface",
    [scenario.slotField]: scenario.expectedSlot,
    principalUserId: scenario.principalUserId,
    checkpoint: {
      phaseId: scenario.phaseId,
      phaseState: scenario.phaseState,
      actorSlot: scenario.expectedSlot,
      actionState: scenario.actionState,
      receiptState: "idle",
      statusText: `Player action unavailable: ${scenario.statusText}`,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: scenario.privateReceipt ? 1 : 0,
      text: "delivered to you alone",
    },
    projectionCommandState: {
      actorSlot: scenario.expectedSlot,
      actorAlive: scenario.actorAlive,
      actorStatus: scenario.actorStatus,
      phase: {
        phaseId: scenario.phaseId,
        locked: scenario.phaseState === "locked",
      },
      actions: [],
      boundary: scenario.boundaryText,
    },
    resyncFromSeq: scenario.resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: scenario.expectedSlot,
      phase: { phaseId: scenario.phaseId },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${scenario.principalUserId}`,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
    },
  };
  if (scenario.privateReceipt) {
    return {
      ...proof,
      privateNotice: {
        id: "notification-1",
        kind: "notification",
        text: `player_killed ${scenario.privateReceiptStatus}`,
        detailText: `Phase ${scenario.privateReceiptPhaseId}`,
      },
      projectionNotifications: [
        { effect: "player_killed", status: scenario.privateReceiptStatus },
      ],
      resyncSnapshotNotifications: [
        { effect: "player_killed", status: scenario.privateReceiptStatus },
      ],
    };
  }
  return {
    ...proof,
    targetReceiptVisible: false,
    privateEmptyText: "No private results visible",
    projectionNotifications: [],
    resyncSnapshotNotifications: [],
  };
}

export function privateReceiptSourceRoleUrl({ game }) {
  return `http://127.0.0.1:5173/g/${game}?private=notification-1`;
}
