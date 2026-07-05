import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNightFourActionSubmissionSurfaceCase,
  assertNightFourResolutionReceiptSurfaceCase,
  coreLoopLateActionProgressionFamilyId,
  coreLoopLateActionProgressionLaneIds,
  coreLoopLateActionProgressionScenarioCases,
  coreLoopLateActionProgressionScenarioFamily,
  lateActionProgressionFeatureSpineRows,
  nightFourActionSubmissionSurfaceCase,
  nightFourResolutionReceiptSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  assertDayFourNoLynchVoteProofCase,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertHostPhaseTransitionActionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  nightFourActionSubmissionSurfaceFixture,
  nightFourResolutionReceiptSurfaceFixture,
} from "./dev_test_game_core_loop_late_action_fixtures.mjs";
import {
  postNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";

test("late action progression family shares Night 4 action and recovery cases", () => {
  assert.equal(
    coreLoopLateActionProgressionFamilyId,
    "core-loop-late-action-progression",
  );
  assert.deepEqual(coreLoopLateActionProgressionLaneIds, ["action-loop"]);
  const scenarioCases = coreLoopLateActionProgressionScenarioCases();
  assert.deepEqual(
    scenarioCases.map((scenarioCase) => ({
      key: scenarioCase.key,
      group: scenarioCase.group,
      laneId: scenarioCase.laneId,
      scenario: scenarioCase.scenario,
    })),
    [
      {
        key: "nightFourActionSubmission",
        group: "surfaces",
        laneId: "action-loop",
        scenario: nightFourActionSubmissionSurfaceCase(),
      },
      {
        key: "nightFourResolutionReceipt",
        group: "surfaces",
        laneId: "action-loop",
        scenario: nightFourResolutionReceiptSurfaceCase(),
      },
      {
        key: "postNightFourTransition",
        group: "surfaces",
        laneId: "action-loop",
        scenario: postNightFourTransitionSurfaceCase(),
      },
      {
        key: "staleNightFourAction",
        group: "staleRejects",
        laneId: "action-loop",
        scenario: staleNightFourActionRecoveryScenario(),
      },
    ],
  );

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
  assert.deepEqual(family.laneIds, coreLoopLateActionProgressionLaneIds);
  assert.deepEqual(family.surfaces, {
    nightFourActionSubmission: nightFourActionSubmissionSurfaceCase(),
    nightFourResolutionReceipt: nightFourResolutionReceiptSurfaceCase(),
    postNightFourTransition: scenarioCases.find(
      (scenarioCase) => scenarioCase.key === "postNightFourTransition",
    ).scenario,
  });
  assert.deepEqual(family.staleRejects, {
    staleNightFourAction: scenarioCases.find(
      (scenarioCase) => scenarioCase.key === "staleNightFourAction",
    ).scenario,
  });
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
  assert.notEqual(
    coreLoopLateActionProgressionScenarioCases()[0].scenario
      .transitionFragments,
    coreLoopLateActionProgressionScenarioCases()[0].scenario
      .transitionFragments,
  );
});

test("late action progression surfaces derive feature-spine rows from N04/D05 checkpoints", () => {
  assert.deepEqual(lateActionProgressionFeatureSpineRows(), [
    {
      targetKey: "nightFourNoActionSurface",
      featureSlotId: "night-four-no-action-surface",
      cycleId: "d04-n04-d05",
      role: "actionPlayer",
      checkpointId: "d04-n04-d05-n04-no-action-open",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "nightFourNoActionResolution",
      featureSlotId: "night-four-no-action-resolution",
      cycleId: "d04-n04-d05",
      role: "host",
      checkpointId: "d04-n04-d05-n04-resolved-no-action",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "postNightFourTransition",
      featureSlotId: "post-night-four-transition",
      cycleId: "d04-n04-d05",
      role: "actionPlayer",
      checkpointId: "d04-n04-d05-d05-day-controls-return",
      adminCheckId: "core-loop",
    },
  ]);
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

test("Night 4 action fixture satisfies the shared submission assertion", () => {
  assert.doesNotThrow(() =>
    assertNightFourActionSubmissionSurfaceCase({
      nightFourActionSubmissionSurface:
        nightFourActionSubmissionSurfaceFixture(),
      expectedGame: "00000000-0000-0000-0000-000000000002",
      assertDayFourNoLynchVoteProof: assertDayFourNoLynchVoteProofCase,
      assertDayFourNoLynchHostTransitionProof:
        assertDayFourNoLynchHostTransitionProofCase,
    }),
  );
});

test("Night 4 receipt fixture satisfies the shared privacy assertion", () => {
  assert.doesNotThrow(() =>
    assertNightFourResolutionReceiptSurfaceCase({
      nightFourResolutionReceiptSurface:
        nightFourResolutionReceiptSurfaceFixture(),
      expectedGame: "00000000-0000-0000-0000-000000000002",
      assertHostPhaseTransitionActionProof:
        assertHostPhaseTransitionActionProofCase,
    }),
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
