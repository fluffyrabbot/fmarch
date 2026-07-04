export const revoteProgressionCycleId = "d03-n03";
export const revoteProgressionAdminCheckId = "core-loop";
export const dayVoteNoLynchLaneId = "day-vote-no-lynch";

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const revoteProgressionCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "day-three-no-majority-revote",
    targetKey: "dayThreeNoMajorityRevote",
    featureSlotId: "day-three-no-majority-revote",
    role: "host",
    checkpointId: "d03-revote-prompt-resolved",
    statusKind: "first-revote",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      decisionPolicy: "no_majority_continue_revote",
      resolveState: "ack",
      promptStatusAfter: "resolved",
    }),
  }),
  Object.freeze({
    id: "day-three-revote-ballot",
    targetKey: "dayThreeRevoteBallot",
    featureSlotId: "day-three-revote-ballot",
    role: "actionPlayer",
    checkpointId: "d03r1-revote-ballot-submitted",
    statusKind: "first-ballot",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      voteState: "ack",
      voteTarget: "NoLynch",
      currentVoteKind: "no_lynch",
    }),
  }),
  Object.freeze({
    id: "day-three-revote-resolution",
    targetKey: "dayThreeRevoteResolution",
    featureSlotId: "day-three-revote-resolution",
    role: "host",
    checkpointId: "d03r1-revote-resolved-no-majority",
    statusKind: "first-resolution",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R1",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      promptStatusAfter: "pending",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote",
    targetKey: "dayThreeSecondRevote",
    featureSlotId: "day-three-second-revote",
    role: "host",
    checkpointId: "d03r2-revote-prompt-resolved",
    statusKind: "second-revote",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      decisionPolicy: "no_majority_continue_revote",
      resolveState: "ack",
      promptStatusAfter: "resolved",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote-ballot",
    targetKey: "dayThreeSecondRevoteBallot",
    featureSlotId: "day-three-second-revote-ballot",
    role: "actionPlayer",
    checkpointId: "d03r2-revote-ballot-submitted",
    statusKind: "second-ballot",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      voteState: "ack",
      voteTarget: "NoLynch",
      currentVoteKind: "no_lynch",
    }),
  }),
  Object.freeze({
    id: "day-three-second-revote-resolution",
    targetKey: "dayThreeSecondRevoteResolution",
    featureSlotId: "day-three-second-revote-resolution",
    role: "host",
    checkpointId: "d03r2-revote-resolved-no-majority",
    statusKind: "second-resolution",
    expectedCheckpointFields: Object.freeze({
      phase: "D03R2",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      decisionPolicy: "no_majority_no_lynch",
      nextPhase: "N03",
    }),
  }),
]);

const dayVoteNoLynchFeatureRowDefinition = Object.freeze({
  targetKey: "dayVoteNoLynch",
  featureSlotId: dayVoteNoLynchLaneId,
  caseId: "day-three-revote-ballot",
  seedMembership: "demoOnly",
  seedOrder: 20,
});

export function revoteProgressionCheckpointCases() {
  return revoteProgressionCheckpointCaseDefinitions.map(cloneCase);
}

export function revoteProgressionCheckpointCaseForId(id) {
  const scenario = revoteProgressionCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown revote progression checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function dayVoteNoLynchFeatureSpineRow({
  cycleId = revoteProgressionCycleId,
} = {}) {
  const row = featureRowFromDefinition(dayVoteNoLynchFeatureRowDefinition, {
    cycleId,
  });
  return cloneFeatureRow(row);
}

export function revoteProgressionFeatureSpineRows({
  cycleId = revoteProgressionCycleId,
} = {}) {
  return revoteProgressionCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(
      featureRowFromDefinition(
        {
          targetKey: scenario.targetKey,
          featureSlotId: scenario.featureSlotId,
          caseId: scenario.id,
        },
        { cycleId },
      ),
    ),
  );
}

export function revoteProgressionCompactStatus(cycle) {
  const checkpoint = (caseId) =>
    checkpointById(
      cycle,
      revoteProgressionCheckpointCaseForId(caseId).checkpointId,
    );
  const revote = checkpoint("day-three-no-majority-revote");
  const revoteBallot = checkpoint("day-three-revote-ballot");
  const revoteResolution = checkpoint("day-three-revote-resolution");
  const secondRevote = checkpoint("day-three-second-revote");
  const secondRevoteBallot = checkpoint("day-three-second-revote-ballot");
  const secondRevoteResolution = checkpoint(
    "day-three-second-revote-resolution",
  );
  return `revote ${String(revote?.phase ?? "unknown")} via ${String(revote?.decisionPolicy ?? "unknown")}, revote vote ${String(revoteBallot?.voteState ?? "unknown")}, revote resolve ${String(revoteResolution?.resolveState ?? "unknown")}, second revote ${String(secondRevote?.phase ?? "unknown")} via ${String(secondRevote?.decisionPolicy ?? "unknown")}, second vote ${String(secondRevoteBallot?.voteState ?? "unknown")}, second resolve ${String(secondRevoteResolution?.resolveState ?? "unknown")}, policy ${String(secondRevoteResolution?.decisionPolicy ?? "unknown")} -> ${String(secondRevoteResolution?.nextPhase ?? "unknown")}`;
}

export function assertRevoteProgressionCheckpointEvidence({
  cycle,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== revoteProgressionCycleId) {
    throwRevoteProgressionAssertionError({
      message: "revote progression cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  for (const scenario of revoteProgressionCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwRevoteProgressionAssertionError({
        message: `revote progression missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwRevoteProgressionAssertionError({
          message: `revote progression checkpoint ${scenario.checkpointId} expected ${field}`,
          evidence: checkpoint,
          includeEvidenceInError,
        });
      }
    }
  }
}

function featureRowFromDefinition(definition, { cycleId }) {
  const scenario = revoteProgressionCheckpointCaseForId(definition.caseId);
  return Object.freeze({
    targetKey: definition.targetKey,
    featureSlotId: definition.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: revoteProgressionAdminCheckId,
    ...(definition.seedMembership === undefined
      ? {}
      : { seedMembership: definition.seedMembership }),
    ...(definition.seedOrder === undefined ? {} : { seedOrder: definition.seedOrder }),
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwRevoteProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
