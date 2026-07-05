import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameReleaseReadiness } from "./dev_test_game_release_readiness.mjs";
import {
  devTestGameHostSetupAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const readinessPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_RELEASE_READINESS ??
    devTestGameReleaseReadinessPath,
);
const readinessRelativePath = path.relative(repoRoot, readinessPath);
const evidencePath = path.join(repoRoot, devTestGameHostSetupAdminProofPath);
const requiredChecks = ["local-host-setup-proof", "ready-check:start-phase"];
const requiredSetupCommandEvidence = [
  "addSlot",
  "assignSlot",
  "assignRole",
  "setPostPolicy",
  "startGame",
];

export function hostSetupAdminProofCase() {
  return {
    smokeName: "dev-test-game-host-setup-admin-proof",
    stage: "host-setup-admin-proof-listen",
    evidencePath,
    envOverrides: {
      FMARCH_DEV_TEST_GAME_RELEASE_READINESS: readinessRelativePath,
    },
    loadSource: async () =>
      assertDevTestGameReleaseReadiness(await readJson(readinessPath)),
    prove: async ({ browser, frontendBaseUrl, source: readiness }) =>
      await proveAdminAuditDetail({
        browser,
        frontendBaseUrl,
        game: readiness.generatedFrom.game,
        auditId: "local-host-setup-proof",
        requiredChecks: requiredHostSetupChecks(readiness),
        requiredSetupCommandEvidence:
          readiness.localDevelopmentSpine.evidence?.hostSetupProof
            ?.setupCommandEvidence === undefined
            ? []
            : requiredSetupCommandEvidence,
      }),
    buildEvidence: ({ source: readiness, adminRoleSurface }) => ({
      version: 1,
      proof: "dev-test-game-host-setup-admin-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      scope: "local-dev-test-game-host-setup-admin-surface",
      proofBoundary:
        "Local SvelteKit admin role URL with fixture admin authority over the saved dev-test-game host setup proof evidence carried by release readiness. Proves the host setup proof is discoverable from the seeded admin overview and inspectable in a native admin audit detail route with setup command evidence visible; it does not prove hosted deployment, hosted identity, invite delivery, beta readiness, release readiness, or production readiness.",
      generatedFrom: {
        releaseReadinessChecklist: readinessRelativePath,
        hostSetupProof: readiness.generatedFrom.hostSetupProof,
        game: readiness.generatedFrom.game,
        checkIds: requiredHostSetupChecks(readiness),
        setupCommandEvidenceIds: requiredSetupCommandEvidence.filter(
          (id) =>
            readiness.localDevelopmentSpine.evidence?.hostSetupProof
              ?.setupCommandEvidence?.[id] !== undefined,
        ),
      },
      adminRoleSurface,
    }),
    assertEvidence: assertHostSetupAdminProof,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  await runAdminAuditProof(hostSetupAdminProofCase());
}

export function assertHostSetupAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-host-setup-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-host-setup-admin-surface"
  ) {
    throw new Error("host setup admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("host setup admin proof did not prove admin overview click-through");
  }
  for (const checkId of evidence.generatedFrom?.checkIds ?? requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`host setup admin proof missing visible check: ${checkId}`);
    }
  }
  for (const commandId of
    evidence.generatedFrom?.setupCommandEvidenceIds ?? requiredSetupCommandEvidence) {
    if (!evidence.adminRoleSurface?.visibleSetupCommandEvidence?.includes(commandId)) {
      throw new Error(
        `host setup admin proof missing visible setup command evidence: ${commandId}`,
      );
    }
  }
  return evidence;
}

function requiredHostSetupChecks(readiness) {
  const readyCheckIds =
    readiness.localDevelopmentSpine.evidence?.hostSetupProof?.readyCheckIds ?? [];
  return [
    "local-host-setup-proof",
    ...readyCheckIds.map((readyCheckId) => `ready-check:${readyCheckId}`),
  ];
}
