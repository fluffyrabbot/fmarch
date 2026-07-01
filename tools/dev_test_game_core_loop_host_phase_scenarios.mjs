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
