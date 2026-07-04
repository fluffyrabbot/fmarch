export const terminalRecoveryCycleId = "n02-d03";
export const terminalRecoveryAdminCheckId = "core-loop";
export const terminalAdvanceRejectRecoveryHookId = "d03TerminalAdvanceReject";

const cloneCase = (scenario) => ({
  ...scenario,
  expectedCheckpointFields: { ...scenario.expectedCheckpointFields },
});

const cloneFeatureRow = (row) => ({ ...row });

const terminalRecoveryCheckpointCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "day-three-terminal-boundary",
    targetKey: "dayThreeTerminalBoundary",
    featureSlotId: "day-three-terminal-boundary",
    role: "host",
    checkpointId: "d03-terminal-advance-reject",
    recoveryHookId: terminalAdvanceRejectRecoveryHookId,
    statusKind: "terminal-boundary",
    expectedCheckpointFields: Object.freeze({
      voteState: "ack",
      resolveState: "ack",
      outcomeStatus: "NoMajority",
      winnerSlot: null,
      targetAlive: true,
      targetStatus: "alive",
      advanceState: "reject",
      rejectError: "InvalidTarget",
      phase: "D03",
      locked: true,
      advanceControlVisible: true,
    }),
  }),
  Object.freeze({
    id: "day-three-terminal-recovery",
    targetKey: "dayThreeTerminalRecovery",
    featureSlotId: "day-three-terminal-recovery",
    role: "host",
    checkpointId: "d03-terminal-reload-recovery",
    recoveryHookId: terminalAdvanceRejectRecoveryHookId,
    statusKind: "terminal-recovery",
    expectedCheckpointFields: Object.freeze({
      routeResponseStatus: 200,
      phase: "D03",
      locked: true,
      outcomeStatus: "NoMajority",
      projectedCount: 1,
      advanceControlVisible: true,
      unlockControlVisible: true,
    }),
  }),
  Object.freeze({
    id: "day-three-stale-continue-policy-recovery",
    targetKey: "dayThreeStaleContinuePolicyRecovery",
    featureSlotId: "day-three-stale-continue-policy-recovery",
    role: "host",
    checkpointId: "d03r2-stale-continue-policy-recovery",
    statusKind: "stale-continue-policy-recovery",
    expectedCheckpointFields: Object.freeze({
      promptId: "D03R2:revote:NoMajority",
      setupPromptStatus: "pending",
      setupActionVisible: true,
      rejectState: "reject",
      rejectError: "PromptAlreadyResolved",
      promptStatusAfterReject: "resolved",
      promptActionVisibleAfterReject: false,
      reloadStatus: "passed",
      reloadPhase: "N03",
      reloadLocked: false,
      reloadResolveControlVisible: true,
      reloadStaleActionVisible: false,
      apiPromptStatusAfterReload: "resolved",
    }),
  }),
]);

export function terminalRecoveryCheckpointCases() {
  return terminalRecoveryCheckpointCaseDefinitions.map(cloneCase);
}

export function terminalRecoveryCheckpointCaseForId(id) {
  const scenario = terminalRecoveryCheckpointCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown terminal recovery checkpoint case: ${id}`);
  }
  return cloneCase(scenario);
}

export function terminalRecoveryFeatureSpineRows({
  cycleId = terminalRecoveryCycleId,
} = {}) {
  return terminalRecoveryCheckpointCaseDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCase(scenario, { cycleId })),
  );
}

export function terminalRecoveryCompactStatus(cycle) {
  const terminal = checkpointById(
    cycle,
    terminalRecoveryCheckpointCaseForId("day-three-terminal-boundary")
      .checkpointId,
  );
  const terminalReload = checkpointById(
    cycle,
    terminalRecoveryCheckpointCaseForId("day-three-terminal-recovery")
      .checkpointId,
  );
  return `terminal advance ${String(terminal?.rejectError ?? "unknown")}, reload ${String(terminalReload?.phase ?? "unknown")}`;
}

export function assertTerminalRecoveryCheckpointEvidence({
  cycle,
  recoveryHooks,
  includeEvidenceInError = false,
}) {
  if (cycle?.id !== terminalRecoveryCycleId) {
    throwTerminalRecoveryAssertionError({
      message: "terminal recovery cycle id mismatch",
      evidence: cycle,
      includeEvidenceInError,
    });
  }
  if (recoveryHooks?.[terminalAdvanceRejectRecoveryHookId] !== "InvalidTarget") {
    throwTerminalRecoveryAssertionError({
      message: "terminal recovery hook mismatch",
      evidence: recoveryHooks,
      includeEvidenceInError,
    });
  }
  for (const scenario of terminalRecoveryCheckpointCaseDefinitions) {
    const checkpoint = checkpointById(cycle, scenario.checkpointId);
    if (checkpoint === null) {
      throwTerminalRecoveryAssertionError({
        message: `terminal recovery missing checkpoint ${scenario.checkpointId}`,
        evidence: cycle,
        includeEvidenceInError,
      });
    }
    for (const [field, expectedValue] of Object.entries(
      scenario.expectedCheckpointFields,
    )) {
      if (checkpoint[field] !== expectedValue) {
        throwTerminalRecoveryAssertionError({
          message: `terminal recovery checkpoint ${scenario.checkpointId} expected ${field}`,
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
    adminCheckId: terminalRecoveryAdminCheckId,
  });
}

function checkpointById(cycle, id) {
  return cycle?.checkpoints?.find((checkpoint) => checkpoint.id === id) ?? null;
}

function throwTerminalRecoveryAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}
