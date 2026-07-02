import {
  privateChannelSubmitPostCommandFacts,
  staleCompletedPrivatePostCommandFacts,
} from "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs";
import {
  playerFactionalKillActionCommandFacts,
  playerSlotVoteCommandFacts,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

export const replacementPrivatePostRaceLaneIds = [
  "concurrent-replacement-private-post-race",
  "concurrent-replacement-private-post-race-reload",
];

export const replacementPrivatePostRecoveryLaneIds = [
  "replacement-stale-private-post-after-resolve",
  "replacement-stale-private-post-reconnect",
  "replacement-stale-private-post-after-complete",
  "replacement-stale-private-post-after-complete-reload",
];

export const replacementPrivatePostHardeningLaneIds = [
  ...replacementPrivatePostRaceLaneIds,
  ...replacementPrivatePostRecoveryLaneIds,
];

export function replacementConcurrentPrivatePostRaceScenario() {
  const privatePost = privateChannelSubmitPostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  return {
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
  };
}

export function replacementConcurrentVoteRaceScenario() {
  const vote = playerSlotVoteCommandFacts({
    actorSlot: "slot-7",
    targetSlot: "slot-2",
  });
  return {
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
  };
}

export function replacementConcurrentActionRaceScenario() {
  const action = playerFactionalKillActionCommandFacts({
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    actionId: "replacement_race_factional_kill",
    phaseId: "N01",
  });
  return {
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
  };
}

export function replacementStalePrivatePostAfterResolveScenario() {
  const privatePost = privateChannelSubmitPostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  return {
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
  };
}

export function replacementStalePrivatePostAfterCompleteScenario() {
  const completedPrivatePost = staleCompletedPrivatePostCommandFacts({
    channelId: "private:mafia_day_chat",
    actorSlot: "slot-7",
  });
  return {
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
  };
}
