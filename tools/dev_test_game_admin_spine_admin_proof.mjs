import path from "node:path";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  validateDevTestGameAdminSpineProof,
  validateDevTestGameAdminSpineTerminalBatches,
} from "./dev_test_game_release_readiness.mjs";
import {
  assertVisibleAdminRoleSurfaceRows,
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  adminSpineProofPath as defaultAdminSpineProofPath,
  adminSpineTerminalBatchProofPath,
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

const adminSpineProofPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF ??
    defaultAdminSpineProofPath,
);
const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? devTestGameProofRunPath,
);
const adminSpineTerminalBatchesPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES ??
    adminSpineTerminalBatchProofPath,
);
const adminSpineProofRelativePath = path.relative(repoRoot, adminSpineProofPath);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const adminSpineTerminalBatchesRelativePath = path.relative(
  repoRoot,
  adminSpineTerminalBatchesPath,
);
const evidencePath = path.join(artifactDir, "admin-spine-admin-proof.json");
const requiredChecks = [
  "core-loop",
  "hardening",
  "identity",
  "backup",
  "ops",
  "seed",
  "host-setup",
  "release",
  "release-runbook",
  "race-coverage",
  "hosted-target-preflight",
  "hosted-concurrent-race-matrix",
  "hosted-ops-signals",
  "spine-manifest",
  "recovery",
  localAdminAuditHandoffCheckIds.spineManifest,
];
const requiredRelatedLinks = [localAdminAuditIds.spineManifest];
const requiredAdminSpineBatches = [
  "aggregate-pre-release-admin-proof-batch",
  "aggregate-release-and-hosted-admin-proof-batch",
];

await runAdminAuditProof({
  smokeName: "dev-test-game-admin-spine-admin-proof",
  stage: "admin-spine-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_PROOF: adminSpineProofRelativePath,
    FMARCH_DEV_TEST_GAME_ADMIN_SPINE_TERMINAL_BATCHES:
      adminSpineTerminalBatchesRelativePath,
  },
  loadSource: async () => ({
    adminSpineProof: await readAdminSpineProof(),
    adminSpineTerminalBatches: await readAdminSpineTerminalBatches(),
    proofRun: assertDevTestGameProofRun(await readJson(proofRunPath)),
  }),
  prove: async ({ browser, frontendBaseUrl, source }) => {
    const requiredBatchIds = [
      ...requiredAdminSpineBatches,
      ...adminSpineTerminalBatchIds(source.adminSpineTerminalBatches),
    ];
    return await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: source.proofRun.session.game,
      auditId: localAdminAuditIds.adminSpine,
      requiredChecks,
      requiredRelatedLinks,
      requiredAdminSpineBatches: requiredBatchIds,
      requiredAdminSpineBatchStatuses: Object.fromEntries(
        requiredBatchIds.map((id) => [id, "passed"]),
      ),
    });
  },
  buildEvidence: ({ source, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-admin-spine-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the aggregate dev-test-game admin-spine proof. Proves the ordered aggregate admin proof artifact and recovery command summary are discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted identity, hosted operations, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      adminSpineProof: adminSpineProofRelativePath,
      ...(source.adminSpineTerminalBatches === null
        ? {}
        : {
            adminSpineTerminalBatches: adminSpineTerminalBatchesRelativePath,
          }),
      proofRun: proofRunRelativePath,
      game: source.proofRun.session.game,
      proofIds: source.adminSpineProof.proofIds,
      batchIds: [
        ...requiredAdminSpineBatches,
        ...adminSpineTerminalBatchIds(source.adminSpineTerminalBatches),
      ],
      batchLabels: [
        ...source.adminSpineProof.batches.map((batch) => batch.label),
        ...(source.adminSpineTerminalBatches?.batches ?? []).map(
          (batch) => batch.label,
        ),
      ],
      batchCaseCounts: [
        ...source.adminSpineProof.batches,
        ...(source.adminSpineTerminalBatches?.batches ?? []),
      ].map((batch) => ({
        label: batch.label,
        caseCount: batch.caseCount,
      })),
      relatedAuditIds: requiredRelatedLinks,
    },
    adminRoleSurface,
  }),
  assertEvidence: assertAdminSpineAdminProof,
});

async function readAdminSpineProof() {
  return validateDevTestGameAdminSpineProof(await readJson(adminSpineProofPath), {
    path: adminSpineProofRelativePath,
  });
}

async function readAdminSpineTerminalBatches() {
  let payload;
  try {
    payload = await readJson(adminSpineTerminalBatchesPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return validateDevTestGameAdminSpineTerminalBatches(payload, {
    path: adminSpineTerminalBatchesRelativePath,
  });
}

function adminSpineTerminalBatchIds(terminalBatches) {
  return terminalBatches?.batchIds ?? [];
}

export function assertAdminSpineAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-admin-spine-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-admin-spine-admin-surface"
  ) {
    throw new Error("admin spine admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("admin spine admin proof did not prove admin overview click-through");
  }
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: requiredChecks,
    proofName: "admin spine admin proof",
    rowName: "visible check",
  });
  assertVisibleAdminRoleSurfaceRows({
    adminRoleSurface: evidence.adminRoleSurface,
    rowIds: evidence.generatedFrom?.relatedAuditIds,
    proofName: "admin spine admin proof",
    rowName: "related link",
    surfaceKey: "visibleRelatedLinks",
  });
  for (const batchId of evidence.generatedFrom?.batchIds ?? []) {
    assertVisibleAdminRoleSurfaceRows({
      adminRoleSurface: evidence.adminRoleSurface,
      rowIds: [batchId],
      proofName: "admin spine admin proof",
      rowName: "batch row",
      surfaceKey: "visibleAdminSpineBatches",
    });
    const visibleText =
      evidence.adminRoleSurface?.visibleAdminSpineBatchStatuses?.[batchId] ?? "";
    if (!visibleText.includes("passed") || !visibleText.includes("shared frontend")) {
      throw new Error(`admin spine admin proof missing batch status: ${batchId}`);
    }
  }
  return evidence;
}
