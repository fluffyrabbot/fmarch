import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  completedGameSeedRequiredScenarioIds,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostStaleDeadlineReconnectLaneId,
  cohostStaleDeadlineControlLaneId,
  coreLoopHostStaleCommandHighlightedLaneIds,
  hardeningHostStaleCommandHighlightedLaneIds,
  hostStaleAdvanceReconnectLaneId,
  hostStaleAdvanceControlLaneId,
  hostStaleAdvanceReloadLaneId,
  hostStaleControlStatusExpectationForLane,
  hostStaleDeadlineReconnectLaneId,
  hostStaleDeadlineControlLaneId,
  hostStaleReconnectExpectationForLane,
  hostStaleResolveReconnectLaneId,
  hostStaleResolveControlLaneId,
  hostStaleResolveReloadLaneId,
} from "../../../../tools/dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  hardeningRecoveryHighlightedLaneIds,
  privateChannelStaleActionReconnectExpectation,
  privateChannelStaleActionReconnectLaneId,
  staleActionConflictMessageLaneId,
  staleConflictMessageStatusExpectationForLane,
  staleDeadActionConflictLaneId,
  stalePlayerActionReconnectExpectation,
  stalePlayerActionReconnectLaneId,
} from "../../../../tools/dev_test_game_hardening_recovery_scenarios.mjs";
import {
  concurrentActionRaceLaneId,
  concurrentActionRaceReloadLaneId,
  hardeningPlayerRecoveryHighlightedLaneIds,
  playerRecoveryStatusExpectationForLane,
  staleActionConflictLaneId,
  staleSameActionRecoveryLaneId,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  playerInvalidActionRecoveryMessage,
} from "../../../../tools/dev_test_game_core_loop_action_scenarios.mjs";
import {
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelInvalidActionRecoveryScenario,
} from "../../../../tools/dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  CORE_LOOP_COMPLETED_GAME_HIGHLIGHTED_LANE_IDS,
  CORE_LOOP_HIGHLIGHTED_LANE_IDS,
  HARDENING_HIGHLIGHTED_LANE_IDS,
  coreLoopHighlightedLaneEvidence,
  coreLoopLaneStatus,
  coreLoopSpineStatus,
  hardeningHighlightedLaneEvidence,
  hardeningLaneStatus,
} from "./local-proof-lane-status.mjs";

function hostStaleReconnectEvidence(laneId) {
  const expectation = hostStaleReconnectExpectationForLane(laneId);
  return {
    reconnectingState: expectation.reconnectingState,
    recoveryState: expectation.recoveryState,
    ...(Object.hasOwn(expectation, "recoveredLocked")
      ? { recoveredLocked: expectation.recoveredLocked }
      : {}),
    ...(Object.hasOwn(expectation, "apiDeadline")
      ? { apiDeadline: expectation.apiDeadline }
      : {}),
    ...(Object.hasOwn(expectation, "phaseActions")
      ? { phaseActions: [...expectation.phaseActions] }
      : {}),
  };
}

function hostStaleControlEvidence(laneId) {
  const expectation = hostStaleControlStatusExpectationForLane(laneId);
  return {
    roleUrl: "http://127.0.0.1:5173/g/game-id/host",
    ...(Object.hasOwn(expectation, "rejectError")
      ? { rejectError: expectation.rejectError }
      : {}),
    ...(Object.hasOwn(expectation, "rejectReceipt")
      ? { rejectReceipt: expectation.rejectReceipt }
      : {}),
    ...(Object.hasOwn(expectation, "locked")
      ? { locked: expectation.locked }
      : {}),
    ...(Object.hasOwn(expectation, "apiDeadline")
      ? { apiDeadline: expectation.apiDeadline }
      : {}),
    ...(Object.hasOwn(expectation, "phaseActions")
      ? { phaseActions: [...expectation.phaseActions] }
      : {}),
  };
}

function staleConflictEvidence(laneId) {
  const expectation = staleConflictMessageStatusExpectationForLane(laneId);
  return {
    roleUrl: "http://127.0.0.1:5173/g/game-id",
    ...(Object.hasOwn(expectation, "rejectError")
      ? { rejectError: expectation.rejectError }
      : {}),
    ...(Object.hasOwn(expectation, "receiptStatusText")
      ? { receiptStatusText: expectation.receiptStatusText }
      : {}),
    ...(Object.hasOwn(expectation, "rejectMessageFragment")
      ? { rejectMessage: expectation.rejectMessageFragment }
      : {}),
    ...(Object.hasOwn(expectation, "actorStatusAfterReject")
      ? { actorStatusAfterReject: expectation.actorStatusAfterReject }
      : {}),
    ...(Object.hasOwn(expectation, "actionVisibleAfterRefresh")
      ? { actionVisibleAfterRefresh: expectation.actionVisibleAfterRefresh }
      : {}),
    ...(Object.hasOwn(expectation, "refreshedPhase")
      ? { refreshedPhase: expectation.refreshedPhase }
      : {}),
  };
}

function playerRecoveryEvidence(laneId) {
  const expectation = playerRecoveryStatusExpectationForLane(laneId);
  return {
    roleUrl: "http://127.0.0.1:5173/g/game-id",
    ...(Object.hasOwn(expectation, "ackState")
      ? { ackState: expectation.ackState }
      : {}),
    ...(Object.hasOwn(expectation, "rejectError")
      ? { rejectError: expectation.rejectError }
      : {}),
    ...(Object.hasOwn(expectation, "targetSlot")
      ? { targetSlot: expectation.targetSlot }
      : {}),
    ...(Object.hasOwn(expectation, "apiTargetAlive")
      ? { apiTargetAlive: expectation.apiTargetAlive }
      : {}),
    ...(Object.hasOwn(expectation, "refreshedPhase")
      ? { refreshedPhase: expectation.refreshedPhase }
      : {}),
    ...(Object.hasOwn(expectation, "actionVisibleAfterRefresh")
      ? { actionVisibleAfterRefresh: expectation.actionVisibleAfterRefresh }
      : {}),
  };
}

test("core loop highlighted completed-game lanes come from shared scenarios", () => {
  assert.deepEqual(
    CORE_LOOP_COMPLETED_GAME_HIGHLIGHTED_LANE_IDS,
    completedGameSeedRequiredScenarioIds(),
  );
});

test("completed-game lane status is keyed by shared metadata, not lane literals", async () => {
  const source = await readFile(
    new URL("./local-proof-lane-status.mjs", import.meta.url),
    "utf8",
  );
  for (const laneId of completedGameSeedRequiredScenarioIds()) {
    assert(
      !source.includes(`case "${laneId}"`),
      `completed-game status should not switch directly on ${laneId}`,
    );
  }
  assert(
    source.includes("completedGameHardeningLaneCases"),
    "completed-game status should resolve shared hardening lane cases",
  );
});

test("hardening highlighted recovery lanes come from shared hardening scenarios", () => {
  for (const laneId of hardeningRecoveryHighlightedLaneIds) {
    assert(
      HARDENING_HIGHLIGHTED_LANE_IDS.includes(laneId),
      `missing highlighted hardening recovery lane ${laneId}`,
    );
  }
});

test("highlighted host stale-command lanes come from shared scenarios", () => {
  for (const laneId of coreLoopHostStaleCommandHighlightedLaneIds) {
    assert(
      CORE_LOOP_HIGHLIGHTED_LANE_IDS.includes(laneId),
      `missing core-loop host stale lane ${laneId}`,
    );
  }
  for (const laneId of hardeningHostStaleCommandHighlightedLaneIds) {
    assert(
      HARDENING_HIGHLIGHTED_LANE_IDS.includes(laneId),
      `missing hardening host stale lane ${laneId}`,
    );
  }
});

test("highlighted player recovery lanes come from shared scenarios", () => {
  for (const laneId of hardeningPlayerRecoveryHighlightedLaneIds) {
    assert(
      HARDENING_HIGHLIGHTED_LANE_IDS.includes(laneId),
      `missing hardening player recovery lane ${laneId}`,
    );
  }
});

test("core loop lane status formats seeded recovery evidence", () => {
  const privateInvalidAction = privateChannelInvalidActionRecoveryScenario();
  assert.equal(
    coreLoopLaneStatus({
      id: "core-loop",
      status: "passed",
      evidence: {
        rejectedVoteError: "PhaseLocked",
        staleVoteVotecountUnchanged: true,
        lockState: "ack",
        unlockState: "ack",
      },
    }),
    "passed: PhaseLocked vote receipt, unchanged true, lock ack/unlock ack",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "invalid-action-recovery",
      status: "passed",
      evidence: {
        rejectError: "InvalidTarget",
        receiptStatusText: playerInvalidActionRecoveryMessage,
        legalActionVisible: true,
      },
    }),
    `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
  );
  assert.equal(
    coreLoopLaneStatus({
      id: coreLoopPrivateChannelInvalidActionLaneId,
      status: "passed",
      evidence: {
        channel: privateInvalidAction.channelId,
        error: privateInvalidAction.commandError,
        receiptStatusText: privateInvalidAction.commandMessage,
        legalActionVisible: true,
      },
    }),
    `passed: channel ${privateInvalidAction.channelId}, ${privateInvalidAction.commandMessage}, legal action visible true`,
  );
  assert.equal(
    coreLoopLaneStatus({
      id: coreLoopPrivateChannelStalePostLaneId,
      status: "passed",
      evidence: {
        channel: "private:mafia_day_chat",
        receiptStatusText: "Ack: stream seqs 43",
        refreshedLocked: true,
      },
    }),
    "passed: channel private:mafia_day_chat, Ack: stream seqs 43, locked true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: hostStaleAdvanceControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleAdvanceControlLaneId),
    }),
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: hostStaleResolveControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleResolveControlLaneId),
    }),
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-host-complete-reload",
      status: "passed",
      evidence: {
        rejectReceipt: "Reject GameAlreadyCompleted: game already completed",
        revealedSlots: 1,
        completeActionVisible: false,
      },
    }),
    "passed: Reject GameAlreadyCompleted: game already completed, revealed 1, complete visible false",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "concurrent-player-complete-race",
      status: "passed",
      evidence: {
        postError: "GameAlreadyCompleted",
        apiCompleted: true,
        apiThreadHasPost: false,
      },
    }),
    "passed: post GameAlreadyCompleted, completed true, thread post false",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-player-complete-reload",
      status: "passed",
      evidence: {
        gameCompleted: true,
        currentVote: "false",
        threadPostCount: 0,
      },
    }),
    "passed: completed true, vote false, posts 0",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: hostStaleResolveReloadLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleResolveReloadLaneId),
    }),
    "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: hostStaleAdvanceReloadLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleAdvanceReloadLaneId),
    }),
    "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "action-loop",
      status: "passed",
      evidence: {
        actionRoleUrl: "http://127.0.0.1:5173/g/game-id",
        nightPhase: "N01",
        targetReceiptStatus: "factional_kill",
        d02VoteOutcomeStatus: "Lynch",
        nextNightPhase: "N02",
      },
    }),
    "passed: role URL true, night N01, receipt factional_kill, D02 Lynch, next N02",
  );
  assert.equal(coreLoopLaneStatus({ id: "unhighlighted", status: "passed" }), "passed");
});

test("core loop spine status formats compact live spine evidence", () => {
  assert.equal(
    coreLoopSpineStatus({
      coreLoopSpine: {
        status: "passed",
        cycles: [
          {
            id: "d01-n01-d02",
            checkpoints: [
              { id: "d01-resolved-locked", phase: "D01" },
              { id: "n01-action-open", phase: "N01" },
              { id: "d02-day-controls-return", phase: "D02" },
            ],
          },
          {
            id: "d02-n02",
            checkpoints: [
              { id: "d02-deciding-vote-submitted", voteState: "ack" },
              { id: "n02-action-open", phase: "N02" },
            ],
          },
          {
            id: "n02-d03",
            checkpoints: [
              { id: "n02-action-submitted", actionState: "ack" },
              { id: "d03-day-controls-return", phase: "D03" },
              {
                id: "d03-terminal-advance-reject",
                rejectError: "InvalidTarget",
              },
              {
                id: "d03-terminal-reload-recovery",
                phase: "D03",
              },
              {
                id: "d03-revote-prompt-resolved",
                phase: "D03R1",
                decisionPolicy: "no_majority_continue_revote",
              },
              {
                id: "d03r1-revote-ballot-submitted",
                voteState: "ack",
              },
              {
                id: "d03r1-revote-resolved-no-majority",
                resolveState: "ack",
              },
              {
                id: "d03r2-revote-prompt-resolved",
                phase: "D03R2",
                decisionPolicy: "no_majority_continue_revote",
              },
              {
                id: "d03r2-revote-ballot-submitted",
                voteState: "ack",
              },
              {
                id: "d03r2-revote-resolved-no-majority",
                resolveState: "ack",
                decisionPolicy: "no_majority_no_lynch",
                nextPhase: "N03",
              },
            ],
          },
          {
            id: "n03-d04",
            checkpoints: [
              { id: "n03-action-open", phase: "N03" },
              { id: "n03-action-submitted", actionState: "ack" },
              { id: "d04-day-controls-return", phase: "D04" },
            ],
          },
        ],
      },
    }),
    "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03, N03 action ack, next D04",
  );
  assert.equal(
    coreLoopSpineStatus({}),
    "unknown: unknown -> unknown -> unknown, vote unknown, unknown action unknown, next unknown, terminal advance unknown, reload unknown, revote unknown via unknown, revote vote unknown, revote resolve unknown, second revote unknown via unknown, second vote unknown, second resolve unknown, policy unknown -> unknown",
  );
});

test("hardening lane status formats stale and concurrent conflict evidence", () => {
  const staleReconnect = stalePlayerActionReconnectExpectation();
  const privateReconnect = privateChannelStaleActionReconnectExpectation();

  assert.equal(
    hardeningLaneStatus({
      id: staleActionConflictMessageLaneId,
      status: "passed",
      evidence: staleConflictEvidence(staleActionConflictMessageLaneId),
    }),
    "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
  );
  assert.equal(
    hardeningLaneStatus({
      id: concurrentActionRaceLaneId,
      status: "passed",
      evidence: playerRecoveryEvidence(concurrentActionRaceLaneId),
    }),
    "passed: ack action, reject ActionAlreadySubmitted",
  );
  assert.equal(
    hardeningLaneStatus({
      id: concurrentActionRaceReloadLaneId,
      status: "passed",
      evidence: playerRecoveryEvidence(concurrentActionRaceReloadLaneId),
    }),
    "passed: target slot-2, alive false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: staleSameActionRecoveryLaneId,
      status: "passed",
      evidence: playerRecoveryEvidence(staleSameActionRecoveryLaneId),
    }),
    "passed: Reject ActionAlreadySubmitted, role URL true, visible false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: staleActionConflictLaneId,
      status: "passed",
      evidence: playerRecoveryEvidence(staleActionConflictLaneId),
    }),
    "passed: Reject PhaseLocked, role URL true, refreshed D02",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "concurrent-host-resolve-race-reload",
      status: "passed",
      evidence: {
        apiLocked: true,
        liveRouteStatus: 200,
        concurrentRouteStatus: 200,
      },
    }),
    "passed: locked true, routes 200/200",
  );
  assert.equal(
    hardeningLaneStatus({
      id: stalePlayerActionReconnectLaneId,
      status: "passed",
      evidence: {
        roleUrl: "http://127.0.0.1:5173/g/game-id",
        reconnectingState: staleReconnect.reconnectingState,
        recoveryState: staleReconnect.recoveryState,
        recoveredPhase: staleReconnect.recoveredPhaseId,
      },
    }),
    "passed: role URL true, reconnecting -> recovered, phase D02",
  );
  assert.equal(
    hardeningLaneStatus({
      id: privateChannelStaleActionReconnectLaneId,
      status: "passed",
      evidence: {
        roleUrl: "http://127.0.0.1:5173/g/game-id/c/private%3Amafia_day_chat",
        channelAfterReject: privateReconnect.channelId,
        reconnectChannel: privateReconnect.channelId,
        rejectError: privateReconnect.rejectError,
        recoveredPhase: privateReconnect.recoveredPhaseId,
      },
    }),
    "passed: role URL true, channel private:mafia_day_chat, reject PhaseLocked, recovered private:mafia_day_chat D02",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-complete-reconnect-recovery",
      status: "passed",
      evidence: {
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        recoveredCompleted: true,
      },
    }),
    "passed: reconnecting -> recovered, completed true",
  );
  assert.equal(
    hardeningLaneStatus({
      id: staleDeadActionConflictLaneId,
      status: "passed",
      evidence: staleConflictEvidence(staleDeadActionConflictLaneId),
    }),
    "passed: Reject SlotNotAlive, role URL true, actor dead",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleResolveControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleResolveControlLaneId),
    }),
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleResolveReconnectLaneId,
      status: "passed",
      evidence: hostStaleReconnectEvidence(hostStaleResolveReconnectLaneId),
    }),
    "passed: reconnecting -> recovered, locked true",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleAdvanceReconnectLaneId,
      status: "passed",
      evidence: hostStaleReconnectEvidence(hostStaleAdvanceReconnectLaneId),
    }),
    "passed: reconnecting -> recovered, locked false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleAdvanceControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleAdvanceControlLaneId),
    }),
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleDeadlineReconnectLaneId,
      status: "passed",
      evidence: hostStaleReconnectEvidence(hostStaleDeadlineReconnectLaneId),
    }),
    "passed: reconnecting -> recovered, deadline null",
  );
  assert.equal(
    hardeningLaneStatus({
      id: hostStaleDeadlineControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(hostStaleDeadlineControlLaneId),
    }),
    "passed: Reject PhaseLocked, role URL true, deadline null",
  );
  assert.equal(
    hardeningLaneStatus({
      id: cohostStaleDeadlineReconnectLaneId,
      status: "passed",
      evidence: hostStaleReconnectEvidence(cohostStaleDeadlineReconnectLaneId),
    }),
    "passed: reconnecting -> recovered, deadline null, phase controls 0",
  );
  assert.equal(
    hardeningLaneStatus({
      id: cohostStaleDeadlineControlLaneId,
      status: "passed",
      evidence: hostStaleControlEvidence(cohostStaleDeadlineControlLaneId),
    }),
    "passed: Reject PhaseLocked, role URL true, phase controls 0",
  );
  assert.equal(hardeningLaneStatus({ id: "unhighlighted", status: "passed" }), "passed");
});

test("highlighted lane evidence maps keep browser proof assertions aligned", () => {
  const staleReconnect = stalePlayerActionReconnectExpectation();
  const privateReconnect = privateChannelStaleActionReconnectExpectation();
  const privateInvalidAction = privateChannelInvalidActionRecoveryScenario();

  const proofRun = {
    lanes: [
      {
        id: "invalid-action-recovery",
        status: "passed",
        evidence: {
          rejectError: "InvalidTarget",
          receiptStatusText: playerInvalidActionRecoveryMessage,
          legalActionVisible: true,
        },
      },
      {
        id: coreLoopPrivateChannelInvalidActionLaneId,
        status: "passed",
        evidence: {
          channel: privateInvalidAction.channelId,
          error: privateInvalidAction.commandError,
          receiptStatusText: privateInvalidAction.commandMessage,
          legalActionVisible: true,
        },
      },
      {
        id: coreLoopPrivateChannelStalePostLaneId,
        status: "passed",
        evidence: {
          channel: "private:mafia_day_chat",
          receiptStatusText: "Ack: stream seqs 43",
          refreshedLocked: true,
        },
      },
      {
        id: staleActionConflictMessageLaneId,
        status: "passed",
        evidence: staleConflictEvidence(staleActionConflictMessageLaneId),
      },
      {
        id: stalePlayerActionReconnectLaneId,
        status: "passed",
        evidence: {
          roleUrl: "http://127.0.0.1:5173/g/game-id",
          reconnectingState: staleReconnect.reconnectingState,
          recoveryState: staleReconnect.recoveryState,
          recoveredPhase: staleReconnect.recoveredPhaseId,
        },
      },
      {
        id: privateChannelStaleActionReconnectLaneId,
        status: "passed",
        evidence: {
          roleUrl:
            "http://127.0.0.1:5173/g/game-id/c/private%3Amafia_day_chat",
          channelAfterReject: privateReconnect.channelId,
          reconnectChannel: privateReconnect.channelId,
          rejectError: privateReconnect.rejectError,
          recoveredPhase: privateReconnect.recoveredPhaseId,
        },
      },
      {
        id: "stale-host-complete-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          recoveredCompleted: true,
          revealedSlots: 1,
        },
      },
      {
        id: "stale-host-complete-reload",
        status: "passed",
        evidence: {
          rejectReceipt: "Reject GameAlreadyCompleted: game already completed",
          revealedSlots: 1,
          completeActionVisible: false,
        },
      },
      {
        id: "concurrent-host-complete-race",
        status: "passed",
        evidence: {
          rejectError: "GameAlreadyCompleted",
          apiCompleted: true,
          apiRevealedSlots: 1,
        },
      },
      {
        id: "concurrent-host-complete-race-reload",
        status: "passed",
        evidence: {
          apiCompleted: true,
          firstRevealedSlots: 1,
          secondRevealedSlots: 1,
        },
      },
      {
        id: "concurrent-player-complete-race",
        status: "passed",
        evidence: {
          postError: "GameAlreadyCompleted",
          apiCompleted: true,
          apiThreadHasPost: false,
        },
      },
      {
        id: "public-player-complete-reload",
        status: "passed",
        evidence: {
          gameCompleted: true,
          reloadPostCount: 0,
        },
      },
      {
        id: "stale-player-complete-reload",
        status: "passed",
        evidence: {
          gameCompleted: true,
          currentVote: "false",
          threadPostCount: 0,
        },
      },
      {
        id: hostStaleResolveReconnectLaneId,
        status: "passed",
        evidence: hostStaleReconnectEvidence(hostStaleResolveReconnectLaneId),
      },
      {
        id: hostStaleAdvanceControlLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(hostStaleAdvanceControlLaneId),
      },
      {
        id: hostStaleAdvanceReconnectLaneId,
        status: "passed",
        evidence: hostStaleReconnectEvidence(hostStaleAdvanceReconnectLaneId),
      },
      {
        id: hostStaleDeadlineControlLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(hostStaleDeadlineControlLaneId),
      },
      {
        id: hostStaleDeadlineReconnectLaneId,
        status: "passed",
        evidence: hostStaleReconnectEvidence(hostStaleDeadlineReconnectLaneId),
      },
      {
        id: cohostStaleDeadlineControlLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(cohostStaleDeadlineControlLaneId),
      },
      {
        id: cohostStaleDeadlineReconnectLaneId,
        status: "passed",
        evidence: hostStaleReconnectEvidence(cohostStaleDeadlineReconnectLaneId),
      },
      {
        id: hostStaleResolveControlLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(hostStaleResolveControlLaneId),
      },
      {
        id: hostStaleResolveReloadLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(hostStaleResolveReloadLaneId),
      },
      {
        id: hostStaleAdvanceReloadLaneId,
        status: "passed",
        evidence: hostStaleControlEvidence(hostStaleAdvanceReloadLaneId),
      },
    ],
  };

  assert.deepEqual(Object.keys(coreLoopHighlightedLaneEvidence(proofRun)), [
    ...CORE_LOOP_HIGHLIGHTED_LANE_IDS,
  ]);
  assert.deepEqual(Object.keys(hardeningHighlightedLaneEvidence(proofRun)), [
    ...HARDENING_HIGHLIGHTED_LANE_IDS,
  ]);
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["invalid-action-recovery"],
    `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[
      coreLoopPrivateChannelInvalidActionLaneId
    ],
    `passed: channel ${privateInvalidAction.channelId}, ${privateInvalidAction.commandMessage}, legal action visible true`,
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[
      coreLoopPrivateChannelStalePostLaneId
    ],
    "passed: channel private:mafia_day_chat, Ack: stream seqs 43, locked true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-host-complete-reload"],
    "passed: Reject GameAlreadyCompleted: game already completed, revealed 1, complete visible false",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[
      "stale-host-complete-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, completed true, revealed 1",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["concurrent-host-complete-race"],
    "passed: reject GameAlreadyCompleted, completed true, revealed 1",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[
      "concurrent-host-complete-race-reload"
    ],
    "passed: completed true, revealed 1/1",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[
      "concurrent-player-complete-race"
    ],
    "passed: post GameAlreadyCompleted, completed true, thread post false",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["public-player-complete-reload"],
    "passed: completed true, posts 0",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-player-complete-reload"],
    "passed: completed true, vote false, posts 0",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[hostStaleResolveControlLaneId],
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[hostStaleResolveReloadLaneId],
    "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[hostStaleAdvanceControlLaneId],
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)[hostStaleAdvanceReloadLaneId],
    "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[staleActionConflictMessageLaneId],
    "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-action-reconnect-recovery"],
    "passed: role URL true, reconnecting -> recovered, phase D02",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "private-channel-stale-action-reconnect-recovery"
    ],
    "passed: role URL true, channel private:mafia_day_chat, reject PhaseLocked, recovered private:mafia_day_chat D02",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-host-complete-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, completed true",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[hostStaleResolveReconnectLaneId],
    "passed: reconnecting -> recovered, locked true",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[hostStaleAdvanceControlLaneId],
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[hostStaleAdvanceReconnectLaneId],
    "passed: reconnecting -> recovered, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[hostStaleDeadlineControlLaneId],
    "passed: Reject PhaseLocked, role URL true, deadline null",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[hostStaleDeadlineReconnectLaneId],
    "passed: reconnecting -> recovered, deadline null",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[cohostStaleDeadlineControlLaneId],
    "passed: Reject PhaseLocked, role URL true, phase controls 0",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[cohostStaleDeadlineReconnectLaneId],
    "passed: reconnecting -> recovered, deadline null, phase controls 0",
  );
  assert.equal(coreLoopHighlightedLaneEvidence(proofRun)["core-loop"], "unknown");
  assert.equal(hardeningHighlightedLaneEvidence(proofRun)["reconnect-recovery"], "unknown");
});
