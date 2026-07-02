import {
  assertCoreLoopCompletedEndgameProgressionSurfaceProof,
  coreLoopCompletedEndgameProgressionProofScenarioCases,
  coreLoopCompletedEndgameProgressionScenarioFamilies,
  coreLoopCompletedEndgameProgressionScenarioFamily,
  coreLoopCompletedEndgameProgressionTransition,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";

export const completedGameProofReadinessCaseGroupDefinitions = Object.freeze([
  Object.freeze({ id: "completedHostStaleCommandCases" }),
  Object.freeze({ id: "completedPlayerReloadCases" }),
  Object.freeze({ id: "staleCompletedGamePlayerCommandCases" }),
]);

export const completedGameProofReadinessCaseGroupIds = Object.freeze(
  completedGameProofReadinessCaseGroupDefinitions.map(({ id }) => id),
);

export function completedGameProofReadinessScenarioFamilies() {
  return coreLoopCompletedEndgameProgressionScenarioFamilies();
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
