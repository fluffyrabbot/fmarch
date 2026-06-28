import path from "node:path";
import { readLocalProofFreshness } from "../frontend/src/lib/server/local-ops-artifacts.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "proof-freshness-admin-proof.json");

await runAdminAuditProof({
  smokeName: "dev-test-game-proof-freshness-admin-proof",
  stage: "proof-freshness-admin-proof-listen",
  evidencePath,
  loadSource: async () => ({
    freshness: assertProofFreshness(await readLocalProofFreshness()),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-proof-freshness",
      requiredChecks: source.freshness.artifacts.map((artifact) => artifact.id),
      requiredCheckStatuses: Object.fromEntries(
        source.freshness.artifacts.map((artifact) => [artifact.id, artifact.status]),
      ),
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-proof-freshness-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-proof-freshness-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game proof freshness dashboard. Proves fresh generated proof artifacts are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not validate artifact contents, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      artifactIds: source.freshness.artifacts.map((artifact) => artifact.id),
      maxAgeHours: source.freshness.maxAgeHours,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertProofFreshnessAdminProof,
});

function assertProofFreshness(freshness) {
  if (
    freshness?.version !== 1 ||
    freshness.proof !== "dev-test-game-proof-freshness" ||
    freshness.scope !== "local-dev-test-game-proof-freshness" ||
    freshness.status !== "passed" ||
    freshness.releaseReady !== false ||
    freshness.productionReady !== false
  ) {
    throw new Error("proof freshness source must be fresh and local-only");
  }
  for (const artifact of freshness.artifacts ?? []) {
    if (artifact.status !== "fresh") {
      throw new Error(`proof freshness artifact ${artifact.id} is ${artifact.status}`);
    }
  }
  return freshness;
}

export function assertProofFreshnessAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-proof-freshness-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-proof-freshness-admin-surface"
  ) {
    throw new Error("proof freshness admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("proof freshness admin proof did not prove admin overview click-through");
  }
  for (const id of evidence.generatedFrom?.artifactIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(id)) {
      throw new Error(`proof freshness admin proof missing visible artifact: ${id}`);
    }
  }
  return evidence;
}
