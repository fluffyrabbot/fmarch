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
import {
  visibleBlockedOperatorPacket,
} from "./dev_test_game_hosted_operator_packet.mjs";
import {
  devTestGameHostedMatrixRawEvidenceTemplateEnv,
  devTestGameHostedMatrixRawEvidenceTemplatePath,
  devTestGameHostedMatrixRawEvidenceTemplateProofCommand,
  devTestGameHostedMatrixRawEvidenceTemplateProofPath,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistPath,
  devTestGameHostedEvidenceOperatorChecklistProofCommand,
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";

const defaultLanePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE ??
    devTestGameHostedEvidenceLanePath,
);
const defaultProofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    devTestGameProofRunPath,
);
const defaultDemoProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF ??
    devTestGameHostedEvidenceLaneDemoProofPath,
);
const defaultEvidencePath = path.join(
  repoRoot,
  devTestGameHostedEvidenceLaneAdminProofPath,
);
const requiredRelatedLinks = [
  "local-hosted-target-preflight",
  "local-hosted-concurrent-race-matrix",
  "local-next-action",
];

export function hostedEvidenceLaneAdminProofCase({
  lanePath = defaultLanePath,
  proofRunPath = defaultProofRunPath,
  demoProofPath = defaultDemoProofPath,
  evidencePath = defaultEvidencePath,
  smokeName = "dev-test-game-hosted-evidence-lane-admin-proof",
  stage = "hosted-evidence-lane-admin-proof-listen",
  proofName = "dev-test-game-hosted-evidence-lane-admin-proof",
  scope = "local-dev-test-game-hosted-evidence-lane-admin-surface",
  proofBoundary =
    "Local SvelteKit admin role URL with fixture admin authority over the hosted evidence lane. Proves the lane is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked preflight rows and local demo proof synthetic-rejection rows visible; it does not prove hosted deployment, hosted telemetry, beta readiness, release readiness, or production readiness.",
  generatedFromExtra = {},
  requiredText = [
    "Hosted evidence blocked receipt",
    "Real hosted raw-capture intake",
    "First missing operator artifact",
    "Hosted evidence operator checklist proof",
    devTestGameHostedEvidenceOperatorChecklistPath,
    `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`,
  ],
  assertEvidence = assertHostedEvidenceLaneAdminProof,
} = {}) {
  const laneRelativePath = path.relative(repoRoot, lanePath);
  const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
  const demoProofRelativePath = path.relative(repoRoot, demoProofPath);
  return {
    smokeName,
    stage,
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
      const hostedHandoffOperatorProofIds =
        hostedEvidenceOperatorChecklistProofIds(
          source.lane.hostedHandoffChecklist,
        );
      const hostedHandoffOperatorProofStatuses =
        hostedEvidenceOperatorChecklistProofStatuses(
          source.lane.hostedHandoffChecklist,
        );
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
        requiredRawEvidenceTemplates: ["operator-template"],
        requiredRawEvidenceTemplateStatuses: {
          "operator-template": devTestGameHostedMatrixRawEvidenceTemplatePath,
        },
        requiredHostedHandoffInputs: hostedEvidenceHandoffInputIds,
        requiredHostedHandoffInputValues: hostedHandoffInputValues,
        requiredHostedHandoffBlockedChecks: source.lane.blockedCheckIds,
        requiredHostedHandoffBlockedCheckStatuses:
          hostedHandoffBlockedCheckStatuses,
        requiredHostedHandoffSummary: hostedHandoffSummary,
        requiredHostedHandoffBlockedReceipt:
          source.lane.hostedHandoffChecklist?.blockedReceipt ?? null,
        requiredText,
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
        requiredHostedHandoffOperatorProofs: hostedHandoffOperatorProofIds,
        requiredHostedHandoffOperatorProofStatuses:
          hostedHandoffOperatorProofStatuses,
        requiredRelatedLinks,
      });
    },
    buildEvidence: ({ source, adminRoleSurface }) => ({
      version: 1,
      proof: proofName,
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope,
      proofBoundary,
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
        demoProofSyntheticRejectedLaneStatus:
          source.demoProof.syntheticRejectedLane.status,
        demoProofSyntheticExternalTarget:
          source.demoProof.target.syntheticExternalTarget,
        blockedCheckIds: source.lane.blockedCheckIds,
        realHostedEvidenceInputIds: hostedEvidenceHandoffInputIds,
        rawEvidenceTemplate: {
          id: "operator-template",
          path: devTestGameHostedMatrixRawEvidenceTemplatePath,
          proofCommand: `npm run ${devTestGameHostedMatrixRawEvidenceTemplateProofCommand}`,
          proofTarget: devTestGameHostedMatrixRawEvidenceTemplateProofPath,
          copyToEnv: devTestGameHostedMatrixRawEvidenceTemplateEnv,
          validatorCommand: `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
          validatorProofTarget: devTestGameRealHostedMatrixRawCapturePath,
        },
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
        hostedHandoffOperatorProofIds: hostedEvidenceOperatorChecklistProofIds(
          source.lane.hostedHandoffChecklist,
        ),
        hostedHandoffOperatorProofStatuses:
          hostedEvidenceOperatorChecklistProofStatuses(
            source.lane.hostedHandoffChecklist,
          ),
        ...(source.lane.hostedHandoffChecklist?.blockedReceipt === undefined
          ? {}
          : {
              hostedHandoffBlockedReceipt:
                source.lane.hostedHandoffChecklist.blockedReceipt,
            }),
        ...(requiredText.length === 0
          ? {}
          : { requiredText: [...requiredText] }),
        relatedAuditIds: requiredRelatedLinks,
        ...generatedFromExtra,
      },
      adminRoleSurface,
    }),
    assertEvidence,
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
    evidence.generatedFrom?.demoProofSyntheticRejectedLaneStatus !== "blocked" ||
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
  const expectedRawEvidenceTemplate = evidence.generatedFrom?.rawEvidenceTemplate;
  if (expectedRawEvidenceTemplate !== undefined) {
    assertVisibleAdminRoleSurfaceRows({
      adminRoleSurface: evidence.adminRoleSurface,
      rowIds: [expectedRawEvidenceTemplate.id],
      proofName: "hosted evidence lane admin proof",
      rowName: "raw evidence template",
      surfaceKey: "visibleRawEvidenceTemplates",
    });
    const visibleTemplateText =
      evidence.adminRoleSurface?.visibleRawEvidenceTemplateStatuses?.[
        expectedRawEvidenceTemplate.id
      ] ?? "";
    for (const value of [
      expectedRawEvidenceTemplate.path,
      expectedRawEvidenceTemplate.proofCommand,
      expectedRawEvidenceTemplate.proofTarget,
      expectedRawEvidenceTemplate.copyToEnv,
      expectedRawEvidenceTemplate.validatorCommand,
      expectedRawEvidenceTemplate.validatorProofTarget,
    ]) {
      if (!visibleTemplateText.includes(String(value))) {
        throw new Error(
          `hosted evidence lane admin proof missing raw evidence template text: ${value}`,
        );
      }
    }
  }
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
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.hostedHandoffOperatorProofIds,
    proofName: "hosted evidence lane admin proof",
    rowName: "hosted handoff operator proof",
    surfaceKey: "visibleHostedHandoffOperatorProofs",
  });
  assertAdminRoleSurfaceStatusText({
    adminRoleSurface: evidence.adminRoleSurface,
    expectedStatuses:
      evidence.generatedFrom?.hostedHandoffOperatorProofStatuses,
    proofName: "hosted evidence lane admin proof",
    rowName: "hosted handoff operator proof status",
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
    if (
      JSON.stringify(visibleReceipt.firstMissingOperatorArtifact ?? null) !==
      JSON.stringify(
        visibleFirstMissingOperatorArtifact(
          expectedBlockedReceipt.firstMissingOperatorArtifact,
        ),
      )
    ) {
      throw new Error(
        "hosted evidence lane admin proof missing first missing operator artifact",
      );
    }
    if (
      JSON.stringify(visibleReceipt.blockedOperatorPacket ?? null) !==
      JSON.stringify(
        visibleBlockedOperatorPacket(
          expectedBlockedReceipt.blockedOperatorPacket,
        ),
      )
    ) {
      throw new Error(
        "hosted evidence lane admin proof missing blocked operator packet",
      );
    }
  }
  for (const token of evidence.generatedFrom?.requiredText ?? []) {
    if (!evidence.adminRoleSurface?.visibleRequiredText?.includes(token)) {
      throw new Error(
        `hosted evidence lane admin proof missing required text token: ${token}`,
      );
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

function visibleFirstMissingOperatorArtifact(artifact) {
  if (artifact === null || artifact === undefined) {
    return null;
  }
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

function hostedEvidenceOperatorChecklistProofIds(checklist) {
  const descriptor = checklist?.blockedReceipt?.blockedOperatorPacket
    ?.operatorChecklist;
  return descriptor === null || typeof descriptor !== "object"
    ? []
    : ["hosted-evidence-operator-checklist"];
}

function hostedEvidenceOperatorChecklistProofStatuses(checklist) {
  const descriptor = checklist?.blockedReceipt?.blockedOperatorPacket
    ?.operatorChecklist;
  if (descriptor === null || typeof descriptor !== "object") {
    return {};
  }
  return {
    "hosted-evidence-operator-checklist":
      descriptor.checklistProofTarget ??
      devTestGameHostedEvidenceOperatorChecklistProofPath,
  };
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
