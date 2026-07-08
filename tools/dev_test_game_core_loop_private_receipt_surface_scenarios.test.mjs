import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNormalNightActionResolutionPrivacySurfaceProof,
  assertTargetResolutionReceiptSurfaceProof,
  coreLoopPrivateReceiptSurfaceFamilyId,
  coreLoopPrivateReceiptSurfaceLaneIds,
  coreLoopPrivateReceiptSurfaceScenarioFamily,
  nightActionResolutionPrivacyFeatureSpineRow,
  nightActionResolutionReceiptFeatureSpineRow,
  privateReceiptSurfaceCases,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

test("private receipt surface family shares early receipt and privacy cases", () => {
  assert.equal(
    coreLoopPrivateReceiptSurfaceFamilyId,
    "core-loop-private-receipt-surface",
  );
  assert.deepEqual(coreLoopPrivateReceiptSurfaceLaneIds, [
    "resolution-receipts",
  ]);

  const family = coreLoopPrivateReceiptSurfaceScenarioFamily();
  assert.equal(family.id, coreLoopPrivateReceiptSurfaceFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPrivateReceiptSurfaceLaneIds);
  assert.deepEqual(Object.keys(family.surfaces), [
    "targetResolutionReceipt",
    "normalResolutionPrivacy",
    "targetDayVoteReceipt",
    "normalDayVotePrivacy",
    "nightActionResolutionReceipt",
    "normalNightActionResolutionPrivacy",
  ]);
  assert.equal(
    family.privateReceiptScenarios.targetResolutionReceipt.id,
    "n01-target-receipt",
  );
  assert.equal(
    family.privateReceiptScenarios.normalDayVotePrivacy.privateReceipt,
    false,
  );
  assert.equal(
    family.privateReceiptScenarios.nightActionResolutionReceipt.phaseId,
    "N02",
  );
  assert.notEqual(
    privateReceiptSurfaceCases().targetResolutionReceipt,
    privateReceiptSurfaceCases().targetResolutionReceipt,
  );
});

test("night action receipt and privacy feature rows are scenario-owned", () => {
  assert.deepEqual(
    nightActionResolutionReceiptFeatureSpineRow({ cycleId: "d02-n02" }),
    {
      targetKey: "nightActionResolutionReceipt",
      featureSlotId: "night-action-resolution-receipt",
      cycleId: "d02-n02",
      role: "target",
      checkpointId: "d02-n02-night-action-resolution-receipt-checkpoint",
      adminCheckId: "resolution-receipts",
      featureTargetKind: "night-action-resolution-receipt",
    },
  );
  assert.deepEqual(
    nightActionResolutionPrivacyFeatureSpineRow({ cycleId: "d02-n02" }),
    {
      targetKey: "nightActionResolutionPrivacy",
      featureSlotId: "night-action-resolution-privacy",
      cycleId: "d02-n02",
      role: "normalPlayer",
      checkpointId: "d02-n02-night-action-resolution-privacy-checkpoint",
      adminCheckId: "resolution-receipts",
      featureTargetKind: "night-action-resolution-privacy",
    },
  );
});

test("early private receipt surface assertions share target and privacy checks", () => {
  const game = "game-a";
  const targetScenario = privateReceiptScenario("n01-target-receipt");
  const privacyScenario = privateReceiptScenario("n02-normal-privacy");

  assert.doesNotThrow(() =>
    assertTargetResolutionReceiptSurfaceProof({
      proof: privateReceiptProofFixture({ game, scenario: targetScenario }),
      expectedGame: game,
      sourceRoleUrl: sourceRoleUrl({ game }),
    }),
  );
  assert.doesNotThrow(() =>
    assertNormalNightActionResolutionPrivacySurfaceProof({
      proof: privateReceiptProofFixture({ game, scenario: privacyScenario }),
      expectedGame: game,
      sourceRoleUrl: sourceRoleUrl({ game }),
    }),
  );
  assert.throws(
    () =>
      assertNormalNightActionResolutionPrivacySurfaceProof({
        proof: {
          ...privateReceiptProofFixture({ game, scenario: privacyScenario }),
          projectionNotifications: [{ effect: "player_killed" }],
        },
        expectedGame: game,
        sourceRoleUrl: sourceRoleUrl({ game }),
      }),
    /normal night action resolution privacy surface/,
  );
});

function privateReceiptProofFixture({ game, scenario }) {
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: sourceRoleUrl({ game }),
    visitedRolePath: `/g/${game}?private=notification-1`,
    surfaceTestId: "player-surface",
    [scenario.slotField]: scenario.expectedSlot,
    principalUserId: scenario.principalUserId,
    checkpoint: {
      phaseId: scenario.phaseId,
      phaseState: scenario.phaseState,
      actorSlot: scenario.expectedSlot,
      actionState: scenario.actionState,
      receiptState: "idle",
      statusText: `Player action unavailable: ${scenario.statusText}`,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: scenario.privateReceipt ? 1 : 0,
      text: "delivered to you alone",
    },
    projectionCommandState: {
      actorSlot: scenario.expectedSlot,
      actorAlive: scenario.actorAlive,
      actorStatus: scenario.actorStatus,
      phase: {
        phaseId: scenario.phaseId,
        locked: scenario.phaseState === "locked",
      },
      actions: [],
      boundary: scenario.boundaryText,
    },
    resyncFromSeq: scenario.resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: scenario.expectedSlot,
      phase: { phaseId: scenario.phaseId },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${scenario.principalUserId}`,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
    },
  };
  if (scenario.privateReceipt) {
    return {
      ...proof,
      privateNotice: {
        id: "notification-1",
        kind: "notification",
        text: `player_killed ${scenario.privateReceiptStatus}`,
        detailText: `Phase ${scenario.privateReceiptPhaseId}`,
      },
      projectionNotifications: [
        { effect: "player_killed", status: scenario.privateReceiptStatus },
      ],
      resyncSnapshotNotifications: [
        { effect: "player_killed", status: scenario.privateReceiptStatus },
      ],
    };
  }
  return {
    ...proof,
    targetReceiptVisible: false,
    privateEmptyText: "No private results visible",
    projectionNotifications: [],
    resyncSnapshotNotifications: [],
  };
}

function sourceRoleUrl({ game }) {
  return `http://127.0.0.1:5173/g/${game}?private=notification-1`;
}
