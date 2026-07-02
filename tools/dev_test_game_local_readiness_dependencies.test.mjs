import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalReadinessDependencyChecks,
  buildNextActionAdminSurfaceReadinessCheck,
  buildProofFreshnessAdminSurfaceReadinessCheck,
  buildProofGraphAdminRoleHandoffsReadinessCheck,
  getLocalReadinessDependency,
  localReadinessDependencyCheckFor,
  localReadinessDependencyRecoveryFor,
  localNextActionAdminSurfaceCheckId,
  localHostedEvidenceLaneDemoProofCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
  rankedMissingLocalReadinessDependencies,
} from "./dev_test_game_local_readiness_dependencies.mjs";

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
    roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
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
});

test("proof graph admin proof builds the matching local readiness check", () => {
  const proofGraphAdminProofEvidence = {
    path: "target/dev-test-game/proof-graph-admin-proof.json",
    proofBoundary: "Local browser proof boundary.",
    roleHandoffCount: 2,
    roleHandoffIds: ["admin-proof:release", "admin-proof:next-action"],
    destinationAuditIds: ["local-release-readiness", "local-next-action"],
    detailRoleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
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
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
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

test("next-action admin proof builds the matching local readiness check", () => {
  const nextActionAdminProofEvidence = {
    path: "target/dev-test-game/next-action-admin-proof.json",
    proofBoundary: "Local next-action admin proof boundary.",
    command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
    reason: "release-readiness-unproven",
    releaseReadinessCandidateCount: 1,
    localReadinessDependencyCandidateCount: 0,
    detailRoleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
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
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
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
    detailRoleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
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
        roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
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

  assert.deepEqual(missingCandidates, [
    {
      id: "local-proof-graph-admin-role-handoffs",
      status: "missing",
      index: 0,
      priority: 0,
      command: "npm run test:dev-test-game-proof-graph-admin-proof",
      buildSlice:
        "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
      proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      proofBoundary:
        "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
      requiredEvidence:
        "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
    },
    {
      id: "local-proof-freshness-admin-surface",
      status: "missing",
      index: 1,
      priority: 1,
      command: "npm run test:dev-test-game-proof-freshness-admin-proof",
      buildSlice:
        "Refresh the proof-freshness admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
      roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
      proofBoundary:
        "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff from the seeded admin audit route. This recovers a local readiness dependency only; it does not validate artifact contents, hosted deployment, release readiness, or production readiness.",
      requiredEvidence:
        "Passed proof-freshness admin surface check in the generated release-readiness checklist",
    },
    {
      id: "local-next-action-admin-surface",
      status: "missing",
      index: 2,
      priority: 2,
      command: "npm run test:dev-test-game-next-action-admin-proof",
      buildSlice:
        "Refresh the next-action admin browser proof before hosted readiness work can be selected.",
      proofTarget: "target/dev-test-game/next-action-admin-proof.json",
      roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      proofBoundary:
        "Local browser proof that the next-action admin surface exposes the selected command, local readiness dependency trace, release-readiness trace, and role URL handoffs from the seeded admin audit route. This recovers a local readiness dependency only; it does not prove hosted deployment, release readiness, or production readiness.",
      requiredEvidence:
        "Passed next-action admin surface check in the generated release-readiness checklist",
    },
    {
      id: "local-hosted-evidence-lane-demo-proof",
      status: "missing",
      index: 3,
      priority: 3,
      command: "npm run test:dev-test-game-hosted-evidence-lane-demo-proof",
      buildSlice:
        "Refresh the local hosted evidence lane demo proof before choosing hosted deployment work.",
      proofTarget: "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      proofBoundary:
        "Local demo proof for the hosted evidence lane pass path. This recovers the blocked-to-passed handoff using synthetic external-looking evidence only; it does not prove hosted deployment, release readiness, or production readiness.",
      requiredEvidence:
        "Passed local hosted evidence lane demo proof with synthetic external target warning",
    },
  ]);

  assert.deepEqual(
    rankedMissingLocalReadinessDependencies({
      localDevelopmentSpine: {
        checks: [
          {
            id: "local-proof-graph-admin-role-handoffs",
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
            id: localHostedEvidenceLaneDemoProofCheckId,
            status: "passed",
          },
        ],
      },
    }),
    [],
  );
});
