import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompletedPrivateChannelProofCases,
  assertPrivateChannelSubmitPostProofCase,
  assertStalePrivateChannelPostPhaseLockedProofCase,
  completedPrivateChannelProofAssertionCases,
  completedPrivateChannelReloadScenario,
  completedPrivateChannelSnapshot,
  completedPrivateChannelTransition,
  privateChannelSubmitPostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
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

test("stale private-channel PhaseLocked assertion covers refreshed private post recovery", () => {
  const scenario = stalePrivateChannelPostPhaseLockedScenario();
  const proof = {
    status: "passed",
    sourceRoleUrl: "http://127.0.0.1/g/game-a/c/role-pm?private=notification-1",
    visitedRolePath: "/g/game-a/c/role-pm?private=notification-1",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game: "game-a",
      channel_id: scenario.channelId,
      actor_slot: scenario.actorSlot,
      body: scenario.stalePostBody,
    },
    commandStatus: {
      state: "reject",
      error: scenario.commandError,
      message: scenario.commandMessageFragment,
    },
    bridgePlan: {
      role: "player",
      commandKind: scenario.commandKind,
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys: scenario.expectedRefreshKeys,
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      phase: {
        phaseId: scenario.expectedPhaseId,
        locked: scenario.expectedLocked,
      },
      boundary: scenario.routeBoundary,
    },
    projectionThread: {
      posts: [{ body: scenario.currentThreadBody }],
    },
    stalePrivatePostBody: scenario.stalePostBody,
    currentThreadText: scenario.currentThreadBody,
    checkpointPhaseId: scenario.expectedPhaseId,
    checkpointActionState: scenario.expectedActionState,
    checkpointReceiptState: scenario.expectedReceiptState,
    receiptStatusText: scenario.expectedReceiptStatusFragment,
    receiptRefreshKeys: scenario.expectedRefreshKeys.join(","),
    rawInviteTokensVisible: false,
  };

  assert.doesNotThrow(() =>
    assertStalePrivateChannelPostPhaseLockedProofCase({
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    }),
  );
  assert.throws(
    () =>
      assertStalePrivateChannelPostPhaseLockedProofCase({
        proof: {
          ...proof,
          projectionThread: {
            posts: [
              { body: scenario.currentThreadBody },
              { body: scenario.stalePostBody },
            ],
          },
        },
        expectedGame: "game-a",
        sourceRoleUrl: proof.sourceRoleUrl,
        visitedRolePath: proof.visitedRolePath,
      }),
    /private channel stale post recovery/,
  );
});

test("private-channel SubmitPost ACK assertion covers projected private post", () => {
  const scenario = privateChannelSubmitPostScenario();
  const proof = {
    status: "passed",
    clickedAction: scenario.clickedAction,
    commandKind: scenario.commandKind,
    command: {
      game: "game-a",
      channel_id: scenario.channelId,
      actor_slot: scenario.actorSlot,
      body: scenario.postBody,
    },
    commandStatus: {
      state: "ack",
      message: `Ack: stream seqs ${scenario.ackSeq}`,
    },
    bridgePlan: {
      role: "player",
      commandKind: scenario.commandKind,
      commandEndpoint: "/commands",
      finalState: "ack",
      projectionRefreshKeys: scenario.expectedRefreshKeys,
    },
    receipts: [{ state: "ack" }],
    projectionThread: {
      posts: [{ body: scenario.postBody }],
    },
    privatePostBody: scenario.postBody,
    receiptCount: 1,
    receiptStatusText: `Ack: stream seqs ${scenario.ackSeq}`,
    receiptRefreshKeys: scenario.expectedRefreshKeys.join(","),
  };

  assert.doesNotThrow(() =>
    assertPrivateChannelSubmitPostProofCase({
      proof,
      expectedGame: "game-a",
    }),
  );
  assert.throws(
    () =>
      assertPrivateChannelSubmitPostProofCase({
        proof: {
          ...proof,
          bridgePlan: {
            ...proof.bridgePlan,
            projectionRefreshKeys: ["thread"],
          },
        },
        expectedGame: "game-a",
      }),
    /private channel SubmitPost ACK/,
  );
});

function recordAssertion(assertionName, asserted) {
  const assertProof = () => {
    asserted.push(assertionName);
  };
  assertProof.assertionName = assertionName;
  return assertProof;
}
