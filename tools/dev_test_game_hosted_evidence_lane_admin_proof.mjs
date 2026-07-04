import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameHostedEvidenceLane } from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  assertDevTestGameHostedEvidenceLaneDemoProof,
  devTestGameHostedEvidenceLaneDemoProofPath,
} from "./dev_test_game_hosted_evidence_lane_demo_proof.mjs";
import {
  hostedEvidenceHandoffBlockedCheckRequiredEvidence,
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputSectionStatuses,
  hostedEvidenceHandoffInputValues,
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

const lanePath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE ??
    "target/dev-test-game/hosted-evidence-lane.json",
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const demoProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_EVIDENCE_LANE_DEMO_PROOF ??
    devTestGameHostedEvidenceLaneDemoProofPath,
);
const laneRelativePath = path.relative(repoRoot, lanePath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const demoProofRelativePath = path.relative(repoRoot, demoProofPath);
const evidencePath = path.join(artifactDir, "hosted-evidence-lane-admin-proof.json");
const requiredRelatedLinks = [
  "local-hosted-target-preflight",
  "local-hosted-concurrent-race-matrix",
  "local-next-action",
];

await runAdminAuditProof({
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
});

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
  for (const checkId of evidence.generatedFrom?.checkIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hosted evidence lane admin proof missing visible check: ${checkId}`);
    }
  }
  for (const checkId of evidence.generatedFrom?.demoProofCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(
        `hosted evidence lane admin proof missing visible demo proof check: ${checkId}`,
      );
    }
  }
  if (
    evidence.generatedFrom?.demoProofStatus !== "passed" ||
    evidence.generatedFrom?.demoProofBlockedLaneStatus !== "blocked" ||
    evidence.generatedFrom?.demoProofPassedLaneStatus !== "passed" ||
    evidence.generatedFrom?.demoProofSyntheticExternalTarget !== true
  ) {
    throw new Error("hosted evidence lane admin proof demo boundary drifted");
  }
  for (const checkId of evidence.generatedFrom?.blockedCheckIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleUnproven?.includes(checkId)) {
      throw new Error(`hosted evidence lane admin proof missing blocked row: ${checkId}`);
    }
  }
  for (const inputId of evidence.generatedFrom?.realHostedEvidenceInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleRealHostedEvidenceInputs?.includes(
        inputId,
      )
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing real hosted input: ${inputId}`,
      );
    }
  }
  for (const inputId of evidence.generatedFrom?.hostedHandoffInputIds ?? []) {
    if (
      !evidence.adminRoleSurface?.visibleHostedHandoffInputs?.includes(inputId)
    ) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff input: ${inputId}`,
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
        `hosted evidence lane admin proof missing handoff blocked check: ${checkId}`,
      );
    }
  }
  for (const [inputId, expectedValue] of Object.entries(
    evidence.generatedFrom?.hostedHandoffInputValues ?? {},
  )) {
    const visibleValue =
      evidence.adminRoleSurface?.visibleHostedHandoffInputValues?.[inputId];
    if (typeof visibleValue !== "string" || !visibleValue.includes(expectedValue)) {
      throw new Error(
        `hosted evidence lane admin proof missing handoff input value: ${inputId}`,
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
        `hosted evidence lane admin proof missing blocked check evidence: ${checkId}`,
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
        `hosted evidence lane admin proof missing handoff input section: ${sectionId}`,
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
        `hosted evidence lane admin proof missing handoff input section status: ${sectionId}`,
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
        `hosted evidence lane admin proof missing handoff section input: ${rowId}`,
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
        `hosted evidence lane admin proof missing handoff section input status: ${rowId}`,
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
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted evidence lane admin proof missing related link: ${linkId}`);
    }
  }
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
