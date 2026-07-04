import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { validateDevTestGameAdminSpineProof } from "./dev_test_game_release_readiness.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

const adminSpineProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    "target/dev-test-game/admin-spine-proof.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const adminSpineProofRelativePath = path.relative(repoRoot, adminSpineProofPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "admin-spine-admin-proof.json");
const requiredChecks = [
  "core-loop",
  "hardening",
  "identity",
  "backup",
  "ops",
  "seed",
  "release",
  "release-runbook",
  "race-coverage",
  "hosted-target-preflight",
  "hosted-concurrent-race-matrix",
  "hosted-ops-signals",
  "spine-manifest",
  "recovery",
  localAdminAuditHandoffCheckIds.spineManifest,
];
const requiredRelatedLinks = [localAdminAuditIds.spineManifest];
const requiredAdminSpineBatches = [
  "aggregate-pre-release-admin-proof-batch",
  "aggregate-release-and-hosted-admin-proof-batch",
];
const requiredAdminSpineBatchStatuses = Object.fromEntries(
  requiredAdminSpineBatches.map((id) => [id, "passed"]),
);

await runAdminAuditProof({
  smokeName: "dev-test-game-admin-spine-admin-proof",
  stage: "admin-spine-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofRelativePath,
  },
  loadSource: async () => ({
    adminSpineProof: await readAdminSpineProof(),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: localAdminAuditIds.adminSpine,
      requiredChecks,
      requiredRelatedLinks,
      requiredAdminSpineBatches,
      requiredAdminSpineBatchStatuses,
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-admin-spine-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the aggregate dev-test-game admin-spine proof. Proves the ordered aggregate admin proof artifact and recovery command summary are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      adminSpineProof: adminSpineProofRelativePath,
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      proofIds: source.adminSpineProof.proofIds,
      batchIds: requiredAdminSpineBatches,
      batchLabels: source.adminSpineProof.batches.map((batch) => batch.label),
      batchCaseCounts: source.adminSpineProof.batches.map((batch) => ({
        label: batch.label,
        caseCount: batch.caseCount,
      })),
      relatedAuditIds: requiredRelatedLinks,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertAdminSpineAdminProof,
});

async function readAdminSpineProof() {
  return validateDevTestGameAdminSpineProof(await readJson(adminSpineProofPath), {
    path: adminSpineProofRelativePath,
  });
}

export function assertAdminSpineAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-admin-spine-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-admin-spine-admin-surface"
  ) {
    throw new Error("admin spine admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("admin spine admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`admin spine admin proof missing visible check: ${checkId}`);
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`admin spine admin proof missing related link: ${linkId}`);
    }
  }
  for (const batchId of evidence.generatedFrom?.batchIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleAdminSpineBatches?.includes(batchId)) {
      throw new Error(`admin spine admin proof missing batch row: ${batchId}`);
    }
    const visibleText =
      evidence.adminRoleSurface?.visibleAdminSpineBatchStatuses?.[batchId] ?? "";
    if (!visibleText.includes("passed") || !visibleText.includes("shared frontend")) {
      throw new Error(`admin spine admin proof missing batch status: ${batchId}`);
    }
  }
  return evidence;
}
