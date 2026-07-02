import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopPhaseProgressionAliasOnlyProofLaneIds,
  coreLoopPhaseProgressionDemoOnlySeedScenarioIds,
  coreLoopPhaseProgressionFamilyId,
  coreLoopPhaseProgressionLaneIds,
  coreLoopPhaseProgressionRequiredSeedScenarioIds,
  coreLoopPhaseProgressionScenarioFamily,
  coreLoopPhaseProgressionSeedAliasEntries,
  coreLoopPhaseProgressionSpineSourceLaneIds,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";

test("core loop phase progression family names proof, seed, and stale reject cases", () => {
  assert.equal(
    coreLoopPhaseProgressionFamilyId,
    "core-loop-phase-progression",
  );
  assert.deepEqual(coreLoopPhaseProgressionLaneIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
    "action-loop",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionSpineSourceLaneIds, [
    "core-loop",
    "day-vote-resolution",
    "action-loop",
    "resolution-receipts",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionRequiredSeedScenarioIds, [
    "night-action-loop",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionDemoOnlySeedScenarioIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionAliasOnlyProofLaneIds, [
    "action-loop",
    "stale-action-conflict",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionSeedAliasEntries, [
    ["night-action-loop", ["action-loop", "stale-action-conflict"]],
  ]);

  const family = coreLoopPhaseProgressionScenarioFamily();
  assert.equal(family.id, coreLoopPhaseProgressionFamilyId);
  assert.equal(
    family.surfaces.dayThreeVoteResolution.playerVoteCase.clickedAction,
    "submit_vote",
  );
  assert.equal(
    family.surfaces.postDayThreeResolution.actionPlayerNightThreeCase
      .expectedPhaseId,
    "N03",
  );
  assert.equal(
    family.staleRejects.staleDayTwoVote.messageIncludes,
    "stale vote state, refresh and use current vote controls",
  );
  assert.equal(
    family.staleRejects.staleNightOneAction.messageIncludes,
    "stale action state, refresh and use current action controls",
  );
});
