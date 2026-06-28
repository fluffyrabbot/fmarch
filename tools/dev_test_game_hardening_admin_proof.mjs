import path from "node:path";
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
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "hardening-admin-proof.json");
const requiredChecks = [
  "replacement-redeemed-invite-recovery",
  "replacement-idempotent-retry",
  "idempotent-retry",
  "reconnect-recovery",
  "stale-player-vote",
  "concurrent-vote-race",
  "stale-action-conflict",
  "stale-host-control",
  "stale-cohost-deadline",
];

await runAdminAuditProof({
  smokeName: "dev-test-game-hardening-admin-proof",
  stage: "hardening-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: "local-hardening",
      requiredChecks,
    }),
  buildEvidence: ({ source: proofRun, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-hardening-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hardening-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game multiplayer-hardening proof-run lanes. Proves the saved local hardening evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove exhaustive race coverage, hosted reconnect behavior, multi-node concurrency, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertHardeningAdminProof,
});

export function assertHardeningAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-hardening-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-hardening-admin-surface"
  ) {
    throw new Error("hardening admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hardening admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hardening admin proof missing visible check: ${checkId}`);
    }
  }
  return evidence;
}
