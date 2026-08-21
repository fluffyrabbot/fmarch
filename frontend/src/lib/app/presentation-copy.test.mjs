import assert from "node:assert/strict";
import test from "node:test";

import {
  humanizeCapabilityLabel,
  sessionContextLabel,
} from "./presentation-copy.mjs";

test("presentation copy translates capability values without formatting principals as handles", () => {
  assert.equal(humanizeCapabilityLabel("HostOf(solstice)"), "Hosting solstice");
  assert.equal(humanizeCapabilityLabel("GlobalAdmin"), "Site administrator");
});

test("session context only describes access for the current game", () => {
  assert.equal(
    sessionContextLabel({
      game: "solstice",
      capabilities: [
        { kind: "SlotOccupant", game: "solstice" },
        { kind: "HostOf", game: "equinox" },
      ],
    }),
    "Playing solstice",
  );
  assert.equal(
    sessionContextLabel({
      game: "solstice",
      capabilities: [
        { kind: "GlobalAdmin" },
        { kind: "HostOf", game: "equinox" },
      ],
    }),
    "Site admin",
  );
});
