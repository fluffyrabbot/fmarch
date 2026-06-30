import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameHostedTargetPreflight } from "./dev_test_game_hosted_target_preflight.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const preflightPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT ??
    "target/dev-test-game/hosted-target-preflight.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const preflightRelativePath = path.relative(repoRoot, preflightPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  artifactDir,
  "hosted-target-preflight-admin-proof.json",
);
const requiredChecks = [
  "hosted-frontend-url-configured",
  "hosted-api-url-configured",
  "hosted-targets-external",
  "raw-evidence-path-configured",
  "raw-evidence-readable",
  "release-claim-boundary-carried",
];
const requiredRelatedLinks = [
  "local-hosted-concurrent-race-matrix",
  "local-next-action",
];

await runAdminAuditProof({
  smokeName: "dev-test-game-hosted-target-preflight-admin-proof",
  stage: "hosted-target-preflight-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT: preflightRelativePath,
  },
  loadSource: async () => ({
    preflight: assertDevTestGameHostedTargetPreflight(await readJson(preflightPath)),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-hosted-target-preflight",
      requiredChecks,
      requiredCheckStatuses: Object.fromEntries(
        source.preflight.checks.map((check) => [check.id, check.status]),
      ),
      requiredUnproven: source.preflight.checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.id),
      requiredRelatedLinks,
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-hosted-target-preflight-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-target-preflight-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the hosted target preflight handoff. Proves configured, blocked, and release-boundary checks are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, hosted telemetry, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      hostedTargetPreflight: preflightRelativePath,
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      status: source.preflight.status,
      checkIds: requiredChecks,
      checkStatuses: Object.fromEntries(
        source.preflight.checks.map((check) => [check.id, check.status]),
      ),
      blockedCheckIds: source.preflight.checks
        .filter((check) => check.status === "blocked")
        .map((check) => check.id),
      relatedAuditIds: requiredRelatedLinks,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertHostedTargetPreflightAdminProof,
});

export function assertHostedTargetPreflightAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-hosted-target-preflight-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-hosted-target-preflight-admin-surface"
  ) {
    throw new Error("hosted target preflight admin proof shape drifted");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hosted target preflight admin proof did not prove admin overview click-through");
  }
  for (const checkId of evidence.generatedFrom?.checkIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hosted target preflight admin proof missing visible check: ${checkId}`);
    }
  }
  for (const checkId of evidence.generatedFrom?.blockedCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(`hosted target preflight admin proof missing blocked row: ${checkId}`);
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted target preflight admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}
