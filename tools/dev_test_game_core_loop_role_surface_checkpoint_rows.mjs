import {
  playerActionSubmissionAckCheckpointRows,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  dayTwoNightTwoCycleId,
} from "./dev_test_game_core_loop_day_two_night_two_scenarios.mjs";
import {
  hostControlRoleSurfaceCheckpointRows,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  nightActionResolutionPrivateReceiptCheckpointRows,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";

export const coreLoopRoleSurfaceSpineCheckpointRows = ({
  hostRoleSurface,
  hostPhaseTransitionSurface,
  playerRoleSurface,
  nightActionResolutionReceiptSurface,
  normalNightActionResolutionPrivacySurface,
} = {}) => {
  const rows = [];
  rows.push(
    ...hostControlRoleSurfaceCheckpointRows({
      cycleId: dayTwoNightTwoCycleId,
      hostRoleSurface,
      hostPhaseTransitionSurface,
    }),
  );
  rows.push(
    ...playerActionSubmissionAckCheckpointRows({
      cycleId: dayTwoNightTwoCycleId,
      playerRoleSurface,
    }),
  );
  rows.push(
    ...nightActionResolutionPrivateReceiptCheckpointRows({
      cycleId: dayTwoNightTwoCycleId,
      nightActionResolutionReceiptSurface,
      normalNightActionResolutionPrivacySurface,
    }),
  );
  return rows;
};
