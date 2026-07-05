import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertDevTestGameHostedConcurrentRaceMatrixEvidence } from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import {
  assertDevTestGameOpsArtifacts,
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_ops_artifacts.mjs";
import {
  assertDevTestGameReleaseReadiness,
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_release_readiness.mjs";
import {
  hostedOpsReadinessBoundaryCheckId,
  hostedOpsSignalCheckCases,
  hostedOpsSignalCheckIds,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";

export const DEV_TEST_GAME_HOSTED_OPS_SIGNALS_VERSION = 1;
export const devTestGameHostedOpsSignalsPath =
  "target/dev-test-game/hosted-ops-signals.json";
export const devTestGameHostedOpsSignalsCommand =
  "test:dev-test-game-hosted-ops-signals";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const defaultPaths = Object.freeze({
  opsArtifacts: path.join(repoRoot, devTestGameOpsArtifactsPath),
  hostedConcurrentRaceMatrix: path.join(
    artifactDir,
    "hosted-concurrent-race-matrix.json",
  ),
  readiness: path.join(repoRoot, devTestGameReleaseReadinessPath),
});
const jsonPath = path.join(repoRoot, devTestGameHostedOpsSignalsPath);

export function buildDevTestGameHostedOpsSignals({
  opsArtifacts,
  hostedConcurrentRaceMatrix,
  readiness,
  artifacts,
  generatedAt = new Date().toISOString(),
}) {
  const ops = assertDevTestGameOpsArtifacts(opsArtifacts);
  const matrix = assertDevTestGameHostedConcurrentRaceMatrixEvidence(
    hostedConcurrentRaceMatrix,
  );
  const checklist = assertDevTestGameReleaseReadiness(readiness);
  if (ops.run?.game !== matrix.hostedLikeTarget?.game) {
    throw new Error(`hosted ops signals ops/matrix game mismatch: ${ops.run?.game}`);
  }
  if (checklist.generatedFrom?.game !== ops.run?.game) {
    throw new Error(
      `hosted ops signals readiness/game mismatch: ${checklist.generatedFrom?.game}`,
    );
  }
  const signals = {
    version: DEV_TEST_GAME_HOSTED_OPS_SIGNALS_VERSION,
    proof: "dev-test-game-hosted-ops-signals",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-hosted-like-ops-signals",
    proofBoundary:
      "Local hosted-like ops signal bundle for the saved dev-test-game matrix run. It checksums the matrix, ops, and readiness artifacts and carries localhost API/frontend target, proof timestamps, and matrix health counters; it does not prove hosted telemetry, centralized logs, paging, SLOs, production incident response, or release readiness.",
    generatedFrom: {
      opsArtifacts: artifacts.opsArtifacts.path,
      hostedConcurrentRaceMatrix: artifacts.hostedConcurrentRaceMatrix.path,
      readinessChecklist: artifacts.readiness.path,
      game: ops.run.game,
    },
    target: {
      kind: "local-hosted-like",
      game: ops.run.game,
      apiBaseUrl: matrix.hostedLikeTarget.apiBaseUrl,
      frontendBaseUrl: matrix.hostedLikeTarget.frontendBaseUrl,
      roleSurfaceCount: matrix.summary.roleSurfaceCount,
      realHostedDeploymentStatus: matrix.summary.realHostedDeploymentStatus,
    },
    matrix: {
      cellCount: matrix.summary.cellCount,
      passedCellCount: matrix.summary.passedCellCount,
      reloadCoveredCellCount: matrix.summary.reloadCoveredCellCount,
      reconnectLaneCount: matrix.summary.reconnectLaneCount,
      staleConflictLaneCount: matrix.summary.staleConflictLaneCount,
      hostedEvidenceStatus: matrix.summary.hostedEvidenceStatus,
    },
    readiness: {
      status: checklist.status,
      releaseReady: checklist.releaseReady,
      productionReady: checklist.productionReady,
      unproven: checklist.releaseReadiness.unproven.map((item) => ({
        id: item.id,
        status: item.status,
      })),
    },
    timestamps: {
      opsGeneratedAt: ops.generatedAt,
      matrixGeneratedAt: matrix.generatedAt,
      readinessGeneratedAt: checklist.generatedAt,
      proofGeneratedAt: ops.generatedFrom?.proofGeneratedAt ?? null,
    },
    artifacts: {
      opsArtifacts: artifacts.opsArtifacts,
      hostedConcurrentRaceMatrix: artifacts.hostedConcurrentRaceMatrix,
      readiness: artifacts.readiness,
    },
    checks: hostedOpsSignalCheckCases({
      hostedConcurrentRaceMatrixPath: artifacts.hostedConcurrentRaceMatrix.path,
      frontendBaseUrl: matrix.hostedLikeTarget.frontendBaseUrl,
      apiBaseUrl: matrix.hostedLikeTarget.apiBaseUrl,
      cellCount: matrix.summary.cellCount,
      reconnectLaneCount: matrix.summary.reconnectLaneCount,
      staleConflictLaneCount: matrix.summary.staleConflictLaneCount,
      realHostedDeploymentStatus: matrix.summary.realHostedDeploymentStatus,
    }),
  };
  assertDevTestGameHostedOpsSignals(signals);
  return signals;
}

export function assertDevTestGameHostedOpsSignals(signals) {
  if (
    signals?.version !== DEV_TEST_GAME_HOSTED_OPS_SIGNALS_VERSION ||
    signals.proof !== "dev-test-game-hosted-ops-signals" ||
    signals.status !== "passed" ||
    signals.scope !== "local-hosted-like-ops-signals" ||
    signals.releaseReady !== false ||
    signals.productionReady !== false
  ) {
    throw new Error("hosted ops signals shape drifted");
  }
  if (
    typeof signals.target?.apiBaseUrl !== "string" ||
    typeof signals.target?.frontendBaseUrl !== "string" ||
    Number(signals.target?.roleSurfaceCount ?? 0) <= 0
  ) {
    throw new Error("hosted ops signals target drifted");
  }
  if (
    Number(signals.matrix?.cellCount ?? 0) <= 0 ||
    signals.matrix.passedCellCount !== signals.matrix.cellCount ||
    signals.matrix.reloadCoveredCellCount !== signals.matrix.cellCount ||
    Number(signals.matrix.reconnectLaneCount ?? 0) <= 0 ||
    Number(signals.matrix.staleConflictLaneCount ?? 0) <= 0
  ) {
    throw new Error("hosted ops signals matrix counters drifted");
  }
  const checks = new Map(
    (signals.checks ?? []).map((check) => [check.id, check.status]),
  );
  for (const id of hostedOpsSignalCheckIds) {
    if (!["passed", "unproven"].includes(String(checks.get(id)))) {
      throw new Error(`hosted ops signals missing check: ${id}`);
    }
  }
  if (checks.get(hostedOpsReadinessBoundaryCheckId) !== "passed") {
    throw new Error("hosted ops signals readiness boundary did not pass");
  }
  const serialized = JSON.stringify(signals);
  if (/invite=(?!REDACTED)/.test(serialized)) {
    throw new Error("hosted ops signals leaked an invite URL token");
  }
  return signals;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const paths = {
    opsArtifacts: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS,
      defaultPaths.opsArtifacts,
    ),
    hostedConcurrentRaceMatrix: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX,
      defaultPaths.hostedConcurrentRaceMatrix,
    ),
    readiness: resolvePath(
      process.env.FMARCH_DEV_TEST_GAME_READINESS,
      defaultPaths.readiness,
    ),
  };
  const [opsArtifacts, hostedConcurrentRaceMatrix, readiness, artifacts] =
    await Promise.all([
      readJson(paths.opsArtifacts),
      readJson(paths.hostedConcurrentRaceMatrix),
      readJson(paths.readiness),
      artifactSummaries(paths),
    ]);
  const signals = buildDevTestGameHostedOpsSignals({
    opsArtifacts,
    hostedConcurrentRaceMatrix,
    readiness,
    artifacts,
  });
  await mkdir(path.dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(signals, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, jsonPath)} (${signals.status})`);
}

function resolvePath(value, fallback) {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return path.resolve(process.cwd(), value);
}

async function artifactSummaries(paths) {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([id, filePath]) => [
        id,
        await artifactSummary(filePath),
      ]),
    ),
  );
}

async function artifactSummary(filePath) {
  const [metadata, contents] = await Promise.all([stat(filePath), readFile(filePath)]);
  return {
    path: path.relative(repoRoot, filePath),
    sha256: createHash("sha256").update(contents).digest("hex"),
    sizeBytes: metadata.size,
    mtime: metadata.mtime.toISOString(),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
