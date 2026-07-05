import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export function productionFeatureGraphCoverageDecisionCheckId(selectedGraph) {
  const nodeId = String(selectedGraph?.nodeId ?? "");
  return nodeId === "" ? "" : `coverage-decision:${nodeId}`;
}

export function assertSelectedProofGraphDestinationText({
  graphDestination,
  selectedProofGraphNode,
  errorMessage = "next-action admin proof did not prove selected proof graph destination text",
}) {
  const selectedNodeId = String(selectedProofGraphNode?.id ?? "");
  assertSelectedGraphDestinationText({
    graphDestination,
    requiredCheckIds: [selectedNodeId],
    requiredCheckText: {
      [selectedNodeId]: selectedProofGraphDestinationTextTokens(
        selectedProofGraphNode,
      ),
    },
    errorMessage,
  });
}

export function assertSelectedProductionFeatureGraphDestinationText({
  graphDestination,
  selectedProductionFeatureGraph,
  errorMessage = "next-action admin proof did not prove selected production feature graph destination text",
}) {
  const nodeId = String(selectedProductionFeatureGraph?.nodeId ?? "");
  const coverageDecisionCheckId = productionFeatureGraphCoverageDecisionCheckId(
    selectedProductionFeatureGraph,
  );
  const coverageDecisionTokens = coverageDecisionTextTokens(
    selectedProductionFeatureGraph?.coverageDecision,
  );
  assertSelectedGraphDestinationText({
    graphDestination,
    requiredCheckIds: [
      nodeId,
      ...(coverageDecisionTokens.length === 0 ? [] : [coverageDecisionCheckId]),
    ],
    requiredCheckText: {
      [nodeId]: selectedProductionFeatureGraphDestinationTextTokens(
        selectedProductionFeatureGraph,
      ),
      ...(coverageDecisionTokens.length === 0
        ? {}
        : { [coverageDecisionCheckId]: coverageDecisionTokens }),
    },
    errorMessage,
  });
}

function assertSelectedGraphDestinationText({
  graphDestination,
  requiredCheckIds,
  requiredCheckText,
  errorMessage,
}) {
  if (
    graphDestination === null ||
    graphDestination === undefined ||
    graphDestination.detailRoleUrl !==
      localAdminAuditRoleUrl(localAdminAuditIds.proofGraph)
  ) {
    throw new Error(errorMessage);
  }
  for (const checkId of requiredCheckIds) {
    if (checkId === "" || !graphDestination.visibleChecks?.includes(checkId)) {
      throw new Error(errorMessage);
    }
  }
  for (const [checkId, tokens] of Object.entries(requiredCheckText)) {
    const visibleText = graphDestination.visibleCheckStatuses?.[checkId] ?? "";
    if (
      typeof visibleText !== "string" ||
      tokens.some((token) => !visibleText.includes(token))
    ) {
      throw new Error(errorMessage);
    }
  }
}

function selectedProofGraphDestinationTextTokens(selectedProofGraphNode) {
  return [
    String(selectedProofGraphNode?.roleUrl ?? "").trim(),
    String(
      selectedProofGraphNode?.graphProofCommand ??
        selectedProofGraphNode?.proofCommand ??
        "",
    ).trim(),
  ].filter((token) => token !== "");
}

function selectedProductionFeatureGraphDestinationTextTokens(selectedGraph) {
  return [
    String(selectedGraph?.nodeId ?? "").trim(),
    String(selectedGraph?.roleUrl ?? "").trim(),
    String(selectedGraph?.targetRoleUrl ?? "").trim(),
    String(selectedGraph?.browserProofCommand ?? "").trim(),
  ].filter((token) => token !== "");
}

function coverageDecisionTextTokens(coverageDecision) {
  if (coverageDecision === null || typeof coverageDecision !== "object") {
    return [];
  }
  return [
    String(coverageDecision.kind ?? "").trim(),
    String(coverageDecision.proofCommand ?? "").trim() ||
      String(coverageDecision.recoveryCommand ?? "").trim() ||
      String(coverageDecision.reason ?? "").trim() ||
      String(coverageDecision.prerequisiteCheckId ?? "").trim() ||
      String(coverageDecision.nextDecisionTrigger ?? "").trim(),
  ].filter((token) => token !== "");
}
