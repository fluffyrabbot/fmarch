import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";
import {
  playerInvalidActionRecoveryMessage,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertLaneCoverageSummary,
  buildLaneCoverageSummary,
  cloneLaneCoverageFamilies,
} from "./dev_test_game_lane_coverage.mjs";

export {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";

export const coreLoopPrivateChannelRecoveryFamilyId =
  "core-loop-private-channel-recovery";

export const coreLoopPrivateChannelPostLaneId = "private-channel";
export const coreLoopPrivateChannelStalePostLaneId =
  "private-channel-stale-post-after-transition";
export const coreLoopPrivateChannelCompletedPostLaneId =
  "private-channel-completed-game-recovery";
export const coreLoopPrivateChannelInvalidActionLaneId =
  "private-channel-invalid-action-recovery";

export function privateChannelInvalidActionRecoveryScenario() {
  return {
    laneId: coreLoopPrivateChannelInvalidActionLaneId,
    channelId: "private:mafia_day_chat",
    actorSlot: "slot_4",
    clickedAction: "submit_invalid_action:factional_kill",
    commandKind: "SubmitAction",
    commandError: "InvalidTarget",
    commandMessage: playerInvalidActionRecoveryMessage,
    expectedActionTemplateId: "factional_kill",
    expectedRefreshKeys: ["commandState"],
    expectedPhaseId: "N01",
  };
}

export const coreLoopPrivateChannelRecoveryLaneIds = Object.freeze([
  coreLoopPrivateChannelPostLaneId,
  coreLoopPrivateChannelStalePostLaneId,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
]);

export const coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions =
  Object.freeze([
    Object.freeze({
      id: "core-loop-private-channel-post",
      label: "Private channel post and role URL",
      laneIds: Object.freeze([coreLoopPrivateChannelPostLaneId]),
    }),
    Object.freeze({
      id: "core-loop-private-channel-stale-post",
      label: "Private channel stale post recovery",
      laneIds: Object.freeze([coreLoopPrivateChannelStalePostLaneId]),
    }),
    Object.freeze({
      id: "core-loop-private-channel-completed-game",
      label: "Completed private-channel recovery",
      laneIds: Object.freeze([coreLoopPrivateChannelCompletedPostLaneId]),
    }),
    Object.freeze({
      id: "core-loop-private-channel-invalid-action",
      label: "Private channel invalid action recovery",
      laneIds: Object.freeze([coreLoopPrivateChannelInvalidActionLaneId]),
    }),
  ]);

export function coreLoopPrivateChannelRecoveryCoverageFamilies() {
  return cloneLaneCoverageFamilies(
    coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
  );
}

export function buildCoreLoopPrivateChannelRecoveryCoverageSummary(lanes) {
  return buildLaneCoverageSummary({
    lanes,
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
    families: coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
  });
}

export function assertCoreLoopPrivateChannelRecoveryCoverageSummary({
  summary,
  lanes,
}) {
  return assertLaneCoverageSummary({
    summary,
    lanes,
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
    familyDefinitions: coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
    label: "core-loop private-channel recovery",
  });
}

export function coreLoopPrivateChannelRecoveryScenarioFamily() {
  const submitPost = privateChannelSubmitPostScenario();
  const stalePostAfterPhaseTransition =
    stalePrivateChannelPostPhaseLockedScenario();
  const completedPrivateChannelReload = completedPrivateChannelReloadScenario();
  const staleCompletedPrivatePost = staleCompletedPrivatePostScenario();
  const invalidActionRecovery = privateChannelInvalidActionRecoveryScenario();
  return {
    id: coreLoopPrivateChannelRecoveryFamilyId,
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    transitionTokens: completedPrivateChannelTransitionTokens(),
    scenarios: {
      submitPost,
      stalePostAfterPhaseTransition,
      completedPrivateChannelReload,
      staleCompletedPrivatePost,
      invalidActionRecovery,
    },
    staleRejects: {
      stalePostAfterPhaseTransition,
      staleCompletedPrivatePost,
      invalidActionRecovery,
    },
    reloads: {
      completedPrivateChannel: completedPrivateChannelReload,
    },
  };
}
