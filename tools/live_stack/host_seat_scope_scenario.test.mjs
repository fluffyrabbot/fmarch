import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { assertHostSeatScope, observeHostSeatReads } from "./host_seat_scope_scenario.mjs";

test("explicit seat route, real refresh, selected occupant and invite scope agree", () => {
  assert.equal(assertHostSeatScope(fixture()).slotId, "slot-7");
});

test("default or mismatched route, refresh, occupant and invite cannot qualify", () => {
  for (const mutate of [
    (e) => { e.pageUrl = e.pageUrl.split("?")[0]; },
    (e) => { e.pageUrl += "&slot_id=slot-2"; },
    (e) => { e.pageUrl = e.pageUrl.replace("/game/", "/other/"); },
    (e) => { e.reads = []; },
    (e) => { e.reads[0].slotIds = []; },
    (e) => { e.reads[0].slotIds = ["slot-2"]; },
    (e) => { e.reads[0].pathname = "/api/gameplay/games/other/host-console-state"; },
    (e) => { e.reads[0].method = "POST"; },
    (e) => { e.reads[0].status = 503; },
    (e) => { e.replacement.slotId = "slot-2"; },
    (e) => { e.replacement.assignedPrincipalId = "other"; },
    (e) => { e.inviteTarget.slotId = "slot-2"; },
    (e) => { e.inviteTarget.principalId = "other"; },
    (e) => { e.inviteTarget.expectedOccupantPrincipalId = "other"; },
  ]) {
    const evidence = fixture();
    mutate(evidence);
    assert.throws(() => assertHostSeatScope(evidence));
  }
});

test("observer records actual scoped response metadata and can be detached", () => {
  const page = new EventEmitter();
  const observed = observeHostSeatReads(page, "game");
  const emit = (url, status = 200) => page.emit("response", {
    url: () => url, status: () => status, request: () => ({ method: () => "GET" }),
  });
  emit("http://localhost/api/gameplay/games/other/host-console-state?slot_id=slot-7");
  emit("http://localhost/live/tickets?game=game&ticket=private");
  emit("http://localhost/api/gameplay/games/game/host-console-state?slot_id=slot-7");
  assert.deepEqual(observed.reads, fixture().reads);
  observed.stop();
  emit("http://localhost/api/gameplay/games/game/host-console-state?slot_id=slot-2");
  assert.equal(observed.reads.length, 1);
});

function fixture() {
  const principalId = "3e6c50c7-c069-41c4-ae7b-01ebd4eb6991";
  return {
    game: "game", slotId: "slot-7", principalId,
    pageUrl: "http://localhost/g/game/host?slot_id=slot-7",
    reads: [{ pathname: "/api/gameplay/games/game/host-console-state", slotIds: ["slot-7"], method: "GET", status: 200 }],
    replacement: { slotId: "slot-7", assignedPrincipalId: principalId },
    inviteTarget: { slotId: "slot-7", principalId, expectedOccupantPrincipalId: principalId },
  };
}
