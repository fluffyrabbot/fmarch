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
          projection: [{ target: "slot-2", count: 1 }],
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
      },
    },
    slotLifecycleApiState: {
      slots: [{ slot_id: "slot-7", alive: false }],
    },
  };
}
