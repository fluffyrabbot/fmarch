import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export const selectedNextActionGraphDestinationCases = Object.freeze([
  Object.freeze({
    id: "selected-proof-graph-node",
    label: "selected proof graph node",
    subjectFromGeneratedFrom: (generatedFrom) =>
      selectedProofGraphNodeFromGeneratedFrom(generatedFrom),
    destinationLinkId: () => "selected-proof-graph-node",
    localCheckIds: () => [
      "selected-proof-graph-node",
      "selected-proof-graph-destination",
    ],
    localRelatedLinkIds: () => ["selected-proof-graph-node"],
    destinationCheckIds: (subject) => [String(subject?.id ?? "")],
    destinationCheckText: (subject) => ({
      [String(subject?.id ?? "")]: selectedProofGraphDestinationTextTokens(
        subject,
      ),
    }),
    proofMissingMessage:
      "next-action admin proof missing selected proof graph destination",
    proofTextMessage:
      "next-action admin proof did not prove selected proof graph destination text",
    readinessMissingMessage:
      "next-action admin proof missing selected proof graph destination",
    readinessTextMessage:
      "next-action admin proof did not prove selected proof graph destination",
  }),
  Object.freeze({
    id: "selected-production-feature-graph",
    label: "selected production feature graph",
    subjectFromGeneratedFrom: (generatedFrom) =>
      selectedProductionFeatureGraphFromGeneratedFrom(generatedFrom),
    destinationLinkId: (subject) => String(subject?.nodeId ?? ""),
    localCheckIds: () => [
      "selected-production-feature-graph-node",
      "selected-production-feature-graph-edge",
      "selected-production-feature-graph-coverage-decision",
    ],
    localRelatedLinkIds: (subject) => [String(subject?.nodeId ?? "")],
    destinationCheckIds: (subject) => {
      const coverageDecisionTokens = coverageDecisionTextTokens(
        subject?.coverageDecision,
      );
      return [
        String(subject?.nodeId ?? ""),
        ...(coverageDecisionTokens.length === 0
          ? []
          : [productionFeatureGraphCoverageDecisionCheckId(subject)]),
      ];
    },
    destinationCheckText: (subject) => {
      const coverageDecisionTokens = coverageDecisionTextTokens(
        subject?.coverageDecision,
      );
      const coverageDecisionCheckId =
        productionFeatureGraphCoverageDecisionCheckId(subject);
      return {
        [String(subject?.nodeId ?? "")]:
          selectedProductionFeatureGraphDestinationTextTokens(subject),
        ...(coverageDecisionTokens.length === 0
          ? {}
          : { [coverageDecisionCheckId]: coverageDecisionTokens }),
      };
    },
    proofMissingMessage:
      "next-action admin proof missing selected production feature graph destination",
    proofTextMessage:
      "next-action admin proof did not prove selected production feature graph destination text",
    readinessMissingMessage:
      "next-action admin proof missing selected production feature graph destination",
    readinessTextMessage:
      "next-action admin proof did not prove selected production feature graph destination",
  }),
]);

export function selectedNextActionGraphDestinationCaseForId(caseId) {
  return (
    selectedNextActionGraphDestinationCases.find(
      (destinationCase) => destinationCase.id === caseId,
    ) ?? null
  );
}

export function productionFeatureGraphCoverageDecisionCheckId(selectedGraph) {
  const nodeId = String(selectedGraph?.nodeId ?? "");
  return nodeId === "" ? "" : `coverage-decision:${nodeId}`;
}

export function selectedGraphDestinationSubject({
  destinationCase,
  generatedFrom,
}) {
  return destinationCase?.subjectFromGeneratedFrom(generatedFrom) ?? null;
}

export function selectedGraphDestinationLinkId({ destinationCase, subject }) {
  return String(destinationCase?.destinationLinkId(subject) ?? "");
}

export function selectedGraphDestinationLocalCheckIds({
  destinationCase,
  subject,
}) {
  return destinationCase?.localCheckIds(subject) ?? [];
}

export function selectedGraphDestinationLocalRelatedLinkIds({
  destinationCase,
  subject,
}) {
  return destinationCase?.localRelatedLinkIds(subject) ?? [];
}

export function selectedGraphDestinationRequiredCheckIds({
  destinationCase,
  subject,
}) {
  return destinationCase?.destinationCheckIds(subject) ?? [];
}

export function selectedGraphDestinationRequiredCheckText({
  destinationCase,
  subject,
}) {
  return destinationCase?.destinationCheckText(subject) ?? {};
}

export function assertSelectedGraphDestinationCaseText({
  destinationCase,
  graphDestination,
  subject,
  errorMessage,
}) {
  assertSelectedGraphDestinationText({
    graphDestination,
    requiredCheckIds: selectedGraphDestinationRequiredCheckIds({
      destinationCase,
      subject,
    }),
    requiredCheckText: selectedGraphDestinationRequiredCheckText({
      destinationCase,
      subject,
    }),
    errorMessage: errorMessage ?? destinationCase?.proofTextMessage,
  });
}

export function assertSelectedGraphDestinationCaseSurface({
  destinationCase,
  subject,
  adminRoleSurface,
  missingErrorMessage,
  textErrorMessage,
}) {
  const missingMessage =
    missingErrorMessage ?? destinationCase?.proofMissingMessage;
  const textMessage = textErrorMessage ?? destinationCase?.proofTextMessage;
  for (const checkId of selectedGraphDestinationLocalCheckIds({
    destinationCase,
    subject,
  })) {
    if (checkId === "" || !adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(missingMessage);
    }
  }
  for (const linkId of selectedGraphDestinationLocalRelatedLinkIds({
    destinationCase,
    subject,
  })) {
    if (
      linkId === "" ||
      !adminRoleSurface?.visibleRelatedLinks?.includes(linkId)
    ) {
      throw new Error(missingMessage);
    }
  }
  const destinationLinkId = selectedGraphDestinationLinkId({
    destinationCase,
    subject,
  });
  const graphDestination =
    adminRoleSurface?.visibleRelatedDestinations?.find(
      (item) =>
        item?.linkId === destinationLinkId &&
        item.auditId === localAdminAuditIds.proofGraph,
    ) ?? null;
  assertSelectedGraphDestinationCaseText({
    destinationCase,
    graphDestination,
    subject,
    errorMessage: textMessage,
  });
  return graphDestination;
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

function selectedProofGraphNodeFromGeneratedFrom(generatedFrom) {
  const selectedProofGraphNode = generatedFrom?.selectedProofGraphNode;
  return selectedProofGraphNode !== null &&
    selectedProofGraphNode !== undefined &&
    selectedProofGraphNode.id !== undefined
    ? selectedProofGraphNode
    : null;
}

function selectedProductionFeatureGraphFromGeneratedFrom(generatedFrom) {
  const selectedProductionFeatureGraph =
    generatedFrom?.unprovenSelectedProductionFeatureGraph;
  return selectedProductionFeatureGraph !== null &&
    selectedProductionFeatureGraph !== undefined
    ? selectedProductionFeatureGraph
    : null;
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
