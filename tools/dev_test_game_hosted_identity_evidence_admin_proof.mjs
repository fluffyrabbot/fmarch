import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedIdentityEvidence,
  buildDevTestGameHostedIdentityEvidence,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  assertDevTestGameHostedIdentityProgressionSummary,
  buildDevTestGameHostedIdentityProgressionSummary,
} from "./dev_test_game_hosted_identity_progression_summary.mjs";
import {
  devTestGameHostedIdentityCompleteAdminProofPath,
  devTestGameHostedIdentityCompleteEvidencePath,
  devTestGameHostedIdentityPartialAdminProofPath,
  devTestGameHostedIdentityPartialEvidencePath,
  devTestGameHostedIdentityEvidenceAdminProofPath,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionCase,
  hostedIdentityEvidenceProgressionPath,
  hostedIdentityEvidenceSectionInputRows,
  hostedIdentityEvidenceSectionInputStatuses,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
export {
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  assertAdminRoleSurfaceStatusText,
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  buildAdminAuditHandoffPath,
} from "./dev_test_game_admin_audit_handoff_path.mjs";
import {
  assertGeneratedAdminProofHandoffPath,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameHostedIdentityEvidencePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

const hostedIdentityEvidencePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE ??
    devTestGameHostedIdentityEvidencePath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    devTestGameProofRunPath,
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const hostedIdentityProgressionSummaryPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_PROGRESSION_SUMMARY ??
    devTestGameHostedIdentityProgressionSummaryPath,
);
const hostedIdentityProgressionSummaryRelativePath = path.relative(
  repoRoot,
  hostedIdentityProgressionSummaryPath,
);
const evidencePath = path.join(
  repoRoot,
  devTestGameHostedIdentityEvidenceAdminProofPath,
);
export const hostedIdentityEvidencePartialPath =
  devTestGameHostedIdentityPartialEvidencePath;
export const hostedIdentityEvidencePartialAdminProofPath =
  devTestGameHostedIdentityPartialAdminProofPath;
export const hostedIdentityEvidenceCompletePath =
  devTestGameHostedIdentityCompleteEvidencePath;
export const hostedIdentityEvidenceCompleteAdminProofPath =
  devTestGameHostedIdentityCompleteAdminProofPath;
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

function hostedIdentityPacketInputEntries(hostedIdentityEvidence) {
  return hostedIdentityPacketSectionRows(hostedIdentityEvidence).flatMap(
    (section) => {
      const provided = new Set(section.providedInputIds ?? []);
      return (section.requiredInputIds ?? []).map((inputId) => ({
        rowId: `${section.id}-${inputId}`,
        status: provided.has(inputId) ? "provided" : "missing",
      }));
    },
  );
}

function hostedIdentityPacketInputStatuses(hostedIdentityEvidence) {
  return Object.fromEntries(
    hostedIdentityPacketInputEntries(hostedIdentityEvidence).map((input) => [
      input.rowId,
      input.status,
    ]),
  );
}

function hostedIdentityPacketSummaryRows(hostedIdentityEvidence) {
  const packet = hostedIdentityEvidence.target?.redactedIntakePacket ?? {};
  return [
    {
      id: "status",
      status: `${String(packet.status ?? "unknown")}\n${Number(
        packet.providedSectionCount ?? 0,
      )}/${Number(packet.sectionCount ?? 0)} sections provided\n${Number(
        packet.missingSectionCount ?? 0,
      )} sections missing`,
    },
    {
      id: "inputs",
      status: `${Number(packet.providedInputCount ?? 0)}/${Number(
        packet.requiredInputCount ?? 0,
      )} inputs provided\n${Number(packet.missingInputCount ?? 0)} inputs missing`,
    },
    {
      id: "redacted-refs",
      status: `${Number(packet.redactedEvidenceRefCount ?? 0)} redacted refs`,
    },
  ];
}

function hostedIdentityPacketSummaryStatuses(hostedIdentityEvidence) {
  return Object.fromEntries(
    hostedIdentityPacketSummaryRows(hostedIdentityEvidence).map((summary) => [
      summary.id,
      summary.status,
    ]),
  );
}

function hostedIdentityHandoffSummary(hostedIdentityEvidence) {
  const checklist = hostedIdentityEvidence.hostedHandoffChecklist ?? {};
  return {
    status: String(checklist.status ?? hostedIdentityEvidence.status ?? "unknown"),
    preflightStatus: String(
      checklist.preflightStatus ?? hostedIdentityEvidence.status ?? "unknown",
    ),
    command: String(checklist.command ?? hostedIdentityEvidence.nextCommand ?? ""),
    proofTarget: String(
      checklist.proofTarget ?? hostedIdentityEvidence.nextProofTarget ?? "",
    ),
  };
}

function hostedIdentityHandoffPath(hostedIdentityEvidence) {
  return buildAdminAuditHandoffPath({
    upstreamAuditId: "local-next-action",
    localCapabilityAuditId: "local-identity-adapter",
    downstreamStatus: String(hostedIdentityEvidence.status ?? "unknown"),
    downstreamCommand: String(hostedIdentityEvidence.nextCommand ?? ""),
    downstreamProofTarget: String(hostedIdentityEvidence.nextProofTarget ?? ""),
  });
}

function hostedIdentityHandoffInputValues(hostedIdentityEvidence) {
  return {
    FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
      hostedIdentityEvidence.target?.rawEvidencePath ??
      hostedIdentityEvidencePlaceholderFixturePath,
  };
}

function hostedIdentityOperatorProofStatus(drilldown) {
  return String(drilldown.progressionId ?? "");
}

function hostedIdentityProgressionRowStatuses(summary) {
  return Object.fromEntries(
    (summary.progressions ?? []).map((progression) => [
      progression.id,
      progression.adminProofTarget,
    ]),
  );
}

export function hostedIdentityEvidenceAdminProofCase({
  sourcePath = hostedIdentityEvidencePath,
  proofPath = evidencePath,
  smokeName = "dev-test-game-hosted-identity-evidence-admin-proof",
  stage = "hosted-identity-evidence-admin-proof-listen",
} = {}) {
  const sourceRelativePath = path.relative(repoRoot, sourcePath);
  const proofRelativePath = path.relative(repoRoot, proofPath);
  return {
    smokeName,
    stage,
    evidencePath: proofPath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_HOSTED_IDENTITY_EVIDENCE:
        sourceRelativePath,
    },
    loadSource: async () => ({
      hostedIdentityEvidence: assertDevTestGameHostedIdentityEvidence(
        await readJson(sourcePath),
      ),
      hostedIdentityProgressionSummary:
        await ensureHostedIdentityProgressionSummary(),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      {
        const hostedHandoffInputSections =
          source.hostedIdentityEvidence.hostedHandoffChecklist.inputSections ?? [];
        const hostedHandoffSectionInputRows =
          hostedIdentityEvidenceSectionInputRows(hostedHandoffInputSections);
        const hostedHandoffOperatorProofDrilldowns =
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorProofDrilldowns ?? [];
        return await proveAdminAuditDetail({
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
        requiredHostedHandoffInputValues: hostedIdentityHandoffInputValues(
          source.hostedIdentityEvidence,
        ),
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
        requiredHostedHandoffInputSections: hostedHandoffInputSections.map(
          (section) => section.id,
        ),
        requiredHostedHandoffInputSectionStatuses:
          hostedIdentityEvidenceInputSectionStatuses(hostedHandoffInputSections),
        requiredHostedHandoffSectionInputs: hostedHandoffSectionInputRows.map(
          (row) => row.id,
        ),
        requiredHostedHandoffSectionInputStatuses:
          hostedIdentityEvidenceSectionInputStatuses(hostedHandoffInputSections),
        requiredHostedHandoffOperatorProofs:
          hostedHandoffOperatorProofDrilldowns.map((drilldown) => drilldown.id),
        requiredHostedHandoffOperatorProofStatuses: Object.fromEntries(
          hostedHandoffOperatorProofDrilldowns.map((drilldown) => [
            drilldown.id,
            hostedIdentityOperatorProofStatus(drilldown),
          ]),
        ),
        requiredHostedHandoffSummary: hostedIdentityHandoffSummary(
          source.hostedIdentityEvidence,
        ),
        requiredHostedHandoffBlockedReceipt:
          source.hostedIdentityEvidence.hostedHandoffChecklist.blockedReceipt ??
          null,
        requiredHostedIdentityOperatorGate:
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorEvidenceGate,
        requiredHostedIdentityProviderBoundary:
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorEvidenceGate?.providerBoundary ??
          source.hostedIdentityEvidence.target.identityProviderBoundary,
        requiredHostedIdentityPacketSummaries: hostedIdentityPacketSummaryRows(
          source.hostedIdentityEvidence,
        ).map((summary) => summary.id),
        requiredHostedIdentityPacketSummaryStatuses:
          hostedIdentityPacketSummaryStatuses(source.hostedIdentityEvidence),
        requiredHostedIdentityPacketSections:
          hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
            (section) => section.id,
          ),
        requiredHostedIdentityPacketSectionStatuses: Object.fromEntries(
          hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
            (section) => [section.id, section.status],
          ),
        ),
        requiredHostedIdentityPacketInputs: hostedIdentityPacketInputEntries(
          source.hostedIdentityEvidence,
        ).map((input) => input.rowId),
        requiredHostedIdentityPacketInputStatuses: hostedIdentityPacketInputStatuses(
          source.hostedIdentityEvidence,
        ),
        requiredHostedIdentityPacketRefs: hostedIdentityPacketRefEntries(
          source.hostedIdentityEvidence,
        ).map((ref) => ref.rowId),
        requiredHostedIdentityPacketRefStatuses: Object.fromEntries(
          hostedIdentityPacketRefEntries(source.hostedIdentityEvidence).map(
            (ref) => [ref.rowId, ref.evidenceFamily],
          ),
        ),
        requiredHostedIdentityProgressions:
          source.hostedIdentityProgressionSummary.progressions.map(
            (progression) => progression.id,
          ),
        requiredHostedIdentityProgressionStatuses:
          hostedIdentityProgressionRowStatuses(
            source.hostedIdentityProgressionSummary,
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
        requiredHandoffPath: hostedIdentityHandoffPath(
          source.hostedIdentityEvidence,
        ),
        requiredRelatedLinks,
        requiredRelatedDestinations: [
          {
            linkId: "local-next-action",
            auditId: "local-next-action",
            requiredChecks: ["next-command"],
          },
        ],
        });
      },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-hosted-identity-evidence-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-hosted-identity-evidence-admin-surface",
      proofBoundary:
        source.hostedIdentityEvidence.status === "passed"
          ? "Local SvelteKit admin role URL with fixture admin authority over the complete hosted identity evidence handoff. Proves a redacted hosted identity intake packet with all six evidence-family sections provided is discoverable from the seeded admin overview and inspectable in a native admin audit detail route while releaseReady and productionReady stay false; it does not prove hosted identity live traffic, beta readiness, release readiness, or production readiness."
          : "Local SvelteKit admin role URL with fixture admin authority over the hosted identity evidence handoff. Proves the hosted identity evidence receipt is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked hosted account, invite, recovery, abuse/rate-limit, session-secret, and audit-retention rows visible; it does not prove hosted identity, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        hostedIdentityEvidence: sourceRelativePath,
        proofRun: proofRunRelativePath,
        proofArtifact: proofRelativePath,
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
        hostedHandoffInputValues: hostedIdentityHandoffInputValues(
          source.hostedIdentityEvidence,
        ),
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
        hostedHandoffInputSectionIds:
          source.hostedIdentityEvidence.hostedHandoffChecklist.inputSections.map(
            (section) => section.id,
          ),
        hostedHandoffInputSectionStatuses:
          hostedIdentityEvidenceInputSectionStatuses(
            source.hostedIdentityEvidence.hostedHandoffChecklist.inputSections,
          ),
        hostedHandoffSectionInputIds: hostedIdentityEvidenceSectionInputRows(
          source.hostedIdentityEvidence.hostedHandoffChecklist.inputSections,
        ).map((row) => row.id),
        hostedHandoffSectionInputStatuses:
          hostedIdentityEvidenceSectionInputStatuses(
            source.hostedIdentityEvidence.hostedHandoffChecklist.inputSections,
          ),
        hostedHandoffOperatorProofIds:
          source.hostedIdentityEvidence.hostedHandoffChecklist.operatorProofDrilldowns.map(
            (drilldown) => drilldown.id,
          ),
        hostedHandoffOperatorProofStatuses: Object.fromEntries(
          source.hostedIdentityEvidence.hostedHandoffChecklist.operatorProofDrilldowns.map(
            (drilldown) => [
              drilldown.id,
              hostedIdentityOperatorProofStatus(drilldown),
            ],
          ),
        ),
        hostedIdentityOperatorGate:
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorEvidenceGate,
        hostedIdentityProviderBoundary:
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorEvidenceGate?.providerBoundary ??
          source.hostedIdentityEvidence.target.identityProviderBoundary,
        hostedIdentityProviderIds: (
          source.hostedIdentityEvidence.hostedHandoffChecklist
            .operatorEvidenceGate?.providerBoundary?.providers ??
          source.hostedIdentityEvidence.target.identityProviderBoundary
            ?.providers ??
          []
        ).map((provider) => provider.id),
        hostedHandoffSummary: hostedIdentityHandoffSummary(
          source.hostedIdentityEvidence,
        ),
        handoffPath: hostedIdentityHandoffPath(source.hostedIdentityEvidence),
        ...(source.hostedIdentityEvidence.hostedHandoffChecklist
          .blockedReceipt === undefined
          ? {}
          : {
              hostedHandoffBlockedReceipt:
                source.hostedIdentityEvidence.hostedHandoffChecklist
                  .blockedReceipt,
            }),
        hostedIdentityPacketSummaryIds: hostedIdentityPacketSummaryRows(
          source.hostedIdentityEvidence,
        ).map((summary) => summary.id),
        hostedIdentityPacketSummaryStatuses:
          hostedIdentityPacketSummaryStatuses(source.hostedIdentityEvidence),
        hostedIdentityPacketSectionIds:
          hostedIdentityPacketSectionRows(source.hostedIdentityEvidence).map(
            (section) => section.id,
          ),
        hostedIdentityPacketInputIds: hostedIdentityPacketInputEntries(
          source.hostedIdentityEvidence,
        ).map((input) => input.rowId),
        hostedIdentityPacketInputStatuses: hostedIdentityPacketInputStatuses(
          source.hostedIdentityEvidence,
        ),
        hostedIdentityPacketRefIds: hostedIdentityPacketRefEntries(
          source.hostedIdentityEvidence,
        ).map((ref) => ref.rowId),
        hostedIdentityProgressionSummary:
          hostedIdentityProgressionSummaryRelativePath,
        hostedIdentityProgressionIds:
          source.hostedIdentityProgressionSummary.progressions.map(
            (progression) => progression.id,
          ),
        hostedIdentityProgressionStatuses:
          hostedIdentityProgressionRowStatuses(
            source.hostedIdentityProgressionSummary,
          ),
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
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostedIdentityEvidenceAdminProofCase());
}

export async function writeHostedIdentityPartialOperatorAdminProof() {
  await writeHostedIdentityProgressionAdminProof({
    progressionId: "account-recovery",
    evidencePath: hostedIdentityEvidencePartialPath,
    proofPath: hostedIdentityEvidencePartialAdminProofPath,
    smokeName: "dev-test-game-hosted-identity-partial-admin-proof",
    stage: "hosted-identity-partial-admin-proof-listen",
  });
}

export async function writeHostedIdentityCompleteAdminProof() {
  const completeEvidencePath = path.resolve(
    repoRoot,
    hostedIdentityEvidenceCompletePath,
  );
  const completeAdminProofPath = path.resolve(
    repoRoot,
    hostedIdentityEvidenceCompleteAdminProofPath,
  );
  const completeEvidence = await buildDevTestGameHostedIdentityEvidence({
    env: {
      FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
        hostedIdentityEvidenceRedactedPassFixturePath,
    },
  });
  if (
    completeEvidence.status !== "passed" ||
    completeEvidence.target?.redactedIntakePacket?.providedSectionCount !== 6 ||
    completeEvidence.target?.redactedIntakePacket?.sectionCount !== 6 ||
    completeEvidence.releaseReady !== false ||
    completeEvidence.productionReady !== false
  ) {
    throw new Error("complete hosted identity evidence packet did not pass locally");
  }
  await writeEvidenceArtifact(completeEvidencePath, completeEvidence);
  await runAdminAuditProof(
    hostedIdentityEvidenceAdminProofCase({
      sourcePath: completeEvidencePath,
      proofPath: completeAdminProofPath,
      smokeName: "dev-test-game-hosted-identity-complete-admin-proof",
      stage: "hosted-identity-complete-admin-proof-listen",
    }),
  );
}

export async function writeHostedIdentityProgressionAdminProof({
  progressionId,
  evidencePath = hostedIdentityEvidenceProgressionPath(progressionId),
  proofPath = hostedIdentityEvidenceProgressionAdminProofPath(progressionId),
  smokeName,
  stage,
} = {}) {
  const progression = hostedIdentityEvidenceProgressionCase(progressionId);
  const progressionEvidencePath = path.resolve(repoRoot, evidencePath);
  const progressionAdminProofPath = path.resolve(repoRoot, proofPath);
  const progressionEvidence = await buildDevTestGameHostedIdentityEvidence({
    env: {
      FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH:
        progression.adminProofFixturePath ?? progression.missingFixturePath,
    },
  });
  await writeEvidenceArtifact(progressionEvidencePath, progressionEvidence);
  await runAdminAuditProof(
    hostedIdentityEvidenceAdminProofCase({
      sourcePath: progressionEvidencePath,
      proofPath: progressionAdminProofPath,
      smokeName:
        smokeName ??
        `dev-test-game-hosted-identity-${progression.id}-admin-proof`,
      stage:
        stage ?? `hosted-identity-${progression.id}-admin-proof-listen`,
    }),
  );
}

async function writeEvidenceArtifact(filePath, evidence) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function ensureHostedIdentityProgressionSummary() {
  const summary = buildDevTestGameHostedIdentityProgressionSummary();
  await writeEvidenceArtifact(hostedIdentityProgressionSummaryPath, summary);
  return assertDevTestGameHostedIdentityProgressionSummary(summary);
}

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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.checkIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.blockedCheckIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "blocked row",
    surfaceKey: "visibleUnproven",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff input",
    surfaceKey: "visibleHostedHandoffInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputValues,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff input value",
    surfaceKey: "visibleHostedHandoffInputValues",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffBlockedCheckIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff blocked check",
    surfaceKey: "visibleHostedHandoffBlockedChecks",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffGroupIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff group",
    surfaceKey: "visibleHostedHandoffGroups",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffGroupStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff group status",
    surfaceKey: "visibleHostedHandoffGroupStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputSectionIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff input section",
    surfaceKey: "visibleHostedHandoffInputSections",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputSectionStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff input section status",
    surfaceKey: "visibleHostedHandoffInputSectionStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffSectionInputIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff section input",
    surfaceKey: "visibleHostedHandoffSectionInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffSectionInputStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff section input status",
    surfaceKey: "visibleHostedHandoffSectionInputStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffOperatorProofIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff operator proof",
    surfaceKey: "visibleHostedHandoffOperatorProofs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffOperatorProofStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "handoff operator proof status",
    surfaceKey: "visibleHostedHandoffOperatorProofStatuses",
  });
  const expectedSummary = evidence.generatedFrom?.hostedHandoffSummary;
  if (expectedSummary !== undefined) {
    for (const [key, expectedValue] of Object.entries(expectedSummary)) {
      if (
        evidence.adminRoleSurface?.visibleHostedHandoffSummary?.[key] !==
        String(expectedValue)
      ) {
        throw new Error(
          `hosted identity evidence admin proof missing handoff summary: ${key}`,
        );
      }
    }
  }
  const expectedBlockedReceipt =
    evidence.generatedFrom?.hostedHandoffBlockedReceipt;
  if (expectedBlockedReceipt !== undefined) {
    const visibleReceipt =
      evidence.adminRoleSurface?.visibleHostedHandoffBlockedReceipt;
    if (visibleReceipt === undefined) {
      throw new Error("hosted identity evidence admin proof missing blocked receipt");
    }
    for (const field of [
      "status",
      "operatorAction",
      "localVsHostedBoundary",
      "nextProofTarget",
    ]) {
      if (visibleReceipt[field] !== expectedBlockedReceipt[field]) {
        throw new Error(
          `hosted identity evidence admin proof blocked receipt mismatch: ${field}`,
        );
      }
    }
    for (const input of expectedBlockedReceipt.missingRequiredInputs ?? []) {
      if (!visibleReceipt.missingRequiredInputs?.includes(String(input))) {
        throw new Error(
          `hosted identity evidence admin proof blocked receipt missing input: ${input}`,
        );
      }
    }
    const expectedFirstMissing =
      expectedBlockedReceipt.firstMissingOperatorArtifact;
    if (expectedFirstMissing !== undefined) {
      const visibleFirstMissing = visibleReceipt.firstMissingOperatorArtifact;
      if (
        visibleFirstMissing === null ||
        visibleFirstMissing === undefined ||
        JSON.stringify(visibleFirstMissing) !==
          JSON.stringify(normalizeVisibleFirstMissing(expectedFirstMissing))
      ) {
        throw new Error(
          "hosted identity evidence admin proof first missing artifact drifted",
        );
      }
    }
  }
  assertGeneratedAdminProofHandoffPath({
    proof: evidence,
    proofName: "hosted identity evidence admin proof",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedIdentityPacketSummaryIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet summary",
    surfaceKey: "visibleHostedIdentityPacketSummaries",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedIdentityPacketSummaryStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet summary status",
    surfaceKey: "visibleHostedIdentityPacketSummaryStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedIdentityPacketSectionIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet section",
    surfaceKey: "visibleHostedIdentityPacketSections",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedIdentityPacketInputIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet input",
    surfaceKey: "visibleHostedIdentityPacketInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedIdentityPacketInputStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet input status",
    surfaceKey: "visibleHostedIdentityPacketInputStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedIdentityPacketRefIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "packet ref",
    surfaceKey: "visibleHostedIdentityPacketRefs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedIdentityProgressionIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "progression",
    surfaceKey: "visibleHostedIdentityProgressions",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedIdentityProgressionStatuses,
    proofName: "hosted identity evidence admin proof",
    rowName: "progression status",
    surfaceKey: "visibleHostedIdentityProgressionStatuses",
  });
  const operatorGate = evidence.generatedFrom?.hostedIdentityOperatorGate;
  if (operatorGate !== undefined) {
    if (
      !evidence.adminRoleSurface?.visibleHostedIdentityOperatorGate?.includes(
        operatorGate.id,
      ) ||
      !(
        evidence.adminRoleSurface
          ?.visibleHostedIdentityOperatorGateStatuses?.[operatorGate.id] ?? ""
      ).includes(operatorGate.requiredRawEvidencePathKind)
    ) {
      throw new Error(
        "hosted identity evidence admin proof missing operator evidence gate",
      );
    }
    assertVisibleAdminRoleSurfaceRows({
      adminRoleSurface: evidence.adminRoleSurface,
      rowIds: (operatorGate.requiredEvidenceFamilies ?? []).map(
        (family) => family.id,
      ),
      proofName: "hosted identity evidence admin proof",
      rowName: "operator evidence family",
      surfaceKey: "visibleHostedIdentityOperatorGateFamilies",
    });
    assertVisibleAdminRoleSurfaceRows({
      adminRoleSurface: evidence.adminRoleSurface,
      rowIds: operatorGate.rejectedRawEvidencePathKinds ?? [],
      proofName: "hosted identity evidence admin proof",
      rowName: "rejected operator evidence path kind",
      surfaceKey: "visibleHostedIdentityOperatorGateRejectedPathKinds",
    });
    if (operatorGate.providerBoundary !== undefined) {
      assertVisibleAdminRoleSurfaceRows({
        adminRoleSurface: evidence.adminRoleSurface,
        rowIds: [operatorGate.providerBoundary.id],
        proofName: "hosted identity evidence admin proof",
        rowName: "identity provider boundary",
        surfaceKey: "visibleHostedIdentityProviderBoundary",
      });
      assertVisibleAdminRoleSurfaceRows({
        adminRoleSurface: evidence.adminRoleSurface,
        rowIds: (operatorGate.providerBoundary.providers ?? []).map(
          (provider) => provider.id,
        ),
        proofName: "hosted identity evidence admin proof",
        rowName: "identity provider",
        surfaceKey: "visibleHostedIdentityProviderBoundaryProviders",
      });
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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds:
      evidence.generatedFrom?.hostedIdentityRoleSurfaceContractMismatchIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "role-surface mismatch",
    surfaceKey: "visibleHostedIdentityRoleSurfaceContractMismatches",
  });
  if (
    evidence.generatedFrom?.hostedIdentityAdapterContractComparisonStatus !==
    evidence.adminRoleSurface
      ?.visibleHostedIdentityAdapterContractComparison?.status
  ) {
    throw new Error(
      "hosted identity evidence admin proof missing adapter contract comparison",
    );
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds:
      evidence.generatedFrom?.hostedIdentityAdapterContractComparisonMismatchIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "adapter contract mismatch",
    surfaceKey: "visibleHostedIdentityAdapterContractComparisonMismatches",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "hosted identity evidence admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  return evidence;
}

function normalizeVisibleFirstMissing(artifact) {
  const drilldown = artifact.roleSurfaceDrilldown ?? {};
  return {
    inputId: String(artifact.inputId ?? ""),
    checkId: String(artifact.checkId ?? ""),
    sectionId: String(artifact.sectionId ?? ""),
    sectionLabel: String(artifact.sectionLabel ?? ""),
    requiredEvidence: String(artifact.requiredEvidence ?? ""),
    purpose: String(artifact.purpose ?? ""),
    proofTarget: String(artifact.proofTarget ?? ""),
    roleSurfaceDrilldown: {
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    },
  };
}
