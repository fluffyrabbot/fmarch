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

export function coreLoopScenarioFamilyRows(
  families = coreLoopGeneratedFromScenarioFamilies(),
) {
  return Object.freeze(
    Object.values(families ?? {}).map((family) => {
      const surfaces = objectKeys(family?.surfaces);
      const staleRejects = objectKeys(family?.staleRejects);
      const reloads = objectKeys(family?.reloads);
      const scenarios = objectKeys(family?.scenarios);
      const transitionTokens = objectKeys(family?.transitionTokens);
      return Object.freeze({
        id: String(family?.id ?? ""),
        label: formatScenarioFamilyLabel(family?.id),
        status: `${Array.isArray(family?.laneIds) ? family.laneIds.length : 0} lanes, ${surfaces.length} surfaces`,
        laneIds: Object.freeze(
          (Array.isArray(family?.laneIds) ? family.laneIds : []).map((id) =>
            String(id),
          ),
        ),
        surfaces: Object.freeze(surfaces),
        staleRejects: Object.freeze(staleRejects),
        reloads: Object.freeze(reloads),
        scenarios: Object.freeze(scenarios),
        transitionTokens: Object.freeze(transitionTokens),
      });
    }),
  );
}

function objectKeys(value) {
  return value !== null && typeof value === "object" ? Object.keys(value) : [];
}

function formatScenarioFamilyLabel(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}
