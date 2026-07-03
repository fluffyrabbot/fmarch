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
  dayThreeVoteResolutionLaneId,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";

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
});

const dayTwoNightTwo = coreLoopFeatureSpineCycleIds.dayTwoNightTwo;
const dayOneNightOneDayTwo =
  coreLoopFeatureSpineCycleIds.dayOneNightOneDayTwo;

const checkpointRow = ({
  featureSlotId,
  cycleId,
  roleUrlId,
  checkpointId,
  adminCheckId,
}) =>
  Object.freeze({
    featureSlotId,
    sourceCheckId: coreLoopFeatureSpineSourceCheckId,
    cycleId,
    roleUrlId,
    checkpointId,
    adminCheckId,
  });

const recoveryHookRow = ({ recoveryHookId, ...row }) =>
  Object.freeze({
    ...checkpointRow(row),
    recoveryHookId,
  });

export const coreLoopFeatureSpineTargetRows = Object.freeze({
  hostPhaseControl: checkpointRow({
    featureSlotId: "host-phase-control",
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-host`,
    checkpointId: `${dayTwoNightTwo}-d02-vote-open`,
    adminCheckId: "host-lifecycle-control",
  }),
  dayVoteResolution: checkpointRow({
    featureSlotId: dayThreeVoteResolutionLaneId,
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-actionPlayer`,
    checkpointId: `${dayTwoNightTwo}-d02-deciding-vote-submitted`,
    adminCheckId: dayThreeVoteResolutionLaneId,
  }),
  postDayThreeTransition: checkpointRow({
    featureSlotId: postDayThreeTransitionLaneId,
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-host`,
    checkpointId: `${dayTwoNightTwo}-d02-resolved-target-killed`,
    adminCheckId: "core-loop",
  }),
  playerActionSubmission: checkpointRow({
    featureSlotId: "player-action-submission",
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-actionPlayer`,
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    adminCheckId: playerActionLoopLaneId,
  }),
  hostNightActionTransition: checkpointRow({
    featureSlotId: hostNightActionTransitionLaneId,
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-host`,
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    adminCheckId: "core-loop",
  }),
  invalidActionRecovery: recoveryHookRow({
    featureSlotId: playerInvalidActionRecoveryLaneId,
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-actionPlayer`,
    checkpointId: `${dayTwoNightTwo}-n02-action-open`,
    recoveryHookId: playerInvalidActionRecoveryHookId,
    adminCheckId: playerInvalidActionRecoveryLaneId,
  }),
  playerActionBoundary: recoveryHookRow({
    featureSlotId: playerActionBoundaryLaneId,
    cycleId: dayOneNightOneDayTwo,
    roleUrlId: `${dayOneNightOneDayTwo}-normalPlayer`,
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    recoveryHookId: playerActionBoundaryRecoveryHookId,
    adminCheckId: playerActionBoundaryLaneId,
  }),
  privateChannel: checkpointRow({
    featureSlotId: coreLoopPrivateChannelPostLaneId,
    cycleId: dayOneNightOneDayTwo,
    roleUrlId: `${dayOneNightOneDayTwo}-privateChannel`,
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    adminCheckId: coreLoopPrivateChannelPostLaneId,
  }),
  resolutionReceipts: checkpointRow({
    featureSlotId: "resolution-receipts",
    cycleId: dayOneNightOneDayTwo,
    roleUrlId: `${dayOneNightOneDayTwo}-target`,
    checkpointId: `${dayOneNightOneDayTwo}-n01-resolved-target-killed`,
    adminCheckId: "resolution-receipts",
  }),
  staleRecovery: checkpointRow({
    featureSlotId: "stale-recovery",
    cycleId: dayOneNightOneDayTwo,
    roleUrlId: `${dayOneNightOneDayTwo}-host`,
    checkpointId: `${dayOneNightOneDayTwo}-d01-resolved-locked`,
    adminCheckId: "stale-deadline-advance",
  }),
  staleActionConflictMessage: recoveryHookRow({
    featureSlotId: "stale-action-conflict-message",
    cycleId: dayOneNightOneDayTwo,
    roleUrlId: `${dayOneNightOneDayTwo}-actionPlayer`,
    checkpointId: `${dayOneNightOneDayTwo}-n01-action-open`,
    recoveryHookId: "staleActionConflictReject",
    adminCheckId: playerActionLoopLaneId,
  }),
  completedGameRecovery: checkpointRow({
    featureSlotId: "completed-game-recovery",
    cycleId: dayTwoNightTwo,
    roleUrlId: `${dayTwoNightTwo}-host`,
    checkpointId: `${dayTwoNightTwo}-d02-resolved-target-killed`,
    adminCheckId: "completed-game-hardening-coverage",
  }),
});
