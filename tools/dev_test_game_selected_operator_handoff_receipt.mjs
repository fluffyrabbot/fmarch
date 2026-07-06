import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  assertBlockedOperatorPacket,
} from "./dev_test_game_hosted_operator_packet.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_readiness_steps.mjs";
import {
  devTestGameProofGraphPath,
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export const selectedOperatorHandoffTerminalReceiptId =
  "selected-operator-handoff-terminal-receipt";
export const selectedOperatorHandoffGraphRelationship =
  "selected-operator-handoff";
export const selectedOperatorHandoffRelatedLinkId =
  "selected-operator-handoff";

export function selectedOperatorHandoffFromNextAction(nextAction) {
  const packet =
    nextAction?.unproven?.hostedHandoffChecklist?.blockedOperatorPacket ??
    nextAction?.unproven?.hostedHandoffChecklist?.blockedReceipt
      ?.blockedOperatorPacket;
  if (packet === null || packet === undefined) {
    return null;
  }
  const blockedOperatorPacket = assertBlockedOperatorPacket(packet);
  return Object.freeze({
    id: `${String(nextAction.unproven?.id ?? "unknown")}:blocked-operator-packet`,
    status: blockedOperatorPacket.status,
    reason: String(nextAction.reason ?? ""),
    command: String(nextAction.command ?? ""),
    unprovenId: String(nextAction.unproven?.id ?? ""),
    proofTarget: String(nextAction.unproven?.proofTarget ?? ""),
    roleUrl: String(nextAction.unproven?.roleUrl ?? ""),
    firstMissingInputId: blockedOperatorPacket.firstMissingInputId,
    selectedProductionFeatureGraphNodeId:
      blockedOperatorPacket.selectedProductionFeatureGraphNodeId,
    selectedProductionFeatureRoleUrl:
      blockedOperatorPacket.selectedProductionFeatureRoleUrl,
    blockedOperatorPacket,
  });
}

export function assertSelectedOperatorHandoffForNextAction(evidence) {
  const expected = selectedOperatorHandoffFromNextAction(evidence.nextAction);
  if (
    JSON.stringify(evidence.selectedOperatorHandoff ?? null) !==
    JSON.stringify(expected)
  ) {
    throw new Error("next-action selected operator handoff drifted");
  }
  if (expected === null) {
    return;
  }
  if (
    expected.reason !== "release-readiness-unproven" ||
    expected.command !== evidence.nextAction.command ||
    expected.unprovenId !== evidence.nextAction.unproven?.id ||
    expected.proofTarget !== evidence.nextAction.unproven?.proofTarget ||
    expected.roleUrl !== evidence.nextAction.unproven?.roleUrl ||
    expected.firstMissingInputId !==
      expected.blockedOperatorPacket.firstMissingInputId ||
    expected.selectedProductionFeatureGraphNodeId !==
      expected.blockedOperatorPacket.selectedProductionFeatureGraphNodeId ||
    expected.selectedProductionFeatureRoleUrl !==
      expected.blockedOperatorPacket.selectedProductionFeatureRoleUrl
  ) {
    throw new Error("next-action selected operator handoff is inconsistent");
  }
}

export function buildSelectedOperatorHandoffTerminalReceipt({
  nextAction,
  proofGraph = null,
  sourceArtifacts = {},
} = {}) {
  const selectedOperatorHandoff =
    nextAction?.selectedOperatorHandoff ??
    selectedOperatorHandoffFromNextAction(nextAction?.nextAction);
  const sourceArtifactPaths = {
    nextAction: sourceArtifacts.nextAction ?? nextActionPath,
    nextActionAdminProof:
      sourceArtifacts.nextActionAdminProof ?? nextActionAdminProofPath,
    proofGraph: sourceArtifacts.proofGraph ?? devTestGameProofGraphPath,
    releaseReadiness:
      sourceArtifacts.releaseReadiness ?? devTestGameReleaseReadinessPath,
  };
  const base = {
    id: selectedOperatorHandoffTerminalReceiptId,
    status: selectedOperatorHandoff === null ? "not_applicable" : "passed",
    proofBoundary:
      "Local terminal receipt for the selected operator handoff. It ties the next-action selectedOperatorHandoff artifact to the proof-graph selected-operator-handoff edge and the release-readiness admin related-link contract; it does not prove hosted deployment, release readiness, or production readiness.",
    sourceArtifacts: sourceArtifactPaths,
    assertions: [
      "next-action.selectedOperatorHandoff",
      "proof-graph.selected-operator-handoff-edge",
      "release-readiness.selected-operator-handoff-related-link",
    ],
  };
  if (selectedOperatorHandoff === null) {
    return Object.freeze({
      ...base,
      reason: "no-selected-operator-handoff",
    });
  }
  const proofGraphEdge = selectedOperatorHandoffProofGraphEdge({
    handoff: selectedOperatorHandoff,
    proofGraph,
  });
  return Object.freeze({
    ...base,
    selectedOperatorHandoff: selectedOperatorHandoffSummary(
      selectedOperatorHandoff,
    ),
    proofGraphEdge,
    readinessRelatedLink: selectedOperatorHandoffReadinessRelatedLink(
      selectedOperatorHandoff,
    ),
  });
}

export function assertSelectedOperatorHandoffTerminalReceipt(
  receipt,
  { nextAction = null, proofGraph = null } = {},
) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.id !== selectedOperatorHandoffTerminalReceiptId ||
    !["passed", "not_applicable"].includes(receipt.status) ||
    receipt.sourceArtifacts?.nextAction !== nextActionPath ||
    receipt.sourceArtifacts?.nextActionAdminProof !== nextActionAdminProofPath ||
    receipt.sourceArtifacts?.proofGraph !== devTestGameProofGraphPath ||
    receipt.sourceArtifacts?.releaseReadiness !==
      devTestGameReleaseReadinessPath ||
    !Array.isArray(receipt.assertions) ||
    !receipt.assertions.includes("next-action.selectedOperatorHandoff") ||
    !receipt.assertions.includes("proof-graph.selected-operator-handoff-edge") ||
    !receipt.assertions.includes(
      "release-readiness.selected-operator-handoff-related-link",
    )
  ) {
    throw new Error("selected operator handoff terminal receipt drifted");
  }
  const selectedOperatorHandoff =
    nextAction === null
      ? null
      : nextAction.selectedOperatorHandoff ??
        selectedOperatorHandoffFromNextAction(nextAction.nextAction);
  if (nextAction === null) {
    assertSelectedOperatorHandoffReceiptShape(receipt);
    return receipt;
  }
  if (selectedOperatorHandoff === null) {
    if (
      receipt.status !== "not_applicable" ||
      receipt.reason !== "no-selected-operator-handoff" ||
      receipt.selectedOperatorHandoff !== undefined ||
      receipt.proofGraphEdge !== undefined ||
      receipt.readinessRelatedLink !== undefined
    ) {
      throw new Error(
        "selected operator handoff terminal receipt should be not_applicable",
      );
    }
    return receipt;
  }
  const expected = buildSelectedOperatorHandoffTerminalReceipt({
    nextAction,
    proofGraph,
  });
  if (JSON.stringify(receipt) !== JSON.stringify(expected)) {
    throw new Error("selected operator handoff terminal receipt mismatch");
  }
  return receipt;
}

function assertSelectedOperatorHandoffReceiptShape(receipt) {
  if (receipt.status === "not_applicable") {
    if (
      receipt.reason !== "no-selected-operator-handoff" ||
      receipt.selectedOperatorHandoff !== undefined ||
      receipt.proofGraphEdge !== undefined ||
      receipt.readinessRelatedLink !== undefined
    ) {
      throw new Error(
        "selected operator handoff terminal receipt should be not_applicable",
      );
    }
    return;
  }
  if (
    receipt.status !== "passed" ||
    receipt.selectedOperatorHandoff === null ||
    typeof receipt.selectedOperatorHandoff !== "object" ||
    receipt.selectedOperatorHandoff.firstMissingInputId === "" ||
    receipt.selectedOperatorHandoff.selectedProductionFeatureGraphNodeId ===
      "" ||
    receipt.proofGraphEdge?.relationship !==
      selectedOperatorHandoffGraphRelationship ||
    receipt.proofGraphEdge?.from !== "next-action" ||
    receipt.proofGraphEdge?.to !==
      receipt.selectedOperatorHandoff.selectedProductionFeatureGraphNodeId ||
    receipt.proofGraphEdge?.firstMissingInputId !==
      receipt.selectedOperatorHandoff.firstMissingInputId ||
    receipt.proofGraphEdge?.command !==
      receipt.selectedOperatorHandoff.command ||
    receipt.readinessRelatedLink?.id !== selectedOperatorHandoffRelatedLinkId ||
    receipt.readinessRelatedLink?.sourceAuditId !==
      localAdminAuditIds.releaseReadiness ||
    receipt.readinessRelatedLink?.destinationAuditId !==
      localAdminAuditIds.nextAction ||
    receipt.readinessRelatedLink?.status !==
      `${receipt.selectedOperatorHandoff.status}:${receipt.selectedOperatorHandoff.firstMissingInputId}` ||
    receipt.readinessRelatedLink?.command !==
      receipt.selectedOperatorHandoff.command
  ) {
    throw new Error("selected operator handoff terminal receipt is malformed");
  }
}

function selectedOperatorHandoffSummary(handoff) {
  return Object.freeze({
    id: handoff.id,
    status: handoff.status,
    reason: handoff.reason,
    command: handoff.command,
    unprovenId: handoff.unprovenId,
    proofTarget: handoff.proofTarget,
    roleUrl: handoff.roleUrl,
    firstMissingInputId: handoff.firstMissingInputId,
    selectedProductionFeatureGraphNodeId:
      handoff.selectedProductionFeatureGraphNodeId,
    selectedProductionFeatureRoleUrl:
      handoff.selectedProductionFeatureRoleUrl,
  });
}

function selectedOperatorHandoffProofGraphEdge({ handoff, proofGraph }) {
  const fallback = {
    from: "next-action",
    to: handoff.selectedProductionFeatureGraphNodeId,
    relationship: selectedOperatorHandoffGraphRelationship,
    command: handoff.command,
    firstMissingInputId: handoff.firstMissingInputId,
    roleUrl: handoff.selectedProductionFeatureRoleUrl,
    proofTarget: handoff.proofTarget,
    unprovenId: handoff.unprovenId,
  };
  if (proofGraph === null || typeof proofGraph !== "object") {
    return Object.freeze(fallback);
  }
  const edge = (proofGraph.edges ?? []).find(
    (candidate) =>
      candidate.from === fallback.from &&
      candidate.to === fallback.to &&
      candidate.relationship === fallback.relationship,
  );
  if (edge === undefined) {
    throw new Error("proof graph is missing selected operator handoff edge");
  }
  if (
    edge.command !== fallback.command ||
    edge.firstMissingInputId !== fallback.firstMissingInputId ||
    edge.roleUrl !== fallback.roleUrl ||
    edge.proofTarget !== fallback.proofTarget ||
    edge.unprovenId !== fallback.unprovenId
  ) {
    throw new Error("proof graph selected operator handoff edge drifted");
  }
  return Object.freeze(fallback);
}

function selectedOperatorHandoffReadinessRelatedLink(handoff) {
  return Object.freeze({
    id: selectedOperatorHandoffRelatedLinkId,
    label: "Selected operator handoff",
    sourceAuditId: localAdminAuditIds.releaseReadiness,
    destinationAuditId: localAdminAuditIds.nextAction,
    href: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
    status: `${handoff.status}:${handoff.firstMissingInputId}`,
    command: handoff.command,
  });
}
