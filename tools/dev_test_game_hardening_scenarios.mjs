import {
  completedGameHardeningLaneIds,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostHostRaceLaneIds,
  playerHostRaceLaneIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  cohostDeadlineRecoveryLaneIds,
  hostGenericStaleControlLaneIds,
  hostLifecycleRaceLaneIds,
  hostPhaseStaleControlLaneIds,
  hostPromptStaleControlLaneIds,
  hostPublishRaceLaneIds,
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
  replacementHandoffHardeningLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";

const uniqueLaneIds = (laneIds) => [...new Set(laneIds)];

export const hardeningAuditLaneIds = Object.freeze(uniqueLaneIds([
  ...replacementHandoffHardeningLaneIds,
  ...staleConflictMessageLaneIds,
  ...playerActionFoundationLaneIds,
  ...promotedStalePlayerCommandLaneIds,
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  ...playerHostRaceLaneIds,
  ...cohostHostRaceLaneIds,
  ...replacementPrivatePostRaceLaneIds,
  "concurrent-replacement-vote-race",
  "concurrent-replacement-vote-race-reload",
  "concurrent-replacement-action-race",
  "concurrent-replacement-action-race-reload",
  "replacement-incoming-action",
  "replacement-action-reconnect",
  "replacement-stale-action-after-resolve",
  ...replacementPrivatePostRecoveryLaneIds,
  ...hostPublishRaceLaneIds,
  ...hostStandaloneStaleControlLaneIds,
  ...hostLifecycleRaceLaneIds,
  ...hostPromptStaleControlLaneIds,
  ...completedGameHardeningLaneIds(),
  ...playerActionConflictRecoveryLaneIds,
  ...hostGenericStaleControlLaneIds,
  ...hostRaceReloadLaneIds,
  ...hostPhaseStaleControlLaneIds,
  "stale-cohost-deadline",
  ...cohostDeadlineRecoveryLaneIds,
]));
