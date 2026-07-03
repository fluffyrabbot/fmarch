import {
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_shared_case_definitions.mjs";

export {
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
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
