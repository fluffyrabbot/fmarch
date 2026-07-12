import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  isSha256Hex,
  sha256File,
} from "./dev_test_game_artifact_digest.mjs";
import {
  assertDevTestGameHostedConcurrentRaceMatrixEvidence,
  devTestGameHostedConcurrentRaceMatrixPath,
} from "./dev_test_game_hosted_concurrent_race_matrix.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_HOSTED_MATRIX_EXTERNAL_EVIDENCE_VERSION = 1;
export const devTestGameHostedMatrixExternalEvidencePath =
  "target/dev-test-game/hosted-matrix-external.json";
export const devTestGameHostedMatrixExternalEvidenceCommand =
  "test:dev-test-game-hosted-matrix-external-evidence";
export const defaultHostedMatrixExternalGroupId = "replacement-race-reload";

const promotedGroupCells = Object.freeze({
  "replacement-race-reload": Object.freeze([
    "replacement-private-post",
    "replacement-vote",
    "replacement-action",
  ]),
});

export function buildDevTestGameHostedMatrixExternalEvidence({
  matrix,
  rawEvidence,
  generatedAt = new Date().toISOString(),
  groupId = defaultHostedMatrixExternalGroupId,
  rawEvidenceSource = null,
  frontendBaseUrl,
  apiBaseUrl,
  allowSyntheticDemo = false,
  rawEvidenceSha256 = null,
} = {}) {
  const sourceMatrix = assertDevTestGameHostedConcurrentRaceMatrixEvidence(matrix);
  const source = assertRawHostedMatrixEvidence(rawEvidence, {
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  const rawEvidenceSyntheticExternalTarget =
    source.generatedFrom?.syntheticExternalTarget === true;
  const rawEvidenceFixtureEvidence =
    source.generatedFrom?.fixtureEvidence === true ||
    source.generatedFrom?.operatorFixture === true;
  if (rawEvidenceSyntheticExternalTarget && allowSyntheticDemo !== true) {
    throw new Error(
      "synthetic hosted matrix evidence cannot satisfy the real hosted matrix external evidence handoff",
    );
  }
  if (rawEvidenceFixtureEvidence) {
    throw new Error(
      "fixture hosted matrix evidence cannot satisfy the real hosted matrix external evidence handoff",
    );
  }
  const cellIds = promotedGroupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported hosted matrix external group: ${groupId}`);
  }
  const matrixCells = new Set(sourceMatrix.cells.map((cell) => cell.id));
  for (const cellId of cellIds) {
    if (!matrixCells.has(cellId)) {
      throw new Error(`hosted matrix external group cell missing from matrix: ${cellId}`);
    }
  }
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_MATRIX_EXTERNAL_EVIDENCE_VERSION,
    proof: "fmarch-hosted-concurrent-race-matrix-evidence",
    status: "passed",
    generatedAt,
    frontendBaseUrl,
    apiBaseUrl,
    groupIds: [groupId],
    cellIds: [...cellIds],
    commandRaceCount: source.commandRaceCount,
    reloadRecoveryCount: source.reloadRecoveryCount,
    reconnectRecovery: true,
    staleConflictMessages: true,
    rawRoleCredentialsRedacted: true,
    sourceMode: rawEvidenceSyntheticExternalTarget
      ? "synthetic-demo"
      : "raw-hosted-target",
    generatedFrom: {
      hostedConcurrentRaceMatrix: devTestGameHostedConcurrentRaceMatrixPath,
      hostedConcurrentRaceMatrixGeneratedAt: sourceMatrix.generatedAt,
      rawEvidence: rawEvidenceSource,
      rawEvidenceGeneratedAt: source.generatedAt ?? null,
      ...(rawEvidenceSha256 === null
        ? {}
        : { rawEvidenceSha256 }),
      rawEvidenceSyntheticExternalTarget,
      rawEvidenceFixtureEvidence,
    },
    observations: source.observations.map((observation) => ({
      id: observation.id,
      status: observation.status,
      cellId: observation.cellId,
      raceLaneId: observation.raceLaneId,
      reloadLaneId: observation.reloadLaneId,
    })),
    proofBoundary:
      "Normalized external hosted matrix evidence for one promoted race group. Passing means the supplied raw evidence claims command races, reload recovery, reconnect recovery, stale-client conflict messages, and credential redaction for the configured target; it does not prove beta readiness, release readiness, production operations, or human rollback readiness.",
  };
  assertDevTestGameHostedMatrixExternalEvidence(evidence, {
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
  });
  return evidence;
}

export function assertDevTestGameHostedMatrixExternalEvidence(
  evidence,
  { frontendBaseUrl, apiBaseUrl, groupId = defaultHostedMatrixExternalGroupId } = {},
) {
  const cellIds = promotedGroupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported hosted matrix external group: ${groupId}`);
  }
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_MATRIX_EXTERNAL_EVIDENCE_VERSION ||
    evidence.proof !== "fmarch-hosted-concurrent-race-matrix-evidence" ||
    evidence.status !== "passed" ||
    evidence.frontendBaseUrl !== frontendBaseUrl ||
    evidence.apiBaseUrl !== apiBaseUrl ||
    !Array.isArray(evidence.groupIds) ||
    evidence.groupIds.length !== 1 ||
    evidence.groupIds[0] !== groupId ||
    !Array.isArray(evidence.cellIds) ||
    JSON.stringify(evidence.cellIds) !== JSON.stringify(cellIds) ||
    !Number.isInteger(evidence.commandRaceCount) ||
    evidence.commandRaceCount < cellIds.length ||
    !Number.isInteger(evidence.reloadRecoveryCount) ||
    evidence.reloadRecoveryCount < cellIds.length ||
    evidence.reconnectRecovery !== true ||
    evidence.staleConflictMessages !== true ||
    evidence.rawRoleCredentialsRedacted !== true ||
    !["synthetic-demo", "raw-hosted-target"].includes(evidence.sourceMode) ||
    (evidence.generatedFrom?.rawEvidenceSha256 !== undefined &&
      !isSha256Hex(evidence.generatedFrom.rawEvidenceSha256)) ||
    typeof evidence.generatedFrom?.rawEvidenceSyntheticExternalTarget !== "boolean" ||
    !Array.isArray(evidence.observations) ||
    evidence.observations.length < cellIds.length
  ) {
    throw new Error("hosted matrix external evidence drifted");
  }
  return evidence;
}

function assertRawHostedMatrixEvidence(
  rawEvidence,
  { frontendBaseUrl, apiBaseUrl, groupId },
) {
  const cellIds = promotedGroupCells[groupId];
  if (cellIds === undefined) {
    throw new Error(`unsupported raw hosted matrix group: ${groupId}`);
  }
  if (
    rawEvidence?.proof !== "fmarch-hosted-concurrent-race-matrix-raw" ||
    rawEvidence.status !== "passed" ||
    rawEvidence.frontendBaseUrl !== frontendBaseUrl ||
    rawEvidence.apiBaseUrl !== apiBaseUrl ||
    rawEvidence.groupId !== groupId ||
    !Number.isInteger(rawEvidence.commandRaceCount) ||
    rawEvidence.commandRaceCount < cellIds.length ||
    !Number.isInteger(rawEvidence.reloadRecoveryCount) ||
    rawEvidence.reloadRecoveryCount < cellIds.length ||
    rawEvidence.reconnectRecovery !== true ||
    rawEvidence.staleConflictMessages !== true ||
    rawEvidence.rawRoleCredentialsRedacted !== true ||
    !Array.isArray(rawEvidence.observations)
  ) {
    throw new Error("raw hosted matrix external evidence drifted");
  }
  const observedCells = new Set(rawEvidence.observations.map((item) => item.cellId));
  for (const cellId of cellIds) {
    if (!observedCells.has(cellId)) {
      throw new Error(`raw hosted matrix evidence missing cell: ${cellId}`);
    }
  }
  return rawEvidence;
}

async function main() {
  const frontendBaseUrl = requiredEnv("FMARCH_HOSTED_MATRIX_FRONTEND_URL");
  const apiBaseUrl = requiredEnv("FMARCH_HOSTED_MATRIX_API_URL");
  const rawEvidencePath = requiredEnv("FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH");
  const outputPath =
    optionalEnv("FMARCH_HOSTED_MATRIX_EVIDENCE_PATH") ??
    devTestGameHostedMatrixExternalEvidencePath;
  const groupId =
    optionalEnv("FMARCH_HOSTED_MATRIX_GROUP_ID") ?? defaultHostedMatrixExternalGroupId;
  const [matrix, rawEvidence] = await Promise.all([
    readJson(path.join(repoRoot, devTestGameHostedConcurrentRaceMatrixPath)),
    readJson(path.resolve(repoRoot, rawEvidencePath)),
  ]);
  const rawEvidenceSha256 = await sha256File(
    path.resolve(repoRoot, rawEvidencePath),
  );
  const evidence = buildDevTestGameHostedMatrixExternalEvidence({
    matrix,
    rawEvidence,
    frontendBaseUrl,
    apiBaseUrl,
    groupId,
    rawEvidenceSource: path.relative(repoRoot, path.resolve(repoRoot, rawEvidencePath)),
    rawEvidenceSha256,
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
