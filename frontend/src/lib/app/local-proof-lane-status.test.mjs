import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORE_LOOP_HIGHLIGHTED_LANE_IDS,
  HARDENING_HIGHLIGHTED_LANE_IDS,
  coreLoopHighlightedLaneEvidence,
  coreLoopLaneStatus,
  coreLoopSpineStatus,
  hardeningHighlightedLaneEvidence,
  hardeningLaneStatus,
} from "./local-proof-lane-status.mjs";

test("core loop lane status formats seeded recovery evidence", () => {
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
        legalActionVisible: true,
      },
    }),
    "passed: Reject InvalidTarget, legal action visible true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-host-advance",
      status: "passed",
      evidence: {
        rejectError: "InvalidTarget",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        locked: false,
      },
    }),
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-host-resolve",
      status: "passed",
      evidence: {
        rejectError: "PhaseLocked",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        locked: true,
      },
    }),
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-host-resolve-reload",
      status: "passed",
      evidence: {
        rejectReceipt:
          "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
        locked: true,
      },
    }),
    "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
  );
  assert.equal(
    coreLoopLaneStatus({
      id: "stale-host-advance-reload",
      status: "passed",
      evidence: {
        rejectReceipt:
          "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
        locked: false,
      },
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

test("core loop spine status formats compact two-cycle evidence", () => {
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
        ],
      },
    }),
    "passed: D01 -> N01 -> D02, vote ack, next N02",
  );
  assert.equal(
    coreLoopSpineStatus({}),
    "unknown: unknown -> unknown -> unknown, vote unknown, next unknown",
  );
});

test("hardening lane status formats stale and concurrent conflict evidence", () => {
  assert.equal(
    hardeningLaneStatus({
      id: "stale-action-conflict-message",
      status: "passed",
      evidence: {
        roleUrl: "http://127.0.0.1:5173/g/game-id",
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      },
    }),
    "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
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
      id: "stale-action-reconnect-recovery",
      status: "passed",
      evidence: {
        roleUrl: "http://127.0.0.1:5173/g/game-id",
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        recoveredPhase: "D02",
      },
    }),
    "passed: role URL true, reconnecting -> recovered, phase D02",
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
      id: "stale-dead-action-conflict",
      status: "passed",
      evidence: {
        rejectError: "SlotNotAlive",
        roleUrl: "http://127.0.0.1:5173/g/game-id",
        actorStatusAfterReject: "dead",
      },
    }),
    "passed: Reject SlotNotAlive, role URL true, actor dead",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-resolve",
      status: "passed",
      evidence: {
        rejectError: "PhaseLocked",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        locked: true,
      },
    }),
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-resolve-reconnect-recovery",
      status: "passed",
      evidence: {
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        recoveredLocked: true,
      },
    }),
    "passed: reconnecting -> recovered, locked true",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-advance-reconnect-recovery",
      status: "passed",
      evidence: {
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        recoveredLocked: false,
      },
    }),
    "passed: reconnecting -> recovered, locked false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-advance",
      status: "passed",
      evidence: {
        rejectError: "InvalidTarget",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        locked: false,
      },
    }),
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-deadline-reconnect-recovery",
      status: "passed",
      evidence: {
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        apiDeadline: null,
      },
    }),
    "passed: reconnecting -> recovered, deadline null",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-host-deadline",
      status: "passed",
      evidence: {
        rejectError: "PhaseLocked",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        apiDeadline: null,
      },
    }),
    "passed: Reject PhaseLocked, role URL true, deadline null",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-cohost-deadline-reconnect-recovery",
      status: "passed",
      evidence: {
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        apiDeadline: null,
        phaseActions: [],
      },
    }),
    "passed: reconnecting -> recovered, deadline null, phase controls 0",
  );
  assert.equal(
    hardeningLaneStatus({
      id: "stale-cohost-deadline",
      status: "passed",
      evidence: {
        rejectError: "PhaseLocked",
        roleUrl: "http://127.0.0.1:5173/g/game-id/host",
        phaseActions: [],
      },
    }),
    "passed: Reject PhaseLocked, role URL true, phase controls 0",
  );
  assert.equal(hardeningLaneStatus({ id: "unhighlighted", status: "passed" }), "passed");
});

test("highlighted lane evidence maps keep browser proof assertions aligned", () => {
  const proofRun = {
    lanes: [
      {
        id: "invalid-action-recovery",
        status: "passed",
        evidence: {
          rejectError: "InvalidTarget",
          legalActionVisible: true,
        },
      },
      {
        id: "stale-action-conflict-message",
        status: "passed",
        evidence: {
          roleUrl: "http://127.0.0.1:5173/g/game-id",
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        },
      },
      {
        id: "stale-action-reconnect-recovery",
        status: "passed",
        evidence: {
          roleUrl: "http://127.0.0.1:5173/g/game-id",
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          recoveredPhase: "D02",
        },
      },
      {
        id: "stale-host-complete-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          recoveredCompleted: true,
        },
      },
      {
        id: "stale-host-resolve-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          recoveredLocked: true,
        },
      },
      {
        id: "stale-host-advance",
        status: "passed",
        evidence: {
          rejectError: "InvalidTarget",
          roleUrl: "http://127.0.0.1:5173/g/game-id/host",
          locked: false,
        },
      },
      {
        id: "stale-host-advance-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          recoveredLocked: false,
        },
      },
      {
        id: "stale-host-deadline",
        status: "passed",
        evidence: {
          rejectError: "PhaseLocked",
          roleUrl: "http://127.0.0.1:5173/g/game-id/host",
          apiDeadline: null,
        },
      },
      {
        id: "stale-host-deadline-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          apiDeadline: null,
        },
      },
      {
        id: "stale-cohost-deadline",
        status: "passed",
        evidence: {
          rejectError: "PhaseLocked",
          roleUrl: "http://127.0.0.1:5173/g/game-id/host",
          phaseActions: [],
        },
      },
      {
        id: "stale-cohost-deadline-reconnect-recovery",
        status: "passed",
        evidence: {
          reconnectingState: "reconnecting",
          recoveryState: "recovered",
          apiDeadline: null,
          phaseActions: [],
        },
      },
      {
        id: "stale-host-resolve",
        status: "passed",
        evidence: {
          rejectError: "PhaseLocked",
          roleUrl: "http://127.0.0.1:5173/g/game-id/host",
          locked: true,
        },
      },
      {
        id: "stale-host-resolve-reload",
        status: "passed",
        evidence: {
          rejectReceipt:
            "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
          locked: true,
        },
      },
      {
        id: "stale-host-advance-reload",
        status: "passed",
        evidence: {
          rejectReceipt:
            "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
          locked: false,
        },
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
    "passed: Reject InvalidTarget, legal action visible true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-host-resolve"],
    "passed: Reject PhaseLocked, role URL true, locked true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-host-resolve-reload"],
    "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-host-advance"],
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    coreLoopHighlightedLaneEvidence(proofRun)["stale-host-advance-reload"],
    "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-action-conflict-message"],
    "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-action-reconnect-recovery"],
    "passed: role URL true, reconnecting -> recovered, phase D02",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-host-complete-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, completed true",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-host-resolve-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, locked true",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-host-advance"],
    "passed: Reject InvalidTarget, role URL true, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-host-advance-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, locked false",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-host-deadline"],
    "passed: Reject PhaseLocked, role URL true, deadline null",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-host-deadline-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, deadline null",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-cohost-deadline"],
    "passed: Reject PhaseLocked, role URL true, phase controls 0",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)[
      "stale-cohost-deadline-reconnect-recovery"
    ],
    "passed: reconnecting -> recovered, deadline null, phase controls 0",
  );
  assert.equal(coreLoopHighlightedLaneEvidence(proofRun)["core-loop"], "unknown");
  assert.equal(hardeningHighlightedLaneEvidence(proofRun)["reconnect-recovery"], "unknown");
});
