import {
  playerInvalidActionRecoveryScenario,
  playerActionSubmissionScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  hostPhaseTransitionActionFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  postDayVoteAdvanceSurfaceCases,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";

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
    hostDeadlineControlProof: {
      status: "passed",
      commandKind: "ExtendDeadline",
      command: {
        phase: "D01",
        at: 1781928000,
      },
      commandStatus: {
        state: "ack",
      },
      commandOutcome: {
        state: "ack",
      },
      bridgePlan: {
        finalState: "ack",
      },
      projection: {
        phase: {
          deadline: 1781928000,
        },
      },
      checkpointPhaseStateAfterAck: "open",
      checkpointDeadlineAffordanceAfterAck: "resolve_phase,lock_thread",
      checkpointDeadlineAfterAck: 1781928000,
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

export function hostPhaseTransitionSurfaceFixture({
  game = "game-a",
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  const hostRoleUrl = `${baseRoleUrl}/host`;
  const hostRolePath = `/g/${game}/host`;
  return {
    status: "passed",
    sourceHostRoleUrl: hostRoleUrl,
    sourcePlayerRoleUrl: baseRoleUrl,
    visitedHostRolePath: hostRolePath,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    transition: "resolve_phase:ack:801 -> advance_phase:ack:802 -> player:N02",
    resolveProof: hostPhaseTransitionActionFixture({
      sourceRoleUrl: hostRoleUrl,
      visitedRolePath: hostRolePath,
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 801,
      phaseId: "D02",
      phaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      projectionRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
      command: {
        game,
        seed: 918273,
      },
    }),
    advanceProof: hostPhaseTransitionActionFixture({
      sourceRoleUrl: hostRoleUrl,
      visitedRolePath: hostRolePath,
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 802,
      phaseId: "N02",
      phaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      projectionRefreshKeys: [],
      command: {
        game,
      },
    }),
    staleHostAdvanceRecoveryProof: {
      status: "passed",
      sourceRoleUrl: hostRoleUrl,
      visitedRolePath: hostRolePath,
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 801,
      setupSnapshotHost: {
        phase: {
          id: "D02",
          state: "locked",
        },
      },
      clickedAction: "advance_phase",
      commandKind: "AdvancePhase",
      command: {
        game,
      },
      commandStatus: {
        state: "reject",
        error: "InvalidTarget",
        message:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      },
      commandOutcome: {
        state: "reject",
        error: "InvalidTarget",
        message:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      },
      bridgePlan: {
        role: "moderator",
        commandKind: "AdvancePhase",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      projection: {
        phase: {
          id: "N02",
          state: "open",
          locked: false,
        },
      },
      checkpointPhaseIdAfterReject: "N02",
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      activityStatusText:
        "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      releaseReady: false,
      productionReady: false,
    },
    playerObservationProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      resyncFromSeq: 802,
      resyncKeys: [
        "thread",
        "votecount",
        "dayVoteOutcomes",
        "notifications",
        "investigationResults",
        "commandState",
      ],
      staleVoteRecoveryProof: {
        status: "passed",
        sourceRoleUrl: baseRoleUrl,
        visitedRolePath: `/g/${game}`,
        clickedAction: "submit_vote",
        commandKind: "SubmitVote",
        setupResyncFromSeq: 801,
        setupSnapshotCommandState: {
          phase: {
            phaseId: "D02",
          },
          voteTargets: [
            { kind: "slot", slotId: "slot-2", label: "Slot 2" },
            { kind: "no_lynch", slotId: null, label: "No lynch" },
          ],
        },
        command: {
          game,
          actor_slot: "slot-7",
          target: { Slot: "slot-2" },
        },
        commandStatus: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
        },
        bridgePlan: {
          role: "player",
          commandKind: "SubmitVote",
          commandEndpoint: "/commands",
          finalState: "reject",
          projectionRefreshKeys: [
            "votecount",
            "commandState",
            "dayVoteOutcomes",
          ],
        },
        receipts: [
          {
            actionId: "submit_vote",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
            current: true,
          },
        ],
        projectionCommandState: {
          phase: {
            phaseId: "N02",
          },
          boundary:
            "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
        },
        checkpointReceiptState: "reject:PhaseLocked",
        checkpointPhaseIdAfterReject: "N02",
        checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
        checkpointTargetSlotsAfterReject: "slot-3",
        recoveryText:
          "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
        receiptCount: 1,
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
      },
      staleActionRecoveryProof: {
        status: "passed",
        sourceRoleUrl: baseRoleUrl,
        visitedRolePath: `/g/${game}`,
        clickedAction: "submit_action:factional_kill",
        commandKind: "SubmitAction",
        command: {
          game,
          action_id: "factional_kill",
          actor_slot: "slot-7",
          template_id: "factional_kill",
          targets: ["slot-3"],
          grant_id: "grant-factional-kill",
        },
        commandStatus: {
          state: "reject",
          error: "PhaseLocked",
          message:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        },
        bridgePlan: {
          role: "player",
          commandKind: "SubmitAction",
          commandEndpoint: "/commands",
          finalState: "reject",
          projectionRefreshKeys: [
            "notifications",
            "investigationResults",
            "commandState",
          ],
        },
        receipts: [
          {
            actionId: "submit_vote",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
            current: false,
          },
          {
            actionId: "submit_action:factional_kill",
            state: "reject",
            message:
              "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
            current: true,
          },
        ],
        projectionCommandState: {
          phase: {
            phaseId: "N02",
          },
          boundary:
            "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
        },
        checkpointReceiptState: "reject:PhaseLocked",
        checkpointPhaseIdAfterReject: "N02",
        checkpointActionStateAfterReject: "enabled:submit_action:factional_kill",
        checkpointTargetSlotsAfterReject: "slot-3",
        recoveryText:
          "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
        receiptCount: 2,
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      },
      resyncSnapshotCommandState: {
        phase: {
          phaseId: "N02",
        },
      },
      projectionCommandState: {
        phase: {
          phaseId: "N02",
        },
        boundary:
          "Seeded browser PhaseLocked recovery and player resync observed host AdvancePhase into Night 2.",
      },
      checkpointPhaseId: "N02",
      checkpointPhaseState: "open",
      checkpointActionState: "enabled:submit_action:factional_kill",
      checkpointTargetSlots: "slot-3",
      checkpointReceiptState: "reject:PhaseLocked",
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}

export function playerActionSubmissionClickProofFixture({
  game = "game-a",
  sourceRoleUrl = playerRoleSurfaceSourceRoleUrl({ game }),
  visitedRolePath = playerRoleSurfaceVisitedRolePath({ game }),
} = {}) {
  const scenario = playerActionSubmissionScenario();
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game,
      action_id: scenario.actionId,
      actor_slot: scenario.actorSlot,
      template_id: scenario.templateId,
      targets: [scenario.targetSlot],
      grant_id: scenario.grantId,
    },
    commandStatus: {
      state: scenario.finalState,
      message: `Ack: stream seqs ${scenario.streamSeq}`,
    },
    bridgePlan: {
      role: "player",
      commandKind: scenario.commandKind,
      commandEndpoint: "/commands",
      finalState: scenario.finalState,
      projectionRefreshKeys: scenario.expectedRefreshKeys,
    },
    receipts: [
      {
        actionId: scenario.clickedAction,
        state: scenario.finalState,
        message: `Ack: stream seqs ${scenario.streamSeq}`,
        current: true,
      },
    ],
    projectionCommandState: {
      phase: {
        phaseId: scenario.refreshedPhaseId,
      },
      actions: [],
    },
    checkpointReceiptState: `ack:${scenario.streamSeq}`,
    checkpointActionStateAfterAck: scenario.checkpointActionState,
    receiptCount: 1,
    receiptStatusText: `Ack: stream seqs ${scenario.streamSeq}`,
  };
}

export function playerActionSubmissionRoleSurfaceFixture({
  game = "game-a",
} = {}) {
  const scenario = playerActionSubmissionScenario();
  const invalidScenario = playerInvalidActionRecoveryScenario();
  const sourceRoleUrl = playerRoleSurfaceSourceRoleUrl({ game });
  const visitedRolePath = playerRoleSurfaceVisitedRolePath({ game });
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    checkpointTestId: "player-action-submission-checkpoint",
    clickedThroughFromRoleUrl: true,
    playerActionSubmissionCheckpoint: {
      proofCheckId: "player-action-submission",
      phaseId: scenario.refreshedPhaseId,
      phaseState: "open",
      actorSlot: scenario.actorSlot,
      actionState: `enabled:${scenario.clickedAction}`,
      selectedAction: scenario.actionId,
      targetSlots: scenario.targetSlot,
      receiptState: "idle",
      visibleRows: [
        "phase",
        "actor",
        "actionState",
        "target",
        "receipt",
        "recovery",
      ],
      targetText: `Selected target\n${scenario.actionId} -> ${scenario.targetSlot}`,
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh command state and use current action controls.",
      statusText: "Player action submission is reachable from this role URL",
    },
    playerActionSubmissionClickProof:
      playerActionSubmissionClickProofFixture({
        game,
        sourceRoleUrl,
        visitedRolePath,
      }),
    playerActionInvalidRecoveryProof: {
      status: "passed",
      sourceRoleUrl,
      visitedRolePath,
      clickedAction: invalidScenario.clickedAction,
      commandKind: invalidScenario.commandKind,
      command: {
        game,
        action_id: invalidScenario.actionId,
        actor_slot: invalidScenario.actorSlot,
        template_id: invalidScenario.templateId,
        targets: [invalidScenario.targetSlot],
        grant_id: invalidScenario.grantId,
      },
      commandStatus: {
        state: invalidScenario.finalState,
        error: invalidScenario.error,
        message: invalidScenario.messageIncludes,
      },
      bridgePlan: {
        role: "player",
        commandKind: invalidScenario.commandKind,
        commandEndpoint: "/commands",
        finalState: invalidScenario.finalState,
        projectionRefreshKeys: invalidScenario.expectedRefreshKeys,
      },
      receipts: [
        {
          actionId: invalidScenario.clickedAction,
          state: invalidScenario.finalState,
          message: invalidScenario.messageIncludes,
          current: true,
        },
      ],
      projectionCommandState: {
        phase: {
          phaseId: invalidScenario.refreshedPhaseId,
        },
        actions: [
          {
            templateId: invalidScenario.refreshedActionTemplateId,
          },
        ],
      },
      checkpointReceiptState: invalidScenario.checkpointReceiptState,
      checkpointActionStateAfterReject: invalidScenario.checkpointActionState,
      checkpointTargetSlotsAfterReject:
        invalidScenario.checkpointTargetSlots,
      receiptCount: 1,
      receiptStatusText: invalidScenario.messageIncludes,
    },
    releaseReady: false,
    productionReady: false,
  };
}

export function playerRoleSurfaceSourceRoleUrl({ game }) {
  return `http://127.0.0.1:5173/g/${game}`;
}

export function playerRoleSurfaceVisitedRolePath({ game }) {
  return `/g/${game}`;
}

export function targetResolutionReceiptSurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("n01-target-receipt"),
  });
}

export function normalResolutionPrivacySurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("n01-normal-privacy"),
  });
}

export function targetDayVoteReceiptSurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("d02-target-receipt"),
  });
}

export function normalDayVotePrivacySurfaceFixture({
  game = "game-a",
} = {}) {
  return privateReceiptProofFixture({
    game,
    scenario: privateReceiptScenario("d02-normal-privacy"),
  });
}

export function targetPostDayVoteAdvanceSurfaceFixture({
  game = "game-a",
} = {}) {
  return postDayVoteAdvanceProofFixture({
    game,
    surfaceCase: postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
  });
}

export function normalPostDayVoteAdvanceSurfaceFixture({
  game = "game-a",
} = {}) {
  return postDayVoteAdvanceProofFixture({
    game,
    surfaceCase: postDayVoteAdvanceSurfaceCases().normalPostDayVoteAdvance,
  });
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

export function postDayVoteAdvanceProofFixture({ game, surfaceCase }) {
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
    visitedRolePath: `/g/${game}?private=notification-1`,
    surfaceTestId: "player-surface",
    [surfaceCase.slotField]: surfaceCase.expectedSlot,
    principalUserId: surfaceCase.principalUserId,
    checkpoint: {
      phaseId: surfaceCase.phaseId,
      phaseState: surfaceCase.phaseState,
      actorSlot: surfaceCase.expectedSlot,
      actionState: surfaceCase.actionState,
      receiptState: "idle",
      statusText: `Player action unavailable: ${surfaceCase.statusText}`,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: surfaceCase.privateReceipt ? 1 : 0,
      text: "delivered to you alone",
    },
    projectionCommandState: {
      actorSlot: surfaceCase.expectedSlot,
      actorAlive: surfaceCase.actorAlive,
      actorStatus: surfaceCase.actorStatus,
      phase: {
        phaseId: surfaceCase.phaseId,
        locked: surfaceCase.phaseState === "locked",
      },
      actions: [],
      boundary: surfaceCase.boundaryText,
    },
    projectionNotifications: [],
    resyncFromSeq: surfaceCase.resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: surfaceCase.expectedSlot,
      phase: {
        phaseId: surfaceCase.phaseId,
      },
    },
    resyncSnapshotNotifications: [],
    coldLoadEndpoints: {
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${surfaceCase.principalUserId}`,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${surfaceCase.principalUserId}&slot_id=${surfaceCase.expectedSlot}`,
    },
  };
  if (surfaceCase.privateReceipt) {
    return {
      ...proof,
      privateNotice: {
        id: "notification-1",
        kind: "notification",
        text: `player_killed ${surfaceCase.privateReceiptStatus}`,
        detailText: `Phase ${surfaceCase.privateReceiptPhaseId}`,
      },
      projectionNotifications: [
        { effect: "player_killed", status: surfaceCase.privateReceiptStatus },
      ],
      resyncSnapshotNotifications: [
        { status: surfaceCase.privateReceiptStatus },
      ],
    };
  }
  return {
    ...proof,
    targetReceiptVisible: false,
    privateEmptyText: "No private results visible",
  };
}

export function privateReceiptSourceRoleUrl({ game }) {
  return `http://127.0.0.1:5173/g/${game}?private=notification-1`;
}
