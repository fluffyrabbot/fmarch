import test from "node:test";
import assert from "node:assert/strict";
import {
  replacementCompletedPrivatePostRejectMatches,
  replacementCompletedPrivatePostReloadMatches,
  replacementResolvedPrivatePostAckMatches,
  replacementResolvedPrivatePostReconnectMatches,
} from "./dev_test_game_replacement_private_post_assertions.mjs";
import {
  replacementStalePrivatePostAfterResolveScenario,
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";

const scenario = replacementStalePrivatePostAfterCompleteScenario();
const resolveScenario = replacementStalePrivatePostAfterResolveScenario();

const replacementResolvedPrivatePostProofFixture = () => ({
  status: "passed",
  game: "game-a",
  channel: resolveScenario.channelId,
  postBody: resolveScenario.fixturePostBody,
  hostEntry: { capabilityKinds: ["HostOf"] },
  staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
  replacementEntry: { capabilityKinds: ["SlotOccupant"] },
  replacement: {
    state: "ack",
    serverEnvelope: { body: { kind: "Ack" } },
    requestEnvelope: {
      body: {
        body: {
          command: {
            ProcessReplacement: {
              slot: resolveScenario.actorSlot,
              incoming_user: resolveScenario.replacementPrincipalUserId,
            },
          },
        },
      },
    },
  },
  hostReplacementAfterProcess: {
    occupantLabel: resolveScenario.replacementOccupantLabel,
  },
  commandStateBeforeClose: {
    actorSlot: resolveScenario.actorSlot,
    actorStatus: "alive",
    phase: { phaseId: "D01", locked: false },
  },
  channelContextBeforeClose: {
    channelId: resolveScenario.channelId,
    actorSlot: resolveScenario.actorSlot,
    capabilityLabel: `ChannelMember(${resolveScenario.channelId})`,
  },
  submitPostBeforeClose: { disabled: false },
  closedStatus: { state: "closed" },
  resolveDay: { commandStatus: { state: "ack" } },
  hostPhaseAfterResolve: { id: "D01", locked: true },
  apiCommandStateAfterResolve: {
    phase: { phase_id: "D01", locked: true },
  },
  stalePost: {
    state: "ack",
    serverEnvelope: { body: { kind: "Ack" } },
    streamSeqs: [resolveScenario.postAckSeq],
    requestEnvelope: {
      body: {
        body: {
          principal_user_id: resolveScenario.replacementPrincipalUserId,
          command: {
            SubmitPost: {
              channel_id: resolveScenario.channelId,
              actor_slot: resolveScenario.actorSlot,
              body: resolveScenario.fixturePostBody,
            },
          },
        },
      },
    },
  },
  dispatchPlan: { projectionRefreshKeys: ["thread", "commandState"] },
  currentReceipt: { actionId: resolveScenario.commandAction, state: "ack" },
  commandStateAfterAck: {
    actorSlot: resolveScenario.actorSlot,
    actorStatus: "alive",
    phase: { phaseId: "D01", locked: true },
    voteTargets: [],
  },
  channelContextAfterAck: {
    channelId: resolveScenario.channelId,
    actorSlot: resolveScenario.actorSlot,
  },
  projectedPost: { authorSlot: resolveScenario.actorSlot },
  apiThreadPostBodies: [resolveScenario.fixturePostBody],
  rowanPrivateIsolationAfterAck: {
    targetKillVisible: false,
    actionResultVisible: false,
  },
  staleOutgoingRouteAfterAck: { status: 403 },
  staleOutgoingThreadAfterAck: { status: 403 },
  privateReconnectAfterAck: {
    status: "passed",
    reconnectCommandStateBeforeDrop: {
      actorSlot: resolveScenario.actorSlot,
      actorStatus: "alive",
      phase: { phaseId: "D01", locked: true },
      voteTargets: [],
    },
    reconnectChannelContextBeforeDrop: {
      channelId: resolveScenario.channelId,
      actorSlot: resolveScenario.actorSlot,
    },
    reconnectButtonsBeforeDrop: [{ action: "submit_post", disabled: false }],
    reconnectingStatus: { state: "reconnecting" },
    reconnectCommand: {
      principalUserId: resolveScenario.replacementPrincipalUserId,
      command: {
        SubmitPost: {
          channel_id: resolveScenario.channelId,
          actor_slot: resolveScenario.actorSlot,
          body: resolveScenario.reconnectPostBody,
        },
      },
    },
    reconnectPostBody: resolveScenario.reconnectPostBody,
    reconnectRecoveryEvent: { state: "recovered", attempt: 1 },
    recoveredSnapshotContainsPost: true,
    recoveredCommandState: {
      actorSlot: resolveScenario.actorSlot,
      actorStatus: "alive",
      phase: { phaseId: "D01", locked: true },
      voteTargets: [],
    },
    reconnectChannelContextAfterRecovery: {
      channelId: resolveScenario.channelId,
      actorSlot: resolveScenario.actorSlot,
    },
    reconnectButtonsAfterRecovery: [
      { action: "submit_post", disabled: false },
    ],
    apiThreadPostBodiesAfterReconnect: [
      resolveScenario.fixturePostBody,
      resolveScenario.reconnectPostBody,
    ],
    apiCommandStateAfterReconnect: {
      phase: { phase_id: "D01", locked: true },
      vote_targets: [],
    },
    staleOutgoingThreadAfterReconnect: { status: 403 },
  },
});

const replacementCompletedPrivatePostProofFixture = () => ({
  status: "passed",
  game: "game-a",
  channel: scenario.channelId,
  postBody: scenario.fixturePostBody,
  hostEntry: { capabilityKinds: ["HostOf"] },
  staleOutgoingEntry: { capabilityKinds: ["SlotOccupant"] },
  replacementEntry: { capabilityKinds: ["SlotOccupant"] },
  replacement: {
    state: "ack",
    requestEnvelope: {
      body: {
        body: {
          command: {
            ProcessReplacement: {
              slot: scenario.actorSlot,
              incoming_user: scenario.replacementPrincipalUserId,
            },
          },
        },
      },
    },
  },
  hostReplacementAfterProcess: {
    occupantLabel: scenario.replacementOccupantLabel,
  },
  commandStateBeforeClose: {
    actorSlot: scenario.actorSlot,
    gameCompleted: false,
  },
  channelContextBeforeClose: {
    channelId: scenario.channelId,
    actorSlot: scenario.actorSlot,
    capabilityLabel: `ChannelMember(${scenario.channelId})`,
  },
  submitPostBeforeClose: { disabled: false },
  closedStatus: { state: "closed" },
  complete: {
    commandStatus: {
      state: "ack",
      requestEnvelope: {
        body: {
          body: {
            command: {
              CompleteGame: { game: "game-a" },
            },
          },
        },
      },
    },
  },
  hostSlotsAfterComplete: [
    { role_revealed: true, alignment_revealed: true },
    { role_revealed: true, alignment_revealed: true },
  ],
  hostActionsAfterComplete: [],
  apiStateAfterComplete: { completed: true },
  reject: {
    state: "reject",
    error: scenario.commandError,
    serverEnvelope: { body: { kind: "Reject" } },
    requestEnvelope: {
      body: {
        body: {
          principal_user_id: scenario.replacementPrincipalUserId,
          command: {
            SubmitPost: {
              channel_id: scenario.channelId,
              actor_slot: scenario.actorSlot,
              body: scenario.fixturePostBody,
            },
          },
        },
      },
    },
  },
  dispatchPlan: { projectionRefreshKeys: ["commandState"] },
  currentReceipt: { actionId: scenario.commandAction, state: "reject" },
  receiptStatusText: scenario.commandMessage,
  commandStateAfterReject: {
    actorSlot: scenario.actorSlot,
    gameCompleted: true,
    actions: [],
    voteTargets: [],
    boundary: scenario.commandStateBoundary,
  },
  channelContextAfterReject: {
    channelId: scenario.channelId,
    actorSlot: scenario.actorSlot,
  },
  buttonsAfterReject: [{ action: "submit_post", disabled: true }],
  apiCommandStateAfterReject: {
    game_completed: true,
    actions: [],
    vote_targets: [],
  },
  apiThreadPostBodies: ["existing post"],
  staleOutgoingRouteAfterReject: { status: 403 },
  staleOutgoingThreadAfterReject: { status: 403 },
  privateReloadAfterReject: {
    status: "passed",
    routeResponseStatus: 200,
    threadPagerVisible: true,
    recoveredCommandState: {
      actorSlot: scenario.actorSlot,
      gameCompleted: true,
      actions: [],
      voteTargets: [],
      boundary: scenario.commandStateBoundary,
    },
    reloadChannelContext: {
      channelId: scenario.channelId,
      actorSlot: scenario.actorSlot,
      capabilityLabel: `ChannelMember(${scenario.channelId})`,
    },
    reloadButtons: [{ action: "submit_post", disabled: true }],
    reloadRejectedPostVisible: false,
    reloadThreadPostBodies: ["existing post"],
    apiCommandStateAfterReload: {
      game_completed: true,
      actions: [],
      vote_targets: [],
    },
    apiThreadPostBodiesAfterReload: ["existing post"],
    staleOutgoingRouteAfterReload: { status: 403, responseStatus: 403 },
    staleOutgoingThreadAfterReload: { status: 403 },
  },
});

test("replacement completed private-post reject assertion covers completed recovery", () => {
  assert.equal(
    replacementCompletedPrivatePostRejectMatches(
      replacementCompletedPrivatePostProofFixture(),
      scenario,
    ),
    true,
  );
});

test("replacement completed private-post reject assertion rejects appended stale post", () => {
  const proof = replacementCompletedPrivatePostProofFixture();
  proof.apiThreadPostBodies.push(proof.postBody);

  assert.equal(
    replacementCompletedPrivatePostRejectMatches(proof, scenario),
    false,
  );
});

test("replacement completed private-post reject assertion requires commandState refresh", () => {
  const proof = replacementCompletedPrivatePostProofFixture();
  proof.dispatchPlan.projectionRefreshKeys = [];

  assert.equal(
    replacementCompletedPrivatePostRejectMatches(proof, scenario),
    false,
  );
});

test("replacement completed private-post reload assertion covers disabled completed surface", () => {
  const proof = replacementCompletedPrivatePostProofFixture();

  assert.equal(
    replacementCompletedPrivatePostReloadMatches(
      proof,
      proof.privateReloadAfterReject,
      scenario,
    ),
    true,
  );
});

test("replacement resolved private-post ACK assertion covers locked channel recovery", () => {
  assert.equal(
    replacementResolvedPrivatePostAckMatches(
      replacementResolvedPrivatePostProofFixture(),
      resolveScenario,
    ),
    true,
  );
});

test("replacement resolved private-post ACK assertion requires thread refresh", () => {
  const proof = replacementResolvedPrivatePostProofFixture();
  proof.dispatchPlan.projectionRefreshKeys = ["commandState"];

  assert.equal(
    replacementResolvedPrivatePostAckMatches(proof, resolveScenario),
    false,
  );
});

test("replacement resolved private-post reconnect assertion covers recovered post surface", () => {
  const proof = replacementResolvedPrivatePostProofFixture();

  assert.equal(
    replacementResolvedPrivatePostReconnectMatches(
      proof,
      proof.privateReconnectAfterAck,
      resolveScenario,
    ),
    true,
  );
});

test("replacement resolved private-post reconnect assertion rejects vote controls", () => {
  const proof = replacementResolvedPrivatePostProofFixture();
  proof.privateReconnectAfterAck.reconnectButtonsAfterRecovery.push({
    action: "submit_vote:no_lynch",
    disabled: false,
  });

  assert.equal(
    replacementResolvedPrivatePostReconnectMatches(
      proof,
      proof.privateReconnectAfterAck,
      resolveScenario,
    ),
    false,
  );
});
