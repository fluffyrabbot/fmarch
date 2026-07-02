import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopResolutionReceiptPrivacyFamilyId,
  coreLoopResolutionReceiptPrivacyLaneIds,
  coreLoopResolutionReceiptPrivacyScenarioFamily,
  nightFourResolutionReceiptSurfaceCase,
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs";

test("receipt/privacy family shares post-Day 3 and Night 4 receipt cases", () => {
  assert.equal(
    coreLoopResolutionReceiptPrivacyFamilyId,
    "core-loop-resolution-receipt-privacy",
  );
  assert.deepEqual(coreLoopResolutionReceiptPrivacyLaneIds, [
    "resolution-receipts",
    "action-loop",
  ]);

  const family = coreLoopResolutionReceiptPrivacyScenarioFamily();
  assert.equal(family.id, coreLoopResolutionReceiptPrivacyFamilyId);
  assert.deepEqual(family.laneIds, coreLoopResolutionReceiptPrivacyLaneIds);
  assert.deepEqual(
    family.surfaces.postDayThreeResolution,
    postDayThreeResolutionSurfaceCase(),
  );
  assert.deepEqual(
    family.surfaces.nightFourResolutionReceipt,
    nightFourResolutionReceiptSurfaceCase(),
  );
  assert.equal(
    family.privateReceiptScenarios.dayThreeTargetReceipt.id,
    "d03-target-receipt",
  );
  assert.equal(
    family.privateReceiptScenarios.dayThreeActionPlayerPrivacy.privateReceipt,
    false,
  );
  assert.equal(
    family.privateReceiptScenarios.nightFourSurvivorReceipt.phaseId,
    "N04",
  );
  assert.equal(
    family.privateReceiptScenarios.nightFourActionPlayerPrivacy.privateReceipt,
    false,
  );
  assert.notEqual(
    coreLoopResolutionReceiptPrivacyScenarioFamily().surfaces
      .postDayThreeResolution,
    coreLoopResolutionReceiptPrivacyScenarioFamily().surfaces
      .postDayThreeResolution,
  );
});
