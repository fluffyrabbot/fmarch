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
