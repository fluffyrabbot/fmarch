import {
  completedDeadPlayerStaleVoteCase,
  completedHostStaleCommandCases,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";

export {
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

export {
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  assertCompletedStaleRejectCases,
  completedActionPlayerSurfaceAssertionCase,
  completedActionPlayerSurfaceProofArgs,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameSurfaceAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandHardeningLaneIds,
  completedHostStaleCommandProofArgs,
  completedPlayerHardeningReloadLaneIds,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";

export function completedGameEndgameProofScenarioCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
}) {
  return {
    completedHostStaleCommandCases: completedHostStaleCommandCases(),
    completedPlayerReloadCases: completedPlayerReloadProofCases({
      actionPlayerRoleUrl,
      normalPlayerRoleUrl,
      deadPlayerRoleUrl,
      commandStateBuilders,
    }),
    completedDeadPlayerStaleVoteCase: completedDeadPlayerStaleVoteCase(),
    staleCompletedGamePlayerCommandCases: staleCompletedGamePlayerCommandCases(),
  };
}
