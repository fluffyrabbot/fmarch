import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION = 1;
export const devTestGameHostedMatrixRawEvidencePath =
  "target/dev-test-game/hosted-matrix-raw.json";
export const devTestGameHostedMatrixRawEvidenceCommand =
  "test:dev-test-game-hosted-matrix-raw-evidence";
export const defaultHostedMatrixRawGroupId = "replacement-race-reload";

const groupCells = Object.freeze({
  "replacement-race-reload": Object.freeze([
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ]),
});

export function buildDevTestGameHostedMatrixRawEvidence({
  matrix,
  generatedAt = new Date().toISOString(),
  frontendBaseUrl,
  apiBaseUrl,
  groupId = defaultHostedMatrixRawGroupId,
} = {}) {
  const sourceMatrix = assertDevTestGameHostedConcurrentRaceMatrixEvidence(matrix);
  const cellIds = groupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported hosted matrix raw group: ${groupId}`);
  }
  if (
    sourceMatrix.hostedLikeTarget.frontendBaseUrl !== frontendBaseUrl ||
    sourceMatrix.hostedLikeTarget.apiBaseUrl !== apiBaseUrl
  ) {
    throw new Error("hosted matrix raw target must match the source matrix target");
  }
  const cells = cellIds.map((cellId) => {
    const cell = sourceMatrix.cells.find((candidate) => candidate.id === cellId);
    if (cell?.status !== "passed") {
      throw new Error(`hosted matrix raw cell is not passed: ${cellId}`);
    }
    return cell;
  });
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION,
    proof: "fmarch-hosted-concurrent-race-matrix-raw",
    status: "passed",
    generatedAt,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
    commandRaceCount: cells.length,
    reloadRecoveryCount: cells.length,
    reconnectRecovery: sourceMatrix.reconnectLanes.length > 0,
    staleConflictMessages: sourceMatrix.staleConflictLanes.length > 0,
    rawRoleCredentialsRedacted: sourceMatrix.hostedLikeTarget.roleSurfaces.every(
      (surface) =>
        !("token" in surface) &&
        !("inviteToken" in surface) &&
        !("loginUrl" in surface) &&
        !String(surface.directUrl ?? "").includes("invite="),
    ),
    generatedFrom: {
      hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
      hostedConcurrentRaceMatrixGeneratedAt: sourceMatrix.generatedAt,
      groupId,
    },
    observations: cells.map((cell) => ({
      id: `${cell.id}-raw-observation`,
      status: "passed",
      cellId: cell.id,
      raceLaneId: cell.raceLane.id,
      reloadLaneId: cell.reloadLane.id,
      roleSurfaces: [...cell.roleSurfaces],
    })),
    proofBoundary:
      "Raw hosted-matrix evidence derived from the validated source matrix for the configured API/frontend target. Passing means the target matches the source matrix target and the replacement race cells have passed race and reload observations; it does not prove a separate hosted deployment, multi-node storage, beta readiness, release readiness, or production readiness.",
  };
  assertDevTestGameHostedMatrixRawEvidence(evidence, {
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  return evidence;
}

export function assertDevTestGameHostedMatrixRawEvidence(
  evidence,
  { frontendBaseUrl, apiBaseUrl, groupId = defaultHostedMatrixRawGroupId } = {},
) {
  const cellIds = groupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported hosted matrix raw group: ${groupId}`);
  }
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION ||
    evidence.proof !== "fmarch-hosted-concurrent-race-matrix-raw" ||
    evidence.status !== "passed" ||
    evidence.frontendBaseUrl !== frontendBaseUrl ||
    evidence.apiBaseUrl !== apiBaseUrl ||
    evidence.groupId !== groupId ||
    evidence.commandRaceCount !== cellIds.length ||
    evidence.reloadRecoveryCount !== cellIds.length ||
    evidence.reconnectRecovery !== true ||
    evidence.staleConflictMessages !== true ||
    evidence.rawRoleCredentialsRedacted !== true ||
    !Array.isArray(evidence.observations) ||
    evidence.observations.length !== cellIds.length
  ) {
    throw new Error("hosted matrix raw evidence drifted");
  }
  for (const cellId of cellIds) {
    if (!evidence.observations.some((observation) => observation.cellId === cellId)) {
      throw new Error(`hosted matrix raw evidence missing cell: ${cellId}`);
    }
  }
  return evidence;
}

async function main() {
  const frontendBaseUrl = requiredEnv("FMARCH_HOSTED_MATRIX_FRONTEND_URL");
  const apiBaseUrl = requiredEnv("FMARCH_HOSTED_MATRIX_API_URL");
  const outputPath =
    optionalEnv("FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH") ??
    devTestGameHostedMatrixRawEvidencePath;
  const groupId =
    optionalEnv("FMARCH_HOSTED_MATRIX_GROUP_ID") ?? defaultHostedMatrixRawGroupId;
  const matrix = await readJson(
    path.join(repoRoot, devTestGameHostedConcurrentRaceMatrixPath),
  );
  const evidence = buildDevTestGameHostedMatrixRawEvidence({
    matrix,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(repoRoot, absoluteOutputPath)} (${evidence.status})`,
  );
}

function requiredEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await main();
}
