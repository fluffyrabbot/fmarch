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
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameHostedIdentityCompleteAdminProofPath,
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceFixturePaths,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceRedactedPassFixturePath,
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
  hostSetupFeatureSpineTargetRows,
} from "./dev_test_game_host_setup_feature_spine_targets.mjs";
import {
  cohostFeatureSpineTargetRows,
} from "./dev_test_game_cohost_feature_spine_targets.mjs";
import {
  replacementFeatureSpineTargetRows,
} from "./dev_test_game_replacement_feature_spine_targets.mjs";
import {
  replacementActionFeatureSpineTargetRows,
} from "./dev_test_game_replacement_action_feature_spine_targets.mjs";
import {
  replacementPrivateFeatureSpineTargetRows,
} from "./dev_test_game_replacement_private_feature_spine_targets.mjs";
import {
  hardeningFeatureSpineTargetRows,
} from "./dev_test_game_hardening_feature_spine_targets.mjs";
import {
  featureSpineCheckpointTarget,
  featureSpineRecoveryHookTarget,
  featureSpineTargetBySlotId,
} from "./dev_test_game_feature_spine_targets.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_artifact_paths.mjs";
import {
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";

export {
  devTestGameReleaseAdminProofPath,
  devTestGameReleaseRunbookAdminProofPath,
  devTestGameReleaseRunbookCommand,
  devTestGameReleaseRunbookPath,
} from "./dev_test_game_release_artifact_paths.mjs";
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
  devTestGameHostedConcurrentRaceMatrixPath;
export const releaseReadinessRealHostedConcurrentRaceMatrixCommand =
  "npm run test:dev-test-game-hosted-matrix-external-evidence";
export const releaseReadinessRealHostedConcurrentRaceMatrixProofTarget =
  hostedMatrixExternalEvidencePath;
const coreLoopSpineRows = coreLoopFeatureSpineTargetRows;
const identitySpineRows = identityFeatureSpineTargetRows;
const hardeningSpineRows = hardeningFeatureSpineTargetRows;

const coreLoopProductionFeatureSpineTargets = Object.freeze(
  Object.fromEntries(
    Object.entries(coreLoopSpineRows).map(([targetKey, row]) => [
      targetKey,
      featureSpineTargetFromSourceRow(row),
    ]),
  ),
);
const hardeningProductionFeatureSpineTargets = Object.freeze(
  Object.fromEntries(
    Object.entries(hardeningSpineRows).map(([targetKey, row]) => [
      targetKey,
      featureSpineTargetFromSourceRow(row),
    ]),
  ),
);

export const releaseReadinessProductionFeatureSpineTargets = Object.freeze({
  identityAdapter: featureSpineCheckpointTarget({
    ...identitySpineRows.identityAdapter,
  }),
  hostSetupRoute: featureSpineCheckpointTarget({
    ...hostSetupFeatureSpineTargetRows.hostSetupRoute,
  }),
  cohostConsole: featureSpineCheckpointTarget({
    ...cohostFeatureSpineTargetRows.cohostConsole,
  }),
  replacementPlayer: featureSpineCheckpointTarget({
    ...replacementFeatureSpineTargetRows.replacementPlayer,
  }),
  replacementActionRecovery: featureSpineCheckpointTarget({
    ...replacementActionFeatureSpineTargetRows.replacementActionRecovery,
  }),
  replacementPrivateChannel: featureSpineCheckpointTarget({
    ...replacementPrivateFeatureSpineTargetRows.replacementPrivateChannel,
  }),
  ...coreLoopProductionFeatureSpineTargets,
  ...hardeningProductionFeatureSpineTargets,
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
  hostedIdentityEvidenceAdminProofEvidence,
  seedFixtureEvidence,
  backupRestoreEvidence,
  raceCoverageEvidence,
  hostedConcurrentRaceMatrixEvidence,
  opsArtifactsEvidence,
  hostedOpsSignalsEvidence,
  releaseRunbookEvidence,
}) {
  return [
    ...identityUnprovenItems({
      identityAdapterEvidence,
      hostedIdentityEvidenceAdminProofEvidence,
    }),
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

function identityUnprovenItems({
  identityAdapterEvidence,
  hostedIdentityEvidenceAdminProofEvidence,
}) {
  if (identityAdapterEvidence === undefined) {
    return [releaseReadinessUnprovenItem("production-identity")];
  }
  if (
    hostedIdentityEvidenceAdminProofEvidence === undefined ||
    !hostedIdentityEvidenceSatisfiesProductionIdentity(
      hostedIdentityEvidenceAdminProofEvidence,
    )
  ) {
    return [releaseReadinessUnprovenItem("hosted-production-identity")];
  }
  return [];
}

export function hostedIdentityEvidenceSatisfiesProductionIdentity(evidence) {
  return (
    evidence?.evidenceStatus === "passed" &&
    evidence.rawEvidenceStatus === "passed" &&
    evidence.fixtureEvidence !== true &&
    hostedIdentityEvidencePathKind(evidence.rawEvidencePath) ===
      "operator-provided"
  );
}

export function hostedIdentityEvidenceSatisfiesCompleteLocalPacket(evidence) {
  return (
    evidence?.status === "passed" &&
    evidence.evidenceStatus === "passed" &&
    evidence.rawEvidenceStatus === "passed" &&
    evidence.path === devTestGameHostedIdentityCompleteAdminProofPath &&
    evidence.rawEvidencePath === hostedIdentityEvidenceRedactedPassFixturePath &&
    evidence.fixtureEvidence === true &&
    evidence.hostedIdentityPacketSummaryStatuses?.status ===
      "provided\n6/6 sections provided\n0 sections missing" &&
    evidence.hostedIdentityPacketSummaryStatuses?.inputs ===
      "16/16 inputs provided\n0 inputs missing" &&
    evidence.releaseReady === false &&
    evidence.productionReady === false
  );
}

export function hostedIdentityEvidencePathKind(rawEvidencePath) {
  const normalized = String(rawEvidencePath ?? "").trim();
  if (normalized === "") {
    return "missing";
  }
  if (hostedIdentityEvidenceFixturePaths.includes(normalized)) {
    return "fixture";
  }
  return "operator-provided";
}

export function releaseReadinessBuildableItemForId(
  itemId,
  {
    hostedTargetPreflight = null,
    hostedEvidenceOperatorChecklistAdminProof = null,
  } = {},
) {
  if (itemId === "hosted-deployment") {
    return hostedDeploymentBuildable({
      hostedTargetPreflight,
      hostedEvidenceOperatorChecklistAdminProof,
    });
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

function hostedDeploymentBuildable({
  hostedTargetPreflight,
  hostedEvidenceOperatorChecklistAdminProof,
}) {
  if (hostedTargetPreflight?.status === "passed") {
    return {
      priority: 0,
      command: hostedEvidenceLaneCommand,
      buildSlice:
        "Run the one-command hosted evidence lane; the hosted target preflight has passed with non-synthetic hosted raw evidence, so the lane can write external hosted matrix evidence.",
      proofTarget: releaseReadinessRealHostedConcurrentRaceMatrixProofTarget,
      roleUrl: releaseReadinessHostedConcurrentRaceMatrixRoleUrl,
      proofGraphNodeId:
        releaseReadinessHostedConcurrentRaceMatrixProofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.hostPhaseControl,
      proofBoundary:
        "External hosted evidence handoff after passed target preflight. This command requires the same FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH target inputs; it does not let local hosted-like or synthetic demo evidence satisfy hosted deployment.",
      hostedEvidenceMode: "real-hosted",
      realHostedEvidenceStatus: "passed",
      realHostedEvidenceInputs: buildRealHostedEvidenceInputs({
        status: "passed",
        mode: "real-hosted",
      }),
    };
  }
  if (hostedEvidenceOperatorChecklistAdminProof?.status === "passed") {
    const blockedBuildable = cloneBuildableItem(
      localBuildableReleaseReadinessItems.get("hosted-deployment"),
    );
    return {
      ...blockedBuildable,
      command: `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
      buildSlice:
        [
          "Attach or validate real hosted raw matrix capture after the operator checklist admin surface is proven;",
          "this keeps hosted deployment blocked until externally captured, non-fixture evidence exists.",
        ].join(" "),
      proofTarget: devTestGameRealHostedMatrixRawCapturePath,
      proofBoundary:
        [
          "Real hosted raw-capture intake.",
          "This command validates operator-provided FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH inputs after the checklist proof is current;",
          "it does not let local hosted-like, fixture, or synthetic demo evidence satisfy hosted deployment.",
        ].join(" "),
      hostedHandoffChecklist:
        hostedTargetPreflight?.status === "blocked"
          ? hostedEvidenceBlockedHandoffChecklistFromPreflight({
              preflight: hostedTargetPreflight,
              command: blockedBuildable.command,
              proofTarget: blockedBuildable.proofTarget,
            })
          : blockedBuildable.hostedHandoffChecklist,
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
      command: `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`,
      buildSlice:
        [
          "Run the hosted evidence operator checklist proof before live hosted URLs exist;",
          "it proves the source-controlled checklist, package command, and raw-evidence template stay synchronized before the real hosted evidence lane can pass.",
        ].join(" "),
      proofTarget: devTestGameHostedEvidenceOperatorChecklistProofPath,
      roleUrl: releaseReadinessHostedEvidenceLaneRoleUrl,
      proofGraphNodeId: releaseReadinessHostedEvidenceLaneProofGraphNodeId,
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.hostPhaseControl,
      proofBoundary:
        [
          "Hosted evidence operator-checklist proof.",
          "This command proves the operator-facing checklist contract while FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, and FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH are still missing;",
          "it does not let local hosted-like evidence satisfy hosted deployment.",
        ].join(" "),
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
