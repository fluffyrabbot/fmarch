import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";

export const DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION = 1;
export const devTestGameReleaseReadinessPath =
  "target/dev-test-game/release-readiness-checklist.json";
export const devTestGameHostedConcurrentRaceMatrixPath =
  "target/dev-test-game/hosted-concurrent-race-matrix.json";
export const devTestGameHostedConcurrentRaceMatrixCommand =
  "test:dev-test-game-hosted-concurrent-race-matrix";

const hostedMatrixJsonPath = path.join(
  repoRoot,
  devTestGameHostedConcurrentRaceMatrixPath,
);

export function buildDevTestGameHostedConcurrentRaceMatrixRequest(
  releaseReadiness,
  {
    generatedAt = new Date().toISOString(),
    releaseReadinessSource = devTestGameReleaseReadinessPath,
  } = {},
) {
  const readiness = assertDevTestGameReleaseReadiness(releaseReadiness);
  const promoted = readiness.generatedFrom?.raceCoveragePromotedMilestones;
  if (
    promoted?.status !== "passed" ||
    promoted.cellCount !== promoted.reloadCoveredCellCount ||
    promoted.groupCount !== promoted.passedGroupCount
  ) {
    throw new Error("hosted concurrent race matrix request requires promoted local race milestones");
  }
  const unproven = readiness.releaseReadiness.unproven.find(
    (item) => item.id === "hosted-concurrent-race-matrix",
  );
  if (unproven === undefined) {
    throw new Error("release readiness is missing hosted-concurrent-race-matrix");
  }
  const evidence = {
    version: DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION,
    proof: "dev-test-game-hosted-concurrent-race-matrix-request",
    status: "unproven",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "hosted-concurrent-race-matrix-request",
    proofBoundary:
      "Machine-readable request for the first hosted-like concurrent race matrix proof. It is derived from promoted local dev-test-game race evidence, but it does not prove hosted deployment, multi-node command races, stale clients across reconnects, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: releaseReadinessSource,
      releaseReadinessGeneratedAt: readiness.generatedAt,
      raceCoverage: String(readiness.generatedFrom?.raceCoverage ?? ""),
      raceCoveragePromotedMilestones: {
        status: promoted.status,
        cellCount: promoted.cellCount,
        provenCellCount: promoted.provenCellCount,
        reloadCoveredCellCount: promoted.reloadCoveredCellCount,
        groupCount: promoted.groupCount,
        passedGroupCount: promoted.passedGroupCount,
        requiredCellCount: promoted.requiredCellCount,
        coveredCellCount: promoted.coveredCellCount,
        gapCount: promoted.gapCount,
        groupIds: promoted.groups.map((group) => group.id),
      },
    },
    requestedEvidence: {
      id: unproven.id,
      status: unproven.status,
      requiredEvidence: unproven.requiredEvidence,
      firstProofTarget: devTestGameHostedConcurrentRaceMatrixPath,
      localBaseline: {
        cellCount: promoted.cellCount,
        reloadCoveredCellCount: promoted.reloadCoveredCellCount,
        groupCount: promoted.groupCount,
        passedGroupCount: promoted.passedGroupCount,
      },
      requiredHostedProof: [
        "hosted or hosted-like API and frontend deployment target",
        "multi-session concurrent command race matrix against that target",
        "reload and reconnect recovery after each accepted or rejected race outcome",
        "stale-client conflict messages across host, player, replacement, and cohost surfaces",
        "artifacted command/event sequence evidence with raw role credentials redacted",
      ],
    },
    nextBuildSlice: {
      command: devTestGameHostedConcurrentRaceMatrixCommand,
      buildSlice:
        "Create the first hosted-like concurrent race matrix proof from the promoted local race baseline without changing role-surface architecture.",
      proofTarget: devTestGameHostedConcurrentRaceMatrixPath,
    },
  };
  assertDevTestGameHostedConcurrentRaceMatrixRequest(evidence);
  return evidence;
}

export function assertDevTestGameHostedConcurrentRaceMatrixRequest(evidence) {
  if (
    evidence?.version !== DEV_TEST_GAME_HOSTED_CONCURRENT_RACE_MATRIX_VERSION ||
    evidence.proof !== "dev-test-game-hosted-concurrent-race-matrix-request" ||
    evidence.status !== "unproven" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "hosted-concurrent-race-matrix-request"
  ) {
    throw new Error("hosted concurrent race matrix request shape drifted");
  }
  const promoted = evidence.generatedFrom?.raceCoveragePromotedMilestones;
  if (
    promoted?.status !== "passed" ||
    !Number.isInteger(promoted.cellCount) ||
    promoted.cellCount !== promoted.reloadCoveredCellCount ||
    promoted.groupCount !== promoted.passedGroupCount ||
    !Array.isArray(promoted.groupIds) ||
    promoted.groupIds.length !== promoted.groupCount
  ) {
    throw new Error("hosted concurrent race matrix request promoted baseline drifted");
  }
  if (
    evidence.requestedEvidence?.id !== "hosted-concurrent-race-matrix" ||
    evidence.requestedEvidence.status !== "unproven" ||
    !Array.isArray(evidence.requestedEvidence.requiredHostedProof) ||
    evidence.requestedEvidence.requiredHostedProof.length < 5
  ) {
    throw new Error("hosted concurrent race matrix request evidence drifted");
  }
  if (
    evidence.nextBuildSlice?.command !==
      devTestGameHostedConcurrentRaceMatrixCommand ||
    evidence.nextBuildSlice?.proofTarget !== devTestGameHostedConcurrentRaceMatrixPath
  ) {
    throw new Error("hosted concurrent race matrix request next slice drifted");
  }
  return evidence;
}

async function main() {
  const readinessPath = path.join(repoRoot, devTestGameReleaseReadinessPath);
  const readiness = JSON.parse(await readFile(readinessPath, "utf8"));
  const evidence = buildDevTestGameHostedConcurrentRaceMatrixRequest(readiness);
  await mkdir(path.dirname(hostedMatrixJsonPath), { recursive: true });
  await writeFile(hostedMatrixJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `wrote ${path.relative(repoRoot, hostedMatrixJsonPath)} (${evidence.status})`,
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await main();
}
