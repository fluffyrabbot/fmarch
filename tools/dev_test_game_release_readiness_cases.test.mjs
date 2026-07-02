import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
import {
  completedGameHardeningSpineCycleId,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";
import {
  replacementStaleConflictMessageSpineLaneCase,
} from "./dev_test_game_stale_conflict_scenarios.mjs";

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
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.resolutionReceipts,
    {
      featureSlotId: "resolution-receipts",
      sourceCheckId: "local-core-loop-proof",
      cycleId: "d01-n01-d02",
      roleUrlId: "d01-n01-d02-target",
      rowKind: "checkpoint",
      checkpointId: "d01-n01-d02-n01-resolved-target-killed",
      adminCheckId: "resolution-receipts",
    },
  );

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
    releaseReadinessProductionFeatureSpineTargets.invalidActionRecovery,
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.staleActionConflictMessage,
    {
      featureSlotId: "stale-action-conflict-message",
      sourceCheckId: "local-core-loop-proof",
      cycleId: "d01-n01-d02",
      roleUrlId: "d01-n01-d02-actionPlayer",
      rowKind: "recovery-hook",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: "staleActionConflictReject",
      adminCheckId: "action-loop",
    },
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.completedGameRecovery,
    {
      featureSlotId: "completed-game-recovery",
      sourceCheckId: "local-core-loop-proof",
      cycleId: "d02-n02",
      roleUrlId: "d02-n02-host",
      rowKind: "checkpoint",
      checkpointId: "d02-n02-d02-resolved-target-killed",
      adminCheckId: "completed-game-hardening-coverage",
    },
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.completedGameStaleRecovery,
    {
      featureSlotId: "completed-game-stale-recovery",
      sourceCheckId: "local-hardening-proof",
      cycleId: completedGameHardeningSpineCycleId,
      roleUrlId: completedGameStaleRecoverySpineLaneCase().id,
      rowKind: "checkpoint",
      checkpointId: completedGameStaleRecoverySpineLaneCase().id,
      adminCheckId: completedGameStaleRecoverySpineLaneCase().id,
    },
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.replacementStaleConflictMessage,
    {
      featureSlotId: "replacement-stale-conflict-message",
      sourceCheckId: "local-hardening-proof",
      cycleId: "hardening-stale-conflict",
      roleUrlId: replacementStaleConflictMessageSpineLaneCase().laneId,
      rowKind: "checkpoint",
      checkpointId: replacementStaleConflictMessageSpineLaneCase().laneId,
      adminCheckId: replacementStaleConflictMessageSpineLaneCase().laneId,
    },
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
  assert.deepEqual(
    realHostedMatrix.productionFeatureSpineTarget,
    releaseReadinessProductionFeatureSpineTargets
      .replacementStaleConflictMessage,
  );

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

test("scenario-owned production feature targets derive proof row ids from source cases", () => {
  const scenarioOwnedTargets = [
    {
      target: releaseReadinessProductionFeatureSpineTargets
        .completedGameStaleRecovery,
      source: {
        cycleId: completedGameHardeningSpineCycleId,
        rowId: completedGameStaleRecoverySpineLaneCase().id,
      },
    },
    {
      target: releaseReadinessProductionFeatureSpineTargets
        .replacementStaleConflictMessage,
      source: {
        cycleId: "hardening-stale-conflict",
        rowId: replacementStaleConflictMessageSpineLaneCase().laneId,
      },
    },
  ];

  for (const { target, source } of scenarioOwnedTargets) {
    assert.equal(target.sourceCheckId, "local-hardening-proof");
    assert.equal(target.cycleId, source.cycleId);
    assert.equal(target.roleUrlId, source.rowId);
    assert.equal(target.checkpointId, source.rowId);
    assert.equal(target.adminCheckId, source.rowId);
  }
});

test("scenario-owned production feature targets avoid hand-maintained row literals", async () => {
  const source = await readFile(
    "tools/dev_test_game_release_readiness_cases.mjs",
    "utf8",
  );
  const completedGameBlock = featureTargetDeclarationBlock(
    source,
    "completedGameStaleRecovery",
  );
  assert.match(
    completedGameBlock,
    /roleUrlId:\s+completedGameStaleRecoverySpineLane\.id/,
  );
  assert.match(
    completedGameBlock,
    /checkpointId:\s+completedGameStaleRecoverySpineLane\.id/,
  );
  assert.match(
    completedGameBlock,
    /adminCheckId:\s+completedGameStaleRecoverySpineLane\.id/,
  );
  assert.doesNotMatch(completedGameBlock, /"stale-host-complete-reload"/);

  const replacementBlock = featureTargetDeclarationBlock(
    source,
    "replacementStaleConflictMessage",
  );
  assert.match(
    replacementBlock,
    /roleUrlId:\s+replacementStaleConflictMessageSpineLane\.laneId/,
  );
  assert.match(
    replacementBlock,
    /checkpointId:\s+replacementStaleConflictMessageSpineLane\.laneId/,
  );
  assert.match(
    replacementBlock,
    /adminCheckId:\s+replacementStaleConflictMessageSpineLane\.laneId/,
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

function featureTargetDeclarationBlock(source, targetKey) {
  const startNeedle = `${targetKey}: featureSpine`;
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing target declaration: ${targetKey}`);
  const end = source.indexOf("\n  }),", start);
  assert.notEqual(end, -1, `missing target declaration end: ${targetKey}`);
  return source.slice(start, end);
}
