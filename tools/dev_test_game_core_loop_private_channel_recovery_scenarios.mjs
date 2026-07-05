import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";
import {
  playerInvalidActionRecoveryMessage,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertLaneCoverageSummary,
  buildLaneCoverageSummary,
  cloneLaneCoverageFamilies,
} from "./dev_test_game_lane_coverage.mjs";

export {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransition,
  completedPrivateChannelTransitionTokens,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs";

export const coreLoopPrivateChannelRecoveryFamilyId =
  "core-loop-private-channel-recovery";

export const coreLoopPrivateChannelPostLaneId = "private-channel";
export const coreLoopPrivateChannelStalePostLaneId =
  "private-channel-stale-post-after-transition";
export const coreLoopPrivateChannelCompletedPostLaneId =
  "private-channel-completed-game-recovery";
export const coreLoopPrivateChannelInvalidActionLaneId =
  "private-channel-invalid-action-recovery";

export function privateChannelInvalidActionRecoveryScenario() {
  return {
    laneId: coreLoopPrivateChannelInvalidActionLaneId,
    channelId: "private:mafia_day_chat",
    actorSlot: "slot_4",
    clickedAction: "submit_invalid_action:factional_kill",
    commandKind: "SubmitAction",
    commandError: "InvalidTarget",
    commandMessage: playerInvalidActionRecoveryMessage,
    expectedActionTemplateId: "factional_kill",
    expectedRefreshKeys: ["commandState"],
    expectedPhaseId: "N01",
  };
}

const clonePrivateChannelRecoveryScenarioCase = (scenarioCase) => ({
  ...scenarioCase,
  coverage:
    scenarioCase.coverage === undefined
      ? undefined
      : { ...scenarioCase.coverage },
  scenario: clonePrivateChannelRecoveryScenario(scenarioCase.scenario),
});

const clonePrivateChannelRecoveryScenario = (scenario) =>
  Object.fromEntries(
    Object.entries(scenario).map(([key, value]) => [
      key,
      Array.isArray(value) ? [...value] : value,
    ]),
  );

const uniqueLaneIds = (scenarioCases) => [
  ...new Set(scenarioCases.map((scenarioCase) => scenarioCase.laneId)),
];

const coreLoopPrivateChannelRecoveryScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "submitPost",
    laneId: coreLoopPrivateChannelPostLaneId,
    scenario: Object.freeze(privateChannelSubmitPostScenario()),
    coverage: Object.freeze({
      id: "core-loop-private-channel-post",
      label: "Private channel post and role URL",
    }),
  }),
  Object.freeze({
    key: "stalePostAfterPhaseTransition",
    staleRejectKey: "stalePostAfterPhaseTransition",
    laneId: coreLoopPrivateChannelStalePostLaneId,
    scenario: Object.freeze(stalePrivateChannelPostPhaseLockedScenario()),
    coverage: Object.freeze({
      id: "core-loop-private-channel-stale-post",
      label: "Private channel stale post recovery",
    }),
  }),
  Object.freeze({
    key: "completedPrivateChannelReload",
    reloadKey: "completedPrivateChannel",
    laneId: coreLoopPrivateChannelCompletedPostLaneId,
    scenario: Object.freeze(completedPrivateChannelReloadScenario()),
    coverage: Object.freeze({
      id: "core-loop-private-channel-completed-game",
      label: "Completed private-channel recovery",
    }),
  }),
  Object.freeze({
    key: "staleCompletedPrivatePost",
    staleRejectKey: "staleCompletedPrivatePost",
    laneId: coreLoopPrivateChannelCompletedPostLaneId,
    scenario: Object.freeze(staleCompletedPrivatePostScenario()),
  }),
  Object.freeze({
    key: "invalidActionRecovery",
    staleRejectKey: "invalidActionRecovery",
    laneId: coreLoopPrivateChannelInvalidActionLaneId,
    scenario: Object.freeze(privateChannelInvalidActionRecoveryScenario()),
    coverage: Object.freeze({
      id: "core-loop-private-channel-invalid-action",
      label: "Private channel invalid action recovery",
    }),
  }),
]);

export function coreLoopPrivateChannelRecoveryScenarioCases() {
  return coreLoopPrivateChannelRecoveryScenarioCaseDefinitions.map(
    clonePrivateChannelRecoveryScenarioCase,
  );
}

export const coreLoopPrivateChannelRecoveryLaneIds = Object.freeze([
  ...uniqueLaneIds(coreLoopPrivateChannelRecoveryScenarioCaseDefinitions),
]);

export const coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions =
  Object.freeze(
    coreLoopPrivateChannelRecoveryScenarioCaseDefinitions
      .filter((scenarioCase) => scenarioCase.coverage !== undefined)
      .map((scenarioCase) =>
        Object.freeze({
          id: scenarioCase.coverage.id,
          label: scenarioCase.coverage.label,
          laneIds: Object.freeze([scenarioCase.laneId]),
        }),
      ),
  );

export function coreLoopPrivateChannelRecoveryCoverageFamilies() {
  return cloneLaneCoverageFamilies(
    coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
  );
}

export function buildCoreLoopPrivateChannelRecoveryCoverageSummary(lanes) {
  return buildLaneCoverageSummary({
    lanes,
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
    families: coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
  });
}

export function assertCoreLoopPrivateChannelRecoveryCoverageSummary({
  summary,
  lanes,
}) {
  return assertLaneCoverageSummary({
    summary,
    lanes,
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
    familyDefinitions: coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
    label: "core-loop private-channel recovery",
  });
}

export function coreLoopPrivateChannelRecoveryScenarioFamily() {
  const scenarioCases = coreLoopPrivateChannelRecoveryScenarioCases();
  return {
    id: coreLoopPrivateChannelRecoveryFamilyId,
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    transitionTokens: completedPrivateChannelTransitionTokens(),
    scenarios: Object.fromEntries(
      scenarioCases.map((scenarioCase) => [
        scenarioCase.key,
        scenarioCase.scenario,
      ]),
    ),
    staleRejects: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.staleRejectKey !== undefined)
        .map((scenarioCase) => [
          scenarioCase.staleRejectKey,
          scenarioCase.scenario,
        ]),
    ),
    reloads: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.reloadKey !== undefined)
        .map((scenarioCase) => [
          scenarioCase.reloadKey,
          scenarioCase.scenario,
        ]),
    ),
  };
}
