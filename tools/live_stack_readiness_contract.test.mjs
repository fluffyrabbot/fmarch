import assert from "node:assert/strict";
import { test } from "node:test";
import { buildLiveStackReadiness } from "./live_stack_readiness_contract.mjs";

test("player-vote-loop requires host votecount convergence evidence", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(checkStatus(buildLiveStackReadiness(evidence), "player-vote-loop"), "passed");

  const withoutConvergence = structuredClone(evidence);
  delete withoutConvergence.browser.hostVotecountConvergence;

  assert.equal(
    checkStatus(buildLiveStackReadiness(withoutConvergence), "player-vote-loop"),
    "failed",
  );
});

test("host setup workflow requires shared setup command evidence", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "host-setup-workflow"),
    "passed",
  );

  const withoutSharedEvidence = structuredClone(evidence);
  delete withoutSharedEvidence.browser.admin.hostSetup.setupCommandEvidence;

  assert.equal(
    checkStatus(
      buildLiveStackReadiness(withoutSharedEvidence),
      "host-setup-workflow",
    ),
    "failed",
  );
});

test("Role PM readiness requires replacement transfer and stale denial", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "role-pm-replacement-lifecycle"),
    "passed",
  );

  delete evidence.browser.moderator.rolePmReplacement.outgoing.stalePostReject;
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "role-pm-replacement-lifecycle"),
    "failed",
  );
});

test("Mason and Neighbor readiness requires both complete room lifecycles", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "mason-neighbor-room-lifecycle"),
    "passed",
  );

  evidence.browser.additionalRooms.rooms[1].outsider.mediaBodyBytes = 12;
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "mason-neighbor-room-lifecycle"),
    "failed",
  );
});

test("dead-chat readiness requires restoration revocation and zero-byte denial", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "dead-chat-lifecycle"),
    "passed",
  );

  evidence.browser.deadChat.restoredAlive.mediaBodyBytes = 12;
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "dead-chat-lifecycle"),
    "failed",
  );
});

test("spectator readiness requires read-only private denial and lifecycle revocation", () => {
  const evidence = liveStackReadinessFixture();
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "spectator-room-lifecycle"),
    "passed",
  );

  evidence.browser.spectator.deniedEndpoints.rolePm = 200;
  assert.equal(
    checkStatus(buildLiveStackReadiness(evidence), "spectator-room-lifecycle"),
    "failed",
  );
});

function checkStatus(readiness, id) {
  return readiness.checks.find((check) => check.id === id)?.status;
}

function liveStackReadinessFixture() {
  return {
    status: "passed",
    database: {
      lifecycle: "created-and-dropped-per-smoke-run",
    },
    grantedSessions: {
      admin: { principalUserId: "admin_a" },
      host: { principalUserId: "host_h" },
      player: { principalUserId: "player-mira" },
      actionPlayer: { principalUserId: "player-seed" },
      racePlayer: { principalUserId: "player-race" },
      cohost: { principalUserId: "cohost-c" },
    },
    browser: {
      admin: {
        createOutcome: { state: "ack" },
        cohostOutcome: { state: "ack" },
        grantedGlobalModLogin: {
          sessionCookie: {
            valueMatchesGrantedToken: true,
          },
        },
        hostSetup: {
          status: "passed",
          setupCommandEvidence: {
            addSlot: {
              status: "ack",
              commandKind: "AddSlot",
              command: { game: "game-a", slot: "slot_1" },
              streamSeqs: [1],
            },
            assignSlot: {
              status: "ack",
              commandKind: "AssignSlot",
              command: { game: "game-a", slot: "slot_1", user: "player_mira" },
              streamSeqs: [2],
            },
            assignRole: {
              status: "ack",
              commandKind: "AssignRole",
              command: { game: "game-a", slot: "slot_1", role_key: "vanilla_townie" },
              streamSeqs: [3],
            },
            setPostPolicy: {
              status: "ack",
              commandKind: "SetPostPolicy",
              command: {
                game: "game-a",
                channel_id: "main",
                allow_media_only: true,
              },
              streamSeqs: [4],
            },
            startGame: {
              status: "ack",
              commandKind: "StartGame",
              command: { game: "game-a", phase: "D01" },
              streamSeqs: [5],
            },
          },
          commands: {
            addSlot: { commandKind: "AddSlot" },
            assignSlot: { commandKind: "AssignSlot" },
            assignRole: {
              commandKind: "AssignRole",
              command: { role_key: "vanilla_townie" },
            },
            setPostPolicy: {
              commandKind: "SetPostPolicy",
              command: { allow_media_only: true },
            },
            startGame: {
              commandKind: "StartGame",
              command: { phase: "D01" },
            },
          },
          readyReadiness: { summary: "Ready to start" },
          startedReadiness: { summary: "Started at D01" },
          hostConsoleState: {
            phase: { phase_id: "D01" },
            slot: { slot_id: "slot_1" },
          },
        },
      },
      player: {
        duplicateVoteRetry: {
          outcome: { state: "ack" },
          voteRows: ["VoteSubmitted"],
        },
        concurrentVoteRace: {
          firstOutcome: { state: "ack" },
          secondOutcome: { state: "ack" },
          rows: ["slot_4", "slot-7"],
        },
        reconnect: {
          reconnectRecoveryEvent: { state: "recovered" },
          recoveredSnapshotContainsPost: true,
        },
        staleVoteRecovery: {
          recovery: {
            outcome: { error: "PhaseLocked" },
            statusMessage: "stale projection refreshed current controls",
          },
        },
      },
      hostVotecountConvergence: {
        status: "passed",
        expectedCount: 1,
        after: {
          projection: [{ target: "slot_1", count: 1 }],
        },
      },
      playerAction: {
        invalidOutcome: { error: "InvalidTarget" },
        legalOutcome: { state: "ack" },
        resolveCommand: { streamSeqs: [1] },
        advanceCommand: { streamSeqs: [2] },
        resolvedTargetSlot: { alive: false },
        staleActionRecovery: {
          outcome: { error: "PhaseLocked" },
          statusMessage: "stale action state refreshed current action controls",
        },
      },
      playerPrivateChannel: {
        submitPost: { outcome: { state: "ack" } },
        media: { responses: [{ ok: true }] },
      },
      privateChannelForbidden: {
        status: 403,
      },
      additionalRooms: {
        status: "passed",
        coveredKinds: ["Mason", "Neighbor"],
        remainingKinds: [],
        rooms: [
          additionalRoomFixture("Mason", "private:mason"),
          additionalRoomFixture("Neighbor", "private:neighbor"),
        ],
      },
      deadChat: deadChatFixture(),
      spectator: spectatorRoomFixture(),
      rolePmHistory: {
        channelId: "private:role_pm:slot-7",
      },
      moderator: {
        phaseControls: {
          lock: { commandStatus: { state: "ack" } },
          staleLockReject: { commandStatus: { error: "PhaseLocked" } },
          unlock: { commandStatus: { state: "ack" } },
        },
        hostPrompt: { commandStatus: { state: "ack" } },
        slotLifecycle: { commandStatus: { state: "ack" } },
        playerInviteTarget: {
          status: "passed",
          principalUserId: "player-rowan",
        },
        stalePlayerInviteReject: {
          state: "recovered",
          reject: { message: "Invite target is stale" },
          retry: {
            state: "ack",
            target: { principalUserId: "player-rowan" },
          },
        },
        rolePmReplacement: {
          status: "passed",
          incoming: {
            submitOutcome: { state: "ack" },
            initialLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
            commandLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
            reloadedPostBodies: [
              "Role PM history before replacement",
              "Incoming replacement continued the durable Role PM",
            ],
          },
          outgoing: {
            routeStatus: 403,
            threadStatus: 403,
            mediaStatus: 403,
            mediaBodyBytes: 0,
            stalePostReject: { error: "NotYourSlot" },
          },
        },
      },
    },
    slotLifecycleApiState: {
      slots: [{ slot_id: "slot-7", alive: false }],
    },
  };
}

function additionalRoomFixture(kind, channelId) {
  return {
    status: "passed",
    kind,
    channelId,
    declaredMemberSlots: [`${kind.toLowerCase()}-1`, `${kind.toLowerCase()}-2`],
    outgoing: {
      submitOutcome: { state: "ack" },
      commandLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      mediaBodyBytes: 1226,
    },
    incoming: {
      submitOutcome: { state: "ack" },
      initialLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      commandLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      reloadedPostBodies: ["history", "incoming"],
      mediaBodyBytes: 1226,
    },
    encryptedStorage: { rawCheck: "2|0|2|0" },
    staleOutgoing: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      postReject: { error: "NotYourSlot" },
    },
    outsider: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      postReject: { error: "NotAuthorized" },
    },
  };
}

function deadChatFixture() {
  return {
    status: "passed",
    channelId: "dead",
    derivedCapability: "DeadViewer(game)",
    preDeath: {
      outgoing: {
        routeStatus: 403,
        threadStatus: 403,
        postReject: { error: "NotAuthorized" },
      },
      living: { routeStatus: 403 },
    },
    death: { streamSeqs: [1] },
    outgoing: {
      submitOutcome: { state: "ack" },
      commandLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      mediaBodyBytes: 1226,
    },
    incoming: {
      submitOutcome: { state: "ack" },
      initialLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      commandLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
      reloadedPostBodies: ["history", "incoming"],
      mediaBodyBytes: 1226,
    },
    encryptedStorage: { rawCheck: "2|0|2|0" },
    staleOutgoing: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      postReject: { error: "NotYourSlot" },
    },
    living: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      postReject: { error: "NotAuthorized" },
    },
    restoration: { streamSeqs: [2] },
    restoredAlive: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      postReject: { error: "NotAuthorized" },
    },
  };
}

function spectatorRoomFixture() {
  return {
    status: "passed",
    channelId: "spectator",
    derivedCapability: "SpectatorOf(game)",
    preGrant: { routeStatus: 403, threadStatus: 403 },
    grant: { streamSeqs: [1] },
    historyNotice: { streamSeqs: [2] },
    liveNotice: { streamSeqs: [3] },
    initialMediaBodyBytes: 1226,
    initialLiveDelta: { delta: { kind: "ThreadPostsChanged" } },
    liveDelta: { delta: { kind: "ThreadPostsChanged" } },
    reloadedPostBodies: ["history", "live"],
    appendReject: { error: "NotAuthorized" },
    encryptedStorage: { rawCheck: "2|0|2|0" },
    deniedEndpoints: {
      dead: 403,
      rolePm: 403,
      faction: 403,
      main: 403,
      notifications: 403,
      investigations: 403,
      commandState: 403,
    },
    revoke: { streamSeqs: [4] },
    revoked: {
      routeStatus: 403,
      threadStatus: 403,
      mediaStatus: 403,
      mediaBodyBytes: 0,
      appendReject: { error: "NotAuthorized" },
      accountSessionActive: true,
    },
  };
}
