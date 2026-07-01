import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { assertDevTestGameHostedEvidenceLane } from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  hostedEvidenceHandoffInputIds,
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
const laneRelativePath = path.relative(repoRoot, lanePath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
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
  },
  loadSource: async () => ({
    lane: assertDevTestGameHostedEvidenceLane(await readJson(lanePath)),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) => {
    const hostedHandoffInputValues = realHostedEvidenceInputValues(
      source.lane.hostedEvidence?.realHostedEvidenceInputs,
    );
    const hostedHandoffBlockedCheckStatuses =
      hostedHandoffBlockedCheckRequiredEvidence(
        source.lane.checks,
        source.lane.blockedCheckIds,
      );
    const hostedHandoffSummary = {
      status: source.lane.status,
      preflightStatus: source.lane.preflightStatus,
      command:
        source.lane.hostedEvidence?.realHostedEvidenceInputs?.command ??
        source.lane.nextCommand,
      proofTarget:
        source.lane.hostedEvidence?.realHostedEvidenceInputs?.proofTarget ??
        source.lane.nextProofTarget,
    };
    return await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: "local-hosted-evidence-lane",
      requiredChecks: source.lane.checks.map((check) => check.id),
      requiredCheckStatuses: Object.fromEntries(
        source.lane.checks.map((check) => [check.id, check.status]),
      ),
      requiredUnproven: source.lane.blockedCheckIds,
      requiredRealHostedEvidenceInputs: hostedEvidenceHandoffInputIds,
      requiredHostedHandoffInputs: hostedEvidenceHandoffInputIds,
      requiredHostedHandoffInputValues: hostedHandoffInputValues,
      requiredHostedHandoffBlockedChecks: source.lane.blockedCheckIds,
      requiredHostedHandoffBlockedCheckStatuses:
        hostedHandoffBlockedCheckStatuses,
      requiredHostedHandoffSummary: hostedHandoffSummary,
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
      "Local SvelteKit admin role URL with fixture admin authority over the hosted evidence lane. Proves the lane is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with blocked preflight rows visible; it does not prove hosted deployment, hosted telemetry, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      hostedEvidenceLane: laneRelativePath,
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      status: source.lane.status,
      preflightStatus: source.lane.preflightStatus,
      checkIds: source.lane.checks.map((check) => check.id),
      checkStatuses: Object.fromEntries(
        source.lane.checks.map((check) => [check.id, check.status]),
      ),
      blockedCheckIds: source.lane.blockedCheckIds,
      realHostedEvidenceInputIds: hostedEvidenceHandoffInputIds,
      hostedHandoffInputIds: hostedEvidenceHandoffInputIds,
      hostedHandoffInputValues: realHostedEvidenceInputValues(
        source.lane.hostedEvidence?.realHostedEvidenceInputs,
      ),
      hostedHandoffBlockedCheckIds: source.lane.blockedCheckIds,
      hostedHandoffBlockedCheckRequiredEvidence:
        hostedHandoffBlockedCheckRequiredEvidence(
          source.lane.checks,
          source.lane.blockedCheckIds,
        ),
      hostedHandoffSummary: {
        status: source.lane.status,
        preflightStatus: source.lane.preflightStatus,
        command:
          source.lane.hostedEvidence?.realHostedEvidenceInputs?.command ??
          source.lane.nextCommand,
        proofTarget:
          source.lane.hostedEvidence?.realHostedEvidenceInputs?.proofTarget ??
          source.lane.nextProofTarget,
      },
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
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted evidence lane admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}

function realHostedEvidenceInputValues(inputs) {
  const env = Array.isArray(inputs?.env) ? inputs.env : [];
  return Object.fromEntries(
    [
      ["command", String(inputs?.command ?? "")],
      ["proof-target", String(inputs?.proofTarget ?? "")],
      ...env.map((item) => [
        String(item?.name ?? ""),
        String(item?.description ?? ""),
      ]),
    ].filter(([id, value]) => id !== "" && value !== ""),
  );
}

function hostedHandoffBlockedCheckRequiredEvidence(checks, blockedCheckIds = []) {
  const blockedCheckIdSet = new Set(blockedCheckIds.map((id) => String(id)));
  return Object.fromEntries(
    (Array.isArray(checks) ? checks : [])
      .filter(
        (check) =>
          blockedCheckIdSet.has(String(check.id)) &&
          check?.status === "blocked" &&
          typeof check.requiredEvidence === "string" &&
          check.requiredEvidence.trim() !== "",
      )
      .map((check) => [String(check.id), check.requiredEvidence]),
  );
}
