import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

export function selectedProofGraphDependencyHandoffSummaries({
  nextAction,
  proofGraph,
  dependencies,
}) {
  const unproven = nextAction?.nextAction?.unproven;
  return (dependencies ?? []).flatMap((dependency) => {
    if (!selectedProofGraphDependencyApplies({ unproven, dependency })) {
      return [];
    }
    return selectedProofGraphDependencyEdges({
      proofGraph,
      dependency,
    }).map((edge) => selectedProofGraphDependencyEdgeHandoff(edge));
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

export function proofGraphEdgeStatusText(edge) {
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
  ].join(" ");
}

function selectedProofGraphDependencyApplies({ unproven, dependency }) {
  if (unproven === null || unproven === undefined) {
    return false;
  }
  const selectedNodeId = String(dependency?.selectedProofGraphNodeId ?? "");
  if (
    selectedNodeId !== "" &&
    String(unproven.proofGraphNodeId ?? "") !== selectedNodeId
  ) {
    return false;
  }
  const unprovenId = String(dependency?.unprovenId ?? "");
  if (unprovenId !== "" && String(unproven.id ?? "") !== unprovenId) {
    return false;
  }
  const roleUrlIncludes = dependency?.roleUrlIncludes;
  if (Array.isArray(roleUrlIncludes) && roleUrlIncludes.length > 0) {
    const roleUrl = String(unproven.roleUrl ?? "");
    return roleUrlIncludes.every((part) => roleUrl.includes(String(part)));
  }
  if (typeof roleUrlIncludes === "string" && roleUrlIncludes !== "") {
    return String(unproven.roleUrl ?? "").includes(roleUrlIncludes);
  }
  return true;
}

function selectedProofGraphDependencyEdges({ proofGraph, dependency }) {
  return (dependency?.edges ?? [])
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

function selectedProofGraphDependencyEdgeHandoff(edge) {
  const edgeRowId = proofGraphEdgeCheckId(edge);
  return {
    linkId: edgeRowId,
    auditId: localAdminAuditIds.proofGraph,
    requiredCheckIds: [edgeRowId, String(edge.from), String(edge.to)],
    requiredCheckStatuses: {
      [edgeRowId]: proofGraphEdgeStatusText(edge),
    },
    requiredRelatedLinkIds: [String(edge.from), String(edge.to)],
  };
}
