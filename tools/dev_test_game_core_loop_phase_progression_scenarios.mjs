import {
  playerActionLoopLaneId,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopVoteResolutionLaneIds,
  coreLoopVoteResolutionScenarioFamily,
  dayThreeVoteResolutionLaneId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";

export const coreLoopPhaseProgressionFamilyId =
  "core-loop-phase-progression";

export const coreLoopPhaseProgressionLaneIds = Object.freeze([
  ...coreLoopVoteResolutionLaneIds,
  "day-vote-no-lynch",
  playerActionLoopLaneId,
]);

export const coreLoopPhaseProgressionSpineSourceLaneIds = Object.freeze([
  "core-loop",
  dayThreeVoteResolutionLaneId,
  playerActionLoopLaneId,
  "resolution-receipts",
]);

export const coreLoopPhaseProgressionRequiredSeedScenarioIds =
  Object.freeze(["night-action-loop"]);

export const coreLoopPhaseProgressionDemoOnlySeedScenarioIds = Object.freeze([
  dayThreeVoteResolutionLaneId,
  "day-vote-no-lynch",
]);

export const coreLoopPhaseProgressionAliasOnlyProofLaneIds = Object.freeze([
  playerActionLoopLaneId,
  "stale-action-conflict",
]);

export const coreLoopPhaseProgressionSeedAliasEntries = Object.freeze([
  Object.freeze([
    "night-action-loop",
    coreLoopPhaseProgressionAliasOnlyProofLaneIds,
  ]),
]);

export function coreLoopPhaseProgressionScenarioFamily() {
  const voteResolutionFamily = coreLoopVoteResolutionScenarioFamily();
  return {
    id: coreLoopPhaseProgressionFamilyId,
    laneIds: [...coreLoopPhaseProgressionLaneIds],
    spineSourceLaneIds: [...coreLoopPhaseProgressionSpineSourceLaneIds],
    seedScenarioIds: [
      ...coreLoopPhaseProgressionRequiredSeedScenarioIds,
      ...coreLoopPhaseProgressionDemoOnlySeedScenarioIds,
    ],
    surfaces: {
      dayThreeVoteResolution:
        voteResolutionFamily.surfaces.dayThreeVoteResolution,
      postDayThreeResolution: postDayThreeResolutionSurfaceCase(),
    },
    staleRejects: {
      staleDayTwoVote: staleDayTwoVoteAfterTransitionRecoveryScenario(),
      staleNightOneAction: staleNightOneActionAfterTransitionRecoveryScenario(),
    },
  };
}
