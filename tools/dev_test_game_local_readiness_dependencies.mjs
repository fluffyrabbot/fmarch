import {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
} from "./dev_test_game_proof_graph_paths.mjs";

export const localProofGraphAdminRoleHandoffsCheckId =
  "local-proof-graph-admin-role-handoffs";

export const localReadinessDependencies = Object.freeze([
  Object.freeze({
    id: localProofGraphAdminRoleHandoffsCheckId,
    label: "Proof graph admin role handoffs",
    priority: 0,
    command: `npm run ${devTestGameProofGraphAdminProofCommand}`,
    buildSlice:
      "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
    proofTarget: devTestGameProofGraphAdminProofPath,
    roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
    proofBoundary:
      "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
  }),
]);

const localReadinessDependencyById = new Map(
  localReadinessDependencies.map((dependency) => [dependency.id, dependency]),
);

export function getLocalReadinessDependency(id) {
  return localReadinessDependencyById.get(id);
}

export function rankedMissingLocalReadinessDependencies(readiness) {
  if (readiness === null) {
    return [];
  }
  const localChecks = new Map(
    (readiness.localDevelopmentSpine?.checks ?? []).map((check, index) => [
      check.id,
      { check, index },
    ]),
  );
  return localReadinessDependencies
    .map((dependency, index) => {
      const current = localChecks.get(dependency.id);
      return current?.check?.status === "passed"
        ? null
        : {
            id: dependency.id,
            status: current?.check?.status ?? "missing",
            index,
            priority: dependency.priority,
            command: dependency.command,
            buildSlice: dependency.buildSlice,
            proofTarget: dependency.proofTarget,
            roleUrl: dependency.roleUrl,
            proofBoundary: dependency.proofBoundary,
            requiredEvidence: dependency.requiredEvidence,
          };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => left.priority - right.priority || left.index - right.index);
}

export function buildProofGraphAdminRoleHandoffsReadinessCheck(
  proofGraphAdminProofEvidence,
) {
  const dependency = getLocalReadinessDependency(
    localProofGraphAdminRoleHandoffsCheckId,
  );
  if (dependency === undefined) {
    throw new Error(
      "proof graph admin handoff readiness dependency is missing a recovery contract",
    );
  }
  return {
    id: dependency.id,
    label: dependency.label,
    status: "passed",
    evidence: proofGraphAdminProofEvidence.path,
    proofBoundary: proofGraphAdminProofEvidence.proofBoundary,
    roleHandoffCount: proofGraphAdminProofEvidence.roleHandoffCount,
    roleHandoffIds: proofGraphAdminProofEvidence.roleHandoffIds,
    destinationAuditIds: proofGraphAdminProofEvidence.destinationAuditIds,
    adminRoleSurface: proofGraphAdminProofEvidence,
  };
}
