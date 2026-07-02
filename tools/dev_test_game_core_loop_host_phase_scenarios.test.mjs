import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostLifecycleControlRoleSurfaceCase,
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
  hostAdvanceByDeadlineCommandFacts,
  hostAdvancePhaseCommandFacts,
  hostCompleteGameCommandFacts,
  hostDeadlineAffordanceForPhaseState,
  hostExtendDeadlineCommandFacts,
  hostLifecycleControlScenario,
  hostLockedPhaseTransitionCase,
  hostLockThreadCommandFacts,
  hostOpenPhaseTransitionCase,
  hostPhaseTransitionCaseForState,
  hostResolvePhaseCommandFacts,
  hostUnlockThreadCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

test("host phase scenario module exposes shared command facts", () => {
  assert.deepEqual(hostResolvePhaseCommandFacts(), {
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
  });
  assert.deepEqual(hostAdvancePhaseCommandFacts(), {
    actionId: "advance_phase",
    commandKind: "AdvancePhase",
  });
  assert.deepEqual(hostCompleteGameCommandFacts(), {
    actionId: "complete_game",
    commandKind: "CompleteGame",
  });
  assert.deepEqual(hostLockThreadCommandFacts(), {
    actionId: "lock_thread",
    commandKind: "LockThread",
  });
  assert.deepEqual(hostUnlockThreadCommandFacts(), {
    actionId: "unlock_thread",
    commandKind: "UnlockThread",
  });
  assert.deepEqual(hostExtendDeadlineCommandFacts(), {
    actionId: "extend_deadline",
    commandKind: "ExtendDeadline",
  });
  assert.deepEqual(hostAdvanceByDeadlineCommandFacts(), {
    actionId: "advance_phase_by_deadline",
    commandKind: "AdvancePhaseByDeadline",
  });
  assert.notEqual(
    hostResolvePhaseCommandFacts(),
    hostResolvePhaseCommandFacts(),
  );
});

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
        expectedRefreshKeys: ["host", "votecount"],
      }),
    /host resolve_phase transition ACK/,
  );
});

test("host phase scenario module exposes shared lifecycle control case", () => {
  assert.deepEqual(hostOpenPhaseTransitionCase(), {
    phaseState: "open",
    locked: false,
    deadlineAffordance: "resolve_phase,lock_thread",
  });
  assert.deepEqual(hostLockedPhaseTransitionCase(), {
    phaseState: "locked",
    locked: true,
    deadlineAffordance: "unlock_thread,advance_phase",
  });
  assert.deepEqual(hostPhaseTransitionCaseForState("open"), {
    phaseState: "open",
    locked: false,
    deadlineAffordance: "resolve_phase,lock_thread",
  });
  assert.equal(
    hostDeadlineAffordanceForPhaseState("locked"),
    "unlock_thread,advance_phase",
  );
  assert.deepEqual(hostLifecycleControlScenario(), {
    proofCheckId: "host-lifecycle-control",
    surfaceTestId: "host-console-surface",
    checkpointTestId: "host-lifecycle-control-checkpoint",
    role: "moderator",
    commandEndpoint: "/commands",
    actionId: "lock_thread",
    commandKind: "LockThread",
    ackStreamSeq: 601,
    openPhaseId: "D01",
    openPhaseState: "open",
    lockedPhaseState: "locked",
    slotId: "slot-7",
    actionState: "enabled:mark_dead,modkill_slot",
    openDeadlineAffordance: "resolve_phase,lock_thread",
    lockedDeadlineAffordance: "unlock_thread,advance_phase",
    visibleRows: [
      "phase",
      "slot",
      "actionState",
      "deadlineAffordance",
      "recovery",
    ],
  });
  assert.notEqual(
    hostLifecycleControlScenario(),
    hostLifecycleControlScenario(),
  );
  assert.notEqual(
    hostLifecycleControlScenario().visibleRows,
    hostLifecycleControlScenario().visibleRows,
  );
});

test("host lifecycle control assertion covers checkpoint, click, and stale reject", () => {
  const hostRoleSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    checkpointTestId: "host-lifecycle-control-checkpoint",
    hostLifecycleControlCheckpoint: {
      proofCheckId: "host-lifecycle-control",
      phaseId: "D01",
      phaseState: "open",
      slotId: "slot-7",
      actionState: "enabled:mark_dead,modkill_slot",
      deadlineAffordance: "resolve_phase,lock_thread",
      visibleRows: [
        "phase",
        "slot",
        "actionState",
        "deadlineAffordance",
        "recovery",
      ],
      recoveryText: "Reject PhaseLocked: phase locked",
      statusText: "Host lifecycle controls are reachable from this role URL",
    },
    hostLifecycleControlClickProof: {
      status: "passed",
      clickedAction: "lock_thread",
      commandKind: "LockThread",
      command: { game: "game-a" },
      commandStatus: { state: "ack", message: "Ack: stream seqs 601" },
      commandOutcome: { state: "ack", message: "Ack: stream seqs 601" },
      bridgePlan: {
        role: "moderator",
        commandKind: "LockThread",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [],
      },
      projection: { phase: { id: "D01", locked: true } },
      checkpointPhaseStateAfterAck: "locked",
      checkpointDeadlineAffordanceAfterAck: "unlock_thread,advance_phase",
      statusText: "Ack: stream seqs 601",
      activityCount: 1,
      activityStatusText: "Ack: stream seqs 601",
    },
    hostLifecycleStaleRejectProof: {
      status: "passed",
      clickedAction: "lock_thread",
      commandKind: "LockThread",
      command: { game: "game-a" },
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
        message: "Reject PhaseLocked: phase locked",
      },
      commandOutcome: {
        state: "reject",
        error: "PhaseLocked",
        message: "Reject PhaseLocked: phase locked",
      },
      bridgePlan: {
        role: "moderator",
        commandKind: "LockThread",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: ["host"],
      },
      projection: { phase: { id: "D01", locked: false } },
      checkpointPhaseStateAfterReject: "open",
      checkpointDeadlineAffordanceAfterReject: "resolve_phase,lock_thread",
      recoveryText: "Reject PhaseLocked: phase locked",
      activityCount: 1,
      activityStatusText: "Reject PhaseLocked: phase locked",
    },
  };

  assert.doesNotThrow(() =>
    assertHostLifecycleControlRoleSurfaceCase({
      hostRoleSurface,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertHostLifecycleControlRoleSurfaceCase({
        hostRoleSurface: {
          ...hostRoleSurface,
          hostLifecycleControlCheckpoint: {
            ...hostRoleSurface.hostLifecycleControlCheckpoint,
            deadlineAffordance: "resolve_phase",
          },
        },
        expectedGame: "game-a",
      }),
    /host lifecycle role checkpoint/,
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
