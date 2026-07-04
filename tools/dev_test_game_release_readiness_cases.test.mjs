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
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityHandoffCase,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  hostedMatrixExternalEvidenceProofTarget,
  hostedMatrixRealHostedBlockedCheckIds,
  hostedMatrixRealHostedEvidenceCommand,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  buildReleaseReadinessUnprovenItems,
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
  releaseReadinessBuildableItemForId,
  releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
  releaseReadinessHostedEvidenceLaneRoleUrl,
  releaseAdminProofFallbackUnprovenIds,
  releaseReadinessProductionFeatureSpineTargets,
  releaseReadinessUnprovenCaseIds,
  releaseReadinessUnprovenItem,
  releaseReadinessUnprovenStatusRows,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  completedGameHardeningSpineCycleId,
} from "./dev_test_game_core_loop_completed_game_cases.mjs";
import {
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
  coreLoopFeatureSpineTargetRows,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  identityFeatureSpineSourceCheckId,
  identityFeatureSpineTargetRows,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineCycleIds,
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
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
      featureSlotId: coreLoopFeatureSpineTargetRows.resolutionReceipts
        .featureSlotId,
      sourceCheckId: coreLoopFeatureSpineSourceCheckId,
      cycleId: coreLoopFeatureSpineTargetRows.resolutionReceipts.cycleId,
      roleUrlId: coreLoopFeatureSpineTargetRows.resolutionReceipts.roleUrlId,
      rowKind: "checkpoint",
      checkpointId:
        coreLoopFeatureSpineTargetRows.resolutionReceipts.checkpointId,
      adminCheckId:
        coreLoopFeatureSpineTargetRows.resolutionReceipts.adminCheckId,
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
      featureSlotId: coreLoopFeatureSpineTargetRows.staleActionConflictMessage
        .featureSlotId,
      sourceCheckId: coreLoopFeatureSpineSourceCheckId,
      cycleId:
        coreLoopFeatureSpineTargetRows.staleActionConflictMessage.cycleId,
      roleUrlId:
        coreLoopFeatureSpineTargetRows.staleActionConflictMessage.roleUrlId,
      rowKind: "recovery-hook",
      checkpointId:
        coreLoopFeatureSpineTargetRows.staleActionConflictMessage.checkpointId,
      recoveryHookId:
        coreLoopFeatureSpineTargetRows.staleActionConflictMessage
          .recoveryHookId,
      adminCheckId:
        coreLoopFeatureSpineTargetRows.staleActionConflictMessage.adminCheckId,
    },
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.completedGameRecovery,
    {
      featureSlotId: coreLoopFeatureSpineTargetRows.completedGameRecovery
        .featureSlotId,
      sourceCheckId: coreLoopFeatureSpineSourceCheckId,
      cycleId: coreLoopFeatureSpineTargetRows.completedGameRecovery.cycleId,
      roleUrlId: coreLoopFeatureSpineTargetRows.completedGameRecovery.roleUrlId,
      rowKind: "checkpoint",
      checkpointId:
        coreLoopFeatureSpineTargetRows.completedGameRecovery.checkpointId,
      adminCheckId:
        coreLoopFeatureSpineTargetRows.completedGameRecovery.adminCheckId,
    },
  );
  assert.deepEqual(
    releaseReadinessProductionFeatureSpineTargets.completedGameStaleRecovery,
    {
      featureSlotId: "completed-game-stale-recovery",
      sourceCheckId: hardeningFeatureSpineSourceCheckId,
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
      sourceCheckId: hardeningFeatureSpineSourceCheckId,
      cycleId: hardeningFeatureSpineCycleIds.staleConflict,
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
  assert.equal(realHostedMatrix.command, hostedMatrixRealHostedEvidenceCommand);
  assert.equal(
    realHostedMatrix.proofTarget,
    hostedMatrixExternalEvidenceProofTarget,
  );
  assert.equal(
    realHostedMatrix.realHostedEvidenceInputs.command,
    hostedMatrixRealHostedEvidenceCommand,
  );
  assert.deepEqual(
    realHostedMatrix.hostedHandoffChecklist.blockedCheckIds,
    hostedMatrixRealHostedBlockedCheckIds,
  );
  assert.match(
    realHostedMatrix.hostedHandoffChecklist.blockedReceipt.operatorAction,
    /races, reload, reconnect, and stale-client conflicts/,
  );
  assert.deepEqual(
    realHostedMatrix.productionFeatureSpineTarget,
    releaseReadinessProductionFeatureSpineTargets
      .replacementStaleConflictMessage,
  );

  const realHostedObservability = releaseReadinessBuildableItemForId(
    "real-hosted-observability-and-operations",
  );
  assert.equal(
    realHostedObservability.command,
    `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
  );
  assert.equal(
    realHostedObservability.proofTarget,
    devTestGameRealHostedObservabilityHandoffPath,
  );
  assert.equal(
    realHostedObservability.roleUrl,
    localAdminAuditRoleUrl(localAdminAuditIds.realHostedObservabilityHandoff),
  );
  assert.equal(realHostedObservability.priority, 12);
  assert.match(
    realHostedObservability.proofBoundary,
    /local hosted-like ops signal bundle remains baseline evidence/,
  );
  assert.deepEqual(
    realHostedObservability.hostedHandoffChecklist.blockedCheckIds,
    realHostedObservabilityHandoffCase().blockedCheckIds,
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
    localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
  );
  assert.equal(hostedIdentity.priority, -10);
  assert.equal(hostedIdentity.actionStatus, "ready");
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
        cycleId: hardeningFeatureSpineCycleIds.staleConflict,
        rowId: replacementStaleConflictMessageSpineLaneCase().laneId,
      },
    },
  ];

  for (const { target, source } of scenarioOwnedTargets) {
    assert.equal(target.sourceCheckId, hardeningFeatureSpineSourceCheckId);
    assert.equal(target.cycleId, source.cycleId);
    assert.equal(target.roleUrlId, source.rowId);
    assert.equal(target.checkpointId, source.rowId);
    assert.equal(target.adminCheckId, source.rowId);
  }
});

test("local core production feature targets derive proof row ids from shared source rows", () => {
  for (const [targetKey, source] of Object.entries(
    coreLoopFeatureSpineTargetRows,
  )) {
    const target = releaseReadinessProductionFeatureSpineTargets[targetKey];
    assert.notEqual(target, undefined, `missing target ${targetKey}`);
    assert.equal(target.featureSlotId, source.featureSlotId);
    assert.equal(target.sourceCheckId, coreLoopFeatureSpineSourceCheckId);
    assert.equal(target.cycleId, source.cycleId);
    assert.equal(target.roleUrlId, source.roleUrlId);
    assert.equal(target.checkpointId, source.checkpointId);
    assert.equal(target.adminCheckId, source.adminCheckId);
    if (source.recoveryHookId !== undefined) {
      assert.equal(target.recoveryHookId, source.recoveryHookId);
    }
  }
});

test("identity production feature target derives proof row ids from shared source rows", () => {
  const source = identityFeatureSpineTargetRows.identityAdapter;
  const target = releaseReadinessProductionFeatureSpineTargets.identityAdapter;
  assert.equal(target.featureSlotId, source.featureSlotId);
  assert.equal(target.sourceCheckId, identityFeatureSpineSourceCheckId);
  assert.equal(target.cycleId, source.cycleId);
  assert.equal(target.roleUrlId, source.roleUrlId);
  assert.equal(target.checkpointId, source.checkpointId);
  assert.equal(target.adminCheckId, source.adminCheckId);
});

test("scenario-owned production feature targets avoid hand-maintained row literals", async () => {
  const source = await readFile(
    "tools/dev_test_game_release_readiness_cases.mjs",
    "utf8",
  );
  assert.match(source, /Object\.entries\(coreLoopSpineRows\)\.map/);
  assert.match(source, /featureSpineTargetFromSourceRow\(row\)/);
  for (const targetKey of Object.keys(coreLoopFeatureSpineTargetRows)) {
    assert.equal(
      source.includes(`${targetKey}: featureSpine`),
      false,
      `core-loop target should derive from catalog row: ${targetKey}`,
    );
  }
  const identityBlock = featureTargetDeclarationBlock(source, "identityAdapter");
  assert.match(
    identityBlock,
    /\.\.\.identitySpineRows\.identityAdapter/,
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
    releaseReadinessHostedEvidenceLaneRoleUrl,
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
    releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
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
