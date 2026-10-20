import assert from "node:assert/strict";
import test from "node:test";

import { authoritySentence, capabilitySentence } from "./presentation-copy.mjs";

test("capability sentences name the game by title, never the capability", () => {
  const gameTitle = "Midsummer Invitational";
  assert.equal(capabilitySentence({ kind: "HostOf", game: "midsummer" }, { gameTitle }), "Hosting Midsummer Invitational");
  assert.equal(capabilitySentence({ kind: "CohostOf", game: "midsummer" }, { gameTitle }), "Co-hosting Midsummer Invitational");
  assert.equal(
    capabilitySentence({ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }, { gameTitle }),
    "Playing Midsummer Invitational",
  );
  assert.equal(
    capabilitySentence({ kind: "PendingReplacement", game: "midsummer" }, { gameTitle }),
    "Joining Midsummer Invitational as a replacement",
  );
  assert.equal(capabilitySentence({ kind: "SpectatorOf", game: "midsummer" }, { gameTitle }), "Watching Midsummer Invitational");
  assert.equal(capabilitySentence(null, { gameTitle }), "Reading Midsummer Invitational");
  assert.equal(capabilitySentence({ kind: "HostOf", game: "midsummer" }), "Hosting this game");
  assert.equal(capabilitySentence({ kind: "GlobalAdmin" }), "Site administrator");
  assert.equal(capabilitySentence(null), "Signed in");
});

test("authority sentences name who may act from capability kinds", () => {
  assert.equal(authoritySentence(["GlobalAdmin", "GlobalMod"]), "Site administrators or community moderators");
  assert.equal(authoritySentence(["HostOf"]), "The game's host");
  assert.equal(authoritySentence([]), "Signed-in accounts");
});
