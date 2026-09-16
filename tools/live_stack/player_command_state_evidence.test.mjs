import assert from "node:assert/strict";
import test from "node:test";
import { readPlayerCommandStateResponse } from "./player_command_state_evidence.mjs";

const url = "https://fixture.invalid/api/gameplay/games/game/player-command-state?slot_id=slot_4";
const response = (body, status = 200) => ({
  json: async () => body,
  url: () => url,
  status: () => status,
  ok: () => status >= 200 && status < 300,
});

test("current command-state DTO derives Day and Night evidence without a redundant kind", async () => {
  for (const [phaseId, phaseKind] of [["D01", "Day"], ["N01", "Night"], ["D02R1", "Day"]]) {
    const evidence = await readPlayerCommandStateResponse(response({
      actor_slot: "slot_4",
      role_key: "mafia_goon",
      phase: { phase_id: phaseId, locked: true, deadline: null },
      actions: [{ template_id: "factional_kill", targets: ["slot-2"], target_options: ["slot-3"] }],
      boundary: "Final command validation",
    }));
    assert.deepEqual(evidence, {
      url,
      pathname: "/api/gameplay/games/game/player-command-state",
      status: 200,
      ok: true,
      actorSlot: "slot_4",
      roleKey: "mafia_goon",
      phaseId,
      phaseKind,
      locked: true,
      actions: [{ templateId: "factional_kill", targets: ["slot-2"], targetOptions: ["slot-3"] }],
      boundary: "Final command validation",
    });
  }
});

test("missing or malformed canonical phase cannot match Day or Night via a legacy kind", async () => {
  for (const phase of [undefined, null, {}, { phase_kind: "Day" },
    ...["", "D1", "D00", "N01R0", "Night", 1].map((phase_id) => ({ phase_id, phase_kind: "Night" }))]) {
    const evidence = await readPlayerCommandStateResponse(response({ phase, actions: [] }));
    assert.equal(evidence.phaseKind, null);
    assert.equal(evidence.phaseKind === "Day" || evidence.phaseKind === "Night", false);
  }
});

test("canonical phase ID wins over a stray conflicting legacy kind", async () => {
  for (const [phase_id, phase_kind, expected] of [["D01", "Night", "Day"], ["N01", "Day", "Night"]]) {
    const evidence = await readPlayerCommandStateResponse(response({ phase: { phase_id, phase_kind } }));
    assert.equal(evidence.phaseKind, expected);
  }
});

test("response failure metadata remains a failure even with a valid phase", async () => {
  const evidence = await readPlayerCommandStateResponse(response({ phase: { phase_id: "D01" } }, 503));
  assert.equal(evidence.status, 503);
  assert.equal(evidence.ok, false);
  assert.equal(evidence.phaseKind, "Day");
});
