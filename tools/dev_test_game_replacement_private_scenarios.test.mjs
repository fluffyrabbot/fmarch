import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  playerFactionalKillActionCommandFacts,
  playerSlotVoteCommandFacts,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  privateChannelSubmitPostCommandFacts,
  staleCompletedPrivatePostCommandFacts,
} from "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs";
import {
  assertReplacementPrivateChannelRecoveryCoverageSummary,
  buildReplacementPrivateChannelRecoveryCoverageSummary,
  replacementActionRaceLaneIds,
  replacementConcurrentActionRaceScenario,
  replacementConcurrentPrivatePostRaceScenario,
  replacementConcurrentVoteRaceScenario,
  replacementPrivateChannelRecoveryCoverageFamilies,
  replacementPrivateChannelRecoveryCoverageFamilyDefinitions,
  replacementPrivateChannelRecoveryLaneIds,
  replacementPrivatePostHardeningLaneIds,
  replacementPrivatePostRaceLaneIds,
  replacementPrivatePostRecoveryLaneIds,
  replacementRaceCoverageCellCases,
  replacementRaceLaneIds,
  replacementRaceReloadSpineTargetCases,
  replacementVoteRaceLaneIds,
  replacementStalePrivatePostAfterResolveScenario,
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";

test("replacement private scenario module groups private-post race and recovery lanes", () => {
  assert.deepEqual(replacementPrivatePostRaceLaneIds, [
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
  ]);
  assert.deepEqual(replacementVoteRaceLaneIds, [
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
  ]);
  assert.deepEqual(replacementActionRaceLaneIds, [
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
  ]);
  assert.deepEqual(replacementRaceLaneIds, [
    ...replacementPrivatePostRaceLaneIds,
    ...replacementVoteRaceLaneIds,
    ...replacementActionRaceLaneIds,
  ]);
  assert.deepEqual(replacementPrivatePostRecoveryLaneIds, [
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
  ]);
  assert.deepEqual(replacementPrivateChannelRecoveryLaneIds, [
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    ...replacementPrivatePostRecoveryLaneIds,
  ]);
  assert.deepEqual(replacementPrivatePostHardeningLaneIds, [
    ...replacementPrivatePostRaceLaneIds,
    ...replacementPrivatePostRecoveryLaneIds,
  ]);
  assert.deepEqual(
    replacementRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      roleSurfaces: cell.roleSurfaces,
    })),
    [
      {
        id: "replacement-private-post",
        raceLaneId: replacementPrivatePostRaceLaneIds[0],
        reloadLaneId: replacementPrivatePostRaceLaneIds[1],
        roleSurfaces: [
          "private-channel",
          "player",
          "replacementPlayer",
          "host",
        ],
      },
      {
        id: "replacement-vote",
        raceLaneId: replacementVoteRaceLaneIds[0],
        reloadLaneId: replacementVoteRaceLaneIds[1],
        roleSurfaces: ["player", "replacementPlayer", "host"],
      },
      {
        id: "replacement-action",
        raceLaneId: replacementActionRaceLaneIds[0],
        reloadLaneId: replacementActionRaceLaneIds[1],
        roleSurfaces: ["player", "replacementPlayer", "host"],
      },
    ],
  );
  assert.deepEqual(replacementRaceReloadSpineTargetCases(), [
    {
      targetKey: "replacementPrivatePostRaceReload",
      featureSlotId: "replacement-private-post-race-reload",
      reloadLaneId: replacementPrivatePostRaceLaneIds[1],
      role: "private-channel",
      channelId: "private:mafia_day_chat",
    },
    {
      targetKey: "replacementVoteRaceReload",
      featureSlotId: "replacement-vote-race-reload",
      reloadLaneId: replacementVoteRaceLaneIds[1],
      role: "player",
    },
    {
      targetKey: "replacementActionRaceReload",
      featureSlotId: "replacement-action-race-reload",
      reloadLaneId: replacementActionRaceLaneIds[1],
      role: "player",
    },
  ]);
});

test("replacement private-channel recovery coverage is derived from shared lanes", () => {
  assert(Object.isFrozen(replacementPrivateChannelRecoveryCoverageFamilyDefinitions));
  assert.deepEqual(
    replacementPrivateChannelRecoveryCoverageFamilies().map((family) => ({
      id: family.id,
      laneIds: family.laneIds,
    })),
    [
      {
        id: "replacement-private-authority",
        laneIds: [
          "replacement-stale-private-channel",
          "replacement-stale-private-receipts",
        ],
      },
      {
        id: "replacement-private-post-after-resolve",
        laneIds: [
          "replacement-stale-private-post-after-resolve",
          "replacement-stale-private-post-reconnect",
        ],
      },
      {
        id: "replacement-private-post-after-complete",
        laneIds: [
          "replacement-stale-private-post-after-complete",
          "replacement-stale-private-post-after-complete-reload",
        ],
      },
    ],
  );
  const lanes = replacementPrivateChannelRecoveryLaneIds.map((id) => ({
    id,
    status: "passed",
  }));
  const summary = buildReplacementPrivateChannelRecoveryCoverageSummary(lanes);
  assert.deepEqual(
    summary.sourceLaneIds,
    replacementPrivateChannelRecoveryLaneIds,
  );
  assert.equal(summary.laneCount, replacementPrivateChannelRecoveryLaneIds.length);
  assert.equal(
    summary.passedLaneCount,
    replacementPrivateChannelRecoveryLaneIds.length,
  );
  assert.equal(summary.familyCount, 3);
  assert.equal(
    summary.expectedLaneCount,
    replacementPrivateChannelRecoveryLaneIds.length,
  );
  assert.equal(summary.expectedFamilyCount, 3);
  assert.doesNotThrow(() =>
    assertReplacementPrivateChannelRecoveryCoverageSummary({ summary, lanes }),
  );
});

test("replacement private-post race scenario carries shared command facts", () => {
  const privatePost = privateChannelSubmitPostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  assert.deepEqual(replacementConcurrentPrivatePostRaceScenario(), {
    gameFixtureId: "replacement-private-post-race-game-a",
    channelId: privatePost.channelId,
    actorSlot: privatePost.actorSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: privatePost.commandAction,
    commandKind: privatePost.commandKind,
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Mira role URL in the Slot 7 private mafia channel raced SubmitPost against a host role URL ProcessReplacement command, accepted only post-before-replacement ACK ordering or NotYourSlot after replacement, then refreshed browser and API surfaces to Rowan as current Slot 7 with Mira's stale command-state and private-channel routes forbidden.",
  });
});

test("replacement vote race scenario carries shared command facts", () => {
  const vote = playerSlotVoteCommandFacts({
    actorSlot: "slot-7",
    targetSlot: "slot-2",
  });
  assert.deepEqual(replacementConcurrentVoteRaceScenario(), {
    gameFixtureId: "replacement-vote-race-game-a",
    actorSlot: vote.actorSlot,
    targetSlot: vote.targetSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandActionPrefix: vote.commandActionPrefix,
    commandKind: vote.commandKind,
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Mira board role URL raced SubmitVote against a host role URL ProcessReplacement command, accepted only vote-before-replacement ACK ordering or NotYourSlot after replacement, then refreshed API surfaces to Rowan as current Slot 7 with Mira's stale command-state route forbidden.",
  });
});

test("replacement action race scenario carries shared command facts", () => {
  const action = playerFactionalKillActionCommandFacts({
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    actionId: "replacement_race_factional_kill",
    phaseId: "N01",
  });
  assert.deepEqual(replacementConcurrentActionRaceScenario(), {
    gameFixtureId: "replacement-action-race-game-a",
    actorSlot: action.actorSlot,
    targetSlot: action.targetSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-goon-a",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    actionId: action.actionId,
    staleRetryActionId: "replacement_race_stale_retry",
    commandAction: action.commandAction,
    commandKind: action.commandKind,
    templateId: action.templateId,
    phaseId: action.phaseId,
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Slot 4 mafia-goon role URL raced SubmitAction factional_kill against a host role URL ProcessReplacement command, accepted only action-before-replacement ACK ordering or NotYourSlot after replacement, then proved the stale outgoing role cannot retry while Rowan opens the current Slot 4 action surface.",
  });
});

test("replacement resolved private-post scenario carries shared command facts", () => {
  const privatePost = privateChannelSubmitPostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  assert.deepEqual(replacementStalePrivatePostAfterResolveScenario(), {
    gameFixtureId: "replacement-stale-private-post-after-resolve-game-a",
    channelId: privatePost.channelId,
    actorSlot: privatePost.actorSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: privatePost.commandAction,
    commandKind: privatePost.commandKind,
    postAckSeq: 71,
    fixturePostBody: "Replacement stale private post after resolve fixture",
    reconnectPostBody: "Replacement stale private post reconnect fixture",
    outcomeSummary:
      "Rowan's stale replacement private post ACKed after D01 resolution with locked channel truth",
  });
});

test("replacement completed private-post scenario carries shared command facts", () => {
  const completedPrivatePost = staleCompletedPrivatePostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  assert.deepEqual(replacementStalePrivatePostAfterCompleteScenario(), {
    gameFixtureId: "replacement-stale-private-post-after-complete-game-a",
    channelId: completedPrivatePost.channelId,
    actorSlot: completedPrivatePost.actorSlot,
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandAction: completedPrivatePost.commandAction,
    commandKind: completedPrivatePost.commandKind,
    commandError: completedPrivatePost.commandError,
    commandMessage: completedPrivatePost.commandMessage,
    commandStateBoundary: completedPrivatePost.commandStateBoundary,
    commandStateBoundaryFragment:
      completedPrivatePost.commandStateBoundaryFragment,
    fixturePostBody: "Replacement stale private post after complete fixture",
    livePostBodyPrefix: "Stale Rowan private post after CompleteGame",
    outcomeSummary:
      "Rowan's stale replacement private post rejected GameAlreadyCompleted after host completion and reloaded into completed private-channel truth",
  });
});

test("replacement private-post scenarios import shared private-channel command facts", async () => {
  const source = await readFile(
    "tools/dev_test_game_replacement_private_scenario_cases.mjs",
    "utf8",
  );
  assert(
    source.includes(
      "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs",
    ),
    "replacement private-post scenarios should import shared private-channel scenario facts",
  );
  assert(
    !source.includes('commandAction: "submit_post"') &&
      !source.includes('commandKind: "SubmitPost"') &&
      !source.includes('commandError: "GameAlreadyCompleted"') &&
      !source.includes(
        'commandMessage: "Reject GameAlreadyCompleted: game already completed"',
      ),
    "replacement private-post scenarios should not duplicate private-channel command facts",
  );
});

test("replacement vote/action race scenarios import shared core command facts", async () => {
  const source = await readFile(
    "tools/dev_test_game_replacement_private_scenario_cases.mjs",
    "utf8",
  );
  assert(
    source.includes("./dev_test_game_core_loop_action_scenarios.mjs"),
    "replacement vote/action races should import shared core action scenario facts",
  );
  assert(
    !source.includes('commandActionPrefix: "submit_vote"') &&
      !source.includes('commandKind: "SubmitVote"') &&
      !source.includes('commandAction: "submit_action:factional_kill"') &&
      !source.includes('commandKind: "SubmitAction"') &&
      !source.includes('templateId: "factional_kill"'),
    "replacement vote/action races should not duplicate core command facts",
  );
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
  assert(source.includes("replacementConcurrentVoteRaceScenario"));
  assert(source.includes("replacementConcurrentActionRaceScenario"));
});

test("replacement race proof and readiness import extracted scenario cases", async () => {
  const proofContractSource = await readFile(
    "tools/dev_test_game_proof_contract.mjs",
    "utf8",
  );
  const liveProofSource = await readFile("tools/dev_test_game_live_proof.mjs", "utf8");
  for (const source of [proofContractSource, liveProofSource]) {
    assert(source.includes("replacementConcurrentVoteRaceScenario"));
    assert(source.includes("replacementConcurrentActionRaceScenario"));
  }
});
