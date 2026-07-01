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
