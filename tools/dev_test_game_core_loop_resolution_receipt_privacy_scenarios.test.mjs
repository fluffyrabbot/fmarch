import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopResolutionReceiptPrivacyFamilyId,
  coreLoopResolutionReceiptPrivacyLaneIds,
  coreLoopResolutionReceiptPrivacyScenarioFamily,
  nightFourNoActionResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs";

test("receipt/privacy family shares post-Day 3 and Night 4 no-action resolution cases", () => {
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
    family.surfaces.nightFourNoActionResolution,
    nightFourNoActionResolutionSurfaceCase(),
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
    family.privateReceiptScenarios.nightFourNoActionPrivacy.privateReceipt,
    false,
  );
  assert.match(
    family.privateReceiptScenarios.nightFourNoActionPrivacy.boundaryText,
    /no-action host resolution/,
  );
  assert.notEqual(
    coreLoopResolutionReceiptPrivacyScenarioFamily().surfaces
      .postDayThreeResolution,
    coreLoopResolutionReceiptPrivacyScenarioFamily().surfaces
      .postDayThreeResolution,
  );
});
