export {
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
  completedGameProofReadinessCaseGroupDefinitions,
  completedGameProofReadinessCaseGroupIds,
  completedGameProofReadinessCaseGroups,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessScenarioFamily,
  completedGameProofReadinessTransition,
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
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_recovery_scenario_assertions.mjs";

import {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_recovery_scenario_assertions.mjs";
import {
  completedGameProofReadinessScenarioFamilies,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";

export function assertCompletedGameProofReadinessSurfaceProof({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  assertCompletedGameEndgameSurfaceProof({
    ...proofArgs,
    scenarioFamilies,
  });
}
