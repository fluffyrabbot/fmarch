import {
  playerActionLoopLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  hostNightActionTransitionLaneId,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  postDayThreeTransitionLaneId,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";

export const dayTwoNightTwoCycleId = "d02-n02";
export const dayTwoNightTwoAdminCheckId = "core-loop";
export const dayTwoNightTwoRoleIds = Object.freeze([
  "host",
  "actionPlayer",
  "target",
  "normalPlayer",
]);

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const dayTwoNightTwoCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: postDayThreeTransitionLaneId,
    targetKey: "postDayThreeTransition",
    featureSlotId: postDayThreeTransitionLaneId,
    role: "host",
    checkpointId: "d02-resolved-target-killed",
    adminCheckId: dayTwoNightTwoAdminCheckId,
    statusKind: "day-vote-resolution-to-night",
    expectedCheckpointFields: Object.freeze({
      resolveState: "ack",
      phase: "D02",
      locked: true,
      outcomeStatus: "Lynch",
      winnerSlot: "slot-2",
      targetAlive: false,
      receiptStatus: "day_vote",
    }),
  }),
  Object.freeze({
    id: "player-action-submission",
    targetKey: "playerActionSubmission",
    featureSlotId: "player-action-submission",
    role: "actionPlayer",
    checkpointId: "n02-action-open",
    adminCheckId: playerActionLoopLaneId,
    statusKind: "player-action-open",
    expectedCheckpointFields: Object.freeze({
      advanceState: "ack",
      phase: "N02",
      locked: false,
      actionTemplate: "factional_kill",
      actionButtonVisible: true,
      normalPlayerFactionalKillVisible: false,
    }),
  }),
  Object.freeze({
    id: hostNightActionTransitionLaneId,
    targetKey: "hostNightActionTransition",
    featureSlotId: hostNightActionTransitionLaneId,
    role: "host",
    checkpointId: "n02-action-open",
    adminCheckId: dayTwoNightTwoAdminCheckId,
    statusKind: "host-night-action-transition",
    expectedCheckpointFields: Object.freeze({
      advanceState: "ack",
      phase: "N02",
      locked: false,
      actionTemplate: "factional_kill",
      actionButtonVisible: true,
      normalPlayerFactionalKillVisible: false,
    }),
  }),
]);

export function dayTwoNightTwoCheckpointCases() {
  return dayTwoNightTwoCheckpointCaseDefinitions.map(cloneCase);
}

export function dayTwoNightTwoCheckpointCaseForId(id) {
  const scenario = dayTwoNightTwoCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown day two night two checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function dayTwoNightTwoFeatureSpineRows({
  cycleId = dayTwoNightTwoCycleId,
} = {}) {
  return dayTwoNightTwoCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function dayTwoNightTwoRoleUrlKey(roleId) {
  if (!dayTwoNightTwoRoleIds.includes(roleId)) {
    throw new Error(`unknown day two night two role id: ${roleId}`);
  }
  return `${dayTwoNightTwoCycleId}-${roleId}`;
}

export function dayTwoNightTwoRoleUrlsFrom(roleUrlHrefs) {
  return Object.fromEntries(
    dayTwoNightTwoRoleIds.map((roleId) => [
      roleId,
      roleUrlHrefs?.[dayTwoNightTwoRoleUrlKey(roleId)],
    ]),
  );
}

export function assertDayTwoNightTwoCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== dayTwoNightTwoCycleId) {
    throwDayTwoNightTwoAssertionError({
      message: "day two night two cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of dayTwoNightTwoCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwDayTwoNightTwoAssertionError({
        message: `day two night two missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwDayTwoNightTwoAssertionError({
          message: `day two night two checkpoint ${scenario.checkpointId} expected ${field}`,
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
    adminCheckId: scenario.adminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwDayTwoNightTwoAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
