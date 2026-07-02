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
  playerActionBoundaryLaneId,
  playerInvalidActionRecoveryLaneId,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  coreLoopPhaseProgressionLaneIds,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";

export const coreLoopSpineCheckId = "core-loop-spine";
export const coreLoopCompletedGameCoverageCheckId =
  "completed-game-hardening-coverage";

export const coreLoopAuditLaneIds = Object.freeze([
  "core-loop",
  ...coreLoopPhaseProgressionLaneIds,
  "host-deadline-advance",
  "stale-deadline-advance",
  playerInvalidActionRecoveryLaneId,
  "resolution-receipts",
  "dead-player-recovery",
  playerActionBoundaryLaneId,
  "private-channel",
  "host-votecount-publication",
  "host-lifecycle-control",
  "host-modkill-control",
  ...completedGameSeedRequiredScenarioIds(),
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  ...replacementCoreLoopHandoffLaneIds,
]);

export const coreLoopAdminCheckIds = Object.freeze([
  coreLoopSpineCheckId,
  coreLoopCompletedGameCoverageCheckId,
  ...coreLoopAuditLaneIds,
]);
