import path from "node:path";
import { assertDevTestGameHostedOpsSignals } from "./dev_test_game_hosted_ops_signals.mjs";
import {
  hostedOpsSignalCheckIds,
  hostedOpsSignalRelatedAuditIds,
  hostedOpsTelemetryBoundaryCheckId,
  hostedOpsTelemetryBoundaryStatus,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const hostedOpsSignalsPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS ??
    "target/dev-test-game/hosted-ops-signals.json",
);
const hostedOpsSignalsRelativePath = path.relative(repoRoot, hostedOpsSignalsPath);
const evidencePath = path.join(artifactDir, "hosted-ops-signals-admin-proof.json");
const requiredChecks = hostedOpsSignalCheckIds;
const requiredRelatedLinks = hostedOpsSignalRelatedAuditIds;

await runAdminAuditProof({
  smokeName: "dev-test-game-hosted-ops-signals-admin-proof",
  stage: "hosted-ops-signals-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS: hostedOpsSignalsRelativePath,
  },
  loadSource: async () =>
    assertDevTestGameHostedOpsSignals(await readJson(hostedOpsSignalsPath)),
  prove: async ({ browser, frontendBaseUrl, source: hostedOpsSignals }) =>
    await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: hostedOpsSignals.target.game,
      auditId: "local-hosted-ops-signals",
      requiredChecks,
      requiredCheckStatuses: {
        [hostedOpsTelemetryBoundaryCheckId]: hostedOpsTelemetryBoundaryStatus(
          hostedOpsSignals.target.realHostedDeploymentStatus,
        ),
      },
      requiredRelatedLinks,
    }),
  buildEvidence: ({ source: hostedOpsSignals, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-hosted-ops-signals-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-ops-signals-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over a saved hosted-like ops signal bundle. Proves the local signal artifact is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with the hosted telemetry boundary visible; it does not prove hosted telemetry, paging/SLOs, production incident response, release readiness, or production readiness.",
    generatedFrom: {
      hostedOpsSignals: hostedOpsSignalsRelativePath,
      game: hostedOpsSignals.target.game,
      checkIds: requiredChecks,
      relatedAuditIds: requiredRelatedLinks,
      realHostedDeploymentStatus: hostedOpsSignals.target.realHostedDeploymentStatus,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertHostedOpsSignalsAdminProof,
});

export function assertHostedOpsSignalsAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-hosted-ops-signals-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-hosted-ops-signals-admin-surface"
  ) {
    throw new Error("hosted ops signals admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("hosted ops signals admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`hosted ops signals admin proof missing visible check: ${checkId}`);
    }
  }
  for (const linkId of requiredRelatedLinks) {
    if (!evidence.adminRoleSurface?.visibleRelatedLinks?.includes(linkId)) {
      throw new Error(`hosted ops signals admin proof missing related link: ${linkId}`);
    }
  }
  return evidence;
}
