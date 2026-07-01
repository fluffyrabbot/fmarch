import path from "node:path";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  releaseAdminProofFallbackUnprovenIds,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const readinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    "target/dev-test-game/release-readiness-checklist.json",
);
const readinessRelativePath = path.relative(repoRoot, readinessPath);
const evidencePath = path.join(artifactDir, "release-admin-proof.json");
const requiredReleaseChecks = [
  "local-role-url-browser-proof",
  "local-core-loop-proof",
  "local-hardening-proof",
];
const requiredLocalPrerequisites = [
  "local-proof-graph-admin-role-handoffs",
  "local-proof-freshness-admin-surface",
  "local-next-action-admin-surface",
  "local-hosted-evidence-lane-demo-proof",
];
const requiredUnprovenItems = releaseAdminProofFallbackUnprovenIds;

await runAdminAuditProof({
  smokeName: "dev-test-game-release-admin-proof",
  stage: "release-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_RELEASE_READINESS: readinessRelativePath,
  },
  loadSource: async () =>
    assertDevTestGameReleaseReadiness(await readJson(readinessPath)),
  prove: async ({ browser, frontendBaseUrl, source: readiness }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: readiness.generatedFrom.game,
      auditId: "local-release-readiness",
      requiredChecks: readiness.localDevelopmentSpine.checks.map((check) => check.id),
      requiredLocalPrerequisites: readiness.localDevelopmentSpine.checks
        .filter((check) => check.dependencyGated === true)
        .map((check) => check.id),
      requiredUnproven: readiness.releaseReadiness.unproven.map((item) => item.id),
    }),
  buildEvidence: ({ source: readiness, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-release-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-release-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game release-readiness checklist. Proves the local checklist is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with local checks and remaining unproven release items visible; it does not prove hosted deployment, hosted identity, hosted operations, production backup/PITR, exhaustive race coverage, human release approval, beta readiness, or production readiness.",
    generatedFrom: {
      releaseReadinessChecklist: readinessRelativePath,
      game: readiness.generatedFrom.game,
      localCheckIds: readiness.localDevelopmentSpine.checks.map((check) => check.id),
      localPrerequisiteIds: readiness.localDevelopmentSpine.checks
        .filter((check) => check.dependencyGated === true)
        .map((check) => check.id),
      unprovenIds: readiness.releaseReadiness.unproven.map((item) => item.id),
    },
    adminRoleSurface,
  }),
  assertEvidence: assertReleaseAdminProof,
});

export function assertReleaseAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-release-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-release-admin-surface"
  ) {
    throw new Error("release admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("release admin proof did not prove admin overview click-through");
  }
  for (const checkId of evidence.generatedFrom?.localCheckIds ?? requiredReleaseChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release admin proof missing visible check: ${checkId}`);
    }
  }
  for (const prerequisiteId of
    evidence.generatedFrom?.localPrerequisiteIds ?? requiredLocalPrerequisites) {
    if (!evidence.adminRoleSurface?.visibleLocalPrerequisites?.includes(prerequisiteId)) {
      throw new Error(
        `release admin proof missing visible local prerequisite: ${prerequisiteId}`,
      );
    }
    if (
      typeof evidence.adminRoleSurface?.visibleLocalPrerequisiteRoleUrls?.[
        prerequisiteId
      ] !== "string"
    ) {
      throw new Error(
        `release admin proof missing local prerequisite role URL: ${prerequisiteId}`,
      );
    }
    const visitedDestination =
      evidence.adminRoleSurface?.visitedLocalPrerequisiteDestinations?.find(
        (destination) =>
          destination?.id === prerequisiteId &&
          destination.clickedThrough === true &&
          typeof destination.auditId === "string" &&
          typeof destination.detailRoleUrl === "string",
      );
    if (visitedDestination === undefined) {
      throw new Error(
        `release admin proof did not navigate local prerequisite: ${prerequisiteId}`,
      );
    }
  }
  for (const itemId of evidence.generatedFrom?.unprovenIds ?? requiredUnprovenItems) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release admin proof missing visible unproven item: ${itemId}`);
    }
  }
  return evidence;
}
