import {
  coreLoopCompletedEndgameProgressionScenarioFamily,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  coreLoopDayFiveProgressionScenarioFamily,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";
import {
  coreLoopHostControlScenarioFamily,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  coreLoopLateActionProgressionScenarioFamily,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  coreLoopNoLynchProgressionScenarioFamily,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  coreLoopPhaseProgressionScenarioFamily,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  coreLoopPlayerActionRecoveryScenarioFamily,
} from "./dev_test_game_core_loop_player_action_recovery_scenarios.mjs";
import {
  coreLoopPostDayVoteAdvanceScenarioFamily,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";
import {
  coreLoopPrivateChannelRecoveryScenarioFamily,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  coreLoopPrivateReceiptSurfaceScenarioFamily,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";
import {
  coreLoopResolutionReceiptPrivacyScenarioFamily,
} from "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs";
import {
  coreLoopVoteResolutionScenarioFamily,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";

export function coreLoopGeneratedFromScenarioFamilies() {
  return {
    hostControlFamily: coreLoopHostControlScenarioFamily(),
    playerActionRecoveryFamily:
      coreLoopPlayerActionRecoveryScenarioFamily(),
    privateReceiptSurfaceFamily:
      coreLoopPrivateReceiptSurfaceScenarioFamily(),
    postDayVoteAdvanceFamily:
      coreLoopPostDayVoteAdvanceScenarioFamily(),
    voteResolutionFamily: coreLoopVoteResolutionScenarioFamily(),
    phaseProgressionFamily: coreLoopPhaseProgressionScenarioFamily(),
    lateActionProgressionFamily: coreLoopLateActionProgressionScenarioFamily(),
    resolutionReceiptPrivacyFamily:
      coreLoopResolutionReceiptPrivacyScenarioFamily(),
    noLynchProgressionFamily:
      coreLoopNoLynchProgressionScenarioFamily(),
    dayFiveProgressionFamily:
      coreLoopDayFiveProgressionScenarioFamily(),
    completedEndgameProgressionFamily:
      coreLoopCompletedEndgameProgressionScenarioFamily(),
    privateChannelRecoveryFamily:
      coreLoopPrivateChannelRecoveryScenarioFamily(),
  };
}
