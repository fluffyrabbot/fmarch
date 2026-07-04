import {
  completedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadHardeningLaneCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandHardeningLaneCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_shared_case_definitions.mjs";

export {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_recovery_scenario_assertions.mjs";

export {
  completedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadHardeningLaneCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandHardeningLaneCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_shared_case_definitions.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const freezeScenarioCase = (scenario) =>
  Object.freeze(cloneScenarioCase(scenario));
const freezeScenarioCases = (scenarios) =>
  Object.freeze(scenarios.map(freezeScenarioCase));

export const completedDeadPlayerStaleVoteCaseDefinition = Object.freeze({
  proofField: "completedDeadPlayerStaleVoteRecoveryProof",
  transitionToken: "deadPlayer:stale_submit_vote:reject:GameAlreadyCompleted",
  commandKind: "SubmitVote",
  expectedSlot: "slot-2",
  principalUserId: "player_ilya",
  expectedBoundaryText: "completed dead-player stale vote rejected",
});

export function completedDeadPlayerStaleVoteCase() {
  return freezeScenarioCase(completedDeadPlayerStaleVoteCaseDefinition);
}

export function completedGameEndgameScenarioCaseFamilies({
  hostStaleCommandCases = completedHostStaleCommandCases(),
  playerReloadCases = completedPlayerReloadCases(),
  deadPlayerStaleVoteCase = completedDeadPlayerStaleVoteCase(),
  playerStaleCommandCases = staleCompletedGamePlayerCommandCases(),
} = {}) {
  return Object.freeze({
    completedHostStaleCommandCases: freezeScenarioCases(hostStaleCommandCases),
    completedPlayerReloadCases: freezeScenarioCases(playerReloadCases),
    completedDeadPlayerStaleVoteCase: freezeScenarioCase(
      deadPlayerStaleVoteCase,
    ),
    staleCompletedGamePlayerCommandCases: freezeScenarioCases(
      playerStaleCommandCases,
    ),
  });
}

export const completedGameEndgameScenarioCaseFamilyDefinitions = Object.freeze([
  Object.freeze({
    id: "completedHostStaleCommandCases",
    label: "Completed host stale commands",
    role: "host",
    recoveryKind: "stale-command",
  }),
  Object.freeze({
    id: "completedPlayerReloadCases",
    label: "Completed player reloads",
    role: "player",
    recoveryKind: "reload",
  }),
  Object.freeze({
    id: "staleCompletedGamePlayerCommandCases",
    label: "Stale completed-game player commands",
    role: "player",
    recoveryKind: "stale-command",
  }),
]);

export const completedGameEndgameScenarioCaseFamilyIds = Object.freeze(
  completedGameEndgameScenarioCaseFamilyDefinitions.map(({ id }) => id),
);

export function completedGameEndgameScenarioCaseFamilyEntries({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return completedGameEndgameScenarioCaseFamilyDefinitions.map(({ id }) => [
    id,
    Object.freeze([...scenarioFamilies[id]]),
  ]);
}

export function completedPlayerReloadAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  cases = completedPlayerReloadCases(),
}) {
  return cases.map((scenario) => ({
    proof: completedGameEndgameSurface[scenario.proofField],
    expectedGame,
    sourceRoleUrl: completedGameEndgameSurface[scenario.sourceRoleUrlField],
    expectedSlot: scenario.expectedSlot,
    expectedBoundaryText: scenario.expectedBoundaryText,
    principalUserId: scenario.principalUserId,
  }));
}

export function completedPlayerReloadProofCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
  cases = completedPlayerReloadCases(),
}) {
  const roleUrlsByField = {
    sourceActionPlayerRoleUrl: actionPlayerRoleUrl,
    sourceNormalPlayerRoleUrl: normalPlayerRoleUrl,
    sourceDeadPlayerRoleUrl: deadPlayerRoleUrl,
  };
  return cases.map((scenario) => ({
    ...scenario,
    roleUrl: roleUrlsByField[scenario.sourceRoleUrlField],
    commandState: completedPlayerReloadCommandState({
      scenario,
      commandStateBuilders,
    }),
  }));
}

export function completedPlayerReloadCommandState({
  scenario,
  commandStateBuilders,
}) {
  const builder = commandStateBuilders?.[scenario.commandStateKind];
  if (typeof builder !== "function") {
    throw new Error(
      `unknown completed player reload command state: ${scenario.commandStateKind}`,
    );
  }
  return builder({ boundary: scenario.boundary });
}

export function assertCompletedPlayerReloadCases(
  cases,
  assertCompletedPlayerReloadProof,
) {
  for (const scenario of cases) {
    assertCompletedPlayerReloadProof({
      ...scenario,
      expectedCommandStateEndpoint:
        `/games/${scenario.expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
      expectedNotificationsEndpoint:
        `/games/${scenario.expectedGame}/notifications?principal_user_id=${scenario.principalUserId}`,
    });
  }
}

export function completedGameEndgameProofScenarioCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
}) {
  return {
    completedHostStaleCommandCases:
      scenarioFamilies.completedHostStaleCommandCases,
    completedPlayerReloadCases: completedPlayerReloadProofCases({
      actionPlayerRoleUrl,
      normalPlayerRoleUrl,
      deadPlayerRoleUrl,
      commandStateBuilders,
      cases: scenarioFamilies.completedPlayerReloadCases,
    }),
    completedDeadPlayerStaleVoteCase:
      scenarioFamilies.completedDeadPlayerStaleVoteCase,
    staleCompletedGamePlayerCommandCases:
      scenarioFamilies.staleCompletedGamePlayerCommandCases,
  };
}

export function completedGameEndgameTransitionTokens({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return [
    "host:N05:complete_game:ack:921",
    "host:reload:complete",
    ...scenarioFamilies.completedHostStaleCommandCases.map(
      (scenario) => scenario.transitionToken,
    ),
    "actionPlayer:endgame:complete",
    ...scenarioFamilies.completedPlayerReloadCases.map(
      (scenario) => scenario.transitionToken,
    ),
    scenarioFamilies.completedDeadPlayerStaleVoteCase.transitionToken,
    ...scenarioFamilies.staleCompletedGamePlayerCommandCases.map(
      (scenario) => scenario.transitionToken,
    ),
  ];
}

export function completedGameEndgameTransition({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return completedGameEndgameTransitionTokens({ scenarioFamilies }).join(" -> ");
}

export function assertCompletedGameEndgameTransition({
  transition,
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
  failureMessage = "completed-game endgame transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = completedGameEndgameTransitionTokens({
    scenarioFamilies,
  }).filter((token) => !transitionText.includes(token));
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
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
}) {
  return [
    ...completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
      cases: scenarioFamilies.completedHostStaleCommandCases,
    }),
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
      scenario: scenarioFamilies.completedDeadPlayerStaleVoteCase,
    }),
    ...staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceActionPlayerRoleUrl,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
      cases: scenarioFamilies.staleCompletedGamePlayerCommandCases,
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
