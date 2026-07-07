import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNormalPostDayVoteAdvanceSurfaceProof,
  assertTargetPostDayVoteAdvanceSurfaceProof,
  coreLoopPostDayVoteAdvanceFamilyId,
  coreLoopPostDayVoteAdvanceLaneIds,
  coreLoopPostDayVoteAdvanceScenarioFamily,
  postDayVoteAdvanceSurfaceCases,
} from "./dev_test_game_core_loop_post_day_vote_advance_scenarios.mjs";

test("post-day-vote advance family shares target and normal observation cases", () => {
  assert.equal(
    coreLoopPostDayVoteAdvanceFamilyId,
    "core-loop-post-day-vote-advance",
  );
  assert.deepEqual(coreLoopPostDayVoteAdvanceLaneIds, [
    "resolution-receipts",
  ]);

  const family = coreLoopPostDayVoteAdvanceScenarioFamily();
  assert.equal(family.id, coreLoopPostDayVoteAdvanceFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPostDayVoteAdvanceLaneIds);
  assert.deepEqual(Object.keys(family.surfaces), [
    "targetPostDayVoteAdvance",
    "normalPostDayVoteAdvance",
  ]);
  assert.equal(
    family.surfaces.targetPostDayVoteAdvance.privateReceiptStatus,
    "day_vote",
  );
  assert.equal(
    family.surfaces.normalPostDayVoteAdvance.privateReceipt,
    false,
  );
  assert.notEqual(
    postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
    postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
  );
});

test("post-day-vote advance assertions cover target receipt and normal privacy", () => {
  const game = "game-a";
  assert.doesNotThrow(() =>
    assertTargetPostDayVoteAdvanceSurfaceProof({
      proof: postDayVoteAdvanceProofFixture({
        game,
        surfaceCase: postDayVoteAdvanceSurfaceCases().targetPostDayVoteAdvance,
      }),
      expectedGame: game,
      sourceRoleUrl: sourceRoleUrl({ game }),
    }),
  );
  assert.doesNotThrow(() =>
    assertNormalPostDayVoteAdvanceSurfaceProof({
      proof: postDayVoteAdvanceProofFixture({
        game,
        surfaceCase: postDayVoteAdvanceSurfaceCases().normalPostDayVoteAdvance,
      }),
      expectedGame: game,
      sourceRoleUrl: sourceRoleUrl({ game }),
    }),
  );
  assert.throws(
    () =>
      assertNormalPostDayVoteAdvanceSurfaceProof({
        proof: {
          ...postDayVoteAdvanceProofFixture({
            game,
            surfaceCase:
              postDayVoteAdvanceSurfaceCases().normalPostDayVoteAdvance,
          }),
          projectionNotifications: [{ effect: "player_killed" }],
        },
        expectedGame: game,
        sourceRoleUrl: sourceRoleUrl({ game }),
      }),
    /normal post-day-vote advance surface/,
  );
});

function postDayVoteAdvanceProofFixture({ game, surfaceCase }) {
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: sourceRoleUrl({ game }),
    visitedRolePath: `/g/${game}?private=notification-1`,
    surfaceTestId: "player-surface",
    [surfaceCase.slotField]: surfaceCase.expectedSlot,
    principalUserId: surfaceCase.principalUserId,
    checkpoint: {
      phaseId: surfaceCase.phaseId,
      phaseState: surfaceCase.phaseState,
      actorSlot: surfaceCase.expectedSlot,
      actionState: surfaceCase.actionState,
      receiptState: "idle",
      statusText: `Player action unavailable: ${surfaceCase.statusText}`,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: surfaceCase.privateReceipt ? 1 : 0,
      text: "delivered to you alone",
    },
    projectionCommandState: {
      actorSlot: surfaceCase.expectedSlot,
      actorAlive: surfaceCase.actorAlive,
      actorStatus: surfaceCase.actorStatus,
      phase: {
        phaseId: surfaceCase.phaseId,
        locked: surfaceCase.phaseState === "locked",
      },
      actions: [],
      boundary: surfaceCase.boundaryText,
    },
    resyncFromSeq: surfaceCase.resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: surfaceCase.expectedSlot,
      phase: { phaseId: surfaceCase.phaseId },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${surfaceCase.principalUserId}`,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${surfaceCase.principalUserId}&slot_id=${surfaceCase.expectedSlot}`,
    },
  };
  if (surfaceCase.privateReceipt) {
    return {
      ...proof,
      privateNotice: {
        id: "notification-1",
        kind: "notification",
        text: `player_killed ${surfaceCase.privateReceiptStatus}`,
        detailText: `Phase ${surfaceCase.privateReceiptPhaseId}`,
      },
      projectionNotifications: [
        { effect: "player_killed", status: surfaceCase.privateReceiptStatus },
      ],
      resyncSnapshotNotifications: [
        { status: surfaceCase.privateReceiptStatus },
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
