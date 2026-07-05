import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import {
  devTestGameSpineManifestAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

const spineManifestPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_SPINE_MANIFEST ??
    "target/dev-test-game/spine-manifest.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const spineManifestRelativePath = path.relative(repoRoot, spineManifestPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(repoRoot, devTestGameSpineManifestAdminProofPath);
const requiredChecks = [
  "core-live-order-recorded",
  "live-spine-order-recorded",
  "sub-spine-orders-recorded",
  "evidence-env-wiring-recorded",
  "freshness-proof-recorded",
  "artifact-refresh-status-recorded",
  "release-boundary-carried",
  localAdminAuditHandoffCheckIds.proofFreshness,
  localAdminAuditHandoffCheckIds.nextAction,
];
const requiredRelatedLinks = [
  localAdminAuditIds.proofFreshness,
  localAdminAuditIds.nextAction,
];

export function spineManifestAdminProofCase() {
  return {
    smokeName: "dev-test-game-spine-manifest-admin-proof",
    stage: "spine-manifest-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_SPINE_MANIFEST: spineManifestRelativePath,
    },
    loadSource: async () => ({
      manifest: assertDevTestGameSpineManifest(await readJson(spineManifestPath)),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: localAdminAuditIds.spineManifest,
        requiredChecks,
        requiredRelatedLinks,
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-spine-manifest-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-spine-manifest-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game spine manifest. Proves the current proof order, evidence env wiring, and artifact refresh status manifest is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        spineManifest: spineManifestRelativePath,
        proofRun: proofRunRelativePath,
        game: source.proofRun.session.game,
        relatedAuditIds: requiredRelatedLinks,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertSpineManifestAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(spineManifestAdminProofCase());
}

export function assertSpineManifestAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-spine-manifest-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-spine-manifest-admin-surface"
  ) {
    throw new Error("spine manifest admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("spine manifest admin proof did not prove admin overview click-through");
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: requiredChecks,
    proofName: "spine manifest admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "spine manifest admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  return evidence;
}
