import assert from "node:assert/strict";
import { test } from "node:test";
import {
  releaseReadinessProductionFeatureSpineTargets,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  buildProductionFeatureSpineDrilldown,
  buildProductionFeatureSpineTargetCollection,
  resolveProductionFeatureSpineTarget,
  validProductionFeatureSpineDrilldown,
  validProductionFeatureSpineTarget,
  validProductionFeatureSpineTargetCollection,
} from "./dev_test_game_production_feature_spine_resolver.mjs";

const browserProofCommand =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";
const coreLoopAdminProofCommand =
  "npm run test:dev-test-game-core-loop-admin-proof";

test("production feature spine resolver resolves seeded role targets", () => {
  const sourceTarget = coreLoopSourceTargetFixture();
  const target = resolveProductionFeatureSpineTarget({
    itemId: "resolution-receipts",
    declaration: releaseReadinessProductionFeatureSpineTargets.resolutionReceipts,
    sourceTargetsByCheckId: {
      "local-core-loop-proof": sourceTarget,
    },
  });

  assert.deepEqual(target, {
    featureSlotId: "resolution-receipts",
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleId: "d01-n01-d02",
    roleUrlId: "d01-n01-d02-target",
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rowKind: "checkpoint",
    checkpointId: "d01-n01-d02-n01-resolved-target-killed",
    adminCheckId: "resolution-receipts",
    browserProofCommand,
    rerunCommand: coreLoopAdminProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineTarget(target, {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
  assert.deepEqual(buildProductionFeatureSpineDrilldown(target), {
    featureSlotId: "resolution-receipts",
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleRowId: "d01-n01-d02",
    roleUrlRowId: "d01-n01-d02-target",
    rowKind: "checkpoint",
    checkpointRowId: "d01-n01-d02-n01-resolved-target-killed",
    adminCheckId: "resolution-receipts",
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rerunCommand: coreLoopAdminProofCommand,
    browserProofCommand,
  });
  assert.equal(
    validProductionFeatureSpineDrilldown(buildProductionFeatureSpineDrilldown(target), {
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver builds and validates source collections", () => {
  const collection = buildProductionFeatureSpineTargetCollection({
    declarations: releaseReadinessProductionFeatureSpineTargets,
    sourceTarget: coreLoopSourceTargetFixture(),
  });

  assert.equal(collection.status, "passed");
  assert.deepEqual(collection.slotIds, [
    "host-phase-control",
    "player-action-submission",
    "invalid-action-recovery",
    "private-channel",
    "resolution-receipts",
    "stale-recovery",
  ]);
  assert.equal(
    collection.bySlotId["invalid-action-recovery"].recoveryHookId,
    "invalidActionReject",
  );
  assert.equal(
    validProductionFeatureSpineTargetCollection(collection, {
      declarations: Object.values(releaseReadinessProductionFeatureSpineTargets)
        .filter(
          (declaration) => declaration.sourceCheckId === "local-core-loop-proof",
        ),
      sourceCheckRules: coreLoopSourceCheckRules(),
    }),
    true,
  );
});

test("production feature spine resolver fails closed for missing proof rows", () => {
  assert.throws(
    () =>
      resolveProductionFeatureSpineTarget({
        itemId: "resolution-receipts",
        declaration:
          releaseReadinessProductionFeatureSpineTargets.resolutionReceipts,
        sourceTargetsByCheckId: {
          "local-core-loop-proof": {
            ...coreLoopSourceTargetFixture(),
            checkpointIds: ["d01-n01-d02-n01-action-open"],
          },
        },
      }),
    /production feature spine target is not in local-core-loop-proof/,
  );
});

function coreLoopSourceTargetFixture() {
  return {
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    browserProofCommand,
    rerunCommand: coreLoopAdminProofCommand,
    cycleIds: ["d01-n01-d02", "d02-n02"],
    roleUrlIds: [
      "d01-n01-d02-host",
      "d01-n01-d02-actionPlayer",
      "d01-n01-d02-normalPlayer",
      "d01-n01-d02-target",
      "d01-n01-d02-privateChannel",
      "d02-n02-host",
      "d02-n02-actionPlayer",
    ],
    checkpointIds: [
      "d01-n01-d02-d01-resolved-locked",
      "d01-n01-d02-n01-action-open",
      "d01-n01-d02-n01-resolved-target-killed",
      "d02-n02-d02-vote-open",
      "d02-n02-n02-action-open",
    ],
    recoveryHookIds: ["invalidActionReject"],
    visibleAdminCheckIds: [
      "host-lifecycle-control",
      "action-loop",
      "invalid-action-recovery",
      "private-channel",
      "resolution-receipts",
      "stale-deadline-advance",
    ],
    roleUrlHrefs: {
      "d01-n01-d02-host": "http://127.0.0.1:5173/g/game-a/host",
      "d01-n01-d02-actionPlayer": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-normalPlayer": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-target": "http://127.0.0.1:5173/g/game-a",
      "d01-n01-d02-privateChannel":
        "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
      "d02-n02-host": "http://127.0.0.1:5173/g/game-b/host",
      "d02-n02-actionPlayer": "http://127.0.0.1:5173/g/game-b",
    },
  };
}

function coreLoopSourceCheckRules() {
  return {
    "local-core-loop-proof": {
      detailRoleUrlIncludes: "/admin/audit/local-core-loop",
      roleUrlIncludes: "/g/",
      rerunCommand: coreLoopAdminProofCommand,
    },
  };
}
