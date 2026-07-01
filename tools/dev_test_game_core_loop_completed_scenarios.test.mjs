import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompletedActionPlayerSurfaceProofCase,
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  assertCompletedHostReloadProofCase,
  assertHostCompleteGameProofCase,
  completedActionPlayerSurfaceAssertionCase,
  completedActionPlayerSurfaceProofArgs,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameSurfaceAssertionCases,
  completedGameEndgameTransition,
  completedDeadPlayerStaleVoteCase,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCases,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

test("completed-game scenario module exposes shared frozen definitions", () => {
  assert(Object.isFrozen(completedHostStaleCommandCaseDefinitions));
  assert(Object.isFrozen(completedPlayerReloadCaseDefinitions));
  assert(Object.isFrozen(staleCompletedGamePlayerCommandCaseDefinitions));
  assert(Object.isFrozen(completedDeadPlayerStaleVoteCaseDefinition));
  assert.deepEqual(
    completedHostStaleCommandCases(),
    completedHostStaleCommandCaseDefinitions,
  );
  assert.deepEqual(
    completedPlayerReloadCases(),
    completedPlayerReloadCaseDefinitions,
  );
  assert.deepEqual(
    staleCompletedGamePlayerCommandCases(),
    staleCompletedGamePlayerCommandCaseDefinitions,
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteCase(),
    completedDeadPlayerStaleVoteCaseDefinition,
  );
  assert.notEqual(
    completedHostStaleCommandCases()[0],
    completedHostStaleCommandCaseDefinitions[0],
  );
  assert.notEqual(
    completedPlayerReloadCases()[0],
    completedPlayerReloadCaseDefinitions[0],
  );
  assert.notEqual(
    staleCompletedGamePlayerCommandCases()[0],
    staleCompletedGamePlayerCommandCaseDefinitions[0],
  );
  assert.notEqual(
    completedDeadPlayerStaleVoteCase(),
    completedDeadPlayerStaleVoteCaseDefinition,
  );
});

test("completed-game scenario module builds player reload proof cases", () => {
  const proofCases = completedPlayerReloadProofCases({
    actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
    commandStateBuilders: commandStateBuildersFixture(),
  });

  assert.deepEqual(
    proofCases.map((scenario) => ({
      proofField: scenario.proofField,
      roleUrl: scenario.roleUrl,
      cookieValue: scenario.cookieValue,
      commandStateKind: scenario.commandStateKind,
      commandStateBoundary: scenario.commandState.boundary,
    })),
    [
      {
        proofField: "completedPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/action",
        cookieValue: "fixture-player",
        commandStateKind: "action-player",
        commandStateBoundary:
          "Seeded browser completed action-player role URL reloaded into durable endgame controls.",
      },
      {
        proofField: "completedNormalPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/normal",
        cookieValue: "fixture-normal",
        commandStateKind: "normal-player",
        commandStateBoundary:
          "Seeded browser completed normal-player role URL reloaded into durable endgame controls.",
      },
      {
        proofField: "completedDeadPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/dead",
        cookieValue: "fixture-target",
        commandStateKind: "dead-player",
        commandStateBoundary:
          "Seeded browser completed dead-player role URL reloaded into durable endgame controls.",
      },
    ],
  );
});

test("completed-game scenario module derives shared assertion cases", () => {
  const completedGameEndgameSurface = {
    completedPlayerReloadProof: { id: "action-reload-proof" },
    completedNormalPlayerReloadProof: { id: "normal-reload-proof" },
    completedDeadPlayerReloadProof: { id: "dead-reload-proof" },
    completedHostStaleResolveRecoveryProof: { id: "host-resolve-stale" },
    completedHostStaleAdvanceRecoveryProof: { id: "host-advance-stale" },
    completedHostStaleCompleteRecoveryProof: { id: "host-complete-stale" },
    completedDeadPlayerStaleVoteRecoveryProof: { id: "dead-stale-vote" },
    staleCompletedVoteRecoveryProof: { id: "stale-completed-vote" },
    staleCompletedPostRecoveryProof: { id: "stale-completed-post" },
    sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    sourceNormalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    sourceDeadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
  };

  assert.deepEqual(
    completedPlayerReloadAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      cases: completedPlayerReloadCases(),
    }).map((scenario) => ({
      proof: scenario.proof,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedSlot: scenario.expectedSlot,
      principalUserId: scenario.principalUserId,
    })),
    [
      {
        proof: { id: "action-reload-proof" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedSlot: "slot-7",
        principalUserId: "player_mira",
      },
      {
        proof: { id: "normal-reload-proof" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/normal",
        expectedSlot: "slot-4",
        principalUserId: "player_rowan",
      },
      {
        proof: { id: "dead-reload-proof" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
        expectedSlot: "slot-2",
        principalUserId: "player_ilya",
      },
    ],
  );

  assert.deepEqual(
    completedGameEndgameStaleRejectAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
      sourceDeadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      assertCompletedHostStaleCommandRecoveryProof: assertProofFixture,
      assertCompletedDeadPlayerStaleVoteRecoveryProof: assertProofFixture,
      assertStaleCompletedGamePlayerCommandRecoveryProof: assertProofFixture,
    }).map((scenario) => ({
      proof: scenario.proof,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedCommandKind: scenario.expectedCommandKind ?? null,
      commandKind: scenario.scenario?.commandKind ?? null,
    })),
    [
      {
        proof: { id: "host-resolve-stale" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "ResolvePhase",
        commandKind: null,
      },
      {
        proof: { id: "host-advance-stale" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "AdvancePhase",
        commandKind: null,
      },
      {
        proof: { id: "host-complete-stale" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "CompleteGame",
        commandKind: null,
      },
      {
        proof: { id: "dead-stale-vote" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      {
        proof: { id: "stale-completed-vote" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      {
        proof: { id: "stale-completed-post" },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: "SubmitPost",
      },
    ],
  );
});

test("completed-game scenario module derives stale host and dead-player assertion cases", () => {
  const completedGameEndgameSurface = {
    completedHostStaleResolveRecoveryProof: { id: "host-resolve-stale" },
    completedHostStaleAdvanceRecoveryProof: { id: "host-advance-stale" },
    completedHostStaleCompleteRecoveryProof: { id: "host-complete-stale" },
    completedDeadPlayerStaleVoteRecoveryProof: { id: "dead-stale-vote" },
  };
  const [resolveScenario, advanceScenario, completeScenario] =
    completedHostStaleCommandCases();
  const deadPlayerScenario = completedDeadPlayerStaleVoteCase();

  assert.deepEqual(
    completedHostStaleCommandProofArgs({
      expectedGame: "game-a",
      sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
      scenario: resolveScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
      expectedCommandKind: "ResolvePhase",
    },
  );
  assert.deepEqual(
    completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
      assertCompletedHostStaleCommandRecoveryProof: assertProofFixture,
    }),
    [
      {
        assertProof: assertProofFixture,
        proof: { id: "host-resolve-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "ResolvePhase",
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "host-advance-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "AdvancePhase",
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "host-complete-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "CompleteGame",
      },
    ],
  );
  assert.deepEqual(
    [resolveScenario, advanceScenario, completeScenario].map(
      (scenario) => scenario.commandKind,
    ),
    ["ResolvePhase", "AdvancePhase", "CompleteGame"],
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteProofArgs({
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    },
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      assertCompletedDeadPlayerStaleVoteRecoveryProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: { id: "dead-stale-vote" },
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    },
  );
});

test("completed-game scenario module derives action-player completed surface case", () => {
  const completedGameEndgameSurface = {
    actionPlayerCompletedProof: { id: "action-player-complete" },
    sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
  };

  assert.deepEqual(
    completedActionPlayerSurfaceProofArgs({
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedPrincipalUserId: "player_mira",
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:game complete",
      expectedStatusText: "game complete",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "completed game endgame state",
      expectedResyncFromSeq: 921,
      expectedCommandStateEndpoint:
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  );
  assert.deepEqual(
    completedActionPlayerSurfaceAssertionCase({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      assertActionPlayerCompletedProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: { id: "action-player-complete" },
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedPrincipalUserId: "player_mira",
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:game complete",
      expectedStatusText: "game complete",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "completed game endgame state",
      expectedResyncFromSeq: 921,
      expectedCommandStateEndpoint:
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  );
});

test("completed-game scenario module derives stale completed-player command assertion cases", () => {
  const completedGameEndgameSurface = {
    staleCompletedVoteRecoveryProof: { id: "stale-completed-vote" },
    staleCompletedPostRecoveryProof: { id: "stale-completed-post" },
  };
  const [voteScenario, postScenario] = staleCompletedGamePlayerCommandCases();

  assert.deepEqual(
    staleCompletedGamePlayerCommandProofArgs({
      expectedGame: "game-a",
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      scenario: voteScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
      scenario: voteScenario,
    },
  );
  assert.deepEqual(
    staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      assertStaleCompletedGamePlayerCommandRecoveryProof: assertProofFixture,
    }),
    [
      {
        assertProof: assertProofFixture,
        proof: { id: "stale-completed-vote" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        scenario: voteScenario,
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "stale-completed-post" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        scenario: postScenario,
      },
    ],
  );
});

test("completed-game scenario module derives shared surface assertion sequence", () => {
  const completedGameEndgameSurface = {
    hostCompleteProof: { id: "host-complete" },
    completedHostReloadProof: { id: "host-reload" },
    actionPlayerCompletedProof: {
      id: "action-player-complete",
      projectionCommandState: { gameCompleted: true },
      resyncSnapshotCommandState: { gameCompleted: true },
    },
    completedPlayerReloadProof: { id: "action-reload-proof" },
    completedNormalPlayerReloadProof: { id: "normal-reload-proof" },
    completedDeadPlayerReloadProof: { id: "dead-reload-proof" },
    completedHostStaleResolveRecoveryProof: { id: "host-resolve-stale" },
    completedHostStaleAdvanceRecoveryProof: { id: "host-advance-stale" },
    completedHostStaleCompleteRecoveryProof: { id: "host-complete-stale" },
    completedDeadPlayerStaleVoteRecoveryProof: { id: "dead-stale-vote" },
    staleCompletedVoteRecoveryProof: { id: "stale-completed-vote" },
    staleCompletedPostRecoveryProof: { id: "stale-completed-post" },
    sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
    sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    sourceNormalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    sourceDeadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
  };
  const asserted = [];
  const cases = completedGameEndgameSurfaceAssertionCases({
    completedGameEndgameSurface,
    expectedGame: "game-a",
    assertHostCompleteGameProof: recordAssertion("host-complete", asserted),
    assertCompletedHostReloadProof: recordAssertion("host-reload", asserted),
    assertActionPlayerCompletedProof: recordAssertion(
      "action-player-complete",
      asserted,
    ),
    assertCompletedHostStaleCommandRecoveryProof: recordAssertion(
      "host-stale",
      asserted,
    ),
    assertCompletedDeadPlayerStaleVoteRecoveryProof: recordAssertion(
      "dead-stale-vote",
      asserted,
    ),
    assertCompletedPlayerReloadProof: recordAssertion(
      "player-reload",
      asserted,
    ),
    assertStaleCompletedGamePlayerCommandRecoveryProof: recordAssertion(
      "player-stale",
      asserted,
    ),
  });

  assert.deepEqual(
    cases.map((scenario) => ({
      assertProofName: scenario.assertProof.assertionName,
      proof: scenario.proof.id,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedCommandKind: scenario.expectedCommandKind ?? null,
      commandKind: scenario.scenario?.commandKind ?? null,
    })),
    [
      {
        assertProofName: "host-complete",
        proof: "host-complete",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "host-reload",
        proof: "host-reload",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "action-player-complete",
        proof: "action-player-complete",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "player-reload",
        proof: "action-reload-proof",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "player-reload",
        proof: "normal-reload-proof",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/normal",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "player-reload",
        proof: "dead-reload-proof",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "host-stale",
        proof: "host-resolve-stale",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "ResolvePhase",
        commandKind: null,
      },
      {
        assertProofName: "host-stale",
        proof: "host-advance-stale",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "AdvancePhase",
        commandKind: null,
      },
      {
        assertProofName: "host-stale",
        proof: "host-complete-stale",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "CompleteGame",
        commandKind: null,
      },
      {
        assertProofName: "dead-stale-vote",
        proof: "dead-stale-vote",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      {
        assertProofName: "player-stale",
        proof: "stale-completed-vote",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      {
        assertProofName: "player-stale",
        proof: "stale-completed-post",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: "SubmitPost",
      },
    ],
  );

  assertCompletedGameEndgameSurfaceAssertionCases({
    cases,
    completedGameEndgameSurface,
  });
  assert.deepEqual(asserted, [
    "host-complete",
    "host-reload",
    "action-player-complete",
    "player-reload",
    "player-reload",
    "player-reload",
    "host-stale",
    "host-stale",
    "host-stale",
    "dead-stale-vote",
    "player-stale",
    "player-stale",
  ]);
});

test("completed-game scenario module asserts host complete-game proof shell", () => {
  const hostPhaseAssertions = [];
  const proof = hostCompleteGameProofFixture();

  assertHostCompleteGameProofCase({
    proof,
    expectedGame: "game-a",
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    assertHostPhaseTransitionActionProof: (scenario) => {
      hostPhaseAssertions.push(scenario);
    },
  });

  assert.deepEqual(hostPhaseAssertions, [
    {
      proof: proof.completeProof,
      expectedGame: "game-a",
      actionId: "complete_game",
      commandKind: "CompleteGame",
      streamSeq: 921,
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "none",
      expectedRefreshKeys: [],
    },
  ]);
});

test("completed-game scenario module asserts completed host reload shell", () => {
  assertCompletedHostReloadProofCase({
    proof: completedHostReloadProofFixture(),
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
  });
});

test("completed-game scenario module delegates action-player completed assertion", () => {
  const asserted = [];
  const proof = { id: "action-player-complete" };
  assertCompletedActionPlayerSurfaceProofCase({
    proof,
    expectedGame: "game-a",
    sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
    assertPostDayThreePlayerSurfaceProof: (scenario) => {
      asserted.push(scenario);
    },
  });

  assert.deepEqual(asserted, [
    {
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedPrincipalUserId: "player_mira",
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:game complete",
      expectedStatusText: "game complete",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "completed game endgame state",
      expectedResyncFromSeq: 921,
      expectedCommandStateEndpoint:
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  ]);
});

test("completed-game shared host assertions fail closed", () => {
  assert.throws(
    () =>
      assertHostCompleteGameProofCase({
        proof: {
          ...hostCompleteGameProofFixture(),
          setupSnapshotHost: { phase: { id: "D05", state: "open" } },
        },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        assertHostPhaseTransitionActionProof: assertProofFixture,
      }),
    /host complete-game setup/,
  );
  assert.throws(
    () =>
      assertCompletedHostReloadProofCase({
        proof: {
          ...completedHostReloadProofFixture(),
          reloadedSnapshot: {
            ...completedHostReloadSnapshotFixture(),
            actionTiles: [{ action: "complete_game" }],
          },
        },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
      }),
    /reloaded completed host reload closure/,
  );
});

test("completed-game transition covers every stale and reload scenario", () => {
  const transition = completedGameEndgameTransition();
  assertCompletedGameEndgameTransition({ transition });
  for (const scenario of [
    ...completedHostStaleCommandCases(),
    ...completedPlayerReloadCases(),
    completedDeadPlayerStaleVoteCase(),
    ...staleCompletedGamePlayerCommandCases(),
  ]) {
    assert.match(transition, new RegExp(escapeRegExp(scenario.transitionToken)));
  }
});

test("completed-game reload proof cases fail closed for unknown command state", () => {
  assert.throws(
    () =>
      completedPlayerReloadProofCases({
        actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
        normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
        deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
        commandStateBuilders: {},
      }),
    /unknown completed player reload command state: action-player/,
  );
});

function commandStateBuildersFixture() {
  return {
    "action-player": ({ boundary }) => ({ kind: "action", boundary }),
    "normal-player": ({ boundary }) => ({ kind: "normal", boundary }),
    "dead-player": ({ boundary }) => ({ kind: "dead", boundary }),
  };
}

function assertProofFixture() {}

function hostCompleteGameProofFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 920,
    setupSnapshotHost: {
      phase: { id: "N05", state: "open" },
      completed: false,
    },
    completeProof: {
      projection: {
        completed: true,
        slots: [
          { role_revealed: true, alignment_revealed: true },
          { role_revealed: true, alignment_revealed: true },
        ],
      },
    },
  };
}

function completedHostReloadProofFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    resyncFromSeq: 921,
    initialResyncSnapshotHost: { completed: true },
    reloadedResyncSnapshotHost: { completed: true },
    initialSnapshot: completedHostReloadSnapshotFixture(),
    reloadedSnapshot: completedHostReloadSnapshotFixture(),
  };
}

function completedHostReloadSnapshotFixture() {
  return {
    checkpoint: {
      phaseId: "N05",
      phaseState: "open",
      deadlineAffordance: "none",
      actionState: "disabled:game complete",
    },
    projection: {
      completed: true,
      phase: { id: "N05", state: "open" },
      slots: [
        { role_revealed: true, alignment_revealed: true },
        { role_revealed: true, alignment_revealed: true },
      ],
    },
    dayVoteOutcomes: [{ phaseId: "D05" }],
    hostPrompts: [],
    actionTiles: [],
    triggerButtons: [],
  };
}

function recordAssertion(assertionName, asserted) {
  const assertProof = () => {
    asserted.push(assertionName);
  };
  assertProof.assertionName = assertionName;
  return assertProof;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
