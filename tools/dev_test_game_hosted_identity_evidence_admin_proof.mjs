import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedIdentityEvidence,
  hostedIdentityEvidenceInputIds,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const hostedIdentityEvidencePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE ??
    "target/dev-test-game/hosted-identity-evidence.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const hostedIdentityEvidenceRelativePath = path.relative(
  repoRoot,
  hostedIdentityEvidencePath,
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  artifactDir,
  "hosted-identity-evidence-admin-proof.json",
);
const requiredRelatedLinks = ["local-identity-adapter", "local-next-action"];

await runAdminAuditProof({
  smokeName: "dev-test-game-hosted-identity-evidence-admin-proof",
  stage: "hosted-identity-evidence-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
      hostedIdentityEvidenceRelativePath,
  },
  loadSource: async () => ({
    hostedIdentityEvidence: assertDevTestGameHostedIdentityEvidence(
      await readJson(hostedIdentityEvidencePath),
    ),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-hosted-identity-evidence",
      requiredChecks: source.hostedIdentityEvidence.checks.map((check) => check.id),
      requiredCheckStatuses: Object.fromEntries(
        source.hostedIdentityEvidence.checks.map((check) => [
          check.id,
          check.status,
        ]),
      ),
      requiredUnproven:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      requiredHostedHandoffInputs: hostedIdentityEvidenceInputIds,
      requiredHostedHandoffBlockedChecks:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      requiredHostedHandoffGroups:
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => group.id,
        ),
      requiredRelatedLinks,
    }),
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-hosted-identity-evidence-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-identity-evidence-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the hosted identity evidence handoff. Proves the hosted identity evidence receipt is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked hosted account, invite, recovery, abuse/rate-limit, session-secret, and audit-retention rows visible; it does not prove hosted identity, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      hostedIdentityEvidence: hostedIdentityEvidenceRelativePath,
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      status: source.hostedIdentityEvidence.status,
      rawEvidenceStatus: source.hostedIdentityEvidence.target.rawEvidenceStatus,
      checkIds: source.hostedIdentityEvidence.checks.map((check) => check.id),
      checkStatuses: Object.fromEntries(
        source.hostedIdentityEvidence.checks.map((check) => [
          check.id,
          check.status,
        ]),
      ),
      blockedCheckIds:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      hostedHandoffInputIds: hostedIdentityEvidenceInputIds,
      hostedHandoffBlockedCheckIds:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      hostedHandoffGroupIds:
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => group.id,
        ),
      relatedAuditIds: requiredRelatedLinks,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertHostedIdentityEvidenceAdminProof,
});

export function assertHostedIdentityEvidenceAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !==
      "dev-test-game-hosted-identity-evidence-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !==
      "local-dev-test-game-hosted-identity-evidence-admin-surface"
  ) {
    throw new Error("hosted identity evidence admin proof shape drifted");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "hosted identity evidence admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of evidence.generatedFrom?.checkIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const checkId of evidence.generatedFrom?.blockedCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing blocked row: ${checkId}`,
      );
    }
  }
  for (const inputId of evidence.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of evidence.generatedFrom?.hostedHandoffBlockedCheckIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const groupId of evidence.generatedFrom?.hostedHandoffGroupIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffGroups?.includes(groupId)
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff group: ${groupId}`,
      );
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `hosted identity evidence admin proof missing related link: ${linkId}`,
      );
    }
  }
  return evidence;
}
