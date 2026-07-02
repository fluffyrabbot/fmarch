import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs";

export {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs";

export const coreLoopPrivateChannelRecoveryFamilyId =
  "core-loop-private-channel-recovery";

export const coreLoopPrivateChannelRecoveryLaneIds = Object.freeze([
  "private-channel",
]);

export function coreLoopPrivateChannelRecoveryScenarioFamily() {
  const submitPost = privateChannelSubmitPostScenario();
  const stalePostAfterPhaseTransition =
    stalePrivateChannelPostPhaseLockedScenario();
  const completedPrivateChannelReload = completedPrivateChannelReloadScenario();
  const staleCompletedPrivatePost = staleCompletedPrivatePostScenario();
  return {
    id: coreLoopPrivateChannelRecoveryFamilyId,
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    transitionTokens: completedPrivateChannelTransitionTokens(),
    scenarios: {
      submitPost,
      stalePostAfterPhaseTransition,
      completedPrivateChannelReload,
      staleCompletedPrivatePost,
    },
    staleRejects: {
      stalePostAfterPhaseTransition,
      staleCompletedPrivatePost,
    },
    reloads: {
      completedPrivateChannel: completedPrivateChannelReload,
    },
  };
}
