import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CORE_LOOP_HIGHLIGHTED_LANE_IDS,
  HARDENING_HIGHLIGHTED_LANE_IDS,
  coreLoopHighlightedLaneEvidence,
  coreLoopLaneStatus,
  hardeningHighlightedLaneEvidence,
  hardeningLaneStatus,
} from "./local-proof-lane-status.mjs";

test("core loop lane status formats seeded recovery evidence", () => {
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
      id: "action-loop",
      status: "passed",
      evidence: {
        legalActionState: "ack",
        advancedPhase: "D02",
      },
    }),
    "passed: legal action ack, advanced D02",
  );
  assert.equal(coreLoopLaneStatus({ id: "unhighlighted", status: "passed" }), "passed");
});

test("hardening lane status formats stale and concurrent conflict evidence", () => {
  assert.equal(
    hardeningLaneStatus({
      id: "stale-action-conflict-message",
      status: "passed",
      evidence: {
        receiptStatusText:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      },
    }),
    "passed: Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
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
        reconnectingState: "reconnecting",
        recoveryState: "recovered",
        recoveredPhase: "D02",
      },
    }),
    "passed: reconnecting -> recovered, phase D02",
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
          receiptStatusText:
            "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
        },
      },
      {
        id: "stale-action-reconnect-recovery",
        status: "passed",
        evidence: {
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
    hardeningHighlightedLaneEvidence(proofRun)["stale-action-conflict-message"],
    "passed: Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
  );
  assert.equal(
    hardeningHighlightedLaneEvidence(proofRun)["stale-action-reconnect-recovery"],
    "passed: reconnecting -> recovered, phase D02",
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
  assert.equal(coreLoopHighlightedLaneEvidence(proofRun)["core-loop"], "unknown");
  assert.equal(hardeningHighlightedLaneEvidence(proofRun)["reconnect-recovery"], "unknown");
});
