import {
  buildRealHostedEvidenceInputs,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";

export const devTestGameReleaseRunbookPath =
  "target/dev-test-game/release-runbook.json";
export const devTestGameReleaseRunbookCommand = "test:dev-test-game-release-runbook";

export const releaseReadinessProductionFeatureSpineTargets = Object.freeze({
  hostPhaseControl: Object.freeze({
    featureSlotId: "host-phase-control",
    sourceCheckId: "local-core-loop-proof",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-host",
    checkpointId: "d02-n02-d02-vote-open",
    adminCheckId: "host-lifecycle-control",
  }),
  playerActionSubmission: Object.freeze({
    featureSlotId: "player-action-submission",
    sourceCheckId: "local-core-loop-proof",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-actionPlayer",
    checkpointId: "d02-n02-n02-action-open",
    adminCheckId: "action-loop",
  }),
  privateChannel: Object.freeze({
    featureSlotId: "private-channel",
    sourceCheckId: "local-core-loop-proof",
    cycleId: "d01-n01-d02",
    roleUrlId: "d01-n01-d02-actionPlayer",
    checkpointId: "d01-n01-d02-n01-action-open",
    adminCheckId: "private-channel",
  }),
  staleRecovery: Object.freeze({
    featureSlotId: "stale-recovery",
    sourceCheckId: "local-core-loop-proof",
    cycleId: "d01-n01-d02",
    roleUrlId: "d01-n01-d02-host",
    checkpointId: "d01-n01-d02-d01-resolved-locked",
    adminCheckId: "stale-deadline-advance",
  }),
});

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
    return {
      priority: 0,
      command: "npm run test:dev-test-game-hosted-evidence-lane",
      buildSlice:
        syntheticExternalTarget
          ? "Run the one-command hosted evidence lane to refresh the local demo pass path; real externally hosted evidence remains required."
          : "Run the one-command hosted evidence lane; the hosted target preflight has passed, so the lane can write external hosted matrix evidence.",
      proofTarget: "target/dev-test-game/hosted-matrix-external.json",
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.hostPhaseControl,
      proofBoundary:
        syntheticExternalTarget
          ? "Local demo hosted evidence handoff after passed synthetic target preflight. This command refreshes the blocked-to-passed local pass path, but does not satisfy real hosted deployment evidence."
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
      hostedHandoffChecklist: hostedHandoffChecklistFromPreflight({
        preflight: hostedTargetPreflight,
        command: blockedBuildable.command,
        proofTarget: blockedBuildable.proofTarget,
        realHostedEvidenceInputs: blockedBuildable.realHostedEvidenceInputs,
      }),
    };
  }
  return blockedBuildable;
}

function hostedHandoffChecklistFromPreflight({
  preflight,
  command,
  proofTarget,
  realHostedEvidenceInputs,
}) {
  const blockedChecks = (preflight.checks ?? [])
    .filter((check) => check?.status === "blocked")
    .map((check) => ({
      id: String(check.id ?? ""),
      status: "blocked",
      requiredEvidence: String(check.requiredEvidence ?? ""),
    }))
    .filter((check) => check.id !== "");
  return {
    status: "blocked",
    preflightStatus: String(preflight.status ?? "unknown"),
    command,
    proofTarget,
    inputIds: realHostedEvidenceInputIds(realHostedEvidenceInputs),
    blockedCheckIds: blockedChecks.map((check) => check.id),
    blockedChecks,
  };
}

function realHostedEvidenceInputIds(realHostedEvidenceInputs) {
  const env = Array.isArray(realHostedEvidenceInputs?.env)
    ? realHostedEvidenceInputs.env
    : [];
  return [
    "command",
    "proof-target",
    ...env
      .map((item) => String(item?.name ?? ""))
      .filter((name) => name !== ""),
  ];
}

const localBuildableReleaseReadinessItems = new Map([
  [
    "hosted-deployment",
    {
      priority: 0,
      command: "npm run test:dev-test-game-hosted-evidence-lane",
      buildSlice:
        "Run the one-command hosted evidence lane; it records a blocked preflight report until externally reachable hosted URLs and raw evidence are configured.",
      proofTarget: "target/dev-test-game/hosted-evidence-lane.json",
      roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-evidence-lane",
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
      command: "npm run test:dev-test-game-hosted-concurrent-race-matrix",
      buildSlice:
        "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
      proofTarget: "target/dev-test-game/hosted-concurrent-race-matrix.json",
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.playerActionSubmission,
      proofBoundary:
        "Machine-readable request artifact only. This can prepare hosted-like concurrent race proof work from the local promoted baseline, but it does not prove hosted deployment, multi-node races, beta readiness, release readiness, or production readiness.",
    },
  ],
  [
    "real-hosted-concurrent-race-matrix",
    {
      priority: 10,
      command: "npm run test:dev-test-game-hosted-matrix-external-evidence",
      buildSlice:
        "Promote the local hosted-like matrix with externally reachable hosted race, reload, reconnect, and stale-client evidence.",
      proofTarget: "target/dev-test-game/hosted-matrix-external.json",
      roleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.staleRecovery,
      proofBoundary:
        "External hosted matrix handoff. Passing requires normalized raw evidence from a real hosted target; local browser/API proof artifacts are only the baseline.",
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
      roleUrl: "/admin/audit/local-release-runbook?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:release-runbook",
      productionFeatureSpineTarget:
        releaseReadinessProductionFeatureSpineTargets.privateChannel,
      proofBoundary:
        "Machine-readable local runbook rehearsal only. This can prove the release checklist is mapped and inspectable, but it does not prove human approval, beta readiness, release readiness, or production readiness.",
    },
  ],
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
  };
}
