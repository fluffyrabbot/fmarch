import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  assertDevTestGameHostedEvidenceLane,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  hostedEvidenceHandoffBlockedCheckRequiredEvidence,
  devTestGameHostedEvidenceLaneAdminProofPath,
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputSectionStatuses,
  hostedEvidenceHandoffInputValues,
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
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const lanePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE ??
    devTestGameHostedEvidenceLanePath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    devTestGameProofRunPath,
);
const demoProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF ??
    devTestGameHostedEvidenceLaneDemoProofPath,
);
const laneRelativePath = path.relative(repoRoot, lanePath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const demoProofRelativePath = path.relative(repoRoot, demoProofPath);
const evidencePath = path.join(repoRoot, devTestGameHostedEvidenceLaneAdminProofPath);
const requiredRelatedLinks = [
  "local-hosted-target-preflight",
  "local-hosted-concurrent-race-matrix",
  "local-next-action",
];

export function hostedEvidenceLaneAdminProofCase() {
  return {
    smokeName: "dev-test-game-hosted-evidence-lane-admin-proof",
    stage: "hosted-evidence-lane-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE: laneRelativePath,
      FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF:
        demoProofRelativePath,
    },
    loadSource: async () => ({
      lane: assertDevTestGameHostedEvidenceLane(await readJson(lanePath)),
      demoProof: assertDevTestGameHostedEvidenceLaneDemoProof(
        await readJson(demoProofPath),
      ),
      proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
    }),
    prove: async ({ browser, frontendBaseUrl, source }) => {
      const hostedHandoffInputValues = hostedEvidenceHandoffInputValues(
        source.lane.hostedEvidence?.realHostedEvidenceInputs,
      );
      const hostedHandoffBlockedCheckStatuses =
        hostedEvidenceHandoffBlockedCheckRequiredEvidence(
          source.lane.checks,
          source.lane.blockedCheckIds,
        );
      const hostedHandoffSummary = hostedEvidenceHandoffSummary({
        status: source.lane.hostedHandoffChecklist?.status,
        preflightStatus: source.lane.hostedHandoffChecklist?.preflightStatus,
        command: source.lane.hostedHandoffChecklist?.command,
        proofTarget: source.lane.hostedHandoffChecklist?.proofTarget,
      });
      const hostedHandoffInputSections =
        source.lane.hostedHandoffChecklist?.inputSections ?? [];
      const hostedHandoffSectionInputRows =
        hostedEvidenceHandoffSectionInputRows(hostedHandoffInputSections);
      return await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: source.proofRun.session.game,
        auditId: "local-hosted-evidence-lane",
        requiredChecks: [
          ...source.lane.checks.map((check) => check.id),
          ...hostedEvidenceLaneDemoProofCheckIds(source.demoProof),
        ],
        requiredCheckStatuses: Object.fromEntries(
          [
            ...source.lane.checks.map((check) => [check.id, check.status]),
            ...hostedEvidenceLaneDemoProofCheckStatuses(source.demoProof),
          ],
        ),
        requiredUnproven: source.lane.blockedCheckIds,
        requiredRealHostedEvidenceInputs: hostedEvidenceHandoffInputIds,
        requiredHostedHandoffInputs: hostedEvidenceHandoffInputIds,
        requiredHostedHandoffInputValues: hostedHandoffInputValues,
        requiredHostedHandoffBlockedChecks: source.lane.blockedCheckIds,
        requiredHostedHandoffBlockedCheckStatuses:
          hostedHandoffBlockedCheckStatuses,
        requiredHostedHandoffSummary: hostedHandoffSummary,
        requiredHostedHandoffBlockedReceipt:
          source.lane.hostedHandoffChecklist?.blockedReceipt ?? null,
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
      proof: "dev-test-game-hosted-evidence-lane-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-hosted-evidence-lane-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the hosted evidence lane. Proves the lane is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked preflight rows and local demo proof blocked-to-passed rows visible; it does not prove hosted deployment, hosted telemetry, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        hostedEvidenceLane: laneRelativePath,
        hostedEvidenceLaneDemoProof: demoProofRelativePath,
        proofRun: proofRunRelativePath,
        game: source.proofRun.session.game,
        status: source.lane.status,
        preflightStatus: source.lane.preflightStatus,
        checkIds: source.lane.checks.map((check) => check.id),
        demoProofCheckIds: hostedEvidenceLaneDemoProofCheckIds(source.demoProof),
        checkStatuses: Object.fromEntries(
          [
            ...source.lane.checks.map((check) => [check.id, check.status]),
            ...hostedEvidenceLaneDemoProofCheckStatuses(source.demoProof),
          ],
        ),
        demoProofStatus: source.demoProof.status,
        demoProofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
        demoProofBlockedLaneStatus: source.demoProof.blockedLane.status,
        demoProofPassedLaneStatus: source.demoProof.passedLane.status,
        demoProofSyntheticExternalTarget:
          source.demoProof.target.syntheticExternalTarget,
        blockedCheckIds: source.lane.blockedCheckIds,
        realHostedEvidenceInputIds: hostedEvidenceHandoffInputIds,
        hostedHandoffInputIds: hostedEvidenceHandoffInputIds,
        hostedHandoffInputValues: hostedEvidenceHandoffInputValues(
          source.lane.hostedEvidence?.realHostedEvidenceInputs,
        ),
        hostedHandoffBlockedCheckIds: source.lane.blockedCheckIds,
        hostedHandoffBlockedCheckRequiredEvidence:
          hostedEvidenceHandoffBlockedCheckRequiredEvidence(
            source.lane.checks,
            source.lane.blockedCheckIds,
          ),
        hostedHandoffSummary: hostedEvidenceHandoffSummary({
          status: source.lane.hostedHandoffChecklist?.status,
          preflightStatus: source.lane.hostedHandoffChecklist?.preflightStatus,
          command: source.lane.hostedHandoffChecklist?.command,
          proofTarget: source.lane.hostedHandoffChecklist?.proofTarget,
        }),
        hostedHandoffInputSectionIds:
          source.lane.hostedHandoffChecklist?.inputSections?.map(
            (section) => section.id,
          ) ?? [],
        hostedHandoffInputSectionStatuses:
          hostedEvidenceHandoffInputSectionStatuses(
            source.lane.hostedHandoffChecklist?.inputSections ?? [],
          ),
        hostedHandoffSectionInputIds: hostedEvidenceHandoffSectionInputRows(
          source.lane.hostedHandoffChecklist?.inputSections ?? [],
        ).map((row) => row.id),
        hostedHandoffSectionInputStatuses:
          hostedEvidenceHandoffSectionInputStatuses(
            source.lane.hostedHandoffChecklist?.inputSections ?? [],
          ),
        ...(source.lane.hostedHandoffChecklist?.blockedReceipt === undefined
          ? {}
          : {
              hostedHandoffBlockedReceipt:
                source.lane.hostedHandoffChecklist.blockedReceipt,
            }),
        relatedAuditIds: requiredRelatedLinks,
      },
      adminRoleSurface,
    }),
    assertEvidence: assertHostedEvidenceLaneAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostedEvidenceLaneAdminProofCase());
}

export function assertHostedEvidenceLaneAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-hosted-evidence-lane-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-hosted-evidence-lane-admin-surface"
  ) {
    throw new Error("hosted evidence lane admin proof shape drifted");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hosted evidence lane admin proof did not prove admin overview click-through");
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.checkIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.demoProofCheckIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "visible demo proof check",
  });
  if (
    evidence.generatedFrom?.demoProofStatus !== "passed" ||
    evidence.generatedFrom?.demoProofBlockedLaneStatus !== "blocked" ||
    evidence.generatedFrom?.demoProofPassedLaneStatus !== "passed" ||
    evidence.generatedFrom?.demoProofSyntheticExternalTarget !== true
  ) {
    throw new Error("hosted evidence lane admin proof demo boundary drifted");
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.blockedCheckIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "blocked row",
    surfaceKey: "visibleUnproven",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.realHostedEvidenceInputIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "real hosted input",
    surfaceKey: "visibleRealHostedEvidenceInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff input",
    surfaceKey: "visibleHostedHandoffInputs",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffBlockedCheckIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff blocked check",
    surfaceKey: "visibleHostedHandoffBlockedChecks",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputValues,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff input value",
    surfaceKey: "visibleHostedHandoffInputValues",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses:
      evidence.generatedFrom?.hostedHandoffBlockedCheckRequiredEvidence,
    proofName: "hosted evidence lane admin proof",
    rowName: "blocked check evidence",
    surfaceKey: "visibleHostedHandoffBlockedCheckStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffInputSectionIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff input section",
    surfaceKey: "visibleHostedHandoffInputSections",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffInputSectionStatuses,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff input section status",
    surfaceKey: "visibleHostedHandoffInputSectionStatuses",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffSectionInputIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "handoff section input",
    surfaceKey: "visibleHostedHandoffSectionInputs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses: evidence.generatedFrom?.hostedHandoffSectionInputStatuses,
    proofName: "hosted evidence lane admin proof",
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
          `hosted evidence lane admin proof missing handoff summary: ${key}`,
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
      throw new Error("hosted evidence lane admin proof missing blocked receipt");
    }
    for (const key of [
      "status",
      "operatorAction",
      "localVsHostedBoundary",
      "nextProofTarget",
    ]) {
      if (visibleReceipt[key] !== String(expectedBlockedReceipt[key] ?? "")) {
        throw new Error(
          `hosted evidence lane admin proof missing blocked receipt field: ${key}`,
        );
      }
    }
    for (const input of expectedBlockedReceipt.missingRequiredInputs ?? []) {
      if (!visibleReceipt.missingRequiredInputs?.includes(String(input))) {
        throw new Error(
          `hosted evidence lane admin proof missing blocked receipt input: ${input}`,
        );
      }
    }
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  return evidence;
}

function hostedEvidenceLaneDemoProofCheckIds(proof) {
  return (proof.checks ?? []).map((check) => `demo-proof:${String(check.id)}`);
}

function hostedEvidenceLaneDemoProofCheckStatuses(proof) {
  return (proof.checks ?? []).map((check) => [
    `demo-proof:${String(check.id)}`,
    String(check.status),
  ]);
}
