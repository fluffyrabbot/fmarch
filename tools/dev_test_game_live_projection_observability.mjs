import {
  playerLiveLagResyncLaneId,
} from "./dev_test_game_stale_client_reconnect_scenarios.mjs";

export const liveProjectionLagServerTraceContract = Object.freeze({
  event: "live_projection_receiver_lagged",
  scopeFields: Object.freeze(["game_id", "connection_id"]),
  measurementField: "dropped_messages",
});

export function liveProjectionLagObservabilityFromProofRun(proofRun) {
  const lane = proofRun?.lanes?.find(
    (entry) => entry.id === playerLiveLagResyncLaneId,
  );
  return assertLiveProjectionLagObservability({
    laneId: lane?.id,
    status: lane?.status,
    serverTraceContract: liveProjectionLagServerTraceContract,
    clientMetrics: lane?.evidence?.clientMetrics,
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
    metrics?.resyncFramesReceived !== 2 ||
    metrics?.resyncRefreshesStarted !== 2 ||
    metrics?.resyncFramesCoalesced !== 0 ||
    metrics?.resyncTrailingRefreshesStarted !== 0
  ) {
    throw new Error("live projection lag observability evidence drifted");
  }
  return Object.freeze({
    laneId: observability.laneId,
    status: observability.status,
    serverTraceContract: liveProjectionLagServerTraceContract,
    clientMetrics: Object.freeze({ ...metrics }),
  });
}
