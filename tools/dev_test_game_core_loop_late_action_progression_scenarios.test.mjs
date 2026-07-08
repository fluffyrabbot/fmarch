import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNightFourNoActionSurfaceCase,
  assertNightFourNoActionResolutionSurfaceCase,
  coreLoopLateActionProgressionFamilyId,
  coreLoopLateActionProgressionLaneIds,
  coreLoopLateActionProgressionScenarioCases,
  coreLoopLateActionProgressionScenarioFamily,
  lateActionProgressionFeatureSpineRows,
  nightFourNoActionSurfaceCase,
  nightFourNoActionResolutionSurfaceCase,
} from "./dev_test_game_core_loop_late_action_progression_scenarios.mjs";
import {
  assertDayFourNoLynchVoteProofCase,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertHostPhaseTransitionActionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  nightFourNoActionSurfaceFixture,
  nightFourNoActionResolutionSurfaceFixture,
} from "./dev_test_game_core_loop_late_action_fixtures.mjs";
import {
  postNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  staleNightFourActionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";

test("late action progression family shares Night 4 no-action and recovery cases", () => {
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
        key: "nightFourNoAction",
        group: "surfaces",
        laneId: "action-loop",
        scenario: nightFourNoActionSurfaceCase(),
      },
      {
        key: "nightFourNoActionResolution",
        group: "surfaces",
        laneId: "action-loop",
        scenario: nightFourNoActionResolutionSurfaceCase(),
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
    nightFourNoActionSurfaceCase().transitionFragments,
    [
      "player:D04:no_lynch:ack:912",
      "host:D04:resolve_phase:ack:913",
      "host:advance_phase:ack:914",
      "actionPlayer:N04:no_action",
    ],
  );
  assert.equal(
    nightFourNoActionSurfaceCase().noActionCase.expectedActionCount,
    0,
  );
  assert.equal(
    nightFourNoActionSurfaceCase().noActionCase.expectedSubmitActionControls,
    0,
  );
  assert.equal(
    nightFourNoActionResolutionSurfaceCase().hostResolutionCase.resolveCase
      .streamSeq,
    916,
  );
  assert.equal(
    nightFourNoActionResolutionSurfaceCase().actionPlayerPrivacyScenario
      .privateReceipt,
    false,
  );
  assert.deepEqual(
    nightFourNoActionResolutionSurfaceCase().transitionFragments,
    [
      "host:N04:resolve_phase:ack:916",
      "actionPlayer:N04:no_action_privacy",
    ],
  );

  const family = coreLoopLateActionProgressionScenarioFamily();
  assert.equal(family.id, coreLoopLateActionProgressionFamilyId);
  assert.deepEqual(family.laneIds, coreLoopLateActionProgressionLaneIds);
  assert.deepEqual(family.surfaces, {
    nightFourNoAction: nightFourNoActionSurfaceCase(),
    nightFourNoActionResolution: nightFourNoActionResolutionSurfaceCase(),
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
    nightFourNoActionSurfaceCase().transitionFragments,
    nightFourNoActionSurfaceCase().transitionFragments,
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
      targetKey: "dayFourNoLynchVoteSubmitted",
      featureSlotId: "day-four-no-lynch-vote-submitted",
      cycleId: "d04-n04-d05",
      role: "actionPlayer",
      checkpointId: "d04-n04-d05-d04-no-lynch-vote-submitted",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayFourNoLynchResolution",
      featureSlotId: "day-four-no-lynch-resolution",
      cycleId: "d04-n04-d05",
      role: "host",
      checkpointId: "d04-n04-d05-d04-resolved-no-lynch",
      adminCheckId: "core-loop",
    },
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

test("late action progression assertion delegates Day 4 and checks Night 4 no-action surface", () => {
  const observedVotes = [];
  const observedHostTransitions = [];
  const game = "game-a";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;

  assert.doesNotThrow(() =>
    assertNightFourNoActionSurfaceCase({
      nightFourNoActionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        transition:
          "player:D04:no_lynch:ack:912 -> host:D04:resolve_phase:ack:913 -> host:advance_phase:ack:914 -> actionPlayer:N04:no_action",
        dayFourVoteProof: { id: "day-four-vote" },
        hostTransitionProof: { id: "day-four-host" },
        nightFourNoActionProof: nightFourNoActionProof({ game, baseRoleUrl }),
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
    assertNightFourNoActionResolutionSurfaceCase({
      nightFourNoActionResolutionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        transition:
          "host:N04:resolve_phase:ack:916 -> actionPlayer:N04:no_action_privacy",
        hostResolutionProof: {
          status: "passed",
          clickedThroughFromRoleUrl: true,
          releaseReady: false,
          productionReady: false,
          rawInviteTokensVisible: false,
          sourceRoleUrl: `${baseRoleUrl}/host`,
          visitedRolePath: `/g/${game}/host`,
          surfaceTestId: "host-console-surface",
          setupResyncFromSeq: 914,
          setupSnapshotHost: { phase: { id: "N04", state: "open" } },
          resolveProof: { id: "host-resolve" },
        },
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
            "Seeded browser action player observed locked Night 4 after no-action host resolution with no private receipt.",
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

test("Night 4 no-action fixture satisfies the shared surface assertion", () => {
  assert.doesNotThrow(() =>
    assertNightFourNoActionSurfaceCase({
      nightFourNoActionSurface:
        nightFourNoActionSurfaceFixture(),
      expectedGame: "00000000-0000-0000-0000-000000000002",
      assertDayFourNoLynchVoteProof: assertDayFourNoLynchVoteProofCase,
      assertDayFourNoLynchHostTransitionProof:
        assertDayFourNoLynchHostTransitionProofCase,
    }),
  );
});

test("Night 4 no-action resolution fixture satisfies the shared privacy assertion", () => {
  assert.doesNotThrow(() =>
    assertNightFourNoActionResolutionSurfaceCase({
      nightFourNoActionResolutionSurface:
        nightFourNoActionResolutionSurfaceFixture(),
      expectedGame: "00000000-0000-0000-0000-000000000002",
      assertHostPhaseTransitionActionProof:
        assertHostPhaseTransitionActionProofCase,
    }),
  );
});

function nightFourNoActionProof({ game, baseRoleUrl }) {
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
      actions: [],
    },
    checkpoint: {
      phaseId: "N04",
      phaseState: "open",
      actorSlot: "slot-7",
      actionCount: 0,
      submitActionControls: 0,
      voteTargetCount: 0,
      privateCount: 0,
    },
    projectionCommandState: {
      actorSlot: "slot-7",
      actorAlive: true,
      actorStatus: "alive",
      phase: { phaseId: "N04", locked: false },
      actions: [],
      voteTargets: [],
      boundary: "Seeded browser opened Night 4 with no legal action available.",
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
      text: "delivered to you alone",
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
