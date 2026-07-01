import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompletedPrivateChannelProofCases,
  completedPrivateChannelProofAssertionCases,
  completedPrivateChannelReloadScenario,
  completedPrivateChannelSnapshot,
  completedPrivateChannelTransition,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

test("completed private-channel scenarios build reusable snapshots and transitions", () => {
  const reloadScenario = completedPrivateChannelReloadScenario();
  const staleScenario = staleCompletedPrivatePostScenario();

  assert.equal(
    completedPrivateChannelTransition(),
    [
      reloadScenario.transitionToken,
      staleScenario.transitionToken,
    ].join(" -> "),
  );

  assert.deepEqual(
    completedPrivateChannelSnapshot({
      scenario: reloadScenario,
      receiptState: "reject:GameAlreadyCompleted",
      boundary: staleScenario.routeBoundary,
    }),
    {
      checkpoint: {
        phaseId: "N05",
        phaseState: "open",
        actorSlot: "slot-7",
        actionState: "disabled:game complete",
        receiptState: "reject:GameAlreadyCompleted",
      },
      commandPanelChannelId: "role-pm",
      channelContext: {
        channelId: "role-pm",
        actorSlot: "slot-7",
        capabilityLabel: "ChannelMember(role-pm)",
        actorStatus: "alive",
      },
      commandState: {
        actorSlot: "slot-7",
        gameCompleted: true,
        actions: [],
        voteTargets: [],
        boundary:
          "Seeded browser completed private-channel GameAlreadyCompleted recovery refreshed role-pm controls.",
      },
      threadPostBodies: ["Completed private channel remains readable."],
      buttons: [
        { action: "withdraw_vote", disabled: true, reason: "" },
        { action: "submit_post", disabled: true, reason: "" },
      ],
      enabledMutatingButtons: [],
    },
  );
});

test("completed private-channel scenarios derive shared proof assertion cases", () => {
  const reloadScenario = completedPrivateChannelReloadScenario();
  const staleScenario = staleCompletedPrivatePostScenario();
  const completedPrivateReloadSnapshot = completedPrivateChannelSnapshot({
    scenario: reloadScenario,
  });
  const completedPrivateRejectSnapshot = completedPrivateChannelSnapshot({
    scenario: reloadScenario,
    receiptState: `reject:${staleScenario.commandError}`,
    boundary: staleScenario.routeBoundary,
  });
  const proof = {
    status: "passed",
    sourceRoleUrl: "http://127.0.0.1/g/game-a?channel=role-pm",
    visitedRolePath: "/g/game-a",
    clickedThroughFromRoleUrl: true,
    transition: completedPrivateChannelTransition(),
    reloadProof: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1/g/game-a?channel=role-pm",
      visitedRolePath: "/g/game-a",
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      resyncFromSeq: reloadScenario.resyncFromSeq,
      initialResyncSnapshotCommandState:
        completedPrivateReloadSnapshot.commandState,
      reloadedResyncSnapshotCommandState:
        completedPrivateReloadSnapshot.commandState,
      initialSnapshot: completedPrivateReloadSnapshot,
      reloadedSnapshot: completedPrivateReloadSnapshot,
      rawInviteTokensVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    staleCompletedPostRecoveryProof: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1/g/game-a?channel=role-pm",
      visitedRolePath: "/g/game-a",
      clickedThroughFromRoleUrl: true,
      clickedAction: staleScenario.clickedAction,
      commandKind: staleScenario.commandKind,
      command: {
        game: "game-a",
        channel_id: staleScenario.channelId,
        actor_slot: staleScenario.actorSlot,
        body: staleScenario.stalePostBody,
      },
      commandStatus: {
        state: "reject",
        error: staleScenario.commandError,
        message: staleScenario.commandMessage,
      },
      bridgePlan: {
        role: "player",
        commandKind: staleScenario.commandKind,
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: staleScenario.expectedRefreshKeys,
      },
      receipts: [{ state: "reject" }],
      stalePrivatePostBody: staleScenario.stalePostBody,
      submitDisabledBeforeReject: false,
      snapshotAfterReject: completedPrivateRejectSnapshot,
      snapshotAfterReload: completedPrivateRejectSnapshot,
      reloadedResyncSnapshotCommandState:
        completedPrivateRejectSnapshot.commandState,
      receiptStatusText: staleScenario.commandMessage,
      receiptRefreshKeys: staleScenario.expectedRefreshKeys.join(","),
      rawInviteTokensVisible: false,
    },
    releaseReady: false,
    productionReady: false,
  };
  const asserted = [];
  const cases = completedPrivateChannelProofAssertionCases({
    proof,
    expectedGame: "game-a",
    sourceRoleUrl: proof.sourceRoleUrl,
    visitedRolePath: proof.visitedRolePath,
    assertCompletedPrivateChannelReloadProof: recordAssertion(
      "reload",
      asserted,
    ),
    assertStaleCompletedPrivatePostRecoveryProof: recordAssertion(
      "stale-completed-post",
      asserted,
    ),
  });

  assert.deepEqual(
    cases.map((scenario) => ({
      assertProofName: scenario.assertProof.assertionName,
      proofStatus: scenario.proof.status,
      expectedGame: scenario.expectedGame ?? null,
      sourceRoleUrl: scenario.sourceRoleUrl,
      visitedRolePath: scenario.visitedRolePath,
    })),
    [
      {
        assertProofName: "reload",
        proofStatus: "passed",
        expectedGame: null,
        sourceRoleUrl: proof.sourceRoleUrl,
        visitedRolePath: proof.visitedRolePath,
      },
      {
        assertProofName: "stale-completed-post",
        proofStatus: "passed",
        expectedGame: "game-a",
        sourceRoleUrl: proof.sourceRoleUrl,
        visitedRolePath: proof.visitedRolePath,
      },
    ],
  );

  assertCompletedPrivateChannelProofCases({
    proof,
    sourceRoleUrl: proof.sourceRoleUrl,
    visitedRolePath: proof.visitedRolePath,
    cases,
  });
  assert.deepEqual(asserted, ["reload", "stale-completed-post"]);
});

function recordAssertion(assertionName, asserted) {
  const assertProof = () => {
    asserted.push(assertionName);
  };
  assertProof.assertionName = assertionName;
  return assertProof;
}
