import {
  playerActionLoopLaneId,
  playerActionBoundaryLaneId,
  playerActionBoundaryRecoveryHookId,
  playerInvalidActionRecoveryHookId,
  playerInvalidActionRecoveryLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopPrivateChannelPostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  coreLoopVoteResolutionLaneIds,
  dayThreeVoteResolutionLaneId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  dayVoteNoLynchFeatureSpineRow,
  dayVoteNoLynchLaneId,
  revoteProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_revote_progression_scenarios.mjs";
import {
  terminalRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_terminal_recovery_scenarios.mjs";
import {
  nightTwoProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_night_two_progression_scenarios.mjs";
import {
  dayTwoNightTwoFeatureSpineRows,
} from "./dev_test_game_core_loop_day_two_night_two_scenarios.mjs";

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
const dayTwoNightTwoSpineRows = dayTwoNightTwoFeatureSpineRows({
  cycleId: dayTwoNightTwo,
});

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
  Object.freeze(dayVoteNoLynchFeatureSpineRow({ cycleId: nightTwoDayThree })),
  Object.freeze(dayTwoNightTwoSpineRows[0]),
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
  ...dayTwoNightTwoSpineRows.slice(1),
  ...nightTwoProgressionFeatureSpineRows({ cycleId: nightTwoDayThree }),
  ...terminalRecoveryFeatureSpineRows({ cycleId: nightTwoDayThree }),
  ...revoteProgressionFeatureSpineRows({ cycleId: nightTwoDayThree }),
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
  dayVoteNoLynchLaneId,
  playerActionLoopLaneId,
]);

export const coreLoopFeaturePhaseProgressionSpineSourceLaneIds = Object.freeze([
  "core-loop",
  dayThreeVoteResolutionLaneId,
  playerActionLoopLaneId,
  "resolution-receipts",
]);
