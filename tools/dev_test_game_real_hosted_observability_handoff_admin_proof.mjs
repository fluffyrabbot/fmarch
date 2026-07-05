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

function realHostedObservabilitySummaryRows(source) {
  const checks = Array.isArray(source.checks) ? source.checks : [];
  const passedCheckCount = checks.filter((check) => check.status === "passed").length;
  const blockedCheckCount = source.hostedHandoffChecklist.blockedCheckIds.length;
  const inputSections = handoffInputSections(source);
  const requiredInputCount = inputSections.reduce(
    (total, section) => total + (section.requiredInputIds ?? []).length,
    0,
  );
  const providedInputCount = inputSections.reduce(
    (total, section) => total + (section.providedInputIds ?? []).length,
    0,
  );
  return [
    {
      id: "status",
      status: `${source.status}\n${passedCheckCount}/${checks.length} checks passed\n${blockedCheckCount} checks blocked`,
    },
    {
      id: "inputs",
      status: `${providedInputCount}/${requiredInputCount} inputs provided\n${requiredInputCount - providedInputCount} inputs missing`,
    },
    {
      id: "baseline",
      status: `${
        source.target.localHostedLikeSignalsOnlyBaseline === true
          ? "baseline only"
          : "baseline missing"
      }\n${source.target.localHostedOpsSignalsPath}\nLocal hosted-like signals cannot satisfy real hosted observability evidence.`,
    },
  ];
}

function realHostedObservabilitySummaryStatuses(source) {
  return Object.fromEntries(
    realHostedObservabilitySummaryRows(source).map((summary) => [
      summary.id,
      summary.status,
    ]),
  );
}

function realHostedObservabilityHandoffPath(source) {
  return buildAdminAuditHandoffPath({
    upstreamAuditId: "local-next-action",
    localCapabilityAuditId: "local-hosted-ops-signals",
    downstreamStatus: String(source.status ?? "unknown"),
    downstreamCommand: String(source.nextCommand ?? ""),
    downstreamProofTarget: String(source.nextProofTarget ?? ""),
  });
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
        requiredRealHostedObservabilitySummaries:
          realHostedObservabilitySummaryRows(source).map((summary) => summary.id),
        requiredRealHostedObservabilitySummaryStatuses:
          realHostedObservabilitySummaryStatuses(source),
        requiredHostedHandoffBlockedReceipt:
          source.hostedHandoffChecklist.blockedReceipt,
        requiredHandoffPath: realHostedObservabilityHandoffPath(source),
        requiredRelatedLinks,
        requiredRelatedDestinations: [
          {
            linkId: "local-next-action",
            auditId: "local-next-action",
            requiredChecks: ["next-command"],
          },
        ],
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
        realHostedObservabilitySummaryIds:
          realHostedObservabilitySummaryRows(source).map((summary) => summary.id),
        realHostedObservabilitySummaryStatuses:
          realHostedObservabilitySummaryStatuses(source),
        handoffPath: realHostedObservabilityHandoffPath(source),
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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.checkIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.blockedCheckIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "blocked row",
    surfaceKey: "visibleUnproven",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "handoff input",
    surfaceKey: "visibleHostedHandoffInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffBlockedCheckIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "handoff blocked check",
    surfaceKey: "visibleHostedHandoffBlockedChecks",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffGroupIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "handoff group",
    surfaceKey: "visibleHostedHandoffGroups",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputSectionIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "input section",
    surfaceKey: "visibleHostedHandoffInputSections",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputSectionStatuses,
    proofName: "real hosted observability handoff admin proof",
    rowName: "input section status",
    surfaceKey: "visibleHostedHandoffInputSectionStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffSectionInputIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "section input",
    surfaceKey: "visibleHostedHandoffSectionInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffSectionInputStatuses,
    proofName: "real hosted observability handoff admin proof",
    rowName: "section input status",
    surfaceKey: "visibleHostedHandoffSectionInputStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.realHostedObservabilitySummaryIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "observability summary",
    surfaceKey: "visibleRealHostedObservabilitySummaries",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses:
      evidence.generatedFrom?.realHostedObservabilitySummaryStatuses,
    proofName: "real hosted observability handoff admin proof",
    rowName: "observability summary status",
    surfaceKey: "visibleRealHostedObservabilitySummaryStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "real hosted observability handoff admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  assertGeneratedAdminProofHandoffPath({
    proof: evidence,
    proofName: "real hosted observability handoff admin proof",
  });
  return evidence;
}
