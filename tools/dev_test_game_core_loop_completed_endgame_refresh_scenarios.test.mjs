import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompletedPlayerEndgameRefreshBrowserProof,
  completedPlayerEndgameRefreshScenario,
  completedPlayerReloadHardeningLaneCaseDefinitions,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";

test("completed player endgame refresh owns command, resync, and reveal expectations", () => {
  const scenario = completedPlayerEndgameRefreshScenario();
  assert.deepEqual(scenario, {
    proofField: "staleCompletedVoteRecoveryProof",
    transitionToken: "stale:D05:submit_vote:reject:GameAlreadyCompleted",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    commandSelector: "SubmitVote",
    commandButtonSelector:
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    setupReadySelector:
      '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
    rejectedBoundary:
      "Seeded browser GameAlreadyCompleted stale D05 vote refreshed into completed endgame controls.",
    staleBoundary:
      "Seeded browser stale completed-game vote proof opened with old Day 5 no-lynch controls.",
    expectedRefreshKeys: ["votecount", "commandState", "endgameSummary"],
    expectedResyncKey: "endgameSummary",
    expectedSummaryState: "revealed",
    expectedRevealSlot: "slot-7",
    expectedRoleKey: "godfather",
    expectedAlignment: "mafia",
  });
  assert.equal(
    completedPlayerReloadHardeningLaneCaseDefinitions().at(-1).id,
    "stale-player-complete-endgame-resync",
  );
});

test("completed player endgame refresh browser assertion covers all three recovery boundaries", () => {
  const proof = completedEndgameRefreshProofFixture();
  assert.doesNotThrow(() =>
    assertCompletedPlayerEndgameRefreshBrowserProof({ proof }),
  );
  assert.throws(
    () =>
      assertCompletedPlayerEndgameRefreshBrowserProof({
        proof: {
          ...proof,
          manualEndgameResync: {
            ...proof.manualEndgameResync,
            snapshotEndgameSummary: null,
          },
        },
      }),
    /completed player endgame refresh proof drifted/,
  );
});

function completedEndgameRefreshProofFixture() {
  const summary = {
    completed: true,
    winner: null,
    slots: [
      {
        slotId: "slot-7",
        roleKey: "godfather",
        alignment: "mafia",
        roleRevealed: true,
        alignmentRevealed: true,
      },
    ],
  };
  const surface = {
    state: "revealed",
    revealRows: [
      {
        testId: "player-endgame-reveal-slot-7",
        text: "Slot 7 Godfather Mafia Survived",
      },
    ],
  };
  return {
    game: "game-a",
    dispatchPlan: {
      projectionRefreshKeys: ["votecount", "commandState", "endgameSummary"],
    },
    coldLoadEndpointsAfterReject: {
      endgameSummaryEndpoint: "/games/game-a/endgame-summary",
    },
    resyncKeysAfterReject: ["thread", "endgameSummary", "commandState"],
    endgameSummaryAfterReject: summary,
    endgameSurfaceAfterReject: surface,
    manualEndgameResync: {
      fromSeq: 0,
      snapshotEndgameSummary: summary,
      surface,
    },
    apiEndgameSummaryAfterReject: {
      completed: true,
      slots: [
        {
          slot_id: "slot-7",
          role_key: "godfather",
          alignment: "mafia",
          role_revealed: true,
          alignment_revealed: true,
        },
      ],
    },
    stalePublicReloadAfterReject: {
      recoveredEndgameSummary: summary,
      endgameSurface: surface,
    },
  };
}
