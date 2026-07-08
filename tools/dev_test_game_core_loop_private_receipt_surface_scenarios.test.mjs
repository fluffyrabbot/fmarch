import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNormalNightActionResolutionPrivacySurfaceProof,
  assertTargetResolutionReceiptSurfaceProof,
  coreLoopPrivateReceiptSurfaceFamilyId,
  coreLoopPrivateReceiptSurfaceLaneIds,
  coreLoopPrivateReceiptSurfaceScenarioFamily,
  nightActionResolutionPrivateReceiptCheckpointRows,
  nightActionResolutionPrivacyCheckpointPassed,
  nightActionResolutionPrivacyFeatureSpineRow,
  nightActionResolutionReceiptCheckpointPassed,
  nightActionResolutionReceiptFeatureSpineRow,
  normalResolutionPrivacyRoleUrl,
  privateReceiptSurfaceCases,
  targetResolutionReceiptRoleUrl,
} from "./dev_test_game_core_loop_private_receipt_surface_scenarios.mjs";
import {
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  nightActionResolutionReceiptSurfaceFixture,
  normalNightActionResolutionPrivacySurfaceFixture,
  privateReceiptProofFixture,
  privateReceiptSourceRoleUrl,
} from "./dev_test_game_core_loop_role_surface_test_fixtures.mjs";

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

test("night action receipt and privacy checkpoint rows share scenario predicates", () => {
  const game = "game-a";
  const receiptSurface = nightActionResolutionReceiptSurfaceFixture({ game });
  const privacySurface = normalNightActionResolutionPrivacySurfaceFixture({
    game,
  });

  assert.equal(
    nightActionResolutionReceiptCheckpointPassed(receiptSurface),
    true,
  );
  assert.equal(
    nightActionResolutionPrivacyCheckpointPassed(privacySurface),
    true,
  );
  assert.deepEqual(
    nightActionResolutionPrivateReceiptCheckpointRows({
      cycleId: "d02-n02",
      nightActionResolutionReceiptSurface: receiptSurface,
      normalNightActionResolutionPrivacySurface: privacySurface,
    }),
    [
      "d02-n02-night-action-resolution-receipt-checkpoint",
      "d02-n02-night-action-resolution-privacy-checkpoint",
    ],
  );
  assert.deepEqual(
    nightActionResolutionPrivateReceiptCheckpointRows({
      cycleId: "d02-n02",
      nightActionResolutionReceiptSurface: {
        ...receiptSurface,
        rawInviteTokensVisible: true,
      },
      normalNightActionResolutionPrivacySurface: {
        ...privacySurface,
        targetReceiptVisible: true,
      },
    }),
    [],
  );
});

test("private receipt surface role URLs focus the private notification", () => {
  assert.equal(
    targetResolutionReceiptRoleUrl("http://127.0.0.1:5173/g/game-a"),
    "http://127.0.0.1:5173/g/game-a?private=notification-1",
  );
  assert.equal(
    normalResolutionPrivacyRoleUrl("http://127.0.0.1:5173/g/game-a?x=1"),
    "http://127.0.0.1:5173/g/game-a?private=notification-1",
  );
  assert.throws(
    () => targetResolutionReceiptRoleUrl(""),
    /target resolution proof missing source role URL/,
  );
  assert.throws(
    () => normalResolutionPrivacyRoleUrl(""),
    /normal resolution proof missing source role URL/,
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
      sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
    }),
  );
  assert.doesNotThrow(() =>
    assertNormalNightActionResolutionPrivacySurfaceProof({
      proof: privateReceiptProofFixture({ game, scenario: privacyScenario }),
      expectedGame: game,
      sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
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
        sourceRoleUrl: privateReceiptSourceRoleUrl({ game }),
      }),
    /normal night action resolution privacy surface/,
  );
});
