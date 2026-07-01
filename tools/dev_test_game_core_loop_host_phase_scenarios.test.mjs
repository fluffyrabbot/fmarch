import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostPhaseTransitionActionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

test("host phase transition ACK assertion covers resolve projection refresh", () => {
  const proof = {
    status: "passed",
    clickedAction: "resolve_phase",
    commandKind: "ResolvePhase",
    command: {
      game: "game-a",
      seed: 918273,
    },
    commandStatus: {
      state: "ack",
      message: "Ack: stream seqs 801",
    },
    commandOutcome: {
      state: "ack",
      message: "Ack: stream seqs 801",
    },
    bridgePlan: {
      role: "moderator",
      commandKind: "ResolvePhase",
      commandEndpoint: "/commands",
      finalState: "ack",
      projectionRefreshKeys: ["host", "votecount"],
    },
    projection: {
      phase: {
        id: "D02",
        state: "locked",
        locked: true,
      },
    },
    checkpointPhaseId: "D02",
    checkpointPhaseState: "locked",
    checkpointDeadlineAffordance: "unlock_thread,advance_phase",
    activityStatusText: "Ack: stream seqs 801",
  };

  assert.doesNotThrow(() =>
    assertHostPhaseTransitionActionProofCase({
      proof,
      expectedGame: "game-a",
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 801,
      expectedPhaseId: "D02",
      expectedPhaseState: "locked",
      expectedDeadlineAffordance: "unlock_thread,advance_phase",
      expectedRefreshKeys: ["host", "votecount"],
    }),
  );
  assert.throws(
    () =>
      assertHostPhaseTransitionActionProofCase({
        proof: {
          ...proof,
          bridgePlan: {
            ...proof.bridgePlan,
            projectionRefreshKeys: ["host"],
          },
        },
        expectedGame: "game-a",
        actionId: "resolve_phase",
        commandKind: "ResolvePhase",
        streamSeq: 801,
        expectedPhaseId: "D02",
        expectedPhaseState: "locked",
        expectedDeadlineAffordance: "unlock_thread,advance_phase",
        expectedRefreshKeys: ["host", "votecount"],
      }),
    /host resolve_phase transition ACK/,
  );
});
