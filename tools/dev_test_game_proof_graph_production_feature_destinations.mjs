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
        adminCheckId: String(node.adminCheckId ?? ""),
        requiredChecks: Object.freeze([String(node.adminCheckId ?? "")]),
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
        adminDetailRoleUrl: destination.adminDetailRoleUrl ?? "",
        recoveryCommand: destination.recoveryCommand ?? "",
        readinessEvidence: destination.readinessEvidence ?? "",
      }),
    );
  return Object.freeze({
    status: driftCount === 0 ? "passed" : "drift",
    totalDestinationCount,
    productionFeatureTargetCount,
    adminAuditDestinationCount,
    roleUrlDestinationCount,
    driftCount,
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
    ]),
  });
}

function roleUrlDestinationStatus(destination) {
  return [
    `roleUrl ${destination.roleUrl}`,
    `targetRoleUrl ${destination.targetRoleUrl}`,
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

function productionFeatureTargetNodes(proofGraph) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  return nodes.filter((node) => node.kind === "production-feature-spine-target");
}

function auditIdFromAdminRoleUrl(roleUrl) {
  const match = String(roleUrl ?? "").match(/^\/admin\/audit\/([^?]+)/);
  return match === null ? null : match[1];
}
