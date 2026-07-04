export const nightTwoProgressionCycleId = "n02-d03";
export const nightTwoProgressionAdminCheckId = "core-loop";

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const nightTwoProgressionCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "night-two-action-resolution",
    targetKey: "nightTwoActionResolution",
    featureSlotId: "night-two-action-resolution",
    role: "host",
    checkpointId: "n02-resolved-target-killed",
    statusKind: "night-action-resolution",
    expectedCheckpointFields: Object.freeze({
      resolveState: "ack",
      phase: "N02",
      locked: true,
      targetSlot: "slot-3",
      targetAlive: false,
      targetStatus: "dead",
    }),
  }),
  Object.freeze({
    id: "day-three-controls-return",
    targetKey: "dayThreeControlsReturn",
    featureSlotId: "day-three-controls-return",
    role: "actionPlayer",
    checkpointId: "d03-day-controls-return",
    statusKind: "day-controls-return",
    expectedCheckpointFields: Object.freeze({
      advanceState: "ack",
      phase: "D03",
      locked: false,
      actionSubmitControls: 0,
      actionVoteControls: 2,
      normalVoteControls: 2,
    }),
  }),
]);

export function nightTwoProgressionCheckpointCases() {
  return nightTwoProgressionCheckpointCaseDefinitions.map(cloneCase);
}

export function nightTwoProgressionCheckpointCaseForId(id) {
  const scenario = nightTwoProgressionCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown night two progression checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function nightTwoProgressionFeatureSpineRows({
  cycleId = nightTwoProgressionCycleId,
} = {}) {
  return nightTwoProgressionCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function nightTwoProgressionCompactStatus(cycle, { actionPhase } = {}) {
  const actionOpen = checkpointById(cycle, "n02-action-open");
  const action = checkpointById(cycle, "n02-action-submitted");
  const dayReturn = checkpointById(
    cycle,
    nightTwoProgressionCheckpointCaseForId("day-three-controls-return")
      .checkpointId,
  );
  return `${String(actionOpen?.phase ?? actionPhase ?? "unknown")} action ${String(action?.actionState ?? "unknown")}, next ${String(dayReturn?.phase ?? "unknown")}`;
}

export function assertNightTwoProgressionCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== nightTwoProgressionCycleId) {
    throwNightTwoProgressionAssertionError({
      message: "night two progression cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of nightTwoProgressionCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwNightTwoProgressionAssertionError({
        message: `night two progression missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwNightTwoProgressionAssertionError({
          message: `night two progression checkpoint ${scenario.checkpointId} expected ${field}`,
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
    adminCheckId: nightTwoProgressionAdminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwNightTwoProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
