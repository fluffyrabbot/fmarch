import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostedOpsReadinessBoundaryCheckId,
  hostedOpsSignalCheckCases,
  hostedOpsSignalCheckIds,
  hostedOpsSignalCheckStatusRows,
  hostedOpsSignalRelatedAuditIds,
  hostedOpsTelemetryBoundaryCheckId,
  hostedOpsTelemetryBoundaryStatus,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";

test("hosted ops signal cases share checks, related links, and telemetry status", () => {
  assert.deepEqual(hostedOpsSignalCheckIds, [
    "hosted-matrix-artifact-checksummed",
    "local-target-signals-carried",
    "matrix-health-counters-carried",
    hostedOpsReadinessBoundaryCheckId,
    hostedOpsTelemetryBoundaryCheckId,
  ]);
  assert.deepEqual(hostedOpsSignalRelatedAuditIds, [
    "local-hosted-concurrent-race-matrix",
    "local-ops-artifacts",
  ]);
  assert.equal(hostedOpsTelemetryBoundaryStatus("passed"), "passed");
  assert.equal(hostedOpsTelemetryBoundaryStatus("unproven"), "unproven");

  const checks = hostedOpsSignalCheckCases({
    hostedConcurrentRaceMatrixPath:
      "target/dev-test-game/hosted-concurrent-race-matrix.json",
    frontendBaseUrl: "http://127.0.0.1:5173",
    apiBaseUrl: "http://127.0.0.1:55987",
    cellCount: 16,
    reconnectLaneCount: 10,
    staleConflictLaneCount: 4,
    realHostedDeploymentStatus: "unproven",
  });
  assert.deepEqual(
    checks.map((check) => [check.id, check.status]),
    hostedOpsSignalCheckStatusRows().map((check) => [check.id, check.status]),
  );
  assert.deepEqual(checks.map((check) => check.id), hostedOpsSignalCheckIds);
  assert.equal(
    checks.find((check) => check.id === "local-target-signals-carried").evidence[0],
    "http://127.0.0.1:5173",
  );
  assert.equal(
    checks.find((check) => check.id === "matrix-health-counters-carried")
      .cellCount,
    16,
  );
});
