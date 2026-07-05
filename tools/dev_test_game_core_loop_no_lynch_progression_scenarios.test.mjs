import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayFourNoLynchVoteProofCase,
  coreLoopNoLynchProgressionFamilyId,
  coreLoopNoLynchProgressionLaneIds,
  coreLoopNoLynchProgressionScenarioCases,
  coreLoopNoLynchProgressionScenarioFamily,
  dayFourNoLynchResolutionSurfaceCase,
  dayFourNoLynchVoteProofCase,
} from "./dev_test_game_core_loop_no_lynch_progression_scenarios.mjs";
import {
  dayFiveNoLynchResolutionSurfaceCase,
} from "./dev_test_game_core_loop_day_five_progression_scenarios.mjs";

test("no-lynch progression family shares Day 4 and Day 5 no-lynch cases", () => {
  assert.equal(
    coreLoopNoLynchProgressionFamilyId,
    "core-loop-no-lynch-progression",
  );
  assert.deepEqual(coreLoopNoLynchProgressionLaneIds, [
    "day-vote-no-lynch",
    "action-loop",
  ]);
  const scenarioCases = coreLoopNoLynchProgressionScenarioCases();
  assert.deepEqual(
    scenarioCases.map((scenarioCase) => ({
      key: scenarioCase.key,
      group: scenarioCase.group,
      laneIds: scenarioCase.laneIds,
      scenario: scenarioCase.scenario,
    })),
    [
      {
        key: "dayFourNoLynchResolution",
        group: "surfaces",
        laneIds: coreLoopNoLynchProgressionLaneIds,
        scenario: dayFourNoLynchResolutionSurfaceCase(),
      },
      {
        key: "dayFiveNoLynchResolution",
        group: "surfaces",
        laneIds: coreLoopNoLynchProgressionLaneIds,
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

  const dayFour = dayFourNoLynchResolutionSurfaceCase();
  assert.deepEqual(dayFour.transitionFragments, [
    "player:D04:no_lynch:ack:912",
    "host:D04:resolve_phase:ack:913",
    "host:advance_phase:ack:914",
  ]);
  assert.equal(dayFour.voteCase.streamSeq, 912);
  assert.equal(dayFour.hostTransitionCase.resolveCase.streamSeq, 913);
  assert.equal(dayFour.hostTransitionCase.advanceCase.expectedPhaseId, "N04");

  const family = coreLoopNoLynchProgressionScenarioFamily();
  assert.equal(family.id, coreLoopNoLynchProgressionFamilyId);
  assert.deepEqual(family.laneIds, coreLoopNoLynchProgressionLaneIds);
  assert.deepEqual(family.surfaces, {
    dayFourNoLynchResolution: dayFourNoLynchResolutionSurfaceCase(),
    dayFiveNoLynchResolution: dayFiveNoLynchResolutionSurfaceCase(),
  });
  assert.deepEqual(family.staleRejects, {
    staleDayFiveVote:
      dayFiveNoLynchResolutionSurfaceCase().staleDayFiveVoteCase,
  });
  assert.deepEqual(
    family.surfaces.dayFourNoLynchResolution.voteCase,
    dayFourNoLynchVoteProofCase(),
  );
  assert.deepEqual(
    family.surfaces.dayFiveNoLynchResolution.voteCase,
    dayFiveNoLynchResolutionSurfaceCase().voteCase,
  );
  assert.equal(
    family.staleRejects.staleDayFiveVote.refreshedBoundary,
    "stale D05 vote refreshed into current Night 5 controls",
  );
  assert.notEqual(
    dayFourNoLynchResolutionSurfaceCase().voteCase.expectedRefreshKeys,
    dayFourNoLynchResolutionSurfaceCase().voteCase.expectedRefreshKeys,
  );
  assert.notEqual(
    coreLoopNoLynchProgressionScenarioCases()[0].scenario.voteCase
      .expectedRefreshKeys,
    coreLoopNoLynchProgressionScenarioCases()[0].scenario.voteCase
      .expectedRefreshKeys,
  );
});

test("Day 4 no-lynch vote assertion covers shared ACK facts", () => {
  assert.doesNotThrow(() =>
    assertDayFourNoLynchVoteProofCase({
      proof: dayFourVoteProofFixture(),
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
    }),
  );
  assert.throws(
    () =>
      assertDayFourNoLynchVoteProofCase({
        proof: {
          ...dayFourVoteProofFixture(),
          receiptRefreshKeys: "commandState",
        },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
      }),
    /Day 4 no-lynch vote ACK/,
  );
});

function dayFourVoteProofFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    targetOnlyReceiptVisible: false,
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
    visitedRolePath: "/g/game-a",
    surfaceTestId: "player-surface",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    command: {
      game: "game-a",
      actor_slot: "slot-7",
      target: "NoLynch",
    },
    commandStatus: { state: "ack", message: "Ack: stream seqs 912" },
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
      phase: { phaseId: "D04", locked: false },
      currentVote: { kind: "no_lynch" },
      boundary: "Seeded browser Day 4 no-lynch vote ACK refreshed.",
    },
    projectionVotecount: [{ target: "No lynch", count: 1, needed: 1 }],
    projectionDayVoteOutcomes: [{ phaseId: "D03" }],
    setupResyncFromSeq: 911,
    setupSnapshotCommandState: { phase: { phaseId: "D04" } },
    currentVote: { hasVote: "true", text: "Current vote: No lynch" },
    receiptCount: 1,
    receiptStatusText: "Ack: stream seqs 912",
    receiptRefreshKeys: "votecount,commandState",
  };
}
