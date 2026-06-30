import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalReadinessDependencyChecks,
  buildNextActionAdminSurfaceReadinessCheck,
  buildProofGraphAdminRoleHandoffsReadinessCheck,
  getLocalReadinessDependency,
  localNextActionAdminSurfaceCheckId,
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
      id: "local-next-action-admin-surface",
      status: "missing",
      index: 1,
      priority: 1,
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
            id: localNextActionAdminSurfaceCheckId,
            status: "passed",
          },
        ],
      },
    }),
    [],
  );
});
