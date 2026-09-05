import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dispatchHostCommandResult,
  exposeHostCommandDispatchBridgePlan,
  exposeHostLiveProjectionEndpoint,
  exposeHostRouteWindowState,
  recordHostLiveProjectionEvent,
} from "./host-route-browser-bridge.mjs";

test("host browser bridge exposes host route projections for smoke evidence", () => {
  const windowRef = {};
  const state = {
    dispatched: [{ actionId: "lock_thread" }],
    commandOutcomes: [{ state: "ack" }],
    commandStatuses: { lock_thread: { state: "ack" } },
    projection: { phase: { id: "D01" } },
    votecount: [{ target: "slot-2" }],
    dayVoteOutcomes: [{ phaseId: "D01", winnerSlot: "slot-2" }],
    hostPrompts: [{ id: "prompt-1" }],
  };

  assert.equal(exposeHostRouteWindowState({ windowRef, ...state }), true);
  assert.equal(windowRef.__fmarchHostActionEvents, state.dispatched);
  assert.equal(windowRef.__fmarchHostCommandOutcomes, state.commandOutcomes);
  assert.equal(windowRef.__fmarchHostCommandStatuses, state.commandStatuses);
  assert.equal(windowRef.__fmarchHostProjection, state.projection);
  assert.equal(windowRef.__fmarchHostVotecountProjection, state.votecount);
  assert.equal(
    windowRef.__fmarchHostDayVoteOutcomesProjection,
    state.dayVoteOutcomes,
  );
  assert.equal(windowRef.__fmarchHostPromptsProjection, state.hostPrompts);
  assert.equal(exposeHostRouteWindowState({ windowRef: null, ...state }), false);
});

test("host browser bridge records live projection events and latest snapshot", () => {
  const windowRef = {
    __fmarchHostLiveProjectionEvents: [{ kind: "open" }],
  };
  const previousStatus = { state: "connected", message: "open" };
  const snapshot = {
    host: { replacement: { lifecycleLabel: "Modkilled" } },
    votecount: [{ target: "slot-target", count: 2 }],
    dayVoteOutcomes: [{ phaseId: "D01", winnerSlot: "slot-target" }],
    hostPrompts: [{ id: "prompt-2", status: "pending" }],
  };

  const liveStatus = recordHostLiveProjectionEvent({
    windowRef,
    message: { kind: "delta", delta: { kind: "HostPromptsChanged" } },
    snapshot,
    currentStatus: previousStatus,
    statusForEvent: (message) => ({
      state: "updated",
      message: `saw ${message.delta.kind}`,
    }),
  });

  assert.deepEqual(liveStatus, {
    state: "updated",
    message: "saw HostPromptsChanged",
  });
  assert.deepEqual(windowRef.__fmarchHostLiveProjectionEvents, [
    { kind: "open" },
    { kind: "delta", delta: { kind: "HostPromptsChanged" } },
  ]);
  assert.equal(windowRef.__fmarchHostLiveProjectionStatus, liveStatus);
  assert.equal(windowRef.__fmarchHostProjection, snapshot.host);
  assert.equal(windowRef.__fmarchHostVotecountProjection, snapshot.votecount);
  assert.equal(
    windowRef.__fmarchHostDayVoteOutcomesProjection,
    snapshot.dayVoteOutcomes,
  );
  assert.equal(windowRef.__fmarchHostPromptsProjection, snapshot.hostPrompts);
});

test("host browser bridge preserves previous live projections for null snapshots", () => {
  const windowRef = {
    __fmarchHostProjection: { phase: { id: "D01" } },
    __fmarchHostVotecountProjection: [{ target: "slot-2" }],
    __fmarchHostDayVoteOutcomesProjection: [{ phaseId: "D01" }],
    __fmarchHostPromptsProjection: [{ id: "prompt-1" }],
  };

  recordHostLiveProjectionEvent({
    windowRef,
    message: { kind: "close" },
    snapshot: null,
    currentStatus: { state: "updated", message: "updated" },
    statusForEvent: () => ({ state: "closed", message: "closed" }),
  });

  assert.deepEqual(windowRef.__fmarchHostProjection, { phase: { id: "D01" } });
  assert.deepEqual(windowRef.__fmarchHostVotecountProjection, [
    { target: "slot-2" },
  ]);
  assert.deepEqual(windowRef.__fmarchHostDayVoteOutcomesProjection, [
    { phaseId: "D01" },
  ]);
  assert.deepEqual(windowRef.__fmarchHostPromptsProjection, [
    { id: "prompt-1" },
  ]);
});

test("host browser bridge dispatches command-result events when available", () => {
  const dispatched = [];
  class FakeCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const windowRef = {
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    },
  };
  const outcome = { actionId: "advance_phase", state: "ack" };

  assert.equal(
    dispatchHostCommandResult({
      windowRef,
      outcome,
      CustomEventCtor: FakeCustomEvent,
    }),
    true,
  );
  assert.equal(dispatched[0].type, "host-command-result");
  assert.equal(dispatched[0].detail, outcome);
  assert.equal(dispatchHostCommandResult({ windowRef: {}, outcome }), false);
});

test("host browser bridge exposes live projection endpoint for runtime proof", () => {
  const windowRef = {};

  assert.equal(
    exposeHostLiveProjectionEndpoint({
      windowRef,
      endpoint: "/ws?game=midsummer",
    }),
    true,
  );
  assert.equal(windowRef.__fmarchHostLiveProjectionEndpoint, "/ws?game=midsummer");
  assert.equal(
    exposeHostLiveProjectionEndpoint({
      windowRef: undefined,
      endpoint: "/ws?game=midsummer",
    }),
    false,
  );
});

test("host browser bridge exposes command dispatch bridge plans", () => {
  const windowRef = {};
  const plan = {
    role: "moderator",
    commandKind: "ResolveHostPrompt",
  };

  assert.equal(exposeHostCommandDispatchBridgePlan({ windowRef, plan }), true);
  assert.equal(windowRef.__fmarchHostCommandDispatchBridgePlan, plan);
  assert.equal(
    exposeHostCommandDispatchBridgePlan({
      windowRef: null,
      plan,
    }),
    false,
  );
});
