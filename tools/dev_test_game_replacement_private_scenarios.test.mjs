import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  replacementConcurrentPrivatePostRaceScenario,
  replacementPrivatePostHardeningLaneIds,
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
  replacementStalePrivatePostAfterResolveScenario,
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";

test("replacement private scenario module groups private-post race and recovery lanes", () => {
  assert.deepEqual(replacementPrivatePostRaceLaneIds, [
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
  ]);
  assert.deepEqual(replacementPrivatePostRecoveryLaneIds, [
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
  ]);
  assert.deepEqual(replacementPrivatePostHardeningLaneIds, [
    ...replacementPrivatePostRaceLaneIds,
    ...replacementPrivatePostRecoveryLaneIds,
  ]);
});

test("replacement private-post race scenario carries shared command facts", () => {
  assert.deepEqual(replacementConcurrentPrivatePostRaceScenario(), {
    gameFixtureId: "replacement-private-post-race-game-a",
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: "submit_post",
    commandKind: "SubmitPost",
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Mira role URL in the Slot 7 private mafia channel raced SubmitPost against a host role URL ProcessReplacement command, accepted only post-before-replacement ACK ordering or NotYourSlot after replacement, then refreshed browser and API surfaces to Rowan as current Slot 7 with Mira's stale command-state and private-channel routes forbidden.",
  });
});

test("replacement resolved private-post scenario carries shared command facts", () => {
  assert.deepEqual(replacementStalePrivatePostAfterResolveScenario(), {
    gameFixtureId: "replacement-stale-private-post-after-resolve-game-a",
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: "submit_post",
    commandKind: "SubmitPost",
    postAckSeq: 71,
    fixturePostBody: "Replacement stale private post after resolve fixture",
    reconnectPostBody: "Replacement stale private post reconnect fixture",
    outcomeSummary:
      "Rowan's stale replacement private post ACKed after D01 resolution with locked channel truth",
  });
});

test("replacement completed private-post scenario carries shared command facts", () => {
  assert.deepEqual(replacementStalePrivatePostAfterCompleteScenario(), {
    gameFixtureId: "replacement-stale-private-post-after-complete-game-a",
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: "submit_post",
    commandKind: "SubmitPost",
    commandError: "GameAlreadyCompleted",
    commandMessage: "Reject GameAlreadyCompleted: game already completed",
    commandStateBoundary: "Role-action availability: game is complete.",
    commandStateBoundaryFragment: "game is complete",
    fixturePostBody: "Replacement stale private post after complete fixture",
    livePostBodyPrefix: "Stale Rowan private post after CompleteGame",
    outcomeSummary:
      "Rowan's stale replacement private post rejected GameAlreadyCompleted after host completion and reloaded into completed private-channel truth",
  });
});

test("replacement private live harness imports extracted scenario cases", async () => {
  const source = await readFile("tools/dev_test_game.mjs", "utf8");
  assert(
    source.includes("./dev_test_game_replacement_private_scenario_cases.mjs"),
    "dev-test-game live harness should import replacement private cases from the extracted case module",
  );
  assert(
    !source.includes("./dev_test_game_replacement_private_scenarios.mjs"),
    "dev-test-game live harness should not import replacement private cases through the compatibility facade",
  );
  assert(source.includes("replacementStalePrivatePostAfterResolveScenario"));
  assert(source.includes("replacementStalePrivatePostAfterCompleteScenario"));
});
