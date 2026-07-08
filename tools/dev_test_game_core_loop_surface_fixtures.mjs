import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
  seededCoreLoopRoleUrl,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";
import {
  dayThreeVoteResolutionSurfaceCase,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  emptyNightThreeHostTransitionProofCase,
  hostDeadlineAffordanceForPhaseState,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  dayFourSurvivorRoleSurfaceCase,
  nightThreeEmptyResolutionSurfaceCase,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";

export function dayThreeVoteResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const surfaceCase = dayThreeVoteResolutionSurfaceCase();
  const voteCase = surfaceCase.playerVoteCase;
  const hostCase = surfaceCase.hostResolutionCase;
  const baseRoleUrl = seededCoreLoopRoleUrl({ game });
  const hostRoleUrl = seededCoreLoopRoleUrl({ game, suffix: "/host" });
  return {
    status: "passed",
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceHostRoleUrl: hostRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition: surfaceCase.transitionFragments.join(" -> "),
    playerVoteProof: {
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
        target: { Slot: voteCase.targetSlot },
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
      receipts: [
        {
          actionId: voteCase.clickedAction,
          state: "ack",
          message: `Ack: stream seqs ${voteCase.streamSeq}`,
          current: true,
        },
      ],
      projectionCommandState: {
        actorSlot: voteCase.actorSlot,
        phase: {
          phaseId: voteCase.expectedPhaseId,
          locked: false,
        },
        currentVote: {
          kind: "slot",
          slotId: voteCase.targetSlot,
          label: "Slot 4",
        },
        boundary:
          "Seeded browser Day 3 vote ACK refreshed current vote and votecount projection.",
      },
      projectionVotecount: [
        {
          target: hostCase.targetLabel,
          count: hostCase.expectedCount,
          needed: hostCase.expectedNeeded,
        },
      ],
      projectionDayVoteOutcomes: [
        {
          phaseId: voteCase.previousOutcomePhaseId,
          status: "Lynch",
        },
      ],
      setupResyncFromSeq: voteCase.setupResyncFromSeq,
      setupSnapshotCommandState: {
        phase: {
          phaseId: voteCase.expectedPhaseId,
        },
      },
      currentVote: {
        hasVote: "true",
        text: "Current vote Slot 4",
      },
      receiptCount: 1,
      receiptStatusText: `Ack: stream seqs ${voteCase.streamSeq}`,
      receiptRefreshKeys: voteCase.expectedReceiptRefreshKeys,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostResolutionProof: seededCoreLoopHostSurfaceFixture({
      game,
      resolveProof: {
        ...hostPhaseTransitionActionFixture({
          sourceRoleUrl: hostRoleUrl,
          visitedRolePath: `/g/${game}/host`,
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
        votecountProjection: [
          {
            target: hostCase.targetLabel,
            count: hostCase.expectedCount,
            needed: hostCase.expectedNeeded,
          },
        ],
        dayVoteOutcomesProjection: [
          { phaseId: "D02", status: "Lynch" },
          {
            phaseId: hostCase.expectedOutcomePhaseId,
            status: hostCase.expectedOutcomeStatus,
            winnerSlot: hostCase.expectedWinnerSlot,
          },
        ],
      },
      hostVotecountProjection: [
        {
          target: hostCase.targetLabel,
          count: hostCase.expectedCount,
          needed: hostCase.expectedNeeded,
        },
      ],
      hostDayVoteOutcomesProjection: [
        { phaseId: "D02", status: "Lynch" },
        {
          phaseId: hostCase.expectedOutcomePhaseId,
          status: hostCase.expectedOutcomeStatus,
          winnerSlot: hostCase.expectedWinnerSlot,
        },
      ],
    }),
    releaseReady: false,
    productionReady: false,
  };
}

export function postDayThreeResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const baseRoleUrl = seededCoreLoopRoleUrl({ game });
  return {
    status: "passed",
    sourceHostRoleUrl: seededCoreLoopRoleUrl({ game, suffix: "/host" }),
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceTargetRoleUrl: seededCoreLoopRoleUrl({
      game,
      suffix: "?private=notification-1",
    }),
    clickedThroughFromRoleUrl: true,
    transition:
      "target:D03:day_vote -> actionPlayer:D03:privacy -> host:advance_phase:ack:909 -> actionPlayer:N03",
    targetReceiptProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      roleUrlSuffix: "?private=notification-1",
      slotField: "targetSlot",
      slot: "slot-4",
      principalUserId: "player_rowan",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "Player action unavailable: actor is not alive",
      privateCount: 1,
      privateReceipt: true,
      boundary:
        "Seeded browser target role received day_vote private receipt after D03 resolution.",
      resyncFromSeq: 908,
    }),
    actionPlayerPrivacyProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D03",
      phaseState: "locked",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "Player action unavailable: phase locked",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player stayed alive with no target-only D03 receipt after host resolved Day 3.",
      resyncFromSeq: 908,
    }),
    hostAdvanceProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 908,
      setupPhaseId: "D03",
      setupPhaseState: "locked",
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 909,
        phaseId: "N03",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
      }),
    }),
    actionPlayerNightThreeProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N03",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed host AdvancePhase from locked D03 into open N03.",
      resyncFromSeq: 909,
    }),
    releaseReady: false,
    productionReady: false,
  };
}

export function nightThreeEmptyResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const surfaceCase = nightThreeEmptyResolutionSurfaceCase();
  const hostTransitionCase = emptyNightThreeHostTransitionProofCase();
  const baseRoleUrl = seededCoreLoopRoleUrl({ game });
  const hostRoleUrl = seededCoreLoopRoleUrl({ game, suffix: "/host" });
  return {
    status: "passed",
    sourceHostRoleUrl: hostRoleUrl,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition: surfaceCase.transitionFragments.join(" -> "),
    actionPlayerNoActionProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: surfaceCase.actionPlayerNoActionCase.slotField,
      slot: surfaceCase.actionPlayerNoActionCase.expectedSlot,
      principalUserId:
        surfaceCase.actionPlayerNoActionCase.expectedPrincipalUserId,
      phaseId: surfaceCase.actionPlayerNoActionCase.expectedPhaseId,
      phaseState: surfaceCase.actionPlayerNoActionCase.expectedPhaseState,
      actorAlive: surfaceCase.actionPlayerNoActionCase.expectedActorAlive,
      actorStatus: surfaceCase.actionPlayerNoActionCase.expectedActorStatus,
      actionState: surfaceCase.actionPlayerNoActionCase.expectedActionState,
      statusText:
        `Player action unavailable: ${surfaceCase.actionPlayerNoActionCase.expectedStatusText}`,
      privateCount: surfaceCase.actionPlayerNoActionCase.expectedPrivateCount,
      privateReceipt:
        surfaceCase.actionPlayerNoActionCase.expectedPrivateReceipt,
      boundary:
        "Seeded browser action player opened N03 with no legal night action after D03 attrition.",
      resyncFromSeq: surfaceCase.actionPlayerNoActionCase.expectedResyncFromSeq,
    }),
    hostTransitionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: hostTransitionCase.setupResyncFromSeq,
      setupPhaseId: hostTransitionCase.setupPhaseId,
      setupPhaseState: hostTransitionCase.setupPhaseState,
      resolveProof: hostPhaseTransitionActionFixture({
        actionId: hostTransitionCase.resolveCase.actionId,
        commandKind: hostTransitionCase.resolveCase.commandKind,
        streamSeq: hostTransitionCase.resolveCase.streamSeq,
        phaseId: hostTransitionCase.resolveCase.expectedPhaseId,
        phaseState: hostTransitionCase.resolveCase.expectedPhaseState,
        deadlineAffordance: hostDeadlineAffordanceForPhaseState(
          hostTransitionCase.resolveCase.expectedPhaseState,
        ),
        projectionRefreshKeys: hostTransitionCase.resolveCase.expectedRefreshKeys,
        command: {
          game,
          seed: 918273,
        },
      }),
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: hostTransitionCase.advanceCase.actionId,
        commandKind: hostTransitionCase.advanceCase.commandKind,
        streamSeq: hostTransitionCase.advanceCase.streamSeq,
        phaseId: hostTransitionCase.advanceCase.expectedPhaseId,
        phaseState: hostTransitionCase.advanceCase.expectedPhaseState,
        deadlineAffordance: hostDeadlineAffordanceForPhaseState(
          hostTransitionCase.advanceCase.expectedPhaseState,
        ),
        projectionRefreshKeys: hostTransitionCase.advanceCase.expectedRefreshKeys,
        command: {
          game,
        },
      }),
    }),
    actionPlayerDayFourProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: surfaceCase.actionPlayerDayFourCase.slotField,
      slot: surfaceCase.actionPlayerDayFourCase.expectedSlot,
      principalUserId:
        surfaceCase.actionPlayerDayFourCase.expectedPrincipalUserId,
      phaseId: surfaceCase.actionPlayerDayFourCase.expectedPhaseId,
      phaseState: surfaceCase.actionPlayerDayFourCase.expectedPhaseState,
      actorAlive: surfaceCase.actionPlayerDayFourCase.expectedActorAlive,
      actorStatus: surfaceCase.actionPlayerDayFourCase.expectedActorStatus,
      actionState: surfaceCase.actionPlayerDayFourCase.expectedActionState,
      statusText:
        `Player action unavailable: ${surfaceCase.actionPlayerDayFourCase.expectedStatusText}`,
      privateCount: surfaceCase.actionPlayerDayFourCase.expectedPrivateCount,
      privateReceipt: surfaceCase.actionPlayerDayFourCase.expectedPrivateReceipt,
      boundary:
        "Seeded browser action player observed host AdvancePhase from empty N03 into open D04 no-lynch voting.",
      resyncFromSeq: surfaceCase.actionPlayerDayFourCase.expectedResyncFromSeq,
      voteButtonCount: surfaceCase.actionPlayerDayFourCase.expectedVoteButtonCount,
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    }),
    releaseReady: false,
    productionReady: false,
  };
}

export function dayFourSurvivorRoleSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const surfaceCase = dayFourSurvivorRoleSurfaceCase();
  const survivorCase = surfaceCase.survivorCase;
  return {
    status: "passed",
    sourceRoleUrl: seededCoreLoopRoleUrl({ game }),
    clickedThroughFromRoleUrl: true,
    survivorProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: survivorCase.slotField,
      slot: survivorCase.expectedSlot,
      principalUserId: survivorCase.expectedPrincipalUserId,
      phaseId: survivorCase.expectedPhaseId,
      phaseState: survivorCase.expectedPhaseState,
      actorAlive: survivorCase.expectedActorAlive,
      actorStatus: survivorCase.expectedActorStatus,
      actionState: survivorCase.expectedActionState,
      statusText:
        `Player action unavailable: ${survivorCase.expectedStatusText}`,
      privateCount: survivorCase.expectedPrivateCount,
      privateReceipt: survivorCase.expectedPrivateReceipt,
      boundary:
        "Seeded browser survivor role opened D04 as a living vote target for the next night-action loop.",
      resyncFromSeq: survivorCase.expectedResyncFromSeq,
      voteButtonCount: survivorCase.expectedVoteButtonCount,
      voteTargets: [
        { kind: "slot", slotId: "slot-7", label: "Slot 7" },
        { kind: "no_lynch", slotId: null, label: "No lynch" },
      ],
    }),
    releaseReady: false,
    productionReady: false,
  };
}
