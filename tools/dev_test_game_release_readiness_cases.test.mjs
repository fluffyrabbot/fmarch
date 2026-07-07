import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  devTestGameHostedIdentityCompleteAdminProofPath,
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceFixturePaths,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidenceRedactedPassFixturePath,
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
  hostedIdentityEvidencePathKind,
  hostedIdentityEvidenceSatisfiesCompleteLocalPacket,
  hostedIdentityEvidenceSatisfiesProductionIdentity,
  releaseReadinessBuildableItemForId,
  releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
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
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  completedGameHardeningSpineTargetCases,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  coreLoopFeatureSpineSourceCheckId,
  coreLoopFeatureSpineTargetRows,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  replacementFeatureSpineSource,
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineSource,
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineSource,
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";
import {
  cohostFeatureSpineSource,
  cohostFeatureSpineTargetRows,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineCycleIds,
  hardeningFeatureSpineTargetProvenanceCases,
  hardeningFeatureSpineTargetRows,
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  replacementRaceReloadSpineTargetCases,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";
import {
  hostSetupFeatureSpineSource,
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  proofGraphAdminFeatureTargetCases,
} from "./dev_test_game_proof_graph_feature_target_cases.mjs";
import {
  proofGraphProductionFeatureTargetDestinations,
} from "./dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  buildProductionFeatureSpineTargetCollection,
} from "./dev_test_game_production_feature_spine_resolver.mjs";
import {
  allProductionFeatureSpineTargetProvenanceCases,
} from "./dev_test_game_production_feature_spine_target_provenance.mjs";
import {
  roleSurfaceBrowserWorkbenchEvidence,
  roleSurfaceSpineCaseList,
} from "./dev_test_game_role_surface_spine_cases.mjs";
import {
  staleConflictMessageSpineTargetCases,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  crossRoleRaceReloadSpineTargetCases,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  hostPhaseRaceReloadSpineTargetCases,
  hostPhaseStaleControlSpineTargetCases,
  hostStandaloneRaceReloadSpineTargetCases,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  playerActionConflictSpineTargetCases,
  reconnectHardeningSpineTargetCases,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";

const devTestGameHostedTargetPreflightCommand =
  "test:dev-test-game-hosted-target-preflight";

const hardeningReconnectFeatureTargetExpectations = Object.freeze(
  reconnectHardeningSpineTargetCases().map((target) =>
    Object.freeze({
      targetKey: target.targetKey,
      featureSlotId: target.featureSlotId,
      rowId: target.laneId,
    }),
  ),
);
const hardeningStaleBaseFeatureTargetExpectations = Object.freeze(
  [
    ...staleConflictMessageSpineTargetCases(),
    ...playerActionConflictSpineTargetCases(),
    ...hostPhaseStaleControlSpineTargetCases(),
  ].map((target) =>
    Object.freeze({
      targetKey: target.targetKey,
      featureSlotId: target.featureSlotId,
      rowId: target.roleUrlId,
    }),
  ),
);
const hardeningConcurrentRaceFeatureTargetExpectations = Object.freeze([
  ...[
    ...hostPhaseRaceReloadSpineTargetCases(),
    ...hostStandaloneRaceReloadSpineTargetCases(),
    ...crossRoleRaceReloadSpineTargetCases(),
    ...replacementRaceReloadSpineTargetCases(),
  ].map((target) =>
    Object.freeze({
      targetKey: target.targetKey,
      featureSlotId: target.featureSlotId,
      rowId: target.reloadLaneId,
    }),
  ),
]);

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

test("release readiness keeps hosted identity fixture evidence out of release transitions", () => {
  const identityAdapterEvidence = { status: "passed" };
  const blockedHostedIdentityEvidence = {
    evidenceStatus: "blocked",
    rawEvidenceStatus: "blocked",
    rawEvidencePath: "",
    fixtureEvidence: false,
  };
  const fixtureHostedIdentityEvidence = {
    evidenceStatus: "passed",
    rawEvidenceStatus: "passed",
    rawEvidencePath: hostedIdentityEvidenceRedactedPassFixturePath,
    fixtureEvidence: true,
  };
  const completeLocalHostedIdentityEvidence = {
    status: "passed",
    evidenceStatus: "passed",
    rawEvidenceStatus: "passed",
    path: devTestGameHostedIdentityCompleteAdminProofPath,
    rawEvidencePath: hostedIdentityEvidenceRedactedPassFixturePath,
    fixtureEvidence: true,
    hostedIdentityPacketSummaryStatuses: {
      status: "provided\n6/6 sections provided\n0 sections missing",
      inputs: "16/16 inputs provided\n0 inputs missing",
      "redacted-refs": "6 redacted refs",
    },
    releaseReady: false,
    productionReady: false,
  };
  const operatorHostedIdentityEvidence = {
    evidenceStatus: "passed",
    rawEvidenceStatus: "passed",
    rawEvidencePath: "target/operator-evidence/hosted-identity-redacted.json",
    fixtureEvidence: false,
  };

  assert.equal(hostedIdentityEvidencePathKind(""), "missing");
  assert.equal(
    hostedIdentityEvidencePathKind(hostedIdentityEvidencePlaceholderFixturePath),
    "fixture",
  );
  assert.equal(
    hostedIdentityEvidencePathKind(hostedIdentityEvidenceRedactedPassFixturePath),
    "fixture",
  );
  for (const fixturePath of hostedIdentityEvidenceFixturePaths) {
    assert.equal(hostedIdentityEvidencePathKind(fixturePath), "fixture");
  }
  assert.equal(
    hostedIdentityEvidencePathKind(
      "target/operator-evidence/hosted-identity-redacted.json",
    ),
    "operator-provided",
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesProductionIdentity(
      blockedHostedIdentityEvidence,
    ),
    false,
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesProductionIdentity(
      fixtureHostedIdentityEvidence,
    ),
    false,
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesProductionIdentity(
      operatorHostedIdentityEvidence,
    ),
    true,
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesCompleteLocalPacket(
      fixtureHostedIdentityEvidence,
    ),
    false,
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesCompleteLocalPacket(
      completeLocalHostedIdentityEvidence,
    ),
    true,
  );
  assert.equal(
    hostedIdentityEvidenceSatisfiesProductionIdentity(
      completeLocalHostedIdentityEvidence,
    ),
    false,
  );

  assert(
    buildReleaseReadinessUnprovenItems({
      identityAdapterEvidence,
      hostedIdentityEvidenceAdminProofEvidence: blockedHostedIdentityEvidence,
    }).some((item) => item.id === "hosted-production-identity"),
  );
  assert(
    buildReleaseReadinessUnprovenItems({
      identityAdapterEvidence,
      hostedIdentityEvidenceAdminProofEvidence: fixtureHostedIdentityEvidence,
    }).some((item) => item.id === "hosted-production-identity"),
  );
  assert.equal(
    buildReleaseReadinessUnprovenItems({
      identityAdapterEvidence,
      hostedIdentityEvidenceAdminProofEvidence: operatorHostedIdentityEvidence,
    }).some((item) => item.id === "hosted-production-identity"),
    false,
  );
  assert.deepEqual(
    buildReleaseReadinessUnprovenItems({
      identityAdapterEvidence,
      hostedIdentityEvidenceAdminProofEvidence: operatorHostedIdentityEvidence,
    })
      .slice(0, 2)
      .map((item) => item.id),
    ["hosted-deployment", "seed-demo-fixtures"],
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
  for (const target of completedGameHardeningSpineTargetCases()) {
    assert.deepEqual(
      releaseReadinessProductionFeatureSpineTargets[target.targetKey],
      {
        featureSlotId: target.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: completedGameHardeningSpineCycleId,
        roleUrlId: target.roleUrlId,
        rowKind: "checkpoint",
        checkpointId: target.checkpointId,
        adminCheckId: target.adminCheckId,
        featureTargetKind: target.featureTargetKind,
      },
    );
  }
  for (const expectation of hardeningStaleBaseFeatureTargetExpectations) {
    assert.deepEqual(
      releaseReadinessProductionFeatureSpineTargets[expectation.targetKey],
      {
        featureSlotId: expectation.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: hardeningFeatureSpineCycleIds.staleConflict,
        roleUrlId: expectation.rowId,
        rowKind: "checkpoint",
        checkpointId: expectation.rowId,
        adminCheckId: expectation.rowId,
      },
    );
  }
  for (const expectation of hardeningReconnectFeatureTargetExpectations) {
    assert.deepEqual(
      releaseReadinessProductionFeatureSpineTargets[expectation.targetKey],
      {
        featureSlotId: expectation.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
        roleUrlId: expectation.rowId,
        rowKind: "checkpoint",
        checkpointId: expectation.rowId,
        adminCheckId: expectation.rowId,
      },
    );
  }
  for (const expectation of hardeningConcurrentRaceFeatureTargetExpectations) {
    assert.deepEqual(
      releaseReadinessProductionFeatureSpineTargets[expectation.targetKey],
      {
        featureSlotId: expectation.featureSlotId,
        sourceCheckId: hardeningFeatureSpineSourceCheckId,
        cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
        roleUrlId: expectation.rowId,
        rowKind: "checkpoint",
        checkpointId: expectation.rowId,
        adminCheckId: expectation.rowId,
      },
    );
  }

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
    ...completedGameHardeningSpineTargetCases().map((target) => ({
      target: releaseReadinessProductionFeatureSpineTargets[target.targetKey],
      source: {
        cycleId: completedGameHardeningSpineCycleId,
        rowId: target.roleUrlId,
      },
    })),
    ...hardeningStaleBaseFeatureTargetExpectations.map((expectation) => ({
      target: releaseReadinessProductionFeatureSpineTargets[
        expectation.targetKey
      ],
      source: {
        cycleId: hardeningFeatureSpineCycleIds.staleConflict,
        rowId: expectation.rowId,
      },
    })),
    ...hardeningReconnectFeatureTargetExpectations.map((expectation) => ({
      target: releaseReadinessProductionFeatureSpineTargets[
        expectation.targetKey
      ],
      source: {
        cycleId: hardeningFeatureSpineCycleIds.reconnectRecovery,
        rowId: expectation.rowId,
      },
    })),
    ...hardeningConcurrentRaceFeatureTargetExpectations.map((expectation) => ({
      target: releaseReadinessProductionFeatureSpineTargets[
        expectation.targetKey
      ],
      source: {
        cycleId: hardeningFeatureSpineCycleIds.concurrentRace,
        rowId: expectation.rowId,
      },
    })),
  ];

  for (const { target, source } of scenarioOwnedTargets) {
    assert.equal(target.sourceCheckId, hardeningFeatureSpineSourceCheckId);
    assert.equal(target.cycleId, source.cycleId);
    assert.equal(target.roleUrlId, source.rowId);
    assert.equal(target.checkpointId, source.rowId);
    assert.equal(target.adminCheckId, source.rowId);
  }
});

test("hardening feature spine rows are classified by exported source-case factories", () => {
  const expectedRows = Object.fromEntries(
    hardeningFeatureSpineTargetProvenanceCases.map((provenanceCase) => [
      provenanceCase.targetKey,
      {
        sourceFactory: provenanceCase.sourceFactory,
        featureSlotId: provenanceCase.featureSlotId,
        sourceCheckId: provenanceCase.sourceCheckId,
        cycleId: provenanceCase.cycleId,
        roleUrlId: provenanceCase.roleUrlId,
        checkpointId: provenanceCase.checkpointId,
        adminCheckId: provenanceCase.adminCheckId,
        ...(provenanceCase.featureTargetKind === undefined
          ? {}
          : { featureTargetKind: provenanceCase.featureTargetKind }),
      },
    ]),
  );
  assert.deepEqual(
    Object.keys(hardeningFeatureSpineTargetRows),
    Object.keys(expectedRows),
  );
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(hardeningFeatureSpineTargetRows).map(([targetKey, row]) => [
        targetKey,
        {
          sourceFactory: expectedRows[targetKey]?.sourceFactory,
          featureSlotId: row.featureSlotId,
          sourceCheckId: row.sourceCheckId,
          cycleId: row.cycleId,
          roleUrlId: row.roleUrlId,
          checkpointId: row.checkpointId,
          adminCheckId: row.adminCheckId,
          ...(row.featureTargetKind === undefined
            ? {}
            : { featureTargetKind: row.featureTargetKind }),
        },
      ]),
    ),
    expectedRows,
  );
});

test("all production feature spine provenance reaches readiness and proof graph rows", () => {
  assertFeatureSpineProvenanceReachesReadinessAndProofGraph({
    provenanceCases: allProductionFeatureSpineTargetProvenanceCases,
  });
});

function assertFeatureSpineProvenanceReachesReadinessAndProofGraph({
  provenanceCases,
}) {
  const sourceCheckIds = [
    ...new Set(
      provenanceCases.map((provenanceCase) => provenanceCase.sourceCheckId),
    ),
  ];
  assert.deepEqual(
    Object.values(releaseReadinessProductionFeatureSpineTargets).map(
      (target) => target.featureSlotId,
    ),
    provenanceCases.map((provenanceCase) => provenanceCase.featureSlotId),
  );
  for (const sourceCheckId of sourceCheckIds) {
    const sourceProvenanceCases = provenanceCases.filter(
      (provenanceCase) => provenanceCase.sourceCheckId === sourceCheckId,
    );
    const roleUrlHrefs = Object.fromEntries(
      sourceProvenanceCases.map((provenanceCase) => [
        provenanceCase.roleUrlId,
        roleUrlForProvenanceCase(provenanceCase),
      ]),
    );
    const firstProvenanceCase = sourceProvenanceCases[0];
    const readinessTargets = buildProductionFeatureSpineTargetCollection({
      declarations: releaseReadinessProductionFeatureSpineTargets,
      sourceTarget: {
        sourceCheckId,
        detailRoleUrl: firstProvenanceCase.detailRoleUrlIncludes,
        browserProofCommand: "npm run test:dev-test-game-core-live",
        sourceProofArtifact: firstProvenanceCase.proofArtifact,
        rerunCommand: firstProvenanceCase.rerunCommand,
        cycleIds: [
          ...new Set(
            sourceProvenanceCases.map(
              (provenanceCase) => provenanceCase.cycleId,
            ),
          ),
        ],
        roleUrlIds: sourceProvenanceCases.map(
          (provenanceCase) => provenanceCase.roleUrlId,
        ),
        checkpointIds: sourceProvenanceCases.map(
          (provenanceCase) => provenanceCase.checkpointId,
        ),
        visibleAdminCheckIds: sourceProvenanceCases.map(
          (provenanceCase) => provenanceCase.adminCheckId,
        ),
        recoveryHookIds: sourceProvenanceCases
          .map((provenanceCase) => provenanceCase.recoveryHookId)
          .filter((id) => id !== undefined),
        roleUrlHrefs,
      },
    });
    const proofGraphDestinations = proofGraphProductionFeatureTargetDestinations({
      nodes: Object.values(readinessTargets.bySlotId).map((target) => ({
        kind: "production-feature-spine-target",
        id: `production-feature:${target.featureSlotId}`,
        roleUrl: firstProvenanceCase.detailRoleUrlIncludes,
        featureSlotId: target.featureSlotId,
        sourceCheckId: target.sourceCheckId,
        targetRoleUrl: target.roleUrl,
        adminCheckId: target.adminCheckId,
        sourceProofArtifact: target.sourceProofArtifact,
        ...(target.featureTargetKind === undefined
          ? {}
          : { featureTargetKind: target.featureTargetKind }),
        browserWorkbench: target.browserWorkbench,
      })),
    });
    const proofGraphDestinationBySlotId = new Map(
      proofGraphDestinations.map((destination) => [
        destination.featureSlotId,
        destination,
      ]),
    );

    assert.deepEqual(
      readinessTargets.slotIds,
      sourceProvenanceCases.map(
        (provenanceCase) => provenanceCase.featureSlotId,
      ),
    );
    for (const provenanceCase of sourceProvenanceCases) {
      const declaration =
        releaseReadinessProductionFeatureSpineTargets[
          provenanceCase.targetKey
        ];
      const readinessTarget =
        readinessTargets.bySlotId[provenanceCase.featureSlotId];
      const proofGraphDestination = proofGraphDestinationBySlotId.get(
        provenanceCase.featureSlotId,
      );
      assert.deepEqual(declaration, {
        featureSlotId: provenanceCase.featureSlotId,
        sourceCheckId: provenanceCase.sourceCheckId,
        cycleId: provenanceCase.cycleId,
        roleUrlId: provenanceCase.roleUrlId,
        rowKind:
          provenanceCase.recoveryHookId === undefined
            ? "checkpoint"
            : "recovery-hook",
        checkpointId: provenanceCase.checkpointId,
        ...(provenanceCase.recoveryHookId === undefined
          ? {}
          : { recoveryHookId: provenanceCase.recoveryHookId }),
        adminCheckId: provenanceCase.adminCheckId,
        ...(provenanceCase.featureTargetKind === undefined
          ? {}
          : { featureTargetKind: provenanceCase.featureTargetKind }),
      });
      assert.equal(
        readinessTarget.sourceProofArtifact,
        provenanceCase.proofArtifact,
      );
      assert.equal(readinessTarget.rerunCommand, provenanceCase.rerunCommand);
      assert.equal(readinessTarget.adminCheckId, provenanceCase.adminCheckId);
      assert.equal(
        readinessTarget.browserWorkbench.requiredEvidence.includes(
          provenanceCase.adminCheckId,
        ),
        true,
      );
      assertFeatureSpineProofGraphDestination({
        destination: proofGraphDestination,
        provenanceCase,
        targetRoleUrl: roleUrlForProvenanceCase(provenanceCase),
      });
    }
  }
}

function roleUrlForProvenanceCase(provenanceCase) {
  if (provenanceCase.roleUrlIncludes === "/g/") {
    return `/g/${provenanceCase.roleUrlId}`;
  }
  return provenanceCase.roleUrlIncludes;
}

function assertFeatureSpineProofGraphDestination({
  destination,
  provenanceCase,
  targetRoleUrl,
}) {
  const expectedGraphKind = provenanceCase.graphSourceNodeId.startsWith(
    "admin-proof:",
  )
    ? "admin-audit"
    : "role-url";
  const commonDestination = {
    kind: destination.kind,
    featureSlotId: destination.featureSlotId,
    sourceCheckId: destination.sourceCheckId,
    targetRoleUrl: destination.targetRoleUrl,
    adminCheckId: destination.adminCheckId,
    sourceProofArtifact: destination.sourceProofArtifact,
    ...(destination.featureTargetKind === undefined
      ? {}
      : { featureTargetKind: destination.featureTargetKind }),
  };
  const commonExpected = {
    kind: expectedGraphKind,
    featureSlotId: provenanceCase.featureSlotId,
    sourceCheckId: provenanceCase.sourceCheckId,
    targetRoleUrl,
    adminCheckId: provenanceCase.adminCheckId,
    sourceProofArtifact: provenanceCase.proofArtifact,
    ...(provenanceCase.featureTargetKind === undefined
      ? {}
      : { featureTargetKind: provenanceCase.featureTargetKind }),
  };
  if (expectedGraphKind === "admin-audit") {
    const expectedAuditId = provenanceCase.detailRoleUrlIncludes.match(
      /^\/admin\/audit\/([^?]+)/,
    )?.[1];
    assert.deepEqual(
      {
        ...commonDestination,
        auditId: destination.auditId,
        requiredChecks: destination.requiredChecks,
      },
      {
        ...commonExpected,
        auditId: expectedAuditId,
        requiredChecks: [provenanceCase.adminCheckId],
      },
    );
    return;
  }
  assert.deepEqual(
    {
      ...commonDestination,
      roleUrl: destination.roleUrl,
    },
    {
      ...commonExpected,
      roleUrl: targetRoleUrl,
    },
  );
}

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

test("proof graph admin feature targets derive from shared source rows", () => {
  const expectedCases = [
    {
      generatedFromKey: "hostSetupFeatureTarget",
      label: "host setup",
      readinessLabel: "Host setup role URL, policy, roster, and recovery proof",
      proofBoundary: null,
      source: hostSetupFeatureSpineSource,
      targetRow: hostSetupFeatureSpineTargetRows.hostSetupRoute,
      visibleAdminCheckIds: ["start-phase"],
      readinessDetailKeys: [
        "capabilityLabel",
        "readyCheckIds",
        "browserWorkbench",
        "setupMutationStatus",
        "policyCommandStatus",
      ],
    },
    {
      generatedFromKey: "cohostFeatureTarget",
      label: "cohost console",
      readinessLabel: "Cohost role URL delegated host-console proof",
      proofBoundary:
        "Seeded dev-test-game cohost role URL proof from proof-run. Proves delegated deadline control and NotHost rejection for host-only resolve; does not prove hosted identity, multi-node races, release readiness, or production readiness.",
      source: cohostFeatureSpineSource,
      targetRow: cohostFeatureSpineTargetRows.cohostConsole,
      visibleAdminCheckIds: ["cohost-console"],
      readinessDetailKeys: [
        "capabilityLabel",
        "extendDeadlineState",
        "extendDeadlinePrincipal",
        "hostOnlyRejectError",
        "hostOnlyRejectPrincipal",
        "phaseAfterRejectId",
        "phaseAfterRejectLocked",
      ],
    },
    {
      generatedFromKey: "replacementFeatureTarget",
      label: "replacement player",
      readinessLabel: "Replacement player role URL proof",
      proofBoundary:
        "Seeded dev-test-game replacement player role URL proof from proof-run. Proves host-issued replacement URL, fresh replacement session recovery, incoming player slot authority, stale outgoing player rejection, and private-channel authority transfer; does not prove hosted identity, invite delivery, multi-node races, release readiness, or production readiness.",
      source: replacementFeatureSpineSource,
      targetRow: replacementFeatureSpineTargetRows.replacementPlayer,
      visibleAdminCheckIds: [
        "replacement-incoming-player",
        "replacement-stale-player",
      ],
      buildVisibleAdminCheckIds: [
        "replacement-host-issued-invite",
        "replacement-session-refresh-recovery",
        "replacement-incoming-player",
        "replacement-stale-player",
        "replacement-stale-private-channel",
        "replacement-stale-private-receipts",
      ],
      readinessDetailKeys: [
        "principalUserId",
        "commandStateSlot",
        "capabilityKinds",
        "hostIssuedInvite",
        "sessionRefresh",
        "incomingPlayer",
        "staleOutgoing",
        "privateAuthority",
      ],
    },
    {
      generatedFromKey: "replacementActionFeatureTarget",
      label: "replacement action",
      readinessLabel: "Replacement action recovery role URL proof",
      proofBoundary:
        "Seeded dev-test-game replacement action role URL proof from proof-run. Proves incoming replacement factional_kill submission, reconnect into locked resolved state, stale replacement action PhaseLocked recovery, and scoped target receipt visibility; does not prove hosted identity, hosted transport, multi-node races, release readiness, or production readiness.",
      source: replacementActionFeatureSpineSource,
      targetRow:
        replacementActionFeatureSpineTargetRows.replacementActionRecovery,
      visibleAdminCheckIds: [
        "replacement-incoming-action",
        "replacement-action-reconnect",
        "replacement-stale-action-after-resolve",
      ],
      readinessDetailKeys: ["incomingAction", "reconnect", "staleAction"],
    },
    {
      generatedFromKey: "replacementPrivateFeatureTarget",
      label: "replacement private",
      readinessLabel: "Replacement private-channel recovery role URL proof",
      proofBoundary:
        "Seeded dev-test-game replacement private-channel role URL proof from proof-run. Proves current replacement private-channel authority, stale outgoing private-channel and receipt denial, stale private-post ACK and reconnect recovery after resolution, completed-game private-post rejection, and completed private-channel reload; does not prove hosted identity, hosted transport, release readiness, or production readiness.",
      source: replacementPrivateFeatureSpineSource,
      targetRow:
        replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
      visibleAdminCheckIds: [
        "replacement-stale-private-channel",
        "replacement-stale-private-post-after-complete-reload",
      ],
      buildVisibleAdminCheckIds: [
        "replacement-stale-private-channel",
        "replacement-stale-private-receipts",
        "replacement-stale-private-post-after-resolve",
        "replacement-stale-private-post-reconnect",
        "replacement-stale-private-post-after-complete",
        "replacement-stale-private-post-after-complete-reload",
      ],
      readinessDetailKeys: [
        "authority",
        "receipts",
        "resolvedPost",
        "reconnect",
        "completedPost",
        "completedReload",
      ],
    },
  ];
  assert.deepEqual(
    roleSurfaceSpineCaseList.map((featureTargetCase) => [
      featureTargetCase.generatedFromKey,
      featureTargetCase.label,
      featureTargetCase.readinessLabel,
      featureTargetCase.proofBoundary ?? null,
      featureTargetCase.source.sourceCheckId,
      featureTargetCase.source.graphSourceNodeId,
      featureTargetCase.source.roleUrlIncludes,
      featureTargetCase.source.rerunCommand,
      featureTargetCase.targetRow.featureSlotId,
      featureTargetCase.targetRow.sourceCheckId,
      featureTargetCase.targetRow.checkpointId,
      featureTargetCase.targetRow.adminCheckId,
      roleSurfaceBrowserWorkbenchEvidence(
        featureTargetCase,
        featureTargetCase.source.roleUrlIncludes,
      ),
      [...featureTargetCase.visibleAdminCheckIds],
      featureTargetCase.buildVisibleAdminCheckIds === undefined
        ? null
        : [...featureTargetCase.buildVisibleAdminCheckIds],
      Object.keys(featureTargetCase.readinessDetails({})),
    ]),
    expectedCases.map((featureTargetCase) => [
      featureTargetCase.generatedFromKey,
      featureTargetCase.label,
      featureTargetCase.readinessLabel,
      featureTargetCase.proofBoundary,
      featureTargetCase.source.sourceCheckId,
      featureTargetCase.source.graphSourceNodeId,
      featureTargetCase.source.roleUrlIncludes,
      featureTargetCase.source.rerunCommand,
      featureTargetCase.targetRow.featureSlotId,
      featureTargetCase.targetRow.sourceCheckId,
      featureTargetCase.targetRow.checkpointId,
      featureTargetCase.targetRow.adminCheckId,
      {
        status: "passed",
        route: featureTargetCase.source.roleUrlIncludes,
        roleUrl: featureTargetCase.source.roleUrlIncludes,
        roleSurface: featureTargetCase.label.replace(/\s+/g, "-"),
        featureSlotId: featureTargetCase.targetRow.featureSlotId,
        requiredEvidence: `Seeded ${featureTargetCase.label} role URL opens ${featureTargetCase.source.roleUrlIncludes} in the browser proof before ${featureTargetCase.targetRow.adminCheckId} recovery is trusted.`,
      },
      featureTargetCase.visibleAdminCheckIds,
      featureTargetCase.buildVisibleAdminCheckIds ?? null,
      featureTargetCase.readinessDetailKeys,
    ]),
  );
  assert.equal(proofGraphAdminFeatureTargetCases, roleSurfaceSpineCaseList);
  for (const featureTargetCase of proofGraphAdminFeatureTargetCases) {
    assert.equal(
      featureTargetCase.targetRow.sourceCheckId,
      featureTargetCase.source.sourceCheckId,
    );
  }
});

test("scenario-owned production feature targets avoid hand-maintained row literals", async () => {
  const source = await readFile(
    "tools/dev_test_game_release_readiness_cases.mjs",
    "utf8",
  );
  assert.match(source, /Object\.entries\(coreLoopSpineRows\)\.map/);
  assert.match(source, /Object\.entries\(hardeningSpineRows\)\.map/);
  assert.match(source, /featureSpineTargetFromSourceRow\(row\)/);
  for (const targetKey of Object.keys(coreLoopFeatureSpineTargetRows)) {
    assert.equal(
      source.includes(`${targetKey}: featureSpine`),
      false,
      `core-loop target should derive from catalog row: ${targetKey}`,
    );
  }
  for (const targetKey of Object.keys(hardeningFeatureSpineTargetRows)) {
    assert.equal(
      source.includes(`${targetKey}: featureSpine`),
      false,
      `hardening target should derive from catalog row: ${targetKey}`,
    );
  }
  const identityBlock = featureTargetDeclarationBlock(source, "identityAdapter");
  assert.match(
    identityBlock,
    /\.\.\.identitySpineRows\.identityAdapter/,
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
  assert.equal(
    blocked.command,
    `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`,
  );
  assert.equal(
    blocked.proofTarget,
    devTestGameHostedEvidenceOperatorChecklistProofPath,
  );
  assert.deepEqual(blocked.hostedHandoffChecklist.blockedCheckIds, [
    "frontend-url-configured",
  ]);
  assert.ok(blocked.hostedHandoffChecklist.inputIds.includes("proof-target"));

  const checklistProven = releaseReadinessBuildableItemForId(
    "hosted-deployment",
    {
      hostedTargetPreflight: {
        status: "blocked",
        checks: [
          {
            id: "raw-evidence-path-configured",
            status: "blocked",
            requiredEvidence: "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
          },
        ],
      },
      hostedEvidenceOperatorChecklistAdminProof: { status: "passed" },
    },
  );
  assert.equal(
    checklistProven.command,
    `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
  );
  assert.equal(
    checklistProven.proofTarget,
    devTestGameRealHostedMatrixRawCapturePath,
  );
  assert.deepEqual(checklistProven.hostedHandoffChecklist.blockedCheckIds, [
    "raw-evidence-path-configured",
  ]);

  const rawCaptureProven = releaseReadinessBuildableItemForId(
    "hosted-deployment",
    {
      realHostedMatrixRawCapture: {
        status: "passed",
        rawEvidenceFixture: false,
        rawEvidenceSyntheticExternalTarget: false,
      },
    },
  );
  assert.equal(
    rawCaptureProven.command,
    `npm run ${devTestGameHostedTargetPreflightCommand}`,
  );
  assert.equal(
    rawCaptureProven.proofTarget,
    devTestGameHostedTargetPreflightPath,
  );
  assert.equal(
    rawCaptureProven.roleUrl,
    "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
  );
  assert.equal(
    rawCaptureProven.proofGraphNodeId,
    "admin-proof:hosted-target-preflight",
  );
  assert.equal(
    rawCaptureProven.realHostedEvidenceInputs.command,
    `npm run ${devTestGameHostedTargetPreflightCommand}`,
  );

  const fixtureRawCapture = releaseReadinessBuildableItemForId(
    "hosted-deployment",
    {
      hostedEvidenceOperatorChecklistAdminProof: { status: "passed" },
      realHostedMatrixRawCapture: {
        status: "passed",
        rawEvidenceFixture: true,
        rawEvidenceSyntheticExternalTarget: false,
      },
    },
  );
  assert.equal(
    fixtureRawCapture.command,
    `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
  );
  assert.equal(
    fixtureRawCapture.proofTarget,
    devTestGameRealHostedMatrixRawCapturePath,
  );

  const passed = releaseReadinessBuildableItemForId("hosted-deployment", {
    hostedTargetPreflight: {
      status: "passed",
      target: { rawEvidenceSyntheticExternalTarget: true },
    },
  });
  assert.equal(
    passed.command,
    "npm run test:dev-test-game-hosted-evidence-lane",
  );
  assert.equal(
    passed.proofTarget,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.equal(
    passed.roleUrl,
    releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
  );
  assert.equal(
    passed.proofGraphNodeId,
    "admin-proof:hosted-concurrent-race-matrix",
  );
  assert.equal(passed.hostedEvidenceMode, "real-hosted");
  assert.equal(passed.realHostedEvidenceStatus, "passed");

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
