import test from "node:test";
import assert from "node:assert/strict";
import {
  cohostDeadlineStaleBasePassed,
  hostPhaseStaleBasePassed,
  hostPhaseStaleReconnectPassed,
  hostPhaseStaleReloadPassed,
} from "./dev_test_game_host_stale_command_assertions.mjs";
import {
  cohostDeadlineStaleControlCases,
  hostStaleResolveControlCase,
} from "./dev_test_game_host_stale_control_scenarios.mjs";

const session = Object.freeze({ game: "game-a" });

const hostResolveProofFixture = () => ({
  status: "passed",
  setup: {
    roleUrl: "http://127.0.0.1:5173/g/game-a/host",
    stalePhase: { id: "D02", locked: false },
    phaseActions: ["resolve_phase", "lock_thread"],
    deadlineActions: [],
  },
  staleClickBrowserProof: {
    roleUrl: "http://127.0.0.1:5173/g/game-a/host",
    clickedActionId: "resolve_phase",
    receiptStatusText: "Reject PhaseLocked: stale phase state",
    dispatchRefreshKeys: ["host"],
    phaseAfterReject: { id: "D02", locked: true },
    phaseActionsAfterReject: ["unlock_thread", "advance_phase"],
  },
  liveResolve: {
    commandStatus: { state: "ack", streamSeqs: [1, 2] },
  },
  reject: {
    state: "reject",
    error: "PhaseLocked",
    message: "Reject PhaseLocked: stale phase state",
    serverEnvelope: { body: { kind: "Reject" } },
  },
  phaseAfterReject: { id: "D02", locked: true },
  phaseActionsAfterReject: ["unlock_thread", "advance_phase"],
  deadlineActionsAfterReject: ["extend_deadline"],
  activityRow: { source: "outcome", actionId: "resolve_phase" },
  dispatchPlan: { projectionRefreshKeys: ["host"] },
  apiPhaseAfterReject: { phase_id: "D02", locked: true },
  restoreAfterReject: { commandStatus: { state: "ack" } },
  apiPhaseAfterRestore: { phase_id: "D02", locked: false },
  staleHostResolveReloadAfterReject: {
    status: "passed",
    routeResponseStatus: 200,
    rejectReceiptStatusText: "Reject PhaseLocked: stale phase state",
    phaseAfterReload: { id: "D02", locked: true },
    phaseActionsAfterReload: ["unlock_thread", "advance_phase"],
    deadlineActionsAfterReload: ["extend_deadline"],
    apiPhaseAfterReload: { phase_id: "D02", locked: true },
  },
  reconnectAfterReject: {
    status: "passed",
    reconnectingStatus: { state: "reconnecting" },
    reconnectRecoveryEvent: { state: "recovered", attempt: 1 },
    recoveredHostProjection: { phase: { id: "D02", locked: true } },
  },
  phaseActionsAfterReconnect: ["unlock_thread", "advance_phase"],
  deadlineActionsAfterReconnect: ["extend_deadline"],
});

const cohostDeadlineProofFixture = () => ({
  status: "passed",
  setup: {
    roleUrl: "http://127.0.0.1:5173/g/game-a/host",
    stalePhase: { id: "D01", locked: false },
    phaseActions: [],
    deadlineActions: ["extend_deadline"],
  },
  staleClickBrowserProof: {
    roleUrl: "http://127.0.0.1:5173/g/game-a/host",
    clickedActionId: "extend_deadline",
    receiptStatusText: "Reject PhaseLocked: stale phase state",
    dispatchRefreshKeys: ["host"],
    phaseAfterReject: { id: "D02", locked: false },
    phaseActionsAfterReject: [],
    deadlineActionsAfterReject: ["extend_deadline"],
    apiPhaseAfterReject: {
      phase_id: "D02",
      locked: false,
      deadline: null,
    },
  },
  reject: {
    error: "PhaseLocked",
    message: "Reject PhaseLocked: stale phase state",
  },
  phaseAfterReject: { id: "D02", locked: false },
  phaseActionsAfterReject: [],
  deadlineActionsAfterReject: ["extend_deadline"],
  activityRow: { source: "outcome", actionId: "extend_deadline" },
  dispatchPlan: { projectionRefreshKeys: ["host"] },
  apiPhaseAfterReject: {
    phase_id: "D02",
    locked: false,
    deadline: null,
  },
});

test("host stale resolve base assertion covers reject and current controls", () => {
  assert.equal(
    hostPhaseStaleBasePassed({
      proof: hostResolveProofFixture(),
      session,
      scenario: hostStaleResolveControlCase(),
    }),
    true,
  );
});

test("host stale resolve base assertion rejects missing host refresh", () => {
  const proof = hostResolveProofFixture();
  proof.dispatchPlan.projectionRefreshKeys = [];

  assert.equal(
    hostPhaseStaleBasePassed({
      proof,
      session,
      scenario: hostStaleResolveControlCase(),
    }),
    false,
  );
});

test("host stale resolve reload and reconnect assertions cover recovery surfaces", () => {
  const proof = hostResolveProofFixture();
  const scenario = hostStaleResolveControlCase();

  assert.equal(
    hostPhaseStaleReloadPassed({
      proof,
      reloadProof: proof.staleHostResolveReloadAfterReject,
      scenario,
    }),
    true,
  );
  assert.equal(
    hostPhaseStaleReconnectPassed({
      proof,
      reconnectProof: proof.reconnectAfterReject,
      scenario,
    }),
    true,
  );
});

test("cohost deadline base assertion covers delegated stale recovery", () => {
  assert.equal(
    cohostDeadlineStaleBasePassed({
      proof: cohostDeadlineProofFixture(),
      session,
      scenario: cohostDeadlineStaleControlCases()[0],
    }),
    true,
  );
});

test("cohost deadline base assertion rejects exposed phase actions", () => {
  const proof = cohostDeadlineProofFixture();
  proof.phaseActionsAfterReject = ["resolve_phase"];

  assert.equal(
    cohostDeadlineStaleBasePassed({
      proof,
      session,
      scenario: cohostDeadlineStaleControlCases()[0],
    }),
    false,
  );
});
