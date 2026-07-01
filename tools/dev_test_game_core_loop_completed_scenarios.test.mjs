import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompletedGameEndgameTransition,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameTransition,
  completedHostStaleCommandCases,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCases,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";

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
        commandKind: null,
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

test("completed-game transition covers every stale and reload scenario", () => {
  const transition = completedGameEndgameTransition();
  assertCompletedGameEndgameTransition({ transition });
  for (const scenario of [
    ...completedHostStaleCommandCases(),
    ...completedPlayerReloadCases(),
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
