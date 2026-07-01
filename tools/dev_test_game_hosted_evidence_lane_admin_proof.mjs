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
  prove: async ({ browser, frontendBaseUrl, source }) =>
    await proveAdminAuditDetail({
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
      requiredHostedHandoffBlockedChecks: source.lane.blockedCheckIds,
      requiredRelatedLinks,
    }),
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
      hostedHandoffBlockedCheckIds: source.lane.blockedCheckIds,
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
  for (const linkId of evidence.generatedFrom?.relatedAuditIds ?? []) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted evidence lane admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}
