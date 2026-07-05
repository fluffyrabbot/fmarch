import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
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
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
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
  replacementFeatureSpineSource,
  replacementFeatureSpineSourceCheckId,
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineSource,
  replacementActionFeatureSpineSourceCheckId,
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineSource,
  replacementPrivateFeatureSpineSourceCheckId,
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";
import {
  cohostFeatureSpineSource,
  cohostFeatureSpineTargetRows,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineCycleIds,
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  hostSetupFeatureSpineSource,
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  proofGraphAdminFeatureTargetCases,
} from "./dev_test_game_proof_graph_feature_target_cases.mjs";
import {
  roleSurfaceSpineCaseList,
} from "./dev_test_game_role_surface_spine_cases.mjs";
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

test("replacement production feature target derives proof row ids from shared source rows", () => {
  const source = replacementFeatureSpineTargetRows.replacementPlayer;
  const target = releaseReadinessProductionFeatureSpineTargets.replacementPlayer;
  assert.equal(target.featureSlotId, source.featureSlotId);
  assert.equal(target.sourceCheckId, replacementFeatureSpineSourceCheckId);
  assert.equal(target.cycleId, source.cycleId);
  assert.equal(target.roleUrlId, source.roleUrlId);
  assert.equal(target.checkpointId, source.checkpointId);
  assert.equal(target.adminCheckId, source.adminCheckId);
});

test("replacement action production feature target derives proof row ids from shared source rows", () => {
  const source =
    replacementActionFeatureSpineTargetRows.replacementActionRecovery;
  const target =
    releaseReadinessProductionFeatureSpineTargets.replacementActionRecovery;
  assert.equal(target.featureSlotId, source.featureSlotId);
  assert.equal(target.sourceCheckId, replacementActionFeatureSpineSourceCheckId);
  assert.equal(target.cycleId, source.cycleId);
  assert.equal(target.roleUrlId, source.roleUrlId);
  assert.equal(target.checkpointId, source.checkpointId);
  assert.equal(target.adminCheckId, source.adminCheckId);
});

test("replacement private production feature target derives proof row ids from shared source rows", () => {
  const source =
    replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel;
  const target =
    releaseReadinessProductionFeatureSpineTargets.replacementPrivateChannel;
  assert.equal(target.featureSlotId, source.featureSlotId);
  assert.equal(target.sourceCheckId, replacementPrivateFeatureSpineSourceCheckId);
  assert.equal(target.cycleId, source.cycleId);
  assert.equal(target.roleUrlId, source.roleUrlId);
  assert.equal(target.checkpointId, source.checkpointId);
  assert.equal(target.adminCheckId, source.adminCheckId);
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
