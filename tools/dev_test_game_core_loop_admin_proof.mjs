import path from "node:path";
import {
  coreLoopHighlightedLaneEvidence,
  coreLoopSpineStatus,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import {
  artifactDir,
  proveAdminAuditDetail,
  readJson,
  repoRoot,
  runAdminAuditProof,
} from "./dev_test_game_admin_audit_proof_helper.mjs";

const proofRunPath = path.resolve(
  repoRoot,
  process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    "target/dev-test-game/proof-run.json",
);
const proofRunRelativePath = path.relative(repoRoot, proofRunPath);
const evidencePath = path.join(artifactDir, "core-loop-admin-proof.json");
const requiredChecks = [
  "core-loop-spine",
  "core-loop",
  "day-vote-resolution",
  "day-vote-no-lynch",
  "action-loop",
  "host-deadline-advance",
  "stale-deadline-advance",
  "invalid-action-recovery",
  "resolution-receipts",
  "dead-player-recovery",
  "player-action-boundary",
  "private-channel",
  "host-votecount-publication",
  "host-lifecycle-control",
  "host-modkill-control",
  "replacement-host-issued-invite",
  "replacement-pending-player",
  "replacement-invalid-target-recovery",
  "replacement-console",
  "stale-host-invite-recovery",
  "replacement-stale-success-recovery",
  "replacement-stale-player",
  "replacement-stale-action",
  "replacement-stale-private-channel",
  "replacement-stale-private-receipts",
  "replacement-incoming-player",
];

const requiredSpineRows = (proofRun) => {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  return {
    cycles: cycles.map((cycle) => String(cycle.id)),
    roleUrls: cycles.flatMap((cycle) =>
      Object.keys(cycle.roleUrls ?? {}).map(
        (roleId) => `${String(cycle.id)}-${String(roleId)}`,
      ),
    ),
    checkpoints: cycles.flatMap((cycle) =>
      (cycle.checkpoints ?? []).map(
        (checkpoint) => `${String(cycle.id)}-${String(checkpoint.id)}`,
      ),
    ),
    recoveryHooks: Object.keys(proofRun?.coreLoopSpine?.recoveryHooks ?? {}),
  };
};

await runAdminAuditProof({
  smokeName: "dev-test-game-core-loop-admin-proof",
  stage: "core-loop-admin-proof-listen",
  evidencePath,
  envOverrides: {
    FMARCH_DEV_TEST_GAME_PROOF_RUN: proofRunRelativePath,
  },
  loadSource: async () => assertDevTestGameProofRun(await readJson(proofRunPath)),
  prove: async ({ browser, frontendBaseUrl, source: proofRun }) => {
    const spineRows = requiredSpineRows(proofRun);
    return await proveAdminAuditDetail({
      browser,
      frontendBaseUrl,
      game: proofRun.session.game,
      auditId: "local-core-loop",
      requiredChecks,
      requiredCheckStatuses: {
        "core-loop-spine": coreLoopSpineStatus(proofRun),
        ...coreLoopHighlightedLaneEvidence(proofRun),
      },
      requiredSpineCycles: spineRows.cycles,
      requiredSpineRoleUrls: spineRows.roleUrls,
      requiredSpineCheckpoints: spineRows.checkpoints,
      requiredSpineRecoveryHooks: spineRows.recoveryHooks,
    });
  },
  buildEvidence: ({ source: proofRun, adminRoleSurface }) => ({
    version: 1,
    proof: "dev-test-game-core-loop-admin-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-core-loop-admin-surface",
    proofBoundary:
      "Local SvelteKit admin role URL with fixture admin authority over the dev-test-game core-loop proof-run lanes. Proves the saved host-control, lynch and no-lynch day-vote resolution, player-action, day/night, official-votecount publication, private-channel, replacement, stale outgoing-player recovery, and incoming replacement-player evidence is discoverable from the seeded admin overview and inspectable in a native admin audit detail route; it does not prove hosted deployment, production identity, exhaustive action/race coverage, beta readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunRelativePath,
      game: proofRun.session.game,
      coreLoopSpineStatus: coreLoopSpineStatus(proofRun),
      coreLoopSpineRows: requiredSpineRows(proofRun),
      highlightedLaneEvidence: coreLoopHighlightedLaneEvidence(proofRun),
    },
    adminRoleSurface,
  }),
  assertEvidence: assertCoreLoopAdminProof,
});

export function assertCoreLoopAdminProof(evidence) {
  if (
    evidence?.version !== 1 ||
    evidence.proof !== "dev-test-game-core-loop-admin-proof" ||
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.scope !== "local-dev-test-game-core-loop-admin-surface"
  ) {
    throw new Error("core-loop admin proof must pass locally without release claims");
  }
  if (
    evidence.adminRoleSurface?.clickedThroughFromOverview !== true ||
    evidence.adminRoleSurface?.rawInviteTokensVisible !== false
  ) {
    throw new Error("core-loop admin proof did not prove admin overview click-through");
  }
  for (const checkId of requiredChecks) {
    if (!evidence.adminRoleSurface?.visibleChecks?.includes(checkId)) {
      throw new Error(`core-loop admin proof missing visible check: ${checkId}`);
    }
  }
  if (
    !evidence.adminRoleSurface?.visibleCheckStatuses?.["core-loop-spine"]?.includes(
      evidence.generatedFrom?.coreLoopSpineStatus,
    )
  ) {
    throw new Error("core-loop admin proof missing visible core-loop spine status");
  }
  assertVisibleRows(
    "core-loop admin proof missing visible spine cycle",
    evidence.adminRoleSurface?.visibleSpineCycles,
    evidence.generatedFrom?.coreLoopSpineRows?.cycles,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine role URL",
    evidence.adminRoleSurface?.visibleSpineRoleUrls,
    evidence.generatedFrom?.coreLoopSpineRows?.roleUrls,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine checkpoint",
    evidence.adminRoleSurface?.visibleSpineCheckpoints,
    evidence.generatedFrom?.coreLoopSpineRows?.checkpoints,
  );
  assertVisibleRows(
    "core-loop admin proof missing visible spine recovery hook",
    evidence.adminRoleSurface?.visibleSpineRecoveryHooks,
    evidence.generatedFrom?.coreLoopSpineRows?.recoveryHooks,
  );
  for (const [checkId, expectedStatus] of Object.entries(
    evidence.generatedFrom?.highlightedLaneEvidence ?? {},
  )) {
    if (
      expectedStatus !== "" &&
      !evidence.adminRoleSurface?.visibleCheckStatuses?.[checkId]?.includes(
        expectedStatus,
      )
    ) {
      throw new Error(
        `core-loop admin proof missing visible status for ${checkId}: ${expectedStatus}`,
      );
    }
  }
  return evidence;
}

function assertVisibleRows(message, visibleRows, requiredRows) {
  const visible = Array.isArray(visibleRows) ? visibleRows : [];
  for (const rowId of requiredRows ?? []) {
    if (!visible.includes(rowId)) {
      throw new Error(`${message}: ${rowId}`);
    }
  }
}
