import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

export const devTestGameHostedOpsSignalsAdminProofPath =
  "target/dev-test-game/hosted-ops-signals-admin-proof.json";

export const hostedOpsTelemetryBoundaryCheckId =
  "hosted-telemetry-boundary-carried";
export const hostedOpsReadinessBoundaryCheckId = "readiness-boundary-carried";

export const hostedOpsSignalCheckIds = Object.freeze([
  "hosted-matrix-artifact-checksummed",
  "local-target-signals-carried",
  "matrix-health-counters-carried",
  hostedOpsReadinessBoundaryCheckId,
  hostedOpsTelemetryBoundaryCheckId,
]);

export const hostedOpsSignalRelatedAuditIds = Object.freeze([
  localAdminAuditIds.hostedConcurrentRaceMatrix,
  localAdminAuditIds.opsArtifacts,
]);

export function hostedOpsTelemetryBoundaryStatus(realHostedDeploymentStatus) {
  return realHostedDeploymentStatus === "passed" ? "passed" : "unproven";
}

export function hostedOpsSignalCheckCases({
  hostedConcurrentRaceMatrixPath,
  frontendBaseUrl,
  apiBaseUrl,
  cellCount,
  reconnectLaneCount,
  staleConflictLaneCount,
  realHostedDeploymentStatus,
}) {
  return [
    {
      id: "hosted-matrix-artifact-checksummed",
      status: "passed",
      evidence: hostedConcurrentRaceMatrixPath,
    },
    {
      id: "local-target-signals-carried",
      status: "passed",
      evidence: [frontendBaseUrl, apiBaseUrl],
    },
    {
      id: "matrix-health-counters-carried",
      status: "passed",
      cellCount,
      reconnectLaneCount,
      staleConflictLaneCount,
    },
    {
      id: hostedOpsReadinessBoundaryCheckId,
      status: "passed",
      releaseReady: false,
      productionReady: false,
    },
    {
      id: hostedOpsTelemetryBoundaryCheckId,
      status: hostedOpsTelemetryBoundaryStatus(realHostedDeploymentStatus),
      requiredEvidence:
        "Hosted logs, metrics, traces, paging/SLOs, and incident response evidence from an externally reachable deployment.",
    },
  ];
}

export function hostedOpsSignalCheckStatusRows({
  realHostedDeploymentStatus = "unproven",
} = {}) {
  return hostedOpsSignalCheckIds.map((id) => ({
    id,
    status:
      id === hostedOpsTelemetryBoundaryCheckId
        ? hostedOpsTelemetryBoundaryStatus(realHostedDeploymentStatus)
        : "passed",
  }));
}
