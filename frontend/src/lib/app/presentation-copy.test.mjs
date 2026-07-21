import assert from "node:assert/strict";
import test from "node:test";

import {
  humanizeCapabilityLabel,
  humanizePrincipal,
  principalInitials,
  sessionContextLabel,
} from "./presentation-copy.mjs";

test("presentation copy translates technical identity and capability values", () => {
  assert.equal(humanizePrincipal("alice"), "@alice");
  assert.equal(humanizePrincipal("@alice"), "@alice");
  assert.equal(humanizeCapabilityLabel("HostOf(solstice)"), "Hosting solstice");
  assert.equal(humanizeCapabilityLabel("GlobalAdmin"), "Site administrator");
  assert.equal(principalInitials("alice-example"), "AE");
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
