import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNormalPostDayVoteAdvanceSurfaceProof,
  assertTargetPostDayVoteAdvanceSurfaceProof,
  coreLoopPostDayVoteAdvanceFamilyId,
  coreLoopPostDayVoteAdvanceLaneIds,
  coreLoopPostDayVoteAdvanceScenarioFamily,
  postDayVoteAdvanceSurfaceCases,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";
import {
  postDayVoteAdvanceProofFixture,
  privateReceiptSourceRoleUrl,
} from "./dev_test_game_core_loop_role_surface_test_fixtures.mjs";

test("post-day-vote advance family shares target and normal observation cases", () => {
  assert.equal(
    coreLoopPostDayVoteAdvanceFamilyId,
    "core-loop-post-day-vote-advance",
  );
  assert.deepEqual(coreLoopPostDayVoteAdvanceLaneIds, [
    "resolution-receipts",
  ]);

  const family = coreLoopPostDayVoteAdvanceScenarioFamily();
  assert.equal(family.id, coreLoopPostDayVoteAdvanceFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPostDayVoteAdvanceLaneIds);
  assert.deepEqual(Object.keys(family.surfaces), [
    "targetPostDayVoteAdvance",
    "normalPostDayVoteAdvance",
  ]);
  assert.equal(
    family.surfaces.targetPostDayVoteAdvance.privateReceiptStatus,
    "day_vote",
  );
  assert.equal(
    family.surfaces.normalPostDayVoteAdvance.privateReceipt,
    false,
  );
  assert.notEqual(
    postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
    postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
  );
});

test("post-day-vote advance assertions cover target receipt and normal privacy", () => {
  const game = "game-a";
  assert.doesNotThrow(() =>
    assertTargetPostDayVoteAdvanceSurfaceProof({
      proof: postDayVoteAdvanceProofFixture({
        game,
        surfaceCase: postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
      }),
      expectedGame: game,
      sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
    }),
  );
  assert.doesNotThrow(() =>
    assertNormalPostDayVoteAdvanceSurfaceProof({
      proof: postDayVoteAdvanceProofFixture({
        game,
        surfaceCase: postDayVoteAdvanceSurfaceCases().normalPostDayVoteAdvance,
      }),
      expectedGame: game,
      sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
    }),
  );
  assert.throws(
    () =>
      assertNormalPostDayVoteAdvanceSurfaceProof({
        proof: {
          ...postDayVoteAdvanceProofFixture({
            game,
            surfaceCase:
              postDayVoteAdvanceSurfaceCases().normalPostDayVoteAdvance,
          }),
          projectionNotifications: [{ effect: "player_killed" }],
        },
        expectedGame: game,
        sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
      }),
    /normal post-day-vote advance surface/,
  );
});
