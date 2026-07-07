export function selectedProofGraphNodeRelatedLinkDescriptor(
  selectedProofGraphNode,
) {
  return Object.freeze({
    id: "selected-proof-graph-node",
    label: String(selectedProofGraphNode?.id ?? ""),
    status: String(selectedProofGraphNode?.status ?? ""),
    command: String(selectedProofGraphNode?.proofCommand ?? ""),
  });
}

export function selectedProductionFeatureGraphRelatedLinkDescriptor(
  selectedProductionFeatureGraph,
) {
  return Object.freeze({
    id: String(selectedProductionFeatureGraph?.nodeId ?? ""),
    label: String(selectedProductionFeatureGraph?.nodeId ?? ""),
    status: String(selectedProductionFeatureGraph?.status ?? ""),
    command: String(
      selectedProductionFeatureGraph?.browserProofCommand ?? "",
    ),
  });
}

export function selectedProofGraphNodeCheckRows({
  selectedProofGraphNode = null,
  selectedProofGraphNodeStatus = "",
} = {}) {
  return selectedProofGraphNode === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-proof-graph-node",
          status: selectedProofGraphNodeStatus,
        }),
        Object.freeze({
          id: "selected-proof-graph-destination",
          status: `${selectedProofGraphNode.id}:${
            selectedProofGraphNode.auditId || "unknown"
          }`,
        }),
      ]);
}

export function selectedProductionFeatureGraphCheckRows({
  selectedProductionFeatureGraph = null,
} = {}) {
  const edgeFrom = String(
    selectedProductionFeatureGraph?.edgeFrom ??
      selectedProductionFeatureGraph?.edge?.from ??
      "",
  );
  const edgeTo = String(
    selectedProductionFeatureGraph?.edgeTo ??
      selectedProductionFeatureGraph?.edge?.to ??
      "",
  );
  return String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-production-feature-graph-node",
          status: `${selectedProductionFeatureGraph.nodeId}:${selectedProductionFeatureGraph.status}`,
        }),
        Object.freeze({
          id: "selected-production-feature-graph-edge",
          status: `${edgeFrom}->${edgeTo}`,
        }),
        ...(selectedProductionFeatureGraph.browserWorkbench == null
          ? []
          : [
              Object.freeze({
                id: "selected-production-feature-graph-browser-workbench",
                status:
                  selectedProductionFeatureGraph.browserWorkbench
                    .requiredEvidence,
              }),
            ]),
        ...coverageDecisionCheckRows({
          parentId: "selected-production-feature-graph",
          rowId: "selected-production-feature-graph-coverage-decision",
          coverageDecision: selectedProductionFeatureGraph.coverageDecision,
        }),
      ]);
}

export function selectedProofGraphDestinationTextTokens(
  selectedProofGraphNode,
) {
  return [
    String(selectedProofGraphNode?.roleUrl ?? "").trim(),
    String(
      selectedProofGraphNode?.graphProofCommand ??
        selectedProofGraphNode?.proofCommand ??
        "",
    ).trim(),
  ].filter((token) => token !== "");
}

export function selectedProductionFeatureGraphDestinationTextTokens(
  selectedGraph,
) {
  return [
    String(selectedGraph?.nodeId ?? "").trim(),
    String(selectedGraph?.roleUrl ?? "").trim(),
    String(selectedGraph?.targetRoleUrl ?? "").trim(),
    String(selectedGraph?.browserProofCommand ?? "").trim(),
    String(selectedGraph?.browserWorkbench?.requiredEvidence ?? "").trim(),
  ].filter((token) => token !== "");
}

export function selectedProductionFeatureGraphDestinationCheckText(
  selectedGraph,
) {
  const nodeId = String(selectedGraph?.nodeId ?? "");
  const coverageDecisionTokens = coverageDecisionTextTokens(
    selectedGraph?.coverageDecision,
  );
  const coverageDecisionCheckId =
    productionFeatureGraphCoverageDecisionCheckId(selectedGraph);
  return Object.freeze({
    [nodeId]: selectedProductionFeatureGraphDestinationTextTokens(
      selectedGraph,
    ),
    ...(coverageDecisionTokens.length === 0
      ? {}
      : { [coverageDecisionCheckId]: coverageDecisionTokens }),
  });
}

export function selectedProductionFeatureGraphDestinationCheckIds(
  selectedGraph,
) {
  const coverageDecisionTokens = coverageDecisionTextTokens(
    selectedGraph?.coverageDecision,
  );
  return Object.freeze([
    String(selectedGraph?.nodeId ?? ""),
    ...(coverageDecisionTokens.length === 0
      ? []
      : [productionFeatureGraphCoverageDecisionCheckId(selectedGraph)]),
  ]);
}

export function productionFeatureGraphCoverageDecisionCheckId(selectedGraph) {
  const nodeId = String(selectedGraph?.nodeId ?? "");
  return nodeId === "" ? "" : `coverage-decision:${nodeId}`;
}

export function coverageDecisionCheckRows({
  parentId,
  coverageDecision,
  rowId = `coverage-decision:${parentId}`,
}) {
  const status = coverageDecisionStatus(coverageDecision);
  return status === ""
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: rowId,
          status,
        }),
      ]);
}

export function coverageDecisionStatus(coverageDecision) {
  if (coverageDecision === null || typeof coverageDecision !== "object") {
    return "";
  }
  const kind = String(coverageDecision.kind ?? "");
  if (kind === "") {
    return "";
  }
  const detail =
    String(coverageDecision.proofCommand ?? "").trim() ||
    String(coverageDecision.recoveryCommand ?? "").trim() ||
    String(coverageDecision.reason ?? "").trim() ||
    String(coverageDecision.prerequisiteCheckId ?? "").trim() ||
    String(coverageDecision.nextDecisionTrigger ?? "").trim();
  return detail === "" ? kind : `${kind}:${detail}`;
}

export function coverageDecisionTextTokens(coverageDecision) {
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
