import {
  assertPrivateReceiptRoleSurfaceCase,
  privateReceiptAssertionArgs,
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

export const coreLoopPrivateReceiptSurfaceFamilyId =
  "core-loop-private-receipt-surface";

export const coreLoopPrivateReceiptSurfaceLaneIds = Object.freeze([
  "resolution-receipts",
]);
export const nightActionResolutionReceiptCheckpointId =
  "night-action-resolution-receipt-checkpoint";
export const nightActionResolutionPrivacyCheckpointId =
  "night-action-resolution-privacy-checkpoint";
export const nightActionResolutionReceiptFeatureTargetKind =
  "night-action-resolution-receipt";
export const nightActionResolutionPrivacyFeatureTargetKind =
  "night-action-resolution-privacy";

const privateReceiptSurfaceCaseDefinitions = Object.freeze({
  targetResolutionReceipt: Object.freeze({
    scenarioId: "n01-target-receipt",
    errorMessage:
      "core-loop admin proof missing target resolution receipt surface",
  }),
  normalResolutionPrivacy: Object.freeze({
    scenarioId: "n01-normal-privacy",
    errorMessage:
      "core-loop admin proof missing normal resolution privacy surface",
  }),
  targetDayVoteReceipt: Object.freeze({
    scenarioId: "d02-target-receipt",
    errorMessage:
      "core-loop admin proof missing target day-vote receipt surface",
  }),
  normalDayVotePrivacy: Object.freeze({
    scenarioId: "d02-normal-privacy",
    errorMessage:
      "core-loop admin proof missing normal day-vote privacy surface",
  }),
  nightActionResolutionReceipt: Object.freeze({
    scenarioId: "n02-target-receipt",
    errorMessage:
      "core-loop admin proof missing night action resolution receipt surface",
  }),
  normalNightActionResolutionPrivacy: Object.freeze({
    scenarioId: "n02-normal-privacy",
    errorMessage:
      "core-loop admin proof missing normal night action resolution privacy surface",
  }),
});

export function privateReceiptSurfaceCases() {
  return Object.fromEntries(
    Object.entries(privateReceiptSurfaceCaseDefinitions).map(([key, value]) => [
      key,
      { ...value },
    ]),
  );
}

export function coreLoopPrivateReceiptSurfaceScenarioFamily() {
  const surfaces = privateReceiptSurfaceCases();
  return {
    id: coreLoopPrivateReceiptSurfaceFamilyId,
    laneIds: [...coreLoopPrivateReceiptSurfaceLaneIds],
    surfaces,
    privateReceiptScenarios: Object.fromEntries(
      Object.entries(surfaces).map(([key, surfaceCase]) => [
        key,
        { ...privateReceiptScenario(surfaceCase.scenarioId) },
      ]),
    ),
  };
}

export function nightActionResolutionReceiptFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "nightActionResolutionReceipt",
    featureSlotId: "night-action-resolution-receipt",
    cycleId,
    role: "target",
    checkpointId: `${cycleId}-${nightActionResolutionReceiptCheckpointId}`,
    adminCheckId: "resolution-receipts",
    featureTargetKind: nightActionResolutionReceiptFeatureTargetKind,
  };
}

export function nightActionResolutionPrivacyFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "nightActionResolutionPrivacy",
    featureSlotId: "night-action-resolution-privacy",
    cycleId,
    role: "normalPlayer",
    checkpointId: `${cycleId}-${nightActionResolutionPrivacyCheckpointId}`,
    adminCheckId: "resolution-receipts",
    featureTargetKind: nightActionResolutionPrivacyFeatureTargetKind,
  };
}

export function nightActionResolutionPrivateReceiptCheckpointRows({
  cycleId,
  nightActionResolutionReceiptSurface,
  normalNightActionResolutionPrivacySurface,
} = {}) {
  const rows = [];
  if (
    nightActionResolutionReceiptCheckpointPassed(
      nightActionResolutionReceiptSurface,
    )
  ) {
    rows.push(`${cycleId}-${nightActionResolutionReceiptCheckpointId}`);
  }
  if (
    nightActionResolutionPrivacyCheckpointPassed(
      normalNightActionResolutionPrivacySurface,
    )
  ) {
    rows.push(`${cycleId}-${nightActionResolutionPrivacyCheckpointId}`);
  }
  return rows;
}

export function nightActionResolutionReceiptCheckpointPassed(surface) {
  return (
    surface?.status === "passed" &&
    surface.targetSlot === "slot-3" &&
    surface.privateQueueBoundary?.count === 1 &&
    surface.privateNotice?.kind === "notification" &&
    String(surface.privateNotice?.text ?? "").includes("factional_kill") &&
    surface.projectionNotifications?.[0]?.status === "factional_kill" &&
    surface.checkpoint?.phaseId === "N02" &&
    surface.checkpoint?.phaseState === "locked" &&
    surface.rawInviteTokensVisible === false
  );
}

export function nightActionResolutionPrivacyCheckpointPassed(surface) {
  return (
    surface?.status === "passed" &&
    surface.normalSlot === "slot-4" &&
    surface.privateQueueBoundary?.count === 0 &&
    surface.targetReceiptVisible === false &&
    surface.projectionNotifications?.length === 0 &&
    surface.checkpoint?.phaseId === "N02" &&
    surface.checkpoint?.phaseState === "locked" &&
    surface.rawInviteTokensVisible === false
  );
}

export function targetResolutionReceiptRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("target resolution proof missing source role URL");
  }
  return privateReceiptFocusedRoleUrl(roleUrl);
}

export function normalResolutionPrivacyRoleUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("normal resolution proof missing source role URL");
  }
  return privateReceiptFocusedRoleUrl(roleUrl);
}

export function assertTargetResolutionReceiptSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.targetResolutionReceipt,
    includeEvidenceInError,
  });
}

export function assertNormalResolutionPrivacySurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.normalResolutionPrivacy,
    includeEvidenceInError,
  });
}

export function assertTargetDayVoteReceiptSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.targetDayVoteReceipt,
    includeEvidenceInError,
  });
}

export function assertNormalDayVotePrivacySurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.normalDayVotePrivacy,
    includeEvidenceInError,
  });
}

export function assertNightActionResolutionReceiptSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.nightActionResolutionReceipt,
    includeEvidenceInError,
  });
}

export function assertNormalNightActionResolutionPrivacySurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  includeEvidenceInError = false,
}) {
  assertPrivateReceiptSurfaceProof({
    proof,
    expectedGame,
    sourceRoleUrl,
    surfaceCase:
      privateReceiptSurfaceCaseDefinitions.normalNightActionResolutionPrivacy,
    includeEvidenceInError,
  });
}

function assertPrivateReceiptSurfaceProof({
  proof,
  expectedGame,
  sourceRoleUrl,
  surfaceCase,
  includeEvidenceInError,
}) {
  assertPrivateReceiptRoleSurfaceCase({
    proof,
    ...privateReceiptAssertionArgs({
      scenario: privateReceiptScenario(surfaceCase.scenarioId),
      expectedGame,
      sourceRoleUrl,
    }),
    errorMessage: surfaceCase.errorMessage,
    includeEvidenceInError,
  });
}

function privateReceiptFocusedRoleUrl(roleUrl) {
  const parsed = new URL(roleUrl);
  parsed.search = "?private=notification-1";
  return parsed.toString();
}
