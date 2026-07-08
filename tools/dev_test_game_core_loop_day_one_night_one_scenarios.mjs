import {
  playerActionBoundaryLaneId,
  playerActionBoundaryRecoveryHookId,
  playerActionLoopLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopPrivateChannelPostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  staleActionConflictMessageLaneId,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  staleActionConflictLaneId,
} from "./dev_test_game_player_recovery_scenarios.mjs";

export const dayOneNightOneDayTwoCycleId = "d01-n01-d02";
export const dayOneNightOneDayTwoRoleIds = Object.freeze([
  "host",
  "actionPlayer",
  "target",
  "normalPlayer",
  "privateChannel",
]);
export const staleLockedVoteRecoveryHookId = "staleLockedVoteReject";
export const staleActionConflictRecoveryHookId = "staleActionConflictReject";

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
  ...(scenario.expectedRoleUrlIncludes === undefined
    ? {}
    : { expectedRoleUrlIncludes: [...scenario.expectedRoleUrlIncludes] }),
  ...(scenario.proofLaneAliases === undefined
    ? {}
    : { proofLaneAliases: [...scenario.proofLaneAliases] }),
});

const cloneFeatureRow = (row) => ({
  ...row,
  ...(row.proofLaneAliases === undefined
    ? {}
    : { proofLaneAliases: [...row.proofLaneAliases] }),
});

const dayOneNightOneCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "night-action-loop",
    targetKey: "nightActionLoop",
    featureSlotId: "night-action-loop",
    role: "actionPlayer",
    checkpointId: "n01-action-open",
    adminCheckId: playerActionLoopLaneId,
    proofLaneAliases: Object.freeze([
      playerActionLoopLaneId,
      staleActionConflictLaneId,
    ]),
    expectedCheckpointFields: Object.freeze({
      phase: "N01",
      locked: false,
      advanceState: "ack",
      actionTemplate: "factional_kill",
      actionButtonVisible: true,
    }),
  }),
  Object.freeze({
    id: playerActionBoundaryLaneId,
    targetKey: "playerActionBoundary",
    featureSlotId: playerActionBoundaryLaneId,
    role: "normalPlayer",
    checkpointId: "n01-action-open",
    recoveryHookId: playerActionBoundaryRecoveryHookId,
    expectedRecoveryHookValue: "InvalidTarget",
    adminCheckId: playerActionBoundaryLaneId,
    expectedCheckpointFields: Object.freeze({
      phase: "N01",
      locked: false,
      normalPlayerActionCount: 0,
      normalPlayerDirectReject: "InvalidTarget",
    }),
  }),
  Object.freeze({
    id: coreLoopPrivateChannelPostLaneId,
    targetKey: "privateChannel",
    featureSlotId: coreLoopPrivateChannelPostLaneId,
    role: "privateChannel",
    checkpointId: "n01-action-open",
    adminCheckId: coreLoopPrivateChannelPostLaneId,
    expectedRoleUrlIncludes: Object.freeze(["/c/", "private%3Amafia_day_chat"]),
    expectedCheckpointFields: Object.freeze({
      phase: "N01",
      locked: false,
      actionTemplate: "factional_kill",
      actionButtonVisible: true,
    }),
  }),
  Object.freeze({
    id: "resolution-receipts",
    targetKey: "resolutionReceipts",
    featureSlotId: "resolution-receipts",
    role: "target",
    checkpointId: "n01-resolved-target-killed",
    adminCheckId: "resolution-receipts",
    expectedCheckpointFields: Object.freeze({
      resolveState: "ack",
      targetSlot: "slot-2",
      targetAlive: false,
      targetStatus: "dead",
      receiptStatus: "factional_kill",
      receiptEffect: "player_killed",
    }),
  }),
  Object.freeze({
    id: "stale-recovery",
    targetKey: "staleRecovery",
    featureSlotId: "stale-recovery",
    role: "host",
    checkpointId: "d01-resolved-locked",
    recoveryHookId: staleLockedVoteRecoveryHookId,
    expectedRecoveryHookValue: "PhaseLocked",
    adminCheckId: "stale-deadline-advance",
    expectedCheckpointFields: Object.freeze({
      phase: "D01",
      locked: true,
      resolveState: "ack",
      submitActionControls: 0,
      submitVoteControls: 0,
    }),
  }),
  Object.freeze({
    id: staleActionConflictMessageLaneId,
    targetKey: "staleActionConflictMessage",
    featureSlotId: staleActionConflictMessageLaneId,
    role: "actionPlayer",
    checkpointId: "n01-action-open",
    recoveryHookId: staleActionConflictRecoveryHookId,
    expectedRecoveryHookValue: "PhaseLocked",
    adminCheckId: playerActionLoopLaneId,
    expectedCheckpointFields: Object.freeze({
      phase: "N01",
      locked: false,
      actionTemplate: "factional_kill",
      actionButtonVisible: true,
    }),
  }),
  Object.freeze({
    id: "day-two-controls-return",
    targetKey: "dayTwoControlsReturn",
    featureSlotId: "day-two-controls-return",
    role: "actionPlayer",
    checkpointId: "d02-day-controls-return",
    adminCheckId: "core-loop",
    expectedCheckpointFields: Object.freeze({
      phase: "D02",
      locked: false,
      advanceState: "ack",
      actionSubmitControls: 0,
      actionVoteControls: 3,
      normalVoteControls: 3,
    }),
  }),
]);

export function dayOneNightOneCheckpointCases() {
  return dayOneNightOneCheckpointCaseDefinitions.map(cloneCase);
}

export function dayOneNightOneCheckpointCaseForId(id) {
  const scenario = dayOneNightOneCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown day one night one checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function dayOneNightOneFeatureSpineRows({
  cycleId = dayOneNightOneDayTwoCycleId,
} = {}) {
  return dayOneNightOneCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function dayOneNightOneDayTwoRoleUrlKey(roleId) {
  if (!dayOneNightOneDayTwoRoleIds.includes(roleId)) {
    throw new Error(`unknown day one night one role id: ${roleId}`);
  }
  return `${dayOneNightOneDayTwoCycleId}-${roleId}`;
}

export function dayOneNightOneDayTwoRoleUrlsFrom(roleUrlHrefs) {
  return Object.fromEntries(
    dayOneNightOneDayTwoRoleIds.map((roleId) => [
      roleId,
      roleUrlHrefs?.[dayOneNightOneDayTwoRoleUrlKey(roleId)],
    ]),
  );
}

export function assertDayOneNightOneCheckpointEvidence({
  cycle,
  recoveryHooks,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== dayOneNightOneDayTwoCycleId) {
    throwDayOneNightOneAssertionError({
      message: "day one night one cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of dayOneNightOneCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwDayOneNightOneAssertionError({
        message: `day one night one missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    if (
      scenario.recoveryHookId !== undefined &&
      recoveryHooks?.[scenario.recoveryHookId] !==
        scenario.expectedRecoveryHookValue
    ) {
      throwDayOneNightOneAssertionError({
        message: `day one night one recovery hook mismatch ${scenario.recoveryHookId}`,
        evidence: recoveryHooks,
        includeEvidenceInError,
      });
    }
    if (
      Array.isArray(scenario.expectedRoleUrlIncludes) &&
      !scenario.expectedRoleUrlIncludes.every((fragment) =>
        String(cycle?.roleUrls?.[scenario.role] ?? "").includes(fragment),
      )
    ) {
      throwDayOneNightOneAssertionError({
        message: `day one night one role URL mismatch ${scenario.role}`,
        evidence: cycle?.roleUrls,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwDayOneNightOneAssertionError({
          message: `day one night one checkpoint ${scenario.checkpointId} expected ${field}`,
          evidence: checkpoint,
          includeEvidenceInError,
        });
      }
    }
  }
}

function featureRowFromCase(scenario, { cycleId }) {
  return Object.freeze({
    targetKey: scenario.targetKey,
    featureSlotId: scenario.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    ...(scenario.recoveryHookId === undefined
      ? {}
      : { recoveryHookId: scenario.recoveryHookId }),
    adminCheckId: scenario.adminCheckId,
    ...(scenario.proofLaneAliases === undefined
      ? {}
      : { proofLaneAliases: Object.freeze([...scenario.proofLaneAliases]) }),
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwDayOneNightOneAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
