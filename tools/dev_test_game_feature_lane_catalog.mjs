import {
  playerActionLoopLaneId,
  playerActionBoundaryLaneId,
  playerActionBoundaryRecoveryHookId,
  playerInvalidActionRecoveryHookId,
  playerInvalidActionRecoveryLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  hostNightActionTransitionLaneId,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  coreLoopPrivateChannelPostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  postDayThreeTransitionLaneId,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";
import {
  coreLoopVoteResolutionLaneIds,
  dayThreeVoteResolutionLaneId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";

export const nightThreeActionResolutionLaneId =
  "night-three-action-resolution";

export const coreLoopFeatureSpineSourceCheckId = "local-core-loop-proof";
export const devTestGameCoreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";
export const coreLoopFeatureSpineSource = Object.freeze({
  sourceCheckId: coreLoopFeatureSpineSourceCheckId,
  graphSourceNodeId: "admin-proof:core-loop",
  readinessSourceKind: "spine-targets",
  detailRoleUrlIncludes: "/admin/audit/local-core-loop",
  roleUrlIncludes: "/g/",
  rerunCommand: devTestGameCoreLoopAdminProofCommand,
});

export const coreLoopFeatureSpineCycleIds = Object.freeze({
  dayTwoNightTwo: "d02-n02",
  dayOneNightOneDayTwo: "d01-n01-d02",
  nightTwoDayThree: "n02-d03",
});

const dayTwoNightTwo = coreLoopFeatureSpineCycleIds.dayTwoNightTwo;
const dayOneNightOneDayTwo =
  coreLoopFeatureSpineCycleIds.dayOneNightOneDayTwo;
const nightTwoDayThree = coreLoopFeatureSpineCycleIds.nightTwoDayThree;

const coreLoopFeatureSpineLaneRows = Object.freeze([
  Object.freeze({
    targetKey: "hostPhaseControl",
    featureSlotId: "host-phase-control",
    cycleId: dayTwoNightTwo,
    role: "host",
    checkpointId: `${dayTwoNightTwo}-d02-vote-open`,
    adminCheckId: "host-lifecycle-control",
  }),
  Object.freeze({
    targetKey: "dayVoteResolution",
    featureSlotId: dayThreeVoteResolutionLaneId,
    cycleId: dayTwoNightTwo,
    role: "actionPlayer",
    checkpointId: `${dayTwoNightTwo}-d02-deciding-vote-submitted`,
    adminCheckId: dayThreeVoteResolutionLaneId,
    seedMembership: "demoOnly",
    seedOrder: 10,
    seedRoleOverride: "actionPlayer",
  }),
  Object.freeze({
    targetKey: "postDayThreeTransition",
    featureSlotId: postDayThreeTransitionLaneId,
    cycleId: dayTwoNightTwo,
    role: "host",
    checkpointId: `${dayTwoNightTwo}-d02-resolved-target-killed`,
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "nightActionLoop",
    featureSlotId: "night-action-loop",
    cycleId: dayOneNightOneDayTwo,
    role: "actionPlayer",
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    adminCheckId: playerActionLoopLaneId,
    proofLaneAliases: Object.freeze([
      playerActionLoopLaneId,
      "stale-action-conflict",
    ]),
  }),
  Object.freeze({
    targetKey: "playerActionSubmission",
    featureSlotId: "player-action-submission",
    cycleId: dayTwoNightTwo,
    role: "actionPlayer",
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    adminCheckId: playerActionLoopLaneId,
  }),
  Object.freeze({
    targetKey: "hostNightActionTransition",
    featureSlotId: hostNightActionTransitionLaneId,
    cycleId: dayTwoNightTwo,
    role: "host",
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "nightTwoActionResolution",
    featureSlotId: "night-two-action-resolution",
    cycleId: nightTwoDayThree,
    role: "host",
    checkpointId: `${nightTwoDayThree}-n02-resolved-target-killed`,
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "dayThreeTerminalBoundary",
    featureSlotId: "day-three-terminal-boundary",
    cycleId: nightTwoDayThree,
    role: "host",
    checkpointId: `${nightTwoDayThree}-d03-terminal-advance-reject`,
    recoveryHookId: "d03TerminalAdvanceReject",
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "dayThreeTerminalRecovery",
    featureSlotId: "day-three-terminal-recovery",
    cycleId: nightTwoDayThree,
    role: "host",
    checkpointId: `${nightTwoDayThree}-d03-terminal-reload-recovery`,
    recoveryHookId: "d03TerminalAdvanceReject",
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "dayThreeNoMajorityRevote",
    featureSlotId: "day-three-no-majority-revote",
    cycleId: nightTwoDayThree,
    role: "host",
    checkpointId: `${nightTwoDayThree}-d03-revote-prompt-resolved`,
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "invalidActionRecovery",
    featureSlotId: playerInvalidActionRecoveryLaneId,
    cycleId: dayTwoNightTwo,
    role: "actionPlayer",
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    recoveryHookId: playerInvalidActionRecoveryHookId,
    adminCheckId: playerInvalidActionRecoveryLaneId,
  }),
  Object.freeze({
    targetKey: "playerActionBoundary",
    featureSlotId: playerActionBoundaryLaneId,
    cycleId: dayOneNightOneDayTwo,
    role: "normalPlayer",
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    recoveryHookId: playerActionBoundaryRecoveryHookId,
    adminCheckId: playerActionBoundaryLaneId,
  }),
  Object.freeze({
    targetKey: "privateChannel",
    featureSlotId: coreLoopPrivateChannelPostLaneId,
    cycleId: dayOneNightOneDayTwo,
    role: "privateChannel",
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    adminCheckId: coreLoopPrivateChannelPostLaneId,
  }),
  Object.freeze({
    targetKey: "resolutionReceipts",
    featureSlotId: "resolution-receipts",
    cycleId: dayOneNightOneDayTwo,
    role: "target",
    checkpointId: `${dayOneNightOneDayTwo}-n01-resolved-target-killed`,
    adminCheckId: "resolution-receipts",
  }),
  Object.freeze({
    targetKey: "staleRecovery",
    featureSlotId: "stale-recovery",
    cycleId: dayOneNightOneDayTwo,
    role: "host",
    checkpointId: `${dayOneNightOneDayTwo}-d01-resolved-locked`,
    adminCheckId: "stale-deadline-advance",
  }),
  Object.freeze({
    targetKey: "staleActionConflictMessage",
    featureSlotId: "stale-action-conflict-message",
    cycleId: dayOneNightOneDayTwo,
    role: "actionPlayer",
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    recoveryHookId: "staleActionConflictReject",
    adminCheckId: playerActionLoopLaneId,
  }),
  Object.freeze({
    targetKey: "completedGameRecovery",
    featureSlotId: "completed-game-recovery",
    cycleId: dayTwoNightTwo,
    role: "host",
    checkpointId: `${dayTwoNightTwo}-d02-resolved-target-killed`,
    adminCheckId: "completed-game-hardening-coverage",
  }),
]);

const coreLoopSeedOnlyLaneRows = Object.freeze([
  Object.freeze({
    featureSlotId: "night-action-loop",
    seedMembership: "required",
    seedOrder: 10,
  }),
  Object.freeze({
    featureSlotId: "day-vote-no-lynch",
    seedMembership: "demoOnly",
    seedOrder: 20,
  }),
]);

export const coreLoopFeatureLaneCatalog = Object.freeze([
  ...coreLoopFeatureSpineLaneRows,
  ...coreLoopSeedOnlyLaneRows,
]);

function checkpointRow({
  featureSlotId,
  cycleId,
  role,
  checkpointId,
  adminCheckId,
  recoveryHookId,
}) {
  return Object.freeze({
    featureSlotId,
    sourceCheckId: coreLoopFeatureSpineSourceCheckId,
    cycleId,
    roleUrlId: `${cycleId}-${role}`,
    checkpointId,
    ...(recoveryHookId === undefined ? {} : { recoveryHookId }),
    adminCheckId,
  });
}

export const coreLoopFeatureSpineTargetRows = Object.freeze(
  Object.fromEntries(
    coreLoopFeatureSpineLaneRows.map((lane) => [
      lane.targetKey,
      checkpointRow(lane),
    ]),
  ),
);

export const coreLoopFeatureSpineAdminCheckIds = Object.freeze([
  ...new Set(coreLoopFeatureSpineLaneRows.map((lane) => lane.adminCheckId)),
]);

function featureSlotIdsForSeedMembership(seedMembership) {
  return Object.freeze(
    coreLoopFeatureLaneCatalog
      .filter((lane) => lane.seedMembership === seedMembership)
      .sort((left, right) => (left.seedOrder ?? 0) - (right.seedOrder ?? 0))
      .map((lane) => lane.featureSlotId),
  );
}

export const coreLoopFeatureRequiredSeedScenarioIds =
  featureSlotIdsForSeedMembership("required");

export const coreLoopFeatureDemoOnlySeedScenarioIds =
  featureSlotIdsForSeedMembership("demoOnly");

export const coreLoopFeatureSeedRoleOverrideEntries = Object.freeze(
  coreLoopFeatureLaneCatalog
    .filter((lane) => lane.seedRoleOverride !== undefined)
    .map((lane) =>
      Object.freeze([lane.featureSlotId, lane.seedRoleOverride]),
    ),
);

export const coreLoopFeatureSeedProofLaneAliasEntries = Object.freeze(
  coreLoopFeatureLaneCatalog
    .filter((lane) => lane.proofLaneAliases !== undefined)
    .map((lane) =>
      Object.freeze([lane.featureSlotId, [...lane.proofLaneAliases]]),
    ),
);

export const coreLoopFeatureSeedAliasOnlyProofLaneIds = Object.freeze(
  [
    ...new Set(
      coreLoopFeatureSeedProofLaneAliasEntries.flatMap(([, aliases]) => aliases),
    ),
  ],
);

export const coreLoopFeaturePhaseProgressionLaneIds = Object.freeze([
  ...coreLoopVoteResolutionLaneIds,
  "day-vote-no-lynch",
  playerActionLoopLaneId,
]);

export const coreLoopFeaturePhaseProgressionSpineSourceLaneIds = Object.freeze([
  "core-loop",
  dayThreeVoteResolutionLaneId,
  playerActionLoopLaneId,
  "resolution-receipts",
]);
