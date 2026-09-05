import {
  playerLiveLagResyncLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

export const liveProjectionLagServerTraceContract = Object.freeze({
  event: "live_projection_receiver_lagged",
  scopeFields: Object.freeze(["game_id", "connection_id"]),
  measurementField: "dropped_messages",
});

export function liveProjectionResyncMetricsAreConsistent(
  metrics,
  { minimumFrames = 2 } = {},
) {
  return metrics !== null &&
    typeof metrics === "object" &&
    !Array.isArray(metrics) &&
    Object.keys(metrics).length === 1 &&
    Object.hasOwn(metrics, "resyncFramesReceived") &&
    Number.isInteger(metrics.resyncFramesReceived) &&
    metrics.resyncFramesReceived >= minimumFrames;
}

export function liveProjectionLagObservabilityFromProofRun(proofRun) {
  const lane = proofRun?.lanes?.find(
    (entry) => entry.id === playerLiveLagResyncLaneId,
  );
  return assertLiveProjectionLagObservability({
    laneId: lane?.id,
    status: lane?.status,
    serverTraceContract: liveProjectionLagServerTraceContract,
    clientMetrics: lane?.evidence?.clientMetrics,
    recoveredReconnectCount: lane?.evidence?.recoveredReconnectCount,
  });
}

export function assertLiveProjectionLagObservability(observability) {
  const metrics = observability?.clientMetrics;
  if (
    observability?.laneId !== playerLiveLagResyncLaneId ||
    observability.status !== "passed" ||
    observability.serverTraceContract?.event !==
      liveProjectionLagServerTraceContract.event ||
    JSON.stringify(observability.serverTraceContract?.scopeFields) !==
      JSON.stringify(liveProjectionLagServerTraceContract.scopeFields) ||
    observability.serverTraceContract?.measurementField !==
      liveProjectionLagServerTraceContract.measurementField ||
    !liveProjectionResyncMetricsAreConsistent(metrics) ||
    !Number.isInteger(observability.recoveredReconnectCount) ||
    observability.recoveredReconnectCount < metrics.resyncFramesReceived
  ) {
    throw new Error("live projection lag observability evidence drifted");
  }
  return Object.freeze({
    laneId: observability.laneId,
    status: observability.status,
    serverTraceContract: liveProjectionLagServerTraceContract,
    clientMetrics: Object.freeze({ ...metrics }),
    recoveredReconnectCount: observability.recoveredReconnectCount,
  });
}
