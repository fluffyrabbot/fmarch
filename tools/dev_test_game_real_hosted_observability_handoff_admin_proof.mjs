import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameRealHostedObservabilityHandoff,
} from "./dev_test_game_real_hosted_observability_handoff.mjs";
import {
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffInputIds,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const handoffPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF ??
    "target/dev-test-game/real-hosted-observability-handoff.json",
);
const handoffRelativePath = path.relative(repoRoot, handoffPath);
const evidencePath = path.join(
  artifactDir,
  "real-hosted-observability-handoff-admin-proof.json",
);
const requiredRelatedLinks = [
  "local-hosted-ops-signals",
  "local-next-action",
];

function handoffInputSections(source) {
  return source.hostedHandoffChecklist?.inputSections ?? [];
}

function handoffSectionInputEntries(source) {
  return handoffInputSections(source).flatMap((section) => {
    const provided = new Set(section.providedInputIds ?? []);
    return (section.requiredInputIds ?? []).map((inputId) => ({
      rowId: `${section.id}-${inputId}`,
      status: provided.has(inputId) ? "provided" : "missing",
    }));
  });
}

function handoffSectionInputStatuses(source) {
  return Object.fromEntries(
    handoffSectionInputEntries(source).map((input) => [
      input.rowId,
      input.status,
    ]),
  );
}

export function realHostedObservabilityHandoffAdminProofCase() {
  return {
    smokeName: "dev-test-game-real-hosted-observability-handoff-admin-proof",
    stage: "real-hosted-observability-handoff-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_REAL_HOSTED_OBSERVABILITY_HANDOFF:
        handoffRelativePath,
    },
    loadSource: async () =>
      assertDevTestGameRealHostedObservabilityHandoff(await readJson(handoffPath)),
    prove: async ({ browser, frontendBaseUrl, source }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.generatedFrom.game,
        auditId: "local-real-hosted-observability-handoff",
        requiredChecks: source.checks.map((check) => check.id),
        requiredCheckStatuses: Object.fromEntries(
          source.checks.map((check) => [check.id, check.status]),
        ),
        requiredUnproven: source.hostedHandoffChecklist.blockedCheckIds,
        requiredHostedHandoffInputs: realHostedObservabilityHandoffInputIds,
        requiredHostedHandoffInputValues: {
          [realHostedObservabilityEvidenceEnv]:
            "externally reachable hosted logs/metrics/traces/paging/SLO/incident-response evidence JSON",
          [realHostedObservabilityBaselineEnv]:
            source.target.localHostedOpsSignalsPath,
        },
        requiredHostedHandoffBlockedChecks:
          source.hostedHandoffChecklist.blockedCheckIds,
        requiredHostedHandoffGroups:
          source.hostedHandoffChecklist.requirementGroups.map((group) => group.id),
        requiredHostedHandoffInputSections:
          handoffInputSections(source).map((section) => section.id),
        requiredHostedHandoffInputSectionStatuses: Object.fromEntries(
          handoffInputSections(source).map((section) => [
            section.id,
            section.status,
          ]),
        ),
        requiredHostedHandoffSectionInputs:
          handoffSectionInputEntries(source).map((input) => input.rowId),
        requiredHostedHandoffSectionInputStatuses:
          handoffSectionInputStatuses(source),
        requiredHostedHandoffBlockedReceipt:
          source.hostedHandoffChecklist.blockedReceipt,
        requiredRelatedLinks,
      }),
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-real-hosted-observability-handoff-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-real-hosted-observability-handoff-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the real hosted observability handoff. Proves the blocked intake receipt is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with externally reachable logs, metrics, traces, paging/SLO, incident-response, and baseline-only boundary rows visible; it does not prove real hosted observability, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        handoff: handoffRelativePath,
        game: source.generatedFrom.game,
        status: source.status,
        rawEvidenceStatus: source.target.rawEvidenceStatus,
        checkIds: source.checks.map((check) => check.id),
        checkStatuses: Object.fromEntries(
          source.checks.map((check) => [check.id, check.status]),
        ),
        blockedCheckIds: source.hostedHandoffChecklist.blockedCheckIds,
        hostedHandoffInputIds: realHostedObservabilityHandoffInputIds,
        hostedHandoffBlockedCheckIds:
          source.hostedHandoffChecklist.blockedCheckIds,
        hostedHandoffGroupIds:
          source.hostedHandoffChecklist.requirementGroups.map((group) => group.id),
        hostedHandoffInputSectionIds:
          handoffInputSections(source).map((section) => section.id),
        hostedHandoffInputSectionStatuses: Object.fromEntries(
          handoffInputSections(source).map((section) => [
            section.id,
            section.status,
          ]),
        ),
        hostedHandoffSectionInputIds:
          handoffSectionInputEntries(source).map((input) => input.rowId),
        hostedHandoffSectionInputStatuses: handoffSectionInputStatuses(source),
        relatedAuditIds: requiredRelatedLinks,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertRealHostedObservabilityHandoffAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(realHostedObservabilityHandoffAdminProofCase());
}

export function assertRealHostedObservabilityHandoffAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !==
      "dev-test-game-real-hosted-observability-handoff-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !==
      "local-dev-test-game-real-hosted-observability-handoff-admin-surface"
  ) {
    throw new Error("real hosted observability handoff admin proof shape drifted");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error(
      "real hosted observability handoff admin proof did not prove admin overview click-through",
    );
  }
  for (const checkId of evidence.generatedFrom?.checkIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `real hosted observability handoff admin proof missing visible check: ${checkId}`,
      );
    }
  }
  for (const checkId of evidence.generatedFrom?.blockedCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(
        `real hosted observability handoff admin proof missing blocked row: ${checkId}`,
      );
    }
  }
  for (const inputId of evidence.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)) {
      throw new Error(
        `real hosted observability handoff admin proof missing handoff input: ${inputId}`,
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
        `real hosted observability handoff admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const groupId of evidence.generatedFrom?.hostedHandoffGroupIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffGroups?.includes(groupId)
    ) {
      throw new Error(
        `real hosted observability handoff admin proof missing handoff group: ${groupId}`,
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
        `real hosted observability handoff admin proof missing input section: ${sectionId}`,
      );
    }
  }
  for (const [sectionId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.hostedHandoffInputSectionStatuses ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffInputSectionStatuses?.[
        sectionId
      ] ?? "";
    if (!visibleText.includes(expectedStatus)) {
      throw new Error(
        `real hosted observability handoff admin proof missing input section status: ${sectionId}`,
      );
    }
  }
  for (const inputId of evidence.generatedFrom?.hostedHandoffSectionInputIds ??
    []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffSectionInputs?.includes(
        inputId,
      )
    ) {
      throw new Error(
        `real hosted observability handoff admin proof missing section input: ${inputId}`,
      );
    }
  }
  for (const [inputId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.hostedHandoffSectionInputStatuses ?? {},
  )) {
    const visibleText =
      evidence.adminRoleSurface?.visibleHostedHandoffSectionInputStatuses?.[
        inputId
      ] ?? "";
    if (!visibleText.includes(expectedStatus)) {
      throw new Error(
        `real hosted observability handoff admin proof missing section input status: ${inputId}`,
      );
    }
  }
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(
        `real hosted observability handoff admin proof missing related link: ${linkId}`,
      );
    }
  }
  return evidence;
}
