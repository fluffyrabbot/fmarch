import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  playerFactionalKillActionCommandFacts,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertReplacementActionRecoveryCoverageSummary,
  buildReplacementActionRecoveryCoverageSummary,
  replacementActionRecoveryCoverageFamilies,
  replacementActionRecoveryCoverageFamilyDefinitions,
  replacementActionLaneIds,
  replacementActionReconnectScenario,
  replacementIncomingActionScenario,
  replacementStaleActionAfterResolveScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";

test("replacement action lane IDs are shared in proof order", () => {
  assert.deepEqual(replacementActionLaneIds, [
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
  ]);
});

test("replacement action recovery coverage is derived from shared lanes", () => {
  assert(Object.isFrozen(replacementActionRecoveryCoverageFamilyDefinitions));
  assert.deepEqual(
    replacementActionRecoveryCoverageFamilies().map((family) => ({
      id: family.id,
      laneIds: family.laneIds,
    })),
    [
      {
        id: "replacement-action-current-surface",
        laneIds: ["replacement-incoming-action"],
      },
      {
        id: "replacement-action-reconnect",
        laneIds: ["replacement-action-reconnect"],
      },
      {
        id: "replacement-action-stale-reject",
        laneIds: ["replacement-stale-action-after-resolve"],
      },
    ],
  );
  const lanes = replacementActionLaneIds.map((id) => ({ id, status: "passed" }));
  const summary = buildReplacementActionRecoveryCoverageSummary(lanes);
  assert.deepEqual(summary.sourceLaneIds, replacementActionLaneIds);
  assert.equal(summary.laneCount, replacementActionLaneIds.length);
  assert.equal(summary.passedLaneCount, replacementActionLaneIds.length);
  assert.equal(summary.familyCount, 3);
  assert.doesNotThrow(() =>
    assertReplacementActionRecoveryCoverageSummary({ summary, lanes }),
  );
});

test("replacement incoming-action scenario carries shared command facts", () => {
  const action = playerFactionalKillActionCommandFacts({
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    phaseId: "N01",
  });
  assert.deepEqual(replacementIncomingActionScenario(), {
    laneId: "replacement-incoming-action",
    gameFixtureId: "replacement-incoming-action-game-a",
    actorSlot: action.actorSlot,
    targetSlot: action.targetSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-goon-a",
    replacementPrincipalUserId: "player-rowan",
    targetPrincipalUserId: "player-target",
    templateId: action.templateId,
    commandAction: action.commandAction,
    commandKind: action.commandKind,
    phaseId: action.phaseId,
    staleOutgoingError: "NotYourSlot",
    targetNoticeEffect: "player_killed",
    targetStatusAfterKill: "dead",
    actionId: "incoming_replacement_factional_kill",
    outcomeSummary:
      "Rowan submitted factional_kill as Slot 4 and killed slot-2",
    proof:
      "A disposable host role URL processed Slot 4 replacement, Rowan's current replacement role URL submitted factional_kill as Slot 4, the host role URL resolved N01, and the target role URL received the private player_killed factional_kill receipt while Rowan did not.",
  });
});

test("replacement action reconnect scenario carries shared command facts", () => {
  const action = playerFactionalKillActionCommandFacts({
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    phaseId: "N01",
  });
  assert.deepEqual(replacementActionReconnectScenario(), {
    laneId: "replacement-action-reconnect",
    gameFixtureId: "replacement-action-reconnect-game-a",
    actorSlot: action.actorSlot,
    targetSlot: action.targetSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-goon-a",
    replacementPrincipalUserId: "player-rowan",
    targetPrincipalUserId: "player-target",
    templateId: action.templateId,
    commandAction: action.commandAction,
    commandKind: action.commandKind,
    phaseId: action.phaseId,
    staleOutgoingError: "NotYourSlot",
    targetNoticeEffect: "player_killed",
    targetStatusAfterKill: "dead",
    actionId: "replacement_action_reconnect_factional_kill",
    reconnectPostPrefix: "Replacement action reconnect proof",
    reconnectPostBodyPrefix: "Replacement action reconnect proof from dev:test-game ",
    outcomeSummary:
      "Rowan reconnected after resolved Slot 4 factional_kill to locked N01 with no actions",
    proof:
      "After Rowan replaced into Slot 4, submitted factional_kill, and host resolved N01, Rowan's replacement role URL dropped its live projection and reconnected to locked N01 with no remaining actions while the target role URL retained the private kill receipt.",
  });
});

test("replacement stale action after resolve scenario carries shared command facts", () => {
  const action = playerFactionalKillActionCommandFacts({
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    phaseId: "N01",
  });
  assert.deepEqual(replacementStaleActionAfterResolveScenario(), {
    laneId: "replacement-stale-action-after-resolve",
    gameFixtureId: "replacement-stale-action-after-resolve-game-a",
    actorSlot: action.actorSlot,
    targetSlot: action.targetSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-goon-a",
    replacementPrincipalUserId: "player-rowan",
    targetPrincipalUserId: "player-target",
    templateId: action.templateId,
    commandAction: action.commandAction,
    commandKind: action.commandKind,
    phaseId: action.phaseId,
    staleOutgoingError: "NotYourSlot",
    targetNoticeEffect: "player_killed",
    targetStatusAfterKill: "dead",
    staleActionId: "role_factional_kill",
    rejectionError: "PhaseLocked",
    rejectionStatusText: "Reject PhaseLocked",
    staleActionStateMessageFragment: "stale action state",
    currentActionControlsMessageFragment: "current action controls",
    outcomeSummary:
      "Rowan's stale replacement factional_kill rejected after N01 resolution without appending",
    proof:
      "After Rowan replaced into Slot 4, a replacement role URL froze with factional_kill available, the host resolved N01, and Rowan's stale action click rejected PhaseLocked while refreshing to locked N01 with no actions and no target kill receipt.",
  });
});

test("replacement action scenarios import shared core action facts", async () => {
  const source = await readFile(
    "tools/dev_test_game_replacement_action_scenario_cases.mjs",
    "utf8",
  );
  assert(
    source.includes("./dev_test_game_core_loop_action_scenarios.mjs"),
    "replacement action scenarios should import shared core action facts",
  );
  assert(
    !source.includes('templateId: "factional_kill"') &&
      !source.includes('commandAction: "submit_action:factional_kill"'),
    "replacement action scenarios should not duplicate factional_kill command facts",
  );
});

test("replacement action consumers import extracted scenario cases", async () => {
  const sources = await Promise.all([
    readFile("tools/dev_test_game.mjs", "utf8"),
    readFile("tools/dev_test_game_live_proof.mjs", "utf8"),
    readFile("tools/dev_test_game_proof_contract.mjs", "utf8"),
  ]);
  for (const source of sources) {
    assert(source.includes("replacementIncomingActionScenario"));
    assert(source.includes("replacementActionReconnectScenario"));
    assert(source.includes("replacementStaleActionAfterResolveScenario"));
  }
});
