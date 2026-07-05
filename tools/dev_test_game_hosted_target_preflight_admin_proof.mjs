import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedTargetPreflight,
  devTestGameHostedTargetPreflightPath,
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameHostedTargetPreflightAdminProofPath,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputSectionStatuses,
  hostedEvidenceHandoffSectionInputRows,
  hostedEvidenceHandoffSectionInputStatuses,
  hostedEvidenceHandoffSummary,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  assertAdminRoleSurfaceStatusText,
  assertVisibleAdminRoleSurfaceRows,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const preflightPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_TARGET_PREFLIGHT ??
    devTestGameHostedTargetPreflightPath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const preflightRelativePath = path.relative(repoRoot, preflightPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(
  repoRoot,
  devTestGameHostedTargetPreflightAdminProofPath,
);
const requiredChecks = hostedTargetPreflightCheckIds;
const requiredRelatedLinks = [
  "local-hosted-concurrent-race-matrix",
  "local-next-action",
];

export function hostedTargetPreflightAdminProofCase() {
  return {
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
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostedTargetPreflightAdminProofCase());
}

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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.checkIds,
    proofName: "hosted target preflight admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.blockedCheckIds,
    proofName: "hosted target preflight admin proof",
    rowName: "blocked row",
    surfaceKey: "visibleUnproven",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.blockedCheckRequiredEvidence,
    proofName: "hosted target preflight admin proof",
    rowName: "blocked required evidence",
    surfaceKey: "visibleUnprovenStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputIds,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff input",
    surfaceKey: "visibleHostedHandoffInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffBlockedCheckIds,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff blocked check",
    surfaceKey: "visibleHostedHandoffBlockedChecks",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses:
      evidence.generatedFrom?.hostedHandoffBlockedCheckRequiredEvidence,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff blocked evidence",
    surfaceKey: "visibleHostedHandoffBlockedCheckStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputSectionIds,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff input section",
    surfaceKey: "visibleHostedHandoffInputSections",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputSectionStatuses,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff input section status",
    surfaceKey: "visibleHostedHandoffInputSectionStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffSectionInputIds,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff section input",
    surfaceKey: "visibleHostedHandoffSectionInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffSectionInputStatuses,
    proofName: "hosted target preflight admin proof",
    rowName: "handoff section input status",
    surfaceKey: "visibleHostedHandoffSectionInputStatuses",
  });
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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "hosted target preflight admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
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
