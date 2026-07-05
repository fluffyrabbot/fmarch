import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertReplacementHandoffRecoveryCoverageSummary,
  replacementHandoffRecoveryCoverageFamilies,
  replacementHandoffRecoveryLaneIds,
} from "./dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_REPLACEMENT_HANDOFF_RECOVERY_RECEIPT_VERSION = 1;
export const devTestGameReplacementHandoffRecoveryReceiptPath =
  "target/dev-test-game/replacement-handoff-recovery-receipt.json";
export const devTestGameReplacementHandoffRecoveryReceiptCommand =
  "test:dev-test-game-replacement-handoff-recovery-receipt";
export const devTestGameReplacementHandoffRecoveryReceiptRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.hardening);

const receiptJsonPath = path.join(
  repoRoot,
  devTestGameReplacementHandoffRecoveryReceiptPath,
);
const defaultProofRunPath = devTestGameProofRunPath;

export function buildDevTestGameReplacementHandoffRecoveryReceipt(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    proofRunSource = defaultProofRunPath,
    hardeningAdminProofSource = devTestGameHardeningAdminProofPath,
  } = {},
) {
  const proof = assertDevTestGameProofRun(proofRun);
  const coverage = assertReplacementHandoffRecoveryCoverageSummary({
    summary: proof.replacementHandoffRecoveryCoverage,
    lanes: proof.lanes,
  });
  const lanesById = new Map((proof.lanes ?? []).map((lane) => [lane.id, lane]));
  const lanes = replacementHandoffRecoveryLaneIds.map((laneId) => {
    const lane = lanesById.get(laneId);
    if (lane === undefined) {
      throw new Error(`replacement handoff receipt missing lane: ${laneId}`);
    }
    if (lane.status !== "passed") {
      throw new Error(`replacement handoff receipt lane ${laneId} is ${lane.status}`);
    }
    return {
      id: lane.id,
      label: lane.label,
      status: lane.status,
      compactStatus: replacementHandoffLaneCompactStatus(lane),
      evidence: lane.evidence ?? {},
    };
  });
  const receipt = {
    version: DEV_TEST_GAME_REPLACEMENT_HANDOFF_RECOVERY_RECEIPT_VERSION,
    proof: "dev-test-game-replacement-handoff-recovery-receipt",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-replacement-handoff-recovery",
    proofBoundary:
      "Derived local receipt for replacement handoff recovery. It records passed seeded proof-run lanes for replacement invite issuance, pending replacement player state, session recovery, stale host invite rejection, invalid target recovery, replacement console state, idempotent retry, stale outgoing authority rejection, stale replacement private-channel receipts, and incoming replacement player recovery plus the existing hardening admin role URL; it does not prove hosted identity, hosted transport, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunSource,
      hardeningAdminProof: hardeningAdminProofSource,
      game: proof.session?.game,
      family: {
        id: "replacement-handoff-recovery",
        laneIds: [...replacementHandoffRecoveryLaneIds],
      },
      roleUrl: devTestGameReplacementHandoffRecoveryReceiptRoleUrl,
    },
    summary: {
      status: coverage.status,
      laneCount: coverage.laneCount,
      passedLaneCount: coverage.passedLaneCount,
      familyCount: coverage.familyCount,
      expectedLaneCount: coverage.expectedLaneCount,
      expectedFamilyCount: coverage.expectedFamilyCount,
    },
    laneIds: [...replacementHandoffRecoveryLaneIds],
    lanes,
  };
  assertDevTestGameReplacementHandoffRecoveryReceipt(receipt);
  return receipt;
}

export function assertDevTestGameReplacementHandoffRecoveryReceipt(receipt) {
  if (
    receipt?.version !==
    DEV_TEST_GAME_REPLACEMENT_HANDOFF_RECOVERY_RECEIPT_VERSION
  ) {
    throw new Error(
      `replacement handoff receipt version drifted: ${receipt?.version}`,
    );
  }
  if (receipt.proof !== "dev-test-game-replacement-handoff-recovery-receipt") {
    throw new Error(
      `unexpected replacement handoff receipt id: ${receipt.proof}`,
    );
  }
  if (receipt.status !== "passed") {
    throw new Error(`replacement handoff receipt status is ${receipt.status}`);
  }
  if (receipt.scope !== "local-dev-test-game-replacement-handoff-recovery") {
    throw new Error(`replacement handoff receipt scope drifted: ${receipt.scope}`);
  }
  if (receipt.releaseReady !== false || receipt.productionReady !== false) {
    throw new Error("replacement handoff receipt must not claim release readiness");
  }
  if (
    receipt.generatedFrom?.family?.id !== "replacement-handoff-recovery" ||
    !sameStringArray(
      receipt.generatedFrom?.family?.laneIds,
      replacementHandoffRecoveryLaneIds,
    )
  ) {
    throw new Error("replacement handoff receipt family drifted");
  }
  if (
    receipt.generatedFrom?.roleUrl !==
    devTestGameReplacementHandoffRecoveryReceiptRoleUrl
  ) {
    throw new Error("replacement handoff receipt role URL drifted");
  }
  const expectedFamilyCount = replacementHandoffRecoveryCoverageFamilies().length;
  if (
    receipt.summary?.status !== "passed" ||
    receipt.summary?.laneCount !== replacementHandoffRecoveryLaneIds.length ||
    receipt.summary?.passedLaneCount !== replacementHandoffRecoveryLaneIds.length ||
    receipt.summary?.familyCount !== expectedFamilyCount
  ) {
    throw new Error("replacement handoff receipt coverage summary drifted");
  }
  if (!sameStringArray(receipt.laneIds, replacementHandoffRecoveryLaneIds)) {
    throw new Error("replacement handoff receipt lane list drifted");
  }
  const lanes = receipt.lanes ?? [];
  if (lanes.length !== replacementHandoffRecoveryLaneIds.length) {
    throw new Error("replacement handoff receipt lane count drifted");
  }
  for (const laneId of replacementHandoffRecoveryLaneIds) {
    const lane = lanes.find((candidate) => candidate.id === laneId);
    if (
      lane === undefined ||
      lane.status !== "passed" ||
      typeof lane.compactStatus !== "string" ||
      lane.compactStatus.trim() === "" ||
      lane.evidence === null ||
      typeof lane.evidence !== "object"
    ) {
      throw new Error(`replacement handoff receipt lane drifted: ${laneId}`);
    }
  }
  return receipt;
}

export async function writeDevTestGameReplacementHandoffRecoveryReceipt({
  generatedAt = new Date().toISOString(),
  proofRunPath = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? defaultProofRunPath,
  hardeningAdminProofPath =
    process.env.FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF ??
    devTestGameHardeningAdminProofPath,
} = {}) {
  const absoluteProofRunPath = path.resolve(repoRoot, proofRunPath);
  const proofRun = JSON.parse(await readFile(absoluteProofRunPath, "utf8"));
  const receipt = buildDevTestGameReplacementHandoffRecoveryReceipt(proofRun, {
    generatedAt,
    proofRunSource: path.relative(repoRoot, absoluteProofRunPath),
    hardeningAdminProofSource: path.relative(
      repoRoot,
      path.resolve(repoRoot, hardeningAdminProofPath),
    ),
  });
  await mkdir(path.dirname(receiptJsonPath), { recursive: true });
  await writeFile(receiptJsonPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

function replacementHandoffLaneCompactStatus(lane) {
  const evidence = lane.evidence ?? {};
  const slot =
    evidence.actorSlot ??
    evidence.targetSlot ??
    evidence.currentSlot ??
    evidence.replacementSlot ??
    evidence.slot;
  const terminalState =
    evidence.rejectError ??
    evidence.reconnectState ??
    evidence.replacementState ??
    evidence.incomingState ??
    evidence.outgoingState ??
    evidence.currentOccupant ??
    evidence.status ??
    lane.status;
  return slot === undefined
    ? `${lane.status}: ${terminalState}`
    : `${lane.status}: ${slot}, ${terminalState}`;
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
  const receipt = await writeDevTestGameReplacementHandoffRecoveryReceipt();
  console.log(
    `wrote ${devTestGameReplacementHandoffRecoveryReceiptPath} (${receipt.status})`,
  );
}
