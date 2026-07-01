import {
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostDeadlineRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostRaceReloadLaneIds,
  hostStandaloneStaleControlLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";

export const hardeningAuditLaneIds = Object.freeze([
  "replacement-redeemed-invite-recovery",
  "replacement-session-revocation-recovery",
  "replacement-session-refresh-recovery",
  "replacement-stale-session-after-refresh",
  "replacement-reconnect-recovery",
  ...staleConflictMessageLaneIds,
  "replacement-idempotent-retry",
  ...playerActionFoundationLaneIds,
  ...promotedStalePlayerCommandLaneIds,
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  "concurrent-player-vote-resolve-race",
  "concurrent-player-vote-resolve-race-reload",
  "concurrent-player-action-advance-race",
  "concurrent-player-action-advance-race-reload",
  "concurrent-cohost-deadline-resolve-race",
  "concurrent-cohost-deadline-resolve-race-reload",
  ...replacementPrivatePostRaceLaneIds,
  "concurrent-replacement-vote-race",
  "concurrent-replacement-vote-race-reload",
  "concurrent-replacement-action-race",
  "concurrent-replacement-action-race-reload",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  ...replacementPrivatePostRecoveryLaneIds,
  "concurrent-host-publish-race",
  "concurrent-host-publish-race-reload",
  ...hostStandaloneStaleControlLaneIds,
  "concurrent-host-lifecycle-race",
  "concurrent-host-lifecycle-race-reload",
  ...hostPromptStaleControlLaneIds,
  ...completedGameHardeningLaneIds(),
  ...playerActionConflictRecoveryLaneIds,
  ...hostGenericStaleControlLaneIds,
  ...hostRaceReloadLaneIds,
  ...hostPhaseStaleControlLaneIds,
  "stale-cohost-deadline",
  ...cohostDeadlineRecoveryLaneIds,
]);
