import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertEmptyNightThreeHostTransitionProofCase,
  assertHostNightActionTransitionSurfaceCase,
  assertHostLifecycleControlRoleSurfaceCase,
  assertHostPhaseTransitionActionProofCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
  dayFourNoLynchHostTransitionProofCase,
  emptyNightThreeHostTransitionProofCase,
  hostAdvanceByDeadlineCommandFacts,
  hostAdvancePhaseCommandFacts,
  hostAdvancePhaseTransitionCase,
  hostCompleteGameCommandFacts,
  hostDeadlineAffordanceForPhaseState,
  hostExtendDeadlineCommandFacts,
  hostLifecycleControlScenario,
  hostLockedPhaseTransitionCase,
  hostLockThreadCommandFacts,
  hostNightActionTransitionSurfaceCase,
  hostOpenPhaseTransitionCase,
  hostPhaseTransitionCaseForState,
  hostResolvePhaseTransitionCase,
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

test("host phase transition cases share command, phase, and refresh facts", () => {
  assert.deepEqual(
    hostResolvePhaseTransitionCase({ streamSeq: 801, expectedPhaseId: "D02" }),
    {
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 801,
      expectedPhaseId: "D02",
      expectedPhaseState: "locked",
      expectedRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
    },
  );
  assert.deepEqual(
    hostAdvancePhaseTransitionCase({ streamSeq: 802, expectedPhaseId: "N02" }),
    {
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 802,
      expectedPhaseId: "N02",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
    },
  );
  assert.notEqual(
    hostResolvePhaseTransitionCase({ streamSeq: 1, expectedPhaseId: "D01" })
      .expectedRefreshKeys,
    hostResolvePhaseTransitionCase({ streamSeq: 1, expectedPhaseId: "D01" })
      .expectedRefreshKeys,
  );
});

test("host night action transition surface case shares transition and observation facts", () => {
  assert.deepEqual(hostNightActionTransitionSurfaceCase(), {
    surfaceTestId: "host-console-surface",
    transitionFragments: [
      "resolve_phase:ack:905",
      "advance_phase:ack:906",
      "actionPlayer:D03",
      "target:D03",
      "normal:D03",
    ],
    resolveCase: {
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 905,
      expectedPhaseId: "N02",
      expectedPhaseState: "locked",
      expectedRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
    },
    advanceCase: {
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 906,
      expectedPhaseId: "D03",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
    },
    playerObservationCases: [
      {
        proofField: "actionPlayerObservationProof",
        sourceRoleUrlField: "sourceActionPlayerRoleUrl",
        expectedPrincipalUserId: "player_mira",
        expectedSlot: "slot-7",
        slotField: "actionPlayerSlot",
        expectedActorAlive: true,
        expectedActorStatus: "alive",
        expectedActionState: "disabled:no legal action available",
        expectedStatusText: "no legal action available",
        expectedPrivateCount: 0,
        expectedPrivateReceipt: false,
        expectedBoundaryText: "action player observed host AdvancePhase",
      },
      {
        proofField: "nightTargetObservationProof",
        sourceRoleUrlField: "sourceNightTargetRoleUrl",
        expectedPrincipalUserId: "player-seed",
        expectedSlot: "slot-3",
        slotField: "targetSlot",
        expectedActorAlive: false,
        expectedActorStatus: "dead",
        expectedActionState: "disabled:actor is not alive",
        expectedStatusText: "actor is not alive",
        expectedPrivateCount: 1,
        expectedPrivateReceipt: true,
        expectedBoundaryText: "killed target stayed dead",
      },
      {
        proofField: "normalObservationProof",
        sourceRoleUrlField: "sourceNormalRoleUrl",
        expectedPrincipalUserId: "player_rowan",
        expectedSlot: "slot-4",
        slotField: "normalSlot",
        expectedActorAlive: true,
        expectedActorStatus: "alive",
        expectedActionState: "disabled:no legal action available",
        expectedStatusText: "no legal action available",
        expectedPrivateCount: 0,
        expectedPrivateReceipt: false,
        expectedBoundaryText: "normal player observed open D03",
      },
    ],
  });
  assert.notEqual(
    hostNightActionTransitionSurfaceCase().transitionFragments,
    hostNightActionTransitionSurfaceCase().transitionFragments,
  );
  assert.notEqual(
    hostNightActionTransitionSurfaceCase().playerObservationCases,
    hostNightActionTransitionSurfaceCase().playerObservationCases,
  );
});

test("host night action transition assertion delegates player observation cases", () => {
  const observed = [];
  const hostNightActionTransitionSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceHostRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    sourceActionPlayerRoleUrl: "http://127.0.0.1:5173/g/game-a",
    sourceNightTargetRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-3",
    sourceNormalRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-4",
    visitedHostRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    transition:
      "resolve_phase:ack:905 -> advance_phase:ack:906 -> actionPlayer:D03 -> target:D03 -> normal:D03",
    resolveProof: hostPhaseTransitionProofFixture({
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 905,
      expectedPhaseId: "N02",
      expectedPhaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      refreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
    }),
    advanceProof: hostPhaseTransitionProofFixture({
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 906,
      expectedPhaseId: "D03",
      expectedPhaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      refreshKeys: [],
    }),
    actionPlayerObservationProof: { id: "action" },
    nightTargetObservationProof: { id: "target" },
    normalObservationProof: { id: "normal" },
  };

  assert.doesNotThrow(() =>
    assertHostNightActionTransitionSurfaceCase({
      hostNightActionTransitionSurface,
      expectedGame: "game-a",
      assertPlayerObservationProof: (args) => observed.push(args),
    }),
  );
  assert.deepEqual(
    observed.map((args) => [
      args.proof.id,
      args.expectedPrincipalUserId,
      args.expectedCommandStateEndpoint,
      args.expectedNotificationsEndpoint,
    ]),
    [
      [
        "action",
        "player_mira",
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
        "/games/game-a/notifications?principal_user_id=player_mira",
      ],
      [
        "target",
        "player-seed",
        "/games/game-a/player-command-state?principal_user_id=player-seed&slot_id=slot-3",
        "/games/game-a/notifications?principal_user_id=player-seed",
      ],
      [
        "normal",
        "player_rowan",
        "/games/game-a/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
        "/games/game-a/notifications?principal_user_id=player_rowan",
      ],
    ],
  );
  assert.throws(
    () =>
      assertHostNightActionTransitionSurfaceCase({
        hostNightActionTransitionSurface: {
          ...hostNightActionTransitionSurface,
          transition: "resolve_phase:ack:905",
        },
        expectedGame: "game-a",
        assertPlayerObservationProof: () => {},
      }),
    /host night action transition surface/,
  );
});

test("Day 4 no-lynch host transition case shares phase and projection facts", () => {
  assert.deepEqual(dayFourNoLynchHostTransitionProofCase(), {
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 912,
    setupPhaseId: "D04",
    setupPhaseState: "open",
    expectedVotecountTarget: "No lynch",
    expectedDayVoteOutcomePhaseId: "D04",
    expectedDayVoteOutcomeStatus: "NoLynch",
    resolveCase: {
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 913,
      expectedPhaseId: "D04",
      expectedPhaseState: "locked",
      expectedRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
    },
    advanceCase: {
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 914,
      expectedPhaseId: "N04",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
    },
  });
  assert.notEqual(
    dayFourNoLynchHostTransitionProofCase().resolveCase.expectedRefreshKeys,
    dayFourNoLynchHostTransitionProofCase().resolveCase.expectedRefreshKeys,
  );
});

test("Day 4 no-lynch host transition assertion covers shared projections", () => {
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 912,
    setupSnapshotHost: {
      phase: { id: "D04", state: "open" },
    },
    resolveProof: {
      ...hostPhaseTransitionProofFixture({
        actionId: "resolve_phase",
        commandKind: "ResolvePhase",
        streamSeq: 913,
        expectedPhaseId: "D04",
        expectedPhaseState: "locked",
        deadlineAffordance: "unlock_thread,advance_phase",
        refreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
      }),
      votecountProjection: [{ target: "No lynch" }],
      dayVoteOutcomesProjection: [
        { phaseId: "D03", status: "Lynch" },
        { phaseId: "D04", status: "NoLynch" },
      ],
    },
    advanceProof: hostPhaseTransitionProofFixture({
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 914,
      expectedPhaseId: "N04",
      expectedPhaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      refreshKeys: [],
    }),
  };

  assert.doesNotThrow(() =>
    assertDayFourNoLynchHostTransitionProofCase({
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    }),
  );
  assert.throws(
    () =>
      assertDayFourNoLynchHostTransitionProofCase({
        proof: {
          ...proof,
          resolveProof: {
            ...proof.resolveProof,
            dayVoteOutcomesProjection: [{ phaseId: "D04", status: "Lynch" }],
          },
        },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      }),
    /Day 4 no-lynch host projections/,
  );
});

test("empty Night 3 host transition case shares phase facts", () => {
  assert.deepEqual(emptyNightThreeHostTransitionProofCase(), {
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 909,
    setupPhaseId: "N03",
    setupPhaseState: "open",
    resolveCase: {
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 910,
      expectedPhaseId: "N03",
      expectedPhaseState: "locked",
      expectedRefreshKeys: [
        "host",
        "votecount",
        "dayVoteOutcomes",
        "hostPrompts",
      ],
    },
    advanceCase: {
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 911,
      expectedPhaseId: "D04",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
    },
  });
  assert.notEqual(
    emptyNightThreeHostTransitionProofCase().resolveCase.expectedRefreshKeys,
    emptyNightThreeHostTransitionProofCase().resolveCase.expectedRefreshKeys,
  );
});

test("empty Night 3 host transition assertion covers resolve and advance ACKs", () => {
  const observed = [];
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 909,
    setupSnapshotHost: {
      phase: { id: "N03", state: "open" },
    },
    resolveProof: hostPhaseTransitionProofFixture({
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 910,
      expectedPhaseId: "N03",
      expectedPhaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      refreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
    }),
    advanceProof: hostPhaseTransitionProofFixture({
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 911,
      expectedPhaseId: "D04",
      expectedPhaseState: "open",
      deadlineAffordance: "resolve_phase,lock_thread",
      refreshKeys: [],
    }),
  };

  assert.doesNotThrow(() =>
    assertEmptyNightThreeHostTransitionProofCase({
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      assertHostPhaseTransitionActionProof: (args) => observed.push(args),
    }),
  );
  assert.deepEqual(
    observed.map((args) => [
      args.actionId,
      args.streamSeq,
      args.expectedPhaseId,
      args.expectedPhaseState,
    ]),
    [
      ["resolve_phase", 910, "N03", "locked"],
      ["advance_phase", 911, "D04", "open"],
    ],
  );
  assert.throws(
    () =>
      assertEmptyNightThreeHostTransitionProofCase({
        proof: {
          ...proof,
          setupSnapshotHost: {
            phase: { id: "D04", state: "open" },
          },
        },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      }),
    /empty Night 3 host transition/,
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

function hostPhaseTransitionProofFixture({
  actionId,
  commandKind,
  streamSeq,
  expectedPhaseId,
  expectedPhaseState,
  deadlineAffordance,
  refreshKeys,
}) {
  return {
    status: "passed",
    clickedAction: actionId,
    commandKind,
    command: {
      game: "game-a",
      ...(commandKind === "ResolvePhase" ? { seed: 918273 } : {}),
    },
    commandStatus: {
      state: "ack",
      message: `Ack: stream seqs ${streamSeq}`,
    },
    commandOutcome: {
      state: "ack",
      message: `Ack: stream seqs ${streamSeq}`,
    },
    bridgePlan: {
      role: "moderator",
      commandKind,
      commandEndpoint: "/commands",
      finalState: "ack",
      projectionRefreshKeys: refreshKeys,
    },
    projection: {
      phase: {
        id: expectedPhaseId,
        state: expectedPhaseState,
        locked: expectedPhaseState === "locked",
      },
    },
    checkpointPhaseId: expectedPhaseId,
    checkpointPhaseState: expectedPhaseState,
    checkpointDeadlineAffordance: deadlineAffordance,
    activityStatusText: `Ack: stream seqs ${streamSeq}`,
  };
}
