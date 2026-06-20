import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("board load opts into root-owned app shell", () => {
  const data = load({
    locals: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
      ],
    },
    url: new URL("https://fmarch.local/"),
  });

  assert.equal(data.shellOwner, "layout");
  assert.equal(data.shell.activeSurface, "board");
  assert.equal(data.shell.session.principalLabel, "player_mira");
  assert.equal(data.routeState, null);
});

test("board load exposes fixture route state for root-owned shell proof", () => {
  const original = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  try {
    const data = load({
      locals: {
        principalUserId: "player_mira",
        resolvedCapabilities: [
          { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        ],
      },
      url: new URL("https://fmarch.local/?__fmarch_route_state=loading"),
    });

    assert.equal(data.shellOwner, "layout");
    assert.deepEqual(data.routeState, {
      surface: "board",
      state: "loading",
      message: null,
      actionHref: null,
    });
  } finally {
    if (original === undefined) {
      delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
    } else {
      process.env.FMARCH_FRONTEND_FIXTURE_SESSION = original;
    }
  }
});
