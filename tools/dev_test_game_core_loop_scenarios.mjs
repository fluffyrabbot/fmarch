import {
  completedGameSeedRequiredScenarioIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  replacementCoreLoopHandoffLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  coreLoopPlayerActionRecoveryLaneIds,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";
import {
  coreLoopPhaseProgressionLaneIds,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  coreLoopHostControlLaneIds,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  coreLoopPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  coreLoopFeatureSpineAdminCheckIds,
} from "./dev_test_game_feature_lane_catalog.mjs";

export const coreLoopSpineCheckId = "core-loop-spine";
export const coreLoopCompletedGameCoverageCheckId =
  "completed-game-hardening-coverage";

export const coreLoopAuditLaneIds = Object.freeze([
  "core-loop",
  ...coreLoopPhaseProgressionLaneIds,
  "host-deadline-advance",
  "stale-deadline-advance",
  "resolution-receipts",
  "dead-player-recovery",
  ...coreLoopPlayerActionRecoveryLaneIds.filter(
    (laneId) => !coreLoopPhaseProgressionLaneIds.includes(laneId),
  ),
  ...coreLoopPrivateChannelRecoveryLaneIds,
  "host-votecount-publication",
  ...coreLoopHostControlLaneIds,
  ...completedGameSeedRequiredScenarioIds(),
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  ...replacementCoreLoopHandoffLaneIds,
]);

export const coreLoopAdminCheckIds = Object.freeze([
  ...new Set([
    coreLoopSpineCheckId,
    coreLoopCompletedGameCoverageCheckId,
    ...coreLoopAuditLaneIds,
    ...coreLoopFeatureSpineAdminCheckIds,
  ]),
]);
