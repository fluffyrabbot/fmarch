import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayFiveNoLynchResolutionSurfaceProof,
  coreLoopDayFiveProgressionFamilyId,
  coreLoopDayFiveProgressionLaneIds,
  coreLoopDayFiveProgressionScenarioCases,
  coreLoopDayFiveProgressionScenarioFamily,
  dayFiveNoLynchResolutionSurfaceCase,
  dayFiveProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";
import {
  dayFiveNoLynchResolutionSurfaceFixture,
} from "./dev_test_game_core_loop_completed_game_fixtures.mjs";

test("Day 5 progression family shares no-lynch resolution and stale vote cases", () => {
  assert.equal(
    coreLoopDayFiveProgressionFamilyId,
    "core-loop-day-five-progression",
  );
  assert.deepEqual(coreLoopDayFiveProgressionLaneIds, [
    "day-vote-no-lynch",
    "action-loop",
  ]);
  const scenarioCases = coreLoopDayFiveProgressionScenarioCases();
  assert.deepEqual(
    scenarioCases.map((scenarioCase) => ({
      key: scenarioCase.key,
      group: scenarioCase.group,
      laneIds: scenarioCase.laneIds,
      scenario: scenarioCase.scenario,
    })),
    [
      {
        key: "dayFiveNoLynchResolution",
        group: "surfaces",
        laneIds: coreLoopDayFiveProgressionLaneIds,
        scenario: dayFiveNoLynchResolutionSurfaceCase(),
      },
      {
        key: "staleDayFiveVote",
        group: "staleRejects",
        laneIds: ["action-loop"],
        scenario:
          dayFiveNoLynchResolutionSurfaceCase().staleDayFiveVoteCase,
      },
    ],
  );

  const surfaceCase = dayFiveNoLynchResolutionSurfaceCase();
  assert.deepEqual(surfaceCase.transitionFragments, [
    "player:D05:no_lynch:ack:918",
    "host:D05:resolve_phase:ack:919",
    "host:advance_phase:ack:920",
    "actionPlayer:N05:no_action",
    "stale:D05:submit_vote:reject:PhaseLocked",
  ]);
  assert.equal(surfaceCase.voteCase.streamSeq, 918);
  assert.equal(surfaceCase.hostTransitionCase.resolveCase.streamSeq, 919);
  assert.equal(surfaceCase.hostTransitionCase.advanceCase.expectedPhaseId, "N05");
  assert.equal(surfaceCase.actionPlayerNightFiveCase.expectedPhaseId, "N05");
  assert.equal(surfaceCase.staleDayFiveVoteCase.refreshedPhaseId, "N05");

  const family = coreLoopDayFiveProgressionScenarioFamily();
  assert.equal(family.id, coreLoopDayFiveProgressionFamilyId);
  assert.deepEqual(family.laneIds, coreLoopDayFiveProgressionLaneIds);
  assert.deepEqual(family.surfaces, {
    dayFiveNoLynchResolution: dayFiveNoLynchResolutionSurfaceCase(),
  });
  assert.deepEqual(family.staleRejects, {
    staleDayFiveVote:
      dayFiveNoLynchResolutionSurfaceCase().staleDayFiveVoteCase,
  });
  assert.equal(
    family.surfaces.dayFiveNoLynchResolution.voteCase.expectedBoundaryText,
    "Day 5 no-lynch vote ACK",
  );
  assert.equal(
    family.staleRejects.staleDayFiveVote.refreshedBoundary,
    "stale D05 vote refreshed into current Night 5 controls",
  );
  assert.notEqual(
    dayFiveNoLynchResolutionSurfaceCase().transitionFragments,
    dayFiveNoLynchResolutionSurfaceCase().transitionFragments,
  );
  assert.notEqual(
    coreLoopDayFiveProgressionScenarioCases()[0].scenario.transitionFragments,
    coreLoopDayFiveProgressionScenarioCases()[0].scenario.transitionFragments,
  );
});

test("Day 5 no-lynch surface derives feature-spine row from D04 entrypoint", () => {
  assert.deepEqual(dayFiveProgressionFeatureSpineRows(), [
    {
      targetKey: "dayFiveNoLynchResolution",
      featureSlotId: "day-five-no-lynch-resolution",
      cycleId: "n03-d04",
      role: "actionPlayer",
      checkpointId: "n03-d04-d04-day-controls-return",
      adminCheckId: "core-loop",
    },
  ]);
});

test("Day 5 progression assertion delegates host and player observations", () => {
  const observedHost = [];
  const observedPlayer = [];
  const game = "game-a";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;

  assert.doesNotThrow(() =>
    assertDayFiveNoLynchResolutionSurfaceProof({
      dayFiveNoLynchResolutionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        transition:
          "player:D05:no_lynch:ack:918 -> host:D05:resolve_phase:ack:919 -> host:advance_phase:ack:920 -> actionPlayer:N05:no_action -> stale:D05:submit_vote:reject:PhaseLocked",
        dayFiveVoteProof: dayFiveVoteProof({ game, baseRoleUrl }),
        hostTransitionProof: dayFiveHostTransitionProof({ game, baseRoleUrl }),
        actionPlayerNightFiveProof: { id: "night-five-player" },
        staleDayFiveVoteRecoveryProof: staleDayFiveVoteProof({
          game,
          baseRoleUrl,
        }),
      },
      assertHostPhaseTransitionActionProof: (args) => observedHost.push(args),
      assertPostDayThreePlayerSurfaceProof: (args) => observedPlayer.push(args),
    }),
  );

  assert.deepEqual(
    observedHost.map((args) => [
      args.proof.id,
      args.actionId,
      args.streamSeq,
      args.expectedPhaseId,
    ]),
    [
      ["resolve", "resolve_phase", 919, "D05"],
      ["advance", "advance_phase", 920, "N05"],
    ],
  );
  assert.deepEqual(
    observedPlayer.map((args) => [
      args.proof.id,
      args.expectedPhaseId,
      args.expectedLastVoteOutcomePhaseId,
    ]),
    [["night-five-player", "N05", "D05"]],
  );
});

test("Day 5 fixture satisfies the shared progression assertion", () => {
  assert.doesNotThrow(() =>
    assertDayFiveNoLynchResolutionSurfaceProof({
      dayFiveNoLynchResolutionSurface:
        dayFiveNoLynchResolutionSurfaceFixture(),
      assertHostPhaseTransitionActionProof: () => {},
      assertPostDayThreePlayerSurfaceProof: () => {},
    }),
  );
});

function dayFiveVoteProof({ game, baseRoleUrl }) {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    targetOnlyReceiptVisible: false,
    sourceRoleUrl: baseRoleUrl,
    visitedRolePath: `/g/${game}`,
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    command: {
      game,
      actor_slot: "slot-7",
      target: "NoLynch",
    },
    commandStatus: { state: "ack", message: "Ack: stream seqs 918" },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitVote",
      commandEndpoint: "/commands",
      finalState: "ack",
      projectionRefreshKeys: ["votecount", "commandState"],
    },
    receipts: [{ state: "ack" }],
    projectionCommandState: {
      actorSlot: "slot-7",
      phase: { phaseId: "D05", locked: false },
      currentVote: { kind: "no_lynch" },
      boundary: "Seeded browser Day 5 no-lynch vote ACK refreshed.",
    },
    projectionVotecount: [{ target: "No lynch", count: 1, needed: 1 }],
    projectionDayVoteOutcomes: [{ phaseId: "D04" }],
    setupResyncFromSeq: 917,
    setupSnapshotCommandState: { phase: { phaseId: "D05" } },
    currentVote: { hasVote: "true", text: "Current vote: No lynch" },
    receiptCount: 1,
    receiptStatusText: "Ack: stream seqs 918",
    receiptRefreshKeys: "votecount,commandState",
  };
}

function dayFiveHostTransitionProof({ game, baseRoleUrl }) {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: `${baseRoleUrl}/host`,
    visitedRolePath: `/g/${game}/host`,
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 918,
    setupSnapshotHost: { phase: { id: "D05", state: "open" } },
    resolveProof: {
      id: "resolve",
      votecountProjection: [{ target: "No lynch" }],
      dayVoteOutcomesProjection: [{ phaseId: "D05", status: "NoLynch" }],
    },
    advanceProof: { id: "advance" },
  };
}

function staleDayFiveVoteProof({ game, baseRoleUrl }) {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    targetOnlyReceiptVisible: false,
    sourceRoleUrl: baseRoleUrl,
    visitedRolePath: `/g/${game}`,
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    setupResyncFromSeq: 918,
    setupSnapshotCommandState: {
      phase: { phaseId: "D05" },
      voteTargets: [{ kind: "no_lynch" }],
    },
    command: {
      game,
      actor_slot: "slot-7",
      target: "NoLynch",
    },
    commandStatus: {
      state: "reject",
      error: "PhaseLocked",
      message:
        "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
    },
    bridgePlan: {
      role: "player",
      commandKind: "SubmitVote",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["votecount", "commandState", "dayVoteOutcomes"],
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      actorSlot: "slot-7",
      phase: { phaseId: "N05", locked: false },
      actions: [],
      voteTargets: [],
      boundary:
        "Seeded browser PhaseLocked stale D05 vote refreshed into current Night 5 controls.",
    },
    checkpointReceiptState: "reject:PhaseLocked",
    checkpointPhaseIdAfterReject: "N05",
    checkpointActionStateAfterReject: "disabled:no legal action available",
    checkpointTargetSlotsAfterReject: "",
    recoveryText: "Reject PhaseLocked: refresh and use current vote controls.",
    receiptCount: 1,
    receiptStatusText: "Reject PhaseLocked",
  };
}
