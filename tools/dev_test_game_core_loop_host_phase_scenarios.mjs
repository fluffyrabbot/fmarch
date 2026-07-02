const cloneCommandFacts = (facts) => ({ ...facts });

const hostPhaseCommandFactDefinitions = Object.freeze({
  resolve: Object.freeze({
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
  }),
  advance: Object.freeze({
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
  }),
  lock: Object.freeze({
    actionId: "lock_thread",
    commandKind: "LockThread",
  }),
  unlock: Object.freeze({
    actionId: "unlock_thread",
    commandKind: "UnlockThread",
  }),
  complete: Object.freeze({
    actionId: "complete_game",
    commandKind: "CompleteGame",
  }),
  extendDeadline: Object.freeze({
    actionId: "extend_deadline",
    commandKind: "ExtendDeadline",
  }),
  advanceByDeadline: Object.freeze({
    actionId: "advance_phase_by_deadline",
    commandKind: "AdvancePhaseByDeadline",
  }),
});

export function hostResolvePhaseCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.resolve);
}

export function hostAdvancePhaseCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.advance);
}

export function hostLockThreadCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.lock);
}

export function hostUnlockThreadCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.unlock);
}

export function hostCompleteGameCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.complete);
}

export function hostExtendDeadlineCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.extendDeadline);
}

export function hostAdvanceByDeadlineCommandFacts() {
  return cloneCommandFacts(hostPhaseCommandFactDefinitions.advanceByDeadline);
}

export function assertHostPhaseTransitionActionProofCase({
  proof,
  expectedGame,
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  expectedDeadlineAffordance,
  expectedRefreshKeys,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedAction !== actionId ||
    proof.commandKind !== commandKind ||
    proof.command?.game !== expectedGame ||
    (commandKind === "ResolvePhase" && proof.command.seed !== 918273) ||
    proof.commandStatus?.state !== "ack" ||
    !proof.commandStatus?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.commandOutcome?.state !== "ack" ||
    !proof.commandOutcome?.message?.includes(`Ack: stream seqs ${streamSeq}`) ||
    proof.bridgePlan?.role !== "moderator" ||
    proof.bridgePlan.commandKind !== commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "ack" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, expectedRefreshKeys) ||
    proof.projection?.phase?.id !== expectedPhaseId ||
    proof.projection?.phase?.state !== expectedPhaseState ||
    proof.projection?.phase?.locked !== (expectedPhaseState === "locked") ||
    proof.checkpointPhaseId !== expectedPhaseId ||
    proof.checkpointPhaseState !== expectedPhaseState ||
    proof.checkpointDeadlineAffordance !== expectedDeadlineAffordance ||
    !String(proof.activityStatusText ?? "")
      .toLowerCase()
      .includes(`ack: stream seqs ${streamSeq}`)
  ) {
    throwHostPhaseScenarioAssertionError({
      message: `core-loop admin proof missing host ${actionId} transition ACK`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertHostStaleAdvanceAfterTransitionProofCase({
  proof,
  expectedGame,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    typeof proof.sourceRoleUrl !== "string" ||
    !proof.sourceRoleUrl.endsWith("/host") ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.setupResyncFromSeq !== 801 ||
    proof.setupSnapshotHost?.phase?.id !== "D02" ||
    proof.setupSnapshotHost?.phase?.state !== "locked" ||
    proof.clickedAction !== "advance_phase" ||
    proof.commandKind !== "AdvancePhase" ||
    proof.command?.game !== expectedGame ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "InvalidTarget" ||
    !String(proof.commandStatus.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    proof.commandOutcome?.state !== "reject" ||
    proof.commandOutcome.error !== "InvalidTarget" ||
    !String(proof.commandOutcome.message ?? "").includes(
      "stale phase state, refresh and use current controls",
    ) ||
    proof.bridgePlan?.role !== "moderator" ||
    proof.bridgePlan.commandKind !== "AdvancePhase" ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(proof.bridgePlan.projectionRefreshKeys, ["host"]) ||
    proof.projection?.phase?.id !== "N02" ||
    proof.projection?.phase?.state !== "open" ||
    proof.projection?.phase?.locked !== false ||
    proof.checkpointPhaseIdAfterReject !== "N02" ||
    proof.checkpointPhaseStateAfterReject !== "open" ||
    proof.checkpointDeadlineAffordanceAfterReject !==
      "resolve_phase,lock_thread" ||
    !String(proof.activityStatusText ?? "")
      .toLowerCase()
      .includes("reject invalidtarget: invalid target")
  ) {
    throwHostPhaseScenarioAssertionError({
      message:
        "core-loop admin proof missing host stale advance recovery after transition",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

function throwHostPhaseScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
