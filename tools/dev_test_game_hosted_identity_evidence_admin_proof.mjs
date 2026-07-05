import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedIdentityEvidence,
  buildDevTestGameHostedIdentityEvidence,
} from "./dev_test_game_hosted_identity_evidence.mjs";
import {
  devTestGameHostedIdentityPartialAdminProofPath,
  devTestGameHostedIdentityPartialEvidencePath,
  hostedIdentityEvidencePlaceholderFixturePath,
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
  artifactDir,
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
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  artifactDir,
  "hosted-identity-evidence-admin-proof.json",
);
export const hostedIdentityEvidencePartialPath =
  devTestGameHostedIdentityPartialEvidencePath;
export const hostedIdentityEvidencePartialAdminProofPath =
  devTestGameHostedIdentityPartialAdminProofPath;
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

function hostedIdentityOperatorProofStatus(drilldown) {
  return String(drilldown.progressionId ?? "");
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
        "Local SvelteKit admin role URL with fixture admin authority over the hosted identity evidence handoff. Proves the hosted identity evidence receipt is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked hosted account, invite, recovery, abuse/rate-limit, session-secret, and audit-retention rows visible; it does not prove hosted identity, beta readiness, release readiness, or production readiness.",
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
      FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH: progression.missingFixturePath,
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
