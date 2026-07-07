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

export function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

export function proofGraphEdgeStatusText(edge, { separator = "\n" } = {}) {
  const relationship = String(edge?.relationship ?? "recorded");
  const fields = [
    ["source", edge?.source],
    ["status", edge?.status],
    ["mode", edge?.mode],
    ["realHostedEvidenceStatus", edge?.realHostedEvidenceStatus],
    ["realHostedDeploymentStatus", edge?.realHostedDeploymentStatus],
    ["externalEvidencePath", edge?.externalEvidencePath],
    ["firstMissingInputId", edge?.firstMissingInputId],
    ["command", edge?.command],
    ["proofTarget", edge?.proofTarget],
    ["roleUrl", edge?.roleUrl],
    ["unprovenId", edge?.unprovenId],
  ];
  return [
    relationship,
    ...fields.flatMap(([key, value]) => {
      const text = String(value ?? "").trim();
      return text === "" ? [] : [`${key} ${text}`];
    }),
  ].join(separator);
}

export function selectedProofGraphDependencyEdgeRelatedLinkDescriptor({
  definition,
  edge,
}) {
  return Object.freeze({
    id: proofGraphEdgeCheckId(edge),
    label:
      typeof definition?.label === "function"
        ? definition.label(edge)
        : `${String(edge?.from ?? "")} to ${String(edge?.to ?? "")}`,
    status:
      typeof definition?.status === "function"
        ? definition.status(edge)
        : proofGraphEdgeStatusText(edge),
    command:
      typeof definition?.command === "function"
        ? definition.command(edge)
        : String(edge?.command ?? ""),
  });
}

export function selectedProofGraphDependencyEdgeHandoff({
  edge,
  auditId,
  statusSeparator = " ",
}) {
  const edgeRowId = proofGraphEdgeCheckId(edge);
  return Object.freeze({
    linkId: edgeRowId,
    auditId,
    requiredCheckIds: Object.freeze([
      edgeRowId,
      String(edge?.from ?? ""),
      String(edge?.to ?? ""),
    ]),
    requiredCheckStatuses: Object.freeze({
      [edgeRowId]: proofGraphEdgeStatusText(edge, {
        separator: statusSeparator,
      }),
    }),
    requiredRelatedLinkIds: Object.freeze([
      String(edge?.from ?? ""),
      String(edge?.to ?? ""),
    ]),
  });
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
  if (Array.isArray(definition.roleUrlIncludes)) {
    return (
      typeof unprovenRoleUrl === "string" &&
      definition.roleUrlIncludes.every((part) =>
        unprovenRoleUrl.includes(String(part)),
      )
    );
  }
  return (
    typeof unprovenRoleUrl === "string" &&
    unprovenRoleUrl.includes(definition.roleUrlIncludes)
  );
}

export function selectedProofGraphDependencyAppliesToUnproven({
  definition,
  unproven,
}) {
  if (unproven === null || unproven === undefined) {
    return false;
  }
  return selectedProofGraphDependencyApplies({
    definition,
    selectedNodeId: String(unproven.proofGraphNodeId ?? ""),
    unproven,
    unprovenRoleUrl: String(unproven.roleUrl ?? ""),
  });
}

export function selectedProofGraphDependencyResolvedEdges({
  proofGraph,
  definition,
}) {
  return (definition?.edges ?? [])
    .map((expected) => proofGraphDependencyEdge({ proofGraph, expected }))
    .filter((edge) => edge !== null);
}

function proofGraphDependencyEdge({ proofGraph, expected }) {
  const graphEdge = (proofGraph?.edges ?? []).find(
    (edge) =>
      String(edge?.from ?? "") === String(expected?.from ?? "") &&
      String(edge?.to ?? "") === String(expected?.to ?? "") &&
      String(edge?.relationship ?? "") === String(expected?.relationship ?? ""),
  );
  if (graphEdge !== undefined) {
    return graphEdge;
  }
  if (
    String(expected?.from ?? "") === "" ||
    String(expected?.to ?? "") === "" ||
    String(expected?.relationship ?? "") === ""
  ) {
    return null;
  }
  return expected;
}
