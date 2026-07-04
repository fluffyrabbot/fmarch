import {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_recovery_scenario_assertions.mjs";
import {
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_shared_scenario_assertions.mjs";
import {
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";

export {
  completedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
};

export const completedGameProofReadinessCaseGroupDefinitions = Object.freeze([
  Object.freeze({ id: "completedHostStaleCommandCases" }),
  Object.freeze({ id: "completedPlayerReloadCases" }),
  Object.freeze({ id: "staleCompletedGamePlayerCommandCases" }),
]);

export const completedGameProofReadinessCaseGroupIds = Object.freeze(
  completedGameProofReadinessCaseGroupDefinitions.map(({ id }) => id),
);

export function completedGameProofReadinessScenarioFamilies() {
  return completedGameEndgameScenarioCaseFamilies();
}

export function completedGameProofReadinessCaseGroups({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return Object.freeze(
    Object.fromEntries(
      completedGameProofReadinessCaseGroupDefinitions.map(({ id }) => [
        id,
        Object.freeze([...scenarioFamilies[id]]),
      ]),
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
    laneIds: completedGameHardeningLaneIds(),
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
