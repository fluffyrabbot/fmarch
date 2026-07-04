import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertCompletedPrivateChannelProofCases,
  assertDayThreePlayerObservationProofCase,
  assertLiveCompletedPrivateChannelPostRejectOutcome,
  assertLivePrivateChannelSubmitPostAckOutcome,
  assertPostDayThreePlayerSurfaceProofCase,
  assertPrivateChannelSubmitPostProofCase,
  assertPrivateReceiptRoleSurfaceCase,
  assertStalePrivateChannelPostPhaseLockedProofCase,
  liveCompletedPrivateChannelPostRejectProof,
  livePrivateChannelSubmitPostAckProof,
  privateReceiptAssertionArgs,
  privateReceiptScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  completedPrivateChannelReloadInitialSnapshotCase,
  completedPrivateChannelProofAssertionCases,
  completedPrivateChannelReloadAssertionCase,
  completedPrivateChannelReloadProofArgs,
  completedPrivateChannelReloadedSnapshotCase,
  completedPrivateChannelReloadScenario,
  completedPrivateChannelReloadSnapshotAssertionCases,
  completedPrivateChannelReloadSnapshotCase,
  completedPrivateChannelSnapshot,
  completedPrivateChannelTransition,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostAfterRejectSnapshotCase,
  staleCompletedPrivatePostAfterReloadSnapshotCase,
  staleCompletedPrivatePostAssertionCase,
  staleCompletedPrivatePostProofArgs,
  staleCompletedPrivatePostSnapshotAssertionCases,
  staleCompletedPrivatePostSnapshotCase,
  stalePrivateChannelPostPhaseLockedScenario,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs";

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
  const assertProofFixture = () => {};
  assert.deepEqual(
    completedPrivateChannelReloadSnapshotAssertionCases({
      proof: proof.reloadProof,
      scenario: reloadScenario,
    }),
    [
      completedPrivateChannelReloadInitialSnapshotCase({
        proof: proof.reloadProof,
        scenario: reloadScenario,
      }),
      completedPrivateChannelReloadedSnapshotCase({
        proof: proof.reloadProof,
        scenario: reloadScenario,
      }),
    ],
  );
  assert.deepEqual(
    completedPrivateChannelReloadSnapshotCase({
      label: "initial",
      snapshot: completedPrivateReloadSnapshot,
      scenario: reloadScenario,
    }),
    {
      label: "initial",
      snapshot: completedPrivateReloadSnapshot,
      expectedBoundary: reloadScenario.expectedBoundary,
    },
  );
  assert.deepEqual(
    staleCompletedPrivatePostSnapshotAssertionCases({
      proof: proof.staleCompletedPostRecoveryProof,
      scenario: staleScenario,
    }),
    [
      staleCompletedPrivatePostAfterRejectSnapshotCase({
        proof: proof.staleCompletedPostRecoveryProof,
        scenario: staleScenario,
      }),
      staleCompletedPrivatePostAfterReloadSnapshotCase({
        proof: proof.staleCompletedPostRecoveryProof,
        scenario: staleScenario,
      }),
    ],
  );
  assert.deepEqual(
    staleCompletedPrivatePostSnapshotCase({
      label: "afterReject",
      snapshot: completedPrivateRejectSnapshot,
      rejectedBody: staleScenario.stalePostBody,
      scenario: staleScenario,
    }),
    {
      label: "afterReject",
      snapshot: completedPrivateRejectSnapshot,
      expectedBoundary: staleScenario.expectedBoundary,
      rejectedBody: staleScenario.stalePostBody,
    },
  );
  assert.deepEqual(
    completedPrivateChannelReloadProofArgs({
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    }),
    {
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    },
  );
  assert.deepEqual(
    staleCompletedPrivatePostProofArgs({
      expectedGame: "game-a",
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    },
  );
  assert.deepEqual(
    completedPrivateChannelReloadAssertionCase({
      proof,
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
      assertCompletedPrivateChannelReloadProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: proof.reloadProof,
      scenario: reloadScenario,
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    },
  );
  assert.deepEqual(
    staleCompletedPrivatePostAssertionCase({
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
      assertStaleCompletedPrivatePostRecoveryProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: proof.staleCompletedPostRecoveryProof,
      scenario: staleScenario,
      expectedGame: "game-a",
      sourceRoleUrl: proof.sourceRoleUrl,
      visitedRolePath: proof.visitedRolePath,
    },
  );
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
      transitionToken: scenario.scenario.transitionToken,
      sourceRoleUrl: scenario.sourceRoleUrl,
      visitedRolePath: scenario.visitedRolePath,
    })),
    [
      {
        assertProofName: "reload",
        proofStatus: "passed",
        expectedGame: null,
        transitionToken: reloadScenario.transitionToken,
        sourceRoleUrl: proof.sourceRoleUrl,
        visitedRolePath: proof.visitedRolePath,
      },
      {
        assertProofName: "stale-completed-post",
        proofStatus: "passed",
        expectedGame: "game-a",
        transitionToken: staleScenario.transitionToken,
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

test("private-channel production harness callers use shared scenario definitions", async () => {
  const proofSource = await readFile(
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "utf8",
  );
  const readinessSource = await readFile(
    "tools/dev_test_game_release_readiness.mjs",
    "utf8",
  );
  const proofContractSource = await readFile(
    "tools/dev_test_game_proof_contract.mjs",
    "utf8",
  );
  const assertionFacadeSource = await readFile(
    "tools/dev_test_game_core_loop_private_receipt_scenarios.mjs",
    "utf8",
  );

  assert(
    proofSource.includes(
      "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs",
    ),
    "core-loop admin proof should import private-channel scenarios from the shared recovery family module",
  );
  assert(
    !proofSource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_cases.mjs",
    ) &&
      !proofSource.includes("./dev_test_game_core_loop_private_channel_cases.mjs"),
    "core-loop admin proof should not import private-channel scenarios through the compatibility facade",
  );
  assert(
    proofSource.includes("coreLoopPrivateChannelRecoveryScenarioFamily") &&
      proofSource.includes("completedPrivateChannelReloadScenario") &&
      proofSource.includes("staleCompletedPrivatePostScenario"),
    "core-loop admin proof should use shared completed private-channel recovery family verbs",
  );
  assert(
    readinessSource.includes(
      "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs",
    ),
    "release readiness should import the shared private-channel recovery family",
  );
  assert(
    readinessSource.includes(
      "./dev_test_game_core_loop_private_receipt_scenarios.mjs",
    ),
    "release readiness should keep using the private-channel assertion facade",
  );
  assert(
    proofContractSource.includes(
      "./dev_test_game_core_loop_private_receipt_scenarios.mjs",
    ) &&
      proofContractSource.includes("assertPrivateChannelSubmitPostProofCase") &&
      proofContractSource.includes(
        "assertStaleCompletedPrivatePostRecoveryProofCase",
      ) &&
      proofContractSource.includes("submitPostAckProof") &&
      proofContractSource.includes("completedPostRejectProof"),
    "proof contract should assert normalized private-channel live proof objects",
  );
  assert(
    assertionFacadeSource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs",
    ),
    "private-channel assertion facade should import completed private-channel cases from the case-only module",
  );
  assert(
    !assertionFacadeSource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_cases.mjs",
    ) &&
      !assertionFacadeSource.includes(
        "./dev_test_game_core_loop_private_channel_cases.mjs",
      ),
    "private-channel assertion facade should not import cases through the compatibility facade",
  );
  assert(
    !readinessSource.includes("Completed private channel remains readable.") &&
      !readinessSource.includes("Stale completed private proof post"),
    "release readiness should not duplicate completed private-channel fixture strings",
  );
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

test("live private-channel SubmitPost ACK outcome assertion covers refresh evidence", () => {
  const postBody = "Stale private-channel post after D01 phase closure fixture.";
  const outcome = {
    commandStatus: {
      state: "ack",
      streamSeqs: [43],
      serverEnvelope: { body: { kind: "Ack" } },
      requestEnvelope: {
        body: {
          body: {
            command: {
              SubmitPost: {
                game: "game-a",
                channel_id: "private:mafia_day_chat",
                actor_slot: "slot-7",
                body: postBody,
              },
            },
          },
        },
      },
    },
    receiptStatusText: "Ack: stream seqs 43",
    dispatchPlan: {
      projectionRefreshKeys: [
        "thread",
        "votecount",
        "commandState",
        "dayVoteOutcomes",
      ],
    },
    currentReceipt: { actionId: "submit_post", state: "ack" },
    projectedPost: { authorSlot: "slot-7", body: postBody },
    commandStateAfterAck: {
      phase: { phaseId: "D01", locked: true },
      currentVote: null,
      voteTargets: [],
    },
    buttonsAfterAck: [{ action: "submit_post", disabled: false }],
    dayVoteOutcomesAfterAck: [
      { phaseId: "D01", status: "Lynch", winnerSlot: "slot-2" },
    ],
    apiCommandStateAfterAck: {
      phase: { phase_id: "D01", locked: true },
      current_vote: null,
      vote_targets: [],
    },
    apiThreadAfterAck: {
      posts: [{ author_slot: "slot-7", body: postBody }],
    },
  };

  assert.doesNotThrow(() =>
    assertLivePrivateChannelSubmitPostAckOutcome({
      outcome,
      expectedGame: "game-a",
      postBody,
      expectedChannelId: "private:mafia_day_chat",
      expectedActorSlot: "slot-7",
      expectedWinnerSlot: "slot-2",
      requireStreamSeq: true,
    }),
  );
  assert.throws(
    () =>
      assertLivePrivateChannelSubmitPostAckOutcome({
        outcome: {
          ...outcome,
          projectedPost: { authorSlot: "slot-7", body: "wrong" },
        },
        expectedGame: "game-a",
        postBody,
        expectedChannelId: "private:mafia_day_chat",
        expectedActorSlot: "slot-7",
      }),
    /private channel SubmitPost ACK/,
  );
  assert.deepEqual(
    livePrivateChannelSubmitPostAckProof({
      outcome,
      expectedGame: "game-a",
      postBody,
      expectedChannelId: "private:mafia_day_chat",
      expectedActorSlot: "slot-7",
    }).command,
    {
      game: "game-a",
      channel_id: "private:mafia_day_chat",
      actor_slot: "slot-7",
      body: postBody,
    },
  );
});

test("live completed private-channel reject outcome assertion covers reload closure", () => {
  const scenario = staleCompletedPrivatePostScenario();
  const postBody = "Completed private-channel stale post fixture.";
  const outcome = {
    commandStatus: {
      state: "reject",
      error: scenario.commandError,
      message: scenario.commandMessage,
      serverEnvelope: { body: { kind: "Reject" } },
      requestEnvelope: {
        body: {
          body: {
            principal_user_id: "player-mira",
            command: {
              SubmitPost: {
                game: "game-a",
                channel_id: "private:mafia_day_chat",
                actor_slot: "slot-7",
                body: postBody,
              },
            },
          },
        },
      },
    },
    dispatchPlan: { projectionRefreshKeys: ["commandState"] },
    currentReceipt: { actionId: "submit_post", state: "reject" },
    receiptStatusText: scenario.commandMessage,
    commandStateAfterReject: {
      actorSlot: "slot-7",
      gameCompleted: true,
      actions: [],
      voteTargets: [],
      boundary: "The game is complete.",
    },
    buttonsAfterReject: [{ action: "submit_post", disabled: true }],
    apiCommandStateAfterReject: {
      game_completed: true,
      actions: [],
      vote_targets: [],
    },
    apiThreadPostBodies: [],
    reloadAfterReject: {
      routeResponseStatus: 200,
      recoveredCommandState: {
        actorSlot: "slot-7",
        gameCompleted: true,
        actions: [],
        voteTargets: [],
        boundary: "The game is complete.",
      },
      reloadButtons: [{ action: "submit_post", disabled: true }],
      reloadRejectedPostVisible: false,
      reloadThreadPostBodies: [],
      apiCommandStateAfterReload: {
        game_completed: true,
        actions: [],
        vote_targets: [],
      },
      apiThreadPostBodiesAfterReload: [],
    },
  };

  assert.doesNotThrow(() =>
    assertLiveCompletedPrivateChannelPostRejectOutcome({
      outcome,
      expectedGame: "game-a",
      postBody,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
      visitedRolePath: "/g/game-a/c/private%3Amafia_day_chat",
      expectedChannelId: "private:mafia_day_chat",
      expectedActorSlot: "slot-7",
      expectedPrincipalUserId: "player-mira",
    }),
  );
  assert.throws(
    () =>
      assertLiveCompletedPrivateChannelPostRejectOutcome({
        outcome: {
          ...outcome,
          apiThreadPostBodies: [postBody],
        },
        expectedGame: "game-a",
        postBody,
        sourceRoleUrl:
          "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
        visitedRolePath: "/g/game-a/c/private%3Amafia_day_chat",
        expectedChannelId: "private:mafia_day_chat",
        expectedActorSlot: "slot-7",
      }),
    /completed private SubmitPost reject reload/,
  );
  assert.equal(
    liveCompletedPrivateChannelPostRejectProof({
      outcome,
      expectedGame: "game-a",
      postBody,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
      visitedRolePath: "/g/game-a/c/private%3Amafia_day_chat",
      expectedChannelId: "private:mafia_day_chat",
      expectedActorSlot: "slot-7",
    }).stalePrivatePostBody,
    postBody,
  );
});

test("private receipt role-surface assertion covers target receipt projection", () => {
  const scenario = privateReceiptScenario("n01-target-receipt");
  const sourceRoleUrl =
    "http://127.0.0.1/g/game-a?private=notification-1";
  const args = privateReceiptAssertionArgs({
    scenario,
    expectedGame: "game-a",
    sourceRoleUrl,
  });
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    targetSlot: scenario.expectedSlot,
    principalUserId: scenario.principalUserId,
    sourceRoleUrl,
    visitedRolePath: "/g/game-a?private=notification-1",
    surfaceTestId: "player-surface",
    checkpoint: {
      phaseId: scenario.phaseId,
      phaseState: scenario.phaseState,
      actorSlot: scenario.expectedSlot,
      actionState: scenario.actionState,
      receiptState: "idle",
      statusText: `Player action unavailable: ${scenario.statusText}`,
    },
    privateQueueBoundary: {
      status: args.expectedPrivateQueueBoundaryStatus,
      count: 1,
      text: "Uses principal-scoped endpoints",
    },
    projectionCommandState: {
      actorSlot: scenario.expectedSlot,
      actorAlive: scenario.actorAlive,
      actorStatus: scenario.actorStatus,
      phase: { phaseId: "ignored", locked: true },
      actions: [],
      boundary: scenario.boundaryText,
    },
    resyncFromSeq: scenario.resyncFromSeq,
    resyncSnapshotCommandState: {
      actorSlot: scenario.expectedSlot,
      phase: { phaseId: "ignored" },
    },
    coldLoadEndpoints: {
      notificationsEndpoint: args.expectedNotificationsEndpoint,
      commandStateEndpoint: args.expectedCommandStateEndpoint,
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: `player_killed ${scenario.privateReceiptStatus}`,
      detailText: `Phase ${scenario.privateReceiptPhaseId}`,
    },
    projectionNotifications: [
      {
        effect: "player_killed",
        status: scenario.privateReceiptStatus,
      },
    ],
    resyncSnapshotNotifications: [
      {
        effect: "player_killed",
        status: "ignored",
      },
    ],
  };

  assert.doesNotThrow(() =>
    assertPrivateReceiptRoleSurfaceCase({
      proof,
      ...args,
      errorMessage: "missing target receipt",
    }),
  );
  assert.throws(
    () =>
      assertPrivateReceiptRoleSurfaceCase({
        proof: {
          ...proof,
          privateNotice: {
            ...proof.privateNotice,
            text: "player_killed wrong_status",
          },
        },
        ...args,
        errorMessage: "missing target receipt",
      }),
    /missing target receipt/,
  );
});

test("Day 3 player observation assertion covers target private receipt", () => {
  const sourceRoleUrl = "http://127.0.0.1/g/game-a?private=notification-1";
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl,
    visitedRolePath: "/g/game-a?private=notification-1",
    surfaceTestId: "player-surface",
    targetSlot: "slot-3",
    principalUserId: "player-seed",
    checkpoint: {
      phaseId: "D03",
      phaseState: "open",
      actorSlot: "slot-3",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text: "Uses principal-scoped endpoints",
    },
    projectionCommandState: {
      actorSlot: "slot-3",
      actorAlive: false,
      actorStatus: "dead",
      phase: { phaseId: "D03", locked: false },
      actions: [],
      boundary: "killed target stayed dead",
    },
    resyncFromSeq: 906,
    resyncSnapshotCommandState: {
      actorSlot: "slot-3",
      phase: { phaseId: "D03" },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player-seed",
      commandStateEndpoint:
        "/games/game-a/player-command-state?principal_user_id=player-seed&slot_id=slot-3",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed factional_kill",
      detailText: "Phase N02",
    },
    projectionNotifications: [
      { effect: "player_killed", status: "factional_kill" },
    ],
    resyncSnapshotNotifications: [
      { effect: "player_killed", status: "factional_kill" },
    ],
  };

  assert.doesNotThrow(() =>
    assertDayThreePlayerObservationProofCase({
      proof,
      sourceRoleUrl,
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
      expectedCommandStateEndpoint:
        proof.coldLoadEndpoints.commandStateEndpoint,
      expectedNotificationsEndpoint:
        proof.coldLoadEndpoints.notificationsEndpoint,
    }),
  );
  assert.throws(
    () =>
      assertDayThreePlayerObservationProofCase({
        proof: {
          ...proof,
          projectionNotifications: [],
        },
        sourceRoleUrl,
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
        expectedCommandStateEndpoint:
          proof.coldLoadEndpoints.commandStateEndpoint,
        expectedNotificationsEndpoint:
          proof.coldLoadEndpoints.notificationsEndpoint,
      }),
    /Day 3 target private receipt/,
  );
});

test("post-Day 3 player surface assertion covers private day-vote receipt", () => {
  const sourceRoleUrl = "http://127.0.0.1/g/game-a?private=notification-1";
  const proof = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl,
    visitedRolePath: "/g/game-a?private=notification-1",
    surfaceTestId: "player-surface",
    targetSlot: "slot-2",
    principalUserId: "player_ilya",
    checkpoint: {
      phaseId: "N03",
      phaseState: "open",
      actorSlot: "slot-2",
      actionState: "disabled:actor is not alive",
      receiptState: "idle",
      statusText: "Player action unavailable: actor is not alive",
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: 1,
      text: "Uses principal-scoped endpoints",
    },
    voteButtonCount: 0,
    projectionCommandState: {
      actorSlot: "slot-2",
      actorAlive: false,
      actorStatus: "dead",
      phase: { phaseId: "N03", locked: false },
      actions: [],
      voteTargets: [],
      boundary: "target observed post-Day 3 private receipt",
    },
    projectionDayVoteOutcomes: [{ phaseId: "D03" }],
    resyncFromSeq: 910,
    resyncSnapshotCommandState: {
      actorSlot: "slot-2",
      phase: { phaseId: "N03" },
    },
    coldLoadEndpoints: {
      notificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_ilya",
      commandStateEndpoint:
        "/games/game-a/player-command-state?principal_user_id=player_ilya&slot_id=slot-2",
    },
    privateNotice: {
      id: "notification-1",
      kind: "notification",
      text: "player_killed day_vote",
      detailText: "Phase D03",
    },
    projectionNotifications: [{ effect: "player_killed", status: "day_vote" }],
    resyncSnapshotNotifications: [
      { effect: "player_killed", status: "day_vote" },
    ],
  };

  assert.doesNotThrow(() =>
    assertPostDayThreePlayerSurfaceProofCase({
      proof,
      sourceRoleUrl,
      expectedSlot: "slot-2",
      slotField: "targetSlot",
      expectedPrincipalUserId: "player_ilya",
      expectedPhaseId: "N03",
      expectedPhaseState: "open",
      expectedActorAlive: false,
      expectedActorStatus: "dead",
      expectedActionState: "disabled:actor is not alive",
      expectedStatusText: "actor is not alive",
      expectedPrivateCount: 1,
      expectedPrivateReceipt: true,
      expectedBoundaryText: "target observed post-Day 3 private receipt",
      expectedResyncFromSeq: 910,
      expectedCommandStateEndpoint:
        proof.coldLoadEndpoints.commandStateEndpoint,
      expectedNotificationsEndpoint:
        proof.coldLoadEndpoints.notificationsEndpoint,
    }),
  );
  assert.throws(
    () =>
      assertPostDayThreePlayerSurfaceProofCase({
        proof: {
          ...proof,
          projectionDayVoteOutcomes: [{ phaseId: "D02" }],
        },
        sourceRoleUrl,
        expectedSlot: "slot-2",
        slotField: "targetSlot",
        expectedPrincipalUserId: "player_ilya",
        expectedPhaseId: "N03",
        expectedPhaseState: "open",
        expectedActorAlive: false,
        expectedActorStatus: "dead",
        expectedActionState: "disabled:actor is not alive",
        expectedStatusText: "actor is not alive",
        expectedPrivateCount: 1,
        expectedPrivateReceipt: true,
        expectedBoundaryText: "target observed post-Day 3 private receipt",
        expectedResyncFromSeq: 910,
        expectedCommandStateEndpoint:
          proof.coldLoadEndpoints.commandStateEndpoint,
        expectedNotificationsEndpoint:
          proof.coldLoadEndpoints.notificationsEndpoint,
      }),
    /post-Day 3 player surface/,
  );
});

function recordAssertion(assertionName, asserted) {
  const assertProof = () => {
    asserted.push(assertionName);
  };
  assertProof.assertionName = assertionName;
  return assertProof;
}
