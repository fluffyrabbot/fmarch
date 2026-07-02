import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidencePlaceholderFixturePath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  buildReleaseReadinessUnprovenItems,
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
  releaseReadinessBuildableItemForId,
  releaseAdminProofFallbackUnprovenIds,
  releaseReadinessProductionFeatureSpineTargets,
  releaseReadinessUnprovenCaseIds,
  releaseReadinessUnprovenItem,
  releaseReadinessUnprovenStatusRows,
} from "./dev_test_game_release_readiness_cases.mjs";

test("release readiness unproven cases share blocker IDs and status rows", () => {
  assert.ok(releaseReadinessUnprovenCaseIds.includes("hosted-deployment"));
  assert.ok(releaseReadinessUnprovenCaseIds.includes("human-release-runbook"));
  assert.deepEqual(
    releaseReadinessUnprovenStatusRows([
      "hosted-deployment",
      "human-release-runbook",
    ]),
    [
      { id: "hosted-deployment", status: "unproven" },
      { id: "human-release-runbook", status: "unproven" },
    ],
  );
  assert.equal(
    releaseReadinessUnprovenItem("hosted-deployment").requiredEvidence,
    "Hosted API/frontend deployment proof with external health checks",
  );
  assert.deepEqual(releaseAdminProofFallbackUnprovenIds, [
    "hosted-deployment",
    "human-release-runbook",
  ]);
});

test("release readiness unproven case builder follows local evidence transitions", () => {
  assert.deepEqual(
    buildReleaseReadinessUnprovenItems({}).map((item) => item.id),
    [
      "production-identity",
      "hosted-deployment",
      "seed-demo-fixtures",
      "backup-restore-drill",
      "exhaustive-race-coverage",
      "observability-and-operations",
      "human-release-runbook",
    ],
  );

  assert.deepEqual(
    buildReleaseReadinessUnprovenItems({
      identityAdapterEvidence: { status: "passed" },
      seedFixtureEvidence: { status: "passed" },
      backupRestoreEvidence: { status: "passed" },
      raceCoverageEvidence: { status: "passed" },
      hostedConcurrentRaceMatrixEvidence: {
        status: "passed",
        realHostedDeploymentStatus: "unproven",
      },
      opsArtifactsEvidence: { status: "passed" },
      hostedOpsSignalsEvidence: {
        status: "passed",
        hostedTelemetryStatus: "unproven",
      },
      releaseRunbookEvidence: { status: "passed" },
    }).map((item) => item.id),
    [
      "hosted-production-identity",
      "hosted-deployment",
      "hosted-demo-fixtures",
      "production-backup-recovery",
      "real-hosted-concurrent-race-matrix",
      "real-hosted-observability-and-operations",
      "human-release-approval",
    ],
  );
});

test("release readiness buildable cases share next-action commands and spine targets", () => {
  const hostedMatrix = releaseReadinessBuildableItemForId(
    "hosted-concurrent-race-matrix",
  );
  assert.equal(
    hostedMatrix.command,
    "npm run test:dev-test-game-hosted-concurrent-race-matrix",
  );
  assert.equal(
    hostedMatrix.proofTarget,
    "target/dev-test-game/hosted-concurrent-race-matrix.json",
  );
  assert.deepEqual(
    hostedMatrix.productionFeatureSpineTarget,
    releaseReadinessProductionFeatureSpineTargets.playerActionSubmission,
  );

  const releaseRunbook = releaseReadinessBuildableItemForId(
    "human-release-runbook",
  );
  assert.equal(releaseRunbook.command, `npm run ${devTestGameReleaseRunbookCommand}`);
  assert.equal(releaseRunbook.proofTarget, devTestGameReleaseRunbookPath);

  const realHostedMatrix = releaseReadinessBuildableItemForId(
    "real-hosted-concurrent-race-matrix",
  );
  assert.equal(realHostedMatrix.realHostedEvidenceStatus, "unproven");

  const hostedIdentity = releaseReadinessBuildableItemForId(
    "hosted-production-identity",
  );
  assert.equal(
    hostedIdentity.command,
    `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
  );
  assert.equal(hostedIdentity.proofTarget, devTestGameHostedIdentityEvidencePath);
  assert.equal(
    hostedIdentity.roleUrl,
    "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
  );
  assert.equal(hostedIdentity.priority, 15);
  assert.deepEqual(
    hostedIdentity.productionFeatureSpineTarget,
    releaseReadinessProductionFeatureSpineTargets.identityAdapter,
  );
  assert.deepEqual(
    hostedIdentity.hostedHandoffChecklist.blockedCheckIds,
    hostedIdentityEvidenceHandoffCase().blockedCheckIds,
  );
  assert.equal(
    hostedIdentity.hostedHandoffChecklist.placeholderFixturePath,
    hostedIdentityEvidencePlaceholderFixturePath,
  );
  assert.deepEqual(
    hostedIdentity.hostedHandoffChecklist.requirementGroups.map((group) => [
      group.id,
      group.status,
      group.blockedCheckIds,
    ]),
    hostedIdentityEvidenceHandoffCase().requirementGroups.map((group) => [
      group.id,
      "blocked",
      group.checkIds,
    ]),
  );
});

test("hosted deployment buildable case carries blocked and passed preflight states", () => {
  const blocked = releaseReadinessBuildableItemForId("hosted-deployment", {
    hostedTargetPreflight: {
      status: "blocked",
      checks: [
        {
          id: "frontend-url-configured",
          status: "blocked",
          requiredEvidence: "Set FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        },
      ],
    },
  });
  assert.equal(blocked.proofTarget, "target/dev-test-game/hosted-evidence-lane.json");
  assert.deepEqual(blocked.hostedHandoffChecklist.blockedCheckIds, [
    "frontend-url-configured",
  ]);
  assert.ok(blocked.hostedHandoffChecklist.inputIds.includes("proof-target"));

  const passed = releaseReadinessBuildableItemForId("hosted-deployment", {
    hostedTargetPreflight: {
      status: "passed",
      target: { rawEvidenceSyntheticExternalTarget: true },
    },
  });
  assert.equal(
    passed.command,
    `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`,
  );
  assert.equal(passed.proofTarget, devTestGameHostedEvidenceLaneDemoProofPath);
  assert.equal(
    passed.roleUrl,
    "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
  );
  assert.equal(passed.proofGraphNodeId, "admin-proof:hosted-evidence-lane");
  assert.equal(passed.hostedEvidenceMode, "synthetic-demo");
  assert.equal(passed.realHostedEvidenceStatus, "unproven");

  const realPassed = releaseReadinessBuildableItemForId("hosted-deployment", {
    hostedTargetPreflight: { status: "passed", target: {} },
  });
  assert.equal(
    realPassed.proofTarget,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.equal(
    realPassed.roleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
  );
  assert.equal(
    realPassed.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  assert.equal(realPassed.hostedEvidenceMode, "real-hosted");
  assert.equal(realPassed.realHostedEvidenceStatus, "passed");
});
