import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  coreLoopPrivateChannelRecoveryFamilyId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelRecoveryScenarioFamily,
  coreLoopPrivateChannelPostLaneId,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";

test("private-channel recovery family shares post, reload, and stale recovery cases", () => {
  assert.equal(
    coreLoopPrivateChannelRecoveryFamilyId,
    "core-loop-private-channel-recovery",
  );
  assert.equal(coreLoopPrivateChannelPostLaneId, "private-channel");
  assert.equal(
    coreLoopPrivateChannelStalePostLaneId,
    "private-channel-stale-post-after-transition",
  );
  assert.deepEqual(coreLoopPrivateChannelRecoveryLaneIds, [
    coreLoopPrivateChannelPostLaneId,
    coreLoopPrivateChannelStalePostLaneId,
  ]);

  const family = coreLoopPrivateChannelRecoveryScenarioFamily();
  assert.equal(family.id, coreLoopPrivateChannelRecoveryFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPrivateChannelRecoveryLaneIds);
  assert.deepEqual(
    family.transitionTokens,
    completedPrivateChannelTransitionTokens(),
  );
  assert.deepEqual(family.scenarios.submitPost, privateChannelSubmitPostScenario());
  assert.deepEqual(
    family.scenarios.stalePostAfterPhaseTransition,
    stalePrivateChannelPostPhaseLockedScenario(),
  );
  assert.deepEqual(
    family.reloads.completedPrivateChannel,
    completedPrivateChannelReloadScenario(),
  );
  assert.deepEqual(
    family.staleRejects.staleCompletedPrivatePost,
    staleCompletedPrivatePostScenario(),
  );
});
