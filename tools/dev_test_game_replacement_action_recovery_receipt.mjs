import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertReplacementActionRecoveryCoverageSummary,
  replacementActionLaneIds,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHardeningAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_REPLACEMENT_ACTION_RECOVERY_RECEIPT_VERSION = 1;
export const devTestGameReplacementActionRecoveryReceiptPath =
  "target/dev-test-game/replacement-action-recovery-receipt.json";
export const devTestGameReplacementActionRecoveryReceiptCommand =
  "test:dev-test-game-replacement-action-recovery-receipt";
export const devTestGameReplacementActionRecoveryReceiptRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.hardening);

const receiptJsonPath = path.join(
  repoRoot,
  devTestGameReplacementActionRecoveryReceiptPath,
);
const defaultProofRunPath = "target/dev-test-game/proof-run.json";

export function buildDevTestGameReplacementActionRecoveryReceipt(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    proofRunSource = defaultProofRunPath,
    hardeningAdminProofSource = devTestGameHardeningAdminProofPath,
  } = {},
) {
  const proof = assertDevTestGameProofRun(proofRun);
  const coverage = assertReplacementActionRecoveryCoverageSummary({
    summary: proof.replacementActionRecoveryCoverage,
    lanes: proof.lanes,
  });
  const lanesById = new Map((proof.lanes ?? []).map((lane) => [lane.id, lane]));
  const lanes = replacementActionLaneIds.map((laneId) => {
    const lane = lanesById.get(laneId);
    if (lane === undefined) {
      throw new Error(`replacement action receipt missing lane: ${laneId}`);
    }
    if (lane.status !== "passed") {
      throw new Error(`replacement action receipt lane ${laneId} is ${lane.status}`);
    }
    return {
      id: lane.id,
      label: lane.label,
      status: lane.status,
      compactStatus: replacementActionLaneCompactStatus(lane),
      evidence: lane.evidence ?? {},
    };
  });
  const receipt = {
    version: DEV_TEST_GAME_REPLACEMENT_ACTION_RECOVERY_RECEIPT_VERSION,
    proof: "dev-test-game-replacement-action-recovery-receipt",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-replacement-action-recovery",
    proofBoundary:
      "Derived local receipt for replacement action recovery. It records passed seeded proof-run lanes for incoming replacement action submission, reconnect to locked resolved state, and stale replacement action rejection plus the existing hardening admin role URL; it does not prove hosted identity, hosted transport, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunSource,
      hardeningAdminProof: hardeningAdminProofSource,
      game: proof.session?.game,
      family: {
        id: "replacement-action-recovery",
        laneIds: [...replacementActionLaneIds],
      },
      roleUrl: devTestGameReplacementActionRecoveryReceiptRoleUrl,
    },
    summary: {
      status: coverage.status,
      laneCount: coverage.laneCount,
      passedLaneCount: coverage.passedLaneCount,
      familyCount: coverage.familyCount,
      expectedLaneCount: coverage.expectedLaneCount,
      expectedFamilyCount: coverage.expectedFamilyCount,
    },
    laneIds: [...replacementActionLaneIds],
    lanes,
  };
  assertDevTestGameReplacementActionRecoveryReceipt(receipt);
  return receipt;
}

export function assertDevTestGameReplacementActionRecoveryReceipt(receipt) {
  if (
    receipt?.version !==
    DEV_TEST_GAME_REPLACEMENT_ACTION_RECOVERY_RECEIPT_VERSION
  ) {
    throw new Error(
      `replacement action receipt version drifted: ${receipt?.version}`,
    );
  }
  if (receipt.proof !== "dev-test-game-replacement-action-recovery-receipt") {
    throw new Error(`unexpected replacement action receipt id: ${receipt.proof}`);
  }
  if (receipt.status !== "passed") {
    throw new Error(`replacement action receipt status is ${receipt.status}`);
  }
  if (receipt.scope !== "local-dev-test-game-replacement-action-recovery") {
    throw new Error(`replacement action receipt scope drifted: ${receipt.scope}`);
  }
  if (receipt.releaseReady !== false || receipt.productionReady !== false) {
    throw new Error("replacement action receipt must not claim release readiness");
  }
  if (
    receipt.generatedFrom?.family?.id !== "replacement-action-recovery" ||
    !sameStringArray(
      receipt.generatedFrom?.family?.laneIds,
      replacementActionLaneIds,
    )
  ) {
    throw new Error("replacement action receipt family drifted");
  }
  if (
    receipt.generatedFrom?.roleUrl !==
    devTestGameReplacementActionRecoveryReceiptRoleUrl
  ) {
    throw new Error("replacement action receipt role URL drifted");
  }
  if (
    receipt.summary?.status !== "passed" ||
    receipt.summary?.laneCount !== replacementActionLaneIds.length ||
    receipt.summary?.passedLaneCount !== replacementActionLaneIds.length ||
    receipt.summary?.familyCount !== replacementActionLaneIds.length
  ) {
    throw new Error("replacement action receipt coverage summary drifted");
  }
  if (!sameStringArray(receipt.laneIds, replacementActionLaneIds)) {
    throw new Error("replacement action receipt lane list drifted");
  }
  const lanes = receipt.lanes ?? [];
  if (lanes.length !== replacementActionLaneIds.length) {
    throw new Error("replacement action receipt lane count drifted");
  }
  for (const laneId of replacementActionLaneIds) {
    const lane = lanes.find((candidate) => candidate.id === laneId);
    if (
      lane === undefined ||
      lane.status !== "passed" ||
      typeof lane.compactStatus !== "string" ||
      lane.compactStatus.trim() === "" ||
      lane.evidence === null ||
      typeof lane.evidence !== "object"
    ) {
      throw new Error(`replacement action receipt lane drifted: ${laneId}`);
    }
  }
  return receipt;
}

export async function writeDevTestGameReplacementActionRecoveryReceipt({
  generatedAt = new Date().toISOString(),
  proofRunPath = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? defaultProofRunPath,
  hardeningAdminProofPath =
    process.env.FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF ??
    devTestGameHardeningAdminProofPath,
} = {}) {
  const absoluteProofRunPath = path.resolve(repoRoot, proofRunPath);
  const proofRun = JSON.parse(await readFile(absoluteProofRunPath, "utf8"));
  const receipt = buildDevTestGameReplacementActionRecoveryReceipt(proofRun, {
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

function replacementActionLaneCompactStatus(lane) {
  const evidence = lane.evidence ?? {};
  const targetSlot = evidence.targetSlot;
  const terminalState =
    evidence.rejectError ??
    evidence.reconnectState ??
    evidence.actionState ??
    evidence.replacementState ??
    lane.status;
  return targetSlot === undefined
    ? `${lane.status}: ${terminalState}`
    : `${lane.status}: ${targetSlot}, ${terminalState}`;
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
  const receipt = await writeDevTestGameReplacementActionRecoveryReceipt();
  console.log(
    `wrote ${devTestGameReplacementActionRecoveryReceiptPath} (${receipt.status})`,
  );
}
