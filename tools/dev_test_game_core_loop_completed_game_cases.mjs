import {
  completedDeadPlayerStaleVoteCase,
  completedHostStaleCommandCases,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_recovery_cases.mjs";

export {
  assertCompletedPlayerReloadCases,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedGameHardeningLaneCaseDefinitions,
  completedGameHardeningLaneCases,
  completedGameHardeningLaneIds,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandHardeningLaneIds,
  completedPlayerHardeningReloadLaneIds,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_recovery_cases.mjs";

export function completedGameEndgameTransitionTokens() {
  return [
    "host:N05:complete_game:ack:921",
    "host:reload:complete",
    ...completedHostStaleCommandCases().map(
      (scenario) => scenario.transitionToken,
    ),
    "actionPlayer:endgame:complete",
    ...completedPlayerReloadCases().map((scenario) => scenario.transitionToken),
    completedDeadPlayerStaleVoteCase().transitionToken,
    ...staleCompletedGamePlayerCommandCases().map(
      (scenario) => scenario.transitionToken,
    ),
  ];
}

export function completedGameEndgameTransition() {
  return completedGameEndgameTransitionTokens().join(" -> ");
}

export function assertCompletedGameEndgameTransition({
  transition,
  failureMessage = "completed-game endgame transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = completedGameEndgameTransitionTokens().filter(
    (token) => !transitionText.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(`${failureMessage}: ${missingTokens.join(", ")}`);
  }
}

export function completedGameEndgameStaleRejectAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceHostRoleUrl,
  sourceDeadPlayerRoleUrl,
  sourceActionPlayerRoleUrl,
  assertCompletedHostStaleCommandRecoveryProof,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
}) {
  return [
    ...completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
    }),
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
    }),
    ...staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceActionPlayerRoleUrl,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
    }),
  ];
}

export function completedHostStaleCommandAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceHostRoleUrl,
  assertCompletedHostStaleCommandRecoveryProof,
  cases = completedHostStaleCommandCases(),
}) {
  return cases.map((scenario) => ({
    assertProof: assertCompletedHostStaleCommandRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...completedHostStaleCommandProofArgs({
      expectedGame,
      sourceHostRoleUrl,
      scenario,
    }),
  }));
}

export function completedHostStaleCommandProofArgs({
  expectedGame,
  sourceHostRoleUrl,
  scenario,
}) {
  return {
    expectedGame,
    sourceRoleUrl: sourceHostRoleUrl,
    expectedCommandKind: scenario.commandKind,
  };
}

export function completedDeadPlayerStaleVoteAssertionCase({
  completedGameEndgameSurface,
  expectedGame,
  sourceRoleUrl,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  scenario = completedDeadPlayerStaleVoteCase(),
}) {
  return {
    assertProof: assertCompletedDeadPlayerStaleVoteRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...completedDeadPlayerStaleVoteProofArgs({
      expectedGame,
      sourceRoleUrl,
      scenario,
    }),
  };
}

export function completedDeadPlayerStaleVoteProofArgs({
  expectedGame,
  sourceRoleUrl,
  scenario = completedDeadPlayerStaleVoteCase(),
}) {
  return {
    expectedGame,
    sourceRoleUrl,
    scenario,
  };
}

export function staleCompletedGamePlayerCommandAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceActionPlayerRoleUrl,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
  cases = staleCompletedGamePlayerCommandCases(),
}) {
  return cases.map((scenario) => ({
    assertProof: assertStaleCompletedGamePlayerCommandRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...staleCompletedGamePlayerCommandProofArgs({
      expectedGame,
      sourceActionPlayerRoleUrl,
      scenario,
    }),
  }));
}

export function staleCompletedGamePlayerCommandProofArgs({
  expectedGame,
  sourceActionPlayerRoleUrl,
  scenario,
}) {
  return {
    expectedGame,
    sourceRoleUrl: sourceActionPlayerRoleUrl,
    scenario,
  };
}

export function completedActionPlayerSurfaceProofArgs({
  expectedGame,
  sourceRoleUrl,
}) {
  return {
    expectedGame,
    sourceRoleUrl,
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N05",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:game complete",
    expectedStatusText: "game complete",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "completed game endgame state",
    expectedResyncFromSeq: 921,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
    expectedLastVoteOutcomePhaseId: "D05",
  };
}

export function completedActionPlayerSurfaceAssertionCase({
  completedGameEndgameSurface,
  expectedGame,
  assertActionPlayerCompletedProof,
}) {
  return {
    assertProof: assertActionPlayerCompletedProof,
    proof: completedGameEndgameSurface.actionPlayerCompletedProof,
    ...completedActionPlayerSurfaceProofArgs({
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
    }),
  };
}

export function completedGameEndgameSurfaceAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  assertHostCompleteGameProof,
  assertCompletedHostReloadProof,
  assertActionPlayerCompletedProof,
  assertCompletedHostStaleCommandRecoveryProof,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  assertCompletedPlayerReloadProof,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
}) {
  return [
    {
      assertProof: assertHostCompleteGameProof,
      proof: completedGameEndgameSurface.hostCompleteProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
    },
    {
      assertProof: assertCompletedHostReloadProof,
      proof: completedGameEndgameSurface.completedHostReloadProof,
      sourceRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
    },
    completedActionPlayerSurfaceAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      assertActionPlayerCompletedProof,
    }),
    ...completedPlayerReloadAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      cases: completedPlayerReloadCases(),
    }).map((scenario) => ({
      assertProof: assertCompletedPlayerReloadProof,
      ...scenario,
      expectedCommandStateEndpoint:
        `/games/${scenario.expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
      expectedNotificationsEndpoint:
        `/games/${scenario.expectedGame}/notifications?principal_user_id=${scenario.principalUserId}`,
    })),
    ...completedGameEndgameStaleRejectAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
      sourceDeadPlayerRoleUrl: completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
      sourceActionPlayerRoleUrl:
        completedGameEndgameSurface.sourceActionPlayerRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
    }),
  ];
}

export function assertCompletedStaleRejectCases(cases) {
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
}

export function assertCompletedGameEndgameSurfaceAssertionCases({
  cases,
  completedGameEndgameSurface,
  includeEvidenceInError = false,
}) {
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
  if (
    completedGameEndgameSurface.actionPlayerCompletedProof
      ?.projectionCommandState?.gameCompleted !== true ||
    completedGameEndgameSurface.actionPlayerCompletedProof
      ?.resyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed player command state",
      evidence: completedGameEndgameSurface.actionPlayerCompletedProof,
      includeEvidenceInError,
    });
  }
}

function throwCompletedScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
