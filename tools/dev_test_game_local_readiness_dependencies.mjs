import {
  devTestGameProofGraphAdminProofCommand,
  devTestGameProofGraphAdminProofPath,
} from "./dev_test_game_proof_graph_paths.mjs";
import {
  nextActionAdminProofCommand,
  nextActionAdminProofPath,
  proofFreshnessAdminProofCommand,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_next_action_paths.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export const localProofGraphAdminRoleHandoffsCheckId =
  "local-proof-graph-admin-role-handoffs";
export const localProofGraphNextActionHandoffCheckId =
  "local-proof-graph-next-action-handoff";
export const localProofFreshnessAdminSurfaceCheckId =
  "local-proof-freshness-admin-surface";
export const localNextActionAdminSurfaceCheckId =
  "local-next-action-admin-surface";
export const localSeedDemoFixtureCheckId = "local-seed-demo-fixture";
export const localHostedEvidenceLaneDemoProofCheckId =
  "local-hosted-evidence-lane-demo-proof";

const devTestGameSeedFixtureCommand = "test:dev-test-game-seed-fixture";
const devTestGameHostedEvidenceLaneDemoProofCommand =
  "test:dev-test-game-hosted-evidence-lane-demo-proof";

export const localReadinessDependencies = Object.freeze([
  Object.freeze({
    id: localProofGraphAdminRoleHandoffsCheckId,
    label: "Proof graph admin role handoffs",
    priority: 0,
    command: `npm run ${devTestGameProofGraphAdminProofCommand}`,
    buildSlice:
      "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
    proofTarget: devTestGameProofGraphAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
    proofBoundary:
      "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
  }),
  Object.freeze({
    id: localProofGraphNextActionHandoffCheckId,
    label: "Proof graph next-action handoff",
    priority: 1,
    command: `npm run ${devTestGameProofGraphAdminProofCommand}`,
    buildSlice:
      "Refresh the proof graph admin browser proof so the terminal batch links to the next-action handoff detail before hosted readiness work can be selected.",
    proofTarget: devTestGameProofGraphAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
    proofBoundary:
      "Local browser proof that the proof graph terminal batch links to the next-action handoff detail and verifies the default blocker plus opt-in hosted identity predicate rows. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed proof graph next-action handoff check in the generated release-readiness checklist",
  }),
  Object.freeze({
    id: localProofFreshnessAdminSurfaceCheckId,
    label: "Proof freshness admin surface",
    priority: 2,
    command: `npm run ${proofFreshnessAdminProofCommand}`,
    buildSlice:
      "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
    proofTarget: proofFreshnessAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness),
    proofBoundary:
      "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed proof-freshness admin surface check in the generated release-readiness checklist",
  }),
  Object.freeze({
    id: localNextActionAdminSurfaceCheckId,
    label: "Next-action admin surface",
    priority: 3,
    command: `npm run ${nextActionAdminProofCommand}`,
    buildSlice:
      "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
    proofTarget: nextActionAdminProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
    proofBoundary:
      "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed next-action admin surface check in the generated release-readiness checklist",
  }),
  Object.freeze({
    id: localSeedDemoFixtureCheckId,
    label: "Local seed/demo fixture summary",
    priority: 4,
    command: `npm run ${devTestGameSeedFixtureCommand}`,
    buildSlice:
      "Generate the local seed/demo fixture inventory and admin proof before choosing hosted readiness work.",
    proofTarget: devTestGameSeedFixturePath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures),
    proofBoundary:
      "Local seed/demo fixture inventory and admin browser proof for one dev-test-game run. This recovers the local fixture dependency only; it does not prove hosted demo data, invite delivery, release readiness, or production readiness.",
    requiredEvidence:
      "Passed local seed/demo fixture inventory and admin role-surface proof in the generated release-readiness checklist",
    sourceUnprovenIds: Object.freeze(["seed-demo-fixtures"]),
  }),
  Object.freeze({
    id: localHostedEvidenceLaneDemoProofCheckId,
    label: "Local hosted evidence lane demo proof",
    priority: 5,
    command: `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
    buildSlice:
      "Refresh the local hosted evidence lane demo proof before choosing hosted deployment work.",
    proofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
    proofBoundary:
      "Local demo proof for the hosted evidence lane pass path. This recovers the blocked-to-passed handoff using synthetic external-looking evidence only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed local hosted evidence lane demo proof with synthetic external target warning",
  }),
]);

const localReadinessDependencyById = new Map(
  localReadinessDependencies.map((dependency) => [dependency.id, dependency]),
);

assertLocalReadinessDependencyRegistry();

export function getLocalReadinessDependency(id) {
  return localReadinessDependencyById.get(id);
}

export function localReadinessDependencyRecoveryFor(id) {
  const dependency = getLocalReadinessDependency(id);
  if (dependency === undefined) {
    throw new Error(`unknown local readiness dependency: ${id}`);
  }
  return buildLocalReadinessDependencyRecovery(dependency);
}

export function localReadinessDependencyCheckFor(id, overrides = {}) {
  const dependency = getLocalReadinessDependency(id);
  if (dependency === undefined) {
    throw new Error(`unknown local readiness dependency: ${id}`);
  }
  return {
    id: dependency.id,
    label: dependency.label,
    status: "missing",
    dependencyGated: true,
    recovery: buildLocalReadinessDependencyRecovery(dependency),
    ...overrides,
  };
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
  const unprovenIds = new Set(
    (readiness.releaseReadiness?.unproven ?? []).map((item) => item.id),
  );
  return localReadinessDependencies
    .map((dependency, index) => {
      const current = localChecks.get(dependency.id);
      const sourceUnprovenMissing =
        dependency.sourceUnprovenIds?.some((id) => unprovenIds.has(id)) ?? false;
      return current?.check?.status === "passed" && !sourceUnprovenMissing
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

export function buildProofGraphNextActionHandoffReadinessCheck(
  proofGraphAdminProofEvidence,
) {
  const dependency = getLocalReadinessDependency(
    localProofGraphNextActionHandoffCheckId,
  );
  if (dependency === undefined) {
    throw new Error(
      "proof graph next-action handoff readiness dependency is missing a recovery contract",
    );
  }
  const handoff = proofGraphAdminProofEvidence.nextActionHandoffDestination;
  return {
    id: dependency.id,
    label: dependency.label,
    status: "passed",
    dependencyGated: true,
    evidence: proofGraphAdminProofEvidence.path,
    proofBoundary: proofGraphAdminProofEvidence.proofBoundary,
    recovery: buildLocalReadinessDependencyRecovery(dependency),
    linkId: handoff.linkId,
    auditId: handoff.auditId,
    detailRoleUrl: handoff.detailRoleUrl,
    visibleChecks: handoff.visibleChecks,
    visibleNextActionHandoffPairRows:
      handoff.visibleNextActionHandoffPairRows,
    visibleNextActionHandoffPairRowStatuses:
      handoff.visibleNextActionHandoffPairRowStatuses,
    adminRoleSurface: proofGraphAdminProofEvidence,
  };
}

export function buildProofFreshnessAdminSurfaceReadinessCheck(
  proofFreshnessAdminProofEvidence,
) {
  const dependency = getLocalReadinessDependency(
    localProofFreshnessAdminSurfaceCheckId,
  );
  if (dependency === undefined) {
    throw new Error(
      "proof-freshness admin surface readiness dependency is missing a recovery contract",
    );
  }
  return {
    id: dependency.id,
    label: dependency.label,
    status: "passed",
    dependencyGated: true,
    evidence: proofFreshnessAdminProofEvidence.path,
    proofBoundary: proofFreshnessAdminProofEvidence.proofBoundary,
    recovery: buildLocalReadinessDependencyRecovery(dependency),
    artifactCount: proofFreshnessAdminProofEvidence.artifactIds.length,
    artifactIds: proofFreshnessAdminProofEvidence.artifactIds,
    maxAgeHours: proofFreshnessAdminProofEvidence.maxAgeHours,
    nextActionCommand: proofFreshnessAdminProofEvidence.nextActionCommand,
    nextActionStatus: proofFreshnessAdminProofEvidence.nextActionStatus,
    nextActionReason: proofFreshnessAdminProofEvidence.nextActionReason,
    adminRoleSurface: proofFreshnessAdminProofEvidence,
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
    dependency.requiredEvidence.length === 0 ||
    (dependency.sourceUnprovenIds !== undefined &&
      (!Array.isArray(dependency.sourceUnprovenIds) ||
        dependency.sourceUnprovenIds.length === 0 ||
        dependency.sourceUnprovenIds.some(
          (id) => typeof id !== "string" || id.length === 0,
        )))
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
