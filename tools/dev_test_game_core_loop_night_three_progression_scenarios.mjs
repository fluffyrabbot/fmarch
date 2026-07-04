export const nightThreeDayFourCycleId = "n03-d04";
export const nightThreeActionResolutionLaneId =
  "night-three-action-resolution";
export const dayFourControlsReturnLaneId = "day-four-controls-return";
export const nightThreeProgressionAdminCheckId = "core-loop";

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const nightThreeProgressionCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: nightThreeActionResolutionLaneId,
    targetKey: "nightThreeActionResolution",
    featureSlotId: nightThreeActionResolutionLaneId,
    seedMembership: "required",
    seedOrder: 30,
    role: "host",
    checkpointId: "n03-resolved-target-killed",
    statusKind: "night-action-resolution",
    expectedCheckpointFields: Object.freeze({
      resolveState: "ack",
      phase: "N03",
      locked: true,
      targetSlot: "slot-7",
      targetAlive: false,
      targetStatus: "dead",
    }),
  }),
  Object.freeze({
    id: dayFourControlsReturnLaneId,
    targetKey: "dayFourControlsReturn",
    featureSlotId: dayFourControlsReturnLaneId,
    role: "actionPlayer",
    checkpointId: "d04-day-controls-return",
    statusKind: "day-controls-return",
    expectedCheckpointFields: Object.freeze({
      advanceState: "ack",
      phase: "D04",
      locked: false,
      actionSubmitControls: 0,
      targetAlive: false,
      targetVoteControls: 0,
    }),
  }),
]);

export function nightThreeProgressionCheckpointCases() {
  return nightThreeProgressionCheckpointCaseDefinitions.map(cloneCase);
}

export function nightThreeProgressionCheckpointCaseForId(id) {
  const scenario = nightThreeProgressionCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown night three progression checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function nightThreeProgressionFeatureSpineRows({
  cycleId = nightThreeDayFourCycleId,
} = {}) {
  return nightThreeProgressionCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function nightThreeProgressionCompactStatus(cycle, { actionPhase } = {}) {
  const actionOpen = checkpointById(cycle, "n03-action-open");
  const action = checkpointById(cycle, "n03-action-submitted");
  const dayReturn = checkpointById(
    cycle,
    nightThreeProgressionCheckpointCaseForId(dayFourControlsReturnLaneId)
      .checkpointId,
  );
  return `${String(actionOpen?.phase ?? actionPhase ?? "unknown")} action ${String(action?.actionState ?? "unknown")}, next ${String(dayReturn?.phase ?? "unknown")}`;
}

export function assertNightThreeProgressionCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== nightThreeDayFourCycleId) {
    throwNightThreeProgressionAssertionError({
      message: "night three progression cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of nightThreeProgressionCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwNightThreeProgressionAssertionError({
        message: `night three progression missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwNightThreeProgressionAssertionError({
          message: `night three progression checkpoint ${scenario.checkpointId} expected ${field}`,
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
    ...(scenario.seedMembership === undefined
      ? {}
      : { seedMembership: scenario.seedMembership }),
    ...(scenario.seedOrder === undefined ? {} : { seedOrder: scenario.seedOrder }),
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: nightThreeProgressionAdminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwNightThreeProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
