import assert from "node:assert/strict";
import { test } from "node:test";
import { playerFeedback } from "./player-feedback-model.mjs";
import { persistPlayerInterruptedCommands, restorePlayerInterruptedCommands } from "../../../routes/g/[game]/player-route-controller.mjs";
const roster = [{ slot_id: "slot-2", occupancies: [{ began_seq: 1, ended_seq: null, names: [{ effective_seq: 1, public_name: "Ilya" }] }] }];
const attempt = { action: "submit_vote", commandId: "same-request", interruption: "timeout", command: { SubmitVote: { game: "game-a", actor_slot: "slot-7", target: { Slot: "slot-2" } } } };
test("unknown outcomes describe the exact saved vote without transport diagnostics", () => {
  assert.equal(playerFeedback({ status: { state: "interrupted", actionId: "submit_vote", message: "command ID secret" }, attempt, roster }).message, "Your vote for Ilya may not have gone through.");
});
test("confirmed success clears feedback; delayed refresh never offers an unknown outcome", () => {
  assert.equal(playerFeedback({ status: { state: "ack" }, attempt, roster }), null);
  assert.equal(playerFeedback({ status: { state: "ack", projectionUnavailable: true }, attempt, roster }).message, "Your vote for Ilya went through. Waiting for the game to update.");
});
test("rejections explain next steps without echoing server diagnostics", () => {
  const view = playerFeedback({ status: { state: "reject", error: "PhaseLocked", message: "projection uuid" }, attempt, roster });
  assert.match(view.message, /phase is closed/);
  assert.doesNotMatch(view.message, /projection|uuid|PhaseLocked/);
});
test("reload preserves the vote intent and exact retry request only in its game and authority", () => {
  const records = new Map();
  const storage = { getItem: k => records.get(k) ?? null, setItem: (k, v) => records.set(k, v), removeItem: k => records.delete(k) };
  const scope = { storage, game: "game-a", principalId: "viewer", actorSlot: "slot-7" };
  assert.equal(persistPlayerInterruptedCommands({ ...scope, attempts: { submit_vote: attempt } }), true);
  const restored = restorePlayerInterruptedCommands(scope);
  assert.equal(playerFeedback({ status: restored.commandStatus, attempt: restored.attempts.submit_vote, roster }).message, "Your vote for Ilya may not have gone through.");
  assert.deepEqual(restored.attempts.submit_vote.command, attempt.command);
  assert.equal(restored.attempts.submit_vote.commandId, attempt.commandId);
  assert.equal(restorePlayerInterruptedCommands({ ...scope, game: "game-b" }).commandStatus, null);
  persistPlayerInterruptedCommands({ ...scope, attempts: {} });
  assert.equal(restorePlayerInterruptedCommands(scope).commandStatus, null);
});
