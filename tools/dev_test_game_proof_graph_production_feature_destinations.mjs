import {
  hostedEvidenceProgressionHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";

export const proofGraphProductionFeatureDestinationRowTestIdPrefix =
  "admin-audit-production-feature-destination-summary";

export const proofGraphProductionFeatureDestinationArtifactFields =
  Object.freeze([
    "sourceProofArtifact",
    "readinessEvidence",
    "evidencePath",
    "adminProofTarget",
  ]);

export function proofGraphProductionFeatureDestinationRowTestId(rowId) {
  return `${proofGraphProductionFeatureDestinationRowTestIdPrefix}-${String(rowId)}`;
}

export function proofGraphProductionFeatureDestinationArtifactTestId({
  rowId,
  field,
}) {
  return `${proofGraphProductionFeatureDestinationRowTestId(rowId)}-${kebabCase(field)}`;
}

export function proofGraphProductionFeatureDestinationArtifacts(summary) {
  return (Array.isArray(summary?.rows) ? summary.rows : []).flatMap((row) =>
    proofGraphProductionFeatureDestinationArtifactFields.flatMap((field) => {
      const artifact = String(row?.[field] ?? "");
      return artifact === ""
        ? []
        : [
            Object.freeze({
              rowId: String(row.id ?? ""),
              field,
              artifact,
            }),
          ];
    }),
  );
}

export function proofGraphProductionFeatureTargetDestinations(proofGraph) {
  return productionFeatureTargetNodes(proofGraph).map((node) => {
    const auditId = auditIdFromAdminRoleUrl(node.roleUrl);
    if (auditId !== null) {
      return Object.freeze({
        kind: "admin-audit",
        linkId: String(node.id ?? ""),
        auditId,
        detailRoleUrl: `/admin/audit/${auditId}?game=<seeded-game>`,
        featureSlotId: String(node.featureSlotId ?? ""),
        sourceCheckId: String(node.sourceCheckId ?? ""),
        targetRoleUrl: String(node.targetRoleUrl ?? ""),
        adminCheckId: String(node.adminCheckId ?? ""),
        sourceProofArtifact: String(node.sourceProofArtifact ?? ""),
        requiredChecks: Object.freeze([String(node.adminCheckId ?? "")]),
        ...(node.browserWorkbench === null ||
        typeof node.browserWorkbench !== "object"
          ? {}
          : { browserWorkbench: Object.freeze({ ...node.browserWorkbench }) }),
        ...(typeof node.readinessEvidence === "string" &&
        node.readinessEvidence.trim() !== ""
          ? { readinessEvidence: String(node.readinessEvidence) }
          : {}),
      });
    }
    return Object.freeze({
      kind: "role-url",
      linkId: String(node.id ?? ""),
      featureSlotId: String(node.featureSlotId ?? ""),
      sourceCheckId: String(node.sourceCheckId ?? ""),
      roleUrl: String(node.roleUrl ?? ""),
      targetRoleUrl: String(node.targetRoleUrl ?? ""),
      adminCheckId: String(node.adminCheckId ?? ""),
      sourceProofArtifact: String(node.sourceProofArtifact ?? ""),
      ...(typeof node.adminDetailRoleUrl === "string" &&
      node.adminDetailRoleUrl.trim() !== ""
        ? { adminDetailRoleUrl: String(node.adminDetailRoleUrl) }
        : {}),
      ...(typeof node.recoveryCommand === "string" &&
      node.recoveryCommand.trim() !== ""
        ? { recoveryCommand: String(node.recoveryCommand) }
        : {}),
      ...(node.browserWorkbench === null ||
      typeof node.browserWorkbench !== "object"
        ? {}
        : { browserWorkbench: Object.freeze({ ...node.browserWorkbench }) }),
      ...(typeof node.readinessEvidence === "string" &&
      node.readinessEvidence.trim() !== ""
        ? { readinessEvidence: String(node.readinessEvidence) }
        : {}),
    });
  });
}

export function proofGraphProductionFeatureDestinationSummary(
  proofGraph,
  { nodes } = {},
) {
  const graphNodes = Array.isArray(nodes)
    ? productionFeatureTargetNodes({ nodes })
    : productionFeatureTargetNodes(proofGraph);
  const productionFeatureTargetCount = Number(
    proofGraph?.summary?.productionFeatureTargetCount ?? graphNodes.length,
  );
  const destinations = proofGraphProductionFeatureTargetDestinations({
    nodes: graphNodes,
  });
  const adminAuditDestinationCount = destinations.filter(
    (destination) => destination.kind === "admin-audit",
  ).length;
  const roleUrlDestinationCount = destinations.filter(
    (destination) => destination.kind === "role-url",
  ).length;
  const totalDestinationCount = destinations.length;
  const driftCount = totalDestinationCount - productionFeatureTargetCount;
  const roleUrlRows = destinations
    .filter((destination) => destination.kind === "role-url")
    .map((destination) =>
      Object.freeze({
        id: destination.linkId,
        label: `Role URL destination: ${destination.featureSlotId}`,
        status: roleUrlDestinationStatus(destination),
        roleUrl: destination.roleUrl,
        targetRoleUrl: destination.targetRoleUrl,
        sourceProofArtifact: destination.sourceProofArtifact,
        adminDetailRoleUrl: destination.adminDetailRoleUrl ?? "",
        recoveryCommand: destination.recoveryCommand ?? "",
        readinessEvidence: destination.readinessEvidence ?? "",
      }),
    );
  const hostedEvidenceProgressionSummary =
    hostedEvidenceProgressionHandoffSummary();
  const hostedEvidenceProgressionRows =
    hostedEvidenceProgressionSummary.progressions.map((progression) =>
      Object.freeze({
        id: `hosted-evidence-progression:${progression.id}`,
        label: `Hosted evidence progression: ${progression.id}`,
        status: hostedEvidenceProgressionDestinationStatus(progression),
        progressionId: progression.id,
        proofCommand: progression.proofCommand,
        evidencePath: progression.evidencePath,
        adminProofTarget: progression.adminProofTarget,
        roleUrl: progression.roleUrl,
        firstMissingInputId: progression.firstMissingInputId,
        firstMissingCheckId: progression.firstMissingCheckId,
      }),
    );
  return Object.freeze({
    status: driftCount === 0 ? "passed" : "drift",
    totalDestinationCount,
    productionFeatureTargetCount,
    adminAuditDestinationCount,
    roleUrlDestinationCount,
    driftCount,
    hostedEvidenceProgressionSummary,
    rows: Object.freeze([
      Object.freeze({
        id: "admin-audit",
        label: "Admin audit destinations",
        status: `${adminAuditDestinationCount} admin-audit destinations`,
        count: adminAuditDestinationCount,
      }),
      Object.freeze({
        id: "role-url",
        label: "Role URL destinations",
        status: `${roleUrlDestinationCount} role URL destinations`,
        count: roleUrlDestinationCount,
      }),
      Object.freeze({
        id: "total",
        label: "Production feature destinations",
        status: `${totalDestinationCount}/${productionFeatureTargetCount} production-feature destinations`,
        count: totalDestinationCount,
        expectedCount: productionFeatureTargetCount,
        driftCount,
      }),
      ...roleUrlRows,
      ...hostedEvidenceProgressionRows,
    ]),
  });
}

export function proofGraphProductionFeatureProvenanceComparison({
  manifestSummary,
  destinationSummary,
  destinations,
}) {
  const destinationGroups = productionFeatureDestinationGroups({
    destinationSummary,
    destinations,
  });
  const manifestGroups = Array.isArray(manifestSummary?.sourceCheckGroups)
    ? manifestSummary.sourceCheckGroups
    : [];
  const allSourceCheckIds = Array.from(
    new Set([
      ...manifestGroups.map((group) => String(group.sourceCheckId ?? "")),
      ...destinationGroups.map((group) => String(group.sourceCheckId ?? "")),
    ]),
  )
    .filter((sourceCheckId) => sourceCheckId !== "")
    .sort();
  const sourceCheckGroups = allSourceCheckIds.map((sourceCheckId) => {
    const manifestGroup =
      manifestGroups.find((group) => group.sourceCheckId === sourceCheckId) ??
      {};
    const destinationGroup =
      destinationGroups.find((group) => group.sourceCheckId === sourceCheckId) ??
      {};
    const manifestFeatureSlotIds = sortedStrings(
      manifestGroup.featureSlotIds ?? [],
    );
    const destinationFeatureSlotIds = sortedStrings(
      destinationGroup.featureSlotIds ?? [],
    );
    const manifestProofArtifacts = sortedStrings(
      manifestGroup.selectedProofArtifacts ?? [],
    );
    const destinationProofArtifacts = sortedStrings(
      destinationGroup.selectedProofArtifacts ?? [],
    );
    const matched =
      sameStrings(manifestFeatureSlotIds, destinationFeatureSlotIds) &&
      sameStrings(manifestProofArtifacts, destinationProofArtifacts);
    return Object.freeze({
      sourceCheckId,
      status: matched ? "matched" : "drift",
      manifestFeatureCount: manifestFeatureSlotIds.length,
      destinationFeatureCount: destinationFeatureSlotIds.length,
      manifestFeatureSlotIds: Object.freeze(manifestFeatureSlotIds),
      destinationFeatureSlotIds: Object.freeze(destinationFeatureSlotIds),
      manifestProofArtifacts: Object.freeze(manifestProofArtifacts),
      destinationProofArtifacts: Object.freeze(destinationProofArtifacts),
    });
  });
  const manifestFeatureCount = Number(manifestSummary?.featureCount ?? 0);
  const destinationFeatureCount = Number(
    destinationSummary?.totalDestinationCount ?? 0,
  );
  const driftCount = sourceCheckGroups.filter(
    (group) => group.status !== "matched",
  ).length;
  return Object.freeze({
    status:
      manifestSummary?.status === "passed" &&
      destinationSummary?.status === "passed" &&
      manifestFeatureCount === destinationFeatureCount &&
      driftCount === 0
        ? "passed"
        : "drift",
    manifestFeatureCount,
    destinationFeatureCount,
    manifestSourceCheckCount: Number(manifestSummary?.sourceCheckCount ?? 0),
    destinationSourceCheckCount: destinationGroups.length,
    driftCount,
    sourceCheckGroups: Object.freeze(sourceCheckGroups),
  });
}

export function assertProofGraphProductionFeatureProvenanceComparison(
  comparison,
  { manifestSummary, destinationSummary, destinations, requirePassed = false } = {},
) {
  const expected = proofGraphProductionFeatureProvenanceComparison({
    manifestSummary,
    destinationSummary,
    destinations,
  });
  if (JSON.stringify(comparison ?? null) !== JSON.stringify(expected)) {
    throw new Error("proof graph production feature provenance comparison drifted");
  }
  if (requirePassed && comparison.status !== "passed") {
    throw new Error(
      `proof graph production feature provenance comparison is ${comparison.status}`,
    );
  }
  return comparison;
}

function roleUrlDestinationStatus(destination) {
  return [
    `roleUrl ${destination.roleUrl}`,
    `targetRoleUrl ${destination.targetRoleUrl}`,
    `sourceProofArtifact ${destination.sourceProofArtifact}`,
    ...(destination.adminDetailRoleUrl === undefined
      ? []
      : [`adminDetailRoleUrl ${destination.adminDetailRoleUrl}`]),
    ...(destination.recoveryCommand === undefined
      ? []
      : [`recoveryCommand ${destination.recoveryCommand}`]),
    ...(destination.browserWorkbench?.requiredEvidence === undefined
      ? []
      : [`browserWorkbench ${destination.browserWorkbench.requiredEvidence}`]),
  ].join("\n");
}

function hostedEvidenceProgressionDestinationStatus(progression) {
  return [
    `adminProofMode ${progression.adminProofMode}`,
    `proofCommand ${progression.proofCommand}`,
    `evidencePath ${progression.evidencePath}`,
    `adminProofTarget ${progression.adminProofTarget}`,
    `roleUrl ${progression.roleUrl}`,
    `firstMissingInputId ${progression.firstMissingInputId}`,
    `firstMissingCheckId ${progression.firstMissingCheckId}`,
    `proofBoundary ${progression.proofBoundary}`,
  ].join("\n");
}

function productionFeatureDestinationGroups({ destinationSummary, destinations }) {
  const groups = new Map();
  const rows = Array.isArray(destinations) ? destinations : destinationSummary?.rows;
  for (const row of rows ?? []) {
    const linkId = String(row.linkId ?? row.id ?? "");
    if (!linkId.startsWith("production-feature:")) {
      continue;
    }
    const sourceCheckId = String(row.sourceCheckId ?? "");
    if (sourceCheckId === "") {
      continue;
    }
    const group = groups.get(sourceCheckId) ?? {
      sourceCheckId,
      featureSlotIds: [],
      selectedProofArtifacts: [],
    };
    group.featureSlotIds.push(String(row.featureSlotId ?? ""));
    group.selectedProofArtifacts.push(String(row.sourceProofArtifact ?? ""));
    groups.set(sourceCheckId, group);
  }
  return Array.from(groups.values())
    .map((group) => ({
      sourceCheckId: group.sourceCheckId,
      featureSlotIds: sortedStrings(group.featureSlotIds),
      selectedProofArtifacts: sortedStrings(group.selectedProofArtifacts),
    }))
    .sort((left, right) => left.sourceCheckId.localeCompare(right.sourceCheckId));
}

function sortedStrings(values) {
  return Array.from(new Set(values.map((value) => String(value ?? ""))))
    .filter((value) => value !== "")
    .sort();
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function kebabCase(value) {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function productionFeatureTargetNodes(proofGraph) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  return nodes.filter((node) => node.kind === "production-feature-spine-target");
}

function auditIdFromAdminRoleUrl(roleUrl) {
  const match = String(roleUrl ?? "").match(/^\/admin\/audit\/([^?]+)/);
  return match === null ? null : match[1];
}
