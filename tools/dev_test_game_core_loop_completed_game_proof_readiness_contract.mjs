import {
  completedGameHardeningLaneIds,
  completedGameHardeningLaneCases,
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";
import {
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_shared_scenario_assertions.mjs";
import {
  completedGameProofReadinessScenarioFamily as completedGameProofReadinessCaseScenarioFamily,
} from "./dev_test_game_core_loop_completed_game_shared_scenario_assertions.mjs";

export {
  assertCompletedGameProofReadinessSurfaceProof,
  completedGameProofReadinessCaseGroupDefinitions,
  completedGameProofReadinessCaseGroupIds,
  completedGameProofReadinessCaseGroups,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessTransition,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_shared_scenario_assertions.mjs";

export {
  completedGameHardeningLaneCases,
  completedGameHardeningLaneIds,
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameStaleRecoverySpineLaneCase,
};

export function completedGameProofReadinessScenarioFamily(options = {}) {
  return {
    ...completedGameProofReadinessCaseScenarioFamily(options),
    laneIds: completedGameHardeningLaneIds(),
  };
}
