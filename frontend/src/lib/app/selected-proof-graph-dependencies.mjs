import {
  realHostedObservabilityRoleSurfaceDrilldown,
} from "../../../../tools/dev_test_game_real_hosted_observability_handoff_cases.mjs";

export function selectedProofGraphDependencyDefinitions({
  command = "",
  actionStatus = "unknown",
  hostedIdentityProofGraphEdges = null,
  unproven = null,
} = {}) {
  return [
    Object.freeze({
      id: "hosted-matrix-transition",
      selectedProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      roleUrlIncludes: "/admin/audit/local-hosted-concurrent-race-matrix",
      edges: Object.freeze([
        Object.freeze({
          from: "admin-proof:hosted-evidence-lane",
          relationship: "feeds-hosted-matrix-transition",
          to: "admin-proof:hosted-concurrent-race-matrix",
        }),
      ]),
      label: () => "Hosted evidence lane to hosted matrix",
      status: () =>
        String(
          unproven?.realHostedEvidenceStatus ??
            unproven?.status ??
            actionStatus,
        ),
      command: () => command,
    }),
    Object.freeze({
      id: "hosted-identity-proof-graph-dependency",
      selectedProofGraphNodeId: "admin-proof:hosted-identity-evidence",
      unprovenId: "hosted-production-identity",
      roleUrlIncludes: "/admin/audit/local-hosted-identity-evidence",
      edges: Object.freeze(
        Array.isArray(hostedIdentityProofGraphEdges?.edges)
          ? hostedIdentityProofGraphEdges.edges
          : [],
      ),
      label: (edge) => `${edge.from} to ${edge.to}`,
      status: (edge) => String(edge.relationship ?? actionStatus),
      command: (edge) => String(edge.command ?? command),
    }),
    Object.freeze({
      id: "real-hosted-observability-handoff",
      selectedProofGraphNodeId:
        realHostedObservabilityRoleSurfaceDrilldown.proofGraphNodeId,
      roleUrlIncludes:
        "/admin/audit/local-real-hosted-observability-handoff",
      edges: Object.freeze([
        Object.freeze({
          from: "admin-proof:hosted-ops-signals",
          relationship: "feeds-real-hosted-observability-handoff",
          to: realHostedObservabilityRoleSurfaceDrilldown.proofGraphNodeId,
        }),
      ]),
      label: () => "Hosted ops signals to real hosted observability",
      status: () => String(unproven?.status ?? actionStatus),
      command: () => command,
    }),
  ];
}

export function selectedProofGraphDependencyApplies({
  definition,
  selectedNodeId,
  unproven,
  unprovenRoleUrl,
}) {
  if (!Array.isArray(definition?.edges) || definition.edges.length === 0) {
    return false;
  }
  if (selectedNodeId !== definition.selectedProofGraphNodeId) {
    return false;
  }
  if (
    typeof definition.unprovenId === "string" &&
    definition.unprovenId !== "" &&
    String(unproven?.id ?? "") !== definition.unprovenId
  ) {
    return false;
  }
  return (
    typeof unprovenRoleUrl === "string" &&
    unprovenRoleUrl.includes(definition.roleUrlIncludes)
  );
}
