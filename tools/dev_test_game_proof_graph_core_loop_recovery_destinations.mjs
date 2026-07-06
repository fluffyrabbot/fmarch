import {
  hostVisibleRecoverySummaryCases,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameCoreLoopAdminProofCommand,
} from "./dev_test_game_production_feature_source_rules.mjs";
import {
  devTestGameCoreLoopAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";

export const proofGraphCoreLoopRecoveryDestinationSectionId =
  "core-loop-recovery-destinations";
export const proofGraphCoreLoopRecoveryDestinationSectionHeading =
  "Core-loop recovery destinations";
export const proofGraphCoreLoopRecoveryDestinationRowTestIdPrefix =
  "admin-audit-core-loop-recovery-destination";

export function proofGraphCoreLoopRecoveryDestinationRowId(recoveryCaseId) {
  return `core-loop-recovery-destination:${String(recoveryCaseId ?? "")}`;
}

export function proofGraphCoreLoopRecoveryDestinationNodeId(recoveryCaseId) {
  return `core-loop-host-visible-recovery:${String(recoveryCaseId ?? "")}`;
}

export function proofGraphCoreLoopRecoveryDestinationRowTestId(rowId) {
  return `${proofGraphCoreLoopRecoveryDestinationRowTestIdPrefix}-${String(rowId)}`;
}

export function proofGraphCoreLoopRecoveryDestinationProofTargetTestId(rowId) {
  return `admin-audit-core-loop-recovery-destination-proof-target-${String(rowId)}`;
}

export function proofGraphCoreLoopRecoveryDestinationNodes({
  game = "<seeded-game>",
  recoveryCommand = devTestGameCoreLoopAdminProofCommand,
} = {}) {
  return Object.freeze(
    hostVisibleRecoverySummaryCases().map((recoveryCase) =>
      Object.freeze({
        id: proofGraphCoreLoopRecoveryDestinationNodeId(recoveryCase.id),
        label: recoveryCase.label,
        kind: "core-loop-host-visible-recovery",
        status: "passed",
        artifact: devTestGameCoreLoopAdminProofPath,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop, { game }),
        proofCommand: recoveryCommand,
        recoveryCommand,
        recoveryCaseId: recoveryCase.id,
        group: recoveryCase.group,
        adminCheckId: recoveryCase.adminCheckId,
        recoveryHookId: recoveryCase.recoveryHookId,
        recoveryHookStatus: recoveryCase.recoveryHookStatus,
        commandKind: recoveryCase.commandKind,
        visibleAdminRowId: `host-visible-recovery-${recoveryCase.id}`,
        visibleAdminRowTestId:
          `admin-audit-host-visible-recovery-${recoveryCase.id}`,
      }),
    ),
  );
}

export function proofGraphCoreLoopRecoveryDestinationEdgeRows({
  nodes = proofGraphCoreLoopRecoveryDestinationNodes(),
  requiredRelationships = null,
} = {}) {
  const requiredRelationshipSet =
    requiredRelationships === null
      ? null
      : new Set(requiredRelationships.map((relationship) => String(relationship)));
  return Object.freeze(
    nodes
      .filter((node) => node.kind === "core-loop-host-visible-recovery")
      .flatMap((node) =>
        proofGraphCoreLoopRecoveryDestinationEdgeDefinitions(node)
          .filter(
            ([, , relationship]) =>
              requiredRelationshipSet === null ||
              requiredRelationshipSet.has(relationship),
          )
          .map(([from, to, relationship, metadata]) =>
            Object.freeze([from, to, relationship, Object.freeze(metadata)]),
          ),
      ),
  );
}

export function proofGraphCoreLoopRecoveryDestinationEdges(options = {}) {
  return Object.freeze(
    proofGraphCoreLoopRecoveryDestinationEdgeRows(options).map(
      ([from, to, relationship, metadata]) =>
        Object.freeze({ from, to, relationship, ...metadata }),
    ),
  );
}

export function proofGraphCoreLoopRecoveryDestinationEdgeRowIds(options = {}) {
  return Object.freeze(
    proofGraphCoreLoopRecoveryDestinationEdgeRows(options).map(
      ([from, to, relationship]) => `edge:${from}:${relationship}:${to}`,
    ),
  );
}

export function proofGraphCoreLoopRecoveryDestinationSummary(
  proofGraph,
  { requiredRelationships = null } = {},
) {
  const rows = proofGraphCoreLoopRecoveryDestinationRows(proofGraph, {
    requiredRelationships,
  });
  const coveredCount = rows.filter((row) => row.status === "passed").length;
  return Object.freeze({
    id: proofGraphCoreLoopRecoveryDestinationSectionId,
    label: proofGraphCoreLoopRecoveryDestinationSectionHeading,
    status:
      coveredCount === rows.length && rows.length > 0 ? "passed" : "missing",
    requiredCount: rows.length,
    coveredCount,
    missingCount: rows.length - coveredCount,
    rows: Object.freeze(rows),
  });
}

export function proofGraphCoreLoopRecoveryDestinationRows(
  proofGraph,
  { requiredRelationships = null } = {},
) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph?.edges) ? proofGraph.edges : [];
  const requiredRelationshipSet =
    requiredRelationships === null
      ? null
      : new Set(requiredRelationships.map((relationship) => String(relationship)));
  return Object.freeze(
    hostVisibleRecoverySummaryCases().map((recoveryCase) => {
      const graphNodeId = `core-loop-host-visible-recovery:${recoveryCase.id}`;
      const adminRowId = `host-visible-recovery-${recoveryCase.id}`;
      const proofEdgeRowId =
        `edge:admin-proof:core-loop:proves-host-visible-recovery:${graphNodeId}`;
      const graphEdgeRowId = `edge:${graphNodeId}:records:proof-graph`;
      const nextActionEdgeRowId =
        `edge:${graphNodeId}:summarizes-into:next-action`;
      const node = nodes.find((candidate) => candidate?.id === graphNodeId);
      const expectedRoleUrl = String(
        node?.roleUrl ?? localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      );
      const expectedCommand = String(
        node?.recoveryCommand ?? devTestGameCoreLoopAdminProofCommand,
      );
      const expectedProofTarget = String(
        node?.artifact ?? devTestGameCoreLoopAdminProofPath,
      );
      const requiredEdges = proofGraphCoreLoopRecoveryDestinationEdgeDefinitions({
        id: graphNodeId,
        recoveryCaseId: recoveryCase.id,
        group: recoveryCase.group,
        roleUrl: expectedRoleUrl,
        recoveryCommand: expectedCommand,
        artifact: expectedProofTarget,
        visibleAdminRowId: adminRowId,
      }).filter(
        ([, , relationship]) =>
          requiredRelationshipSet === null ||
          requiredRelationshipSet.has(relationship),
      );
      const edgesCovered = requiredEdges.every(([from, to, relationship]) =>
        edges.some(
          (edge) =>
            edge?.from === from &&
            edge?.to === to &&
            edge?.relationship === relationship &&
            edge?.roleUrl === expectedRoleUrl &&
            edge?.command === expectedCommand &&
            edge?.proofTarget === expectedProofTarget &&
            edge?.recoveryCaseId === recoveryCase.id,
        ),
      );
      const nodeCovered =
        node?.kind === "core-loop-host-visible-recovery" &&
        node?.status === "passed" &&
        node?.visibleAdminRowId === adminRowId;
      return Object.freeze({
        id: proofGraphCoreLoopRecoveryDestinationRowId(recoveryCase.id),
        recoveryCaseId: recoveryCase.id,
        label: recoveryCase.label,
        group: recoveryCase.group,
        status: nodeCovered && edgesCovered ? "passed" : "missing",
        graphNodeId,
        adminRowId,
        proofEdgeRowId,
        graphEdgeRowId,
        nextActionEdgeRowId,
        roleUrl: expectedRoleUrl,
        proofTarget: expectedProofTarget,
        command: expectedCommand,
      });
    }),
  );
}

export function proofGraphCoreLoopHostVisibleRecoveryDestinations(proofGraph) {
  const nodesByRecoveryCaseId = new Map(
    (proofGraph?.nodes ?? [])
      .filter((node) => node.kind === "core-loop-host-visible-recovery")
      .map((node) => [node.recoveryCaseId, node]),
  );
  return Object.freeze(
    hostVisibleRecoverySummaryCases().map((recoveryCase) => {
      const node = nodesByRecoveryCaseId.get(recoveryCase.id);
      if (node === undefined) {
        throw new Error(
          `proof graph missing core-loop host-visible recovery: ${recoveryCase.id}`,
        );
      }
      return Object.freeze({
        linkId: node.id,
        auditId: localAdminAuditIds.coreLoop,
        detailRoleUrl: node.roleUrl,
        recoveryCaseId: recoveryCase.id,
        requiredHostVisibleRecoveries: Object.freeze([recoveryCase.id]),
        requiredHostVisibleRecoveryText: Object.freeze({
          [recoveryCase.id]:
            proofGraphCoreLoopHostVisibleRecoveryTextTokens(recoveryCase),
        }),
      });
    }),
  );
}

export function proofGraphCoreLoopHostVisibleRecoveryTextTokens(recoveryCase) {
  return Object.freeze(
    [
      recoveryCase.label,
      "passed",
      recoveryCase.group,
      recoveryCase.recoveryHookStatus,
      recoveryCase.commandKind,
    ].filter((token) => String(token ?? "") !== ""),
  );
}

function proofGraphCoreLoopRecoveryDestinationEdgeDefinitions(node) {
  const metadata = {
    recoveryCaseId: node.recoveryCaseId,
    group: node.group,
    roleUrl: node.roleUrl,
    command: node.recoveryCommand,
    proofTarget: node.artifact,
    visibleAdminRowId: node.visibleAdminRowId,
  };
  return [
    [
      "admin-proof:core-loop",
      node.id,
      "proves-host-visible-recovery",
      metadata,
    ],
    [node.id, "proof-graph", "records", metadata],
    [node.id, "next-action", "summarizes-into", metadata],
  ];
}
