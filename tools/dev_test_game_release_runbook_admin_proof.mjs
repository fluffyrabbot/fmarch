import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameReleaseRunbook } from "./dev_test_game_release_runbook.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const releaseRunbookPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK ??
    "target/dev-test-game/release-runbook.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? "target/dev-test-game/proof-run.json",
);
const releaseRunbookRelativePath = path.relative(repoRoot, releaseRunbookPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "release-runbook-admin-proof.json");

const requiredChecks = [
  "remaining-readiness-gaps-mapped",
  "rollback-path-carried",
  "support-path-carried",
  "release-claim-boundary-carried",
  "human-approval-boundary-carried",
];
const requiredRelatedLinks = ["local-release-readiness"];

export function releaseRunbookAdminProofCase() {
  return {
    smokeName: "dev-test-game-release-runbook-admin-proof",
    stage: "release-runbook-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_RELEASE_RUNBOOK: releaseRunbookRelativePath,
    },
    loadSource: async () => ({
      releaseRunbook: assertDevTestGameReleaseRunbook(await readJson(releaseRunbookPath)),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: "local-release-runbook",
        requiredChecks,
        requiredUnproven: source.releaseRunbook.runbookItems.map((item) => item.id),
        requiredRelatedLinks,
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-release-runbook-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-release-runbook-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the release-runbook rehearsal artifact. Proves the runbook checks, rehearsed readiness gaps, and release-readiness handoff are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove human approval, hosted deployment, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        releaseRunbook: releaseRunbookRelativePath,
        proofRun: proofRunRelativePath,
        game: source.proofRun.session.game,
        checkIds: requiredChecks,
        runbookItemIds: source.releaseRunbook.runbookItems.map((item) => item.id),
        relatedAuditIds: requiredRelatedLinks,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertReleaseRunbookAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(releaseRunbookAdminProofCase());
}

export function assertReleaseRunbookAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-release-runbook-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-release-runbook-admin-surface"
  ) {
    throw new Error("release runbook admin proof must pass locally without claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("release runbook admin proof did not prove overview click-through");
  }
  for (const checkId of evidence.generatedFrom?.checkIds ?? requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`release runbook admin proof missing visible check: ${checkId}`);
    }
  }
  for (const itemId of evidence.generatedFrom?.runbookItemIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(itemId)) {
      throw new Error(`release runbook admin proof missing runbook item: ${itemId}`);
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? requiredRelatedLinks) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`release runbook admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}
