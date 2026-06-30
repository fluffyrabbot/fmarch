import {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";

export const localProofGraphAdminRoleHandoffsCheckId =
  "local-proof-graph-admin-role-handoffs";
export const localNextActionAdminSurfaceCheckId =
  "local-next-action-admin-surface";

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
  Object.freeze({
    id: localNextActionAdminSurfaceCheckId,
    label: "Next-action admin surface",
    priority: 1,
    command: `npm run ${nextActionAdminProofCommand}`,
    buildSlice:
      "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
    proofTarget: nextActionAdminProofPath,
    roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
    proofBoundary:
      "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed next-action admin surface check in the generated release-readiness checklist",
  }),
]);

const localReadinessDependencyById = new Map(
  localReadinessDependencies.map((dependency) => [dependency.id, dependency]),
);

assertLocalReadinessDependencyRegistry();

export function getLocalReadinessDependency(id) {
  return localReadinessDependencyById.get(id);
}

export function assertLocalReadinessDependencyRegistry() {
  const ids = new Set();
  for (const dependency of localReadinessDependencies) {
    if (ids.has(dependency.id)) {
      throw new Error(`duplicate local readiness dependency id: ${dependency.id}`);
    }
    ids.add(dependency.id);
    assertLocalReadinessDependencyDescriptor(dependency);
  }
  return localReadinessDependencies;
}

export function assertLocalReadinessDependencyChecks(checks) {
  assertLocalReadinessDependencyRegistry();
  for (const check of checks ?? []) {
    const dependency = getLocalReadinessDependency(check?.id);
    if (check?.dependencyGated === true && dependency === undefined) {
      throw new Error(
        `local readiness dependency check ${check?.id} has no recovery contract`,
      );
    }
    if (dependency === undefined) {
      continue;
    }
    if (check.dependencyGated !== true) {
      throw new Error(
        `local readiness dependency check ${check.id} is missing dependencyGated=true`,
      );
    }
    assertLocalReadinessDependencyCheckMatchesContract(check, dependency);
  }
  return checks;
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
    dependencyGated: true,
    evidence: proofGraphAdminProofEvidence.path,
    proofBoundary: proofGraphAdminProofEvidence.proofBoundary,
    recovery: buildLocalReadinessDependencyRecovery(dependency),
    roleHandoffCount: proofGraphAdminProofEvidence.roleHandoffCount,
    roleHandoffIds: proofGraphAdminProofEvidence.roleHandoffIds,
    destinationAuditIds: proofGraphAdminProofEvidence.destinationAuditIds,
    adminRoleSurface: proofGraphAdminProofEvidence,
  };
}

export function buildNextActionAdminSurfaceReadinessCheck(
  nextActionAdminProofEvidence,
) {
  const dependency = getLocalReadinessDependency(
    localNextActionAdminSurfaceCheckId,
  );
  if (dependency === undefined) {
    throw new Error(
      "next-action admin surface readiness dependency is missing a recovery contract",
    );
  }
  return {
    id: dependency.id,
    label: dependency.label,
    status: "passed",
    dependencyGated: true,
    evidence: nextActionAdminProofEvidence.path,
    proofBoundary: nextActionAdminProofEvidence.proofBoundary,
    recovery: buildLocalReadinessDependencyRecovery(dependency),
    selectedCommand: nextActionAdminProofEvidence.command,
    selectedReason: nextActionAdminProofEvidence.reason,
    releaseReadinessCandidateCount:
      nextActionAdminProofEvidence.releaseReadinessCandidateCount,
    localReadinessDependencyCandidateCount:
      nextActionAdminProofEvidence.localReadinessDependencyCandidateCount,
    adminRoleSurface: nextActionAdminProofEvidence,
  };
}

function buildLocalReadinessDependencyRecovery(dependency) {
  return {
    command: dependency.command,
    buildSlice: dependency.buildSlice,
    proofTarget: dependency.proofTarget,
    roleUrl: dependency.roleUrl,
    proofBoundary: dependency.proofBoundary,
    requiredEvidence: dependency.requiredEvidence,
  };
}

function assertLocalReadinessDependencyDescriptor(dependency) {
  if (
    typeof dependency?.id !== "string" ||
    dependency.id.length === 0 ||
    typeof dependency.label !== "string" ||
    dependency.label.length === 0 ||
    !Number.isInteger(dependency.priority) ||
    dependency.priority < 0 ||
    typeof dependency.command !== "string" ||
    !dependency.command.startsWith("npm run ") ||
    typeof dependency.buildSlice !== "string" ||
    dependency.buildSlice.length === 0 ||
    typeof dependency.proofTarget !== "string" ||
    dependency.proofTarget.length === 0 ||
    typeof dependency.roleUrl !== "string" ||
    !dependency.roleUrl.includes("?game=<seeded-game>") ||
    typeof dependency.proofBoundary !== "string" ||
    dependency.proofBoundary.length === 0 ||
    typeof dependency.requiredEvidence !== "string" ||
    dependency.requiredEvidence.length === 0
  ) {
    throw new Error(
      `local readiness dependency ${dependency?.id ?? "<unknown>"} is missing recovery metadata`,
    );
  }
}

function assertLocalReadinessDependencyCheckMatchesContract(check, dependency) {
  const expectedRecovery = buildLocalReadinessDependencyRecovery(dependency);
  if (check.label !== dependency.label) {
    throw new Error(
      `local readiness dependency check ${check.id} label drifted from registry`,
    );
  }
  for (const [field, expected] of Object.entries(expectedRecovery)) {
    if (check.recovery?.[field] !== expected) {
      throw new Error(
        `local readiness dependency check ${check.id} recovery ${field} drifted from registry`,
      );
    }
  }
}
