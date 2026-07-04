import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedIdentityEvidence,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidenceInputIds,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
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

function hostedIdentityPacketSectionRows(hostedIdentityEvidence) {
  return hostedIdentityEvidence.target?.redactedIntakePacket?.sections ?? [];
}

function hostedIdentityPacketRefEntries(hostedIdentityEvidence) {
  return hostedIdentityPacketSectionRows(hostedIdentityEvidence).flatMap(
    (section) =>
      (section.redactedEvidenceRefs ?? []).map((ref) => ({
        rowId: `${section.id}-${ref.id}`,
        evidenceFamily: ref.evidenceFamily,
      })),
  );
}

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
      requiredHostedHandoffInputValues: {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          hostedIdentityEvidencePlaceholderFixturePath,
      },
      requiredHostedHandoffBlockedChecks:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      requiredHostedHandoffGroups:
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => group.id,
        ),
      requiredHostedHandoffGroupStatuses: Object.fromEntries(
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => [group.id, group.status],
        ),
      ),
      requiredHostedIdentityPacketSections:
        hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
          (section) => section.id,
        ),
      requiredHostedIdentityPacketSectionStatuses: Object.fromEntries(
        hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
          (section) => [section.id, section.status],
        ),
      ),
      requiredHostedIdentityPacketRefs: hostedIdentityPacketRefEntries(
        source.hostedIdentityEvidence,
      ).map((ref) => ref.rowId),
      requiredHostedIdentityPacketRefStatuses: Object.fromEntries(
        hostedIdentityPacketRefEntries(source.hostedIdentityEvidence).map(
          (ref) => [ref.rowId, ref.evidenceFamily],
        ),
      ),
      requiredHostedIdentityRoleSurfaceContractDiffStatus:
        source.hostedIdentityEvidence.target.roleSurfaceContractDiff.status,
      requiredHostedIdentityRoleSurfaceContractMismatches:
        source.hostedIdentityEvidence.target.roleSurfaceContractDiff.mismatches.map(
          (mismatch) => mismatch.id,
        ),
      requiredHostedIdentityAdapterContractComparisonStatus:
        source.hostedIdentityEvidence.target.identityAdapterContractComparison.status,
      requiredHostedIdentityAdapterContractComparisonMismatches:
        source.hostedIdentityEvidence.target.identityAdapterContractComparison.mismatches.map(
          (mismatch) => mismatch.id,
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
      rawEvidencePath: source.hostedIdentityEvidence.target.rawEvidencePath,
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
      hostedHandoffInputValues: {
        FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
          hostedIdentityEvidencePlaceholderFixturePath,
      },
      hostedHandoffBlockedCheckIds:
        source.hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds,
      hostedHandoffGroupIds:
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => group.id,
        ),
      hostedHandoffGroupStatuses: Object.fromEntries(
        source.hostedIdentityEvidence.hostedHandoffChecklist.requirementGroups.map(
          (group) => [group.id, group.status],
        ),
      ),
      hostedIdentityPacketSectionIds:
        hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
          (section) => section.id,
        ),
      hostedIdentityPacketRefIds: hostedIdentityPacketRefEntries(
        source.hostedIdentityEvidence,
      ).map((ref) => ref.rowId),
      hostedIdentityRoleSurfaceContractDiffStatus:
        source.hostedIdentityEvidence.target.roleSurfaceContractDiff.status,
      hostedIdentityRoleSurfaceContractMismatchIds:
        source.hostedIdentityEvidence.target.roleSurfaceContractDiff.mismatches.map(
          (mismatch) => mismatch.id,
        ),
      hostedIdentityAdapterContractComparisonStatus:
        source.hostedIdentityEvidence.target.identityAdapterContractComparison.status,
      hostedIdentityAdapterContractComparisonMismatchIds:
        source.hostedIdentityEvidence.target.identityAdapterContractComparison.mismatches.map(
          (mismatch) => mismatch.id,
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
  for (const [inputId, expected] of Object.entries(
    evidence.generatedFrom?.hostedHandoffInputValues ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId] ?? "";
    if (!visibleText.includes(expected)) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff input value: ${inputId}`,
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
  for (const [groupId, status] of Object.entries(
    evidence.generatedFrom?.hostedHandoffGroupStatuses ?? {},
  )) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffGroupStatuses?.[
        groupId
      ]?.includes(status)
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing handoff group status: ${groupId}`,
      );
    }
  }
  for (const sectionId of evidence.generatedFrom?.hostedIdentityPacketSectionIds ??
    []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedIdentityPacketSections?.includes(
        sectionId,
      )
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing packet section: ${sectionId}`,
      );
    }
  }
  for (const refId of evidence.generatedFrom?.hostedIdentityPacketRefIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedIdentityPacketRefs?.includes(refId)
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing packet ref: ${refId}`,
      );
    }
  }
  if (
    evidence.generatedFrom?.hostedIdentityRoleSurfaceContractDiffStatus !==
    evidence.adminRoleSurface?.visibleHostedIdentityRoleSurfaceContractDiff?.status
  ) {
    throw new Error(
      "hosted identity evidence admin proof missing role-surface contract diff",
    );
  }
  for (const mismatchId of evidence.generatedFrom
    ?.hostedIdentityRoleSurfaceContractMismatchIds ?? []) {
    if (
      !evidence.adminRoleSurface
        ?.visibleHostedIdentityRoleSurfaceContractMismatches?.includes(
          mismatchId,
        )
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing role-surface mismatch: ${mismatchId}`,
      );
    }
  }
  if (
    evidence.generatedFrom?.hostedIdentityAdapterContractComparisonStatus !==
    evidence.adminRoleSurface
      ?.visibleHostedIdentityAdapterContractComparison?.status
  ) {
    throw new Error(
      "hosted identity evidence admin proof missing adapter contract comparison",
    );
  }
  for (const mismatchId of evidence.generatedFrom
    ?.hostedIdentityAdapterContractComparisonMismatchIds ?? []) {
    if (
      !evidence.adminRoleSurface
        ?.visibleHostedIdentityAdapterContractComparisonMismatches?.includes(
          mismatchId,
        )
    ) {
      throw new Error(
        `hosted identity evidence admin proof missing adapter contract mismatch: ${mismatchId}`,
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
