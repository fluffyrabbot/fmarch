import assert from "node:assert/strict";
import { test } from "node:test";
import { previewResponse } from "./preview-transport.mjs";
import { fixtureApiRoutes } from "./role-fixtures.mjs";
import { validatePlayerCommandStateResponse, validateGameplayThreadPageResponse } from "../app/gameplay-response-schema.mjs";

test("healthy preview projects each phase and actor without mutating shared fixtures", () => {
  const before = JSON.stringify(fixtureApiRoutes);
  for (const phaseId of ["D01", "N01", "T01"]) {
    const response = previewResponse(new URL("http://localhost/api/gameplay/games/midsummer/player-command-state?slot_id=slot-4"), { phaseId });
    assert.equal(response.phase.phase_id, phaseId);
    assert.equal(validatePlayerCommandStateResponse(response, { game: "midsummer", actorSlot: "slot-4" }), true);
    const thread = previewResponse(new URL("http://localhost/api/gameplay/games/midsummer?limit=50"), { phaseId });
    assert.equal(validateGameplayThreadPageResponse(thread, { game: "midsummer", channel: "main" }), true);
  }
  assert.equal(JSON.stringify(fixtureApiRoutes), before);
});
