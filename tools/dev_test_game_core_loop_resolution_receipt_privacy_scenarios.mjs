import {
  assertPostDayThreeResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";
import {
  assertNightFourNoActionResolutionSurfaceCase,
  nightFourNoActionResolutionSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

export {
  assertPostDayThreeResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
  assertNightFourNoActionResolutionSurfaceCase,
  nightFourNoActionResolutionSurfaceCase,
};

export const coreLoopResolutionReceiptPrivacyFamilyId =
  "core-loop-resolution-receipt-privacy";

export const coreLoopResolutionReceiptPrivacyLaneIds = Object.freeze([
  "resolution-receipts",
  "action-loop",
]);

export function coreLoopResolutionReceiptPrivacyScenarioFamily() {
  return {
    id: coreLoopResolutionReceiptPrivacyFamilyId,
    laneIds: [...coreLoopResolutionReceiptPrivacyLaneIds],
    surfaces: {
      postDayThreeResolution: postDayThreeResolutionSurfaceCase(),
      nightFourNoActionResolution: nightFourNoActionResolutionSurfaceCase(),
    },
    privateReceiptScenarios: {
      dayThreeTargetReceipt: clonePrivateReceiptScenario(
        privateReceiptScenario("d03-target-receipt"),
      ),
      dayThreeActionPlayerPrivacy: clonePrivateReceiptScenario(
        privateReceiptScenario("d03-action-player-privacy"),
      ),
      nightFourNoActionPrivacy: clonePrivateReceiptScenario(
        privateReceiptScenario("n04-action-player-privacy"),
      ),
    },
  };
}

function clonePrivateReceiptScenario(scenario) {
  return { ...scenario };
}
