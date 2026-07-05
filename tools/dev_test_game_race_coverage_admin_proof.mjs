import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameRaceCoverage,
  devTestGameRaceCoverageAdminProofPath,
  devTestGameRaceCoveragePath,
} from "./dev_test_game_race_coverage.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const raceCoveragePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RACE_COVERAGE ?? devTestGameRaceCoveragePath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const raceCoverageRelativePath = path.relative(repoRoot, raceCoveragePath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(repoRoot, devTestGameRaceCoverageAdminProofPath);

export function raceCoverageAdminProofCase() {
  return {
    smokeName: "dev-test-game-race-coverage-admin-proof",
    stage: "race-coverage-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_RACE_COVERAGE: raceCoverageRelativePath,
    },
    loadSource: async () => ({
      raceCoverage: assertDevTestGameRaceCoverage(await readJson(raceCoveragePath)),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: "local-race-coverage",
        requiredChecks: source.raceCoverage.cells.map((cell) => cell.id),
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-race-coverage-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-race-coverage-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game race-coverage inventory. Proves the local race matrix is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted concurrency hardening, exhaustive command-space coverage, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        raceCoverage: raceCoverageRelativePath,
        proofRun: proofRunRelativePath,
        game: source.proofRun.session.game,
        cellIds: source.raceCoverage.cells.map((cell) => cell.id),
        cellCount: source.raceCoverage.summary.cellCount,
        reloadCoveredCellCount: source.raceCoverage.summary.reloadCoveredCellCount,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertRaceCoverageAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(raceCoverageAdminProofCase());
}

export function assertRaceCoverageAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-race-coverage-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-race-coverage-admin-surface"
  ) {
    throw new Error("race coverage admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("race coverage admin proof did not prove admin overview click-through");
  }
  for (const cellId of evidence.generatedFrom?.cellIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(cellId)) {
      throw new Error(`race coverage admin proof missing visible cell: ${cellId}`);
    }
  }
  return evidence;
}
