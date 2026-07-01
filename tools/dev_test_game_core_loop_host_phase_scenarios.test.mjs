import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
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

test("host stale advance recovery assertion covers refreshed host controls", () => {
  const proof = {
    status: "passed",
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 801,
    setupSnapshotHost: {
      phase: { id: "D02", state: "locked" },
    },
    clickedAction: "advance_phase",
    commandKind: "AdvancePhase",
    command: { game: "game-a" },
    commandStatus: {
      state: "reject",
      error: "InvalidTarget",
      message: "stale phase state, refresh and use current controls",
    },
    commandOutcome: {
      state: "reject",
      error: "InvalidTarget",
      message: "stale phase state, refresh and use current controls",
    },
    bridgePlan: {
      role: "moderator",
      commandKind: "AdvancePhase",
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: ["host"],
    },
    projection: {
      phase: { id: "N02", state: "open", locked: false },
    },
    checkpointPhaseIdAfterReject: "N02",
    checkpointPhaseStateAfterReject: "open",
    checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
    activityStatusText: "Reject InvalidTarget: invalid target",
  };

  assert.doesNotThrow(() =>
    assertHostStaleAdvanceAfterTransitionProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertHostStaleAdvanceAfterTransitionProofCase({
        proof: {
          ...proof,
          bridgePlan: {
            ...proof.bridgePlan,
            projectionRefreshKeys: [],
          },
        },
        expectedGame: "game-a",
      }),
    /host stale advance recovery after transition/,
  );
});
