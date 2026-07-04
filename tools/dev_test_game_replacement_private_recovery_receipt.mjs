import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  assertReplacementPrivateChannelRecoveryCoverageSummary,
  replacementPrivateChannelRecoveryLaneIds,
} from "./dev_test_game_replacement_private_scenarios.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_REPLACEMENT_PRIVATE_RECOVERY_RECEIPT_VERSION = 1;
export const devTestGameReplacementPrivateRecoveryReceiptPath =
  "target/dev-test-game/replacement-private-channel-recovery-receipt.json";
export const devTestGameReplacementPrivateRecoveryReceiptCommand =
  "test:dev-test-game-replacement-private-recovery-receipt";
export const devTestGameReplacementPrivateRecoveryReceiptRoleUrl =
  localAdminAuditRoleUrl(localAdminAuditIds.hardening);

const receiptJsonPath = path.join(
  repoRoot,
  devTestGameReplacementPrivateRecoveryReceiptPath,
);
const defaultProofRunPath = "target/dev-test-game/proof-run.json";

export function buildDevTestGameReplacementPrivateRecoveryReceipt(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    proofRunSource = defaultProofRunPath,
    hardeningAdminProofSource = "target/dev-test-game/hardening-admin-proof.json",
  } = {},
) {
  const proof = assertDevTestGameProofRun(proofRun);
  const coverage = assertReplacementPrivateChannelRecoveryCoverageSummary({
    summary: proof.replacementPrivateChannelRecoveryCoverage,
    lanes: proof.lanes,
  });
  const lanesById = new Map((proof.lanes ?? []).map((lane) => [lane.id, lane]));
  const lanes = replacementPrivateChannelRecoveryLaneIds.map((laneId) => {
    const lane = lanesById.get(laneId);
    if (lane === undefined) {
      throw new Error(
        `replacement private recovery receipt missing lane: ${laneId}`,
      );
    }
    if (lane.status !== "passed") {
      throw new Error(
        `replacement private recovery receipt lane ${laneId} is ${lane.status}`,
      );
    }
    return {
      id: lane.id,
      label: lane.label,
      status: lane.status,
      compactStatus: replacementPrivateLaneCompactStatus(lane),
      evidence: lane.evidence ?? {},
    };
  });
  const receipt = {
    version: DEV_TEST_GAME_REPLACEMENT_PRIVATE_RECOVERY_RECEIPT_VERSION,
    proof: "dev-test-game-replacement-private-recovery-receipt",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-replacement-private-recovery",
    proofBoundary:
      "Derived local receipt for replacement private-channel recovery. It records passed seeded proof-run lanes for outgoing replacement private-channel authority, private receipts, stale private posts after resolution, reconnect recovery, completed-game private post rejection, and completed private-channel reload plus the existing hardening admin role URL; it does not prove hosted identity, hosted transport, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: proofRunSource,
      hardeningAdminProof: hardeningAdminProofSource,
      game: proof.session?.game,
      family: {
        id: "replacement-private-channel-recovery",
        laneIds: [...replacementPrivateChannelRecoveryLaneIds],
      },
      roleUrl: devTestGameReplacementPrivateRecoveryReceiptRoleUrl,
    },
    summary: {
      status: coverage.status,
      laneCount: coverage.laneCount,
      passedLaneCount: coverage.passedLaneCount,
      familyCount: coverage.familyCount,
      expectedLaneCount: coverage.expectedLaneCount,
      expectedFamilyCount: coverage.expectedFamilyCount,
    },
    laneIds: [...replacementPrivateChannelRecoveryLaneIds],
    lanes,
  };
  assertDevTestGameReplacementPrivateRecoveryReceipt(receipt);
  return receipt;
}

export function assertDevTestGameReplacementPrivateRecoveryReceipt(receipt) {
  if (
    receipt?.version !==
    DEV_TEST_GAME_REPLACEMENT_PRIVATE_RECOVERY_RECEIPT_VERSION
  ) {
    throw new Error(
      `replacement private recovery receipt version drifted: ${receipt?.version}`,
    );
  }
  if (receipt.proof !== "dev-test-game-replacement-private-recovery-receipt") {
    throw new Error(
      `unexpected replacement private recovery receipt id: ${receipt.proof}`,
    );
  }
  if (receipt.status !== "passed") {
    throw new Error(`replacement private receipt status is ${receipt.status}`);
  }
  if (receipt.scope !== "local-dev-test-game-replacement-private-recovery") {
    throw new Error(`replacement private receipt scope drifted: ${receipt.scope}`);
  }
  if (receipt.releaseReady !== false || receipt.productionReady !== false) {
    throw new Error("replacement private receipt must not claim release readiness");
  }
  if (
    receipt.generatedFrom?.family?.id !==
      "replacement-private-channel-recovery" ||
    !sameStringArray(
      receipt.generatedFrom?.family?.laneIds,
      replacementPrivateChannelRecoveryLaneIds,
    )
  ) {
    throw new Error("replacement private receipt family drifted");
  }
  if (
    receipt.generatedFrom?.roleUrl !==
    devTestGameReplacementPrivateRecoveryReceiptRoleUrl
  ) {
    throw new Error("replacement private receipt role URL drifted");
  }
  if (
    receipt.summary?.status !== "passed" ||
    receipt.summary?.laneCount !== replacementPrivateChannelRecoveryLaneIds.length ||
    receipt.summary?.passedLaneCount !==
      replacementPrivateChannelRecoveryLaneIds.length ||
    receipt.summary?.familyCount !== 3
  ) {
    throw new Error("replacement private receipt coverage summary drifted");
  }
  if (!sameStringArray(receipt.laneIds, replacementPrivateChannelRecoveryLaneIds)) {
    throw new Error("replacement private receipt lane list drifted");
  }
  const lanes = receipt.lanes ?? [];
  if (lanes.length !== replacementPrivateChannelRecoveryLaneIds.length) {
    throw new Error("replacement private receipt lane count drifted");
  }
  for (const laneId of replacementPrivateChannelRecoveryLaneIds) {
    const lane = lanes.find((candidate) => candidate.id === laneId);
    if (
      lane === undefined ||
      lane.status !== "passed" ||
      typeof lane.compactStatus !== "string" ||
      lane.compactStatus.trim() === "" ||
      lane.evidence === null ||
      typeof lane.evidence !== "object"
    ) {
      throw new Error(`replacement private receipt lane drifted: ${laneId}`);
    }
  }
  return receipt;
}

export async function writeDevTestGameReplacementPrivateRecoveryReceipt({
  generatedAt = new Date().toISOString(),
  proofRunPath = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ?? defaultProofRunPath,
  hardeningAdminProofPath =
    process.env.FMARCH_DEV_TEST_GAME_HARDENING_ADMIN_PROOF ??
    "target/dev-test-game/hardening-admin-proof.json",
} = {}) {
  const absoluteProofRunPath = path.resolve(repoRoot, proofRunPath);
  const proofRun = JSON.parse(await readFile(absoluteProofRunPath, "utf8"));
  const receipt = buildDevTestGameReplacementPrivateRecoveryReceipt(proofRun, {
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

function replacementPrivateLaneCompactStatus(lane) {
  const evidence = lane.evidence ?? {};
  const channel = evidence.channel ?? evidence.rowanChannelContext;
  const terminalState =
    evidence.rejectError ??
    evidence.postState ??
    evidence.reconnectState ??
    evidence.routeStatus ??
    evidence.staleRouteStatus ??
    evidence.rowanPostState ??
    lane.status;
  return channel === undefined
    ? `${lane.status}: ${terminalState}`
    : `${lane.status}: ${channel}, ${terminalState}`;
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
  const receipt = await writeDevTestGameReplacementPrivateRecoveryReceipt();
  console.log(
    `wrote ${devTestGameReplacementPrivateRecoveryReceiptPath} (${receipt.status})`,
  );
}
