import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameSpineManifest } from "./dev_test_game_spine_manifest.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

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
const evidencePath = path.join(artifactDir, "spine-manifest-admin-proof.json");
const requiredChecks = [
  "live-spine-order-recorded",
  "sub-spine-orders-recorded",
  "evidence-env-wiring-recorded",
  "release-boundary-carried",
];

await runAdminAuditProof({
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
      auditId: "local-spine-manifest",
      requiredChecks,
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-spine-manifest-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-spine-manifest-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the generated dev-test-game spine manifest. Proves the current proof order and evidence env wiring manifest is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      spineManifest: spineManifestRelativePath,
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertSpineManifestAdminProof,
});

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
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`spine manifest admin proof missing visible check: ${checkId}`);
    }
  }
  return evidence;
}
