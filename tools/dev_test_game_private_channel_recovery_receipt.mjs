import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  coreLoopHighlightedLaneEvidence,
} from "../frontend/src/lib/app/local-proof-lane-status.mjs";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertCoreLoopPrivateChannelRecoveryCoverageSummary,
  coreLoopPrivateChannelRecoveryFamilyId,
  coreLoopPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_PRIVATE_CHANNEL_RECOVERY_RECEIPT_VERSION = 1;
export const devTestGamePrivateChannelRecoveryReceiptPath =
  "target/dev-test-game/private-channel-recovery-receipt.json";
export const devTestGamePrivateChannelRecoveryReceiptCommand =
  "test:dev-test-game-private-channel-recovery-receipt";
export const devTestGamePrivateChannelRecoveryReceiptRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.coreLoop);

const receiptJsonPath = path.join(
  repoRoot,
  devTestGamePrivateChannelRecoveryReceiptPath,
);
const defaultProofRunPath = "target/dev-test-game/proof-run.json";

export function buildDevTestGamePrivateChannelRecoveryReceipt(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    proofRunSource = defaultProofRunPath,
    coreLoopAdminProofSource = "target/dev-test-game/core-loop-admin-proof.json",
  } = {},
) {
  const proof = assertDevTestGameProofRun(proofRun);
  const coverage = assertCoreLoopPrivateChannelRecoveryCoverageSummary({
    summary: proof.coreLoopPrivateChannelRecoveryCoverage,
    lanes: proof.lanes,
  });
  const lanesById = new Map((proof.lanes ?? []).map((lane) => [lane.id, lane]));
  const highlightedLaneEvidence = coreLoopHighlightedLaneEvidence(proof);
  const lanes = coreLoopPrivateChannelRecoveryLaneIds.map((laneId) => {
    const lane = lanesById.get(laneId);
    if (lane === undefined) {
      throw new Error(`private-channel recovery receipt missing lane: ${laneId}`);
    }
    if (lane.status !== "passed") {
      throw new Error(
        `private-channel recovery receipt lane ${laneId} is ${lane.status}`,
      );
    }
    return {
      id: lane.id,
      label: lane.label,
      status: lane.status,
      compactStatus: String(highlightedLaneEvidence[lane.id] ?? ""),
      evidence: lane.evidence ?? {},
    };
  });
  const receipt = {
    version: DEV_TEST_GAME_PRIVATE_CHANNEL_RECOVERY_RECEIPT_VERSION,
    proof: "dev-test-game-private-channel-recovery-receipt",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-private-channel-recovery",
    proofBoundary:
      "Derived local receipt for the core-loop private-channel recovery family. It records passed seeded proof-run lanes for private-channel post, stale post recovery, completed-game reload recovery, and invalid-action recovery plus the existing core-loop admin role URL; it does not prove hosted identity, hosted transport, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunSource,
      coreLoopAdminProof: coreLoopAdminProofSource,
      game: proof.session?.game,
      family: {
        id: coreLoopPrivateChannelRecoveryFamilyId,
        laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
      },
      roleUrl: devTestGamePrivateChannelRecoveryReceiptRoleUrl,
    },
    summary: {
      status: coverage.status,
      laneCount: coverage.laneCount,
      passedLaneCount: coverage.passedLaneCount,
      familyCount: coverage.familyCount,
      expectedLaneCount: coverage.expectedLaneCount,
      expectedFamilyCount: coverage.expectedFamilyCount,
    },
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    lanes,
  };
  assertDevTestGamePrivateChannelRecoveryReceipt(receipt);
  return receipt;
}

export function assertDevTestGamePrivateChannelRecoveryReceipt(receipt) {
  if (
    receipt?.version !==
    DEV_TEST_GAME_PRIVATE_CHANNEL_RECOVERY_RECEIPT_VERSION
  ) {
    throw new Error(
      `private-channel recovery receipt version drifted: ${receipt?.version}`,
    );
  }
  if (receipt.proof !== "dev-test-game-private-channel-recovery-receipt") {
    throw new Error(`unexpected private-channel receipt id: ${receipt.proof}`);
  }
  if (receipt.status !== "passed") {
    throw new Error(`private-channel receipt status is ${receipt.status}`);
  }
  if (receipt.scope !== "local-dev-test-game-private-channel-recovery") {
    throw new Error(`private-channel receipt scope drifted: ${receipt.scope}`);
  }
  if (receipt.releaseReady !== false || receipt.productionReady !== false) {
    throw new Error("private-channel receipt must not claim release readiness");
  }
  if (
    receipt.generatedFrom?.family?.id !== coreLoopPrivateChannelRecoveryFamilyId ||
    !sameStringArray(
      receipt.generatedFrom?.family?.laneIds,
      coreLoopPrivateChannelRecoveryLaneIds,
    )
  ) {
    throw new Error("private-channel receipt family drifted");
  }
  if (
    receipt.generatedFrom?.roleUrl !==
    devTestGamePrivateChannelRecoveryReceiptRoleUrl
  ) {
    throw new Error("private-channel receipt role URL drifted");
  }
  if (
    receipt.summary?.status !== "passed" ||
    receipt.summary?.laneCount !== coreLoopPrivateChannelRecoveryLaneIds.length ||
    receipt.summary?.passedLaneCount !==
      coreLoopPrivateChannelRecoveryLaneIds.length ||
    receipt.summary?.familyCount !== coreLoopPrivateChannelRecoveryLaneIds.length
  ) {
    throw new Error("private-channel receipt coverage summary drifted");
  }
  if (!sameStringArray(receipt.laneIds, coreLoopPrivateChannelRecoveryLaneIds)) {
    throw new Error("private-channel receipt lane list drifted");
  }
  const lanes = receipt.lanes ?? [];
  if (lanes.length !== coreLoopPrivateChannelRecoveryLaneIds.length) {
    throw new Error("private-channel receipt lane count drifted");
  }
  for (const laneId of coreLoopPrivateChannelRecoveryLaneIds) {
    const lane = lanes.find((candidate) => candidate.id === laneId);
    if (
      lane === undefined ||
      lane.status !== "passed" ||
      typeof lane.compactStatus !== "string" ||
      lane.compactStatus.trim() === "" ||
      lane.evidence === null ||
      typeof lane.evidence !== "object"
    ) {
      throw new Error(`private-channel receipt lane drifted: ${laneId}`);
    }
  }
  return receipt;
}

export async function writeDevTestGamePrivateChannelRecoveryReceipt({
  generatedAt = new Date().toISOString(),
  proofRunPath = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? defaultProofRunPath,
  coreLoopAdminProofPath =
    process.env.FMARCH_DEV_TEST_GAME_CORE_LOOP_ADMIN_PROOF ??
    "target/dev-test-game/core-loop-admin-proof.json",
} = {}) {
  const absoluteProofRunPath = path.resolve(repoRoot, proofRunPath);
  const proofRun = JSON.parse(await readFile(absoluteProofRunPath, "utf8"));
  const receipt = buildDevTestGamePrivateChannelRecoveryReceipt(proofRun, {
    generatedAt,
    proofRunSource: path.relative(repoRoot, absoluteProofRunPath),
    coreLoopAdminProofSource: path.relative(
      repoRoot,
      path.resolve(repoRoot, coreLoopAdminProofPath),
    ),
  });
  await mkdir(path.dirname(receiptJsonPath), { recursive: true });
  await writeFile(receiptJsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function sameStringArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const receipt = await writeDevTestGamePrivateChannelRecoveryReceipt();
  console.log(
    `wrote ${devTestGamePrivateChannelRecoveryReceiptPath} (${receipt.status})`,
  );
}
