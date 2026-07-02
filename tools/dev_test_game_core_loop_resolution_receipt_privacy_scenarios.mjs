import {
  assertPostDayThreeResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";
import {
  assertNightFourResolutionReceiptSurfaceCase,
  nightFourResolutionReceiptSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

export {
  assertPostDayThreeResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
  assertNightFourResolutionReceiptSurfaceCase,
  nightFourResolutionReceiptSurfaceCase,
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
      nightFourResolutionReceipt: nightFourResolutionReceiptSurfaceCase(),
    },
    privateReceiptScenarios: {
      dayThreeTargetReceipt: clonePrivateReceiptScenario(
        privateReceiptScenario("d03-target-receipt"),
      ),
      dayThreeActionPlayerPrivacy: clonePrivateReceiptScenario(
        privateReceiptScenario("d03-action-player-privacy"),
      ),
      nightFourSurvivorReceipt: clonePrivateReceiptScenario(
        privateReceiptScenario("n04-survivor-receipt"),
      ),
      nightFourActionPlayerPrivacy: clonePrivateReceiptScenario(
        privateReceiptScenario("n04-action-player-privacy"),
      ),
    },
  };
}

function clonePrivateReceiptScenario(scenario) {
  return { ...scenario };
}
