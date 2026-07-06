export const proofGraphPrerequisiteDestinationSectionId =
  "proof-graph-prerequisite-destinations";
export const proofGraphPrerequisiteDestinationSectionHeading =
  "Proof graph prerequisite destinations";
export const proofGraphPrerequisiteDestinationRowTestIdPrefix =
  "admin-audit-proof-graph-prerequisite-destination";
export const proofGraphPrerequisiteDestinationRoleUrlTestIdPrefix =
  "admin-audit-proof-graph-prerequisite-destination-role-url";

export function proofGraphPrerequisiteDestinationRows(proofGraph) {
  return proofGraphPrerequisiteDestinationRowsFromNodes(proofGraph?.nodes);
}

export function proofGraphPrerequisiteDestinationRowsFromNodes(nodes) {
  return Object.freeze(
    (Array.isArray(nodes) ? nodes : []).flatMap((node) =>
      proofGraphPrerequisiteDestinationRowsForNode(node),
    ),
  );
}

export function proofGraphPrerequisiteDestinationRowIds(proofGraph) {
  return Object.freeze(
    proofGraphPrerequisiteDestinationRows(proofGraph).map((row) => row.rowId),
  );
}

export function proofGraphPrerequisiteDestinationRowId({
  nodeId,
  destinationId,
}) {
  return `${String(nodeId ?? "")}:${String(destinationId ?? "")}`;
}

export function proofGraphPrerequisiteDestinationRowTestId(rowId) {
  return `${proofGraphPrerequisiteDestinationRowTestIdPrefix}-${String(rowId)}`;
}

export function proofGraphPrerequisiteDestinationRoleUrlTestId(rowId) {
  return `${proofGraphPrerequisiteDestinationRoleUrlTestIdPrefix}-${String(rowId)}`;
}

function proofGraphPrerequisiteDestinationRowsForNode(node) {
  const nodeId = String(node?.id ?? "");
  const destinations = Array.isArray(node?.requiredLocalPrerequisiteDestinations)
    ? node.requiredLocalPrerequisiteDestinations
    : [];
  return destinations.map((destination) => {
    const destinationId = String(destination?.id ?? "");
    const rowId = proofGraphPrerequisiteDestinationRowId({
      nodeId,
      destinationId,
    });
    return Object.freeze({
      nodeId,
      destinationId,
      auditId: String(destination?.auditId ?? ""),
      roleUrl: String(destination?.roleUrl ?? ""),
      rowId,
      rowTestId: proofGraphPrerequisiteDestinationRowTestId(rowId),
      roleUrlTestId: proofGraphPrerequisiteDestinationRoleUrlTestId(rowId),
    });
  });
}
