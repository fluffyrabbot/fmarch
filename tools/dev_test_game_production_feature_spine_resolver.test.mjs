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
    "day-vote-resolution",
    "post-day-three-transition",
    "night-action-loop",
    "player-action-submission",
    "host-night-action-transition",
    "night-two-action-resolution",
    "day-three-terminal-boundary",
    "day-three-terminal-recovery",
    "day-three-no-majority-revote",
    "day-three-revote-ballot",
    "day-three-revote-resolution",
    "invalid-action-recovery",
    "player-action-boundary",
    "private-channel",
    "resolution-receipts",
    "stale-recovery",
    "stale-action-conflict-message",
    "completed-game-recovery",
  ]);
  assert.equal(
    collection.bySlotId["invalid-action-recovery"].recoveryHookId,
    "invalidActionReject",
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-vote-resolution"].roleUrlId,
      checkpointId: collection.bySlotId["day-vote-resolution"].checkpointId,
      adminCheckId: collection.bySlotId["day-vote-resolution"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-actionPlayer",
      checkpointId: "d02-n02-d02-deciding-vote-submitted",
      adminCheckId: "day-vote-resolution",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["post-day-three-transition"].roleUrlId,
      checkpointId:
        collection.bySlotId["post-day-three-transition"].checkpointId,
      adminCheckId:
        collection.bySlotId["post-day-three-transition"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-host",
      checkpointId: "d02-n02-d02-resolved-target-killed",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["night-action-loop"].roleUrlId,
      checkpointId: collection.bySlotId["night-action-loop"].checkpointId,
      adminCheckId: collection.bySlotId["night-action-loop"].adminCheckId,
    },
    {
      roleUrlId: "d01-n01-d02-actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      adminCheckId: "action-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["host-night-action-transition"].roleUrlId,
      checkpointId:
        collection.bySlotId["host-night-action-transition"].checkpointId,
      adminCheckId:
        collection.bySlotId["host-night-action-transition"].adminCheckId,
    },
    {
      roleUrlId: "d02-n02-host",
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-terminal-boundary"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-terminal-boundary"].checkpointId,
      recoveryHookId:
        collection.bySlotId["day-three-terminal-boundary"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["day-three-terminal-boundary"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-host",
      checkpointId: "n02-d03-d03-terminal-advance-reject",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-terminal-recovery"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-terminal-recovery"].checkpointId,
      recoveryHookId:
        collection.bySlotId["day-three-terminal-recovery"].recoveryHookId,
      adminCheckId:
        collection.bySlotId["day-three-terminal-recovery"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-host",
      checkpointId: "n02-d03-d03-terminal-reload-recovery",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-no-majority-revote"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-no-majority-revote"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-no-majority-revote"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-host",
      checkpointId: "n02-d03-d03-revote-prompt-resolved",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["day-three-revote-ballot"].roleUrlId,
      checkpointId: collection.bySlotId["day-three-revote-ballot"].checkpointId,
      adminCheckId: collection.bySlotId["day-three-revote-ballot"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-actionPlayer",
      checkpointId: "n02-d03-d03r1-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId:
        collection.bySlotId["day-three-revote-resolution"].roleUrlId,
      checkpointId:
        collection.bySlotId["day-three-revote-resolution"].checkpointId,
      adminCheckId:
        collection.bySlotId["day-three-revote-resolution"].adminCheckId,
    },
    {
      roleUrlId: "n02-d03-host",
      checkpointId: "n02-d03-d03r1-revote-resolved-no-majority",
      adminCheckId: "core-loop",
    },
  );
  assert.deepEqual(
    {
      roleUrlId: collection.bySlotId["player-action-boundary"].roleUrlId,
      checkpointId: collection.bySlotId["player-action-boundary"].checkpointId,
      recoveryHookId:
        collection.bySlotId["player-action-boundary"].recoveryHookId,
      adminCheckId: collection.bySlotId["player-action-boundary"].adminCheckId,
    },
    {
      roleUrlId: "d01-n01-d02-normalPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: "normalPlayerDirectActionReject",
      adminCheckId: "player-action-boundary",
    },
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
    cycleIds: ["d01-n01-d02", "d02-n02", "n02-d03"],
    roleUrlIds: [
      "d01-n01-d02-host",
      "d01-n01-d02-actionPlayer",
      "d01-n01-d02-normalPlayer",
      "d01-n01-d02-target",
      "d01-n01-d02-privateChannel",
      "d02-n02-host",
      "d02-n02-actionPlayer",
      "d02-n02-normalPlayer",
      "d02-n02-target",
      "n02-d03-host",
      "n02-d03-actionPlayer",
      "n02-d03-normalPlayer",
    ],
    checkpointIds: [
      "d01-n01-d02-d01-resolved-locked",
      "d01-n01-d02-n01-action-open",
      "d01-n01-d02-n01-resolved-target-killed",
      "d01-n01-d02-d02-day-controls-return",
      "d02-n02-d02-vote-open",
      "d02-n02-d02-deciding-vote-submitted",
      "d02-n02-d02-resolved-target-killed",
      "d02-n02-n02-action-open",
      "n02-d03-n02-action-open",
      "n02-d03-n02-action-submitted",
      "n02-d03-n02-resolved-target-killed",
      "n02-d03-d03-day-controls-return",
      "n02-d03-d03-terminal-advance-reject",
      "n02-d03-d03-terminal-reload-recovery",
      "n02-d03-d03-revote-prompt-resolved",
      "n02-d03-d03r1-revote-ballot-submitted",
      "n02-d03-d03r1-revote-resolved-no-majority",
    ],
    recoveryHookIds: [
      "staleLockedVoteReject",
      "invalidActionReject",
      "normalPlayerDirectActionReject",
      "staleActionConflictReject",
      "d03TerminalAdvanceReject",
    ],
    visibleAdminCheckIds: [
      "core-loop",
      "completed-game-hardening-coverage",
      "host-lifecycle-control",
      "day-vote-resolution",
      "action-loop",
      "invalid-action-recovery",
      "player-action-boundary",
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
      "d02-n02-normalPlayer": "http://127.0.0.1:5173/g/game-b",
      "n02-d03-host": "http://127.0.0.1:5173/g/game-b/host",
      "n02-d03-actionPlayer": "http://127.0.0.1:5173/g/game-b",
      "n02-d03-normalPlayer": "http://127.0.0.1:5173/g/game-b",
      "d02-n02-target": "http://127.0.0.1:5173/g/game-b",
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
