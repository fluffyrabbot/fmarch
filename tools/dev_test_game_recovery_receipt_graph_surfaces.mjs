import {
  coreLoopPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  replacementActionLaneIds,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementHandoffRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  replacementPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGamePrivateChannelRecoveryReceiptCommand,
  devTestGamePrivateChannelRecoveryReceiptPath,
} from "./dev_test_game_private_channel_recovery_receipt.mjs";
import {
  devTestGameReplacementActionRecoveryReceiptCommand,
  devTestGameReplacementActionRecoveryReceiptPath,
} from "./dev_test_game_replacement_action_recovery_receipt.mjs";
import {
  devTestGameReplacementHandoffRecoveryReceiptCommand,
  devTestGameReplacementHandoffRecoveryReceiptPath,
} from "./dev_test_game_replacement_handoff_recovery_receipt.mjs";
import {
  devTestGameReplacementPrivateRecoveryReceiptCommand,
  devTestGameReplacementPrivateRecoveryReceiptPath,
} from "./dev_test_game_replacement_private_recovery_receipt.mjs";

const recoveryReceiptRelationships = Object.freeze([
  "proves",
  "records",
  "summarizes-into",
]);

export const recoveryReceiptGraphDescriptors = Object.freeze([
  recoveryReceiptGraphDescriptor({
    receiptKey: "privateChannelRecoveryReceipt",
    sourceKey: "privateChannelRecoveryReceiptSource",
    nextActionGeneratedFromKey: "privateChannelRecoveryGraph",
    summaryLaneCountKey: "privateChannelRecoveryLaneCount",
    checkId: "private-channel-recovery-graph",
    nodeId: "private-channel-recovery-receipt",
    label: "Private-channel recovery receipt",
    kind: "private-channel-recovery-receipt",
    provingNodeId: "admin-proof:core-loop",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    proofCommand: devTestGamePrivateChannelRecoveryReceiptCommand,
    proofTarget: devTestGamePrivateChannelRecoveryReceiptPath,
    familyId: "core-loop-private-channel-recovery",
    laneIds: coreLoopPrivateChannelRecoveryLaneIds,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementActionRecoveryReceipt",
    sourceKey: "replacementActionRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementActionRecoveryGraph",
    summaryLaneCountKey: "replacementActionRecoveryLaneCount",
    checkId: "replacement-action-recovery-graph",
    nodeId: "replacement-action-recovery-receipt",
    label: "Replacement action recovery receipt",
    kind: "replacement-action-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementActionRecoveryReceiptCommand,
    proofTarget: devTestGameReplacementActionRecoveryReceiptPath,
    familyId: "replacement-action-recovery",
    laneIds: replacementActionLaneIds,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementHandoffRecoveryReceipt",
    sourceKey: "replacementHandoffRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementHandoffRecoveryGraph",
    summaryLaneCountKey: "replacementHandoffRecoveryLaneCount",
    checkId: "replacement-handoff-recovery-graph",
    nodeId: "replacement-handoff-recovery-receipt",
    label: "Replacement handoff recovery receipt",
    kind: "replacement-handoff-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementHandoffRecoveryReceiptCommand,
    proofTarget: devTestGameReplacementHandoffRecoveryReceiptPath,
    familyId: "replacement-handoff-recovery",
    laneIds: replacementHandoffRecoveryLaneIds,
  }),
  recoveryReceiptGraphDescriptor({
    receiptKey: "replacementPrivateRecoveryReceipt",
    sourceKey: "replacementPrivateRecoveryReceiptSource",
    nextActionGeneratedFromKey: "replacementPrivateRecoveryGraph",
    summaryLaneCountKey: "replacementPrivateRecoveryLaneCount",
    checkId: "replacement-private-recovery-graph",
    nodeId: "replacement-private-recovery-receipt",
    label: "Replacement private-channel recovery receipt",
    kind: "replacement-private-recovery-receipt",
    provingNodeId: "admin-proof:hardening",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    proofCommand: devTestGameReplacementPrivateRecoveryReceiptCommand,
    proofTarget: devTestGameReplacementPrivateRecoveryReceiptPath,
    familyId: "replacement-private-channel-recovery",
    laneIds: replacementPrivateChannelRecoveryLaneIds,
  }),
]);

export function recoveryReceiptGraphDescriptorByReceiptKey(receiptKey) {
  const descriptor = recoveryReceiptGraphDescriptors.find(
    (candidate) => candidate.receiptKey === receiptKey,
  );
  if (descriptor === undefined) {
    throw new Error(`unknown recovery receipt graph descriptor: ${receiptKey}`);
  }
  return descriptor;
}

export function buildRecoveryReceiptGraphNode({
  descriptor,
  receipt,
  source,
}) {
  if (receipt === null) {
    return null;
  }
  return {
    id: descriptor.nodeId,
    label: descriptor.label,
    kind: descriptor.kind,
    status: receipt.status,
    artifact: source,
    roleUrl: receipt.roleUrl,
    proofCommand: descriptor.proofCommand,
    recoveryCommand: descriptor.proofCommand,
    familyId: receipt.familyId,
    laneCount: receipt.laneCount,
    laneIds: receipt.laneIds,
  };
}

export function buildRecoveryReceiptGraphEdges({ descriptor, receipt }) {
  if (receipt === null) {
    return [];
  }
  return [
    [
      descriptor.provingNodeId,
      descriptor.nodeId,
      "proves",
      {
        roleUrl: receipt.roleUrl,
        proofTarget: receipt.path,
      },
    ],
    [
      descriptor.nodeId,
      "proof-graph",
      "records",
      { proofTarget: receipt.path },
    ],
    [
      descriptor.nodeId,
      "next-action",
      "summarizes-into",
      { proofTarget: receipt.path },
    ],
  ];
}

export function recoveryReceiptGraphSummaryFromProofGraph(proofGraph, descriptor) {
  if (proofGraph === null) {
    return null;
  }
  const node = proofGraph.nodes.find(
    (candidate) => candidate?.id === descriptor.nodeId,
  );
  if (node === undefined) {
    return null;
  }
  const edges = recoveryReceiptGraphEdgesForNode(proofGraph, descriptor);
  return {
    nodeId: node.id,
    status: String(node.status ?? "unknown"),
    proofTarget: String(node.artifact ?? ""),
    roleUrl: String(node.roleUrl ?? ""),
    familyId: String(node.familyId ?? ""),
    laneCount: Number(node.laneCount ?? 0),
    laneIds: Array.isArray(node.laneIds)
      ? node.laneIds.map((laneId) => String(laneId))
      : [],
    edgeCount: edges.length,
    edgeTargets: edges.map((edge) =>
      String(edge.from === node.id ? edge.to : edge.from),
    ),
  };
}

export function assertRecoveryReceiptGraphSummary(
  summary,
  descriptor,
  { label = "recovery receipt graph" } = {},
) {
  if (summary === undefined) {
    return;
  }
  if (
    summary === null ||
    summary.nodeId !== descriptor.nodeId ||
    summary.status !== "passed" ||
    summary.proofTarget !== descriptor.proofTarget ||
    summary.roleUrl !== descriptor.roleUrl ||
    summary.familyId !== descriptor.familyId ||
    summary.laneCount !== descriptor.laneIds.length ||
    !Array.isArray(summary.laneIds) ||
    summary.laneIds.length !== descriptor.laneIds.length ||
    summary.edgeCount !== 3 ||
    JSON.stringify(summary.edgeTargets) !==
      JSON.stringify([descriptor.provingNodeId, "proof-graph", "next-action"])
  ) {
    throw new Error(`${label} ${descriptor.nodeId} summary drifted`);
  }
}

export function assertProofGraphCoversRecoveryReceipt(graph, descriptor) {
  const node = (graph?.nodes ?? []).find(
    (candidate) => candidate.id === descriptor.nodeId,
  );
  if (graph?.generatedFrom?.[descriptor.receiptKey] === undefined) {
    if (
      node !== undefined ||
      graph.summary?.[descriptor.summaryLaneCountKey] !== 0
    ) {
      throw new Error(`proof graph ${descriptor.nodeId} summary drifted`);
    }
    return graph;
  }
  if (
    node?.kind !== descriptor.kind ||
    node.status !== "passed" ||
    node.artifact !== graph.generatedFrom[descriptor.receiptKey] ||
    node.roleUrl !== descriptor.roleUrl ||
    node.proofCommand !== descriptor.proofCommand ||
    node.recoveryCommand !== descriptor.proofCommand ||
    node.laneCount !== graph.summary[descriptor.summaryLaneCountKey]
  ) {
    throw new Error(`proof graph ${descriptor.nodeId} node drifted`);
  }
  for (const [from, to, relationship] of [
    [descriptor.provingNodeId, descriptor.nodeId, "proves"],
    [descriptor.nodeId, "proof-graph", "records"],
    [descriptor.nodeId, "next-action", "summarizes-into"],
  ]) {
    if (
      !(graph.edges ?? []).some(
        (edge) =>
          edge.from === from &&
          edge.to === to &&
          edge.relationship === relationship,
      )
    ) {
      throw new Error(`proof graph ${descriptor.nodeId} edge missing: ${from}->${to}`);
    }
  }
  return graph;
}

function recoveryReceiptGraphDescriptor(descriptor) {
  return Object.freeze({
    ...descriptor,
    laneIds: Object.freeze([...descriptor.laneIds]),
  });
}

function recoveryReceiptGraphEdgesForNode(proofGraph, descriptor) {
  return proofGraph.edges.filter(
    (candidate) =>
      (candidate?.from === descriptor.nodeId ||
        candidate?.to === descriptor.nodeId) &&
      recoveryReceiptRelationships.includes(
        String(candidate?.relationship ?? ""),
      ),
  );
}
