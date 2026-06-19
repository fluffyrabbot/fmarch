import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHostCommandEnvelope,
  mapHostActionToWireCommand,
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
});

function jsonResponse(body) {
  return {
    status: 200,
    async json() {
      return body;
    },
  };
}
