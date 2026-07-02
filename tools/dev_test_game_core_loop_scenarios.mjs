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

export const coreLoopSpineCheckId = "core-loop-spine";

export const coreLoopAuditLaneIds = Object.freeze([
  "core-loop",
  "day-vote-resolution",
  "day-vote-no-lynch",
  "action-loop",
  "host-deadline-advance",
  "stale-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
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
  ...coreLoopAuditLaneIds,
]);
