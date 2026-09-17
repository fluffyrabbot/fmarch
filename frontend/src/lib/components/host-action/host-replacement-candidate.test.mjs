import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_PRINCIPAL_IDS as ids } from "../../principal-id.mjs";
import { createReplacementChooser, replacementContext, replacementHandle, replacementWithCandidate, validateReplacementCandidate } from "./host-replacement-candidate.mjs";
import { buildHostConsoleCriticalActions } from "./host-console-critical-action.mjs";
import { shouldPreserveHostActionConfirmation } from "./host-action-contract.mjs";

const seat = Object.freeze({ slotId: "slot-7", personaId: "persona-mira", assignedPrincipalId: ids.playerMira, occupantLabel: "Mira" });
const authority = Object.freeze({ principalId: ids.hostH, capabilityKind: "HostOf", allowedClasses: [] });
const context = replacementContext({ gameId: "game-1", replacement: seat, authority });
const payload = Object.freeze({ slot_id: "slot-7", outgoing_persona_id: "persona-mira", principal_id: ids.playerRowan, handle: "rowan", display_name: "Rowan" });
const deferred = () => { let resolve; const promise = new Promise((done) => resolve = done); return { promise, resolve }; };

test("replacement lookup normalizes a full handle and binds candidate to the selected game and occupant", async () => {
  const calls = [];
  const chooser = createReplacementChooser({ fetchImpl: async (...args) => { calls.push(args); return Response.json(payload); } });
  chooser.setContext(context, true);
  chooser.setHandle(" @Rowan ");
  await chooser.lookup();
  assert.equal(calls[0][0], "/api/gameplay/games/game-1/replacement-candidate?slot_id=slot-7&handle=rowan");
  assert.deepEqual(chooser.view().candidate, { ...context, principalId: ids.playerRowan, handle: "rowan", displayName: "Rowan" });
  assert.equal(replacementHandle("ab"), null);
  assert.equal(replacementHandle("rowan-name"), null);
  assert.equal(replacementHandle("Kitty"), null);
});

for (const oldFinishesFirst of [true, false]) test(`replacement lookup ignores the earlier handle response (${oldFinishesFirst ? "old" : "new"} finishes first)`, async () => {
  const first = deferred(); const second = deferred(); let calls = 0;
  const chooser = createReplacementChooser({ fetchImpl: () => (++calls === 1 ? first : second).promise });
  chooser.setContext(context, true); chooser.setHandle("rowan"); const old = chooser.lookup();
  chooser.setHandle("birch"); const latest = chooser.lookup();
  const finishOld = async () => { first.resolve(Response.json(payload)); await old; };
  const finishNew = async () => { second.resolve(Response.json({ ...payload, handle: "birch", display_name: "Birch", principal_id: ids.cohostC })); await latest; };
  if (oldFinishesFirst) { await finishOld(); assert.equal(chooser.view().candidate, null); await finishNew(); }
  else { await finishNew(); await finishOld(); }
  assert.equal(chooser.view().candidate.handle, "birch");
});

for (const change of [
  { gameId: "game-2" }, { slotId: "slot-8" }, { outgoingPersonaId: "persona-next" },
  { outgoingPrincipalId: ids.cohostC }, { authorityPrincipalId: ids.cohostC },
]) test(`replacement lookup cannot cross changed ${Object.keys(change)[0]}`, async () => {
  const request = deferred();
  const chooser = createReplacementChooser({ fetchImpl: () => request.promise });
  chooser.setContext(context, true); chooser.setHandle("rowan"); const pending = chooser.lookup();
  chooser.setContext({ ...context, ...change }, true);
  request.resolve(Response.json(payload)); await pending;
  assert.equal(chooser.view().candidate, null);
  assert.equal(chooser.view().state, "idle");
});

test("replacement selection clears on any handle edit and a changed occupant", async () => {
  const chooser = createReplacementChooser({ fetchImpl: async () => Response.json(payload) });
  chooser.setContext(context, true); chooser.setHandle("rowan"); await chooser.lookup();
  chooser.setHandle("Rowan"); assert.equal(chooser.view().candidate, null);
  await chooser.lookup(); assert.ok(chooser.view().candidate);
  chooser.setContext({ ...context, outgoingPersonaId: "new-persona" }, true);
  assert.equal(chooser.view().candidate, null);
});

test("unready authority blocks lookup and invalidates an already pending response", async () => {
  const request = deferred(); let calls = 0;
  const chooser = createReplacementChooser({ fetchImpl: () => { calls += 1; return request.promise; } });
  chooser.setContext(context, false); chooser.setHandle("rowan"); await chooser.lookup(); assert.equal(calls, 0);
  chooser.setContext(context, true); const pending = chooser.lookup();
  chooser.setContext(context, false); chooser.setContext(context, true);
  request.resolve(Response.json(payload)); await pending;
  assert.equal(chooser.view().candidate, null);
  chooser.setContext(null, true); await chooser.lookup(); assert.equal(calls, 1);
});

test("replacement candidate decoder rejects wrong scope, identity and missing public labels", () => {
  for (const invalid of [null, {}, { ...payload, slot_id: "slot-2" }, { ...payload, outgoing_persona_id: "old" },
    { ...payload, principal_id: "player-rowan" }, { ...payload, principal_id: ids.playerMira },
    { ...payload, handle: "Rowan" }, { ...payload, handle: "birch" }, { ...payload, display_name: " " }]) {
    assert.throws(() => validateReplacementCandidate(invalid, context, "rowan"), /invalid or stale/);
  }
});

test("replacement access rejects operator-only, revoked and undelegated cohost contexts", () => {
  for (const denied of [null, { ...authority, capabilityKind: "GlobalOperator" }, { ...authority, capabilityKind: "CohostOf" }]) {
    assert.equal(replacementContext({ gameId: "game-1", replacement: seat, authority: denied }), null);
  }
  assert.ok(replacementContext({ gameId: "game-1", replacement: seat, authority: { ...authority, capabilityKind: "CohostOf", allowedClasses: ["replacement"] } }));
  assert.equal(replacementContext({ gameId: "game-1", replacement: seat, authority, completed: true }), null);
});

test("replacement errors leave no selected identity", async () => {
  const chooser = createReplacementChooser({ fetchImpl: async () => new Response(null, { status: 404 }) });
  chooser.setContext(context, true); chooser.setHandle("rowan"); await chooser.lookup();
  assert.equal(chooser.view().candidate, null);
  assert.equal(chooser.view().message, "No available member with that public handle.");
});

test("real replacement actions never inherit a fixture incoming identity and do not mutate projection", () => {
  const candidate = validateReplacementCandidate(payload, context, "rowan");
  const projection = { ...seat, incomingPrincipalId: ids.cohostC };
  const input = { gameId: "game-1", replacement: projection, authority };
  assert.equal(replacementWithCandidate(input).incomingPrincipalId, undefined);
  assert.equal(replacementWithCandidate({ ...input, candidate: { ...candidate, outgoingPersonaId: "stale" } }).incomingPrincipalId, undefined);
  assert.equal(replacementWithCandidate({ ...input, candidate }).incomingPrincipalId, ids.playerRowan);
  assert.equal(projection.incomingPrincipalId, ids.cohostC);
  assert.equal(replacementWithCandidate({ ...input, fixtureMode: true }).incomingPrincipalId, ids.cohostC);
});

test("replacement confirmation names the exact incoming member and resets when selected identity changes", () => {
  const candidate = validateReplacementCandidate(payload, context, "rowan");
  const actionFor = (selected) => buildHostConsoleCriticalActions("game-1", {
    replacement: replacementWithCandidate({ gameId: "game-1", replacement: seat, authority, candidate: selected }),
  }).find((action) => action.id === "process_replacement");
  const first = actionFor(candidate);
  const second = actionFor({ ...candidate, principalId: ids.cohostC, handle: "birch", displayName: "Birch" });
  assert.match(first.confirmationText, /Mira with Rowan \(@rowan\)/);
  assert.equal(first.confirmationText.includes(ids.playerRowan), false);
  assert.equal(first.payload.incomingPrincipalId, ids.playerRowan);
  assert.equal(shouldPreserveHostActionConfirmation(first, { ...first }, true), true);
  assert.equal(shouldPreserveHostActionConfirmation(first, second, true), false);
});
