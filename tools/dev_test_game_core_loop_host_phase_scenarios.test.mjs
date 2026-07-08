import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayFourNoLynchHostTransitionProofCase,
  assertEmptyNightThreeHostTransitionProofCase,
  assertHostAdvanceRaceSurfaceCase,
  assertHostControlRaceSurfaceCase,
  assertHostDeadlineAdvanceRaceSurfaceCase,
  assertHostLifecycleRaceSurfaceCase,
  assertHostNightActionTransitionSurfaceCase,
  assertHostLifecycleControlRoleSurfaceCase,
  assertHostMixedAdvanceRaceSurfaceCase,
  assertHostModkillControlSurfaceCase,
  assertHostPhaseTransitionActionProofCase,
  assertHostPublishRaceSurfaceCase,
  assertHostResolveRaceSurfaceCase,
  assertHostStaleAdvanceAfterTransitionProofCase,
  dayFourNoLynchHostTransitionProofCase,
  emptyNightThreeHostTransitionProofCase,
  hostAdvanceRaceScenario,
  hostAdvanceByDeadlineCommandFacts,
  hostAdvancePhaseCommandFacts,
  hostAdvancePhaseTransitionCase,
  hostCompleteGameCommandFacts,
  hostControlRaceScenarioCases,
  hostDeadlineAdvanceRaceScenario,
  hostDeadlineAffordanceForPhaseState,
  hostExtendDeadlineCommandFacts,
  hostLifecycleRaceScenario,
  hostLifecycleControlScenario,
  hostMixedAdvanceRaceScenario,
  hostModkillControlScenario,
  hostPublishRaceScenario,
  hostResolveRaceScenario,
  hostLockedPhaseTransitionCase,
  hostLockThreadCommandFacts,
  hostNightActionTransitionSurfaceCase,
  hostOpenPhaseTransitionCase,
  hostPhaseTransitionCaseForState,
  hostResolvePhaseTransitionCase,
  hostResolvePhaseCommandFacts,
  hostUnlockThreadCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  assertPostNightFourTransitionSurfaceCase,
  postNightFourTransitionSurfaceCase,
} from "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs";
import {
  assertPostDayThreePlayerSurfaceProofCase,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  assertStaleNightFourActionRecoveryProofCase,
} from "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs";
import {
  postNightFourTransitionSurfaceFixture,
} from "./dev_test_game_core_loop_late_action_fixtures.mjs";

const hostRoleUrl = (game) => `http://127.0.0.1:5173/g/${game}/host`;

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
    unlockActionId: "unlock_thread",
    unlockCommandKind: "UnlockThread",
    unlockAckStreamSeq: 602,
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

test("host phase scenario module exposes shared host-control race cases", () => {
  const raceCases = hostControlRaceScenarioCases();
  assert.deepEqual(
    raceCases.map((raceCase) => ({
      surfaceKey: raceCase.surfaceKey,
      surfaceField: raceCase.surfaceField,
      assertionArgument: raceCase.assertionArgument,
      metadata: raceCase.metadata,
      laneMap: raceCase.laneMap,
      scenario: raceCase.scenario,
    })),
    [
      {
        surfaceKey: "hostLifecycleRace",
        surfaceField: "hostLifecycleRaceSurface",
        assertionArgument: "hostLifecycleRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-lifecycle-race",
          reloadProofCheckId: "concurrent-host-lifecycle-race-reload",
        },
        laneMap: {
          hostLifecycleRace: "concurrent-host-lifecycle-race",
          hostLifecycleRaceReload: "concurrent-host-lifecycle-race-reload",
        },
        scenario: hostLifecycleRaceScenario(),
      },
      {
        surfaceKey: "hostPublishRace",
        surfaceField: "hostPublishRaceSurface",
        assertionArgument: "hostPublishRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-publish-race",
          reloadProofCheckId: "concurrent-host-publish-race-reload",
        },
        laneMap: {
          hostPublishRace: "concurrent-host-publish-race",
          hostPublishRaceReload: "concurrent-host-publish-race-reload",
        },
        scenario: hostPublishRaceScenario(),
      },
      {
        surfaceKey: "hostResolveRace",
        surfaceField: "hostResolveRaceSurface",
        assertionArgument: "hostResolveRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-resolve-race",
          reloadProofCheckId: "concurrent-host-resolve-race-reload",
        },
        laneMap: {
          hostResolveRace: "concurrent-host-resolve-race",
          hostResolveRaceReload: "concurrent-host-resolve-race-reload",
        },
        scenario: hostResolveRaceScenario(),
      },
      {
        surfaceKey: "hostAdvanceRace",
        surfaceField: "hostAdvanceRaceSurface",
        assertionArgument: "hostAdvanceRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-advance-race",
          reloadProofCheckId: "concurrent-host-advance-race-reload",
        },
        laneMap: {
          hostAdvanceRace: "concurrent-host-advance-race",
          hostAdvanceRaceReload: "concurrent-host-advance-race-reload",
        },
        scenario: hostAdvanceRaceScenario(),
      },
      {
        surfaceKey: "hostDeadlineAdvanceRace",
        surfaceField: "hostDeadlineAdvanceRaceSurface",
        assertionArgument: "hostDeadlineAdvanceRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-deadline-advance-race",
          reloadProofCheckId:
            "concurrent-host-deadline-advance-race-reload",
        },
        laneMap: {
          hostDeadlineAdvanceRace: "concurrent-host-deadline-advance-race",
          hostDeadlineAdvanceRaceReload:
            "concurrent-host-deadline-advance-race-reload",
        },
        scenario: hostDeadlineAdvanceRaceScenario(),
      },
      {
        surfaceKey: "hostMixedAdvanceRace",
        surfaceField: "hostMixedAdvanceRaceSurface",
        assertionArgument: "hostMixedAdvanceRaceSurface",
        metadata: {
          proofCheckId: "concurrent-host-mixed-advance-race",
          reloadProofCheckId: "concurrent-host-mixed-advance-race-reload",
        },
        laneMap: {
          hostMixedAdvanceRace: "concurrent-host-mixed-advance-race",
          hostMixedAdvanceRaceReload:
            "concurrent-host-mixed-advance-race-reload",
        },
        scenario: hostMixedAdvanceRaceScenario(),
      },
    ],
  );
  assert.notEqual(
    hostControlRaceScenarioCases()[2].scenario.allowedPageRoles,
    hostControlRaceScenarioCases()[2].scenario.allowedPageRoles,
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
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
      actionId: "resolve_phase",
      commandKind: "ResolvePhase",
      streamSeq: 905,
      expectedPhaseId: "N02",
      expectedPhaseState: "locked",
      deadlineAffordance: "unlock_thread,advance_phase",
      refreshKeys: ["host", "votecount", "dayVoteOutcomes", "hostPrompts"],
    }),
    advanceProof: hostPhaseTransitionProofFixture({
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
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
        sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
        visitedRolePath: "/g/game-a/host",
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
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
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

test("post-Night 4 transition surface case shares transition and observation facts", () => {
  assert.deepEqual(postNightFourTransitionSurfaceCase(), {
    surfaceTestId: "host-console-surface",
    transitionFragments: [
      "host:N04:advance_phase:ack:917",
      "deadPlayer:D05:dead_no_controls",
      "actionPlayer:D05:no_lynch_controls",
      "stale:N04:submit_action:reject:PhaseLocked",
    ],
    hostAdvanceSetupResyncFromSeq: 916,
    hostAdvanceSetupPhaseId: "N04",
    hostAdvanceSetupPhaseState: "locked",
    expectedHostAdvanceDayVoteOutcomePhaseId: "D04",
    hostAdvanceCase: {
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 917,
      expectedPhaseId: "D05",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
    },
    playerObservationCases: [
      {
        proofField: "deadPlayerDayFiveProof",
        sourceRoleUrlField: "sourceDeadPlayerRoleUrl",
        expectedSlot: "slot-3",
        slotField: "deadPlayerSlot",
        expectedPrincipalUserId: "player-seed",
        expectedPhaseId: "D05",
        expectedPhaseState: "open",
        expectedActorAlive: false,
        expectedActorStatus: "dead",
        expectedActionState: "disabled:actor is not alive",
        expectedStatusText: "actor is not alive",
        expectedPrivateCount: 1,
        expectedPrivateReceipt: true,
        expectedBoundaryText:
          "dead player stayed dead from the N02 factional kill",
        expectedResyncFromSeq: 917,
        expectedVoteButtonCount: 0,
        expectedVoteTargetCount: 0,
        expectedLastVoteOutcomePhaseId: "D04",
        expectedPrivateReceiptStatus: "factional_kill",
        expectedPrivateReceiptPhaseId: "N02",
      },
      {
        proofField: "actionPlayerDayFiveProof",
        sourceRoleUrlField: "sourceActionPlayerRoleUrl",
        expectedSlot: "slot-7",
        slotField: "actionPlayerSlot",
        expectedPrincipalUserId: "player_mira",
        expectedPhaseId: "D05",
        expectedPhaseState: "open",
        expectedActorAlive: true,
        expectedActorStatus: "alive",
        expectedActionState: "disabled:no legal action available",
        expectedStatusText: "no legal action available",
        expectedPrivateCount: 0,
        expectedPrivateReceipt: false,
        expectedBoundaryText: "open Day 5 no-lynch controls",
        expectedResyncFromSeq: 917,
        expectedVoteButtonCount: 1,
        expectedVoteTargetCount: 1,
        expectedLastVoteOutcomePhaseId: "D04",
        expectedPrivateReceiptStatus: "day_vote",
        expectedPrivateReceiptPhaseId: "D03",
      },
    ],
  });
  assert.notEqual(
    postNightFourTransitionSurfaceCase().transitionFragments,
    postNightFourTransitionSurfaceCase().transitionFragments,
  );
  assert.notEqual(
    postNightFourTransitionSurfaceCase().playerObservationCases,
    postNightFourTransitionSurfaceCase().playerObservationCases,
  );
});

test("post-Night 4 transition assertion delegates host, player, and stale checks", () => {
  const observedHost = [];
  const observedPlayers = [];
  const observedStale = [];
  const postNightFourTransitionSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceHostRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    sourceActionPlayerRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-7",
    sourceDeadPlayerRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-3",
    transition:
      "host:N04:advance_phase:ack:917 -> deadPlayer:D05:dead_no_controls -> actionPlayer:D05:no_lynch_controls -> stale:N04:submit_action:reject:PhaseLocked",
    hostAdvanceProof: {
      status: "passed",
      clickedThroughFromRoleUrl: true,
      releaseReady: false,
      productionReady: false,
      rawInviteTokensVisible: false,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 916,
      setupSnapshotHost: { phase: { id: "N04", state: "locked" } },
      advanceProof: {
        dayVoteOutcomesProjection: [{ phaseId: "D04" }],
      },
    },
    deadPlayerDayFiveProof: { id: "deadPlayer" },
    actionPlayerDayFiveProof: { id: "actionPlayer" },
    staleNightFourActionRecoveryProof: { id: "stale" },
  };

  assert.doesNotThrow(() =>
    assertPostNightFourTransitionSurfaceCase({
      postNightFourTransitionSurface,
      expectedGame: "game-a",
      assertHostPhaseTransitionActionProof: (args) => observedHost.push(args),
      assertPlayerSurfaceProof: (args) => observedPlayers.push(args),
      assertStaleActionRecoveryProof: (args) => observedStale.push(args),
    }),
  );
  assert.deepEqual(
    observedHost.map((args) => [
      args.actionId,
      args.streamSeq,
      args.expectedPhaseId,
      args.expectedPhaseState,
    ]),
    [["advance_phase", 917, "D05", "open"]],
  );
  assert.deepEqual(
    observedPlayers.map((args) => [
      args.proof.id,
      args.expectedPrincipalUserId,
      args.expectedCommandStateEndpoint,
      args.expectedNotificationsEndpoint,
      args.expectedVoteButtonCount,
      args.expectedPrivateReceiptStatus,
    ]),
    [
      [
        "deadPlayer",
        "player-seed",
        "/games/game-a/player-command-state?principal_user_id=player-seed&slot_id=slot-3",
        "/games/game-a/notifications?principal_user_id=player-seed",
        0,
        "factional_kill",
      ],
      [
        "actionPlayer",
        "player_mira",
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
        "/games/game-a/notifications?principal_user_id=player_mira",
        1,
        "day_vote",
      ],
    ],
  );
  assert.deepEqual(observedStale, [
    {
      proof: { id: "stale" },
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-7",
      includeEvidenceInError: false,
    },
  ]);
  assert.throws(
    () =>
      assertPostNightFourTransitionSurfaceCase({
        postNightFourTransitionSurface: {
          ...postNightFourTransitionSurface,
          transition: "host:N04:advance_phase:ack:917",
        },
        expectedGame: "game-a",
        assertHostPhaseTransitionActionProof: () => {},
        assertPlayerSurfaceProof: () => {},
        assertStaleActionRecoveryProof: () => {},
      }),
    /post-Night 4 transition surface/,
  );
});

test("post-Night 4 fixture satisfies the shared transition assertion", () => {
  assert.doesNotThrow(() =>
    assertPostNightFourTransitionSurfaceCase({
      postNightFourTransitionSurface: postNightFourTransitionSurfaceFixture(),
      expectedGame: "00000000-0000-0000-0000-000000000002",
      assertHostPhaseTransitionActionProof:
        assertHostPhaseTransitionActionProofCase,
      assertPlayerSurfaceProof: assertPostDayThreePlayerSurfaceProofCase,
      assertStaleActionRecoveryProof:
        assertStaleNightFourActionRecoveryProofCase,
    }),
  );
});

test("host lifecycle control assertion covers checkpoint, click, unlock, and stale reject", () => {
  const sourceRoleUrl = "http://127.0.0.1:5173/g/game-a/host";
  const visitedRolePath = "/g/game-a/host";
  const hostRoleSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceRoleUrl,
    visitedRolePath,
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
      sourceRoleUrl,
      visitedRolePath,
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
    hostLifecycleUnlockProof: {
      status: "passed",
      sourceRoleUrl,
      visitedRolePath,
      clickedAction: "unlock_thread",
      commandKind: "UnlockThread",
      command: { game: "game-a" },
      commandStatus: { state: "ack", message: "Ack: stream seqs 602" },
      commandOutcome: { state: "ack", message: "Ack: stream seqs 602" },
      bridgePlan: {
        role: "moderator",
        commandKind: "UnlockThread",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: [],
      },
      projection: { phase: { id: "D01", locked: false } },
      checkpointPhaseStateAfterAck: "open",
      checkpointDeadlineAffordanceAfterAck: "resolve_phase,lock_thread",
      statusText: "Ack: stream seqs 602",
      activityCount: 2,
      activityStatusText: "Ack: stream seqs 602",
    },
    hostLifecycleStaleRejectProof: {
      status: "passed",
      sourceRoleUrl,
      visitedRolePath,
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

test("host modkill control assertion covers ack, stale reject, and reload recovery", () => {
  const hostModkillControlSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("game-a"),
    proofCheckId: "host-modkill-control",
    staleProofCheckId: "stale-host-modkill",
    staleReloadProofCheckId: "stale-host-modkill-reload",
    hostModkillControl: {
      id: "host-modkill-control",
      label: "Host modkill control disables player commands",
      status: "passed",
      evidence: {
        targetSlot: "slot-7",
        modkillState: "ack",
        commandStatus: "modkilled",
        apiModkillStatus: "modkilled",
        actorStatusAfterModkill: "modkilled",
        directPostError: "SlotNotAlive",
        restoreState: "ack",
        apiRestoredStatus: "alive",
        actorStatusAfterRestore: "alive",
      },
    },
    staleHostModkill: {
      id: "stale-host-modkill",
      label: "Stale host modkill rejects current status",
      status: "passed",
      evidence: {
        rejectError: "InvalidTarget",
        staleLifecycle: "Alive",
        apiStatus: "modkilled",
        actorStatus: "modkilled",
      },
    },
    staleHostModkillReload: {
      id: "stale-host-modkill-reload",
      label: "Stale host modkill reloads terminal slot controls",
      status: "passed",
      evidence: {
        routeResponseStatus: 200,
        routeStatus: 200,
        lifecycle: "Modkilled",
        apiStatus: "modkilled",
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostModkillControlSurfaceCase({
      hostModkillControlSurface,
      expectedGame: "game-a",
      scenario: hostModkillControlScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostModkillControlSurfaceCase({
        hostModkillControlSurface: {
          ...hostModkillControlSurface,
          hostModkillControl: {
            ...hostModkillControlSurface.hostModkillControl,
            evidence: {
              ...hostModkillControlSurface.hostModkillControl.evidence,
              directPostError: null,
            },
          },
        },
        expectedGame: "game-a",
      }),
    /host modkill control surface/,
  );
});

test("host lifecycle race assertion covers convergence and reload lanes", () => {
  const hostLifecycleRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("race-game-a"),
    proofCheckId: "concurrent-host-lifecycle-race",
    reloadProofCheckId: "concurrent-host-lifecycle-race-reload",
    hostLifecycleRace: {
      id: "concurrent-host-lifecycle-race",
      label: "Concurrent host lifecycle commands converge",
      status: "passed",
      evidence: {
        ackRaceRole: "dead",
        rejectRaceRole: "modkill",
        ackActionId: "mark_dead",
        rejectActionId: "modkill_slot",
        game: "race-game-a",
        winningStatus: "dead",
        rejectError: "InvalidTarget",
        apiStatus: "dead",
      },
    },
    hostLifecycleRaceReload: {
      id: "concurrent-host-lifecycle-race-reload",
      label: "Concurrent host lifecycle race reloads terminal slot projections",
      status: "passed",
      evidence: {
        game: "race-game-a",
        winningStatus: "dead",
        deadRouteStatus: 200,
        modkillRouteStatus: 200,
        playerRouteStatus: 200,
        deadLifecycleLabel: "Dead",
        modkillLifecycleLabel: "Dead",
        playerStatus: "dead",
        apiStatus: "dead",
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostLifecycleRaceSurfaceCase({
      hostLifecycleRaceSurface,
      scenario: hostLifecycleRaceScenario(),
    }),
  );
  assert.doesNotThrow(() =>
    assertHostLifecycleRaceSurfaceCase({
      hostLifecycleRaceSurface: {
        ...hostLifecycleRaceSurface,
        hostLifecycleRace: {
          ...hostLifecycleRaceSurface.hostLifecycleRace,
          evidence: {
            ...hostLifecycleRaceSurface.hostLifecycleRace.evidence,
            ackRaceRole: "modkill",
            rejectRaceRole: "dead",
            ackActionId: "modkill_slot",
            rejectActionId: "mark_dead",
            winningStatus: "modkilled",
            apiStatus: "modkilled",
          },
        },
        hostLifecycleRaceReload: {
          ...hostLifecycleRaceSurface.hostLifecycleRaceReload,
          evidence: {
            ...hostLifecycleRaceSurface.hostLifecycleRaceReload.evidence,
            winningStatus: "modkilled",
            deadLifecycleLabel: "Modkilled",
            modkillLifecycleLabel: "Modkilled",
            playerStatus: "modkilled",
            apiStatus: "modkilled",
          },
        },
      },
      scenario: hostLifecycleRaceScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostLifecycleRaceSurfaceCase({
        hostLifecycleRaceSurface: {
          ...hostLifecycleRaceSurface,
          hostLifecycleRaceReload: {
            ...hostLifecycleRaceSurface.hostLifecycleRaceReload,
            evidence: {
              ...hostLifecycleRaceSurface.hostLifecycleRaceReload.evidence,
              modkillRouteStatus: 409,
            },
          },
        },
      }),
    /host lifecycle race surface/,
  );
});

test("host publish race assertion covers official-count convergence and reload lanes", () => {
  const hostPublishRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("publish-race-game-a"),
    proofCheckId: "concurrent-host-publish-race",
    reloadProofCheckId: "concurrent-host-publish-race-reload",
    hostPublishRace: {
      id: "concurrent-host-publish-race",
      label: "Concurrent host publishes converge",
      status: "passed",
      evidence: {
        game: "publish-race-game-a",
        targetSlot: "slot_5",
        targetCount: 3,
        ackRaceRole: "second",
        rejectRaceRole: "first",
        ackState: "ack",
        rejectError: "InvalidTarget",
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
    },
    hostPublishRaceReload: {
      id: "concurrent-host-publish-race-reload",
      label: "Concurrent host publish race reloads official count truth",
      status: "passed",
      evidence: {
        firstHostRouteStatus: 200,
        secondHostRouteStatus: 200,
        playerRouteStatus: 200,
        apiOfficialPostCount: 1,
        playerOfficialPostCount: 1,
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostPublishRaceSurfaceCase({
      hostPublishRaceSurface,
      scenario: hostPublishRaceScenario(),
    }),
  );
  assert.doesNotThrow(() =>
    assertHostPublishRaceSurfaceCase({
      hostPublishRaceSurface: {
        ...hostPublishRaceSurface,
        hostPublishRace: {
          ...hostPublishRaceSurface.hostPublishRace,
          evidence: {
            ...hostPublishRaceSurface.hostPublishRace.evidence,
            ackRaceRole: "first",
            rejectRaceRole: "second",
          },
        },
      },
      scenario: hostPublishRaceScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostPublishRaceSurfaceCase({
        hostPublishRaceSurface: {
          ...hostPublishRaceSurface,
          hostPublishRaceReload: {
            ...hostPublishRaceSurface.hostPublishRaceReload,
            evidence: {
              ...hostPublishRaceSurface.hostPublishRaceReload.evidence,
              playerOfficialPostCount: 2,
            },
          },
        },
      }),
    /host publish race surface/,
  );
});

test("host resolve race assertion covers phase-lock convergence and reload lanes", () => {
  const hostResolveRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("resolve-race-game-a"),
    proofCheckId: "concurrent-host-resolve-race",
    reloadProofCheckId: "concurrent-host-resolve-race-reload",
    hostResolveRace: {
      id: "concurrent-host-resolve-race",
      label: "Concurrent host resolves converge",
      status: "passed",
      evidence: {
        ackPageRole: "concurrent",
        rejectPageRole: "live",
        game: "resolve-race-game-a",
        ackState: "ack",
        rejectError: "PhaseLocked",
        lockedAfterRace: true,
        lockedAfterRestore: false,
      },
    },
    hostResolveRaceReload: {
      id: "concurrent-host-resolve-race-reload",
      label: "Concurrent host resolve race reloads locked host projections",
      status: "passed",
      evidence: {
        game: "resolve-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "D02", state: "locked", locked: true },
        concurrentPhase: { id: "D02", state: "locked", locked: true },
        apiLocked: true,
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostResolveRaceSurfaceCase({
      hostResolveRaceSurface,
      scenario: hostResolveRaceScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostResolveRaceSurfaceCase({
        hostResolveRaceSurface: {
          ...hostResolveRaceSurface,
          hostResolveRaceReload: {
            ...hostResolveRaceSurface.hostResolveRaceReload,
            evidence: {
              ...hostResolveRaceSurface.hostResolveRaceReload.evidence,
              apiLocked: false,
            },
          },
        },
      }),
    /host resolve race surface/,
  );
});

test("host advance race assertion covers phase advance convergence and reload lanes", () => {
  const hostAdvanceRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("advance-race-game-a"),
    proofCheckId: "concurrent-host-advance-race",
    reloadProofCheckId: "concurrent-host-advance-race-reload",
    hostAdvanceRace: {
      id: "concurrent-host-advance-race",
      label: "Concurrent host advances converge",
      status: "passed",
      evidence: {
        ackPageRole: "concurrent",
        rejectPageRole: "live",
        game: "advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N02",
      },
    },
    hostAdvanceRaceReload: {
      id: "concurrent-host-advance-race-reload",
      label: "Concurrent host advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "advance-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "N02", state: "open", locked: false },
        concurrentPhase: { id: "N02", state: "open", locked: false },
        apiPhase: "N02",
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostAdvanceRaceSurfaceCase({
      hostAdvanceRaceSurface,
      scenario: hostAdvanceRaceScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostAdvanceRaceSurfaceCase({
        hostAdvanceRaceSurface: {
          ...hostAdvanceRaceSurface,
          hostAdvanceRaceReload: {
            ...hostAdvanceRaceSurface.hostAdvanceRaceReload,
            evidence: {
              ...hostAdvanceRaceSurface.hostAdvanceRaceReload.evidence,
              apiPhase: "D02",
            },
          },
        },
      }),
    /host advance race surface/,
  );
});

test("host deadline advance race assertion covers deadline convergence and reload lanes", () => {
  const hostDeadlineAdvanceRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("deadline-advance-race-game-a"),
    proofCheckId: "concurrent-host-deadline-advance-race",
    reloadProofCheckId: "concurrent-host-deadline-advance-race-reload",
    hostDeadlineAdvanceRace: {
      id: "concurrent-host-deadline-advance-race",
      label: "Concurrent host deadline advances converge",
      status: "passed",
      evidence: {
        ackPageRole: "live",
        rejectPageRole: "concurrent",
        game: "deadline-advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N01",
      },
    },
    hostDeadlineAdvanceRaceReload: {
      id: "concurrent-host-deadline-advance-race-reload",
      label:
        "Concurrent host deadline advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "deadline-advance-race-game-a",
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
        livePhase: { id: "N01", state: "open", locked: false },
        concurrentPhase: { id: "N01", state: "open", locked: false },
        apiPhase: "N01",
        apiDeadline: null,
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostDeadlineAdvanceRaceSurfaceCase({
      hostDeadlineAdvanceRaceSurface,
      scenario: hostDeadlineAdvanceRaceScenario(),
    }),
  );
  assert.throws(
    () =>
      assertHostDeadlineAdvanceRaceSurfaceCase({
        hostDeadlineAdvanceRaceSurface: {
          ...hostDeadlineAdvanceRaceSurface,
          hostDeadlineAdvanceRaceReload: {
            ...hostDeadlineAdvanceRaceSurface.hostDeadlineAdvanceRaceReload,
            evidence: {
              ...hostDeadlineAdvanceRaceSurface.hostDeadlineAdvanceRaceReload
                .evidence,
              apiDeadline: "2026-01-01T00:00:00.000Z",
            },
          },
        },
      }),
    /host deadline advance race surface/,
  );
});

test("host mixed advance race assertion covers mixed advance convergence and reload lanes", () => {
  const hostMixedAdvanceRaceSurface = {
    status: "passed",
    sourceRoleUrl: hostRoleUrl("mixed-advance-race-game-a"),
    proofCheckId: "concurrent-host-mixed-advance-race",
    reloadProofCheckId: "concurrent-host-mixed-advance-race-reload",
    hostMixedAdvanceRace: {
      id: "concurrent-host-mixed-advance-race",
      label: "Concurrent host mixed advance commands converge",
      status: "passed",
      evidence: {
        ackRaceRole: "deadline",
        rejectRaceRole: "normal",
        ackActionId: "advance_phase_by_deadline",
        rejectActionId: "advance_phase",
        game: "mixed-advance-race-game-a",
        ackState: "ack",
        rejectError: "InvalidTarget",
        phaseAfterRace: "N01",
      },
    },
    hostMixedAdvanceRaceReload: {
      id: "concurrent-host-mixed-advance-race-reload",
      label: "Concurrent host mixed advance race reloads open host projections",
      status: "passed",
      evidence: {
        game: "mixed-advance-race-game-a",
        normalRouteStatus: 200,
        deadlineRouteStatus: 200,
        normalPhase: { id: "N01", state: "open", locked: false },
        deadlinePhase: { id: "N01", state: "open", locked: false },
        apiPhase: "N01",
        apiDeadline: null,
      },
    },
  };

  assert.doesNotThrow(() =>
    assertHostMixedAdvanceRaceSurfaceCase({
      hostMixedAdvanceRaceSurface,
      scenario: hostMixedAdvanceRaceScenario(),
    }),
  );
  assert.doesNotThrow(() =>
    assertHostMixedAdvanceRaceSurfaceCase({
      hostMixedAdvanceRaceSurface: {
        ...hostMixedAdvanceRaceSurface,
        hostMixedAdvanceRace: {
          ...hostMixedAdvanceRaceSurface.hostMixedAdvanceRace,
          evidence: {
            ...hostMixedAdvanceRaceSurface.hostMixedAdvanceRace.evidence,
            ackRaceRole: "normal",
            rejectRaceRole: "deadline",
            ackActionId: "advance_phase",
            rejectActionId: "advance_phase_by_deadline",
          },
        },
      },
      scenario: hostMixedAdvanceRaceScenario(),
    }),
  );
  assert.doesNotThrow(() =>
    assertHostControlRaceSurfaceCase({
      raceCase: hostControlRaceScenarioCases().find(
        (raceCase) => raceCase.surfaceKey === "hostMixedAdvanceRace",
      ),
      surface: hostMixedAdvanceRaceSurface,
    }),
  );
  assert.throws(
    () =>
      assertHostMixedAdvanceRaceSurfaceCase({
        hostMixedAdvanceRaceSurface: {
          ...hostMixedAdvanceRaceSurface,
          hostMixedAdvanceRace: {
            ...hostMixedAdvanceRaceSurface.hostMixedAdvanceRace,
            evidence: {
              ...hostMixedAdvanceRaceSurface.hostMixedAdvanceRace.evidence,
              rejectActionId: "advance_phase_by_deadline",
            },
          },
        },
      }),
    /host mixed advance race surface/,
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
  sourceRoleUrl,
  visitedRolePath,
}) {
  return {
    status: "passed",
    ...(sourceRoleUrl === undefined ? {} : { sourceRoleUrl }),
    ...(visitedRolePath === undefined ? {} : { visitedRolePath }),
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
