import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopRoleSurfaceProofEvidenceKeys,
  coreLoopRoleSurfaceProofCaseKeys,
} from "./dev_test_game_core_loop_admin_proof.mjs";

test("core loop admin proof role surfaces have one declarative serial order", () => {
  const caseKeys = coreLoopRoleSurfaceProofCaseKeys();
  assert.equal(new Set(caseKeys).size, caseKeys.length);
  assert.deepEqual(caseKeys, [
    "hostRoleSurface",
    "playerRoleSurface",
    "targetResolutionReceiptSurface",
    "normalResolutionPrivacySurface",
    "targetDayVoteReceiptSurface",
    "normalDayVotePrivacySurface",
    "hostPhaseTransitionSurface",
    "targetPostDayVoteAdvanceSurface",
    "normalPostDayVoteAdvanceSurface",
    "nightActionResolutionReceiptSurface",
    "normalNightActionResolutionPrivacySurface",
    "hostNightActionTransitionSurface",
    "dayThreeVoteResolutionSurface",
    "postDayThreeResolutionSurface",
    "nightThreeEmptyResolutionSurface",
    "dayFourSurvivorRoleSurface",
    "nightFourNoActionSurface",
    "nightFourNoActionResolutionSurface",
    "postNightFourTransitionSurface",
    "dayFiveNoLynchResolutionSurface",
    "completedGameEndgameSurface",
    "privateChannelRoleSurface",
  ]);
  assert.deepEqual(
    coreLoopRoleSurfaceProofEvidenceKeys({ omit: ["hostRoleSurface"] }),
    caseKeys.slice(1),
  );
});
