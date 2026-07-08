import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";
import {
  hostDeadlineAffordanceForPhaseState,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  dayFourNoLynchResolutionSurfaceCase,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  nightFourNoActionResolutionSurfaceCase,
  nightFourNoActionSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";

export function lateLoopDayVoteOutcomesFixture() {
  return [
    { phaseId: "D02", status: "Lynch" },
    { phaseId: "D03", status: "Lynch" },
    { phaseId: "D04", status: "NoLynch" },
  ];
}

export function nightFourNoActionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const surfaceCase = nightFourNoActionSurfaceCase();
  const noLynchCase = dayFourNoLynchResolutionSurfaceCase();
  const voteCase = noLynchCase.voteCase;
  const hostTransitionCase = surfaceCase.dayFourHostTransitionCase;
  const noActionCase = surfaceCase.noActionCase;
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition: surfaceCase.transitionFragments.join(" -> "),
    dayFourVoteProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: voteCase.surfaceTestId,
      clickedThroughFromRoleUrl: true,
      clickedAction: voteCase.clickedAction,
      commandKind: voteCase.commandKind,
      command: {
        game,
        actor_slot: voteCase.actorSlot,
        target: voteCase.target,
      },
      commandStatus: {
        state: "ack",
        message: `Ack: stream seqs ${voteCase.streamSeq}`,
      },
      bridgePlan: {
        role: "player",
        commandKind: voteCase.commandKind,
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: voteCase.expectedRefreshKeys,
      },
      receipts: [{ state: "ack" }],
      projectionCommandState: {
        actorSlot: voteCase.actorSlot,
        phase: {
          phaseId: voteCase.setupPhaseId,
          locked: false,
        },
        currentVote: {
          kind: "no_lynch",
        },
        boundary:
          "Seeded browser Day 4 no-lynch vote ACK refreshed current vote and votecount projection.",
      },
      projectionVotecount: [
        {
          target: voteCase.expectedVotecountTarget,
          count: voteCase.expectedVotecountCount,
          needed: voteCase.expectedVotecountNeeded,
        },
      ],
      projectionDayVoteOutcomes: [
        { phaseId: "D02" },
        { phaseId: voteCase.expectedPriorDayVoteOutcomePhaseId },
      ],
      setupResyncFromSeq: voteCase.setupResyncFromSeq,
      setupSnapshotCommandState: {
        phase: {
          phaseId: voteCase.setupPhaseId,
        },
      },
      currentVote: {
        hasVote: "true",
        text: "Current vote: No lynch",
      },
      receiptCount: 1,
      receiptStatusText: `Ack: stream seqs ${voteCase.streamSeq}`,
      receiptRefreshKeys: voteCase.expectedReceiptRefreshKeys,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostTransitionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: hostTransitionCase.setupResyncFromSeq,
      setupPhaseId: hostTransitionCase.setupPhaseId,
      setupPhaseState: hostTransitionCase.setupPhaseState,
      resolveProof: {
        ...hostPhaseTransitionActionFixture({
          actionId: hostTransitionCase.resolveCase.actionId,
          commandKind: hostTransitionCase.resolveCase.commandKind,
          streamSeq: hostTransitionCase.resolveCase.streamSeq,
          phaseId: hostTransitionCase.resolveCase.expectedPhaseId,
          phaseState: hostTransitionCase.resolveCase.expectedPhaseState,
          deadlineAffordance: hostDeadlineAffordanceForPhaseState(
            hostTransitionCase.resolveCase.expectedPhaseState,
          ),
          projectionRefreshKeys:
            hostTransitionCase.resolveCase.expectedRefreshKeys,
          command: {
            game,
            seed: 918273,
          },
        }),
        votecountProjection: [
          {
            target: hostTransitionCase.expectedVotecountTarget,
            count: voteCase.expectedVotecountCount,
            needed: voteCase.expectedVotecountNeeded,
          },
        ],
        dayVoteOutcomesProjection: [
          { phaseId: "D02" },
          { phaseId: "D03" },
          {
            phaseId: hostTransitionCase.expectedDayVoteOutcomePhaseId,
            status: hostTransitionCase.expectedDayVoteOutcomeStatus,
          },
        ],
      },
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: hostTransitionCase.advanceCase.actionId,
        commandKind: hostTransitionCase.advanceCase.commandKind,
        streamSeq: hostTransitionCase.advanceCase.streamSeq,
        phaseId: hostTransitionCase.advanceCase.expectedPhaseId,
        phaseState: hostTransitionCase.advanceCase.expectedPhaseState,
        deadlineAffordance: hostDeadlineAffordanceForPhaseState(
          hostTransitionCase.advanceCase.expectedPhaseState,
        ),
        projectionRefreshKeys:
          hostTransitionCase.advanceCase.expectedRefreshKeys,
        command: {
          game,
        },
      }),
    }),
    nightFourNoActionProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: noActionCase.surfaceTestId,
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: noActionCase.setupResyncFromSeq,
      setupSnapshotCommandState: {
        phase: {
          phaseId: noActionCase.setupPhaseId,
        },
        actions: [],
      },
      checkpoint: {
        phaseId: noActionCase.setupPhaseId,
        phaseState: noActionCase.expectedPhaseState,
        actorSlot: noActionCase.expectedSlot,
        actionCount: noActionCase.expectedActionCount,
        submitActionControls: noActionCase.expectedSubmitActionControls,
        voteTargetCount: noActionCase.expectedVoteTargetCount,
        privateCount: noActionCase.expectedPrivateCount,
      },
      projectionCommandState: {
        actorSlot: noActionCase.expectedSlot,
        actorAlive: noActionCase.expectedActorAlive,
        actorStatus: noActionCase.expectedActorStatus,
        phase: {
          phaseId: noActionCase.setupPhaseId,
          locked: false,
        },
        actions: [],
        voteTargets: [],
        boundary:
          "Seeded browser opened Night 4 with no legal action available.",
      },
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}

export function nightFourNoActionResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const surfaceCase = nightFourNoActionResolutionSurfaceCase();
  const hostCase = surfaceCase.hostResolutionCase;
  const privacyCase = surfaceCase.actionPlayerPrivacyScenario;
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition: surfaceCase.transitionFragments.join(" -> "),
    hostResolutionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: hostCase.setupResyncFromSeq,
      setupPhaseId: hostCase.setupPhaseId,
      setupPhaseState: hostCase.setupPhaseState,
      resolveProof: hostPhaseTransitionActionFixture({
        actionId: hostCase.resolveCase.actionId,
        commandKind: hostCase.resolveCase.commandKind,
        streamSeq: hostCase.resolveCase.streamSeq,
        phaseId: hostCase.resolveCase.expectedPhaseId,
        phaseState: hostCase.resolveCase.expectedPhaseState,
        deadlineAffordance: hostDeadlineAffordanceForPhaseState(
          hostCase.resolveCase.expectedPhaseState,
        ),
        projectionRefreshKeys: hostCase.resolveCase.expectedRefreshKeys,
        command: {
          game,
          seed: 918273,
        },
      }),
    }),
    actionPlayerPrivacyProof: nightFourResolutionPlayerSurfaceFixture({
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      slotField: privacyCase.slotField,
      slot: privacyCase.expectedSlot,
      principalUserId: privacyCase.principalUserId,
      phaseId: privacyCase.phaseId,
      phaseState: privacyCase.phaseState,
      actorAlive: privacyCase.actorAlive,
      actorStatus: privacyCase.actorStatus,
      actionState: privacyCase.actionState,
      statusText: `Player action unavailable: ${privacyCase.statusText}`,
      privateCount: privacyCase.privateReceipt ? 1 : 0,
      privateReceipt: privacyCase.privateReceipt,
      privateReceiptStatus: privacyCase.privateReceiptStatus,
      privateReceiptPhaseId: privacyCase.privateReceiptPhaseId,
      boundary: `Seeded browser ${privacyCase.boundaryText}.`,
      resyncFromSeq: privacyCase.resyncFromSeq,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${privacyCase.principalUserId}&slot_id=${privacyCase.expectedSlot}`,
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${privacyCase.principalUserId}`,
    }),
    releaseReady: false,
    productionReady: false,
  };
}

export function postNightFourTransitionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
  dayVoteOutcomes = lateLoopDayVoteOutcomesFixture(),
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceDeadPlayerRoleUrl: `${baseRoleUrl}?private=notification-1`,
    clickedThroughFromRoleUrl: true,
    transition:
      "host:N04:advance_phase:ack:917 -> deadPlayer:D05:dead_no_controls -> actionPlayer:D05:no_lynch_controls -> stale:N04:submit_action:reject:PhaseLocked",
    hostAdvanceProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 916,
      setupPhaseId: "N04",
      setupPhaseState: "locked",
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 917,
        phaseId: "D05",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
        dayVoteOutcomesProjection: dayVoteOutcomes,
      }),
    }),
    deadPlayerDayFiveProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      roleUrlSuffix: "?private=notification-1",
      slotField: "deadPlayerSlot",
      slot: "slot-3",
      principalUserId: "player-seed",
      phaseId: "D05",
      phaseState: "open",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "Player action unavailable: actor is not alive",
      privateCount: 1,
      privateReceipt: true,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N02",
      boundary:
        "Seeded browser dead player stayed dead from the N02 factional kill after N04 advanced to Day 5.",
      resyncFromSeq: 917,
      dayVoteOutcomes,
    }),
    actionPlayerDayFiveProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D05",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed open Day 5 no-lynch controls after Night 4 advanced.",
      resyncFromSeq: 917,
      voteButtonCount: 1,
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
      dayVoteOutcomes,
    }),
    staleNightFourActionRecoveryProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      setupResyncFromSeq: 916,
      setupSnapshotCommandState: {
        phase: { phaseId: "N04" },
        actions: [{ targets: ["slot-5"] }],
      },
      command: {
        game,
        actor_slot: "slot-7",
        action_id: "factional_kill",
        template_id: "factional_kill",
        targets: ["slot-5"],
        grant_id: "grant-factional-kill-n04",
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
          "dayVoteOutcomes",
        ],
      },
      receipts: [{ state: "reject" }],
      projectionCommandState: {
        actorSlot: "slot-7",
        phase: {
          phaseId: "D05",
          locked: false,
        },
        actions: [],
        voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        boundary:
          "Seeded browser PhaseLocked stale N04 action refreshed into current Day 5 controls.",
      },
      checkpointReceiptState: "reject:PhaseLocked",
      checkpointPhaseIdAfterReject: "D05",
      checkpointActionStateAfterReject: "disabled:no legal action available",
      checkpointTargetSlotsAfterReject: "",
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh and use current action controls.",
      receiptCount: 1,
      receiptStatusText: "Reject PhaseLocked",
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}

function nightFourResolutionPlayerSurfaceFixture({
  sourceRoleUrl,
  visitedRolePath,
  slotField,
  slot,
  principalUserId,
  phaseId,
  phaseState,
  actorAlive,
  actorStatus,
  actionState,
  statusText,
  privateCount,
  privateReceipt,
  privateReceiptStatus,
  privateReceiptPhaseId,
  boundary,
  resyncFromSeq,
  commandStateEndpoint,
  notificationsEndpoint,
}) {
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    [slotField]: slot,
    principalUserId,
    checkpoint: {
      phaseId,
      phaseState,
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text:
        "Night results and notices are delivered to you alone.",
    },
    voteButtonCount: 0,
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      phase: {
        phaseId,
        locked: phaseState === "locked",
      },
      actions: [],
      voteTargets: [],
      boundary,
    },
    projectionNotifications: privateReceipt
      ? [
          {
            effect: "player_killed",
            status: privateReceiptStatus,
          },
        ]
      : [],
    projectionDayVoteOutcomes: lateLoopDayVoteOutcomesFixture(),
    resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      phase: {
        phaseId,
      },
    },
    resyncSnapshotNotifications: privateReceipt
      ? [
          {
            status: privateReceiptStatus,
          },
        ]
      : [],
    coldLoadEndpoints: {
      notificationsEndpoint,
      commandStateEndpoint,
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (privateReceipt) {
    proof.privateNotice = {
      id: "notification-1",
      kind: "notification",
      text: `player_killed ${privateReceiptStatus}`,
      detailText: `Phase ${privateReceiptPhaseId}`,
    };
  } else {
    proof.privateEmptyText = "No private results visible";
  }
  return proof;
}
