export function selectedNextActionProofGraphNodeSummary({
  nextAction,
  proofGraph,
}) {
  const proofGraphNodeId = nextAction?.nextAction?.unproven?.proofGraphNodeId;
  const node = proofGraphNodeById(proofGraph, proofGraphNodeId);
  return node === null
    ? null
    : {
        id: String(node.id),
        status: String(node.status ?? "unknown"),
        proofCommand: proofGraphNodeProofCommand(node),
      };
}

export function selectedNextActionProofGraphNodeStatus({
  nextAction,
  proofGraph,
}) {
  const selectedNode = selectedNextActionProofGraphNodeSummary({
    nextAction,
    proofGraph,
  });
  return selectedNode === null
    ? ""
    : `${selectedNode.status}: ${selectedNode.proofCommand}`;
}

export function hostedMatrixHandoffSummary({ nextAction, hostedMatrix }) {
  return hostedMatrixHandoffSummaryForRoleLink({
    linkId: nextAction?.nextAction?.unproven?.proofGraphNodeId,
    roleUrl: nextAction?.nextAction?.unproven?.roleUrl,
    hostedMatrix,
  });
}

export function hostedMatrixHandoffSummaryForRoleLink({
  linkId,
  roleUrl,
  hostedMatrix,
}) {
  if (
    linkId !== "admin-proof:hosted-concurrent-race-matrix" ||
    typeof roleUrl !== "string" ||
    !roleUrl.includes("/admin/audit/local-hosted-concurrent-race-matrix")
  ) {
    return null;
  }
  return {
    linkId,
    auditId: "local-hosted-concurrent-race-matrix",
    requiredCheckIds: [
      ...(hostedMatrix?.evidenceProgress ?? []).map((item) => item.id),
      ...(hostedMatrix?.cells ?? []).map((cell) => cell.id),
    ],
    requiredCheckStatuses: {
      "real-hosted-deployment": String(
        hostedMatrix?.summary?.realHostedDeploymentStatus ?? "unknown",
      ),
    },
    requiredUnprovenIds: [
      hostedMatrix?.requestedEvidence?.id,
      ...(hostedMatrix?.remainingGaps ?? []).map(
        (_gap, index) => `remaining-gap-${index + 1}`,
      ),
    ].filter((id) => typeof id === "string" && id.trim() !== ""),
    requiredReconnectLaneIds: (hostedMatrix?.reconnectLanes ?? [])
      .map((lane) => lane.id)
      .filter((id) => typeof id === "string" && id.trim() !== ""),
    requiredStaleConflictLaneIds: (hostedMatrix?.staleConflictLanes ?? [])
      .map((lane) => lane.id)
      .filter((id) => typeof id === "string" && id.trim() !== ""),
    requiredRelatedLinkIds: ["local-race-coverage", "local-next-action"],
  };
}

function proofGraphNodeById(proofGraph, proofGraphNodeId) {
  if (
    typeof proofGraphNodeId !== "string" ||
    proofGraphNodeId.trim() === "" ||
    proofGraph === null ||
    typeof proofGraph !== "object" ||
    proofGraph.version !== 1 ||
    proofGraph.proof !== "dev-test-game-proof-graph" ||
    proofGraph.status !== "passed" ||
    proofGraph.scope !== "local-dev-test-game-proof-graph" ||
    !Array.isArray(proofGraph.nodes)
  ) {
    return null;
  }
  return (
    proofGraph.nodes.find((candidate) => candidate?.id === proofGraphNodeId) ??
    null
  );
}

function proofGraphNodeProofCommand(node) {
  return String(node?.proofCommand ?? node?.recoveryCommand ?? "");
}
