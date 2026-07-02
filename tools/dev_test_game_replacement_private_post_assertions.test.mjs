import test from "node:test";
import assert from "node:assert/strict";
import {
  replacementCompletedPrivatePostRejectMatches,
  replacementCompletedPrivatePostReloadMatches,
} from "./dev_test_game_replacement_private_post_assertions.mjs";
import {
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";

const scenario = replacementStalePrivatePostAfterCompleteScenario();

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
