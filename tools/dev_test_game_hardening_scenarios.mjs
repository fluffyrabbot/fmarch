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
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  playerActionConflictRecoveryLaneIds,
  playerActionFoundationLaneIds,
  promotedStalePlayerCommandLaneIds,
} from "./dev_test_game_player_recovery_scenarios.mjs";
import {
  replacementPrivatePostRecoveryLaneIds,
  replacementRaceLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  replacementHandoffHardeningLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  hardeningRecoveryAuditLaneIds,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";

const uniqueLaneIds = (laneIds) => [...new Set(laneIds)];

export const hardeningAuditLaneIds = Object.freeze(uniqueLaneIds([
  ...replacementHandoffHardeningLaneIds,
  ...hardeningRecoveryAuditLaneIds,
  ...playerActionFoundationLaneIds,
  ...promotedStalePlayerCommandLaneIds,
  "concurrent-vote-race",
  "concurrent-vote-race-reload",
  ...playerHostRaceLaneIds,
  ...cohostHostRaceLaneIds,
  ...replacementRaceLaneIds,
  "replacement-incoming-action",
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
