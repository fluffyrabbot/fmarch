import {
  getLocalReadinessDependency,
} from "./dev_test_game_local_readiness_dependencies.mjs";

export const proofGraphPrerequisiteDestinationSectionId =
  "proof-graph-prerequisite-destinations";
export const proofGraphPrerequisiteDestinationSectionHeading =
  "Proof graph prerequisite destinations";
export const proofGraphPrerequisiteDestinationRowTestIdPrefix =
  "admin-audit-proof-graph-prerequisite-destination";
export const proofGraphPrerequisiteDestinationRoleUrlTestIdPrefix =
  "admin-audit-proof-graph-prerequisite-destination-role-url";
export const proofGraphPrerequisiteDestinationProofTargetTestIdPrefix =
  "admin-audit-proof-graph-prerequisite-destination-proof-target";

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

export function proofGraphPrerequisiteDestinationProofTargetTestId(rowId) {
  return `${proofGraphPrerequisiteDestinationProofTargetTestIdPrefix}-${String(rowId)}`;
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
      proofTarget: String(
        destination?.proofTarget ??
          getLocalReadinessDependency(destinationId)?.proofTarget ??
          "",
      ),
      rowId,
      rowTestId: proofGraphPrerequisiteDestinationRowTestId(rowId),
      roleUrlTestId: proofGraphPrerequisiteDestinationRoleUrlTestId(rowId),
      proofTargetTestId: proofGraphPrerequisiteDestinationProofTargetTestId(rowId),
    });
  });
}
