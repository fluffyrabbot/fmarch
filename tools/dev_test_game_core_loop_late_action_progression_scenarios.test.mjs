import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNightFourActionSubmissionSurfaceCase,
  assertNightFourResolutionReceiptSurfaceCase,
  coreLoopLateActionProgressionFamilyId,
  coreLoopLateActionProgressionLaneIds,
  coreLoopLateActionProgressionScenarioFamily,
  nightFourActionSubmissionSurfaceCase,
  nightFourResolutionReceiptSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";

test("late action progression family shares Night 4 action and recovery cases", () => {
  assert.equal(
    coreLoopLateActionProgressionFamilyId,
    "core-loop-late-action-progression",
  );
  assert.deepEqual(coreLoopLateActionProgressionLaneIds, ["action-loop"]);

  assert.deepEqual(
    nightFourActionSubmissionSurfaceCase().transitionFragments,
    [
      "player:D04:no_lynch:ack:912",
      "host:D04:resolve_phase:ack:913",
      "host:advance_phase:ack:914",
      "player:N04:submit_action:slot-5:ack:915",
    ],
  );
  assert.equal(
    nightFourActionSubmissionSurfaceCase().actionSubmissionCase.targetSlot,
    "slot-5",
  );
  assert.equal(
    nightFourActionSubmissionSurfaceCase().actionSubmissionCase.streamSeq,
    915,
  );
  assert.equal(
    nightFourResolutionReceiptSurfaceCase().hostResolutionCase.resolveCase
      .streamSeq,
    916,
  );
  assert.equal(
    nightFourResolutionReceiptSurfaceCase().survivorReceiptScenario.phaseId,
    "N04",
  );

  const family = coreLoopLateActionProgressionScenarioFamily();
  assert.equal(family.id, coreLoopLateActionProgressionFamilyId);
  assert.equal(
    family.surfaces.postNightFourTransition.hostAdvanceCase.expectedPhaseId,
    "D05",
  );
  assert.equal(
    family.staleRejects.staleNightFourAction.refreshedPhaseId,
    "D05",
  );
  assert.notEqual(
    nightFourActionSubmissionSurfaceCase().transitionFragments,
    nightFourActionSubmissionSurfaceCase().transitionFragments,
  );
});

test("late action progression assertion delegates Day 4 and checks Night 4 action ACK", () => {
  const observedVotes = [];
  const observedHostTransitions = [];
  const game = "game-a";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;

  assert.doesNotThrow(() =>
    assertNightFourActionSubmissionSurfaceCase({
      nightFourActionSubmissionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        transition:
          "player:D04:no_lynch:ack:912 -> host:D04:resolve_phase:ack:913 -> host:advance_phase:ack:914 -> player:N04:submit_action:slot-5:ack:915",
        dayFourVoteProof: { id: "day-four-vote" },
        hostTransitionProof: { id: "day-four-host" },
        nightFourActionProof: nightFourActionProof({ game, baseRoleUrl }),
      },
      expectedGame: game,
      assertDayFourNoLynchVoteProof: (args) => observedVotes.push(args),
      assertDayFourNoLynchHostTransitionProof: (args) =>
        observedHostTransitions.push(args),
    }),
  );

  assert.deepEqual(observedVotes.map((args) => args.proof.id), [
    "day-four-vote",
  ]);
  assert.deepEqual(observedHostTransitions.map((args) => args.proof.id), [
    "day-four-host",
  ]);
});

test("late action progression assertion checks host resolution and receipt privacy", () => {
  const observedHost = [];
  const game = "game-a";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;

  assert.doesNotThrow(() =>
    assertNightFourResolutionReceiptSurfaceCase({
      nightFourResolutionReceiptSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        sourceSurvivorRoleUrl: `${baseRoleUrl}?private=notification-1`,
        transition:
          "host:N04:resolve_phase:ack:916 -> survivor:N04:factional_kill_receipt -> actionPlayer:N04:privacy",
        hostResolutionProof: {
          status: "passed",
          clickedThroughFromRoleUrl: true,
          releaseReady: false,
          productionReady: false,
          rawInviteTokensVisible: false,
          sourceRoleUrl: `${baseRoleUrl}/host`,
          visitedRolePath: `/g/${game}/host`,
          surfaceTestId: "host-console-surface",
          setupResyncFromSeq: 915,
          setupSnapshotHost: { phase: { id: "N04", state: "open" } },
          resolveProof: { id: "host-resolve" },
        },
        survivorReceiptProof: nightFourPlayerSurfaceProof({
          game,
          sourceRoleUrl: `${baseRoleUrl}?private=notification-1`,
          visitedRolePath: `/g/${game}?private=notification-1`,
          slotField: "survivorSlot",
          slot: "slot-5",
          principalUserId: "player_sage",
          actorAlive: false,
          actorStatus: "dead",
          actionState: "disabled:actor is not alive",
          statusText: "actor is not alive",
          privateCount: 1,
          privateReceipt: true,
          boundary:
            "Seeded browser survivor target received factional_kill private receipt after N04 resolution.",
        }),
        actionPlayerPrivacyProof: nightFourPlayerSurfaceProof({
          game,
          sourceRoleUrl: baseRoleUrl,
          visitedRolePath: `/g/${game}`,
          slotField: "actionPlayerSlot",
          slot: "slot-7",
          principalUserId: "player_mira",
          actorAlive: true,
          actorStatus: "alive",
          actionState: "disabled:phase locked",
          statusText: "phase locked",
          privateCount: 0,
          privateReceipt: false,
          boundary:
            "Seeded browser action player stayed alive with no target-only N04 receipt after host resolved Night 4.",
        }),
      },
      expectedGame: game,
      assertHostPhaseTransitionActionProof: (args) => observedHost.push(args),
    }),
  );

  assert.deepEqual(
    observedHost.map((args) => [
      args.proof.id,
      args.actionId,
      args.streamSeq,
      args.expectedPhaseId,
    ]),
    [["host-resolve", "resolve_phase", 916, "N04"]],
  );
});

function nightFourActionProof({ game, baseRoleUrl }) {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl: baseRoleUrl,
    visitedRolePath: `/g/${game}`,
    surfaceTestId: "player-surface",
    setupResyncFromSeq: 914,
    setupSnapshotCommandState: {
      phase: { phaseId: "N04" },
      actions: [{ targets: ["slot-5"] }],
    },
    clickProof: {
      status: "passed",
      clickedAction: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      command: {
        game,
        actor_slot: "slot-7",
        action_id: "factional_kill",
        template_id: "factional_kill",
        targets: ["slot-5"],
        grant_id: "grant-factional-kill-n04",
      },
      commandStatus: { state: "ack", message: "Ack: stream seqs 915" },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitAction",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [
          "notifications",
          "investigationResults",
          "commandState",
        ],
      },
      receipts: [{ state: "ack" }],
      projectionCommandState: {
        phase: { phaseId: "N04" },
        actions: [],
        boundary: "Seeded browser Night 4 action ACK refreshed action state.",
      },
      checkpointReceiptState: "ack:Ack: stream seqs 915",
      checkpointActionStateAfterAck: "disabled:no legal action available",
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 915",
    },
  };
}

function nightFourPlayerSurfaceProof({
  game,
  sourceRoleUrl,
  visitedRolePath,
  slotField,
  slot,
  principalUserId,
  actorAlive,
  actorStatus,
  actionState,
  statusText,
  privateCount,
  privateReceipt,
  boundary,
}) {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    [slotField]: slot,
    principalUserId,
    checkpoint: {
      phaseId: "N04",
      phaseState: "locked",
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text: "principal-scoped endpoints",
    },
    voteButtonCount: 0,
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      phase: { phaseId: "N04", locked: true },
      actions: [],
      voteTargets: [],
      boundary,
    },
    projectionDayVoteOutcomes: [{ phaseId: "D04" }],
    resyncFromSeq: 916,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      phase: { phaseId: "N04" },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${principalUserId}`,
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${principalUserId}&slot_id=${slot}`,
    },
    ...(privateReceipt
      ? {
          privateNotice: {
            id: "notification-1",
            kind: "notification",
            text: "player_killed factional_kill",
            detailText: "Phase N04",
          },
          projectionNotifications: [
            {
              effect: "player_killed",
              status: "factional_kill",
            },
          ],
          resyncSnapshotNotifications: [{ status: "factional_kill" }],
        }
      : {
          privateEmptyText: "No private results visible",
          projectionNotifications: [],
          resyncSnapshotNotifications: [],
        }),
  };
}
