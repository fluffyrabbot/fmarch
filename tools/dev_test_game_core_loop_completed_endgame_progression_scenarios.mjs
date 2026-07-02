import {
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameTransitionTokens,
} from "./dev_test_game_core_loop_completed_recovery_scenario_cases.mjs";
import {
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";

export const coreLoopCompletedEndgameProgressionFamilyId =
  "core-loop-completed-endgame-progression";

export const coreLoopCompletedEndgameProgressionLaneIds = Object.freeze(
  completedGameHardeningLaneIds(),
);

export function coreLoopCompletedEndgameProgressionScenarioFamilies() {
  return completedGameEndgameScenarioCaseFamilies();
}

export function coreLoopCompletedEndgameProgressionScenarioFamily({
  scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies(),
} = {}) {
  return {
    id: coreLoopCompletedEndgameProgressionFamilyId,
    laneIds: [...coreLoopCompletedEndgameProgressionLaneIds],
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
