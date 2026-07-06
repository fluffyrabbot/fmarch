import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertDevTestGameRealHostedObservabilityHandoff,
  buildDevTestGameRealHostedObservabilityHandoff,
} from "./dev_test_game_real_hosted_observability_handoff.mjs";
import {
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityEvidenceContractSummary,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffCheckIds,
  realHostedObservabilityHandoffInputIds,
  realHostedObservabilityHandoffInputSectionDefinitions,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";

test("real hosted observability handoff records blocked receipt from local baseline only", async () => {
  const baselinePath =
    "target/dev-test-game/test-real-hosted-observability-baseline.json";
  await writeJson(baselinePath, hostedOpsSignalsFixture());

  const handoff = await buildDevTestGameRealHostedObservabilityHandoff({
    env: {
      [realHostedObservabilityBaselineEnv]: baselinePath,
    },
    generatedAt: "2026-07-03T00:00:00.000Z",
  });

  assertDevTestGameRealHostedObservabilityHandoff(handoff);
  assert.equal(handoff.status, "blocked");
  assert.equal(handoff.generatedFrom.hostedOpsSignals, baselinePath);
  assert.equal(handoff.target.localHostedLikeSignalsOnlyBaseline, true);
  assert.deepEqual(
    handoff.checks.map((check) => check.id),
    realHostedObservabilityHandoffCheckIds,
  );
  assert.equal(
    handoff.checks.find((check) => check.id === "local-hosted-ops-signals-baseline-carried")
      .status,
    "passed",
  );
  assert.deepEqual(
    handoff.hostedHandoffChecklist.inputIds,
    realHostedObservabilityHandoffInputIds,
  );
  assert.deepEqual(
    handoff.hostedHandoffChecklist.inputSections.map((section) => [
      section.id,
      section.status,
      section.requiredInputIds,
      section.providedInputIds,
      section.missingInputs,
    ]),
    realHostedObservabilityHandoffInputSectionDefinitions.map((section) => [
      section.id,
      "missing",
      [...section.requiredInputIds],
      section.id === "baseline-boundary"
        ? [realHostedObservabilityBaselineEnv]
        : [],
      section.requiredInputIds.filter(
        (inputId) => inputId !== realHostedObservabilityBaselineEnv,
      ),
    ]),
  );
  assert(
    handoff.hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary.includes(
      "baseline evidence only",
    ),
  );
  assert.equal(
    handoff.hostedHandoffChecklist.blockedReceipt.rawEvidenceContractSummary,
    realHostedObservabilityEvidenceContractSummary(),
  );
  assert.equal(
    handoff.hostedHandoffChecklist.blockedReceipt.firstMissingOperatorArtifact
      .inputId,
    realHostedObservabilityEvidenceEnv,
  );
  assert.equal(
    handoff.hostedHandoffChecklist.blockedReceipt.blockedOperatorPacket
      .selectedProductionFeatureRoleUrl,
    "/admin/audit/local-hosted-ops-signals?game=<seeded-game>",
  );
  assert(
    handoff.hostedHandoffChecklist.blockedCheckIds.includes(
      "externally-reachable-logs-evidence",
    ),
  );
});

test("real hosted observability handoff can pass with externally hosted evidence JSON", async () => {
  const baselinePath =
    "target/dev-test-game/test-real-hosted-observability-pass-baseline.json";
  const evidencePath =
    "target/dev-test-game/test-real-hosted-observability-evidence.json";
  await writeJson(baselinePath, hostedOpsSignalsFixture());
  await writeJson(evidencePath, {
    version: 1,
    proof: "real-hosted-observability-evidence",
    releaseReady: false,
    productionReady: false,
    hostedObservability: {
      externallyReachableLogs: true,
      externallyReachableMetrics: true,
      externallyReachableTraces: true,
      pagingSlo: true,
      incidentResponse: true,
      localHostedLikeSignalsOnlyBaseline: true,
    },
  });

  const handoff = await buildDevTestGameRealHostedObservabilityHandoff({
    env: {
      [realHostedObservabilityBaselineEnv]: baselinePath,
      [realHostedObservabilityEvidenceEnv]: evidencePath,
    },
    generatedAt: "2026-07-03T00:00:00.000Z",
  });

  assertDevTestGameRealHostedObservabilityHandoff(handoff);
  assert.equal(handoff.status, "passed");
  assert.deepEqual(handoff.hostedHandoffChecklist.blockedCheckIds, []);
  assert.deepEqual(
    handoff.hostedHandoffChecklist.inputSections.map((section) => [
      section.id,
      section.status,
      section.missingInputs,
    ]),
    realHostedObservabilityHandoffInputSectionDefinitions.map((section) => [
      section.id,
      "provided",
      [],
    ]),
  );
  assert.equal(handoff.hostedHandoffChecklist.blockedReceipt, undefined);
});

async function writeJson(filePath, value) {
  await mkdir("target/dev-test-game", { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function hostedOpsSignalsFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-ops-signals",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-07-03T00:00:00.000Z",
    scope: "local-hosted-like-ops-signals",
    proofBoundary:
      "Local hosted-like ops signal bundle; real hosted telemetry remains unproven.",
    generatedFrom: {
      opsArtifacts: "target/dev-test-game/ops-artifacts.json",
      hostedConcurrentRaceMatrix:
        "target/dev-test-game/hosted-concurrent-race-matrix.json",
      readinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
      game: "midsummer",
    },
    target: {
      kind: "local-hosted-like",
      game: "midsummer",
      apiBaseUrl: "http://127.0.0.1:55987",
      frontendBaseUrl: "http://127.0.0.1:5173",
      roleSurfaceCount: 4,
      realHostedDeploymentStatus: "unproven",
    },
    matrix: {
      cellCount: 2,
      passedCellCount: 2,
      reloadCoveredCellCount: 2,
      reconnectLaneCount: 1,
      staleConflictLaneCount: 1,
      hostedEvidenceStatus: "unproven",
    },
    readiness: {
      status: "passed",
      releaseReady: false,
      productionReady: false,
      unproven: [
        {
          id: "real-hosted-observability-and-operations",
          status: "unproven",
        },
      ],
    },
    timestamps: {
      opsGeneratedAt: "2026-07-03T00:00:00.000Z",
      matrixGeneratedAt: "2026-07-03T00:00:00.000Z",
      readinessGeneratedAt: "2026-07-03T00:00:00.000Z",
      proofGeneratedAt: "2026-07-03T00:00:00.000Z",
    },
    artifacts: {},
    checks: [
      { id: "hosted-matrix-artifact-checksummed", status: "passed" },
      {
        id: "local-target-signals-carried",
        status: "passed",
        evidence: ["http://127.0.0.1:5173", "http://127.0.0.1:55987"],
      },
      {
        id: "matrix-health-counters-carried",
        status: "passed",
        cellCount: 2,
        reconnectLaneCount: 1,
        staleConflictLaneCount: 1,
      },
      {
        id: "readiness-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
      {
        id: "hosted-telemetry-boundary-carried",
        status: "unproven",
        requiredEvidence:
          "Hosted logs, metrics, traces, paging/SLOs, and incident response evidence from an externally reachable deployment.",
      },
    ],
  };
}
