import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  proofGraphEdgeCheckId,
  proofGraphEdgeStatusText,
  selectedProofGraphDependencyAppliesToUnproven,
  selectedProofGraphDependencyEdgeHandoff,
  selectedProofGraphDependencyResolvedEdges,
} from "../frontend/src/lib/app/selected-proof-graph-dependencies.mjs";

export { proofGraphEdgeCheckId, proofGraphEdgeStatusText };

export function selectedProofGraphDependencyHandoffSummaries({
  nextAction,
  proofGraph,
  dependencies,
}) {
  const unproven = nextAction?.nextAction?.unproven;
  return (dependencies ?? []).flatMap((dependency) => {
    if (
      !selectedProofGraphDependencyAppliesToUnproven({
        unproven,
        definition: dependency,
      })
    ) {
      return [];
    }
    return selectedProofGraphDependencyResolvedEdges({
      proofGraph,
      definition: dependency,
    }).map((edge) =>
      selectedProofGraphDependencyEdgeHandoff({
        edge,
        auditId: localAdminAuditIds.proofGraph,
      }),
    );
  });
}

export function selectedProofGraphDependencyLinkIds({
  nextAction,
  proofGraph,
  dependencies,
}) {
  return selectedProofGraphDependencyHandoffSummaries({
    nextAction,
    proofGraph,
    dependencies,
  }).map((handoff) => handoff.linkId);
}
