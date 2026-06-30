import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProofGraphAdminRoleHandoffsReadinessCheck,
  getLocalReadinessDependency,
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
      evidence: "target/dev-test-game/proof-graph-admin-proof.json",
      proofBoundary: "Local browser proof boundary.",
      roleHandoffCount: 2,
      roleHandoffIds: ["admin-proof:release", "admin-proof:next-action"],
      destinationAuditIds: ["local-release-readiness", "local-next-action"],
      adminRoleSurface: proofGraphAdminProofEvidence,
    },
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
  ]);

  assert.deepEqual(
    rankedMissingLocalReadinessDependencies({
      localDevelopmentSpine: {
        checks: [
          {
            id: "local-proof-graph-admin-role-handoffs",
            status: "passed",
          },
        ],
      },
    }),
    [],
  );
});
