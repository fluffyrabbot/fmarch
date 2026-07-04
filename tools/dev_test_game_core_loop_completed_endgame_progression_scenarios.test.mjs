import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopCompletedEndgameProgressionFamilyId,
  coreLoopCompletedEndgameProgressionLaneIds,
  coreLoopCompletedEndgameProgressionScenarioFamilies,
  coreLoopCompletedEndgameProgressionScenarioFamily,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  completedGameEndgameScenarioCaseFamilies,
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_game_scenario_assertions.mjs";
import {
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessScenarioFamily,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_cases.mjs";

test("completed endgame progression family shares reload and stale command cases", () => {
  assert.equal(
    coreLoopCompletedEndgameProgressionFamilyId,
    "core-loop-completed-endgame-progression",
  );
  assert.deepEqual(
    coreLoopCompletedEndgameProgressionLaneIds,
    completedGameHardeningLaneIds(),
  );

  const scenarioFamilies = coreLoopCompletedEndgameProgressionScenarioFamilies();
  assert.deepEqual(scenarioFamilies, completedGameProofReadinessScenarioFamilies());
  assert.deepEqual(scenarioFamilies, completedGameEndgameScenarioCaseFamilies());
  const family = coreLoopCompletedEndgameProgressionScenarioFamily({
    scenarioFamilies,
  });
  const contractFamily = completedGameProofReadinessScenarioFamily({
    scenarioFamilies,
  });

  assert.equal(family.id, coreLoopCompletedEndgameProgressionFamilyId);
  assert.deepEqual(family.laneIds, coreLoopCompletedEndgameProgressionLaneIds);
  assert.deepEqual(
    family.transitionTokens,
    contractFamily.transitionTokens,
  );
  assert.deepEqual(
    family.staleRejects.completedHostStaleCommands.map(
      (scenario) => scenario.proofField,
    ),
    [
      "completedHostStaleResolveRecoveryProof",
      "completedHostStaleAdvanceRecoveryProof",
      "completedHostStaleCompleteRecoveryProof",
    ],
  );
  assert.deepEqual(
    family.reloads.completedPlayers.map((scenario) => scenario.proofField),
    [
      "completedPlayerReloadProof",
      "completedNormalPlayerReloadProof",
      "completedDeadPlayerReloadProof",
    ],
  );
  assert.deepEqual(
    family.staleRejects.staleCompletedGamePlayerCommands.map(
      (scenario) => scenario.proofField,
    ),
    ["staleCompletedVoteRecoveryProof", "staleCompletedPostRecoveryProof"],
  );
  assert.equal(
    family.staleRejects.completedDeadPlayerStaleVote.proofField,
    "completedDeadPlayerStaleVoteRecoveryProof",
  );
});
