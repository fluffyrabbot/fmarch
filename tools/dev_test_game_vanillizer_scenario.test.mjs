import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVanillizerRoleActionBrowserProof,
  buildVanillizerRoleActionProofFixture,
  vanillizerRoleActionLaneId,
  vanillizerRoleActionProofPassed,
  vanillizerRoleActionScenario,
  vanillizerSeedCommandPlan,
} from "./dev_test_game_vanillizer_scenario.mjs";

test("vanillizer scenario owns its seeded command grammar", () => {
  const game = "00000000-0000-4000-8000-000000000001";
  const scenario = vanillizerRoleActionScenario();
  const plan = vanillizerSeedCommandPlan(game);

  assert.equal(scenario.laneId, vanillizerRoleActionLaneId);
  assert.equal(plan.length, 14);
  assert.deepEqual(plan.at(-1), [
    "host_h",
    { StartGame: { game, phase: "N01" } },
  ]);
  assert.equal(
    plan.some(
      ([principal, command]) =>
        principal === "host_h" &&
        command.AssignRole?.slot === "slot_1" &&
        command.AssignRole?.role_key === "vanillizer",
    ),
    true,
  );
});

test("vanillizer browser proof requires role mutation through the next night", () => {
  const game = "00000000-0000-4000-8000-000000000001";
  const proof = buildVanillizerRoleActionProofFixture(game);

  assert.equal(vanillizerRoleActionProofPassed(proof, game), true);
  assert.equal(
    assertVanillizerRoleActionBrowserProof({ proof, expectedGame: game }),
    proof,
  );
  assert.equal(
    vanillizerRoleActionProofPassed(
      {
        ...proof,
        targetAfterReload: {
          ...proof.targetAfterReload,
          commandState: {
            ...proof.targetAfterReload.commandState,
            actions: [{ templateId: "cop_investigate" }],
          },
        },
      },
      game,
    ),
    false,
  );
});
