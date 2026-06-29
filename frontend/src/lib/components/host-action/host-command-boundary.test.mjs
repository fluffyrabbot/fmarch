import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHostCommandEnvelope,
  buildHostConsoleStateEndpoint,
  mapHostActionToWireCommand,
  projectHostConsoleState,
  sendHostActionCommand,
} from "./host-command-boundary.mjs";

const EXTEND_EVENT = Object.freeze({
  actionId: "extend_deadline",
  payload: Object.freeze({
    kind: "extend_deadline",
    gameId: "00000000-0000-0000-0000-000000000001",
    phaseId: "day-2",
    extendsTo: "2026-06-20T04:00:00Z",
  }),
});

const REPLACEMENT_EVENT = Object.freeze({
  actionId: "process_replacement",
  payload: Object.freeze({
    kind: "process_replacement",
    gameId: "00000000-0000-0000-0000-000000000001",
    slotId: "slot-7",
    outgoingPlayerId: "player-mira",
    incomingPlayerId: "player-rowan",
  }),
});

const LOCK_THREAD_EVENT = Object.freeze({
  actionId: "lock_thread",
  payload: Object.freeze({
    kind: "lock_thread",
    gameId: "00000000-0000-0000-0000-000000000001",
  }),
});

const UNLOCK_THREAD_EVENT = Object.freeze({
  actionId: "unlock_thread",
  payload: Object.freeze({
    kind: "unlock_thread",
    gameId: "00000000-0000-0000-0000-000000000001",
  }),
});

const RESOLVE_PHASE_EVENT = Object.freeze({
  actionId: "resolve_phase",
  payload: Object.freeze({
    kind: "resolve_phase",
    gameId: "00000000-0000-0000-0000-000000000001",
    seed: 918273,
  }),
});

const ADVANCE_PHASE_EVENT = Object.freeze({
  actionId: "advance_phase",
  payload: Object.freeze({
    kind: "advance_phase",
    gameId: "00000000-0000-0000-0000-000000000001",
  }),
});

const ADVANCE_PHASE_BY_DEADLINE_EVENT = Object.freeze({
  actionId: "advance_phase_by_deadline",
  payload: Object.freeze({
    kind: "advance_phase_by_deadline",
    gameId: "00000000-0000-0000-0000-000000000001",
    phaseId: "D01",
    observedAt: 1781928001,
  }),
});

const PUBLISH_VOTECOUNT_EVENT = Object.freeze({
  actionId: "publish_votecount",
  payload: Object.freeze({
    kind: "publish_votecount",
    gameId: "00000000-0000-0000-0000-000000000001",
  }),
});

const MARK_DEAD_EVENT = Object.freeze({
  actionId: "mark_dead",
  payload: Object.freeze({
    kind: "mark_dead",
    gameId: "00000000-0000-0000-0000-000000000001",
    slotId: "slot-7",
    status: "dead",
  }),
});

const MODKILL_EVENT = Object.freeze({
  actionId: "modkill_slot",
  payload: Object.freeze({
    kind: "modkill_slot",
    gameId: "00000000-0000-0000-0000-000000000001",
    slotId: "slot-7",
    status: "modkilled",
  }),
});

const COMPLETE_GAME_EVENT = Object.freeze({
  actionId: "complete_game",
  payload: Object.freeze({
    kind: "complete_game",
    gameId: "00000000-0000-0000-0000-000000000001",
  }),
});

const RESOLVE_PROMPT_ACK_EVENT = Object.freeze({
  actionId: "resolve_host_prompt-D01-skip_next_day-slot_1",
  payload: Object.freeze({
    kind: "resolve_host_prompt",
    gameId: "00000000-0000-0000-0000-000000000001",
    promptId: "D01:skip_next_day:slot_1",
    decision: Object.freeze({ kind: "acknowledge" }),
  }),
});

const RESOLVE_PROMPT_SELECT_SLOT_EVENT = Object.freeze({
  actionId: "resolve_host_prompt-D01-tie-slot_2",
  payload: Object.freeze({
    kind: "resolve_host_prompt",
    gameId: "00000000-0000-0000-0000-000000000001",
    promptId: "D01:tie:slot_2",
    decision: Object.freeze({ kind: "select_slot", slot: "slot_2" }),
  }),
});

test("host actions map to generated wire command variants", () => {
  assert.deepEqual(mapHostActionToWireCommand(EXTEND_EVENT), {
    ExtendDeadline: {
      game: "00000000-0000-0000-0000-000000000001",
      phase: "day-2",
      at: 1781928000,
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(REPLACEMENT_EVENT), {
    ProcessReplacement: {
      game: "00000000-0000-0000-0000-000000000001",
      slot: "slot-7",
      outgoing_user: "player-mira",
      incoming_user: "player-rowan",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(LOCK_THREAD_EVENT), {
    LockThread: {
      game: "00000000-0000-0000-0000-000000000001",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(UNLOCK_THREAD_EVENT), {
    UnlockThread: {
      game: "00000000-0000-0000-0000-000000000001",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(RESOLVE_PHASE_EVENT), {
    ResolvePhase: {
      game: "00000000-0000-0000-0000-000000000001",
      seed: 918273,
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(ADVANCE_PHASE_EVENT), {
    AdvancePhase: {
      game: "00000000-0000-0000-0000-000000000001",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(ADVANCE_PHASE_BY_DEADLINE_EVENT), {
    AdvancePhaseByDeadline: {
      game: "00000000-0000-0000-0000-000000000001",
      phase: "D01",
      observed_at: 1781928001,
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(PUBLISH_VOTECOUNT_EVENT), {
    PublishVotecount: {
      game: "00000000-0000-0000-0000-000000000001",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(MARK_DEAD_EVENT), {
    SetSlotStatus: {
      game: "00000000-0000-0000-0000-000000000001",
      slot: "slot-7",
      status: "dead",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(MODKILL_EVENT), {
    SetSlotStatus: {
      game: "00000000-0000-0000-0000-000000000001",
      slot: "slot-7",
      status: "modkilled",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(COMPLETE_GAME_EVENT), {
    CompleteGame: {
      game: "00000000-0000-0000-0000-000000000001",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(RESOLVE_PROMPT_ACK_EVENT), {
    ResolveHostPrompt: {
      game: "00000000-0000-0000-0000-000000000001",
      prompt_id: "D01:skip_next_day:slot_1",
      decision: "Acknowledge",
    },
  });
  assert.deepEqual(mapHostActionToWireCommand(RESOLVE_PROMPT_SELECT_SLOT_EVENT), {
    ResolveHostPrompt: {
      game: "00000000-0000-0000-0000-000000000001",
      prompt_id: "D01:tie:slot_2",
      decision: { SelectSlot: { slot: "slot_2" } },
    },
  });
});

test("host command envelope uses the Rust wire ClientEnvelope shape", () => {
  const envelope = buildHostCommandEnvelope({
    actionEvent: EXTEND_EVENT,
    principalUserId: "host_h",
    commandId: "11111111-1111-4111-8111-111111111111",
    envelopeId: 7,
  });

  assert.deepEqual(envelope, {
    v: 1,
    id: 7,
    body: {
      kind: "Command",
      body: {
        command_id: "11111111-1111-4111-8111-111111111111",
        principal_user_id: "host_h",
        command: {
          ExtendDeadline: {
            game: "00000000-0000-0000-0000-000000000001",
            phase: "day-2",
            at: 1781928000,
          },
        },
      },
    },
  });
});

test("host command sender normalizes Ack and Reject server truth", async () => {
  const sent = [];
  const ack = await sendHostActionCommand({
    actionEvent: EXTEND_EVENT,
    principalUserId: "host_h",
    endpoint: "/commands",
    commandIdFactory: () => "11111111-1111-4111-8111-111111111111",
    envelopeIdFactory: () => 7,
    fetchImpl: async (url, init) => {
      sent.push({ url, envelope: JSON.parse(init.body) });
      return jsonResponse({
        v: 1,
        id: 7,
        body: { kind: "Ack", body: { stream_seqs: [101, 102] } },
      });
    },
  });

  assert.equal(sent[0].url, "/commands");
  assert.equal(sent[0].envelope.body.kind, "Command");
  assert.equal(ack.state, "ack");
  assert.deepEqual(ack.streamSeqs, [101, 102]);
  assert.match(ack.message, /101, 102/);

  const reject = await sendHostActionCommand({
    actionEvent: REPLACEMENT_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "22222222-2222-4222-8222-222222222222",
    envelopeIdFactory: () => 8,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 8,
        body: {
          kind: "Reject",
          body: {
            error: "UnknownSlot",
            retryable: false,
            message: "unknown slot",
          },
        },
      }),
  });

  assert.equal(reject.state, "reject");
  assert.equal(reject.error, "UnknownSlot");
  assert.match(reject.message, /unknown slot/);

  const stalePhaseReject = await sendHostActionCommand({
    actionEvent: LOCK_THREAD_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "44444444-4444-4444-8444-444444444444",
    envelopeIdFactory: () => 10,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 10,
        body: {
          kind: "Reject",
          body: {
            error: "PhaseLocked",
            retryable: false,
            message: "phase locked",
          },
        },
      }),
  });

  assert.equal(stalePhaseReject.state, "reject");
  assert.equal(
    stalePhaseReject.message,
    "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
  );

  const staleAdvanceReject = await sendHostActionCommand({
    actionEvent: ADVANCE_PHASE_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "45454545-4545-4545-8545-454545454545",
    envelopeIdFactory: () => 15,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 15,
        body: {
          kind: "Reject",
          body: {
            error: "InvalidTarget",
            retryable: false,
            message: "invalid target",
          },
        },
      }),
  });

  assert.equal(staleAdvanceReject.state, "reject");
  assert.equal(staleAdvanceReject.error, "InvalidTarget");
  assert.equal(
    staleAdvanceReject.message,
    "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
  );

  const stalePublishReject = await sendHostActionCommand({
    actionEvent: PUBLISH_VOTECOUNT_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "46464646-4646-4646-8646-464646464646",
    envelopeIdFactory: () => 16,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 16,
        body: {
          kind: "Reject",
          body: {
            error: "InvalidTarget",
            retryable: false,
            message: "invalid target",
          },
        },
      }),
  });

  assert.equal(stalePublishReject.state, "reject");
  assert.equal(stalePublishReject.error, "InvalidTarget");
  assert.equal(
    stalePublishReject.message,
    "Reject InvalidTarget: invalid target; official votecount is already published, refresh the thread before retrying",
  );

  const staleLifecycleReject = await sendHostActionCommand({
    actionEvent: MARK_DEAD_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "47474747-4747-4747-8747-474747474747",
    envelopeIdFactory: () => 17,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 17,
        body: {
          kind: "Reject",
          body: {
            error: "InvalidTarget",
            retryable: false,
            message: "invalid target",
          },
        },
      }),
  });

  assert.equal(staleLifecycleReject.state, "reject");
  assert.equal(staleLifecycleReject.error, "InvalidTarget");
  assert.equal(
    staleLifecycleReject.message,
    "Reject InvalidTarget: invalid target; slot lifecycle is already current, refresh the slot controls before retrying",
  );

  const staleReplacementReject = await sendHostActionCommand({
    actionEvent: REPLACEMENT_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "55555555-5555-4555-8555-555555555555",
    envelopeIdFactory: () => 11,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 11,
        body: {
          kind: "Reject",
          body: {
            error: "InvalidTarget",
            retryable: false,
            message: "invalid target",
          },
        },
      }),
  });

  assert.equal(staleReplacementReject.state, "reject");
  assert.equal(
    staleReplacementReject.message,
    "Reject InvalidTarget: invalid target; replacement target is stale, refresh the host console and use the current slot occupant",
  );

  const staleDeadlineReject = await sendHostActionCommand({
    actionEvent: ADVANCE_PHASE_BY_DEADLINE_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "66666666-6666-4666-8666-666666666666",
    envelopeIdFactory: () => 12,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 12,
        body: {
          kind: "Reject",
          body: {
            error: "InvalidTarget",
            retryable: false,
            message: "invalid target",
          },
        },
      }),
  });

  assert.equal(staleDeadlineReject.state, "reject");
  assert.equal(
    staleDeadlineReject.message,
    "Reject InvalidTarget: invalid target; deadline target is stale, refresh the host console and use current phase controls",
  );

  const retryableReject = await sendHostActionCommand({
    actionEvent: REPLACEMENT_EVENT,
    principalUserId: "host_h",
    commandIdFactory: () => "33333333-3333-4333-8333-333333333333",
    envelopeIdFactory: () => 9,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 9,
        body: {
          kind: "Reject",
          body: {
            error: "StreamConflict",
            retryable: true,
            message: "stream conflict (retryable)",
          },
        },
      }),
  });

  assert.equal(retryableReject.retryable, true);
  assert.equal(
    retryableReject.message,
    "Reject StreamConflict: stream conflict (retryable); reload and retry",
  );
});

test("host command sender can refresh projected host console state after ack", async () => {
  const sent = [];
  const ack = await sendHostActionCommand({
    actionEvent: REPLACEMENT_EVENT,
    principalUserId: "host_h",
    endpoint: "/commands",
    stateEndpoint:
      "/games/00000000-0000-0000-0000-000000000001/host-console-state?principal_user_id=host_h&slot_id=slot-7",
    commandIdFactory: () => "33333333-3333-4333-8333-333333333333",
    envelopeIdFactory: () => 9,
    fetchImpl: async (url, init = {}) => {
      sent.push({ url, init });
      if (url === "/commands") {
        return jsonResponse({
          v: 1,
          id: 9,
          body: { kind: "Ack", body: { stream_seqs: [201] } },
        });
      }
      return jsonResponse({
        phase: { phase_id: "day-2", locked: false, deadline: 1781928000 },
        slots: [
          {
            slot_id: "slot-7",
            occupant_user_id: "player-rowan",
            alive: false,
            status: "modkilled",
          },
        ],
        thread_posts: [{ author_slot: "slot-7", body: "before replacement" }],
      });
    },
  });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, "/commands");
  assert.match(sent[1].url, /host-console-state/);
  assert.equal(ack.state, "ack");
  assert.equal(ack.projectionState.slots[0].occupant_user_id, "player-rowan");
});

test("host console projection maps deadline and stable slot history to labels", () => {
  const projection = projectHostConsoleState(
    {
      completed: true,
      phase: { phase_id: "day-2", locked: true, deadline: 1781928000 },
      slots: [
        {
          slot_id: "slot-7",
          occupant_user_id: "player-rowan",
          alive: false,
          status: "modkilled",
          role_key: "encryptor",
          alignment: "mafia",
          role_revealed: true,
          alignment_revealed: true,
        },
      ],
      thread_posts: [{ author_slot: "slot-7", body: "before replacement" }],
    },
    {
      phase: {
        id: "day-2",
        deadlineLabel: "No deadline extension committed",
        lockedLabel: "Thread open",
      },
      replacement: {
        slotId: "slot-7",
        occupantLabel: "player-mira",
        lifecycleLabel: "Alive",
        historyLabel: "Waiting for replacement command proof",
      },
    },
  );

  assert.equal(projection.completed, true);
  assert.equal(projection.phase.deadlineLabel, "Jun 19, 2026, 9:00 PM");
  assert.equal(projection.phase.deadline, 1781928000);
  assert.equal(projection.phase.lockedLabel, "Thread locked");
  assert.equal(projection.replacement.occupantLabel, "player-rowan");
  assert.equal(projection.replacement.lifecycleLabel, "Modkilled");
  assert.equal(projection.slots[0].role_key, "encryptor");
  assert.equal(projection.slots[0].alignment, "mafia");
  assert.equal(projection.slots[0].role_revealed, true);
  assert.equal(projection.slots[0].alignment_revealed, true);
  assert.equal(
    projection.replacement.historyLabel,
    "Slot history remains attached to slot-7",
  );
});

test("host console projection clears explicit null deadlines", () => {
  const projection = projectHostConsoleState(
    {
      completed: false,
      phase: { phase_id: "day-3", locked: false, deadline: null },
      slots: [],
      thread_posts: [],
    },
    {
      phase: {
        id: "day-2",
        deadline: 1781928000,
        deadlineLabel: "Jun 19, 2026, 9:00 PM",
        lockedLabel: "Thread locked",
      },
      replacement: {
        slotId: "slot-7",
        occupantLabel: "player-mira",
        lifecycleLabel: "Alive",
        historyLabel: "Waiting for replacement command proof",
      },
    },
  );

  assert.equal(projection.phase.id, "day-3");
  assert.equal(projection.phase.locked, false);
  assert.equal(projection.phase.deadline, null);
  assert.equal(projection.phase.deadlineLabel, "No deadline extension committed");
});

test("host console state endpoint is scoped by principal and slot", () => {
  assert.equal(
    buildHostConsoleStateEndpoint({
      gameId: "00000000-0000-0000-0000-000000000001",
      principalUserId: "host_h",
      slotId: "slot-7",
    }),
    "/games/00000000-0000-0000-0000-000000000001/host-console-state?principal_user_id=host_h&slot_id=slot-7",
  );
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}
