import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameOpsArtifacts,
  devTestGameOpsArtifactsPath,
} from "./dev_test_game_ops_artifacts.mjs";
import {
  devTestGameOpsAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const opsArtifactsPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS ??
    devTestGameOpsArtifactsPath,
);
const opsArtifactsRelativePath = path.relative(repoRoot, opsArtifactsPath);
const evidencePath = path.join(repoRoot, devTestGameOpsAdminProofPath);
const requiredChecks = [
  "source-artifacts-checksummed",
  "role-entrypoints-redacted",
  "proof-lanes-summarized",
  "admin-role-surfaces-summarized",
  "proof-stability-summarized",
  "live-projection-lag-observability-summarized",
  "release-boundary-carried",
];

export function opsAdminProofCase() {
  return {
    smokeName: "dev-test-game-ops-admin-proof",
    stage: "ops-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_OPS_ARTIFACTS: opsArtifactsRelativePath,
    },
    loadSource: async () =>
      assertDevTestGameOpsArtifacts(await readJson(opsArtifactsPath)),
    prove: async ({ browser, frontendBaseUrl, source: opsArtifacts }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: opsArtifacts.run.game,
        auditId: "local-ops-artifacts",
        requiredChecks,
      }),
    buildEvidence: ({ source: opsArtifacts, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-ops-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-ops-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over a saved dev-test-game ops artifact. Proves the local ops artifact bundle, including core-loop and hardening admin role-surface evidence plus measured live-projection lag recovery counters, is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted observability, centralized logs, paging, SLOs, incident response, or release readiness.",
      generatedFrom: {
        opsArtifacts: opsArtifactsRelativePath,
        game: opsArtifacts.run.game,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertOpsAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(opsAdminProofCase());
}

export function assertOpsAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-ops-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-ops-admin-surface"
  ) {
    throw new Error("ops admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("ops admin proof did not prove the native admin audit surface");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`ops admin proof missing visible check: ${checkId}`);
    }
  }
  return evidence;
}
