import {
  assertCompletedGameEndgameSurfaceProof,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
} from "./dev_test_game_core_loop_completed_game_shared_recovery_scenarios.mjs";

export {
  assertCompletedGameEndgameSurfaceProof,
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadHardeningLaneCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandHardeningLaneCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_game_shared_recovery_scenarios.mjs";

export const completedGameProofReadinessCaseGroupDefinitions =
  completedGameEndgameScenarioCaseFamilyDefinitions;

export const completedGameProofReadinessCaseGroupIds =
  completedGameEndgameScenarioCaseFamilyIds;

export function completedGameProofReadinessScenarioFamilies() {
  return completedGameEndgameScenarioCaseFamilies();
}

export function completedGameProofReadinessCaseGroups({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return Object.freeze(
    Object.fromEntries(
      completedGameEndgameScenarioCaseFamilyEntries({ scenarioFamilies }),
    ),
  );
}

export function completedGameProofReadinessProofScenarioCases({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  return completedGameEndgameProofScenarioCases({
    ...proofArgs,
    scenarioFamilies,
  });
}

export function completedGameProofReadinessTransition({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return completedGameEndgameTransition({ scenarioFamilies });
}

export function completedGameProofReadinessScenarioFamily({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return {
    id: "core-loop-completed-endgame-progression",
    transitionTokens: completedGameEndgameTransitionTokens({
      scenarioFamilies,
    }),
    staleRejects: {
      completedHostStaleCommands: [
        ...scenarioFamilies.completedHostStaleCommandCases,
      ],
      completedDeadPlayerStaleVote:
        scenarioFamilies.completedDeadPlayerStaleVoteCase,
      staleCompletedGamePlayerCommands: [
        ...scenarioFamilies.staleCompletedGamePlayerCommandCases,
      ],
    },
    reloads: {
      completedPlayers: [...scenarioFamilies.completedPlayerReloadCases],
    },
  };
}

export function assertCompletedGameProofReadinessSurfaceProof({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  assertCompletedGameEndgameSurfaceProof({
    ...proofArgs,
    scenarioFamilies,
  });
}
