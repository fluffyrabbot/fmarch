import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayThreeVoteResolutionSurfaceCase,
  dayThreeVoteResolutionLaneId,
  dayThreeVoteResolutionSurfaceCase,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";

test("Day 3 vote resolution scenario module exports proof lane id", () => {
  assert.equal(dayThreeVoteResolutionLaneId, "day-vote-resolution");
});

test("Day 3 vote resolution case shares vote and host resolution facts", () => {
  assert.deepEqual(dayThreeVoteResolutionSurfaceCase(), {
    transitionFragments: [
      "player:submit_vote:ack:907",
      "host:resolve_phase:ack:908",
    ],
    playerVoteCase: {
      surfaceTestId: "player-surface",
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
      actorSlot: "slot-7",
      targetSlot: "slot-4",
      targetLabel: "slot-4 / Rowan",
      streamSeq: 907,
      expectedPhaseId: "D03",
      previousOutcomePhaseId: "D02",
      expectedBoundaryText: "Day 3 vote ACK",
      expectedRefreshKeys: ["votecount", "commandState"],
      setupResyncFromSeq: 906,
      expectedReceiptRefreshKeys: "votecount,commandState",
    },
    hostResolutionCase: {
      surfaceTestId: "host-console-surface",
      targetLabel: "slot-4 / Rowan",
      expectedCount: 2,
      expectedNeeded: 2,
      expectedOutcomeIndex: 1,
      expectedOutcomePhaseId: "D03",
      expectedOutcomeStatus: "Lynch",
      expectedWinnerSlot: "slot-4",
      resolveCase: {
        actionId: "resolve_phase",
        commandKind: "ResolvePhase",
        streamSeq: 908,
        expectedPhaseId: "D03",
        expectedPhaseState: "locked",
        expectedRefreshKeys: [
          "host",
          "votecount",
          "dayVoteOutcomes",
          "hostPrompts",
        ],
      },
    },
  });
  assert.notEqual(
    dayThreeVoteResolutionSurfaceCase().transitionFragments,
    dayThreeVoteResolutionSurfaceCase().transitionFragments,
  );
  assert.notEqual(
    dayThreeVoteResolutionSurfaceCase().playerVoteCase,
    dayThreeVoteResolutionSurfaceCase().playerVoteCase,
  );
});

test("Day 3 vote resolution assertion delegates host resolve and covers vote proof", () => {
  const observedHost = [];
  const dayThreeVoteResolutionSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceActionPlayerRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-7",
    sourceHostRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    transition: "player:submit_vote:ack:907 -> host:resolve_phase:ack:908",
    playerVoteProof: {
      status: "passed",
      clickedThroughFromRoleUrl: true,
      releaseReady: false,
      productionReady: false,
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-7",
      visitedRolePath: "/g/game-a",
      surfaceTestId: "player-surface",
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
      command: {
        game: "game-a",
        actor_slot: "slot-7",
        target: { Slot: "slot-4" },
      },
      commandStatus: { state: "ack", message: "Ack: stream seqs 907" },
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
        phase: { phaseId: "D03", locked: false },
        currentVote: { slotId: "slot-4" },
        boundary: "Seeded browser Day 3 vote ACK refreshed current vote.",
      },
      projectionVotecount: [{ target: "slot-4 / Rowan", count: 2, needed: 2 }],
      projectionDayVoteOutcomes: [{ phaseId: "D02" }],
      setupResyncFromSeq: 906,
      setupSnapshotCommandState: { phase: { phaseId: "D03" } },
      currentVote: { hasVote: "true", text: "Slot 4 / Rowan" },
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 907",
      receiptRefreshKeys: "votecount,commandState",
    },
    hostResolutionProof: {
      status: "passed",
      clickedThroughFromRoleUrl: true,
      releaseReady: false,
      productionReady: false,
      rawInviteTokensVisible: false,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
      surfaceTestId: "host-console-surface",
      hostVotecountProjection: [
        { target: "slot-4 / Rowan", count: 2, needed: 2 },
      ],
      hostDayVoteOutcomesProjection: [
        { phaseId: "D02", status: "NoLynch" },
        { phaseId: "D03", status: "Lynch", winnerSlot: "slot-4" },
      ],
      resolveProof: {
        id: "resolve",
        votecountProjection: [{ target: "slot-4 / Rowan" }],
        dayVoteOutcomesProjection: [
          { phaseId: "D02" },
          { phaseId: "D03" },
        ],
      },
    },
  };

  assert.doesNotThrow(() =>
    assertDayThreeVoteResolutionSurfaceCase({
      dayThreeVoteResolutionSurface,
      expectedGame: "game-a",
      assertHostPhaseTransitionActionProof: (args) => observedHost.push(args),
    }),
  );
  assert.deepEqual(observedHost, [
    {
      proof: dayThreeVoteResolutionSurface.hostResolutionProof.resolveProof,
      expectedGame: "game-a",
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 908,
      expectedPhaseId: "D03",
      expectedPhaseState: "locked",
      expectedRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
      includeEvidenceInError: false,
    },
  ]);
  assert.throws(
    () =>
      assertDayThreeVoteResolutionSurfaceCase({
        dayThreeVoteResolutionSurface: {
          ...dayThreeVoteResolutionSurface,
          transition: "player:submit_vote:ack:907",
        },
        expectedGame: "game-a",
        assertHostPhaseTransitionActionProof: () => {},
      }),
    /Day 3 vote resolution surface/,
  );
});
