import {
  assertCoreLoopCompletedEndgameProgressionSurfaceProof,
  coreLoopCompletedEndgameProgressionProofScenarioCases,
  coreLoopCompletedEndgameProgressionScenarioFamilies,
  coreLoopCompletedEndgameProgressionScenarioFamily,
  coreLoopCompletedEndgameProgressionTransition,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";

export const completedGameProofReadinessCaseGroupIds = Object.freeze([
  "completedHostStaleCommandCases",
  "completedPlayerReloadCases",
  "staleCompletedGamePlayerCommandCases",
]);

export function completedGameProofReadinessScenarioFamilies() {
  return coreLoopCompletedEndgameProgressionScenarioFamilies();
}

export function completedGameProofReadinessCaseGroups({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return {
    completedHostStaleCommandCases: [
      ...scenarioFamilies.completedHostStaleCommandCases,
    ],
    completedPlayerReloadCases: [
      ...scenarioFamilies.completedPlayerReloadCases,
    ],
    staleCompletedGamePlayerCommandCases: [
      ...scenarioFamilies.staleCompletedGamePlayerCommandCases,
    ],
  };
}

export function completedGameProofReadinessProofScenarioCases({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  return coreLoopCompletedEndgameProgressionProofScenarioCases({
    ...proofArgs,
    scenarioFamilies,
  });
}

export function completedGameProofReadinessTransition({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return coreLoopCompletedEndgameProgressionTransition({ scenarioFamilies });
}

export function completedGameProofReadinessScenarioFamily({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return coreLoopCompletedEndgameProgressionScenarioFamily({ scenarioFamilies });
}

export function assertCompletedGameProofReadinessSurfaceProof({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  assertCoreLoopCompletedEndgameProgressionSurfaceProof({
    ...proofArgs,
    scenarioFamilies,
  });
}
