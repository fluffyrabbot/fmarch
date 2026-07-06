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

export function proofGraphCoreLoopRecoveryDestinationRowTestId(rowId) {
  return `${proofGraphCoreLoopRecoveryDestinationRowTestIdPrefix}-${String(rowId)}`;
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
      const requiredEdges = [
        ["admin-proof:core-loop", graphNodeId, "proves-host-visible-recovery"],
        [graphNodeId, "proof-graph", "records"],
        [graphNodeId, "next-action", "summarizes-into"],
      ].filter(
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
            edge?.roleUrl === localAdminAuditRoleUrl(localAdminAuditIds.coreLoop) &&
            edge?.command === devTestGameCoreLoopAdminProofCommand &&
            edge?.proofTarget === devTestGameCoreLoopAdminProofPath &&
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
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
        proofTarget: devTestGameCoreLoopAdminProofPath,
        command: devTestGameCoreLoopAdminProofCommand,
      });
    }),
  );
}
