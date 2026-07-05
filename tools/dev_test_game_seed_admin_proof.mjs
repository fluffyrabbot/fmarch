import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameSeedFixtureSummary } from "./dev_test_game_seed_fixture_summary.mjs";
import {
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  devTestGameSeedAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameSeedFixturePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const seedFixturePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY ??
    devTestGameSeedFixturePath,
);
const seedFixtureRelativePath = path.relative(repoRoot, seedFixturePath);
const evidencePath = path.join(repoRoot, devTestGameSeedAdminProofPath);
const requiredScenarios = seedScenarioCoverageGroups.allDemo;
const requiredProofLaneCoverage = [
  "direct-seeded",
  "alias-only",
  "aggregate-only",
  "unclassified",
];

export function seedAdminProofCase() {
  return {
    smokeName: "dev-test-game-seed-admin-proof",
    stage: "seed-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_SEED_FIXTURE_SUMMARY: seedFixtureRelativePath,
    },
    loadSource: async () =>
      assertDevTestGameSeedFixtureSummary(await readJson(seedFixturePath)),
    prove: async ({ browser, frontendBaseUrl, source: seedFixture }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: seedFixture.fixture.game,
        auditId: "local-seed-fixtures",
        requiredScenarios,
        requiredProofLaneCoverage,
      }),
    buildEvidence: ({ source: seedFixture, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-seed-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-seed-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over a saved dev-test-game seed/demo fixture summary. Proves the local seed/demo fixture inventory is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted demo data, sanitized demo-data policy, invite delivery, beta readiness, or release readiness.",
      generatedFrom: {
        seedFixtureSummary: seedFixtureRelativePath,
        game: seedFixture.fixture.game,
        proofLaneCoverage: seedFixture.proofLaneCoverage,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertSeedAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(seedAdminProofCase());
}

export function assertSeedAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-seed-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-seed-admin-surface"
  ) {
    throw new Error("seed admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("seed admin proof did not prove admin overview click-through");
  }
  for (const scenarioId of requiredScenarios) {
    if (!evidence.adminRoleSurface?.visibleScenarios?.includes(scenarioId)) {
      throw new Error(`seed admin proof missing visible scenario: ${scenarioId}`);
    }
  }
  for (const coverageId of requiredProofLaneCoverage) {
    if (!evidence.adminRoleSurface?.visibleProofLaneCoverage?.includes(coverageId)) {
      throw new Error(
        `seed admin proof missing visible proof lane coverage: ${coverageId}`,
      );
    }
  }
  return evidence;
}
