import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  assertBlockedOperatorPacket,
} from "./dev_test_game_hosted_operator_packet.mjs";
import {
  assertHostedMatrixRawEvidenceTemplateDescriptor,
  hostedMatrixRawEvidenceTemplateDescriptorFieldValues,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
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
      "proof-graph.selected-operator-packet-node",
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
    selectedOperatorHandoffPacket: selectedOperatorHandoffPacketSummary({
      handoff: selectedOperatorHandoff,
      proofGraph,
    }),
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
    !receipt.assertions.includes("proof-graph.selected-operator-packet-node") ||
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
      receipt.selectedOperatorHandoffPacket !== undefined ||
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

export function selectedOperatorHandoffReceiptSelectedRowStatus(receipt) {
  const template = receipt.selectedOperatorHandoff.rawEvidenceTemplate;
  return [
    receipt.selectedOperatorHandoff.status,
    receipt.selectedOperatorHandoff.command,
    receipt.selectedOperatorHandoff.firstMissingInputId,
    receipt.selectedOperatorHandoff.selectedProductionFeatureGraphNodeId,
    ...hostedMatrixRawEvidenceTemplateDescriptorFieldValues(template).map(
      (field) => field.value,
    ),
  ].join("\n");
}

export function selectedOperatorHandoffTerminalReceiptDestinationFields(
  receipt,
) {
  return {
    selectedOperatorHandoffReceiptId: receipt.id,
    selectedOperatorHandoffReceiptStatus: receipt.status,
    requiredSelectedOperatorHandoffTerminalReceiptRows: [
      "receipt",
      "selected",
      "packet",
      "edge",
      "readiness-link",
    ],
    requiredSelectedOperatorHandoffTerminalReceiptRowStatuses: {
      receipt: [
        receipt.status,
        receipt.id,
        receipt.proofBoundary,
        receipt.sourceArtifacts.nextAction,
        receipt.sourceArtifacts.nextActionAdminProof,
        receipt.sourceArtifacts.proofGraph,
        receipt.sourceArtifacts.releaseReadiness,
      ].join("\n"),
      selected: selectedOperatorHandoffReceiptSelectedRowStatus(receipt),
      packet: selectedOperatorHandoffReceiptPacketRowStatus(receipt),
      edge: [
        receipt.proofGraphEdge.from,
        receipt.proofGraphEdge.relationship,
        receipt.proofGraphEdge.to,
        receipt.proofGraphEdge.firstMissingInputId,
      ].join("\n"),
      "readiness-link": [
        receipt.readinessRelatedLink.id,
        receipt.readinessRelatedLink.sourceAuditId,
        receipt.readinessRelatedLink.destinationAuditId,
        receipt.readinessRelatedLink.status,
        receipt.readinessRelatedLink.command,
      ].join("\n"),
    },
  };
}

function assertSelectedOperatorHandoffReceiptShape(receipt) {
  if (receipt.status === "not_applicable") {
    if (
      receipt.reason !== "no-selected-operator-handoff" ||
      receipt.selectedOperatorHandoff !== undefined ||
      receipt.selectedOperatorHandoffPacket !== undefined ||
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
    receipt.selectedOperatorHandoffPacket === null ||
    typeof receipt.selectedOperatorHandoffPacket !== "object" ||
    receipt.selectedOperatorHandoffPacket.firstMissingInputId !==
      receipt.selectedOperatorHandoff.firstMissingInputId ||
    receipt.selectedOperatorHandoffPacket.selectedProductionFeatureGraphNodeId !==
      receipt.selectedOperatorHandoff.selectedProductionFeatureGraphNodeId ||
    receipt.selectedOperatorHandoffPacket.selectedProductionFeatureRoleUrl !==
      receipt.selectedOperatorHandoff.selectedProductionFeatureRoleUrl ||
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
      receipt.selectedOperatorHandoff.command ||
    (receipt.selectedOperatorHandoff.rawEvidenceTemplate !== undefined &&
      assertHostedMatrixRawEvidenceTemplateDescriptor(
        receipt.selectedOperatorHandoff.rawEvidenceTemplate,
      ) === null)
  ) {
    throw new Error("selected operator handoff terminal receipt is malformed");
  }
}

export function selectedOperatorHandoffReceiptPacketRowStatus(receipt) {
  const packet = receipt.selectedOperatorHandoffPacket;
  const template = packet.rawEvidenceTemplate;
  return [
    packet.status,
    packet.firstMissingInputId,
    packet.firstMissingCheckId,
    packet.firstMissingSectionId,
    packet.proofTarget,
    packet.packetProofTarget,
    packet.nextProofTarget,
    packet.selectedProductionFeatureGraphNodeId,
    packet.selectedProductionFeatureRoleUrl,
    packet.handoffRoleUrl,
    packet.operatorChecklistProofTarget,
    packet.operatorChecklistPreflightTarget,
    ...hostedMatrixRawEvidenceTemplateDescriptorFieldValues(template).map(
      (field) => field.value,
    ),
  ].join("\n");
}

function selectedOperatorHandoffSummary(handoff) {
  const rawEvidenceTemplateSource =
    handoff.rawEvidenceTemplate ??
    handoff.blockedOperatorPacket?.rawEvidenceTemplate;
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
    ...(rawEvidenceTemplateSource === undefined
      ? {}
      : {
          rawEvidenceTemplate:
            assertHostedMatrixRawEvidenceTemplateDescriptor(
              rawEvidenceTemplateSource,
            ),
        }),
  });
}

function selectedOperatorHandoffPacketSummary({ handoff, proofGraph }) {
  const packet = assertBlockedOperatorPacket(handoff.blockedOperatorPacket);
  const proofGraphNode = selectedOperatorHandoffProofGraphPacketNode({
    handoff,
    packet,
    proofGraph,
  });
  const roleSurfaceDrilldown = packet.roleSurfaceDrilldown ?? {};
  const operatorChecklist = packet.operatorChecklist ?? {};
  return Object.freeze({
    status: packet.status,
    firstMissingInputId: packet.firstMissingInputId,
    firstMissingCheckId: packet.firstMissingCheckId,
    firstMissingSectionId: packet.firstMissingSectionId,
    proofTarget: handoff.proofTarget,
    packetProofTarget: packet.proofTarget,
    nextProofTarget: packet.nextProofTarget,
    selectedProductionFeatureGraphNodeId:
      packet.selectedProductionFeatureGraphNodeId,
    selectedProductionFeatureRoleUrl:
      packet.selectedProductionFeatureRoleUrl,
    handoffRoleUrl: String(roleSurfaceDrilldown.handoffRoleUrl ?? ""),
    operatorChecklistProofTarget: String(operatorChecklist.proofTarget ?? ""),
    operatorChecklistPreflightTarget: String(
      operatorChecklist.preflightTarget ?? "",
    ),
    rawEvidenceTemplate: assertHostedMatrixRawEvidenceTemplateDescriptor(
      packet.rawEvidenceTemplate,
    ),
    ...(proofGraphNode === null ? {} : { proofGraphNodeId: proofGraphNode.id }),
  });
}

function selectedOperatorHandoffProofGraphPacketNode({
  handoff,
  packet,
  proofGraph,
}) {
  if (
    proofGraph === null ||
    typeof proofGraph !== "object" ||
    !Array.isArray(proofGraph.nodes)
  ) {
    return null;
  }
  const node = (proofGraph.nodes ?? []).find(
    (candidate) => candidate.id === "selected-operator-handoff-packet",
  );
  if (node === undefined) {
    throw new Error("proof graph is missing selected operator packet node");
  }
  if (
    node.packetId !== handoff.id ||
    node.status !== packet.status ||
    node.proofTarget !== handoff.proofTarget ||
    node.packetProofTarget !== packet.proofTarget ||
    node.nextProofTarget !== packet.nextProofTarget ||
    node.firstMissingInputId !== packet.firstMissingInputId ||
    node.firstMissingCheckId !== packet.firstMissingCheckId ||
    node.selectedProductionFeatureGraphNodeId !==
      packet.selectedProductionFeatureGraphNodeId ||
    node.selectedProductionFeatureRoleUrl !==
      packet.selectedProductionFeatureRoleUrl ||
    node.rawEvidenceTemplate?.path !== packet.rawEvidenceTemplate?.path
  ) {
    throw new Error("proof graph selected operator packet node drifted");
  }
  return node;
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
