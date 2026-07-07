import {
  completedGameHardeningLaneIds,
  completedGameHardeningLaneCases,
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameHardeningSpineTargetCases,
  completedGameEndgameRecoveryFeatureSpineRows,
  completedGameStaleCommandFeatureSpineRows,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessScenarioFamily as completedGameProofReadinessCaseScenarioFamily,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

export {
  completedGameProofReadinessCaseGroupDefinitions,
  completedGameProofReadinessCaseGroupIds,
  completedGameProofReadinessCaseGroups,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessTransition,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export {
  completedGameHardeningLaneCases,
  completedGameHardeningLaneIds,
  completedGameHardeningSpineCycleId,
  completedGameHardeningSpineLaneCases,
  completedGameHardeningSpineTargetCases,
  completedGameEndgameRecoveryFeatureSpineRows,
  completedGameStaleCommandFeatureSpineRows,
  completedGameStaleRecoverySpineLaneCase,
};

export function completedGameProofReadinessScenarioFamily(options = {}) {
  return {
    ...completedGameProofReadinessCaseScenarioFamily(options),
    laneIds: completedGameHardeningLaneIds(),
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
