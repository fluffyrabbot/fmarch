import {
  hostDeadlineAffordanceForPhaseState,
  hostNightActionTransitionSurfaceCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  hostPhaseTransitionActionFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";

export function hostNightActionTransitionSurfaceFixture({
  game = "game-a",
} = {}) {
  const surfaceCase = hostNightActionTransitionSurfaceCase();
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  const baseRolePath = `/g/${game}`;
  const hostRoleUrl = `${baseRoleUrl}/host`;
  const hostRolePath = `${baseRolePath}/host`;
  const sourceRoleUrls = {
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceNightTargetRoleUrl: `${baseRoleUrl}?private=notification-1`,
    sourceNormalRoleUrl: `${baseRoleUrl}?private=notification-1`,
  };
  return {
    status: "passed",
    sourceHostRoleUrl: hostRoleUrl,
    ...sourceRoleUrls,
    visitedHostRolePath: hostRolePath,
    surfaceTestId: surfaceCase.surfaceTestId,
    clickedThroughFromRoleUrl: true,
    transition: surfaceCase.transitionFragments.join(" -> "),
    resolveProof: hostNightTransitionActionFixture({
      actionCase: surfaceCase.resolveCase,
      sourceRoleUrl: hostRoleUrl,
      visitedRolePath: hostRolePath,
      command: {
        game,
        seed: 918273,
      },
    }),
    advanceProof: hostNightTransitionActionFixture({
      actionCase: surfaceCase.advanceCase,
      sourceRoleUrl: hostRoleUrl,
      visitedRolePath: hostRolePath,
      command: {
        game,
      },
    }),
    ...Object.fromEntries(
      surfaceCase.playerObservationCases.map((playerCase) => [
        playerCase.proofField,
        dayThreeObservationFixture({
          sourceRoleUrl: sourceRoleUrls[playerCase.sourceRoleUrlField],
          visitedRolePath:
            playerCase.sourceRoleUrlField === "sourceActionPlayerRoleUrl"
              ? baseRolePath
              : `${baseRolePath}?private=notification-1`,
          principalUserId: playerCase.expectedPrincipalUserId,
          slotField: playerCase.slotField,
          slot: playerCase.expectedSlot,
          actorAlive: playerCase.expectedActorAlive,
          actorStatus: playerCase.expectedActorStatus,
          actionState: playerCase.expectedActionState,
          statusText:
            `Player action unavailable: ${playerCase.expectedStatusText}`,
          privateCount: playerCase.expectedPrivateCount,
          privateReceipt: playerCase.expectedPrivateReceipt,
          boundary: dayThreeObservationBoundary(playerCase.proofField),
          commandStateEndpoint:
            `/games/${game}/player-command-state?principal_user_id=${playerCase.expectedPrincipalUserId}&slot_id=${playerCase.expectedSlot}`,
          notificationsEndpoint:
            `/games/${game}/notifications?principal_user_id=${playerCase.expectedPrincipalUserId}`,
        }),
      ]),
    ),
    releaseReady: false,
    productionReady: false,
  };
}

function hostNightTransitionActionFixture({
  actionCase,
  sourceRoleUrl,
  visitedRolePath,
  command,
}) {
  return hostPhaseTransitionActionFixture({
    sourceRoleUrl,
    visitedRolePath,
    actionId: actionCase.actionId,
    commandKind: actionCase.commandKind,
    streamSeq: actionCase.streamSeq,
    phaseId: actionCase.expectedPhaseId,
    phaseState: actionCase.expectedPhaseState,
    deadlineAffordance: hostDeadlineAffordanceForPhaseState(
      actionCase.expectedPhaseState,
    ),
    projectionRefreshKeys: actionCase.expectedRefreshKeys,
    command,
  });
}

function dayThreeObservationBoundary(proofField) {
  if (proofField === "actionPlayerObservationProof") {
    return "Seeded browser action player observed host AdvancePhase from resolved N02 into open D03.";
  }
  if (proofField === "nightTargetObservationProof") {
    return "Seeded browser killed target stayed dead with factional_kill receipt after host advanced N02 to D03.";
  }
  return "Seeded browser normal player observed open D03 with no target-only private receipt after host advanced N02.";
}

export function dayThreeObservationFixture({
  sourceRoleUrl,
  visitedRolePath,
  principalUserId,
  slotField,
  slot,
  actorAlive,
  actorStatus,
  actionState,
  statusText,
  privateCount,
  privateReceipt,
  boundary,
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
      phaseId: "D03",
      phaseState: "open",
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text: "Night results and notices are delivered to you alone.",
    },
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      phase: {
        phaseId: "D03",
        locked: false,
      },
      actions: [],
      boundary,
    },
    projectionNotifications: privateReceipt
      ? [
          {
            effect: "player_killed",
            phase_id: "N02",
            status: "factional_kill",
          },
        ]
      : [],
    resyncFromSeq: 906,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      phase: {
        phaseId: "D03",
      },
    },
    resyncSnapshotNotifications: privateReceipt
      ? [
          {
            status: "factional_kill",
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
    return {
      ...proof,
      privateNotice: {
        id: "notification-1",
        kind: "notification",
        text: "player_killed factional_kill",
        detailText: "Phase N02",
      },
    };
  }
  return {
    ...proof,
    privateEmptyText: "No private results visible",
  };
}
