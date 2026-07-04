import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputSectionStatuses,
  hostedEvidenceHandoffSectionInputRows,
  hostedEvidenceHandoffSectionInputStatuses,
  hostedEvidenceHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";
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
const requiredChecks = hostedTargetPreflightCheckIds;
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
  prove: async ({ browser, frontendBaseUrl, source }) => {
    const blockedRequiredEvidence = blockedCheckRequiredEvidence(
      source.preflight.checks,
    );
    const hostedHandoffInputSections =
      source.preflight.hostedHandoffChecklist?.inputSections ?? [];
    const hostedHandoffSectionInputRows =
      hostedEvidenceHandoffSectionInputRows(hostedHandoffInputSections);
    return await proveAdminAuditDetail({
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
      requiredUnprovenStatuses: blockedRequiredEvidence,
      requiredHostedHandoffInputs: hostedEvidenceHandoffInputIds,
      requiredHostedHandoffBlockedChecks:
        source.preflight.hostedHandoffChecklist?.blockedCheckIds ?? [],
      requiredHostedHandoffBlockedCheckStatuses:
        source.preflight.hostedHandoffChecklist === undefined
          ? {}
          : blockedCheckRequiredEvidence(
              source.preflight.hostedHandoffChecklist.blockedChecks,
            ),
      requiredHostedHandoffSummary: hostedEvidenceHandoffSummary({
        status: source.preflight.hostedHandoffChecklist?.status,
        preflightStatus:
          source.preflight.hostedHandoffChecklist?.preflightStatus,
        command: source.preflight.hostedHandoffChecklist?.command,
        proofTarget: source.preflight.hostedHandoffChecklist?.proofTarget,
      }),
      requiredHostedHandoffBlockedReceipt:
        source.preflight.hostedHandoffChecklist?.blockedReceipt ?? null,
      requiredHostedHandoffInputSections: hostedHandoffInputSections.map(
        (section) => section.id,
      ),
      requiredHostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(hostedHandoffInputSections),
      requiredHostedHandoffSectionInputs: hostedHandoffSectionInputRows.map(
        (row) => row.id,
      ),
      requiredHostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(hostedHandoffInputSections),
      requiredRelatedLinks,
    });
  },
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
      blockedCheckRequiredEvidence: blockedCheckRequiredEvidence(
        source.preflight.checks,
      ),
      hostedHandoffInputIds: hostedEvidenceHandoffInputIds,
      hostedHandoffBlockedCheckIds:
        source.preflight.hostedHandoffChecklist?.blockedCheckIds ?? [],
      hostedHandoffBlockedCheckRequiredEvidence:
        blockedCheckRequiredEvidence(
          source.preflight.hostedHandoffChecklist?.blockedChecks ?? [],
        ),
      hostedHandoffSummary: hostedEvidenceHandoffSummary({
        status: source.preflight.hostedHandoffChecklist?.status,
        preflightStatus:
          source.preflight.hostedHandoffChecklist?.preflightStatus,
        command: source.preflight.hostedHandoffChecklist?.command,
        proofTarget: source.preflight.hostedHandoffChecklist?.proofTarget,
      }),
      hostedHandoffInputSectionIds:
        source.preflight.hostedHandoffChecklist?.inputSections?.map(
          (section) => section.id,
        ) ?? [],
      hostedHandoffInputSectionStatuses:
        hostedEvidenceHandoffInputSectionStatuses(
          source.preflight.hostedHandoffChecklist?.inputSections ?? [],
        ),
      hostedHandoffSectionInputIds: hostedEvidenceHandoffSectionInputRows(
        source.preflight.hostedHandoffChecklist?.inputSections ?? [],
      ).map((row) => row.id),
      hostedHandoffSectionInputStatuses:
        hostedEvidenceHandoffSectionInputStatuses(
          source.preflight.hostedHandoffChecklist?.inputSections ?? [],
        ),
      ...(source.preflight.hostedHandoffChecklist?.blockedReceipt === undefined
        ? {}
        : {
            hostedHandoffBlockedReceipt:
              source.preflight.hostedHandoffChecklist.blockedReceipt,
          }),
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
  for (const [checkId, expectedText] of Object.entries(
    evidence.generatedFrom?.blockedCheckRequiredEvidence ?? {},
  )) {
    const visibleText = evidence.adminRoleSurface?.visibleUnprovenStatuses?.[checkId];
    if (typeof visibleText !== "string" || !visibleText.includes(expectedText)) {
      throw new Error(
        `hosted target preflight admin proof missing blocked required evidence: ${checkId}`,
      );
    }
  }
  for (const inputId of evidence.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff input: ${inputId}`,
      );
    }
  }
  for (const checkId of evidence.generatedFrom?.hostedHandoffBlockedCheckIds ??
    []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffBlockedChecks?.includes(
        checkId,
      )
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const [checkId, expectedText] of Object.entries(
    evidence.generatedFrom?.hostedHandoffBlockedCheckRequiredEvidence ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffBlockedCheckStatuses?.[
        checkId
      ];
    if (typeof visibleText !== "string" || !visibleText.includes(expectedText)) {
      throw new Error(
        `hosted target preflight admin proof missing handoff blocked evidence: ${checkId}`,
      );
    }
  }
  for (const sectionId of evidence.generatedFrom?.hostedHandoffInputSectionIds ??
    []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffInputSections?.includes(
        sectionId,
      )
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff input section: ${sectionId}`,
      );
    }
  }
  for (const [sectionId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.hostedHandoffInputSectionStatuses ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffInputSectionStatuses?.[
        sectionId
      ];
    if (typeof visibleText !== "string" || !visibleText.includes(expectedStatus)) {
      throw new Error(
        `hosted target preflight admin proof missing handoff input section status: ${sectionId}`,
      );
    }
  }
  for (const rowId of evidence.generatedFrom?.hostedHandoffSectionInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(
        rowId,
      )
    ) {
      throw new Error(
        `hosted target preflight admin proof missing handoff section input: ${rowId}`,
      );
    }
  }
  for (const [rowId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.hostedHandoffSectionInputStatuses ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffSectionInputStatuses?.[
        rowId
      ];
    if (typeof visibleText !== "string" || !visibleText.includes(expectedStatus)) {
      throw new Error(
        `hosted target preflight admin proof missing handoff section input status: ${rowId}`,
      );
    }
  }
  const expectedSummary = evidence.generatedFrom?.hostedHandoffSummary;
  if (expectedSummary !== undefined) {
    for (const [key, expectedValue] of Object.entries(expectedSummary)) {
      if (
        evidence.adminRoleSurface?.visibleHostedHandoffSummary?.[key] !==
        String(expectedValue)
      ) {
        throw new Error(
          `hosted target preflight admin proof missing handoff summary: ${key}`,
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
      throw new Error("hosted target preflight admin proof missing blocked receipt");
    }
    for (const key of [
      "status",
      "operatorAction",
      "localVsHostedBoundary",
      "nextProofTarget",
    ]) {
      if (visibleReceipt[key] !== String(expectedBlockedReceipt[key] ?? "")) {
        throw new Error(
          `hosted target preflight admin proof missing blocked receipt field: ${key}`,
        );
      }
    }
    for (const input of expectedBlockedReceipt.missingRequiredInputs ?? []) {
      if (!visibleReceipt.missingRequiredInputs?.includes(String(input))) {
        throw new Error(
          `hosted target preflight admin proof missing blocked receipt input: ${input}`,
        );
      }
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted target preflight admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}

function blockedCheckRequiredEvidence(checks) {
  return Object.fromEntries(
    (Array.isArray(checks) ? checks : [])
      .filter(
        (check) =>
          check?.status === "blocked" &&
          typeof check.requiredEvidence === "string" &&
          check.requiredEvidence.trim() !== "",
      )
      .map((check) => [String(check.id), check.requiredEvidence]),
  );
}
