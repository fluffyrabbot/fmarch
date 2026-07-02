import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
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
  assert.equal(
    coreLoopPrivateChannelCompletedPostLaneId,
    "private-channel-completed-game-recovery",
  );
  assert.equal(
    coreLoopPrivateChannelInvalidActionLaneId,
    "private-channel-invalid-action-recovery",
  );
  assert.deepEqual(coreLoopPrivateChannelRecoveryLaneIds, [
    coreLoopPrivateChannelPostLaneId,
    coreLoopPrivateChannelStalePostLaneId,
    coreLoopPrivateChannelCompletedPostLaneId,
    coreLoopPrivateChannelInvalidActionLaneId,
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

test("private-channel recovery family imports case-only scenario definitions", async () => {
  const recoverySource = await readFile(
    "tools/dev_test_game_core_loop_private_channel_recovery_scenarios.mjs",
    "utf8",
  );
  const assertionSource = await readFile(
    "tools/dev_test_game_core_loop_private_channel_scenario_assertions.mjs",
    "utf8",
  );

  assert(
    recoverySource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs",
    ),
    "private-channel recovery family should derive scenarios from the case-only module",
  );
  assert(
    !recoverySource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs",
    ),
    "private-channel recovery family should not import scenario cases through assertion helpers",
  );
  assert(
    assertionSource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs",
    ),
    "private-channel assertions should consume shared case definitions",
  );
  assert(
    !/export\s+function\s+completedPrivateChannelReloadScenario\b/.test(
      assertionSource,
    ) &&
      !/export\s+function\s+staleCompletedPrivatePostScenario\b/.test(
        assertionSource,
      ),
    "private-channel assertions should not redefine raw scenario cases",
  );
});
