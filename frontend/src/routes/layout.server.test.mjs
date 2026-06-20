import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+layout.server.js";

test("root layout exposes resolved session context for error surfaces", () => {
  const data = load({
    locals: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
  });

  assert.deepEqual(data, {
    appSession: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
  });
});

test("root layout fails closed without authenticated locals", () => {
  assert.deepEqual(load({ locals: {} }), {
    appSession: {
      principalUserId: null,
      resolvedCapabilities: [],
    },
  });
});
