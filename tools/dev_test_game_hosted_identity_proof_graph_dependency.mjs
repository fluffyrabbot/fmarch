import {
  devTestGameHostedIdentityOperatorAdminProofCommand,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityProgressionAdminProofBatchCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProofGraphNodeId,
  hostedIdentityFamilyBatchOperatorProofGraphRelationship,
  hostedIdentityFamilyBatchProofGraphNodeId,
  hostedIdentityOperatorAdminSurfaceProofGraphRelationship,
  hostedIdentityOperatorPredicateProofGraphNodeId,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export const hostedIdentityProofGraphDependencyId =
  "hosted-identity-proof-graph-dependency";
export const hostedIdentityProofGraphDependencyBoundary =
  "Hosted identity proof graph dependency. This next-action row links the family proof batch, operator predicate proof, and hosted identity admin surface graph edges; it records local graph topology only and does not prove live hosted identity traffic, release readiness, or production readiness.";

export function hostedIdentityOperatorDependencyProofGraphNodes() {
  const roleUrl = localAdminAuditRoleUrl(
    localAdminAuditIds.hostedIdentityEvidence,
  );
  const familyBatchCommand = hostedIdentityFamilyBatchProofCommand();
  const operatorCommand = hostedIdentityOperatorProofCommand();
  return [
    {
      id: hostedIdentityFamilyBatchProofGraphNodeId,
      label: "Hosted identity family proof batch",
      kind: "hosted-identity-family-proof-batch",
      status: "recorded",
      artifact: devTestGameHostedIdentityProgressionSummaryPath,
      roleUrl,
      proofCommand: familyBatchCommand,
      recoveryCommand: familyBatchCommand,
      progressionCount: hostedIdentityEvidenceFamilyProgressionCases.length,
      progressionIds: hostedIdentityFamilyProgressionIds(),
      proofTargets: hostedIdentityFamilyProofTargets(),
      proofBoundary:
        "Hosted identity family proof batch prerequisite. This graph node records that every hosted identity evidence-family admin proof target is a prerequisite before the operator predicate proof may run; it does not validate those artifacts or prove live hosted identity traffic, release readiness, or production readiness.",
    },
    {
      id: hostedIdentityOperatorPredicateProofGraphNodeId,
      label: "Hosted identity operator predicate proof",
      kind: "hosted-identity-operator-predicate-proof",
      status: "recorded",
      artifact: devTestGameHostedIdentityOperatorAdminProofPath,
      roleUrl,
      proofCommand: operatorCommand,
      recoveryCommand: operatorCommand,
      prerequisiteNodeId: hostedIdentityFamilyBatchProofGraphNodeId,
      auditSurfaceNodeId: hostedIdentityEvidenceProofGraphNodeId,
      proofBoundary:
        "Hosted identity operator predicate proof. This graph node records the target-local redacted operator packet predicate that can clear the hosted-production-identity readiness item over the existing role-surface adapter; it does not validate the artifact or prove live hosted identity traffic, release readiness, or production readiness.",
    },
  ];
}

export function hostedIdentityOperatorDependencyProofGraphEdgeRows(nodes) {
  const nodeIds = new Set((nodes ?? []).map((node) => node.id));
  if (
    !nodeIds.has(hostedIdentityFamilyBatchProofGraphNodeId) ||
    !nodeIds.has(hostedIdentityOperatorPredicateProofGraphNodeId) ||
    !nodeIds.has(hostedIdentityEvidenceProofGraphNodeId)
  ) {
    return [];
  }
  return hostedIdentityOperatorDependencyExpectedEdges().map((edge) => [
    edge.from,
    edge.to,
    edge.relationship,
    {
      command: edge.command,
      proofTarget: edge.proofTarget,
    },
  ]);
}

export function assertHostedIdentityProofGraphDependency(graph) {
  assertHostedIdentityProofGraphDependencyNodes(graph);
  const dependency = hostedIdentityProofGraphDependencyFromGraph(graph);
  if (dependency === undefined) {
    throw new Error("proof graph hosted identity operator dependency missing");
  }
  if (!validHostedIdentityProofGraphDependency(dependency)) {
    throw new Error("proof graph hosted identity operator dependency drifted");
  }
  return dependency;
}

export function hostedIdentityProofGraphDependencyFromGraph(graph) {
  const familyBatchNode = (graph?.nodes ?? []).find(
    (node) => node?.id === hostedIdentityFamilyBatchProofGraphNodeId,
  );
  const operatorNode = (graph?.nodes ?? []).find(
    (node) => node?.id === hostedIdentityOperatorPredicateProofGraphNodeId,
  );
  const adminSurfaceNode = (graph?.nodes ?? []).find(
    (node) => node?.id === hostedIdentityEvidenceProofGraphNodeId,
  );
  const expectedEdges = hostedIdentityOperatorDependencyExpectedEdges();
  const edges = expectedEdges.map((expected) =>
    (graph?.edges ?? []).find(
      (edge) =>
        edge?.from === expected.from &&
        edge?.to === expected.to &&
        edge?.relationship === expected.relationship,
    ),
  );
  if (
    familyBatchNode === undefined ||
    operatorNode === undefined ||
    adminSurfaceNode === undefined ||
    edges.some((edge) => edge === undefined)
  ) {
    return undefined;
  }
  return {
    id: hostedIdentityProofGraphDependencyId,
    status: "recorded",
    proofGraphRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
    familyBatchNodeId: hostedIdentityFamilyBatchProofGraphNodeId,
    operatorPredicateNodeId: hostedIdentityOperatorPredicateProofGraphNodeId,
    adminSurfaceNodeId: hostedIdentityEvidenceProofGraphNodeId,
    familyProofTargets: Array.isArray(familyBatchNode.proofTargets)
      ? familyBatchNode.proofTargets.map((target) => String(target))
      : [],
    operatorProofTarget: String(operatorNode.artifact ?? ""),
    edges: edges.map((edge) => ({
      id: hostedIdentityProofGraphEdgeCheckId(edge),
      from: String(edge.from ?? ""),
      to: String(edge.to ?? ""),
      relationship: String(edge.relationship ?? ""),
      command: String(edge.command ?? ""),
      proofTarget: String(edge.proofTarget ?? ""),
    })),
    proofBoundary: hostedIdentityProofGraphDependencyBoundary,
  };
}

export function validHostedIdentityProofGraphDependency(dependency) {
  const expectedEdges = hostedIdentityOperatorDependencyExpectedEdges();
  return (
    dependency !== null &&
    typeof dependency === "object" &&
    dependency.id === hostedIdentityProofGraphDependencyId &&
    dependency.status === "recorded" &&
    dependency.proofGraphRoleUrl ===
      localAdminAuditRoleUrl(localAdminAuditIds.proofGraph) &&
    dependency.familyBatchNodeId === hostedIdentityFamilyBatchProofGraphNodeId &&
    dependency.operatorPredicateNodeId ===
      hostedIdentityOperatorPredicateProofGraphNodeId &&
    dependency.adminSurfaceNodeId === hostedIdentityEvidenceProofGraphNodeId &&
    sameStringArray(
      dependency.familyProofTargets,
      hostedIdentityFamilyProofTargets(),
    ) &&
    dependency.operatorProofTarget ===
      devTestGameHostedIdentityOperatorAdminProofPath &&
    Array.isArray(dependency.edges) &&
    dependency.edges.length === expectedEdges.length &&
    dependency.edges.every((edge, index) => {
      const expected = expectedEdges[index];
      return (
        edge.id === hostedIdentityProofGraphEdgeCheckId(expected) &&
        edge.from === expected.from &&
        edge.to === expected.to &&
        edge.relationship === expected.relationship &&
        edge.command === expected.command &&
        edge.proofTarget === expected.proofTarget
      );
    }) &&
    typeof dependency.proofBoundary === "string" &&
    dependency.proofBoundary.includes("does not prove live hosted identity traffic")
  );
}

export function assertHostedIdentityProofGraphDependencyNodes(graph) {
  const batchNode = (graph.nodes ?? []).find(
    (node) => node.id === hostedIdentityFamilyBatchProofGraphNodeId,
  );
  const [expectedBatchNode, expectedOperatorNode] =
    hostedIdentityOperatorDependencyProofGraphNodes();
  if (batchNode?.kind !== expectedBatchNode.kind) {
    throw new Error("proof graph hosted identity family batch node drifted");
  }
  assertNodeMatches(batchNode, expectedBatchNode, [
    "status",
    "artifact",
    "roleUrl",
    "proofCommand",
    "recoveryCommand",
    "progressionCount",
  ], "proof graph hosted identity family batch");
  if (
    !sameStringArray(batchNode.progressionIds, expectedBatchNode.progressionIds)
  ) {
    throw new Error(
      "proof graph hosted identity family batch progression ids drifted",
    );
  }
  if (!sameStringArray(batchNode.proofTargets, expectedBatchNode.proofTargets)) {
    throw new Error(
      "proof graph hosted identity family batch proof targets drifted",
    );
  }
  if (
    !String(batchNode.proofBoundary ?? "").includes(
      "does not validate those artifacts or prove live hosted identity traffic",
    )
  ) {
    throw new Error(
      "proof graph hosted identity family batch boundary drifted",
    );
  }
  const operatorNode = (graph.nodes ?? []).find(
    (node) => node.id === hostedIdentityOperatorPredicateProofGraphNodeId,
  );
  if (operatorNode?.kind !== expectedOperatorNode.kind) {
    throw new Error("proof graph hosted identity operator predicate node drifted");
  }
  assertNodeMatches(operatorNode, expectedOperatorNode, [
    "status",
    "artifact",
    "roleUrl",
    "proofCommand",
    "recoveryCommand",
    "prerequisiteNodeId",
    "auditSurfaceNodeId",
  ], "proof graph hosted identity operator predicate");
  if (
    !String(operatorNode.proofBoundary ?? "").includes(
      "does not validate the artifact or prove live hosted identity traffic",
    )
  ) {
    throw new Error("proof graph hosted identity operator predicate node drifted");
  }
  return graph;
}

export function hostedIdentityProofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

function hostedIdentityOperatorDependencyExpectedEdges() {
  return [
    {
      from: hostedIdentityFamilyBatchProofGraphNodeId,
      to: hostedIdentityOperatorPredicateProofGraphNodeId,
      relationship: hostedIdentityFamilyBatchOperatorProofGraphRelationship,
      command: hostedIdentityFamilyBatchProofCommand(),
      proofTarget: devTestGameHostedIdentityOperatorAdminProofPath,
    },
    {
      from: hostedIdentityOperatorPredicateProofGraphNodeId,
      to: hostedIdentityEvidenceProofGraphNodeId,
      relationship: hostedIdentityOperatorAdminSurfaceProofGraphRelationship,
      command: hostedIdentityOperatorProofCommand(),
      proofTarget: devTestGameHostedIdentityOperatorAdminProofPath,
    },
  ];
}

function hostedIdentityFamilyBatchProofCommand() {
  return `npm run ${devTestGameHostedIdentityProgressionAdminProofBatchCommand}`;
}

function hostedIdentityOperatorProofCommand() {
  return `npm run ${devTestGameHostedIdentityOperatorAdminProofCommand}`;
}

function hostedIdentityFamilyProgressionIds() {
  return hostedIdentityEvidenceFamilyProgressionCases.map(
    (progression) => progression.id,
  );
}

function hostedIdentityFamilyProofTargets() {
  return hostedIdentityEvidenceFamilyProgressionCases.map((progression) =>
    hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
  );
}

function assertNodeMatches(node, expected, fields, label) {
  for (const field of fields) {
    if (node?.[field] !== expected[field]) {
      throw new Error(`${label} ${field} drifted`);
    }
  }
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
