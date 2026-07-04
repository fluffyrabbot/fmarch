import {
  buildRealHostedEvidenceInputs,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  hostedMatrixExternalEvidenceProofTarget,
  hostedMatrixRealHostedEvidenceCommand,
  hostedMatrixRealHostedHandoffChecklist,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  hostedEvidenceBlockedHandoffChecklistFromPreflight,
  hostedEvidenceLaneCommand,
  hostedEvidenceLanePath,
  hostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameHostedEvidenceLaneDemoProofCommand,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceHandoffCase,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityHandoffCase,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  coreLoopFeatureSpineTargetRows,
} from "./dev_test_game_core_loop_feature_spine_targets.mjs";
import {
  identityFeatureSpineTargetRows,
} from "./dev_test_game_identity_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineCycleIds,
  hardeningFeatureSpineSourceCheckId,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  completedGameHardeningSpineCycleId,
  completedGameStaleRecoverySpineLaneCase,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  replacementStaleConflictMessageSpineLaneCase,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  featureSpineCheckpointTarget,
  featureSpineRecoveryHookTarget,
  featureSpineTargetBySlotId,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export const devTestGameReleaseRunbookPath =
  "target/dev-test-game/release-runbook.json";
export const devTestGameReleaseRunbookCommand = "test:dev-test-game-release-runbook";
export const releaseReadinessHostedEvidenceLaneRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane);
export const releaseReadinessHostedEvidenceLaneProofGraphNodeId =
  "admin-proof:hosted-evidence-lane";
export const releaseReadinessHostedEvidenceLaneProofTarget =
  hostedEvidenceLanePath;
export const releaseReadinessHostedConcurrentRaceMatrixCommand =
  "npm run test:dev-test-game-hosted-concurrent-race-matrix";
export const releaseReadinessHostedConcurrentRaceMatrixRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix);
export const releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId =
  "admin-proof:hosted-concurrent-race-matrix";
export const releaseReadinessHostedConcurrentRaceMatrixProofTarget =
  "target/dev-test-game/hosted-concurrent-race-matrix.json";
export const releaseReadinessRealHostedConcurrentRaceMatrixCommand =
  "npm run test:dev-test-game-hosted-matrix-external-evidence";
export const releaseReadinessRealHostedConcurrentRaceMatrixProofTarget =
  hostedMatrixExternalEvidencePath;
const completedGameStaleRecoverySpineLane =
  completedGameStaleRecoverySpineLaneCase();
const replacementStaleConflictMessageSpineLane =
  replacementStaleConflictMessageSpineLaneCase();
const coreLoopSpineRows = coreLoopFeatureSpineTargetRows;
const identitySpineRows = identityFeatureSpineTargetRows;

const coreLoopProductionFeatureSpineTargets = Object.freeze(
  Object.fromEntries(
    Object.entries(coreLoopSpineRows).map(([targetKey, row]) => [
      targetKey,
      featureSpineTargetFromSourceRow(row),
    ]),
  ),
);

export const releaseReadinessProductionFeatureSpineTargets = Object.freeze({
  identityAdapter: featureSpineCheckpointTarget({
    ...identitySpineRows.identityAdapter,
  }),
  ...coreLoopProductionFeatureSpineTargets,
  completedGameStaleRecovery: featureSpineCheckpointTarget({
    featureSlotId: "completed-game-stale-recovery",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: completedGameHardeningSpineCycleId,
    roleUrlId: completedGameStaleRecoverySpineLane.id,
    checkpointId: completedGameStaleRecoverySpineLane.id,
    adminCheckId: completedGameStaleRecoverySpineLane.id,
  }),
  replacementStaleConflictMessage: featureSpineCheckpointTarget({
    featureSlotId: "replacement-stale-conflict-message",
    sourceCheckId: hardeningFeatureSpineSourceCheckId,
    cycleId: hardeningFeatureSpineCycleIds.staleConflict,
    roleUrlId: replacementStaleConflictMessageSpineLane.laneId,
    checkpointId: replacementStaleConflictMessageSpineLane.laneId,
    adminCheckId: replacementStaleConflictMessageSpineLane.laneId,
  }),
});
export const releaseReadinessProductionFeatureSpineTargetsBySlotId =
  featureSpineTargetBySlotId(releaseReadinessProductionFeatureSpineTargets);

function featureSpineTargetFromSourceRow(row) {
  const targetFactory =
    row.recoveryHookId === undefined
      ? featureSpineCheckpointTarget
      : featureSpineRecoveryHookTarget;
  return targetFactory({ ...row });
}

const releaseReadinessUnprovenCases = Object.freeze({
  "production-identity": Object.freeze({
    id: "production-identity",
    status: "unproven",
    requiredEvidence:
      "Real accounts, sessions, and invite delivery replacing local dev tokens without changing role surfaces",
  }),
  "hosted-production-identity": Object.freeze({
    id: "hosted-production-identity",
    status: "unproven",
    requiredEvidence:
      "Hosted account lifecycle, invite delivery, account recovery, rate limits, abuse controls, production session-secret policy, and hosted audit retention/export over the proven role-surface adapter",
  }),
  "hosted-deployment": Object.freeze({
    id: "hosted-deployment",
    status: "unproven",
    requiredEvidence: "Hosted API/frontend deployment proof with external health checks",
  }),
  "seed-demo-fixtures": Object.freeze({
    id: "seed-demo-fixtures",
    status: "unproven",
    requiredEvidence:
      "Machine-readable seeded local demo fixture and scenario inventory tied to this proof run",
  }),
  "hosted-demo-fixtures": Object.freeze({
    id: "hosted-demo-fixtures",
    status: "unproven",
    requiredEvidence:
      "Hosted/demo environment fixtures, sanitized demo data policy, and release-safe invite delivery",
  }),
  "backup-restore-drill": Object.freeze({
    id: "backup-restore-drill",
    status: "unproven",
    requiredEvidence:
      "Local or production-like backup/restore drill tied to this dev-test-game spine",
  }),
  "production-backup-recovery": Object.freeze({
    id: "production-backup-recovery",
    status: "unproven",
    requiredEvidence:
      "Production-like backup storage, PITR restore, key escrow, and secret rotation evidence",
  }),
  "exhaustive-race-coverage": Object.freeze({
    id: "exhaustive-race-coverage",
    status: "unproven",
    requiredEvidence:
      "Machine-readable local race coverage inventory tied to the saved dev-test-game proof-run",
  }),
  "hosted-concurrent-race-matrix": Object.freeze({
    id: "hosted-concurrent-race-matrix",
    status: "unproven",
    requiredEvidence:
      "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
  }),
  "real-hosted-concurrent-race-matrix": Object.freeze({
    id: "real-hosted-concurrent-race-matrix",
    status: "unproven",
    requiredEvidence:
      "Externally reachable hosted API/frontend deployment, multi-node command race execution, and hosted reload/reconnect and stale-client conflict evidence beyond the local hosted-like matrix artifact",
  }),
  "observability-and-operations": Object.freeze({
    id: "observability-and-operations",
    status: "unproven",
    requiredEvidence:
      "Saved local proof artifacts, redacted role entrypoints, checksums, logs/metrics/traces, and operator runbook evidence for the seeded game flow",
  }),
  "hosted-observability-and-operations": Object.freeze({
    id: "hosted-observability-and-operations",
    status: "unproven",
    requiredEvidence:
      "Hosted-like or hosted ops signal bundle tying matrix/readiness artifacts to logs, metrics, traces, paging/SLOs, and incident response boundaries",
  }),
  "real-hosted-observability-and-operations": Object.freeze({
    id: "real-hosted-observability-and-operations",
    status: "unproven",
    requiredEvidence:
      "Hosted logs, metrics, traces, paging/SLOs, and incident response evidence from an externally reachable deployment",
  }),
  "human-release-runbook": Object.freeze({
    id: "human-release-runbook",
    status: "unproven",
    requiredEvidence:
      "Human-executed beta/release checklist with rollback and support path",
  }),
  "human-release-approval": Object.freeze({
    id: "human-release-approval",
    status: "unproven",
    requiredEvidence:
      "Human release owner executes the local runbook rehearsal, verifies rollback/support staffing, and records explicit beta/release approval",
  }),
});

export const releaseReadinessUnprovenCaseIds = Object.freeze(
  Object.keys(releaseReadinessUnprovenCases),
);
export const releaseAdminProofFallbackUnprovenIds = Object.freeze([
  "hosted-deployment",
  "human-release-runbook",
]);

export function releaseReadinessUnprovenItem(id) {
  const item = releaseReadinessUnprovenCases[id];
  if (item === undefined) {
    throw new Error(`unknown release-readiness unproven item: ${id}`);
  }
  return { ...item };
}

export function releaseReadinessUnprovenStatusRows(ids) {
  return ids.map((id) => {
    const item = releaseReadinessUnprovenItem(id);
    return { id: item.id, status: item.status };
  });
}

export function buildReleaseReadinessUnprovenItems({
  identityAdapterEvidence,
  seedFixtureEvidence,
  backupRestoreEvidence,
  raceCoverageEvidence,
  hostedConcurrentRaceMatrixEvidence,
  opsArtifactsEvidence,
  hostedOpsSignalsEvidence,
  releaseRunbookEvidence,
}) {
  return [
    releaseReadinessUnprovenItem(
      identityAdapterEvidence === undefined
        ? "production-identity"
        : "hosted-production-identity",
    ),
    releaseReadinessUnprovenItem("hosted-deployment"),
    releaseReadinessUnprovenItem(
      seedFixtureEvidence === undefined
        ? "seed-demo-fixtures"
        : "hosted-demo-fixtures",
    ),
    releaseReadinessUnprovenItem(
      backupRestoreEvidence === undefined
        ? "backup-restore-drill"
        : "production-backup-recovery",
    ),
    ...raceMatrixUnprovenItems({
      raceCoverageEvidence,
      hostedConcurrentRaceMatrixEvidence,
    }),
    ...observabilityUnprovenItems({
      opsArtifactsEvidence,
      hostedOpsSignalsEvidence,
    }),
    ...humanReleaseUnprovenItems({ releaseRunbookEvidence }),
  ];
}

export function releaseReadinessBuildableItemForId(
  itemId,
  { hostedTargetPreflight = null } = {},
) {
  if (itemId === "hosted-deployment") {
    return hostedDeploymentBuildable({ hostedTargetPreflight });
  }
  const item = localBuildableReleaseReadinessItems.get(itemId);
  return item === undefined ? undefined : cloneBuildableItem(item);
}

function raceMatrixUnprovenItems({
  raceCoverageEvidence,
  hostedConcurrentRaceMatrixEvidence,
}) {
  if (raceCoverageEvidence === undefined) {
    return [releaseReadinessUnprovenItem("exhaustive-race-coverage")];
  }
  if (hostedConcurrentRaceMatrixEvidence === undefined) {
    return [releaseReadinessUnprovenItem("hosted-concurrent-race-matrix")];
  }
  if (hostedConcurrentRaceMatrixEvidence.realHostedDeploymentStatus === "passed") {
    return [];
  }
  return [releaseReadinessUnprovenItem("real-hosted-concurrent-race-matrix")];
}

function observabilityUnprovenItems({
  opsArtifactsEvidence,
  hostedOpsSignalsEvidence,
}) {
  if (opsArtifactsEvidence === undefined) {
    return [releaseReadinessUnprovenItem("observability-and-operations")];
  }
  if (hostedOpsSignalsEvidence === undefined) {
    return [releaseReadinessUnprovenItem("hosted-observability-and-operations")];
  }
  if (hostedOpsSignalsEvidence.hostedTelemetryStatus === "passed") {
    return [];
  }
  return [releaseReadinessUnprovenItem("real-hosted-observability-and-operations")];
}

function humanReleaseUnprovenItems({ releaseRunbookEvidence }) {
  if (releaseRunbookEvidence === undefined) {
    return [releaseReadinessUnprovenItem("human-release-runbook")];
  }
  return [releaseReadinessUnprovenItem("human-release-approval")];
}

function hostedDeploymentBuildable({ hostedTargetPreflight }) {
  if (hostedTargetPreflight?.status === "passed") {
    const syntheticExternalTarget =
      hostedTargetPreflight.target?.rawEvidenceSyntheticExternalTarget === true;
    const command = syntheticExternalTarget
      ? `npm run ${devTestGameHostedEvidenceLaneDemoProofCommand}`
      : hostedEvidenceLaneCommand;
    const proofTarget = syntheticExternalTarget
      ? devTestGameHostedEvidenceLaneDemoProofPath
      : releaseReadinessRealHostedConcurrentRaceMatrixProofTarget;
    const roleUrl = syntheticExternalTarget
      ? releaseReadinessHostedEvidenceLaneRoleUrl
      : releaseReadinessHostedConcurrentRaceMatrixRoleUrl;
    const proofGraphNodeId = syntheticExternalTarget
      ? releaseReadinessHostedEvidenceLaneProofGraphNodeId
      : releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId;
    return {
      priority: 0,
      command,
      buildSlice:
        syntheticExternalTarget
          ? "Run the local hosted evidence lane demo proof; it refreshes blocked and synthetic passed lane artifacts, while real externally hosted evidence remains required."
          : "Run the one-command hosted evidence lane; the hosted target preflight has passed, so the lane can write external hosted matrix evidence.",
      proofTarget,
      roleUrl,
      proofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.hostPhaseControl,
      proofBoundary:
        syntheticExternalTarget
          ? "Local demo proof for the hosted evidence lane pass path after passed synthetic target preflight. This command refreshes blocked and synthetic passed local lane artifacts, but does not satisfy real hosted deployment evidence."
          : "External hosted evidence handoff after passed target preflight. This command requires the same FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH target inputs; it does not let local hosted-like evidence satisfy hosted deployment.",
      hostedEvidenceMode: syntheticExternalTarget ? "synthetic-demo" : "real-hosted",
      realHostedEvidenceStatus: syntheticExternalTarget ? "unproven" : "passed",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: syntheticExternalTarget ? "unproven" : "passed",
        mode: syntheticExternalTarget ? "synthetic-demo" : "real-hosted",
      }),
    };
  }
  const blockedBuildable = cloneBuildableItem(
    localBuildableReleaseReadinessItems.get("hosted-deployment"),
  );
  if (hostedTargetPreflight?.status === "blocked") {
    return {
      ...blockedBuildable,
      hostedHandoffChecklist: hostedEvidenceBlockedHandoffChecklistFromPreflight({
        preflight: hostedTargetPreflight,
        command: blockedBuildable.command,
        proofTarget: blockedBuildable.proofTarget,
      }),
    };
  }
  return blockedBuildable;
}

function hostedProductionIdentityBuildable() {
  const command = `npm run ${devTestGameHostedIdentityEvidenceCommand}`;
  return {
    priority: -10,
    actionStatus: "ready",
    command,
    buildSlice:
      "Run the hosted identity evidence intake; it records a blocked handoff until hosted account lifecycle, invite delivery, recovery, abuse/rate-limit, session-secret, and audit retention evidence are attached without changing role surfaces.",
    proofTarget: devTestGameHostedIdentityEvidencePath,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
    proofGraphNodeId: "admin-proof:hosted-identity-evidence",
    productionFeatureSpineTarget:
      releaseReadinessProductionFeatureSpineTargets.identityAdapter,
    proofBoundary:
      "Hosted identity evidence handoff. The local identity adapter admin proof remains the prerequisite role-surface proof, while this command records the hosted account lifecycle, invite delivery, account recovery, abuse controls, session-secret policy, and hosted audit retention/export inputs needed next; it does not prove beta readiness, release readiness, or production readiness.",
    hostedHandoffChecklist: hostedIdentityEvidenceHandoffCase(),
  };
}

const localBuildableReleaseReadinessItems = new Map([
  [
    "hosted-production-identity",
    hostedProductionIdentityBuildable(),
  ],
  [
    "hosted-deployment",
    {
      priority: 0,
      command: hostedEvidenceLaneCommand,
      buildSlice:
        "Run the one-command hosted evidence lane; it records a blocked preflight report until externally reachable hosted URLs and raw evidence are configured.",
      proofTarget: releaseReadinessHostedEvidenceLaneProofTarget,
      roleUrl: releaseReadinessHostedEvidenceLaneRoleUrl,
      proofGraphNodeId: releaseReadinessHostedEvidenceLaneProofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.hostPhaseControl,
      proofBoundary:
        "Hosted evidence lane handoff. This command records whether FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH are configured for a non-local hosted target, then exposes the blocked or passed lane through its native admin role URL; it does not let local hosted-like evidence satisfy hosted deployment.",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: "unproven",
        mode: "not_configured",
      }),
    },
  ],
  [
    "hosted-concurrent-race-matrix",
    {
      priority: 5,
      command: releaseReadinessHostedConcurrentRaceMatrixCommand,
      buildSlice:
        "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
      proofTarget: releaseReadinessHostedConcurrentRaceMatrixProofTarget,
      roleUrl: releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
      proofGraphNodeId:
        releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.invalidActionRecovery,
      proofBoundary:
        "Machine-readable request artifact only. This can prepare hosted-like concurrent race proof work from the local promoted baseline, but it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
    },
  ],
  [
    "real-hosted-concurrent-race-matrix",
    {
      priority: 10,
      command: releaseReadinessRealHostedConcurrentRaceMatrixCommand,
      buildSlice:
        "Promote the local hosted-like matrix with externally reachable hosted race, reload, reconnect, and stale-client evidence.",
      proofTarget: releaseReadinessRealHostedConcurrentRaceMatrixProofTarget,
      roleUrl: releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
      proofGraphNodeId:
        releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets
          .replacementStaleConflictMessage,
      proofBoundary:
        "External hosted matrix handoff. Passing requires normalized raw evidence from a real hosted target; local browser/API proof artifacts are only the baseline.",
      realHostedEvidenceStatus: "unproven",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: "unproven",
        mode: "real-hosted-handoff",
        command: hostedMatrixRealHostedEvidenceCommand,
        proofTarget: hostedMatrixExternalEvidenceProofTarget,
      }),
      hostedHandoffChecklist: hostedMatrixRealHostedHandoffChecklist(),
    },
  ],
  [
    "real-hosted-observability-and-operations",
    {
      priority: 12,
      command: `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
      buildSlice:
        "Create the real-hosted observability handoff receipt; it keeps local hosted-like ops signals as baseline only and blocks until externally reachable logs, metrics, traces, paging/SLO, and incident-response evidence are attached.",
      proofTarget: devTestGameRealHostedObservabilityHandoffPath,
      roleUrl: localAdminAuditRoleUrl(
        localAdminAuditIds.realHostedObservabilityHandoff,
      ),
      proofGraphNodeId: "admin-proof:real-hosted-observability-handoff",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.privateChannel,
      proofBoundary:
        "Real hosted observability handoff only. The local hosted-like ops signal bundle remains baseline evidence and does not prove hosted logs, metrics, traces, paging/SLO, incident response, release readiness, or production readiness.",
      hostedHandoffChecklist: realHostedObservabilityHandoffCase(),
    },
  ],
  [
    "human-release-runbook",
    {
      priority: 20,
      command: `npm run ${devTestGameReleaseRunbookCommand}`,
      buildSlice:
        "Create the local release-runbook rehearsal that maps remaining readiness gaps to rollback, support, owner, and evidence boundaries.",
      proofTarget: devTestGameReleaseRunbookPath,
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.releaseRunbook),
      proofGraphNodeId: "admin-proof:release-runbook",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.privateChannel,
      proofBoundary:
        "Machine-readable local runbook rehearsal only. This can prove the release checklist is mapped and inspectable, but it does not prove human approval, beta readiness, release readiness, or production readiness.",
    },
  ],
]);

export const releaseReadinessBuildableItemIds = Object.freeze([
  ...localBuildableReleaseReadinessItems.keys(),
]);

function cloneBuildableItem(item) {
  if (item === undefined) {
    return undefined;
  }
  return {
    ...item,
    ...(item.realHostedEvidenceInputs === undefined
      ? {}
      : { realHostedEvidenceInputs: structuredClone(item.realHostedEvidenceInputs) }),
    ...(item.hostedHandoffChecklist === undefined
      ? {}
      : { hostedHandoffChecklist: structuredClone(item.hostedHandoffChecklist) }),
  };
}
