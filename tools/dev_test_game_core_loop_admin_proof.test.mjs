import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopRoleSurfaceProofCases,
  coreLoopRoleSurfaceProofEvidenceKeys,
  coreLoopRoleSurfaceProofCaseKeys,
  coreLoopRoleSurfaceProofInventory,
} from "./dev_test_game_core_loop_role_surface_proof_cases.mjs";

test("core loop admin proof role surfaces have one declarative serial order", () => {
  const caseKeys = coreLoopRoleSurfaceProofCaseKeys();
  assert.equal(new Set(caseKeys).size, caseKeys.length);
  assert.equal(
    new Set(coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey)).size,
    coreLoopRoleSurfaceProofCases.length,
  );
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
  assert.deepEqual(coreLoopRoleSurfaceProofInventory(), {
    surfaceKeys: caseKeys,
    proofKeys: coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey),
  });
});
