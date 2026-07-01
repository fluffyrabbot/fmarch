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
  return {
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
  };
}

export function replacementConcurrentVoteRaceScenario() {
  return {
    gameFixtureId: "replacement-vote-race-game-a",
    actorSlot: "slot-7",
    targetSlot: "slot-2",
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-mira",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    commandActionPrefix: "submit_vote",
    commandKind: "SubmitVote",
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Mira board role URL raced SubmitVote against a host role URL ProcessReplacement command, accepted only vote-before-replacement ACK ordering or NotYourSlot after replacement, then refreshed API surfaces to Rowan as current Slot 7 with Mira's stale command-state route forbidden.",
  };
}

export function replacementConcurrentActionRaceScenario() {
  return {
    gameFixtureId: "replacement-action-race-game-a",
    actorSlot: "slot_4",
    targetSlot: "slot-2",
    hostPrincipalUserId: "host_h",
    staleOutgoingPrincipalUserId: "player-goon-a",
    replacementPrincipalUserId: "player-rowan",
    replacementOccupantLabel: "player-rowan",
    actionId: "replacement_race_factional_kill",
    staleRetryActionId: "replacement_race_stale_retry",
    commandAction: "submit_action:factional_kill",
    commandKind: "SubmitAction",
    templateId: "factional_kill",
    phaseId: "N01",
    rejectionError: "NotYourSlot",
    proof:
      "A disposable Slot 4 mafia-goon role URL raced SubmitAction factional_kill against a host role URL ProcessReplacement command, accepted only action-before-replacement ACK ordering or NotYourSlot after replacement, then proved the stale outgoing role cannot retry while Rowan opens the current Slot 4 action surface.",
  };
}

export function replacementStalePrivatePostAfterResolveScenario() {
  return {
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
  };
}

export function replacementStalePrivatePostAfterCompleteScenario() {
  return {
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
  };
}
