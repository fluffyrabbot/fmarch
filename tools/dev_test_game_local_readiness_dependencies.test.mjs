import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalReadinessDependencyChecks,
  buildNextActionAdminSurfaceReadinessCheck,
  buildProofFreshnessAdminSurfaceReadinessCheck,
  buildProofGraphAdminRoleHandoffsReadinessCheck,
  buildProofGraphTerminalValidationReadinessCheck,
  getLocalReadinessDependency,
  localReadinessDependencyAuditIdFromRoleUrl,
  localReadinessDependencyCheckFor,
  localReadinessDependencyDestinationFor,
  localReadinessDependencyDestinations,
  localReadinessDependencyRecoveryFor,
  localNextActionAdminSurfaceCheckId,
  localHostedEvidenceLaneDemoProofCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
  localProofGraphNextActionHandoffCheckId,
  localProofGraphProductionFeatureProvenanceCheckId,
  localProofGraphTerminalValidationCheckId,
  localSeedDemoFixtureCheckId,
  rankedMissingLocalReadinessDependencies,
} from "./dev_test_game_local_readiness_dependencies.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

const proofGraphRoleUrl = localAdminAuditRoleUrl(localAdminAuditIds.proofGraph);
const proofFreshnessRoleUrl = localAdminAuditRoleUrl(
  localAdminAuditIds.proofFreshness,
);
const nextActionRoleUrl = localAdminAuditRoleUrl(localAdminAuditIds.nextAction);
const seedFixturesRoleUrl = localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures);
const hostedEvidenceLaneRoleUrl = localAdminAuditRoleUrl(
  localAdminAuditIds.hostedEvidenceLane,
);

test("local readiness dependency contract carries recovery command and role surface", () => {
  const dependency = getLocalReadinessDependency(
    localProofGraphAdminRoleHandoffsCheckId,
  );

  assert.deepEqual(dependency, {
    id: "local-proof-graph-admin-role-handoffs",
    label: "Proof graph admin role handoffs",
    priority: 0,
    command: "npm run test:dev-test-game-proof-graph-admin-proof",
    buildSlice:
      "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
    proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
    roleUrl: proofGraphRoleUrl,
    proofBoundary:
      "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
    requiredEvidence:
      "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
  });
  assert.deepEqual(localReadinessDependencyRecoveryFor(dependency.id), {
    command: dependency.command,
    buildSlice: dependency.buildSlice,
    proofTarget: dependency.proofTarget,
    roleUrl: dependency.roleUrl,
    proofBoundary: dependency.proofBoundary,
    requiredEvidence: dependency.requiredEvidence,
  });
  assert.deepEqual(
    localReadinessDependencyCheckFor(dependency.id, {
      status: "passed",
      evidence: dependency.proofTarget,
    }),
    {
      id: dependency.id,
      label: dependency.label,
      status: "passed",
      dependencyGated: true,
      evidence: dependency.proofTarget,
      recovery: localReadinessDependencyRecoveryFor(dependency.id),
    },
  );
  assert.throws(
    () => localReadinessDependencyCheckFor("local-unknown-readiness-dependency"),
    /unknown local readiness dependency/,
  );
  assert.deepEqual(
    localReadinessDependencyDestinationFor(dependency.id),
    {
      id: dependency.id,
      auditId: localAdminAuditIds.proofGraph,
      roleUrl: proofGraphRoleUrl,
    },
  );
  assert.deepEqual(
    localReadinessDependencyDestinations().map((destination) => [
      destination.id,
      destination.auditId,
      destination.roleUrl,
    ]),
    [
      [
        localProofGraphAdminRoleHandoffsCheckId,
        localAdminAuditIds.proofGraph,
        proofGraphRoleUrl,
      ],
      [
        localProofGraphProductionFeatureProvenanceCheckId,
        localAdminAuditIds.proofGraph,
        proofGraphRoleUrl,
      ],
      [
        localProofGraphNextActionHandoffCheckId,
        localAdminAuditIds.proofGraph,
        proofGraphRoleUrl,
      ],
      [
        localProofGraphTerminalValidationCheckId,
        localAdminAuditIds.proofGraph,
        proofGraphRoleUrl,
      ],
      [
        localProofFreshnessAdminSurfaceCheckId,
        localAdminAuditIds.proofFreshness,
        proofFreshnessRoleUrl,
      ],
      [
        localNextActionAdminSurfaceCheckId,
        localAdminAuditIds.nextAction,
        nextActionRoleUrl,
      ],
      [
        localSeedDemoFixtureCheckId,
        localAdminAuditIds.seedFixtures,
        seedFixturesRoleUrl,
      ],
      [
        localHostedEvidenceLaneDemoProofCheckId,
        localAdminAuditIds.hostedEvidenceLane,
        hostedEvidenceLaneRoleUrl,
      ],
    ],
  );
  assert.equal(
    localReadinessDependencyAuditIdFromRoleUrl(proofGraphRoleUrl),
    localAdminAuditIds.proofGraph,
  );
  assert.throws(
    () =>
      localReadinessDependencyAuditIdFromRoleUrl("/admin/audit/local-proof-graph"),
    /local readiness dependency role URL is malformed/,
  );
  assert.throws(
    () =>
      localReadinessDependencyAuditIdFromRoleUrl(
        "/admin/audit/local-unknown?game=<seeded-game>",
      ),
    /local readiness dependency role URL uses unknown admin audit id/,
  );
  assert.throws(
    () =>
      localReadinessDependencyDestinationFor(
        "local-unknown-readiness-dependency",
      ),
    /unknown local readiness dependency/,
  );
});

test("proof graph admin proof builds the matching local readiness check", () => {
  const proofGraphAdminProofEvidence = {
    path: "target/dev-test-game/proof-graph-admin-proof.json",
    proofBoundary: "Local browser proof boundary.",
    roleHandoffCount: 2,
    roleHandoffIds: ["admin-proof:release", "admin-proof:next-action"],
    destinationAuditIds: ["local-release-readiness", "local-next-action"],
    detailRoleUrl: proofGraphRoleUrl,
  };

  assert.deepEqual(
    buildProofGraphAdminRoleHandoffsReadinessCheck(
      proofGraphAdminProofEvidence,
    ),
    {
      id: "local-proof-graph-admin-role-handoffs",
      label: "Proof graph admin role handoffs",
      status: "passed",
      dependencyGated: true,
      evidence: "target/dev-test-game/proof-graph-admin-proof.json",
      proofBoundary: "Local browser proof boundary.",
      recovery: {
        command: "npm run test:dev-test-game-proof-graph-admin-proof",
        buildSlice:
          "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
        proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: proofGraphRoleUrl,
        proofBoundary:
          "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
      },
      roleHandoffCount: 2,
      roleHandoffIds: ["admin-proof:release", "admin-proof:next-action"],
      destinationAuditIds: ["local-release-readiness", "local-next-action"],
      adminRoleSurface: proofGraphAdminProofEvidence,
    },
  );
});

test("proof graph terminal validation proof builds the matching local readiness check", () => {
  const proofGraphAdminProofEvidence = {
    path: "target/dev-test-game/proof-graph-admin-proof.json",
    proofBoundary: "Local browser proof boundary.",
    adminSpineTerminalValidationDestination: {
      linkId: "admin-spine-terminal-batches",
      auditId: localAdminAuditIds.adminSpine,
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
      visibleAdminSpineTerminalValidations: [
        "release-admin-proof-contract",
      ],
      visibleAdminSpineTerminalValidationStatuses: {
        "release-admin-proof-contract":
          "Release admin proof diagnostics contract\npassed\ntarget/dev-test-game/release-admin-proof-contract.json",
      },
    },
  };

  assert.deepEqual(
    buildProofGraphTerminalValidationReadinessCheck(
      proofGraphAdminProofEvidence,
    ),
    {
      id: localProofGraphTerminalValidationCheckId,
      label: "Proof graph terminal validation destination",
      status: "passed",
      dependencyGated: true,
      evidence: "target/dev-test-game/proof-graph-admin-proof.json",
      proofBoundary: "Local browser proof boundary.",
      recovery: {
        command: "npm run test:dev-test-game-proof-graph-admin-proof",
        buildSlice:
          "Refresh the proof graph admin browser proof so the terminal validation links to the admin-spine diagnostics contract row before hosted readiness work can be selected.",
        proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: proofGraphRoleUrl,
        proofBoundary:
          "Local browser proof that the proof graph terminal validation destination clicks through to the admin-spine diagnostics contract row. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed proof graph terminal validation destination check in the generated release-readiness checklist",
      },
      linkId: "admin-spine-terminal-batches",
      auditId: localAdminAuditIds.adminSpine,
      detailRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
      visibleAdminSpineTerminalValidations: ["release-admin-proof-contract"],
      visibleAdminSpineTerminalValidationStatuses: {
        "release-admin-proof-contract":
          "Release admin proof diagnostics contract\npassed\ntarget/dev-test-game/release-admin-proof-contract.json",
      },
      adminRoleSurface: proofGraphAdminProofEvidence,
    },
  );
});

test("next-action admin proof builds the matching local readiness check", () => {
  const nextActionAdminProofEvidence = {
    path: "target/dev-test-game/next-action-admin-proof.json",
    proofBoundary: "Local next-action admin proof boundary.",
    command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
    reason: "release-readiness-unproven",
    releaseReadinessCandidateCount: 1,
    localReadinessDependencyCandidateCount: 0,
    detailRoleUrl: nextActionRoleUrl,
  };

  assert.deepEqual(
    buildNextActionAdminSurfaceReadinessCheck(nextActionAdminProofEvidence),
    {
      id: "local-next-action-admin-surface",
      label: "Next-action admin surface",
      status: "passed",
      dependencyGated: true,
      evidence: "target/dev-test-game/next-action-admin-proof.json",
      proofBoundary: "Local next-action admin proof boundary.",
      recovery: {
        command: "npm run test:dev-test-game-next-action-admin-proof",
        buildSlice:
          "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
        proofTarget: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: nextActionRoleUrl,
        proofBoundary:
          "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed next-action admin surface check in the generated release-readiness checklist",
      },
      selectedCommand: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      selectedReason: "release-readiness-unproven",
      releaseReadinessCandidateCount: 1,
      localReadinessDependencyCandidateCount: 0,
      adminRoleSurface: nextActionAdminProofEvidence,
    },
  );
});

test("proof-freshness admin proof builds the matching local readiness check", () => {
  const proofFreshnessAdminProofEvidence = {
    path: "target/dev-test-game/proof-freshness-admin-proof.json",
    proofBoundary: "Local proof-freshness admin proof boundary.",
    artifactIds: ["proof-run", "release-readiness", "next-action"],
    maxAgeHours: 24,
    nextActionCommand: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
    nextActionStatus: "ready",
    nextActionReason: "release-readiness-unproven",
    detailRoleUrl: proofFreshnessRoleUrl,
  };

  assert.deepEqual(
    buildProofFreshnessAdminSurfaceReadinessCheck(
      proofFreshnessAdminProofEvidence,
    ),
    {
      id: "local-proof-freshness-admin-surface",
      label: "Proof freshness admin surface",
      status: "passed",
      dependencyGated: true,
      evidence: "target/dev-test-game/proof-freshness-admin-proof.json",
      proofBoundary: "Local proof-freshness admin proof boundary.",
      recovery: {
        command: "npm run test:dev-test-game-proof-freshness-admin-proof",
        buildSlice:
          "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
        proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
        roleUrl: proofFreshnessRoleUrl,
        proofBoundary:
          "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
        requiredEvidence:
          "Passed proof-freshness admin surface check in the generated release-readiness checklist",
      },
      artifactCount: 3,
      artifactIds: ["proof-run", "release-readiness", "next-action"],
      maxAgeHours: 24,
      nextActionCommand: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      nextActionStatus: "ready",
      nextActionReason: "release-readiness-unproven",
      adminRoleSurface: proofFreshnessAdminProofEvidence,
    },
  );
});

test("dependency-gated checks must match the recovery registry", () => {
  const check = buildProofGraphAdminRoleHandoffsReadinessCheck({
    path: "target/dev-test-game/proof-graph-admin-proof.json",
    proofBoundary: "Local browser proof boundary.",
    roleHandoffCount: 2,
    roleHandoffIds: ["admin-proof:release"],
    destinationAuditIds: ["local-release-readiness"],
  });

  const checks = [check];
  assert.equal(assertLocalReadinessDependencyChecks(checks), checks);
  assert.throws(
    () =>
      assertLocalReadinessDependencyChecks([
        {
          ...check,
          recovery: {
            ...check.recovery,
            command: "npm run test:wrong-command",
          },
        },
      ]),
    /recovery command drifted from registry/,
  );
  assert.throws(
    () =>
      assertLocalReadinessDependencyChecks([
        {
          ...check,
          id: "local-unregistered-dependency",
        },
      ]),
    /has no recovery contract/,
  );
  assert.throws(
    () =>
      assertLocalReadinessDependencyChecks([
        {
          ...check,
          dependencyGated: false,
        },
      ]),
    /missing dependencyGated=true/,
  );
});

test("missing local readiness dependencies rank before hosted readiness work", () => {
  const missingCandidates = rankedMissingLocalReadinessDependencies({
    localDevelopmentSpine: { checks: [] },
  });

  assert.deepEqual(
    missingCandidates.map((candidate) => [
      candidate.id,
      candidate.index,
      candidate.priority,
      candidate.status,
    ]),
    [
      ["local-proof-graph-admin-role-handoffs", 0, 0, "missing"],
      [localProofGraphProductionFeatureProvenanceCheckId, 1, 1, "missing"],
      [localProofGraphNextActionHandoffCheckId, 2, 1, "missing"],
      [localProofGraphTerminalValidationCheckId, 3, 1, "missing"],
      [localProofFreshnessAdminSurfaceCheckId, 4, 2, "missing"],
      [localNextActionAdminSurfaceCheckId, 5, 3, "missing"],
      [localSeedDemoFixtureCheckId, 6, 4, "missing"],
      [localHostedEvidenceLaneDemoProofCheckId, 7, 5, "missing"],
    ],
  );
  assert.deepEqual(
    missingCandidates.find(
      (candidate) => candidate.id === localProofGraphTerminalValidationCheckId,
    ),
    {
      id: localProofGraphTerminalValidationCheckId,
      status: "missing",
      index: 3,
      priority: 1,
      command: "npm run test:dev-test-game-proof-graph-admin-proof",
      buildSlice:
        "Refresh the proof graph admin browser proof so the terminal validation links to the admin-spine diagnostics contract row before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
      roleUrl: proofGraphRoleUrl,
      proofBoundary:
        "Local browser proof that the proof graph terminal validation destination clicks through to the admin-spine diagnostics contract row. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
      requiredEvidence:
        "Passed proof graph terminal validation destination check in the generated release-readiness checklist",
    },
  );

  assert.deepEqual(
    rankedMissingLocalReadinessDependencies({
      localDevelopmentSpine: {
        checks: [
          {
            id: "local-proof-graph-admin-role-handoffs",
            status: "passed",
          },
          {
            id: localProofGraphProductionFeatureProvenanceCheckId,
            status: "passed",
          },
          {
            id: localProofGraphNextActionHandoffCheckId,
            status: "passed",
          },
          {
            id: localProofGraphTerminalValidationCheckId,
            status: "passed",
          },
          {
            id: localProofFreshnessAdminSurfaceCheckId,
            status: "passed",
          },
          {
            id: localNextActionAdminSurfaceCheckId,
            status: "passed",
          },
          {
            id: localSeedDemoFixtureCheckId,
            status: "passed",
          },
          {
            id: localHostedEvidenceLaneDemoProofCheckId,
            status: "passed",
          },
        ],
      },
    }),
    [],
  );
});
