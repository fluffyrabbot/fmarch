import {
  invalidActionRecoveryFeatureSpineRow,
  playerActionLoopLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopVoteResolutionLaneIds,
  dayVoteResolutionFeatureSpineRow,
  dayThreeVoteResolutionLaneId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  hostPhaseControlFeatureSpineRow,
} from "./dev_test_game_core_loop_host_control_scenarios.mjs";
import {
  completedGameRecoveryFeatureSpineRow,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";
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
import {
  dayOneNightOneFeatureSpineRows,
} from "./dev_test_game_core_loop_day_one_night_one_scenarios.mjs";

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
  dayThreeNightThree: "d03-n03",
});

const dayTwoNightTwo = coreLoopFeatureSpineCycleIds.dayTwoNightTwo;
const dayOneNightOneDayTwo =
  coreLoopFeatureSpineCycleIds.dayOneNightOneDayTwo;
const nightTwoDayThree = coreLoopFeatureSpineCycleIds.nightTwoDayThree;
const dayThreeNightThree = coreLoopFeatureSpineCycleIds.dayThreeNightThree;
const dayTwoNightTwoSpineRows = dayTwoNightTwoFeatureSpineRows({
  cycleId: dayTwoNightTwo,
});
const dayOneNightOneSpineRows = dayOneNightOneFeatureSpineRows({
  cycleId: dayOneNightOneDayTwo,
});

const coreLoopFeatureSpineLaneRows = Object.freeze([
  Object.freeze(hostPhaseControlFeatureSpineRow({ cycleId: dayTwoNightTwo })),
  Object.freeze(dayVoteResolutionFeatureSpineRow({ cycleId: dayTwoNightTwo })),
  Object.freeze(dayVoteNoLynchFeatureSpineRow({ cycleId: dayThreeNightThree })),
  Object.freeze(dayTwoNightTwoSpineRows[0]),
  Object.freeze(dayOneNightOneSpineRows[0]),
  ...dayTwoNightTwoSpineRows.slice(1),
  ...nightTwoProgressionFeatureSpineRows({ cycleId: nightTwoDayThree }),
  ...terminalRecoveryFeatureSpineRows({ cycleId: dayThreeNightThree }),
  ...revoteProgressionFeatureSpineRows({ cycleId: dayThreeNightThree }),
  Object.freeze(
    invalidActionRecoveryFeatureSpineRow({ cycleId: dayTwoNightTwo }),
  ),
  ...dayOneNightOneSpineRows.slice(1),
  Object.freeze(
    completedGameRecoveryFeatureSpineRow({ cycleId: dayTwoNightTwo }),
  ),
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
