import {
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

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
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
]);

export const coreLoopAdminCheckIds = Object.freeze([
  coreLoopSpineCheckId,
  ...coreLoopAuditLaneIds,
]);
