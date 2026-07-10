import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAdminCommand,
  buildCommandEnvelope,
  buildPlayerCommand,
  sendCommand,
} from "./command-boundary.mjs";

test("player actions map to Rust wire command variants", () => {
  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      target: "slot-2",
    }),
    {
      SubmitVote: {
        game: "00000000-0000-0000-0000-000000000001",
        actor_slot: "slot-7",
        target: { Slot: "slot-2" },
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_vote:no_lynch",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      actionConfig: {
        commandKind: "submit_vote",
        voteTarget: "NoLynch",
      },
    }),
    {
      SubmitVote: {
        game: "00000000-0000-0000-0000-000000000001",
        actor_slot: "slot-7",
        target: "NoLynch",
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_post",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      body: "##vote slot-2",
    }),
    {
      SubmitPost: {
        game: "00000000-0000-0000-0000-000000000001",
        channel_id: "main",
        actor_slot: "slot-7",
        body: "##vote slot-2",
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_post",
      game: "00000000-0000-0000-0000-000000000001",
      channelId: "role-pm",
      actorSlot: "slot-7",
      body: "private note",
    }),
    {
      SubmitPost: {
        game: "00000000-0000-0000-0000-000000000001",
        channel_id: "role-pm",
        actor_slot: "slot-7",
        body: "private note",
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_post",
      game: "00000000-0000-0000-0000-000000000001",
      channelId: "role-pm",
      actorSlot: "slot-7",
      body: "private note with receipt",
      media: [
        {
          content_id: "a".repeat(64),
          alt: "Live faction day chat tablet receipt",
        },
      ],
    }),
    {
      SubmitPost: {
        game: "00000000-0000-0000-0000-000000000001",
        channel_id: "role-pm",
        actor_slot: "slot-7",
        body: "private note with receipt",
        media: [
          {
            content_id: "a".repeat(64),
            alt: "Live faction day chat tablet receipt",
          },
        ],
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_post",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      body: "",
      media: [
        {
          content_id: "b".repeat(64),
          alt: "Tablet canvas sketch",
        },
      ],
      actionConfig: {
        allowMediaOnlyPost: true,
      },
    }),
    {
      SubmitPost: {
        game: "00000000-0000-0000-0000-000000000001",
        channel_id: "main",
        actor_slot: "slot-7",
        body: "",
        media: [
          {
            content_id: "b".repeat(64),
            alt: "Tablet canvas sketch",
          },
        ],
      },
    },
  );

  assert.deepEqual(
    buildPlayerCommand({
      action: "submit_action",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot_4",
      actionConfig: {
        actionId: "browser_factional_kill_n01",
        templateId: "factional_kill",
        targets: ["slot-2"],
      },
    }),
    {
      SubmitAction: {
        game: "00000000-0000-0000-0000-000000000001",
        action_id: "browser_factional_kill_n01",
        actor_slot: "slot_4",
        template_id: "factional_kill",
        targets: ["slot-2"],
        grant_id: null,
      },
    },
  );
});

test("player post builder requires policy affordance for media-only posts", () => {
  assert.throws(
    () =>
      buildPlayerCommand({
        action: "submit_post",
        game: "00000000-0000-0000-0000-000000000001",
        actorSlot: "slot-7",
        body: "",
        media: [
          {
            content_id: "c".repeat(64),
            alt: "Tablet canvas sketch",
          },
        ],
      }),
    /media-only posts are enabled/,
  );
  assert.throws(
    () =>
      buildPlayerCommand({
        action: "submit_post",
        game: "00000000-0000-0000-0000-000000000001",
        actorSlot: "slot-7",
        body: "",
        actionConfig: {
          allowMediaOnlyPost: true,
        },
      }),
    /media-only posts are enabled/,
  );
});

test("generic command envelope uses the Rust ClientEnvelope shape", () => {
  const envelope = buildCommandEnvelope({
    principalUserId: "player_mira",
    commandId: "11111111-1111-4111-8111-111111111111",
    envelopeId: 10,
    command: buildPlayerCommand({
      action: "withdraw_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
    }),
  });

  assert.deepEqual(envelope, {
    v: 1,
    id: 10,
    body: {
      kind: "Command",
      body: {
        command_id: "11111111-1111-4111-8111-111111111111",
        principal_user_id: "player_mira",
        command: {
          WithdrawVote: {
            game: "00000000-0000-0000-0000-000000000001",
            actor_slot: "slot-7",
          },
        },
      },
    },
  });
});

test("admin actions map to bootstrap wire command variants", () => {
  assert.deepEqual(
    buildAdminCommand({
      action: "create_game",
      game: "00000000-0000-0000-0000-000000000123",
      pack: "mafiascum",
    }),
    {
      CreateGame: {
        game: "00000000-0000-0000-0000-000000000123",
        pack: "mafiascum",
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "add_slot",
      game: "00000000-0000-0000-0000-000000000123",
      slot: "slot_1",
    }),
    {
      AddSlot: {
        game: "00000000-0000-0000-0000-000000000123",
        slot: "slot_1",
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "assign_slot",
      game: "00000000-0000-0000-0000-000000000123",
      slot: "slot_1",
      user: "player_mira",
    }),
    {
      AssignSlot: {
        game: "00000000-0000-0000-0000-000000000123",
        slot: "slot_1",
        user: "player_mira",
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "assign_role",
      game: "00000000-0000-0000-0000-000000000123",
      slot: "slot_1",
      roleKey: "vanilla_townie",
    }),
    {
      AssignRole: {
        game: "00000000-0000-0000-0000-000000000123",
        slot: "slot_1",
        role_key: "vanilla_townie",
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "add_cohost",
      game: "00000000-0000-0000-0000-000000000123",
      user: "cohost_c",
    }),
    {
      AddCohost: {
        game: "00000000-0000-0000-0000-000000000123",
        user: "cohost_c",
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "set_post_policy",
      game: "00000000-0000-0000-0000-000000000123",
      channelId: "main",
      allowMediaOnly: true,
    }),
    {
      SetPostPolicy: {
        game: "00000000-0000-0000-0000-000000000123",
        channel_id: "main",
        allow_media_only: true,
      },
    },
  );

  assert.deepEqual(
    buildAdminCommand({
      action: "start_game",
      game: "00000000-0000-0000-0000-000000000123",
      phase: "D01",
    }),
    {
      StartGame: {
        game: "00000000-0000-0000-0000-000000000123",
        phase: "D01",
      },
    },
  );
});

test("generic command sender normalizes ack and reject outcomes", async () => {
  const ack = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      target: "slot-2",
    }),
    commandIdFactory: () => "22222222-2222-4222-8222-222222222222",
    envelopeIdFactory: () => 11,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 11,
        body: { kind: "Ack", body: { stream_seqs: [44] } },
      }),
  });
  assert.equal(ack.state, "ack");
  assert.deepEqual(ack.streamSeqs, [44]);

  const reject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "withdraw_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
    }),
    commandIdFactory: () => "33333333-3333-4333-8333-333333333333",
    envelopeIdFactory: () => 12,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 12,
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
  assert.equal(reject.state, "reject");
  assert.equal(
    reject.message,
    "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
  );

  const staleActionReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_action",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot_4",
      actionConfig: {
        actionId: "browser_factional_kill_n01",
        templateId: "factional_kill",
        targets: ["slot-2"],
      },
    }),
    commandIdFactory: () => "44444444-4444-4444-8444-444444444444",
    envelopeIdFactory: () => 13,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 13,
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
  assert.equal(
    staleActionReject.message,
    "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
  );

  const deadActionReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_action",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot_4",
      actionConfig: {
        actionId: "browser_factional_kill_n01",
        templateId: "factional_kill",
        targets: ["slot-2"],
      },
    }),
    commandIdFactory: () => "77777777-7777-4777-8777-777777777777",
    envelopeIdFactory: () => 16,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 16,
        body: {
          kind: "Reject",
          body: {
            error: "SlotNotAlive",
            retryable: false,
            message: "slot not alive",
          },
        },
      }),
  });
  assert.equal(
    deadActionReject.message,
    "Reject SlotNotAlive: slot not alive; actor is no longer alive, refresh and use current action controls",
  );

  const staleActionTargetReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_invalid_action:factional_kill",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot_4",
      actionConfig: {
        commandKind: "submit_invalid_action",
        actionId: "invalid_self_factional_kill",
        templateId: "factional_kill",
        targets: ["slot_4"],
      },
    }),
    commandIdFactory: () => "99999999-9999-4999-8999-999999999999",
    envelopeIdFactory: () => 18,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 18,
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
  assert.equal(
    staleActionTargetReject.message,
    "Reject InvalidTarget: invalid target; action target is no longer valid, refresh and use current action controls",
  );

  const staleVoteTargetReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      target: "slot-2",
    }),
    commandIdFactory: () => "88888888-8888-4888-8888-888888888888",
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
  assert.equal(
    staleVoteTargetReject.message,
    "Reject InvalidTarget: invalid target; vote target is no longer valid, refresh and use current vote controls",
  );

  const alreadySubmittedReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "withdraw_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
    }),
    commandIdFactory: () => "55555555-5555-4555-8555-555555555555",
    envelopeIdFactory: () => 14,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 14,
        body: {
          kind: "Reject",
          body: {
            error: "ActionAlreadySubmitted",
            retryable: false,
            message: "action already submitted",
          },
        },
      }),
  });
  assert.equal(
    alreadySubmittedReject.message,
    "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
  );

  const notYourSlotReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "submit_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
      target: "slot-2",
    }),
    commandIdFactory: () => "66666666-6666-4666-8666-666666666666",
    envelopeIdFactory: () => 15,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 15,
        body: {
          kind: "Reject",
          body: {
            error: "NotYourSlot",
            retryable: false,
            message: "not your slot",
          },
        },
      }),
  });
  assert.equal(
    notYourSlotReject.message,
    "Reject NotYourSlot: not your slot; slot ownership changed, refresh and use current role surface",
  );

  const retryableReject = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "withdraw_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
    }),
    commandIdFactory: () => "44444444-4444-4444-8444-444444444444",
    envelopeIdFactory: () => 13,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 13,
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

  const retryableRejectWithGuidance = await sendCommand({
    principalUserId: "player_mira",
    command: buildPlayerCommand({
      action: "withdraw_vote",
      game: "00000000-0000-0000-0000-000000000001",
      actorSlot: "slot-7",
    }),
    commandIdFactory: () => "44444444-4444-4444-8444-444444444445",
    envelopeIdFactory: () => 14,
    fetchImpl: async () =>
      jsonResponse({
        v: 1,
        id: 14,
        body: {
          kind: "Reject",
          body: {
            error: "StreamConflict",
            retryable: true,
            message: "reload and retry",
          },
        },
      }),
  });
  assert.equal(retryableRejectWithGuidance.retryable, true);
  assert.equal(
    retryableRejectWithGuidance.message,
    "Reject StreamConflict: reload and retry",
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
